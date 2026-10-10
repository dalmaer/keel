// Versioned timing receipts. File plans are resolved before launch; observations
// never invent the expected file set. No failure text or environment values here.
import { glob, realpath } from 'node:fs/promises';
import { relative, resolve, sep, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])])) : v;
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const safeFile = s => typeof s === 'string' && s.length <= 1024 && s !== '' && !isAbsolute(s) && !s.split(/[\\/]/).includes('..') && !/[\x00-\x1f]/.test(s);
const posix = s => s.split(sep).join('/');
const nonnegative = n => Number.isFinite(n) && n >= 0;
export const RECEIPT_LIMITS = Object.freeze({ files: 2000, tests: 20000, identityChars: 1000 });

/** A deliberately small literal Node script grammar. Shell programs are unknown. */
export async function nodePlan({ root, cwd = root, script, words, flags, revision, invocationId = randomUUID() }) {
  root = await realpath(root); cwd = await realpath(cwd);
  const unavailable = reason => ({ version: 1, invocationId, available: false, reason });
  if (typeof script !== 'string' || /[;&|<>$`\n\r]/.test(script)) return unavailable('dynamic or compound test script');
  const ws = words(script);
  if (ws.shift() !== 'node' || !ws.includes('--test')) return unavailable('not a literal Node test script');
  const optionWords = flags(ws).flatMap(f => f.words), selected = [];
  let i = 0;
  // Flags must precede files; otherwise --test can be a script argument.
  while (i < ws.length && ws[i].startsWith('-')) {
    const f = flags(ws.slice(i))[0];
    if (!f || f.words.some(v => v === undefined)) return unavailable('unknown option');
    i += f.words.length;
  }
  selected.push(...ws.slice(i));
  if (!selected.length || selected.some(s => s.startsWith('-') || !safeFile(s))) return unavailable('no bounded literal file selection');
  const isolation = optionWords.find(s => s.startsWith('--test-isolation='))?.split('=')[1] ?? (optionWords.includes('--test-isolation') ? optionWords[optionWords.indexOf('--test-isolation') + 1] : 'process');
  const concurrency = optionWords.find(s => s.startsWith('--test-concurrency='))?.split('=')[1] ?? (optionWords.includes('--test-concurrency') ? optionWords[optionWords.indexOf('--test-concurrency') + 1] : 'default');
  const filtered = optionWords.some(s => /^--test-(name-pattern|skip-pattern|only|shard)(=|$)/.test(s));
  const found = [];
  for (const pattern of selected) {
    let n = 0;
    for await (const file of glob(pattern, { cwd })) {
      const absolute = await realpath(resolve(cwd, file));
      const rel = posix(relative(root, absolute));
      if (!safeFile(rel) || !/\.[cm]?[jt]sx?$/.test(rel)) return unavailable('selection outside project or unsupported test file');
      found.push(rel); n++;
      if (found.length > RECEIPT_LIMITS.files) return unavailable('file selection limit');
    }
    if (!n) return unavailable('declared selection matched no files');
  }
  if (new Set(found).size !== found.length) return unavailable('duplicate selected files');
  const executionSettings = { isolation, concurrency, selection: selected, flagsHash: digest(optionWords), filtered };
  return { version: 1, available: true, invocationId, revision, scope: posix(relative(root, cwd)) || '.', expectedFiles: found.sort(), executionSettings,
    commandHash: digest(script), settingsHash: digest(executionSettings) };
}

/** Node testId/parentId establish lineage; duplicate full names remain ambiguous. */
export function suiteCollector({ root, plan, flagsHash, sanitize = value => value }) {
  const summaries = [], nodes = new Map(), problems = [];
  let aggregate = null, aggregates = 0, truncated = false;
  const fileOf = f => typeof f === 'string' ? posix(relative(root, resolve(f))) : null;
  return {
    push(e) {
      const d = e.data ?? {}, file = fileOf(d.file);
      if (e.type === 'test:summary') {
        const summary = { file, durationMs: d.duration_ms, success: d.success, counts: d.counts };
        if (file) { if (summaries.length < RECEIPT_LIMITS.files) summaries.push(summary); else truncated = true; }
        else { aggregate = summary; aggregates++; }
      }
      if (!['test:pass', 'test:fail'].includes(e.type) || !file || !d.details?.type || resolve(root, String(d.name)) === d.file) return;
      if (nodes.size >= RECEIPT_LIMITS.tests || typeof d.name !== 'string' || d.name.length > RECEIPT_LIMITS.identityChars) { truncated = true; return; }
      const safeName = sanitize(d.name);
      if (safeName !== d.name) problems.push('logical identity redacted; mapping unavailable');
      const id = `${file}:${d.testId}`;
      if (!Number.isInteger(d.testId) || (d.nesting > 0 && !Number.isInteger(d.parentId)) || nodes.has(id)) problems.push('logical identity linkage unavailable');
      nodes.set(id, { file, testId: d.testId, parentId: d.parentId, name: safeName, nesting: d.nesting, type: d.details.type, durationMs: d.details.duration_ms,
        outcome: d.skip ? 'skip' : d.todo ? 'todo' : e.type === 'test:pass' ? 'pass' : 'fail' });
    },
    finish() {
      const observedInventory = [];
      for (const node of nodes.values()) {
        const hierarchy = [node.name], visited = new Set([node.testId]);
        let current = node;
        while (current.nesting > 0 && Number.isInteger(current.parentId)) {
          if (visited.has(current.parentId)) { problems.push('cyclic test linkage'); break; }
          visited.add(current.parentId);
          current = nodes.get(`${node.file}:${current.parentId}`);
          if (!current) { problems.push('missing parent identity'); break; }
          hierarchy.unshift(current.name);
        }
        observedInventory.push({ file: node.file, hierarchy, occurrence: 1, type: node.type, outcome: node.outcome, durationMs: node.durationMs });
      }
      if (aggregate && nodes.size !== (aggregate.counts?.tests ?? -1) + (aggregate.counts?.suites ?? -1)) problems.push('logical inventory count differs from aggregate');
      const keys = observedInventory.map(t => digest({file:t.file,hierarchy:t.hierarchy,occurrence:t.occurrence,type:t.type}));
      if (new Set(keys).size !== keys.length) problems.push('duplicate logical names are ambiguous');
      if (truncated) problems.push('inventory or summary limit exceeded');
      const expected = plan?.available === true ? plan.expectedFiles : [];
      const files = summaries.map(s => s.file);
      const complete = plan?.available === true && plan.executionSettings?.isolation === 'process' && !plan.executionSettings.filtered &&
        plan.executionSettings.flagsHash === flagsHash && aggregates === 1 && aggregate?.success === true && nonnegative(aggregate.durationMs) && expected.length > 0 &&
        files.length === expected.length && new Set(files).size === files.length && files.every(f => expected.includes(f)) && summaries.every(s => s.success === true && nonnegative(s.durationMs));
      return { version: 1, invocationId: plan?.invocationId ?? null, revision: plan?.revision ?? null, expectedFiles: expected,
        executionSettings: plan?.executionSettings ?? null, settingsHash: plan?.settingsHash ?? null, commandHash: plan?.commandHash ?? null,
        observedSummaries: summaries, aggregate, complete, observedInventory,
        inventoryComplete: complete && !problems.length && !truncated, inventoryProblems: [...new Set(problems)],
        gaps: complete ? [] : [plan?.reason ?? 'expected files, settings or successful final summaries unavailable'] };
    },
  };
}

export async function readReceiptPlan(env = process.env) {
  try { return JSON.parse(env.KEEL_SUITE_PLAN ?? 'null'); } catch { return null; }
}

/** No transcript or error text. One receipt per matched top-level identity. */
export function stallsEvidence({ identity, plain, stalled, pinned, startedAt, completedAt, configHash, flagsHash, scope = '.', sanitize = value => value }) {
  const receipts = [], seen = new Set();
  for (const t of plain.tests ?? []) {
    const key = JSON.stringify([t.file, t.name]);
    const matches = (stalled.tests ?? []).filter(s => s.file === t.file && s.name === t.name);
    if (seen.has(key) || matches.length !== 1 || (plain.tests ?? []).filter(s => s.file === t.file && s.name === t.name).length !== 1 || !safeFile(t.file)) continue;
    seen.add(key);
    const name = sanitize(t.name);
    receipts.push({ version: 1, id: randomUUID(), identity: { kind: 'stalls', scope, runner: 'node', configHash, flagsHash, target: { file: t.file, name } },
      revision: identity.commit, clean: identity.dirty === false, startedAt, completedAt, pinned: pinned === true,
      seed: stalled.seed, verifiedInjected: (stalled.stalls ?? []).length > 0 && stalled.paused > 0, pauses: (stalled.stalls ?? []).length,
      complete: name === t.name && name.length<=1000 && (plain.from!=='ledger'||plain.revision===identity.commit) && !plain.timedOut && !stalled.timedOut && [0, 1].includes(stalled.exitCode) && (plain.from === 'ledger' || [0, 1].includes(plain.exitCode)),
      plain: t.outcome, stalled: matches[0].outcome });
  }
  return receipts;
}

export function isStallsReceipt(r) {
  const keys=['version','id','identity','revision','clean','startedAt','completedAt','pinned','seed','verifiedInjected','pauses','complete','plain','stalled'];
  return r && Object.keys(r).every(k=>keys.includes(k)) && Object.keys(r.identity??{}).every(k=>['kind','scope','runner','configHash','flagsHash','target'].includes(k)) && Object.keys(r.identity?.target??{}).every(k=>['file','name'].includes(k)) && r.version===1 && typeof r.id==='string' && r.id.length<=100 &&
    r.identity?.kind==='stalls' && typeof r.identity.scope==='string' && r.identity.runner==='node' &&
    typeof r.identity.configHash==='string' && typeof r.identity.flagsHash==='string' &&
    safeFile(r.identity.target?.file) && typeof r.identity.target?.name==='string' && r.identity.target.name.length<=1000 &&
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(r.revision??'') && typeof r.clean==='boolean' &&
    Number.isFinite(Date.parse(r.startedAt)) && Number.isFinite(Date.parse(r.completedAt)) && Date.parse(r.startedAt)<=Date.parse(r.completedAt) &&
    typeof r.pinned==='boolean' && typeof r.complete==='boolean' && typeof r.verifiedInjected==='boolean' &&
    Number.isInteger(r.seed) && r.seed>=0 && r.seed<=4294967295 && Number.isSafeInteger(r.pauses) && r.pauses>=0 &&
    ['pass','fail','inconclusive','skip','todo'].includes(r.plain) && ['pass','fail','inconclusive','skip','todo'].includes(r.stalled);
}

// Read-only reconciliation. Ships standalone: no runtime dependencies or writes.
// Receipts: keel-proof JSON fences, version 1, in the referenced evidence section.
// Research/design decisions require an explicit <a id="…"></a> section anchor.
// Impact unchanged reasons: {unchanged: {"docs/phases/01-example.md": "reason"}}.
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const LIMIT = 1024 * 1024, MAX_FILES = 2000;
const hash = s => createHash('sha256').update(s).digest('hex');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const string = x => typeof x === 'string' && x.trim().length > 0;
const strings = x => Array.isArray(x) && x.length <= MAX_FILES && x.every(string);
const stable = x => JSON.stringify(x, function (k, v) { return object(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v; });
const result = () => ({ findings: [], notes: [], unknown: [], snapshot: { blobs: {}, prs: {}, remote: 'skipped' }, proposals: [] });
const issue = (rule, path, message, extra = {}) => ({ rule, path, message, ...extra });
const prKey = value => {
  if (typeof value !== 'string') return null;
  const m = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)(?:#|\/pull\/)([1-9]\d*)$/.exec(value);
  return m ? `${m[1]}/${m[2]}#${m[3]}` : null;
};
function refParts(ref) {
  if (!string(ref) || ref.length > 1024) throw Error('invalid record reference');
  const [path, anchor, ...rest] = ref.split('#');
  if (rest.length || !/^docs\/(?:phases\/|projects\/|decisions\/|research\/|evidence\/|design\.md$)/.test(path) || !path.endsWith('.md') || /[\\\x00-\x1f%:]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..') || (anchor !== undefined && !/^[\w.-]+$/.test(anchor))) throw Error(`unsafe record reference: ${ref}`);
  return { path, anchor };
}
async function safePath(root, path) {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw Error(`symlink refused: ${path}`);
  }
  return current;
}
function markdown(text) {
  const sections = [], fences = [], prose = [];
  let section = { title: '', anchor: null, explicit: false, lines: [] }, fence = null, pending = null;
  const ancestry = [];
  sections.push(section);
  const seen = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.char}{${fence.size},}\\s*$`).test(line)) { fences.push({ ...fence, body: fence.lines.join('\n'), section }); fence = null; }
      else fence.lines.push(line);
      continue;
    }
    const f = /^ {0,3}(`{3,}|~{3,})([^\s]*)\s*$/.exec(line);
    if (f) { fence = { char: f[1][0], size: f[1].length, type: f[2], lines: [], section }; continue; }
    const a = /<a\s+(?:id|name)=["']([\w.-]+)["']\s*>\s*<\/a>/.exec(line);
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const slug = heading[2].toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-');
      const count = seen.get(slug) || 0; seen.set(slug, count + 1);
      while (ancestry.length && ancestry.at(-1).level >= heading[1].length) ancestry.pop();
      const historical = /^(?:trajectory|history|historical|evidence|proof)\b/i.test(heading[2]) || ancestry.some(s => s.historical);
      section = { historical, title: heading[2], level: heading[1].length, anchor: a?.[1] || pending || `${slug}${count ? `-${count}` : ''}`, explicit: !!(a || pending), lines: [] };
      sections.push(section); ancestry.push(section); pending = null;
    } else if (a) { pending = a[1]; section.anchor = a[1]; section.explicit = true; }
    section.lines.push(line); prose.push(line);
  }
  return { sections, fences, prose: prose.join('\n'), unclosed: fence };
}
function jsonFence(f) {
  const v = JSON.parse(f.body);
  if (!object(v) || v.version !== 1) throw Error(`${f.type} requires an object with version 1`);
  return v;
}
async function reader(root, out) {
  root = await realpath(root);
  const cache = new Map();
  async function read(ref) {
    const { path, anchor } = refParts(ref);
    if (!cache.has(path)) {
      if (cache.size >= MAX_FILES) throw Error('record limit exceeded');
      try {
        const target = await safePath(root, path), stat = await lstat(target);
        if (!stat.isFile() || stat.size > LIMIT) throw Error(`not a bounded regular file: ${path}`);
        const text = await readFile(target, 'utf8');
        out.snapshot.blobs[path] = hash(text); cache.set(path, { path, text, ...markdown(text) });
      } catch (e) { if (e.code === 'ENOENT') out.snapshot.blobs[path] = null; throw e; }
    }
    const doc = cache.get(path);
    const section = anchor ? doc.sections.find(s => s.anchor === anchor) : null;
    if (anchor && !section) throw Error(`missing anchor: ${ref}`);
    return { ...doc, section };
  }
  const files = [];
  let entries = 0;
  async function walk(path, depth = 0) {
    if (depth > 12) throw Error('record depth limit exceeded');
    let dir;
    try { dir = await safePath(root, path); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++entries > MAX_FILES) throw Error('record limit exceeded');
      const p = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) { out.unknown.push(issue('record-unreadable', p, 'Symlink skipped')); continue; }
      if (entry.isDirectory()) await walk(p, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(p);
    }
  }
  for (const dir of ['docs/phases', 'docs/projects', 'docs/decisions', 'docs/research']) {
    try { await walk(dir); } catch (e) { out.unknown.push(issue('record-unreadable', dir, e.message)); }
  }
  try { await safePath(root, 'docs/design.md'); files.push('docs/design.md'); } catch (e) { if (e.code !== 'ENOENT') out.unknown.push(issue('record-unreadable', 'docs/design.md', e.message)); }
  return { read, files };
}
async function observe(key, { env = process.env, prFacts }) {
  let value;
  if (prFacts !== undefined) {
    if (!object(prFacts) || !Object.hasOwn(prFacts, key)) throw Error(`no fresh observation for ${key}`);
    value = prFacts[key];
  } else {
    const [repo, n] = key.split('#');
    const { stdout } = await exec(env.KEEL_GH || 'gh', ['api', `repos/${repo}/pulls/${n}`], { env, timeout: 15000, maxBuffer: LIMIT });
    value = JSON.parse(stdout);
  }
  if (!object(value) || !['open', 'closed'].includes(value.state) || typeof value.draft !== 'boolean' || !Object.hasOwn(value, 'merged_at') || (value.merged_at !== null && (!string(value.merged_at) || !Number.isFinite(Date.parse(value.merged_at)))) || (value.merged_at && !string(value.merge_commit_sha)) || value.cached || value.stale || value.error) throw Error(`invalid or cached PR observation: ${key}`);
  // Include revisions/updated time in the freshness token, not observation time.
  return { state: value.state, draft: value.draft, merged_at: value.merged_at, merge_commit_sha: value.merge_commit_sha ?? null, head: value.head?.sha ?? null, base: value.base?.sha ?? null, updated_at: value.updated_at ?? null, html_url: value.html_url || `https://github.com/${key.replace('#', '/pull/')}`, reverted: value.reverted === true };
}
function active(doc) {
  // Local variants may put a standalone current Next action after Trajectory.
  // Fenced code and blockquotes never become current actions.
  return doc.sections.map(s => {
    if (!s.historical) return s.lines.join('\n');
    const paragraphs = s.lines.join('\n').split(/\n\s*\n/);
    return paragraphs.filter(p => /^\*\*Next action[.:]?\*\*/i.test(p.trim())).join('\n');
  }).join('\n');
}
function phaseScope(doc, fence) {
  if (!doc.path.startsWith('docs/projects/')) return doc;
  const index = doc.sections.indexOf(fence.section);
  const isPhase = s => s.level === 2 && /^(?:Phase \d|\d+\.)/.test(s.title);
  let start = index;
  while (start > 0 && !isPhase(doc.sections[start])) start--;
  let end = index + 1;
  while (end < doc.sections.length && !isPhase(doc.sections[end])) end++;
  return { ...doc, sections: doc.sections.slice(start, end), subject: `${doc.path}#${doc.sections[start].anchor}` };
}
const scopeList = v => typeof v === 'string' ? [v] : v;

export async function reconcile({ root, github = false, env = process.env, prFacts, now = new Date() }) {
  const out = result();
  const observedAt = new Date(now).toISOString();
  const { read, files } = await reader(root, out);
  let repo;
  try {
    const configPath = await safePath(await realpath(root), '.keel/keel.json');
    const stat = await lstat(configPath);
    if (!stat.isFile() || stat.size > LIMIT) throw Error('Configuration exceeds read limits');
    const configText = await readFile(configPath, 'utf8');
    const config = JSON.parse(configText);
    if (!object(config)) throw Error('Invalid configuration');
    repo = typeof config.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(config.repo) ? config.repo : undefined;
    out.snapshot.config_hash = hash(configText);
  } catch (e) { if (e.code !== 'ENOENT') out.unknown.push(issue('record-config', '.keel/keel.json', e.message)); }
  out.snapshot.inventory = [...files].sort();
  const docs = [], decisions = new Map(), phases = [], prs = new Set();
  const add = (rule, path, message, extra = {}) => out.findings.push(issue(rule, path, message, { confidence: 'deterministic', ...extra }));
  async function reference(ref, owner, rule = 'record-reference') {
    try { return await read(ref); } catch (e) { add(rule, owner, e.message, { observed: ref }); return null; }
  }
  for (const path of files) {
    let doc;
    try { doc = await read(path); docs.push(doc); } catch (e) { out.unknown.push(issue('record-unreadable', path, e.message)); continue; }
    const phase = /^docs\/(phases|projects)\//.test(path) && !/\/README\.md$/i.test(path);
    for (const f of [...doc.fences, ...(doc.unclosed ? [doc.unclosed] : [])]) {
      const relevant = (f.type === 'keel-reconciliation' && phase && /^Reconciliation\b/i.test(f.section?.title || '')) || (f.type === 'keel-decision' && (path.startsWith('docs/decisions/') || f.section?.explicit));
      if (!relevant) continue;
      try {
        const v = jsonFence(f);
        if (f.type === 'keel-decision') {
          if (!string(v.id) || !/^[\w.-]+$/.test(v.id) || !['proposed', 'accepted', 'superseded', 'withdrawn'].includes(v.status) || !strings(scopeList(v.scope)) || !strings(v.supersedes ?? []) || !strings(v.superseded_by ?? []) || (['accepted', 'superseded'].includes(v.status) && (!string(v.decided_by) || !string(v.decided_at)))) throw Error('invalid decision metadata');
          const key = `${path}#${f.section.anchor || v.id}`;
          if (decisions.has(key)) throw Error(`duplicate decision: ${key}`);
          decisions.set(key, { ...v, path, key, scope: scopeList(v.scope), supersedes: v.supersedes ?? [], superseded_by: v.superseded_by ?? [] });
        } else {
          if (!strings(v.prs ?? []) || !strings(v.decisions ?? []) || ['implementation', 'production', 'use'].some(k => !Array.isArray(v[k] ?? []) || (v[k] ?? []).some(x => !object(x) || !string(x.acceptance) || !string(x.evidence))) || (v.next !== undefined && (!object(v.next) || !['acceptance', 'review-pr', 'decision', 'use', 'none'].includes(v.next.kind) || (v.next.kind !== 'none' && !string(v.next.ref))))) throw Error('invalid reconciliation metadata');
          phases.push({ doc: phaseScope(doc, f), v });
          for (const p of [...(v.prs ?? []), ...(v.next?.kind === 'review-pr' ? [v.next.ref] : [])]) { const key = prKey(p); if (!key) add('record-reference', path, `PR must be repo-qualified: ${p}`); else prs.add(key); }
        }
      } catch (e) { add('record-schema', path, e.message); }
    }
    if (phase && !phases.some(p => p.doc.path === doc.path)) out.notes.push(issue('legacy-record', path, 'No structured reconciliation references; prose observations are advisory.'));
    if (phase && repo) for (const match of active(doc).matchAll(/(?<![\w./-])PR\s*#?([1-9]\d*)\b/gi)) prs.add(`${repo}#${match[1]}`);
    if (phase) for (const match of active(doc).matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*|\b[\w.-]+\/[\w.-]+#[1-9]\d*/g)) prs.add(prKey(match[0]));
  }
  if (github) {
    out.snapshot.remote = 'observed';
    for (const key of [...prs].sort()) {
      try { out.snapshot.prs[key] = await observe(key, { env, prFacts }); }
      catch (e) { out.unknown.push(issue('github-unavailable', key, e.message)); }
    }
    if (out.unknown.some(x => x.rule === 'github-unavailable')) out.snapshot.remote = 'incomplete';
  } else if (prs.size) out.notes.push(issue('github-skipped', '', 'Remote lane skipped; merge facts are not verified.'));

  for (const { doc, v } of phases) {
    const path = doc.subject || doc.path, boxes = new Map();
    for (const m of active(doc).matchAll(/^\s*- \[([ xX])\].*?<!--\s*acceptance:\s*([\w.-]+)\s*-->/gm)) {
      if (boxes.has(m[2])) add('acceptance-id', path, `Duplicate acceptance ID: ${m[2]}`);
      boxes.set(m[2], m[1].toLowerCase() === 'x');
    }
    for (const ref of v.decisions ?? []) {
      if (!await reference(ref, path)) continue;
      const d = decisions.get(ref);
      if (!d || !['accepted', 'superseded'].includes(d.status)) add('decision-reference', path, `Active reference is not an accepted decision: ${ref}`);
      else {
        const successors = [...decisions.values()].filter(s => s.status === 'accepted' && s.supersedes.includes(ref));
        if (d.status === 'superseded' || successors.length) add('decision-superseded', path, `Review only the replaced scopes of ${ref}`, { observed: ref, successors: successors.map(s => ({ ref: s.key, scope: s.scope })) });
      }
    }
    for (const kind of ['implementation', 'production', 'use']) for (const entry of v[kind] ?? []) {
      if (!boxes.has(entry.acceptance)) add('acceptance-id', path, `Unknown acceptance ID: ${entry.acceptance}`);
      const evidence = await reference(entry.evidence, path, 'proof-scope-mismatch');
      if (!evidence) continue;
      const receipts = evidence.fences.filter(f => f.type === 'keel-proof' && (!evidence.section || f.section === evidence.section));
      let valid = false;
      for (const fence of receipts) {
        try {
          const receipt = jsonFence(fence);
          if (receipt.kind !== kind || receipt.acceptance !== entry.acceptance) continue;
          valid ||= /^[a-f\d]{40,64}$/i.test(receipt.sha ?? '') && string(receipt.environment) && string(receipt.observed_at) && Number.isFinite(Date.parse(receipt.observed_at)) && string(receipt.observer) && string(receipt.claim) && receipt.result === 'pass' && receipt.invalidated !== true && (kind !== 'production' || (receipt.environment === 'production' && string(receipt.deployment))) && (kind !== 'use' || (string(receipt.duration) && string(receipt.context) && (string(receipt.observations) || (strings(receipt.observations) && receipt.observations.length >= 2)) && receipt.repeated === true));
        } catch { /* A malformed receipt cannot support a claim. */ }
      }
      if (!valid) add('proof-scope-mismatch', path, `No applicable explicit ${kind} receipt for ${entry.acceptance} at ${entry.evidence}`, { observed: entry });
    }
    const next = v.next;
    if (!next) continue;
    if (next.kind === 'acceptance') {
      if (!boxes.has(next.ref)) add('acceptance-id', path, `Next action names unknown acceptance: ${next.ref}`);
      else if (boxes.get(next.ref)) add('next-action-satisfied', path, `Acceptance ${next.ref} is already checked`, { observed: next });
    } else if (next.kind === 'none' && /- \[ \]/.test(active(doc))) add('next-action-satisfied', path, 'No next action despite unresolved acceptance', { observed: next });
    else if (next.kind === 'review-pr') {
      const key = prKey(next.ref), fact = out.snapshot.prs[key];
      if (fact && (fact.merged_at || fact.state === 'closed')) add('pr-state-contradiction', path, `${key} is ${fact.merged_at ? 'merged' : 'closed without merge'}; review is obsolete, acceptance remains unchanged`, { observed: next, source: { pr: key, ...fact, observed_at: observedAt } });
    } else if (next.kind === 'decision') {
      await reference(next.ref, path);
      const decision = decisions.get(next.ref);
      if (!decision) add('decision-reference', path, `Next decision has no metadata: ${next.ref}`);
      else if (['accepted', 'superseded', 'withdrawn'].includes(decision.status)) add('next-action-satisfied', path, `Decision is ${decision.status}: ${next.ref}`, { observed: next });
    } else if (next.kind === 'use') await reference(next.ref, path);
  }

  for (const d of decisions.values()) {
    for (const ref of [...d.supersedes, ...d.superseded_by]) {
      await reference(ref, d.key);
      if (!decisions.has(ref)) add('decision-reference', d.key, `Missing decision metadata: ${ref}`);
    }
    for (const ref of d.supersedes) {
      const old = decisions.get(ref);
      if (d.status !== 'accepted' || !old) continue;
      if (!old.superseded_by.includes(d.key)) add('decision-superseded', old.key, `Missing reciprocal history link to ${d.key}`, { scope: d.scope });
      if (!d.scope.every(s => old.scope.includes(s))) add('decision-scope', d.key, 'Replacement scope must identify scopes of the old decision');
      if (old.status === 'superseded' && old.scope.some(s => ![...decisions.values()].some(n => n.status === 'accepted' && n.supersedes.includes(old.key) && n.scope.includes(s)))) add('decision-scope', old.key, 'Partial replacement cannot retire unaffected scopes');
    }
    for (const ref of d.superseded_by) {
      const next = decisions.get(ref);
      if (next?.status === 'accepted' && !next.supersedes.includes(d.key)) add('decision-superseded', d.key, `Successor ${ref} does not name the replaced decision`);
    }
    const successors = [...decisions.values()].filter(n => n.status === 'accepted' && n.supersedes.includes(d.key));
    for (let a = 0; a < successors.length; a++) for (let b = a + 1; b < successors.length; b++) if (successors[a].scope.some(s => successors[b].scope.includes(s))) add('decision-scope', d.key, 'Accepted successors overlap; partition their scope labels explicitly');
  }
  const visiting = new Set(), visited = new Set();
  function visit(key) {
    if (visiting.has(key)) { add('decision-cycle', key, 'Decision supersession cycle'); return; }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const ref of decisions.get(key)?.supersedes ?? []) if (decisions.has(ref)) visit(ref);
    visiting.delete(key); visited.add(key);
  }
  for (const key of decisions.keys()) visit(key);

  for (const doc of docs.filter(d => /^docs\/(phases|projects)\//.test(d.path))) {
    for (const section of doc.sections.filter(s => /deliberately open/i.test(s.title))) for (const d of decisions.values()) if (d.status === 'accepted' && section.lines.some(line => line.includes(d.key))) add('decision-still-open', doc.path, `Open entry points to accepted decision ${d.key}`);
    const currentText = active(doc);
    const documentPRs = new Set();
    for (const match of currentText.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*|\b[\w.-]+\/[\w.-]+#[1-9]\d*/g)) documentPRs.add(prKey(match[0]));
    if (repo) for (const match of currentText.matchAll(/(?<![\w./-])PR\s*#?([1-9]\d*)\b/gi)) documentPRs.add(`${repo}#${match[1]}`);
    const nextLines = new Set(doc.sections.filter(s => /^Next action\b/i.test(s.title)).flatMap(s => s.lines));
    for (const paragraph of currentText.split(/\n\s*\n/)) if (/^\*\*Next action[.:]?\*\*/i.test(paragraph.trim())) for (const line of paragraph.split('\n')) nextLines.add(line);
    for (const line of currentText.split('\n')) {
      if (/^\s*>/.test(line) || /\b(?:merged|no longer|already reviewed|not (?:a )?draft|do not review|review (?:is|was) (?:not|complete))\b/i.test(line)) continue;
      const pendingPR = /\b(?:draft|unmerged|open)\s+(?:implementation\s+|integration\s+)?(?:PR|pull request)\b/i.test(line);
      const reviewPR = /\breview\s+(?:(?:the|this|draft|implementation|in)\s+)*(?:PR(?=\b|[1-9])|pull request\b|https:\/\/github\.com\/|[\w.-]+\/[\w.-]+#)/i.test(line);
      if (!pendingPR && !reviewPR && !(nextLines.has(line) && /\breview\b.*\b(?:PR|pull request)\b/i.test(line))) continue;
      const concreteUnresolved = /\b(?:the|this)\s+draft\s+(?:PR|pull request)\b/i.test(line) || (nextLines.has(line) && /\breview\b.*\b(?:PR|pull request)\b/i.test(line));
      if (!documentPRs.size && concreteUnresolved) out.notes.push(issue('pr-reference-unresolved', doc.path, 'Current draft/review wording needs a repo-qualified PR reference before its state can be checked.', { confidence: 'advisory', observed: line.trim() }));
      for (const key of documentPRs) {
        const fact = out.snapshot.prs[key];
        if (!fact) continue;
        const n = key.split('#')[1];
        const direct = line.includes(key) || line.includes(fact.html_url) || (repo && key.startsWith(`${repo}#`) && new RegExp(`(?<![\\w./-])PR\\s*#?${n}\\b`, 'i').test(line));
        if ((!direct && documentPRs.size !== 1) || (!fact.merged_at && fact.state !== 'closed' && !(/\bdraft\b/i.test(line) && !fact.draft))) continue;
        out.notes.push(issue('pr-state-contradiction', doc.path, `Prose may describe ${key} as pending; GitHub reports ${fact.merged_at ? 'merged' : fact.state}. Review wording; do not infer acceptance.`, { confidence: 'advisory', association: direct ? 'explicit reference' : 'single same-document PR reference', source: { pr: key, ...fact, observed_at: observedAt }, observed: line.trim() }));
      }
    }
  }
  const legacyDecisions = docs.filter(d => /^docs\/(research\/|design\.md)/.test(d.path)).flatMap(d => d.sections.filter(s => /decisions? for (?:the )?owner/i.test(s.title) && /\bsettled\b/i.test(s.lines.join(' '))).map(s => ({ path: d.path, anchor: s.anchor })));
  if (legacyDecisions.length) for (const doc of docs.filter(d => /^docs\/(phases|projects)\//.test(d.path))) {
    const open = doc.sections.filter(s => /deliberately open/i.test(s.title)).map(s => s.lines.join(' ')).join(' ');
    const inlineOpen = /\*\*Deliberately open[.:]?\*\*([\s\S]*?)(?=\n\n|$)/i.exec(active(doc))?.[1] || '';
    if (/\b(store|storage|database|host|auth|architecture)\b/i.test(open + inlineOpen)) out.notes.push(issue('legacy-unstructured-decision', doc.path, 'Open architecture choices warrant review against settled research entries; unstructured prose does not establish authoritative scope or supersession.', { confidence: 'advisory', candidates: legacyDecisions }));
  }
  const fingerprints = new Set();
  function guidance(f) {
    const next = phases.find(p => (p.doc.subject || p.doc.path) === f.path);
    const open = next ? [...active(next.doc).matchAll(/- \[ \].*?<!--\s*acceptance:\s*([\w.-]+)\s*-->/g)].map(m => m[1]) : [];
    const remaining = open.length ? ` Review recorded open acceptance ${open.join(', ')} as possible next work.` : ' Ask the author to name remaining work.';
    switch (f.rule) {
      case 'pr-state-contradiction': return `Record the observed ${f.source?.merged_at ? 'merge' : f.source?.state || 'PR state'} for ${f.source?.pr || 'the linked PR'}; remove obsolete draft/review wording.${remaining} Preserve status and unchecked acceptance.`;
      case 'pr-reference-unresolved': return 'Identify the intended repo-qualified PR before asserting its state or replacing draft/review wording; preserve acceptance.';
      case 'next-action-satisfied': return `Replace obsolete next reference ${stable(f.observed ?? {})}.${remaining} Do not check acceptance automatically.`;
      case 'decision-superseded': return f.successors?.length ? `Review successors ${f.successors.map(s => `${s.ref} for scope ${s.scope.join(', ')}`).join('; ')}; update only those active scopes and preserve unaffected work and history.` : `${f.message}. Add reciprocal, scope-limited history links without retiring unrelated work.`;
      case 'decision-still-open': return `${f.message}. Mark only that choice settled, preserving other open decisions.`;
      case 'proof-scope-mismatch': return `${f.message}. Supply an applicable scoped receipt or withdraw the unsupported claim; preserve original measurements and unchecked acceptance.`;
      case 'legacy-unstructured-decision': return 'Have the owner compare open choices with the listed settled research sections, establish stable decision anchors and explicit scopes, then annotate only confirmed superseded choices.';
      default: return `${f.message}. Correct this record reference or metadata with human review; preserve acceptance and historical evidence.`;
    }
  }
  for (const finding of [...out.findings, ...out.notes.filter(n => ['pr-state-contradiction', 'pr-reference-unresolved', 'legacy-unstructured-decision'].includes(n.rule))]) {
    finding.source ??= { sha: out.snapshot.blobs[finding.path.split('#')[0]], observed_at: observedAt };
    finding.proposed_edit = guidance(finding);
    finding.prerequisites = ['human review', 'unchanged source blobs', 'fresh remote observations'];
    const fingerprint = hash(stable({ rule: finding.rule, path: finding.path, observed: finding.observed ?? finding.message, blobs: out.snapshot.blobs, inventory: out.snapshot.inventory, config_hash: out.snapshot.config_hash, prs: out.snapshot.prs }));
    finding.fingerprint = fingerprint;
    if (fingerprints.has(fingerprint)) continue;
    fingerprints.add(fingerprint);
    out.proposals.push({ fingerprint, rule: finding.rule, path: finding.path, manual_only: true, confidence: finding.confidence, source: finding.source, proposed_edit: finding.proposed_edit, expected_blobs: { ...out.snapshot.blobs }, expected_prs: structuredClone(out.snapshot.prs) });
  }
  out.findings = [...new Map(out.findings.map(f => [f.fingerprint, f])).values()];
  return out;
}

export async function verifyProposal({ root, proposal, github = false, env = process.env, prFacts }) {
  const out = result();
  out.valid = false;
  if (!object(proposal) || proposal.manual_only !== true || !/^[a-f\d]{64}$/.test(proposal.fingerprint ?? '') || !object(proposal.expected_blobs) || !Object.keys(proposal.expected_blobs).length || !object(proposal.expected_prs)) {
    out.findings.push(issue('proposal-invalid', '', 'Invalid proposal envelope')); return out;
  }
  const { read } = await reader(root, out);
  for (const [path, expected] of Object.entries(proposal.expected_blobs)) {
    try {
      if (expected !== null && !/^[a-f\d]{64}$/.test(expected)) throw Error('Invalid expected blob hash');
      let actual;
      try { await read(path); actual = out.snapshot.blobs[path]; } catch (e) { if (e.code !== 'ENOENT') throw e; actual = null; }
      if (actual !== expected) throw Error('Record changed since proposal');
    } catch (e) { out.findings.push(issue('proposal-stale', path, e.message)); }
  }
  for (const [key, expected] of Object.entries(proposal.expected_prs)) {
    if (!github || prKey(key) !== key) { out.unknown.push(issue('github-unavailable', key, 'Fresh remote verification required')); continue; }
    try { const actual = await observe(key, { env, prFacts }); if (stable(actual) !== stable(expected)) out.findings.push(issue('proposal-stale', key, 'Remote facts changed since proposal')); }
    catch (e) { out.unknown.push(issue('github-unavailable', key, e.message)); }
  }
  if (!out.findings.length && !out.unknown.length) {
    const current = await reconcile({ root, github, env, prFacts });
    out.unknown.push(...current.unknown);
    if (!current.proposals.some(p => p.fingerprint === proposal.fingerprint)) out.findings.push(issue('proposal-stale', proposal.path, 'Contradiction or its source set changed'));
  }
  out.valid = !out.findings.length && !out.unknown.length;
  return out;
}

export async function checkImpact({ root, base, head, body, changedFiles }) {
  const out = result();
  const bad = (message, path = '') => out.findings.push(issue('pr-impact-missing', path, message));
  if (typeof body !== 'string' || body.length > LIMIT) { bad('Missing or oversized PR body'); return out; }
  const fences = markdown(body).fences.filter(f => f.type === 'keel-impact');
  if (fences.length !== 1) { bad('Exactly one keel-impact declaration is required'); return out; }
  let declaration;
  try {
    declaration = jsonFence(fences[0]);
    if (!['updated', 'unchanged', 'none'].includes(declaration.reconciliation) || ['phases', 'decisions', 'supersedes', 'evidence'].some(k => !strings(declaration[k] ?? [])) || (declaration.unchanged !== undefined && (!object(declaration.unchanged) || Object.values(declaration.unchanged).some(v => !string(v))))) throw Error('Invalid impact declaration');
  } catch (e) { bad(e.message); return out; }
  const actualDiff = changedFiles === undefined;
  if (actualDiff) {
    if (![base, head].every(x => typeof x === 'string' && /^[a-f\d]{7,64}$/i.test(x))) { out.unknown.push(issue('impact-diff', '', 'Valid base and head SHAs are required')); return out; }
    try { const { stdout } = await exec('git', ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--'], { cwd: root, timeout: 15000, maxBuffer: LIMIT }); changedFiles = stdout.split('\0').filter(Boolean); }
    catch (e) { out.unknown.push(issue('impact-diff', '', e.message)); return out; }
  }
  if (!strings(changedFiles)) { out.unknown.push(issue('impact-diff', '', 'Invalid changed-file list')); return out; }
  const refs = ['phases', 'decisions', 'supersedes', 'evidence'].flatMap(k => declaration[k] ?? []);
  if (declaration.reconciliation === 'none' && (!string(declaration.reason) || refs.length)) bad('None impact requires a reason and no affected records');
  if (declaration.reconciliation !== 'none' && !(declaration.phases?.length || declaration.decisions?.length)) bad('Declare at least one affected phase or decision');
  const { read } = await reader(root, out);
  for (const ref of refs) {
    try {
      const { path } = refParts(ref);
      await read(ref);
      if (!changedFiles.includes(path) && !string(declaration.unchanged?.[ref])) bad(`Unchanged record requires its own reason: ${ref}`, path);
    } catch (e) { bad(e.message, ref); }
  }
  for (const path of changedFiles) if ((/^docs\/(phases|decisions)\/.*\.md$/.test(path) && !/\/README\.md$/i.test(path)) || /^docs\/projects\/.*\/phases\.md$/.test(path)) {
    if (![...(declaration.phases ?? []), ...(declaration.decisions ?? [])].some(ref => ref.split('#')[0] === path)) bad('Directly edited record omitted from declaration', path);
  }
  for (const path of changedFiles.filter(p => /^docs\/(research\/.*\.md|design\.md)$/.test(p))) {
    try {
      refParts(path);
      let previous = [];
      if (actualDiff) {
        // A removed fence cannot erase its own impact obligation. Read the
        // merge base used by the three-dot diff, never code from the PR body.
        const { stdout: mergeBase } = await exec('git', ['merge-base', base, head], { cwd: root, timeout: 15000, maxBuffer: LIMIT });
        const revision = mergeBase.trim();
        if (!/^[a-f\d]{40,64}$/i.test(revision)) throw Error('Invalid merge-base revision');
        const { stdout: entries } = await exec('git', ['ls-tree', revision, '--', path], { cwd: root, timeout: 15000, maxBuffer: LIMIT });
        if (entries.trim()) {
          if (!/^100(?:644|755) blob /.test(entries)) throw Error('Base record is not a regular file');
          const { stdout } = await exec('git', ['show', `${revision}:${path}`], { cwd: root, timeout: 15000, maxBuffer: LIMIT });
          previous = markdown(stdout).fences;
        }
      }
      let current = [];
      try { current = (await read(path)).fences; }
      catch (e) {
        if (!actualDiff || e.code !== 'ENOENT') throw e;
        // Only a deletion in the actual head may be absent locally. An
        // incomplete checkout must not turn a present record into no impact.
        const { stdout } = await exec('git', ['ls-tree', head, '--', path], { cwd: root, timeout: 15000, maxBuffer: LIMIT });
        if (stdout.trim()) throw e;
      }
      const required = new Set();
      for (const f of [...current, ...previous].filter(f => f.type === 'keel-decision' && f.section.explicit)) {
        if (required.has(f.section.anchor)) continue;
        required.add(f.section.anchor);
        const ref = `${path}#${f.section.anchor}`;
        if (!(declaration.decisions ?? []).includes(ref)) bad('Edited anchored decision omitted from declaration', ref);
      }
    } catch (e) { bad(e.message, path); }
  }
  out.notes.push(issue('impact-review', '', 'Structural coverage only: a reviewer must verify semantic reconciliation.'));
  return out;
}

async function main() {
  const args = process.argv.slice(2), options = { root: process.cwd() };
  let impact, event, json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--github') options.github = true;
    else if (['--impact', '--event', '--base', '--head', '--root'].includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith('--')) throw Error(`Missing value for ${arg}`);
      if (arg === '--impact') impact = value; else if (arg === '--event') event = value; else options[arg.slice(2)] = value;
    } else throw Error(`Unknown argument: ${arg}`);
  }
  async function input(path) { const stat = await lstat(path); if (!stat.isFile() || stat.size > LIMIT) throw Error('Input must be a bounded regular file'); return readFile(path, 'utf8'); }
  if (event) {
    const value = JSON.parse(await input(event));
    if (!object(value.pull_request) || typeof value.pull_request.body !== 'string') throw Error('Event requires a pull request body');
    options.body = value.pull_request.body; options.base ??= value.pull_request.base?.sha; options.head ??= value.pull_request.head?.sha;
  }
  if (impact) options.body = await input(impact);
  const out = impact || event ? await checkImpact(options) : await reconcile(options);
  process.stdout.write(json ? `${JSON.stringify(out)}\n` : `${out.findings.length} contradictions, ${out.notes.length} notes, ${out.unknown.length} unknown\n`);
  process.exitCode = out.unknown.length ? 2 : out.findings.length ? 1 : 0;
}
if (process.argv[1] && (await realpath(process.argv[1]).catch(() => null)) === await realpath(fileURLToPath(import.meta.url))) main().catch(e => { process.stdout.write(`${JSON.stringify({ error: e.message })}\n`); process.exitCode = 2; });

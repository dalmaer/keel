// What the delivery practice's configuration says, and the concurrency rule
// every project's workflows keep (plates phase 80; plates practice `delivery`;
// managed: plates render rewrites it). The design is plates's
// docs/research/2026-10-16-delivery.md, items 1, 2 and 6.
//
// Zero imports beyond Node: plates's doctor reads this file in plates's own
// tree, where the night's scripts are not beside it.
//
//   deliveryOf(config)        .plates/plates.json "delivery": { tested, gateWorkflow,
//                             site, version, smoke, promote }, validated, each
//                             error naming its key (site, version and smoke: phase
//                             81's verifier, scripts/plates/verify.mjs; promote:
//                             phase 82's plates promote, scripts/plates/promote.mjs)
//   concurrencyOf(text)       a workflow's concurrency blocks, read as text
//   workflowKind(file, text, { gate })  'test', 'publish' or null
//   concurrencyProblems(file, text, kind)  the rule, broken: [string]
//
// The rule (design item 6; isocan's test/workflows.test.ts is the model):
// a test or gate workflow cancels a superseded run on the same ref (a group
// per ref, cancel-in-progress: true); a publish or deploy workflow is queued
// and never cancelled (one fixed group, cancel-in-progress: false), since a
// deploy stopped midway is worse than a late one.

/** The tested ref when .plates/plates.json names none. */
export const TESTED = 'green';

/** Words in a workflow's file name or `name:` that make it a publish or deploy workflow. */
export const PUBLISH_WORDS = Object.freeze(['publish', 'deploy', 'deployment', 'release', 'promote']);
/** Words that make it a test or gate workflow (when not a publish one). */
export const TEST_WORDS = Object.freeze(['test', 'tests', 'check', 'checks', 'ci', 'gate']);

/**
 * A group expression that names the ref or the commit: two runs of different
 * refs (or commits) land in different groups. A test group wants one; a
 * publish group must have none.
 */
const PER_REF = /\bgithub\.(ref|ref_name|head_ref)\b|\bpull_request\.number\b|\bissue\.number\b|\bhead_branch\b/;
const PER_COMMIT = /\bgithub\.sha\b|\bhead_sha\b|\bpull_request\.head\.sha\b/;
/** A group expression that names the run: every run lands in a group of its own (#179). */
const PER_RUN = /\bgithub\.(run_id|run_number|run_attempt|job)\b/;
/** Contexts that are the same for every run of a workflow: a group made of these and literals is fixed. */
const FIXED_CONTEXTS = new Set(['github.workflow', 'github.repository', 'github.repository_owner', 'github.event.repository.name', 'github.event.repository.full_name', 'github.event.repository.default_branch']);

/** The context paths an expression reads (literals, operators and function names aside). */
function contextsOf(expr) {
  const src = expr.replace(/'(?:[^']|'')*'/g, "''");
  const out = [];
  for (const m of src.matchAll(/[A-Za-z_][\w-]*(?:\.[A-Za-z_*][\w-]*|\[[^\]]*\])*(\s*\()?/g)) {
    if (m[1] || ['true', 'false', 'null'].includes(m[0])) continue;
    out.push(m[0]);
  }
  return out;
}

/**
 * Whether a publish or deploy group is one fixed group: { fixed: true } or
 * { fixed: false, kind: 'ref' | 'commit' | 'run' | 'unknown', reads }. A
 * literal name is fixed; so is one made of contexts every run shares
 * (github.workflow, github.repository). `${{ <condition> && '<name>' || <any> }}`
 * is fixed only when `gated(<condition>)` says no run outside the condition
 * publishes (concurrencyProblems: every publishing job's `if:` is that
 * condition, plates-publish.yml's form); otherwise its fallback group can
 * publish beside `<name>` (a retry's own group, say), and it is not
 * established (PR #182 review). A group naming the ref, the commit or the run
 * is not fixed; anything else plates cannot establish, and says so rather than
 * guess (#179).
 */
export function groupFixity(group, { gated = () => false } = {}) {
  if (!group) return { fixed: false, kind: 'unknown', reads: [] };
  const exprs = [...group.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map(m => m[1].trim());
  if (!exprs.length) return { fixed: true };
  const cond = /^\$\{\{\s*([\s\S]+)&&\s*'((?:[^']|'')+)'\s*\|\|\s*([\s\S]+?)\s*\}\}$/.exec(group.trim());
  if (cond && balanced(cond[1])) {
    if (gated(cond[1])) return { fixed: true };
    return { fixed: false, kind: 'unknown', reads: [], why: `runs outside ${JSON.stringify(normExpr(cond[1]))} get another group, and no job's if: keeps them from publishing` };
  }
  const reads = exprs.flatMap(contextsOf);
  if (exprs.some(e => PER_RUN.test(e))) return { fixed: false, kind: 'run', reads };
  if (exprs.some(e => PER_COMMIT.test(e))) return { fixed: false, kind: 'commit', reads };
  if (exprs.some(e => PER_REF.test(e))) return { fixed: false, kind: 'ref', reads };
  const unknown = reads.filter(r => !FIXED_CONTEXTS.has(r) && !/^vars\.[A-Za-z_]\w*$/.test(r));
  return unknown.length ? { fixed: false, kind: 'unknown', reads: unknown } : { fixed: true };
}

/** An expression as compared: no `${{ }}`, whitespace collapsed, parentheses around the whole of it dropped. */
export function normExpr(e) {
  let s = String(e ?? '').trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1').replace(/\s+/g, ' ').trim();
  for (;;) {
    if (!s.startsWith('(') || !s.endsWith(')') || !balanced(s.slice(1, -1))) return s;
    // The outer pair only when it encloses everything: "(a) || (b)" keeps its own.
    let depth = 0, whole = true;
    for (let k = 0; k < s.length - 1; k++) { if (s[k] === '(') depth++; else if (s[k] === ')' && --depth === 0) { whole = false; break; } }
    if (!whole) return s;
    s = s.slice(1, -1).trim();
  }
}

/**
 * Each job's own `if:` (normalized, null when unset or a form plates does not
 * read) and `needs:` (names), from a workflow's text: { [name]: { if, needs, line } }.
 */
export function jobKeys(text) {
  const lines = (text ?? '').split('\n');
  const out = {};
  for (const j of jobsOf(text)) {
    let indent = null;
    const keys = { if: null, needs: [], line: j.line };
    for (let i = j.line; i < j.end; i++) {
      const l = lines[i];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      const at = l.search(/\S/);
      indent ??= at;
      if (at !== indent) continue;
      const m = /^\s*(if|needs):[ \t]*(.*?)[ \t]*$/.exec(l);
      if (!m) continue;
      if (m[1] === 'if') { const s = scalar(m[2]); keys.if = s.error || !s.value ? null : normExpr(s.value); continue; }
      const v = m[2].replace(/[ \t]+#.*$/, '');
      if (v.startsWith('[')) keys.needs = v.replace(/^\[|\]$/g, '').split(',').map(x => x.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean);
      else if (v) keys.needs = [scalar(v).value].filter(Boolean);
      else for (let k = i + 1; k < j.end && /^\s*-\s/.test(lines[k]); k++) keys.needs.push(lines[k].replace(/^\s*-\s*/, '').replace(/[ \t]+#.*$/, '').trim().replace(/^(["'])(.*)\1$/, '$2'));
    }
    out[j.name] = keys;
  }
  return out;
}

/**
 * Whether a job runs only on `cond`: its own `if:` is `cond`, or it needs a
 * job that does and its `if:` (when set) has no always(), failure() or
 * cancelled(), so a skipped need skips it too.
 */
function jobOnlyOn(keys, name, cond, seen = new Set()) {
  const j = keys[name];
  if (!j || seen.has(name)) return false;
  seen.add(name);
  if (j.if === cond) return true;
  if (j.if && /\b(always|failure|cancelled)\s*\(/.test(j.if)) return false;
  return j.needs.some(n => jobOnlyOn(keys, n, cond, seen));
}

/** Whether an expression's parentheses balance (outside quotes). */
function balanced(s) {
  let depth = 0;
  for (const c of s.replace(/'(?:[^']|'')*'/g, '')) {
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** A workflow's jobs: [{ name, line, end }] (end: the last line of the job, 1-based), read from the lines under a top-level `jobs:`. */
export function jobsOf(text) {
  const lines = (text ?? '').split('\n');
  const start = lines.findIndex(l => /^jobs:[ \t]*(#.*)?$/.test(l));
  if (start < 0) return [];
  const out = [];
  let indent = null, i = start + 1;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const at = l.search(/\S/);
    if (at === 0) break;
    indent ??= at;
    const m = at === indent ? /^\s*([A-Za-z_][\w-]*):/.exec(l) : null;
    if (m) { if (out.length) out.at(-1).end = i; out.push({ name: m[1], line: i + 1, end: null }); }
  }
  if (out.length) out.at(-1).end = i;
  return out;
}

/** A branch name plates will push the tested ref to: git's own rules, narrowed (no `..`, `@{`, control or glob characters). */
function branchProblem(name) {
  if (typeof name !== 'string' || !name) return 'must be a branch name, like "green"';
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) || name.includes('..') || name.includes('//') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock') || name.split('/').some(s => s.startsWith('.'))) return `must be a branch name, like "green" (got ${JSON.stringify(name)})`;
  if (name.startsWith('refs/') || name === 'HEAD') return `is a branch's short name, like "green", never a full ref or HEAD (got ${JSON.stringify(name)})`;
  if (['main', 'master'].includes(name)) return `cannot be ${name}: the publisher never writes the default branch`;
  return null;
}

/** Every problem with .plates/plates.json "delivery" as the publisher reads it: [string], each naming its key. */
export function deliveryProblems(config) {
  const d = config?.delivery;
  if (d === undefined) return [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['.plates/plates.json "delivery" must be an object'];
  const out = [];
  if (d.tested !== undefined) {
    const p = branchProblem(d.tested);
    if (p) out.push(`.plates/plates.json "delivery".tested ${p}`);
  }
  if (d.gateWorkflow !== undefined && (typeof d.gateWorkflow !== 'string' || !d.gateWorkflow.trim() || d.gateWorkflow !== d.gateWorkflow.trim() || /[\r\n\0"\\]/.test(d.gateWorkflow))) {
    out.push('.plates/plates.json "delivery".gateWorkflow must be the gate workflow\'s file (like "check.yml") or the name GitHub shows for it');
  }
  // The verifier's keys (phase 81): where production is, which path reports its commit, and what to smoke-test.
  if (d.site !== undefined) {
    const p = siteProblem(d.site);
    if (p) out.push(`.plates/plates.json "delivery".site ${p}`);
  }
  if (d.version !== undefined) {
    const p = pathProblem(d.version);
    if (p) out.push(`.plates/plates.json "delivery".version ${p}, the path that reports the commit production serves (like "/api/version")`);
  }
  if (d.smoke !== undefined) {
    if (!Array.isArray(d.smoke) || d.smoke.length > SMOKE_MAX) out.push(`.plates/plates.json "delivery".smoke must be a list of at most ${SMOKE_MAX} checks, each a path ("/") or { "path": "/", "status": 200 }`);
    else d.smoke.forEach((c, i) => { const p = smokeProblem(c); if (p) out.push(`.plates/plates.json "delivery".smoke[${i}] ${p}`); });
  }
  // plates promote's key (phase 82): the ref production deploys from, "tag:<name>" or "branch:<name>", or "none".
  if (d.promote !== undefined) {
    const p = promoteProblem(d.promote, d.tested ?? TESTED);
    if (p) out.push(`.plates/plates.json "delivery".promote ${p}`);
    else if (d.promote !== 'none' && (d.site === undefined || d.version === undefined)) out.push('.plates/plates.json "delivery".promote needs "delivery".site and "delivery".version: plates promote verifies that production serves the commit it moved to');
  }
  if ((d.version !== undefined || d.smoke !== undefined) && d.site === undefined) out.push('.plates/plates.json "delivery".site is required with "delivery".version or "delivery".smoke: the production origin they are read from (like "https://anvils.acme.example")');
  return out;
}

/**
 * What is wrong with a "delivery".promote value, or null: "tag:<name>" or
 * "branch:<name>" (a ref name by git's rules, narrowed; a branch never the
 * default branch nor the tested ref), or "none".
 */
function promoteProblem(value, tested) {
  const like = 'must be "tag:<name>" or "branch:<name>", the ref production deploys from (like "tag:prod"), or "none"';
  if (value === 'none') return null;
  const m = typeof value === 'string' ? /^(tag|branch):(.+)$/.exec(value) : null;
  if (!m) return `${like} (got ${JSON.stringify(value)})`;
  const p = branchProblem(m[2]);
  const defaultBranch = p !== null && /^cannot be (main|master)\b/.test(p);
  if (p && !defaultBranch) return `${like} (got ${JSON.stringify(value)})`;
  if (m[1] === 'branch' && defaultBranch) return `cannot be branch:${m[2]}: plates promote never writes the default branch`;
  if (m[1] === 'branch' && m[2] === tested) return `cannot be branch:${m[2]}, the tested ref: the publisher moves that one, and production is promoted from it`;
  return null;
}

/** "delivery".promote as a ref: { kind: 'tag' | 'branch', name, ref, spec }, or null for none (no promote). Validated by deliveryProblems. */
export function promoteRefOf(value) {
  if (value === undefined || value === null || value === 'none') return null;
  const [, kind, name] = /^(tag|branch):(.+)$/.exec(value);
  return { kind, name, ref: `refs/${kind === 'tag' ? 'tags' : 'heads'}/${name}`, spec: value };
}

/** How many smoke checks a project may name. */
export const SMOKE_MAX = 50;

/** An origin plates reads production at: https, or http on this machine only (a local preview). */
export function siteProblem(site) {
  let u;
  try { if (typeof site !== 'string') throw new TypeError(); u = new URL(site); } catch { return `must be the production origin, like "https://anvils.acme.example" (got ${JSON.stringify(site)})`; }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return `must be an origin alone, like "https://anvils.acme.example": no path, query, fragment or credentials (got ${JSON.stringify(site)})`;
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
  return `must be https (http only on localhost or 127.0.0.1) (got ${JSON.stringify(site)})`;
}

function pathProblem(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\s#\\\0]/.test(path) || path.length > 512) return `must be a path starting with "/" (got ${JSON.stringify(path)})`;
  return null;
}

const statusOk = s => Number.isInteger(s) && s >= 100 && s <= 599;
function smokeProblem(c) {
  if (typeof c === 'string') return pathProblem(c) && `${pathProblem(c)}, or { "path": "/", "status": 200 }`;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'must be a path ("/") or { "path": "/", "status": 200 }';
  const extra = Object.keys(c).filter(k => !['path', 'status'].includes(k));
  if (extra.length) return `takes path and status only (got ${extra.join(', ')})`;
  const p = pathProblem(c.path);
  if (p) return `path ${p}`;
  if (c.status !== undefined && !statusOk(c.status) && !(Array.isArray(c.status) && c.status.length && c.status.every(statusOk))) return `status must be an HTTP status code (100-599) or a list of them (got ${JSON.stringify(c.status)})`;
  return null;
}

export class DeliveryError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

/**
 * { tested, gateWorkflow (null: the project's gate workflow), site, version,
 * smoke: [{ path, status: [code] }] } (site and version null when unset; a
 * smoke path alone expects 200), or a throw (exit 2) naming the key.
 */
export function deliveryOf(config) {
  const problems = deliveryProblems(config);
  if (problems.length) throw new DeliveryError(problems[0]);
  const d = config?.delivery ?? {};
  const smoke = (d.smoke ?? []).map(c => typeof c === 'string' ? { path: c, status: [200] } : { path: c.path, status: c.status === undefined ? [200] : [c.status].flat() });
  return { tested: d.tested ?? TESTED, gateWorkflow: d.gateWorkflow ?? null, site: d.site ? new URL(d.site).origin : null, version: d.version ?? null, smoke, promote: promoteRefOf(d.promote) };
}

/** A workflow's top-level `name:`, unquoted, or null. */
export function workflowName(text) {
  const m = /^name:[ \t]*(.+?)[ \t]*$/m.exec(text ?? '');
  if (!m) return null;
  const v = m[1].replace(/[ \t]+#.*$/, '');
  return v.replace(/^(["'])(.*)\1$/, '$2') || null;
}

const bool = v => v === 'true' ? true : v === 'false' ? false : v;

/**
 * One YAML scalar as written after a key: { value } (a quoted value without
 * its quotes, a plain one without a trailing comment), or { error } for a
 * form this reader does not take (an anchor, alias, tag, block scalar, flow
 * collection, or an unclosed quote). Never a guess.
 */
export function scalar(raw) {
  const v = (raw ?? '').trim();
  if (!v) return { value: '' };
  const q = v[0];
  if (q === '"' || q === "'") {
    let k = 1, out = '';
    for (; k < v.length; k++) {
      if (q === "'" && v[k] === "'" && v[k + 1] === "'") { out += "'"; k++; continue; }
      if (q === '"' && v[k] === '\\' && k + 1 < v.length) { out += v[++k]; continue; }
      if (v[k] === q) break;
      out += v[k];
    }
    if (k >= v.length) return { error: 'an unclosed quote' };
    const rest = v.slice(k + 1);
    if (rest.trim() && !/^[ \t]+#/.test(rest)) return { error: `text after a quoted value (${JSON.stringify(rest.trim())})` };
    return { value: out };
  }
  if (/^[&*!|>[{]/.test(v)) return { error: `the form ${JSON.stringify(v[0])} (an anchor, alias, tag, block scalar or flow collection)` };
  return { value: v.replace(/[ \t]+#.*$/, '').trim() };
}

/** Split a flow mapping's inside at its top-level commas: quotes and (), {}, [] (a `${{ … }}` expression too) nest. */
function topLevel(s, sep) {
  const parts = [];
  let depth = 0, quote = null, at = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (quote) { if (c === '\\' && quote === '"') k++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === sep && depth === 0) { parts.push(s.slice(at, k)); at = k + 1; }
  }
  parts.push(s.slice(at));
  return parts;
}

/** Where a flow mapping that starts at v[0] (`{`) closes, or -1. */
function closing(v) {
  let depth = 0, quote = null;
  for (let k = 0; k < v.length; k++) {
    const c = v[k];
    if (quote) { if (c === '\\' && quote === '"') k++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c) && --depth === 0) return k;
  }
  return -1;
}

const KEYS = ['group', 'cancel-in-progress'];

/** Set one key of a block from its written value; an unreadable value marks the block unreadable. */
function setKey(block, key, raw) {
  const s = scalar(raw);
  if (s.error) { block.unreadable ??= `${key}: ${s.error}`; return; }
  if (key === 'group') block.group = s.value || null;
  else block.cancel = bool(s.value);
}

/**
 * The concurrency blocks of one workflow's text: [{ level: 'workflow'|'job',
 * line, group, cancel, unreadable? }]. Three forms: `concurrency: <group>` (a
 * group with no cancel-in-progress, GitHub's default: false); a flow mapping
 * `concurrency: { group: …, cancel-in-progress: … }`; and `group:` and
 * `cancel-in-progress:` lines under it. Values may be quoted. `cancel` is
 * true, false, undefined (not set), or the expression as written. Anything
 * else is `unreadable`, with why, and concurrencyProblems names it.
 */
export function concurrencyOf(text) {
  const lines = (text ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)concurrency:[ \t]*(.*?)[ \t]*$/.exec(lines[i]);
    if (!m || /^\s*#/.test(lines[i])) continue;
    const indent = m[1].length;
    const block = { level: indent === 0 ? 'workflow' : 'job', line: i + 1, group: null, cancel: undefined };
    const inline = m[2];
    if (inline.startsWith('{')) {
      const end = closing(inline);
      const after = end < 0 ? '' : inline.slice(end + 1);
      if (end < 0) block.unreadable = 'an unclosed { mapping } (plates reads a flow mapping on one line)';
      else if (after.trim() && !/^[ \t]+#/.test(after)) block.unreadable = `text after the mapping (${JSON.stringify(after.trim())})`;
      else {
        const parts = topLevel(inline.slice(1, end), ',');
        for (const part of parts.filter(p => p.trim())) {
          const kv = /^\s*([\w-]+)\s*:(?:\s+|$)([\s\S]*)$/.exec(part);
          if (!kv) { block.unreadable ??= `the entry ${JSON.stringify(part.trim())}`; continue; }
          if (!KEYS.includes(kv[1])) { block.unreadable ??= `the key ${kv[1]} (concurrency takes group and cancel-in-progress)`; continue; }
          setKey(block, kv[1], kv[2]);
        }
      }
      out.push(block);
      continue;
    }
    if (inline && !/^#/.test(inline)) {
      const s = scalar(inline);
      if (s.error) block.unreadable = s.error; else block.group = s.value || null;
      out.push(block);
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      if (l.search(/\S/) <= indent) break;
      const kv = /^\s*(group|cancel-in-progress):[ \t]*(.*?)[ \t]*$/.exec(l);
      if (kv) setKey(block, kv[1], kv[2]);
    }
    out.push(block);
  }
  return out;
}

const words = s => (s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * What the rule holds a workflow to: 'publish' when its file name or `name:`
 * says publish, deploy, release or promote; else 'test' when it is the gate
 * workflow (`gate`: its file or name) or says test, check, ci or gate; else
 * null (not checked). Found by reading, so a workflow added next month is held
 * to the rule without anyone listing it.
 */
export function workflowKind(file, text, { gate = null } = {}) {
  const base = file.split('/').pop();
  const name = workflowName(text);
  const said = [...words(base.replace(/\.ya?ml$/, '')), ...words(name)];
  if (said.some(w => PUBLISH_WORDS.includes(w))) return 'publish';
  if (gate && [base, file, name].includes(gate)) return 'test';
  if (said.some(w => TEST_WORDS.includes(w))) return 'test';
  return null;
}

/** The rule, broken by one workflow: [string], each naming the file and line. */
export function concurrencyProblems(file, text, kind) {
  if (!kind) return [];
  const blocks = concurrencyOf(text);
  const out = [];
  // A form this reader does not take is named, and never judged by a guess at what it says.
  const unread = blocks.filter(b => b.unreadable).map(b => `${file} (line ${b.line}): plates cannot read this concurrency (${b.unreadable}); write it as group: and cancel-in-progress: lines under concurrency:, or as { group: …, cancel-in-progress: … } on one line`);
  const readable = blocks.filter(b => !b.unreadable);
  out.push(...unread);
  if (kind === 'test') {
    if (!blocks.length) return [`${file}: a test workflow with no concurrency group: a superseded run is never cancelled; add concurrency: { group: <name>-\${{ github.ref }}, cancel-in-progress: true }`];
    const good = b => b.group && PER_REF.test(b.group) && b.cancel === true;
    const testProblems = b => [
      ...(!b.group || !PER_REF.test(b.group) ? [`${file} (line ${b.line}): a test workflow's concurrency group ${JSON.stringify(b.group)} is not per ref: runs of every branch share one queue; name the ref in it (\${{ github.ref }})`] : []),
      ...(b.cancel !== true ? [`${file} (line ${b.line}): a test workflow's cancel-in-progress is ${b.cancel === undefined ? 'not set (false)' : JSON.stringify(b.cancel)}: a superseded test run keeps running; set cancel-in-progress: true`] : []),
    ];
    // Only a workflow-level block covers the whole workflow; one job's block covers that job alone (#179).
    const top = readable.filter(b => b.level === 'workflow');
    if (top.some(good)) return out;
    const jobs = jobsOf(text);
    const jobBlocks = readable.filter(b => b.level === 'job');
    if (!jobBlocks.length || !jobs.length) {
      for (const b of readable) out.push(...testProblems(b));
      return out;
    }
    for (const b of top) out.push(...testProblems(b));
    for (const j of jobs) {
      const own = jobBlocks.filter(b => b.line > j.line && b.line <= j.end);
      if (own.some(good)) continue;
      if (own.length) for (const b of own) out.push(...testProblems(b).map(p => p.replace("a test workflow's", `a test workflow's job ${j.name}:`)));
      else if (!blocks.some(b => b.unreadable && b.line > j.line && b.line <= j.end)) out.push(`${file} (line ${j.line}): a test workflow's job ${j.name} has no concurrency of its own, and no workflow-level block covers it: a superseded run of it keeps running; put concurrency: { group: <name>-\${{ github.ref }}, cancel-in-progress: true } at the workflow's top level, or on every job`);
    }
    return out;
  }
  if (!blocks.length) return [`${file}: a publish or deploy workflow with no concurrency group: two can run at once; add concurrency: { group: <fixed name>, cancel-in-progress: false }`];
  const keys = jobKeys(text), jobs = jobsOf(text);
  for (const b of readable) {
    // A conditional group holds only where every job it covers runs on its condition alone (PR #182 review).
    const covered = b.level === 'workflow' ? jobs.map(j => j.name) : jobs.filter(j => b.line > j.line && b.line <= j.end).map(j => j.name);
    const gated = cond => covered.length > 0 && covered.every(n => jobOnlyOn(keys, n, normExpr(cond)));
    const f = groupFixity(b.group, { gated });
    if (!f.fixed && f.kind !== 'unknown') out.push(`${file} (line ${b.line}): a publish or deploy workflow's concurrency group ${JSON.stringify(b.group)} is not fixed: it names the ${f.kind}, so publishes of different ${f.kind}s can run at once; name one group for them all`);
    else if (!f.fixed) out.push(`${file} (line ${b.line}): plates cannot establish that a publish or deploy workflow's concurrency group ${JSON.stringify(b.group)} is fixed${f.why ? `: ${f.why}` : f.reads.length ? ` (it reads ${f.reads.join(', ')})` : ''}: two deploys could run at once; name one group for them all, or write \${{ <the condition it publishes on> && '<fixed name>' || format('<name>-skip-{0}', github.run_id) }} with that condition as every job's if:`);
    if (b.cancel !== false && b.cancel !== undefined) out.push(`${file} (line ${b.line}): a publish or deploy workflow's cancel-in-progress is ${JSON.stringify(b.cancel)}: a deploy can be cancelled midway; set cancel-in-progress: false`);
  }
  return out;
}

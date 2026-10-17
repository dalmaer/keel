// What the delivery practice's configuration says, and the concurrency rule
// every project's workflows keep (keel phase 80; keel practice `delivery`;
// managed: keel render rewrites it). The design is keel's
// docs/research/2026-10-16-delivery.md, items 1, 2 and 6.
//
// Zero imports beyond Node: keel's doctor reads this file in keel's own
// tree, where the night's scripts are not beside it.
//
//   deliveryOf(config)        .keel/keel.json "delivery": { tested, gateWorkflow },
//                             validated, each error naming its key
//   concurrencyOf(text)       a workflow's concurrency blocks, read as text
//   workflowKind(file, text, { gate })  'test', 'publish' or null
//   concurrencyProblems(file, text, kind)  the rule, broken: [string]
//
// The rule (design item 6; isocan's test/workflows.test.ts is the model):
// a test or gate workflow cancels a superseded run on the same ref (a group
// per ref, cancel-in-progress: true); a publish or deploy workflow is queued
// and never cancelled (one fixed group, cancel-in-progress: false), since a
// deploy stopped midway is worse than a late one.

/** The tested ref when .keel/keel.json names none. */
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

/** A branch name keel will push the tested ref to: git's own rules, narrowed (no `..`, `@{`, control or glob characters). */
function branchProblem(name) {
  if (typeof name !== 'string' || !name) return 'must be a branch name, like "green"';
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) || name.includes('..') || name.includes('//') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock') || name.split('/').some(s => s.startsWith('.'))) return `must be a branch name, like "green" (got ${JSON.stringify(name)})`;
  if (name.startsWith('refs/') || name === 'HEAD') return `is a branch's short name, like "green", never a full ref or HEAD (got ${JSON.stringify(name)})`;
  if (['main', 'master'].includes(name)) return `cannot be ${name}: the publisher never writes the default branch`;
  return null;
}

/** Every problem with .keel/keel.json "delivery" as the publisher reads it: [string], each naming its key. */
export function deliveryProblems(config) {
  const d = config?.delivery;
  if (d === undefined) return [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['.keel/keel.json "delivery" must be an object'];
  const out = [];
  if (d.tested !== undefined) {
    const p = branchProblem(d.tested);
    if (p) out.push(`.keel/keel.json "delivery".tested ${p}`);
  }
  if (d.gateWorkflow !== undefined && (typeof d.gateWorkflow !== 'string' || !d.gateWorkflow.trim() || d.gateWorkflow !== d.gateWorkflow.trim() || /[\r\n\0"\\]/.test(d.gateWorkflow))) {
    out.push('.keel/keel.json "delivery".gateWorkflow must be the gate workflow\'s file (like "check.yml") or the name GitHub shows for it');
  }
  return out;
}

export class DeliveryError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

/** { tested, gateWorkflow (null: the project's gate workflow) }, or a throw (exit 2) naming the key. */
export function deliveryOf(config) {
  const problems = deliveryProblems(config);
  if (problems.length) throw new DeliveryError(problems[0]);
  const d = config?.delivery ?? {};
  return { tested: d.tested ?? TESTED, gateWorkflow: d.gateWorkflow ?? null };
}

/** A workflow's top-level `name:`, unquoted, or null. */
export function workflowName(text) {
  const m = /^name:[ \t]*(.+?)[ \t]*$/m.exec(text ?? '');
  if (!m) return null;
  const v = m[1].replace(/[ \t]+#.*$/, '');
  return v.replace(/^(["'])(.*)\1$/, '$2') || null;
}

const unquote = v => v.replace(/[ \t]+#.*$/, '').trim().replace(/^(["'])(.*)\1$/, '$2');
const bool = v => v === 'true' ? true : v === 'false' ? false : v;

/**
 * The concurrency blocks of one workflow's text: [{ level: 'workflow'|'job',
 * line, group, cancel }]. `concurrency: <group>` on one line is a group with
 * no cancel-in-progress (GitHub's default: false). `cancel` is true, false,
 * undefined (not set), or the expression as written.
 */
export function concurrencyOf(text) {
  const lines = (text ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)concurrency:[ \t]*(.*?)[ \t]*$/.exec(lines[i]);
    if (!m || /^\s*#/.test(lines[i])) continue;
    const indent = m[1].length;
    const block = { level: indent === 0 ? 'workflow' : 'job', line: i + 1, group: null, cancel: undefined };
    const inline = unquote(m[2]);
    if (inline) { block.group = inline; out.push(block); continue; }
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      if (l.search(/\S/) <= indent) break;
      const kv = /^\s*(group|cancel-in-progress):[ \t]*(.*?)[ \t]*$/.exec(l);
      if (kv?.[1] === 'group') block.group = unquote(kv[2]) || null;
      if (kv?.[1] === 'cancel-in-progress') block.cancel = bool(unquote(kv[2]));
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
  if (kind === 'test') {
    if (!blocks.length) return [`${file}: a test workflow with no concurrency group: a superseded run is never cancelled; add concurrency: { group: <name>-\${{ github.ref }}, cancel-in-progress: true }`];
    const good = blocks.filter(b => b.group && PER_REF.test(b.group) && b.cancel === true);
    if (good.length) return [];
    for (const b of blocks) {
      if (!b.group || !PER_REF.test(b.group)) out.push(`${file} (line ${b.line}): a test workflow's concurrency group ${JSON.stringify(b.group)} is not per ref: runs of every branch share one queue; name the ref in it (\${{ github.ref }})`);
      if (b.cancel !== true) out.push(`${file} (line ${b.line}): a test workflow's cancel-in-progress is ${b.cancel === undefined ? 'not set (false)' : JSON.stringify(b.cancel)}: a superseded test run keeps running; set cancel-in-progress: true`);
    }
    return out;
  }
  if (!blocks.length) return [`${file}: a publish or deploy workflow with no concurrency group: two can run at once; add concurrency: { group: <fixed name>, cancel-in-progress: false }`];
  for (const b of blocks) {
    if (!b.group || PER_REF.test(b.group) || PER_COMMIT.test(b.group)) out.push(`${file} (line ${b.line}): a publish or deploy workflow's concurrency group ${JSON.stringify(b.group)} is not fixed: publishes of different refs or commits can run at once; name one group for them all`);
    if (b.cancel !== false && b.cancel !== undefined) out.push(`${file} (line ${b.line}): a publish or deploy workflow's cancel-in-progress is ${JSON.stringify(b.cancel)}: a deploy can be cancelled midway; set cancel-in-progress: false`);
  }
  return out;
}

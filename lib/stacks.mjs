// Where a lesson applies (phase 30; design research/2026-10-06-lessons-by-stack-and-pattern.md, part 1).
//
// The vocabulary is practices/lessons/stacks.json, closed: [{ tag, means,
// evidence }]. Each evidence rule is one of
//   <path>                  a file at that path ("vercel.json")
//   <dir>/                  a directory ("./vercel/")
//   <dir>/*.<ext>           a file in that directory matching the glob
//   workflow uses <action>  a .github/workflows/*.y(a)ml with `uses: <action>`
//   depends on <package>    package.json dependencies or devDependencies
// A tag is a fact about where a failure happened; a new one is a decision,
// like any practice change. This file is the one reader of the vocabulary.
//
// keel's catalogue (docs/lessons.md) has a fifth column, Where: empty for a
// lesson every project reads, else tags. A project declares its stack in
// .keel/keel.json `stack`; adopt detects and records it, doctor lints it
// against the evidence (stack-evidence) and the vocabulary (stack-unknown).
// The lessons practice renders docs/keel-lessons.md from keel's catalogue as
// this keel carries it: every universal row and the rows whose Where meets
// the stack, in catalogue order, each line as the catalogue has it.
import { readFileSync } from 'node:fs';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLessons } from '../practices/night/files/scripts/keel/lib.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STACKS = join(KEEL, 'practices', 'lessons', 'stacks.json');
/** keel's catalogue, as this keel carries it (package.json `files` ships it). */
export const CATALOGUE = join(KEEL, 'docs', 'lessons.md');
export const VIEW = 'docs/keel-lessons.md';

const fail = message => { throw new Error(message); };
const RULE = /^(?:workflow uses [\w.\/-]+|depends on (@[\w.-]+\/)?[\w.-]+|[\w.-]+(\/[\w.-]+)*\/?|[\w.-]+(\/[\w.-]+)*\/\*\.[\w]+)$/;

/** The vocabulary, validated: [{ tag, means, evidence }]. */
export function vocabulary(text = readFileSync(STACKS, 'utf8')) {
  let list;
  try { list = JSON.parse(text); } catch { fail('practices/lessons/stacks.json is not JSON'); }
  if (!Array.isArray(list) || !list.length) fail('practices/lessons/stacks.json must be a list of { tag, means, evidence }');
  const seen = new Set();
  for (const s of list) {
    if (!/^[a-z][a-z0-9-]*$/.test(s?.tag ?? '')) fail(`practices/lessons/stacks.json: bad tag ${JSON.stringify(s?.tag)}`);
    if (seen.has(s.tag)) fail(`practices/lessons/stacks.json: ${s.tag} twice`);
    seen.add(s.tag);
    if (typeof s.means !== 'string' || !s.means.trim()) fail(`practices/lessons/stacks.json: ${s.tag} says nothing of what it means`);
    if (!Array.isArray(s.evidence) || !s.evidence.length) fail(`practices/lessons/stacks.json: ${s.tag} has no evidence`);
    for (const e of s.evidence) if (typeof e !== 'string' || !RULE.test(e)) fail(`practices/lessons/stacks.json: ${s.tag}: evidence ${JSON.stringify(e)} is not a path, a dir/, a dir/*.ext, "workflow uses <action>" or "depends on <package>"`);
  }
  return list;
}

export const tags = (vocab = vocabulary()) => vocab.map(s => s.tag);

/** A Where cell's tags: backticks dropped, split on commas and spaces. */
export const whereTags = cell => (cell ?? '').replace(/`/g, '').split(/[\s,]+/).filter(Boolean);

/** Problems with a config's `stack` (absent is none): a list of messages. */
export function stackProblems(stack, known = tags()) {
  if (stack === undefined) return [];
  if (!Array.isArray(stack) || stack.some(t => typeof t !== 'string')) return ['"stack" must be a list of tags'];
  const unknown = stack.filter(t => !known.includes(t));
  return unknown.length ? [`"stack" names ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} not in keel's vocabulary (${known.join(', ')})`] : [];
}

/** Rows of a catalogue whose Where names a tag outside the vocabulary: [{ n, unknown }]. */
export function unknownWhere(text, known = tags()) {
  return parseLessons(text).rows.map(r => ({ n: r.n, unknown: whereTags(r.where).filter(t => !known.includes(t)) })).filter(r => r.unknown.length);
}

const exists = p => lstat(p).then(i => i, () => null);

// The files under `dir` (relative): on disk and planned.
async function under(root, dir, planned) {
  const names = new Set(await readdir(join(root, dir)).catch(() => []));
  for (const p of planned.keys()) if (dirname(p) === dir) names.add(p.slice(dir.length + 1));
  return [...names];
}
const text = (root, path, planned) => planned.has(path) ? Promise.resolve(planned.get(path)) : readFile(join(root, path), 'utf8').catch(() => null);

async function holds(root, rule, ctx, planned) {
  let m;
  if ((m = /^workflow uses (.+)$/.exec(rule))) {
    ctx.workflows ??= await (async () => {
      const names = (await under(root, '.github/workflows', planned)).filter(n => /\.ya?ml$/.test(n));
      return (await Promise.all(names.map(n => text(root, `.github/workflows/${n}`, planned)))).map(t => t ?? '');
    })();
    const action = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return ctx.workflows.some(t => new RegExp(`^\\s*(-\\s*)?uses:\\s*['"]?${action}(@|['"\\s]|$)`, 'm').test(t));
  }
  if ((m = /^depends on (.+)$/.exec(rule))) {
    if (ctx.pkg === undefined) {
      try { ctx.pkg = JSON.parse(await text(root, 'package.json', planned)); } catch { ctx.pkg = null; }
    }
    return [ctx.pkg?.dependencies, ctx.pkg?.devDependencies].some(d => d && typeof d === 'object' && Object.hasOwn(d, m[1]));
  }
  if ((m = /^(.*)\/\*\.(\w+)$/.exec(rule))) {
    return (await under(root, m[1], planned)).some(n => n.endsWith(`.${m[2]}`));
  }
  if (rule.endsWith('/')) return !!(await exists(join(root, rule)))?.isDirectory() || [...planned.keys()].some(p => p.startsWith(rule));
  return planned.has(rule) || !!(await exists(join(root, rule)))?.isFile();
}

/**
 * The stack a repo's files show: [{ tag, evidence: [the rules that held] }],
 * in vocabulary order. Reads only the paths the rules name. `planned` (path →
 * text) adds files about to be written (adopt: keel's own check.yml).
 */
export async function detect(root, vocab = vocabulary(), planned = new Map()) {
  const ctx = {}, out = [];
  for (const s of vocab) {
    const held = [];
    for (const rule of s.evidence) if (await holds(root, rule, ctx, planned)) held.push(rule);
    if (held.length) out.push({ tag: s.tag, evidence: held });
  }
  return out;
}

/** Declared against detected: { missing: detected not declared, unbacked: declared with no evidence }. */
export function disagreement(declared, detected) {
  const found = detected.map(d => d.tag);
  return { missing: found.filter(t => !declared.includes(t)), unbacked: declared.filter(t => !found.includes(t)) };
}

/**
 * The rows of a catalogue a project with `stack` reads: every universal row
 * (an empty Where) and every row whose Where names a tag of the stack, in
 * catalogue order. Returns { head: [header, separator], rows: [{ n, line,
 * text, where }] }; `text` is the catalogue's line as it is.
 */
export function viewRows(catalogue, stack = [], known = tags()) {
  const lines = catalogue.split('\n');
  const { rows } = parseLessons(catalogue);
  if (!rows.length) fail('keel\'s catalogue has no lesson table');
  const bad = unknownWhere(catalogue, known);
  if (bad.length) fail(`keel's catalogue: ${bad.map(b => `lesson ${b.n} names ${b.unknown.join(', ')}`).join('; ')}, not in practices/lessons/stacks.json`);
  const first = Math.min(...rows.map(r => r.line)); // 1-based; the separator and header sit above it
  const sep = lines.slice(0, first - 1).findLastIndex(l => /^\|?\s*:?-{3,}/.test(l.trim()));
  const head = [lines[sep - 1], lines[sep]];
  const keep = rows.filter(r => { const w = whereTags(r.where); return !w.length || w.some(t => stack.includes(t)); });
  return { head, rows: keep.map(r => ({ n: r.n, line: r.line, text: lines[r.line - 1], where: r.where })) };
}

/**
 * docs/keel-lessons.md for a config: the template's prose, a line naming the
 * stack it was filtered for, and the rows. Sync: fill() is. An unknown tag in
 * the config's stack or the catalogue throws (never a silent pass).
 */
export function shapeLessonsView(text, config = {}, { catalogue = readFileSync(CATALOGUE, 'utf8'), known = tags() } = {}) {
  const problems = stackProblems(config.stack, known);
  if (problems.length) fail(`.keel/keel.json: ${problems.join('; ')}`);
  const stack = config.stack ?? [];
  const { head, rows } = viewRows(catalogue, stack, known);
  const said = stack.length
    ? `This project's stack (\`stack\` in \`.keel/keel.json\`): ${stack.map(t => `\`${t}\``).join(', ')}. ${rows.length} of keel's lessons apply: every universal one, and those tagged for this stack.`
    : `This project declares no stack (\`stack\` in \`.keel/keel.json\`; \`keel doctor\` says what it detects), so it reads keel's universal lessons only: ${rows.length}.`;
  return `${text.replace(/\n*$/, '\n')}\n${said}\n\n${head.join('\n')}\n${rows.map(r => r.text).join('\n')}\n`;
}

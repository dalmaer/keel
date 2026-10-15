// keel persona: goals a project sets itself, measured (keel practice
// `personas`; managed: keel render rewrites it). keel phase 75, the design's
// "Personas measure; they do not build" (docs/research/2026-10-14-nightwatch.md
// in keel). keel's CLI (`keel persona run`) runs this same module, so a project
// measures its personas from its own checkout with no keel at runtime.
//
// Provenance: the file format and the runner's rules are adapted from isocan
// (github.com/dglazkov/isocan, scripts/persona-run.mjs and
// packages/core/src/persona.ts at 7bde1a85, Apache-2.0). Not carried over:
// the model tier (scripts/lib/persona-tier.mjs: budget, escalate, trigger) and
// `against`. keel's personas only run commands; a persona that spends tokens
// waits for an owner's budget.
//
// A persona is `.agents/personas/<name>.md`: front matter the machine reads,
// prose (the lens) the agent reads.
//
//   ---
//   name: performance
//   description: Whether the app still feels fast.
//   goal:
//     - name: entry bundle size
//       at most: 250000
//       measured by: node scripts/measure.mjs bundle-bytes
//       baseline: 231000, 2026-10-14, 6bb8994
//   ---
//
// A goal is a number, a bound and the command that prints it. The bound is
// `at most` or `at least`, a number with an optional unit (`100ms`); the
// command prints exactly one number on stdout and nothing else. `baseline` is
// optional: a baseline nobody measured is fiction, so leave it out until one
// is taken.
//
// This is not a YAML parser and must not become one. It reads `key: value`
// lines, and indented `- key: value` blocks under `goal:`. An unknown key, a
// goal with no command and a bound that is not a number are each refused,
// naming the file and the key: a goal half-read reports success forever.
//
// A run (`run`):
//   - runs each goal's command as the project's other commands are run
//     ("climb".build, "climb".perf.command): `sh -c` (spawnSync with shell)
//     in the project root, the gate's environment (gateEnv: NODE_TEST_*
//     stripped, .keel/keel.json `env` merged), with a timeout. The command is
//     the project's own committed text, passed verbatim; nothing is
//     interpolated into it.
//   - marks each goal met, missed or broken. A command that fails, times out
//     or prints anything but one number is broken, never zero.
//   - refuses, writing nothing, when a persona file changed while it ran: a
//     runner that can change its goal can pass by lowering the bar.
//   - writes docs/reviews/<date>-<persona>.md and nothing else.
//
// `planCandidates` turns a run's missed goals into candidate plan items for
// the night's default plan (keel phase 73's plan shape), and a broken goal
// into a review item. `personaMeasures` gives each goal as a measure the
// night's improve.mjs `measure()` can take (`persona:<name>:<goal>`).
import { spawnSync } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The night's lib.mjs (this practice requires night): beside this file in a
// project. In keel's own tree this file is the practice's template, and keel
// does not switch personas on for itself, so the night's source is read there.
const LIB = existsSync(fileURLToPath(new URL('./lib.mjs', import.meta.url))) ? './lib.mjs' : '../../../../night/files/scripts/keel/lib.mjs';
const { gateEnv, isMain, main, rootOf } = await import(LIB);

export const PERSONA_DIR = '.agents/personas';
export const REVIEWS = 'docs/reviews';
/** How long one goal's command may run. A measurement, not a build. */
export const TIMEOUT_MS = 10 * 60_000;
export const COMMAND = 'node scripts/keel/persona.mjs run';

/** The front-matter keys a persona may carry. The vendor's (Claude Code's subagent) keys are read and kept, never used. */
export const PERSONA_KEYS = Object.freeze(['name', 'description', 'goal', 'model', 'effort', 'color', 'tools']);
/** The keys of one goal. */
export const GOAL_KEYS = Object.freeze(['name', 'at most', 'at least', 'measured by', 'baseline']);
/** isocan keys keel does not carry, with why, so the refusal says more than "unknown". */
const NOT_CARRIED = Object.freeze({
  trigger: 'the night runs personas; a persona carries no schedule',
  budget: "keel's personas only run commands; a model tier waits for the owner's budget",
  escalate: "keel's personas only run commands; a model tier waits for the owner's budget",
  runs: `a run's page always goes to ${REVIEWS}/`,
  against: 'keel does not carry a debt basis yet; bound the number itself',
});

export class PersonaError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const fail = (message, exitCode) => { throw new PersonaError(message, exitCode); };
export const slugOf = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
const unquote = s => { const t = s.trim(); return /^(["']).*\1$/.test(t) && t.length > 1 ? t.slice(1, -1) : t; };
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const refusedKey = (where, key) => `${where}: unknown key "${key}"${NOT_CARRIED[key] ? ` (${NOT_CARRIED[key]})` : ''}`;

/**
 * One persona file → { name, description, goals, body, meta }. `file` is its
 * path (for messages); the persona's name is the file's stem. Each goal is
 * { id, name, kind: 'at most'|'at least', bound, unit, better, measuredBy, baseline }.
 */
export function parsePersona(file, text) {
  const stem = /([^/\\]+)\.md$/.exec(file)?.[1];
  if (!stem || !/^[a-z0-9][a-z0-9-]*$/.test(stem)) fail(`${file}: a persona is .agents/personas/<name>.md, with <name> in lowercase letters, digits and dashes`);
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!block) fail(`${file}: missing front matter`);
  const meta = {}, raw = [];
  let top = null, goal = null;
  for (const line of block[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (!m) fail(`${file}: not a "key: value" line: ${line.trim()}`);
      const [, key, value] = m;
      if (!PERSONA_KEYS.includes(key)) fail(refusedKey(file, key));
      if (Object.hasOwn(meta, key)) fail(`${file}: duplicate ${key}`);
      if (key === 'goal' && value.trim()) fail(`${file}: goal: takes its entries on the lines below it, each "- name: …"`);
      meta[key] = key === 'goal' ? [] : unquote(value);
      top = key; goal = null;
      continue;
    }
    if (top !== 'goal') fail(`${file}: an indented line belongs under goal: (${line.trim()})`);
    let pair = line.trim();
    if (/^-(\s|$)/.test(pair)) {
      goal = {}; raw.push(goal);
      pair = pair.slice(1).trim();
      if (!pair) continue;
    }
    if (!goal) fail(`${file}: a goal starts with "- name: …" (${line.trim()})`);
    const m = /^([a-z][a-z ]*?)\s*:\s*(.*)$/.exec(pair);
    if (!m) fail(`${file}: goal ${raw.length}: not a "key: value" line: ${pair}`);
    const [, key, value] = m;
    if (!GOAL_KEYS.includes(key)) fail(refusedKey(`${file}: goal ${raw.length}`, key));
    if (Object.hasOwn(goal, key)) fail(`${file}: goal ${raw.length}: duplicate ${key}`);
    goal[key] = unquote(value);
  }
  if (meta.name !== undefined && meta.name !== stem) fail(`${file}: name "${meta.name}" is not the file's name (${stem})`);
  if (!raw.length) fail(`${file}: no goal: a persona measures at least one number`);
  const goals = raw.map((g, i) => goalOf(`${file}: goal ${i + 1}`, g));
  const seen = new Map();
  for (const g of goals) {
    if (seen.has(g.id)) fail(`${file}: goals "${seen.get(g.id)}" and "${g.name}" share the measure id ${g.id}; rename one`);
    seen.set(g.id, g.name);
  }
  return { name: stem, description: meta.description ?? '', goals, body: block[2], meta };
}

function goalOf(where, g) {
  const name = g.name?.trim();
  if (!name) fail(`${where}: no name`);
  const at = `${where} ("${name}")`;
  if (!slugOf(name)) fail(`${at}: the name needs a letter or digit`);
  if (!g['measured by']?.trim()) fail(`${at}: no command (measured by:)`);
  const kinds = ['at most', 'at least'].filter(k => g[k] !== undefined);
  if (kinds.length !== 1) fail(`${at}: ${kinds.length ? 'both at most: and at least:; give one' : 'no bound (at most: or at least:)'}`);
  const kind = kinds[0];
  const b = /^(-?\d+(?:\.\d+)?)\s*([a-zA-Z%]*)$/.exec(g[kind].trim());
  if (!b) fail(`${at}: ${kind}: "${g[kind]}" is not a number (a number, with an optional unit: 100ms)`);
  let baseline = null;
  if (g.baseline !== undefined) {
    const m = /^(-?\d+(?:\.\d+)?)\s*[a-zA-Z%]*\s*,\s*(\d{4}-\d{2}-\d{2})\s*(?:,\s*([0-9a-f]{4,40}))?$/.exec(g.baseline.trim());
    if (!m) fail(`${at}: baseline: "${g.baseline}" is not "<number>, <YYYY-MM-DD>[, <commit>]"`);
    baseline = { value: Number(m[1]), date: m[2], ...(m[3] ? { commit: m[3] } : {}) };
  }
  return { id: slugOf(name), name, kind, bound: Number(b[1]), unit: b[2], better: kind === 'at most' ? 'lower' : 'higher', measuredBy: g['measured by'].trim(), baseline };
}

/** Every persona in the project, parsed, by name. Empty when there is no .agents/personas/. */
export async function readPersonas(root) {
  const dir = join(root, PERSONA_DIR);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(f => f.endsWith('.md')).sort();
  return Promise.all(files.map(async f => {
    const path = `${PERSONA_DIR}/${f}`;
    const text = await readFile(join(root, path), 'utf8');
    return { path, text, persona: parsePersona(path, text) };
  }));
}

/** Every persona file's text, so "did the run change one" is answered by bytes, not by asking git. */
async function snapshot(root) {
  const dir = join(root, PERSONA_DIR);
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.md'))) out.set(f, await readFile(join(dir, f), 'utf8'));
  return out;
}

const tail = s => String(s ?? '').trim().split('\n').slice(-3).join(' ').slice(0, 200);

/**
 * Run one goal's command and read its number: { value } or { broken }. A
 * command that fails, times out or prints anything but one number is broken,
 * never zero: "0 failures" and "nothing was measured" must not look alike.
 */
export function take(goal, { root, env = process.env, config = {}, timeout = TIMEOUT_MS } = {}) {
  const r = spawnSync(goal.measuredBy, { cwd: root, shell: true, env: gateEnv(env, config), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error?.code === 'ETIMEDOUT') return { broken: `timed out after ${Math.round(timeout / 1000)} s` };
  if (r.error) return { broken: `could not run: ${r.error.message}` };
  if (r.status !== 0) return { broken: `exit ${r.status ?? r.signal}${tail(r.stderr) ? `: ${tail(r.stderr)}` : ''}` };
  const out = String(r.stdout).trim();
  if (!NUMBER.test(out)) return { broken: `printed ${out ? JSON.stringify(out.slice(0, 120)) : 'nothing'}, not one number` };
  return { value: Number(out) };
}

export const met = (goal, value) => goal.kind === 'at most' ? value <= goal.bound : value >= goal.bound;
export const measureId = (persona, goal) => `persona:${persona}:${goal.id}`;

/** One goal's result, as a run reports it. */
function resultOf(persona, goal, reading) {
  const state = reading.broken ? 'broken' : met(goal, reading.value) ? 'met' : 'missed';
  return {
    id: goal.id, name: goal.name, measure: measureId(persona, goal), command: goal.measuredBy,
    kind: goal.kind, bound: goal.bound, unit: goal.unit, better: goal.better, baseline: goal.baseline,
    state, value: reading.broken ? null : reading.value, ...(reading.broken ? { detail: reading.broken } : {}),
  };
}

/**
 * Each missed goal of one persona's run as a candidate plan item, and each
 * broken goal as a review item: the night's default plan lists them (keel
 * phase 73's item shape, docs/research/2026-10-14-nightwatch.md "The design").
 *
 *   missed → { id, title, kind: 'build', source: 'persona:<name>',
 *              number: { measure: 'persona:<name>:<goal>', bound, better },
 *              lane: 'persona:<name>', status: 'planned' }
 *   broken → { id, title, kind: 'review', source: 'persona:<name>',
 *              number: null, lane: 'persona:<name>', status: 'planned' }
 *
 * `id` is `persona-<name>--<goal>` (keel#141): a goal's id is a slug, which
 * never holds `--`, so the last `--` separates the two and no two personas'
 * goals share an id ("a-b" + "c" and "a" + "b-c" were both persona-a-b-c). A
 * build item names its number first; a broken goal has no number to name, so
 * it is never a build. `lane` is the persona's own (the plan's lane names
 * where the item came from until phase 76 hands builds to a pass; a persona
 * never builds). A met goal gives nothing.
 */
export function planCandidates({ name, goals }) {
  const items = [];
  for (const g of goals) {
    const base = { id: `persona-${name}--${g.id}`, source: `persona:${name}` };
    if (g.state === 'missed') {
      items.push({ ...base, title: `${g.name}: back to ${g.kind} ${g.bound}${g.unit} (measured ${g.value}${g.unit})`, kind: 'build',
        number: { measure: g.measure, bound: g.bound, better: g.better }, lane: `persona:${name}`, status: 'planned' });
    } else if (g.state === 'broken') {
      items.push({ ...base, title: `${g.name}: its command is broken (\`${g.command}\`: ${g.detail})`, kind: 'review', number: null, lane: `persona:${name}`, status: 'planned' });
    }
  }
  return items;
}

const cell = s => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
const VERDICT = { met: 'met', missed: '**missed**', broken: '**broken**' };

/** The review page: what each goal read, against its bound and baseline, and what goes to the next night. */
export function reviewPage({ persona, goals, date, commit, by = COMMAND }) {
  const lines = [`# ${persona} — ${date}`, '',
    `Measured by \`${by}\`${commit ? ` at \`${commit}\`` : ''}. A run changes nothing but this page.`, '',
    '| Goal | Bound | Now | Verdict |', '| --- | --- | --- | --- |'];
  for (const g of goals) {
    const was = g.baseline && g.value !== null && g.baseline.value !== g.value ? ` (was ${g.baseline.value}${g.unit} on ${g.baseline.date})` : '';
    lines.push(`| ${cell(g.name)} | ${g.kind} ${g.bound}${g.unit} | ${g.value === null ? '—' : `${g.value}${g.unit}${was}`} | ${VERDICT[g.state]} |`);
  }
  const broken = goals.filter(g => g.state === 'broken');
  if (broken.length) lines.push('', '## Broken', '', 'A broken command is not a zero: nothing was measured.', '', ...broken.map(g => `- ${g.name}: \`${g.command}\` — ${g.detail}`));
  const items = planCandidates({ name: persona, goals });
  lines.push('', '## For the next night', '');
  lines.push(...(items.length ? items.map(i => `- ${i.kind}: ${i.title}${i.number ? ` (\`${i.number.measure}\`)` : ''}`) : ['Nothing: every goal is met.']));
  return `${lines.join('\n')}\n`;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function commitOf(root, env) {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
}

async function configOf(root) {
  try { return JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw new PersonaError(`.keel/keel.json: ${e.message}`); }
}

/** lstat, or null when the path does not exist. */
const lstatOf = path => lstat(path).catch(e => { if (e.code === 'ENOENT') return null; throw e; });

/**
 * docs/reviews/, made if missing. Refused when docs or docs/reviews is a
 * symlink (checked before mkdir, so nothing is made through one) or when it
 * resolves outside the project.
 */
async function reviewsDir(root) {
  let at = root;
  for (const part of REVIEWS.split('/')) {
    at = join(at, part);
    const s = await lstatOf(at);
    if (s && !s.isDirectory()) fail(`refused: ${relative(root, at).split(sep).join('/')} is ${s.isSymbolicLink() ? 'a symlink' : 'not a directory'}; a run writes only inside the project, never through a link`, 1);
  }
  const dir = join(root, REVIEWS);
  await mkdir(dir, { recursive: true });
  const [real, top] = [await realpath(dir), await realpath(root)];
  if (real !== top && !real.startsWith(top + sep)) fail(`${REVIEWS} resolves outside the project (${real}); a run writes only inside it`, 1);
  return dir;
}

/** Why `s` (an lstat or fstat) is not a page this run may overwrite, or null: a regular file with one link. */
const unsafe = s => s.isSymbolicLink() ? 'a symlink' : !s.isFile() ? 'not a file' : s.nlink !== 1 ? `${s.nlink} links` : null;
const pageRefusal = (root, page, why) => `refused: ${relative(root, page).split(sep).join('/')} is not a regular file (${why}); a run never writes through a link, and no review page was written`;

/**
 * Write a review page without following a link: opened with O_NOFOLLOW (a
 * symlink made after the check still fails the open), checked on the open
 * handle (a hard link shares an outside file's bytes), then truncated.
 */
async function writePage(root, page, text) {
  let handle;
  try { handle = await open(page, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o644); }
  catch (e) { if (e.code === 'ELOOP') fail(pageRefusal(root, page, 'a symlink'), 1); throw e; }
  try {
    const why = unsafe(await handle.stat());
    if (why) fail(pageRefusal(root, page, why), 1);
    await handle.truncate(0);
    await handle.writeFile(text);
  } finally { await handle.close(); }
}

/**
 * Measure one persona (`name`) or every one (`all`), and write each one's
 * review page. Returns { data, text, exitCode }: 0 every goal met, 1 a goal
 * missed, 2 a goal broken (as keel improve: a broken instrument outranks a
 * number outside its bound). Refuses, writing nothing, when a persona file
 * changed during the run.
 */
export async function run({ root, name, all = false, date = today(), env = process.env, timeout = TIMEOUT_MS, by = COMMAND } = {}) {
  if (all === Boolean(name)) fail(`name one persona or --all: ${by} [<name> | --all]`);
  const config = await configOf(root);
  const before = await snapshot(root);
  const personas = await readPersonas(root);
  if (!personas.length) fail(`no personas: ${PERSONA_DIR}/ has no <name>.md`);
  const wanted = all ? personas : personas.filter(p => p.persona.name === name);
  if (!wanted.length) fail(`no persona "${name}"; there is ${personas.map(p => p.persona.name).join(', ')} (or --all)`);
  const results = wanted.map(({ persona }) => ({
    name: persona.name,
    goals: persona.goals.map(g => resultOf(persona.name, g, take(g, { root, env, config, timeout }))),
  }));
  const after = await snapshot(root);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(f => before.get(f) !== after.get(f)).sort();
  if (changed.length) fail(`refused: ${changed.map(f => `${PERSONA_DIR}/${f}`).join(', ')} changed during the run, and a run that can change its goal can pass by lowering the bar; no review page was written`, 1);
  const dir = await reviewsDir(root);
  const commit = commitOf(root, env);
  // Every destination is checked before any is written, so one refused page writes none.
  for (const r of results) {
    const page = join(dir, `${date}-${r.name}.md`);
    const s = await lstatOf(page);
    const why = s && unsafe(s);
    if (why) fail(pageRefusal(root, page, why), 1);
  }
  for (const r of results) {
    const page = join(dir, `${date}-${r.name}.md`);
    await writePage(root, page, reviewPage({ persona: r.name, goals: r.goals, date, commit, by }));
    r.page = relative(root, page).split(sep).join('/');
    r.candidates = planCandidates(r);
  }
  const count = state => results.reduce((n, r) => n + r.goals.filter(g => g.state === state).length, 0);
  const totals = { met: count('met'), missed: count('missed'), broken: count('broken') };
  return {
    data: { date, ...totals, personas: results },
    text: results.map(r => `${r.page} — ${r.goals.length} goal${r.goals.length === 1 ? '' : 's'}: ${['met', 'missed', 'broken'].map(s => `${r.goals.filter(g => g.state === s).length} ${s}`).join(', ')}`).join('\n'),
    exitCode: totals.broken ? 2 : totals.missed ? 1 : 0,
  };
}

/**
 * Each persona goal as a measure the night's improve.mjs `measure()` takes:
 * id `persona:<name>:<goal>`, its bound read from the persona file on every
 * run (a rule measure, ratchet: false, so .keel/bounds.json never holds a
 * second copy of it). A broken command throws, which measure() reports as broken.
 */
export async function personaMeasures(root, { timeout = TIMEOUT_MS } = {}) {
  return (await readPersonas(root)).flatMap(({ persona }) => persona.goals.map(goal => ({
    id: measureId(persona.name, goal), what: `${persona.name}: ${goal.name} (${goal.kind} ${goal.bound}${goal.unit}, ${PERSONA_DIR}/${persona.name}.md)`,
    unit: goal.unit || 'number', bound: null, better: goal.better, ratchet: false, persona: persona.name,
    async run(ctx) {
      const r = take(goal, { root: ctx.root, env: ctx.env, config: ctx.config, timeout });
      if (r.broken) throw new Error(`\`${goal.measuredBy}\`: ${r.broken}`);
      return { value: r.value, bound: goal.bound, detail: `\`${goal.measuredBy}\` printed ${r.value}; ${goal.kind} ${goal.bound}${goal.unit}` };
    },
  })));
}

/** `run [<name> | --all]`: the words after the script, or after `keel persona`. */
export function parseArgs(args) {
  const [verb, ...rest] = args;
  if (verb !== 'run') fail(`usage: ${COMMAND.replace(/ run$/, '')} run [<name> | --all] [--json]`);
  const unknown = rest.find(a => a.startsWith('--') && a !== '--all');
  if (unknown) fail(`unexpected argument: ${unknown}`);
  const names = rest.filter(a => !a.startsWith('--'));
  if (names.length > 1) fail(`unexpected argument: ${names[1]}`);
  return { name: names[0], all: rest.includes('--all') };
}

if (isMain(import.meta)) {
  const root = rootOf(import.meta);
  await main(args => run({ root: resolve(root), ...parseArgs(args) }));
}

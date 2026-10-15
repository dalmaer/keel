// The night's plan (keel practice `night`; managed: keel render rewrites it).
// Every night has one plan, written before anything runs, and each pass
// ticks its item with what became of it (keel phase 73; the design is
// docs/research/2026-10-14-nightwatch.md, "One plan per night"). keel's
// `keel night plan` and `keel night tick` are this same module.
//
//   node scripts/keel/night-plan.mjs plan [--date d]          keel's default plan for the night d, written
//   node scripts/keel/night-plan.mjs tonight --date d [--branch-plan f | --branch-unread "<why>"]
//                                   the night's own step: the plan f read from the plan branch when it is
//                                   valid and dated d, else the default plan; it says which
//   node scripts/keel/night-plan.mjs tick <id> --status s [--note "<text>"] [--link <url>]
//   node scripts/keel/night-plan.mjs check [--file f]        validate a plan (default: the working plan)
//
// The plan is .keel/night/plan.json (schema 1), a working file that ignores
// itself; the night commits it as it ended as docs/night/<date>.json in its
// data-only PR (improve.mjs writes that record). It travels on the branch
// keel-night-plan (one file, force-pushed by whoever shapes it, never merged):
// the night only reads it.
//
// The default plan is what keel would do anyway, written down: tonight's
// measures, the health page's proposal, the climb job `climb.mjs pick` would
// choose, the robot's next admissible issue and Loop's untriaged findings,
// and whatever CANDIDATE_SOURCES add (personas, phase 75, plug in there).
// Deterministic: no model, no clock in the file, and the same inputs make the
// same bytes. It reads only what the night already reads (the health pages,
// the climb and loop practices' scripts, gh's open PRs and keel:agent issues).
//
// "Tonight" is the UTC date the night runs on: keel-night.yml runs at 07:23
// UTC and its page and PR are dated by the runner's (UTC) date, so a plan
// made before 07:23 UTC is for that day's night and one made after is for the
// next (nightOf). The night itself passes its own date.
//
// Rules the validator holds (validatePlan): exactly the design's fields,
// an unknown one refused by name; a build item names its number first; at
// most five build items, counted with the robot's open PRs. The default plan
// never writes a refused plan: a candidate build with no number becomes
// triage, and builds past the fifth wait for the next night (admit).
//
// Exit: 0 done; 2 usage, a refused plan or tick, or an input that cannot be
// read (nothing is written then; the message names the input). gh is
// process.env.KEEL_GH || 'gh'.
import { readFile, mkdir, readdir, lstat, realpath, open } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain, rootOf, main, healthDirOf, cells } from './lib.mjs';

export const SCHEMA = 1;
export const PLAN_DIR = '.keel/night';
export const PLAN = `${PLAN_DIR}/plan.json`;
export const PLAN_BRANCH = 'keel-night-plan';
export const RECORD_DIR = 'docs/night';
/** The plan as the night ended, committed in its data-only PR. */
export const recordOf = date => `${RECORD_DIR}/${date}.json`;
/** keel-night.yml's cron, UTC: the minute a night starts. */
export const NIGHT_AT = Object.freeze({ hour: 7, minute: 23 });
export const MAX_BUILD = 5;
/** Loop findings the default plan names one by one; the rest are one leftOpen line. */
export const FINDING_ITEMS = 5;
export const MAX_BYTES = 256 * 1024;
export const KINDS = Object.freeze(['measure', 'build', 'triage', 'review']);
export const STATUSES = Object.freeze(['planned', 'running', 'done', 'failed', 'skipped', 'left-alone']);
export const SHAPERS = Object.freeze(['default', 'owner']);
export const PLAN_FIELDS = Object.freeze(['schema', 'date', 'shapedBy', 'readyBy', 'willNotTouch', 'settledToday', 'leftOpen', 'items']);
export const ITEM_FIELDS = Object.freeze(['id', 'title', 'kind', 'source', 'number', 'lane', 'budget', 'status', 'result']);
/** The night's own item: improve.mjs --report ticks every measure item in lane night. */
export const MEASURE_ITEM = 'measures';
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE = /^(?:default|owner|persona:[a-z0-9][a-z0-9-]*|loop:[A-Za-z0-9][A-Za-z0-9._-]*|health:[a-z][a-z0-9_]*|robot:#[1-9]\d*)$/;
const LANE = /^(?:climb:[a-z][a-z0-9-]*|robot:#[1-9]\d*|loop|persona:[a-z0-9][a-z0-9-]*|night)$/;
const READY_BY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
const ROBOT_HEAD = /^keel\/robot-([1-9]\d*)$/;

export class NightPlanError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

/** The UTC date of the night a plan made at `now` is for: today's before 07:23 UTC, else tomorrow's. */
export function nightOf(now = new Date()) {
  const d = new Date(now);
  if (!Number.isFinite(d.getTime())) throw new NightPlanError('nightOf: not a time');
  if (d.getUTCHours() * 60 + d.getUTCMinutes() >= NIGHT_AT.hour * 60 + NIGHT_AT.minute) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x, max = 2000) => typeof x === 'string' && x.trim() !== '' && x.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x);
const isDate = d => DATE.test(d ?? '') && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const textList = (x, max = 64) => Array.isArray(x) && x.length <= max && x.every(s => isText(s, 500));

/** A build item's or a measure-named item's number: { measure, bound, better }. Returns the problems. */
function numberProblems(n, where) {
  if (!isObject(n)) return [`${where}: "number" is { measure, bound, better }`];
  const out = [];
  for (const k of Object.keys(n)) if (!['measure', 'bound', 'better'].includes(k)) out.push(`${where}: unknown field "number.${k}"`);
  if (!/^[a-z][a-z0-9_]*$/.test(n.measure ?? '')) out.push(`${where}: "number.measure" names a measure the night already takes (like slow_tests)`);
  if (!Number.isFinite(n.bound)) out.push(`${where}: "number.bound" is a number`);
  if (!['lower', 'higher'].includes(n.better)) out.push(`${where}: "number.better" is lower or higher`);
  return out;
}

/** The robot PRs a plan's build count includes: those whose issue no build item already names in its lane. */
const robotOutside = (items, openRobotPrs) => {
  const named = new Set(items.filter(i => i?.kind === 'build' && /^robot:#/.test(i?.lane ?? '')).map(i => Number(i.lane.slice(7))));
  return [...new Set(openRobotPrs)].filter(n => !named.has(n)).sort((a, b) => a - b);
};

/**
 * Is this a schema-1 plan? Exactly the design's fields; an unknown one is
 * refused by name. A build item with no number is refused (the default plan
 * makes it triage first: admit). At most MAX_BUILD build items, counted with
 * the robot's open PRs (`openRobotPrs`: the issue numbers of the open
 * keel/robot-<n> PRs; one whose issue a build item names in its lane is that
 * item, not another). Pure. Returns { ok, problems: [text] }.
 */
export function validatePlan(plan, { openRobotPrs = [] } = {}) {
  const problems = [];
  const bad = m => problems.push(m);
  if (!isObject(plan)) return { ok: false, problems: ['the plan is a JSON object'] };
  for (const k of Object.keys(plan)) if (!PLAN_FIELDS.includes(k)) bad(`plan: unknown field "${k}" (a plan has ${PLAN_FIELDS.join(', ')})`);
  if (plan.schema !== SCHEMA) bad(`plan: "schema" is ${SCHEMA}`);
  if (!isDate(plan.date)) bad('plan: "date" is the night\'s UTC date, YYYY-MM-DD');
  if (!SHAPERS.includes(plan.shapedBy)) bad(`plan: "shapedBy" is ${SHAPERS.join(' or ')}`);
  if (plan.readyBy !== null && !READY_BY.test(plan.readyBy ?? '')) bad('plan: "readyBy" is null or a time with its zone, like 2026-10-15T07:00:00Z');
  for (const k of ['willNotTouch', 'settledToday', 'leftOpen']) if (!textList(plan[k])) bad(`plan: "${k}" is a list of at most 64 lines of text`);
  if (!Array.isArray(plan.items) || plan.items.length > 64) { bad('plan: "items" is a list of at most 64 items'); return { ok: false, problems }; }
  const seen = new Set();
  let builds = 0;
  const outside = robotOutside(plan.items, openRobotPrs);
  plan.items.forEach((item, i) => {
    const where = `items[${i}]${typeof item?.id === 'string' ? ` (${item.id})` : ''}`;
    if (!isObject(item)) { bad(`${where}: an item is an object`); return; }
    for (const k of Object.keys(item)) if (!ITEM_FIELDS.includes(k)) bad(`${where}: unknown field "${k}" (an item has ${ITEM_FIELDS.join(', ')})`);
    if (!ID.test(item.id ?? '')) bad(`${where}: "id" is lowercase letters, digits and dashes, at most 64`);
    else if (seen.has(item.id)) bad(`${where}: "id" ${item.id} is already an item`);
    else seen.add(item.id);
    if (!isText(item.title, 300)) bad(`${where}: "title" is one line of text, at most 300 characters`);
    if (!KINDS.includes(item.kind)) bad(`${where}: "kind" is ${KINDS.join(', ')}`);
    if (!SOURCE.test(item.source ?? '')) bad(`${where}: "source" is default, owner, persona:<name>, loop:<slug>, health:<measure> or robot:#<issue>`);
    if (!LANE.test(item.lane ?? '')) bad(`${where}: "lane" is climb:<job>, robot:#<issue>, loop, persona:<name> or night`);
    if (!STATUSES.includes(item.status)) bad(`${where}: "status" is ${STATUSES.join(', ')}`);
    if (item.number !== undefined && item.number !== null) problems.push(...numberProblems(item.number, where));
    if (item.budget !== undefined && item.budget !== null) {
      if (!isObject(item.budget) || Object.keys(item.budget).some(k => k !== 'minutes') || !(Number.isFinite(item.budget.minutes) && item.budget.minutes > 0)) bad(`${where}: "budget" is { minutes } with minutes above 0`);
    }
    if (item.result !== undefined && item.result !== null) {
      if (!isObject(item.result)) bad(`${where}: "result" is { note, link }`);
      else {
        for (const k of Object.keys(item.result)) if (!['note', 'link'].includes(k)) bad(`${where}: unknown field "result.${k}"`);
        if (item.result.note !== undefined && !isText(item.result.note, 1000)) bad(`${where}: "result.note" is text, at most 1000 characters`);
        if (item.result.link !== undefined && !isLink(item.result.link)) bad(`${where}: "result.link" is an https URL or a repo path`);
      }
    }
    if (item.kind === 'build') {
      if (item.number === undefined || item.number === null) bad(`${where}: a build item names its number first; it has no "number" (make it triage or review)`);
      builds++;
      if (builds + outside.length > MAX_BUILD) {
        bad(`${where}: a ${ordinal(builds + outside.length)} build item; at most ${MAX_BUILD} a night, counted with the robot's open PRs (${outside.length ? outside.map(n => `#${n}`).join(', ') : 'none'}); the rest wait for the next night`);
      }
    }
  });
  return { ok: !problems.length, problems };
}
const ordinal = n => ({ 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth' })[n] ?? `${n}th`;
/** A result's link: an https URL, or a repo-relative path (a health page). */
export const isLink = l => isText(l, 500) && !/\s/.test(l) && (/^https:\/\/[^/]+\//.test(l) || (!l.startsWith('/') && !l.includes('..') && !/^[a-z]+:/i.test(l)));

/** One item with every field, in the design's order. */
const item = ({ id, title, kind, source, number = null, lane, budget = null, status = 'planned', result = null }) =>
  ({ id, title, kind, source, number, lane, budget, status, result });

/**
 * Candidate items into tonight's items, under the plan's rules, never
 * refusing: each gets every field (status planned); a build with no number
 * becomes triage, saying why; a repeated id gets a -2, -3; builds past the
 * fifth (counted with the robot's open PRs) wait for the next night, as
 * leftOpen lines. This is the seam for other plan sources: a source's items
 * pass through here. Pure. Returns { items, waiting: [text] }.
 */
export function admit(candidates, { openRobotPrs = [], taken = [] } = {}) {
  const ids = new Set(taken), items = [], waiting = [];
  // Kinds first: a build with no number is triage before anything is counted,
  // so admission counts exactly the builds the validator will.
  const normal = candidates.map(c => {
    const it = item(c);
    return it.kind === 'build' && it.number === null
      ? { ...it, kind: 'triage', result: { note: 'Names no number, so it is triage, not build: a build item names its number first.' } }
      : it;
  });
  // The validator's count: admitted builds, plus each open robot PR no admitted build names in its lane.
  // A build naming an open PR not yet named takes that PR's place (no change); any other adds one.
  const open = new Set(openRobotPrs), named = new Set();
  let total = open.size;
  for (const c of normal) {
    let it = c;
    let id = String(it.id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
    const base = id;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    it = { ...it, id };
    if (it.kind === 'build') {
      const pr = /^robot:#/.test(it.lane) ? Number(it.lane.slice(7)) : null;
      const replaces = pr !== null && open.has(pr) && !named.has(pr);
      if (total + (replaces ? 0 : 1) > MAX_BUILD) { waiting.push(`${id}: waits for the next night (at most ${MAX_BUILD} build items, counted with the robot's ${open.size} open PR${open.size === 1 ? '' : 's'})`); continue; }
      if (replaces) named.add(pr); else total++;
    }
    ids.add(id);
    items.push(it);
  }
  return { items, waiting };
}

// ---- the inputs -------------------------------------------------------------

const readJsonFile = async (path, what) => {
  let raw;
  try { raw = await readFile(path, 'utf8'); } catch (e) { throw new NightPlanError(`cannot read ${what}: ${e.code ?? e.message}`); }
  if (raw.length > MAX_BYTES) throw new NightPlanError(`${what} is larger than ${MAX_BYTES} bytes`);
  try { return JSON.parse(raw); } catch { throw new NightPlanError(`${what} is not JSON`); }
};

/** The health page's measure rows: `| \`id\` — what | value | ≤ bound | state | detail |`. */
export function healthRows(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!/^\|\s*`[a-z_]+`/.test(line)) continue;
    const [measure, value, bound, state] = cells(line);
    const id = /^`([a-z_]+)`/.exec(measure)?.[1];
    const b = /^([≤≥])\s*(-?[\d.]+)/.exec(bound ?? '');
    if (!id) continue;
    out.push({ id, value: /^-?[\d.]+$/.test(value) ? Number(value) : null, bound: b ? Number(b[2]) : null, better: b?.[1] === '≥' ? 'higher' : 'lower', state });
  }
  return out;
}

/** The page's one proposal: its first line after `## Proposal`, `**\`id\`** (state) — text`; null when it proposes none. */
export function healthProposal(text) {
  const at = text.split('\n').findIndex(l => l.trim() === '## Proposal');
  if (at < 0) return null;
  for (const line of text.split('\n').slice(at + 1)) {
    if (!line.trim()) continue;
    if (line.startsWith('<!-- ')) continue;
    const m = /^\*\*`([a-z_]+)`\*\*(?: \(([\w/-]+)\))? — (.+)$/.exec(line.trim());
    return m ? { id: m[1], state: m[2] ?? 'outside', text: m[3].trim() } : null;
  }
  return null;
}

/**
 * The newest health page dated before the night (a rerun the same day reads
 * what the night before it read): { date, file, rows, proposal }, or null
 * when there is none yet. A page or directory that exists and cannot be read
 * throws.
 */
export async function newestHealth(root, config, date) {
  let dir;
  try { dir = healthDirOf(config); } catch (e) { throw new NightPlanError(`the health directory: ${e.message}`); }
  let names;
  try { names = (await readdir(join(root, dir))).filter(n => /^\d{4}-\d{2}-\d{2}\.md$/.test(n) && n.slice(0, 10) < date).sort(); }
  catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) return null; throw new NightPlanError(`cannot read the health directory ${dir}: ${e.code ?? e.message}`); }
  if (!names.length) return null;
  const file = `${dir}/${names.at(-1)}`;
  let text;
  try { text = await readFile(join(root, file), 'utf8'); } catch (e) { throw new NightPlanError(`cannot read the health page ${file}: ${e.code ?? e.message}`); }
  return { date: names.at(-1).slice(0, 10), file, rows: healthRows(text), proposal: healthProposal(text) };
}

/** gh's JSON, or a NightPlanError naming the read. */
function ghJson(root, env, args, what) {
  const gh = env.KEEL_GH || 'gh';
  const r = spawnSync(gh, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  if (r.error) throw new NightPlanError(`cannot read ${what} (${gh}): ${r.error.code === 'ENOENT' ? 'gh is not installed' : r.error.message}`);
  if (r.status !== 0) throw new NightPlanError(`cannot read ${what}: gh exited ${r.status}${(r.stderr || '').trim() ? `, ${r.stderr.trim().split('\n')[0]}` : ''}`);
  let data;
  try { data = JSON.parse(r.stdout); } catch { throw new NightPlanError(`cannot read ${what}: gh did not print JSON`); }
  if (!Array.isArray(data)) throw new NightPlanError(`cannot read ${what}: gh did not print a JSON list`);
  return data;
}
const repoArgs = config => (typeof config?.repo === 'string' && config.repo ? ['--repo', config.repo] : []);

/** The issue numbers of the robot's open PRs (keel/robot-<n>, from this repo). */
export function openRobotPrs(root, config, env = process.env) {
  return ghJson(root, env, ['pr', 'list', ...repoArgs(config), '--state', 'open', '--limit', '200', '--json', 'number,headRefName,isCrossRepository'], 'the open PRs')
    .filter(p => !p?.isCrossRepository && ROBOT_HEAD.test(p?.headRefName ?? ''))
    .map(p => Number(ROBOT_HEAD.exec(p.headRefName)[1])).sort((a, b) => a - b);
}

async function practiceScript(root, rel, what) {
  const path = join(root, rel);
  if (!existsSync(path)) throw new NightPlanError(`cannot read ${what}: ${rel} is not here (its practice is not installed)`);
  try { return await import(pathToFileURL(path).href); } catch (e) { throw new NightPlanError(`cannot read ${what}: ${rel} did not load (${String(e.message).split('\n')[0]})`); }
}

/** The climb job `climb.mjs pick` would choose tonight, or null with climb off. */
async function climbInput(root, config, env, date) {
  if (config?.climb === undefined) return null;
  const climb = await practiceScript(root, 'scripts/keel/climb.mjs', 'the climb pick');
  let picked;
  try { picked = await climb.pick({ root, config, env, date }); }
  catch (e) { throw new NightPlanError(`cannot read the climb pick: ${String(e.message).split('\n')[0]}`); }
  if (!picked?.job) return { job: null, reason: picked?.reason ?? 'no job tonight' };
  const job = climb.JOBS?.[picked.job];
  return { job: picked.job, by: picked.by, why: picked.why, minutes: picked.minutes ?? null, measures: [...(job?.measures ?? [])], better: climb.betterOf ? climb.betterOf(picked.job, config) : 'lower' };
}

/**
 * The robot's next admissible issue: with the robot on (robot-policy.mjs),
 * the oldest open keel:agent issue whose rubric parses with no owner blocker
 * and no prerequisite, as the robot's own admission reads it. The weekly
 * allowance is the robot's to check when it runs; the plan does not read it.
 */
async function robotInput(root, config, env) {
  if (config?.robot === undefined) return { policy: 'off', next: null, open: [] };
  const { robotPolicy } = await practiceScript(root, 'scripts/keel/robot-policy.mjs', 'the robot policy');
  const policy = robotPolicy(config);
  const open = openRobotPrs(root, config, env);
  if (!policy.valid || !policy.enabled) return { policy: policy.valid ? 'off' : 'invalid', next: null, open };
  const { parseRobotRubric } = await practiceScript(root, 'scripts/keel/robot-rubric.mjs', 'the robot rubric');
  const issues = ghJson(root, env, ['issue', 'list', ...repoArgs(config), '--state', 'open', '--label', 'keel:agent', '--limit', '100', '--json', 'number,title,body,createdAt'], 'the keel:agent issues')
    .filter(i => Number.isSafeInteger(i?.number) && i.number > 0)
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.number - b.number);
  for (const issue of issues) {
    const parsed = parseRobotRubric(issue.body ?? '');
    if (!parsed.ok || parsed.rubric.ownerBlockers.length || parsed.rubric.prerequisites.length) continue;
    return { policy: 'on', next: { number: issue.number, title: String(issue.title ?? '').replace(/\s+/g, ' ').trim() }, open };
  }
  return { policy: 'on', next: null, open };
}

/** Loop's untriaged findings (the loop practice's scripts/loop.mjs, docs/loop/), or null without it. */
async function loopInput(root) {
  if (!existsSync(join(root, 'scripts/loop.mjs'))) return null;
  const loop = await practiceScript(root, 'scripts/loop.mjs', 'the Loop findings');
  try { return loop.loadFindings(join(root, 'docs/loop')).filter(f => f.decision === 'untriaged').map(f => ({ slug: f.slug, title: f.title })).sort((a, b) => a.slug.localeCompare(b.slug)); }
  catch (e) { throw new NightPlanError(`cannot read the Loop findings (docs/loop): ${String(e.message).split('\n')[0]}`); }
}

/** Everything the default plan reads. Throws NightPlanError naming the first input it cannot read. */
export async function readInputs({ root, config, env = process.env, date }) {
  const health = await newestHealth(root, config, date);
  const climb = await climbInput(root, config, env, date);
  const robot = await robotInput(root, config, env);
  const loop = await loopInput(root);
  return { health, climb, robot, loop };
}

/**
 * Other sources of candidate items: each is async ({ root, config, env, date,
 * inputs }) → [item], its items passed through admit after keel's own. Empty
 * here; personas (phase 75) add theirs. A source that throws is an input the
 * plan cannot read.
 */
export const CANDIDATE_SOURCES = Object.freeze([]);

// ---- the default plan -------------------------------------------------------

const short = (s, n = 160) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const numberOf = (rows, ids, better) => {
  const row = ids.map(id => rows.find(r => r.id === id && Number.isFinite(r.bound))).find(Boolean);
  return row ? { measure: row.id, bound: row.bound, better: better ?? row.better } : null;
};

/**
 * keel's default plan for `date`, from what readInputs read, pure: the
 * night's measure item first, then the health page's proposal (review), the
 * climb job (build), the robot's next issue (build: it names no number, so
 * admit makes it triage), Loop's untriaged findings (triage), then
 * `candidates` (other sources). Same inputs, same plan.
 */
export function defaultPlan({ date, health = null, climb = null, robot = null, loop = null, candidates = [] }) {
  if (!isDate(date)) throw new NightPlanError(`the night's date is YYYY-MM-DD (got ${JSON.stringify(date)})`);
  const rows = health?.rows ?? [];
  const off = rows.filter(r => ['outside', 'broken'].includes(r.state)).map(r => r.id);
  const own = [item({
    id: MEASURE_ITEM, kind: 'measure', source: 'default', lane: 'night',
    title: health ? `Measure the practice: ${rows.length} measures; outside or broken on ${health.date}: ${off.length ? short(off.join(', '), 200) : 'none'}` : 'Measure the practice (no health page yet)',
  })];
  const p = health?.proposal;
  if (p) own.push(item({ id: `health-${p.id.replace(/_/g, '-')}`, kind: 'review', source: `health:${p.id}`, lane: 'night', number: numberOf(rows, [p.id]), title: short(`Proposal from ${health.date}: ${p.text}`, 300) }));
  if (climb?.job) {
    const ranked = [...climb.measures].sort((a, b) => Number(off.includes(b)) - Number(off.includes(a)));
    const number = numberOf(rows, ranked, climb.better);
    own.push(item({ id: `climb-${climb.job}`, kind: 'build', source: climb.by === 'measure' && number ? `health:${number.measure}` : 'default', lane: `climb:${climb.job}`, number, budget: Number.isFinite(climb.minutes) && climb.minutes > 0 ? { minutes: climb.minutes } : null, title: short(`Climb ${climb.job}: ${climb.why ?? 'tonight\'s job'}`, 300) }));
  }
  if (robot?.next) own.push(item({ id: `robot-${robot.next.number}`, kind: 'build', source: `robot:#${robot.next.number}`, lane: `robot:#${robot.next.number}`, title: short(`Robot: #${robot.next.number} ${robot.next.title}`, 300) }));
  const findings = loop ?? [];
  for (const f of findings.slice(0, FINDING_ITEMS)) own.push(item({ id: `loop-${f.slug}`, kind: 'triage', source: `loop:${f.slug}`, lane: 'loop', title: short(`Triage the Loop finding: ${f.title}`, 300) }));
  const open = robot?.open ?? [];
  const { items, waiting } = admit([...own, ...candidates], { openRobotPrs: open });
  const leftOpen = [
    ...(findings.length > FINDING_ITEMS ? [`${findings.length - FINDING_ITEMS} more untriaged Loop findings wait (docs/loop/)`] : []),
    ...(climb && !climb.job ? [`climb: ${short(climb.reason, 300)}`] : []),
    ...waiting,
  ];
  const plan = { schema: SCHEMA, date, shapedBy: 'default', readyBy: null, willNotTouch: [], settledToday: [], leftOpen, items };
  const v = validatePlan(plan, { openRobotPrs: open });
  if (!v.ok) throw new NightPlanError(`the default plan broke its own rules: ${v.problems[0]}`, 1);
  return plan;
}

async function configOf(root) {
  const config = await readJsonFile(join(root, '.keel', 'keel.json'), '.keel/keel.json');
  if (!isObject(config)) throw new NightPlanError('.keel/keel.json is not a JSON object');
  return config;
}

/** The default plan for the night `date`, read and made; nothing written. */
export async function makePlan({ root, date, env = process.env, sources = CANDIDATE_SOURCES }) {
  if (!isDate(date)) throw new NightPlanError(`--date is the night's UTC date, YYYY-MM-DD (got ${JSON.stringify(date)})`);
  const config = await configOf(root);
  const inputs = await readInputs({ root, config, env, date });
  const candidates = [];
  for (const source of sources) {
    let got;
    try { got = await source({ root, config, env, date, inputs }); } catch (e) { throw new NightPlanError(`cannot read a plan source (${source.name || 'unnamed'}): ${String(e?.message ?? e).split('\n')[0]}`); }
    if (!Array.isArray(got)) throw new NightPlanError(`a plan source (${source.name || 'unnamed'}) gave no list of items`);
    candidates.push(...got);
  }
  return { plan: defaultPlan({ date, ...inputs, candidates }), inputs, config };
}

/**
 * Write `text` to the repo-relative `rel` under `root`, never through a
 * symlink: every component that exists is a real directory (missing ones are
 * made, one at a time, and checked again), the destination resolves inside
 * the repo, and the file is opened O_NOFOLLOW, so a link planted between the
 * check and the open is still refused. A symlinked docs/night or record would
 * otherwise overwrite whatever it points at. Throws NightPlanError (exit 2).
 */
export async function safeWrite(root, rel, text) {
  const parts = rel.split('/');
  if (!parts.length || parts.some(p => !p || p === '.' || p === '..')) throw new NightPlanError(`refusing to write ${rel}: not a plain repo path`);
  const top = await realpath(root);
  let at = top;
  for (const [i, part] of parts.entries()) {
    at = join(at, part);
    let s = await lstat(at).catch(e => (e.code === 'ENOENT' ? null : Promise.reject(e)));
    const last = i === parts.length - 1;
    if (!s && !last) { await mkdir(at).catch(e => (e.code === 'EEXIST' ? null : Promise.reject(e))); s = await lstat(at); }
    if (s?.isSymbolicLink()) throw new NightPlanError(`refusing to write ${rel}: ${parts.slice(0, i + 1).join('/')} is a symlink`);
    if (s && !last && !s.isDirectory()) throw new NightPlanError(`refusing to write ${rel}: ${parts.slice(0, i + 1).join('/')} is not a directory`);
    if (s && last && !s.isFile()) throw new NightPlanError(`refusing to write ${rel}: it is not a regular file`);
  }
  const dir = await realpath(dirname(at));
  if (dir !== top && !dir.startsWith(`${top}${sep}`)) throw new NightPlanError(`refusing to write ${rel}: it resolves outside the repo`);
  let file;
  try { file = await open(at, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644); }
  catch (e) { throw new NightPlanError(`refusing to write ${rel}: ${e.code === 'ELOOP' ? 'it is a symlink' : e.code ?? e.message}`); }
  try { await file.writeFile(text); } finally { await file.close(); }
  return rel;
}

/** Write the working plan; .keel/night ignores itself (only docs/night/<date>.json is ever committed). */
export async function writePlan(root, plan) {
  await safeWrite(root, `${PLAN_DIR}/.gitignore`, '*\n');
  await safeWrite(root, PLAN, `${JSON.stringify(plan, null, 2)}\n`);
  return PLAN;
}

/** The plan as the night ended, docs/night/<date>.json, written the same safe way. */
export const writeRecord = (root, plan) => safeWrite(root, recordOf(plan.date), `${JSON.stringify(plan, null, 2)}\n`);

/** The working plan, validated (the build count without the robot's PRs: a tick never reads GitHub). Null when there is none. */
export async function readPlan(root, path = join(root, PLAN), what = PLAN) {
  if (!existsSync(path)) return null;
  const plan = await readJsonFile(path, what);
  const v = validatePlan(plan);
  if (!v.ok) throw new NightPlanError(`${what} is refused: ${v.problems.join('; ')}`);
  return plan;
}

export const planLine = it => `  ${it.id.padEnd(22)} ${it.kind.padEnd(7)} ${it.status.padEnd(10)} ${it.lane.padEnd(16)} ${it.title}`;
const planText = (plan, head) => [head, ...plan.items.map(planLine), ...plan.leftOpen.map(l => `  left open: ${l}`)].join('\n');

/** keel night plan: make the default plan for `date` (default: nightOf now) and write it. */
export async function plan({ root, date, env = process.env, now = new Date(), sources }) {
  const night = date ?? nightOf(now);
  const made = await makePlan({ root, date: night, env, sources });
  await writePlan(root, made.plan);
  return { data: { ok: true, path: PLAN, from: 'default', plan: made.plan }, text: planText(made.plan, `The default plan for the night of ${night} (UTC), written to ${PLAN}:`) };
}

/**
 * The night's step: the plan read from the plan branch (`branchPlan`, a
 * file the workflow wrote with git show) when it is valid and dated for this
 * night, else the default plan; written either way, saying which and why.
 * `branchUnread` is why the branch could not be read (the workflow goes red
 * on it; the night still has a plan).
 */
export async function tonight({ root, date, env = process.env, branchPlan = null, branchUnread = null, sources }) {
  if (!isDate(date)) throw new NightPlanError(`--date is the night's UTC date, YYYY-MM-DD (got ${JSON.stringify(date)})`);
  let why, refused = [];
  if (branchUnread) why = `the plan branch ${PLAN_BRANCH} could not be read (${branchUnread})`;
  else if (!branchPlan) why = `no plan on ${PLAN_BRANCH}`;
  else {
    let shaped = null;
    try { shaped = await readJsonFile(branchPlan, `the plan on ${PLAN_BRANCH}`); }
    catch (e) { refused = [e.message]; }
    if (shaped && !refused.length) {
      const config = await configOf(root);
      const open = config.robot === undefined ? [] : openRobotPrs(root, config, env);
      const v = validatePlan(shaped, { openRobotPrs: open });
      if (!v.ok) refused = v.problems;
      else if (shaped.date !== date) why = `the plan on ${PLAN_BRANCH} is dated ${shaped.date}, not ${date}`;
      else {
        await writePlan(root, shaped);
        const head = `Tonight's plan (${date}) is the one on ${PLAN_BRANCH}, shaped by ${shaped.shapedBy}.`;
        return { data: { ok: true, path: PLAN, from: 'branch', why: head, date, plan: shaped }, text: planText(shaped, head) };
      }
    }
    if (refused.length) why = `the plan on ${PLAN_BRANCH} is refused: ${refused.join('; ')}`;
  }
  const made = await makePlan({ root, date, env, sources });
  await writePlan(root, made.plan);
  const head = `Tonight's plan (${date}) is keel's default plan: ${why}.`;
  return { data: { ok: true, path: PLAN, from: 'default', why: head, refused, date, plan: made.plan }, text: planText(made.plan, head) };
}

/**
 * keel night tick: one item's status, with a note and a link. Refused: an
 * id the plan does not hold, a status outside the six, and a move back from
 * done (a done item may be ticked done again, to mend its note).
 */
export async function tick({ root, id, status, note, link }) {
  if (!STATUSES.includes(status)) throw new NightPlanError(`--status is one of ${STATUSES.join(', ')} (got ${JSON.stringify(status)})`);
  if (note !== undefined && !isText(note, 1000)) throw new NightPlanError('--note is text, at most 1000 characters');
  if (link !== undefined && !isLink(link)) throw new NightPlanError('--link is an https URL or a repo path');
  const current = await readPlan(root);
  if (!current) throw new NightPlanError(`no plan to tick: ${PLAN} is not here (keel night plan writes one)`);
  const at = current.items.findIndex(i => i.id === id);
  if (at < 0) throw new NightPlanError(`no item "${id}" in tonight's plan (${current.date}); its items: ${current.items.map(i => i.id).join(', ') || 'none'}`);
  const was = current.items[at];
  if (was.status === 'done' && status !== 'done') throw new NightPlanError(`"${id}" is done; a done item never moves back (to ${status})`);
  const result = { ...(was.result ?? {}), ...(note !== undefined ? { note } : {}), ...(link !== undefined ? { link } : {}) };
  const next = { ...was, status, result: Object.keys(result).length ? result : null };
  const updated = { ...current, items: current.items.map((it, i) => (i === at ? next : it)) };
  const v = validatePlan(updated);
  if (!v.ok) throw new NightPlanError(`the tick would leave a refused plan: ${v.problems[0]}`);
  await writePlan(root, updated);
  return { data: { ok: true, path: PLAN, date: updated.date, item: next, from: was.status }, text: `${id}: ${was.status} → ${status}${note ? ` — ${note}` : ''}${link ? ` (${link})` : ''}` };
}

/**
 * The night's measure items, ticked from what improve measured (pure): done,
 * with the counts and the page, or failed when an instrument broke. Other
 * items are each pass's to tick.
 */
export function tickMeasures(plan, { results, page }) {
  const count = s => results.filter(r => r.state === s).length;
  const broken = results.filter(r => r.state === 'broken').map(r => r.id);
  const note = `${count('ok')} ok, ${count('outside')} outside, ${count('n/a')} n/a, ${count('broken')} broken${broken.length ? ` (${short(broken.join(', '), 200)})` : ''}`;
  return {
    ...plan,
    items: plan.items.map(it => (it.kind === 'measure' && it.lane === 'night' && it.status !== 'done'
      ? { ...it, status: broken.length ? 'failed' : 'done', result: { note, ...(page ? { link: page } : {}) } }
      : it)),
  };
}

const esc = s => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
const numberCell = n => (n ? `\`${n.measure}\` ${n.better === 'higher' ? '≥' : '≤'} ${n.bound}` : '—');

/** The health page's section: the plan as the night ended, each item and what became of it. */
export function planSection(plan, { record } = {}) {
  const by = plan.shapedBy === 'owner' ? `the owner (from the plan branch \`${PLAN_BRANCH}\`)` : 'keel\'s default plan (`keel night plan`): nobody shaped tonight';
  return [
    '## Tonight\'s plan', '',
    `Shaped by ${by}. Each pass ticks its own item; until phase 76, climb and the robot still choose their own work, so an item they have not ticked is still \`planned\`.${record ? ` The record: \`${record}\`.` : ''}`, '',
    '| Item | Kind | Lane | Number | Status | Outcome |', '| --- | --- | --- | --- | --- | --- |',
    ...plan.items.map(it => `| ${esc(it.id)}: ${esc(it.title)} | ${it.kind} | ${esc(it.lane)} | ${esc(numberCell(it.number))} | ${it.status} | ${it.result ? esc([it.result.note, it.result.link].filter(Boolean).join(' — ')) : '—'} |`),
    ...(plan.items.length ? [] : ['| — | — | — | — | — | nothing planned |']),
    '',
    ...(plan.willNotTouch.length ? [`Will not touch: ${plan.willNotTouch.map(esc).join('; ')}.`, ''] : []),
    ...(plan.leftOpen.length ? [`Left open: ${plan.leftOpen.map(esc).join('; ')}.`, ''] : []),
  ];
}

// ---- the script --------------------------------------------------------------

const USAGE = 'usage: node scripts/keel/night-plan.mjs plan [--date d] | tonight --date d [--branch-plan f | --branch-unread "<why>"] | tick <id> --status s [--note "<text>"] [--link <url>] | check [--file f] [--json]';

/** The script's own arguments: a subcommand, its one positional (tick), its valued flags. */
export function parseArgs(args) {
  const [sub, ...rest] = args;
  const valued = { plan: ['--date'], tonight: ['--date', '--branch-plan', '--branch-unread'], tick: ['--status', '--note', '--link'], check: ['--file'] }[sub];
  if (!valued) throw new NightPlanError(USAGE);
  const out = { sub }, positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (valued.includes(rest[i])) {
      if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw new NightPlanError(`${rest[i]} needs a value`);
      out[rest[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rest[++i];
    } else if (rest[i].startsWith('--')) throw new NightPlanError(`unexpected argument: ${rest[i]}; ${USAGE}`);
    else positional.push(rest[i]);
  }
  if (sub === 'tick' ? positional.length !== 1 : positional.length) throw new NightPlanError(`unexpected argument: ${positional[sub === 'tick' ? 1 : 0] ?? '(none)'}; ${USAGE}`);
  if (sub === 'tick') { out.id = positional[0]; if (out.status === undefined) throw new NightPlanError('--status is required'); }
  if (sub === 'tonight' && out.date === undefined) throw new NightPlanError('--date is required: the night passes its own');
  if (out.branchPlan && out.branchUnread) throw new NightPlanError('--branch-plan and --branch-unread are one or the other');
  return out;
}

/** The validator, as a command: the working plan, or --file. */
export async function check({ root, file }) {
  const path = file ? file : join(root, PLAN);
  const raw = await readJsonFile(path, file ?? PLAN);
  const v = validatePlan(raw);
  return { data: { ok: v.ok, problems: v.problems }, text: v.ok ? `${file ?? PLAN}: a schema-${SCHEMA} plan.` : v.problems.join('\n'), exitCode: v.ok ? 0 : 2 };
}

export async function run(args, { root, env = process.env } = {}) {
  const o = parseArgs(args);
  if (o.sub === 'plan') return plan({ root, date: o.date, env });
  if (o.sub === 'tonight') return tonight({ root, date: o.date, env, branchPlan: o.branchPlan ?? null, branchUnread: o.branchUnread ?? null });
  if (o.sub === 'tick') return tick({ root, id: o.id, status: o.status, note: o.note, link: o.link });
  return check({ root, file: o.file });
}

if (isMain(import.meta)) await main(args => run(args, { root: rootOf(import.meta) }));

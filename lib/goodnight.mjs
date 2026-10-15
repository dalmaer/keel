// keel goodnight: the owner shapes tonight's plan (keel phase 74; the design
// is docs/research/2026-10-14-nightwatch.md, "/goodnight shapes it"; isocan's
// night watch, docs/projects/proactive-agent/design.md §4, gave the rules).
//
//   keel goodnight                        the opening: settled today, left open, the plan, things to try
//   keel goodnight add <suggestion-id>    one of the things to try, into the draft
//   keel goodnight add --title "<words>" [--kind k] [--measure m --bound n --better lower|higher] [--lane l] [--budget min] [--id x]
//   keel goodnight drop <id>              an item out of the draft
//   keel goodnight edit <id> [--title "<words>"] [--kind k] [--lane l] [--measure m --bound n --better b]
//   keel goodnight budget <id> <minutes>  what an item may spend
//   keel goodnight skip <path-or-id>      will not touch (an item of that id leaves the draft)
//   keel goodnight --yes                  "that's the plan": write it, shaped by the owner, and push it
//
// The draft is .keel/night/draft.json: tonight's plan as the owner is shaping
// it (schema 1, phase 73's shape), started from keel's default plan on the
// first change and written the way the plan is (safeWrite: never through a
// link). Only --yes writes .keel/night/plan.json and pushes it to the plan
// branch keel-night-plan: that push is the only summons. With no --yes the
// night runs keel's default plan, and nothing here is written or pushed
// except the draft by a shaping verb.
//
// The rules (isocan's, and phase 73's validator): at most five build items,
// counted with the robot's open PRs; a build item names its number first;
// willNotTouch holds paths and ids; anything merged or decided today is never
// an item; an item the owner wrote or edited keeps their words. A change that
// breaks one is refused, naming why, and the draft is left as it was.
//
// An accepted Loop finding that names a number is the robot's to build (phase
// 78): its suggestion, and add, put it in the draft's lane robot:pending (a
// draft's marker only; validatePlan refuses it in any plan), with a robot
// rubric drafted from the finding and checked as the robot checks one. Only
// --yes makes its issue, through ensureRobotIssue (idempotent: a second --yes
// recovers the same issue), and writes robot:#<n> in its place. A finding
// with no number, with the robot off, or whose drafted rubric the check
// refuses, stays triage, its reason in the item's note.
//
// "Today" is since the last plan: the commit time of the plan branch as this
// checkout last saw it (no fetch: the opening writes nothing), or the last 24
// hours, whichever is later.
//
// The push writes one commit of one file, .keel/night/plan.json, with no
// parent, and force-pushes it to refs/heads/keel-night-plan: git hash-object,
// mktree and commit-tree build it from the object store, so the working tree,
// the index, HEAD and every other branch are never touched; the refspec is a
// constant, so main never is. The branch is never merged.
//
// Exit: 0 shown, shaped or said; 1 the plan was written but the push failed
// (the night runs the default plan), or a Loop finding's robot issue was not
// verified (nothing written; --yes again recovers it); 2 usage, a refused change, or an input
// that cannot be read (nothing written). gh is KEEL_GH or gh.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  validatePlan, makePlan, safeWrite, writePlan, nightOf, planLine,
  NightPlanError, PLAN, PLAN_DIR, PLAN_BRANCH, PENDING_LANE, KINDS, MAX_BYTES,
} from '../practices/night/files/scripts/keel/night-plan.mjs';
import { cells } from '../practices/night/files/scripts/keel/lib.mjs';
import { validateRobotRubric, formatRobotRubric, robotRubricRefusal } from '../practices/climb/files/scripts/keel/robot-rubric.mjs';
import { robotPolicy } from '../practices/climb/files/scripts/keel/robot-policy.mjs';
import { robotGithub, robotRepo } from '../practices/night/files/scripts/keel/robot-delivery.mjs';
import { ensureRobotIssue, robotTargetPolicy, robotIssueInstance } from './robot-issue.mjs';
import { remoteOf } from './claim.mjs';

export const DRAFT = `${PLAN_DIR}/draft.json`;
export const SUGGESTIONS = 3;
export const VERBS = Object.freeze(['add', 'drop', 'edit', 'budget', 'skip']);
const DAY = 86_400_000;
const LINES = 64;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class GoodnightError extends NightPlanError {}
const refuse = (m, code = 2) => { throw new GoodnightError(m, code); };

const lastLine = s => String(s ?? '').trim().split('\n').filter(Boolean).pop() ?? 'failed';
const exec = (cmd, args, { cwd, env, input } = {}) => new Promise(done => {
  const child = execFile(cmd, args, { cwd, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    done(error ? { ok: false, why: error.code === 'ENOENT' ? `${cmd} is not installed` : lastLine(stderr || error.message), stdout: stdout ?? '' } : { ok: true, stdout });
  });
  if (input !== undefined) child.stdin.end(input);
});
const git = (root, args, env, input) => exec('git', ['-C', root, ...args], { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, input });
const clip = (s, n = 200) => { const t = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

async function configOf(root) {
  try { return JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8')); }
  catch (e) { return refuse(`cannot read .keel/keel.json: ${e.code ?? e.message}`); }
}
const repoArgs = config => (typeof config?.repo === 'string' && config.repo ? ['--repo', config.repo] : []);

async function ghList(root, env, args, what) {
  const r = await exec(env.KEEL_GH || 'gh', args, { cwd: root, env });
  if (!r.ok) throw new GoodnightError(`cannot read ${what}: ${r.why}`);
  let data;
  try { data = JSON.parse(r.stdout); } catch { throw new GoodnightError(`cannot read ${what}: gh did not print JSON`); }
  if (!Array.isArray(data)) throw new GoodnightError(`cannot read ${what}: gh did not print a JSON list`);
  return data;
}

// ---- since the last plan -----------------------------------------------------

/** { at, from }: the plan branch's commit time as last fetched, or 24 hours ago, whichever is later. */
export async function sinceOf(root, env, now) {
  const day = new Date(now.getTime() - DAY);
  const remote = await remoteOf(root, env);
  if (remote) {
    const r = await git(root, ['log', '-1', '--format=%cI', `refs/remotes/${remote}/${PLAN_BRANCH}`, '--'], env);
    const t = r.ok ? new Date(r.stdout.trim()) : null;
    if (t && Number.isFinite(t.getTime()) && t > day && t <= now) return { at: t.toISOString(), from: `the last plan (${PLAN_BRANCH})` };
  }
  return { at: day.toISOString(), from: 'the last 24 hours' };
}

// ---- settled today -----------------------------------------------------------

/** The PRs merged since `since`. */
async function mergedPrs(root, config, env, since) {
  const prs = await ghList(root, env, ['pr', 'list', ...repoArgs(config), '--state', 'merged', '--search', `merged:>=${since.slice(0, 10)}`, '--limit', '100', '--json', 'number,title,url,mergedAt,headRefName'], 'the merged PRs');
  return prs.filter(p => Number.isSafeInteger(p?.number) && Date.parse(p.mergedAt ?? '') >= Date.parse(since))
    .map(p => ({ number: p.number, title: clip(p.title, 160), url: p.url ?? null, head: String(p.headRefName ?? '') }))
    .sort((a, b) => a.number - b.number);
}

const statusIn = text => /^---\n[\s\S]*?^status:\s*([\w-]+)/m.exec(text ?? '')?.[1] ?? null;

/** Phases whose status moved since `since` (committed: HEAD against the last commit before it). */
async function movedPhases(root, env, since) {
  if (!existsSync(join(root, 'docs', 'phases'))) return [];
  const head = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], env);
  if (!head.ok) return [];
  const before = await git(root, ['rev-list', '-1', `--before=${since}`, 'HEAD'], env);
  const base = before.ok ? before.stdout.trim() : '';
  const changed = base
    ? await git(root, ['diff', '--name-only', base, 'HEAD', '--', 'docs/phases'], env)
    : await git(root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'docs/phases'], env);
  if (!changed.ok) throw new GoodnightError(`cannot read the phases moved today: ${changed.why}`);
  const out = [];
  for (const path of changed.stdout.split('\n').filter(p => /^docs\/phases\/\d+-[^/]+\.md$/.test(p)).sort()) {
    const now = await git(root, ['show', `HEAD:${path}`], env);
    if (!now.ok) continue; // removed or renamed away: the new name says it
    const to = statusIn(now.stdout);
    const was = base ? await git(root, ['show', `${base}:${path}`], env) : { ok: false };
    const from = was.ok ? statusIn(was.stdout) : null;
    // A phase written today only to be planned has not moved; one written and built the same day has.
    if (!to || from === to || (from === null && ['planned', 'designed'].includes(to))) continue;
    out.push({ phase: Number(/^docs\/phases\/0*(\d+)-/.exec(path)[1]), from, to, file: path });
  }
  return out;
}

/** Loop findings decided since `since` (the day it entered its decision, `since:`). */
async function decidedFindings(root, since) {
  const loop = await loopModule(root);
  if (!loop) return [];
  let findings;
  try { findings = loop.loadFindings(join(root, 'docs/loop')); } catch (e) { throw new GoodnightError(`cannot read the Loop findings (docs/loop): ${clip(e.message, 120)}`); }
  return findings.filter(f => !['untriaged', 'proposed'].includes(f.decision) && f.since && f.since >= since.slice(0, 10))
    .map(f => ({ slug: f.slug, title: clip(f.title, 160), decision: f.decision }));
}

const loopModule = async root => {
  const path = join(root, 'scripts/loop.mjs');
  if (!existsSync(path)) return null;
  try { return await import(pathToFileURL(path).href); } catch (e) { throw new GoodnightError(`cannot read the Loop findings: scripts/loop.mjs did not load (${clip(e.message, 120)})`); }
};

/** Settled today: { prs, phases, findings }. Throws when any of them cannot be read: the settled-today rule needs all three. */
export async function readSettled(root, config, env, since) {
  return { prs: await mergedPrs(root, config, env, since), phases: await movedPhases(root, env, since), findings: await decidedFindings(root, since) };
}

/** Why an item names something settled today, or null. */
export function namesSettled(item, settled) {
  const prs = new Set(settled.prs.map(p => p.number));
  const robot = new Set(settled.prs.map(p => /^keel\/robot-([1-9]\d*)$/.exec(p.head)?.[1]).filter(Boolean).map(Number));
  const phases = new Set(settled.phases.map(p => p.phase));
  const findings = new Set(settled.findings.map(f => f.slug));
  for (const ref of [item.source, item.lane]) {
    const loop = /^loop:(.+)$/.exec(ref ?? '')?.[1];
    if (loop && findings.has(loop)) return `the Loop finding ${loop} was decided today`;
    const issue = /^robot:#(\d+)$/.exec(ref ?? '')?.[1];
    if (issue && robot.has(Number(issue))) return `the robot's PR for #${issue} merged today`;
  }
  const slug = /^loop-(.+)$/.exec(item.id ?? '')?.[1];
  if (slug && findings.has(slug)) return `the Loop finding ${slug} was decided today`;
  for (const [, n] of String(item.title ?? '').matchAll(/#(\d+)\b/g)) if (prs.has(Number(n))) return `#${n} merged today`;
  for (const [, n] of String(item.title ?? '').matchAll(/\bphase\s+0*(\d+)\b/gi)) if (phases.has(Number(n))) return `phase ${n} moved today`;
  return null;
}

const settledLines = s => [
  ...s.prs.map(p => `merged #${p.number}: ${p.title}`),
  ...s.phases.map(p => `phase ${p.phase}: ${p.from ?? 'new'} → ${p.to}`),
  ...s.findings.map(f => `Loop finding ${f.slug}: ${f.decision}`),
];

// ---- left open ---------------------------------------------------------------

/**
 * The board's sources whose items can be the owner's (waits: owner) or are the
 * reviews: roadmap walks and ⚑ steps, loose-ends' ⚑ items and questions, a
 * review at its round limit, the health page's proposals, the lesson inbox and
 * an idle claim. The fleet and robot sources only give broken or time items,
 * which are not the owner's list.
 */
export const OWNER_SOURCES = Object.freeze(['roadmap', 'loose-ends', 'reviews', 'health', 'inbox', 'claims']);

/**
 * A source board() marks n/a because it does not apply here, not because a
 * read failed: board() gives the same state for both, so this is decided from
 * the project, the way board() decides it. The inbox is keel's own (board's
 * inboxItems answers n/a wherever .keel/keel.json is not `"keel": "self"`).
 * Every other n/a among OWNER_SOURCES is a gap: the claims source is listed
 * only where a remote exists and its n/a is a failed read; the health source
 * has no n/a but a thrown read; roadmap and loose-ends n/a are failures.
 */
export const expectedNa = (s, config) => s.source === 'inbox' && config?.keel !== 'self';

/**
 * Left open: the open PRs (gh), and from the board (lib/board.mjs, its
 * sources as it reads them) the unanswered reviews and the "yours" items.
 * A source that cannot be read is a gap, said; never an empty list.
 */
export async function readLeftOpen(root, config, env, deps = {}) {
  const gaps = [];
  let prs = [];
  try {
    prs = (await ghList(root, env, ['pr', 'list', ...repoArgs(config), '--state', 'open', '--limit', '100', '--json', 'number,title,url,headRefName,isDraft'], 'the open PRs'))
      .filter(p => Number.isSafeInteger(p?.number)).map(p => ({ number: p.number, title: clip(p.title, 160), url: p.url ?? null, draft: !!p.isDraft })).sort((a, b) => a.number - b.number);
  } catch (e) { gaps.push(`open PRs: ${e.message}`); }
  let reviews = [], yours = [];
  try {
    const b = deps.board ? await deps.board(root) : await (await import('./board.mjs')).board({ root }, { env });
    const items = b?.items ?? [];
    reviews = items.filter(i => i.source === 'reviews').map(i => ({ title: clip(i.title, 200), read: i.read ?? null, link: i.link ?? null }));
    yours = items.filter(i => i.waits === 'owner' && i.source !== 'reviews').map(i => ({ title: clip(i.title, 200), why: clip(i.why, 200), read: i.read ?? null, link: i.link ?? null }));
    // Coverage the board could not give is a gap, said in the opening and kept in leftOpen: a source that
    // feeds the reviews or the owner's items and was not read (n/a), one partly read (partial: a repo
    // failed), and reviews read with a repo skipped or a limit unread (state ok, with a why). Never a subset
    // shown as the whole. Quiet only where board() itself says a source does not apply here (expectedNa).
    for (const s of b?.sources ?? []) {
      if (!OWNER_SOURCES.includes(s.source)) continue;
      const label = s.source === 'reviews' ? 'unanswered reviews' : `the board's ${s.source}`;
      if (s.state === 'n/a') { if (!expectedNa(s, config)) gaps.push(`${label}: ${clip(s.why, 160)}`); }
      else if (s.state === 'partial' || (s.source === 'reviews' && s.why)) gaps.push(`${label}: partly read, only what was read is listed (${clip(s.why ?? 'a source failed', 200)})`);
    }
  } catch (e) { gaps.push(`the board: ${clip(e?.message ?? e, 160)}`); }
  return { prs, reviews, yours, gaps };
}

const leftOpenLines = l => [
  ...l.prs.map(p => `open PR #${p.number}${p.draft ? ' (draft)' : ''}: ${p.title}`),
  ...l.reviews.map(r => `review: ${r.title}`),
  ...l.yours.map(y => `yours: ${y.title}`),
  ...l.gaps.map(g => `not read: ${g}`),
];

// ---- the default plan and the things to try ------------------------------------

/**
 * Persona missed goals, read from each persona's newest review page
 * (docs/reviews/<date>-<persona>.md) rather than measured: the opening runs
 * no command and writes nothing (`keel persona run`, and the night, measure).
 * The same items persona.mjs's planCandidates makes from a run: a missed
 * goal is a build only for the climb job that measures it, else triage.
 */
export async function personaPageCandidates({ root, config, inputs }) {
  if (!(config?.practices ?? []).includes('personas')) return [];
  const persona = await import('../practices/personas/files/scripts/keel/persona.mjs');
  let personas;
  try { personas = (await persona.readPersonas(root)).map(p => p.persona); } catch (e) { throw new GoodnightError(`cannot read the personas: ${clip(e.message, 160)}`); }
  if (!personas.length) return [];
  const pages = existsSync(join(root, persona.REVIEWS)) ? (await readdir(join(root, persona.REVIEWS))).sort() : [];
  const out = [];
  for (const p of personas) {
    const page = pages.filter(n => n.endsWith(`-${p.name}.md`) && /^\d{4}-\d{2}-\d{2}-/.test(n)).pop();
    if (!page) continue;
    const text = await readFile(join(root, persona.REVIEWS, page), 'utf8');
    const rows = text.split('\n').filter(l => /^\|/.test(l)).map(cells);
    const goals = [];
    for (const g of p.goals) {
      const row = rows.find(r => r[0]?.replaceAll('\\|', '|') === g.name && r[3] === '**missed**');
      const value = row ? Number(/^-?\d+(?:\.\d+)?/.exec(row[2])?.[0]) : NaN;
      if (row && Number.isFinite(value)) goals.push({ ...g, state: 'missed', value, measure: persona.measureId(p.name, g) });
    }
    out.push(...persona.planCandidates({ name: p.name, goals }, { jobs: inputs?.jobs ?? {} }));
  }
  return out;
}

/**
 * The project's enabled climb jobs and their measures: climb.mjs's own
 * climbConfigOf (the jobs .keel/keel.json's "climb".jobs names), never the
 * whole JOBS catalogue. {} with `why` when climb is off, not installed, or its
 * config is refused: then no climb lane is one a pass builds.
 */
export async function climbJobs(root, config) {
  const none = why => Object.defineProperty({}, 'why', { value: why });
  if (config?.climb === undefined) return none('climb is off here (.keel/keel.json has no "climb")');
  if (!existsSync(join(root, 'scripts/keel/climb.mjs'))) return none('climb is not installed here (no scripts/keel/climb.mjs)');
  let climb, c;
  try { climb = await import(pathToFileURL(join(root, 'scripts/keel/climb.mjs')).href); } catch (e) { return none(`scripts/keel/climb.mjs did not load (${clip(e.message, 120)})`); }
  try { c = climb.climbConfigOf(config); } catch (e) { return none(clip(e.message, 200)); }
  if (!c) return none('climb is off here');
  return Object.fromEntries(c.jobs.filter(j => climb.JOBS?.[j]).map(j => [j, climb.JOBS[j]]));
}

/** Each item whose lane names a climb job the project does not enable, as a refusal. */
export function climbLaneProblems(plan, jobs) {
  return plan.items.filter(i => /^climb:/.test(i.lane) && !Object.hasOwn(jobs, i.lane.slice(6))).map(i =>
    `"${i.id}" is in lane ${i.lane}, a climb job this project does not run (${jobsHere(jobs)})`);
}
const jobFor = (jobs, measure) => Object.entries(jobs).find(([, j]) => (j?.measures ?? []).includes(measure))?.[0] ?? null;
const jobsHere = jobs => (Object.keys(jobs).length ? `its climb jobs: ${Object.keys(jobs).map(j => `climb:${j}`).join(', ')}` : jobs.why ?? 'no climb jobs');

/** A number a text names: the first `measure` in backticks the health page bounds. */
function numberIn(texts, rows) {
  for (const t of texts) {
    for (const [, id] of String(t ?? '').matchAll(/`([a-z][a-z0-9_]*)`/g)) {
      const row = rows.find(r => r.id === id && Number.isFinite(r.bound));
      if (row) return { measure: row.id, bound: row.bound, better: row.better };
    }
  }
  return null;
}

// ---- a Loop finding, built by the robot (phase 78) ------------------------------

/** The files a finding cites: Loop's own reference list (`- \`path\``) and any path:line in its text; plain repo paths only. */
export function citedFiles(f) {
  const text = [f.body, f.note].filter(Boolean).join('\n');
  const found = [...[...text.matchAll(/^- `([^`\n]+)`\s*$/gm)].map(m => m[1]), ...[...text.matchAll(/[\w.@/-]+\.[A-Za-z0-9]+:\d+/g)].map(m => m[0])];
  const plain = p => p.length <= 300 && !p.startsWith('/') && !p.split('/').includes('..') && !/^[a-z]+:\/\//i.test(p) && !/[\s<>]/.test(p);
  return [...new Set(found.filter(plain))].slice(0, 16);
}

/**
 * A robot rubric drafted from an accepted Loop finding and its number, pure:
 * the problem in the finding's words (its title, what Loop said, the owner's
 * note), the number and its bound as the acceptance, the files it cites as
 * the one change, and no prerequisites or owner blockers. A finding that
 * cites no file drafts an empty change, which the rubric check refuses.
 */
export function loopRubric(f, number) {
  const sign = number.better === 'higher' ? 'at least' : 'at most';
  const says = /^> \*\*Loop says\*\*[^:\n]*: (.+)$/m.exec(f.body ?? '')?.[1];
  const files = citedFiles(f);
  return {
    version: 1,
    problem: clip([`${f.title}.`, says && `Loop says: ${says}`, f.note && `Accepted: ${f.note}`].filter(Boolean).join(' '), 3900),
    reproduction: `The night measures \`${number.measure}\` (node scripts/keel/improve.mjs --report) and writes it on the health page; the Loop finding docs/loop/${f.slug}.md names it.`,
    acceptance: `\`${number.measure}\` is ${sign} ${number.bound}, as the night measures it, and no other measure on the health page moves the wrong way.`,
    change: files.length ? clip(`Change only what the finding cites: ${files.join(', ')}.`, 3900) : '',
    prerequisites: [],
    ownerBlockers: [],
  };
}

/**
 * Whether an accepted Loop finding can be a robot build tonight: { ok, number,
 * rubric } or { ok: false, number, why }. It needs a number the health page
 * bounds, the robot on (else no pass would build it), and a drafted rubric
 * the robot's own rubric check accepts (robotRubricRefusal). Pure.
 */
export function loopDraft({ finding, rows, robotOn, number = numberIn([finding.note, finding.title, finding.body], rows) }) {
  if (!number) return { ok: false, number: null, why: 'it names no number the health page bounds (a measure in backticks, like `slow_tests`), so it stays triage: a build names its number first' };
  if (!robotOn) return { ok: false, number, why: 'the robot is off here (.keel/keel.json "robot": { "on": true, "budgetMinutes": n } is the owner\'s to set), so no pass would build it; it stays triage' };
  const checked = validateRobotRubric(loopRubric(finding, number));
  const refusal = checked.ok ? robotRubricRefusal(formatRobotRubric(checked.rubric)) : checked.problems.map(p => `${p.field}: ${p.message}`).join('; ');
  if (refusal) return { ok: false, number, why: `the robot's rubric check refuses the rubric drafted from it (${clip(refusal, 300)}), so it stays triage` };
  return { ok: true, number, rubric: checked.rubric };
}

/** The issue's title for a Loop finding's item: its title, without markup, as the issue rubric allows. */
const issueTitle = t => clip(String(t).replace(/[<>]/g, ''), 240);

/**
 * Up to SUGGESTIONS things to try, none already in the plan and none naming
 * something settled today: personas' missed goals the plan did not admit,
 * accepted Loop findings (a build for the robot when loopDraft allows it, in
 * the draft's PENDING_LANE until --yes makes its issue; else triage, saying
 * why), and the health page's proposal as a build for the climb job that
 * measures it. Builds come first.
 */
export async function suggestionsFor({ root, config, plan, personaItems, health, settled }) {
  const taken = new Set(plan.items.map(i => i.id));
  const lanes = new Set(plan.items.filter(i => i.kind === 'build').map(i => i.lane));
  const rows = health?.rows ?? [];
  const out = [], triage = [];
  for (const c of personaItems.filter(c => c.kind === 'build')) out.push({ ...c, why: 'a persona missed its goal' });
  const loop = await loopModule(root);
  if (loop) {
    const robotOn = robotPolicy(config).enabled;
    for (const f of loop.loadFindings(join(root, 'docs/loop')).filter(f => f.decision === 'accepted')) {
      const d = loopDraft({ finding: f, rows, robotOn });
      if (d.ok) out.push({ id: `loop-${f.slug}`, title: clip(`Loop: ${f.title}`, 300), kind: 'build', source: `loop:${f.slug}`, number: d.number, lane: PENDING_LANE, why: `an accepted Loop finding that names \`${d.number.measure}\`: the robot builds it, its issue drafted with a rubric and made by keel goodnight --yes` });
      else triage.push({ id: `loop-${f.slug}`, title: clip(`Triage the Loop finding: ${f.title}`, 300), kind: 'triage', source: `loop:${f.slug}`, number: d.number, lane: 'loop', result: { note: clip(`Not a build: ${d.why}.`, 1000) }, why: d.why });
    }
  }
  const p = health?.proposal;
  if (p) {
    const job = jobFor(await climbJobs(root, config), p.id), number = numberIn([`\`${p.id}\``], rows);
    if (job && number && !lanes.has(`climb:${job}`)) out.push({ id: `fix-${p.id.replace(/_/g, '-')}`, title: clip(`Back within bound: ${p.id} (the ${health.date} proposal)`, 300), kind: 'build', source: `health:${p.id}`, number, lane: `climb:${job}`, why: 'the health page\'s proposal' });
  }
  const seen = new Set();
  return [...out, ...triage].filter(s => !taken.has(s.id) && !seen.has(s.id) && seen.add(s.id) && !(settled && namesSettled(s, settled))).slice(0, SUGGESTIONS);
}

/**
 * At --yes, each draft build in PENDING_LANE becomes the robot's issue: the
 * finding is read again (still accepted, its rubric drafted again from the
 * item's number and checked), and ensureRobotIssue makes it, idempotently (a
 * durable intent in .keel/robot-issues; a second --yes recovers the same
 * issue, never a second). The item's lane becomes robot:#<n>. Any refusal, or
 * an issue not verified, stops --yes before the plan is written. Returns
 * { plan, issues: [{ id, number, url, state }] }.
 */
export async function fileLoopIssues({ root, config, plan, rows }, { github = robotGithub } = {}) {
  const pending = plan.items.filter(i => i.lane === PENDING_LANE);
  if (!pending.length) return { plan, issues: [] };
  const repo = robotRepo(config?.repo) ? config.repo.toLowerCase() : null;
  if (!repo) refuse('refused: a Loop finding\'s robot issue needs the project\'s repo (.keel/keel.json "repo": "owner/name"); nothing was written');
  const loop = await loopModule(root);
  const findings = loop ? loop.loadFindings(join(root, 'docs/loop')) : [];
  const policy = await robotTargetPolicy({ root, repo, github });
  const issues = [], lanes = new Map();
  for (const it of pending) {
    const slug = /^loop:(.+)$/.exec(it.source)?.[1];
    const f = slug && findings.find(x => x.slug === slug);
    if (!f || f.decision !== 'accepted') refuse(`refused: "${it.id}" waits for a robot issue, and ${slug ? `the Loop finding ${slug} is ${f ? f.decision : 'not in docs/loop'}` : 'its source names no Loop finding'}; drop it or make it triage. Nothing was written`);
    const d = loopDraft({ finding: f, rows, robotOn: policy.enabled === true, number: it.number });
    if (!d.ok) refuse(`refused: "${it.id}": ${d.why}. Nothing was written`);
    const r = await ensureRobotIssue({ repo, title: issueTitle(it.title), rubric: d.rubric, policy, subjectKey: `loop:${slug}`, instanceId: robotIssueInstance('keel-goodnight-loop', repo, slug), yes: true, stateDir: join(root, '.keel/robot-issues'), github });
    if (!['created', 'recovered'].includes(r.state) || !r.issue) refuse(`the robot issue for "${it.id}" is ${r.state}${r.issue ? ` (#${r.issue.number})` : ''}: ${r.reasons.join('; ') || 'not verified'}. Nothing was written; keel goodnight --yes again recovers it (an uncertain write is never repeated)`, 1);
    issues.push({ id: it.id, number: r.issue.number, url: r.issue.url, state: r.state });
    lanes.set(it.id, `robot:#${r.issue.number}`);
  }
  return { plan: { ...plan, items: plan.items.map(i => (lanes.has(i.id) ? { ...i, lane: lanes.get(i.id) } : i)) }, issues };
}

// ---- the draft -----------------------------------------------------------------

async function readJson(root, rel) {
  if (!existsSync(join(root, rel))) return null;
  const raw = await readFile(join(root, rel), 'utf8');
  if (raw.length > MAX_BYTES) refuse(`${rel} is larger than ${MAX_BYTES} bytes`);
  try { return JSON.parse(raw); } catch { return refuse(`${rel} is not JSON; remove it to start again from the default plan`); }
}

/** Tonight's draft: { draft } when there is one for `night`, { stale } when it is another night's, {} when none. */
export async function readDraft(root, night) {
  const d = await readJson(root, DRAFT);
  if (!d) return {};
  if (d.date !== night) return { stale: String(d.date) };
  const v = validatePlan(d, { draft: true });
  if (!v.ok) refuse(`${DRAFT} is refused: ${v.problems.join('; ')}; remove it to start again from the default plan`);
  return { draft: d };
}

const writeDraft = async (root, plan) => {
  await safeWrite(root, `${PLAN_DIR}/.gitignore`, '*\n');
  await safeWrite(root, DRAFT, `${JSON.stringify(plan, null, 2)}\n`);
};

const item = ({ id, title, kind, source, number = null, lane, budget = null, result = null }) => ({ id, title, kind, source, number, lane, budget, status: 'planned', result });

/**
 * Everything the opening and the verbs read: tonight's night, the default
 * plan (phase 73's, with personas read from their pages), the draft, what was
 * settled and what is left open, the robot's open PRs.
 */
async function readNight(root, env, now, deps, { opening = true } = {}) {
  const config = await configOf(root);
  const night = nightOf(now);
  const since = await sinceOf(root, env, now);
  const settled = await readSettled(root, config, env, since.at);
  let personaItems = [];
  const made = await makePlan({ root, date: night, env, sources: [async a => (personaItems = await personaPageCandidates(a))] });
  const open = made.inputs.robot?.open ?? [];
  // Settled today is never an item: the default plan's are left out here, saying so.
  const dropped = made.plan.items.filter(i => namesSettled(i, settled));
  const base = { ...made.plan, items: made.plan.items.filter(i => !dropped.includes(i)), leftOpen: [...made.plan.leftOpen, ...dropped.map(i => `${i.id}: left out, ${namesSettled(i, settled)}`)].slice(0, LINES) };
  const { draft, stale } = await readDraft(root, night);
  const left = opening ? await readLeftOpen(root, config, env, deps) : null;
  return { config, night, since, settled, base, draft, stale, open, personaItems, health: made.inputs.health, left };
}

// ---- the verbs -------------------------------------------------------------------

/** Apply one shaping verb to `plan` (pure but for the suggestions it is handed). Returns { plan, said }. */
export function shape(plan, o, { settled, suggestions = [], jobs = {} }) {
  const items = plan.items;
  const find = id => { const at = items.findIndex(i => i.id === id); if (at < 0) refuse(`no item "${id}" in tonight's draft; its items: ${items.map(i => i.id).join(', ') || 'none'}`); return at; };
  const settledCheck = it => { const why = namesSettled(it, settled); if (why) refuse(`refused: "${it.id}" names something settled today (${why}); settled today is never an item`); };
  const numberOf = (was = null) => {
    if (o.measure === undefined && o.bound === undefined && o.better === undefined) return was;
    const n = { measure: o.measure ?? was?.measure, bound: o.bound === undefined ? was?.bound : Number(o.bound), better: o.better ?? was?.better ?? 'lower' };
    if (!n.measure || !Number.isFinite(n.bound)) refuse('a number is --measure <id> --bound <number> [--better lower|higher]');
    return n;
  };
  if (o.kind !== undefined && !KINDS.includes(o.kind)) refuse(`--kind is ${KINDS.join(', ')}`);
  const budgetOf = v => { const m = Number(v); if (!(Number.isFinite(m) && m > 0)) refuse(`a budget is minutes above 0 (got ${JSON.stringify(v)})`); return { minutes: m }; };
  let next = plan, said;
  if (o.verb === 'add') {
    let it;
    if (o.target) {
      const s = suggestions.find(x => x.id === o.target);
      if (!s) refuse(`no thing to try named "${o.target}"; tonight's: ${suggestions.map(x => x.id).join(', ') || 'none'} (or add --title "<words>")`);
      it = item({ ...s, ...(o.title !== undefined ? { title: o.title } : {}), ...(o.budget !== undefined ? { budget: budgetOf(o.budget) } : {}) });
    } else {
      if (o.title === undefined) refuse('keel goodnight add <suggestion-id>, or add --title "<words>"');
      const number = numberOf();
      const kind = o.kind ?? (number ? 'build' : 'review');
      const job = number ? jobFor(jobs, number.measure) : null;
      const lane = o.lane ?? (kind === 'build' ? (job ? `climb:${job}` : refuse(`refused: a build item names the pass that builds it: --lane climb:<job> or robot:#<issue>; no climb job here measures ${number?.measure ?? 'an item with no number'} (${jobsHere(jobs)})`)) : 'night');
      const id = o.id ?? (String(o.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'item');
      if (!ID.test(id)) refuse(`an id is lowercase letters, digits and dashes (got "${id}")`);
      it = item({ id, title: o.title, kind, source: 'owner', number, lane, budget: o.budget !== undefined ? budgetOf(o.budget) : null });
    }
    if (items.some(i => i.id === it.id)) refuse(`"${it.id}" is already in tonight's draft`);
    if (plan.willNotTouch.includes(it.id)) refuse(`"${it.id}" is on will-not-touch tonight`);
    settledCheck(it);
    next = { ...plan, items: [...items, it] };
    said = `added ${it.id}`;
  } else if (o.verb === 'drop') {
    const at = find(o.target);
    next = { ...plan, items: items.filter((_, i) => i !== at) };
    said = `dropped ${o.target}`;
  } else if (o.verb === 'edit') {
    const at = find(o.target);
    const was = items[at];
    const it = { ...was, ...(o.title !== undefined ? { title: o.title } : {}), ...(o.kind !== undefined ? { kind: o.kind } : {}), ...(o.lane !== undefined ? { lane: o.lane } : {}), number: numberOf(was.number), ...(o.budget !== undefined ? { budget: budgetOf(o.budget) } : {}) };
    // An item made (or kept) a build in lane night, with no --lane, takes its pass the way add does: the climb job that measures its number, or refused.
    if (it.kind === 'build' && it.lane === 'night' && o.lane === undefined && it.number) {
      const job = jobFor(jobs, it.number.measure);
      it.lane = job ? `climb:${job}` : refuse(`refused: a build item names the pass that builds it: --lane climb:<job> or robot:#<issue> (lane night only measures); no climb job here measures ${it.number.measure} (${jobsHere(jobs)})`);
    }
    settledCheck(it);
    next = { ...plan, items: items.map((x, i) => (i === at ? it : x)) };
    said = `edited ${o.target}`;
  } else if (o.verb === 'budget') {
    const at = find(o.target);
    next = { ...plan, items: items.map((x, i) => (i === at ? { ...x, budget: budgetOf(o.minutes) } : x)) };
    said = `${o.target}: ${Number(o.minutes)} minutes`;
  } else if (o.verb === 'skip') {
    const what = o.target;
    if (plan.willNotTouch.includes(what)) refuse(`"${what}" is already on will-not-touch tonight`);
    next = { ...plan, willNotTouch: [...plan.willNotTouch, what], items: items.filter(i => i.id !== what) };
    said = `will not touch ${what}${next.items.length < items.length ? ' (its item left the draft)' : ''}`;
  }
  return { plan: { ...next, shapedBy: 'owner' }, said };
}

/** The plan's text: its items, will-not-touch and left-open lines. */
const planText = plan => [
  ...plan.items.map(planLine),
  ...plan.items.filter(i => i.number || i.budget).map(i => `    ${i.id}: ${[i.number && `\`${i.number.measure}\` ${i.number.better === 'higher' ? '≥' : '≤'} ${i.number.bound}`, i.budget && `${i.budget.minutes} min`].filter(Boolean).join(', ')}`),
  ...plan.willNotTouch.map(w => `  will not touch: ${w}`),
  ...plan.leftOpen.map(l => `  left open: ${l}`),
];

function openingText(n, plan, suggestions, from) {
  const list = (lines, none) => (lines.length ? lines.map(l => `  ${l}`) : [`  ${none}`]);
  return [
    `Goodnight. Tonight is the night of ${n.night} (UTC); today is since ${n.since.at.slice(0, 16).replace('T', ' ')} UTC (${n.since.from}).`, '',
    'Settled today', ...list(settledLines(n.settled), 'nothing merged, moved or decided'), '',
    'Left open', ...list(leftOpenLines(n.left), 'nothing'), '',
    `Tonight's plan (${from})`, ...planText(plan), '',
    'Things to try (keel goodnight add <id>)', ...list(suggestions.map(s => `${s.id.padEnd(22)} ${s.kind.padEnd(7)} ${s.title} — ${s.why}`), 'nothing to suggest'), '',
    `Shape it: keel goodnight add|drop|edit|budget|skip. Say "that's the plan" with keel goodnight --yes: it writes ${PLAN} and pushes it to ${PLAN_BRANCH}. Without --yes the night runs keel's default plan.`,
  ].join('\n');
}

/** The plan as it is said: the draft (or the default plan), with settled today and left open filled in, shaped by the owner. */
function finalPlan(n, start) {
  const fit = lines => lines.slice(0, LINES).map(l => clip(l, 480));
  return { ...start, shapedBy: 'owner', settledToday: fit(settledLines(n.settled)), leftOpen: fit([...start.leftOpen, ...leftOpenLines(n.left)]) };
}

/** One commit, one file, no parent, force-pushed to the plan branch: never the working tree, never another branch. */
export async function pushPlan(root, plan, env, remote) {
  const step = async (args, input, what) => {
    const r = await git(root, args, env, input);
    if (!r.ok) refuse(`the plan was written to ${PLAN} but not pushed (${what}: ${r.why}); tonight runs keel's default plan`, 1);
    return r.stdout.trim();
  };
  const blob = await step(['hash-object', '-w', '--stdin'], `${JSON.stringify(plan, null, 2)}\n`, 'hash-object');
  const night = await step(['mktree'], `100644 blob ${blob}\tplan.json\n`, 'mktree');
  const keel = await step(['mktree'], `040000 tree ${night}\tnight\n`, 'mktree');
  const tree = await step(['mktree'], `040000 tree ${keel}\t.keel\n`, 'mktree');
  const commit = await step(['commit-tree', tree, '-m', `keel goodnight: the plan for the night of ${plan.date}, shaped by the owner`], undefined, 'commit-tree');
  const ref = `refs/heads/${PLAN_BRANCH}`;
  await step(['push', '--quiet', '--force', remote, `${commit}:${ref}`], undefined, `git push ${remote} ${PLAN_BRANCH}`);
  const there = await git(root, ['ls-remote', remote, ref], env);
  if (!there.ok || there.stdout.split('\t')[0].trim() !== commit) refuse(`the plan was written to ${PLAN}, and ${remote} does not show it on ${PLAN_BRANCH} (${there.ok ? 'another commit is there' : there.why}); tonight may run keel's default plan`, 1);
  return { remote, branch: PLAN_BRANCH, commit };
}

// ---- the command -------------------------------------------------------------------

const USAGE = 'keel goodnight [add <suggestion-id> | add --title "<words>" … | drop <id> | edit <id> … | budget <id> <minutes> | skip <path-or-id> | --yes] [--json]';
const VALUED = ['--title', '--kind', '--measure', '--bound', '--better', '--lane', '--budget', '--id'];

export function parseArgs(args) {
  const o = { yes: false };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') continue;
    if (a === '--yes') { o.yes = true; continue; }
    if (VALUED.includes(a)) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) refuse(`${a} needs a value`);
      o[a.slice(2)] = v; i++; continue;
    }
    if (a.startsWith('--')) refuse(`unexpected argument: ${a}; ${USAGE}`);
    positional.push(a);
  }
  const [verb, ...rest] = positional;
  if (verb !== undefined && !VERBS.includes(verb)) refuse(`unknown goodnight verb "${verb}"; ${USAGE}`);
  if (o.yes && verb) refuse('--yes says the plan as it stands; shape it first, then keel goodnight --yes');
  const flags = VALUED.map(f => f.slice(2)).filter(k => o[k] !== undefined);
  const want = { add: [0, 1], drop: [1, 1], edit: [1, 1], budget: [2, 2], skip: [1, 1] }[verb] ?? [0, 0];
  if (rest.length < want[0] || rest.length > want[1]) refuse(`${rest.length > want[1] ? `unexpected argument: ${rest[want[1]]}` : `keel goodnight ${verb} needs ${verb === 'budget' ? '<id> <minutes>' : verb === 'skip' ? '<path-or-id>' : '<id>'}`}; ${USAGE}`);
  if (!['add', 'edit'].includes(verb) && flags.length) refuse(`--${flags[0]} goes with add or edit`);
  if (verb === 'edit' && !flags.length) refuse('keel goodnight edit <id> needs a change: --title, --kind, --lane, --measure/--bound/--better or --budget');
  if (o.better !== undefined && !['lower', 'higher'].includes(o.better)) refuse('--better is lower or higher');
  if (o.title !== undefined && (!o.title.trim() || o.title.length > 300 || /[\u0000-\u001f\u007f]/.test(o.title))) refuse('--title is one line of text, at most 300 characters');
  if (verb === 'skip' && (rest[0].length > 500 || /[\u0000-\u001f\u007f]/.test(rest[0]) || !rest[0].trim())) refuse('skip takes one path or id, one line, at most 500 characters');
  return { ...o, verb, target: rest[0], minutes: rest[1] };
}

/** keel goodnight, every form. deps: { now, board, github } (tests). */
export async function goodnight({ root, args = [], env = process.env }, deps = {}) {
  const o = parseArgs(args);
  const now = deps.now ?? new Date();
  const n = await readNight(root, env, now, deps, { opening: !o.verb });
  const start = n.draft ?? { ...n.base, shapedBy: 'owner' };
  const from = n.draft ? `the owner's draft, ${DRAFT}` : `keel's default plan${n.stale ? `; the draft in ${DRAFT} was for ${n.stale}, so tonight starts again` : ''}`;
  const robot = n.config.robot === undefined ? [] : n.open;
  const jobs = await climbJobs(root, n.config);
  // A draft may hold a build waiting for its robot issue (PENDING_LANE); the plan --yes writes never does.
  const check = (plan, { draft = true } = {}) => {
    const problems = [...validatePlan(plan, { openRobotPrs: robot, draft }).problems, ...climbLaneProblems(plan, jobs)];
    if (problems.length) refuse(`refused: ${problems.join('; ')}`);
  };

  if (o.verb) {
    const suggestions = await suggestionsFor({ root, config: n.config, plan: start, personaItems: n.personaItems, health: n.health, settled: n.settled });
    const { plan, said } = shape(start, o, { settled: n.settled, suggestions, jobs });
    check(plan);
    await writeDraft(root, plan);
    return { data: { ok: true, night: n.night, said, draft: DRAFT, plan }, text: [`${said}. Tonight's draft (${DRAFT}):`, ...planText(plan)].join('\n') };
  }

  if (o.yes) {
    const said = finalPlan(n, start);
    for (const it of said.items) { const why = namesSettled(it, n.settled); if (why) refuse(`refused: "${it.id}" names something settled today (${why}); drop it, then say the plan again`); }
    check(said);
    const remote = await remoteOf(root, env);
    if (!remote) refuse(`no git remote here: the night reads the plan from ${PLAN_BRANCH} on the remote; nothing was written`);
    // A Loop finding's robot issue is made here and nowhere before (phase 78), once the rest of the plan holds.
    const { plan, issues } = await fileLoopIssues({ root, config: n.config, plan: said, rows: n.health?.rows ?? [] }, deps);
    check(plan, { draft: false });
    if (issues.length) await writeDraft(root, plan);
    await writePlan(root, plan);
    const pushed = await pushPlan(root, plan, env, remote);
    const made = issues.map(i => `  ${i.id}: robot issue #${i.number}, ${i.state} (${i.url})`);
    return { data: { ok: true, night: n.night, path: PLAN, pushed, issues, plan }, text: [`That's the plan for the night of ${n.night}: written to ${PLAN} and pushed to ${remote}/${PLAN_BRANCH} (${pushed.commit.slice(0, 7)}), shaped by the owner.`, ...made, ...planText(plan)].join('\n') };
  }

  const suggestions = await suggestionsFor({ root, config: n.config, plan: start, personaItems: n.personaItems, health: n.health, settled: n.settled });
  return {
    data: { ok: true, night: n.night, since: n.since, settled: n.settled, leftOpen: n.left, plan: start, from: n.draft ? 'draft' : 'default', staleDraft: n.stale ?? null, suggestions },
    text: openingText(n, start, suggestions, from),
  };
}

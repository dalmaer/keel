// keel fleet: one look tells the owner which projects are behind, red, or
// teaching something (design §7). It runs on keel only, reads GitHub through
// gh, and changes nothing.
//
// fleet.json at keel's root lists the repos: [{ repo, kind, role, note }].
// role `managed` is a project keel manages (or will: unadopted is shown as
// such); role `source` is a repo keel learns from and never manages.
//
// Per managed repo, every gh call runs at once (one process each):
//   repos/<r>                       default branch; a failure here makes the row unreadable
//   contents/.keel/keel.json        the config; 404 → not adopted
//   contents/docs/health            newest <date>.md; older than two days → silent
//                                   (a config naming another `health` dir is
//                                   read there instead, one more call)
//   run list                        the gate workflow's newest completed run on the default branch
//   pr list                         open machine PRs, by prefix (keel/, keel-night/, renovate/)
//   contents/docs/lessons.md, contents/.keel/sent.json
//                                   lesson rows whose fingerprint is not in sent;
//                                   a config naming another `lessons` path is
//                                   read there instead (one more call)
// The practice is compared with this CLI's; migrations the project has not
// recorded are listed as unrecorded (fleet stays fast: it never asks them).
// fleet update asks each applies() over a read-only remote view of the default
// branch (read/exists/list through the contents API, cached per run): only
// those that apply are pending; one whose reads failed is "possibly pending",
// with why. The CI cell's gate workflow is the one named `check`; else a
// push-triggered workflow with runs on the default branch whose YAML runs the configured
// check (default `npm run check`) or `npm test`; else a name match. It says
// which rule chose it.
// Per source repo: each practice pinned to it, and whether its head moved
// (the same check keel learn makes).
//
// A failure is shown where it happened, as `unreadable: <why>`, never as
// healthy, and never stops the other rows. Exit 0 when the table was drawn;
// what needs a person is in `needs`. gh is process.env.KEEL_GH || 'gh'.
//
// keel fleet update [--yes] is the one verb here that writes, and it writes
// only through each project's own update PR (design §6, "Projects run on
// their own": changes go out from keel; a project never pulls keel). From the
// same reads, every adopted project behind this CLI or with an unrecorded
// migration that applies (or could not be asked); the rest are listed as not
// planned, with why. Without --yes: each, and the PR it would open (exit 3; 0 when
// none). With --yes, one at a time: gh repo clone into a temp dir with the
// owner's own gh login, a git identity only if none is configured, the
// project's install (its .keel/keel.json `setup` under bash -e in the gate env;
// else npm ci when there is a lockfile; else nothing), then keel update --yes --no-self-update there,
// which pushes keel/update-v<version> and opens the PR. One repo failing never
// stops the others; each says its PR or its error (exit 1 if any failed).
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, posix } from 'node:path';
import { findRoot } from './project.mjs';
import { lessonsPath } from './practices.mjs';
import { parseLessons, lessonFingerprint, SENT } from './lessons.mjs';
import { sourcePins, headApi, atPin } from './learn.mjs';
import { load as loadMigrations, compareVersions, parseVersion, taken, untaken } from './migrations.mjs';
import { MACHINE_PREFIXES, HEALTH } from './improve.mjs';
import { update as keelUpdate, BRANCH } from './update.mjs';
import { gateEnv, healthDirOf } from '../practices/night/files/scripts/keel/lib.mjs';

export const FLEET = 'fleet.json';
export const ROLES = ['managed', 'source'];
export const KINDS = ['static', 'node', 'web', 'other'];
export const SILENT_DAYS = 2;
const DAY = 86_400_000;

export class FleetError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

// ---- gh, in parallel ---------------------------------------------------------

class GhError extends Error {
  constructor(message, notFound) { super(message); this.notFound = notFound; }
}

/** Run gh; resolve its stdout, or reject with a GhError (notFound for HTTP 404). */
function gh(args, env) {
  const bin = env.KEEL_GH || 'gh';
  return new Promise((done, fail) => {
    execFile(bin, args, { env, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return done(stdout);
      const text = `${stderr ?? ''}\n${stdout ?? ''}`;
      const notFound = /HTTP 404|Not Found/.test(text);
      const why = String(stderr || error.message).trim().split('\n').filter(Boolean).pop() ?? 'failed';
      fail(new GhError(why.replace(/^gh: /, ''), notFound));
    });
  });
}
const ghJson = async (args, env) => JSON.parse(await gh(args, env));
/** A file's text through the contents API, or null on 404. */
async function contents(repo, path, env) {
  try {
    const f = await ghJson(['api', `repos/${repo}/contents/${path}`], env);
    if (Array.isArray(f) || f?.type !== 'file') throw new GhError(`${path} is not a file`, false);
    return Buffer.from(f.content ?? '', f.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  } catch (e) {
    if (e.notFound) return null;
    throw e;
  }
}
/** A directory's entry names, or null on 404. */
async function listing(repo, path, env) {
  try {
    const d = await ghJson(['api', `repos/${repo}/contents/${path}`], env);
    if (!Array.isArray(d)) throw new GhError(`${path} is not a directory`, false);
    return d.map(e => e.name);
  } catch (e) {
    if (e.notFound) return null;
    throw e;
  }
}
/** { ok: value } or { error: why } — so one failure never sinks the others. */
const settle = p => p.then(ok => ({ ok }), e => ({ error: e.message }));

/**
 * One path at `ref` through the contents API, cached for the run:
 * { file: text } | { dir: [{name, type, path}] } | { none: true } (404).
 * Any other failure rejects, and is never read as absence.
 */
function remoteEntry(repo, ref, path, { env, cache }) {
  const key = `${repo}@${ref}:${path}`;
  if (!cache.has(key)) {
    const url = `repos/${repo}/contents${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
    cache.set(key, ghJson(['api', url], env).then(f => {
      if (Array.isArray(f)) return { dir: f };
      if (f?.type !== 'file') return { file: null }; // a submodule or symlink reads as no text
      if (f.encoding !== 'base64') throw new GhError(`${path}: the contents API gave no content (encoding ${f.encoding ?? 'none'}; too large?)`, false);
      return { file: Buffer.from(f.content ?? '', 'base64').toString('utf8') };
    }, e => {
      if (e.notFound) return { none: true };
      throw new GhError(`${path}: ${e.message}`, false);
    }));
  }
  return cache.get(key);
}

/**
 * The read-only project a migration's applies() is asked over, backed by the
 * default branch on GitHub: { root: null, config, read, exists, list }, as
 * migrations' view() is locally (read → text or null, list → names or []).
 */
export function remoteView(repo, ref, config, deps) {
  const check = path => {
    const p = typeof path === 'string' ? posix.normalize(path).replace(/\/$/, '') : '';
    if (!p || p.startsWith('/') || p === '..' || p.startsWith('../')) throw new Error(`a migration may only read inside the project: ${path}`);
    return p;
  };
  const at = path => remoteEntry(repo, ref, check(path), deps);
  return Object.freeze({
    root: null,
    config: Object.freeze(structuredClone(config)),
    read: async path => (await at(path)).file ?? null,
    exists: async path => !(await at(path)).none,
    list: async (dir = '.') => {
      const e = dir === '.' || dir === '' ? await remoteEntry(repo, ref, '', deps) : await at(dir);
      return (e.dir ?? []).map(x => x.name).sort();
    },
  });
}

/** Of the unrecorded migrations, { pending: ids applies() says yes to, possiblyPending: [{id, why}] }. */
async function pendingOf(migrations, view) {
  const pending = [], possiblyPending = [];
  for (const m of migrations) {
    if (typeof m.applies !== 'function') { possiblyPending.push({ id: m.id, why: 'it has no applies()' }); continue; }
    try { if (await m.applies(view)) pending.push(m.id); } catch (e) { possiblyPending.push({ id: m.id, why: String(e?.message ?? e).split('\n')[0] }); }
  }
  return { pending, possiblyPending };
}

// ---- fleet.json --------------------------------------------------------------

export function parseFleet(text) {
  let list;
  try { list = JSON.parse(text); } catch (e) { throw new FleetError(`${FLEET}: not JSON: ${e.message}`); }
  if (!Array.isArray(list)) throw new FleetError(`${FLEET}: expected an array of { repo, kind, role, note }`);
  const seen = new Set();
  return list.map((e, i) => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(e?.repo ?? '')) throw new FleetError(`${FLEET}[${i}]: repo must be owner/name`);
    if (!ROLES.includes(e.role)) throw new FleetError(`${FLEET}[${i}] ${e.repo}: role must be one of ${ROLES.join(', ')}`);
    if (e.kind !== undefined && !KINDS.includes(e.kind)) throw new FleetError(`${FLEET}[${i}] ${e.repo}: kind must be one of ${KINDS.join(', ')}`);
    if (seen.has(e.repo)) throw new FleetError(`${FLEET}: ${e.repo} is listed twice`);
    seen.add(e.repo);
    return { repo: e.repo, kind: e.kind ?? 'other', role: e.role, note: e.note ?? '' };
  });
}

// ---- the pure parts ----------------------------------------------------------

/** The newest health page's date and how it reads today. */
export function healthOf(names, now) {
  const dates = (names ?? []).map(n => /^(\d{4}-\d{2}-\d{2})\.md$/.exec(n)?.[1]).filter(Boolean).sort();
  const last = dates.at(-1) ?? null;
  if (!last) return { last: null, age: null, state: 'none' };
  const age = Math.floor((Date.parse(now.slice(0, 10)) - Date.parse(last)) / DAY);
  return { last, age, state: age > SILENT_DAYS ? 'silent' : 'fresh' };
}

/** The gate workflow among run names: `check`, then ci/test(s), then any naming check, test or CI. */
export function gateName(names) {
  const unique = [...new Set(names)];
  const exact = w => unique.find(n => n.toLowerCase() === w);
  return exact('check') ?? exact('ci') ?? exact('test') ?? exact('tests')
    ?? unique.find(n => /\b(check|tests?|ci)\b/i.test(n)) ?? null;
}

/** The commands a workflow's YAML runs: each `run:` value, a block scalar line by line; comments dropped. */
export function runCommands(yaml) {
  const lines = String(yaml).split(/\r?\n/), out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*?)\s*$/.exec(lines[i]);
    if (!m) continue;
    if (/^[|>][+-]?\d*$/.test(m[2])) {
      while (i + 1 < lines.length && (!lines[i + 1].trim() || /^\s*/.exec(lines[i + 1])[0].length > m[1].length)) {
        const l = lines[++i].trim();
        if (l && !l.startsWith('#')) out.push(l);
      }
    } else if (m[2] && !m[2].startsWith('#')) out.push(m[2].replace(/^(['"])(.*)\1$/, '$2'));
  }
  return out;
}

/** A workflow's name as GitHub shows it: its top-level `name:`, else its path. */
export function workflowName(yaml, path) {
  const m = /^name:\s*(.+?)\s*$/m.exec(String(yaml));
  return m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : path;
}

/** Whether a workflow's YAML is triggered by push (`on: push`, `on: [push, …]`, or a `push:` key under `on:`). */
export function onPush(yaml) {
  const lines = String(yaml).split(/\r?\n/);
  const i = lines.findIndex(l => /^(on|"on"|'on'):/.test(l));
  if (i < 0) return false;
  if (/\bpush\b/.test(lines[i].replace(/#.*$/, '').replace(/^[^:]*:/, ''))) return true;
  for (const l of lines.slice(i + 1)) {
    if (/^\S/.test(l)) break; // the next top-level key
    if (/^\s+(-\s+)?push\b/.test(l)) return true;
  }
  return false;
}

/** Whether `commands` run `command` (as one step of a line split on && || ; |), with or without arguments. */
const runsCommand = (commands, command) => commands.some(line => line.split(/\s*(?:&&|\|\||;|\|)\s*/)
  .some(part => part === command || part.startsWith(`${command} `)));

/**
 * The gate workflow and the rule that chose it, among the workflows with runs
 * on the default branch (newest run first): one named `check`; else one
 * triggered by push whose YAML runs the configured check, else `npm test` (a
 * scheduled or dispatched loop that runs the check is not the gate); else a
 * name match (gateName). A `gateWorkflow` named in the project's config comes
 * first. workflows: [{name, push, commands}] or null when unread.
 */
export function gateOf(names, { workflows = null, check = 'npm run check', gateWorkflow = null } = {}) {
  // The project said which workflow is its gate (.keel/keel.json gateWorkflow): no guess beats that.
  if (gateWorkflow) return { workflow: gateWorkflow, rule: 'named in config' };
  const exact = names.find(n => n.toLowerCase() === 'check');
  if (exact) return { workflow: exact, rule: 'named check' };
  if (Array.isArray(workflows)) {
    for (const [command, also] of [[check], ['npm test', ['npm run test']]]) {
      for (const n of names) {
        const w = workflows.find(x => x.name === n);
        if (w?.push && [command, ...(also ?? [])].some(c => runsCommand(w.commands, c))) return { workflow: n, rule: `runs ${command}` };
      }
    }
  }
  const named = gateName(names);
  return named ? { workflow: named, rule: 'name matches' } : { workflow: null, rule: null };
}

/** The workflow names with runs on `branch`, newest run first. */
export const branchWorkflows = (runs, branch) => [...new Set(runs.filter(r => r.headBranch === branch)
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(r => r.workflowName))];

/** Conclusions that judge the code. cancelled, skipped, neutral and stale say nothing about it. */
export const VERDICTS = { success: 'green', failure: 'red', timed_out: 'red', startup_failure: 'red', action_required: 'red' };

/**
 * CI from `gh run list` rows: the gate's newest run on the default branch whose
 * conclusion is a verdict. Newer runs that are not (cancelled, skipped, running)
 * are counted, not read as the state: a busy repo with cancel-in-progress is
 * mostly cancelled runs, and they say nothing. opts: gateOf's.
 */
export function ciOf(runs, branch, opts = {}) {
  const mine = runs.filter(r => r.headBranch === branch);
  const { workflow, rule } = gateOf(branchWorkflows(runs, branch), opts);
  if (!workflow) return { state: 'no gate run', workflow: null, rule: null, conclusion: null, at: null };
  const gate = mine.filter(r => r.workflowName === workflow).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const i = gate.findIndex(r => r.status === 'completed' && Object.hasOwn(VERDICTS, r.conclusion));
  const newer = i < 0 ? gate : gate.slice(0, i);
  const running = newer.filter(r => r.status !== 'completed').length;
  const skipped = {};
  for (const r of newer) if (r.status === 'completed') skipped[r.conclusion || 'unknown'] = (skipped[r.conclusion || 'unknown'] ?? 0) + 1;
  const run = gate[i];
  if (!run) return { state: running ? 'running' : 'no verdict', workflow, rule, conclusion: null, at: null, running, skipped };
  return { state: VERDICTS[run.conclusion], workflow, rule, conclusion: run.conclusion, at: run.createdAt, running, skipped };
}

/** What a CI cell adds past its verdict: when that verdict was and what is newer, or nothing when it is the newest run. */
export function ciNote(ci) {
  const parts = Object.entries(ci.skipped ?? {}).map(([c, n]) => `${n} newer ${c}`);
  if (ci.running) parts.push(`${ci.running} running`);
  if (!parts.length) return '';
  const at = ci.at ? `last verdict ${ci.at.slice(11, 16)}` : 'no verdict';
  return ` · ${at}; ${parts.join(', ')}`;
}

/** Lesson rows in lessons.md whose fingerprint is not in sent.json. */
export function unsentOf(lessonsText, sentText, project) {
  if (lessonsText === null) return { rows: 0, unsent: 0 };
  const { rows } = parseLessons(lessonsText);
  const sent = sentText ? JSON.parse(sentText) : {};
  return { rows: rows.length, unsent: rows.filter(r => !Object.hasOwn(sent, lessonFingerprint(project, r))).length };
}

/** How far a project's practice is behind the CLI's: 'current', 'a → b', or 'ahead (a)'. */
export function behindOf(practice, cli) {
  if (!parseVersion(practice)) return `unknown (${practice ?? 'none'})`;
  const c = compareVersions(practice, cli);
  return c === 0 ? 'current' : c < 0 ? `${practice} → ${cli}` : `ahead (${practice})`;
}

// ---- reading one repo --------------------------------------------------------

/**
 * The default branch's workflows as [{name, path, push, commands}], beside the
 * repo's other reads: one listing (no ref: the default branch), then every
 * file at once, and no file at all when a run on the default branch is named
 * `check` (rule a needs no YAML) or there is no run there.
 */
async function workflowsOf(r, metaP, runsP, deps) {
  const [meta, runs, dir] = await Promise.all([metaP, runsP, remoteEntry(r, null, '.github/workflows', deps)]);
  const names = branchWorkflows(runs, meta.default_branch);
  if (!names.length || names.some(n => n.toLowerCase() === 'check')) return null;
  const files = (dir.dir ?? []).filter(e => e.type === 'file' && /\.ya?ml$/.test(e.name));
  return Promise.all(files.map(async e => {
    const path = `.github/workflows/${e.name}`;
    const text = (await remoteEntry(r, null, path, deps)).file ?? '';
    return { name: workflowName(text, path), path, push: onPush(text), commands: runCommands(text) };
  }));
}

async function managed(entry, { env, now, cli, migrations, cache, ask }) {
  const r = entry.repo;
  const metaP = ghJson(['api', `repos/${r}`], env);
  const runsP = ghJson(['run', 'list', '-R', r, '--limit', '50', '--json', 'conclusion,workflowName,createdAt,headBranch,status'], env);
  let [meta, config, health, runs, prs, lessonsMd, sent, workflows] = await Promise.all([
    settle(metaP),
    settle(contents(r, '.keel/keel.json', env)),
    settle(listing(r, HEALTH, env)),
    settle(runsP),
    settle(ghJson(['pr', 'list', '-R', r, '--state', 'open', '--limit', '200', '--json', 'number,headRefName'], env)),
    settle(contents(r, 'docs/lessons.md', env)),
    settle(contents(r, SENT, env)),
    settle(workflowsOf(r, metaP, runsP, { env, cache })),
  ]);
  const row = { repo: r, role: 'managed', kind: entry.kind, note: entry.note };
  if (meta.error) return { ...row, unreadable: meta.error };
  let healthDir = null;
  const branch = meta.ok.default_branch;
  row.branch = branch;

  if (config.error) row.adopted = { unreadable: config.error };
  else if (config.ok === null) row.adopted = false;
  else {
    let cfg;
    try { cfg = JSON.parse(config.ok); } catch (e) { cfg = null; row.adopted = { unreadable: `.keel/keel.json is not JSON: ${e.message}` }; }
    if (cfg) {
      row.adopted = true;
      // keel itself is home: its lessons are the catalogue, never sent, and its practice is its source.
      if (cfg.keel === 'self') row.home = true;
      row.check = typeof cfg.check === 'string' && cfg.check.trim() ? cfg.check.trim() : 'npm run check';
      if (cfg.gateWorkflow !== undefined) {
        if (typeof cfg.gateWorkflow === 'string' && cfg.gateWorkflow.trim()) row.gateWorkflow = cfg.gateWorkflow.trim();
        else row.gateWorkflowProblem = '.keel/keel.json "gateWorkflow" must be a workflow\'s name, as GitHub shows it';
      }
      row.practice = { version: cfg.practice ?? null, behind: behindOf(cfg.practice, cli) };
      let unrecorded;
      try { unrecorded = untaken(migrations, taken(cfg)); } catch (e) { row.practice.unrecorded = { unreadable: e.message }; }
      if (unrecorded) {
        row.practice.unrecorded = unrecorded.map(m => m.id);
        // Only fleet update asks applies() (over the default branch, many reads); home's are never fleet's to plan.
        if (row.home) Object.assign(row.practice, { pending: [], possiblyPending: [] });
        else if (ask) Object.assign(row.practice, await pendingOf(unrecorded, remoteView(r, branch, cfg, { env, cache })));
      }
      // The health pages are where the project's .keel/keel.json says (lib.mjs healthDirOf), not always docs/health.
      let dir = HEALTH;
      try { dir = healthDirOf(cfg); } catch (e) { health = { error: e.message }; }
      if (dir !== HEALTH) { healthDir = dir; health = await settle(listing(r, dir, env)); }
      const project = /^[\w.-]+\/[\w.-]+$/.test(cfg.repo ?? '') ? cfg.repo : (cfg.name ?? r);
      const path = lessonsPath(cfg);
      const table = path === 'docs/lessons.md' ? lessonsMd : await settle(contents(r, path, env));
      if (row.home) row.lessons = { project, home: true };
      else if (table.error || sent.error) row.lessons = { unreadable: table.error ?? sent.error };
      else {
        try { row.lessons = { project, ...(path === 'docs/lessons.md' ? {} : { path }), ...unsentOf(table.ok, sent.ok, project) }; } catch (e) { row.lessons = { unreadable: `${SENT}: ${e.message}` }; }
      }
    }
  }
  row.health = { ...(health.error ? { unreadable: health.error } : healthOf(health.ok, now)), ...(healthDir ? { dir: healthDir } : {}) };
  // A named gate workflow is read on its own: on a busy repo (isocan's bots run
  // eight workflows a day) it can fall out of the newest 50 runs of all of them.
  if (row.gateWorkflow) {
    const own = await settle(ghJson(['run', 'list', '-R', r, '--workflow', row.gateWorkflow, '--branch', branch, '--limit', '20', '--json', 'conclusion,workflowName,createdAt,headBranch,status'], env));
    runs = own.error ? own : { ok: own.ok };
  }
  if (row.gateWorkflowProblem) row.ci = { unreadable: row.gateWorkflowProblem };
  else if (runs.error) row.ci = { unreadable: runs.error };
  else {
    row.ci = ciOf(runs.ok, branch, { workflows: workflows.ok ?? null, check: row.check ?? 'npm run check', gateWorkflow: row.gateWorkflow ?? null });
    if (workflows.error) row.ci.workflowsUnreadable = workflows.error;
  }
  delete row.check;
  if (prs.error) row.machinePrs = { unreadable: prs.error };
  else {
    const queues = Object.fromEntries(MACHINE_PREFIXES.map(p => [p, prs.ok.filter(x => String(x.headRefName ?? '').startsWith(p)).length]));
    row.machinePrs = { total: Object.values(queues).reduce((a, b) => a + b, 0), queues,
      heads: prs.ok.map(x => String(x.headRefName ?? '')).filter(h => MACHINE_PREFIXES.some(p => h.startsWith(p))).sort() };
  }
  return row;
}

async function source(entry, { env, pins }) {
  const mine = pins.filter(p => p.source.repo === entry.repo);
  const row = { repo: entry.repo, role: 'source', kind: entry.kind, note: entry.note };
  const heads = await Promise.all(mine.map(p => settle(ghJson(['api', headApi(p.source)], env))));
  row.pins = mine.map((p, i) => {
    const pin = { practice: p.practice, path: p.source.path, pinned: p.source.commit };
    if (heads[i].error) return { ...pin, unreadable: heads[i].error };
    const head = heads[i].ok?.[0]?.sha;
    if (!head) return { ...pin, unreadable: 'no commit touches that path' };
    return { ...pin, head, moved: !atPin(p.source.commit, head) };
  });
  if (mine.length && row.pins.every(p => p.unreadable)) row.unreadable = row.pins[0].unreadable;
  return row;
}

// ---- what needs a person -----------------------------------------------------

const bad = v => v && typeof v === 'object' && 'unreadable' in v;

/** 'pending: a; possibly pending: b (why)', or '' when no migration applies. */
export function migrationWork(p) {
  if (p && !p.pending && Array.isArray(p.unrecorded)) {
    return p.unrecorded.length ? `${p.unrecorded.length} unrecorded (${p.unrecorded.join(', ')}); keel fleet update checks them` : '';
  }
  const pending = p?.pending ?? [], maybe = p?.possiblyPending ?? [];
  return [pending.length ? `pending: ${pending.join(', ')}` : '',
    maybe.length ? `possibly pending: ${maybe.map(m => `${m.id} (${m.why})`).join(', ')}` : ''].filter(Boolean).join('; ');
}

export function needsOf(rows) {
  const out = [];
  for (const r of rows) {
    const say = why => out.push({ repo: r.repo, why });
    if (r.unreadable) { say(`unreadable: ${r.unreadable}`); continue; }
    if (r.role === 'source') {
      for (const p of r.pins) {
        if (p.unreadable) say(`${p.practice}: head unreadable: ${p.unreadable}`);
        else if (p.moved) say(`${p.practice}: upstream ${p.path} moved ${p.pinned.slice(0, 8)} → ${p.head.slice(0, 8)} (keel learn)`);
      }
      continue;
    }
    if (bad(r.adopted)) say(`config unreadable: ${r.adopted.unreadable}`);
    else if (!r.adopted) say('not adopted');
    else {
      const p = r.practice;
      if (bad(p.unrecorded)) say(`migrations unreadable: ${p.unrecorded.unreadable}`);
      const work = migrationWork(p);
      if (p.behind !== 'current') say(`behind: ${p.behind}${work ? `; ${work}` : ''} (keel update)`);
      else if (work && !r.home) say(p.pending ? `${work} (keel update)` : work);
    }
    if (bad(r.ci)) say(`CI unreadable: ${r.ci.unreadable}`);
    else if (r.ci.state === 'red') say(`red: ${r.ci.workflow} ${r.ci.conclusion} at ${r.ci.at}`);
    if (r.adopted === true) {
      if (bad(r.health)) say(`health unreadable: ${r.health.unreadable}`);
      else if (r.health.state === 'silent') say(`silent: last health page ${r.health.last}, ${r.health.age} days ago`);
      else if (r.health.state === 'none') say('no health page');
      if (bad(r.lessons)) say(`lessons unreadable: ${r.lessons.unreadable}`);
      else if (!r.home && r.lessons?.unsent) say(`${r.lessons.unsent} unsent lesson${r.lessons.unsent === 1 ? '' : 's'} (keel lessons, there)`);
    }
    if (bad(r.machinePrs)) say(`machine PRs unreadable: ${r.machinePrs.unreadable}`);
    else for (const [p, n] of Object.entries(r.machinePrs.queues)) if (n > 1) say(`${n} open ${p} PRs (keel drain ${p})`);
  }
  return out;
}

// ---- text --------------------------------------------------------------------

const cell = v => bad(v) ? `unreadable: ${v.unreadable}` : v;
function cells(r) {
  if (r.unreadable) return [r.repo, `unreadable: ${r.unreadable}`, '', '', '', '', ''];
  const adopted = bad(r.adopted) ? cell(r.adopted) : r.adopted ? 'yes' : 'no';
  const practice = r.adopted === true ? (r.practice.behind === 'current' ? `${r.practice.version} current` : r.practice.behind) : '—';
  const health = bad(r.health) ? cell(r.health)
    : r.health.state === 'none' ? 'no health page'
    : `${r.health.last}${r.health.state === 'silent' ? ' silent' : ''}`;
  const ci = bad(r.ci) ? cell(r.ci) : r.ci.workflow ? `${r.ci.state} (${r.ci.workflow} · ${r.ci.rule}${ciNote(r.ci)})` : r.ci.state;
  const lessons = r.adopted !== true ? '—' : bad(r.lessons) ? cell(r.lessons) : r.lessons.home ? 'home' : String(r.lessons.unsent);
  const prs = bad(r.machinePrs) ? cell(r.machinePrs) : String(r.machinePrs.total);
  return [r.repo, adopted, practice, health, ci, lessons, prs];
}

export function fleetText({ rows, needs, cli, ms }) {
  const head = ['repo', 'adopted', 'practice', 'health', 'CI', 'unsent lessons', 'machine PRs'];
  const body = rows.filter(r => r.role === 'managed').map(cells);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const line = cs => cs.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  const out = [`keel fleet — practice ${cli} on this CLI`, '', line(head), ...body.map(line)];
  const sources = rows.filter(r => r.role === 'source');
  if (sources.length) {
    out.push('', 'Sources (learned from, never managed):');
    for (const r of sources) {
      if (r.unreadable) { out.push(`  ${r.repo}: unreadable: ${r.unreadable}`); continue; }
      if (!r.pins.length) { out.push(`  ${r.repo}: nothing pinned from it`); continue; }
      out.push(`  ${r.repo}: ${r.pins.map(p => `${p.practice} pins ${p.path}@${p.pinned.slice(0, 8)} — ${p.unreadable ? `unreadable: ${p.unreadable}` : p.moved ? `moved to ${p.head.slice(0, 8)}` : 'unmoved'}`).join('; ')}`);
    }
  }
  out.push('', needs.length ? 'Needs you:' : 'Needs you: nothing.', ...needs.map(n => `  ${n.repo}: ${n.why}`));
  if (ms !== undefined) out.push('', `Read ${rows.length} repos in ${(ms / 1000).toFixed(1)}s.`);
  return out.join('\n');
}

// ---- the verb ----------------------------------------------------------------

/** opts: { dir }; deps: { env?, now?, cli (practice version), migrations?, askMigrations? (fleet update: ask applies()) }. */
export async function fleet(opts, deps) {
  const { env = process.env, now = new Date().toISOString(), cli } = deps;
  const started = Date.now();
  const root = await findRoot(resolve(opts.dir ?? '.'));
  const cfg = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  if (cfg.keel !== 'self') throw new FleetError('fleet runs at home, on keel. It reads the projects listed in keel\'s fleet.json.');
  const text = await readFile(join(root, FLEET), 'utf8').catch(e => {
    if (e.code === 'ENOENT') throw new FleetError(`no ${FLEET} at ${root}: list the fleet's repos there`);
    throw e;
  });
  const entries = parseFleet(text);
  const migrations = deps.migrations ?? await loadMigrations();
  const pins = await sourcePins(root);
  const ctx = { env, now, cli, migrations, pins, cache: new Map(), ask: !!deps.askMigrations };
  const rows = await Promise.all(entries.map(e => e.role === 'source' ? source(e, ctx) : managed(e, ctx)));
  const needs = needsOf(rows);
  const ms = Date.now() - started;
  return {
    data: { ok: true, root, cli, at: now, ms, rows, needs },
    text: fleetText({ rows, needs, cli, ms }),
    exitCode: 0,
  };
}

// ---- fleet update ------------------------------------------------------------

/** The update PR a fleet row would get, or null when it needs none: behind this CLI, or a migration that applies (or could not be asked). */
export function updatePlan(row, cli) {
  if (row.role !== 'managed' || row.unreadable || row.adopted !== true || row.home) return null;
  const p = row.practice;
  const pending = Array.isArray(p.pending) ? p.pending : [];
  const possiblyPending = Array.isArray(p.possiblyPending) ? p.possiblyPending : [];
  const behind = parseVersion(p.version) && compareVersions(p.version, cli) < 0;
  if (!behind && !pending.length && !possiblyPending.length) return null;
  const branch = BRANCH(cli);
  return {
    repo: row.repo, from: p.version, to: cli, pending, possiblyPending, behind: !!behind, branch,
    title: behind ? `keel update: practice ${p.version} → ${cli}` : `keel update: practice ${cli}, pending migrations`,
    open: Array.isArray(row.machinePrs?.heads) && row.machinePrs.heads.includes(branch),
  };
}

/** Why an adopted project (not home) gets no plan: 'current; nothing applies (asked …)'. */
function restingOf(row) {
  const p = row.practice;
  if (bad(p.unrecorded)) return `${p.behind}; migrations unreadable: ${p.unrecorded.unreadable}`;
  return p.unrecorded.length ? `${p.behind}; nothing applies (asked ${p.unrecorded.join(', ')})` : `${p.behind}; every migration recorded`;
}

const planLine = u => {
  const work = migrationWork(u);
  return `  ${u.repo}: ${u.open ? `${u.branch} is already open; it waits for a person` : `"${u.title}" from ${u.branch}`}${work ? ` (${work})` : ''}`;
};

/** The last `n` lines a failed command printed, stdout then stderr. */
const tailOf = (e, n = 12) => `${e?.stdout ?? ''}\n${e?.stderr ?? ''}`.split('\n').map(l => l.trimEnd()).filter(Boolean).slice(-n).join('\n')
  || String(e?.message ?? e).split('\n')[0];

/** One repo: clone, identity, the project's install, keel update --yes. Returns its row of the result. */
async function updateOne(u, { env, cli, cliRoot, whatsnew, update }) {
  const tmp = await mkdtemp(join(tmpdir(), 'keel-fleet-update-'));
  const dir = join(tmp, u.repo.split('/')[1]);
  const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024, ...opts });
  const why = e => String(e?.stderr || e?.message || e).trim().split('\n').filter(Boolean).pop() ?? 'failed';
  try {
    const gh = env.KEEL_GH || 'gh';
    try { run(gh, ['repo', 'clone', u.repo, dir, '--', '--quiet']); } catch (e) { return { ...u, ok: false, step: 'clone', error: `${gh} repo clone failed: ${why(e)}` }; }
    for (const [key, value] of [['user.name', 'keel fleet update'], ['user.email', 'keel-fleet-update@users.noreply.github.com']]) {
      let set = '';
      try { set = run('git', ['-C', dir, 'config', key]).trim(); } catch { set = ''; }
      if (!set) run('git', ['-C', dir, 'config', key, value]); // only when the owner has none
    }
    // Install the way the project says: its setup (as the night runs it), else npm ci with a lockfile, else nothing.
    let config, gate;
    try {
      config = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
      gate = gateEnv(env, config); // NODE_TEST_* stripped, the project's env over it; a bad env throws
      if (config.setup !== undefined && (typeof config.setup !== 'string' || !config.setup.trim())) throw new Error('.keel/keel.json: "setup" must be a non-empty shell command');
    } catch (e) { return { ...u, ok: false, step: 'setup', error: String(e?.message ?? e).split('\n')[0] }; }
    if (config.setup !== undefined) {
      try { run('bash', ['-e', '-c', config.setup], { cwd: dir, env: gate }); } catch (e) {
        return { ...u, ok: false, step: 'setup', error: `setup \`${config.setup}\` failed${e?.status != null ? ` (exit ${e.status})` : ''}:\n${tailOf(e)}` };
      }
    } else if (await stat(join(dir, 'package-lock.json')).catch(() => null)) {
      const npm = env.KEEL_NPM || 'npm';
      try { run(npm, ['ci'], { cwd: dir, env: gate }); } catch (e) { return { ...u, ok: false, step: 'install', error: `npm ci failed: ${why(e)}` }; }
    }
    let r;
    try {
      r = await update({ dir, yes: true, selfUpdate: false, argv: ['update', '--yes', '--no-self-update'], cwd: dir }, { version: cli, cliRoot, whatsnew, env });
    } catch (e) { return { ...u, ok: false, step: 'update', error: String(e?.message ?? e).split('\n')[0] }; }
    if (r.data?.pr) return { ...u, ok: true, pr: r.data.pr };
    if (r.data?.changed === false) return { ...u, ok: true, pr: null, note: 'nothing to change once cloned (no pending migration applies)' };
    return { ...u, ok: false, step: 'update', error: (r.text ?? 'no pull request was opened').split('\n').pop() };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** opts: { dir, yes }; deps: fleet's, plus { cliRoot, whatsnew, update? }. */
export async function fleetUpdate(opts, deps) {
  const { env = process.env, cli } = deps;
  const read = await fleet(opts, { ...deps, askMigrations: true });
  const plans = [], resting = [];
  for (const row of read.data.rows) {
    const plan = updatePlan(row, cli);
    if (plan) plans.push(plan);
    else if (row.role === 'managed' && !row.unreadable && row.adopted === true && !row.home) resting.push({ repo: row.repo, why: restingOf(row) });
  }
  const todo = plans.filter(u => !u.open);
  const head = `keel fleet update — practice ${cli} on this CLI`;
  const notPlanned = resting.length ? ['', 'Not planned:', ...resting.map(x => `  ${x.repo}: ${x.why}`)] : [];
  if (!todo.length) {
    return {
      data: { ok: true, cli, plans, resting, results: [] },
      text: [head, '', ...(plans.length ? ['Already open, waiting for a person:', ...plans.map(planLine)] : ['Every adopted project is current, with nothing pending.']), ...notPlanned].join('\n'),
      exitCode: 0,
    };
  }
  if (!opts.yes) {
    return {
      data: { ok: false, needs: 'yes', cli, plans, resting },
      text: [head, '', 'Would open, one per project, with your own gh login:', ...plans.map(planLine), ...notPlanned, '',
        '⚑ Opening pull requests on these repos needs a yes. Nothing was cloned or pushed; re-run with --yes.'].join('\n'),
      exitCode: 3,
    };
  }
  const results = [];
  for (const u of todo) results.push(await updateOne(u, { env, cli, cliRoot: deps.cliRoot, whatsnew: deps.whatsnew, update: deps.update ?? keelUpdate }));
  const failed = results.filter(r => !r.ok);
  const line = r => `  ${r.repo}: ${r.ok ? (r.pr ? `opened ${r.pr}` : r.note) : `FAILED at ${r.step}: ${r.error.replace(/\n/g, '\n      ')}`}`;
  return {
    data: { ok: !failed.length, cli, plans, resting, results },
    text: [head, '', ...results.map(line), ...plans.filter(u => u.open).map(planLine), ...notPlanned].join('\n'),
    exitCode: failed.length ? 1 : 0,
  };
}

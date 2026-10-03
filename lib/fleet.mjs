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
//   run list                        the gate workflow's newest completed run on the default branch
//   pr list                         open machine PRs, by prefix (keel/, keel-night/, renovate/)
//   contents/docs/lessons.md, contents/.keel/sent.json
//                                   lesson rows whose fingerprint is not in sent;
//                                   a config naming another `lessons` path is
//                                   read there instead (one more call)
// The practice is compared with this CLI's; migrations the project has not
// recorded are "possibly pending" (applies() needs the tree, which is remote).
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
// same reads, every adopted project behind this CLI or with migrations it has
// not recorded. Without --yes: each, and the PR it would open (exit 3; 0 when
// none). With --yes, one at a time: gh repo clone into a temp dir with the
// owner's own gh login, a git identity only if none is configured, npm ci
// when there is a lockfile, then keel update --yes --no-self-update there,
// which pushes keel/update-v<version> and opens the PR. One repo failing never
// stops the others; each says its PR or its error (exit 1 if any failed).
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findRoot } from './project.mjs';
import { lessonsPath } from './practices.mjs';
import { parseLessons, lessonFingerprint, SENT } from './lessons.mjs';
import { sourcePins, headApi, atPin } from './learn.mjs';
import { load as loadMigrations, compareVersions, parseVersion, taken, untaken } from './migrations.mjs';
import { MACHINE_PREFIXES, HEALTH } from './improve.mjs';
import { update as keelUpdate, BRANCH } from './update.mjs';

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

/** CI from `gh run list` rows: the gate's newest completed run on the default branch. */
export function ciOf(runs, branch) {
  const mine = runs.filter(r => r.headBranch === branch);
  const workflow = gateName(mine.map(r => r.workflowName));
  if (!workflow) return { state: 'no gate run', workflow: null, conclusion: null, at: null };
  const run = mine.filter(r => r.workflowName === workflow && r.status === 'completed')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!run) return { state: 'running', workflow, conclusion: null, at: null };
  const state = run.conclusion === 'success' ? 'green'
    : ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(run.conclusion) ? 'red' : run.conclusion;
  return { state, workflow, conclusion: run.conclusion, at: run.createdAt };
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

async function managed(entry, { env, now, cli, migrations }) {
  const r = entry.repo;
  const [meta, config, health, runs, prs, lessonsMd, sent] = await Promise.all([
    settle(ghJson(['api', `repos/${r}`], env)),
    settle(contents(r, '.keel/keel.json', env)),
    settle(listing(r, HEALTH, env)),
    settle(ghJson(['run', 'list', '-R', r, '--limit', '50', '--json', 'conclusion,workflowName,createdAt,headBranch,status'], env)),
    settle(ghJson(['pr', 'list', '-R', r, '--state', 'open', '--limit', '200', '--json', 'number,headRefName'], env)),
    settle(contents(r, 'docs/lessons.md', env)),
    settle(contents(r, SENT, env)),
  ]);
  const row = { repo: r, role: 'managed', kind: entry.kind, note: entry.note };
  if (meta.error) return { ...row, unreadable: meta.error };
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
      let pending;
      try { pending = untaken(migrations, taken(cfg)).map(m => m.id); } catch (e) { pending = { unreadable: e.message }; }
      row.practice = { version: cfg.practice ?? null, behind: behindOf(cfg.practice, cli), possiblyPending: pending };
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
  row.health = health.error ? { unreadable: health.error } : healthOf(health.ok, now);
  row.ci = runs.error ? { unreadable: runs.error } : ciOf(runs.ok, branch);
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
      const p = r.practice, pending = bad(p.possiblyPending) ? [] : p.possiblyPending;
      if (bad(p.possiblyPending)) say(`migrations unreadable: ${p.possiblyPending.unreadable}`);
      if (p.behind !== 'current') say(`behind: ${p.behind}${pending.length ? `; possibly pending: ${pending.join(', ')}` : ''} (keel update)`);
      else if (pending.length && !r.home) say(`possibly pending: ${pending.join(', ')} (keel update)`);
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
  const ci = bad(r.ci) ? cell(r.ci) : r.ci.workflow ? `${r.ci.state} (${r.ci.workflow})` : r.ci.state;
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

/** opts: { dir }; deps: { env?, now?, cli (practice version), migrations? }. */
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
  const ctx = { env, now, cli, migrations, pins };
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

/** The update PR a fleet row would get, or null when it needs none. */
export function updatePlan(row, cli) {
  if (row.role !== 'managed' || row.unreadable || row.adopted !== true || row.home) return null;
  const p = row.practice;
  const pending = Array.isArray(p.possiblyPending) ? p.possiblyPending : [];
  const behind = parseVersion(p.version) && compareVersions(p.version, cli) < 0;
  if (!behind && !pending.length) return null;
  const branch = BRANCH(cli);
  return {
    repo: row.repo, from: p.version, to: cli, pending, branch,
    title: behind ? `keel update: practice ${p.version} → ${cli}` : `keel update: practice ${cli}, pending migrations`,
    open: Array.isArray(row.machinePrs?.heads) && row.machinePrs.heads.includes(branch),
  };
}

const planLine = u => `  ${u.repo}: ${u.open ? `${u.branch} is already open; it waits for a person` : `"${u.title}" from ${u.branch}`}${u.pending.length ? ` (possibly pending: ${u.pending.join(', ')})` : ''}`;

/** One repo: clone, identity, install, keel update --yes. Returns its row of the result. */
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
    if (await stat(join(dir, 'package-lock.json')).catch(() => null)) {
      const npm = env.KEEL_NPM || 'npm';
      const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('NODE_TEST_')));
      try { run(npm, ['ci'], { cwd: dir, env: clean }); } catch (e) { return { ...u, ok: false, step: 'install', error: `npm ci failed: ${why(e)}` }; }
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
  const read = await fleet(opts, deps);
  const plans = read.data.rows.map(r => updatePlan(r, cli)).filter(Boolean);
  const todo = plans.filter(u => !u.open);
  const head = `keel fleet update — practice ${cli} on this CLI`;
  if (!todo.length) {
    return {
      data: { ok: true, cli, plans, results: [] },
      text: [head, '', ...(plans.length ? ['Already open, waiting for a person:', ...plans.map(planLine)] : ['Every adopted project is current, with nothing pending.'])].join('\n'),
      exitCode: 0,
    };
  }
  if (!opts.yes) {
    return {
      data: { ok: false, needs: 'yes', cli, plans },
      text: [head, '', 'Would open, one per project, with your own gh login:', ...plans.map(planLine), '',
        '⚑ Opening pull requests on these repos needs a yes. Nothing was cloned or pushed; re-run with --yes.'].join('\n'),
      exitCode: 3,
    };
  }
  const results = [];
  for (const u of todo) results.push(await updateOne(u, { env, cli, cliRoot: deps.cliRoot, whatsnew: deps.whatsnew, update: deps.update ?? keelUpdate }));
  const failed = results.filter(r => !r.ok);
  const line = r => `  ${r.repo}: ${r.ok ? (r.pr ? `opened ${r.pr}` : r.note) : `FAILED at ${r.step}: ${r.error}`}`;
  return {
    data: { ok: !failed.length, cli, plans, results },
    text: [head, '', ...results.map(line), ...plans.filter(u => u.open).map(planLine)].join('\n'),
    exitCode: failed.length ? 1 : 0,
  };
}

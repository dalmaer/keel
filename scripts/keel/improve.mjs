// keel improve, shipped: is the practice working here? Numbers first, one
// proposal last, and nothing changed (keel docs/design.md §6, "The night
// shift"). keel practice `night`; managed: keel render rewrites it.
//
//   node scripts/keel/improve.mjs [--report] [--transcripts <dir>] [--json]
//
// It runs from the project's own checkout with Node built-ins, gh and npm,
// and the project's scripts/roadmap.mjs (the phases practice); no keel. keel's
// own `keel improve` is this same module, handed keel's instruments (its
// roadmap parser, doctor and inbox), so it computes the full set. Here, a
// measure that needs keel says `keel-side only`; it is never a zero:
//   drift  by .keel/lock.json alone: bytes keel did not write are `edited`
//          (`behind`, keel moving on, needs keel's templates: keel doctor)
//   lint   the rules the project's own files can show (PROJECT_LINTS)
//   inbox_waiting  keel-side only
//
// Each measure is { id, what, unit, bound, better, ratchet?, run(ctx) → { value,
// detail, facts? } | { na } }. `bound` is the default; a project's .keel/bounds.json
// holds its own. An instrument that cannot run THROWS: the measure is
// `broken` and the whole run exits 2. It is never reported as a zero, because
// a grader that reports zeros when it breaks is believed (lesson 6).
//
// Exit codes: 0 every measure within its bound (or n/a), 1 one outside, 2 one
// broken. --report also writes <health>/<date>.md (.keel/keel.json `health`,
// default docs/health) and tightens
// .keel/bounds.json where a value beat its bound (a ratchet: never loosens).
//
// Adapted ideas, not code: the conduct-cost measure follows isocan's
// scripts/subagent-time.mjs (github.com/dalmaer/isocan, origin/main,
// Apache-2.0): time each Bash call from tool_use to tool_result, by kind. The
// ratchet follows isocan's scripts/ratchet.mjs (Apache-2.0): bounds that only
// report the wrong way.
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCK, read, readLock, lockDrift, phaseLints, claudeMdLint, secondCopies, lockedSkills, lessonsTableSplit, parseLessons, lessonsPathOf, unsentLessons, SENT, gateEnv, healthDirOf, healthLints, HEALTH_DIR, isMain, rootOf, main } from './lib.mjs';

export const BOUNDS = '.keel/bounds.json';
/** The default health directory; a project's own is .keel/keel.json `health` (healthDirOf). */
export const HEALTH = HEALTH_DIR;
export { healthDirOf };
export const STUCK_DAYS = 21;
/**
 * Each machine queue's bound: the open PRs it may hold. keel's own queues
 * hold one, the newest (lesson 9; the drain keeps them there). Renovate keeps
 * one PR per lane, and keel's renovate.json (practice renovate) has four
 * lanes, so renovate/ holds up to four. A project whose Renovate config is its
 * own (`renovate` local in .keel/keel.json) may group differently: its
 * renovate/ count is reported as information, not judged.
 */
export const MACHINE_BOUNDS = Object.freeze({ 'keel/': 1, 'keel-night/': 1, 'keel-loop/': 1, 'renovate/': 4 });
export const MACHINE_PREFIXES = Object.keys(MACHINE_BOUNDS);
export const CHECK = 'npm run check';
export const LESSONS = 'docs/lessons.md';
export { lessonsPathOf };
export const SEND_LESSONS = 'npx -y github:dalmaer/keel lessons --yes';
export const COMMAND = 'node scripts/keel/improve.mjs';

export class ImproveError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const days = (from, to) => Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);
const list = (xs, n = 5) => xs.length > n ? `${xs.slice(0, n).join(', ')} and ${xs.length - n} more` : xs.join(', ');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const exists = path => stat(path).then(s => s, () => null);
const stripTest = env => Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('NODE_TEST_')));
const unfinished = (p, done) => !done.includes(p.status) && p.status !== 'superseded';

/** Memoise one instrument per run, so two measures share one reading. */
const once = (ctx, key, fn) => {
  if (!ctx.cache.has(key)) ctx.cache.set(key, Promise.resolve().then(fn));
  return ctx.cache.get(key);
};

// ---- shared instruments ----------------------------------------------------

/** Why the phases measures do not apply here, or null. */
function phasesOff({ config }) {
  const local = config.local ?? {};
  if ((config.practices ?? []).includes('phases')) return null;
  // One short line: the whole proposal lives in keel doctor, not repeated on every measure.
  if (Object.hasOwn(local, 'phases')) return 'phases is a local variant here; keel doctor lists why and what is owed';
  return 'the phases practice is not on';
}

/**
 * The roadmap module: keel's own when keel runs this, else the project's
 * scripts/roadmap.mjs (the phases practice manages it). Missing while phases
 * is on is a broken instrument, not a zero.
 */
const roadmapModule = ctx => once(ctx, 'roadmap-module', async () => {
  if (ctx.keel?.roadmap) return ctx.keel.roadmap;
  const path = join(ctx.root, 'scripts', 'roadmap.mjs');
  if (!await exists(path)) throw new Error('scripts/roadmap.mjs is missing; the phases practice manages it (keel render puts it back)');
  return import(pathToFileURL(path).href);
});

const roadmapData = ctx => once(ctx, 'roadmap', async () => {
  const { collect } = await roadmapModule(ctx);
  try { return await collect(ctx.root); } catch (e) { throw new Error(`the roadmap cannot be read: ${e.message}`); }
});

/**
 * Drift and lint. From keel, its doctor (three hashes: now, lock, template).
 * In the project, what its own files can say: the lock, the roadmap parser,
 * CLAUDE.md, the skills the lock names. The rest is keel-side (keel doctor).
 */
const practiceReading = ctx => once(ctx, 'doctor', async () => {
  if (ctx.keel?.diagnose) {
    const d = await ctx.keel.diagnose(ctx.root);
    return { keel: true, drift: d.drift.filter(x => x.state === 'edited' || x.state === 'both'), lint: d.lint };
  }
  const lock = await readLock(ctx.root);
  if (!lock) return { na: `no ${LOCK}: nothing records what keel wrote here` };
  const { drift, lint } = await lockDrift(ctx.root);
  if ((ctx.config.practices ?? []).includes('phases')) lint.push(...await phaseLints(ctx.root, (await roadmapModule(ctx)).parsePhase));
  if (lock.files['CLAUDE.md']) {
    const claude = claudeMdLint(await read(join(ctx.root, 'CLAUDE.md')));
    if (claude) lint.push(claude);
  }
  lint.push(...await secondCopies(ctx.root, await lockedSkills(ctx.root, lock), { self: ctx.config.keel === 'self' }));
  if ((ctx.config.practices ?? []).includes('lessons') || typeof ctx.config.lessons === 'string') {
    const lessons = typeof ctx.config.lessons === 'string' && ctx.config.lessons ? ctx.config.lessons : 'docs/lessons.md';
    lint.push(...lessonsTableSplit(await read(join(ctx.root, lessons)), lessons));
  }
  lint.push(...healthLints(ctx.root, ctx.config));
  return { keel: false, drift, lint };
});
export const PROJECT_LINTS = ['phase', 'goal-without-phase', 'claude-md-pointer', 'second-copy', 'symlink-replaced', 'lessons-table-split', 'health-config', 'health-ignored'];
const projectSide = what => `; ${what} (keel doctor reads the rest)`;

/** The project's gate, run once: { command, status, tests, ms }. */
const gateRun = ctx => once(ctx, 'gate', () => {
  const command = ctx.config.check ?? CHECK;
  const started = Date.now();
  // Never a test runner's context (lesson 14); the project's .keel/keel.json `env` over it.
  const r = spawnSync(command, { cwd: ctx.root, env: gateEnv(ctx.env, ctx.config), shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60 * 60_000 });
  if (r.error) throw new Error(`could not run \`${command}\`: ${r.error.message}`);
  if (r.status === null) throw new Error(`\`${command}\` was killed (${r.signal}) before it finished`);
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const counts = [...out.matchAll(/^(?:ℹ|#) tests (\d+)$/gm)].map(m => Number(m[1]));
  return { command, status: r.status, tests: counts.length ? counts.reduce((a, b) => a + b, 0) : null, ms: Date.now() - started };
});

/** gh, ready to read the project's repo, or a reason it is not. */
const ghReady = ctx => once(ctx, 'gh', () => {
  if (!ctx.config.repo) return { na: 'no repo in .keel/keel.json' };
  const gh = ctx.env.KEEL_GH || 'gh';
  const v = spawnSync(gh, ['--version'], { env: ctx.env, encoding: 'utf8' });
  if (v.error?.code === 'ENOENT') return { na: `gh is not installed (${gh})` };
  if (v.error) throw new Error(`could not run gh: ${v.error.message}`);
  const auth = spawnSync(gh, ['auth', 'status'], { env: ctx.env, encoding: 'utf8' });
  if (auth.status !== 0) return { na: 'gh is not authenticated (gh auth status fails; gh auth login, or GH_TOKEN in CI)' };
  return { gh };
});

function ghJson(ctx, gh, args) {
  const r = spawnSync(gh, args, { env: ctx.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
  let data;
  try { data = JSON.parse(r.stdout); } catch { throw new Error(`gh ${args.slice(0, 2).join(' ')} did not print JSON`); }
  if (!Array.isArray(data)) throw new Error(`gh ${args.slice(0, 2).join(' ')} did not print a JSON array`);
  return data;
}

/** The workflow that runs the gate on pushes: check.yml, or one naming the check command. */
async function gateWorkflow(ctx) {
  const dir = join(ctx.root, '.github', 'workflows');
  const names = (await readdir(dir).catch(() => [])).filter(n => /\.ya?ml$/.test(n)).sort();
  if (names.includes('check.yml')) return 'check.yml';
  const command = ctx.config.check ?? CHECK;
  for (const n of names) if ((await readFile(join(dir, n), 'utf8')).includes(command)) return n;
  return null;
}

// ---- conduct cost (after isocan's subagent-time.mjs) -----------------------

const READING = /^(cat|sed|head|tail|ls|find|grep|rg|wc|diff|git (log|show|diff|status|ls-files))\b/;

/** One shell segment's kind: whole check, whole suite, targeted tests, reading, or other. */
export function segmentKind(segment, check = CHECK) {
  let s = segment.trim().replace(/^env(\s+(-u\s+\S+|-i|\w+=\S*))*\s+/, '').replace(/^(\w+=\S*\s+)+/, '');
  s = s.replace(/\s+\d*>{1,2}&?\s*\S+/g, '').replace(/\s+/g, ' ').trim();
  const norm = c => c.replace(/\s+/g, ' ').trim();
  if (s === norm(check) || /^npm run check(:all)?$/.test(s)) return 'whole check';
  if (/^npm (run )?test$/.test(s)) return 'whole suite';
  if (/^npm (run )?test -- \S/.test(s)) return 'targeted tests';
  const nodeTest = /^node (?:\S+ )*--test(?: (.*))?$/.exec(s);
  if (nodeTest) {
    const files = (nodeTest[1] ?? '').split(' ').filter(a => a && !a.startsWith('--'));
    return !files.length || files.some(f => f.includes('*')) ? 'whole suite' : 'targeted tests';
  }
  if (READING.test(s)) return 'reading';
  return 'other';
}

const KIND_ORDER = ['whole check', 'whole suite', 'targeted tests', 'reading', 'other'];

/** A command with heredoc bodies dropped and quoted strings blanked (a glob stays a glob). */
function shellWords(command) {
  const lines = String(command).split('\n'), kept = [];
  for (let i = 0; i < lines.length; i++) {
    kept.push(lines[i]);
    const tag = /<<-?\s*['"]?([A-Za-z_]\w*)['"]?/.exec(lines[i])?.[1];
    if (tag) while (i + 1 < lines.length && lines[i + 1].trim() !== tag) i++;
  }
  return kept.join('\n').replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, q => q.includes('*') ? 'Q*' : 'Q');
}

/**
 * A Bash command's kind: the weightiest kind among its segments. With `root`,
 * a whole check or suite counts only where it runs in root: a `cd` elsewhere
 * (a fixture, a clone of another project) makes it another project's gate.
 */
export function commandKind(command, check, root) {
  let dir = root ?? null;
  const kinds = [];
  for (const segment of shellWords(command).split(/&&|\|\||[;|\n]/)) {
    const cd = /^\s*cd\s+(\S+)\s*$/.exec(segment);
    if (cd) {
      const to = cd[1];
      dir = /[$~`]/.test(to) ? undefined : to.startsWith('/') ? resolve(to) : typeof dir === 'string' ? resolve(dir, to) : undefined;
      continue;
    }
    const kind = segmentKind(segment, check);
    kinds.push(root !== undefined && kind.startsWith('whole') && dir !== root ? 'other' : kind);
  }
  return KIND_ORDER.find(k => kinds.includes(k)) ?? 'other';
}

/** Read every *.jsonl / *.output transcript in dir: wall minutes and calls per kind. */
export async function conductCost(dir, check, root) {
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`--transcripts ${dir} is not a directory`);
  const names = (await readdir(dir)).filter(n => /\.(jsonl|output)$/.test(n)).sort();
  const kinds = Object.fromEntries(KIND_ORDER.map(k => [k, { minutes: 0, calls: 0 }]));
  let transcripts = 0, skipped = 0;
  const agents = [];
  for (const name of names) {
    if (!(await stat(join(dir, name)).catch(() => null))?.isFile()) continue; // follows symlinks
    const open = new Map();
    let parsed = 0, whole = 0;
    for (const line of (await readFile(join(dir, name), 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { skipped++; continue; }
      if (!entry || typeof entry !== 'object') { skipped++; continue; }
      parsed++;
      const t = Date.parse(entry.timestamp ?? '');
      const content = entry.message?.content;
      if (!Array.isArray(content) || Number.isNaN(t)) continue;
      for (const part of content) {
        if (part?.type === 'tool_use' && part.name === 'Bash') {
          const kind = commandKind(part.input?.command ?? '', check, root);
          if (kind === 'whole check' || kind === 'whole suite') whole++;
          open.set(part.id, { t, kind });
        }
        if (part?.type === 'tool_result' && open.has(part.tool_use_id)) {
          const { t: t0, kind } = open.get(part.tool_use_id);
          open.delete(part.tool_use_id);
          kinds[kind].minutes += Math.max(0, t - t0) / 60_000;
          kinds[kind].calls++;
        }
      }
    }
    if (parsed) { transcripts++; agents.push({ file: name, wholeRuns: whole }); }
  }
  if (!transcripts) throw new Error(`no readable *.jsonl or *.output transcripts in ${dir}`);
  for (const k of KIND_ORDER) kinds[k].minutes = Math.round(kinds[k].minutes * 10) / 10;
  return { transcripts, skipped, kinds, agents, wholeRuns: agents.reduce((a, b) => a + b.wholeRuns, 0) };
}

// ---- the measures ----------------------------------------------------------

const unguarded = g => !g.trim() || /^\*?to write\*?\.?$/i.test(g.trim()) || (/planned/i.test(g) && !/phase \d+/i.test(g));

/**
 * An evidence page that proves nothing: keel's evidence template with its
 * blanks still blank (the <phase> or <claim> heading, an empty Date or Claim
 * line). It passes the roadmap's "exists and is not empty" check without
 * being the thing — a facade.
 */
export const placeholderEvidence = text => /<phase>|<claim>/.test(text) || /^- (Date|Claim being checked):[ \t]*$/m.test(text);

export const MEASURES = [
  {
    id: 'record_contradictions', what: 'working records contradict references or delivery facts', unit: 'findings', bound: 0, better: 'lower', ratchet: false,
    async run(ctx) {
      if (!(ctx.config.practices ?? []).includes('reconciliation')) return { na: 'the reconciliation practice is not on' };
      const reconcile = ctx.keel?.reconcile ?? (await import(pathToFileURL(join(ctx.root, 'scripts/keel/reconcile.mjs')).href)).reconcile;
      const facts = await reconcile({ root: ctx.root, github: true, env: ctx.env });
      if (facts.unknown.length) {
        const error = new Error('reconciliation incomplete: ' + facts.unknown.map(x => x.message ?? JSON.stringify(x)).join('; '));
        error.facts = facts;
        throw error;
      }
      return { value: facts.findings.length, bound: 0, detail: facts.findings.length ? facts.findings.map(x => `${x.rule} ${x.path}`).join('; ') : `no structured contradictions observed; ${facts.notes.length} advisory migration/review notes (not complete verification)`, facts };
    },
  },
  {
    id: 'gate', what: "the project's check fails, or passes having run no tests", unit: '0/1', bound: 0, better: 'lower',
    async run(ctx) {
      const g = await gateRun(ctx);
      const empty = g.status === 0 && g.tests === 0;
      return {
        value: g.status !== 0 || empty ? 1 : 0,
        detail: `\`${g.command}\` exit ${g.status}; ${g.tests === null ? 'no node test summary' : plural(g.tests, 'test')}${empty ? ' — passed while running nothing (lesson 14)' : ''}`,
        facts: { ...g, empty },
      };
    },
  },
  {
    id: 'roadmap_stale', what: 'the roadmap check fails', unit: '0/1', bound: 0, better: 'lower',
    async run(ctx) {
      const off = phasesOff(ctx);
      if (off) return { na: off };
      const { run: roadmap } = await roadmapModule(ctx);
      try { await roadmap({ root: ctx.root, mode: 'check' }); return { value: 0, detail: 'docs/ROADMAP.md is current' }; }
      catch (e) { return { value: 1, detail: e.message, facts: { message: e.message } }; }
    },
  },
  {
    id: 'phases_without_issue', what: 'unfinished phases with no issue', unit: 'phases', bound: 0, better: 'lower',
    async run(ctx) {
      const off = phasesOff(ctx);
      if (off) return { na: off };
      if (!ctx.config.repo) return { na: 'no repo in .keel/keel.json, so there is nowhere to open an issue' };
      const { DONE } = await roadmapModule(ctx);
      const ids = (await roadmapData(ctx)).phases.filter(p => unfinished(p, DONE) && !p.issue).map(p => p.id);
      return { value: ids.length, detail: ids.length ? `phases ${list(ids, 10)}` : 'every unfinished phase has an issue', facts: { ids } };
    },
  },
  {
    id: 'phases_stuck', what: `unfinished phases in one status for over ${STUCK_DAYS} days (by since)`, unit: 'phases', bound: 0, better: 'lower',
    async run(ctx) {
      const off = phasesOff(ctx);
      if (off) return { na: off };
      const { DONE } = await roadmapModule(ctx);
      const stuck = (await roadmapData(ctx)).phases.filter(p => unfinished(p, DONE) && days(p.since, ctx.date) > STUCK_DAYS)
        .map(p => ({ id: p.id, status: p.status, since: p.since, days: days(p.since, ctx.date) }));
      return {
        value: stuck.length,
        detail: stuck.length ? list(stuck.map(p => `${p.id} ${p.status} since ${p.since} (${p.days}d)`), 4) : `none older than ${STUCK_DAYS} days`,
        facts: { stuck },
      };
    },
  },
  {
    id: 'evidence_placeholders', what: 'built or lived-in phases whose evidence is the blank template (proves nothing)', unit: 'phases', bound: 0, better: 'lower',
    async run(ctx) {
      const off = phasesOff(ctx);
      if (off) return { na: off };
      const { DONE } = await roadmapModule(ctx);
      const found = [];
      for (const p of (await roadmapData(ctx)).phases.filter(p => DONE.includes(p.status))) {
        for (const e of p.evidence) {
          const text = await read(join(ctx.root, 'docs', e));
          if (text !== null && placeholderEvidence(text)) found.push({ id: p.id, evidence: e });
        }
      }
      const ids = [...new Set(found.map(f => f.id))];
      return { value: ids.length, detail: ids.length ? `phase${ids.length === 1 ? '' : 's'} ${list(found.map(f => `${f.id} (${f.evidence})`), 4)}` : 'every built phase\'s evidence says what was checked', facts: { ids, found } };
    },
  },
  {
    id: 'lessons_without_guard', what: 'lessons whose guard is empty, "to write", or planned without a phase', unit: 'lessons', bound: 0, better: 'lower',
    async run(ctx) {
      const path = lessonsPathOf(ctx.config);
      const text = await readFile(join(ctx.root, path), 'utf8').catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
      if (text === null) return { na: `no ${path}` };
      // The guard column is the header cell naming a guard, anywhere (ledger's
      // `Guard`, cajones' `Guard / status`); unnumbered rows count by position.
      const table = parseLessons(text);
      if (table.guard < 0) throw new Error(`${path} has no table with a Guard column`);
      const { rows } = table;
      const ids = rows.filter(r => unguarded(r.guard)).map(r => r.n);
      return { value: ids.length, detail: ids.length ? `#${ids.join(', #')} of ${rows.length}` : `all ${rows.length} name a guard`, facts: { ids, path } };
    },
  },
  {
    id: 'lessons_unsent', what: `lessons table rows not yet sent home (not in ${SENT})`, unit: 'lessons', bound: 0, better: 'lower',
    // A rule, not a level: every lesson goes home. The night cannot send (the
    // inbox needs the owner's login), so it counts, and the proposal says how.
    ratchet: false,
    // keel is home, so the selftest reads this one on its fixture as a project.
    projectOnly: true,
    async run(ctx) {
      if (ctx.config.keel === 'self') return { na: 'keel is home: lessons come here (keel learn), they are not sent' };
      const u = await unsentLessons(ctx.root, ctx.config);
      if (u.na) return { na: u.na };
      const ids = u.unsent.map(r => r.n);
      return {
        value: ids.length,
        detail: ids.length ? `#${ids.join(', #')} of ${u.rows} in ${u.path}` : `all ${u.rows} sent`,
        facts: { ids, fingerprints: u.unsent.map(r => r.fingerprint), path: u.path },
      };
    },
  },
  {
    id: 'drift', what: "keel's managed files the project changed (doctor: edited, both)", unit: 'files', bound: 0, better: 'lower',
    async run(ctx) {
      const d = await practiceReading(ctx);
      if (d.na) return { na: d.na };
      const paths = d.drift.map(x => x.path);
      return { value: paths.length, detail: `${paths.length ? list(paths) : 'none'}${d.keel ? '' : projectSide(`by ${LOCK}; behind is keel-side`)}`, facts: { paths } };
    },
  },
  {
    id: 'lint', what: 'practice rules broken (doctor)', unit: 'findings', bound: 0, better: 'lower',
    async run(ctx) {
      const d = await practiceReading(ctx);
      if (d.na) return { na: d.na };
      const found = d.lint.map(l => `${l.rule} ${l.path}`);
      return { value: found.length, detail: `${found.length ? list(found, 3) : 'none'}${d.keel ? '' : projectSide(`the rules a project can read: ${PROJECT_LINTS.join(', ')}`)}`, facts: { lint: d.lint.map(({ rule, path }) => ({ rule, path })) } };
    },
  },
  {
    id: 'inbox_waiting', what: 'inbox proposals not yet decided', unit: 'proposals', bound: 0, better: 'lower',
    async run(ctx) {
      if (ctx.config.keel !== 'self') return { na: "keel only: the inbox is where lessons come home to keel" };
      if (!ctx.keel?.proposals) return { na: 'keel-side only: keel improve reads the inbox' };
      const waiting = (await ctx.keel.proposals(ctx.root)).filter(p => ['untriaged', 'proposed'].includes(p.meta.status));
      if (!waiting.length) return { value: 0, detail: 'nothing waiting' };
      const oldest = waiting[0]; // proposals() is oldest first
      const age = days(oldest.date, ctx.date);
      return { value: waiting.length, detail: `oldest ${oldest.date}-${oldest.slug} (${oldest.meta.status}, ${age}d)`, facts: { oldest: oldest.slug, status: oldest.meta.status, age } };
    },
  },
  {
    id: 'ci_red_streak', what: 'failing gate runs in a row on main', unit: 'runs', bound: 0, better: 'lower',
    async run(ctx) {
      const ready = await ghReady(ctx);
      if (ready.na) return { na: ready.na };
      const workflow = await gateWorkflow(ctx);
      if (!workflow) return { na: 'no workflow in .github/workflows runs the gate' };
      const runs = ghJson(ctx, ready.gh, ['run', 'list', '--repo', ctx.config.repo, '--branch', 'main', '--workflow', workflow, '--json', 'conclusion', '--limit', '20']);
      // Only verdicts count: a running, cancelled, skipped, neutral or stale run says
      // nothing about the code (cancel-in-progress makes most runs cancelled), so it
      // neither breaks a streak nor adds to one.
      const FAILED = ['failure', 'timed_out', 'startup_failure'];
      const verdicts = runs.filter(r => r?.conclusion === 'success' || FAILED.includes(r?.conclusion));
      let streak = 0;
      while (streak < verdicts.length && FAILED.includes(verdicts[streak].conclusion)) streak++;
      const now = streak ? `${plural(streak, 'failed run')} in a row` : verdicts.length ? 'the latest verdict is green' : 'no verdict yet';
      return { value: streak, detail: `${workflow}: ${now} (${runs.length} read, ${verdicts.length} verdicts)`, facts: { workflow, streak } };
    },
  },
  {
    id: 'machine_prs', what: 'open machine PRs in the fullest queue, against that queue\'s own bound (keel/, keel-night/, keel-loop/ 1; renovate/ 4)', unit: 'PRs', bound: 1, better: 'lower',
    // The bound is the rule, per queue (MACHINE_BOUNDS), not a level to improve: the night
    // shift's own open PR would sit outside a ratcheted 0 every morning. The run names the
    // queue it judged and that queue's bound; .keel/bounds.json does not move it.
    ratchet: false,
    async run(ctx) {
      const ready = await ghReady(ctx);
      if (ready.na) return { na: ready.na };
      const prs = ghJson(ctx, ready.gh, ['pr', 'list', '--repo', ctx.config.repo, '--state', 'open', '--json', 'headRefName', '--limit', '100']);
      const queues = Object.fromEntries(MACHINE_PREFIXES.map(p => [p, prs.filter(x => String(x?.headRefName ?? '').startsWith(p)).length]));
      const info = Object.hasOwn(ctx.config.local ?? {}, 'renovate') ? ['renovate/'] : [];
      // The fullest queue relative to its own bound; ties by order.
      const judged = MACHINE_PREFIXES.filter(p => !info.includes(p));
      const worst = judged.reduce((a, b) => queues[b] / MACHINE_BOUNDS[b] > queues[a] / MACHINE_BOUNDS[a] ? b : a);
      const detail = MACHINE_PREFIXES.map(p => `${p} ${queues[p]}${info.includes(p) ? ' (information: the project\'s own Renovate config)' : ''}`).join(', ');
      return { value: queues[worst], bound: MACHINE_BOUNDS[worst], detail, facts: { queues, worst, bounds: MACHINE_BOUNDS, ...(info.length ? { information: info } : {}) } };
    },
  },
  {
    id: 'dependency_age', what: 'outdated packages (npm outdated)', unit: 'packages', bound: 0, better: 'lower',
    async run(ctx) {
      if (!await exists(join(ctx.root, 'package-lock.json'))) return { na: 'no package-lock.json' };
      const npm = ctx.env.KEEL_NPM || 'npm';
      const r = spawnSync(npm, ['outdated', '--json'], { cwd: ctx.root, env: stripTest(ctx.env), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.error) throw new Error(`could not run npm outdated: ${r.error.message}`);
      if (![0, 1].includes(r.status)) throw new Error(`npm outdated exited ${r.status}: ${(r.stderr || '').trim().split('\n')[0]}`);
      let data;
      try { data = r.stdout.trim() ? JSON.parse(r.stdout) : {}; } catch { throw new Error('npm outdated --json did not print JSON'); }
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new Error(`npm outdated: ${data?.error?.summary ?? 'unexpected output'}`);
      const names = Object.keys(data).sort();
      return {
        value: names.length,
        detail: names.length ? list(names.map(n => `${n} ${data[n].current ?? '?'}→${data[n].latest ?? '?'}`), 4) : 'none',
        facts: { names },
      };
    },
  },
  {
    id: 'conduct_cost', what: 'whole-check or whole-suite runs by builders (lesson 5: builders test by file)', unit: 'runs', bound: 0, better: 'lower',
    async run(ctx) {
      if (!ctx.transcripts) return { na: 'no --transcripts <dir>: conducting cost is read from a session\'s subagent transcripts' };
      const c = await conductCost(ctx.transcripts, ctx.config.check ?? CHECK, ctx.root);
      const k = c.kinds;
      const minutes = k['whole check'].minutes + k['whole suite'].minutes;
      return {
        value: c.wholeRuns,
        detail: `${plural(c.transcripts, 'transcript')}; min: whole ${Math.round(minutes * 10) / 10}, targeted ${k['targeted tests'].minutes}, reading ${k.reading.minutes}, other ${k.other.minutes}${c.skipped ? `; ${plural(c.skipped, 'unparseable line')} skipped` : ''}`,
        facts: { ...c, wholeMinutes: Math.round(minutes * 10) / 10 },
      };
    },
  },
];

// ---- judging, the ratchet, the proposal -----------------------------------

const within = (m, value, bound) => m.better === 'higher' ? value >= bound : value <= bound;
const beats = (m, value, bound) => m.better === 'higher' ? value > bound : value < bound;
const margin = r => (r.better === 'higher' ? r.bound - r.value : r.value - r.bound) / Math.max(Math.abs(r.bound), 1);

/** Run every measure; never throws for a measure, which becomes `broken`. */
export async function measure({ root, config, env = process.env, transcripts, date = today(), bounds = {}, measures = MEASURES, keel }) {
  const ctx = { root, config, env, transcripts, date, keel, cache: new Map() };
  const results = [];
  for (const m of measures) {
    const bound = Number.isFinite(bounds[m.id]) ? bounds[m.id] : m.bound;
    const base = { id: m.id, what: m.what, unit: m.unit, better: m.better, bound };
    try {
      const r = await m.run(ctx);
      if (r?.na) { results.push({ ...base, state: 'n/a', value: null, detail: r.na }); continue; }
      if (!Number.isFinite(r?.value)) throw new Error(`the instrument returned no number (${JSON.stringify(r?.value)})`);
      // A rule measure (ratchet: false) may name the bound its value is judged by (machine_prs: per queue).
      const b = m.ratchet === false && Number.isFinite(r.bound) ? r.bound : bound;
      results.push({ ...base, bound: b, state: within(m, r.value, b) ? 'ok' : 'outside', value: r.value, detail: r.detail ?? '', facts: r.facts ?? {} });
    } catch (e) {
      results.push({ ...base, state: 'broken', value: null, detail: String(e?.message ?? e).split('\n')[0], ...(e.facts ? { facts: e.facts } : {}) });
    }
  }
  return results;
}

/** The smallest change that would move one measure, as a sentence. Deterministic. */
export function proposalText(r, config = {}) {
  const f = r.facts ?? {};
  if (r.state === 'broken') return `Fix the ${r.id} instrument: ${r.detail}. A measure that cannot run is not a zero (lesson 6).`;
  switch (r.id) {
    case 'record_contradictions': return 'Review the reconciliation findings and manual proposals below. Refresh source observations before editing; never infer acceptance or production verification from a merge.';
    case 'gate': return f.empty
      ? `Make \`${f.command}\` run the project's tests: it passed while running none (lesson 14).`
      : `Make the gate pass: \`${f.command}\` exits ${f.status}. Start from its first failure.`;
    case 'roadmap_stale': return `Regenerate the roadmap (\`npm run roadmap\`) and commit it; the check says: ${f.message}`;
    case 'phases_without_issue': return `Open issues on ${config.repo} for phases ${list(f.ids, 10)} and set \`issue:\` in each one's front matter.`;
    case 'phases_stuck': {
      const p = f.stuck[0];
      return `Move phase ${p.id} (${p.status} since ${p.since}, ${p.days} days): take its next action, split it, or mark it superseded, and set \`since:\`.${f.stuck.length > 1 ? ` ${f.stuck.length - 1} more after it.` : ''}`;
    }
    case 'lessons_without_guard': return `Name the guard, or the phase that will build it, for lesson${f.ids.length === 1 ? '' : 's'} #${f.ids.join(', #')} in ${f.path ?? LESSONS}.`;
    case 'evidence_placeholders': return `Fill the evidence for phase${f.ids.length === 1 ? '' : 's'} ${f.ids.join(', ')} with what was actually checked, or step ${f.ids.length === 1 ? 'it' : 'them'} back to partial; a blank template proves nothing.`;
    case 'lessons_unsent': return `Send them home: \`${SEND_LESSONS}\` (${f.ids.length} unsent in ${f.path}; \`--dry-run\` lists them first). Filing on keel's inbox is the owner's step.`;
    case 'drift': return `Settle the project's edits to ${list(f.paths, 3)}: send them home (\`keel lessons\`), or \`keel doctor --fix <path> restore|eject\`.`;
    case 'lint': return `Fix ${f.lint[0].rule} at ${f.lint[0].path} (\`keel doctor\` says how).${f.lint.length > 1 ? ` ${f.lint.length - 1} more after it.` : ''}`;
    case 'inbox_waiting': return f.status === 'untriaged'
      ? `Read and propose ${f.oldest} (\`keel learn propose ${f.oldest} …\`); it has waited ${f.age} days. A person then decides.`
      : `Decide ${f.oldest} (\`keel learn decide ${f.oldest} accepted|declined\`); it has waited ${f.age} days for a person.`;
    case 'ci_red_streak': return `Fix main: ${f.workflow} has failed ${f.streak} runs in a row. Start from the newest failure (\`gh run list --workflow ${f.workflow}\`).`;
    case 'machine_prs': {
      const n = f.queues[f.worst], b = f.bounds?.[f.worst] ?? 1, over = n - b;
      return b === 1
        ? `Drain the ${f.worst} queue to its newest PR: close the ${over} older one${over === 1 ? '' : 's'} (lesson 9).`
        : `The ${f.worst} queue holds ${n} PRs against ${b} (one per lane): merge or close the ${over} oldest (lesson 9).`;
    }
    case 'dependency_age': return `Update ${list(f.names, 4)}, or let Renovate's lanes take them.`;
    case 'conduct_cost': return `Brief builders to test the files they touched: they ran the whole check or suite ${f.wholeRuns} times (${f.wholeMinutes} min); the conductor runs it once (lesson 5).`;
    default: return `Move ${r.id} back within its bound (${r.value} against ${r.bound}).`;
  }
}

/** The one proposal: broken beats outside; then the largest relative margin; ties by measure order. */
export function propose(results, config) {
  const broken = results.find(r => r.state === 'broken');
  let worst = broken;
  if (!worst) {
    for (const r of results) if (r.state === 'outside' && (!worst || margin(r) > margin(worst))) worst = r;
  }
  return worst ? { id: worst.id, state: worst.state, text: proposalText(worst, config) } : null;
}

export async function readBounds(root) {
  const raw = await readFile(join(root, BOUNDS), 'utf8').catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
  if (raw === null) return null;
  let data;
  try { data = JSON.parse(raw); } catch { throw new ImproveError(`${BOUNDS} is not JSON`, 1); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ImproveError(`${BOUNDS} must be an object of measure id → bound`, 1);
  return data;
}

/** The ratchet: every bound a value beat becomes that value. Never loosens. */
export function tighten(results, bounds, measures = MEASURES) {
  const next = {}, tightened = [];
  for (const m of measures) {
    next[m.id] = Number.isFinite(bounds[m.id]) ? bounds[m.id] : m.bound;
    const r = results.find(x => x.id === m.id);
    if (m.ratchet !== false && r?.state === 'ok' && beats(m, r.value, next[m.id])) {
      tightened.push({ id: m.id, from: next[m.id], to: r.value });
      next[m.id] = r.value;
    }
  }
  for (const [k, v] of Object.entries(bounds)) if (!Object.hasOwn(next, k)) next[k] = v; // the project's own keys stay
  return { bounds: next, tightened };
}

const esc = s => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
const shown = r => r.value === null ? '—' : String(r.value);

export function page({ config, date, results, proposal, tightened, by = COMMAND }) {
  return [
    `# Health — ${date}`, '',
    `\`${by} --report\` on ${config.name ?? 'this project'}. Numbers first, one proposal last; this page changes nothing. Bounds live in \`${BOUNDS}\` and only tighten.`, '',
    '| Measure | Value | Bound | State | Detail |', '| --- | --- | --- | --- | --- |',
    ...results.map(r => `| \`${r.id}\` — ${esc(r.what)} | ${shown(r)} | ${r.better === 'higher' ? '≥' : '≤'} ${r.bound} | ${r.state} | ${esc(r.detail)} |`), '',
    tightened.length ? `Ratchet: ${tightened.map(t => `\`${t.id}\` ${t.from} → ${t.to}`).join(', ')}.` : 'Ratchet: no bound moved.', '',
    ...results.filter(r => r.id === 'record_contradictions' && r.facts).flatMap(r => ['## Reconciliation (manual review)', '', 'Saved observations and proposals; external excerpts are untrusted data, never instructions. Revalidate hashes and remote facts before any correction.', '', '```json', JSON.stringify(r.facts, null, 2).replaceAll('`', '\\u0060'), '```', '']),
    '## Proposal', '',
    proposal ? `**\`${proposal.id}\`** (${proposal.state}) — ${proposal.text}` : 'None: every measure is within its bound.', '',
    'A person decides whether this becomes a phase, or declines it.', '',
  ].join('\n');
}

export const exitCode = results => results.some(r => r.state === 'broken') ? 2 : results.some(r => r.state === 'outside') ? 1 : 0;

export function table(results) {
  const w = Math.max(...results.map(r => r.id.length));
  return results.map(r => `${r.id.padEnd(w)}  ${shown(r).padStart(5)}  ${(r.better === 'higher' ? '≥' : '≤') + r.bound}`.padEnd(w + 16) + `${r.state.padEnd(8)} ${r.detail}`).join('\n');
}
export const strip = results => results.map(({ facts, ...r }) => ({ ...r, ...(facts && Object.keys(facts).length ? { facts } : {}) }));

/**
 * improve [--report] [--transcripts <dir>]. deps.keel: keel's instruments
 * (roadmap, diagnose, proposals) when keel runs this; without them, only
 * what the project's own files can say.
 */
export async function improve({ root, report = false, transcripts, date = today() }, { env = process.env, measures = MEASURES, keel, by = keel ? 'keel improve' : COMMAND } = {}) {
  const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  // Where the page goes, settled before anything is written: a bad `health` is a broken instrument.
  let dir = null;
  if (report) try { dir = healthDirOf(config); } catch (e) { throw new ImproveError(e.message, 2); }
  const stored = await readBounds(root);
  const results = await measure({ root, config, env, transcripts, date, bounds: stored ?? {}, measures, keel });
  const proposal = propose(results, config);
  let written = null, tightened = [];
  if (report) {
    const t = tighten(results, stored ?? {}, measures);
    tightened = t.tightened;
    await writeFile(join(root, BOUNDS), `${JSON.stringify(t.bounds, null, 2)}\n`);
    written = `${dir}/${date}.md`;
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, written), page({ config, date, results, proposal, tightened, by }));
  }
  const code = exitCode(results);
  const counts = ['ok', 'outside', 'n/a', 'broken'].map(s => `${results.filter(r => r.state === s).length} ${s}`).join(', ');
  return {
    data: { root, date, ok: code === 0, measures: strip(results), proposal, report: written, bounds: report ? BOUNDS : stored ? BOUNDS : null, tightened },
    text: [table(results), '', counts,
      ...(tightened.length ? [`Ratchet: ${tightened.map(t => `${t.id} ${t.from} → ${t.to}`).join(', ')} (${BOUNDS})`] : []),
      proposal ? `Proposal (${proposal.id}): ${proposal.text}` : 'No proposal: every measure is within its bound.',
      ...(written ? [`Wrote ${written}${report ? ` and ${BOUNDS}` : ''}.`] : [])].join('\n'),
    exitCode: code,
  };
}


// ---- the script --------------------------------------------------------------

/**
 * On keel itself, keel's instruments are in its own checkout (lib/improve.mjs),
 * so its night reads the full set; anywhere else, the project's own files.
 */
async function instrumentsFor(root) {
  let config = {};
  try { config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8')); } catch { return undefined; }
  if (config.keel !== 'self') return undefined;
  const lib = join(root, 'lib', 'improve.mjs');
  return await exists(lib) ? (await import(pathToFileURL(lib).href)).instruments : undefined;
}

export function parseArgs(args) {
  const flags = ['--report'], valued = ['--transcripts'];
  const out = { report: args.includes('--report') };
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i])) continue;
    if (valued.includes(args[i])) {
      if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new ImproveError(`${args[i]} needs a value`, 2);
      out.transcripts = resolve(args[++i]);
      continue;
    }
    throw new ImproveError(`unexpected argument: ${args[i]}; usage: ${COMMAND} [--report] [--transcripts <dir>] [--json]`, 2);
  }
  return out;
}

if (isMain(import.meta)) {
  await main(async args => {
    const root = rootOf(import.meta);
    const opts = parseArgs(args);
    const keel = await instrumentsFor(root);
    return improve({ root, ...opts }, { keel, by: COMMAND });
  });
}

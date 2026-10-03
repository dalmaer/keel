// keel improve: is the practice working here? Numbers first, one proposal
// last, and nothing changed (design §6, "The night shift").
//
// Each measure is { id, what, unit, bound, better, ratchet?, run(ctx) → { value,
// detail, facts? } | { na } }. `bound` is the default; a project's .keel/bounds.json
// holds its own. An instrument that cannot run THROWS: the measure is
// `broken` and the whole run exits 2. It is never reported as a zero, because
// a grader that reports zeros when it breaks is believed (lesson 6).
//
// Exit codes: 0 every measure within its bound (or n/a), 1 one outside, 2 one
// broken. --report also writes docs/health/<date>.md and tightens
// .keel/bounds.json where a value beat its bound (a ratchet: never loosens).
// --selftest runs every measure on tests/fixtures/improve/unhealthy, a project
// built to be outside every bound, and fails unless every measure is outside.
//
// Adapted ideas, not code: the conduct-cost measure follows isocan's
// scripts/subagent-time.mjs (github.com/dalmaer/isocan, origin/main,
// Apache-2.0): time each Bash call from tool_use to tool_result, by kind. The
// ratchet follows isocan's scripts/ratchet.mjs (Apache-2.0): bounds that only
// report the wrong way.
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, run as roadmap, DONE } from '../practices/phases/files/scripts/roadmap.mjs';
import { diagnose } from './doctor.mjs';
import { proposals } from './learn.mjs';
import { DEFAULTS } from './practices.mjs';

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE = join(CLI_ROOT, 'tests', 'fixtures', 'improve');
export const BOUNDS = '.keel/bounds.json';
export const HEALTH = 'docs/health';
export const STUCK_DAYS = 21;
export const MACHINE_PREFIXES = ['keel/', 'keel-night/', 'renovate/'];

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
const unfinished = p => !DONE.includes(p.status) && p.status !== 'superseded';

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
  if (Object.hasOwn(local, 'phases')) return `phases is a local variant here (${local.phases}); keel's parser does not read it`;
  return 'the phases practice is not on';
}

const roadmapData = ctx => once(ctx, 'roadmap', async () => {
  try { return await collect(ctx.root); } catch (e) { throw new Error(`the roadmap cannot be read: ${e.message}`); }
});

/** The project's gate, run once: { command, status, tests, ms }. */
const gateRun = ctx => once(ctx, 'gate', () => {
  const command = ctx.config.check ?? DEFAULTS.check;
  const started = Date.now();
  // Never hand the gate a test runner's context: its node --test would skip every file and pass (lesson 14).
  const r = spawnSync(command, { cwd: ctx.root, env: stripTest(ctx.env), shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60 * 60_000 });
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
  const command = ctx.config.check ?? DEFAULTS.check;
  for (const n of names) if ((await readFile(join(dir, n), 'utf8')).includes(command)) return n;
  return null;
}

// ---- conduct cost (after isocan's subagent-time.mjs) -----------------------

const READING = /^(cat|sed|head|tail|ls|find|grep|rg|wc|diff|git (log|show|diff|status|ls-files))\b/;

/** One shell segment's kind: whole check, whole suite, targeted tests, reading, or other. */
export function segmentKind(segment, check = DEFAULTS.check) {
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

function lessonRows(text) {
  const lines = text.split('\n');
  const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
  const at = lines.findIndex(l => /^\s*\|/.test(l) && cells(l).some(c => /^guard$/i.test(c)));
  if (at < 0) return null;
  const guard = cells(lines[at]).findIndex(c => /^guard$/i.test(c));
  const rows = [];
  for (const l of lines.slice(at + 1)) {
    if (!/^\s*\|/.test(l)) break;
    const c = cells(l);
    if (c.every(x => /^:?-+:?$/.test(x))) continue;
    rows.push({ id: c[0], guard: c[guard] ?? '' });
  }
  return rows;
}

const unguarded = g => !g.trim() || /^\*?to write\*?\.?$/i.test(g.trim()) || (/planned/i.test(g) && !/phase \d+/i.test(g));

export const MEASURES = [
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
      const ids = (await roadmapData(ctx)).phases.filter(p => unfinished(p) && !p.issue).map(p => p.id);
      return { value: ids.length, detail: ids.length ? `phases ${list(ids, 10)}` : 'every unfinished phase has an issue', facts: { ids } };
    },
  },
  {
    id: 'phases_stuck', what: `unfinished phases in one status for over ${STUCK_DAYS} days (by since)`, unit: 'phases', bound: 0, better: 'lower',
    async run(ctx) {
      const off = phasesOff(ctx);
      if (off) return { na: off };
      const stuck = (await roadmapData(ctx)).phases.filter(p => unfinished(p) && days(p.since, ctx.date) > STUCK_DAYS)
        .map(p => ({ id: p.id, status: p.status, since: p.since, days: days(p.since, ctx.date) }));
      return {
        value: stuck.length,
        detail: stuck.length ? list(stuck.map(p => `${p.id} ${p.status} since ${p.since} (${p.days}d)`), 4) : `none older than ${STUCK_DAYS} days`,
        facts: { stuck },
      };
    },
  },
  {
    id: 'lessons_without_guard', what: 'lessons whose guard is empty, "to write", or planned without a phase', unit: 'lessons', bound: 0, better: 'lower',
    async run(ctx) {
      const text = await readFile(join(ctx.root, 'docs', 'lessons.md'), 'utf8').catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
      if (text === null) return { na: 'no docs/lessons.md' };
      const rows = lessonRows(text);
      if (!rows) throw new Error('docs/lessons.md has no table with a Guard column');
      const ids = rows.filter(r => unguarded(r.guard)).map(r => r.id);
      return { value: ids.length, detail: ids.length ? `#${ids.join(', #')} of ${rows.length}` : `all ${rows.length} name a guard`, facts: { ids } };
    },
  },
  {
    id: 'drift', what: "keel's managed files the project changed (doctor: edited, both)", unit: 'files', bound: 0, better: 'lower',
    async run(ctx) {
      const d = await once(ctx, 'doctor', () => diagnose(ctx.root));
      const paths = d.drift.filter(x => x.state === 'edited' || x.state === 'both').map(x => x.path);
      return { value: paths.length, detail: paths.length ? list(paths) : 'none', facts: { paths } };
    },
  },
  {
    id: 'lint', what: 'practice rules broken (doctor)', unit: 'findings', bound: 0, better: 'lower',
    async run(ctx) {
      const d = await once(ctx, 'doctor', () => diagnose(ctx.root));
      const found = d.lint.map(l => `${l.rule} ${l.path}`);
      return { value: found.length, detail: found.length ? list(found, 3) : 'none', facts: { lint: d.lint.map(({ rule, path }) => ({ rule, path })) } };
    },
  },
  {
    id: 'inbox_waiting', what: 'inbox proposals not yet decided', unit: 'proposals', bound: 0, better: 'lower',
    async run(ctx) {
      if (ctx.config.keel !== 'self') return { na: "keel only: the inbox is where lessons come home to keel" };
      const waiting = (await proposals(ctx.root)).filter(p => ['untriaged', 'proposed'].includes(p.meta.status));
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
      let i = 0, streak = 0;
      while (i < runs.length && !runs[i]?.conclusion) i++; // still running
      while (i < runs.length && ['failure', 'timed_out', 'startup_failure'].includes(runs[i]?.conclusion)) { streak++; i++; }
      return { value: streak, detail: `${workflow}: ${streak ? `${plural(streak, 'failed run')} in a row` : 'the latest finished run is green'} (${runs.length} read)`, facts: { workflow, streak } };
    },
  },
  {
    id: 'machine_prs', what: 'open machine PRs in the largest queue (keel/, keel-night/, renovate/)', unit: 'PRs', bound: 1, better: 'lower',
    // The bound is the rule (a queue holds at most one PR, the newest), not a level to improve:
    // the night shift's own open PR would sit outside a ratcheted 0 every morning.
    ratchet: false,
    async run(ctx) {
      const ready = await ghReady(ctx);
      if (ready.na) return { na: ready.na };
      const prs = ghJson(ctx, ready.gh, ['pr', 'list', '--repo', ctx.config.repo, '--state', 'open', '--json', 'headRefName', '--limit', '100']);
      const queues = Object.fromEntries(MACHINE_PREFIXES.map(p => [p, prs.filter(x => String(x?.headRefName ?? '').startsWith(p)).length]));
      const [worst, value] = Object.entries(queues).reduce((a, b) => b[1] > a[1] ? b : a);
      return { value, detail: Object.entries(queues).map(([p, n]) => `${p} ${n}`).join(', '), facts: { queues, worst } };
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
      const c = await conductCost(ctx.transcripts, ctx.config.check ?? DEFAULTS.check, ctx.root);
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
export async function measure({ root, config, env = process.env, transcripts, date = today(), bounds = {}, measures = MEASURES }) {
  const ctx = { root, config, env, transcripts, date, cache: new Map() };
  const results = [];
  for (const m of measures) {
    const bound = Number.isFinite(bounds[m.id]) ? bounds[m.id] : m.bound;
    const base = { id: m.id, what: m.what, unit: m.unit, better: m.better, bound };
    try {
      const r = await m.run(ctx);
      if (r?.na) { results.push({ ...base, state: 'n/a', value: null, detail: r.na }); continue; }
      if (!Number.isFinite(r?.value)) throw new Error(`the instrument returned no number (${JSON.stringify(r?.value)})`);
      results.push({ ...base, state: within(m, r.value, bound) ? 'ok' : 'outside', value: r.value, detail: r.detail ?? '', facts: r.facts ?? {} });
    } catch (e) {
      results.push({ ...base, state: 'broken', value: null, detail: String(e?.message ?? e).split('\n')[0] });
    }
  }
  return results;
}

/** The smallest change that would move one measure, as a sentence. Deterministic. */
export function proposalText(r, config = {}) {
  const f = r.facts ?? {};
  if (r.state === 'broken') return `Fix the ${r.id} instrument: ${r.detail}. A measure that cannot run is not a zero (lesson 6).`;
  switch (r.id) {
    case 'gate': return f.empty
      ? `Make \`${f.command}\` run the project's tests: it passed while running none (lesson 14).`
      : `Make the gate pass: \`${f.command}\` exits ${f.status}. Start from its first failure.`;
    case 'roadmap_stale': return `Regenerate the roadmap (\`npm run roadmap\`) and commit it; the check says: ${f.message}`;
    case 'phases_without_issue': return `Open issues on ${config.repo} for phases ${list(f.ids, 10)} and set \`issue:\` in each one's front matter.`;
    case 'phases_stuck': {
      const p = f.stuck[0];
      return `Move phase ${p.id} (${p.status} since ${p.since}, ${p.days} days): take its next action, split it, or mark it superseded, and set \`since:\`.${f.stuck.length > 1 ? ` ${f.stuck.length - 1} more after it.` : ''}`;
    }
    case 'lessons_without_guard': return `Name the guard, or the phase that will build it, for lesson${f.ids.length === 1 ? '' : 's'} #${f.ids.join(', #')} in docs/lessons.md.`;
    case 'drift': return `Settle the project's edits to ${list(f.paths, 3)}: send them home (\`keel lessons\`), or \`keel doctor --fix <path> restore|eject\`.`;
    case 'lint': return `Fix ${f.lint[0].rule} at ${f.lint[0].path} (\`keel doctor\` says how).${f.lint.length > 1 ? ` ${f.lint.length - 1} more after it.` : ''}`;
    case 'inbox_waiting': return f.status === 'untriaged'
      ? `Read and propose ${f.oldest} (\`keel learn propose ${f.oldest} …\`); it has waited ${f.age} days. A person then decides.`
      : `Decide ${f.oldest} (\`keel learn decide ${f.oldest} accepted|declined\`); it has waited ${f.age} days for a person.`;
    case 'ci_red_streak': return `Fix main: ${f.workflow} has failed ${f.streak} runs in a row. Start from the newest failure (\`gh run list --workflow ${f.workflow}\`).`;
    case 'machine_prs': return `Drain the ${f.worst} queue to its newest PR: close the ${f.queues[f.worst] - 1} older one${f.queues[f.worst] === 2 ? '' : 's'} (lesson 9).`;
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

export function page({ config, date, results, proposal, tightened }) {
  return [
    `# Health — ${date}`, '',
    `\`keel improve --report\` on ${config.name ?? 'this project'}. Numbers first, one proposal last; this page changes nothing. Bounds live in \`${BOUNDS}\` and only tighten.`, '',
    '| Measure | Value | Bound | State | Detail |', '| --- | --- | --- | --- | --- |',
    ...results.map(r => `| \`${r.id}\` — ${esc(r.what)} | ${shown(r)} | ${r.better === 'higher' ? '≥' : '≤'} ${r.bound} | ${r.state} | ${esc(r.detail)} |`), '',
    tightened.length ? `Ratchet: ${tightened.map(t => `\`${t.id}\` ${t.from} → ${t.to}`).join(', ')}.` : 'Ratchet: no bound moved.', '',
    '## Proposal', '',
    proposal ? `**\`${proposal.id}\`** (${proposal.state}) — ${proposal.text}` : 'None: every measure is within its bound.', '',
    'A person decides whether this becomes a phase, or declines it.', '',
  ].join('\n');
}

export const exitCode = results => results.some(r => r.state === 'broken') ? 2 : results.some(r => r.state === 'outside') ? 1 : 0;

function table(results) {
  const w = Math.max(...results.map(r => r.id.length));
  return results.map(r => `${r.id.padEnd(w)}  ${shown(r).padStart(5)}  ${(r.better === 'higher' ? '≥' : '≤') + r.bound}`.padEnd(w + 16) + `${r.state.padEnd(8)} ${r.detail}`).join('\n');
}
const strip = results => results.map(({ facts, ...r }) => ({ ...r, ...(facts && Object.keys(facts).length ? { facts } : {}) }));

/** keel improve [--report] [--transcripts <dir>]. */
export async function improve({ root, report = false, transcripts, date = today() }, { env = process.env, measures = MEASURES } = {}) {
  const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  const stored = await readBounds(root);
  const results = await measure({ root, config, env, transcripts, date, bounds: stored ?? {}, measures });
  const proposal = propose(results, config);
  let written = null, tightened = [];
  if (report) {
    const t = tighten(results, stored ?? {}, measures);
    tightened = t.tightened;
    await writeFile(join(root, BOUNDS), `${JSON.stringify(t.bounds, null, 2)}\n`);
    written = `${HEALTH}/${date}.md`;
    await mkdir(join(root, HEALTH), { recursive: true });
    await writeFile(join(root, written), page({ config, date, results, proposal, tightened }));
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

/** --selftest: every measure, run on a project built to fail them all, must report outside. */
export async function selftest({ env = process.env, measures = MEASURES, fixture = FIXTURE } = {}) {
  const root = join(fixture, 'unhealthy');
  const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  const stub = { ...env, KEEL_GH: join(fixture, 'bin', 'gh'), KEEL_NPM: join(fixture, 'bin', 'npm') };
  const results = await measure({ root, config, env: stub, transcripts: join(fixture, 'transcripts'), date: today(), measures });
  const missed = results.filter(r => r.state !== 'outside');
  return {
    data: { ok: !missed.length, fixture: root, measures: strip(results), missed: missed.map(r => ({ id: r.id, state: r.state, detail: r.detail })) },
    text: [table(results), '', missed.length
      ? `selftest FAILED: ${missed.map(r => `${r.id} is ${r.state}`).join(', ')} on a project built to be outside every bound. The grader cannot be believed (lesson 6).`
      : `selftest ok: all ${results.length} measures report outside on the unhealthy fixture.`].join('\n'),
    exitCode: missed.length ? 1 : 0,
  };
}

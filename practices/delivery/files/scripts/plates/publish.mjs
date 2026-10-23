// The publisher: moves the tested ref to the newest commit on main whose gate
// passed (plates phase 80; plates practice `delivery`; managed: plates render
// rewrites it). The design is plates's docs/research/2026-10-16-delivery.md,
// items 1 and 2, after isocan's scripts/release-order.sh.
//
//   node scripts/plates/publish.mjs [--trigger <sha>] [--json]
//   node scripts/plates/publish.mjs --plan [--trigger <sha>] [--json]
//   node scripts/plates/publish.mjs --advance --from <sha|none> --to <sha> [--json]
//
// Many commits test at once; one publisher at a time (plates-publish.yml's one
// concurrency group) moves .plates/plates.json "delivery".tested (default green).
// GitHub keeps only one *pending* run per group, so a late trigger can replace
// a newer one: the publisher never trusts the commit that started it
// (--trigger is recorded, never used). Each run:
//
//   1. reads the remote's default branch and the tested ref (git ls-remote),
//      and fetches both;
//   2. refuses (exit 1) a tested ref that is not an ancestor of main: it has
//      diverged, and moving it would rewrite what deploys follow;
//   3. walks main's first-parent history from the tip back to the tested ref
//      (at most WINDOW commits; every one a descendant of the tested ref), and
//      asks each commit's gate result, newest first, through the same reader
//      the night uses to reuse CI (ci.mjs readCiGate: the gate workflow's
//      latest attempt on exactly that commit, a push to the default branch,
//      completed). The first that succeeded is chosen; a failed, cancelled,
//      pending or missing run is skipped; a result that cannot be read is red;
//   4. moves the tested ref there with a lease on the value step 1 read
//      (git push --force-with-lease=refs/heads/<tested>:<that value>), or
//      creates it there on first use (the lease says "absent"). Nothing newer
//      passed, or the ref is already main's tip: it does nothing.
//
// It never writes main: the only ref it pushes is refs/heads/<tested>, and a
// tested ref named for the default branch is refused. --plan is steps 1-3
// (plates-publish.yml's read-only job; it writes action/from/to to
// $GITHUB_OUTPUT); --advance is step 4 for a plan (the job that may write),
// re-checking ancestry and the lease itself.
//
// Exit codes: 0 moved, created or nothing to do; 1 refused (diverged, moved
// since it was read, a gate result that cannot be read, a refused push); 2 a
// bad configuration or usage.
import { spawnSync } from 'node:child_process';
import { readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readCiGate } from './ci.mjs';
import { gateWorkflowIn, isMain, main } from './lib.mjs';
import { deliveryOf, DeliveryError } from './delivery.mjs';

/** How many of main's newest first-parent commits a run considers. */
export const WINDOW = 30;
/** Where a run keeps what it fetched: its own namespace, never a branch. */
const MAIN_REF = 'refs/plates/publish/main', TESTED_REF = 'refs/plates/publish/tested';
/** Why a commit is skipped rather than red: its gate has not passed (failed, cancelled, pending or never ran). */
const NOT_PASSED = Object.freeze(['no completed success/failure on the exact default-branch revision', 'no executed jobs']);
const FAILED = 'its gate did not pass';

export class PublishError extends DeliveryError {}

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

function git(root, env, args) {
  const r = spawnSync(env.PLATES_GIT || 'git', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new PublishError(`could not run git: ${r.error.message}`);
  return r;
}
const gitOk = (root, env, args, what) => {
  const r = git(root, env, args);
  if (r.status !== 0) throw new PublishError(`${what}: git ${args[0]} failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`, 1);
  return r.stdout.trim();
};

/** Whether a is an ancestor of b (or b itself). An unreadable object is an error, never "no". */
function ancestor(root, env, a, b) {
  const r = git(root, env, ['merge-base', '--is-ancestor', a, b]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new PublishError(`cannot tell whether ${a.slice(0, 7)} is an ancestor of ${b.slice(0, 7)}: ${r.stderr.trim().split('\n')[0]}`, 1);
}

/** The remote's default branch and the tested ref's value (null: absent), as the remote has them now. */
export function remoteState(root, env, remote, tested) {
  const out = gitOk(root, env, ['ls-remote', '--symref', remote, 'HEAD', `refs/heads/${tested}`], `cannot read ${remote}`);
  const lines = out.split('\n').filter(Boolean);
  const head = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(lines.find(l => l.startsWith('ref: ')) ?? '')?.[1];
  if (!head) throw new PublishError(`${remote} names no default branch (HEAD)`, 1);
  if (head === tested) throw new PublishError(`.plates/plates.json "delivery".tested is ${tested}, ${remote}'s default branch: the publisher never writes it`);
  const value = lines.map(l => l.split('\t')).find(([, ref]) => ref === `refs/heads/${tested}`)?.[0] ?? null;
  return { main: head, testedValue: value };
}

/** Fetch main (and the tested ref, when present) into the run's own refs; main's tip. */
function fetchBoth(root, env, remote, { main: branch, testedValue }, tested) {
  const specs = [`+refs/heads/${branch}:${MAIN_REF}`, ...(testedValue ? [`+refs/heads/${tested}:${TESTED_REF}`] : [])];
  gitOk(root, env, ['fetch', '--no-tags', '--quiet', remote, ...specs], `cannot fetch ${remote}`);
  const tip = gitOk(root, env, ['rev-parse', '--verify', `${MAIN_REF}^{commit}`], 'cannot read main');
  if (testedValue && gitOk(root, env, ['rev-parse', '--verify', `${TESTED_REF}^{commit}`], `cannot read ${tested}`) !== testedValue) {
    throw new PublishError(`${tested} moved while it was fetched: run again`, 1);
  }
  return tip;
}

/** The repo (.plates/plates.json repo, else $GITHUB_REPOSITORY) and the gate workflow ("delivery".gateWorkflow, else the project's). */
async function sources(root, config, env) {
  const { tested, gateWorkflow } = deliveryOf(config);
  const repo = config.repo ?? env.GITHUB_REPOSITORY;
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new PublishError('.plates/plates.json has no "repo" (owner/name): the publisher reads its gate results there');
  const gate = gateWorkflow ? { name: gateWorkflow } : await gateWorkflowIn(root, config);
  if (gate?.problem) throw new PublishError(gate.problem);
  if (!gate) throw new PublishError('no gate workflow: set .plates/plates.json "delivery".gateWorkflow to the workflow that runs the gate on pushes to main');
  return { tested, repo, workflow: gate.name };
}

/** Whether one commit's gate passed: { passed: true, runId } | { passed: false, reason }; a throw (exit 1) when it cannot be read. */
export async function gatePassed({ repo, workflow, sha, env, request, now = Date.now() }) {
  const verify = async ({ run }) => run.conclusion === 'success' ? { kind: 'run', conclusion: 'success' } : { reason: `${FAILED} (${run.conclusion})` };
  const r = await readCiGate({ repo, workflow, sha, clean: true, env, now, maxAgeMs: Infinity, verify, request });
  if (r.reused) return { passed: true, runId: r.runId };
  if (NOT_PASSED.includes(r.reason) || r.reason.startsWith(FAILED)) return { passed: false, reason: r.reason === NOT_PASSED[0] ? 'its gate has not finished on main, or never ran' : r.reason };
  throw new PublishError(`cannot tell whether ${sha.slice(0, 7)} passed its gate (${workflow}): ${r.reason}`, 1);
}

/**
 * Steps 1-3: which commit the tested ref moves to. { action: 'advance' |
 * 'create' | 'none', tested, main, from (null: absent), to, trigger, chosen,
 * skipped: [{ sha, reason }], reason }. A diverged ref throws (exit 1).
 */
export async function choose({ root, config, env = process.env, remote = 'origin', trigger = null, request, window = WINDOW, now }) {
  const { tested, repo, workflow } = await sources(root, config, env);
  const state = remoteState(root, env, remote, tested);
  const tip = fetchBoth(root, env, remote, state, tested);
  const from = state.testedValue;
  const base = { tested, main: state.main, from, tip, trigger: trigger || null, workflow };
  if (from && !ancestor(root, env, from, tip)) {
    throw new PublishError(`${tested} (${from.slice(0, 7)}) has diverged from ${state.main} (${tip.slice(0, 7)}): it is not an ancestor, so moving it would rewrite what deploys follow. Nothing was moved. Put it back on ${state.main} by hand (git push --force-with-lease=refs/heads/${tested}:${from} origin <a commit on ${state.main} whose gate passed>:refs/heads/${tested})`, 1);
  }
  if (from === tip) return { action: 'none', ...base, to: null, skipped: [], reason: `${tested} is already ${state.main}'s tip (${tip.slice(0, 7)})` };
  const range = from ? [`${TESTED_REF}..${MAIN_REF}`] : [MAIN_REF];
  const listed = gitOk(root, env, ['rev-list', '--first-parent', `--max-count=${window}`, ...range], 'cannot read main\'s history').split('\n').filter(Boolean);
  // A first-parent commit that is not a descendant (the tested ref came in on a merged branch) would move it sideways.
  const candidates = from ? listed.filter(sha => ancestor(root, env, from, sha)) : listed;
  const skipped = [];
  for (const sha of candidates) {
    const g = await gatePassed({ repo, workflow, sha, env, request, now });
    if (g.passed) return { action: from ? 'advance' : 'create', ...base, to: sha, runId: g.runId, skipped, reason: `${sha.slice(0, 7)} is the newest commit on ${state.main} whose gate passed` };
    skipped.push({ sha, reason: g.reason });
  }
  const where = from ? `after ${tested} (${from.slice(0, 7)})` : `among ${state.main}'s newest ${candidates.length}`;
  return { action: 'none', ...base, to: null, skipped, reason: candidates.length ? `no commit ${where} has passed its gate yet` : `no commit ${where}` };
}

/**
 * Step 4: move the tested ref from `from` (null: create it) to `to`, with a
 * lease on `from`. Re-checks, as the remote has it now, that `to` is on main
 * and descends from `from`; refuses (exit 1) otherwise or when the ref moved.
 */
export function advance({ root, config, env = process.env, remote = 'origin', from, to }) {
  const { tested } = deliveryOf(config);
  if (!SHA.test(to ?? '') || (from !== null && !SHA.test(from ?? ''))) throw new PublishError('--advance needs --from <sha|none> and --to <sha>, full commit hashes');
  const state = remoteState(root, env, remote, tested);
  if (state.testedValue !== from) throw new PublishError(`${tested} moved since it was read (${from ? from.slice(0, 7) : 'absent'}, now ${state.testedValue ? state.testedValue.slice(0, 7) : 'absent'}): nothing was moved; the next publish reads it again`, 1);
  const tip = fetchBoth(root, env, remote, state, tested);
  if (!ancestor(root, env, to, tip)) throw new PublishError(`${to.slice(0, 7)} is not on ${state.main}: nothing was moved`, 1);
  if (from && !ancestor(root, env, from, to)) throw new PublishError(`${to.slice(0, 7)} does not descend from ${tested} (${from.slice(0, 7)}): nothing was moved`, 1);
  const r = git(root, env, ['push', '--quiet', '--no-verify', `--force-with-lease=refs/heads/${tested}:${from ?? ''}`, remote, `${to}:refs/heads/${tested}`]);
  if (r.status !== 0) throw new PublishError(`${remote} refused moving ${tested} to ${to.slice(0, 7)} (the lease, or a rule on the ref): ${(r.stderr || r.stdout).trim().split('\n').slice(-1)[0]}`, 1);
  return { action: from ? 'advanced' : 'created', tested, main: state.main, from, to };
}

/** Both, in one process: what a run by hand does. */
export async function publish(opts) {
  const plan = await choose(opts);
  if (plan.action === 'none') return plan;
  const moved = advance({ ...opts, from: plan.from, to: plan.to });
  return { ...plan, action: moved.action };
}

const short = s => s ? s.slice(0, 7) : 'absent';

/** What a run says it did, one line. */
export function publishLine(p) {
  const started = p.trigger && p.trigger !== p.to ? `; started by ${short(p.trigger)}, which it did not trust` : '';
  const skips = p.skipped?.length ? `; skipped ${p.skipped.length} newer (${p.skipped.map(s => `${short(s.sha)}: ${s.reason}`).join('; ')})` : '';
  if (p.action === 'advanced' || p.action === 'advance') return `plates publish: ${p.tested} ${p.action === 'advance' ? 'moves' : 'moved'} ${short(p.from)} → ${short(p.to)}, ${p.reason ?? 'as planned'}${skips}${started}`;
  if (p.action === 'created' || p.action === 'create') return `plates publish: ${p.tested} ${p.action === 'create' ? 'is created' : 'created'} at ${short(p.to)}, ${p.reason ?? 'as planned'}${skips}${started}`;
  return `plates publish: ${p.tested} stays at ${short(p.from)}: ${p.reason}${skips}${started}`;
}

function value(args, flag) {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new PublishError(`${flag} needs a value`);
  return args[i + 1];
}

if (isMain(import.meta)) {
  await main(async args => {
    const usage = 'usage: node scripts/plates/publish.mjs [--plan | --advance --from <sha|none> --to <sha>] [--trigger <sha>] [--json]';
    const flags = new Set(['--plan', '--advance']), valued = new Set(['--from', '--to', '--trigger']);
    for (let i = 0; i < args.length; i++) {
      if (valued.has(args[i])) { i++; continue; }
      if (!flags.has(args[i])) throw new PublishError(`unknown argument ${args[i]}; ${usage}`);
    }
    const root = process.cwd();
    let config;
    try { config = JSON.parse(await readFile(join(root, '.plates', 'plates.json'), 'utf8')); }
    catch (e) { throw new PublishError(`cannot read .plates/plates.json (${e.code ?? 'invalid JSON'})`); }
    const trigger = value(args, '--trigger');
    if (args.includes('--advance')) {
      if (args.includes('--plan')) throw new PublishError(usage);
      const from = value(args, '--from'), to = value(args, '--to');
      if (from === undefined || to === undefined) throw new PublishError(usage);
      const r = advance({ root, config, from: from === 'none' ? null : from, to });
      return { data: r, text: publishLine(r) };
    }
    const r = args.includes('--plan') ? await choose({ root, config, trigger }) : await publish({ root, config, trigger });
    if (args.includes('--plan') && process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `action=${r.action}\nfrom=${r.from ?? 'none'}\nto=${r.to ?? ''}\n`);
    }
    return { data: r, text: publishLine(r) };
  });
}

// keel promote: production moves only to a tested commit, previewed, then
// verified (keel phase 82; keel practice `delivery`; managed: keel render
// rewrites it). The design is keel's docs/research/2026-10-16-delivery.md,
// item 5, after isocan's hand-moved prod tag.
//
//   keel promote [<commit>] [--yes] [--within <s>] [--every <s>] [--json]
//   keel promote --back <commit> [--yes] [--within <s>] [--every <s>] [--json]
//   (keel promote runs this script: node scripts/keel/promote.mjs, the same arguments)
//
// .keel/keel.json "delivery": { "promote": "tag:prod" } (or "branch:production"):
// the ref production deploys from. Without one ("none", or unset) a project
// has no promote. It needs "delivery".site and "delivery".version, since
// every promotion ends in a verify.
//
// The guard, before anything moves (each refusal names why, exit 1):
//   - the commit is on the tested ref ("delivery".tested, default green) as
//     origin has it now: the ref's tip or an ancestor of it;
//   - its gate passed: phase 79's result (gate.mjs ciResult), CI's exact,
//     clean, successful run of the gate workflow on that commit, whose
//     keel-test-runs records show the gate's own command passing with tests.
//     The 24-hour reuse window does not apply: a commit tested last week is
//     still a tested commit;
//   - its direction: forward (no --back) never moves production to an
//     ancestor of what it serves now, and --back only ever does.
// Default commit: the tested ref's tip. Production already at the commit (a
// retry after a failed verify): nothing is pushed, and --yes still verifies it.
//
// Without --yes it previews (exit 3): the commit, what production serves now,
// the commits that reach production (or, going back, leave it), and the
// verify that will follow. With --yes it moves the one ref, with a lease on
// the value it read (git push --force-with-lease), and then verifies
// production (verify.mjs): forward, production serves the commit or a
// descendant; --back, production serves exactly the commit, since a
// descendant still serving (the newer commit the rollback is from) would pass
// a descendant check. A failed verify reports, suggests --back to what
// production was, and moves nothing.
//
// It is a person's command: it refuses to run in GitHub Actions, and no
// workflow keel installs runs it (tests/workflows.test.mjs). It runs on the
// owner's machine with their git credentials.
//
// Exit codes: 0 moved (or already there) and verified; 1 refused, the push
// refused, or the verify failed; 2 a bad configuration or usage; 3 the
// preview (nothing moved; --yes to move).
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMain, main, gateWorkflowOf } from './lib.mjs';
import { deliveryOf, DeliveryError } from './delivery.mjs';
import { ciResult } from './gate.mjs';
import { verify, verifyText, WITHIN, EVERY } from './verify.mjs';

/** Where a run keeps what it fetched: its own namespace, never a branch. */
const TESTED_REF = 'refs/keel/promote/tested', PRODUCTION_REF = 'refs/keel/promote/production';
/** How many commits the preview lists, each way. */
export const LISTED = 20;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const short = s => (s ? s.slice(0, 7) : 'nothing');

export class PromoteError extends DeliveryError {}

function git(root, env, args) {
  const r = spawnSync(env.KEEL_GIT || 'git', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  if (r.error) throw new PromoteError(`could not run git: ${r.error.message}`, 1);
  return r;
}
const gitOk = (root, env, args, what) => {
  const r = git(root, env, args);
  if (r.status !== 0) throw new PromoteError(`${what}: git ${args[0]} failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`, 1);
  return r.stdout.trim();
};

/** Whether a is an ancestor of b (or b itself). An unreadable object is an error, never "no". */
function ancestor(root, env, a, b) {
  const r = git(root, env, ['merge-base', '--is-ancestor', a, b]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new PromoteError(`cannot tell whether ${short(a)} is an ancestor of ${short(b)}: ${(r.stderr || '').trim().split('\n')[0]}`, 1);
}

/** The commits in `range` (newest first): { count, commits: [{ sha, subject }] (at most LISTED) }. */
function commitsIn(root, env, range) {
  const count = Number(gitOk(root, env, ['rev-list', '--count', ...range], 'cannot read the history'));
  const listed = gitOk(root, env, ['log', `--max-count=${LISTED}`, '--format=%H%x09%s', ...range], 'cannot read the history');
  return { count, commits: listed ? listed.split('\n').map(l => { const tab = l.indexOf('\t'); return { sha: l.slice(0, tab), subject: l.slice(tab + 1) }; }) : [] };
}

/**
 * Origin's default branch, the tested ref's tip and the production ref's
 * value (the object it names, a tag object for an annotated tag, and the
 * commit it peels to), fetched into the run's own refs.
 */
function remoteState(root, env, remote, tested, prod) {
  const out = gitOk(root, env, ['ls-remote', '--symref', remote, 'HEAD', `refs/heads/${tested}`, prod.ref], `cannot read ${remote}`);
  const lines = out.split('\n').filter(Boolean);
  const head = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(lines.find(l => l.startsWith('ref: ')) ?? '')?.[1] ?? null;
  const value = ref => lines.map(l => l.split('\t')).find(([, r]) => r === ref)?.[0] ?? null;
  const testedValue = value(`refs/heads/${tested}`), prodObject = value(prod.ref);
  if (prod.kind === 'branch' && head && prod.name === head) throw new PromoteError(`.keel/keel.json "delivery".promote is ${prod.spec}, ${remote}'s default branch: keel promote never writes it`);
  if (!testedValue) throw new PromoteError(`${tested}, the tested ref, does not exist on ${remote}: nothing has passed through the publisher yet, so nothing can be promoted`, 1);
  const specs = [`+refs/heads/${tested}:${TESTED_REF}`, ...(prodObject ? [`+${prod.ref}:${PRODUCTION_REF}`] : [])];
  gitOk(root, env, ['fetch', '--no-tags', '--quiet', remote, ...specs], `cannot fetch ${remote}`);
  const testedTip = gitOk(root, env, ['rev-parse', '--verify', `${TESTED_REF}^{commit}`], `cannot read ${tested}`);
  if (testedTip !== testedValue) throw new PromoteError(`${tested} moved while it was fetched: run again`, 1);
  const from = prodObject ? gitOk(root, env, ['rev-parse', '--verify', `${PRODUCTION_REF}^{commit}`], `cannot read ${prod.spec}: it does not name a commit`) : null;
  return { main: head, testedTip, prodObject, from };
}

/** The commit an argument names, as this checkout has it once the tested ref is fetched; a throw (exit 1) when none. */
function resolveCommit(root, env, arg) {
  const r = git(root, env, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${arg}^{commit}`]);
  const sha = r.status === 0 ? r.stdout.trim() : null;
  if (!sha || !SHA.test(sha)) throw new PromoteError(`${JSON.stringify(arg)} is not a commit in this repository, nor on the tested ref just fetched: only a commit on the tested ref is promoted`, 1);
  return sha;
}

/** The gate workflow whose result counts: "delivery".gateWorkflow, else the project's ci.gateWorkflow. Never a guess. */
function gateConfig(config, d) {
  const named = gateWorkflowOf(config);
  if (named?.problem) throw new PromoteError(named.problem);
  const workflow = d.gateWorkflow ?? named?.name ?? null;
  if (!workflow) throw new PromoteError('no gate workflow is named (.keel/keel.json "delivery".gateWorkflow, or ci.gateWorkflow): which run is a commit\'s gate cannot be told, so nothing is promoted', 1);
  if (typeof config.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(config.repo)) throw new PromoteError('.keel/keel.json has no "repo" (owner/name): a commit\'s gate result is read there');
  return { workflow, config: { ...config, gateWorkflow: undefined, ci: { ...(config.ci ?? {}), gateWorkflow: workflow } } };
}

/**
 * Everything before a move: the guard, and what would change. { action:
 * 'promote' | 'back' | 'verify' (already there), ref, tested, testedTip, from, fromObject, to,
 * subject, arriving, leaving, gate, verify, reason }. A refusal throws (exit
 * 1, naming why); a bad configuration throws (exit 2).
 */
export async function plan({ root, config, commit = null, back = false, within = WITHIN, every = EVERY, env = process.env, remote = 'origin', now = Date.now(), request, download }) {
  if (env.GITHUB_ACTIONS === 'true') throw new PromoteError('keel promote is a person\'s command: it does not run in GitHub Actions, and no workflow promotes', 1);
  const d = deliveryOf(config);
  if (!d.promote) throw new PromoteError('.keel/keel.json has no "delivery".promote (like "tag:prod"): this project has no promote');
  if (back && !commit) throw new PromoteError('--back needs the commit to roll back to');
  const gate = gateConfig(config, d);
  if (gitOk(root, env, ['rev-parse', '--is-shallow-repository'], 'cannot read this checkout') === 'true') throw new PromoteError('this checkout is shallow, so ancestry cannot be read: fetch its full history (git fetch --unshallow)');
  const state = remoteState(root, env, remote, d.tested, d.promote);
  const to = commit ? resolveCommit(root, env, commit) : state.testedTip;
  const where = `${d.promote.spec} (${state.from ? short(state.from) : 'absent'})`;
  const base = { ref: d.promote.spec, tested: d.tested, testedTip: state.testedTip, from: state.from, fromObject: state.prodObject, to, back };
  // On the tested ref: only a commit the publisher has passed through is ever production.
  if (!ancestor(root, env, to, state.testedTip)) throw new PromoteError(`${short(to)} is not on ${d.tested} (its tip is ${short(state.testedTip)}): only a commit on the tested ref is promoted, and nothing was moved`, 1);
  // Already there (a retry after a failed verify, say): nothing to push, but production is still verified (PR #191 review).
  const already = state.from === to;
  // The direction: forward never goes back, and --back only does.
  if (already) { /* no direction: the ref stays where it is */ } else if (back) {
    if (!state.from) throw new PromoteError(`production (${d.promote.spec}) does not exist on ${remote}: there is nothing to roll back`, 1);
    if (!ancestor(root, env, to, state.from)) throw new PromoteError(`${short(to)} is not earlier than production, ${where}: --back moves production to an ancestor of what it serves; to move it forward, keel promote ${short(to)}`, 1);
  } else if (state.from && ancestor(root, env, to, state.from)) {
    throw new PromoteError(`${short(to)} is earlier than production, ${where}: rolling back is keel promote --back ${short(to)}, and nothing was moved`, 1);
  }
  // Its gate: phase 79's result for exactly this commit, at any age.
  const tree = gitOk(root, env, ['rev-parse', `${to}^{tree}`], `cannot read ${short(to)}'s tree`);
  const g = await ciResult({ config: gate.config, sha: to, tree, clean: true, env, now, maxAgeMs: Infinity, request, download });
  if (!g.reused) throw new PromoteError(`${short(to)}'s gate has not passed, as far as keel can show (${gate.workflow}): ${g.reason}; only a commit whose gate passed is promoted, and nothing was moved`, 1);
  const subject = gitOk(root, env, ['log', '-1', '--format=%s', to], `cannot read ${short(to)}`);
  const arriving = commitsIn(root, env, state.from ? [`${state.from}..${to}`] : [to]);
  const leaving = state.from ? commitsIn(root, env, [`${to}..${state.from}`]) : { count: 0, commits: [] };
  return {
    action: already ? 'verify' : back ? 'back' : 'promote', ...base, subject, arriving, leaving,
    gate: { workflow: g.workflow, runId: g.runId, attempt: g.attempt, tests: g.tests, completedAt: g.completedAt },
    verifies: { site: d.site, version: d.version, exact: back, within, every, smoke: d.smoke.length },
    reason: already ? `${d.promote.spec} is already at ${short(to)}, which is on ${d.tested} and whose gate passed` : back ? `${short(to)} is on ${d.tested}, earlier than production, and its gate passed` : `${short(to)} is on ${d.tested} and its gate passed`,
  };
}

/** Move the production ref from what the plan read to its commit, with a lease on that value; a throw (exit 1) when origin refuses. */
export function move({ root, plan: p, config, env = process.env, remote = 'origin' }) {
  const { promote } = deliveryOf(config);
  const r = git(root, env, ['push', '--quiet', '--no-verify', `--force-with-lease=${promote.ref}:${p.fromObject ?? ''}`, remote, `${p.to}:${promote.ref}`]);
  if (r.status !== 0) throw new PromoteError(`${remote} refused moving ${promote.spec} to ${short(p.to)} (it moved since it was read, or a rule on the ref): ${(r.stderr || r.stdout).trim().split('\n').slice(-1)[0]}; nothing was moved`, 1);
  return { moved: true, ref: promote.spec, from: p.from, to: p.to };
}

/**
 * The command: plan, then (with yes) move and verify. { ...plan, moved,
 * verify: <verify.mjs result>, next, exitCode }. Never moves a second time:
 * a failed verify suggests --back and stops.
 */
export async function promote({ root, config, commit = null, back = false, yes = false, within = WITHIN, every = EVERY, env = process.env, remote = 'origin', fetch, request, download, now, sleep }) {
  const p = await plan({ root, config, commit, back, within, every, env, remote, request, download, now });
  if (!yes) return { ...p, moved: null, preview: true, exitCode: 3 };
  // The ref already there is not pushed again, and still verified: a retry is never a success it did not see.
  const moved = p.action === 'verify' ? { moved: false, ref: p.ref, from: p.from, to: p.to } : move({ root, plan: p, config, env, remote });
  let v;
  try { v = await verify({ root, config, sha: p.to, exact: back, within, every, env, fetch, ...(sleep ? { sleep } : {}) }); }
  catch (e) { v = { ok: false, sha: p.to, site: p.verifies.site, exact: back, serving: null, failures: [`the verify could not run: ${e.message}`], smoke: [] }; }
  const next = v.ok ? null : back
    ? `production does not serve exactly ${short(p.to)}; ${p.ref} is at ${short(p.to)}: check the deploy, then node scripts/keel/verify.mjs ${p.to} --exact`
    : p.from ? `production does not serve ${short(p.to)}: to roll back, keel promote --back ${p.from}` : `production does not serve ${short(p.to)}, and there was no earlier production to roll back to: check the deploy`;
  return { ...p, moved, verify: v, next, exitCode: v.ok ? 0 : 1 };
}

const list = (head, c) => [head, ...c.commits.map(x => `    ${short(x.sha)} ${x.subject}`), ...(c.count > c.commits.length ? [`    … and ${c.count - c.commits.length} more`] : [])];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** What a run says, a few lines: the preview, then what was moved and the verify. */
export function promoteText(r) {
  const already = r.action === 'verify';
  const head = r.preview ? (already ? 'preview, nothing to move (--yes verifies production)' : 'preview, nothing moved (--yes to move it)') : already ? `${r.ref} is already at ${short(r.to)}: not pushed, verified` : `${r.ref} moved ${short(r.from)} → ${short(r.to)}`;
  const lines = [`keel promote${r.back ? ' --back' : ''}: ${head}`,
    `  production (${r.ref}): ${already ? `at ${short(r.to)}` : `${r.from ? short(r.from) : 'absent, created'} → ${short(r.to)}`} ${r.subject}`,
    `  ${r.reason}: ${r.gate.workflow} run ${r.gate.runId}, ${plural(r.gate.tests, 'test')} passed (${r.gate.completedAt}).`];
  if (already) { /* nothing arrives or leaves */ } else if (r.back) lines.push(...list(`  ${plural(r.leaving.count, 'commit')} leave production:`, r.leaving));
  else {
    lines.push(...list(`  ${plural(r.arriving.count, 'commit')} reach production:`, r.arriving));
    if (r.leaving.count) lines.push(...list(`  and ${plural(r.leaving.count, 'commit')} production has now are not in ${short(r.to)} and leave it:`, r.leaving));
  }
  const w = r.verifies;
  if (r.preview) {
    lines.push(`  Then: ${new URL(w.version, w.site).href} must report ${w.exact ? `exactly ${short(r.to)}` : `${short(r.to)} or a descendant`} within ${w.within}s, then ${plural(w.smoke, 'smoke check')}.`);
    return lines.join('\n');
  }
  lines.push(...verifyText(r.verify).split('\n').map(l => `  ${l}`));
  if (r.next) lines.push(`  Next: ${r.next}. Nothing else was moved.`);
  return lines.join('\n');
}

const USAGE = 'usage: keel promote [<commit>] [--yes] [--within <s>] [--every <s>] [--json] | keel promote --back <commit> [--yes] [--within <s>] [--every <s>] [--json]';

/** The arguments: { commit, back, yes, within?, every? }; a throw (exit 2) on anything else. */
export function parseArgs(args) {
  const out = { commit: null, back: false, yes: false };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--yes') { out.yes = true; continue; }
    if (['--back', '--within', '--every'].includes(a)) {
      if (args[i + 1] === undefined || args[i + 1].startsWith('-')) throw new PromoteError(`${a} needs a value; ${USAGE}`);
      if (a === '--back') { out.back = true; positional.push(args[++i]); } else out[a.slice(2)] = args[++i];
      continue;
    }
    if (a.startsWith('-')) throw new PromoteError(`unknown argument ${a}; ${USAGE}`);
    positional.push(a);
  }
  if (positional.length > 1) throw new PromoteError(USAGE);
  out.commit = positional[0] ?? null;
  for (const k of ['within', 'every']) {
    if (out[k] === undefined) continue;
    const n = Number(out[k]);
    if (!Number.isFinite(n) || n < 0 || n > 3600 || (k === 'every' && n === 0)) throw new PromoteError(`--${k} is seconds, ${k === 'every' ? 'more than 0' : '0 or more'} and at most 3600 (got ${JSON.stringify(out[k])})`);
    out[k] = n;
  }
  return out;
}

export async function run(args, { root = process.cwd(), env = process.env, fetch } = {}) {
  const o = parseArgs(args);
  let config;
  try { config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8')); }
  catch (e) { throw new PromoteError(`cannot read .keel/keel.json (${e.code ?? 'invalid JSON'})`); }
  const r = await promote({ root, config, commit: o.commit, back: o.back, yes: o.yes, within: o.within ?? WITHIN, every: o.every ?? EVERY, env, fetch });
  const { exitCode, ...data } = r;
  return { data, text: promoteText(r), exitCode };
}

if (isMain(import.meta)) await main(args => run(args));

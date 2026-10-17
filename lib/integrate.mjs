// keel ready and keel integrate: a session hands a change off as ready, and
// one integrator runs the expensive path for every ready change at once (keel
// phase 83; docs/research/2026-10-16-delivery.md, "The owner's ask").
//
//   keel ready [--branch <name>] [--check "<cmd>"]...   push the branch, record it ready
//   keel integrate                                       take the lock, gate the batch once, push
//
// The owner, 2026-10-16: two changes asked for one after the other each ran
// the whole test path. Here a session runs only its fast checks and says the
// change is ready; the full gate is the integrator's alone.
//
// Ready. `keel ready` runs the fast checks (.keel/keel.json "delivery".fast,
// and each --check), refuses a check that is the full gate (`check`, default
// `npm run check`), pushes the session's branch, and pushes ready/<branch>: a
// commit of its own whose only parent is the change's head, whose tree is the
// head's, and whose message records the session, the machine, the time and
// each fast check with its exit code. A failing fast check pushes nothing.
//
// The lock. claims/integrate is phase 70's create-only claim (claim.mjs
// pushCreateOnly): of two integrators the server takes one push, and the
// read-back of the ref, by a token made fresh per attempt, says which. The
// other exits 1 naming the holder. The lock is released when the run ends,
// whatever happened; one left by a run that died is the owner's to delete.
//
// Integrate. In a temporary worktree on the default branch: merge every ready
// change, in the order they were marked ready, and run the full gate once.
// That is the fast path, and a batch that passes costs one gate run and one
// push. A batch that fails is not bisected blindly: splitting alone cannot
// find an interaction failure (two changes that each pass, and fail together:
// keel#166). So it accumulates by halves: the left half is accepted against
// the default branch, then the right half against the tree accepted so far,
// recursively, down to single changes. A change is kept only when the tree
// with it, on top of everything kept before it, passed the gate. A single
// change that fails on top of kept ones is tried alone on the default branch,
// once, to say which it is: it fails on its own, or it conflicts with the
// ones kept before it. The tree pushed is always one the gate passed;
// nothing failing is pushed. Landed changes lose their ready ref; a change
// sent back keeps it, rewritten as blocked with the reason, and is skipped
// until its session marks it ready again.
//
// Exit codes: 0 every ready change landed (or nothing was ready); 1 a change
// was sent back, a fast check failed, the lock is held, or a push was
// refused; 2 usage, no remote, or a configuration error.
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { remoteOf, defaultBranch, providerOf, sessionOf, pushCreateOnly } from './claim.mjs';

export const READY_PREFIX = 'ready/';
export const LOCK = 'claims/integrate';
const LOCK_REF = `refs/heads/${LOCK}`;
/** The full gate when .keel/keel.json names no `check`: the gate script's own default. */
export const FULL_GATE = 'npm run check';

export class IntegrateError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const lastLine = s => String(s ?? '').trim().split('\n').filter(Boolean).pop() ?? 'failed';
function git(root, args, env = process.env) {
  return new Promise(done => {
    const child = spawn('git', ['-C', root, ...args], { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => done({ ok: false, why: e.message, stdout: '' }));
    child.on('close', code => done(code === 0 ? { ok: true, stdout: out } : { ok: false, why: lastLine(err || out), stdout: out }));
  });
}
const must = async (root, args, env, what) => {
  const r = await git(root, args, env);
  if (!r.ok) throw new IntegrateError(`${what}: git ${args[0]} failed: ${r.why}`, 1);
  return r.stdout.trim();
};

/** A command's environment: never the test runner's context (lesson 14), and the project's own "env" over it. */
const gateEnv = (env, config) => ({ ...Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('NODE_TEST_') && k !== 'KEEL_AGENT_GIT')), ...(config?.env ?? {}) });

/** Run a shell command in `cwd`; its output goes to stderr, so --json stays clean. { status, ms }. */
export function shell(command, { cwd, env }) {
  const t0 = Date.now();
  return new Promise(done => {
    const child = spawn(command, { cwd, env, shell: true, stdio: ['ignore', 2, 2] });
    child.on('error', () => done({ status: 127, ms: Date.now() - t0 }));
    child.on('close', (code, signal) => done({ status: code ?? (signal ? 128 : 1), ms: Date.now() - t0 }));
  });
}

async function configOf(root) {
  try { return JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8')); }
  catch (e) { throw new IntegrateError(`cannot read .keel/keel.json (${e.code ?? 'invalid JSON'})`); }
}
/** The full gate this project runs: "check", else npm run check. */
export function fullGate(config) {
  if (config.check !== undefined && (typeof config.check !== 'string' || !config.check.trim())) throw new IntegrateError('.keel/keel.json "check" must be a shell command');
  return config.check ?? FULL_GATE;
}
/**
 * The gate a checked-out candidate names: its own .keel/keel.json `check` and
 * `env`. { command, config } or { why } (the candidate is sent back with it).
 */
export async function candidateGate(dir) {
  let config;
  try { config = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8')); }
  catch (e) { return { why: `names no gate keel can run: its .keel/keel.json cannot be read (${e.code ?? 'invalid JSON'})` }; }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { why: 'names no gate keel can run: its .keel/keel.json is not an object' };
  if (config.env !== undefined && (!config.env || typeof config.env !== 'object' || Array.isArray(config.env) || Object.values(config.env).some(v => typeof v !== 'string'))) {
    return { why: 'names no gate keel can run: its .keel/keel.json "env" must map names to strings' };
  }
  try { return { command: fullGate(config), config }; } catch (e) { return { why: `names no gate keel can run: ${e.message}` }; }
}
/** The files that say what node_modules holds. */
export const DEPENDENCY_FILES = Object.freeze(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']);
export const DEPENDENCIES = 'changes dependencies: install them in the integrator checkout, or integrate it alone after `npm ci`';
/** Whether a candidate's dependency files are the checkout's, byte for byte (a file missing on both sides counts as the same). */
export async function sameDependencies(root, dir) {
  for (const f of DEPENDENCY_FILES) {
    const [mine, theirs] = await Promise.all([readFile(join(root, f)).catch(() => null), readFile(join(dir, f)).catch(() => null)]);
    if (mine === null && theirs === null) continue;
    if (mine === null || theirs === null || !mine.equals(theirs)) return false;
  }
  return true;
}
const same = (a, b) => a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ');
/** The fast checks: "delivery".fast, then each --check. Never the full gate. */
export function fastChecks(config, extra = []) {
  const listed = config.delivery?.fast ?? [];
  if (!Array.isArray(listed)) throw new IntegrateError('.keel/keel.json "delivery".fast must be a list of shell commands');
  const all = [...listed, ...extra];
  for (const c of all) {
    if (typeof c !== 'string' || !c.trim() || /[\r\n]/.test(c)) throw new IntegrateError(`a fast check is one line of shell; not ${JSON.stringify(c)}`);
  }
  const full = fullGate(config);
  const gate = all.find(c => same(c, full));
  if (gate !== undefined) throw new IntegrateError(`keel ready never runs the full gate (\`${full}\`): that is keel integrate's, once for every ready change. Name a fast check instead (a test file, a lint).`);
  return all;
}

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
function branchProblem(name) {
  if (!BRANCH.test(name) || name.includes('..') || name.includes('//') || name.endsWith('/') || name.endsWith('.lock') || name.split('/').some(s => s.startsWith('.'))) return `"${name}" is not a branch name keel will push`;
  if (name.startsWith(READY_PREFIX) || name.startsWith('claims/')) return `"${name}" is keel's own ref space (ready/, claims/), not a change`;
  return null;
}
const field = (message, key) => new RegExp(`^${key}: (.+)$`, 'm').exec(message)?.[1].trim() ?? null;

/** The ready commit's message: what the integrator reads, and what a person reads with git log. */
export function readyMessage({ branch, head, status = 'ready', provider, session, machine, at, checks, blocked }) {
  return [`${status}: ${branch}`, '',
    `Branch: ${branch}`, `Head: ${head}`, `Status: ${status}`, `Provider: ${provider ?? 'unknown'}`, `Session: ${session ?? 'unknown'}`,
    `Machine: ${machine}`, `At: ${at}`,
    ...checks.map(c => `Check: ${c.status} ${c.command}`),
    ...(blocked ? [`Blocked: ${blocked}`] : []), ''].join('\n');
}
export function parseReady(message) {
  const checks = [...message.matchAll(/^Check: (\d+) (.+)$/gm)].map(m => ({ status: Number(m[1]), command: m[2] }));
  return { branch: field(message, 'Branch'), head: field(message, 'Head'), status: field(message, 'Status'), provider: field(message, 'Provider'),
    session: field(message, 'Session'), machine: field(message, 'Machine'), at: field(message, 'At'), checks, blocked: field(message, 'Blocked') };
}

async function remoteAndDefault(root, env) {
  const remote = await remoteOf(root, env);
  if (!remote) throw new IntegrateError('no git remote here: a ready change is a branch the integrator can see, and there is nowhere to push one');
  const found = await defaultBranch(root, remote, env, true);
  if (!found.branch) throw new IntegrateError(`the default branch could not be read: ${found.why}`);
  return { remote, main: found.branch };
}

/**
 * keel ready: the fast checks, then the branch and its ready ref pushed.
 * deps (tests): env, now, run (a fast check's runner: (command, {cwd, env}) => {status}).
 */
export async function ready({ root, branch: named, checks: extra = [] }, deps = {}) {
  const env = deps.env ?? process.env;
  const config = await configOf(root);
  const commands = fastChecks(config, extra);
  const { remote, main } = await remoteAndDefault(root, env);
  const branch = named ?? (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], env)).stdout.trim();
  if (!branch) throw new IntegrateError('HEAD is detached: name the change\'s branch with --branch <name>');
  const bad = branchProblem(branch);
  if (bad) throw new IntegrateError(bad);
  if (branch === main) throw new IntegrateError(`${branch} is ${remote}'s default branch: commit the change on a branch of its own, then keel ready there. The integrator is what writes ${branch}.`);
  const dirty = (await git(root, ['status', '--porcelain', '--untracked-files=normal'], env)).stdout.trim();
  if (dirty) throw new IntegrateError('the tree has uncommitted changes: keel ready hands off a commit, so commit first (the integrator never sees what is not committed)');
  const head = await must(root, ['rev-parse', '--verify', 'HEAD^{commit}'], env, 'HEAD');
  if (named && head !== (await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${named}^{commit}`], env)).stdout.trim()) {
    throw new IntegrateError(`--branch ${named} is not what is checked out: check it out first, so the fast checks run on the change`);
  }
  const results = [];
  const runCheck = deps.run ?? shell;
  for (const command of commands) {
    const r = await runCheck(command, { cwd: root, env: gateEnv(env, config) });
    results.push({ command, status: r.status });
  }
  const failed = results.filter(r => r.status !== 0);
  const base = { branch, head, remote, ref: `${READY_PREFIX}${branch}`, checks: results };
  if (failed.length) {
    return { data: { ok: false, ready: false, ...base }, exitCode: 1,
      text: `Not ready: ${failed.map(f => `\`${f.command}\` exit ${f.status}`).join(', ')}. Nothing was pushed.` };
  }
  const pushed = await git(root, ['push', '--quiet', remote, `${head}:refs/heads/${branch}`], env);
  if (!pushed.ok) throw new IntegrateError(`${branch} could not be pushed to ${remote}: ${pushed.why}`, 1);
  const at = new Date(deps.now ?? Date.now()).toISOString();
  let provider = null;
  try { provider = providerOf(env); } catch { provider = null; }
  const message = readyMessage({ branch, head, provider, session: sessionOf(env), machine: env.KEEL_MACHINE || hostname(), at, checks: results });
  const dated = { ...env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
  const sha = await must(root, ['commit-tree', `${head}^{tree}`, '-p', head, '-m', message], dated, 'the ready commit');
  // This branch's ready ref is this change's: marking it ready again replaces it (and clears a block).
  const marked = await git(root, ['push', '--quiet', '--force', remote, `${sha}:refs/heads/${base.ref}`], env);
  if (!marked.ok) throw new IntegrateError(`${base.ref} could not be pushed to ${remote}: ${marked.why}`, 1);
  return { data: { ok: true, ready: true, ...base, sha, at },
    text: `Ready: ${branch} at ${head.slice(0, 7)} (${base.ref} on ${remote}), ${results.length ? `fast checks ${results.map(r => `\`${r.command}\` exit 0`).join(', ')}` : 'no fast checks named'}. `
      + `The full gate is keel integrate's: run it, or let the session running it take this change.` };
}

/** Every ready change on the remote, as last fetched, oldest first: { branch, ref, sha, head, ...record }. */
async function readyChanges(root, remote, env) {
  const r = await git(root, ['for-each-ref', '--format=%(refname)%09%(objectname)', `refs/remotes/${remote}/${READY_PREFIX}`], env);
  if (!r.ok) throw new IntegrateError(`the ready changes could not be read: ${r.why}`, 2);
  const out = [], malformed = [];
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [full, sha] = line.split('\t');
    const name = full.slice(`refs/remotes/${remote}/`.length);
    const message = (await git(root, ['log', '-1', '--format=%B', sha], env)).stdout;
    const rec = parseReady(message);
    const parents = (await git(root, ['log', '-1', '--format=%P', sha], env)).stdout.trim().split(' ').filter(Boolean);
    // A ready ref is keel's commit on the change: one parent, the head it names, the branch it names.
    if (parents.length !== 1 || rec.head !== parents[0] || `${READY_PREFIX}${rec.branch}` !== name) { malformed.push(name); continue; }
    out.push({ ...rec, ref: name, sha });
  }
  out.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.branch.localeCompare(b.branch));
  return { changes: out, malformed };
}

/** Whether a tree may be pushed without gating it again: only one this run's gate passed. */
export const pushable = (tree, passed) => passed.has(tree);

const lockMessage =({ provider, session, machine, at, token }) =>
  `claim: integrate\n\nLock: integrate\nProvider: ${provider ?? 'unknown'}\nSession: ${session ?? 'unknown'}\nMachine: ${machine}\nAt: ${at}\nToken: ${token}\n`;

/** Take claims/integrate: { held: true, sha } or { held: false, holder }. */
async function takeLock(root, remote, main, env, deps) {
  const at = new Date(deps.now ?? Date.now()).toISOString();
  const token = randomBytes(16).toString('hex');
  let provider = null;
  try { provider = providerOf(env); } catch { provider = null; }
  const mine = { provider, session: sessionOf(env), machine: env.KEEL_MACHINE || hostname(), at, token };
  const base = `refs/remotes/${remote}/${main}`;
  const sha = await must(root, ['commit-tree', `${base}^{tree}`, '-p', base, '-m', lockMessage(mine)], { ...env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at }, 'the lock commit');
  if (deps.beforeLock) await deps.beforeLock();
  const pushed = await pushCreateOnly(root, remote, sha, LOCK_REF, env);
  // Whatever the push said, the remote ref is the answer: the lock is this run's when its token is there.
  const there = await git(root, ['fetch', '--quiet', remote, `+${LOCK_REF}:refs/remotes/${remote}/${LOCK}`], env);
  if (!there.ok && !pushed.ok) {
    // Refused, and the ref is gone already: another run held it and has finished. Not this run's.
    const ls = await git(root, ['ls-remote', remote, LOCK_REF], env);
    if (ls.ok && !ls.stdout.trim()) return { held: false, holder: { provider: null, session: null, machine: null, at: null } };
  }
  if (!there.ok) throw new IntegrateError(`the lock may or may not be held: the push ${pushed.ok ? 'was accepted' : `failed (${pushed.why})`}, and ${remote} could not be read afterwards (${there.why}). Check: git ls-remote ${remote} ${LOCK_REF}`, 1);
  const theirs = (await git(root, ['log', '-1', '--format=%B', `refs/remotes/${remote}/${LOCK}`], env)).stdout;
  if (field(theirs, 'Token') === token) return { held: true, sha };
  return { held: false, holder: { provider: field(theirs, 'Provider'), session: field(theirs, 'Session'), machine: field(theirs, 'Machine'), at: field(theirs, 'At') } };
}
const releaseLock = (root, remote, sha, env) => git(root, ['push', '--quiet', `--force-with-lease=${LOCK_REF}:${sha}`, remote, `:${LOCK_REF}`], env);

/**
 * keel integrate. deps (tests): env, now, gate ((dir, {env, sha, command}) =>
 * {status}: the full gate on a tree; default: runs `command`, the candidate's
 * own `check`, in the worktree),
 * beforeLock (runs before the lock's push: where a second integrator races).
 */
export async function integrate({ root }, deps = {}) {
  const env = deps.env ?? process.env;
  const config = await configOf(root);
  const command = fullGate(config);
  const { remote, main } = await remoteAndDefault(root, env);
  const fetched = await git(root, ['fetch', '--prune', '--quiet', remote, `+refs/heads/*:refs/remotes/${remote}/*`], env);
  if (!fetched.ok) throw new IntegrateError(`git fetch ${remote} failed: ${fetched.why}`);
  const lock = await takeLock(root, remote, main, env, deps);
  if (!lock.held) {
    const h = lock.holder;
    return { data: { ok: false, refused: true, lock: LOCK, holder: h }, exitCode: 1,
      text: `Another integrator holds ${LOCK} (${h.provider ?? 'unknown'} on ${h.machine ?? 'unknown'} since ${h.at ?? 'unknown'}): it takes every ready change, yours too, reading them again before it lets go (up to ${MAX_ROUNDS} rounds). Nothing was done here. `
        + `If its report does not name yours, run keel integrate again once the lock is free. `
        + `A lock left by a run that died is the owner's to delete: git push ${remote} --delete ${LOCK}` };
  }
  try {
    // Drain before letting go: a session refused the lock was told this run takes its change, and it may have
    // marked it ready after this run's read. So the ready refs are read again after each round, and a change
    // not seen yet starts another, up to MAX_ROUNDS.
    const rounds = [];
    for (;;) {
      rounds.push(await integrateRound({ root, env, deps, remote, main, command }));
      const seen = new Set(rounds.flatMap(r => r.seen));
      const again = await git(root, ['fetch', '--prune', '--quiet', remote, `+refs/heads/${READY_PREFIX}*:refs/remotes/${remote}/${READY_PREFIX}*`], env);
      const fresh = again.ok ? (await readyChanges(root, remote, env)).changes.filter(c => c.status !== 'blocked' && !seen.has(c.sha)) : [];
      if (!fresh.length) break;
      if (rounds.length >= MAX_ROUNDS) { rounds.at(-1).more = fresh.map(c => c.branch); break; }
    }
    return combined(rounds);
  } finally {
    await releaseLock(root, remote, lock.sha, env);
  }
}

/** How many batches one integrator runs before it lets go of the lock. */
export const MAX_ROUNDS = 3;

/** One run's rounds, as one report: the lists joined, the gate runs summed; `rounds` when there were several. */
function combined(rounds) {
  const more = rounds.at(-1).more ?? [];
  const tail = more.length ? [`More became ready while this ran (${more.join(', ')}), after ${rounds.length} rounds: run keel integrate again.`] : [];
  if (rounds.length === 1) {
    const [r] = rounds;
    return { data: { ...r.data, more }, text: [r.text, ...tail].join('\n'), ...(r.exitCode ? { exitCode: r.exitCode } : {}) };
  }
  const datas = rounds.map(r => r.data);
  const data = { ...datas.at(-1), base: datas[0].base, more,
    ok: datas.every(d => d.ok), gates: datas.reduce((n, d) => n + d.gates, 0),
    commands: [...new Set(datas.flatMap(d => d.commands ?? []))],
    pushed: datas.map(d => d.pushed).filter(Boolean).at(-1) ?? null,
    landed: datas.flatMap(d => d.landed), blocked: datas.flatMap(d => d.blocked),
    alreadyLanded: datas.flatMap(d => d.alreadyLanded), rounds: datas };
  return { data, text: [...rounds.map((r, i) => `Round ${i + 1}: ${r.text}`), ...tail].join('\n'), ...(data.ok ? {} : { exitCode: 1 }) };
}

/** One batch under the lock: read the ready changes, gate, push, send back. { data, text, exitCode?, seen }. */
async function integrateRound({ root, env, deps, remote, main, command }) {
  let dir = null;
  try {
    // Read again under the lock: what was ready before it was taken may have landed since.
    const again = await git(root, ['fetch', '--prune', '--quiet', remote, `+refs/heads/*:refs/remotes/${remote}/*`], env);
    if (!again.ok) throw new IntegrateError(`git fetch ${remote} failed: ${again.why}`);
    const origin = await must(root, ['rev-parse', '--verify', `refs/remotes/${remote}/${main}^{commit}`], env, `${remote}/${main}`);
    const { changes: all, malformed } = await readyChanges(root, remote, env);
    const seen = all.map(c => c.sha);
    const blockedBefore = all.filter(c => c.status === 'blocked');
    const landedBefore = [], todo = [];
    for (const c of all.filter(x => x.status !== 'blocked')) {
      if ((await git(root, ['merge-base', '--is-ancestor', c.head, origin], env)).ok) landedBefore.push(c); else todo.push(c);
    }
    for (const c of landedBefore) await git(root, ['push', '--quiet', `--force-with-lease=refs/heads/${c.ref}:${c.sha}`, remote, `:refs/heads/${c.ref}`], env);
    const report = { ok: true, lock: LOCK, remote, branch: main, base: origin, command, commands: [], gates: 0, pushed: null,
      landed: [], blocked: [], stillBlocked: blockedBefore.map(c => ({ branch: c.branch, head: c.head, reason: c.blocked })),
      alreadyLanded: landedBefore.map(c => c.branch), malformed };
    if (!todo.length) return { data: report, seen, text: `Nothing is ready${blockedBefore.length ? ` (still blocked: ${blockedBefore.map(c => c.branch).join(', ')})` : ''}. No gate ran.` };

    dir = await mkdtemp(join(deps.tmp ?? tmpdir(), 'keel-integrate-'));
    await rm(dir, { recursive: true, force: true });
    await must(root, ['worktree', 'add', '--quiet', '--detach', dir, origin], env, 'the integration worktree');
    // A project's installed packages are not in a fresh worktree. The integrator's own are linked in, per gate
    // run, only for a candidate whose manifest and lockfiles are the checkout's, byte for byte (dependencies).
    const installed = (await stat(join(root, 'node_modules')).catch(() => null))?.isDirectory() ?? false;

    const treeOf = async sha => must(root, ['rev-parse', `${sha}^{tree}`], env, 'a tree');
    const passed = new Set();
    const runGate = deps.gate ?? ((cwd, o) => shell(o.command, { cwd, env: o.env }));
    /** The full gate on `sha`: { ok, why } (why: a reason other than the gate's own failure, or null). */
    const gateOn = async sha => {
      report.gates++;
      await must(dir, ['checkout', '--quiet', '--detach', '--force', sha], env, 'the tree to gate');
      await git(dir, ['clean', '-ffdxq'], env);
      // The candidate's own gate and env, never the integrator's checkout's: a stale checkout, or a change
      // that edits `check`, would otherwise be gated by a command it does not name.
      const own = await candidateGate(dir);
      if (own.why) return { ok: false, why: own.why };
      if (!report.commands.includes(own.command)) report.commands.push(own.command);
      await rm(join(dir, 'node_modules'), { force: true }).catch(() => {});
      if (installed) {
        if (!await sameDependencies(root, dir)) return { ok: false, why: DEPENDENCIES };
        await symlink(join(root, 'node_modules'), join(dir, 'node_modules'));
      }
      const r = await runGate(dir, { env: gateEnv(env, own.config), sha, command: own.command });
      if (r.status !== 0) return { ok: false, why: null };
      // A pass counts only for the tree that was gated: a gate that regenerates a tracked file (or commits) has
      // passed a tree it made, and `sha`, unrepaired, would be pushed.
      const head = await git(dir, ['rev-parse', 'HEAD'], env);
      const status = await git(dir, ['status', '--porcelain', '--untracked-files=no'], env);
      if (!head.ok || head.stdout.trim() !== sha || !status.ok || status.stdout.trim()) return { ok: false, why: 'the gate changed tracked files' };
      passed.add(await treeOf(sha));
      return { ok: true, why: null };
    };
    /** `list` merged onto `base`, in order: { sha } or { conflict: change }. */
    const apply = async (base, list) => {
      await must(dir, ['checkout', '--quiet', '--detach', '--force', base], env, 'the batch base');
      await git(dir, ['clean', '-ffdxq'], env);
      for (const c of list) {
        const m = await git(dir, ['merge', '--no-ff', '--quiet', '-m', `integrate: ${c.branch} (${c.head.slice(0, 7)})`, c.head], env);
        if (!m.ok) { await git(dir, ['merge', '--abort'], env); return { conflict: c }; }
      }
      return { sha: await must(dir, ['rev-parse', 'HEAD'], env, 'the batch') };
    };
    const failed = why => why ?? `fails the gate on ${main}`;
    const reject = async (c, base, kept, kind, why) => {
      let reason;
      if (!kept.length) reason = kind === 'conflict' ? `does not merge onto ${main}` : failed(why);
      else {
        // Once, to say which it is: its own failure, or the combination with what was kept before it.
        const alone = await apply(origin, [c]);
        const names = kept.map(k => k.branch).join(', ');
        if (alone.conflict) reason = `does not merge onto ${main}`;
        else if (kind === 'conflict') reason = `conflicts with ${names}: it merges onto ${main} alone, and not on top of ${kept.length === 1 ? 'it' : 'them'}`;
        else {
          const g = await gateOn(alone.sha);
          reason = g.ok ? `conflicts with ${names}: each passes the gate alone, and together they fail it` : failed(g.why);
        }
      }
      report.blocked.push({ branch: c.branch, head: c.head, reason, with: kept.length && /^conflicts/.test(reason) ? kept.map(k => k.branch) : [] });
    };
    /** Accumulate: keep each change only on top of what was kept before it. { sha, kept }. */
    const accept = async (base, list, kept) => {
      const r = await apply(base, list);
      const g = r.conflict ? null : await gateOn(r.sha);
      if (g?.ok) return { sha: r.sha, kept: [...kept, ...list] };
      if (list.length === 1) { await reject(list[0], base, kept, r.conflict ? 'conflict' : 'gate', g?.why ?? null); return { sha: base, kept }; }
      const half = Math.ceil(list.length / 2);
      const left = await accept(base, list.slice(0, half), kept);
      return accept(left.sha, list.slice(half), left.kept);
    };
    const result = await accept(origin, todo, []);
    report.landed = result.kept.map(c => ({ branch: c.branch, head: c.head }));
    report.ok = report.blocked.length === 0;

    if (result.kept.length) {
      // The tree pushed is one the gate passed, or nothing is pushed. The accumulation already ends on a tree it
      // gated; this says so where the push is, so a change to the search cannot push a combination never gated.
      if (!pushable(await treeOf(result.sha), passed) && !(await gateOn(result.sha)).ok) {
        report.landed = [];
        report.ok = false;
        throw new IntegrateError(`the combined tree failed the gate: nothing was pushed (${todo.map(c => c.branch).join(', ')} stay ready)`, 1);
      }
      const pushed = await git(root, ['push', '--quiet', `--force-with-lease=refs/heads/${main}:${origin}`, remote, `${result.sha}:refs/heads/${main}`], env);
      if (!pushed.ok) {
        report.landed = [];
        throw new IntegrateError(`${main} could not be pushed (${pushed.why}): it moved while the batch was gated. Nothing landed; every change stays ready. Run keel integrate again.`, 1);
      }
      report.pushed = result.sha;
      for (const c of result.kept) await git(root, ['push', '--quiet', `--force-with-lease=refs/heads/${c.ref}:${c.sha}`, remote, `:refs/heads/${c.ref}`], env);
    }
    // Sent back: the ready ref says blocked and why. A lease, so a session that marked it ready again since keeps its own.
    for (const b of report.blocked) {
      const c = todo.find(x => x.branch === b.branch);
      const at = new Date(deps.now ?? Date.now()).toISOString();
      const msg = readyMessage({ ...c, status: 'blocked', blocked: b.reason, at: c.at, checks: c.checks });
      const sha = await git(root, ['commit-tree', `${c.head}^{tree}`, '-p', c.head, '-m', msg], { ...env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
      if (sha.ok) await git(root, ['push', '--quiet', `--force-with-lease=refs/heads/${c.ref}:${c.sha}`, remote, `${sha.stdout.trim()}:refs/heads/${c.ref}`], env);
    }
    const lines = [
      report.pushed ? `Landed on ${main} in one push (${report.pushed.slice(0, 7)}): ${report.landed.map(l => l.branch).join(', ')}.` : 'Nothing landed.',
      `The full gate (${(report.commands.length ? report.commands : [command]).map(c => `\`${c}\``).join(', ')}) ran ${report.gates} time${report.gates === 1 ? '' : 's'}.`,
      ...report.blocked.map(b => `Sent back: ${b.branch} ${b.reason}. Fix it on its branch and keel ready again.`),
      ...(report.stillBlocked.length ? [`Still blocked: ${report.stillBlocked.map(b => b.branch).join(', ')}.`] : []),
      ...(malformed.length ? [`Not a ready ref keel made (skipped): ${malformed.join(', ')}.`] : []),
    ];
    return { data: report, text: lines.join('\n'), seen, ...(report.ok ? {} : { exitCode: 1 }) };
  } finally {
    if (dir) {
      await git(root, ['worktree', 'remove', '--force', dir], env);
      await rm(dir, { recursive: true, force: true });
      await git(root, ['worktree', 'prune'], env);
    }
  }
}

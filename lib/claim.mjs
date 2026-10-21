// plates phase claim, and the free set plates next hands out (plates phase 70;
// docs/research/2026-10-12-claims-and-review-rounds.md).
//
//   plates phase claim <n> [--provider <name>]   push claims/phase-<n>, create-only
//   plates phase claim <n> --release             delete this checkout's claim
//   plates next                                  every ready phase: free, or claimed and by whom
//
// On 2026-10-10 two sessions built phase 54 at once and one was thrown away:
// plates knew which phase was next and had no way to say it was taken.
//
// The claim is one shared branch per phase, claims/phase-<n>, the same name
// for every provider, so two claims of one phase meet on one ref. The push is
// create-only (--force-with-lease=<ref>: succeeds only when the ref does not
// exist), and the server lets exactly one through. The claim is a commit of
// its own on the default branch's head whose message names the provider, the
// machine, the time and a random token made fresh for each attempt. The token
// is what makes two claims differ: without it, two sessions with one git
// identity in one second make the same commit, and git reports the second
// push as up to date. A checkout knows it holds a claim by finding its own
// token (kept under its git dir) on the remote ref. That says the claim was
// made from this working tree; whose it is among the sessions sharing the
// tree is the caller's to show (owns: its provider and session id, or
// --token), so a second session there is refused like any other (plates#119).
//
// An open PR whose branch names the phase is a claim too, so work that began
// before this phase counts. A claim ends when its phase is built on the
// default branch, or it is released.
//
// Nothing here guesses. When the fetch fails, or gh cannot list the open PRs,
// the claims could not be read: exit 2, and no phase is listed as free. Where
// there is no remote at all there is nowhere to hold a claim, and plates next
// lists what is ready as it always did, saying so.
//
// plates never releases another session's claim. A claim idle for seven days is
// the owner's item on the board (claimItems): release it by hand, or leave it.
//
// Exit codes: 0 claimed, held or released; 1 refused (someone else holds it,
// or a release with work on it); 2 usage, no remote, or the claims unread.
// gh is PLATES_GH or gh, as everywhere.
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { collect, nextPhase, nothingNext, parsePhase, DONE } from '../practices/phases/files/scripts/roadmap.mjs';

export const CLAIM_PREFIX = 'claims/phase-';
/** A claim with no push for this many days is the owner's item on the board. A guess: the phase's week of use settles it. */
export const STALE_DAYS = 7;
const DAY = 86_400_000;
const TIMEOUT = 30_000;
const PR_LIMIT = 200;
const PROVIDER = /^[a-z][a-z0-9-]{0,39}$/;
/** A branch that names a phase: claude/phase-54-robot, codex/phase-7. */
const NAMES_PHASE = /(?:^|[/_-])phase-0*(\d+)(?!\d)/i;

export class ClaimError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const lastLine = s => String(s ?? '').trim().split('\n').filter(Boolean).pop() ?? 'failed';
const exec = (cmd, args, { env, timeout = TIMEOUT } = {}) => new Promise(done => {
  execFile(cmd, args, { env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    done(error ? { ok: false, why: lastLine(stderr || error.message), stdout: stdout ?? '' } : { ok: true, stdout });
  });
});
// Never a prompt: a fetch that wants a password has failed.
const git = (root, args, env = process.env) => exec('git', ['-C', root, ...args], { env: { ...env, GIT_TERMINAL_PROMPT: '0' } });

/**
 * Push `sha` to `ref` on `remote` only if the ref does not exist there: an
 * empty expected value in --force-with-lease means "must not exist", and of
 * two such pushes the server takes one. The phase claim's push, and the
 * integrator's lock (claims/integrate, lib/integrate.mjs). Its answer is not
 * the last word: read the ref back to learn whose push won.
 */
export const pushCreateOnly = (root, remote, sha, ref, env = process.env) =>
  git(root, ['push', '--quiet', `--force-with-lease=${ref}:`, remote, `${sha}:${ref}`], env);

export const claimBranch = id => `${CLAIM_PREFIX}${id}`;
/** The phase a branch names, or null. A claim branch names a claim, not work. */
export const phaseOfBranch = name => { const m = name.startsWith('claims/') ? null : NAMES_PHASE.exec(name); return m ? Number(m[1]) : null; };

/** Who is claiming: --provider, PLATES_PROVIDER, else the agent this process runs under; null when none says. */
export function providerOf(env = process.env, named) {
  const p = named || env.PLATES_PROVIDER || (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT ? 'claude' : Object.keys(env).some(k => k.startsWith('CODEX_')) ? 'codex' : null);
  if (p !== null && !PROVIDER.test(p)) throw new ClaimError(`a provider is a short lowercase name, like claude or codex; not "${p}"`);
  return p;
}

/**
 * The session a caller runs in, or null: PLATES_SESSION, else the id the agent
 * itself puts in the environment. Only one is known and was seen set: Claude
 * Code's CLAUDE_CODE_SESSION_ID. No such variable is known for Codex, so none
 * is read: a Codex session sets PLATES_SESSION, or is told apart by provider only.
 */
export const sessionOf = (env = process.env) => env.PLATES_SESSION || env.CLAUDE_CODE_SESSION_ID || null;

/**
 * Whether a claim on the remote is the caller's own (plates#119). A token file
 * under this tree's git dir says the claim was made from this tree; it does
 * not say by whom, and two sessions can share a tree. So the caller proves it:
 *   - with --token, the token plates printed to the claimer (right or refused);
 *   - else by naming the claim's provider, and by its session id being the
 *     one recorded when the claim was made.
 * A claim recorded with no session id (the claimer's agent exposes none, or
 * the claim predates this) is resumable by any caller of its provider in this
 * tree: the known limit that remains.
 */
function owns(c, caller) {
  if (!c.here || !c.token) return false;
  if (caller.token) return caller.token === c.token;
  if (!caller.provider || caller.provider !== c.provider) return false;
  if (c.session) return caller.session === c.session;
  return true;
}

/** The remote a claim lives on: origin, else the first one, else null (no remote, or not a git checkout). */
export async function remoteOf(root, env = process.env) {
  const r = await git(root, ['remote'], env);
  if (!r.ok) return null;
  const names = r.stdout.split('\n').filter(Boolean);
  return names.includes('origin') ? 'origin' : names[0] ?? null;
}

/**
 * The remote's default branch: { branch } or { why }. Never guessed from a
 * name. A fetch does not move the checkout's cached <remote>/HEAD, and a
 * checkout made with git init and remote add has none: a remote whose default
 * is develop, with an old main still there, would have its phases read from
 * main, and a claim on a phase main calls built could be released by anyone.
 * So a fresh read asks the remote what it advertises (one ls-remote); only
 * the board's read of what was last fetched uses the cached HEAD.
 */
export async function defaultBranch(root, remote, env, fresh) {
  if (fresh) {
    const r = await git(root, ['ls-remote', '--symref', remote, 'HEAD'], env);
    if (!r.ok) return { why: `git ls-remote ${remote} HEAD failed: ${r.why}` };
    const branch = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(r.stdout)?.[1];
    return branch ? { branch } : { why: `${remote} advertises no default branch (its HEAD names no branch that exists)` };
  }
  const head = await git(root, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], env);
  return head.ok ? { branch: head.stdout.trim().slice(remote.length + 1) }
    : { why: `this checkout does not know ${remote}'s default branch (git remote set-head ${remote} -a)` };
}

// Where this checkout keeps the tokens of its own claims: under its git dir, never in the tree. One file per
// attempt, named by its token (keel-claims/phase-<n>.d/<token>), never one shared file: two claim commands in
// one checkout would overwrite each other's token there, and the loser's cleanup would delete the winner's.
// With a file each, an attempt writes and removes only its own, and no lock is needed.
const SAFE_TOKEN = /^[\w-]{1,128}$/;
async function tokenPaths(root, id, env) {
  const r = await git(root, ['rev-parse', '--git-path', `keel-claims/phase-${id}`], env);
  if (!r.ok) return null;
  const legacy = resolve(root, r.stdout.trim());
  // `legacy` is the one shared file the first build of this phase wrote: still read, so a claim made with it stays its checkout's.
  return { legacy, dir: `${legacy}.d` };
}
const legacyToken = async paths => (await readFile(paths.legacy, 'utf8').catch(() => '')).trim() || null;
/**
 * What this tree recorded when it made the claim with `token` (read from the
 * remote ref): { session } (null when none was known), or null when the claim
 * was not made here. A token is a file name here: anything else is not ours.
 */
async function tokenRecord(root, id, token, env) {
  if (!token || !SAFE_TOKEN.test(token)) return null;
  const paths = await tokenPaths(root, id, env);
  if (!paths) return null;
  const file = join(paths.dir, token);
  if ((await stat(file).catch(() => null))?.isFile()) {
    // An empty file is a claim made before sessions were recorded.
    let session = null;
    try { session = JSON.parse(await readFile(file, 'utf8')).session ?? null; } catch { /* no record */ }
    return { session: typeof session === 'string' && session ? session : null };
  }
  return await legacyToken(paths) === token ? { session: null } : null;
}
async function keepToken(root, id, token, env) {
  if (!SAFE_TOKEN.test(token)) throw new ClaimError(`a claim token is letters, digits, - and _; not "${token}"`);
  const paths = await tokenPaths(root, id, env);
  if (!paths) throw new ClaimError('this checkout has no git dir to keep a claim token in');
  await mkdir(paths.dir, { recursive: true });
  await writeFile(join(paths.dir, token), `${JSON.stringify({ session: sessionOf(env) })}\n`);
}
/** Forget one token, and only that one: another attempt's is never touched. */
async function dropToken(root, id, token, env) {
  if (!token || !SAFE_TOKEN.test(token)) return;
  const paths = await tokenPaths(root, id, env);
  if (!paths) return;
  await rm(join(paths.dir, token), { force: true });
  if (await legacyToken(paths) === token) await rm(paths.legacy, { force: true });
}

const field = (message, key) => new RegExp(`^${key}: (.+)$`, 'm').exec(message)?.[1].trim() ?? null;
/** The claim commit's message: what a loser reads to say who holds the phase. */
export const claimMessage = ({ phase, provider, machine, at, token }) =>
  `claim: phase ${phase}\n\nPhase: ${phase}\nProvider: ${provider}\nMachine: ${machine}\nAt: ${at}\nToken: ${token}\n`;

/**
 * Every claim the remote shows, read fresh. Throws ClaimError (exit 2) when
 * the fetch fails, the remote's default branch cannot be resolved, or gh
 * cannot list the open PRs: unread is never "free".
 * `fetch: false` reads the refs as last fetched and `prs: false` asks gh
 * nothing (the board's 60 s refresh). Returns { remote, branch, ref, claims,
 * prs, work, ended(id), holder(id) }.
 */
export async function readClaims({ root, config, env = process.env, fetch = true, prs: readPrs = true, branch: known, caller }) {
  // Who is asking: a claim is `mine` only for the session that made it (owns). plates next has no --provider or --token to go by.
  caller ??= { provider: (() => { try { return providerOf(env); } catch { return null; } })(), session: sessionOf(env) };
  const remote = await remoteOf(root, env);
  if (!remote) throw new ClaimError('no git remote here: a claim is a branch every session can see, and there is nowhere to push one');
  const unread = why => new ClaimError(`the claims could not be read: ${why}. No phase is listed as free.`);
  if (fetch) {
    // Every branch, not only the configured refspec: a single-branch clone must still see the claims.
    const r = await git(root, ['fetch', '--prune', '--quiet', remote, `+refs/heads/*:refs/remotes/${remote}/*`], env);
    if (!r.ok) throw unread(`git fetch ${remote} failed: ${r.why}`);
  }
  // `known`: the default branch a fresh read of this same command already resolved (claim's read-back).
  const found = known ? { branch: known } : await defaultBranch(root, remote, env, fetch);
  if (!found.branch) throw unread(found.why);
  const branch = found.branch, ref = `${remote}/${branch}`;
  if (!(await git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/${ref}^{commit}`], env)).ok) throw unread(`${remote}'s default branch is ${branch}, and this checkout has no ${ref}`);
  const refs = await git(root, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(committerdate:unix)', `refs/remotes/${remote}/`], env);
  if (!refs.ok) throw unread(`git for-each-ref failed: ${refs.why}`);
  const claims = [], work = [];
  for (const line of refs.stdout.split('\n').filter(Boolean)) {
    const [full, sha, unix] = line.split('\t');
    const name = full.slice(`refs/remotes/${remote}/`.length);
    const at = Number(unix) * 1000;
    const claimed = /^claims\/phase-(\d+)$/.exec(name);
    if (claimed) {
      const id = Number(claimed[1]);
      const message = (await git(root, ['log', '-1', '--format=%B', sha], env)).stdout ?? '';
      const token = field(message, 'Token');
      const record = await tokenRecord(root, id, token, env);
      const c = { phase: id, branch: name, sha, provider: field(message, 'Provider') ?? 'unknown', machine: field(message, 'Machine') ?? 'unknown',
        at: new Date(at).toISOString(), token, here: !!record, session: record?.session ?? null };
      claims.push({ ...c, mine: owns(c, caller) });
      continue;
    }
    const id = phaseOfBranch(name);
    if (id !== null && name !== branch) work.push({ phase: id, branch: name, at });
  }
  let prs = null;
  if (readPrs && /^[\w.-]+\/[\w.-]+$/.test(config?.repo ?? '')) {
    const r = await exec(env.PLATES_GH || 'gh', ['pr', 'list', '-R', config.repo, '--state', 'open', '--limit', String(PR_LIMIT),
      '--json', 'number,url,headRefName,author,createdAt,state'], { env });
    if (!r.ok) throw unread(`gh pr list -R ${config.repo} failed: ${r.why}`);
    let list;
    try { list = JSON.parse(r.stdout); } catch { list = null; }
    if (!Array.isArray(list)) throw unread(`gh pr list -R ${config.repo} did not print a JSON array`);
    if (list.length >= PR_LIMIT) throw unread(`${config.repo} has ${PR_LIMIT} or more open PRs, more than one read lists`);
    // Asked for open ones; a merged or closed PR that comes back anyway is not a claim.
    prs = list.filter(p => (p.state ?? 'OPEN') === 'OPEN' && typeof p.headRefName === 'string' && phaseOfBranch(p.headRefName) !== null)
      .map(p => ({ phase: phaseOfBranch(p.headRefName), number: p.number, url: p.url ?? null, branch: p.headRefName, author: p.author?.login ?? null, at: p.createdAt ?? null }));
  }
  // A phase's status on the default branch, as the remote has it: a claim ends when the phase is built there.
  let names = null;
  const statuses = new Map();
  const statusOnDefault = async id => {
    if (statuses.has(id)) return statuses.get(id);
    names ??= ((await git(root, ['ls-tree', '--name-only', `${ref}:docs/phases`], env)).stdout ?? '').split('\n').filter(Boolean);
    const file = names.find(n => Number(/^(\d+)-.*\.md$/.exec(n)?.[1] ?? NaN) === id);
    const raw = file ? (await git(root, ['show', `${ref}:docs/phases/${file}`], env)).stdout ?? '' : '';
    // The roadmap's own parser, so `status: "built"` reads as it does everywhere else. A file it rejects for some
    // other reason (a section missing) still says its status: the two fields, decoded by the parser's rule (a
    // value that starts with a quote is JSON).
    let found = { status: null, owes: null };
    if (file) {
      try { const meta = parsePhase(file, raw); found = { status: meta.status, owes: meta.owes ?? null }; } catch {
        const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? '';
        const decoded = key => { const v = field(front, key); try { return v?.startsWith('"') ? JSON.parse(v) : v; } catch { return null; } };
        found = { status: decoded('status'), owes: decoded('owes') };
      }
    }
    statuses.set(id, found);
    return found;
  };
  /** Built, lived-in, superseded, or partial owing only a walk on the default branch: nothing in it is left to build. */
  const ended = async id => {
    const s = await statusOnDefault(id);
    return DONE.includes(s.status) || s.status === 'superseded' || (s.status === 'partial' && s.owes === 'walk');
  };
  /** Who holds a phase, or null: the claim branch first, else the open PR; `work` is every work branch naming it. */
  const holder = id => {
    const c = claims.find(x => x.phase === id), pr = prs?.find(x => x.phase === id) ?? null;
    const branches = work.filter(x => x.phase === id).map(x => x.branch);
    const shown = pr ? { number: pr.number, url: pr.url, branch: pr.branch, author: pr.author } : null;
    if (c) return { by: 'branch', branch: c.branch, provider: c.provider, machine: c.machine, at: c.at, mine: c.mine, here: c.here, pr: shown, work: branches };
    if (pr) return { by: 'pr', branch: pr.branch, provider: /^([a-z][a-z0-9-]*)\//.exec(pr.branch)?.[1] ?? null, machine: null, at: pr.at, mine: false, here: false, pr: shown, work: branches };
    return null;
  };
  return { remote, branch, ref, claims, prs, work, ended, holder };
}

/** A holder, in words: who, where, since when, on which branch. */
export const holderText = h => h.by === 'pr'
  ? `open PR #${h.pr.number} on ${h.branch}${h.pr.author || h.at ? ` (${[h.pr.author, h.at ? `since ${h.at}` : ''].filter(Boolean).join(', ')})` : ''}`
  : `${h.provider} on ${h.machine} since ${h.at} (${h.branch}${h.mine ? ', this session' : h.here ? ', this working tree, another session' : ''})${h.pr ? `, PR #${h.pr.number}` : ''}`;

/**
 * Claim a phase, or with `release` give this checkout's claim back.
 * `token` (--token) proves a claim made from this tree is the caller's own.
 * deps (tests): env, now (the clock), token (a fixed one), beforePush (runs
 * after the fetch and before the push: where a second session wins the race),
 * afterPush (runs before the remote is read back: where the connection drops).
 */
export async function claim({ root, phase, provider: named, release = false, token: given }, deps = {}) {
  const env = deps.env ?? process.env;
  if (given !== undefined && !SAFE_TOKEN.test(given)) throw new ClaimError('--token takes the token plates printed when the claim was made');
  if (!/^\d+$/.test(String(phase ?? ''))) throw new ClaimError('plates phase claim <n> [--provider <name>] [--release]: <n> is a phase number');
  const id = Number(phase);
  const data = await collect(root);
  const p = data.phases.find(x => x.id === id);
  if (!p) throw new ClaimError(`no phase ${id}; plates phase list names them`);
  // Named before anything is read: whether a claim found in this tree is the caller's turns on who the caller is.
  const provider = providerOf(env, named);
  const caller = { provider, session: sessionOf(env), token: given };
  const state = await readClaims({ root, config: data.config, env, caller });
  const branch = claimBranch(id), ref = `refs/heads/${branch}`;
  // Made from this tree, and not shown to be this caller's: another session's, as if it were another checkout's.
  const prove = `If the claim is yours, say so with the token plates printed when it was made: plates phase claim ${id}${release ? ' --release' : ''} --token <token>`;
  // Two different facts. This checkout's own tree saying built is a reason not to make a new claim. Only the
  // default branch on the remote saying so ends a claim: a checkout that marks a phase built before it merges
  // must not be able to clear another session's live claim, or skip the work checks.
  const ended = await state.ended(id);
  const built = ended || DONE.includes(p.status);
  const held = state.holder(id);
  const base = { phase: id, title: p.title, branch, remote: state.remote };
  const refuse = (text, more = {}) => ({ data: { ok: false, ...base, refused: true, holder: held, ...more }, text, exitCode: 1 });

  if (release) {
    const mine = state.claims.find(c => c.phase === id);
    if (!mine) return refuse(`Phase ${id} has no claim to release (${state.remote} has no ${branch}).`, { holder: null });
    // A claim that has ended (the phase is built on the default branch) is clutter, whoever made it; a live one is its holder's.
    if (!mine.mine && !ended) return refuse(`Phase ${id} is claimed by ${holderText(held)}, not by this session: plates never releases another session's claim. ${mine.here ? `${prove}. ` : ''}The owner can: git push ${state.remote} --delete ${branch}`);
    if (!ended) {
      const local = ((await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], env)).stdout ?? '').split('\n').filter(n => n && phaseOfBranch(n) === id);
      const branches = [...new Set([...held.work, ...local])];
      if (branches.length || held.pr) return refuse(`Phase ${id} has work on it: ${[...branches.map(b => `branch ${b}`), ...(held.pr ? [`open PR #${held.pr.number}`] : [])].join(', ')}. The claim stays until the phase is built on ${state.ref} or the work is gone. The owner can: git push ${state.remote} --delete ${branch}`, { work: branches });
    }
    // Only the claim that was read: a new one made since is not this one.
    const del = await git(root, ['push', '--quiet', `--force-with-lease=${ref}:${mine.sha}`, state.remote, `:${ref}`], env);
    if (!del.ok) throw new ClaimError(`the claim could not be released: git push ${state.remote} :${branch} failed: ${del.why}`, 1);
    // The released claim's own token only: a claim this checkout is making for the phase right now keeps its own.
    await dropToken(root, id, mine.token, env);
    return { data: { ok: true, ...base, released: true }, text: `Released ${branch}: phase ${id} is free.` };
  }

  if (built) return refuse(`Phase ${id} is ${DONE.includes(p.status) ? p.status : `built on ${state.ref}`}: nothing in it is left to claim.`);
  if (held?.mine) return { data: { ok: true, ...base, held: true, claimed: false, holder: held }, text: `Phase ${id} is already this session's: ${holderText(held)}.` };
  if (held) return refuse(`Phase ${id} is claimed: ${holderText(held)}. Take another free phase (plates next), or stop.${held.here ? ` ${prove}` : ''}`);

  if (!provider) throw new ClaimError('who is claiming? --provider <name> (claude, codex), or PLATES_PROVIDER');
  const now = new Date(deps.now ?? Date.now());
  const token = deps.token ?? randomBytes(16).toString('hex');
  const mine = { phase: id, provider, machine: env.PLATES_MACHINE || hostname(), at: now.toISOString(), token };
  // The commit's own dates are the claim's time, so the commit is what its message says and nothing else.
  const dated = { ...env, GIT_AUTHOR_DATE: mine.at, GIT_COMMITTER_DATE: mine.at };
  const made = await git(root, ['commit-tree', `${state.ref}^{tree}`, '-p', state.ref, '-m', claimMessage(mine)], dated);
  if (!made.ok) throw new ClaimError(`the claim commit could not be made: ${made.why}`, 1);
  const sha = made.stdout.trim();
  // Kept before the push: a session that dies between the two still knows the claim on the remote is its own.
  await keepToken(root, id, token, env);
  if (deps.beforePush) await deps.beforePush();
  const pushed = await pushCreateOnly(root, state.remote, sha, ref, env);
  // Whatever the push said, the remote ref is the answer: this session holds the claim when its own token is there.
  if (deps.afterPush) await deps.afterPush();
  const there = await git(root, ['fetch', '--quiet', state.remote, `+${ref}:refs/remotes/${state.remote}/${branch}`], env);
  // The remote could not be read after the push: whether the claim was made is unknown (a connection that drops
  // after git accepted it leaves the claim there). The token stays, so asking again finds a claim that is this
  // checkout's; it is removed only when a read shows someone else's.
  if (!there.ok) {
    throw new ClaimError(`phase ${id} may or may not be claimed: the push ${pushed.ok ? 'was accepted' : `failed (${pushed.why})`}, and ${state.remote} could not be read afterwards (${there.why}). `
      + `Nothing is assumed. Check: git ls-remote ${state.remote} ${ref}, or run plates phase claim ${id} again (it says "already this session's" if the claim was made).`);
  }
  const winner = (await readClaims({ root, config: data.config, env, fetch: false, prs: false, branch: state.branch })).claims.find(c => c.phase === id) ?? null;
  if (winner?.token === token) {
    // The token is handed to the claimer, once: what a restarted session, or one with no session id, shows to resume or release.
    return { data: { ok: true, ...base, held: true, claimed: true, sha, token, holder: { by: 'branch', branch, provider, machine: mine.machine, at: winner.at, mine: true, here: true, pr: null, work: [] } },
      text: `Claimed phase ${id}: ${branch} on ${state.remote} (${provider} on ${mine.machine}, ${winner.at}). Build it on ${provider}/phase-${id}.\nToken: ${token} (this session needs no flag; another session in this working tree resumes or releases the claim only with --token)` };
  }
  // A read that shows another winner, or no claim at all: this attempt's token names nothing. Only its own is
  // removed: the winner may be another claim command in this same checkout.
  await dropToken(root, id, token, env);
  if (!winner) throw new ClaimError(`the claim could not be pushed: ${pushed.ok ? `${state.remote} does not show ${branch}` : pushed.why}`, 1);
  const theirs = { by: 'branch', branch, provider: winner.provider, machine: winner.machine, at: winner.at, mine: false, here: winner.here, pr: null, work: [] };
  return { data: { ok: false, ...base, refused: true, holder: theirs }, text: `Phase ${id} is claimed: ${holderText(theirs)}. Take another free phase (plates next), or stop.`, exitCode: 1 };
}

const phaseLine = p => `${p.id}. ${p.title} [${p.status}] — docs/phases/${p.file}`;

/**
 * plates next: every phase that is ready (not built, not dated, its depends:
 * satisfied, as nextPhase reads it), split into free and claimed. `next` is
 * the first free one. { next, free, claimed, behind, claims }.
 */
export async function nextFree({ root, data }, deps = {}) {
  const env = deps.env ?? process.env;
  const retired = new Set(data.goals.filter(g => g.retired).map(g => g.id));
  const ready = data.phases.filter(p => nextPhase(data.phases, x => x === p && !retired.has(x.goal), deps.today));
  const nothing = () => nothingNext(data.phases, data.goals, deps.today);
  if (!await remoteOf(root, env)) {
    const why = 'no git remote here, so there is nowhere to hold a claim';
    const next = ready[0] ?? null;
    return { data: { next, free: ready, claimed: [], behind: [], claims: { read: false, why } },
      text: [next ? `${phaseLine(next)}\nDone when: ${next.done}\nNext action: ${next.next}` : nothing(),
        ...(ready.length > 1 ? ['', 'Also ready:', ...ready.slice(1).map(p => `  ${phaseLine(p)}`)] : [])].join('\n') };
  }
  const state = await readClaims({ root, config: data.config, env });
  const free = [], claimed = [], behind = [];
  for (const p of ready) {
    // Built on the default branch and not in this checkout yet: neither free nor claimed. Pull.
    if (await state.ended(p.id)) { behind.push(p.id); continue; }
    const holder = state.holder(p.id);
    if (holder) claimed.push({ id: p.id, title: p.title, file: p.file, status: p.status, holder });
    else free.push(p);
  }
  const next = free[0] ?? null;
  const text = [
    next ? `${phaseLine(next)}\nDone when: ${next.done}\nNext action: ${next.next}\nClaim it before building: plates phase claim ${next.id}`
      : claimed.length ? 'Nothing is free: every ready phase is claimed.' : nothing(),
    ...(free.length > 1 ? ['', 'Also free:', ...free.slice(1).map(p => `  ${phaseLine(p)}`)] : []),
    ...(claimed.length ? ['', 'Claimed:', ...claimed.map(c => `  ${c.id}. ${c.title} — ${holderText(c.holder)}${c.holder.work.length ? `; work on ${c.holder.work.join(', ')}` : ''}`)] : []),
    ...(behind.length ? ['', `Built on ${state.ref}, not in this checkout (pull first): ${behind.map(id => `phase ${id}`).join(', ')}`] : []),
  ].join('\n');
  return { data: { next, free, claimed, behind, claims: { read: true, remote: state.remote, branch: state.branch, prs: state.prs !== null } }, text };
}

/**
 * The board's claims source: a live claim with no push for STALE_DAYS is the
 * owner's item. A push is the claim itself or a commit on a branch that names
 * the phase. The refs are read as last fetched; `fresh` fetches first.
 */
export async function claimItems(root, { env = process.env, fresh = false, now = Date.now(), days = STALE_DAYS } = {}) {
  let state;
  try { state = await readClaims({ root, env, fetch: fresh, prs: false }); } catch (e) { return { na: e.message }; }
  const at = new Date(now).getTime(), items = [];
  for (const c of state.claims) {
    if (await state.ended(c.phase)) continue;
    const last = Math.max(Date.parse(c.at), ...state.work.filter(w => w.phase === c.phase).map(w => w.at));
    const idle = Math.floor((at - last) / DAY);
    if (idle < days) continue;
    items.push({ waits: 'owner', kind: 'claim', source: 'claims', phase: c.phase, title: `phase ${c.phase}: claimed by ${c.provider} on ${c.machine}, idle ${idle} days`,
      why: `${c.branch} since ${c.at.slice(0, 10)}, no push since ${new Date(last).toISOString().slice(0, 10)}. Release it (git push ${state.remote} --delete ${c.branch}) or leave it: plates never releases another session's claim.`,
      read: `git log -1 ${state.remote}/${c.branch}`, link: null, actions: [] });
  }
  return { items, ...(fresh ? {} : { why: 'as last fetched; --fresh fetches' }) };
}

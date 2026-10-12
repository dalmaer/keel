// keel phase claim and the free set of keel next (phase 70): two clones of
// one bare Acme origin, on this machine's disk. No network: gh is a stub that
// prints the PRs a test wrote, or fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claim, nextFree, readClaims, claimItems, providerOf, phaseOfBranch, claimMessage } from '../lib/claim.mjs';
import { collect } from '../practices/phases/files/scripts/roadmap.mjs';
import { run } from './helpers/run.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const NOW = '2026-10-12T10:00:00.000Z';

const phase = ({ status = 'planned', depends = '[]', evidence = '[]', title }) => `---
status: ${status}
since: 2026-10-01
goal: G0
depends: ${depends}
note: "Acme."
evidence: ${evidence}
---

# ${title}

## Done when

The anvil lands.

## Scope

Small.

## Acceptance

- [${status === 'built' ? 'x' : ' '}] Lands. \`tests/anvil.test.mjs\`

## Proof

A command.

## Deliberately open

Nothing yet.

## Next action

Build the anvil.
`;

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * One bare Acme origin and two clones of it, `a` and `b`. Phase 0 is built;
 * 1 and 2 are ready; 3 depends on 2, so it is not. `gh` is the stub and
 * `prs(list)` sets what it prints (null: gh fails). `env(machine)` is a
 * session's environment.
 */
async function acme(t) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-claim-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seed = join(dir, 'seed'), origin = join(dir, 'origin.git');
  const w = async (p, text) => { await mkdir(dirname(join(seed, p)), { recursive: true }); await writeFile(join(seed, p), text); };
  await w('.keel/keel.json', JSON.stringify({ name: 'Acme', repo: 'acme/app', practices: ['phases'] }));
  await w('docs/goals.json', JSON.stringify([{ id: 'G0', title: 'Anvils', outcome: 'They land.' }]));
  await w('docs/evidence/acme-0.md', '# Evidence: phase 0\n');
  await w('docs/phases/00-start.md', phase({ status: 'built', evidence: '["evidence/acme-0.md"]', title: 'Start' }));
  await w('docs/phases/01-anvil.md', phase({ depends: '[0]', title: 'Build the anvil' }));
  await w('docs/phases/02-rocket.md', phase({ depends: '[0]', title: 'Build the rocket' }));
  await w('docs/phases/03-sled.md', phase({ depends: '[2]', title: 'Strap the rocket to a sled' }));
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'acme');
  execFileSync('git', ['clone', '-q', '--bare', seed, origin]);
  const a = join(dir, 'a'), b = join(dir, 'b');
  for (const clone of [a, b]) execFileSync('git', ['clone', '-q', origin, clone]);
  const gh = join(dir, 'gh'), list = join(dir, 'prs.json');
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
if (a[0] !== 'pr' || a[1] !== 'list' || !fs.existsSync(${JSON.stringify(list)})) { console.error('gh: offline'); process.exit(1); }
process.stdout.write(fs.readFileSync(${JSON.stringify(list)}, 'utf8'));
`, { mode: 0o755 });
  const prs = async value => value === null ? rm(list, { force: true }) : writeFile(list, JSON.stringify(value));
  await prs([]);
  const env = (machine = 'acme-host') => ({ ...process.env, KEEL_GH: gh, KEEL_MACHINE: machine, KEEL_PROVIDER: '' });
  return { dir, origin, a, b, env, prs };
}

const keel = (args, cwd, env) => {
  const r = run(process.execPath, [BIN, ...args], { cwd, env });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
};
const remoteClaim = (origin, n) => { try { return git(origin, 'rev-parse', '--verify', '--quiet', `refs/heads/claims/phase-${n}`); } catch { return null; } };

test('keel phase claim pushes claims/phase-<n>, its own commit on the default branch\'s head; a second claim from another clone is refused, naming the holder', async t => {
  const x = await acme(t);
  const first = keel(['phase', 'claim', '1', '--provider', 'claude', '--json'], x.a, x.env('acme-laptop'));
  assert.equal(first.code, 0, first.out + first.err);
  const won = first.json();
  assert.deepEqual([won.ok, won.claimed, won.held, won.branch], [true, true, true, 'claims/phase-1']);
  // The branch is on the origin, one commit past main, with main's tree, and its message says who, where, when, and a token.
  const sha = remoteClaim(x.origin, 1);
  assert.equal(sha, won.sha);
  assert.equal(git(x.origin, 'rev-parse', `${sha}^`), git(x.origin, 'rev-parse', 'refs/heads/main'));
  assert.equal(git(x.origin, 'rev-parse', `${sha}^{tree}`), git(x.origin, 'rev-parse', 'refs/heads/main^{tree}'));
  const message = git(x.origin, 'log', '-1', '--format=%B', sha);
  assert.match(message, /^claim: phase 1\n\nPhase: 1\nProvider: claude\nMachine: acme-laptop\nAt: \d{4}-\d\d-\d\dT[\d:.]+Z\nToken: [0-9a-f]{32}$/);

  // Another clone, another provider: refused (exit 1), told who holds it and since when; nothing on the origin moved.
  const second = keel(['phase', 'claim', '1', '--provider', 'codex', '--json'], x.b, x.env('acme-desktop'));
  assert.equal(second.code, 1, second.out + second.err);
  const lost = second.json();
  assert.deepEqual([lost.ok, lost.refused], [false, true]);
  assert.deepEqual([lost.holder.by, lost.holder.provider, lost.holder.machine, lost.holder.branch, lost.holder.mine], ['branch', 'claude', 'acme-laptop', 'claims/phase-1', false]);
  assert.equal(lost.holder.at, won.holder.at);
  assert.equal(remoteClaim(x.origin, 1), sha);
  const said = keel(['phase', 'claim', '1', '--provider', 'codex'], x.b, x.env('acme-desktop'));
  assert.equal(said.code, 1);
  assert.match(said.out, new RegExp(`^Phase 1 is claimed: claude on acme-laptop since ${won.holder.at.replace(/[.]/g, '\\.')} \\(claims/phase-1\\)\\. Take another free phase \\(keel next\\), or stop\\.\\n$`));

  // The holder asking again finds its own token on the remote ref: it holds the claim, and makes no second one.
  const again = keel(['phase', 'claim', '1', '--provider', 'claude', '--json'], x.a, x.env('acme-laptop')).json();
  assert.deepEqual([again.ok, again.held, again.claimed, again.holder.mine], [true, true, false, true]);
  assert.equal(remoteClaim(x.origin, 1), sha);

  // A phase that is not there, a phase already built, and no provider named: nothing pushed.
  assert.equal(keel(['phase', 'claim', '9', '--provider', 'claude', '--json'], x.a, x.env()).code, 2);
  const built = keel(['phase', 'claim', '0', '--provider', 'claude', '--json'], x.a, x.env());
  assert.equal(built.code, 1);
  assert.match(keel(['phase', 'claim', '0', '--provider', 'claude'], x.a, x.env()).out, /^Phase 0 is built: nothing in it is left to claim\.\n$/);
  const env = x.env();
  for (const k of Object.keys(env)) if (k.startsWith('CODEX_') || k.startsWith('CLAUDE')) delete env[k];
  const nobody = keel(['phase', 'claim', '2', '--json'], x.a, env);
  assert.equal(nobody.code, 2);
  assert.match(nobody.json().error, /who is claiming\? --provider/);
  assert.equal(remoteClaim(x.origin, 2), null);
});

test('two providers that both fetched before either pushed race the claim: exactly one succeeds, and the other is told who holds it', async t => {
  const x = await acme(t);
  // Deterministic: claude has fetched and made its commit; codex then fetches, pushes and wins; only then does claude push.
  let codex;
  const claude = await claim({ root: x.a, phase: '1', provider: 'claude' }, { env: x.env('acme-laptop'),
    beforePush: async () => { codex = await claim({ root: x.b, phase: '1', provider: 'codex' }, { env: x.env('acme-desktop') }); } });
  assert.deepEqual([codex.data.ok, codex.data.claimed], [true, true], 'codex pushed first');
  assert.deepEqual([claude.data.ok, claude.data.refused, claude.exitCode], [false, true, 1], 'claude fetched an unclaimed phase and still lost');
  assert.deepEqual([claude.data.holder.provider, claude.data.holder.machine, claude.data.holder.at], ['codex', 'acme-desktop', codex.data.holder.at]);
  assert.match(claude.text, /^Phase 1 is claimed: codex on acme-desktop since /);
  assert.equal(remoteClaim(x.origin, 1), codex.data.sha);
  // The loser does not believe it holds anything: asking again is refused, not "held".
  assert.equal((await claim({ root: x.a, phase: '1', provider: 'claude' }, { env: x.env('acme-laptop') })).data.refused, true);

  // Live: both at once, each from its own clone, on another phase. Whichever the server takes, it takes one.
  const both = await Promise.all([
    claim({ root: x.a, phase: '2', provider: 'claude' }, { env: x.env('acme-laptop') }),
    claim({ root: x.b, phase: '2', provider: 'codex' }, { env: x.env('acme-desktop') }),
  ]);
  const winners = both.filter(r => r.data.ok), losers = both.filter(r => !r.data.ok);
  assert.equal(winners.length, 1, JSON.stringify(both.map(r => r.data)));
  assert.equal(losers.length, 1);
  assert.equal(losers[0].data.holder.provider, winners[0].data.holder.provider, 'the loser names the winner');
  assert.equal(remoteClaim(x.origin, 2), winners[0].data.sha);
});

test('two claims with the same git identity, provider, machine and a frozen clock still differ: exactly one succeeds', async t => {
  const x = await acme(t);
  const same = { env: x.env('acme-laptop'), now: NOW };
  let second;
  const first = await claim({ root: x.a, phase: '1', provider: 'claude' }, { ...same, beforePush: async () => { second = await claim({ root: x.b, phase: '1', provider: 'claude' }, same); } });
  assert.deepEqual([second.data.ok, first.data.ok, first.data.refused], [true, false, true], 'one identity, one second: still exactly one');
  assert.equal(first.data.holder.at, NOW);
  assert.equal(remoteClaim(x.origin, 1), second.data.sha);
  // Everything in the two commits is the same but the token.
  const message = git(x.origin, 'log', '-1', '--format=%an %ae %aI %cI%n%B', second.data.sha);
  assert.match(message, /^Acme Builder builder@acme\.test 2026-10-12T10:00:00Z 2026-10-12T10:00:00Z\n/);

  // Why the token is there: with one token the two claims are one commit, git calls the second push up to date, and both believe they hold the phase.
  const fixed = { ...same, token: 'a'.repeat(32) };
  let other;
  const one = await claim({ root: x.a, phase: '2', provider: 'claude' }, { ...fixed, beforePush: async () => { other = await claim({ root: x.b, phase: '2', provider: 'claude' }, fixed); } });
  assert.equal(one.data.sha, other.data.sha, 'the same commit');
  assert.deepEqual([one.data.ok, other.data.ok], [true, true], 'the failure the fresh token prevents');
  assert.equal(claimMessage({ phase: 2, provider: 'claude', machine: 'acme-laptop', at: NOW, token: 'a'.repeat(32) }), git(x.origin, 'log', '-1', '--format=%B', one.data.sha) + '\n');
});

test('an open PR whose branch names the phase is a claim; a merged or closed one is not; a claim ends when its phase is built on the default branch', async t => {
  const x = await acme(t);
  let r;
  const pr = (state, more = {}) => ({ number: 59, url: 'https://github.com/acme/app/pull/59', headRefName: 'claude/phase-1-anvil', author: { login: 'acme-builder' }, createdAt: '2026-10-10T08:00:00Z', state, ...more });
  // Open: phase 1 is claimed by the PR, and cannot be claimed over it. A PR on a branch that names no phase claims nothing.
  await x.prs([pr('OPEN'), pr('OPEN', { number: 60, headRefName: 'claude/tidy-readme' })]);
  let next = keel(['next', '--json'], x.b, x.env()).json();
  assert.deepEqual(next.claimed.map(c => [c.id, c.holder.by, c.holder.branch, c.holder.pr.number, c.holder.pr.author, c.holder.provider]), [[1, 'pr', 'claude/phase-1-anvil', 59, 'acme-builder', 'claude']]);
  assert.deepEqual(next.free.map(p => p.id), [2]);
  const over = keel(['phase', 'claim', '1', '--provider', 'codex'], x.b, x.env());
  assert.equal(over.code, 1);
  assert.match(over.out, /^Phase 1 is claimed: open PR #59 on claude\/phase-1-anvil \(acme-builder, since 2026-10-10T08:00:00Z\)\./);
  assert.equal(remoteClaim(x.origin, 1), null);
  // Merged or closed: not a claim, even when gh hands it back.
  for (const state of ['MERGED', 'CLOSED']) {
    await x.prs([pr(state)]);
    next = keel(['next', '--json'], x.b, x.env()).json();
    assert.deepEqual([next.free.map(p => p.id), next.claimed], [[1, 2], []], state);
  }

  // A claim ends when the phase is built on the default branch: b builds phase 1 and pushes main.
  await x.prs([]);
  assert.equal(keel(['phase', 'claim', '1', '--provider', 'claude', '--json'], x.a, x.env()).code, 0);
  assert.deepEqual(keel(['next', '--json'], x.b, x.env()).json().claimed.map(c => c.id), [1]);
  const file = join(x.b, 'docs/phases/01-anvil.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace('status: planned', 'status: built').replace('evidence: []', 'evidence: ["evidence/acme-0.md"]').replace('- [ ]', '- [x]'));
  git(x.b, 'commit', '-q', '-am', 'phase 1: built');
  git(x.b, 'push', '-q', 'origin', 'main');
  // In b, phase 1 is built. In a, which has not pulled, it is neither free nor claimed: it is built where it counts.
  r = keel(['next', '--json'], x.b, x.env());
  assert.equal(r.code, 0, r.out + r.err);
  next = r.json();
  assert.deepEqual([next.free.map(p => p.id), next.claimed, next.behind], [[2], [], []]);
  next = keel(['next', '--json'], x.a, x.env()).json();
  assert.deepEqual([next.free.map(p => p.id), next.claimed, next.behind], [[2], [], [1]]);
  assert.match(keel(['next'], x.a, x.env()).out, /Built on origin\/main, not in this checkout \(pull first\): phase 1/);
  // The branch is still on the origin, and still no claim: nobody can claim a built phase, and anyone may clear the leftover.
  assert.ok(remoteClaim(x.origin, 1));
  assert.match(keel(['phase', 'claim', '1', '--provider', 'codex'], x.a, x.env()).out, /Phase 1 is built on origin\/main: nothing in it is left to claim/);
  assert.equal(keel(['phase', 'claim', '1', '--release', '--json'], x.b, x.env()).code, 0);
  assert.equal(remoteClaim(x.origin, 1), null);
});

test('keel next lists every ready, unclaimed phase and shows a claimed one as claimed; a phase whose depends: are not built is in neither list', async t => {
  const x = await acme(t);
  // Nothing claimed: both ready phases are free, the first as before; phase 3 waits on 2.
  let r = keel(['next', '--json'], x.a, x.env());
  assert.equal(r.code, 0, r.out + r.err);
  let next = r.json();
  assert.deepEqual(next.next, (await collect(x.a)).phases.find(p => p.id === 1), 'the first is the phase object, as before');
  assert.deepEqual([next.free.map(p => p.id), next.claimed], [[1, 2], []]);
  assert.deepEqual(next.claims, { read: true, remote: 'origin', branch: 'main', prs: true });
  assert.match(keel(['next'], x.a, x.env()).out, /^1\. Build the anvil \[planned\] — docs\/phases\/01-anvil\.md\nDone when: The anvil lands\.\nNext action: Build the anvil\.\nClaim it before building: keel phase claim 1\n\nAlso free:\n {2}2\. Build the rocket \[planned\] — docs\/phases\/02-rocket\.md\n$/);

  // a claims phase 1. b, asking next, is handed phase 2, and sees 1 as claimed, by whom and on which branch.
  const won = keel(['phase', 'claim', '1', '--provider', 'claude', '--json'], x.a, x.env('acme-laptop')).json();
  next = keel(['next', '--json'], x.b, x.env('acme-desktop')).json();
  assert.equal(next.next.id, 2);
  assert.deepEqual(next.free.map(p => p.id), [2]);
  assert.deepEqual(next.claimed, [{ id: 1, title: 'Build the anvil', file: '01-anvil.md', status: 'planned',
    holder: { by: 'branch', branch: 'claims/phase-1', provider: 'claude', machine: 'acme-laptop', at: won.holder.at, mine: false, pr: null, work: [] } }]);
  for (const list of [next.free, next.claimed]) assert.ok(!list.some(p => p.id === 3), 'phase 3 depends on 2, which is not built: in neither list');
  const text = keel(['next'], x.b, x.env('acme-desktop')).out;
  assert.match(text, /^2\. Build the rocket \[planned\]/);
  assert.match(text, /\nClaimed:\n {2}1\. Build the anvil — claude on acme-laptop since \S+ \(claims\/phase-1\)\n$/);
  // The holder sees its own claim as its own.
  assert.equal(keel(['next', '--json'], x.a, x.env('acme-laptop')).json().claimed[0].holder.mine, true);

  // Work pushed on another provider's branch for a claimed phase is reported with the claim (the collision the claim cannot stop).
  git(x.b, 'push', '-q', 'origin', 'HEAD:refs/heads/codex/phase-1');
  assert.deepEqual(keel(['next', '--json'], x.a, x.env()).json().claimed[0].holder.work, ['codex/phase-1']);
  assert.match(keel(['next'], x.a, x.env()).out, /claims\/phase-1, this checkout\); work on codex\/phase-1\n/);

  // Both claimed: nothing is free, and next is null.
  assert.equal(keel(['phase', 'claim', '2', '--provider', 'codex', '--json'], x.b, x.env('acme-desktop')).code, 0);
  next = keel(['next', '--json'], x.a, x.env()).json();
  assert.deepEqual([next.next, next.free, next.claimed.map(c => c.id)], [null, [], [1, 2]]);
  assert.match(keel(['next'], x.a, x.env()).out, /^Nothing is free: every ready phase is claimed\.\n\nClaimed:\n/);
});

test('when the fetch fails, keel next says the claims could not be read (exit 2) and never lists a phase as free', async t => {
  const x = await acme(t);
  assert.equal(keel(['phase', 'claim', '1', '--provider', 'claude', '--json'], x.a, x.env()).code, 0);
  // Offline: the origin cannot be reached. The last fetch knew phase 2 was free; that is not said again.
  git(x.b, 'fetch', '-q', 'origin');
  git(x.b, 'remote', 'set-url', 'origin', join(x.dir, 'gone.git'));
  const r = keel(['next', '--json'], x.b, x.env());
  assert.equal(r.code, 2, r.out + r.err);
  const out = r.json();
  assert.deepEqual(Object.keys(out), ['error'], 'no next, no free list');
  assert.match(out.error, /^the claims could not be read: git fetch origin failed: .+\. No phase is listed as free\.$/);
  const said = keel(['next'], x.b, x.env());
  assert.equal(said.code, 2);
  assert.equal(said.out, '', 'nothing on stdout: no phase is offered');
  assert.match(said.err, /^keel: the claims could not be read: git fetch origin failed/);
  assert.doesNotMatch(said.err + said.out, /Build the rocket|Build the anvil/);
  // A claim cannot be made blind either.
  const blind = keel(['phase', 'claim', '2', '--provider', 'codex', '--json'], x.b, x.env());
  assert.equal(blind.code, 2);
  assert.match(blind.json().error, /the claims could not be read/);

  // The open PRs are claims too: when gh cannot list them, the claims were not read.
  await x.prs(null);
  const noGh = keel(['next', '--json'], x.a, x.env());
  assert.equal(noGh.code, 2);
  assert.match(noGh.json().error, /^the claims could not be read: gh pr list -R acme\/app failed: gh: offline\. No phase is listed as free\.$/);

  // No remote at all is not a failed fetch: there is nowhere to hold a claim, and next lists what is ready, saying so.
  await x.prs([]);
  git(x.a, 'remote', 'remove', 'origin');
  const alone = keel(['next', '--json'], x.a, x.env());
  assert.equal(alone.code, 0, alone.out + alone.err);
  assert.deepEqual([alone.json().free.map(p => p.id), alone.json().claims.read], [[1, 2], false]);
  assert.equal(keel(['phase', 'claim', '2', '--provider', 'claude', '--json'], x.a, x.env()).code, 2);
});

test('--release deletes a claim with no work branch or PR, and refuses one that has either; keel never releases another session\'s claim', async t => {
  const x = await acme(t);
  const claimIt = n => assert.equal(keel(['phase', 'claim', String(n), '--provider', 'claude', '--json'], x.a, x.env('acme-laptop')).code, 0);
  // Another session's claim: refused, and the branch stays.
  claimIt(1);
  const theirs = keel(['phase', 'claim', '1', '--release'], x.b, x.env('acme-desktop'));
  assert.equal(theirs.code, 1);
  assert.match(theirs.out, /^Phase 1 is claimed by claude on acme-laptop since \S+ \(claims\/phase-1\), not by this checkout: keel never releases another session's claim\. The owner can: git push origin --delete claims\/phase-1\n$/);
  assert.ok(remoteClaim(x.origin, 1));

  // A pushed work branch: refused.
  git(x.a, 'push', '-q', 'origin', 'HEAD:refs/heads/claude/phase-1');
  let r = keel(['phase', 'claim', '1', '--release', '--json'], x.a, x.env('acme-laptop'));
  assert.equal(r.code, 1);
  assert.deepEqual([r.json().refused, r.json().work], [true, ['claude/phase-1']]);
  assert.ok(remoteClaim(x.origin, 1));
  git(x.a, 'push', '-q', 'origin', '--delete', 'claude/phase-1');
  // A work branch that was never pushed: refused too.
  git(x.a, 'branch', 'claude/phase-1');
  r = keel(['phase', 'claim', '1', '--release'], x.a, x.env('acme-laptop'));
  assert.equal(r.code, 1);
  assert.match(r.out, /^Phase 1 has work on it: branch claude\/phase-1\. The claim stays/);
  git(x.a, 'branch', '-D', 'claude/phase-1');
  // An open PR for the phase: refused.
  await x.prs([{ number: 7, headRefName: 'claude/phase-1', author: { login: 'acme-builder' }, createdAt: '2026-10-11T08:00:00Z', state: 'OPEN' }]);
  r = keel(['phase', 'claim', '1', '--release'], x.a, x.env('acme-laptop'));
  assert.equal(r.code, 1);
  assert.match(r.out, /^Phase 1 has work on it: open PR #7\./);
  assert.ok(remoteClaim(x.origin, 1));

  // Neither: released. The branch is gone from the origin, and the phase is free for the other session.
  await x.prs([]);
  r = keel(['phase', 'claim', '1', '--release', '--json'], x.a, x.env('acme-laptop'));
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual([r.json().ok, r.json().released], [true, true]);
  assert.equal(remoteClaim(x.origin, 1), null);
  assert.deepEqual(keel(['next', '--json'], x.b, x.env()).json().free.map(p => p.id), [1, 2]);
  assert.equal(keel(['phase', 'claim', '1', '--provider', 'codex', '--json'], x.b, x.env('acme-desktop')).code, 0);
  // Nothing to release: said, exit 1.
  assert.equal(keel(['phase', 'claim', '2', '--release', '--json'], x.a, x.env()).code, 1);
});

test('who is claiming, and which branches name a phase', () => {
  assert.equal(providerOf({ CLAUDECODE: '1' }), 'claude');
  assert.equal(providerOf({ CODEX_HOME: '/acme' }), 'codex');
  assert.equal(providerOf({ CLAUDECODE: '1', KEEL_PROVIDER: 'codex' }), 'codex', 'KEEL_PROVIDER outranks the guess');
  assert.equal(providerOf({ CLAUDECODE: '1', KEEL_PROVIDER: 'codex' }, 'acme-bot'), 'acme-bot', '--provider outranks both');
  assert.equal(providerOf({}), null);
  assert.throws(() => providerOf({}, 'Not A Name'), /a provider is a short lowercase name/);
  assert.deepEqual(['claude/phase-54-robot', 'codex/phase-7', 'phase-0', 'claude/phase-054', 'claims/phase-54', 'claude/phases-54', 'main', 'claude/multiphase-5'].map(phaseOfBranch),
    [54, 7, 0, 54, null, null, null, null]);
});

test('readClaims and nextFree read in process what the CLI reads', async t => {
  const x = await acme(t);
  await claim({ root: x.a, phase: '2', provider: 'claude' }, { env: x.env('acme-laptop'), now: NOW });
  const config = JSON.parse(await readFile(join(x.b, '.keel/keel.json'), 'utf8'));
  const state = await readClaims({ root: x.b, config, env: x.env() });
  assert.deepEqual(state.claims.map(c => [c.phase, c.branch, c.provider, c.machine, c.at, c.mine]), [[2, 'claims/phase-2', 'claude', 'acme-laptop', NOW, false]]);
  assert.deepEqual([state.remote, state.branch, state.prs], ['origin', 'main', []]);
  const free = await nextFree({ root: x.b, data: await collect(x.b) }, { env: x.env() });
  assert.deepEqual([free.data.next.id, free.data.claimed.map(c => c.id)], [1, [2]]);
});

// Review of #117: the connection drops after git accepted the claim. The claim is on the remote; the checkout must still know it is its own.
test('a push that lands and a read-back that fails keeps the token: the error says the claim may have been made, and asking again finds it held', async t => {
  const x = await acme(t);
  const env = x.env('acme-laptop');
  await assert.rejects(claim({ root: x.a, phase: '1', provider: 'claude' }, { env, afterPush: async () => { git(x.a, 'remote', 'set-url', 'origin', join(x.dir, 'gone.git')); } }), e => {
    assert.equal(e.exitCode, 2);
    assert.match(e.message, /^phase 1 may or may not be claimed: the push was accepted, and origin could not be read afterwards \(.+\)\. Nothing is assumed\. Check: git ls-remote origin refs\/heads\/claims\/phase-1, or run keel phase claim 1 again/);
    return true;
  });
  // The claim was made.
  const sha = remoteClaim(x.origin, 1);
  assert.ok(sha, 'the push landed');
  // Back online: the claim on the remote is this checkout's own, not "another session's".
  git(x.a, 'remote', 'set-url', 'origin', x.origin);
  const again = await claim({ root: x.a, phase: '1', provider: 'claude' }, { env });
  assert.deepEqual([again.data.ok, again.data.held, again.data.claimed, again.data.holder.mine], [true, true, false, true]);
  assert.equal(remoteClaim(x.origin, 1), sha);
  // And it can release it.
  assert.equal((await claim({ root: x.a, phase: '1', release: true }, { env })).data.released, true);
  // A read-back that shows another winner still removes the loser's token: the loser is refused, not "held".
  let other;
  const lost = await claim({ root: x.a, phase: '2', provider: 'claude' }, { env, beforePush: async () => { other = await claim({ root: x.b, phase: '2', provider: 'codex' }, { env: x.env('acme-desktop') }); } });
  assert.deepEqual([other.data.ok, lost.data.refused], [true, true]);
  assert.equal((await claim({ root: x.a, phase: '2', provider: 'claude' }, { env })).data.refused, true);
});

// Review of #117: a checkout's own tree saying "built" is not the default branch saying it.
test('a phase marked built only in one checkout does not let it release another session\'s claim, or skip the work checks', async t => {
  const x = await acme(t);
  assert.equal(keel(['phase', 'claim', '1', '--provider', 'claude', '--json'], x.a, x.env('acme-laptop')).code, 0);
  await x.prs([{ number: 7, headRefName: 'claude/phase-1', author: { login: 'acme-builder' }, createdAt: '2026-10-11T08:00:00Z', state: 'OPEN' }]);
  const sha = remoteClaim(x.origin, 1);
  const markBuilt = async clone => {
    const file = join(clone, 'docs/phases/01-anvil.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('status: planned', 'status: built').replace('evidence: []', 'evidence: ["evidence/acme-0.md"]').replace('- [ ]', '- [x]'));
    git(clone, 'commit', '-q', '-am', 'phase 1: built, not merged');
  };
  // b marks phase 1 built locally and does not push. The claim is live, with an open PR, and is not b's.
  await markBuilt(x.b);
  const foreign = keel(['phase', 'claim', '1', '--release'], x.b, x.env('acme-desktop'));
  assert.equal(foreign.code, 1, foreign.out + foreign.err);
  assert.match(foreign.out, /^Phase 1 is claimed by claude on acme-laptop since \S+ \(claims\/phase-1\), PR #7, not by this checkout: keel never releases another session's claim\./);
  assert.equal(remoteClaim(x.origin, 1), sha, 'the claim is still there');
  // The holder marking it built locally does not skip the work checks either: the open PR still holds the claim. The refusal names the owner's way out.
  await markBuilt(x.a);
  const own = keel(['phase', 'claim', '1', '--release'], x.a, x.env('acme-laptop'));
  assert.equal(own.code, 1, own.out + own.err);
  assert.equal(own.out, 'Phase 1 has work on it: open PR #7. The claim stays until the phase is built on origin/main or the work is gone. The owner can: git push origin --delete claims/phase-1\n');
  assert.equal(remoteClaim(x.origin, 1), sha);
  // Local completion is still a reason not to make a new claim.
  assert.match(keel(['phase', 'claim', '1', '--provider', 'codex'], x.b, x.env('acme-desktop')).out, /^Phase 1 is built: nothing in it is left to claim\.\n$/);
  // Once it is built on the default branch, the claim has ended and anyone may clear the leftover.
  git(x.a, 'push', '-q', 'origin', 'main');
  assert.equal(keel(['phase', 'claim', '1', '--release', '--json'], x.b, x.env('acme-desktop')).code, 0);
  assert.equal(remoteClaim(x.origin, 1), null);
});

// Review of #117: the roadmap parser accepts JSON-quoted front matter, so the default branch may say status: "built".
test('a phase the default branch calls "built", or "partial" owing a "walk", in quotes has ended: it is never listed as free', async t => {
  const x = await acme(t);
  for (const [n, name] of [[1, '01-anvil.md'], [2, '02-rocket.md']]) assert.equal(keel(['phase', 'claim', String(n), '--provider', 'claude', '--json'], x.a, x.env()).code, 0, name);
  const rewrite = async (name, from, to) => { const file = join(x.b, 'docs/phases', name); await writeFile(file, (await readFile(file, 'utf8')).replace(from, to)); };
  await rewrite('01-anvil.md', 'status: planned', 'status: "built"');
  await rewrite('01-anvil.md', 'evidence: []', 'evidence: ["evidence/acme-0.md"]');
  await rewrite('01-anvil.md', '- [ ]', '- [x]');
  await rewrite('02-rocket.md', 'status: planned', 'status: "partial"\nowes: "walk"');
  await rewrite('02-rocket.md', '- [ ] Lands. `tests/anvil.test.mjs`', '- [x] Lands. `tests/anvil.test.mjs`\n- [ ] ⚑ by hand: the owner rides it.');
  // Phase 3 is quoted too, in a file the roadmap would reject (built, its box unchecked): its status is still read.
  await rewrite('03-sled.md', 'status: planned', 'status: "built"');
  git(x.b, 'commit', '-q', '-am', 'phases 1 and 2: quoted');
  git(x.b, 'push', '-q', 'origin', 'main');
  // a has not pulled: both are ready in its tree, and both have ended on the default branch. Neither free nor claimed.
  const r = keel(['next', '--json'], x.a, x.env());
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual([r.json().free.map(p => p.id), r.json().claimed.map(c => c.id), r.json().behind], [[], [], [1, 2]]);
  assert.match(keel(['phase', 'claim', '1', '--provider', 'codex'], x.a, x.env()).out, /^Phase 1 is built on origin\/main: nothing in it is left to claim\.\n$/);
  const state = await readClaims({ root: x.a, config: JSON.parse(await readFile(join(x.a, '.keel/keel.json'), 'utf8')), env: x.env() });
  assert.deepEqual([await state.ended(1), await state.ended(2), await state.ended(3), await state.ended(0)], [true, true, true, true]);
});

// Review of #117: two claim commands in ONE checkout. Each keeps its own token; the loser must not take the winner's with it.
test('two claims racing in the same checkout: the loser never removes or overwrites the winner\'s token, so the winner still holds and can release', async t => {
  const x = await acme(t);
  const env = x.env('acme-laptop');
  const again = async n => (await claim({ root: x.a, phase: String(n), provider: 'claude' }, { env })).data;
  // The first has written its token and pauses before its push; the second, in the same checkout, claims and wins; the first then loses.
  let second;
  const first = await claim({ root: x.a, phase: '1', provider: 'claude' }, { env, beforePush: async () => { second = await claim({ root: x.a, phase: '1', provider: 'claude' }, { env }); } });
  assert.deepEqual([second.data.ok, second.data.claimed, first.data.refused], [true, true, true]);
  assert.equal(remoteClaim(x.origin, 1), second.data.sha);
  // The claim on the remote is this checkout's: held, not "another session's".
  let now = await again(1);
  assert.deepEqual([now.ok, now.held, now.holder?.mine], [true, true, true], JSON.stringify(now));
  assert.equal(keel(['next', '--json'], x.a, x.env('acme-laptop')).json().claimed[0].holder.mine, true);
  // Only the claim's own token is kept: the first attempt's losing one is gone, the winner's is the one file left.
  const dir = `${resolve(x.a, git(x.a, 'rev-parse', '--git-path', 'keel-claims/phase-1'))}.d`;
  const { readdir, rename } = await import('node:fs/promises');
  const kept = await readdir(dir);
  assert.equal(kept.length, 1);
  assert.match(git(x.origin, 'log', '-1', '--format=%B', second.data.sha), new RegExp(`^Token: ${kept[0]}$`, 'm'));
  // A token in the first build's one shared file is still this checkout's.
  await rename(join(dir, kept[0]), join(dir, 'aside'));
  assert.equal((await again(1)).refused, true, 'no token: not ours');
  await writeFile(resolve(x.a, git(x.a, 'rev-parse', '--git-path', 'keel-claims/phase-1')), `${kept[0]}\n`);
  assert.equal((await again(1)).held, true);
  // Release removes the claim and its token, and nothing else.
  assert.equal((await claim({ root: x.a, phase: '1', release: true }, { env })).data.released, true);
  assert.deepEqual(await readdir(dir), ['aside']);
});

// Review of #117: the default branch is what the remote advertises, never a cached HEAD or a branch that happens to be called main.
test('the remote\'s default is develop and an old main calls the phase built: phases and claims are read from develop, whatever this checkout\'s cached HEAD says, and another checkout\'s claim is not released', async t => {
  const x = await acme(t);
  // The origin moves its default to develop. Both clones still have origin/HEAD -> origin/main cached from the clone.
  git(x.b, 'push', '-q', 'origin', 'main:refs/heads/develop');
  git(x.origin, 'symbolic-ref', 'HEAD', 'refs/heads/develop');
  assert.equal(git(x.a, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'), 'origin/main', 'the cache is stale');
  // a claims phase 1: the claim commit sits on develop's head, not main's.
  const won = keel(['phase', 'claim', '1', '--provider', 'claude', '--json'], x.a, x.env('acme-laptop'));
  assert.equal(won.code, 0, won.out + won.err);
  const sha = remoteClaim(x.origin, 1);
  // The old main goes on to call phase 1 built; develop, the default, does not.
  const file = join(x.b, 'docs/phases/01-anvil.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace('status: planned', 'status: built').replace('evidence: []', 'evidence: ["evidence/acme-0.md"]').replace('- [ ]', '- [x]'));
  git(x.b, 'commit', '-q', '-am', 'phase 1: built on the old main');
  git(x.b, 'push', '-q', 'origin', 'main');
  assert.equal(git(x.origin, 'rev-parse', `${sha}^`), git(x.origin, 'rev-parse', 'refs/heads/develop'));
  assert.notEqual(git(x.origin, 'rev-parse', 'refs/heads/develop'), git(x.origin, 'rev-parse', 'refs/heads/main'));

  // keel next, with the stale cached HEAD and then with none: phase 1 is still claimed, not "built", and nothing is read from main.
  for (const cached of ['stale', 'absent']) {
    if (cached === 'absent') git(x.a, 'remote', 'set-head', 'origin', '-d');
    const r = keel(['next', '--json'], x.a, x.env('acme-laptop'));
    assert.equal(r.code, 0, cached + r.out + r.err);
    const next = r.json();
    assert.deepEqual([next.claims.branch, next.free.map(p => p.id), next.claimed.map(c => c.id), next.behind], ['develop', [2], [1], []], cached);
  }
  // b's tree calls phase 1 built, and so does main. Neither is the default branch: b may not release a's live claim.
  for (const cached of ['stale', 'absent']) {
    if (cached === 'absent') git(x.b, 'remote', 'set-head', 'origin', '-d');
    const r = keel(['phase', 'claim', '1', '--release'], x.b, x.env('acme-desktop'));
    assert.equal(r.code, 1, cached + r.out + r.err);
    assert.match(r.out, /not by this checkout: keel never releases another session's claim/, cached);
    assert.equal(remoteClaim(x.origin, 1), sha, `${cached}: the claim is still there`);
  }
  // The board's read of what was last fetched has no cached HEAD to go by now: the gap is said, not guessed from a branch called main.
  const cachedRead = await claimItems(x.a, { env: x.env() });
  assert.match(cachedRead.na ?? '', /^the claims could not be read: this checkout does not know origin's default branch \(git remote set-head origin -a\)/);
  // A fresh read asks the remote.
  assert.deepEqual((await claimItems(x.a, { env: x.env(), fresh: true })).items, []);
  // Once develop says built, the claim has ended.
  git(x.b, 'push', '-q', 'origin', 'main:refs/heads/develop');
  assert.deepEqual(keel(['next', '--json'], x.a, x.env('acme-laptop')).json().behind, [1]);
});

test('when the remote\'s advertised default branch cannot be resolved, the claims could not be read (exit 2): nothing is free, claimed or released', async t => {
  const x = await acme(t);
  assert.equal(keel(['phase', 'claim', '1', '--provider', 'claude', '--json'], x.a, x.env('acme-laptop')).code, 0);
  const sha = remoteClaim(x.origin, 1);
  // The origin's HEAD names a branch that is not there. Its branches still fetch, and main and the cached origin/HEAD are still here to guess from.
  git(x.origin, 'symbolic-ref', 'HEAD', 'refs/heads/gone');
  const r = keel(['next', '--json'], x.b, x.env('acme-desktop'));
  assert.equal(r.code, 2, r.out + r.err);
  assert.deepEqual(Object.keys(r.json()), ['error']);
  assert.match(r.json().error, /^the claims could not be read: origin advertises no default branch \(its HEAD names no branch that exists\)\. No phase is listed as free\.$/);
  assert.equal(keel(['next'], x.b, x.env('acme-desktop')).out, '');
  assert.equal(keel(['phase', 'claim', '2', '--provider', 'codex', '--json'], x.b, x.env('acme-desktop')).code, 2);
  assert.equal(remoteClaim(x.origin, 2), null);
  for (const clone of [x.a, x.b]) assert.equal(keel(['phase', 'claim', '1', '--release', '--json'], clone, x.env('acme-laptop')).code, 2);
  assert.equal(remoteClaim(x.origin, 1), sha);
});

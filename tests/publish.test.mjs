// The publisher (phase 80): scripts/keel/publish.mjs, the delivery practice's.
// A bare Acme origin and a clone of it, and a gh stub that answers the
// Actions API from fixtures; no network, nobody's git settings. The publisher
// runs from a scratch scripts/keel/ holding the night's scripts beside it, as
// a project has them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, cp, chmod, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { run as spawnNode } from './helpers/run.mjs';
import { pathToFileURL } from 'node:url';
import { scratch, ENV } from './helpers/improve.mjs';
import { deliveryOf, deliveryProblems } from '../practices/delivery/files/scripts/keel/delivery.mjs';

const repo = 'acme/anvils';
const CONFIG = { name: 'Acme', repo, practices: ['night', 'delivery'], ci: { gateWorkflow: 'check.yml' } };
const NIGHT = resolve('practices/night/files/scripts/keel');
const DELIVERY = resolve('practices/delivery/files/scripts/keel');
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();

/** scripts/keel/ as a project has it: the night's scripts and the delivery practice's, side by side. */
async function scripts(t) {
  const dir = join(await scratch(t, 'keel-publish-scripts-'), 'scripts', 'keel');
  await cp(NIGHT, dir, { recursive: true });
  await cp(DELIVERY, dir, { recursive: true });
  return { dir, module: await import(pathToFileURL(join(dir, 'publish.mjs')).href) };
}

/**
 * The Actions API for `runs` ({ sha, conclusion?, status?, event? }): each a
 * push run of check.yml on main with one job. A sha with no entry has no run.
 */
function actions(runs) {
  const routes = { [`repos/${repo}`]: { private: false, default_branch: 'main' }, [`repos/${repo}/actions/workflows`]: { workflows: [{ id: 7, name: 'check', path: '.github/workflows/check.yml' }], total_count: 1 } };
  runs.forEach((c, i) => {
    const id = 100 + i, status = c.status ?? 'completed', conclusion = status === 'completed' ? c.conclusion ?? 'success' : null;
    routes[`repos/${repo}/actions/workflows/7/runs?head_sha=${c.sha}`] = { workflow_runs: [{ id, workflow_id: 7, run_attempt: 1, head_sha: c.sha, head_branch: 'main', event: c.event ?? 'push', head_repository: { full_name: repo }, status, conclusion, created_at: ago(20), updated_at: ago(5) }], total_count: 1 };
    routes[`repos/${repo}/actions/runs/${id}/attempts/1/jobs`] = { jobs: [{ id: id * 10, run_id: id, run_attempt: 1, name: 'check', head_sha: c.sha, status: status === 'completed' ? 'completed' : 'in_progress', conclusion, started_at: ago(15), completed_at: status === 'completed' ? ago(5) : null }], total_count: 1 };
  });
  return { routes };
}

/** A gh stub answering `gh api <path>` from a fixture file, which a test may rewrite; `down` makes every call fail. */
async function ghStub(t, fixture) {
  const dir = await scratch(t, 'keel-publish-gh-');
  const gh = join(dir, 'gh'), data = join(dir, 'fixture.json'), log = join(dir, 'log');
  await writeFile(data, JSON.stringify(fixture));
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs'), a = process.argv.slice(2);
if (a[0] !== 'api' || a.length !== 2) process.exit(1);
fs.appendFileSync(${JSON.stringify(log)}, a[1] + '\\n');
const { routes, down } = JSON.parse(fs.readFileSync(${JSON.stringify(data)}, 'utf8'));
if (down) { console.error('gh: HTTP 502'); process.exit(1); }
const p = a[1].replace(/[?&]per_page=\\d+&page=1$/, '');
if (!Object.hasOwn(routes, p)) { if (/\\/runs\\?head_sha=/.test(p)) { console.log(JSON.stringify({ workflow_runs: [], total_count: 0 })); process.exit(0); } console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
console.log(JSON.stringify(routes[p]));
`);
  await chmod(gh, 0o755);
  return {
    env: { ...ENV, KEEL_GH: gh },
    set: async next => writeFile(data, JSON.stringify(next)),
    asked: async () => (existsSync(log) ? await readFile(log, 'utf8') : '').split('\n').filter(Boolean),
  };
}

/** A bare origin (default branch main) and a clone with .keel/keel.json; `commit` adds one commit to main and pushes it. */
async function acme(t, { config = CONFIG, branch = 'main' } = {}) {
  const dir = await scratch(t, 'keel-publish-');
  const origin = join(dir, 'origin.git'), root = join(dir, 'acme');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();
  git(dir, 'init', '-q', '--bare', '-b', branch, origin);
  git(dir, 'init', '-q', '-b', branch, root);
  git(root, 'remote', 'add', 'origin', origin);
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify(config));
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'Acme');
  git(root, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  let n = 0;
  const commit = async () => {
    await writeFile(join(root, `anvil-${++n}.mjs`), `export const anvil = ${n};\n`);
    git(root, 'add', '-A'); git(root, 'commit', '-qm', `Acme anvil ${n}`);
    git(root, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    return git(root, 'rev-parse', 'HEAD');
  };
  const remote = ref => { try { return git(root, 'ls-remote', '--exit-code', 'origin', `refs/heads/${ref}`).split('\t')[0]; } catch { return null; } };
  const setTested = (sha, ref = 'green') => git(root, 'push', '-q', '--force', 'origin', `${sha}:refs/heads/${ref}`);
  return { root, origin, git: (...a) => git(root, ...a), commit, remote, setTested, head: () => git(root, 'rev-parse', 'HEAD') };
}

// ---- the publisher: move, skip, refuse --------------------------------------------------

test('the publisher moves the tested ref to the newest passing descendant, skips a superseded commit, refuses a diverged ref, and never writes main', async t => {
  const { module: p } = await scripts(t);
  const a = await acme(t);
  const A = await a.commit(), B = await a.commit(), C = await a.commit();
  a.setTested(A);
  // Move: green at A; B passed, C still running: the newest passing descendant is B.
  const stub = await ghStub(t, actions([{ sha: A }, { sha: B }, { sha: C, status: 'in_progress' }]));
  const main0 = a.remote('main');
  const moved = await p.publish({ root: a.root, config: CONFIG, env: stub.env });
  assert.equal(moved.action, 'advanced');
  assert.equal(moved.to, B);
  assert.equal(a.remote('green'), B, 'green moved to B');
  assert.deepEqual(moved.skipped.map(s => s.sha), [C], 'C, newer but not passed, was skipped');
  assert.match(p.publishLine(moved), /^keel publish: green moved [0-9a-f]{7} → [0-9a-f]{7}, [0-9a-f]{7} is the newest commit on main whose gate passed; skipped 1 newer/);
  // Skip: C passes; then a late run (B's) finds green already past B: C is published, B never again.
  await stub.set(actions([{ sha: A }, { sha: B }, { sha: C }]));
  assert.equal((await p.publish({ root: a.root, config: CONFIG, env: stub.env, trigger: C })).to, C);
  const late = await p.publish({ root: a.root, config: CONFIG, env: stub.env, trigger: B });
  assert.equal(late.action, 'none', 'B is superseded: green is past it');
  assert.equal(a.remote('green'), C);
  assert.match(p.publishLine(late), /green stays at [0-9a-f]{7}: green is already main's tip/);
  // Refuse: green pushed to a commit not on main (a side branch): red, and nothing moves.
  a.git('checkout', '-q', '-b', 'side', A);
  await writeFile(join(a.root, 'side.mjs'), 'export const side = 1;\n');
  a.git('add', '-A'); a.git('commit', '-qm', 'Acme side');
  const side = a.head();
  a.setTested(side);
  a.git('checkout', '-q', 'main');
  await assert.rejects(p.publish({ root: a.root, config: CONFIG, env: stub.env }), e => e.exitCode === 1 && /has diverged from main/.test(e.message));
  assert.equal(a.remote('green'), side, 'a diverged ref is left as it is');
  assert.equal(main0, C);
  assert.equal(a.remote('main'), main0, 'main is never written');
});

test('two passing commits arriving out of order leave the tested ref at the newer one', async t => {
  const { module: p } = await scripts(t);
  const a = await acme(t);
  const A = await a.commit(), B = await a.commit(), C = await a.commit();
  a.setTested(A);
  // C's gate finishes first (B still running): C's publisher moves green to C.
  const stub = await ghStub(t, actions([{ sha: A }, { sha: B, status: 'in_progress' }, { sha: C }]));
  const first = await p.publish({ root: a.root, config: CONFIG, env: stub.env, trigger: C });
  assert.equal(first.to, C);
  // Then B passes, and its publisher runs: green stays at C, the newer.
  await stub.set(actions([{ sha: A }, { sha: B }, { sha: C }]));
  const second = await p.publish({ root: a.root, config: CONFIG, env: stub.env, trigger: B });
  assert.equal(second.action, 'none');
  assert.equal(a.remote('green'), C, 'never back to B');
  // And the reverse order: B first, then C, ends at C as well.
  const b = await acme(t);
  const A2 = await b.commit(), B2 = await b.commit(), C2 = await b.commit();
  b.setTested(A2);
  const stub2 = await ghStub(t, actions([{ sha: A2 }, { sha: B2 }, { sha: C2, status: 'queued' }]));
  assert.equal((await p.publish({ root: b.root, config: CONFIG, env: stub2.env, trigger: B2 })).to, B2);
  await stub2.set(actions([{ sha: A2 }, { sha: B2 }, { sha: C2 }]));
  assert.equal((await p.publish({ root: b.root, config: CONFIG, env: stub2.env, trigger: C2 })).to, C2);
  assert.equal(b.remote('green'), C2);
});

test('A, B, C: while A\'s publisher runs, C\'s run queues and B\'s late run replaces it; the surviving run still publishes C', async t => {
  const { module: p } = await scripts(t);
  const a = await acme(t);
  const A = await a.commit(), B = await a.commit(), C = await a.commit();
  // A's publisher ran: green at A. C's gate finished, then B's (late): GitHub kept one pending
  // run, B's, and dropped C's. The run that survives was started by B.
  a.setTested(A);
  const stub = await ghStub(t, actions([{ sha: A }, { sha: B }, { sha: C }]));
  const r = await p.publish({ root: a.root, config: CONFIG, env: stub.env, trigger: B });
  assert.equal(r.trigger, B, 'started by B');
  assert.equal(r.to, C, 'it chose the newest passing commit itself, not the one that started it');
  assert.equal(a.remote('green'), C);
  assert.match(p.publishLine(r), /started by [0-9a-f]{7}, which it did not trust$/);
  // Mutation of the rule: a publisher that trusted its trigger would have published B.
  assert.notEqual(r.to, r.trigger);
});

test('first use creates the tested ref at the newest passing commit; a failed tip is skipped; nothing passed creates nothing', async t => {
  const { module: p } = await scripts(t);
  const a = await acme(t);
  const A = await a.commit(), B = await a.commit();
  const stub = await ghStub(t, actions([{ sha: A }, { sha: B, conclusion: 'failure' }]));
  assert.equal(a.remote('green'), null);
  const r = await p.publish({ root: a.root, config: CONFIG, env: stub.env });
  assert.equal(r.action, 'created');
  assert.equal(r.to, A, 'B failed: the newest passing is A');
  assert.equal(r.from, null);
  assert.equal(a.remote('green'), A);
  assert.match(r.skipped[0].reason, /its gate did not pass \(failure\)/);
  // A fresh project where nothing has passed: no ref is made.
  const b = await acme(t);
  const X = await b.commit();
  const none = await ghStub(t, actions([{ sha: X, conclusion: 'cancelled' }]));
  const n = await p.publish({ root: b.root, config: CONFIG, env: none.env });
  assert.equal(n.action, 'none');
  assert.equal(b.remote('green'), null);
});

test('a gate result that cannot be read is red, and moves nothing', async t => {
  const { module: p } = await scripts(t);
  const a = await acme(t);
  const A = await a.commit(); await a.commit();
  a.setTested(A);
  const stub = await ghStub(t, { routes: {}, down: true });
  await assert.rejects(p.publish({ root: a.root, config: CONFIG, env: stub.env }), e => e.exitCode === 1 && /cannot tell whether [0-9a-f]{7} passed its gate/.test(e.message));
  assert.equal(a.remote('green'), A);
});

test('a pull request\'s run, or another workflow\'s, never counts as the gate passing on main', async t => {
  const { module: p } = await scripts(t);
  const a = await acme(t);
  const A = await a.commit(), B = await a.commit();
  a.setTested(A);
  const stub = await ghStub(t, actions([{ sha: A }, { sha: B, event: 'pull_request' }]));
  const r = await p.publish({ root: a.root, config: CONFIG, env: stub.env });
  assert.equal(r.action, 'none');
  assert.equal(a.remote('green'), A);
});

test('the lease: a tested ref moved between choosing and advancing is refused, and left where it is', async t => {
  const { module: p } = await scripts(t);
  const a = await acme(t);
  const A = await a.commit(), B = await a.commit(), C = await a.commit();
  a.setTested(A);
  const stub = await ghStub(t, actions([{ sha: A }, { sha: B }, { sha: C, status: 'queued' }]));
  const plan = await p.choose({ root: a.root, config: CONFIG, env: stub.env });
  assert.deepEqual([plan.action, plan.from, plan.to], ['advance', A, B]);
  a.setTested(C); // someone else moved it meanwhile
  assert.throws(() => p.advance({ root: a.root, config: CONFIG, env: stub.env, from: plan.from, to: plan.to }), e => e.exitCode === 1 && /moved since it was read/.test(e.message));
  assert.equal(a.remote('green'), C);
  // The race the pre-check cannot see: green moves after it is read and before the push. The push's own
  // lease refuses it (a git that moves green to C once, just before running `git push`).
  a.setTested(A);
  const wrap = join(a.root, '..', 'git-race');
  await writeFile(wrap, `#!/bin/sh
if [ "$1" = push ] && [ ! -f "${wrap}.done" ]; then touch "${wrap}.done"; git push -q --force origin ${C}:refs/heads/green; fi
exec git "$@"
`);
  await chmod(wrap, 0o755);
  assert.throws(() => p.advance({ root: a.root, config: CONFIG, env: { ...stub.env, KEEL_GIT: wrap }, from: A, to: B }), e => e.exitCode === 1 && /refused moving green/.test(e.message));
  assert.equal(a.remote('green'), C, 'the lease held: what moved it first stands');
  // Advancing to a commit not on main, or sideways, is refused too.
  a.setTested(A);
  a.git('checkout', '-q', '-b', 'side', A);
  await writeFile(join(a.root, 'side.mjs'), 'x\n'); a.git('add', '-A'); a.git('commit', '-qm', 'side');
  const side = a.head(); a.git('push', '-q', 'origin', 'side');
  assert.throws(() => p.advance({ root: a.root, config: CONFIG, env: stub.env, from: A, to: side }), /is not on main/);
  assert.equal(a.remote('green'), A);
  assert.equal(a.remote('main'), C, 'main is never written');
});

// ---- configuration --------------------------------------------------------------------------

test('"delivery" is validated, each error naming its key; a tested ref named for the default branch is refused', async t => {
  assert.deepEqual(deliveryOf({}), { tested: 'green', gateWorkflow: null });
  assert.deepEqual(deliveryOf({ delivery: { tested: 'tested/dev', gateWorkflow: 'test.yml', docsOnly: ['docs/'] } }), { tested: 'tested/dev', gateWorkflow: 'test.yml' });
  for (const [delivery, key] of [
    [{ tested: 'main' }, /"delivery".tested cannot be main/],
    [{ tested: 'master' }, /"delivery".tested cannot be master/],
    [{ tested: 'refs/heads/green' }, /"delivery".tested is a branch's short name/],
    [{ tested: 'gr een' }, /"delivery".tested must be a branch name/],
    [{ tested: 'a..b' }, /"delivery".tested must be a branch name/],
    [{ tested: '' }, /"delivery".tested must be a branch name/],
    [{ tested: 7 }, /"delivery".tested must be a branch name/],
    [{ gateWorkflow: '' }, /"delivery".gateWorkflow must be/],
    [{ gateWorkflow: 'a\nb' }, /"delivery".gateWorkflow must be/],
  ]) {
    assert.throws(() => deliveryOf({ delivery }), e => e.exitCode === 2 && key.test(e.message), JSON.stringify(delivery));
    assert.match(deliveryProblems({ delivery })[0], key);
  }
  assert.match(deliveryProblems({ delivery: [] })[0], /"delivery" must be an object/);
  // At run time, against the remote's own default branch.
  const { module: p } = await scripts(t);
  const config = { ...CONFIG, delivery: { tested: 'trunk' } };
  const a = await acme(t, { config, branch: 'trunk' });
  await a.commit();
  const stub = await ghStub(t, actions([]));
  await assert.rejects(p.publish({ root: a.root, config, env: stub.env }), e => e.exitCode === 2 && /"delivery".tested is trunk, origin's default branch/.test(e.message));
  await assert.rejects(p.publish({ root: a.root, config: { ...CONFIG, repo: undefined }, env: { ...stub.env, GITHUB_REPOSITORY: '' } }), /has no "repo"/);
});

test('"delivery".gateWorkflow names the workflow whose results count; another workflow\'s pass is not the gate\'s', async t => {
  const { module: p } = await scripts(t);
  const config = { ...CONFIG, delivery: { gateWorkflow: 'release.yml' } };
  const a = await acme(t, { config });
  const A = await a.commit();
  const fixture = actions([{ sha: A }]); // check.yml passed A; release.yml has no run
  fixture.routes[`repos/${repo}/actions/workflows`] = { workflows: [{ id: 7, name: 'check', path: '.github/workflows/check.yml' }, { id: 8, name: 'release', path: '.github/workflows/release.yml' }], total_count: 2 };
  const stub = await ghStub(t, fixture);
  const r = await p.publish({ root: a.root, config, env: stub.env });
  assert.equal(r.action, 'none');
  assert.equal(r.workflow, 'release.yml');
  assert.ok((await stub.asked()).some(q => q.startsWith(`repos/${repo}/actions/workflows/8/runs?head_sha=${A}`)), 'it asked release.yml');
});

// ---- the script, as the workflow runs it -----------------------------------------------------

test('the script: --plan writes action, from and to to $GITHUB_OUTPUT and moves nothing; --advance moves; bad usage is exit 2', async t => {
  const { dir } = await scripts(t);
  const a = await acme(t);
  const A = await a.commit(), B = await a.commit();
  a.setTested(A);
  const stub = await ghStub(t, actions([{ sha: A }, { sha: B }]));
  const out = join(a.root, '..', 'github-output');
  const run = (args, env = {}) => spawnNode(process.execPath, [join(dir, 'publish.mjs'), ...args], { cwd: a.root, env: { ...stub.env, ...env } });
  const plan = run(['--plan', '--trigger', A, '--json'], { GITHUB_OUTPUT: out });
  assert.equal(plan.status, 0, plan.stderr + plan.stdout);
  assert.equal(JSON.parse(plan.stdout).to, B);
  assert.equal(await readFile(out, 'utf8'), `action=advance\nfrom=${A}\nto=${B}\n`);
  assert.equal(a.remote('green'), A, '--plan moves nothing');
  const adv = run(['--advance', '--from', A, '--to', B]);
  assert.equal(adv.status, 0, adv.stderr);
  assert.match(adv.stdout, /^keel publish: green moved [0-9a-f]{7} → [0-9a-f]{7}/);
  assert.equal(a.remote('green'), B);
  // A dispatch has no trigger: an empty --trigger is none. Nothing newer: exit 0.
  const again = run(['--trigger', '', '--json']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).action, 'none');
  // Creating: --from none.
  const b = await acme(t);
  const X = await b.commit();
  const c = spawnNode(process.execPath, [join(dir, 'publish.mjs'), '--advance', '--from', 'none', '--to', X], { cwd: b.root, env: stub.env });
  assert.equal(c.status, 0, c.stderr);
  assert.equal(b.remote('green'), X);
  for (const args of [['--bogus'], ['--advance', '--to', X], ['--plan', '--advance', '--from', 'none', '--to', X], ['--advance', '--from', 'none', '--to', 'abc']]) {
    const r = run([...args, '--json']);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}`);
    assert.ok(JSON.parse(r.stdout).error);
  }
  // A diverged ref is exit 1 from the script, as the choose job sees it.
  a.git('checkout', '-q', '--orphan', 'other');
  a.git('commit', '-qm', 'other', '--allow-empty');
  a.setTested(a.head());
  a.git('checkout', '-q', 'main');
  const red = run(['--plan', '--json']);
  assert.equal(red.status, 1);
  assert.match(JSON.parse(red.stdout).error, /has diverged/);
});

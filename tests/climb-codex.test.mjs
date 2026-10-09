// climb.mjs's tests, split from climb.test.mjs (2026-10-09) so they run in parallel.
// The synthetic Acme repo and the stubs are in tests/helpers/climb.mjs; nothing here reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp, realpath, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { WORKFLOW, git, write, commit, acme, climb, json, TIMED, tendAcme, TEND_WORKFLOW, runStep, agentGit, sandboxGit, plantHostile } from './helpers/climb.mjs';

/** A "suite" that took `ms` by the clock compare reads (KEEL_CLIMB_CLOCK) and waits no real time (phase 55); `tag` keeps two equal suites different commits. */
const clocked = (ms, tag = '') => `// acme suite ${tag}\nimport { writeFileSync } from 'node:fs';\nif (process.env.KEEL_CLIMB_CLOCK) writeFileSync(process.env.KEEL_CLIMB_CLOCK, '${ms}');\n`;

test('phase 47: under KEEL_AGENT_GIT, with .git and the checkout\'s parent read-only as Codex\'s sandbox keeps them, a climb night commits, compares, keeps and reverts in .keel/agent-git; .git never moves', async t => {
  // The checkout's parent is outside Codex's writable roots too: read-only here, so worktrees beside it would fail.
  const made = await acme(t, { climb: TIMED, files: { 't.mjs': clocked(1500), 'package.json': '{ "name": "acme" }\n' } });
  const parent = await mkdtemp(join(tmpdir(), 'keel-codex-parent-'));
  t.after(async () => { run('chmod', ['u+w', parent]); await rm(parent, { recursive: true, force: true }); });
  const dir = join(parent, 'acme');
  await cp(made, dir, { recursive: true });
  assert.equal(run('chmod', ['a-w', parent]).status, 0);
  const base = git(dir, ['rev-parse', 'HEAD']);
  const BRANCH = 'keel-climb/test-time/2026-10-08';
  git(dir, ['switch', '-q', '-c', BRANCH]);
  assert.equal(climb(dir, ['measure', 'test-time', '--baseline', '--runs', '1']).status, 0);
  const text = await readFile(WORKFLOW, 'utf8');
  const given = runStep(text, dir, 'Give Codex its git dir', { BRANCH });
  assert.equal(given.status, 0, given.out);
  assert.equal((await readFile(join(dir, '.keel/agent-git/HEAD'), 'utf8')).trim(), `ref: refs/heads/${BRANCH}`);
  assert.equal(git(dir, ['status', '--porcelain']), '', '.git ignores the agent\'s git dir');
  assert.equal(agentGit(dir, ['status', '--porcelain']), '', 'so does the agent\'s own');
  const restore = await sandboxGit(t, dir);
  // The suite's own clock, not the wall clock: compare's keep and revert are the fixture's (phase 55).
  const clock = join(parent, '..', `${parent.split('/').pop()}-clock`);
  t.after(() => rm(clock, { force: true }));
  const A = { KEEL_AGENT_GIT: '.keel/agent-git', KEEL_CLIMB_CLOCK: clock };

  // The fast candidate, written in place (the agent's git dir commits it, not commit()).
  await writeFile(join(dir, 't.mjs'), clocked(10, 'fast'));
  agentGit(dir, ['commit', '-q', '-am', 'acme: share one fixture']);
  const kept = climb(dir, ['compare', '--decide', '--runs', '1', '--json'], A);
  assert.equal(kept.status, 0, kept.stdout + kept.stderr);
  assert.equal(json(kept).verdict, 'keep', json(kept).why);
  assert.match(agentGit(dir, ['log', '-1', '--format=%B']), /^acme: share one fixture\n\nclimb test-time: \d+ ms → \d+ ms/, 'the numbers go in the agent\'s commit');
  const keptSha = agentGit(dir, ['rev-parse', 'HEAD']);
  // A slower candidate against the kept 10 ms one.
  await writeFile(join(dir, 't.mjs'), clocked(300, 'slower'));
  agentGit(dir, ['commit', '-q', '-am', 'acme: nothing really']);
  const missed = climb(dir, ['compare', '--decide', '--runs', '1', '--json'], A);
  assert.equal(json(missed).verdict, 'revert');
  assert.equal(agentGit(dir, ['rev-parse', 'HEAD']), keptSha, 'a revert resets the agent\'s branch');
  assert.equal(agentGit(dir, ['status', '--porcelain']), '', 'and its tree');
  assert.equal(git(dir, ['rev-parse', `refs/heads/${BRANCH}`]), base, '.git never moved');
  assert.equal(agentGit(dir, ['worktree', 'list']).split('\n').length, 1, 'no worktree left registered');
  // Without it, climb.mjs reads .git: the agent's commits are not there.
  assert.equal(json(climb(dir, ['sandbox', '--base', base, '--head', keptSha, '--json'])).ok, undefined, 'not in .git');
  const there = climb(dir, ['sandbox', '--base', base, '--head', 'HEAD', '--json'], A);
  assert.equal(json(there).ok, true, there.stdout);
  restore();
  run('chmod', ['u+w', parent]);
});

test('phase 47: Codex\'s commits leave its git dir as objects only, running nothing that dir holds (hooks, fsmonitor, aliases, includes); the judge refuses what it refuses of Claude\'s; mutation: a handoff that reads that dir runs them', async t => {
  const dir = await acme(t, { files: { 'acme.mjs': 'export const anvil = 1;\n' } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const BRANCH = 'keel-climb/test-time/2026-10-08';
  const text = await readFile(WORKFLOW, 'utf8');
  const temp = await mkdtemp(join(tmpdir(), 'keel-runner-temp-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const env = { BRANCH, RUNNER_TEMP: temp, GITHUB_SHA: base };
  const bundle = join(temp, 'handoff/night.bundle');

  /** A night: the git dir given, Codex's commits (`files` each), hostile config planted, then the handoff. */
  const night = async (commits, { workflow = text } = {}) => {
    git(dir, ['checkout', '-q', '-f', '-B', BRANCH, base]);
    git(dir, ['clean', '-q', '-fdx', '-e', '.keel/climb']);
    await rm(join(temp, 'handoff'), { recursive: true, force: true });
    assert.equal(runStep(text, dir, 'Give Codex its git dir', env).status, 0);
    const restore = await sandboxGit(t, dir);
    for (const [files, opts] of commits) {
      await write(dir, files);
      agentGit(dir, ['add', ...(opts?.force ? ['-f'] : []), '-A', '--', ...Object.keys(files)]);
      agentGit(dir, ['commit', '-q', '-m', `acme: ${Object.keys(files).join(', ')}`]);
    }
    const tip = agentGit(dir, ['rev-parse', 'HEAD']);
    const hostile = await plantHostile(t, dir);
    const r = runStep(workflow, dir, 'Take Codex\'s commits, objects only', env);
    restore();
    return { ...r, tip, ran: await hostile.ran() };
  };
  /** The judge's take: the bundle fetched into .git, then climb.mjs sandbox, as the judge job runs them. */
  const judge = () => {
    git(dir, ['fetch', '-q', bundle, `refs/heads/${BRANCH}`]);
    const head = git(dir, ['rev-parse', 'FETCH_HEAD']);
    return { head, sb: climb(dir, ['sandbox', '--base', base, '--head', head, '--json']) };
  };

  const fine = await night([[{ 'acme.mjs': 'export const anvil = 2;\n' }], [{ 'docs/acme.md': '# Acme\n' }]]);
  assert.equal(fine.status, 0, fine.out);
  assert.deepEqual(fine.ran, [], 'nothing of the agent\'s git dir ran');
  assert.match(fine.out, new RegExp(`Codex's commits: 2 on ${BRANCH}, taken as objects`));
  const { head, sb } = judge();
  assert.equal(head, fine.tip, 'the judge gets the agent\'s commits, as made');
  assert.equal(sb.status, 0, sb.stdout);

  // The judge refuses what it refuses of Claude's: keel's scripts, a workflow, the config, and a git dir carried as files.
  for (const [path, opts] of [['scripts/keel/acme.mjs'], ['.github/workflows/acme.yml'], ['.keel/keel.json'], ['.keel/agent-git/config', { force: true }]]) {
    const n = await night([[{ [path]: path === '.keel/keel.json' ? '{"name":"Acme","check":"true"}\n' : '# acme\n' }, opts]]);
    assert.equal(n.status, 0, `${path}: ${n.out}`);
    assert.deepEqual(n.ran, [], `${path}: nothing ran`);
    const j = judge();
    assert.equal(j.sb.status, 1, `${path}: ${j.sb.stdout}`);
    assert.match(json(j.sb).problems[0], new RegExp(`^${path.replace(/\./g, '\\.')}: changed on the agent's branch`));
  }

  // A head not on top of the run's commit is refused here, before any bundle: an orphan the agent made.
  git(dir, ['checkout', '-q', '-f', '-B', BRANCH, base]);
  await rm(join(temp, 'handoff'), { recursive: true, force: true });
  assert.equal(runStep(text, dir, 'Give Codex its git dir', env).status, 0);
  const orphan = git(dir, ['--git-dir=.keel/agent-git', 'commit-tree', '-m', 'acme: orphan', git(dir, ['--git-dir=.keel/agent-git', 'rev-parse', 'HEAD^{tree}'])]);
  await writeFile(join(dir, `.keel/agent-git/refs/heads/${BRANCH}`), `${orphan}\n`);
  const off = runStep(text, dir, 'Take Codex\'s commits, objects only', env);
  assert.equal(off.status, 1, off.out);
  assert.match(off.out, /is not on top of the run's commit/);
  assert.equal(existsSync(bundle), false, 'nothing handed on');
  // A ref that names no object, or a symlinked ref, hands nothing on.
  await writeFile(join(dir, `.keel/agent-git/refs/heads/${BRANCH}`), 'ref: refs/heads/main\n');
  assert.equal(runStep(text, dir, 'Take Codex\'s commits, objects only', env).status, 1);

  // Mutation: the handoff's git reads the agent's git dir (its config, hooks and all): they run.
  const reads = text.replace('g() { git -c core.hooksPath=/dev/null -c core.fsmonitor=false --git-dir="$dst" "$@"; }', 'g() { git --git-dir="$src" "$@"; }');
  assert.notEqual(reads, text, 'the mutation applied');
  const hit = await night([[{ 'acme.mjs': 'export const anvil = 3;\n' }]], { workflow: reads });
  assert.ok(hit.ran.length, `the mutation's handoff ran the agent's hooks: ${hit.out}`);
});

test('phase 47: a Codex tend pass\'s commits, handed on as objects, meet the tend guard as Claude\'s do: a cited fix passes, an evidence edit and an uncited commit are refused', async t => {
  const dir = await tendAcme(t);
  assert.equal(climb(dir, ['tend-input', '--record'], { KEEL_CLI: join(dir, 'no-such-keel') }).status, 0);
  const base = git(dir, ['rev-parse', 'HEAD']);
  const findings = JSON.parse(await readFile(join(dir, '.keel/tend/pass.json'), 'utf8')).worksheet.findings;
  const m = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
  const BRANCH = 'keel-tend/2026-10-08';
  const text = await readFile(TEND_WORKFLOW, 'utf8');
  const temp = await mkdtemp(join(tmpdir(), 'keel-runner-temp-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const env = { BRANCH, RUNNER_TEMP: temp, GITHUB_SHA: base };
  const pass = async (files, message) => {
    git(dir, ['checkout', '-q', '-f', '-B', BRANCH, base]);
    await rm(join(temp, 'handoff'), { recursive: true, force: true });
    assert.equal(runStep(text, dir, 'Give Codex its git dir', env).status, 0);
    const restore = await sandboxGit(t, dir);
    await write(dir, files);
    agentGit(dir, ['add', '-A', '--', ...Object.keys(files)]);
    agentGit(dir, ['commit', '-q', '-m', message]);
    const hostile = await plantHostile(t, dir);
    const r = runStep(text, dir, 'Take Codex\'s commits, objects only', env);
    restore();
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(await hostile.ran(), [], 'nothing of the agent\'s git dir ran');
    git(dir, ['fetch', '-q', join(temp, 'handoff/pass.bundle'), `refs/heads/${BRANCH}`]);
    const head = git(dir, ['rev-parse', 'FETCH_HEAD']);
    assert.equal(climb(dir, ['sandbox', '--base', base, '--head', head]).status, 0);
    return m.tendCheck(dir, base, head, { findings }).refused;
  };
  assert.deepEqual(await pass({ 'README.md': '# Acme\n\nAcme sells anvils.\n' }, 'acme: tend\n\nTend: proofs_hold:1'), [], 'a cited README fix passes');
  const evidence = await pass({ 'docs/evidence/2026-10-01-acme-orders.md': 'rewritten\n' }, 'acme: tend\n\nTend: proofs_hold:1');
  assert.ok(evidence.some(p => /^docs\/evidence\/2026-10-01-acme-orders\.md:1: edits evidence/.test(p)), JSON.stringify(evidence));
  const uncited = await pass({ 'README.md': 'Acme sells anvils, and ships them.\n' }, 'acme: readme');
  assert.ok(uncited.some(p => /"acme: readme": cites no finding/.test(p)), JSON.stringify(uncited));
});

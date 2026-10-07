// The climb practice's hygiene job (phase 36), past pick and guard
// (tests/climb.test.mjs): prove-steady runs one test N times on one clean
// worktree and keeps a fix only when every run passed; a night that proves
// nothing writes the issue the workflow files. The flaky Acme test fails on a
// counter, never on a clock, so the fixture decides, not the machine (the
// 6 October CI escapes: fixed sleeps under a loaded runner, and a fixed id
// prefix over random ids).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NIGHT = join(KEEL, 'practices/night/files/scripts/keel');
const CLIMB = join(KEEL, 'practices/climb/files/scripts/keel/climb.mjs');
const WORKFLOW = join(KEEL, 'practices/climb/files/.github/workflows/keel-climb.yml');
const LEDGER_TEST = 'node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout acme.test.mjs';

const git = (cwd, args) => {
  const r = run('git', args, { cwd });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
async function write(dir, files) {
  for (const [p, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), text);
  }
}
async function commit(dir, files, message) {
  await write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

/** Acme's suite: `acme counts` fails on the run its counter file says (third by default), whatever the machine. */
const counting = (failOn = 2) => `import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
test('acme adds', () => {});
test('acme counts', () => {
  let n = 0;
  try { n = Number(readFileSync(process.env.ACME_COUNT, 'utf8')); } catch {}
  writeFileSync(process.env.ACME_COUNT, String(n + 1));
  if (n === ${failOn}) throw new Error('acme: this run fails');
});
`;

async function acme(t) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-climb-hygiene-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'scripts/keel'), { recursive: true });
  for (const f of ['lib.mjs', 'test-ledger.mjs', 'pr-body.mjs']) await cp(join(NIGHT, f), join(dir, 'scripts/keel', f));
  await cp(CLIMB, join(dir, 'scripts/keel/climb.mjs'));
  await cp(join(dirname(CLIMB), 'tend.mjs'), join(dir, 'scripts/keel/tend.mjs'));
  await write(dir, { '.keel/keel.json': JSON.stringify({ name: 'Acme', check: LEDGER_TEST, climb: { jobs: ['hygiene'], testCommand: LEDGER_TEST } }), 'acme.test.mjs': counting() });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme']);
  // The ledger, as CI's artifacts would bring it: acme counts passed and failed on this one clean tree.
  const commitSha = git(dir, ['rev-parse', 'HEAD']), tree = git(dir, ['rev-parse', 'HEAD^{tree}']);
  await mkdir(join(dir, '.keel/test-runs'), { recursive: true });
  await writeFile(join(dir, '.keel/test-runs/.gitignore'), '*\n');
  for (const [i, outcome] of ['pass', 'fail', 'pass', 'pass'].entries()) {
    await writeFile(join(dir, `.keel/test-runs/2026-10-05T0${i}-00-00-000Z-${i}.json`), JSON.stringify({ commit: commitSha, tree, dirty: false, machine: { os: 'linux', arch: 'x64', cpus: 4 }, node: 'v24.0.0', date: `2026-10-05T0${i}:00:00.000Z`, tests: [{ file: 'acme.test.mjs', name: 'acme adds', outcome: 'pass', ms: 1 }, { file: 'acme.test.mjs', name: 'acme counts', outcome, ms: 1 }] }));
  }
  return dir;
}

const climb = (dir, args, env = {}) => run(process.execPath, [join(dir, 'scripts/keel/climb.mjs'), ...args], { cwd: dir, env: { ...process.env, ...env } });
const json = r => { try { return JSON.parse(r.stdout); } catch { assert.fail(`not JSON (exit ${r.status}): ${r.stdout}${r.stderr}`); } };
/** A fresh counter outside the repo, so the worktree stays clean. */
async function counter(t) {
  const d = await mkdtemp(join(tmpdir(), 'keel-climb-count-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  return { ACME_COUNT: join(d, 'count') };
}

test('prove-steady: N runs of one test on one clean worktree; steady only with N passes, a fail at any run is not, and a name that matches nothing cannot tell', async t => {
  const dir = await acme(t);
  const spec = 'acme.test.mjs: acme counts';
  const flaky = climb(dir, ['prove-steady', '--test', spec, '--runs', '5', '--json'], await counter(t));
  assert.equal(flaky.status, 1, flaky.stdout + flaky.stderr);
  assert.deepEqual([json(flaky).steady, json(flaky).passed, json(flaky).failed], [false, 2, 1]);
  assert.match(json(flaky).why, /^acme\.test\.mjs "acme counts" failed at run 3 of 5 \(passed 2, failed 1\) on one clean tree [0-9a-f]{7}/);

  const fix = await commit(dir, { 'acme.test.mjs': counting(-1) }, 'acme: the counter no longer decides');
  const steady = climb(dir, ['prove-steady', '--test', spec, '--runs', '5', '--json'], await counter(t));
  assert.equal(steady.status, 0, steady.stdout + steady.stderr);
  assert.deepEqual([json(steady).steady, json(steady).passed, json(steady).failed, json(steady).candidate], [true, 5, 0, fix]);
  assert.match(json(steady).why, /^acme\.test\.mjs "acme counts" passed 5 of 5 on one clean tree [0-9a-f]{7}$/);
  assert.equal(git(dir, ['worktree', 'list']).split('\n').length, 1, 'prove-steady removes its worktree');

  // A name that matches no test never ran: exit 2, never a pass. The ledger fails a run that
  // executed no test, so prove-steady stops at the first.
  const typo = climb(dir, ['prove-steady', '--test', 'acme.test.mjs: acme count', '--runs', '2', '--json'], await counter(t));
  assert.equal(typo.status, 2);
  assert.match(json(typo).error, /"acme count" never ran in 1 run: .*prove-steady cannot tell/);
  for (const [args, re] of [[['--test', 'acme counts'], /--test is "<file>: <name>"/], [['--test', spec, '--runs', '51'], /--runs must be a whole number from 1 to 50/], [['--test', 'acme.missing.mjs: x'], /acme\.missing\.mjs is not in/]]) {
    const r = climb(dir, ['prove-steady', ...args, '--json']);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(json(r).error, re);
  }
  // The suite's preloads ride along, so a test runs alone as it ran in the suite.
  const { preloadsOf } = await import(`${new URL(`file://${join(dir, 'scripts/keel/climb.mjs')}`).href}`);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --import ./tests/helpers/hermetic.mjs --test --test-reporter=spec tests/' } }));
  assert.deepEqual(await preloadsOf(dir, { climb: { jobs: ['hygiene'] } }), ['--import=./tests/helpers/hermetic.mjs']);
  assert.deepEqual(await preloadsOf(dir, { climb: { jobs: ['hygiene'], testCommand: "node -r ./a.cjs --test 'x'" } }), ['--require=./a.cjs']);
});

test('a hygiene night: prove-steady --decide keeps a proven fix with its runs and reverts a timeout-only one; the PR names the test; a night that proved nothing writes the issue', async t => {
  const dir = await acme(t);
  const spec = 'acme.test.mjs: acme counts';
  const base = git(dir, ['rev-parse', 'HEAD']);
  const night = () => readFile(join(dir, '.keel/climb/night.json'), 'utf8').then(JSON.parse);
  assert.equal(json(climb(dir, ['measure', 'hygiene', '--baseline', '--json'])).median, 1);
  // Hygiene has no timing: compare refuses to judge it, and the final compare is a no-op.
  assert.match(json(climb(dir, ['compare', '--decide', '--json'])).error, /hygiene is judged by prove-steady, not by timing/);

  const fix = await commit(dir, { 'acme.test.mjs': counting(-1) }, 'acme: the counter no longer decides');
  const kept = climb(dir, ['prove-steady', '--test', spec, '--runs', '3', '--decide', '--json'], await counter(t));
  assert.equal(kept.status, 0, kept.stdout + kept.stderr);
  assert.equal(json(kept).verdict, 'keep');
  assert.match(git(dir, ['log', '-1', '--format=%B']), /^acme: the counter no longer decides\n\nclimb hygiene: acme\.test\.mjs "acme counts" passed 3 of 3 on one clean tree [0-9a-f]{7}; base [0-9a-f]{7}$/);
  const keptSha = git(dir, ['rev-parse', 'HEAD']);
  assert.notEqual(keptSha, fix, 'the runs are amended into the commit');

  // A longer wait and nothing else: refused before a single run, and reset.
  await commit(dir, { 'acme.test.mjs': counting(-1).replace("test('acme counts', () => {", "test('acme counts', { timeout: 9000 }, () => {") }, 'acme: wait longer');
  const waited = json(climb(dir, ['prove-steady', '--test', spec, '--decide', '--json'], await counter(t)));
  assert.equal(waited.verdict, 'revert');
  assert.match(waited.why, /acme\.test\.mjs:4 .*only changes a timeout or a retry/);
  assert.equal(git(dir, ['rev-parse', 'HEAD']), keptSha);
  assert.deepEqual((await night()).tried.map(a => a.verdict), ['keep', 'revert']);

  assert.equal(json(climb(dir, ['compare', '--final', '--json'])).verdict, 'same');
  const bodyFile = join(dir, '..', `${dir.split('/').pop()}-body.md`), issueFile = join(dir, '..', `${dir.split('/').pop()}-issue.md`);
  t.after(() => Promise.all([rm(bodyFile, { force: true }), rm(issueFile, { force: true })]));
  const rep = json(climb(dir, ['report', '--body', bodyFile, '--issue', issueFile, '--json']));
  assert.equal(rep.issue, null, 'a kept fix opens a PR, not an issue');
  assert.match(rep.line, /^climb hygiene \d{4}-\d{2}-\d{2}: kept 1 of 2 tried; flaky tests 1 → 0/);
  const body = await readFile(bodyFile, 'utf8');
  assert.match(body, /^\| Flaky test \(the test ledger\) \| Before \| After \|$/m);
  assert.match(body, /^\| acme\.test\.mjs "acme counts" \| passed 3, failed 1 on [0-9a-f]{7} \| steady \(prove-steady\) \|$/m);
  assert.match(body, /^\| acme: the counter no longer decides \([0-9a-f]{7}\) \| acme\.test\.mjs "acme counts" \| passed 3 of 3, failed 0, on one clean tree [0-9a-f]{7} \|$/m);
  assert.match(body, /^- acme: wait longer: acme\.test\.mjs:4 /m);

  // Another night, nothing proven: no PR, and the issue carries the ledger's evidence.
  git(dir, ['reset', '-q', '--hard', base]);
  json(climb(dir, ['measure', 'hygiene', '--baseline', '--json']));
  await commit(dir, { 'acme.test.mjs': counting(3) }, 'acme: a later run fails instead');
  const moved = json(climb(dir, ['prove-steady', '--test', spec, '--runs', '5', '--decide', '--json'], await counter(t)));
  assert.equal(moved.verdict, 'revert', moved.why);
  const none = json(climb(dir, ['report', '--issue', issueFile, '--json']));
  assert.equal(none.kept, 0);
  assert.match(none.line, /kept nothing; 1 tried, none proven steady/);
  assert.equal(none.issue.title, 'Flaky test: acme.test.mjs "acme counts"');
  const issue = await readFile(issueFile, 'utf8');
  assert.match(issue, /the cause of this flaky test was not found within the budget/);
  assert.match(issue, /^\| acme\.test\.mjs "acme counts" \| [0-9a-f]{7} \| 3 \| 1 \|$/m);
  assert.match(issue, /^node --test --test-name-pattern='\^acme counts\$' acme\.test\.mjs$/m);
  assert.match(issue, /^- acme: a later run fails instead: acme\.test\.mjs "acme counts" failed at run 4 of 5/m);
});

/** Run one named step of keel-climb.yml with a gh that logs its calls: { status, out, calls }. */
async function issueStep(t, open) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-climb-issue-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // The judge's handoff, as the publish job downloads it into $RUNNER_TEMP/night.
  await mkdir(join(dir, 'night'));
  await writeFile(join(dir, 'night/issue-title.txt'), 'Flaky test: acme.test.mjs "acme counts"');
  await writeFile(join(dir, 'night/issue.md'), 'acme\n');
  await mkdir(join(dir, 'bin'));
  await writeFile(join(dir, 'bin/gh'), `#!/bin/sh\necho "$@" >> "${join(dir, 'calls')}"\nif [ "$1 $2" = "issue list" ]; then printf '%s\\n' ${open.map(o => `'${o}'`).join(' ') || "''"}; fi\n`, { mode: 0o755 });
  const block = runBlocks(await readFile(WORKFLOW, 'utf8')).find(b => b.step === 'File the flaky test');
  assert.ok(block, 'keel-climb.yml has a step "File the flaky test"');
  const r = run('bash', ['-e', '-c', block.script], { cwd: dir, env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: dir, REPO: 'acme/anvils' } });
  const calls = await readFile(join(dir, 'calls'), 'utf8').catch(() => '');
  return { status: r.status, out: r.stdout + r.stderr, calls };
}

test('the workflow files a hygiene night\'s issue on the project\'s own repo, once, and only when hygiene proved nothing', async t => {
  const fresh = await issueStep(t, ['Anvils rust']);
  assert.equal(fresh.status, 0, fresh.out);
  assert.match(fresh.calls, /^issue create --repo acme\/anvils --title Flaky test: acme\.test\.mjs "acme counts" --body-file .*issue\.md$/m);
  const again = await issueStep(t, ['Flaky test: acme.test.mjs "acme counts"']);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /::notice::Already open: Flaky test/);
  assert.doesNotMatch(again.calls, /issue create/);
  const text = await readFile(WORKFLOW, 'utf8');
  assert.match(text, /- name: File the flaky test\n\s+if: needs\.agent\.outputs\.job == 'hygiene' && needs\.judge\.outputs\.issue == 'yes'\n\s+env:\n\s+REPO: \$\{\{ github\.repository \}\}/);
  // issues: write is the publish job's alone: the agent's and the judge's tokens cannot file one.
  const jobs = text.split(/\n(?= {2}[a-z]+:\n)/);
  assert.deepEqual(jobs.filter(j => /\n {6}issues: write\n/.test(j)).map(j => j.split('\n')[0]), ['  publish:']);
  assert.ok(text.indexOf('- name: File the flaky test') > text.indexOf('\n  publish:\n'), 'the issue is filed by the publish job');
  assert.match(text, /climb\.mjs report --state --body "\$RUNNER_TEMP\/body\.md" --issue "\$RUNNER_TEMP\/issue\.md"/);
  assert.ok(text.indexOf('- name: Gather the test ledger') < text.indexOf('- name: Baseline'), 'the ledger is gathered before the baseline reads it');
});

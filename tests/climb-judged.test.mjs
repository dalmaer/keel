// #68: climb and tend publish exactly the commit their guard passed. The
// workflows' own steps, run as the workflow has them, on a synthetic Acme: the
// judge names its commit before any of the agent's code runs and bundles that
// commit alone, whatever lands on the branch after; the publish job refuses a
// bundle whose head is not that commit, and rechecks the commit itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { WORKFLOW, TEND_WORKFLOW, git, commit, acme, climb, json } from './helpers/climb.mjs';

const DAY = '2026-10-10';

/** Run one named step of a workflow's text in `dir`, as a runner would: { status, out, outputs }. */
async function stepIn(text, dir, name, env) {
  const block = runBlocks(text).find(b => b.step === name);
  assert.ok(block, `the workflow has a step "${name}"`);
  const out = join(env.RUNNER_TEMP, `${name.replace(/\W/g, '')}.out`);
  await writeFile(out, '');
  const r = run('bash', ['-e', '-c', block.script], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: join(env.RUNNER_TEMP, 'summary.md'), ...env } });
  const outputs = Object.fromEntries((await readFile(out, 'utf8')).split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { status: r.status, out: r.stdout + r.stderr, outputs };
}

const temp = async (t, tag) => {
  const d = await mkdtemp(join(tmpdir(), `keel-judged-${tag}-`));
  t.after(() => rm(d, { recursive: true, force: true }));
  return d;
};

/** A fresh checkout of `origin` at its main (what actions/checkout gives a job), with origin as its remote. */
async function checkout(t, origin, tag) {
  const d = join(await temp(t, tag), 'acme');
  git(join(d, '..'), ['clone', '-q', origin, d]);
  return d;
}

/** A gh that lists no PR and opens one quietly: the publish step's PR calls, offline. */
async function quietGh(t) {
  const d = await temp(t, 'gh');
  await writeFile(join(d, 'gh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return d;
}

const pushed = (bare, ref) => run('git', ['rev-parse', '-q', '--verify', ref], { cwd: bare }).stdout.trim();
const bundleHead = (dir, file, ref) => git(dir, ['bundle', 'list-heads', file, ref]).split(' ')[0];

/** Acme on a bare origin, its main the run's commit: { bare, base }. Each job clones its own checkout of it. */
async function origin(t) {
  const src = await acme(t, { climb: { jobs: ['test-time'] }, config: { tend: { budget: { minutes: 30 } } } });
  const bare = join(await temp(t, 'origin'), 'acme.git');
  git(src, ['clone', '-q', '--bare', src, bare]);
  return { bare, base: git(src, ['rev-parse', 'HEAD']) };
}

test('#68 climb: the judge bundles the commit it named before the agent\'s code ran, never a later one; publish refuses a bundle with any other head, and rechecks the commit itself', async t => {
  const { bare, base } = await origin(t);
  const BRANCH = `keel-climb/test-time/${DAY}`;
  const text = await readFile(WORKFLOW, 'utf8');

  // The agent's job: one kept change, its record, its commits as a bundle.
  const agent = await checkout(t, bare, 'agent');
  git(agent, ['switch', '-q', '-c', BRANCH]);
  const kept = await commit(agent, { 'src/acme.mjs': 'export const anvil = 1;\n' }, 'acme: a faster anvil');
  const agentTemp = await temp(t, 'agent-temp');
  await mkdir(join(agentTemp, 'handoff/record'), { recursive: true });
  git(agent, ['bundle', 'create', join(agentTemp, 'handoff/night.bundle'), `${base}..refs/heads/${BRANCH}`]);
  const record = { job: 'test-time', date: DAY, base, started: `${DAY}T10:17:00.000Z`, margin: 0.05, attempts: 10, command: 'npm test', baseline: { median: 100, spread: 1, times: [100] }, tried: [{ what: 'acme: a faster anvil', verdict: 'keep', why: 'acme', base, candidate: kept, rounds: [] }] };
  await writeFile(join(agentTemp, 'handoff/record/night.json'), JSON.stringify(record));
  await writeFile(join(agentTemp, 'handoff/record/.gitignore'), '/*\n');

  // The judge: the commits taken, settled, and named before any of the agent's code runs.
  const judge = await checkout(t, bare, 'judge');
  const judgeTemp = await temp(t, 'judge-temp');
  await cp(join(agentTemp, 'handoff'), join(judgeTemp, 'handoff'), { recursive: true });
  const env = { RUNNER_TEMP: judgeTemp, GITHUB_SHA: base, BRANCH };
  const take = await stepIn(text, judge, "Take the night's commits", env);
  assert.equal(take.status, 0, take.out);
  assert.equal(take.outputs.validated, kept, 'the commit named is the kept change, before any of the agent\'s code ran');
  assert.equal(JSON.parse(take.outputs.held).head, kept);

  // The agent's code the judge runs past the guard (a gate's background process, compare --final's worktree)
  // commits after the guard returned: held refuses it, and the bundle is still the commit named.
  const later = await commit(judge, { 'src/acme.mjs': 'export const anvil = 2; // never guarded\n' }, 'acme: a commit after the guard');
  const held = climb(judge, ['held', '--since', take.outputs.held, '--head', take.outputs.validated, '--json']);
  assert.equal(held.status, 1, held.stdout);
  assert.ok(json(held).problems.some(p => /moved HEAD from [0-9a-f]{7} to [0-9a-f]{7}/.test(p)), held.stdout);
  const hand = await stepIn(text, judge, 'Hand the judged night on', { ...env, VALIDATED: take.outputs.validated });
  assert.equal(hand.status, 0, hand.out);
  const judged = join(judgeTemp, 'judged/night.bundle');
  assert.equal(bundleHead(judge, judged, `refs/heads/${BRANCH}`), kept, 'the bundle ends on the commit named, not the later one');

  // Publish: the commit named, rechecked, pushed with the rotation's state on top; any other head, nothing pushed.
  const gh = await quietGh(t);
  const publishEnv = night => ({ RUNNER_TEMP: night, GITHUB_SHA: base, KEPT: '1', LINE: 'climb test-time: kept 1', JOB: 'test-time', DAY, BRANCH, VALIDATED: kept, BASE: 'main', GH_TOKEN: 'acme', PATH: `${gh}:${process.env.PATH}` });
  const target = `refs/heads/keel-climb/test-time/${DAY}`;
  const publishWith = async (bundle, over = {}) => {
    const pub = await checkout(t, bare, 'publish');
    const pubTemp = await temp(t, 'publish-temp');
    await mkdir(join(pubTemp, 'night/record'), { recursive: true });
    await cp(bundle, join(pubTemp, 'night/night.bundle'));
    await writeFile(join(pubTemp, 'night/body.md'), 'acme\n');
    return { pub, r: await stepIn(text, pub, "Open the climb's pull request", { ...publishEnv(pubTemp), ...over }) };
  };

  // A bundle of the later commit (the hand-off as it was before #68): refused, red, nothing pushed.
  const lateBundle = join(await temp(t, 'late'), 'night.bundle');
  git(judge, ['update-ref', `refs/heads/${BRANCH}`, later]);
  git(judge, ['bundle', 'create', lateBundle, `${base}..refs/heads/${BRANCH}`]);
  assert.equal(bundleHead(judge, lateBundle, `refs/heads/${BRANCH}`), later);
  const late = await publishWith(lateBundle);
  assert.equal(late.r.status, 1, late.r.out);
  assert.match(late.r.out, /::error::The judged bundle's head \([0-9a-f]{40}\) is not the commit the judge named before the agent's code ran/);
  assert.equal(pushed(bare, target), '', 'nothing is pushed');
  const unnamed = await publishWith(judged, { VALIDATED: '' });
  assert.equal(unnamed.r.status, 1, 'no commit named, nothing pushed');
  assert.equal(pushed(bare, target), '');

  // The commit named: pushed, with the rotation's state as one more commit made by publish itself.
  const ok = await publishWith(judged);
  assert.equal(ok.r.status, 0, ok.r.out);
  const tip = pushed(bare, target);
  assert.equal(git(bare, ['rev-parse', `${tip}^`]), kept, 'the guarded commit, and the rotation state on it');
  assert.deepEqual(git(bare, ['diff', '--name-only', kept, tip]).split('\n'), ['.keel/climb.json']);
  assert.deepEqual(JSON.parse(git(bare, ['show', `${tip}:.keel/climb.json`])), { last: { job: 'test-time', date: DAY, kept: 1 } });
  assert.equal(git(bare, ['log', '-1', '--format=%s', tip]), `keel climb: test-time ${DAY}, rotation state`);

  // The recheck is publish's own: a named commit that changes a workflow is refused there too.
  const src = await checkout(t, bare, 'off');
  git(src, ['switch', '-q', '-c', BRANCH, base]);
  const off = await commit(src, { '.github/workflows/acme.yml': 'name: acme\n' }, 'acme: a workflow');
  const offBundle = join(await temp(t, 'off'), 'night.bundle');
  git(src, ['bundle', 'create', offBundle, `${base}..refs/heads/${BRANCH}`]);
  run('git', ['update-ref', '-d', target], { cwd: bare });
  const refused = await publishWith(offBundle, { VALIDATED: off });
  assert.equal(refused.r.status, 1, refused.r.out);
  assert.match(refused.r.out, /sandbox refused:[\s\S]*\.github\/workflows\/acme\.yml: changed on the agent's branch/);
  assert.equal(pushed(bare, target), '', 'nothing is pushed');
});

test('#68 tend: the judge names the pass with its page before the gate runs, bundles that alone; publish refuses another head and rechecks the record rules itself (sandbox --job tend)', async t => {
  const { bare, base } = await origin(t);
  const BRANCH = `keel-tend/${DAY}`;
  const text = await readFile(TEND_WORKFLOW, 'utf8');

  const agent = await checkout(t, bare, 'agent');
  git(agent, ['switch', '-q', '-c', BRANCH]);
  await commit(agent, { 'docs/acme.md': '# Acme\n\nAnvils ship on Mondays.\n' }, 'docs: anvils ship on Mondays\n\nTend: drift:acme');
  const agentTemp = await temp(t, 'agent-temp');
  await mkdir(join(agentTemp, 'handoff/record'), { recursive: true });
  git(agent, ['bundle', 'create', join(agentTemp, 'handoff/pass.bundle'), `${base}..refs/heads/${BRANCH}`]);
  const pass = { base, date: DAY, worksheet: { findings: [{ id: 'drift:acme' }, { id: 'proofs_hold:acme' }] }, notes: [{ finding: 'proofs_hold:acme', kind: 'proposed', text: 'Acme: restore the orders test.' }] };
  await writeFile(join(agentTemp, 'handoff/record/pass.json'), JSON.stringify(pass));
  await writeFile(join(agentTemp, 'handoff/record/.gitignore'), '*\n');

  const judge = await checkout(t, bare, 'judge');
  const judgeTemp = await temp(t, 'judge-temp');
  await cp(join(agentTemp, 'handoff'), join(judgeTemp, 'handoff'), { recursive: true });
  const env = { RUNNER_TEMP: judgeTemp, GITHUB_SHA: base, BRANCH, DAY };
  const take = await stepIn(text, judge, "Take the pass's commits", env);
  assert.equal(take.status, 0, take.out);
  const page = git(judge, ['rev-parse', 'HEAD']);
  assert.equal(git(judge, ['log', '-1', '--format=%s', page]), `keel tend: ${DAY}, 1 proposal for the owner`);
  assert.equal(take.outputs.validated, page, 'the commit named is the judge\'s page, on the agent\'s commits');

  const later = await commit(judge, { 'docs/acme.md': '# Acme\n\nNever guarded.\n' }, 'docs: after the gate\n\nTend: drift:acme');
  const held = climb(judge, ['held', '--since', take.outputs.held, '--head', take.outputs.validated, '--json']);
  assert.equal(held.status, 1, held.stdout);
  const hand = await stepIn(text, judge, 'Hand the judged pass on', { ...env, VALIDATED: take.outputs.validated });
  assert.equal(hand.status, 0, hand.out);
  const judged = join(judgeTemp, 'judged/pass.bundle');
  assert.equal(bundleHead(judge, judged, `refs/heads/${BRANCH}`), page, 'the bundle ends on the commit named, not the later one');

  const gh = await quietGh(t);
  const target = `refs/heads/keel-tend/${DAY}`;
  const publishWith = async (bundle, over = {}) => {
    const pub = await checkout(t, bare, 'publish');
    const pubTemp = await temp(t, 'publish-temp');
    await mkdir(join(pubTemp, 'pass/record'), { recursive: true });
    await cp(bundle, join(pubTemp, 'pass/pass.bundle'));
    await writeFile(join(pubTemp, 'pass/body.md'), 'acme\n');
    const e = { RUNNER_TEMP: pubTemp, GITHUB_SHA: base, COMMITS: '2', LINE: 'tend: 2 commits', DAY, BRANCH, VALIDATED: page, BASE: 'main', GH_TOKEN: 'acme', PATH: `${gh}:${process.env.PATH}`, ...over };
    return stepIn(text, pub, 'Open the tend pull request', e);
  };

  const lateBundle = join(await temp(t, 'late'), 'pass.bundle');
  git(judge, ['update-ref', `refs/heads/${BRANCH}`, later]);
  git(judge, ['bundle', 'create', lateBundle, `${base}..refs/heads/${BRANCH}`]);
  assert.equal(bundleHead(judge, lateBundle, `refs/heads/${BRANCH}`), later);
  const late = await publishWith(lateBundle);
  assert.equal(late.status, 1, late.out);
  assert.match(late.out, /::error::The judged bundle's head \([0-9a-f]{40}\) is not the commit the judge named before the agent's code ran/);
  assert.equal(pushed(bare, target), '', 'nothing is pushed');

  const ok = await publishWith(judged);
  assert.equal(ok.status, 0, ok.out);
  assert.equal(pushed(bare, target), page, 'exactly the commit the guard passed');

  // The record rules are publish's own: a named commit that writes evidence, or cites no finding, is refused there.
  for (const [files, message, said] of [
    [{ 'docs/evidence/2026-10-10-acme.md': '# Acme: proven\n' }, 'docs: proven\n\nTend: drift:acme', /docs\/evidence\/2026-10-10-acme\.md:1: adds evidence/],
    [{ 'docs/acme.md': '# Acme\n\nUncited.\n' }, 'docs: uncited', /cites no finding/],
  ]) {
    const src = await checkout(t, bare, 'rules');
    git(src, ['switch', '-q', '-c', BRANCH, base]);
    const head = await commit(src, files, message);
    const b = join(await temp(t, 'rules'), 'pass.bundle');
    git(src, ['bundle', 'create', b, `${base}..refs/heads/${BRANCH}`]);
    run('git', ['update-ref', '-d', target], { cwd: bare });
    const refused = await publishWith(b, { VALIDATED: head });
    assert.equal(refused.status, 1, refused.out);
    assert.match(refused.out, said);
    assert.equal(pushed(bare, target), '', 'nothing is pushed');
  }
});

test('#68: climb.mjs held names the checkout\'s state as one line, and with --since refuses what moved: HEAD, the tree, the git dir; a state of another commit is refused', async t => {
  const dir = await acme(t);
  const head = git(dir, ['rev-parse', 'HEAD']);
  const line = climb(dir, ['held']);
  assert.equal(line.status, 0, line.stderr);
  assert.equal(line.stdout.trim().split('\n').length, 1, 'one line, for a step output');
  const state = line.stdout.trim();
  assert.equal(JSON.parse(state).head, head);
  const still = climb(dir, ['held', '--since', state, '--head', head]);
  assert.equal(still.status, 0, still.stdout + still.stderr);
  assert.match(still.stdout, /^held: nothing moved since [0-9a-f]{7} was named/);
  // Another commit's state, or a malformed one: refused before anything is compared.
  const other = climb(dir, ['held', '--since', state, '--head', 'f'.repeat(40), '--json']);
  assert.equal(other.status, 1);
  assert.match(json(other).problems[0], /the state given \(--since\) is of [0-9a-f]{7}, not of the commit the judge named/);
  assert.equal(climb(dir, ['held', '--since', '{"acme":1}', '--head', head]).status, 2);
  assert.equal(climb(dir, ['held', '--since', state]).status, 2, '--since needs --head');
  for (const [move, said] of [
    [async () => { await writeFile(join(dir, '.keel/keel.json'), '{}\n'); }, /changed the tracked tree or the index/],
    [async () => { await writeFile(join(dir, '.git/hooks/post-checkout'), '#!/bin/sh\n', { mode: 0o755 }); }, /changed the git dir's config, hooks or attributes/],
    [async () => { await commit(dir, { 'acme.txt': 'later\n' }, 'acme: later'); }, /moved HEAD from/],
  ]) {
    await move();
    const r = climb(dir, ['held', '--since', state, '--head', head, '--what', 'the acme gate']);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /^::error::the acme gate /m);
    assert.match(r.stdout, said);
    git(dir, ['reset', '-q', '--hard', head]);
    await rm(join(dir, '.git/hooks/post-checkout'), { force: true });
  }
  // sandbox --job takes tend alone: a climb job's rules are its guard's.
  assert.equal(climb(dir, ['sandbox', '--base', head, '--head', head, '--job', 'test-time']).status, 2);
});

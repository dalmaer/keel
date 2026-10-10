// Shared by the climb test files (tests/climb*.test.mjs): the synthetic Acme
// repo, the climb.mjs runner, and the gh and keel stubs. Split out of
// climb.test.mjs (2026-10-09) so its tests run in parallel. `clocked` stays
// in each test file that times a suite, beside the stalls pin
// tests/timing-hygiene.test.mjs asks of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp, realpath, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './run.mjs';
import { runBlocks } from './workflows.mjs';

export const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const NIGHT = join(KEEL, 'practices/night/files/scripts/keel');

export const CLIMB = join(KEEL, 'practices/climb/files/scripts/keel/climb.mjs');

export const WORKFLOW = join(KEEL, 'practices/climb/files/.github/workflows/keel-climb.yml');

export const git = (cwd, args) => {
  const r = run('git', args, { cwd });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

export async function write(dir, files) {
  for (const [p, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), text);
  }
}

/** Commit `files` on the current branch; returns the new sha. */
export async function commit(dir, files, message) {
  await write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

/** A synthetic Acme project with the night's scripts and climb.mjs in scripts/keel, committed on main. */
export async function acme(t, { climb = { jobs: ['test-time'] }, config = {}, files = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-climb-acme-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'scripts/keel'), { recursive: true });
  for (const f of ['lib.mjs', 'test-ledger.mjs', 'time-receipts.mjs', 'pr-body.mjs']) await cp(join(NIGHT, f), join(dir, 'scripts/keel', f));
  await cp(CLIMB, join(dir, 'scripts/keel/climb.mjs'));
  await cp(join(dirname(CLIMB), 'tend.mjs'), join(dir, 'scripts/keel/tend.mjs'));
  await write(dir, { '.keel/keel.json': `${JSON.stringify({ name: 'Acme', ...(climb ? { climb } : {}), ...config }, null, 2)}\n`, ...files });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme']);
  return dir;
}

export const climb = (dir, args, env = {}) => run(process.execPath, [join(dir, 'scripts/keel/climb.mjs'), ...args], { cwd: dir, env: { ...process.env, ...env } });

export const json = r => { try { return JSON.parse(r.stdout); } catch { assert.fail(`not JSON (exit ${r.status}): ${r.stdout}${r.stderr}`); } };

export const load = dir => import(pathToFileURL(join(dir, 'scripts/keel/climb.mjs')).href);

/**
 * A stub gh: `pr list --state open` prints these open heads (or exits 1 when
 * `heads` is null); `pr list --state all` prints `closed` (every state:
 * [{ headRefName, number, createdAt, mergedAt, state? }]); `--state closed`
 * prints only those whose state is CLOSED or MERGED, as gh does.
 */
export async function stubGh(t, heads, closed = []) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-climb-gh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gh = join(dir, 'gh');
  const open = heads === null ? 'echo "gh: acme is unreachable" >&2\nexit 1' : `echo '${JSON.stringify(heads.map(h => ({ headRefName: h })))}'\nexit 0`;
  const shut = closed.filter(p => p.state !== 'OPEN');
  await writeFile(gh, `#!/bin/sh\nif [ "$1 $2 $3 $4" = "pr list --state all" ]; then\necho '${JSON.stringify(closed)}'\nexit 0\nfi\nif [ "$1 $2 $3 $4" = "pr list --state closed" ]; then\necho '${JSON.stringify(shut)}'\nexit 0\nfi\nif [ "$1 $2" = "pr list" ]; then\n${open}\nfi\nexit 1\n`, { mode: 0o755 });
  return gh;
}

/** A health page as the night writes its table. */
export const page = rows => [
  '# Health — 2026-10-05', '', '| Measure | Value | Bound | State | Detail |', '| --- | --- | --- | --- | --- |',
  ...rows.map(([id, value, bound, state]) => `| \`${id}\` — what it counts \\| with a pipe | ${value} | ${bound} | ${state} | detail |`), '',
].join('\n');

// The margin is wide (30%) and the gaps wider: the sleeps (600 ms against 10) dominate
// node's own startup even on a loaded 4-CPU runner (one took ~650 ms to start
// node; lesson 40), so the fixture decides, never the machine.
export const TIMED = { jobs: ['test-time'], testCommand: 'node t.mjs', margin: 0.3 };

/** An Acme suite under node --test with the test ledger as its second reporter. */
export const LEDGER_TEST = 'node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout acme.test.mjs';

export const suite = (...names) => `import { test } from 'node:test';\n${names.map(n => (typeof n === 'string' ? `test('${n}', () => {});` : n.text)).join('\n')}\n`;

/** Run one named step of keel-climb.yml in `dir`, as the workflow has it: { status, out, outputs }. */
export async function step(t, dir, name, env = {}) {
  const block = runBlocks(await readFile(WORKFLOW, 'utf8')).find(b => b.step === name);
  assert.ok(block, `keel-climb.yml has a step "${name}"`);
  const out = join(dir, '..', `${dir.split('/').pop()}-${name.replace(/\W/g, '')}-out`);
  t.after(() => rm(out, { force: true }));
  await writeFile(out, '');
  const r = run('bash', ['-e', '-c', block.script], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out, ...env } });
  const outputs = Object.fromEntries((await readFile(out, 'utf8')).split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { status: r.status, out: r.stdout + r.stderr, outputs };
}

// ---- phase 36: hygiene and build-time ---------------------------------------------

/** Synthetic test ledger runs (the ledger's record shape) for `tree`, written under dir's .keel/test-runs. */
export async function ledgerRuns(dir, { commit, tree, outcomes, file = 'acme.test.mjs', name = 'acme waits', others = ['acme adds'] }) {
  await mkdir(join(dir, '.keel/test-runs'), { recursive: true });
  await writeFile(join(dir, '.keel/test-runs/.gitignore'), '*\n');
  for (const [i, outcome] of outcomes.entries()) {
    const run = { commit, tree, dirty: false, machine: { os: 'linux', arch: 'x64', cpus: 4 }, node: 'v24.0.0', date: `2026-10-05T0${i}:00:00.000Z`, tests: [...others.map(n => ({ file, name: n, outcome: 'pass', ms: 1 })), { file, name, outcome, ms: 2 }] };
    await writeFile(join(dir, `.keel/test-runs/2026-10-05T0${i}-00-00-000Z-${i}.json`), JSON.stringify(run));
  }
}

/** A flaky test with a timeout, as a person might first write it. */
export const WAITING = `import { test } from 'node:test';
test('acme adds', () => {});
test('acme waits', { timeout: 100 }, async () => {
  const id = Math.random().toString(36).slice(2, 6);
  if (id.length > 4) throw new Error('acme');
});
`;

// ---- did the agent run? (lesson 29) -------------------------------------------------

/** claude-code-action's execution file: the session's messages, then one result. */
export const execution = result => JSON.stringify([{ type: 'system', subtype: 'init', session_id: 'acme' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'acme private session text' }] } }, { type: 'result', ...result }]);

// ---- phase 38: the tend pass ---------------------------------------------------------

export const keelCli = (args, cwd, env = {}) => run(process.execPath, [join(KEEL, 'bin/keel.mjs'), ...args], { cwd, env: { ...process.env, ...env } });

/**
 * A keel-inited Acme with climb (so tend.mjs, improve.mjs and roadmap.mjs are
 * its own), a built phase 1 whose cited test is gone (proof lost) and its
 * evidence, all committed. `tend`: the "tend" key, or null for none.
 */
export async function tendAcme(t, { tend = { budget: { minutes: 30 } } } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'keel-tend-acme-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'acme');
  const r = keelCli(['init', dir, '--description', 'Acme sells anvils.', '--name', 'Acme', '--with', 'climb'], base);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const config = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  await write(dir, {
    '.keel/keel.json': `${JSON.stringify({ ...config, check: 'node -e "process.exit(0)"', ...(tend ? { tend } : {}) }, null, 2)}\n`,
    'docs/evidence/2026-10-01-acme-orders.md': '# Acme orders\n\nOrdered one anvil; it arrived.\n',
    'docs/phases/01-acme-orders.md': ['---', 'status: built', 'since: 2026-10-01', 'goal: G0', 'depends: [0]', 'note: "Acme orders work."', 'evidence: ["evidence/2026-10-01-acme-orders.md"]', '---', '',
      '# Acme orders', '', '## Done when', '', 'An anvil is ordered.', '', '## Scope', '', 'Orders.', '', '## Acceptance', '',
      '- [x] An anvil is ordered. `tests/acme-orders.test.mjs: "orders"`', '', '## Proof', '', 'Automated: `node --test tests/acme-orders.test.mjs`.', '', '## Deliberately open', '', 'Nothing.', '', '## Next action', '', 'None.', ''].join('\n'),
    'docs/phases/02-acme-ships.md': ['---', 'status: partial', 'since: 2026-10-01', 'goal: G0', 'depends: [1]', 'note: "Acme ships."', 'evidence: []', '---', '',
      '# Acme ships', '', '## Done when', '', 'An anvil ships.', '', '## Scope', '', 'Shipping.', '', '## Acceptance', '', '- [ ] An anvil ships.', '', '## Proof', '', 'By hand.', '', '## Deliberately open', '', 'Nothing.', '', '## Next action', '', 'Ship one.', ''].join('\n'),
    'tests/acme-ships.test.mjs': "import { test } from 'node:test';\ntest('ships', () => {});\n",
  });
  const roadmap = run(process.execPath, ['scripts/roadmap.mjs'], { cwd: dir });
  assert.equal(roadmap.status, 0, roadmap.stderr + roadmap.stdout);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme: orders built, ships partial']);
  return dir;
}

/** A keel CLI stub whose loose-ends lists `items` for `repo` (or prints `raw`). */
export async function stubKeel(t, { repo = 'acme/acme', items = [], dir = '/nowhere', raw } = {}) {
  const d = await mkdtemp(join(tmpdir(), 'keel-tend-cli-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  const out = raw ?? JSON.stringify({ projects: [{ repo, dir, checkout: true, github: 'checked', items }], shown: items.length, hidden: 0 });
  await writeFile(join(d, 'keel'), `#!/bin/sh\ncat <<'KEEL_EOF'\n${out}\nKEEL_EOF\n`, { mode: 0o755 });
  return join(d, 'keel');
}

// ---- phase 37: perf, lessons and loop ------------------------------------------------

export const DISTILL = join(KEEL, 'practices/climb/files/scripts/keel/distill.mjs');

export const LOOP = join(KEEL, 'practices/loop/files/scripts/loop.mjs');

export const STITCH = join(KEEL, 'tests/fixtures/loop/stitch.mjs');

/** A benchmark that prints a line of chatter, then its number: deterministic, never timed. */
export const bench = n => `console.log('acme bench: warming up');\nconsole.log('${n}');\n`;

export const setConfig = (dir, config) => writeFile(join(dir, '.keel/keel.json'), `${JSON.stringify({ name: 'Acme', ...config }, null, 2)}\n`);

/** A synthetic Acme lessons table: four numbered rows, provenance in each shape. */
export const LESSONS_MD = ['# Lessons', '', '| # | The shape of it | What it cost | Guard |', '| --- | --- | --- | --- |',
  '| 1 | **A cache read after its source moved serves the old value.** *(acme, widgets 3)* | a day | a test that moves the source |',
  '| 2 | **A cache keyed by name serves a renamed widget\'s old value.** *(acme, widgets 5)* | an hour | to write |',
  '| 3 | **A gate that pipes its tests through tee reports tee\'s exit code.** *(acme, ci 2)* | a red main | pipefail |',
  '| 4 | **A sprocket loaded twice registers twice.** *(acme, sprockets 1)* | a week | a test that loads twice |', ''].join('\n');

export const READ_LESSONS = 'docs/lessons.md rows 1 and 2 checked';

/** A finding file as the loop practice writes one. */
export async function findingText(f) {
  const { serializeFinding } = await import(pathToFileURL(LOOP).href);
  return serializeFinding({ loop: [], loop_rank: 'P2/S1', loop_state: 'ACTIVE', decision: 'untriaged', rank: null, phase: null, project: null, lesson: null, since: null, note: null, ...f });
}

export const ALPHA = 'aaaaaaaa-1111-4000-8000-000000000001', BETA = 'bbbbbbbb-2222-4000-8000-000000000002', GAMMA = 'cccccccc-3333-4000-8000-000000000003';

export const loopInsight = (id, title) => ({ id, title, description: `${title}.`, state: 'ACTIVE', priority: 'P2', severity: 'S1', confidence: 80, references: {} });

// ---- phase 47: Codex runs climb and tend, committing to its own git dir -------------

export const TEND_WORKFLOW = join(KEEL, 'practices/climb/files/.github/workflows/keel-tend.yml');

/** The environment a workflow step sees on a runner: no pin of the test harness's on git's config. */
export const runnerEnv = env => Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([k]) => !/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k)));

/** Run one named step of a workflow's text in `dir`, as the workflow has it: { status, out }. */
export function runStep(text, dir, name, env = {}) {
  const block = runBlocks(text).find(b => b.step === name);
  assert.ok(block, `the workflow has a step "${name}"`);
  const r = run('bash', ['-e', '-c', block.script], { cwd: dir, env: runnerEnv(env) });
  return { status: r.status, out: r.stdout + r.stderr };
}

/** Git as Codex runs it: on .keel/agent-git, the checkout its work tree. */
export const agentGit = (dir, args) => git(dir, ['--git-dir=.keel/agent-git', '--work-tree=.', '-c', 'core.hooksPath=/dev/null', ...args]);

/**
 * .git read-only, as Codex's workspace-write sandbox keeps it; the returned
 * function makes it writable again (the test calls it before it ends, so the
 * temp dir can be removed; a failed test is cleaned up by t.after).
 */
export async function sandboxGit(t, dir) {
  const chmod = mode => assert.equal(run('chmod', ['-R', mode, join(dir, '.git')]).status, 0);
  chmod('a-w');
  t.after(() => { if (existsSync(join(dir, '.git'))) run('chmod', ['-R', 'u+w', join(dir, '.git')]); });
  return () => chmod('u+w');
}

/**
 * What an agent could leave in a git dir it can write, and the proof each is
 * live: hooks (core.hooksPath, and the same through include.path), an
 * fsmonitor command, aliases. Each writes a marker under `marks` when run.
 */
export async function plantHostile(t, dir) {
  const marks = await mkdtemp(join(tmpdir(), 'keel-agent-git-marks-'));
  t.after(() => rm(marks, { recursive: true, force: true }));
  const hooks = join(marks, 'hooks');
  await mkdir(hooks);
  for (const h of ['reference-transaction', 'post-checkout', 'post-index-change', 'pre-auto-gc', 'post-commit', 'pre-push']) {
    await writeFile(join(hooks, h), `#!/bin/sh\ntouch "${marks}/ran-${h}"\n`, { mode: 0o755 });
  }
  await writeFile(join(marks, 'fsmonitor'), `#!/bin/sh\ntouch "${marks}/ran-fsmonitor"\n`, { mode: 0o755 });
  await writeFile(join(marks, 'included'), `[core]\n\thooksPath = ${hooks}\n`);
  const cfg = (k, v) => git(dir, ['--git-dir=.keel/agent-git', 'config', k, v]);
  cfg('core.hooksPath', hooks);
  cfg('core.fsmonitor', join(marks, 'fsmonitor'));
  cfg('include.path', join(marks, 'included'));
  cfg('alias.bundle', `!touch ${marks}/ran-alias`);
  cfg('alias.update-ref', `!touch ${marks}/ran-alias`);
  const ran = async () => (await readdir(marks)).filter(n => n.startsWith('ran-'));
  // Live: a plain git on that dir runs them.
  const probe = run('git', ['--git-dir=.keel/agent-git', 'update-ref', 'refs/heads/acme-probe', 'HEAD'], { cwd: dir, env: runnerEnv() });
  assert.equal(probe.status, 0, probe.stderr);
  assert.ok((await ran()).length, 'the planted hooks run for a git that reads the agent\'s git dir');
  git(dir, ['--git-dir=.keel/agent-git', '-c', 'core.hooksPath=/dev/null', 'update-ref', '-d', 'refs/heads/acme-probe']);
  for (const n of await ran()) await rm(join(marks, n));
  return { ran };
}

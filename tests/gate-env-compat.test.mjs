// Exercise compatibility in the child, after the production environment filter.
// Supplying aliases explicitly bypasses the test preload's own isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ready, integrate } from '../lib/integrate.mjs';
import { gateEnv as sourceGateEnv } from '../practices/night/files/scripts/plates/lib.mjs';
import { gateEnv as shippedGateEnv } from '../scripts/plates/lib.mjs';
import { judgeRobot as shippedJudge } from '../scripts/plates/robot.mjs';
import { run } from './helpers/run.mjs';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const aliases = [
  { KEEL_AGENT_GIT: '.plates/agent-git' },
  { PLATES_AGENT_GIT: '.plates/agent-git' },
  { KEEL_AGENT_GIT: '.plates/agent-git', PLATES_AGENT_GIT: '.plates/agent-git' },
];
const check = 'node probe.mjs && node --test --test-reporter=./scripts/plates/test-ledger.mjs acme.test.mjs';
const probe = `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { agentGitArgs } from './gate-lib.mjs';
const git = args => execFileSync('git', args, {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git(['init', '--bare', '--quiet', '.plates/agent-git']);
const ordinary = git(['rev-parse', '--absolute-git-dir']);
const selected = git([...agentGitArgs(process.cwd()), 'rev-parse', '--absolute-git-dir']);
assert.equal(selected, ordinary, 'compat must not select the inherited agent Git directory');
assert.equal(process.env.KEEL_AGENT_GIT, undefined);
assert.equal(process.env.PLATES_AGENT_GIT, undefined, 'compat must not recreate the canonical override');
assert.equal(process.env.ACME_GATE_POLICY, 'configured');
appendFileSync(process.env.PROBE_LOG, ordinary + '\\n');
`;

async function project(t) {
  const dir = await mkdtemp(join(tmpdir(), 'plates-gate-env-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'project');
  await mkdir(join(root, '.plates'), { recursive: true });
  await mkdir(join(root, 'scripts/plates'), { recursive: true });
  await writeFile(join(root, '.plates/plates.json'), JSON.stringify({ name: 'Acme', check, env: { ACME_GATE_POLICY: 'configured' } }));
  await writeFile(join(root, '.gitignore'), '.plates/agent-git/\n.plates/test-runs/\n');
  await writeFile(join(root, 'probe.mjs'), probe);
  await writeFile(join(root, 'acme.test.mjs'), "import {test} from 'node:test';test('Acme executes',()=>{});\n");
  await writeFile(join(root, 'acme.txt'), 'base\n');
  await cp(resolve('scripts/plates/lib.mjs'), join(root, 'gate-lib.mjs'));
  for (const name of ['test-ledger.mjs', 'time-receipts.mjs']) await cp(resolve('scripts/plates', name), join(root, 'scripts/plates', name));
  git(root, 'init', '-q', '-b', 'main');git(root, 'add', '.');git(root, 'commit', '-qm', 'Acme base');
  const baseSha = git(root, 'rev-parse', 'HEAD');
  const origin = join(dir, 'origin.git');
  git(root, 'clone', '-q', '--bare', root, origin);git(root, 'remote', 'add', 'origin', origin);
  git(root, 'checkout', '-qb', 'claude/acme');
  await writeFile(join(root, 'acme.txt'), 'candidate\n');git(root, 'commit', '-qam', 'Acme candidate');
  const log = join(dir, 'probe.log');
  const env = override => ({ ...process.env, ...override, ACME_GATE_POLICY: 'inherited', PROBE_LOG: log });
  return { root, dir, baseSha, headSha: git(root, 'rev-parse', 'HEAD'), env, count: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).length };
}

for (const [name, gateEnv] of [['source', sourceGateEnv], ['shipped', shippedGateEnv]]) {
  test(`${name} night gate removes both inherited agent Git aliases before child compatibility`, async t => {
    const p = await project(t);
    for (const inherited of aliases) {
      const child = run(process.execPath, ['probe.mjs'], { cwd: p.root, env: gateEnv(p.env(inherited), { env: { ACME_GATE_POLICY: 'configured' } }) });
      assert.equal(child.status, 0, child.stderr);
    }
    assert.equal(await p.count(), aliases.length);
    const configured = gateEnv(p.env(aliases[2]), { env: { PLATES_AGENT_GIT: 'deliberate/canonical', KEEL_AGENT_GIT: 'deliberate/legacy' } });
    assert.equal(configured.PLATES_AGENT_GIT, 'deliberate/canonical');assert.equal(configured.KEEL_AGENT_GIT, 'deliberate/legacy');
  });
}

test('ready fast checks remove both inherited agent Git aliases before child compatibility', async t => {
  for (const inherited of aliases) {
    const p = await project(t);
    const result = await ready({ root: p.root, checks: ['node probe.mjs'] }, { env: p.env(inherited) });
    assert.equal(result.data.ok, true, result.text);assert.equal(await p.count(), 1);
  }
});

test('integrate full gate removes both inherited agent Git aliases before child compatibility', async t => {
  for (const inherited of aliases) {
    const p = await project(t);
    assert.equal((await ready({ root: p.root }, { env: p.env({}) })).data.ok, true);
    const result = await integrate({ root: p.root }, { env: p.env(inherited) });
    assert.equal(result.data.ok, true, result.text);assert.equal(await p.count(), 1);
  }
});

for (const name of ['source', 'shipped']) {
  test(`${name} robot judge removes both inherited agent Git aliases before both real gates`, async t => {
    let judge = shippedJudge;
    if (name === 'source') {
      const runtime = await mkdtemp(join(tmpdir(), 'plates-source-robot-env-'));
      t.after(() => rm(runtime, { recursive: true, force: true }));
      for (const dir of ['practices/night/files/scripts/plates', 'practices/climb/files/scripts/plates', 'practices/reconciliation/files/scripts/plates']) {
        for (const file of await readdir(dir)) if (file.endsWith('.mjs')) await cp(join(dir, file), join(runtime, file));
      }
      judge = (await import(pathToFileURL(join(runtime, 'robot.mjs')))).judgeRobot;
    }
    const p = await project(t);
    for (const inherited of aliases) {
      const result = await judge({ root: p.root, baseSha: p.baseSha, headSha: p.headSha, config: { check, env: { ACME_GATE_POLICY: 'configured' } }, env: p.env(inherited) });
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    assert.equal(await p.count(), 2 * aliases.length, 'both base and candidate gates actually executed');
  });
}

test('hermetic preload removes both inherited agent Git aliases before child compatibility', async t => {
  const p = await project(t);
  for (const inherited of aliases) {
    const child = run(process.execPath, ['--import', pathToFileURL(resolve('tests/helpers/hermetic.mjs')).href, 'probe.mjs'], { cwd: p.root, env: { ...p.env(inherited), ACME_GATE_POLICY: 'configured' } });
    assert.equal(child.status, 0, child.stderr);
  }
  assert.equal(await p.count(), aliases.length);
});

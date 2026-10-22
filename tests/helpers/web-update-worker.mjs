import { mkdtemp, mkdir, writeFile, cp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { run } from './run.mjs';
import { prepareUpdateTree } from '../../lib/web/update-worker.mjs';

export async function updateFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'acme-isolated-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, 'project'), targetRoot = join(root, 'target');
  await mkdir(join(projectRoot, '.keel'), { recursive: true });
  await writeFile(join(projectRoot, '.keel/keel.json'), JSON.stringify({ name: 'Acme', practices: ['acme'], practice: '1.0.0', check: 'acme-check' }));
  await writeFile(join(projectRoot, '.keel/lock.json'), '{"practice":"1.0.0","files":{}}');
  await writeFile(join(projectRoot, 'old.txt'), 'Acme old');
  await mkdir(join(targetRoot, 'practices'), { recursive: true });
  await mkdir(join(targetRoot, 'migrations'));
  await mkdir(join(targetRoot, 'practices/acme/files'), { recursive: true });
  await writeFile(join(targetRoot, 'practices/acme/practice.json'), JSON.stringify({ name: 'acme', summary: 'Acme practice', requires: [], files: [{ path: 'acme.txt', kind: 'seeded', from: 'acme.txt' }] }));
  await writeFile(join(targetRoot, 'practices/acme/files/acme.txt'), 'Acme seed');
  await writeFile(join(targetRoot, 'package.json'), '{"version":"1.0.1"}');
  await writeFile(join(targetRoot, 'practices/VERSION'), '1.0.1\n');
  await writeFile(join(targetRoot, 'migrations/9000-acme.mjs'), `export const id='9000-acme',to='1.0.1',summary='Acme migration';
export const applies=async p=>p.exists('generated.txt');
export const up=async p=>[{path:'new.txt',content:await p.read('generated.txt')},{path:'old.txt',content:null}];`);
  const git = (cwd, ...args) => {
    const r = run('git', args, { cwd }); if (r.status) throw Error(r.stderr); return r.stdout.trim();
  };
  for (const cwd of [projectRoot, targetRoot]) {
    git(cwd, 'init', '-q'); git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'Acme source');
  }
  const base = { repoId: 100, repositoryNodeId: 'AcmeProject', commit: git(projectRoot, 'rev-parse', 'HEAD') };
  const target = { repoId: 200, repositoryNodeId: 'AcmeTarget', repo: 'Acme/keel', commit: git(targetRoot, 'rev-parse', 'HEAD'),
    cliVersion: '1.0.1', practiceVersion: '1.0.1', bundleDigest: createHash('sha256').update(git(targetRoot, 'rev-parse', 'HEAD^{tree}')).digest('hex') };
  const preparation = { base, target, setup: 'acme-setup', check: 'acme-check', env: { ACME_FLAG: 'yes' },
    container: { image: `node@sha256:${'a'.repeat(64)}`, platform: 'linux/amd64', network: 'none' } };
  return { root, projectRoot, targetRoot, preparation, git, prepare: prepareUpdateTree };
}

export function fakeContainers({ failUpdated = false, failBaseSetup = false, mutate, loseCleanup = false } = {}) {
  const calls = [];
  return { calls, run: async input => {
    calls.push(input);
    if (loseCleanup) throw Error('container_cleanup_uncertain');
    await cp(input.source, input.destination, { recursive: true, verbatimSymlinks: true });
    const checks = {};
    for (const { key, command } of input.commands) {
      const failed = key === 'updated' && failUpdated || key === 'setup' && calls.length === 3 && failBaseSetup;
      if (key === 'setup' && !failed) await writeFile(join(input.destination, 'generated.txt'), 'Acme generated');
      checks[key] = { command, exit: failed ? 1 : 0, signal: null,
        startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', tail: '' };
      if (failed) break;
    }
    if (mutate) await mutate(input, calls.length);
    return { containerId: calls.length.toString(16).padStart(64, '0'), checks, cleanup: 'verified' };
  } };
}

export function dockerProtocol({ failCopy = false, missingTermination = false, loseCreate = false, losePause = false } = {}) {
  const calls = [], id = 'c'.repeat(64);
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    const [verb] = args;
    if (command === 'tar') return { exit: 0, signal: null, stdout: '', stderr: '' };
    if (verb === 'create' && loseCreate) throw Error('fake lost create');
    if (verb === 'pause' && losePause) throw Error('fake lost pause');
    if (verb === 'cp' && failCopy) throw Error('fake copy refused');
    let stdout = '';
    if (verb === 'create' || verb === 'inspect' && args.includes('{{.Id}}')) stdout = id;
    if (verb === 'inspect' && args.includes('{{.State.Paused}}')) stdout = 'true';
    if (verb === 'inspect' && args.includes('{{.State.Running}}')) stdout = missingTermination ? 'true' : 'false';
    return { exit: 0, signal: null, stdout, stderr: '' };
  };
  return { run, calls, id };
}

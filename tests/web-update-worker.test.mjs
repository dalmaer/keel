import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareIsolatedUpdate, runUpdateWorker, materializeUpdateSource } from '../lib/web/update-worker.mjs';
import { runUpdateContainer, validateContainerPolicy } from '../lib/web/update-container.mjs';
import { scanUpdateTree, assertUpdateTree, blobOf } from '../lib/web/update-patch.mjs';
import { validateUpdateOutput, patchDigest } from '../lib/update-artifact.mjs';
import { canonicalUpdateWorkflow } from '../lib/web/update-workflow.mjs';
import { updateFixture, fakeContainers, dockerProtocol } from './helpers/web-update-worker.mjs';

test('preparation runs setup before shared transformation, freezes exact patch and excludes generated dependency output', async t => {
  const f = await updateFixture(t), containers = fakeContainers();
  const output = await prepareIsolatedUpdate({ ...f, signal: new AbortController().signal }, { containerRun: containers.run, prepare: f.prepare });
  assert.deepEqual(containers.calls.map(c => c.commands.map(x => x.key)), [['setup'], ['updated']]);
  assert.equal(output.files.find(f => f.path === 'new.txt').after.content, Buffer.from('Acme generated').toString('base64'));
  assert.equal(output.files.find(f => f.path === 'old.txt').after, null);
  assert.equal(output.files.some(f => f.path === 'generated.txt'), false);
  assert.equal(output.checks.baseSetup, null);
  assert.equal(output.cleanup.containerIds.length, 2);
  assert.equal(validateUpdateOutput(output).schema, 1);
  assert.equal(patchDigest(output), patchDigest(structuredClone(output)));
});

test('failed updated check gets pristine base setup/check; failed base setup is not a fabricated check', async t => {
  for (const failBaseSetup of [false, true]) {
    const f = await updateFixture(t), containers = fakeContainers({ failUpdated: true, failBaseSetup });
    const output = await prepareIsolatedUpdate({ ...f, signal: new AbortController().signal }, { containerRun: containers.run, prepare: f.prepare });
    assert.equal(output.checks.updated.exit, 1);
    assert.equal(output.checks.baseSetup.exit, failBaseSetup ? 1 : 0);
    assert.equal(output.checks.base?.exit ?? null, failBaseSetup ? null : 0);
    assert.equal(output.cleanup.containerIds.length, 3);
    assert.notEqual(containers.calls[2].source, containers.calls[1].source);
  }
});

test('setup and check tracked mutations, removed-file recreation and unsafe generated links refuse output', async t => {
  for (const kind of ['setup', 'check', 'recreate', 'escape']) {
    const f = await updateFixture(t), containers = fakeContainers({ mutate: async (input, count) => {
      if (kind === 'setup' && count === 1) await writeFile(join(input.destination, 'old.txt'), 'changed');
      if (kind === 'check' && count === 2) await writeFile(join(input.destination, 'new.txt'), 'changed');
      if (kind === 'recreate' && count === 2) await writeFile(join(input.destination, 'old.txt'), 'restored');
      if (kind === 'escape' && count === 1) await symlink('/tmp', join(input.destination, 'outside'));
    } });
    await assert.rejects(prepareIsolatedUpdate({ ...f, signal: new AbortController().signal }, { containerRun: containers.run, prepare: f.prepare }), /tracked|symlink|restored_deleted_path/, kind);
  }
  assert.doesNotThrow(() => assertUpdateTree(new Map([['removed', null]]), new Map()));
  assert.throws(() => assertUpdateTree(new Map([['removed', null]]), new Map([['removed', {}]])), /restored/);
});

test('dirty trusted target, unsafe source shape and incomplete export-ignore archives are refused', async t => {
  const f = await updateFixture(t), containers = fakeContainers();
  await writeFile(join(f.targetRoot, 'untracked.mjs'), 'Acme dirty runtime');
  await assert.rejects(prepareIsolatedUpdate({ ...f, signal: new AbortController().signal }, { containerRun: containers.run, prepare: f.prepare }), /target_changed/);
  assert.equal(containers.calls.length, 0);
  await rm(join(f.targetRoot, 'untracked.mjs'));
  await writeFile(join(f.targetRoot, '.git/info/exclude'), 'ignored.mjs\n');
  await writeFile(join(f.targetRoot, 'ignored.mjs'), 'Acme ignored runtime');
  await assert.rejects(prepareIsolatedUpdate({ ...f, signal: new AbortController().signal }, { containerRun: containers.run, prepare: f.prepare }), /target_changed/);
  await rm(join(f.targetRoot, 'ignored.mjs'));
  await writeFile(join(f.targetRoot, 'package.json'), '{"version":"1.0.1","dirty":true}');
  await assert.rejects(prepareIsolatedUpdate({ ...f, signal: new AbortController().signal }, { containerRun: containers.run, prepare: f.prepare }), /target_changed/);
  assert.equal(containers.calls.length, 0);
  await writeFile(join(f.projectRoot, '.gitattributes'), 'old.txt export-ignore\n');
  f.git(f.projectRoot, 'add', '.'); f.git(f.projectRoot, 'commit', '-qm', 'Acme archive exclusion');
  await assert.rejects(materializeUpdateSource(f.projectRoot, f.git(f.projectRoot, 'rev-parse', 'HEAD'), join(f.root, 'exported'), new AbortController().signal), /incomplete/);
});

test('container protocol freezes snapshot before stop, verifies removal, and enforces fixed isolation flags', async t => {
  const f = await updateFixture(t), protocol = dockerProtocol();
  const result = await runUpdateContainer({ source: f.projectRoot, destination: join(f.root, 'out'), container: f.preparation.container,
    commands: [{ key: 'updated', command: 'acme-check' }], expected: new Map([['old.txt', { mode: '100644', blob: blobOf(Buffer.from('Acme old')) }]]), signal: new AbortController().signal }, { run: protocol.run });
  assert.equal(result.cleanup, 'verified');
  const verbs = protocol.calls.filter(c => c.command === 'docker').map(c => c.args[0]);
  assert.ok(verbs.indexOf('pause') < verbs.indexOf('cp'));
  assert.ok(verbs.indexOf('cp') < verbs.indexOf('kill'));
  assert.ok(verbs.indexOf('rm') < verbs.lastIndexOf('ps'));
  const args = protocol.calls.find(c => c.args[0] === 'create').args;
  for (const flag of ['--read-only', '--cap-drop', '--security-opt', '--pids-limit', '--cpus', '--memory', '--memory-swap', '--tmpfs']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--user') + 1], '1000:1000');
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.equal(args.includes('--mount'), false); assert.equal(args.includes('-v'), false);
  assert.equal(args.includes('--privileged'), false);
  const verifier = protocol.calls.find(c => c.args.includes('/usr/local/bin/node'));
  assert.ok(verifier); assert.ok(verifier.args.includes('--input-type=module'));
  const cleanups = protocol.calls.filter(c => ['unpause', 'kill', 'rm', 'ps'].includes(c.args[0]));
  assert.ok(cleanups.every(c => c.options.signal === cleanups[0].options.signal));
});

test('lost create and paused copy failures still reconcile/stop/remove exact container; unknown termination refuses', async t => {
  const f = await updateFixture(t);
  for (const failure of [{ loseCreate: true }, { failCopy: true }, { losePause: true }, { missingTermination: true }]) {
    const protocol = dockerProtocol(failure);
    await assert.rejects(runUpdateContainer({ source: f.projectRoot, destination: join(f.root, 'out'), container: f.preparation.container,
      commands: [{ key: 'updated', command: 'acme-check' }], signal: new AbortController().signal }, { run: protocol.run }));
    assert.ok(protocol.calls.some(c => c.args[0] === 'kill'));
    if (!failure.missingTermination) assert.ok(protocol.calls.some(c => c.args[0] === 'rm'));
    if (failure.failCopy || failure.losePause) assert.ok(protocol.calls.some(c => c.args[0] === 'unpause'));
    assert.equal(protocol.calls.filter(c => c.args[0] === 'create').length, 1);
  }
});

test('container policy rejects mutable image, host network and control environment injection', () => {
  const policy = { image: `node@sha256:${'a'.repeat(64)}`, platform: 'linux/amd64', network: 'none' };
  assert.throws(() => validateContainerPolicy({ ...policy, image: 'node:latest' }));
  assert.throws(() => validateContainerPolicy({ ...policy, network: 'host' }));
  for (const key of ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'LD_PRELOAD', 'DOCKER_HOST', 'API_KEY'])
    assert.throws(() => validateContainerPolicy(policy, { [key]: 'fake-acme' }), key);
});

test('artifact validation enforces decoded byte bounds, exact schema, modes, private provenance and deletion shapes', async t => {
  const f = await updateFixture(t), containers = fakeContainers();
  const output = await prepareIsolatedUpdate({ ...f, signal: new AbortController().signal }, { containerRun: containers.run, prepare: f.prepare });
  for (const change of [
    { files: [{ path: '../escape', before: null, after: { mode: '100644', content: '' } }] },
    { files: [{ path: 'large', before: null, after: { mode: '100644', content: Buffer.alloc(262145).toString('base64') } }] },
    { files: [{ path: 'link', before: null, after: { mode: '120000', content: Buffer.from('/tmp').toString('base64') } }] },
    { files: [output.files[0], output.files[0]] },
    { files: ['a', 'a/b'].map(path => ({ path, before: null, after: { mode: '100644', content: '' } })) },
    { files: [{ path: 'noop', before: { mode: '100644', blob: blobOf(Buffer.from('Acme')) }, after: { mode: '100644', content: Buffer.from('Acme').toString('base64') } }] }, { cleanup: { state: 'unknown', containerIds: [] } },
    { coverage: { complete: false, gaps: [] } }, { checks: { ...output.checks, baseSetup: undefined } },
  ]) assert.throws(() => validateUpdateOutput({ ...output, ...change }));
});

test('update worker never prepares after uncertain begin and never repeats output after lost response', async t => {
  const f = await updateFixture(t), containers = fakeContainers();
  const output = await prepareIsolatedUpdate({ ...f, signal: new AbortController().signal }, { containerRun: containers.run, prepare: f.prepare });
  for (const failure of ['begin', 'update-output', null]) {
    const calls = [], deadline = Date.now() + 60000;
    const claim = { adapter: 'update-preparation-v1', fence: 1, jobId: 20, deadline, leaseExpiresAt: deadline,
      checkoutSha: f.preparation.base.commit, workflowSha: 'd'.repeat(40), preparation: f.preparation };
    let prepared = 0;
    const result = await runUpdateWorker({ origin: 'https://acme.example', operationId: 'e'.repeat(64), runAttempt: '1',
      sha: claim.checkoutSha, workflowSha: claim.workflowSha, projectRoot: f.projectRoot, targetRoot: f.targetRoot }, {
      transport: async (stage, body) => {
        calls.push({ stage, body }); if (stage === failure) throw Error('fake lost response');
        if (stage === 'claim') return claim;
        if (stage === 'begin') return { ...claim, granted: true };
        if (stage === 'update-output') return { accepted: true, digest: patchDigest(output) };
        return { accepted: true };
      }, prepare: async () => { prepared++; return output; },
    });
    assert.equal(prepared, failure === 'begin' ? 0 : 1);
    assert.equal(calls.filter(c => c.stage === 'begin').length, 1);
    assert.equal(calls.filter(c => c.stage === 'update-output').length, failure === 'begin' ? 0 : 1);
    assert.equal(result.state, failure ? 'failed' : 'succeeded');
  }
});

test('canonical update workflow pins executable source literally and keeps project commands out of host steps', async t => {
  const f = await updateFixture(t), source = canonicalUpdateWorkflow(f.preparation.target);
  assert.ok(source.includes(`repository: ${f.preparation.target.repo}`));
  assert.ok(source.includes(`ref: ${f.preparation.target.commit}`));
  assert.match(source, /timeout-minutes: 60/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /run: node trusted-keel\/scripts\/web-update-worker.mjs/);
  assert.doesNotMatch(source, /run: npm|secrets\.|cron:|vars.*(?:REPOSITORY|REVISION)/);
  assert.match(await readFile(new URL('../.github/workflows/web-update.yml', import.meta.url), 'utf8'), /if: \$\{\{ false \}\}/);
});

test('update worker enforces monotonic deadline despite wall-clock rollback and stops on lost heartbeat authority', async t => {
  const f = await updateFixture(t);
  for (const rollback of [true, false]) {
    const wall = Date.now(); let clock = wall, elapsed = 0, prepared = 0;
    const calls = [], claim = { adapter: 'update-preparation-v1', fence: 1, jobId: 20, deadline: wall + 60000,
      leaseExpiresAt: wall + 60000, checkoutSha: f.preparation.base.commit, workflowSha: 'd'.repeat(40), preparation: f.preparation };
    const result = await runUpdateWorker({ origin: 'https://acme.example', operationId: 'e'.repeat(64), runAttempt: '1',
      sha: claim.checkoutSha, workflowSha: claim.workflowSha, projectRoot: f.projectRoot, targetRoot: f.targetRoot }, {
      now: () => clock, monotonic: () => elapsed, heartbeatMs: 1,
      transport: async stage => {
        calls.push(stage);
        if (stage === 'claim') return claim;
        if (stage === 'begin') {
          if (rollback) { clock -= 3600000; elapsed = 60000; }
          return { ...claim, granted: true };
        }
        if (stage === 'heartbeat') return { continue: false };
        throw Error('unexpected effect');
      }, prepare: async ({ signal }) => {
        prepared++;
        await new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true });
          if (signal.aborted) reject(Error('cancelled'));
        });
      },
    });
    assert.equal(result.state, 'cancelled');
    assert.equal(prepared, rollback ? 0 : 1);
    assert.equal(calls.includes('update-output'), false);
    assert.equal(calls.includes('complete'), false);
  }
});

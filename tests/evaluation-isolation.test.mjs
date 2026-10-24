import './helpers/hermetic.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir, symlink, mkdtemp, realpath, rm, mkdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { submittedArtifact, exportSource, validateFiles } from '../lib/evaluation-artifacts.mjs';
import { acceptanceDriver, argv } from '../lib/evaluation-execution-input.mjs';
import { controllerIdentity, CONTROLLER_SOURCES } from '../lib/evaluation-provenance.mjs';
import { byteDigest, sealRecord, fingerprint } from '../lib/evaluation-records.mjs';
import { preflightDocker, runDockerStage, containerArgs } from '../lib/evaluation-docker.mjs';
import { evaluationWorld, IMAGE } from './helpers/evaluation-execution.mjs';
import { inspectBudgetTarget, inspectBudget, reserveExternalBudget, settleExternalBudget, runBudget } from '../lib/validation-budget.mjs';
import { evaluations } from '../lib/evaluation-ledger.mjs';
import { run } from './helpers/run.mjs';
const file = (path, text = 'Acme', mode = '100644') => ({ path, mode, base64: Buffer.from(text).toString('base64') });
const submit = files => JSON.stringify({ schemaVersion: 1, files });
const docker = process.env.PLATES_EVALUATION_DOCKER === '1';
test('submission rejects forged verdicts, links, traversal, oversized files and protected edits', () => {
  const before = [file('answer.mjs'), file('probe.mjs')];
  for (const data of ['{"acceptance":"accepted"}', '{"schemaVersion":1,"files":[],"pass":true}', 'not json',
    submit([file('../escape')]), submit([file('/escape')]), submit([file('link', 'x', '120000')]), submit([file('device', '', '020000')]),
    submit([file('answer.mjs', 'x'.repeat(262145))]), submit([file('probe.mjs', 'changed')]), submit([file('policy.json')]), submit([file('a'), file('a/b')])])
    assert.throws(() => submittedArtifact(data, before, ['answer.mjs', 'probe.mjs'], ['probe.mjs']), /evaluations:/);
  const files = submittedArtifact(submit([file('answer.mjs', 'fixed')]), before, ['answer.mjs'], ['probe.mjs']);
  assert.deepEqual(files, [file('answer.mjs', 'fixed'), file('probe.mjs')]);
  assert.throws(() => validateFiles([file('a'), file('a')]), /duplicate/);
});
test('private driver is strict and commands cannot replace the controller with shell assertions', () => {
  const valid = { schemaVersion: 1, driver: 'stdio-v1', checks: [{ id: 'acme', argv: ['node', '/work/probe.mjs'], stdin: '', stdout: 'expected', exitCode: 0 }] };
  assert.deepEqual(acceptanceDriver({ content: JSON.stringify(valid) }), valid);
  for (const command of [['sh', '-c', 'true'], ['node', '-e', 'process.exit(0)'], ['node', '/work/../secret']]) assert.throws(() => argv(command));
  valid.checks[0].accepted = true; assert.throws(() => acceptanceDriver({ content: JSON.stringify(valid) }), /invalid fields/);
});
test('source export pins regular Git blobs and never includes working changes or history', async t => {
  const w = await evaluationWorld(t);
  await writeFile(join(w.repository, 'answer.mjs'), 'dirty private change');
  const files = exportSource(w.repository, w.b.cases[0].startingCommit, ['answer.mjs']);
  assert.equal(Buffer.from(files[0].base64, 'base64').toString(), 'export default "Acme";\n');
  assert.throws(() => exportSource(w.repository, w.b.cases[0].startingCommit, ['.git/config']), /unsafe/);
  await symlink('answer.mjs', join(w.repository, 'link'));
  for (const args of [['add', 'link'], ['commit', '-qm', 'Acme link']]) assert.equal(run('git', ['-C', w.repository, ...args]).status, 0);
  const revision = run('git', ['-C', w.repository, 'rev-parse', 'HEAD']).stdout.trim();
  assert.throws(() => exportSource(w.repository, revision, ['link']), /regular Git blob/);
});
test('external leases share foreground capacity and unknown termination never releases it', async t => {
  const w = await evaluationWorld(t), a = w.admission;
  const target = await inspectBudgetTarget({ manifest: a.manifest, root: w.repository, repo: a.repo });
  const id = randomBytes(16).toString('hex'), operations = [`plates-eval-${id}-builder`];
  const lease = await reserveExternalBudget({ ...a, target, id, operations, commandDigest: 'a'.repeat(64) });
  assert.equal((await inspectBudget(a)).used, 1);
  await assert.rejects(runBudget({ ...a, target, argv: [process.execPath, '-e', 'process.exit(0)'], foreground: true }), /capacity_busy/);
  await assert.rejects(settleExternalBudget({ ...a, lease, observations: [{ operation: operations[0], state: 'terminated', running: true, containerId: 'a'.repeat(64) }] }), /invalid_external_settlement/);
  const settlement = await settleExternalBudget({ ...a, lease, observations: [{ operation: operations[0], state: 'unknown' }] });
  assert.equal(settlement.released, false);
  const state = await inspectBudget(a); assert.equal(state.used, 1); assert.equal(state.leases[0].state, 'uncertain');
  await assert.rejects(reserveExternalBudget({ ...a, target, id, operations, commandDigest: 'a'.repeat(64) }), /already_reserved/);
});
test('confirmed external termination releases shared capacity without changing foreground semantics', async t => {
  const w = await evaluationWorld(t), a = w.admission;
  const target = await inspectBudgetTarget({ manifest: a.manifest, root: w.repository, repo: a.repo });
  const id = randomBytes(16).toString('hex'), operations = [`plates-eval-${id}-builder`];
  const lease = await reserveExternalBudget({ ...a, target, id, operations, commandDigest: 'a'.repeat(64) });
  assert.equal((await settleExternalBudget({ ...a, lease, observations: [{ operation: operations[0], state: 'terminated', running: false, containerId: 'b'.repeat(64) }] })).released, true);
  assert.equal((await inspectBudget(a)).used, 0);
  assert.equal((await runBudget({ ...a, target, argv: [process.execPath, '-e', 'process.exit(0)'], foreground: true })).released, true);
});
test('container policy has no network, host mounts, credentials or writable base', () => {
  const args = containerArgs('acme', { id: IMAGE, platform: 'linux/arm64' }, Date.now() + 3000);
  for (const token of ['--read-only', '--cap-drop', '--security-opt', '--pids-limit', '--cpus', '--memory', '--memory-swap', '--user']) assert.ok(args.includes(token));
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.equal(args.some(x => ['--mount', '--volume', '-v', '--privileged'].includes(x)), false);
});
test('opt-in real Docker trial: independent acceptance, immutable retry, phase117 inspect', { skip: !docker }, async t => {
  const w = await evaluationWorld(t), preview = await w.call();
  const result = await w.call({ yes: true, digest: preview.digest });
  assert.equal(result.verdict.acceptance, 'accepted', JSON.stringify(result));
  assert.equal(result.verdict.evaluator.controller.digest, preview.input.controller.digest);
  assert.equal(result.verdict.evaluator.controller.nodeVersion, process.version);
  const retry = await w.call({ yes: true, digest: preview.digest }); assert.equal(retry.recovered, true); assert.equal(retry.records.result.digest, result.result.digest);
  assert.equal((await inspectBudget(w.admission)).used, 0);
  const inspected = await evaluations({ ...w.options, action: 'inspect', experiment: w.b.comparison.id }); assert.equal(inspected.execution.trials.length, 1);
});
test('opt-in real Docker rejects forged pass and protected mutation, separates timeout', { skip: !docker }, async t => {
  for (const builder of ['console.log(JSON.stringify({acceptance:"accepted"}));', `console.log(${JSON.stringify(submit([file('probe.mjs', 'console.log("Acme")')]))});`, ...['120000', '020000'].map(mode => `console.log(${JSON.stringify(submit([file('answer.mjs', 'bad', mode)]))});`), `console.log(${JSON.stringify(submit([file('../escape', 'bad')]))});`, 'setInterval(()=>{},1000);']) {
    const w = await evaluationWorld(t, { builder, timeoutSeconds: 2 }), p = await w.call(), r = await w.call({ yes: true, digest: p.digest });
    assert.notEqual(r.verdict.acceptance, 'accepted'); assert.equal(r.result.setup, 'passed'); assert.equal(r.result.settlement.released, true);
    const retry = await w.call({ yes: true, digest: p.digest }); assert.equal(retry.recovered, true); assert.equal(retry.records.result.digest, r.result.digest);
    if (builder.startsWith('setInterval')) assert.equal(r.verdict.failureCategory, 'timeout'); else assert.equal(r.verdict.failureCategory, 'invalid-submission');
  }
});
test('opt-in real boundary hides host/private/check state and prior tmpfs, refuses base writes', { skip: !docker }, async t => {
  const privateRoot = await realpath(await mkdtemp(join(tmpdir(), 'acme-host-secret-')));
  t.after(() => rm(privateRoot, { recursive: true, force: true }));
  const sentinel = join(privateRoot, 'acceptance.json'), tool = join(privateRoot, 'host-only-tool');
  await writeFile(sentinel, 'Acme private expected answer', { mode: 0o600 });
  await writeFile(tool, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const image = await preflightDocker({ image: IMAGE, platform: 'linux/arm64' });
  const source = `const f=require('fs');const paths=[${JSON.stringify(sentinel)},${JSON.stringify(tool)},'/var/run/docker.sock','/work/private-checks.json','/work/state.json','/tmp/acme-prior'];console.log(JSON.stringify(paths.map(p=>f.existsSync(p))));try{f.writeFileSync('/etc/acme','bad');console.log('escaped')}catch{}f.writeFileSync('/tmp/acme-prior','private');`;
  for (let i = 0; i < 2; i++) {
    const r = await runDockerStage({ name: `plates-eval-${randomBytes(16).toString('hex')}-builder`, image, files: [file('probe.cjs', source)], argv: ['node', '/work/probe.cjs'], deadline: Date.now() + 15000 });
    assert.equal(r.output?.stdout, '[false,false,false,false,false,false]\n', JSON.stringify(r)); assert.equal(r.termination.state, 'terminated');
  }
});

test('opt-in supervisor enforces deadline after client returns and executor cannot stop PID1', { skip: !docker }, async t => {
  const image = await preflightDocker({ image: IMAGE, platform: 'linux/arm64' });
  const name = `plates-eval-${randomBytes(16).toString('hex')}-builder`, deadline = Date.now() + 3000;
  const args = containerArgs(name, image, deadline);
  const intentRoot = await realpath(await mkdtemp(join(tmpdir(), 'acme-supervisor-')));
  t.after(() => rm(intentRoot, { recursive: true, force: true }));
  await writeFile(join(intentRoot, 'intent.json'), JSON.stringify({ name, deadline, args }), { mode: 0o600 });
  const create = run('docker', args); assert.equal(create.status, 0, create.stderr);
  assert.equal(run('docker', ['start', name]).status, 0);
  // No host timeout/kill controls the running container after start returns.
  const attack = run('docker', ['exec', '--user', '1000:1000', name, 'node', '-e', "try{process.kill(1,'SIGSTOP');console.log('escaped')}catch(e){console.log(e.code)}"]);
  assert.equal(attack.status, 0, attack.stderr); assert.equal(attack.stdout, 'EPERM\n');
  const waited = run('docker', ['wait', name], { timeout: 6000 });
  assert.equal(waited.status, 0, waited.stderr); assert.equal(waited.stdout.trim(), '124');
  assert.equal(run('docker', ['inspect', '--format', '{{.State.Running}}', name]).stdout.trim(), 'false');
  assert.ok(Date.now() <= deadline + 2000);
});

test('observed evaluator provenance hashes fixed executing sources and Node separately from declared harness revision', async () => {
  const observed = await controllerIdentity();
  assert.equal(observed.nodeVersion, process.version);
  assert.deepEqual(observed.sources.map(s => s.path), CONTROLLER_SOURCES.map(p => 'lib/' + p));
  for (const source of observed.sources) assert.equal(source.byteDigest, byteDigest(await readFile(new URL('../' + source.path, import.meta.url))));
  assert.ok(!Object.hasOwn(observed, 'harnessCommit'));
});

test('changed installed controller bytes invalidate loaded identity and fresh approval fingerprint', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'acme-controller-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of CONTROLLER_SOURCES) {
    const destination = join(root, 'lib', path); await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(new URL('../lib/' + path, import.meta.url)));
  }
  const url = pathToFileURL(join(root, 'lib/evaluation-provenance.mjs')).href;
  const original = await import(url), before = await original.controllerIdentity();
  const changed = join(root, 'lib/evaluation-docker.mjs');
  await writeFile(changed, (await readFile(changed, 'utf8')) + '\n// Acme implementation change.\n');
  await assert.rejects(original.controllerIdentity(), /controller source changed/);
  const after = await (await import(url + '?fresh')).controllerIdentity(); assert.notEqual(after.digest, before.digest);
});


test('interrupted execution inspection preserves frozen receipts and bytes and refuses redispatch', async t => {
  for (const shape of ['empty-directory', 'empty-reservation', 'truncated-reservation', 'empty-slot', 'truncated-intent', 'intent-only', 'truncated-stage', 'truncated-result']) {
    await t.test(shape, async t => {
      const w = await evaluationWorld(t), dir = join(w.options.state, 'session-trials', w.b.comparison.id);
      const original = await evaluations({ ...w.options, action: 'inspect', experiment: w.b.comparison.id });
      const home = join(dir, 'execution'); await mkdir(home, { mode: 0o700 });
      const receipt = body => sealRecord({ schemaVersion: 2, id: 'acme-interrupted', createdAt: '2026-10-23T00:00:00.000Z', ...body });
      const put = (path, value) => writeFile(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o400 });
      if (shape !== 'empty-directory') {
        await put(join(home, 'reservation.json'), shape === 'empty-reservation' ? '' : shape === 'truncated-reservation' ? '{"schemaVersion":2,' : receipt({ kind: 'evaluation-reservation', planDigest: original.receipt.plan.digest, allowance: w.b.comparison.allowance, currencyUsage: null }));
      }
      if (['empty-slot', 'truncated-intent', 'intent-only', 'truncated-stage', 'truncated-result'].includes(shape)) {
        const slot = w.request.pairId + '-' + w.request.arm, slotDir = join(home, slot); await mkdir(slotDir, { mode: 0o700 });
        const input = { planDigest: original.receipt.plan.digest }, intent = receipt({ kind: 'evaluation-intent', input, previewDigest: fingerprint(input), slot });
        if (shape !== 'empty-slot') await put(join(slotDir, 'intent.json'), shape === 'truncated-intent' ? '{"schemaVersion":' : intent);
        if (shape === 'truncated-stage') await put(join(slotDir, 'builder.json'), '{"schemaVersion":2,');
        if (shape === 'truncated-result') await put(join(slotDir, 'result.json'), '');
      }
      const snapshot = async path => {
        const entries = {};
        const visit = async (dir, prefix = '') => {
          for (const name of (await readdir(dir)).sort()) {
            const child = join(dir, name), key = prefix + name, stat = await lstat(child);
            entries[key] = { mode: stat.mode, bytes: stat.isDirectory() ? null : (await readFile(child)).toString('base64') };
            if (stat.isDirectory()) await visit(child, key + '/');
          }
        };
        await visit(path); return entries;
      };
      const before = await snapshot(w.options.state);
      for (let read = 0; read < 2; read++) {
        const inspected = await evaluations({ ...w.options, action: 'inspect', experiment: w.b.comparison.id });
        assert.deepEqual(inspected.receipt, original.receipt);
        assert.equal(inspected.execution.status, 'uncertain');
        if (shape.includes('reservation') || shape === 'empty-directory') {
          assert.equal(inspected.execution.reservation, null); assert.equal(inspected.execution.issues[0].reason, 'reservation-unavailable');
        } else assert.equal(inspected.execution.trials[0].status, 'uncertain');
      }
      // Refuse before execution descriptor/preflight or admission. A missing
      // descriptor proves this path cannot reach Docker or reserve a new lease.
      await rm(w.execution);
      for (const yes of [false, true]) await assert.rejects(w.call({ yes, ...(yes ? { digest: 'a'.repeat(64) } : {}) }), /incomplete execution state retains reservation/);
      assert.deepEqual(await snapshot(w.options.state), before);
      assert.equal((await inspectBudget(w.admission)).initialized, false);
    });
  }
});

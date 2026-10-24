import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ledgerLock, inspectHarnessLock } from '../lib/session-ledger-io.mjs';
import { reserveExternalBudget, inspectBudgetTarget, inspectBudget, reconcileExternalBudget } from '../lib/validation-budget.mjs';
import { storeImmutable } from '../lib/session-ledger-io.mjs';
import { evaluations } from '../lib/evaluation-ledger.mjs';
import { evaluationWorld, evaluationController } from './helpers/evaluation-execution.mjs';
import { sealRecord, fingerprint } from '../lib/evaluation-records.mjs';
import { admittedDeadline } from '../lib/evaluation-execution-input.mjs';
import { preflightDocker } from '../lib/evaluation-docker.mjs';
import { exportSource } from '../lib/evaluation-artifacts.mjs';
import { inspectExecutions, unauthorizedStage } from '../lib/evaluation-execution.mjs';

async function home(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'acme-harness-lock-')));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
test('SIGKILL writer recovery preserves bytes and fences two recoverers', async t => {
  const dir = await home(t), url = new URL('../lib/session-ledger-io.mjs', import.meta.url).href;
  const child = evaluationController(`import {ledgerLock} from ${JSON.stringify(url)}; await ledgerLock(${JSON.stringify(dir)},{harness:true}); console.log('ready'); setInterval(()=>{},1000);`);
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  const active = await inspectHarnessLock(dir);
  assert.equal(active.status, 'active-or-unverifiable');
  await assert.rejects(ledgerLock(dir, { harness: true, recover: active }), /death unverified/);
  const original = await readFile(join(dir, '.lock'));
  const done = once(child, 'exit'); child.kill('SIGKILL'); await done;
  const dead = await inspectHarnessLock(dir); assert.equal(dead.status, 'recoverable');
  const attempts = await Promise.allSettled([ledgerLock(dir, { harness: true, recover: dead }), ledgerLock(dir, { harness: true, recover: dead })]);
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
  assert.deepEqual(await readFile(join(dir, '.harness-recovered-' + dead.owner.id)), original);
  await attempts.find(a => a.status === 'fulfilled').value();
  assert.equal(await inspectHarnessLock(dir), null);
  const replacement = await ledgerLock(dir, { harness: true });
  await assert.rejects(ledgerLock(dir, { harness: true, recover: dead }), /changed|death unverified/);
  await replacement();
});
test('legacy empty and partial locks never acquire recovery authority; handoff stays compatible', async t => {
  const dir = await home(t);
  const release = await ledgerLock(dir);
  assert.equal((await inspectHarnessLock(dir)).status, 'blocked');
  await assert.rejects(ledgerLock(dir, { harness: true }), /locked/);
  await release();
  await writeFile(join(dir, '.lock'), '{', { mode: 0o600 });
  assert.equal((await inspectHarnessLock(dir)).status, 'blocked');
  await assert.rejects(ledgerLock(dir, { harness: true, recover: await inspectHarnessLock(dir) }), /death unverified/);
});
test('compare retains malformed execution uncertainty and refuses mutation options', async t => {
  const world = await evaluationWorld(t);
  const dir = join(world.options.state, 'session-trials', world.b.comparison.id);
  const original = await readFile(join(dir, 'state.json'));
  await mkdir(join(dir, 'execution'), { mode: 0o700 });
  await writeFile(join(dir, 'execution', 'reservation.json'), '{', { mode: 0o400 });
  const result = await evaluations({ ...world.options, action: 'compare', experiment: world.b.comparison.id });
  assert.equal(result.preview, false);
  const execution = await inspectExecutions(dir, { digest: 'unused' });
  assert.equal(execution.status, 'uncertain'); assert.ok(execution.issues.length);
  await assert.rejects(evaluations({ ...world.options, action: 'resume', experiment: world.b.comparison.id, execution: world.execution }), /uncertain/);
  await assert.rejects(evaluations({ ...world.options, action: 'compare', experiment: world.b.comparison.id, yes: true }), /read-only/);
  assert.deepEqual(await readFile(join(dir, 'state.json')), original);
});
test('reconcile previews and rejects stale approval without modifying frozen receipt', async t => {
  const world = await evaluationWorld(t);
  const options = { ...world.options, action: 'reconcile', experiment: world.b.comparison.id };
  const preview = await evaluations(options);
  assert.equal(preview.preview, true); assert.equal(preview.input.lock, null);
  await assert.rejects(evaluations({ ...options, yes: true, digest: '0'.repeat(64) }), /stale/);
});

async function reservedSlot(t, { truncated = false } = {}) {
  const world = await evaluationWorld(t);
  const dir = join(world.options.state, 'session-trials', world.b.comparison.id);
  const ledger = JSON.parse(await readFile(join(dir, 'state.json'))), plan = ledger.plan;
  const home = join(dir, 'execution'); await mkdir(home, { mode: 0o700 });
  const record = (kind, id, body) => sealRecord({ schemaVersion: 2, kind, id, createdAt: new Date().toISOString(), ...body });
  await storeImmutable(join(home, 'reservation.json'), record('evaluation-reservation', world.b.comparison.id, { planDigest: plan.digest, allowance: world.b.comparison.allowance, currencyUsage: null }));
  const id = 'a'.repeat(32), slot = world.request.pairId + '-baseline', path = join(home, slot); await mkdir(path, { mode: 0o700 });
  const input = { request: world.request, planDigest: plan.digest, taskDigest: world.b.cases[0].digest,
    configurationDigest: world.b.configurations[0].digest, checkManifestDigest: world.b.cases[0].acceptanceManifest.digest,
    sourceDigest: 'b'.repeat(64), image: { id: world.b.cases[0].environment.image }, controller: { digest: 'a'.repeat(64) } };
  const operations = [`plates-eval-${id}-builder`, `plates-eval-${id}-check-0`];
  const intent = record('evaluation-intent', id, { slot, input, previewDigest: fingerprint(input), operations,
    dispatchProtocol: 'ordered-authorization-v1', attempt: 1, parentAttemptId: null, reservedMinutes: 2, interventions: [], repairRounds: 0 });
  await storeImmutable(join(path, 'intent.json'), intent);
  const target = await inspectBudgetTarget({ manifest: world.managed, root: world.repository, repo: 'Acme/widget' });
  const lease = await reserveExternalBudget({ ...world.admission, target, id, commandDigest: intent.previewDigest, operations });
  await storeImmutable(join(path, 'lease.json'), record('evaluation-lease', id, { intentDigest: intent.digest, lease }));
  if (truncated) await writeFile(join(path, 'dispatch-builder.json'), '{', { mode: 0o400 });
  return { ...world, dir, path, plan, intent };
}
test('fenced never-authorized stages settle unknown once, retain receipts and consume recovery allowance', async t => {
  const w = await reservedSlot(t), options = { ...w.options, action: 'reconcile', experiment: w.b.comparison.id };
  const before = await readFile(join(w.path, 'intent.json'));
  const preview = await evaluations(options), result = await evaluations({ ...options, yes: true, digest: preview.digest });
  assert.equal(result.execution.trials[0].status, 'terminal');
  assert.equal(result.execution.trials[0].recovery.verdict.acceptance, 'unknown');
  assert.equal(result.execution.trials[0].records.result, undefined);
  assert.deepEqual(await readFile(join(w.path, 'intent.json')), before);
  assert.equal((await inspectBudget({ stateDir: w.admission.stateDir, capacity: 1 })).used, 0);
  const repeated = await evaluations({ ...options, yes: true, digest: preview.digest });
  assert.equal(repeated.recovered, true);
  assert.equal((await inspectBudget({ stateDir: w.admission.stateDir, capacity: 1 })).history.length, 1);
  await assert.rejects(evaluations(options), /allowance exhausted/);
  await assert.rejects(evaluations({ ...options, yes: true, digest: 'f'.repeat(64) }), /allowance exhausted/);
});
test('partial dispatch authorization stays uncertain, cannot be hidden by reconciliation and retains bytes', async t => {
  const w = await reservedSlot(t, { truncated: true });
  const options = { ...w.options, action: 'reconcile', experiment: w.b.comparison.id };
  const preview = await evaluations(options), result = await evaluations({ ...options, yes: true, digest: preview.digest });
  assert.equal(result.execution.status, 'uncertain');
  assert.equal(result.execution.trials[0].status, 'uncertain');
  assert.equal(await readFile(join(w.path, 'dispatch-builder.json'), 'utf8'), '{');
  assert.equal((await inspectBudget({ stateDir: w.admission.stateDir, capacity: 1 })).used, 1);
  await assert.rejects(evaluations({ ...w.options, action: 'resume', experiment: w.b.comparison.id, execution: w.execution }), /uncertain/);
});
test('cancel closes admission without converting malformed observations into terminal evidence', async t => {
  const w = await reservedSlot(t, { truncated: true });
  const options = { ...w.options, action: 'cancel', experiment: w.b.comparison.id };
  const preview = await evaluations(options), result = await evaluations({ ...options, yes: true, digest: preview.digest });
  assert.equal(result.execution.cancellation.admissionClosed, true);
  assert.equal(result.execution.status, 'uncertain');
  assert.equal((await inspectBudget({ stateDir: w.admission.stateDir, capacity: 1 })).used, 1);
  assert.equal((await evaluations({ ...options, yes: true, digest: preview.digest })).recovered, true);
});
test('legacy planned operations are not evidence of non-dispatch', () => {
  assert.equal(unauthorizedStage({ intent: { operations: ['Acme'] } }, 0), false);
  assert.equal(unauthorizedStage({ intent: { dispatchProtocol: 'ordered-authorization-v1', operations: ['Acme'] }, 'dispatch-builder': {} }, 0), false);
});

test('real killed controller retains first trial, reconciles original operations and resumes missing slots once', { skip: process.env.PLATES_EVALUATION_DOCKER !== '1', timeout: 180000 }, async t => {
  const w = await evaluationWorld(t, { timeoutSeconds: 8,
    builder: 'import {readFileSync} from "node:fs"; if(process.argv.includes("slow")) await new Promise(r=>setTimeout(r,30000)); console.log(JSON.stringify({schemaVersion:1,files:[{path:"answer.mjs",mode:"100644",base64:readFileSync("answer.mjs").toString("base64")}]}));' });
  const first = await w.call({}), completed = await w.call({ yes: true, digest: first.digest });
  assert.equal(completed.status, 'terminal');
  const dir = join(w.options.state, 'session-trials', w.b.comparison.id), firstPath = join(dir, 'execution', completed.slot, 'result.json');
  const firstBytes = await readFile(firstPath), frozenBytes = await readFile(join(dir, 'state.json'));
  const secondRequest = { ...w.request, arm: 'candidate', builderArgv: [...w.request.builderArgv, 'slow'] };
  await writeFile(w.execution, JSON.stringify(secondRequest));
  const url = new URL('../lib/evaluation-ledger.mjs', import.meta.url).href;
  const options = { ...w.options, action: 'run', experiment: w.b.comparison.id, execution: w.execution };
  const child = evaluationController(`import {evaluations} from ${JSON.stringify(url)}; const o=${JSON.stringify(options)};const p=await evaluations(o);await evaluations({...o,yes:true,digest:p.digest});`);
  t.after(() => child.kill('SIGKILL'));
  const slotDir = join(dir, 'execution', w.request.pairId + '-candidate');
  let intent, runningObserved = false, terminationObserved = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      intent = JSON.parse(await readFile(join(slotDir, 'intent.json')));
      const { run } = await import('./helpers/run.mjs');
      const found = run('docker', ['inspect', '--format', '{{.State.Running}}', intent.operations[0]]);
      if (found.status === 0 && found.stdout.trim() === 'true') { runningObserved = true; break; }
    } catch { /* wait for durable dispatch and actual original container */ }
    await new Promise(r => setTimeout(r, 25));
  }
  assert.ok(intent, 'controller reached durable intent');
  assert.equal(runningObserved, true, 'observed original container running before SIGKILL');
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  // The original supervisor's bounded deadline terminates its container. No
  // replacement is launched; the explicit cancel operation has its own budget.
  const until = Date.now() + 12000;
  const { run } = await import('./helpers/run.mjs');
  while (Date.now() < until) {
    const found = run('docker', ['inspect', '--format', '{{.State.Running}}', intent.operations[0]]);
    if (found.status === 0 && found.stdout.trim() === 'false') { terminationObserved = true; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(terminationObserved, true, 'observed supervisor termination after controller SIGKILL');
  const recoverOptions = { ...w.options, action: 'reconcile', experiment: w.b.comparison.id };
  const preview = await evaluations(recoverOptions);
  assert.equal(preview.input.lock.status, 'recoverable');
  const recovered = await evaluations({ ...recoverOptions, yes: true, digest: preview.digest });
  assert.equal(recovered.execution.status, 'complete');
  assert.equal(recovered.execution.trials.find(r => r.slot.endsWith('-candidate')).recovery.verdict.acceptance, 'unknown');
  const executions = w.b.comparison.pairs.flatMap(p => (p.order === 'AB' ? ['baseline','candidate'] : ['candidate','baseline']).map(arm => ({ ...w.request, pairId: p.id, arm }))).slice(2);
  await writeFile(w.execution, JSON.stringify({ schemaVersion: 1, executions }));
  const resumeOptions = { ...w.options, action: 'resume', experiment: w.b.comparison.id, execution: w.execution };
  const resumePreview = await evaluations(resumeOptions);
  const resumed = await evaluations({ ...resumeOptions, yes: true, digest: resumePreview.digest });
  assert.equal(resumed.execution.trials.length, 12);
  assert.equal(resumed.execution.trials.filter(r => r.status === 'terminal').length, 12);
  assert.deepEqual(await readFile(firstPath), firstBytes);
  assert.deepEqual(await readFile(join(dir, 'state.json')), frozenBytes);
  if (process.env.PLATES_EVALUATION_RETAIN === '1') t.diagnostic(JSON.stringify({ retainedPrivateWorkspace: w.root, frozenReceipt: join(dir, 'state.json'), frozenBytesDigest: fingerprint(frozenBytes.toString('base64')), firstResult: firstPath, firstResultBytesDigest: fingerprint(firstBytes.toString('base64')), recoveredIntent: intent.digest, reconcileDigest: preview.digest, resumeDigest: resumePreview.digest, completedSlots: resumed.execution.trials.length, runningObserved, terminationObserved }));
  await assert.rejects(evaluations(resumeOptions), /every missing slot/);
});

test('forged derived acceptance and mismatched stage authorization cannot become terminal', async t => {
  for (const shape of ['derived-acceptance', 'dispatch-operation']) await t.test(shape, async t => {
    const w = await reservedSlot(t), options = { ...w.options, action: 'reconcile', experiment: w.b.comparison.id };
    if (shape === 'dispatch-operation') {
      const forged = sealRecord({ schemaVersion: 2, kind: 'evaluation-dispatch', id: w.intent.id,
        createdAt: new Date().toISOString(), intentDigest: w.intent.digest, operation: w.intent.operations[1], index: 0 });
      await storeImmutable(join(w.path, 'dispatch-builder.json'), forged);
    } else {
      const preview = await evaluations(options), recovered = await evaluations({ ...options, yes: true, digest: preview.digest });
      const receipt = recovered.execution.trials[0].recovery.receipt;
      const verdict = sealRecord({ ...receipt.verdict, acceptance: 'accepted' });
      const result = sealRecord({ ...receipt.result, verdictDigest: verdict.digest, validation: 'passed' });
      const forged = sealRecord({ ...receipt, verdict, result });
      await storeImmutable(join(w.path, `reconciliation-${forged.digest}.json`), forged);
    }
    const inspected = await inspectExecutions(w.dir, w.plan);
    assert.equal(inspected.status, 'uncertain');
    assert.equal(inspected.trials[0].status, 'uncertain');
    assert.equal(inspected.trials[0].recovery, undefined);
  });
});

test('verified original verdict survives a derived missing-result projection; altered check evidence refuses', async t => {
  const w = await reservedSlot(t), i = w.intent, records = { intent: i, lease: JSON.parse(await readFile(join(w.path, 'lease.json'))) };
  const record = (kind, body) => sealRecord({ schemaVersion: 2, kind, id: i.id, createdAt: new Date().toISOString(), intentDigest: i.digest, ...body });
  const observations = i.operations.map((operation, index) => ({ operation, state: 'terminated', containerId: String(index + 1).repeat(64), running: false }));
  for (const [index, operation] of i.operations.entries()) {
    const name = index ? 'check-0' : 'builder';
    records['dispatch-' + name] = record('evaluation-dispatch', { operation, index });
    await storeImmutable(join(w.path, 'dispatch-' + name + '.json'), records['dispatch-' + name]);
    records[name] = record('evaluation-stage', { stage: { operation, containerId: observations[index].containerId,
      setup: 'passed', execution: 'passed', error: null, output: { exit: 0, signal: null, stdout: index ? 'Acme\n' : '', stderr: '' }, termination: observations[index] } });
    await storeImmutable(join(w.path, name + '.json'), records[name]);
  }
  const files = [{ path: 'answer.mjs', mode: '100644', base64: Buffer.from('export default "Acme";').toString('base64') }];
  records.artifact = record('evaluation-artifact', { files, filesDigest: fingerprint(files), sourceDigest: 'b'.repeat(64) });
  await storeImmutable(join(w.path, 'artifact.json'), records.artifact);
  records.verdict = record('evaluation-verdict', { artifactDigest: records.artifact.digest, checkManifestDigest: i.input.checkManifestDigest,
    evaluator: { identity: 'plates-host-stdio-v1', version: 1, controller: i.input.controller, image: i.input.image },
    acceptance: 'accepted', failureCategory: null, checks: [{ id: 'acme-behavior', status: 'passed', observationDigest: records['check-0'].digest }] });
  await storeImmutable(join(w.path, 'verdict.json'), records.verdict);
  const missing = await inspectExecutions(w.dir, w.plan);
  assert.equal(missing.trials[0].status, 'uncertain');
  assert.equal(missing.trials[0].records.verdict.acceptance, 'accepted');
  const inputDigest = 'c'.repeat(64), settlement = { id: i.id, commandDigest: i.previewDigest, released: true, observations };
  const result = record('evaluation-result', { recoveryInputDigest: inputDigest, status: 'terminal', verdictDigest: records.verdict.digest, settlement,
    setup: 'passed', execution: 'passed', validation: 'passed', resources: { currencyUsd: null } });
  const receipt = record('evaluation-reconciliation', { inputDigest, result, verdict: records.verdict, settlement, observations, status: 'terminal',
    originalEvidence: Object.fromEntries(Object.entries(records).map(([k,v]) => [k,v.digest])) });
  await storeImmutable(join(w.path, `reconciliation-${receipt.digest}.json`), receipt);
  const projected = await inspectExecutions(w.dir, w.plan);
  assert.equal(projected.trials[0].status, 'terminal');
  assert.equal(projected.trials[0].recovery.verdict.digest, records.verdict.digest);
  assert.equal(projected.trials[0].records.result, undefined);
  const forged = record('evaluation-reconciliation', { ...receipt, originalEvidence: { ...receipt.originalEvidence, 'check-0': 'd'.repeat(64) } });
  await storeImmutable(join(w.path, `reconciliation-${forged.digest}.json`), forged);
  assert.equal((await inspectExecutions(w.dir, w.plan)).trials[0].status, 'uncertain');
});

test('authorized but unavailable original operation keeps capacity; retries never repeat Docker inspection', async t => {
  const w = await reservedSlot(t), bin = join(w.root, 'tools'), calls = join(w.root, 'docker-calls');
  await mkdir(bin, { mode: 0o700 });
  await writeFile(join(bin, 'docker'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)}, 'inspect\\n');process.exit(1);\n`, { mode: 0o700 });
  const previousPath = process.env.PATH; process.env.PATH = bin + ':' + previousPath;
  t.after(() => { process.env.PATH = previousPath; });
  const dispatch = sealRecord({ schemaVersion: 2, kind: 'evaluation-dispatch', id: w.intent.id, createdAt: new Date().toISOString(),
    intentDigest: w.intent.digest, operation: w.intent.operations[0], index: 0 });
  await storeImmutable(join(w.path, 'dispatch-builder.json'), dispatch);
  for (const action of ['reconcile', 'cancel']) {
    const options = { ...w.options, action, experiment: w.b.comparison.id };
    const preview = await evaluations(options);
    const result = await evaluations({ ...options, yes: true, digest: preview.digest });
    assert.equal(result.execution.status, 'uncertain');
    assert.equal((await inspectBudget({ stateDir: w.admission.stateDir, capacity: 1 })).used, 1);
    const observed = await readFile(calls);
    await evaluations({ ...options, yes: true, digest: preview.digest });
    assert.deepEqual(await readFile(calls), observed);
    await assert.rejects(evaluations(options), /allowance exhausted/);
  }
  assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, 2);
});

test('derived terminal result must agree with its settlement and reconciliation receipt', async t => {
  for (const shape of ['result-status', 'result-settlement', 'settlement-observations']) await t.test(shape, async t => {
    const w = await reservedSlot(t), options = { ...w.options, action: 'reconcile', experiment: w.b.comparison.id };
    const preview = await evaluations(options), recovered = await evaluations({ ...options, yes: true, digest: preview.digest });
    const receipt = recovered.execution.trials[0].recovery.receipt;
    const result = shape === 'result-status' ? sealRecord({ ...receipt.result, status: 'uncertain' })
      : shape === 'result-settlement' ? sealRecord({ ...receipt.result, settlement: { ...receipt.result.settlement, released: false } }) : receipt.result;
    const settlement = shape === 'settlement-observations' ? { ...receipt.settlement, observations: [] } : receipt.settlement;
    const forged = sealRecord({ ...receipt, result, settlement });
    await storeImmutable(join(w.path, `reconciliation-${forged.digest}.json`), forged);
    const inspected = await inspectExecutions(w.dir, w.plan);
    assert.equal(inspected.trials[0].status, 'uncertain');
  });
});


test('preparation consumes trial allowance and expired external setup refuses before subprocess dispatch', async t => {
  assert.equal(admittedDeadline({ task: { limits: { minutes: 2 } }, preparationMs: 5000 }, 1000), 116000);
  assert.throws(() => admittedDeadline({ task: { limits: { minutes: 2 } }, preparationMs: 120000 }), /exhausted/);
  assert.throws(() => admittedDeadline({ task: { limits: { minutes: 2 } } }), /coverage/);
  assert.throws(() => exportSource('/Acme/missing', 'a'.repeat(40), ['acme.mjs'], { deadline: 0 }), /preparation deadline/);
  await assert.rejects(preflightDocker({}, { deadline: 0 }), /preparation deadline/);
  const w = await evaluationWorld(t);
  await assert.rejects(inspectBudgetTarget({ manifest: w.managed, root: w.repository, repo: 'Acme/widget', deadline: 0 }), /inspection_deadline/);
});

test('reused coordinator history must retain exact original settlement and operation evidence', async t => {
  const w = await reservedSlot(t), options = { ...w.options, action: 'reconcile', experiment: w.b.comparison.id };
  const preview = await evaluations(options), result = await evaluations({ ...options, yes: true, digest: preview.digest });
  const trial = result.execution.trials[0], lease = trial.records.lease.lease, observations = trial.recovery.receipt.observations;
  const args = { stateDir: w.admission.stateDir, capacity: 1, lease, observations };
  const original = await reconcileExternalBudget(args);
  assert.equal(original.released, true);
  const statePath = join(w.admission.stateDir, 'state.json'), pristine = JSON.parse(await readFile(statePath));
  for (const altered of [{ root: '/Acme/foreign' }, { observations: [] }, { released: 'yes' }, { endedAt: 'invalid' }]) {
    const state = structuredClone(pristine); Object.assign(state.history[0], altered);
    await writeFile(statePath, JSON.stringify(state));
    await assert.rejects(reconcileExternalBudget(args), /invalid_original_settlement_history/);
  }
});

test('cancel before first trial retains a valid reservation and closed admission', async t => {
  const w = await evaluationWorld(t), options = { ...w.options, action: 'cancel', experiment: w.b.comparison.id };
  const preview = await evaluations(options), cancelled = await evaluations({ ...options, yes: true, digest: preview.digest });
  assert.equal(cancelled.execution.status, 'complete');
  assert.equal(cancelled.execution.cancellation.admissionClosed, true);
  assert.equal(cancelled.execution.reservation.kind, 'evaluation-reservation');
});

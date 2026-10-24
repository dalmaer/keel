// Immutable execution extension beneath the frozen session-trials experiment.
import { mkdir, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { checkEvaluation as check, sealRecord, fingerprint, evaluationId } from './evaluation-records.mjs';
import { safePath, readJson, storeImmutable, ledgerLock } from './session-ledger-io.mjs';
import { controllerIdentity } from './evaluation-provenance.mjs';
import { executionInput, admittedDeadline } from './evaluation-execution-input.mjs';
import { submittedArtifact } from './evaluation-artifacts.mjs';
import { runDockerStage } from './evaluation-docker.mjs';
import { reserveExternalBudget, settleExternalBudget } from './validation-budget.mjs';
export const SLOT_BYTES = 1536 * 1024;
const record = (kind, id, body) => sealRecord({ schemaVersion: 2, kind, id, createdAt: new Date().toISOString(), ...body });
export async function immutable(path) {
  check(await safePath(path, false), 'missing execution record');
  const stat = await lstat(path); check(stat.nlink === 1 && (stat.mode & 0o277) === 0, 'execution receipt must be private immutable');
  const r = await readJson(path, 4 * 1024 * 1024);
  check(r.schemaVersion === 2 && sealRecord(r).digest === r.digest, 'execution receipt digest mismatch'); return r;
}
export async function usage(path) {
  check(await safePath(path), 'missing experiment directory');
  let bytes = 0, count = 0;
  async function visit(dir) {
    for (const name of await readdir(dir)) {
      const p = join(dir, name), s = await lstat(p);
      check(!s.isSymbolicLink() && (s.isDirectory() || s.isFile()) && s.nlink >= 1, 'unsafe execution storage');
      if (s.isDirectory()) await visit(p); else { check(s.nlink === 1, 'linked execution storage'); bytes += s.size; count++; }
      check(count <= 20000 && bytes <= 64 * 1024 * 1024, 'execution storage exhausted');
    }
  }
  await visit(path); return { bytes, count };
}
export async function inspectExecutions(dir, plan) {
  const home = join(dir, 'execution'); if (!await safePath(home)) return null;
  const names = await readdir(home); check(names.every(n => n === 'reservation.json' || n === 'control' || /^[a-z][a-z0-9-]{0,63}-(baseline|candidate)$/.test(n)), 'foreign execution state');
  const issues = [], trials = [];
  let reservation = null;
  try {
    const candidate = await immutable(join(home, 'reservation.json'));
    check(candidate.kind === 'evaluation-reservation' && candidate.planDigest === plan.digest
      && fingerprint(candidate.allowance) === fingerprint(plan.bundle.comparison.allowance), 'reservation binding mismatch');
    reservation = candidate;
  } catch (error) {
    issues.push({ record: 'reservation.json', reason: 'reservation-unavailable', detail: error.message });
  }
  for (const name of names.filter(n => n !== 'reservation.json' && n !== 'control')) {
    const slot = join(home, name), records = {};
    let reading = name;
    try {
      check(await safePath(slot), 'unsafe slot');
      const files = await readdir(slot);
      check(files.every(f => ['intent.json', 'lease.json', 'builder.json', 'artifact.json', 'verdict.json', 'result.json', 'dispatch-builder.json', ...Array.from({ length: 8 }, (_, i) => `dispatch-check-${i}.json`), ...Array.from({ length: 8 }, (_, i) => `check-${i}.json`)].includes(f) || /^reconciliation-[a-f0-9]{64}\.json$/.test(f)), 'foreign trial state');
      reading = name + '/intent.json';
      const intent = await immutable(join(slot, 'intent.json'));
      check(intent.kind === 'evaluation-intent' && intent.input.planDigest === plan.digest && intent.input.digest === undefined
        && intent.previewDigest === fingerprint(intent.input) && intent.slot === name, 'intent binding mismatch');
      records.intent = intent;
      for (const file of files.filter(f => f !== 'intent.json')) {
        reading = name + '/' + file;
        const r = await immutable(join(slot, file));
        check(r.intentDigest === intent.digest, 'trial record binding mismatch');
        if (file.startsWith('reconciliation-')) check(file === `reconciliation-${r.digest}.json`, 'reconciliation filename mismatch');
        records[file.slice(0, -5)] = r;
      }
      reading = name;
      if (records.artifact) check(records.artifact.filesDigest === fingerprint(records.artifact.files), 'artifact digest mismatch');
      if (records.verdict) check(records.verdict.artifactDigest === (records.artifact?.digest ?? null)
        && records.verdict.checkManifestDigest === intent.input.checkManifestDigest, 'verdict binding mismatch');
      if (records.result) {
        const result = records.result, verdict = records.verdict;
        check(result.kind === 'evaluation-result' && ['terminal', 'uncertain'].includes(result.status) && result.verdictDigest === verdict?.digest, 'terminal verdict binding mismatch');
        check(verdict?.kind === 'evaluation-verdict' && ['accepted', 'rejected', 'unknown'].includes(verdict.acceptance), 'invalid verdict');
        check(records.lease?.kind === 'evaluation-lease' && records.lease.lease.id === intent.id, 'missing original lease');
        check(result.settlement?.id === intent.id && result.settlement.commandDigest === intent.previewDigest
          && Array.isArray(result.settlement.observations) && result.settlement.observations.length === intent.operations.length
          && result.settlement.observations.every((o, i) => o.operation === intent.operations[i] && ['terminated', 'not-dispatched', 'unknown'].includes(o.state) && (o.state !== 'terminated' || /^[a-f0-9]{64}$/.test(o.containerId) && o.running === false)), 'invalid settlement');
        check(result.status !== 'terminal' || result.settlement.released === true && result.settlement.observations.every(o => o.state !== 'unknown'), 'unconfirmed terminal');
        check(verdict.acceptance !== 'accepted' || records.artifact && verdict.checks?.length > 0 && verdict.checks.every(c => c.status === 'passed' && Object.values(records).some(r => r.kind === 'evaluation-stage' && r.digest === c.observationDigest)), 'accepted verdict lacks observations');
      }
      validateTrialChain(records, plan, name);
      const history = Object.entries(records).filter(([key]) => key.startsWith('reconciliation-')).map(([,r]) => r);
      let recovery = null;
      for (const receipt of history) {
        check(receipt.kind === 'evaluation-reconciliation' && receipt.intentDigest === intent.digest
          && receipt.settlement?.id === intent.id && receipt.settlement.commandDigest === intent.previewDigest
          && receipt.observations?.length === intent.operations.length
          && receipt.observations.every((o,i) => o.operation === intent.operations[i] && ['terminated','unknown','not-dispatched'].includes(o.state))
          && Object.entries(receipt.originalEvidence).every(([key, hash]) => records[key]?.digest === hash), 'invalid reconciliation evidence');
        if (receipt.status === 'terminal') {
          check(receipt.result?.status === 'terminal' && fingerprint(receipt.result.settlement) === fingerprint(receipt.settlement)
            && fingerprint(receipt.observations) === fingerprint(receipt.settlement.observations)
            && receipt.settlement.released === true && receipt.observations.every((o,i) =>
            o.state === 'terminated' && /^[a-f0-9]{64}$/.test(o.containerId) && o.running === false
            || o.state === 'not-dispatched' && unauthorizedStage(records, i)), 'unverified recovered termination');
          check(receipt.result?.kind === 'evaluation-result' && sealRecord(receipt.result).digest === receipt.result.digest
            && receipt.result.intentDigest === intent.digest && receipt.result.recoveryInputDigest === receipt.inputDigest
            && receipt.result.verdictDigest === receipt.verdict?.digest && receipt.verdict.intentDigest === intent.digest
            && sealRecord(receipt.verdict).digest === receipt.verdict.digest, 'invalid derived recovery records');
          check(receipt.verdict.acceptance === 'unknown' || receipt.verdict.digest === records.verdict?.digest, 'recovery changed original verdict');
          check(receipt.result.validation === (receipt.verdict.acceptance === 'accepted' ? 'passed' : receipt.verdict.acceptance === 'rejected' ? 'failed' : 'unknown'), 'recovered validation mismatch');
          recovery = { receipt, result: receipt.result, verdict: receipt.verdict };
        }
      }
      trials.push({ slot: name, status: recovery ? 'terminal' : records.result?.status ?? 'uncertain', records, history, ...(recovery ? { recovery } : {}) });
    } catch (error) {
      issues.push({ record: reading, reason: 'trial-record-unavailable', detail: error.message });
      // Expose no unvalidated outcome as a terminal receipt. Partial bytes stay
      // untouched on disk for explicit later recovery, never inferred absent.
      trials.push({ slot: name, status: 'uncertain', reason: 'trial-record-unavailable' });
    }
  }
  let cancellation = null;
  const control = join(home, 'control');
  if (await safePath(control)) {
    for (const name of await readdir(control)) {
      try {
        check(/^(cancel\.json|(reconcile|cancel)-(intent|[a-f0-9]{64})\.json)$/.test(name), 'foreign control receipt');
        const receipt = await immutable(join(control, name));
        check(receipt.planDigest === plan.digest && ['evaluation-cancel','evaluation-control','evaluation-recovery-reservation'].includes(receipt.kind), 'invalid control binding');
        if (name === 'cancel.json') { check(receipt.admissionClosed === true, 'invalid cancellation'); cancellation = receipt; }
      } catch (error) { issues.push({ record: 'control/' + name, reason: 'control-record-unavailable', detail: error.message }); }
    }
  }
  return { cancellation, status: issues.length || trials.some(t => t.status === 'uncertain') ? 'uncertain' : 'complete', reservation, trials, issues };
}

export async function runEvaluation(options, { scope, readFrozen, heldLock = false, supplied, preparedInput }) {
  const invocationStarted = Date.now();
  check(evaluationId(options.experiment) && options.bundle === undefined, 'run needs experiment and execution only');
  const bound = await scope(options), parent = join(bound.paths.state, 'session-trials');
  check(await safePath(parent), 'freeze experiment first');
  const dir = join(parent, options.experiment);
  let ledger = await readFrozen(dir, bound, options.experiment);
  check((await inspectExecutions(dir, ledger.plan))?.status !== 'uncertain', 'incomplete execution state retains reservation; recovery is unavailable');
  const prepared = preparedInput ?? await executionInput(options, ledger, supplied);
  const preview = { action: 'run', preview: true, digest: prepared.digest, input: prepared.input, maximumAdditionalMinutes: prepared.task.limits.minutes,
    comparisonAllowance: ledger.plan.bundle.comparison.allowance, currencyUsd: null };
  if (!options.yes) return preview;
  check(options.digest === prepared.digest, 'stale or missing run preview digest');
  const approvedAt = Date.now();
  const chargedPreparationMs = prepared.preparationMs + Math.max(0, approvedAt - invocationStarted - (preparedInput ? 0 : prepared.preparationMs));
  const totalDeadline = admittedDeadline({ ...prepared, preparationMs: chargedPreparationMs }, approvedAt);
  const release = heldLock ? async () => {} : await ledgerLock(parent, { harness: true });
  try {
    ledger = await readFrozen(dir, await scope(options), options.experiment);
    check(prepared.input.planDigest === ledger.plan.digest && fingerprint(prepared.input) === prepared.digest
      && (await controllerIdentity()).digest === prepared.input.controller.digest, 'prepared execution binding changed');
    const { input, task, driver, protectedPaths, target } = prepared, { request } = input;
    const slot = request.pairId + '-' + request.arm, home = join(dir, 'execution'), slotDir = join(home, slot);
    check(!await safePath(join(dir, 'execution', 'control', 'cancel.json'), false), 'comparison cancelled; admission closed');
    const existing = await inspectExecutions(dir, ledger.plan);
    check(existing?.status !== 'uncertain', 'incomplete execution state retains reservation; recovery is unavailable');
    const previous = existing?.trials.find(t => t.slot === slot);
    if (previous) {
      check(previous.records?.intent.previewDigest === prepared.digest, 'slot already reserved with other inputs');
      return { action: 'run', preview: false, recovered: true, ...previous };
    }
    check(!existing?.trials.some(t => t.status === 'uncertain'), 'uncertain prior trial retains reservation');
    const retained = await usage(dir), policy = ledger.plan.bundle.comparison.retention;
    const allSlots = ledger.plan.bundle.comparison.pairs.length * 2;
    const remaining = allSlots - (existing?.trials.length ?? 0);
    const planned = ledger.plan.bundle.comparison.pairs.reduce((n,p) => n + 2 * ledger.plan.bundle.cases.find(c => c.id === p.case.id).limits.minutes, 0);
    check(planned + allSlots / 3 <= ledger.plan.bundle.comparison.allowance.minutes, 'comparison allowance lacks conservative recovery reservation');
    check(retained.bytes + remaining * SLOT_BYTES + allSlots * 65536 <= policy.maxBytes
      && retained.count + remaining * 26 + allSlots * 4 <= policy.maxEvents, 'whole comparison and recovery retention reservation exhausted');
    check(retained.bytes + SLOT_BYTES <= policy.maxBytes && retained.count + driver.checks.length * 2 + 8 <= policy.maxEvents, 'trial retention reservation exhausted');
    if (!existing) {
      await mkdir(home, { mode: 0o700 });
      await storeImmutable(join(home, 'reservation.json'), record('evaluation-reservation', options.experiment, { planDigest: ledger.plan.digest, allowance: ledger.plan.bundle.comparison.allowance, currencyUsage: null }));
    }
    const id = randomBytes(16).toString('hex');
    const operations = [`plates-eval-${id}-builder`, ...driver.checks.map((_, i) => `plates-eval-${id}-check-${i}`)];
    await mkdir(slotDir, { mode: 0o700 });
    const intent = record('evaluation-intent', id, { slot, previewDigest: prepared.digest, input, operations,
      approvedExecution: { approvedAt, deadlineEpochMs: totalDeadline, preparationMs: chargedPreparationMs, coverage: 'preparation-plus-admitted-slot-v1' }, dispatchProtocol: 'ordered-authorization-v1', attempt: 1, parentAttemptId: null, reservedMinutes: task.limits.minutes, repairRounds: 0, interventions: [] });
    await storeImmutable(join(slotDir, 'intent.json'), intent);
    const save = async (name, kind, body) => {
      const r = record(kind, id, { intentDigest: intent.digest, ...body });
      const retainedNow = await usage(dir), size = Buffer.byteLength(JSON.stringify(r) + '\n');
      check(retainedNow.bytes + size <= policy.maxBytes && retainedNow.count + 1 <= policy.maxEvents, 'execution evidence capacity exhausted; original intent retained');
      await storeImmutable(join(slotDir, name + '.json'), r); return r;
    };
    // Failure after durable intent is never retried. A coordinator refusal has
    // no container effect, but keeps this slot visible for explicit reconciliation.
    const a = request.admission;
    const lease = await reserveExternalBudget({ stateDir: a.stateDir, capacity: a.capacity, weight: a.weight, target, id, commandDigest: prepared.digest, operations });
    await save('lease', 'evaluation-lease', { lease });
    const start = Date.now(), deadline = Math.min(start + task.limits.timeoutSeconds * 1000, totalDeadline - (driver.checks.length + 1) * 10000);
    check(deadline > Date.now(), 'approved trial allowance exhausted before dispatch');
    const observations = operations.map(operation => ({ operation, state: 'not-dispatched' }));
    await save('dispatch-builder', 'evaluation-dispatch', { operation: operations[0], index: 0 });
    const builder = await runDockerStage({ name: operations[0], image: input.image, files: input.delivered, argv: request.builderArgv, submission: true, deadline, cleanupDeadline: totalDeadline });
    observations[0] = builder.termination;
    // Submission stdout is retained exactly in the stage observation, separate
    // from the host-parsed artifact. It is never a source of verdict authority.
    await save('builder', 'evaluation-stage', { stage: builder });
    let artifact = null, artifactFailure = null, verdictStatus = 'unknown', failureCategory = 'setup', checks = [];
    if (builder.setup === 'passed') {
      failureCategory = builder.error === 'deadline-exhausted' ? 'timeout' : 'execution';
      if (builder.execution === 'passed' && !builder.error && builder.termination.state === 'terminated') {
        try {
          const files = submittedArtifact(builder.output.stdout, input.delivered, task.allowlist.paths, protectedPaths);
          artifact = await save('artifact', 'evaluation-artifact', { files, filesDigest: fingerprint(files), submissionDigest: fingerprint(builder.output.stdout), sourceDigest: input.sourceDigest });
        } catch (error) { artifactFailure = error.message; verdictStatus = 'rejected'; failureCategory = 'invalid-submission'; }
      }
    }
    if (artifact) {
      for (let i = 0; i < driver.checks.length; i++) {
        if (Date.now() >= deadline || observations.some(o => o.state === 'unknown')) break;
        const c = driver.checks[i];
        await save(`dispatch-check-${i}`, 'evaluation-dispatch', { operation: operations[i + 1], index: i + 1 });
        const stage = await runDockerStage({ name: operations[i + 1], image: input.image, files: artifact.files, argv: c.argv, stdin: c.stdin, deadline, cleanupDeadline: totalDeadline });
        observations[i + 1] = stage.termination;
        const retained = await save(`check-${i}`, 'evaluation-stage', { stage });
        const known = stage.setup === 'passed' && !stage.error && stage.output && stage.output.signal === null && stage.termination.state === 'terminated';
        checks.push({ id: c.id, status: !known ? 'unknown' : stage.output.exit === c.exitCode && stage.output.stdout === c.stdout ? 'passed' : 'failed', observationDigest: retained.digest });
      }
      verdictStatus = checks.length !== driver.checks.length || checks.some(c => c.status === 'unknown') ? 'unknown' : checks.every(c => c.status === 'passed') ? 'accepted' : 'rejected';
      failureCategory = verdictStatus === 'accepted' ? null : verdictStatus === 'rejected' ? 'acceptance' : 'evaluation';
    }
    const verdict = await save('verdict', 'evaluation-verdict', { artifactDigest: artifact?.digest ?? null, checkManifestDigest: input.checkManifestDigest,
      evaluator: { identity: 'plates-host-stdio-v1', version: 1, controller: input.controller, image: input.image }, acceptance: verdictStatus, failureCategory, checks,
      artifactFailure, supersedesVerdictId: null, limitations: ['Offline scripted builder; no model efficacy claim.', 'Costs and active human time unavailable.'] });
    const settlement = await settleExternalBudget({ stateDir: a.stateDir, capacity: a.capacity, lease, observations });
    const result = await save('result', 'evaluation-result', { status: settlement.released ? 'terminal' : 'uncertain', verdictDigest: verdict.digest,
      setup: builder.setup, execution: builder.execution, validation: verdictStatus === 'accepted' ? 'passed' : verdictStatus === 'rejected' ? 'failed' : 'unknown',
      settlement, resources: { wallMs: Date.now() - start, approvedWallMs: Date.now() - approvedAt + chargedPreparationMs, preparationMs: chargedPreparationMs, source: 'observed-clock', coverage: 'wallMs: dispatch-execution-evaluation-cleanup; approvedWallMs: preparation and admitted slot; excludes read-only prior previews and stalled host IO' , currencyUsd: null, cpuMs: null, activeHumanMinutes: null } });
    return { action: 'run', preview: false, recovered: false, slot, status: result.status, intent, result, verdict };
  } finally { await release(); }
}

export function unauthorizedStage(records, index) {
  const intent = records.intent;
  if (intent?.dispatchProtocol !== 'ordered-authorization-v1') return false;
  const marker = i => i === 0 ? 'dispatch-builder' : `dispatch-check-${i - 1}`;
  const stage = i => i === 0 ? 'builder' : `check-${i - 1}`;
  // Only the versioned controller protocol grants dispatch authority. No later
  // stage can be authorized before its predecessor's durable observation.
  return intent.operations.slice(index).every((_, offset) => !records[marker(index + offset)] && !records[stage(index + offset)]);
}
export function validateTrialChain(records, plan, slot) {
  const i = records.intent, input = i.input, request = input.request;
  const pair = plan.bundle.comparison.pairs.find(p => p.id === request?.pairId);
  check(pair && ['baseline', 'candidate'].includes(request.arm) && slot === request.pairId + '-' + request.arm, 'unplanned execution slot');
  const task = plan.bundle.cases.find(c => c.id === pair.case.id);
  check(input.taskDigest === task.digest && input.configurationDigest === plan.bundle.comparison[request.arm].digest
    && input.checkManifestDigest === task.acceptanceManifest.digest && Array.isArray(i.operations)
    && i.operations.length >= 1 && i.operations.length <= 9
    && i.operations.every((op,index) => op === `plates-eval-${i.id}-${index ? 'check-' + (index - 1) : 'builder'}`), 'intent identity mismatch');
  if (records.lease) check(records.lease.kind === 'evaluation-lease' && records.lease.lease.id === i.id
    && records.lease.lease.commandDigest === i.previewDigest && fingerprint(records.lease.lease.operations) === fingerprint(i.operations)
    && records.lease.lease.repo === input.request.admission.repo && records.lease.lease.root === request.repository, 'lease chain mismatch');
  if (records.verdict) {
    const v = records.verdict;
    check(v.kind === 'evaluation-verdict' && ['accepted','rejected','unknown'].includes(v.acceptance)
      && fingerprint(v.evaluator?.controller) === fingerprint(input.controller)
      && fingerprint(v.evaluator?.image) === fingerprint(input.image), 'verdict authority mismatch');
    if (v.acceptance === 'accepted' || v.acceptance === 'rejected' && v.failureCategory === 'acceptance') {
      const driver = JSON.parse(plan.bundle.materials.find(m => m.digest === task.acceptanceManifest.digest).content);
      check(records.artifact?.kind === 'evaluation-artifact' && records.artifact.sourceDigest === input.sourceDigest
        && Array.isArray(v.checks) && v.checks.length === driver.checks.length && driver.checks.every((c,index) => {
          const observed = records[`check-${index}`], outcome = v.checks[index], stage = observed?.stage;
          const known = stage?.setup === 'passed' && !stage.error && stage.output?.signal === null && stage.termination?.state === 'terminated';
          const passed = known && stage.output.exit === c.exitCode && stage.output.stdout === c.stdout;
          return known && outcome.id === c.id && outcome.observationDigest === observed.digest && outcome.status === (passed ? 'passed' : 'failed');
        }) && (v.acceptance === 'accepted') === v.checks.every(c => c.status === 'passed'), 'verdict lacks independent check chain');
    }
  }

  for (let index = 0; index < i.operations.length; index++) {
    const name = index ? `check-${index - 1}` : 'builder', stage = records[name], marker = records['dispatch-' + name];
    if (marker) check(marker.kind === 'evaluation-dispatch' && marker.operation === i.operations[index] && marker.index === index
      && (index === 0 || records[index === 1 ? 'builder' : `check-${index - 2}`]?.kind === 'evaluation-stage'), 'dispatch authorization chain mismatch');
    if (stage) check(stage.kind === 'evaluation-stage' && stage.stage?.operation === i.operations[index]
      && (i.dispatchProtocol !== 'ordered-authorization-v1' || marker), 'stage operation mismatch');
  }
}

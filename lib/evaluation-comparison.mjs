// Foreground comparison orchestration over the frozen ledger and original slots.
import { readdir, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { checkEvaluation as check, fields, fingerprint, sealRecord, evaluationId } from './evaluation-records.mjs';
import { evaluationBytes } from './evaluation-ledger.mjs';
import { safePath, storeImmutable, ledgerLock, inspectHarnessLock } from './session-ledger-io.mjs';
import { inspectExecutions, runEvaluation, usage, SLOT_BYTES, immutable, unauthorizedStage } from './evaluation-execution.mjs';
import { executionInput } from './evaluation-execution-input.mjs';
import { controllerIdentity } from './evaluation-provenance.mjs';
import { inspectDockerOperation } from './evaluation-docker.mjs';
import { reconcileExternalBudget } from './validation-budget.mjs';
import { summarizeComparison, renderComparison } from './evaluation-comparison-report.mjs';

export const orderedSlots = plan => plan.bundle.comparison.pairs.flatMap(p => (p.order === 'AB' ? ['baseline', 'candidate'] : ['candidate', 'baseline']).map(arm => ({ slot: `${p.id}-${arm}`, pairId: p.id, arm })));
const record = (kind, id, body) => sealRecord({ schemaVersion: 2, kind, id, createdAt: new Date().toISOString(), ...body });
async function snapshot(dir) {
  const rows = [];
  async function visit(path, relative = '') {
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name), key = relative + name, stat = await lstat(file);
      check(!stat.isSymbolicLink(), 'unsafe comparison storage');
      if (stat.isDirectory()) await visit(file, key + '/');
      else { check(stat.isFile() && stat.nlink === 1, 'unsafe comparison record'); rows.push({ path: key, digest: fingerprint((await evaluationBytes(file, 4 * 1024 * 1024)).toString('base64')) }); }
      check(rows.length <= 20000, 'comparison record limit');
    }
  }
  await visit(dir); return fingerprint(rows);
}
async function saveControl(dir, name, value, policy) {
  const retained = await usage(dir), size = Buffer.byteLength(JSON.stringify(value) + '\n');
  check(retained.bytes + size <= policy.maxBytes && retained.count + 1 <= policy.maxEvents, 'recovery retention exhausted');
  const control = join(dir, 'execution', 'control');
  await mkdir(control, { recursive: true, mode: 0o700 });
  await storeImmutable(join(control, name), value);
}
export async function comparisonOperation(options, { scope, readFrozen }) {
  const { action, experiment } = options;
  check(evaluationId(experiment) && options.bundle === undefined, 'comparison needs experiment only');
  const bound = await scope(options), parent = join(bound.paths.state, 'session-trials'), dir = join(parent, experiment);
  const ledger = await readFrozen(dir, bound, experiment), plan = ledger.plan;
  const execution = await inspectExecutions(dir, plan), lock = await inspectHarnessLock(parent);
  const recoveryIntentPath = join(dir, 'execution', 'control', `${action}-intent.json`);
  if (['reconcile', 'cancel'].includes(action) && await safePath(recoveryIntentPath, false)) {
    const previous = await immutable(recoveryIntentPath);
    check(previous.kind === 'evaluation-recovery-reservation' && previous.planDigest === plan.digest, 'invalid recovery reservation');
    check(options.yes && options.digest === previous.inputDigest, 'recovery allowance exhausted; recover original approved receipt only');
    const outcomePath = join(dir, 'execution', 'control', `${action}-${previous.inputDigest}.json`);
    return { action, preview: false, digest: previous.inputDigest, recovered: true,
      status: await safePath(outcomePath, false) ? 'recorded' : 'uncertain', execution };
  }
  if (action === 'compare') {
    check(!options.yes && options.digest === undefined && options.execution === undefined, 'compare is read-only');
    check(!lock || lock.status === 'recoverable', 'comparison writer active or unverifiable');
    const report = summarizeComparison(plan, execution);
    return { action, preview: false, report, markdown: renderComparison(report) };
  }
  check(['resume', 'reconcile', 'cancel'].includes(action), 'unsupported comparison action');
  check(action === 'resume' || options.execution === undefined, 'execution only applies to resume');
  check(!lock || action === 'reconcile' && lock.status === 'recoverable', 'storage locked; explicit verified recovery required');
  const input = { recoveryPolicy: { attemptsPerAction: 1, operationDeadlineMs: 1000, reservedSecondsPerSlot: 20 }, planDigest: plan.digest, destination: dir, snapshot: await snapshot(dir), lock, controller: await controllerIdentity(), allowance: plan.bundle.comparison.allowance };
  let requests = [], prepared = [];
  const slots = orderedSlots(plan), policy = plan.bundle.comparison.retention;
  if (action === 'resume') {
    check(execution?.status !== 'uncertain', 'uncertain original operations require reconciliation');
    check(!await safePath(join(dir, 'execution', 'control', 'cancel.json'), false), 'comparison cancelled; admission closed');
    const raw = await evaluationBytes(options.execution, 1024 * 1024);
    const descriptor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    fields(descriptor, ['schemaVersion', 'executions']);
    check(descriptor.schemaVersion === 1 && Array.isArray(descriptor.executions), 'invalid resume descriptor');
    const missing = slots.filter(s => !execution?.trials.some(t => t.slot === s.slot));
    requests = descriptor.executions;
    check(requests.length === missing.length && requests.every((r, i) => r.pairId === missing[i].pairId && r.arm === missing[i].arm), 'resume requires every missing slot in frozen order');
    for (const request of requests) prepared.push(await executionInput(options, ledger, request));
    const retained = await usage(dir);
    check(retained.bytes + missing.length * SLOT_BYTES + slots.length * 65536 <= policy.maxBytes
      && retained.count + missing.length * 26 + slots.length * 4 <= policy.maxEvents, 'whole comparison and recovery retention reservation exhausted');
    const plannedMinutes = plan.bundle.comparison.pairs.reduce((n, p) => n + 2 * plan.bundle.cases.find(c => c.id === p.case.id).limits.minutes, 0);
    const recoveryMinutes = slots.length / 3;
    check(plannedMinutes + recoveryMinutes <= plan.bundle.comparison.allowance.minutes, 'comparison allowance lacks conservative recovery reservation');
    Object.assign(input, { executionPath: options.execution, descriptorDigest: fingerprint(raw.toString('base64')), missing: prepared.map(p => p.input), maximumAdditionalMinutes: missing.reduce((n, s) => n + plan.bundle.cases.find(c => c.id === plan.bundle.comparison.pairs.find(p => p.id === s.pairId).case.id).limits.minutes, 0) + recoveryMinutes, recoveryMinutes });
  }
  const digest = fingerprint(input);
  if (!options.yes) return { action, preview: true, digest, input };
  check(options.digest === digest, 'stale or missing comparison preview digest');
  const release = await ledgerLock(parent, { harness: true, ...(lock ? { recover: lock } : {}) });
  try {
    check(fingerprint(await scope(options)) === fingerprint(bound) && (await readFrozen(dir, bound, experiment)).digest === ledger.digest && await snapshot(dir) === input.snapshot, 'comparison changed before mutation');
    if (action === 'resume') {
      for (let i = 0; i < requests.length; i++) {
        await runEvaluation({ ...options, action: 'run', digest: prepared[i].digest }, { scope, readFrozen, heldLock: true, supplied: requests[i], preparedInput: prepared[i] });
      }
    } else {
      const plannedMinutes = plan.bundle.comparison.pairs.reduce((n,p) => n + 2 * plan.bundle.cases.find(c => c.id === p.case.id).limits.minutes, 0);
      check(plannedMinutes + slots.length / 3 <= plan.bundle.comparison.allowance.minutes, 'comparison allowance lacks conservative recovery reservation');
      if (!execution) {
        await mkdir(join(dir, 'execution'), { mode: 0o700 });
        await storeImmutable(join(dir, 'execution', 'reservation.json'), record('evaluation-reservation', experiment, { planDigest: plan.digest, allowance: plan.bundle.comparison.allowance, currencyUsage: null }));
      }
      // Exactly one bounded reconciliation and one bounded cancellation per
      // comparison. A crash consumes the reservation; retries inspect it only.
      await saveControl(dir, `${action}-intent.json`, record('evaluation-recovery-reservation', experiment,
        { planDigest: plan.digest, inputDigest: digest, action, maximumSeconds: slots.length * 10, policy: input.recoveryPolicy }), policy);
      if (action === 'cancel' && !await safePath(join(dir, 'execution', 'control', 'cancel.json'), false)) {
        await saveControl(dir, 'cancel.json', record('evaluation-cancel', experiment, { planDigest: plan.digest, inputDigest: digest, admissionClosed: true }), policy);
      }
      for (const trial of execution?.trials ?? []) {
        if (trial.status === 'terminal' || !trial.records?.intent || !trial.records?.lease) continue;
        const records = trial.records, intent = records.intent, lease = records.lease.lease;
        const observations = [];
        for (const [index, operation] of intent.operations.entries()) {
          const prior = Object.values(records).find(r => r.kind === 'evaluation-stage' && r.stage?.operation === operation)?.stage;
          observations.push(unauthorizedStage(records, index) ? { operation, state: 'not-dispatched', authority: 'ordered-authorization-v1', intentDigest: intent.digest } : await inspectDockerOperation(operation, intent.input.image, { cancel: action === 'cancel', expectedId: prior?.containerId ?? null }));
        }
        const a = intent.input.request.admission;
        const settlement = await reconcileExternalBudget({ stateDir: a.stateDir, capacity: a.capacity, lease, observations });
        let verdict = records.verdict;
        if (!verdict) verdict = record('evaluation-verdict', intent.id, { intentDigest: intent.digest, recoveryInputDigest: digest,
          artifactDigest: records.artifact?.digest ?? null, checkManifestDigest: intent.input.checkManifestDigest,
          evaluator: { identity: 'plates-host-stdio-v1', version: 1, controller: intent.input.controller, image: intent.input.image },
          acceptance: 'unknown', failureCategory: 'missing-evidence', checks: [], supersedesVerdictId: null,
          limitations: ['Recovered termination; original outputs unavailable.'] });
        const result = record('evaluation-result', intent.id, { intentDigest: intent.digest, recoveryInputDigest: digest,
          status: settlement.released ? 'terminal' : 'uncertain', verdictDigest: verdict.digest, settlement,
          setup: records.builder?.stage.setup ?? 'unknown', execution: records.builder?.stage.execution ?? 'unknown',
          validation: verdict.acceptance === 'accepted' ? 'passed' : verdict.acceptance === 'rejected' ? 'failed' : 'unknown',
          resources: records.result?.resources ?? { currencyUsd: null, wallMs: null, activeHumanMinutes: null, cpuMs: null } });
        const body = { result, verdict, intentDigest: intent.digest, originalEvidence: Object.fromEntries(Object.entries(records).map(([k,v]) => [k,v.digest])), observations, settlement,
          status: settlement.released ? 'terminal' : 'uncertain', acceptance: verdict.acceptance, reason: 'recovered-operation; missing evidence remains unavailable', inputDigest: digest };
        const receipt = record('evaluation-reconciliation', intent.id, body);
        const retained = await usage(dir);
        check(retained.bytes + Buffer.byteLength(JSON.stringify(receipt)) + 1 <= policy.maxBytes && retained.count + 1 <= policy.maxEvents, 'recovery retention exhausted');
        await storeImmutable(join(dir, 'execution', trial.slot, `reconciliation-${receipt.digest}.json`), receipt);
      }
      await saveControl(dir, `${action}-${digest}.json`, record('evaluation-control', experiment, { planDigest: plan.digest, inputDigest: digest, action, recoveredLock: lock }), policy);
    }
    return { action, preview: false, digest, execution: await inspectExecutions(dir, plan) };
  } finally { await release(); }
}

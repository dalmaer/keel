// Immutable execution extension beneath the frozen session-trials experiment.
import { mkdir, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { checkEvaluation as check, sealRecord, fingerprint, evaluationId } from './evaluation-records.mjs';
import { safePath, readJson, storeImmutable, ledgerLock } from './session-ledger-io.mjs';
import { executionInput } from './evaluation-execution-input.mjs';
import { submittedArtifact } from './evaluation-artifacts.mjs';
import { runDockerStage } from './evaluation-docker.mjs';
import { reserveExternalBudget, settleExternalBudget } from './validation-budget.mjs';
const SLOT_BYTES = 1536 * 1024;
const record = (kind, id, body) => sealRecord({ schemaVersion: 2, kind, id, createdAt: new Date().toISOString(), ...body });
async function immutable(path) {
  check(await safePath(path, false), 'missing execution record');
  const stat = await lstat(path); check(stat.nlink === 1 && (stat.mode & 0o277) === 0, 'execution receipt must be private immutable');
  const r = await readJson(path, 4 * 1024 * 1024);
  check(r.schemaVersion === 2 && sealRecord(r).digest === r.digest, 'execution receipt digest mismatch'); return r;
}
async function usage(path) {
  check(await safePath(path), 'missing experiment directory');
  let bytes = 0, count = 0;
  async function visit(dir) {
    for (const name of await readdir(dir)) {
      const p = join(dir, name), s = await lstat(p);
      check(!s.isSymbolicLink() && (s.isDirectory() || s.isFile()) && s.nlink >= 1, 'unsafe execution storage');
      if (s.isDirectory()) await visit(p); else { check(s.nlink === 1, 'linked execution storage'); bytes += s.size; count++; }
      check(count <= 20000 && bytes <= 4 * 1024 * 1024, 'execution storage exhausted');
    }
  }
  await visit(path); return { bytes, count };
}
export async function inspectExecutions(dir, plan) {
  const home = join(dir, 'execution'); if (!await safePath(home)) return null;
  const names = await readdir(home); check(names.every(n => n === 'reservation.json' || /^[a-z][a-z0-9-]{0,63}-(baseline|candidate)$/.test(n)), 'foreign execution state');
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
  for (const name of names.filter(n => n !== 'reservation.json')) {
    const slot = join(home, name), records = {};
    let reading = name;
    try {
      check(await safePath(slot), 'unsafe slot');
      const files = await readdir(slot);
      check(files.every(f => ['intent.json', 'lease.json', 'builder.json', 'artifact.json', 'verdict.json', 'result.json', ...Array.from({ length: 8 }, (_, i) => `check-${i}.json`)].includes(f)), 'foreign trial state');
      reading = name + '/intent.json';
      const intent = await immutable(join(slot, 'intent.json'));
      check(intent.kind === 'evaluation-intent' && intent.input.planDigest === plan.digest && intent.input.digest === undefined
        && intent.previewDigest === fingerprint(intent.input) && intent.slot === name, 'intent binding mismatch');
      records.intent = intent;
      for (const file of files.filter(f => f !== 'intent.json')) {
        reading = name + '/' + file;
        const r = await immutable(join(slot, file));
        check(r.intentDigest === intent.digest, 'trial record binding mismatch');
        records[file.slice(0, -5)] = r;
      }
      reading = name;
      if (records.artifact) check(records.artifact.filesDigest === fingerprint(records.artifact.files), 'artifact digest mismatch');
      if (records.verdict) check(records.verdict.artifactDigest === (records.artifact?.digest ?? null)
        && records.verdict.checkManifestDigest === intent.input.checkManifestDigest, 'verdict binding mismatch');
      if (records.result) check(records.result.verdictDigest === records.verdict?.digest, 'terminal verdict binding mismatch');
      trials.push({ slot: name, status: records.result?.status ?? 'uncertain', records });
    } catch (error) {
      issues.push({ record: reading, reason: 'trial-record-unavailable', detail: error.message });
      // Expose no unvalidated outcome as a terminal receipt. Partial bytes stay
      // untouched on disk for explicit later recovery, never inferred absent.
      trials.push({ slot: name, status: 'uncertain', reason: 'trial-record-unavailable' });
    }
  }
  return { status: issues.length || trials.some(t => t.status === 'uncertain') ? 'uncertain' : 'complete', reservation, trials, issues };
}

export async function runEvaluation(options, { scope, readFrozen }) {
  check(evaluationId(options.experiment) && options.bundle === undefined, 'run needs experiment and execution only');
  const bound = await scope(options), parent = join(bound.paths.state, 'session-trials');
  check(await safePath(parent), 'freeze experiment first');
  const dir = join(parent, options.experiment);
  let ledger = await readFrozen(dir, bound, options.experiment);
  check((await inspectExecutions(dir, ledger.plan))?.status !== 'uncertain', 'incomplete execution state retains reservation; recovery is unavailable');
  let prepared = await executionInput(options, ledger);
  const preview = { action: 'run', preview: true, digest: prepared.digest, input: prepared.input, maximumAdditionalMinutes: prepared.task.limits.minutes,
    comparisonAllowance: ledger.plan.bundle.comparison.allowance, currencyUsd: null };
  if (!options.yes) return preview;
  check(options.digest === prepared.digest, 'stale or missing run preview digest');
  const release = await ledgerLock(parent);
  try {
    ledger = await readFrozen(dir, await scope(options), options.experiment);
    const current = await executionInput(options, ledger); check(current.digest === prepared.digest, 'execution inputs changed before admission'); prepared = current;
    const { input, task, driver, protectedPaths, target } = prepared, { request } = input;
    const slot = request.pairId + '-' + request.arm, home = join(dir, 'execution'), slotDir = join(home, slot);
    const existing = await inspectExecutions(dir, ledger.plan);
    check(existing?.status !== 'uncertain', 'incomplete execution state retains reservation; recovery is unavailable');
    const previous = existing?.trials.find(t => t.slot === slot);
    if (previous) {
      check(previous.records?.intent.previewDigest === prepared.digest, 'slot already reserved with other inputs');
      return { action: 'run', preview: false, recovered: true, ...previous };
    }
    check(!existing?.trials.some(t => t.status === 'uncertain'), 'uncertain prior trial retains reservation');
    const retained = await usage(dir), policy = ledger.plan.bundle.comparison.retention;
    check(retained.bytes + SLOT_BYTES <= policy.maxBytes && retained.count + driver.checks.length + 7 <= policy.maxEvents, 'trial retention reservation exhausted');
    if (!existing) {
      await mkdir(home, { mode: 0o700 });
      await storeImmutable(join(home, 'reservation.json'), record('evaluation-reservation', options.experiment, { planDigest: ledger.plan.digest, allowance: ledger.plan.bundle.comparison.allowance, currencyUsage: null }));
    }
    const id = randomBytes(16).toString('hex');
    const operations = [`plates-eval-${id}-builder`, ...driver.checks.map((_, i) => `plates-eval-${id}-check-${i}`)];
    await mkdir(slotDir, { mode: 0o700 });
    const intent = record('evaluation-intent', id, { slot, previewDigest: prepared.digest, input, operations,
      attempt: 1, parentAttemptId: null, reservedMinutes: task.limits.minutes, repairRounds: 0, interventions: [] });
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
    const start = Date.now(), deadline = start + task.limits.timeoutSeconds * 1000;
    const observations = operations.map(operation => ({ operation, state: 'not-dispatched' }));
    const builder = await runDockerStage({ name: operations[0], image: input.image, files: input.delivered, argv: request.builderArgv, submission: true, deadline });
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
        const stage = await runDockerStage({ name: operations[i + 1], image: input.image, files: artifact.files, argv: c.argv, stdin: c.stdin, deadline });
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
      settlement, resources: { wallMs: Date.now() - start, source: 'observed-clock', coverage: 'dispatch-execution-evaluation-cleanup; excludes preflight and admission', currencyUsd: null, cpuMs: null, activeHumanMinutes: null } });
    return { action: 'run', preview: false, recovered: false, slot, status: result.status, intent, result, verdict };
  } finally { await release(); }
}

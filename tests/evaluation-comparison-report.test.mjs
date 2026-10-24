// Synthetic Acme receipts; no Docker, provider, network or execution effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeComparison, renderComparison } from '../lib/evaluation-comparison-report.mjs';
import { sealRecord, fingerprint } from '../lib/evaluation-records.mjs';
import { acmeEvaluationPlan } from './helpers/evaluation-plan.mjs';
const ref = r => ({ kind: r.kind, id: r.id, digest: r.digest });
function fixture() {
  const bundle = acmeEvaluationPlan();
  bundle.materials[0] = sealRecord({ ...bundle.materials[0], content: JSON.stringify({ driver: 'stdio-v1', checks: [{ id: 'acme-output', stdout: 'Acme', exitCode: 0 }] }) });
  bundle.cases[0] = sealRecord({ ...bundle.cases[0], acceptanceManifest: ref(bundle.materials[0]) });
  bundle.cases.push(sealRecord({ ...bundle.cases[0], id: 'acme-control', taskClass: 'control' }));
  bundle.configurations = bundle.configurations.map(c => sealRecord({ ...c, provider: 'offline', runtime: { ...c.runtime, name: 'scripted-node-v1' }, model: { requested: 'none', resolved: 'offline-no-model', unresolvedReason: null } }));
  bundle.comparison = sealRecord({ ...bundle.comparison, baseline: ref(bundle.configurations[0]), candidate: ref(bundle.configurations[1]), cases: bundle.cases.map(ref),
    pairs: bundle.cases.flatMap((c, j) => Array.from({ length: 5 }, (_, n) => ({ id: `acme-pair-${j}-${n}`, case: ref(c), order: n % 2 ? 'BA' : 'AB' }))) });
  const plan = { digest: fingerprint(bundle), bundle }, execution = { status: 'complete', reservation: null, trials: [], issues: [] };
  const controllerBody = { nodeVersion: 'v24.22.1', sources: [{ path: 'lib/evaluation-execution.mjs', byteDigest: 'c'.repeat(64) }] };
  const controller = { ...controllerBody, digest: fingerprint(controllerBody) };
  function trial(pair, arm, outcome = 'accepted', cost = 1) {
    const task = bundle.cases.find(c => c.id === pair.case.id), config = bundle.configurations[arm === 'baseline' ? 0 : 1];
    const slot = pair.id + '-' + arm;
    const input = { planDigest: plan.digest, request: { pairId: pair.id, arm }, taskDigest: task.digest, configurationDigest: config.digest,
      checkManifestDigest: task.acceptanceManifest.digest, controller, image: { id: 'sha256:' + 'd'.repeat(64), requested: task.environment.image, platform: task.environment.platform, inherited: ['NODE_VERSION=24.22.1'], nodeVersion: '24.22.1' }, sourceDigest: 'a'.repeat(64) };
    const base = { schemaVersion: 2, id: slot, createdAt: '2026-10-23T00:00:00.000Z' };
    const intent = sealRecord({ ...base, kind: 'evaluation-intent', slot, input, previewDigest: fingerprint(input), attempt: 1, parentAttemptId: null, repairRounds: 0, interventions: [] });
    const record = (kind, data) => sealRecord({ ...base, kind, intentDigest: intent.digest, ...data });
    const artifact = record('evaluation-artifact', { files: [], filesDigest: fingerprint([]), sourceDigest: input.sourceDigest });
    const stage = record('evaluation-stage', { stage: { setup: 'passed', error: null, termination: { state: 'terminated' }, output: { exit: 0, signal: null, stdout: outcome === 'accepted' ? 'Acme' : 'wrong' } } });
    const verdict = record('evaluation-verdict', { artifactDigest: artifact.digest, checkManifestDigest: input.checkManifestDigest,
      evaluator: { controller, image: input.image }, acceptance: outcome, failureCategory: outcome === 'accepted' ? null : outcome === 'rejected' ? 'acceptance' : 'setup',
      checks: [{ id: 'acme-output', status: outcome === 'accepted' ? 'passed' : 'failed', observationDigest: stage.digest }] });
    const result = record('evaluation-result', { status: 'terminal', verdictDigest: verdict.digest, validation: outcome === 'accepted' ? 'passed' : outcome === 'rejected' ? 'failed' : 'unknown',
      settlement: { released: true }, resources: { wallMs: 100, currencyUsd: cost, cpuMs: null, activeHumanMinutes: null } });
    return { slot, status: 'terminal', records: Object.fromEntries(Object.entries({ intent, artifact, verdict, result, 'check-0': stage }).map(([key, receipt]) => [key, JSON.parse(JSON.stringify(receipt))])) };
  }
  for (const pair of bundle.comparison.pairs) for (const arm of ['baseline', 'candidate']) execution.trials.push(trial(pair, arm));
  return { plan, execution, trial };
}
test('twenty-slot mixed outcomes preserve raw denominators, missing pairs, drift, costs and controls', () => {
  const { plan, execution, trial } = fixture(), pairs = plan.bundle.comparison.pairs;
  execution.trials[0] = trial(pairs[0], 'baseline', 'rejected', 2);
  execution.trials[11] = trial(pairs[5], 'candidate', 'rejected', 3);
  execution.trials[4] = trial(pairs[2], 'baseline', 'unknown', 4);
  execution.trials[7] = trial(pairs[3], 'candidate', 'accepted', null);
  execution.trials.splice(18, 2);
  const drift = execution.trials[3].records;
  const changedController = { nodeVersion: 'v24.23.0', sources: drift.intent.input.controller.sources };
  drift.intent.input.controller = { ...changedController, digest: fingerprint(changedController) };
  drift.intent.previewDigest = fingerprint(drift.intent.input);
  const oldDigest = drift.intent.digest;
  drift.intent = sealRecord(drift.intent);
  for (const [k, r] of Object.entries(drift)) if (r.intentDigest === oldDigest) drift[k] = sealRecord({ ...r, intentDigest: drift.intent.digest });
  drift.verdict = sealRecord({ ...drift.verdict, evaluator: { ...drift.verdict.evaluator, controller: drift.intent.input.controller }, artifactDigest: drift.artifact.digest,
    checks: [{ ...drift.verdict.checks[0], observationDigest: drift['check-0'].digest }] });
  drift.result = sealRecord({ ...drift.result, verdictDigest: drift.verdict.digest });
  const report = summarizeComparison(plan, execution);
  assert.equal(report.pairs.length, 10); assert.equal(report.slots.length, 20); assert.equal(report.attempts.length, 18);
  assert.equal(report.arms.baseline.accepted, 7); assert.equal(report.arms.baseline.denominator, 10);
  assert.equal(report.arms.baseline.failures.setup, 1); assert.equal(report.arms.baseline.missing, 1);
  assert.equal(report.cases[0].discordant.baselineFailCandidatePass, 1);
  assert.equal(report.cases[1].discordant.baselinePassCandidateFail, 1);
  assert.ok(report.pairs[1].exclusions.includes('controller-unknown-or-drift'));
  assert.equal(report.arms.candidate.currencyUsd.costPerAcceptedOutcome, null);
  assert.equal(report.arms.candidate.currencyUsd.knownSubtotal, 10);
  assert.equal(report.status, 'incomplete'); assert.equal(report.screening.eligible, false);
  assert.equal(report.recommendation.disposition, 'inconclusive'); assert.equal(report.recommendation.agentEfficacy, false);
  const markdown = renderComparison(report);
  assert.match(markdown, /control regression/); assert.match(markdown, /3 \/ 5/); assert.match(markdown, /no agent efficacy/);
  assert.match(markdown, /unknown/); assert.match(markdown, /check-0:/);
});
test('complete cost includes failed attempts; zero acceptance never divides', () => {
  const { plan, execution, trial } = fixture();
  execution.trials[0] = trial(plan.bundle.comparison.pairs[0], 'baseline', 'rejected', 11);
  let report = summarizeComparison(plan, execution);
  assert.equal(report.arms.baseline.currencyUsd.total, 20);
  assert.equal(report.arms.baseline.currencyUsd.costPerAcceptedOutcome, 20 / 9);
  assert.equal(report.screening.eligible, true);
  execution.trials = execution.trials.map(t => trial(plan.bundle.comparison.pairs.find(p => t.slot === p.id + '-baseline' || t.slot === p.id + '-candidate'), t.records.intent.input.request.arm, 'rejected', 0));
  report = summarizeComparison(plan, execution);
  assert.equal(report.arms.baseline.currencyUsd.total, 0); assert.equal(report.arms.baseline.currencyUsd.costPerAcceptedOutcome, null);
  assert.equal(report.arms.baseline.accepted, 0); assert.equal(report.arms.baseline.completed, 10);
});
test('missing and malformed outcome chains never turn claims into acceptance', () => {
  for (const corrupt of [
    r => { delete r.result; }, r => { delete r.verdict; }, r => { delete r.artifact; }, r => { delete r['check-0']; },
    r => { r.verdict.acceptance = 'rejected'; },
    r => { r.result = sealRecord({ ...r.result, verdictDigest: '0'.repeat(64) }); },
    r => { r.verdict = { acceptance: 'accepted' }; r.result = { status: 'terminal', validation: 'passed' }; },
  ]) {
    const { plan, execution } = fixture(); corrupt(execution.trials[0].records);
    const report = summarizeComparison(plan, execution);
    assert.equal(report.arms.baseline.accepted, 9); assert.equal(report.slots[0].outcome, 'unknown'); assert.equal(report.pairs[0].comparable, false);
  }
});
test('empty execution, duplicates, unknown intervention and resource coverage remain explicit', () => {
  const { plan, execution } = fixture();
  let report = summarizeComparison(plan, null);
  assert.equal(report.arms.baseline.missing, 10); assert.equal(report.arms.baseline.currencyUsd.total, null);
  assert.equal(report.arms.baseline.resources.wallMs.median, null);
  execution.trials.push(structuredClone(execution.trials[0]));
  report = summarizeComparison(plan, execution);
  assert.equal(report.attempts.length, 21); assert.equal(report.arms.baseline.accepted, 9); assert.equal(report.slots[0].status, 'invalid');
  assert.equal(report.arms.baseline.resources.cpuMs.observed, 0);
  assert.equal(report.arms.baseline.interventions.recordsPresent, 11); assert.equal(report.arms.baseline.interventions.recordedSubtotal, 0);
  assert.equal(report.arms.baseline.resources.activeHumanMinutes.observed, 0);
  assert.equal(report.arms.baseline.resources.wallMs.median, 100);
  const before = JSON.stringify({ plan, execution }); summarizeComparison(plan, execution); assert.equal(JSON.stringify({ plan, execution }), before);
});
test('unknown model aliases do not establish a comparable cohort', () => {
  const { plan, execution } = fixture();
  plan.bundle.configurations[0].model.resolved = null;
  const report = summarizeComparison(plan, execution);
  assert.equal(report.pairs.filter(p => p.comparable).length, 0);
  assert.ok(report.pairs[0].exclusions.includes('unresolved-model-alias'));
});

test('malformed sealed artifact fields and unsupported acceptance manifests fail closed', () => {
  for (const corrupt of [
    r => { delete r.artifact.files; r.artifact = sealRecord(r.artifact); r.verdict = sealRecord({ ...r.verdict, artifactDigest: r.artifact.digest }); r.result = sealRecord({ ...r.result, verdictDigest: r.verdict.digest }); },
    r => { r.verdict = sealRecord({ ...r.verdict, checks: null }); r.result = sealRecord({ ...r.result, verdictDigest: r.verdict.digest }); },
  ]) {
    const { plan, execution } = fixture(); corrupt(execution.trials[0].records);
    const report = summarizeComparison(plan, execution);
    assert.equal(report.slots[0].outcome, 'unknown');
  }
  const { plan, execution } = fixture(); plan.bundle.materials[0].content = 'not an acceptance manifest';
  assert.equal(summarizeComparison(plan, execution).arms.baseline.accepted, 0);
});
test('unavailable records preserve attempts and unknown interventions rather than claiming zero', () => {
  const { plan, execution } = fixture();
  execution.trials[0] = { slot: execution.trials[0].slot, status: 'uncertain', reason: 'trial-record-unavailable' };
  execution.issues.push({ record: 'acme-pair-0-0-baseline', reason: 'trial-record-unavailable' });
  const report = summarizeComparison(plan, execution);
  assert.equal(report.attempts.length, 20); assert.equal(report.arms.baseline.interventions.recordsPresent, 9);
  assert.equal(report.arms.baseline.repairRounds.recordsPresent, 9); assert.equal(report.arms.baseline.currencyUsd.observed, 9);
  assert.equal(report.arms.baseline.currencyUsd.total, null); assert.equal(report.arms.baseline.invalid, 1);
  assert.equal(report.issues.length, 1);
});
test('actual environment drift and unknown live model identity exclude matched aliases', () => {
  const { plan, execution } = fixture();
  plan.bundle.configurations.forEach(c => { c.provider = 'Acme'; });
  const report = summarizeComparison(plan, execution);
  assert.ok(report.pairs.every(p => p.exclusions.includes('model-unknown-or-drift')));
  assert.ok(report.pairs.every(p => p.exclusions.includes('environment-unknown-or-drift')));
  assert.equal(report.screening.eligible, false);
});

test('phase-118 separately deserialized image receipts preserve accepted and comparable pairs', () => {
  const { plan, execution } = fixture();
  const r = execution.trials[0].records;
  assert.notEqual(r.intent.input.image, r.verdict.evaluator.image);
  assert.deepEqual(r.intent.input.image, r.verdict.evaluator.image);
  // Docker RepoDigests may identify the requested manifest while Id identifies
  // the resolved local image. They need not be the same digest.
  assert.notEqual(r.intent.input.image.id, r.intent.input.image.requested);
  const report = summarizeComparison(plan, execution);
  assert.equal(report.arms.baseline.accepted, 10);
  assert.equal(report.arms.candidate.accepted, 10);
  assert.equal(report.pairs.filter(p => p.comparable).length, 10);
});

function rebind(records, change) {
  change(records.intent.input);
  records.intent.previewDigest = fingerprint(records.intent.input);
  records.intent = sealRecord(records.intent);
  for (const [key, record] of Object.entries(records)) if (key !== 'intent') records[key] = sealRecord({ ...record, intentDigest: records.intent.digest });
  records.verdict = sealRecord({ ...records.verdict, artifactDigest: records.artifact.digest,
    evaluator: { ...records.verdict.evaluator, image: structuredClone(records.intent.input.image), controller: structuredClone(records.intent.input.controller) },
    checks: records.verdict.checks.map((c, index) => ({ ...c, observationDigest: records[`check-${index}`].digest })) });
  records.result = sealRecord({ ...records.result, verdictDigest: records.verdict.digest });
}
test('image request, platform and resolved identity must be bound, and controller content must match its digest', () => {
  for (const mutate of [
    i => { i.image.requested = 'sha256:' + 'f'.repeat(64); },
    i => { i.image.platform = 'linux/amd64'; },
    i => { i.image.id = 'latest'; },
    i => { i.controller.sources[0].byteDigest = 'f'.repeat(64); },
    i => { i.controller = { digest: 'c'.repeat(64) }; },
  ]) {
    const { plan, execution } = fixture();
    rebind(execution.trials[0].records, mutate);
    rebind(execution.trials[1].records, mutate);
    const report = summarizeComparison(plan, execution);
    assert.equal(report.pairs[0].comparable, false);
    assert.ok(report.pairs[0].exclusions.some(r => ['image-differs-from-frozen-environment', 'unknown-controller'].includes(r)));
  }
  const { plan, execution } = fixture();
  rebind(execution.trials[1].records, i => { i.image.id = 'sha256:' + 'e'.repeat(64); });
  assert.ok(summarizeComparison(plan, execution).pairs[0].exclusions.includes('image-unknown-or-drift'));
});
function reconciledFixture() {
  const { plan, execution } = fixture(), trial = execution.trials[0], records = trial.records;
  records.intent = sealRecord({ ...records.intent, operations: ['plates-eval-acme-builder'] });
  const base = { schemaVersion: 2, id: records.intent.id, createdAt: records.intent.createdAt, intentDigest: records.intent.digest };
  const lease = sealRecord({ ...base, kind: 'evaluation-lease', lease: { id: records.intent.id } });
  const observations = [{ operation: records.intent.operations[0], state: 'terminated', containerId: 'a'.repeat(64), running: false }];
  const settlement = { id: records.intent.id, commandDigest: records.intent.previewDigest, released: true, observations };
  const recovery = sealRecord({ ...base, kind: 'evaluation-reconciliation', originalEvidence: { intent: records.intent.digest, lease: lease.digest },
    observations, settlement, status: 'terminal', acceptance: 'unknown', reason: 'recovered-operation; missing evidence remains unavailable', inputDigest: 'b'.repeat(64) });
  // This is inspectExecutions' current in-memory projection, not forged sealed
  // result/verdict records. Each retained record is deserialized independently.
  trial.records = Object.fromEntries(Object.entries({ intent: records.intent, lease, [`reconciliation-${recovery.digest}`]: recovery,
    verdict: { kind: 'evaluation-verdict', digest: recovery.digest, acceptance: 'unknown', artifactDigest: null, failureCategory: 'missing-evidence', checks: [] },
    result: { kind: 'evaluation-result', digest: recovery.digest, status: 'terminal', verdictDigest: recovery.digest, settlement,
      setup: 'unknown', execution: 'unknown', validation: 'unknown', resources: { currencyUsd: null, wallMs: null, activeHumanMinutes: null } },
  }).map(([key, record]) => [key, JSON.parse(JSON.stringify(record))]));
  trial.history = [JSON.parse(JSON.stringify(recovery))];
  return { plan, execution, trial };
}
test('confirmed reconciliation counts termination but never reconstructs acceptance or cost', () => {
  const { plan, execution } = reconciledFixture();
  const report = summarizeComparison(plan, execution);
  assert.equal(report.arms.baseline.completed, 10); assert.equal(report.arms.baseline.accepted, 9);
  assert.equal(report.slots[0].outcome, 'unknown'); assert.equal(report.attempts[0].recovered, true);
  assert.equal(report.arms.baseline.failures['missing-evidence'], 1);
  assert.equal(report.arms.baseline.currencyUsd.total, null); assert.equal(report.pairs[0].comparable, false);
  assert.ok(report.attempts[0].evidence.some(e => e.record.startsWith('reconciliation-')));
});
test('reconciliation projection without its bound original receipt cannot establish termination or acceptance', () => {
  for (const mutate of [
    t => { delete t.records[Object.keys(t.records).find(k => k.startsWith('reconciliation-'))]; },
    t => { t.records.verdict.acceptance = 'accepted'; },
    t => { t.records.result.settlement.released = false; },
    t => { const key = Object.keys(t.records).find(k => k.startsWith('reconciliation-')); t.records[key] = sealRecord({ ...t.records[key], intentDigest: 'f'.repeat(64) }); },
  ]) {
    const { plan, execution, trial } = reconciledFixture(); mutate(trial);
    const report = summarizeComparison(plan, execution);
    assert.equal(report.arms.baseline.completed, 9); assert.equal(report.arms.baseline.accepted, 9);
    assert.equal(report.slots[0].outcome, 'unknown');
  }
});

test('empty initial declarations never establish zero actual human help or complete coverage', () => {
  const { plan, execution } = fixture();
  const report = summarizeComparison(plan, execution);
  for (const metric of ['interventions', 'repairRounds']) {
    assert.equal(report.arms.baseline[metric].recordedSubtotal, 0);
    assert.equal(report.arms.baseline[metric].recordsPresent, 10);
    assert.equal(report.arms.baseline[metric].actualCount, null);
    assert.equal(report.arms.baseline[metric].actualCoverage, 'unknown');
  }
  assert.match(renderComparison(report), /Actual human help and repair coverage unknown/);
});
function derivedRecoveryFixture(acceptance) {
  const { plan, execution } = fixture(), trial = execution.trials[0], r = trial.records;
  r.intent.operations = ['plates-eval-acme-builder'];
  rebind(r, () => {});
  const base = { schemaVersion: 2, id: r.intent.id, createdAt: r.intent.createdAt, intentDigest: r.intent.digest };
  r.lease = sealRecord({ ...base, kind: 'evaluation-lease', lease: { id: r.intent.id } });
  delete r.result;
  if (acceptance === 'unknown') delete r.verdict;
  const inputDigest = 'b'.repeat(64), observations = [{ operation: r.intent.operations[0], state: 'terminated', containerId: 'a'.repeat(64), running: false }];
  const settlement = { id: r.intent.id, commandDigest: r.intent.previewDigest, released: true, observations };
  const verdict = r.verdict ?? sealRecord({ ...base, kind: 'evaluation-verdict', recoveryInputDigest: inputDigest,
    artifactDigest: r.artifact.digest, checkManifestDigest: r.intent.input.checkManifestDigest,
    evaluator: { controller: r.intent.input.controller, image: r.intent.input.image }, acceptance: 'unknown', failureCategory: 'missing-evidence', checks: [] });
  const result = sealRecord({ ...base, kind: 'evaluation-result', recoveryInputDigest: inputDigest, status: 'terminal', verdictDigest: verdict.digest,
    settlement, validation: acceptance === 'accepted' ? 'passed' : 'unknown', resources: { currencyUsd: null, wallMs: null } });
  const receipt = sealRecord({ ...base, kind: 'evaluation-reconciliation', inputDigest, result, verdict, settlement, observations,
    originalEvidence: Object.fromEntries(Object.entries(r).map(([key, record]) => [key, record.digest])), status: 'terminal', acceptance });
  r[`reconciliation-${receipt.digest}`] = JSON.parse(JSON.stringify(receipt));
  trial.recovery = JSON.parse(JSON.stringify({ receipt, result, verdict }));
  trial.history = [JSON.parse(JSON.stringify(receipt))];
  return { plan, execution, trial };
}
test('derived recovery keeps original acceptance and new result provenance without assuming human help coverage', () => {
  for (const acceptance of ['accepted', 'unknown']) {
    const { plan, execution } = derivedRecoveryFixture(acceptance);
    const report = summarizeComparison(plan, execution);
    assert.equal(report.arms.baseline.completed, 10);
    assert.equal(report.arms.baseline.accepted, acceptance === 'accepted' ? 10 : 9);
    assert.equal(report.attempts[0].recovered, true);
    assert.equal(report.attempts[0].recoveryInputDigest, 'b'.repeat(64));
    assert.equal(report.arms.baseline.currencyUsd.total, null);
    assert.equal(report.arms.baseline.interventions.actualCount, null);
    assert.equal(report.attempts[0].outcome, acceptance);
    assert.ok(report.attempts[0].evidence.some(e => e.record.startsWith('reconciliation-')));
  }
});
test('unbound derived recovery and changed original evidence cannot establish acceptance', () => {
  for (const corrupt of [
    t => { t.recovery.result = sealRecord({ ...t.recovery.result, recoveryInputDigest: 'f'.repeat(64) }); },
    t => { delete t.records[Object.keys(t.records).find(k => k.startsWith('reconciliation-'))]; },
    t => { t.records.lease = sealRecord({ ...t.records.lease, lease: { id: 'other' } }); },
  ]) {
    const { plan, execution, trial } = derivedRecoveryFixture('accepted'); corrupt(trial);
    const report = summarizeComparison(plan, execution);
    assert.equal(report.slots[0].outcome, 'unknown'); assert.equal(report.arms.baseline.accepted, 9);
  }
});

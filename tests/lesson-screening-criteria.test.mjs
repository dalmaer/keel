// Acme synthetic projection arithmetic only: no live provider, execution or efficacy evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScreeningCriteria, screenComparison, validateScreeningResult } from '../lib/lesson-screening-criteria.mjs';
const clone = x => structuredClone(x);
const criteria = () => ({ schemaVersion: 1, targetCaseIds: ['acme-target'], controlCaseIds: ['acme-control'], minimumComparablePairsPerCase: 5,
  minimumTargetNetGains: 1, maxControlRegressions: 0, maxAdditionalCurrencyUsd: 2, maxAdditionalMedianWallMs: 10,
  comparability: 'actual-identity-v1', missingEvidence: 'inconclusive' });
function fixture({ offline = false, count = 5 } = {}) {
  const model = { requested: 'acme-model', resolved: 'acme-pinned-model', unresolvedReason: null };
  const environment = { image: 'sha256:' + 'a'.repeat(64), platform: 'linux/amd64', dependencyLock: 'b'.repeat(64), installer: 'c'.repeat(64) };
  const configuration = { provider: offline ? 'offline' : 'acme-synthetic-provider', runtime: { name: offline ? 'scripted-node-v1' : 'acme-synthetic-runtime', version: '1' }, model, environment };
  const report = { schemaVersion: 1, comparisonId: 'acme-screening', planDigest: 'd'.repeat(64), status: 'completed',
    cases: [{ id: 'acme-target', taskClass: 'package' }, { id: 'acme-control', taskClass: 'control' }], pairs: [], slots: [], attempts: [], unplannedAttempts: [], issues: [],
    recommendation: { disposition: 'inconclusive', automaticPromotion: false, agentEfficacy: false },
    candidate: { baselineConfiguration: clone(configuration), candidateConfiguration: clone(configuration) }, limitations: [] };
  for (const c of report.cases) for (let n = 0; n < count; n++) {
    const pair = { id: `${c.id}-${n}`, caseId: c.id, order: n % 2 ? 'BA' : 'AB', slots: [], completed: true, comparable: true, exclusions: [],
      baseline: c.id === 'acme-target' && n === 0 ? 'rejected' : 'accepted', candidate: 'accepted' };
    for (const arm of ['baseline', 'candidate']) {
      const slot = pair.id + '-' + arm, outcome = pair[arm]; pair.slots.push(slot);
      const a = { slot, pairId: pair.id, caseId: c.id, arm, attemptId: slot, attempt: 1, parentAttemptId: null,
        status: 'completed', terminal: true, outcome, failureCategory: outcome === 'rejected' ? 'acceptance' : null,
        identity: { controller: { digest: 'e'.repeat(64), nodeVersion: 'v24.22.1', sources: [{ path: 'acme.mjs', byteDigest: 'f'.repeat(64) }] },
          image: { id: environment.image, requested: environment.image, platform: environment.platform, inherited: [], nodeVersion: '24.22.1' },
          model: clone(model), environment: clone(environment), sourceDigest: '1'.repeat(64), taskDigest: '2'.repeat(64), checkManifestDigest: '3'.repeat(64) },
        resources: { currencyUsd: 1, wallMs: arm === 'candidate' ? 105 : 100 }, interventions: [], repairRounds: 0, evidence: [] };
      report.attempts.push(a); report.slots.push({ slot, pairId: pair.id, caseId: c.id, arm, attempts: [a], status: 'completed', outcome });
    }
    report.pairs.push(pair);
  }
  return report;
}
function regress(r) {
  const p = r.pairs.find(p => p.caseId === 'acme-control'); p.candidate = 'rejected';
  const s = r.slots.find(s => s.slot === p.slots[1]); s.outcome = 'rejected'; s.attempts[0].outcome = 'rejected'; s.attempts[0].failureCategory = 'acceptance';
}
function missing(r, index) {
  const s = r.slots[index]; r.attempts = r.attempts.filter(a => a.slot !== s.slot); s.attempts = []; s.status = 'missing'; s.outcome = 'unknown';
  const p = r.pairs.find(p => p.id === s.pairId); p[s.arm] = 'unknown'; p.completed = false; p.comparable = false; p.exclusions = ['incomplete']; r.status = 'incomplete';
}
const target = result => result.caseResults.find(c => c.caseId === 'acme-target');
const control = result => result.caseResults.find(c => c.caseId === 'acme-control');
test('strict criteria permit null and require complete disjoint target/control case sets', () => {
  const ids = ['acme-target', 'acme-control']; assert.equal(validateScreeningCriteria(null, ids), null);
  assert.deepEqual(validateScreeningCriteria(criteria(), ids), criteria());
  for (const change of [c => { c.extra = true; }, c => { c.minimumComparablePairsPerCase = 4; }, c => { c.minimumTargetNetGains = 0; },
    c => { c.maxControlRegressions = 1; }, c => { c.maxAdditionalCurrencyUsd = null; }, c => { c.maxAdditionalMedianWallMs = Infinity; },
    c => { c.controlCaseIds = ['acme-target']; }, c => { c.controlCaseIds = []; }, c => { c.targetCaseIds.push('acme-other'); },
    c => { c.comparability = 'trust-alias'; }, c => { c.missingEvidence = 'passed'; }]) { const c = criteria(); change(c); assert.throws(() => validateScreeningCriteria(c, ids)); }
});
test('synthetic supported arithmetic ignores reporter fixed efficacy flag; no held-out requirement', () => {
  const r = fixture(), original = clone(r), result = screenComparison(criteria(), r);
  assert.equal(result.disposition, 'supported'); assert.equal(result.method, 'paired-screening-v1'); assert.deepEqual(r, original);
  assert.equal(target(result).criteria.targetNetGains.observed, 1); assert.equal(target(result).arms.baseline.accepted, 4);
  assert.equal(target(result).arms.baseline.denominator, 5); assert.equal(target(result).arms.baseline.currencyUsd.total, 5);
  assert.equal(target(result).arms.baseline.currencyUsd.costPerAcceptedOutcome, 1.25);
  assert.deepEqual(result, screenComparison(criteria(), JSON.parse(JSON.stringify(r))));
  assert.equal(validateScreeningResult(result), result);
});
test('offline and null criteria stay inconclusive, retaining visible failures and controls', () => {
  const r = fixture({ offline: true }); regress(r);
  const result = screenComparison(criteria(), r); assert.equal(result.disposition, 'inconclusive');
  assert.equal(control(result).criteria.controlRegressions.status, 'failed'); assert(result.reasons.includes('offline-scripted-no-agent-efficacy'));
  const unset = screenComparison(null, fixture()); assert.equal(unset.disposition, 'inconclusive');
  assert.equal(target(unset).role, 'unclassified'); assert.equal(target(unset).criteria.targetNetGains.status, 'unknown');
});
test('known failed criteria reject; missing required evidence dominates while regression remains visible', () => {
  const r = fixture(); regress(r); assert.equal(screenComparison(criteria(), r).disposition, 'rejected');
  r.attempts[0].resources.currencyUsd = null;
  const result = screenComparison(criteria(), r); assert.equal(result.disposition, 'inconclusive');
  assert.equal(control(result).criteria.controlRegressions.status, 'failed'); assert.equal(target(result).criteria.additionalCurrencyUsd.status, 'unknown');
  assert.equal(target(result).arms.baseline.currencyUsd.knownSubtotal, 4); assert.equal(target(result).arms.baseline.currencyUsd.total, null);
});
test('wall-time coverage, arithmetic tolerances and per-case floors are explicit', () => {
  const r = fixture(); r.attempts[1].resources.wallMs = null;
  let result = screenComparison(criteria(), r); assert.equal(result.disposition, 'inconclusive'); assert.equal(target(result).arms.candidate.wallMs.observed, 4);
  assert.equal(target(result).criteria.additionalMedianWallMs.observed, null);
  const c = criteria(); c.maxAdditionalMedianWallMs = 4; assert.equal(screenComparison(c, fixture()).disposition, 'rejected');
  result = screenComparison(criteria(), fixture({ count: 4 })); assert.equal(result.disposition, 'inconclusive');
  assert.equal(target(result).criteria.comparablePairs.status, 'failed');
});
test('all twenty slots and failed-attempt costs count; zero accepted never divides', () => {
  const r = fixture(); r.attempts[0].resources.currencyUsd = 11;
  let result = screenComparison(criteria(), r); assert.equal(target(result).arms.baseline.currencyUsd.total, 15);
  assert.equal(target(result).arms.baseline.currencyUsd.costPerAcceptedOutcome, 15 / 4);
  for (const p of r.pairs) p.baseline = p.candidate = 'rejected';
  for (const s of r.slots) { s.outcome = 'rejected'; for (const a of s.attempts) { a.outcome = 'rejected'; a.failureCategory = 'acceptance'; a.resources.currencyUsd = 0; } }
  result = screenComparison(criteria(), r); assert.equal(target(result).arms.baseline.currencyUsd.total, 0);
  assert.equal(target(result).arms.baseline.currencyUsd.costPerAcceptedOutcome, null); assert.equal(target(result).arms.baseline.failed, 5);
});
test('mixed missing pair, drift, unknown costs and regression remain inconclusive with raw denominators', () => {
  const r = fixture(); regress(r); missing(r, 4); missing(r, 5); r.attempts[1].resources.currencyUsd = null;
  r.pairs[1].comparable = false; r.pairs[1].exclusions = ['controller-unknown-or-drift'];
  r.slots[2].attempts[0].identity.controller.digest = '4'.repeat(64);
  const result = screenComparison(criteria(), r); assert.equal(result.disposition, 'inconclusive');
  assert.equal(target(result).arms.baseline.denominator, 5); assert.equal(target(result).arms.baseline.missing, 1);
  assert.equal(target(result).comparablePairs, 3); assert.equal(control(result).discordant.baselinePassCandidateFail, 1);
});
test('unplanned and unknown-case/arm resources stay retained and bar support', () => {
  const r = fixture(); const extra = { ...clone(r.attempts[0]), slot: 'acme-unplanned', caseId: null, arm: null, failureCategory: 'setup', resources: { currencyUsd: null, wallMs: 75 } };
  r.attempts.push(extra); r.unplannedAttempts.push(extra);
  const result = screenComparison(criteria(), r); assert.equal(result.disposition, 'inconclusive');
  const u = result.caseResults.find(c => c.role === 'unassigned'); assert.equal(u.arms.unassigned.attempts, 1);
  assert.equal(u.arms.unassigned.currencyUsd.denominator, 1); assert.equal(u.arms.unassigned.currencyUsd.observed, 0);
  assert.deepEqual(u.arms.unassigned.wallMs.raw, [75]); assert.equal(u.arms.unassigned.failures.setup, 1);
  assert.equal(target(result).arms.baseline.attempts, 5);
});
test('duplicate attempts, unresolved actual identity and opaque aliases cannot support', () => {
  for (const change of [r => { const a = clone(r.attempts[0]); r.slots[0].attempts.push(a); r.attempts.splice(1, 0, a); },
    r => { r.attempts[0].identity.model.resolved = null; }, r => { r.attempts[0].identity = null; },
    r => { r.candidate.candidateConfiguration.model.resolved = null; }, r => { r.attempts[0].attempt = 2; },
    r => { r.attempts[0].identity.image.requested = 'sha256:' + '9'.repeat(64); }]) {
    const r = fixture(); change(r); assert.equal(screenComparison(criteria(), r).disposition, 'inconclusive');
  }
});
test('initial empty declarations retain recorded zero without asserting actual human help coverage', () => {
  const r = fixture(); r.attempts[0].interventions = null; r.attempts[0].repairRounds = null;
  const a = target(screenComparison(criteria(), r)).arms.baseline;
  assert.deepEqual(a.interventions, { recordedSubtotal: 0, recordsPresent: 4, denominator: 5, actualCount: null, actualCoverage: 'unknown' });
  assert.deepEqual(a.repairRounds, a.interventions);
});
test('retained result validator rejects unknown fields, inconsistent totals, fake coverage and changed thresholds', () => {
  const valid = screenComparison(criteria(), fixture());
  for (const change of [r => { r.approved = true; }, r => { target(r).arms.baseline.denominator = 4; },
    r => { target(r).arms.baseline.currencyUsd.costPerAcceptedOutcome = 0; }, r => { target(r).arms.baseline.interventions.actualCount = 0; },
    r => { target(r).criteria.targetNetGains.threshold = 0; }, r => { target(r).arms.baseline.wallMs.observed = 0; },
    r => { target(r).criteria.additionalMedianWallMs.observed = 0; }, r => { target(r).criteria.targetNetGains.status = 'not-applicable'; },
    r => { r.caseResults.push(clone(target(r))); }, r => { target(r).arms.baseline.currencyUsd.knownSubtotal = NaN; }]) {
    const r = clone(valid); change(r); assert.throws(() => validateScreeningResult(r));
  }
  const wrapped = { ...valid, reportDigest: 'a'.repeat(64) };
  assert.doesNotThrow(() => validateScreeningResult(Object.fromEntries(['method', 'disposition', 'caseResults', 'reasons', 'limitations'].map(k => [k, wrapped[k]]))));
});

test('truncated global inventory refuses instead of minting accepted counts', () => {
  const r = fixture(); r.attempts.pop(); assert.throws(() => screenComparison(criteria(), r));
});
test('real reporter empty execution projection is inconclusive, not an absent-data success', async () => {
  const { summarizeComparison } = await import('../lib/evaluation-comparison-report.mjs');
  const { acmeEvaluationPlan } = await import('./helpers/evaluation-plan.mjs');
  const bundle = acmeEvaluationPlan();
  const report = summarizeComparison({ digest: 'a'.repeat(64), bundle }, null);
  const r = screenComparison(null, report);
  assert.equal(r.disposition, 'inconclusive');
  assert.equal(r.caseResults[0].arms.baseline.missing, report.slots.filter(s => s.arm === 'baseline').length);
  assert.equal(r.caseResults[0].arms.baseline.currencyUsd.costPerAcceptedOutcome, null);
});

test('retained result cannot relabel incomplete or unassigned evidence as a decisive rejection', () => {
  for (const r of [fixture({ offline: true, count: 4 }), fixture()]) {
    regress(r); if (r.pairs.length === 10) missing(r, 0);
    const result = screenComparison(criteria(), r); result.disposition = 'rejected';
    assert.throws(() => validateScreeningResult(result));
  }
});

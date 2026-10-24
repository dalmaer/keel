// Pure phase122 arithmetic over a source-verified comparison projection.
// This module never verifies execution authority or grants publication/provider permission.
import { isDeepStrictEqual as same } from 'node:util';
const METHOD = 'paired-screening-v1', ARMS = ['baseline', 'candidate', 'unassigned'];
const check = (ok, code = 'invalid_screening_result') => { if (!ok) throw Object.assign(new Error(code), { code, exitCode: 2 }); };
const object = x => x !== null && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype;
const exact = (x, keys) => check(object(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k)), 'invalid_screening_fields');
const id = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const count = x => Number.isSafeInteger(x) && x >= 0 && x <= 20000;
const amount = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const text = x => typeof x === 'string' && x.length > 0 && Buffer.byteLength(x) <= 4096;
const bounded = (x, max) => check(Array.isArray(x) && x.length <= max, 'screening_array_bound');
const unique = xs => new Set(xs).size === xs.length;

export function validateScreeningCriteria(criteria, caseIds) {
  bounded(caseIds, 20); check(caseIds.length > 0 && caseIds.every(id) && unique(caseIds), 'invalid_screening_cases');
  if (criteria === null) return criteria;
  exact(criteria, ['schemaVersion', 'targetCaseIds', 'controlCaseIds', 'minimumComparablePairsPerCase', 'minimumTargetNetGains',
    'maxControlRegressions', 'maxAdditionalCurrencyUsd', 'maxAdditionalMedianWallMs', 'comparability', 'missingEvidence']);
  const c = criteria;
  for (const key of ['targetCaseIds', 'controlCaseIds']) { bounded(c[key], 20); check(c[key].length > 0 && c[key].every(id), 'invalid_screening_cases'); }
  const selected = [...c.targetCaseIds, ...c.controlCaseIds];
  check(unique(selected) && same([...selected].sort(), [...caseIds].sort()), 'screening_case_coverage');
  check(c.schemaVersion === 1 && Number.isSafeInteger(c.minimumComparablePairsPerCase) && c.minimumComparablePairsPerCase >= 5
    && c.minimumComparablePairsPerCase <= 1000 && Number.isSafeInteger(c.minimumTargetNetGains) && c.minimumTargetNetGains >= 1
    && c.minimumTargetNetGains <= 1000 && c.maxControlRegressions === 0 && amount(c.maxAdditionalCurrencyUsd)
    && amount(c.maxAdditionalMedianWallMs) && c.comparability === 'actual-identity-v1' && c.missingEvidence === 'inconclusive', 'invalid_screening_criteria');
  return criteria;
}
function distribution(raw) {
  const values = raw.map(x => amount(x) ? x : null), sorted = values.filter(amount).sort((a, b) => a - b), n = sorted.length;
  return { observed: n, denominator: values.length, raw: values,
    median: n ? sorted[Math.floor((n - 1) / 2)] / 2 + sorted[Math.floor(n / 2)] / 2 : null,
    min: n ? sorted[0] : null, max: n ? sorted[n - 1] : null };
}
function declarations(attempts, key) {
  const values = attempts.map(a => key === 'interventions' ? Array.isArray(a[key]) ? a[key].length : null : count(a[key]) ? a[key] : null);
  return { recordedSubtotal: values.reduce((n, v) => n + (v ?? 0), 0), recordsPresent: values.filter(v => v !== null).length,
    denominator: attempts.length, actualCount: null, actualCoverage: 'unknown' };
}
function totals(slots, attempts) {
  const accepted = slots.filter(s => s.outcome === 'accepted').length;
  const costs = attempts.map(a => a.resources?.currencyUsd), known = costs.filter(amount);
  const subtotal = known.reduce((n, v) => n + v, 0); check(finite(subtotal), 'screening_numeric_overflow');
  const complete = attempts.length > 0 && known.length === attempts.length && attempts.every(a => a.terminal === true)
    && slots.every(s => s.status === 'completed');
  const failures = {};
  for (const a of attempts) if (a.failureCategory != null) {
    check(text(a.failureCategory) && !['__proto__', 'constructor', 'prototype'].includes(a.failureCategory), 'invalid_screening_failure');
    failures[a.failureCategory] = (failures[a.failureCategory] ?? 0) + 1;
  }
  return { planned: slots.length, attempted: slots.filter(s => s.attempts.length).length, attempts: attempts.length,
    completed: slots.filter(s => s.status === 'completed').length,
    failed: slots.filter(s => s.outcome === 'rejected' || s.attempts.some(a => a.terminal && a.failureCategory)).length,
    invalid: slots.filter(s => s.status === 'invalid').length, missing: slots.filter(s => s.status === 'missing').length,
    accepted, denominator: slots.length, unknown: slots.filter(s => s.outcome === 'unknown').length, failures,
    currencyUsd: { knownSubtotal: subtotal, observed: known.length, denominator: attempts.length, complete,
      total: complete ? subtotal : null, costPerAcceptedOutcome: complete && accepted > 0 ? subtotal / accepted : null },
    wallMs: distribution(attempts.map(a => a.resources?.wallMs)), interventions: declarations(attempts, 'interventions'), repairRounds: declarations(attempts, 'repairRounds') };
}
const metric = (observed, threshold, direction, applicable = true) => ({
  status: !applicable ? 'not-applicable' : observed === null || threshold === null ? 'unknown'
    : (direction === 'minimum' ? observed >= threshold : observed <= threshold) ? 'passed' : 'failed', observed, threshold,
});
const difference = (a, b) => a !== null && b !== null ? a - b : null;
function actualIdentities(report) {
  const configs = ['baseline', 'candidate'].map(arm => report.candidate?.[arm + 'Configuration']);
  const offline = configs.some(c => c?.provider === 'offline' || c?.runtime?.name === 'scripted-node-v1');
  const configured = configs.every(c => text(c?.provider) && text(c?.runtime?.name) && text(c?.model?.resolved) && object(c.environment))
    && configs[0].provider === configs[1].provider && same(configs[0].runtime, configs[1].runtime);
  if (!configured) return { offline, known: false };
  const known = report.attempts.every(a => {
    const x = a.identity, config = configs[a.arm === 'baseline' ? 0 : 1];
    return ['baseline', 'candidate'].includes(a.arm) && x && hash(x.controller?.digest) && text(x.controller.nodeVersion)
      && Array.isArray(x.controller.sources) && x.controller.sources.length > 0 && x.controller.sources.every(s => text(s.path) && hash(s.byteDigest))
      && /^sha256:[a-f0-9]{64}$/.test(x.image?.id ?? '') && x.image.requested === config.environment.image && x.image.platform === config.environment.platform
      && hash(x.sourceDigest) && hash(x.taskDigest) && hash(x.checkManifestDigest)
      && text(x.model?.resolved) && x.model.resolved === config.model.resolved && same(x.environment, config.environment)
      && a.attempt === 1 && a.parentAttemptId === null && text(a.attemptId);
  }) && report.pairs.every(p => {
    const xs = p.slots.map(slot => report.attempts.filter(a => a.slot === slot));
    return xs.length === 2 && xs.every(x => x.length === 1)
      && ['controller', 'image', 'sourceDigest', 'taskDigest', 'checkManifestDigest', 'model', 'environment'].every(k => same(xs[0][0].identity?.[k], xs[1][0].identity?.[k]));
  });
  return { offline, known };
}
function reportShape(r) {
  check(object(r) && r.schemaVersion === 1 && ['completed', 'incomplete'].includes(r.status), 'invalid_screening_report');
  for (const [key, max] of [['cases', 20], ['pairs', 1000], ['slots', 2000], ['attempts', 20000], ['unplannedAttempts', 20000], ['issues', 20000]]) bounded(r[key], max);
  check(r.cases.length > 0 && r.cases.every(c => id(c.id)) && unique(r.cases.map(c => c.id)), 'invalid_screening_cases');
  check(r.pairs.every(p => id(p.id) && r.cases.some(c => c.id === p.caseId) && Array.isArray(p.slots) && p.slots.length === 2
    && typeof p.comparable === 'boolean' && typeof p.completed === 'boolean' && Array.isArray(p.exclusions)) && unique(r.pairs.map(p => p.id)), 'invalid_screening_pairs');
  check(r.slots.every(s => text(s.slot) && r.cases.some(c => c.id === s.caseId) && ['baseline', 'candidate'].includes(s.arm)
    && ['missing', 'invalid', 'completed'].includes(s.status) && ['accepted', 'rejected', 'unknown'].includes(s.outcome) && Array.isArray(s.attempts))
    && unique(r.slots.map(s => s.slot)), 'invalid_screening_slots');
  check(r.attempts.every(a => object(a) && text(a.slot)), 'invalid_screening_attempts');
}
/** Primary must supply a verified projection; this pure function cannot authenticate JSON. */
export function screenComparisonV1(criteria, report) {
  reportShape(report); validateScreeningCriteria(criteria, report.cases.map(c => c.id));
  const reasons = [], blockers = [];
  const block = reason => { blockers.push(reason); reasons.push(reason); };
  if (criteria === null) block('criteria-unset');
  const identities = actualIdentities(report);
  if (identities.offline) block('offline-scripted-no-agent-efficacy');
  else if (!identities.known) block('actual-execution-identities-unavailable-or-drifted');
  if (report.status !== 'completed') block('report-incomplete');
  if (report.issues.length) block('execution-issues');
  const expected = report.slots.flatMap(s => s.attempts), unplanned = report.attempts.filter(a => !report.slots.some(s => s.slot === a.slot));
  if (unplanned.length || report.unplannedAttempts.length) block('unplanned-attempts');
  if (!same([...expected, ...report.unplannedAttempts], report.attempts)
    || report.slots.some(s => !same(s.attempts, report.attempts.filter(a => a.slot === s.slot)))
    || report.pairs.some(p => !same(p.slots, ['baseline', 'candidate'].map(arm => report.slots.find(s => s.pairId === p.id && s.arm === arm)?.slot)))
    || report.slots.length !== report.pairs.length * 2) block('attempt-or-slot-inventory-mismatch');
  const caseResults = report.cases.map(c => {
    const role = criteria === null ? 'unclassified' : criteria.targetCaseIds.includes(c.id) ? 'target' : 'control';
    return caseResult(c.id, role, report.pairs.filter(p => p.caseId === c.id), report.slots.filter(s => s.caseId === c.id), report.attempts.filter(a => a.caseId === c.id), criteria);
  });
  const unassigned = report.attempts.filter(a => !report.cases.some(c => c.id === a.caseId));
  if (unassigned.length) caseResults.push(caseResult(null, 'unassigned', [], [], unassigned, null));
  let failed = false;
  for (const c of caseResults) {
    if (c.role === 'unassigned') { block('unassigned-attempt-resources'); continue; }
    if (c.comparablePairs !== c.plannedPairs || c.completedPairs !== c.plannedPairs || c.plannedPairs === 0
      || criteria && c.comparablePairs < criteria.minimumComparablePairsPerCase
      || ['baseline', 'candidate'].some(arm => c.arms[arm].unknown || c.arms[arm].attempts !== c.arms[arm].planned)
      || c.arms.unassigned.attempts) block(`${c.caseId}:incomplete-or-incomparable-pairs`);
    for (const [key, m] of Object.entries(c.criteria)) {
      if (m.status === 'unknown') block(`${c.caseId}:${key}:unknown`);
      if (m.status === 'failed') { failed = true; reasons.push(`${c.caseId}:${key}:failed`); }
    }
  }
  const result = { method: METHOD, disposition: blockers.length ? 'inconclusive' : failed ? 'rejected' : 'supported', caseResults,
    reasons: [...new Set(reasons)], limitations: [
      'Development-cohort screening only; zero held-out cases limits generalization, not scoped support.',
      'Five pairs are a screening floor, not statistical proof or a causal guarantee.',
      'Initial intervention and repair declarations do not establish actual external human-help coverage.',
      'Arithmetic consumes a source-verified projection; it grants no execution, promotion or publication authority.',
    ] };
  validateScreeningResult(result); return result;
}
function caseResult(caseId, role, pairs, slots, attempts, criteria) {
  const arms = Object.fromEntries(ARMS.map(arm => [arm, totals(slots.filter(s => s.arm === arm), attempts.filter(a => arm === 'unassigned' ? !['baseline', 'candidate'].includes(a.arm) : a.arm === arm))]));
  const comparable = pairs.filter(p => p.comparable && p.completed && p.exclusions.length === 0 && ['accepted', 'rejected'].includes(p.baseline) && ['accepted', 'rejected'].includes(p.candidate));
  const discordant = { baselineFailCandidatePass: comparable.filter(p => p.baseline === 'rejected' && p.candidate === 'accepted').length,
    baselinePassCandidateFail: comparable.filter(p => p.baseline === 'accepted' && p.candidate === 'rejected').length };
  const additionalCost = difference(arms.candidate.currencyUsd.total, arms.baseline.currencyUsd.total);
  const completeWall = ['baseline', 'candidate'].every(arm => arms[arm].wallMs.denominator > 0 && arms[arm].wallMs.observed === arms[arm].wallMs.denominator
    && arms[arm].completed === arms[arm].planned && attempts.filter(a => a.arm === arm).every(a => a.terminal));
  const additionalWall = completeWall ? difference(arms.candidate.wallMs.median, arms.baseline.wallMs.median) : null;
  const applicable = role !== 'unassigned';
  return { caseId, role, plannedPairs: pairs.length, completedPairs: pairs.filter(p => p.completed).length, comparablePairs: comparable.length, arms, discordant,
    criteria: { comparablePairs: metric(comparable.length, criteria?.minimumComparablePairsPerCase ?? null, 'minimum', applicable),
      targetNetGains: metric(discordant.baselineFailCandidatePass - discordant.baselinePassCandidateFail, criteria?.minimumTargetNetGains ?? null, 'minimum', applicable && role !== 'control'),
      controlRegressions: metric(discordant.baselinePassCandidateFail, criteria?.maxControlRegressions ?? null, 'maximum', applicable && role !== 'target'),
      additionalCurrencyUsd: metric(additionalCost, criteria?.maxAdditionalCurrencyUsd ?? null, 'maximum', applicable),
      additionalMedianWallMs: metric(additionalWall, criteria?.maxAdditionalMedianWallMs ?? null, 'maximum', applicable) } };
}
function validateArm(a) {
  exact(a, ['planned', 'attempted', 'attempts', 'completed', 'failed', 'invalid', 'missing', 'accepted', 'denominator', 'unknown', 'failures', 'currencyUsd', 'wallMs', 'interventions', 'repairRounds']);
  for (const k of ['planned', 'attempted', 'attempts', 'completed', 'failed', 'invalid', 'missing', 'accepted', 'denominator', 'unknown']) check(count(a[k]));
  check(a.denominator === a.planned && a.attempted <= a.planned && a.attempted <= a.attempts && a.completed + a.invalid + a.missing === a.planned
    && a.accepted <= a.completed && a.unknown <= a.planned && a.failed <= a.planned);
  check(object(a.failures) && Object.keys(a.failures).length <= 128 && Object.entries(a.failures).every(([k, v]) => text(k) && count(v) && v > 0)
    && Object.values(a.failures).reduce((n, v) => n + v, 0) <= a.attempts);
  const c = a.currencyUsd; exact(c, ['knownSubtotal', 'observed', 'denominator', 'complete', 'total', 'costPerAcceptedOutcome']);
  check(amount(c.knownSubtotal) && count(c.observed) && c.denominator === a.attempts && c.observed <= c.denominator && typeof c.complete === 'boolean');
  check(c.complete ? c.observed === c.denominator && c.denominator > 0 && a.completed === a.planned && c.total === c.knownSubtotal : c.total === null);
  check(c.costPerAcceptedOutcome === (c.complete && a.accepted > 0 ? c.total / a.accepted : null));
  const w = a.wallMs; exact(w, ['observed', 'denominator', 'raw', 'median', 'min', 'max']); bounded(w.raw, 20000);
  check(w.raw.every(v => v === null || amount(v)) && same(w, distribution(w.raw)) && w.denominator === a.attempts);
  for (const key of ['interventions', 'repairRounds']) { const d = a[key]; exact(d, ['recordedSubtotal', 'recordsPresent', 'denominator', 'actualCount', 'actualCoverage']);
    check(Number.isSafeInteger(d.recordedSubtotal) && d.recordedSubtotal >= 0 && count(d.recordsPresent) && d.recordsPresent <= a.attempts
      && d.denominator === a.attempts && d.actualCount === null && d.actualCoverage === 'unknown'); }
}
/** Strict retained schema validator; structural validity is not source verification. */
export function validateScreeningResult(result) {
  exact(result, ['method', 'disposition', 'caseResults', 'reasons', 'limitations']);
  check(result.method === METHOD && ['supported', 'rejected', 'inconclusive'].includes(result.disposition));
  bounded(result.caseResults, 21); check(result.caseResults.length > 0);
  for (const k of ['reasons', 'limitations']) { bounded(result[k], 256); check(result[k].every(text) && unique(result[k])); }
  check(unique(result.caseResults.map(c => c.caseId)));
  let failed = false, unknown = false;
  for (const c of result.caseResults) {
    exact(c, ['caseId', 'role', 'plannedPairs', 'completedPairs', 'comparablePairs', 'arms', 'discordant', 'criteria']);
    check(['target', 'control', 'unclassified', 'unassigned'].includes(c.role) && (c.role === 'unassigned' ? c.caseId === null : id(c.caseId)));
    for (const key of ['plannedPairs', 'completedPairs', 'comparablePairs']) check(count(c[key]));
    check(c.comparablePairs <= c.completedPairs && c.completedPairs <= c.plannedPairs);
    exact(c.arms, ARMS); ARMS.forEach(arm => validateArm(c.arms[arm]));
    check(c.arms.baseline.planned === c.plannedPairs && c.arms.candidate.planned === c.plannedPairs && c.arms.unassigned.planned === 0);
    exact(c.discordant, ['baselineFailCandidatePass', 'baselinePassCandidateFail']);
    check(Object.values(c.discordant).every(count) && Object.values(c.discordant).reduce((a, b) => a + b, 0) <= c.comparablePairs);
    exact(c.criteria, ['comparablePairs', 'targetNetGains', 'controlRegressions', 'additionalCurrencyUsd', 'additionalMedianWallMs']);
    for (const [key, m] of Object.entries(c.criteria)) { exact(m, ['status', 'observed', 'threshold']);
      check(['passed', 'failed', 'unknown', 'not-applicable'].includes(m.status) && (m.observed === null || finite(m.observed)) && (m.threshold === null || amount(m.threshold)));
      const applicable = c.role !== 'unassigned' && !(key === 'targetNetGains' && c.role === 'control') && !(key === 'controlRegressions' && c.role === 'target');
      check(same(m, metric(m.observed, m.threshold, ['comparablePairs', 'targetNetGains'].includes(key) ? 'minimum' : 'maximum', applicable)));
      if (c.role === 'unclassified' || c.role === 'unassigned') check(m.threshold === null);
      else check(m.threshold !== null && (key === 'comparablePairs' ? Number.isSafeInteger(m.threshold) && m.threshold >= 5 && m.threshold <= 1000
        : key === 'targetNetGains' ? Number.isSafeInteger(m.threshold) && m.threshold >= 1 && m.threshold <= 1000
        : key === 'controlRegressions' ? m.threshold === 0 : amount(m.threshold)));
      failed ||= m.status === 'failed'; unknown ||= m.status === 'unknown';
    }
    check(c.criteria.comparablePairs.observed === c.comparablePairs
      && c.criteria.targetNetGains.observed === c.discordant.baselineFailCandidatePass - c.discordant.baselinePassCandidateFail
      && c.criteria.controlRegressions.observed === c.discordant.baselinePassCandidateFail);
    check(c.criteria.additionalCurrencyUsd.observed === difference(c.arms.candidate.currencyUsd.total, c.arms.baseline.currencyUsd.total));
    if (c.criteria.additionalMedianWallMs.observed !== null) check(['baseline', 'candidate'].every(arm => c.arms[arm].wallMs.denominator > 0
      && c.arms[arm].wallMs.observed === c.arms[arm].wallMs.denominator && c.arms[arm].completed === c.arms[arm].planned)
      && c.criteria.additionalMedianWallMs.observed === difference(c.arms.candidate.wallMs.median, c.arms.baseline.wallMs.median));
  }
  if (result.disposition !== 'inconclusive') check(!unknown && result.caseResults.some(c => c.role === 'target') && result.caseResults.some(c => c.role === 'control')
    && result.caseResults.every(c => ['target', 'control'].includes(c.role) && c.comparablePairs === c.plannedPairs
      && c.comparablePairs >= c.criteria.comparablePairs.threshold && c.arms.unassigned.attempts === 0
      && ['baseline', 'candidate'].every(arm => c.arms[arm].attempts === c.arms[arm].planned && c.arms[arm].completed === c.arms[arm].planned
        && c.arms[arm].unknown === 0 && c.arms[arm].currencyUsd.complete && c.arms[arm].wallMs.observed === c.arms[arm].attempts)));
  if (result.disposition === 'supported') check(!failed && result.reasons.length === 0);
  if (result.disposition === 'rejected') check(failed && !unknown && result.reasons.length > 0);
  if (result.disposition === 'inconclusive') check(result.reasons.length > 0);
  check(Buffer.byteLength(JSON.stringify(result)) <= 262144, 'screening_result_bytes_bound');
  return result;
}

// Retained paired-screening-v1 results use the versioned implementation above.
export const screenComparison = screenComparisonV1;

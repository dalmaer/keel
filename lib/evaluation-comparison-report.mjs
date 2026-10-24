// Pure projections of a frozen plan and controller-validated execution receipts.
// This module grants no execution, acceptance-store or promotion authority.
import { fingerprint, sealRecord } from './evaluation-records.mjs';
const arms = ['baseline', 'candidate'];
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const number = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const equal = (a, b) => {
  try { return a != null && b != null && fingerprint(a) === fingerprint(b); } catch { return false; }
};
function sealed(r, kind) {
  try { return r?.schemaVersion === 2 && r.kind === kind && hash(r.digest) && sealRecord(r).digest === r.digest; } catch { return false; }
}
function coherentController(controller) {
  try {
    const { digest, ...body } = controller;
    return hash(digest) && typeof body.nodeVersion === 'string' && Array.isArray(body.sources) && body.sources.length > 0
      && body.sources.every(s => typeof s.path === 'string' && hash(s.byteDigest))
      && fingerprint(body) === digest;
  } catch { return false; }
}
function boundImage(image, environment) {
  // preflightDocker already verified requested against Id or RepoDigests.
  // A manifest digest and its resolved local image ID may legitimately differ.
  return image && /^sha256:[a-f0-9]{64}$/.test(image.id) && image.requested === environment?.image
    && image.platform === environment?.platform && Array.isArray(image.inherited)
    && image.inherited.every(v => typeof v === 'string') && typeof image.nodeVersion === 'string' && image.nodeVersion.length > 0;
}
function projectedRecovery(trial) {
  const recovery = trial.recovery, original = trial.records ?? {}, intent = original.intent;
  if (!recovery) return null;
  const { receipt, result, verdict } = recovery;
  if (!sealed(receipt, 'evaluation-reconciliation') || receipt.intentDigest !== intent?.digest
    || !Object.values(original).some(r => r.digest === receipt.digest)
    || !sealed(result, 'evaluation-result') || !sealed(verdict, 'evaluation-verdict')
    || !equal(result, receipt.result) || !equal(verdict, receipt.verdict)
    || result.intentDigest !== intent.digest || verdict.intentDigest !== intent.digest
    || !hash(receipt.inputDigest) || result.recoveryInputDigest !== receipt.inputDigest
    || result.verdictDigest !== verdict.digest || receipt.status !== 'terminal' || result.status !== 'terminal'
    || !equal(result.settlement, receipt.settlement) || receipt.settlement?.released !== true
    || receipt.settlement.id !== intent.id || receipt.settlement.commandDigest !== intent.previewDigest
    || !receipt.originalEvidence || !Object.entries(receipt.originalEvidence).every(([key, digest]) => original[key]?.digest === digest)
    || receipt.originalEvidence.intent !== intent.digest || !sealed(original.lease, 'evaluation-lease')
    || original.lease.intentDigest !== intent.digest || original.lease.lease?.id !== intent.id
    || receipt.originalEvidence.lease !== original.lease.digest
    || !Array.isArray(intent.operations) || !intent.operations.length || !Array.isArray(receipt.observations)
    || receipt.observations.length !== intent.operations.length
    || !receipt.observations.every((o, index) => o.operation === intent.operations[index]
      && (o.state === 'terminated' && hash(o.containerId) && o.running === false
        || o.state === 'not-dispatched' && o.authority === 'ordered-authorization-v1' && o.intentDigest === intent.digest))
    || (verdict.acceptance !== 'unknown' && verdict.digest !== original.verdict?.digest)
    || (verdict.digest !== original.verdict?.digest && verdict.recoveryInputDigest !== receipt.inputDigest)) return null;
  return recovery;
}
function recoveredProjection(trial, linked) {
  const r = trial.records ?? {}, i = r.intent, v = r.verdict, result = r.result;
  return Object.entries(r).filter(([key]) => key.startsWith('reconciliation-')).some(([, recovery]) => {
    if (!linked(recovery, 'evaluation-reconciliation') || recovery.status !== 'terminal' || recovery.acceptance !== 'unknown'
      || !Array.isArray(i.operations) || !i.operations.length || !Array.isArray(recovery.observations)
      || recovery.observations.length !== i.operations.length || recovery.settlement?.released !== true
      || recovery.settlement.id !== i.id || recovery.settlement.commandDigest !== i.previewDigest
      || recovery.originalEvidence?.intent !== i.digest || !linked(r.lease, 'evaluation-lease')
      || r.lease.lease?.id !== i.id || recovery.originalEvidence.lease !== r.lease.digest) return false;
    if (!recovery.observations.every((o, index) => o.operation === i.operations[index]
      && o.state === 'terminated' && hash(o.containerId) && o.running === false)) return false;
    // inspectExecutions replaces missing result/verdict fields in memory only.
    // The sealed recovery receipt remains the authority for termination, never
    // for acceptance or reconstructed usage. Original verdict bytes may have
    // been replaced by the explicitly unknown projection.
    return trial.status === 'terminal' && v?.kind === 'evaluation-verdict' && v.digest === recovery.digest
      && v.acceptance === 'unknown' && v.failureCategory === 'missing-evidence'
      && result?.kind === 'evaluation-result' && result.digest === recovery.digest && result.verdictDigest === recovery.digest
      && result.status === 'terminal' && result.validation === 'unknown' && equal(result.settlement, recovery.settlement);
  });
}
function distribution(values) {
  const known = values.filter(number), sorted = [...known].sort((a, b) => a - b), n = sorted.length;
  return { observed: n, denominator: values.length, raw: values.map(v => number(v) ? v : null),
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    min: n ? sorted[0] : null, max: n ? sorted[n - 1] : null };
}
function observe(plan, trial, pair, arm) {
  const recovery = projectedRecovery(trial), original = trial.records ?? {};
  const r = recovery ? { ...original, verdict: recovery.verdict, result: recovery.result } : original;
  const i = r.intent, v = r.verdict, result = r.result, input = i?.input;
  const task = plan.bundle.cases.find(c => c.id === pair?.case.id);
  const config = plan.bundle.configurations.find(c => c.id === plan.bundle.comparison[arm]?.id);
  const reasons = [];
  const bound = (!trial.recovery || Boolean(recovery)) && sealed(i, 'evaluation-intent') && i.slot === trial.slot && input?.planDigest === plan.digest
    && i.previewDigest === fingerprint(input) && input.request?.pairId === pair?.id && input.request?.arm === arm
    && input.taskDigest === task?.digest && input.configurationDigest === config?.digest;
  if (!bound) reasons.push('invalid-intent-reference');
  const linked = (record, kind) => sealed(record, kind) && bound && record.intentDigest === i.digest;
  const verdict = linked(v, 'evaluation-verdict') && v.checkManifestDigest === task?.acceptanceManifest.digest
    && input.checkManifestDigest === v.checkManifestDigest && v.artifactDigest === (r.artifact?.digest ?? null)
    && coherentController(input.controller) && equal(v.evaluator?.controller, input.controller) && equal(v.evaluator?.image, input.image);
  const recovered = recoveredProjection(trial, linked);
  const terminal = recovered || verdict && linked(result, 'evaluation-result') && result.verdictDigest === v.digest
    && result.status === 'terminal' && trial.status === 'terminal' && result.settlement?.released === true;
  if (!verdict && !recovered) reasons.push('missing-or-invalid-verdict');
  if (!terminal) reasons.push('missing-or-invalid-terminal-result');
  let checksValid = false;
  try {
    const material = plan.bundle.materials.find(m => m.digest === task.acceptanceManifest.digest);
    const driver = JSON.parse(material.content);
    checksValid = driver.driver === 'stdio-v1' && driver.checks.length > 0 && v.checks.length === driver.checks.length
      && driver.checks.every((c, index) => {
        const check = v.checks[index], observation = r[`check-${index}`];
        return check.id === c.id && ['passed', 'failed'].includes(check.status)
          && linked(observation, 'evaluation-stage') && check.observationDigest === observation.digest
          && observation.stage?.setup === 'passed' && !observation.stage.error
          && observation.stage.termination?.state === 'terminated' && observation.stage.output?.signal === null
          && (check.status === 'passed') === (observation.stage.output.exit === c.exitCode && observation.stage.output.stdout === c.stdout);
      });
  } catch { /* Unavailable acceptance references remain unknown. */ }
  const artifact = linked(r.artifact, 'evaluation-artifact') && Array.isArray(r.artifact.files) && r.artifact.filesDigest === fingerprint(r.artifact.files)
    && r.artifact.sourceDigest === input?.sourceDigest;
  const accepted = !recovered && terminal && artifact && checksValid && v.acceptance === 'accepted'
    && v.checks.every(c => c.status === 'passed') && result.validation === 'passed';
  if (v?.acceptance === 'accepted' && !accepted) reasons.push('unverified-acceptance');
  const rejected = !recovered && terminal && v.acceptance === 'rejected' && result.validation === 'failed'
    && (v.failureCategory === 'invalid-submission' || (artifact && checksValid && v.checks.some(c => c.status === 'failed')));
  const outcome = accepted ? 'accepted' : rejected ? 'rejected' : 'unknown';
  const resources = linked(result, 'evaluation-result') ? result.resources ?? {} : {};
  return { slot: trial.slot, pairId: pair?.id ?? null, caseId: task?.id ?? null, arm,
    attemptId: bound ? i.id : null, attempt: bound ? i.attempt ?? null : null, parentAttemptId: bound ? i.parentAttemptId ?? null : null,
    status: terminal && !reasons.includes('unverified-acceptance') ? 'completed' : 'invalid', terminal: Boolean(terminal), outcome,
    recovered: Boolean(recovery) || recovered, recoveryInputDigest: recovery?.receipt.inputDigest ?? null,
    failureCategory: recovered ? 'missing-evidence' : verdict ? v.failureCategory ?? null : trial.reason ?? 'missing-evidence', reasons,
    identity: bound ? { controller: input.controller ?? null, image: input.image ?? null, sourceDigest: input.sourceDigest ?? null,
      taskDigest: input.taskDigest, checkManifestDigest: input.checkManifestDigest,
      model: input.model ?? null, environment: input.environment ?? null } : null,
    resources: Object.fromEntries(['wallMs', 'setupMs', 'executionMs', 'validationMs', 'cpuMs', 'currencyUsd', 'activeHumanMinutes'].map(k => [k, number(resources[k]) ? resources[k] : null])),
    resourceAttribution: { source: resources.source ?? null, coverage: resources.coverage ?? null },
    interventionAttribution: 'initial-intent-declaration; subsequent external help unknown',
    interventions: bound && Array.isArray(i.interventions) ? i.interventions : null,
    repairRounds: bound && Number.isSafeInteger(i.repairRounds) && i.repairRounds >= 0 ? i.repairRounds : null,
    evidence: Object.entries({ ...r, ...(recovery && original.result ? { originalResult: original.result } : {}), ...(recovery && original.verdict ? { originalVerdict: original.verdict } : {}) }).filter(([, record]) => hash(record?.digest)).map(([record, value]) => ({ record, digest: value.digest })),
    checks: verdict ? v.checks ?? [] : [] };
}
function totals(slots, attempts) {
  const accepted = slots.filter(s => s.outcome === 'accepted').length;
  const cost = attempts.map(a => a.resources.currencyUsd), known = cost.filter(number);
  // Missing planned work and extra attempts must never improve cost coverage.
  const completeCost = slots.every(s => s.status === 'completed') && attempts.every(a => a.terminal) && known.length === cost.length && cost.length > 0;
  const failures = {};
  for (const a of attempts) if (a.failureCategory) failures[a.failureCategory] = (failures[a.failureCategory] ?? 0) + 1;
  return { planned: slots.length, attempted: slots.filter(s => s.attempts.length).length, attempts: attempts.length,
    completed: slots.filter(s => s.status === 'completed').length,
    failed: slots.filter(s => s.outcome === 'rejected' || s.attempts.some(a => a.failureCategory && a.terminal)).length,
    invalid: slots.filter(s => s.status === 'invalid').length, missing: slots.filter(s => s.status === 'missing').length,
    accepted, denominator: slots.length, acceptanceRate: slots.length ? accepted / slots.length : null,
    unknown: slots.filter(s => s.outcome === 'unknown').length, failures,
    currencyUsd: { knownSubtotal: known.reduce((a, b) => a + b, 0), observed: known.length, denominator: cost.length,
      complete: completeCost, total: completeCost ? known.reduce((a, b) => a + b, 0) : null,
      costPerAcceptedOutcome: completeCost && accepted > 0 ? known.reduce((a, b) => a + b, 0) / accepted : null },
    resources: Object.fromEntries(['wallMs', 'setupMs', 'executionMs', 'validationMs', 'cpuMs', 'activeHumanMinutes'].map(k => [k, distribution(attempts.map(a => a.resources[k]))])),
    interventions: { source: 'initial-intent-declarations', actualCount: null, actualCoverage: 'unknown', recordedSubtotal: attempts.reduce((n, a) => n + (a.interventions?.length ?? 0), 0), recordsPresent: attempts.filter(a => a.interventions !== null).length, denominator: attempts.length },
    repairRounds: { source: 'initial-intent-declarations', actualCount: null, actualCoverage: 'unknown', recordedSubtotal: attempts.reduce((n, a) => n + (a.repairRounds ?? 0), 0), recordsPresent: attempts.filter(a => a.repairRounds !== null).length, denominator: attempts.length } };
}
/** plan is frozenLedger.plan; execution is inspectExecutions' validated projection. */
export function summarizeComparisonV1(plan, execution) {
  const b = plan.bundle, comparison = b.comparison, attempts = [], slots = [], pairs = [];
  const configurations = arms.map(arm => b.configurations.find(c => c.id === comparison[arm].id));
  const offline = configurations.every(c => c.provider === 'offline' && c.runtime.name === 'scripted-node-v1');
  for (const pair of comparison.pairs) {
    const paired = arms.map(arm => {
      const slot = pair.id + '-' + arm;
      const observations = (execution?.trials ?? []).filter(t => t.slot === slot).map(t => observe(plan, t, pair, arm));
      attempts.push(...observations);
      const a = observations[0], unique = observations.length === 1;
      const s = { slot, pairId: pair.id, caseId: pair.case.id, arm, attempts: observations,
        status: !a ? 'missing' : unique ? a.status : 'invalid', outcome: unique ? a.outcome : 'unknown' };
      slots.push(s); return s;
    });
    const reasons = [], [baseline, candidate] = paired.map(s => s.attempts[0]);
    if (paired.some(s => s.status !== 'completed')) reasons.push('incomplete-or-invalid-pair');
    if (paired.some(s => s.outcome === 'unknown')) reasons.push('unknown-outcome');
    const x = baseline?.identity, y = candidate?.identity;
    for (const key of ['controller', 'image', 'sourceDigest', 'taskDigest', 'checkManifestDigest']) {
      if (!equal(x?.[key], y?.[key])) reasons.push(`${key}-unknown-or-drift`);
    }
    // Offline trials have no model invocation. Live configuration aliases cannot
    // substitute for the actual resolved identity recorded at execution.
    if (configurations.some(c => !c.model?.resolved)) reasons.push('unresolved-model-alias');
    const task = b.cases.find(c => c.id === pair.case.id);
    if (!boundImage(x?.image, task.environment) || !boundImage(y?.image, task.environment)) reasons.push('image-differs-from-frozen-environment');
    if (!equal(configurations[0].environment, configurations[1].environment)) reasons.push('configured-environment-drift');
    if (!coherentController(x?.controller) || !coherentController(y?.controller)) reasons.push('unknown-controller');
    if (!offline) {
      if (!x?.model?.resolved || !y?.model?.resolved || !equal(x.model, y.model)) reasons.push('model-unknown-or-drift');
      if (!equal(x?.environment, y?.environment)) reasons.push('environment-unknown-or-drift');
    }
    if (!equal(configurations[0].runtime, configurations[1].runtime)) reasons.push('runtime-drift');
    const comparable = reasons.length === 0;
    pairs.push({ id: pair.id, caseId: pair.case.id, order: pair.order, slots: paired.map(s => s.slot),
      completed: paired.every(s => s.status === 'completed'), comparable, exclusions: reasons,
      baseline: paired[0].outcome, candidate: paired[1].outcome,
      discordance: comparable && paired[0].outcome !== paired[1].outcome ? paired[1].outcome === 'accepted' ? 'candidate-gain' : 'candidate-regression' : null });
  }
  const knownSlots = new Set(slots.map(s => s.slot));
  const unplanned = (execution?.trials ?? []).filter(t => !knownSlots.has(t.slot)).map(t => observe(plan, t, null, t.records?.intent?.input?.request?.arm ?? null));
  attempts.push(...unplanned);
  const summarize = selected => Object.fromEntries(arms.map(arm => [arm, totals(selected.filter(s => s.arm === arm), attempts.filter(a => a.arm === arm && (!selected.length ? false : selected.some(s => s.caseId === a.caseId))))]));
  const cases = b.cases.filter(c => comparison.cases.some(r => r.id === c.id)).map(c => {
    const cohort = pairs.filter(p => p.caseId === c.id), comparable = cohort.filter(p => p.comparable);
    return { id: c.id, taskClass: c.taskClass, arms: summarize(slots.filter(s => s.caseId === c.id)),
      plannedPairs: cohort.length, completedPairs: cohort.filter(p => p.completed).length, comparablePairs: comparable.length,
      screeningFloor: cohort.length >= 5 && comparable.length >= 5,
      discordant: { baselineFailCandidatePass: comparable.filter(p => p.discordance === 'candidate-gain').length,
        baselinePassCandidateFail: comparable.filter(p => p.discordance === 'candidate-regression').length },
      comparableAccepted: Object.fromEntries(arms.map(arm => [arm, { accepted: comparable.filter(p => p[arm] === 'accepted').length, denominator: comparable.length }])) };
  });
  const screening = cases.some(c => c.taskClass === 'control') && cases.some(c => c.taskClass !== 'control') && cases.every(c => c.screeningFloor);
  const reasons = [];
  if (offline) reasons.push('Offline scripted outcomes establish machinery only; no agent efficacy claim.');
  if (comparison.promotion.criteria === null) reasons.push('Promotion criteria are unset.');
  if (!screening) reasons.push('Screening requires at least five comparable pairs for every affected case and selected control.');
  if (cases.some(c => c.taskClass === 'control' && c.discordant.baselinePassCandidateFail)) reasons.push('Comparable control regression observed.');
  if (unplanned.length) reasons.push('Unplanned attempts retained; execution differs from the frozen plan.');
  reasons.push('Five pairs are a screening floor, not statistical proof; ambiguous evidence needs a preregistered larger comparison.');
  return { schemaVersion: 1, comparisonId: comparison.id, planDigest: plan.digest,
    status: pairs.every(p => p.completed) && !unplanned.length && !(execution?.issues?.length) ? 'completed' : 'incomplete',
    cases, arms: Object.fromEntries(arms.map(arm => [arm, totals(slots.filter(s => s.arm === arm), attempts.filter(a => a.arm === arm))])),
    pairs, slots, attempts, unplannedAttempts: unplanned, issues: execution?.issues ?? [],
    screening: { eligible: screening, minimumPairsPerCase: 5, plannedCoverage: cases.some(c => c.taskClass === 'control') && cases.some(c => c.taskClass !== 'control') && cases.every(c => c.plannedPairs >= 5) },
    recommendation: { disposition: 'inconclusive', automaticPromotion: false, agentEfficacy: false, reasons },
    candidate: { baseline: comparison.baseline, candidate: comparison.candidate, baselineConfiguration: configurations[0], candidateConfiguration: configurations[1], changes: Object.keys(configurations[0]).filter(key => !['id', 'digest', 'createdAt'].includes(key) && !equal(configurations[0][key], configurations[1][key]) && configurations[0][key] !== configurations[1][key]).map(key => ({ field: key, baseline: configurations[0][key], candidate: configurations[1][key] })) },
    limitations: ['Wall-time distributions are per attempt, not summed elapsed comparison time.', 'Missing resource observations are unknown, not zero.', 'No subsequent escaped-defect observation window or exposure cohort is available.'] };
}
// Retained report schema 1 uses this exact projection. Future algorithms need
// a new version and must keep this reader for historical immutable receipts.
export const summarizeComparison = summarizeComparisonV1;
const cell = x => String(x ?? 'unknown').replace(/[|\r\n]/g, ' ').replace(/[<>]/g, '');
/** Render the same report without adding a score or changing its denominators. */
export function renderComparison(report) {
  const lines = ['# Harness comparison', '', '| Case | Arm | Accepted / planned | Completed | Failed | Invalid | Missing |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const c of report.cases) for (const arm of arms) {
    const a = c.arms[arm]; lines.push(`| ${cell(c.id)} | ${arm} | ${a.accepted} / ${a.denominator} | ${a.completed} | ${a.failed} | ${a.invalid} | ${a.missing} |`);
  }
  lines.push('', `Recommendation: ${report.recommendation.disposition}. No automatic promotion.`, ...report.recommendation.reasons.map(r => `- ${r}`), '', 'Paired outcomes (comparable subset):');
  for (const c of report.cases) lines.push(`- ${cell(c.id)}: ${c.comparablePairs}/${c.plannedPairs} comparable; baseline fail / candidate pass ${c.discordant.baselineFailCandidatePass}; baseline pass / candidate fail ${c.discordant.baselinePassCandidateFail}.`);
  lines.push('', 'Cost and resources (all attempts, including failures):');
  for (const arm of arms) {
    const a = report.arms[arm], cost = a.currencyUsd, wall = a.resources.wallMs;
    lines.push(`- ${arm}: USD known subtotal ${cost.knownSubtotal}; coverage ${cost.observed}/${cost.denominator}, complete ${cost.complete}; cost per accepted outcome ${cell(cost.costPerAcceptedOutcome)}.`,
      `  Wall ms median ${cell(wall.median)}, range ${cell(wall.min)}–${cell(wall.max)}, coverage ${wall.observed}/${wall.denominator}; raw ${JSON.stringify(wall.raw)}.`,
      ...Object.entries(a.resources).filter(([key]) => key !== 'wallMs').map(([key, d]) => `  ${key}: median ${cell(d.median)}, range ${cell(d.min)}–${cell(d.max)}; coverage ${d.observed}/${d.denominator}; raw ${JSON.stringify(d.raw)}.`),
      `  Recorded intervention declarations ${a.interventions.recordedSubtotal} (${a.interventions.recordsPresent}/${a.interventions.denominator} initial records present); recorded repair rounds ${a.repairRounds.recordedSubtotal} (${a.repairRounds.recordsPresent}/${a.repairRounds.denominator} initial records present). Actual human help and repair coverage unknown.`);
  }
  lines.push('', 'All planned pairs:');
  for (const p of report.pairs) lines.push(`- ${cell(p.id)} (${p.order}): ${p.baseline} / ${p.candidate}; ${p.comparable ? 'comparable' : p.exclusions.join(', ')}.`);
  lines.push('', 'All attempts and evidence:');
  for (const a of report.attempts) lines.push(`- ${cell(a.slot)} attempt ${cell(a.attempt)}: ${a.status}, ${a.outcome}; failure ${cell(a.failureCategory ?? (a.outcome === 'accepted' ? 'none' : null))}; ${a.reasons.join(', ')}; evidence ${a.evidence.map(e => `${cell(e.record)}:${e.digest}`).join(', ')}; initial intervention declarations ${cell(JSON.stringify(a.interventions))}; subsequent human help unknown.`);
  lines.push('', ...report.limitations.map(l => `- ${l}`));
  return lines.join('\n') + '\n';
}

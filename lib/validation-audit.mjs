// Phase 110: pure, bounded analysis of retained evidence. No execution or reuse authority.
import { createHash } from 'node:crypto';

export const AUDIT_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, records: 5000, projects: 100, stages: 256 });
const INPUT_KEYS = ['command', 'config', 'runtime', 'environment', 'selection', 'workflow', 'lock', 'cache'];
const KINDS = ['gate', 'stage', 'setup', 'review', 'reuse'];
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const DIGEST = /^[a-f0-9]{64}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const WORKFLOW = /^\.github\/workflows\/[a-zA-Z0-9_-]+\.ya?ml$/;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const canonical = x => Array.isArray(x) ? x.map(canonical) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const hash = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const known = x => x !== undefined && x !== null;
const finite = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x) && Number.isFinite(Date.parse(x));
const fail = message => { throw new Error(message); };
function optional(x, key, valid, location) {
  if (known(x[key]) && !valid(x[key])) fail(`${location}.${key} is invalid`);
}
function fields(x, location) {
  for (const key of ['head', 'tree']) optional(x, key, v => typeof v === 'string' && SHA.test(v), location);
  for (const key of ['dirty', 'completed', 'timedOut']) optional(x, key, v => typeof v === 'boolean', location);
  optional(x, 'status', v => Number.isInteger(v) && v >= 0 && v <= 255, location);
  for (const key of ['startedAt', 'endedAt', 'heartbeatAt']) optional(x, key, date, location);
  for (const key of ['wallMs', 'cpuMs', 'queueMs', 'timeoutMs']) optional(x, key, finite, location);
  for (const key of ['parentId', 'invocationId', 'purpose', 'retryOf', 'retryReason']) optional(x, key, v => typeof v === 'string' && TOKEN.test(v), location);
  optional(x, 'gateSource', v => ['configured-check', 'explicit-command'].includes(v), location);
  optional(x, 'manifestDigest', v => typeof v === 'string' && DIGEST.test(v), location);
  optional(x, 'inputs', object, location);
  if (x.inputs) for (const key of INPUT_KEYS) optional(x.inputs, key, v => typeof v === 'string' && DIGEST.test(v), `${location}.inputs`);
  if (x.startedAt && x.endedAt && Date.parse(x.endedAt) < Date.parse(x.startedAt)) fail(`${location} has a reversed interval`);
}
function stages(x, location) {
  optional(x, 'requiredStages', v => Array.isArray(v) && v.length <= AUDIT_LIMITS.stages && v.every(s => typeof s === 'string' && TOKEN.test(s)) && new Set(v).size === v.length, location);
  optional(x, 'stages', v => Array.isArray(v) && v.length <= AUDIT_LIMITS.stages, location);
  for (const [i, s] of (x.stages ?? []).entries()) {
    const at = `${location}.stages[${i}]`;
    if (!object(s) || typeof s.id !== 'string' || !TOKEN.test(s.id)) fail(`${at} is invalid`);
    fields(s, at);
    optional(s, 'inputsDigest', v => typeof v === 'string' && DIGEST.test(v), at);
  }
}
/** Digests cover normalized keys, not caller property order or arbitrary private fields. */
export function inputsDigest(inputs) {
  if (!object(inputs) || INPUT_KEYS.some(k => typeof inputs[k] !== 'string' || !DIGEST.test(inputs[k]))) return null;
  return hash(INPUT_KEYS.map(k => [k, inputs[k]]));
}
export function cohortDigest(record) {
  const inputs = inputsDigest(record.inputs);
  return inputs && record.manifestDigest ? hash([record.kind, record.stage ?? null, inputs, record.manifestDigest]) : null;
}
function fingerprint(record) {
  const inputs = inputsDigest(record.inputs);
  return record.head && record.tree && inputs && record.manifestDigest
    ? hash([record.head, record.tree, inputs, record.manifestDigest, record.requiredStages ? [...record.requiredStages].sort() : null]) : null;
}
function gateGaps(record) {
  const gaps = [];
  if (record.gateSource !== 'configured-check') gaps.push('configured-gate-source');
  if (record.dirty !== false) gaps.push('clean-tree');
  if (record.completed !== true || record.status !== 0) gaps.push('successful-completion');
  if (!fingerprint(record)) gaps.push('immutable-inputs');
  if (!record.invocationId) gaps.push('invocation');
  if (!record.startedAt || !record.endedAt) gaps.push('interval');
  if (!record.requiredStages?.length || !record.stages?.length) gaps.push('required-stage-manifest');
  const children = record.stages ?? [];
  const input = inputsDigest(record.inputs);
  for (const name of record.requiredStages ?? []) {
    const matches = children.filter(s => s.id === name);
    if (matches.length !== 1) { gaps.push('stage-union'); continue; }
    const s = matches[0];
    if (s.completed !== true || s.status !== 0 || s.dirty !== false || s.head !== record.head || s.tree !== record.tree || !input || s.inputsDigest !== input || s.manifestDigest !== record.manifestDigest) gaps.push('stage-attestation');
  }
  if (children.some(s => !(record.requiredStages ?? []).includes(s.id))) gaps.push('stage-union');
  return [...new Set(gaps)].sort();
}
function validate(manifest, input) {
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > AUDIT_LIMITS.projects) fail('manifest must be a bounded nonempty array');
  for (const [i, p] of manifest.entries()) {
    if (!object(p) || typeof p.repo !== 'string' || p.repo.length > 160 || !REPO.test(p.repo) || p.repo.split('/').some(s => s === '.' || s === '..') || !['managed', 'source'].includes(p.role)) fail(`manifest[${i}] is invalid`);
  }
  if (new Set(manifest.map(p => p.repo)).size !== manifest.length) fail('manifest contains duplicate repositories');
  const projects = manifest.filter(p => p.role === 'managed').map(p => p.repo).sort();
  if (!projects.length) fail('manifest has no managed repositories');
  if (!object(input) || input.schema !== 1 || !date(input.observedAt) || !Array.isArray(input.records) || input.records.length > AUDIT_LIMITS.records) fail('input requires schema 1, observedAt and bounded records');
  for (const [i, r] of input.records.entries()) {
    const at = `records[${i}]`;
    if (!object(r) || typeof r.id !== 'string' || !TOKEN.test(r.id) || !projects.includes(r.repo) || !KINDS.includes(r.kind)) fail(`${at} has invalid identity, kind or unmanaged repository`);
    fields(r, at); stages(r, at);
    for (const key of ['startedAt', 'endedAt', 'heartbeatAt']) if (r[key] && Date.parse(r[key]) > Date.parse(input.observedAt)) fail(`${at}.${key} is after observedAt`);
    optional(r, 'stage', v => typeof v === 'string' && TOKEN.test(v), at);
    optional(r, 'baseline', object, at);
    if (r.baseline) {
      const b = r.baseline;
      optional(b, 'sampleCount', v => Number.isInteger(v) && v >= 0, `${at}.baseline`);
      optional(b, 'medianWallMs', finite, `${at}.baseline`);
      optional(b, 'thresholdRatio', v => finite(v) && v >= 1, `${at}.baseline`);
      optional(b, 'cohortDigest', v => typeof v === 'string' && DIGEST.test(v), `${at}.baseline`);
    }
    optional(r, 'review', object, at);
    if (r.review) {
      for (const key of ['base', 'reviewedBase', 'reviewedHead', 'workflowHead', 'expectedWorkflowHead']) optional(r.review, key, v => typeof v === 'string' && SHA.test(v), `${at}.review`);
      for (const key of ['workflow', 'expectedWorkflow']) optional(r.review, key, v => typeof v === 'string' && WORKFLOW.test(v), `${at}.review`);
      optional(r.review, 'inputComplete', v => typeof v === 'boolean', `${at}.review`);
      optional(r.review, 'event', v => typeof v === 'string' && TOKEN.test(v), `${at}.review`);
      optional(r.review, 'allowedEvents', v => Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every(e => typeof e === 'string' && TOKEN.test(e)), `${at}.review`);
    }
    optional(r, 'reuse', object, at);
    if (r.reuse) {
      optional(r.reuse, 'gateId', v => typeof v === 'string' && TOKEN.test(v), `${at}.reuse`);
      optional(r.reuse, 'policy', v => ['24-hours', 'until-change'].includes(v), `${at}.reuse`);
      optional(r.reuse, 'artifactIntegrity', v => ['verified', 'unknown', 'invalid'].includes(v), `${at}.reuse`);
      optional(r.reuse, 'artifactExpired', v => typeof v === 'boolean', `${at}.reuse`);
    }
  }
  return projects;
}

/** Audit observations only. A report can never grant permission to skip a gate. */
export function auditValidation(manifest, input) {
  const projects = validate(manifest, input);
  const records = [], seen = new Map(), conflicts = new Set();
  const findings = new Map();
  function finding(repo, rule, record, severity, reason, nextAction, details = {}) {
    const evidence = record ? hash([record.repo, record.id, record.head ?? null]) : null;
    const id = hash([repo, rule, evidence, record?.head ?? null]);
    findings.set(id, { id, repo, rule, severity, evidence, head: record?.head ?? null, reason, nextAction, ...details });
  }
  const normalized = input.records.map(r => {
    const copy = Object.fromEntries(['id', 'repo', 'kind', 'head', 'tree', 'dirty', 'completed', 'status', 'timedOut', 'startedAt', 'endedAt', 'heartbeatAt', 'wallMs', 'cpuMs', 'queueMs', 'timeoutMs', 'parentId', 'invocationId', 'purpose', 'retryOf', 'retryReason', 'gateSource', 'manifestDigest', 'requiredStages', 'stage'].filter(k => known(r[k])).map(k => [k, r[k]]));
    for (const [key, keys] of Object.entries({ inputs: INPUT_KEYS, baseline: ['sampleCount', 'medianWallMs', 'thresholdRatio', 'cohortDigest'], review: ['base', 'reviewedBase', 'reviewedHead', 'workflowHead', 'expectedWorkflowHead', 'workflow', 'expectedWorkflow', 'inputComplete', 'event', 'allowedEvents'], reuse: ['gateId', 'policy', 'artifactIntegrity', 'artifactExpired'] })) {
      if (r[key]) copy[key] = Object.fromEntries(keys.filter(k => known(r[key][k])).map(k => [k, r[key][k]]));
    }
    if (r.stages) copy.stages = r.stages.map(s => Object.fromEntries(['id', 'head', 'tree', 'dirty', 'completed', 'status', 'inputsDigest', 'manifestDigest'].filter(k => known(s[k])).map(k => [k, s[k]]))).sort((a, b) => a.id.localeCompare(b.id));
    if (copy.requiredStages) copy.requiredStages = [...copy.requiredStages].sort();
    return copy;
  }).sort((a, b) => hash(a).localeCompare(hash(b)));
  for (const r of normalized) {
    const key = JSON.stringify([r.repo, r.id]);
    // Private/extra fields have no semantics, but conflicting copies must never authorize a claim.
    const digest = hash(r);
    if (seen.has(key)) {
      if (seen.get(key) !== digest) conflicts.add(key);
      continue;
    }
    seen.set(key, digest); records.push(r);
  }
  for (const r of records) if (conflicts.has(JSON.stringify([r.repo, r.id]))) finding(r.repo, 'conflicting-evidence', r, 'gap', 'One evidence identity has conflicting records.', 'Recover the original immutable record before comparing or reusing it.');
  const usable = records.filter(r => !conflicts.has(JSON.stringify([r.repo, r.id])));
  const now = Date.parse(input.observedAt);
  const byGate = new Map(usable.filter(r => r.kind === 'gate').map(r => [JSON.stringify([r.repo, r.id]), r]));
  const duplicates = new Map();
  for (const r of usable) {
    if (r.kind !== 'review' && (!finite(r.wallMs) || !finite(r.cpuMs))) finding(r.repo, 'telemetry-incomplete', r, 'gap', 'Wall or CPU duration is unavailable; neither is inferred from the other.', 'Record wall and child CPU durations separately on the next producer run.');
    if (r.kind === 'gate') {
      const gaps = gateGaps(r);
      if (gaps.length) finding(r.repo, 'incomplete-attestation', r, 'gap', 'The record does not establish a complete exact-input configured gate.', 'Collect the original required stage union and clean exact-head input evidence; keep required validation.', { gaps });
      if (!gaps.length && r.purpose && !r.retryOf && !r.parentId) {
        const key = hash([r.repo, fingerprint(r), r.purpose]);
        const list = duplicates.get(key) ?? []; list.push(r); duplicates.set(key, list);
      }
    }
    if (['gate', 'stage'].includes(r.kind)) {
      const b = r.baseline ?? {}, cohort = cohortDigest(r);
      if (r.completed !== true || r.status !== 0 || r.dirty !== false || !cohort || b.cohortDigest !== cohort || !finite(r.wallMs) || !finite(b.medianWallMs) || b.medianWallMs === 0 || !(b.sampleCount >= 5) || !finite(b.thresholdRatio)) {
        finding(r.repo, 'baseline-insufficient', r, 'gap', 'The baseline is missing, too small or not comparable to these inputs.', 'Collect at least five comparable observations with explicit coverage, environment, cache and threshold.');
      } else if (r.wallMs > b.medianWallMs * b.thresholdRatio) {
        finding(r.repo, 'timing-regression', r, 'warning', 'Observed wall duration exceeds the explicit comparable baseline threshold.', 'Inspect stage and resource evidence before changing concurrency, fixtures or gate policy.', { measurement: { wallMs: r.wallMs, baselineMedianWallMs: b.medianWallMs, sampleCount: b.sampleCount, thresholdRatio: b.thresholdRatio } });
      }
    }
    if (r.kind === 'setup') {
      // Historical setup stops at its recorded end; the audit cutoff is only
      // a clock for setup without confirmed completion. A missing completed end stays unknown.
      const boundary = r.completed === true ? (r.endedAt ? Date.parse(r.endedAt) : null) : now;
      const elapsed = boundary !== null && r.startedAt ? boundary - Date.parse(r.startedAt) : null;
      if (r.timedOut === true || (r.completed !== true && r.timeoutMs > 0 && elapsed !== null && elapsed >= r.timeoutMs)) finding(r.repo, 'setup-stalled', r, 'warning', r.timedOut === true ? 'Setup timed out.' : 'No confirmed setup completion was recorded by the deadline.', 'Inspect redacted process and heartbeat diagnostics; retain failure and retry only the failed exact-input job.', { measurement: { elapsedMs: elapsed, timeoutMs: r.timeoutMs ?? null, heartbeatAgeMs: boundary !== null && r.heartbeatAt ? Math.max(0, boundary - Date.parse(r.heartbeatAt)) : null } });
      else if (r.completed !== true && (r.completed !== false || !r.startedAt || !(r.timeoutMs > 0))) finding(r.repo, 'setup-coverage-gap', r, 'gap', 'Setup completion is unknown or usable start/deadline evidence is missing.', 'Collect the original completion receipt, start, heartbeat and bounded deadline before another installation.');
    }
    if (r.kind === 'review') {
      const v = r.review;
      if (!v || !r.head || !v.base || v.reviewedHead !== r.head || v.reviewedBase !== v.base || v.inputComplete !== true) finding(r.repo, 'review-input-gap', r, 'gap', 'Complete review input for the exact base and head is not established.', 'Recover a complete pinned diff and reviewer input manifest; review the current exact head.');
      if (!v || !v.expectedWorkflowHead || v.workflowHead !== v.expectedWorkflowHead || !v.expectedWorkflow || v.workflow !== v.expectedWorkflow || !v.allowedEvents?.includes(v.event)) finding(r.repo, 'review-workflow-gap', r, 'gap', 'The recorded review workflow/event does not match the explicit expected route.', 'Verify the trusted workflow revision and use its working review event; retain the original review receipt.');
    }
    if (r.kind === 'reuse') {
      const u = r.reuse, gate = u ? byGate.get(JSON.stringify([r.repo, u.gateId])) : null;
      const age = gate?.endedAt ? now - Date.parse(gate.endedAt) : null;
      const same = gate && fingerprint(r) && fingerprint(r) === fingerprint(gate);
      if (!u || !same || r.dirty !== false || !gate || gateGaps(gate).length || u.artifactIntegrity !== 'verified' || u.artifactExpired !== false || age === null || age < 0 || !u.policy || (u.policy === '24-hours' && age > 86400000)) finding(r.repo, 'unsupported-reuse', r, 'warning', 'Recorded reuse lacks complete matching evidence or violates its freshness/artifact policy.', 'Keep the required gate until the existing validator accepts complete exact-head evidence; do not broaden freshness.');
    }
  }
  for (const list of duplicates.values()) {
    const invocations = [...new Map(list.sort((a, b) => b.id.localeCompare(a.id)).map(r => [r.invocationId, r])).values()].sort((a, b) => a.id.localeCompare(b.id));
    if (invocations.length < 2) continue;
    const r = invocations[0];
    // A group identity changes when its evidence set changes and ignores input order.
    const evidence = hash(invocations.map(x => [x.id, x.invocationId]).sort());
    finding(r.repo, 'redundant-gates', { ...r, id: evidence }, 'warning', 'Multiple complete gates record identical immutable inputs and purpose without a retry relationship.', 'Inspect why each invocation ran; preserve required checks and adopt reuse only through the existing validator.', { count: invocations.length });
  }
  const coverage = projects.map(repo => {
    const rows = usable.filter(r => r.repo === repo);
    if (!rows.length) finding(repo, 'project-coverage-gap', null, 'gap', 'No usable evidence was supplied for this managed repository.', 'Collect retained validation evidence for this repository; do not run full suites merely to fill this report.');
    else {
      for (const kind of ['gate', 'review']) if (!rows.some(r => r.kind === kind)) finding(repo, `${kind}-coverage-gap`, null, 'gap', `No ${kind} evidence was supplied for this managed repository.`, `Collect retained ${kind} receipts, preserving missing coverage as unknown.`);
    }
    return { repo, records: rows.length, kinds: [...new Set(rows.map(r => r.kind))].sort() };
  });
  return {
    schema: 1, observedAt: input.observedAt, authority: 'advisory-only', coverage,
    records: records.length, duplicateRecords: input.records.length - records.length,
    findings: [...findings.values()].sort((a, b) => a.repo.localeCompare(b.repo) || a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id)),
    measurements: usable.filter(r => r.kind !== 'review').map(r => ({ evidence: hash([r.repo, r.id, r.head ?? null]), repo: r.repo, kind: r.kind, wallMs: r.wallMs ?? null, cpuMs: r.cpuMs ?? null, queueMs: r.queueMs ?? null, intervalMs: r.startedAt && r.endedAt ? Date.parse(r.endedAt) - Date.parse(r.startedAt) : null })).sort((a, b) => a.evidence.localeCompare(b.evidence)),
    limits: ['Recorded evidence is not independently verified gate authority.', 'Unknown duration is null, not zero. CPU is not wall time.', 'Nested and overlapping durations are not added; no total elapsed or savings claim is made.', 'No p95 is estimated from these baseline summaries.', 'No gate, network request, notification or configuration change is performed.'],
  };
}

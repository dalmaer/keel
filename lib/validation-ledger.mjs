// Source-only retained observations. No gate execution or reuse authority.
import { createHash } from 'node:crypto';
import { archiveEntries, unpack } from '../practices/night/files/scripts/plates/test-history.mjs';
import { parseEvidenceJson } from './validation-evidence.mjs';

export const LEDGER_LIMITS = Object.freeze({ requests: 48, pages: 5, perPage: 100, timeoutMs: 30_000, jsonBytes: 1024 * 1024, archiveBytes: 8 * 1024 * 1024, expandedBytes: 16 * 1024 * 1024, entries: 256, records: 256 });
export const JOINT_INPUT_KEYS = Object.freeze(['command', 'config', 'workflow', 'lock', 'harness', 'runtime', 'environment', 'selection', 'cache']);
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const positive = x => Number.isSafeInteger(x) && x > 0;
const stringMatch = (value, pattern) => typeof value === 'string' && pattern.test(value);
const stamp = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x) && Number.isFinite(Date.parse(x));
const hash = x => createHash('sha256').update(x).digest('hex');
const opaque = x => hash(JSON.stringify(x));
const statusOf = x => x === 'success' ? 0 : ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(x) ? 1 : null;
const safePath = x => typeof x === 'string' && x.length <= 240 && /^[A-Za-z0-9_.\/-]+$/.test(x) && !x.split('/').some(v => !v || v === '.' || v === '..');
export class LedgerInputError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const invalid = code => { throw new LedgerInputError(code); };

/** Reviewed expectations are distinct from observations, including in fixtures. */
function validate(fleet, profile, runId, observedAt) {
  if (!object(profile) || profile.schema !== 1 || !stringMatch(profile.repo, REPO) || !stringMatch(profile.baseline, SHA) || !safePath(profile.workflow) || !stringMatch(profile.workflow, /^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/) || !stringMatch(profile.workflowName, TOKEN)) invalid('invalid_profile');
  if (!Array.isArray(fleet) || fleet.length > 100 || fleet.filter(p => p?.repo === profile.repo && p.role === 'managed').length !== 1 || new Set(fleet.map(p => p?.repo)).size !== fleet.length) invalid('unmanaged_repository');
  if (!positive(runId) || !stamp(observedAt)) invalid('invalid_run_or_time');
  if (!Array.isArray(profile.sources) || !profile.sources.length || profile.sources.length > 20 || profile.sources.some(s => !safePath(s.path) || !stringMatch(s.sha256, HASH)) || new Set(profile.sources.map(s => s.path)).size !== profile.sources.length) invalid('invalid_sources');
  if (!Array.isArray(profile.lanes) || profile.lanes.length !== 2 || profile.lanes.some(l => !stringMatch(l.id, TOKEN) || !stringMatch(l.artifact, TOKEN) || !stringMatch(l.job, TOKEN) || !['.', 'web'].includes(l.directory)) || new Set(profile.lanes.map(l => l.artifact)).size !== 2 || new Set(profile.lanes.map(l => l.id)).size !== 2) invalid('invalid_lanes');
  const stages = profile.configured?.stages;
  if (!Array.isArray(stages) || !stages.length || stages.length > 32 || stages.some(s => !stringMatch(s.id, TOKEN) || ![0, 400].includes(s.clockShiftDays) || !['.', 'web'].includes(s.directory) || (s.hosted !== null && (!object(s.hosted) || !stringMatch(s.hosted.job, TOKEN) || typeof s.hosted.step !== 'string' || s.hosted.step.length > 160))) || new Set(stages.map(s => s.id)).size !== stages.length) invalid('invalid_stages');
  if (!Array.isArray(profile.hosted?.jobs) || profile.hosted.jobs.length !== 3 || profile.hosted.jobs.some(j => !stringMatch(j, TOKEN)) || new Set(profile.hosted.jobs).size !== 3 || !Array.isArray(profile.hosted.extraStages) || profile.hosted.extraStages.length > 8 || profile.hosted.extraStages.some(s => !stringMatch(s.id, TOKEN) || !profile.hosted.jobs.includes(s.job) || typeof s.step !== 'string' || s.step.length > 160) || !Array.isArray(profile.hosted.webInstallOrder) || profile.hosted.webInstallOrder.length > 16 || profile.hosted.webInstallOrder.some(s => typeof s !== 'string' || s.length > 160)) invalid('invalid_hosted_profile');
}

/** Preserve cache and harness separately. Legacy short hashes stay short. */
export function bridgeLedgerInputs(record) {
  const inputs = Object.fromEntries(JOINT_INPUT_KEYS.map(k => [k, stringMatch(record.inputs?.[k], HASH) ? record.inputs[k] : null]));
  const legacy = {};
  for (const k of ['commandHash', 'config']) if (stringMatch(record[k], /^[a-f0-9]{12}$/)) legacy[k] = record[k];
  const privateData = {
    revision: stringMatch(record.privateData?.revision, SHA) ? record.privateData.revision : null,
    tree: stringMatch(record.privateData?.tree, SHA) ? record.privateData.tree : null,
  };
  return { schema: 1, inputs, legacy, privateData,
    projections: {
      auditSchema1: Object.fromEntries(JOINT_INPUT_KEYS.filter(k => k !== 'harness' && inputs[k]).map(k => [k, inputs[k]])),
      shadowSchema1: Object.fromEntries(JOINT_INPUT_KEYS.filter(k => k !== 'cache' && inputs[k]).map(k => [k, inputs[k]])),
    }, comparisonSupported: false };
}

/** request/download take constructed GET paths, never provider-returned URLs. */
export async function collectLedger({ fleet, profile, runId, request, download, observedAt = new Date().toISOString(), transport = 'override' }) {
  validate(fleet, profile, runId, observedAt);
  if (typeof request !== 'function' || typeof download !== 'function' || !['override', 'gh-read-only'].includes(transport)) invalid('invalid_transport');
  const repo = profile.repo, prefix = `repos/${repo}`, gaps = new Map(), records = [], children = [], sources = [], artifacts = [], jobsOut = [];
  let requests = 0, expanded = 0;
  const add = (code, evidence = null) => { const id = opaque([repo, runId, code, evidence]); gaps.set(id, { id, code, ...(evidence ? { evidence: opaque(evidence) } : {}) }); };
  async function read(path, binary = false, rawSource = false) {
    if (++requests > LEDGER_LIMITS.requests) { add('request_bound'); return null; }
    let timer;
    try {
      const bytes = await Promise.race([
        (binary ? download : request)(path, { maxBytes: binary ? LEDGER_LIMITS.archiveBytes : LEDGER_LIMITS.jsonBytes, timeoutMs: LEDGER_LIMITS.timeoutMs, ...(rawSource ? { accept: 'application/vnd.github.raw' } : {}) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), LEDGER_LIMITS.timeoutMs); }),
      ]);
      if (!(bytes instanceof Uint8Array) || bytes.length > (binary ? LEDGER_LIMITS.archiveBytes : LEDGER_LIMITS.jsonBytes)) throw new Error();
      return binary || rawSource ? Buffer.from(bytes) : parseEvidenceJson(bytes);
    } catch { add(binary ? 'archive_request_failed' : 'api_request_failed', path); return null; }
    finally { clearTimeout(timer); }
  }
  async function pages(path, key) {
    const rows = [], ids = new Set(); let total = null;
    for (let page = 1; page <= LEDGER_LIMITS.pages; page++) {
      const value = await read(`${path}?per_page=${LEDGER_LIMITS.perPage}&page=${page}`);
      if (!object(value) || !Array.isArray(value[key]) || value[key].length > LEDGER_LIMITS.perPage || !Number.isSafeInteger(value.total_count) || value.total_count < 0) { add('pagination_incomplete', key); return rows; }
      if (total !== null && total !== value.total_count) { add('pagination_changed', key); return rows; }
      total = value.total_count;
      for (const row of value[key]) {
        if (!object(row) || !positive(row.id) || ids.has(row.id)) { add('pagination_duplicate_or_invalid', key); continue; }
        ids.add(row.id); rows.push(row);
      }
      if (value[key].length < LEDGER_LIMITS.perPage || rows.length >= total) {
        if (rows.length !== total) add('pagination_incomplete', key);
        return rows;
      }
    }
    add('pagination_bound', key); return rows;
  }
  const run = await read(`${prefix}/actions/runs/${runId}`);
  if (!object(run) || run.id !== runId || !positive(run.run_attempt) || !stringMatch(run.head_sha, SHA) || !positive(run.workflow_id) || !positive(run.repository?.id) || run.repository.full_name !== repo || run.head_repository?.id !== run.repository.id || run.head_repository?.full_name !== repo || run.path !== profile.workflow) invalid('run_identity_unusable');
  const attempt = run.run_attempt, head = run.head_sha;
  const identity = { provider: 'github-actions', host: 'github.com', repo, runId, attempt, workflow: profile.workflow, workflowId: run.workflow_id, head, tree: null, observation: transport, executionAuthenticated: false };
  const repository = await read(prefix);
  if (repository?.id !== run.repository.id || repository?.full_name !== repo) add('repository_identity_mismatch');
  const workflow = await read(`${prefix}/actions/workflows/${run.workflow_id}`);
  if (workflow?.id !== run.workflow_id || workflow?.path !== profile.workflow || workflow?.name !== profile.workflowName || run.name !== profile.workflowName) add('workflow_identity_mismatch');
  const commit = await read(`${prefix}/git/commits/${head}`);
  if (commit?.sha !== head || !stringMatch(commit?.tree?.sha, SHA) || run.head_commit?.id !== head || run.head_commit?.tree_id !== commit?.tree?.sha) add('head_tree_mismatch');
  else identity.tree = commit.tree.sha;
  if (run.status !== 'completed' || run.conclusion !== 'success') add('workflow_not_successful');
  function interval(value, startKey, endKey) {
    const start = stamp(value?.[startKey]) ? value[startKey] : null, end = stamp(value?.[endKey]) ? value[endKey] : null;
    if (!start || !end || Date.parse(end) < Date.parse(start) || Date.parse(end) > Date.parse(observedAt)) { add('interval_unavailable'); return { startedAt: start, endedAt: end, wallMs: null, cpuMs: null }; }
    return { startedAt: start, endedAt: end, wallMs: Date.parse(end) - Date.parse(start), cpuMs: null };
  }
  const runInterval = interval(run, 'run_started_at', 'updated_at');
  const metadataIntervalMs = runInterval.wallMs;
  // updated_at is a metadata update, not an execution completion timestamp.
  runInterval.wallMs = null;
  // An explicit incomplete outer observation lets the existing audit retain the gap.
  records.push({ id: `run-${runId}-${attempt}`, repo, kind: 'gate', head, tree: identity.tree, dirty: null, completed: run.status === 'completed', status: statusOf(run.conclusion), gateSource: 'explicit-command', ...runInterval, requiredStages: profile.configured.stages.map(s => s.id), stages: [] });
  add('configured_gate_unobserved'); add('local_hosted_equivalence_unestablished'); add('schema_bridge_comparison_unsupported');
  for (const s of profile.configured.stages.filter(s => s.hosted === null)) add('local_stage_unobserved', s.id);
  for (const source of profile.sources) {
    // Source is not reporter JSON. Its immutable constructed contents endpoint
    // returns raw bytes under a fixed Accept header, with a separate byte cap.
    // This preserves the unchanged strict evidence parser's string/node limits.
    const bytes = await read(`${prefix}/contents/${source.path.split('/').map(encodeURIComponent).join('/')}?ref=${head}`, false, true);
    const actual = bytes ? hash(bytes) : null;
    sources.push({ path: source.path, expectedSha256: source.sha256, observedSha256: actual, matches: actual === source.sha256, role: 'reviewed-source-binding' });
    if (actual !== source.sha256) add('coverage_source_changed_or_unavailable', source.path);
  }
  const jobs = await pages(`${prefix}/actions/runs/${runId}/attempts/${attempt}/jobs`, 'jobs');
  for (const name of profile.hosted.jobs) {
    const matches = jobs.filter(j => j.name === name);
    if (matches.length !== 1) { add('job_missing_or_duplicate', name); continue; }
    const job = matches[0];
    if (job.run_id !== runId || job.run_attempt !== attempt || job.head_sha !== head || !Array.isArray(job.steps) || job.steps.length > 100) { add('job_identity_mismatch', name); continue; }
    if (job.status !== 'completed' || job.conclusion !== 'success') add('job_not_successful', name);
    const span = interval(job, 'started_at', 'completed_at');
    jobsOut.push({ job: name, id: job.id, completed: job.status === 'completed', conclusion: ['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required'].includes(job.conclusion) ? job.conclusion : 'unknown', ...span });
    records.push({ id: `job-${job.id}`, repo, kind: 'stage', stage: name, head, tree: identity.tree, dirty: null, completed: job.status === 'completed', status: statusOf(job.conclusion), ...span });
    const required = [...profile.configured.stages.filter(s => s.hosted?.job === name).map(s => ({ id: s.id, step: s.hosted.step })), ...profile.hosted.extraStages.filter(s => s.job === name)];
    for (const s of required) {
      const step = job.steps.filter(x => x.name === s.step);
      if (step.length !== 1 || step[0].status !== 'completed' || step[0].conclusion !== 'success') add('hosted_stage_missing_or_failed', s.id);
    }
    if (name === 'web') {
      const indexes = profile.hosted.webInstallOrder.map(step => job.steps.findIndex(s => s.name === step));
      if (indexes.some((v, i) => v < 0 || (i > 0 && v <= indexes[i - 1]))) add('web_install_order_mismatch');
    }
  }
  if (jobs.some(j => !profile.hosted.jobs.includes(j.name))) add('unexpected_job');
  const listed = await pages(`${prefix}/actions/runs/${runId}/artifacts`, 'artifacts');
  for (const lane of profile.lanes) {
    const matches = listed.filter(a => a.name === lane.artifact);
    if (matches.length !== 1) { add('artifact_missing_or_duplicate', lane.id); continue; }
    const a = matches[0], link = a.workflow_run;
    const item = { id: a.id, lane: lane.id, expectedJob: lane.job, jobAttribution: 'reviewed-name-convention-only', providerJobLinkObserved: false, attemptLinkObserved: false, sha256: null, integrityVerified: false };
    artifacts.push(item); add('artifact_job_link_unobserved', lane.id); add('artifact_attempt_link_unobserved', lane.id);
    if (link?.id !== runId || link?.repository_id !== run.repository.id || link?.head_repository_id !== run.repository.id || link?.head_sha !== head) { add('artifact_identity_mismatch', lane.id); continue; }
    if (a.expired !== false || !stamp(a.expires_at) || Date.parse(a.expires_at) <= Date.parse(observedAt)) { add('artifact_expired_or_unknown', lane.id); continue; }
    if (!stamp(a.created_at) || !stamp(a.updated_at) || !runInterval.startedAt || !runInterval.endedAt || Date.parse(a.created_at) < Date.parse(runInterval.startedAt) || Date.parse(a.updated_at) > Date.parse(runInterval.endedAt) || Date.parse(a.updated_at) < Date.parse(a.created_at)) { add('artifact_attempt_interval_mismatch', lane.id); continue; }
    if (!stringMatch(a.digest, /^sha256:[a-f0-9]{64}$/)) { add('artifact_digest_unavailable', lane.id); continue; }
    item.sha256 = a.digest.slice(7);
    if (!positive(a.size_in_bytes) || a.size_in_bytes > LEDGER_LIMITS.archiveBytes) { add('archive_size_bound', lane.id); continue; }
    const zip = await read(`${prefix}/actions/artifacts/${a.id}/zip`, true);
    if (!zip) continue;
    if (zip.length !== a.size_in_bytes || hash(zip) !== item.sha256) { add('archive_digest_mismatch', lane.id); continue; }
    let parsed;
    try {
      parsed = archiveEntries(zip, LEDGER_LIMITS.expandedBytes - expanded);
      if (parsed.entries.length > LEDGER_LIMITS.entries || parsed.entries.some(e => e.length > LEDGER_LIMITS.jsonBytes)) throw new Error();
      expanded += parsed.bytes;
      // Validate every entry, including metadata not interpreted as a child run.
      for (const e of parsed.entries) unpack(zip, e);
    } catch { add('archive_unsafe_or_corrupt', lane.id); continue; }
    item.integrityVerified = true;
    let accepted = 0;
    for (const entry of parsed.entries.filter(e => stringMatch(e.name, /^[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/))) {
      if (children.length >= LEDGER_LIMITS.records) { add('record_bound'); break; }
      const evidence = opaque([a.id, entry.name]);
      let child;
      try { child = parseEvidenceJson(unpack(zip, entry)); } catch { add('child_json_invalid_or_bound', evidence); continue; }
      if (!object(child) || !Array.isArray(child.tests) || !child.tests.length || child.tests.length > 10_000) { add('child_inventory_unavailable', evidence); continue; }
      if (child.commit !== head || child.tree !== identity.tree || child.dir !== lane.directory || (child.workflow !== undefined && child.workflow !== profile.workflowName)) { add('child_identity_mismatch', evidence); continue; }
      accepted++;
      const bridge = bridgeLedgerInputs(child);
      const dirty = typeof child.dirty === 'boolean' ? child.dirty : null;
      if (dirty !== false) add(dirty === true ? 'child_dirty_tree' : 'child_clean_tree_unknown', evidence);
      for (const k of JOINT_INPUT_KEYS) if (!bridge.inputs[k]) add(`input_${k}_unobserved`, evidence);
      if (!bridge.privateData.revision || !bridge.privateData.tree) add('private_data_unobserved', evidence);
      if (bridge.privateData.revision || bridge.privateData.tree) add('private_data_expected_revision_unbound', evidence);
      // Tests array is telemetry, not an independently bound expected inventory.
      add('child_inventory_not_attested', evidence); add('child_execution_lineage_unobserved', evidence);
      const failed = child.tests.some(t => t?.outcome === 'fail');
      if (child.completed !== true || failed || child.filtered === true) add('child_failed_incomplete_or_filtered', evidence);
      const endedAt = stamp(child.date) ? child.date : null;
      const wallMs = typeof child.wallMs === 'number' && Number.isFinite(child.wallMs) && child.wallMs >= 0 && child.wallMs <= 86400000 ? child.wallMs : null;
      const startedAt = endedAt && wallMs !== null ? new Date(Date.parse(endedAt) - wallMs).toISOString() : null;
      if (!endedAt || !runInterval.startedAt || !runInterval.endedAt || Date.parse(endedAt) > Date.parse(runInterval.endedAt) || (startedAt && Date.parse(startedAt) < Date.parse(runInterval.startedAt))) add('child_interval_mismatch', evidence);
      const setting = child.setting?.env?.LEDGE_CLOCK_SHIFT_DAYS;
      const redacted = object(setting) && setting.name === 'LEDGE_CLOCK_SHIFT_DAYS' && typeof setting.set === 'boolean' && (setting.set ? stringMatch(setting.hash, /^[a-f0-9]{12}$/) : setting.hash === null);
      const clockObservation = redacted ? { representation: 'redacted-setting', set: setting.set, valueHash12: setting.hash } : { representation: ['0', '400'].includes(setting) ? 'literal-setting' : 'unknown', set: setting === undefined ? null : true, valueHash12: null };
      // A short hash is retained as observed, never decoded into an environment.
      const clockShiftDays = setting === '400' ? 400 : setting === '0' || (redacted && setting.set === false) ? 0 : null;
      if (clockShiftDays === null) add('child_clock_unobserved', evidence);
      const id = `child-${evidence}`;
      const row = { id, repo, kind: 'stage', stage: lane.id, head, tree: child.tree, dirty, completed: child.completed === true, status: failed ? 1 : child.tests.every(t => ['pass', 'skip', 'todo'].includes(t?.outcome)) && child.completed === true ? 0 : null, inputs: bridge.projections.auditSchema1, startedAt, endedAt, wallMs, cpuMs: null };
      records.push(row);
      children.push({ id, lane: lane.id, archiveEvidence: opaque([a.id]), childBytesSha256: hash(unpack(zip, entry)), dirty, clockShiftDays, clockObservation, observedTests: child.tests.length, runtimeVersion: stringMatch(child.node, /^v\d+\.\d+\.\d+$/) ? child.node : null, intervalSource: 'retained-end-and-wall-derived-start', retainedInterval: { startedAt, endedAt, wallMs, cpuMs: null }, bridge });
    }
    if (!accepted) add('lane_child_inventory_missing', lane.id);
  }
  for (const lane of profile.lanes) {
    const observed = children.filter(c => c.lane === lane.id);
    for (const clock of [0, 400]) if (observed.filter(c => c.clockShiftDays === clock).length !== 1) add('child_clock_missing_or_duplicate', [lane.id, clock]);
  }
  // Unknown inputs stay unknown even when a run or lane has no retained children.
  add('private_data_unobserved'); add('runtime_cache_harness_equivalence_unestablished');
  const findings = [...gaps.values()].sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
  return { schema: 1, authority: 'advisory-only', reuseAuthorized: false, configuredGateComplete: false, status: findings.length ? 1 : 0,
    observedAt, identity, runObservation: { ...runInterval, metadataIntervalMs, intervalSource: 'provider-run-start-to-metadata-update', executionWallMeasured: false }, coverageManifest: { schema: profile.schema, parsedObjectSha256: opaque(profile), digestSemantics: 'sha256-utf8-JSON.stringify-parsed-profile-property-order-preserved', baseline: profile.baseline, expectedStages: profile.configured.stages.map(s => s.id), equivalenceEstablished: false },
    coverage: { requests, expandedBytes: expanded, childRecords: children.length }, sources, jobs: jobsOut, artifacts, children, gaps: findings,
    auditInput: { schema: 1, observedAt, records: records.map(row => {
      const copy = { ...row };
      // Preserve anomalous original spans in provenance, not invalid audit dates.
      if (!stamp(copy.startedAt) || !stamp(copy.endedAt) || Date.parse(copy.startedAt) > Date.parse(copy.endedAt) || Date.parse(copy.endedAt) > Date.parse(observedAt)) { copy.startedAt = null; copy.endedAt = null; }
      return copy;
    }) },
    limits: ['Provider metadata and archive integrity are retained observations, not authenticated execution lineage.', 'Job/artifact names do not establish a provider-observed job or attempt link.', 'Unknown CPU remains null; overlapping spans are never summed.', 'Expected source digests do not substitute observed runtime/config/cache/harness or private-data inputs.', 'Nightly schema 1 omits harness and shadow schema 1 omits cache; joint values are retained without field substitution.', 'No complete configured-gate equivalence, gate exemption or reuse authorization is established.'] };
}

// Phase 114 source-only shadow contract. No execution, policy or reuse authority.
import { createHash } from 'node:crypto';

export const EVIDENCE_LIMITS = Object.freeze({ bytes: 1024 * 1024, stages: 128, depth: 12, nodes: 20000, string: 4096 });
export const INPUT_KEYS = Object.freeze(['command', 'config', 'workflow', 'lock', 'harness', 'runtime', 'environment', 'selection']);
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const WORKFLOW = /^\.github\/workflows\/[A-Za-z0-9_-]{1,100}\.ya?ml$/;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const string = (v, re) => typeof v === 'string' && re.test(v);
const canonical = v => Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const stamp = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const bytesDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export class EvidenceInputError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const invalid = code => { throw new EvidenceInputError(code); };

/** Bound all public object inputs too; never recurse arbitrarily deeply. */
function bounded(value) {
  let nodes = 0;
  function walk(v, depth) {
    if (++nodes > EVIDENCE_LIMITS.nodes || depth > EVIDENCE_LIMITS.depth) invalid('input_limits');
    if (typeof v === 'string') { if (v.length > EVIDENCE_LIMITS.string) invalid('input_limits'); return; }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
    if (!Array.isArray(v) && !object(v)) invalid('invalid_json_value');
    for (const [k, child] of Object.entries(v)) {
      if (k.length > EVIDENCE_LIMITS.string) invalid('input_limits');
      walk(child, depth + 1);
    }
  }
  walk(value, 0);
}

/** Parse exact UTF-8 bytes; reject ambiguous duplicate keys as well as malformed JSON. */
export function parseEvidenceJson(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > EVIDENCE_LIMITS.bytes) invalid('input_bytes');
  let text, value;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); value = JSON.parse(text); }
  catch { invalid('invalid_json'); }
  const stack = [];
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g)) {
    const t = token[0], top = stack.at(-1);
    if (t === '{' || t === '[') {
      stack.push({ object: t === '{', key: t === '{', names: new Set() });
      if (stack.length > EVIDENCE_LIMITS.depth) invalid('input_limits');
    } else if (t === '}' || t === ']') stack.pop();
    else if (t === ',' && top?.object) top.key = true;
    else if (t.startsWith('"') && top?.object && top.key) {
      const name = JSON.parse(t);
      if (top.names.has(name)) invalid('duplicate_json_key');
      top.names.add(name); top.key = false;
    }
  }
  bounded(value);
  return value;
}

function candidate(v) {
  return exact(v, ['repo', 'head', 'tree', 'dirty', 'gateSource', 'inputs']) && string(v.repo, REPO) &&
    string(v.head, SHA) && string(v.tree, SHA) && v.dirty === false && v.gateSource === 'configured-check' &&
    exact(v.inputs, INPUT_KEYS) && INPUT_KEYS.every(k => string(v.inputs[k], DIGEST));
}
function manifest(v) {
  return exact(v, ['schema', 'repo', 'gateCommandDigest', 'stages']) && v.schema === 1 && string(v.repo, REPO) &&
    string(v.gateCommandDigest, DIGEST) && Array.isArray(v.stages) && v.stages.length > 0 && v.stages.length <= EVIDENCE_LIMITS.stages &&
    v.stages.every(s => exact(s, ['id', 'commandDigest']) && string(s.id, ID) && string(s.commandDigest, DIGEST)) &&
    new Set(v.stages.map(s => s.id)).size === v.stages.length;
}
/** SHA-256 of UTF-8 compact JSON with recursively sorted object keys and stages sorted by ASCII ID. */
export function manifestDigest(value) {
  bounded(value);
  if (!manifest(value)) invalid('invalid_manifest');
  return bytesDigest(Buffer.from(JSON.stringify(canonical({ ...value, stages: [...value.stages].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }))));
}
const SOURCE_KEYS = ['provider', 'repo', 'workflow', 'runId', 'attempt'];
function source(v, withDigest = false) {
  return exact(v, withDigest ? [...SOURCE_KEYS, 'artifactId', 'expiresAt', 'sha256'] : SOURCE_KEYS) && v.provider === 'github-actions' &&
    string(v.repo, REPO) && string(v.workflow, WORKFLOW) && string(v.runId, /^[1-9][0-9]{0,19}$/) &&
    v.attempt === 1 && (!withDigest || (string(v.artifactId, /^[1-9][0-9]{0,19}$/) && stamp(v.expiresAt) && string(v.sha256, DIGEST)));
}
function expectation(v) {
  return exact(v, ['schema', 'candidate', 'manifest', 'evaluatedAt', 'freshness']) && v.schema === 1 && candidate(v.candidate) &&
    manifest(v.manifest) && v.manifest.repo === v.candidate.repo && v.manifest.gateCommandDigest === v.candidate.inputs.command &&
    stamp(v.evaluatedAt) && (exact(v.freshness, ['mode']) && v.freshness.mode === 'until-change' ||
      exact(v.freshness, ['mode', 'maxAgeMs']) && v.freshness.mode === 'max-age' && Number.isSafeInteger(v.freshness.maxAgeMs) && v.freshness.maxAgeMs > 0);
}
const LIMITS = Object.freeze([
  'Advisory structure and byte-identity checks only; reuse is never authorized.',
  'Caller-supplied expectations, digests and source metadata are not origin authentication or truthful execution proof.',
  'No real consumer producer, stage equivalence or existing gate integration is established.',
  'Single first attempt only; retry and cross-attempt aggregation require a later reviewed contract.',
]);

/** Separate expectations/source from artifact bytes. Never infer requirements from the evidence. */
export function validateEvidence(expected, expectedSource, artifactBytes) {
  bounded(expected); bounded(expectedSource);
  if (!expectation(expected)) invalid('invalid_expectation');
  if (!source(expectedSource, true) || expectedSource.repo !== expected.candidate.repo) invalid('invalid_source');
  if (!(artifactBytes instanceof Uint8Array) || !artifactBytes.byteLength || artifactBytes.byteLength > EVIDENCE_LIMITS.bytes) invalid('input_bytes');
  const findings = [];
  const add = (code, stage) => findings.push(stage ? { code, stage } : { code });
  const result = () => ({ schema: 1, authority: 'advisory-only', reuseAuthorized: false, coverageComplete: findings.length === 0,
    status: findings.length ? 1 : 0, artifact: { id: expectedSource.artifactId, sha256: expectedSource.sha256, expiresAt: expectedSource.expiresAt, provenance: 'caller-supplied' }, manifestDigest: manifestDigest(expected.manifest), findings, limits: [...LIMITS] });
  if (bytesDigest(artifactBytes) !== expectedSource.sha256) { add('artifact_digest_mismatch'); return result(); }
  const artifact = parseEvidenceJson(artifactBytes);
  if (!object(artifact) || artifact.schema !== 1) invalid('unsupported_artifact_schema');
  const outerKeys = ['schema', 'candidate', 'manifestDigest', 'invocationId', 'source', 'startedAt', 'endedAt', 'completed', 'status', 'stages'];
  if (!exact(artifact, outerKeys)) { add('outer_fields'); return result(); }
  const expectedIdentity = Object.fromEntries(SOURCE_KEYS.map(k => [k, expectedSource[k]]));
  const digest = manifestDigest(expected.manifest);
  if (!candidate(artifact.candidate) || !same(artifact.candidate, expected.candidate)) add('candidate_mismatch');
  if (artifact.manifestDigest !== digest) add('manifest_mismatch');
  if (!string(artifact.invocationId, ID)) add('invocation_missing');
  if (!source(artifact.source) || !same(artifact.source, expectedIdentity)) add('source_mismatch');
  if (artifact.completed !== true || artifact.status !== 0) add('outer_failed_or_incomplete');
  const now = Date.parse(expected.evaluatedAt), start = Date.parse(artifact.startedAt), end = Date.parse(artifact.endedAt);
  const interval = stamp(artifact.startedAt) && stamp(artifact.endedAt) && start <= end && end <= now;
  if (!interval) add('outer_chronology');
  if (Date.parse(expectedSource.expiresAt) <= now) add('artifact_expired');
  if (interval && Date.parse(expectedSource.expiresAt) <= end) add('artifact_expiry_chronology');
  if (interval && expected.freshness.mode === 'max-age' && now - end > expected.freshness.maxAgeMs) add('evidence_stale');
  if (!Array.isArray(artifact.stages) || artifact.stages.length > EVIDENCE_LIMITS.stages) { add('invalid_stage_union'); return result(); }
  const required = new Map(expected.manifest.stages.map(s => [s.id, s.commandDigest]));
  const seen = new Set(), invocations = new Set([artifact.invocationId]);
  const childKeys = ['id', 'commandDigest', 'candidate', 'manifestDigest', 'invocationId', 'parentInvocationId', 'source', 'startedAt', 'endedAt', 'completed', 'status'];
  for (const child of artifact.stages) {
    const id = object(child) && string(child.id, ID) ? child.id : undefined;
    if (!exact(child, childKeys) || !id) { add('stage_fields'); continue; }
    if (!required.has(id)) { add('stage_unexpected', id); continue; }
    if (seen.has(id)) add('stage_duplicate', id);
    seen.add(id);
    if (child.commandDigest !== required.get(id)) add('stage_command_mismatch', id);
    if (!candidate(child.candidate) || !same(child.candidate, expected.candidate)) add('stage_candidate_mismatch', id);
    if (child.manifestDigest !== digest) add('stage_manifest_mismatch', id);
    if (!string(child.invocationId, ID) || invocations.has(child.invocationId)) add('stage_invocation_invalid', id);
    invocations.add(child.invocationId);
    if (child.parentInvocationId !== artifact.invocationId || !string(child.parentInvocationId, ID)) add('stage_parent_mismatch', id);
    if (!source(child.source) || !same(child.source, expectedIdentity)) add('stage_source_mismatch', id);
    if (child.completed !== true || child.status !== 0) add('stage_failed_or_incomplete', id);
    if (!interval || !stamp(child.startedAt) || !stamp(child.endedAt) || Date.parse(child.startedAt) < start ||
      Date.parse(child.endedAt) < Date.parse(child.startedAt) || Date.parse(child.endedAt) > end) add('stage_chronology', id);
  }
  for (const id of required.keys()) if (!seen.has(id)) add('stage_missing', id);
  return result();
}

import { validateScreeningCriteria } from './lesson-screening-criteria.mjs';
// Schema-2 harness definitions. Pure validation: no filesystem, execution or authority grants.
import { createHash } from 'node:crypto';
export const EVALUATION_BYTES = 1024 * 1024;
export const checkEvaluation = (ok, message) => { if (!ok) throw Object.assign(new Error(`evaluations: ${message}`), { exitCode: 2 }); };
const check = checkEvaluation;
export function fields(x, names) {
  check(x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x, k)), 'invalid fields');
}
const text = x => typeof x === 'string' && x.length > 0 && x.length <= 4096 && !/[\x00-\x1f\x7f]/.test(x);
export const evaluationId = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const time = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const integer = (x, min, max) => Number.isSafeInteger(x) && x >= min && x <= max;
const amount = x => Number.isFinite(x) && x > 0 && x <= 1000000;
const money = x => x === null || amount(x);
const repo = x => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9_.-]{0,99}$/i.test(x) && !x.toLowerCase().endsWith('.git');
export function relativeFile(x) {
  check(text(x) && !x.includes('\\') && !x.includes(':') && !x.startsWith('/') && x.split('/').every(s => s && s !== '.' && s !== '..') && !x.split('/').some(s => s.toLowerCase() === '.git'), 'unsafe relative path');
}
function list(x, fn, min = 0, max = 100) {
  check(Array.isArray(x) && x.length >= min && x.length <= max, 'array exceeds bounds');
  for (const item of x) fn(item);
}
const strings = (x, min = 0) => list(x, v => check(text(v), 'invalid text'), min);
const version = x => typeof x === 'string' && /^v?\d+(?:\.\d+){0,3}(?:[-+][a-zA-Z0-9.-]+)?$/.test(x) && x.length <= 128;
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isFinite(value), 'non-finite number'); return JSON.stringify(value); }
  if (Array.isArray(value)) { check(Object.keys(value).length === value.length, 'sparse array'); return `[${value.map(canonical).join(',')}]`; }
  check(value && Object.getPrototypeOf(value) === Object.prototype, 'non-JSON value');
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export const byteDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const fingerprint = value => byteDigest(canonical(value));
export function sealRecord(record) {
  const { digest: ignored, ...body } = record;
  return { ...body, digest: fingerprint(body) };
}
function header(x, kind, extra) {
  fields(x, ['schemaVersion', 'kind', 'id', 'createdAt', 'digest', ...extra]);
  check(x.schemaVersion === 2 && x.kind === kind && evaluationId(x.id) && time(x.createdAt) && hash(x.digest), 'invalid record identity');
  check(sealRecord(x).digest === x.digest, 'record digest mismatch');
}
function environment(x) {
  fields(x, ['image', 'platform', 'dependencyLock', 'installer']);
  check(typeof x.image === 'string' && /^sha256:[a-f0-9]{64}$/.test(x.image) && ['linux/arm64', 'linux/amd64'].includes(x.platform) && hash(x.dependencyLock) && hash(x.installer), 'unpinned environment');
}
function limits(x) {
  fields(x, ['timeoutSeconds', 'minutes', 'currencyUsd']);
  check(integer(x.timeoutSeconds, 1, 86400) && amount(x.minutes) && money(x.currencyUsd), 'invalid case limits');
}
function reference(x, kind, records) {
  fields(x, ['kind', 'id', 'digest']);
  check(x.kind === kind && evaluationId(x.id) && hash(x.digest), 'invalid reference');
  const result = records.find(r => r.kind === kind && r.id === x.id && r.digest === x.digest);
  check(result, 'unresolved reference'); return result;
}
export function validateEvaluationBundle(bundle) {
  check(Buffer.byteLength(canonical(bundle)) <= EVALUATION_BYTES, 'bundle exceeds byte bound');
  fields(bundle, ['schemaVersion', 'kind', 'cases', 'configurations', 'materials', 'comparison']);
  check(bundle.schemaVersion === 2 && bundle.kind === 'harness', 'schema-2 harness bundle required');
  list(bundle.materials, x => {
    header(x, 'material', ['mediaType', 'content']);
    check(['text/plain', 'application/json'].includes(x.mediaType) && typeof x.content === 'string' && Buffer.byteLength(x.content) <= 65536, 'invalid material bytes');
  }, 1);
  list(bundle.cases, x => {
    header(x, 'case', ['version', 'taskClass', 'publicBrief', 'repository', 'startingCommit', 'environment', 'allowlist', 'prerequisites', 'requirements', 'acceptanceManifest', 'limits', 'provenance', 'visibility', 'exposure']);
    check(integer(x.version, 1, 1000000) && text(x.taskClass) && text(x.publicBrief) && repo(x.repository) && sha(x.startingCommit), 'mutable or missing case identity');
    environment(x.environment); limits(x.limits);
    fields(x.allowlist, ['tools', 'network', 'paths']); strings(x.allowlist.tools);
    list(x.allowlist.network, v => check(typeof v === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(v), 'invalid network host'));
    list(x.allowlist.paths, relativeFile, 1); strings(x.prerequisites); strings(x.requirements, 1); strings(x.provenance, 1);
    reference(x.acceptanceManifest, 'material', bundle.materials);
    check(['development', 'held-out'].includes(x.visibility), 'invalid visibility');
    list(x.exposure, e => { fields(e, ['actor', 'at', 'reason']); check(text(e.actor) && time(e.at) && text(e.reason), 'invalid exposure'); });
  }, 1, 20);
  list(bundle.configurations, x => {
    header(x, 'configuration', ['harnessCommit', 'dirtyOverlay', 'provider', 'runtime', 'model', 'context', 'overlays', 'exclusions', 'tools', 'routing', 'policy', 'environment']);
    check(sha(x.harnessCommit) && (x.dirtyOverlay === null || hash(x.dirtyOverlay)) && text(x.provider), 'unpinned harness');
    fields(x.runtime, ['name', 'version', 'settings']); check(text(x.runtime.name) && version(x.runtime.version), 'invalid runtime');
    fields(x.runtime.settings, ['temperature', 'maxTokens']);
    check((x.runtime.settings.temperature === null || (Number.isFinite(x.runtime.settings.temperature) && x.runtime.settings.temperature >= 0 && x.runtime.settings.temperature <= 2)) && integer(x.runtime.settings.maxTokens, 1, 10000000), 'invalid runtime settings');
    fields(x.model, ['requested', 'resolved', 'unresolvedReason']);
    check(text(x.model.requested) && (x.model.resolved === null ? text(x.model.unresolvedReason) : text(x.model.resolved) && x.model.unresolvedReason === null), 'model identity or explicit unresolved alias required');
    for (const entries of [x.context, x.overlays]) {
      const seen = new Set();
      list(entries, e => { fields(e, ['path', 'material']); relativeFile(e.path); check(!seen.has(e.path), 'duplicate context path'); seen.add(e.path); reference(e.material, 'material', bundle.materials); });
    }
    list(x.exclusions, relativeFile);
    list(x.tools, tool => { fields(tool, ['name', 'version', 'configDigest']); check(text(tool.name) && version(tool.version) && hash(tool.configDigest), 'unpinned tool'); });
    fields(x.routing, ['provider', 'policyDigest']); check(x.routing.provider === x.provider && hash(x.routing.policyDigest), 'invalid routing');
    fields(x.policy, ['execution', 'review', 'automatic']);
    check(x.policy.execution === 'offline-only' && x.policy.review === 'independent' && x.policy.automatic === false, 'unsupported or automatic application');
    environment(x.environment);
  }, 2, 2);
  const acceptanceBytes = new Set(bundle.cases.map(c => byteDigest(reference(c.acceptanceManifest, 'material', bundle.materials).content)));
  for (const config of bundle.configurations) for (const entry of [...config.context, ...config.overlays]) {
    check(!acceptanceBytes.has(byteDigest(reference(entry.material, 'material', bundle.materials).content)), 'acceptance material cannot enter builder context');
  }
  const records = [...bundle.materials, ...bundle.cases, ...bundle.configurations];
  check(new Set(records.map(r => `${r.kind}:${r.id}`)).size === records.length, 'duplicate record identity');
  const x = bundle.comparison;
  header(x, 'comparison', ['repository', 'authority', 'baseline', 'candidate', 'cases', 'pairs', 'seed', 'stopping', 'replacements', 'allowance', 'retention', 'drift', 'promotion']);
  check(repo(x.repository), 'invalid comparison repository');
  fields(x.authority, ['kind', 'ref']);
  const authority = x.authority;
  check(typeof authority.ref === 'string' && (authority.kind === 'phase' ? /^[1-9]\d{0,8}$/.test(authority.ref) : authority.kind === 'issue' && authority.ref.split('#').length === 2 && authority.ref.split('#')[0].toLowerCase() === x.repository.toLowerCase() && /^[1-9]\d{0,8}$/.test(authority.ref.split('#')[1])), 'invalid authority');
  const baseline = reference(x.baseline, 'configuration', records), candidate = reference(x.candidate, 'configuration', records);
  check(baseline.id !== candidate.id && canonical(baseline.exclusions) === canonical(candidate.exclusions), 'arms need distinct identities and matching exclusions');
  list(x.cases, r => { const c = reference(r, 'case', records); check(c.repository.toLowerCase() === x.repository.toLowerCase(), 'case outside comparison repository'); }, 1, 20);
  check(new Set(x.cases.map(r => r.id)).size === x.cases.length && x.cases.length === bundle.cases.length, 'duplicate or unused case');
  list(x.pairs, p => { fields(p, ['id', 'case', 'order']); check(evaluationId(p.id) && ['AB', 'BA'].includes(p.order), 'invalid pair slot'); reference(p.case, 'case', bundle.cases); }, 5, 1000);
  check(new Set(x.pairs.map(p => p.id)).size === x.pairs.length, 'duplicate pair identity');
  for (const c of x.cases) {
    const pairs = x.pairs.filter(p => p.case.id === c.id);
    check(pairs.length >= 5 && Math.abs(pairs.filter(p => p.order === 'AB').length - pairs.filter(p => p.order === 'BA').length) <= 1 && pairs.every((p, i) => i === 0 || p.order !== pairs[i - 1].order), 'five interleaved balanced pairs required per case');
  }
  check(integer(x.seed, 0, 2147483647) && x.stopping === 'all-planned-or-safety' && x.replacements === 0 && x.drift === 'unknown-is-incomparable', 'unsupported comparison policy');
  fields(x.allowance, ['minutes', 'currencyUsd']); check(amount(x.allowance.minutes) && money(x.allowance.currencyUsd), 'invalid allowance');
  check(x.pairs.reduce((n, p) => n + 2 * reference(p.case, 'case', records).limits.minutes, 0) <= x.allowance.minutes, 'planned minutes exceed allowance');
  if (x.allowance.currencyUsd !== null) check(x.pairs.every(p => reference(p.case, 'case', records).limits.currencyUsd !== null) && x.pairs.reduce((n, p) => n + 2 * reference(p.case, 'case', records).limits.currencyUsd, 0) <= x.allowance.currencyUsd, 'unknown or excessive planned currency');
  fields(x.retention, ['days', 'maxBytes', 'maxEvents']);
  check(integer(x.retention.days, 1, 3650) && integer(x.retention.maxBytes, 1024, EVALUATION_BYTES * 64) && integer(x.retention.maxEvents, 1, 20000), 'invalid retention bounds');
  fields(x.promotion, ['automatic', 'criteria']); check(x.promotion.automatic === false, 'automatic application unavailable'); validateScreeningCriteria(x.promotion.criteria, x.cases.map(c => c.id));
  return bundle;
}

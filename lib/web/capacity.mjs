// Internal adapter normalization only. This is not an authenticated reporter or
// an endpoint for owner/browser-supplied quota claims. No unit totals are made.
import { exact } from './common.mjs';

const providers = ['openai', 'anthropic', 'codex', 'claude', 'runner'];
const units = { subscription: ['percent'], 'api-rate': ['requests', 'tokens', 'input-tokens', 'output-tokens'], spend: ['usd'], runner: ['workers'] };
const provenances = ['provider-response', 'authenticated-reporter', 'unknown'];
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/|-]{0,199}$/.test(value);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e15;
const nullableNumber = value => value === null || number(value);
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
const fields = ['provider', 'identity', 'pool', 'kind', 'unit', 'models', 'measurement', 'window', 'observedAt', 'expiresAt', 'source', 'confidence', 'nonAdditive'];

function normalize(input, now, index) {
  if (!exact(input, fields) || !providers.includes(input.provider) || !Object.hasOwn(units, input.kind)
      || !units[input.kind].includes(input.unit)) return null;
  const { identity, pool, models, measurement, window, source } = input;
  if (!exact(identity, ['account', 'workspace', 'scope', 'provenance'])
      || ![identity.account, identity.workspace].every(value => value === null || identifier(value))
      || !provenances.includes(identity.provenance) || !['account', 'workspace', 'unknown'].includes(identity.scope)
      || identity.scope === 'account' && identity.workspace !== null
      || !exact(pool, ['id', 'provenance']) || !(pool.id === null || identifier(pool.id)) || !provenances.includes(pool.provenance)
      || !exact(models, ['ids', 'provenance']) || !Array.isArray(models.ids) || models.ids.length > 100
      || !models.ids.every(identifier) || new Set(models.ids).size !== models.ids.length || !provenances.includes(models.provenance)
      || (models.provenance === 'unknown' && models.ids.length)
      || !exact(measurement, ['used', 'remaining', 'limit']) || !exact(window, ['durationMinutes', 'resetAt'])
      || !exact(source, ['kind', 'id']) || !['api-response', 'local-reporter', 'owner-claim', 'unsupported'].includes(source.kind)
      || !identifier(source.id) || !['observed', 'claimed', 'unknown'].includes(input.confidence)
      || typeof input.nonAdditive !== 'boolean') return null;
  // A readable identity still carries a malformed measurement as unavailable,
  // so a newer bad reading cannot silently resurrect an older usable value.
  const validTime = iso(input.observedAt) && Date.parse(input.observedAt) <= now;
  const validExpiry = iso(input.expiresAt) && validTime && Date.parse(input.expiresAt) > Date.parse(input.observedAt);
  const validWindow = (window.durationMinutes === null || (number(window.durationMinutes) && window.durationMinutes > 0))
    && (window.resetAt === null || iso(window.resetAt));
  const validNumbers = Object.values(measurement).every(nullableNumber)
    && (measurement.limit === null || [measurement.used, measurement.remaining].every(n => n === null || n <= measurement.limit))
    && (Object.values(measurement).some(n => n === null) || Math.abs(measurement.used + measurement.remaining - measurement.limit) < 1e-8)
    && (input.unit !== 'percent' || (measurement.limit === null || measurement.limit === 100)
      && [measurement.used, measurement.remaining].every(n => n === null || n <= 100));
  const established = identity.account !== null && identity.provenance !== 'unknown'
    && (identity.scope === 'account' || identity.scope === 'workspace' && identity.workspace !== null) && pool.id !== null && pool.provenance !== 'unknown';
  const tuple = [input.provider, identity.scope, identity.account, identity.workspace, pool.id, input.kind, input.unit,
    validWindow ? window.durationMinutes : null, validWindow && window.resetAt !== null ? new Date(window.resetAt).toISOString() : null];
  const id = JSON.stringify(established ? tuple : ['unresolved', index, ...tuple]);
  const timedKind = ['subscription', 'api-rate'].includes(input.kind);
  const complete = validTime && validExpiry && validWindow && validNumbers && measurement.limit !== null
    && measurement.remaining !== null && (!timedKind || window.durationMinutes !== null && window.resetAt !== null)
    && (!timedKind || Date.parse(window.resetAt) > Date.parse(input.observedAt));
  const supported = input.confidence === 'observed' && ['api-response', 'local-reporter'].includes(source.kind);
  const expired = validTime && validExpiry && (Date.parse(input.expiresAt) <= now
    || (validWindow && window.resetAt !== null && Date.parse(window.resetAt) <= now));
  const state = expired ? 'expired' : complete && established && supported ? 'observed' : 'unavailable';
  return {
    id, provider: input.provider, identity: { ...identity }, pool: { ...pool }, kind: input.kind, unit: input.unit,
    models: { ids: [...models.ids].sort(), provenance: models.provenance },
    measurement: validNumbers ? { ...measurement } : { used: null, remaining: null, limit: null },
    window: validWindow ? { durationMinutes: window.durationMinutes, resetAt: window.resetAt === null ? null : new Date(window.resetAt).toISOString() } : { durationMinutes: null, resetAt: null },
    observedAt: validTime ? new Date(input.observedAt).toISOString() : null,
    expiresAt: validExpiry ? new Date(input.expiresAt).toISOString() : null,
    source: { ...source }, confidence: input.confidence, nonAdditive: input.nonAdditive,
    state, eligible: state === 'observed' && !input.nonAdditive, origins: [source.id],
    incomplete: !complete,
  };
}

export function capacityModel(observations = [], { now = Date.now } = {}) {
  const at = typeof now === 'function' ? now() : now;
  if (!Number.isFinite(at) || !Array.isArray(observations) || observations.length > 500) {
    return { pools: [], gaps: [{ code: 'capacity_input_invalid' }] };
  }
  const groups = new Map(), gaps = [], invalidated = new Map();
  let unboundInvalid = false;
  const family = item => JSON.stringify([item.provider, item.identity.scope, item.identity.account, item.identity.workspace, item.pool.id, item.kind, item.unit]);
  for (let i = 0; i < observations.length; i++) {
    const item = normalize(observations[i], at, i);
    if (!item) { unboundInvalid = true; gaps.push({ code: 'capacity_observation_invalid', index: i }); continue; }
    if (item.incomplete) {
      const time = item.observedAt === null ? Infinity : Date.parse(item.observedAt);
      invalidated.set(family(item), Math.max(invalidated.get(family(item)) ?? -Infinity, time));
    }
    if (!groups.has(item.id)) groups.set(item.id, []);
    groups.get(item.id).push(item);
  }
  const pools = [];
  for (const items of groups.values()) {
    // An undated/broken read cannot be ordered behind a valid read.
    const undated = items.filter(item => item.observedAt === null);
    const newest = Math.max(...items.map(item => Date.parse(item.observedAt) || 0));
    const current = undated.length ? undated : items.filter(item => Date.parse(item.observedAt) === newest);
    const first = current[0];
    const signature = item => JSON.stringify([item.measurement, item.expiresAt, item.state, item.confidence, item.nonAdditive]);
    const conflict = current.some(item => signature(item) !== signature(first));
    const origins = [...new Set(items.flatMap(item => item.origins))].sort();
    const verifiedModels = current.every(item => item.models.provenance !== 'unknown');
    const modelIds = [...new Set(current.flatMap(item => item.models.ids))].sort();
    if (modelIds.length > 100) gaps.push({ code: 'capacity_model_coverage_limit', poolId: first.id });
    const models = verifiedModels && modelIds.length <= 100
      ? { ids: modelIds, provenance: first.models.provenance }
      : { ids: [], provenance: 'unknown' };
    const { incomplete: _, ...safe } = first;
    const merged = { ...safe, models, origins };
    if (unboundInvalid || (invalidated.get(family(first)) ?? -Infinity) >= (Date.parse(first.observedAt) || 0)) {
      Object.assign(merged, { state: 'unavailable', eligible: false });
    }
    if (conflict) Object.assign(merged, { state: 'conflict', eligible: false, measurement: { used: null, remaining: null, limit: null } });
    pools.push(merged);
    if (merged.state !== 'observed') gaps.push({ code: `capacity_${merged.state}`, poolId: merged.id });
  }
  if (!observations.length) gaps.push({ code: 'capacity_unavailable' });
  return { pools, gaps };
}

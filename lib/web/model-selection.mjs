import { capacityModel } from './capacity.mjs';
import { exact, hash, WebError } from './common.mjs';

const integer = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const modelId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v);
const id = v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v);
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const iso = v => typeof v === 'string' && v.length <= 30 && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const fail = code => { throw new WebError(code, 400); };
/** Config may retain expired evidence for an explained wait; selection and quotes require freshness. */
export function validateModelEvidence(value, { now = Date.now(), allowExpired = false } = {}) {
  if (!exact(value, ['model', 'contextTokens', 'maxOutputTokens', 'inputMicroUsdPerMillion', 'outputMicroUsdPerMillion',
    'evidenceUrl', 'observedAt', 'expiresAt', 'immutable', 'background', 'text', 'count'])
    || !modelId(value.model) || !integer(value.contextTokens, 100_000_000) || value.contextTokens === 0
    || !integer(value.maxOutputTokens, value.contextTokens) || value.maxOutputTokens === 0
    || !integer(value.inputMicroUsdPerMillion, 1_000_000_000_000) || !integer(value.outputMicroUsdPerMillion, 1_000_000_000_000)
    || !['immutable', 'background', 'text', 'count'].every(k => value[k] === true)
    || !iso(value.observedAt) || !iso(value.expiresAt) || !Number.isFinite(now)
    || typeof allowExpired !== 'boolean' || Date.parse(value.observedAt) > now || !allowExpired && Date.parse(value.expiresAt) <= now
    || Date.parse(value.expiresAt) <= Date.parse(value.observedAt)) fail('model_evidence');
  let url;
  try { url = new URL(value.evidenceUrl); } catch { fail('model_evidence'); }
  if (typeof value.evidenceUrl !== 'string' || value.evidenceUrl.length > 2048 || url.protocol !== 'https:'
    || url.username || url.password || !['openai.com', 'developers.openai.com', 'platform.openai.com'].includes(url.hostname)) fail('model_evidence');
  return structuredClone(value);
}

/** Uncached input plus the entire output ceiling; no floating-point money. */
export function quoteModel(evidence, { inputTokens, maxOutputTokens, now = Date.now() }) {
  const value = validateModelEvidence(evidence, { now });
  if (!integer(inputTokens, value.contextTokens) || !integer(maxOutputTokens, value.maxOutputTokens)
    || maxOutputTokens === 0 || inputTokens + maxOutputTokens > value.contextTokens) fail('model_context');
  const numerator = BigInt(inputTokens) * BigInt(value.inputMicroUsdPerMillion)
    + BigInt(maxOutputTokens) * BigInt(value.outputMicroUsdPerMillion);
  const total = (numerator + 999999n) / 1000000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail('model_price');
  return { model: value.model, inputTokens, maxOutputTokens, totalMicroUsd: Number(total),
    priceDigest: hash(JSON.stringify(value)), expiresAt: value.expiresAt };
}

function validInputs({ policy, models, connections, reservations, cooldowns, inputTokens, now }) {
  const limits = policy?.limits, capacity = policy?.capacity;
  return Number.isFinite(now) && integer(inputTokens, 100_000_000) && Array.isArray(models) && models.length <= 100
    && Array.isArray(connections) && connections.length <= 1000
    && new Set(connections.map(c => c?.id)).size === connections.length
    && connections.every(c => exact(c, ['id', 'provider', 'enabled', 'authorized', 'version', 'policyDigest', 'capacityIdentity'])
      && id(c.id) && typeof c.provider === 'string' && typeof c.enabled === 'boolean' && typeof c.authorized === 'boolean'
      && (c.version === null || integer(c.version, 2147483647)) && hex(c.policyDigest)
      && (c.capacityIdentity === null || exact(c.capacityIdentity, ['account', 'workspace', 'scope'])
        && typeof c.capacityIdentity.account === 'string' && ['account', 'workspace'].includes(c.capacityIdentity.scope)
        && (c.capacityIdentity.scope === 'account' ? c.capacityIdentity.workspace === null : typeof c.capacityIdentity.workspace === 'string')))
    && Array.isArray(policy?.candidates) && policy.candidates.length > 0 && policy.candidates.length <= 20
    && new Set(policy.candidates.map(c => c?.id)).size === policy.candidates.length
    && policy.candidates.every(c => exact(c, ['id', 'connectionId', 'model', 'unknownCapacity'])
      && id(c.id) && id(c.connectionId) && modelId(c.model) && ['wait', 'allow-budgeted'].includes(c.unknownCapacity))
    && typeof policy.automaticFallback === 'boolean' && typeof policy.enabled === 'boolean'
    && limits && ['maxInputTokens', 'maxOutputTokens', 'attemptMicroUsd', 'taskMicroUsd'].every(k => integer(limits[k]) && limits[k] > 0)
    && capacity && integer(capacity.maxAgeSeconds, 86400) && capacity.maxAgeSeconds > 0
    && integer(capacity.reservePercent, 99) && integer(capacity.reentryPercent, 99)
    && capacity.reentryPercent >= capacity.reservePercent
    && integer(capacity.cooldownSeconds, 604800)
    && policy.requirements && integer(policy.requirements.minimumContext, 100_000_000)
    && typeof policy.requirements.independentReview === 'boolean'
    && Array.isArray(reservations) && reservations.length <= 10000
    && reservations.every(r => exact(r, ['poolId', 'unit', 'amount']) && typeof r.poolId === 'string'
      && r.poolId.length <= 2048 && ['requests', 'tokens', 'input-tokens', 'output-tokens'].includes(r.unit) && integer(r.amount))
    && Array.isArray(cooldowns) && cooldowns.length <= 1000
    && cooldowns.every(c => exact(c, ['connectionId', 'until', 'observedAt']) && id(c.connectionId)
      && integer(c.until) && integer(c.observedAt) && c.observedAt <= now && c.until >= c.observedAt);
}

/** Selection is explanatory; SQL must recheck and reserve all returned claims atomically. */
export function selectModel({ policy, models, connections, observations = [], reservations = [], cooldowns = [], inputTokens, now = Date.now() }) {
  const rejections = [], gaps = [];
  const wait = code => ({ state: 'wait', selected: null, rejections: [{ candidateId: null, code }], gaps });
  if (!validInputs({ policy, models, connections, reservations, cooldowns, inputTokens, now })) return wait('model_policy_invalid');
  if (!policy.enabled) return wait('model_policy_disabled');
  if (policy.taskClass !== 'planning' || policy.adapter !== 'project-evidence-brief-v1') return wait('model_task_unsupported');
  if (policy.requirements.independentReview) return wait('model_independent_review_unavailable');
  if (policy.requirements.privacy !== 'allow-temporary-provider-retention') return wait('model_privacy_unsupported');
  if (inputTokens > policy.limits.maxInputTokens) return wait('model_input_limit');
  const normalized = capacityModel(observations, { now });
  gaps.push(...normalized.gaps);
  let selected = null;
  for (const [index, candidate] of policy.candidates.entries()) {
    const refuse = code => rejections.push({ candidateId: candidate.id, code });
    if (selected) { refuse('model_lower_priority'); continue; }
    if (index > 0 && !policy.automaticFallback) { refuse('model_fallback_disabled'); continue; }
    const connection = connections.find(c => c.id === candidate.connectionId);
    if (!connection?.authorized || !connection.enabled || !(connection.version > 0)) { refuse('model_connection_unavailable'); continue; }
    if (connection.provider !== 'openai') { refuse('model_provider_unsupported'); continue; }
    const evidence = models.filter(m => m?.model === candidate.model);
    let quote;
    try {
      if (evidence.length !== 1) fail('model_evidence');
      if (evidence[0].contextTokens < policy.requirements.minimumContext) fail('model_context');
      quote = quoteModel(evidence[0], { inputTokens, maxOutputTokens: policy.limits.maxOutputTokens, now });
    } catch (error) { refuse(error instanceof WebError ? error.code : 'model_evidence'); continue; }
    if (quote.totalMicroUsd > Math.min(policy.limits.attemptMicroUsd, policy.limits.taskMicroUsd)) { refuse('model_budget_limit'); continue; }
    const history = cooldowns.filter(c => c.connectionId === connection.id);
    if (history.some(c => c.until > now)) { refuse('model_cooldown'); continue; }
    const threshold = history.length ? policy.capacity.reentryPercent : policy.capacity.reservePercent;
    const identity = connection.capacityIdentity;
    const applicable = normalized.pools.filter(p => p.provider === 'openai' && p.kind === 'api-rate'
      && identity && ['account', 'workspace', 'scope'].every(k => p.identity[k] === identity[k])
      && (p.models.provenance === 'unknown' || p.models.ids.includes(candidate.model)));
    let unknown = applicable.length === 0, insufficient = false;
    const claims = [];
    for (const pool of applicable) {
      const fresh = pool.observedAt !== null && now - Date.parse(pool.observedAt) <= policy.capacity.maxAgeSeconds * 1000
        && history.every(c => Date.parse(pool.observedAt) > c.observedAt);
      if (!pool.eligible || !fresh || pool.models.provenance === 'unknown' || !pool.models.ids.includes(candidate.model)) { unknown = true; continue; }
      const demand = { requests: 1, 'input-tokens': inputTokens, 'output-tokens': policy.limits.maxOutputTokens,
        tokens: inputTokens + policy.limits.maxOutputTokens }[pool.unit];
      if (demand === undefined || !integer(pool.measurement.limit) || !integer(pool.measurement.remaining)) { unknown = true; continue; }
      const held = reservations.filter(r => r.poolId === pool.id && r.unit === pool.unit).reduce((sum, r) => sum + r.amount, 0);
      const reserve = Number((BigInt(pool.measurement.limit) * BigInt(threshold) + 99n) / 100n);
      if (!integer(held) || pool.measurement.remaining - held - demand < reserve) insufficient = true;
      claims.push({ poolId: pool.id, unit: pool.unit, amount: demand, remaining: pool.measurement.remaining,
        limit: pool.measurement.limit, resetAt: pool.window.resetAt, observedAt: pool.observedAt });
    }
    if (insufficient) { refuse('model_capacity_low'); continue; }
    if (unknown && candidate.unknownCapacity !== 'allow-budgeted') { refuse(history.length ? 'model_reentry_unverified' : 'model_capacity_unknown'); continue; }
    if (unknown) gaps.push({ code: 'model_provider_capacity_unknown' });
    selected = { candidateId: candidate.id, connectionId: connection.id, model: candidate.model,
      connectionVersion: connection.version, connectionPolicyDigest: connection.policyDigest, quote,
      capacity: unknown ? 'unknown' : 'observed', claims };
  }
  return { state: selected ? 'selected' : 'wait', selected, rejections, gaps };
}

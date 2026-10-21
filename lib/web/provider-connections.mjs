// Fixed metadata probes only. Sources inspected 2026-10-21:
// https://developers.openai.com/api/reference/overview
// https://developers.openai.com/api/docs/guides/rate-limits
// https://platform.claude.com/docs/en/api/overview
// https://platform.claude.com/docs/en/api/rate-limits
// https://platform.claude.com/docs/en/manage-claude/workspaces
import { WebError, exact, record } from './common.mjs';

export const PROVIDER_LIMITS = Object.freeze({ timeoutMs: 8000, responseBytes: 1024 * 1024, models: 100 });
const endpoints = { openai: 'https://api.openai.com/v1/models', anthropic: 'https://api.anthropic.com/v1/models' };
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const modelId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(value);
const error = code => new WebError(code, code === 'provider_input' ? 400 : 503);
const unavailable = () => ({ pools: [], gaps: ['inference_capacity_unavailable', 'subscription_reporter_unavailable', 'spend_unavailable', 'runner_unavailable'].map(code => ({ code })) });

export function validProviderInput(policy, key) {
  if (!exact(policy, ['provider', 'scope']) || !Object.hasOwn(endpoints, policy.provider)
      || !exact(policy.scope, ['organization', 'project', 'workspace'])
      || !Object.values(policy.scope).every(value => value === null || safeId(value))) return false;
  if (policy.provider === 'openai' ? policy.scope.workspace !== null
    : policy.scope.organization !== null || policy.scope.project !== null
      || policy.scope.workspace !== null && !policy.scope.workspace.startsWith('wrkspc_')) return false;
  return typeof key === 'string' && /^[\x21-\x7e]{16,4096}$/.test(key)
    && !key.startsWith('sk-ant-admin') && !key.startsWith('sk-admin-')
    && !Object.values(policy.scope).some(value => value !== null && reflected(value, key));
}

function reflected(text, key) {
  return [key, encodeURIComponent(key), Buffer.from(key).toString('base64'), Buffer.from(key).toString('base64url')]
    .some(secret => text.includes(secret));
}
function responseId(response, name, key, prefix = null) {
  const value = response.headers.get(name);
  if (value === null) return null;
  if (!safeId(value) || reflected(value, key) || prefix && !value.startsWith(prefix)) throw error('provider_response');
  return value;
}
function identityFor(response, provider, scope, key) {
  const account = responseId(response, provider === 'openai' ? 'openai-organization' : 'anthropic-organization-id', key);
  const workspace = provider === 'anthropic' ? responseId(response, 'anthropic-workspace-id', key, 'wrkspc_') : null;
  if (scope.organization !== null && account !== null && account !== scope.organization
      || scope.workspace !== null && workspace !== null && workspace !== scope.workspace) throw error('provider_scope');
  return { account, workspace, provenance: account !== null || workspace !== null ? 'provider-response' : 'unverified' };
}
function integer(value) {
  if (value === null || !/^(0|[1-9]\d{0,14})$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}
function resetTime(value, provider, now) {
  if (typeof value !== 'string' || value.length > 100) return null;
  if (provider === 'anthropic') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const [year, month, day, hour, minute, second] = value.match(/^\d{4}|\d{2}/g).slice(0, 6).map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
        || hour > 23 || minute > 59 || second > 59) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > now ? new Date(parsed).toISOString() : null;
  }
  // OpenAI reports time-until-reset, not the duration of its underlying window.
  if (!/^(?:(?:\d+(?:\.\d+)?)(?:ms|s|m|h|d))+$/.test(value)) return null;
  const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)];
  if (new Set(parts.map(p => p[2])).size !== parts.length) return null;
  const duration = parts.reduce((sum, p) => sum + Number(p[1]) * factors[p[2]], 0);
  return duration > 0 && duration <= 366 * 86_400_000 ? new Date(now + duration).toISOString() : null;
}
function endpointLimits(response, provider, at, key, gaps) {
  const rows = [];
  const metrics = provider === 'openai' ? ['requests', 'tokens', 'project-tokens'] : ['requests', 'input-tokens', 'output-tokens', 'tokens'];
  for (const metric of metrics) {
    const names = ['limit', 'remaining', 'reset'].map(field => provider === 'openai'
      ? `x-ratelimit-${field}-${metric}` : `anthropic-ratelimit-${metric}-${field}`);
    const values = names.map(name => response.headers.get(name));
    if (values.every(value => value === null)) continue;
    if (values.some(value => value !== null && reflected(value, key))) throw error('provider_response');
    const limit = integer(values[0]), remaining = integer(values[1]), resetAt = resetTime(values[2], provider, at);
    if (limit === null || remaining === null || remaining > limit || resetAt === null) {
      gaps.push('endpoint_limit_invalid'); continue;
    }
    rows.push({ metric, unit: metric === 'project-tokens' ? 'tokens' : metric, limit, remaining, resetAt,
      observedAt: new Date(at).toISOString(), windowDurationMinutes: null,
      scope: 'GET /v1/models', modelCoverage: 'unknown', rounded: provider === 'anthropic' && metric !== 'requests',
      composite: provider === 'anthropic' && metric === 'tokens', eligible: false });
  }
  if (!rows.length) gaps.push('endpoint_limits_unavailable');
  return rows;
}

async function readModels(response, provider, key, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw error('provider_response');
  const chunks = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw error('provider_timeout');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PROVIDER_LIMITS.responseBytes) throw error('provider_limit');
      chunks.push(value);
    }
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw error('provider_response'); }
    if (!record(data) || !Array.isArray(data.data) || data.data.length > 10_000
        || provider === 'openai' && data.object !== 'list'
        || provider === 'anthropic' && typeof data.has_more !== 'boolean') throw error('provider_response');
    const ids = new Set();
    for (const item of data.data) {
      if (!record(item) || !modelId(item.id) || reflected(item.id, key)
          || provider === 'openai' && item.object !== 'model'
          || provider === 'anthropic' && item.type !== 'model') throw error('provider_response');
      ids.add(item.id);
    }
    return { models: [...ids].slice(0, PROVIDER_LIMITS.models).map(id => ({ id })),
      truncated: ids.size > PROVIDER_LIMITS.models, paginated: provider === 'anthropic' && data.has_more };
  } finally {
    signal.removeEventListener('abort', abort);
    // Cancellation itself can be a stalled upstream promise; never await it.
    void reader.cancel().catch(() => {});
  }
}

export async function probeConnection(policy, key, { fetcher = fetch, now = Date.now } = {}) {
  if (!validProviderInput(policy, key)) throw error('provider_input');
  const { provider, scope } = policy;
  const started = now();
  if (!Number.isFinite(started)) throw error('provider_input');
  const headers = { accept: 'application/json' };
  if (provider === 'openai') {
    headers.Authorization = `Bearer ${key}`;
    if (scope.organization !== null) headers['OpenAI-Organization'] = scope.organization;
    if (scope.project !== null) headers['OpenAI-Project'] = scope.project;
  } else {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2026-10-21';
    headers['content-type'] = 'application/json';
    if (scope.workspace !== null) headers['anthropic-workspace-id'] = scope.workspace;
  }
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(error('provider_timeout')); }, PROVIDER_LIMITS.timeoutMs);
  });
  const operation = async () => {
    const response = await fetcher(endpoints[provider], { method: 'GET', headers, redirect: 'error', signal: controller.signal });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw error('provider_timeout'); }
    if (response.redirected || response.url && response.url !== endpoints[provider]) {
      void response.body?.cancel().catch(() => {}); throw error('provider_response');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw error([401, 403].includes(response.status) ? 'provider_denied' : response.status === 429 ? 'provider_rate_limited' : 'provider_unavailable');
    }
    let identity;
    try { identity = identityFor(response, provider, scope, key); }
    catch (caught) { void response.body?.cancel().catch(() => {}); throw caught; }
    const listed = await readModels(response, provider, key, controller.signal);
    const at = now();
    if (!Number.isFinite(at) || at < started) throw error('provider_unavailable');
    if (at - started >= PROVIDER_LIMITS.timeoutMs) throw error('provider_timeout');
    const gaps = ['metadata_only', 'inference_capacity_unavailable'];
    if (identity.account === null) gaps.push('account_identity_unverified');
    if (provider === 'anthropic' && identity.workspace === null) gaps.push('workspace_identity_unverified');
    if (scope.project !== null) gaps.push('project_identity_unverified');
    if (listed.truncated) gaps.push('models_truncated');
    if (listed.paginated) gaps.push('models_paginated');
    const limits = endpointLimits(response, provider, at, key, gaps);
    return { provider, status: 'validated', observedAt: new Date(at).toISOString(), expiresAt: null,
      identity, scope: { ...scope, provenance: 'owner-claim' }, models: listed.models,
      coverage: { state: 'partial', gaps: [...new Set(gaps)] }, endpointLimits: limits, capacity: unavailable() };
  };
  try { return await Promise.race([operation(), timeout]); }
  catch (caught) {
    const codes = ['provider_input', 'provider_denied', 'provider_rate_limited', 'provider_timeout', 'provider_limit', 'provider_response', 'provider_scope', 'provider_unavailable'];
    if (caught instanceof WebError && codes.includes(caught.code)) throw error(caught.code);
    throw error(controller.signal.aborted ? 'provider_timeout' : 'provider_unavailable');
  } finally { clearTimeout(timer); }
}

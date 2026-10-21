import { requestJson, seal, unseal, hash, WebError } from './common.mjs';
import { QUOTA_FLOOR, GH_TTL } from '../quota.mjs';
export { GH_TTL };
export function createHomeStore(config, fetcher = fetch) {
  const rpc = (name, data) => requestJson(fetcher, `${config.storageUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: config.storageKey, Authorization: `Bearer ${config.storageKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }, 600000);
  const keyFor = (userId, repoId, scope = '') => hash(`${config.appId}:${config.installationId}:${config.workspace.repoId}:${config.workspace.id}:${userId}:${repoId}:${scope}`);
  async function cache(operation, key, options = {}) {
    const result = await rpc('keel_home_cache_rpc', { p_operation: operation, p_key: key, p_value: null, p_lease: null, p_error: null, ...options });
    if (!result) return null;
    if (!Number.isSafeInteger(result.version) || result.version < 0 || (result.value !== null && typeof result.value !== 'string')) throw new WebError('invalid_cache_response');
    return { ...result, value: result.value === null ? null : unseal(result.value, config.encryptionKey, `home:${key}`) };
  }
  async function quota(operation, userId, observation) {
    const result = await rpc('keel_home_quota_rpc', { p_operation: operation, p_key: keyFor(userId, 'github-quota'),
      p_remaining: observation?.remaining ?? null, p_reset: observation?.reset ?? null });
    if (!result || typeof result.allowed !== 'boolean' || (result.remaining !== null && (!Number.isSafeInteger(result.remaining) || result.remaining < 0))) throw new WebError('invalid_quota_response');
    return { ...result, state: result.blockedUntil ? 'saving' : result.remaining === null ? 'unavailable' : result.remaining <= QUOTA_FLOOR ? 'saving' : 'known' };
  }
  return { keyFor, read: key => cache('read', key), claim: (key, lease) => cache('claim', key, { p_lease: lease }),
    finish: (key, lease, value) => cache('finish', key, { p_lease: lease, p_value: seal(value, config.encryptionKey, `home:${key}`) }),
    fail: (key, lease, error) => cache('fail', key, { p_lease: lease, p_error: error }),
    cursor: (key, cursor, since = null) => rpc('keel_home_cursor_rpc', { p_key: key, p_cursor: cursor, p_since: since }),
    quota: userId => quota('read', userId), defer: (userId, until) => quota('defer', userId, { reset: until }), reserve: userId => quota('reserve', userId), observe: (userId, observation) => quota('observe', userId, observation),
  };
}
export function quotaObservation(headers) {
  const remaining = headers.get('x-ratelimit-remaining'), reset = headers.get('x-ratelimit-reset');
  if (!/^\d{1,7}$/.test(remaining ?? '') || !/^\d{1,10}$/.test(reset ?? '')) return null;
  const result = { remaining: Number(remaining), reset: Number(reset) };
  return result.remaining <= 1000000 && result.reset <= 4102444800 ? result : null;
}

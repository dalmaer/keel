import { writeName } from '../names.mjs';
import { requestJson, WebError, seal, unseal } from './common.mjs';

// Every operation is a database transaction. No memory/filesystem fallback.
export function createStore(config, fetcher = fetch) {
  async function rpc(operation, kind, key, options = {}) {
    const result = await requestJson(fetcher, `${config.storageUrl}/rest/v1/rpc/${writeName('database:keel_web_rpc')}`, {
      method: 'POST', headers: { apikey: config.storageKey, Authorization: `Bearer ${config.storageKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_operation: operation, p_kind: kind, p_key: key, p_value: null, p_binding: null,
        p_actor: null, p_seconds: 0, p_version: 0, ...options }),
    }, 32768);
    if (result !== null && (!result || typeof result !== 'object' || !Number.isSafeInteger(result.version)
      || result.version < 1 || typeof result.value !== 'string')) throw new WebError('invalid_store_response');
    if (!result) return null;
    return { value: unseal(result.value, config.encryptionKey, `${kind}:${key}`), version: result.version };
  }
  return {
    create: (kind, key, value, seconds, binding = null, actor = null) => rpc('create', kind, key, {
      p_value: seal(value, config.encryptionKey, `${kind}:${key}`), p_seconds: seconds, p_binding: binding, p_actor: actor }),
    read: (kind, key) => rpc('read', kind, key),
    consume: (key, binding) => rpc('consume', 'attempt', key, { p_binding: binding }),
    renew: (key, version, seconds) => rpc('renew', 'session', key, { p_version: version, p_seconds: seconds }),
    revoke: key => rpc('revoke', 'session', key),
    revokeActor: actor => rpc('revoke_actor', 'session', '', { p_actor: actor }),
    compareAndSwap: (kind, key, version, value, seconds) => rpc('cas', kind, key, {
      p_version: version, p_value: seal(value, config.encryptionKey, `${kind}:${key}`), p_seconds: seconds }),
  };
}

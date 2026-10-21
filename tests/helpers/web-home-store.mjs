// Synthetic HTTP protocol state for independent adapters. SQL proof is separate.
export function homeDatabase(now) {
  const cache = new Map(), quotas = new Map(), cursors = new Map();
  const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  return { cache, quotas, cursors, handle(url, options) {
    const path = new URL(url).pathname;
    if (!path.includes('/rpc/keel_home_')) return null;
    const p = JSON.parse(options.body), clock = now();
    if (path.endsWith('cache_rpc')) {
      let row = cache.get(p.p_key), acquired = false;
      if (row && row.expires <= clock) { cache.delete(p.p_key); row = null; }
      if (p.p_operation === 'claim') {
        if (!row) { row = { value: null, version: 0, expires: clock + 7 * 86400000, readAt: null, leaseUntil: 0, nextAttempt: 0, lastError: null }; cache.set(p.p_key, row); }
        if (row.leaseUntil <= clock && row.nextAttempt <= clock) { row.lease = p.p_lease; row.leaseUntil = clock + 45000; row.nextAttempt = clock + 60000; acquired = true; }
      } else if (['finish','fail'].includes(p.p_operation)) {
        if (!row || row.lease !== p.p_lease || row.leaseUntil <= clock) return json(null);
        row.lease = null; row.leaseUntil = 0;
        if (p.p_operation === 'finish') { row.value = p.p_value; row.version++; row.readAt = new Date(clock).toISOString(); row.expires = clock + 7 * 86400000; row.lastError = null; }
        else row.lastError = p.p_error;
      }
      return json(row ? { value: row.value, version: row.version, readAt: row.readAt, leaseAcquired: acquired, refreshing: row.leaseUntil > clock,
        lastError: row.lastError, nextAttempt: new Date(row.nextAttempt).toISOString() } : null);
    }
    if (path.endsWith('quota_rpc')) {
      const row = quotas.get(p.p_key) ?? { remaining: null, reset: null, observed: null, probes: 0, window: clock }; let allowed = true;
      if (p.p_operation === 'observe') {
        if (row.reset === null || p.p_reset > row.reset) { row.remaining = p.p_remaining; row.reset = p.p_reset; }
        else if (row.reset === p.p_reset) row.remaining = Math.min(row.remaining, p.p_remaining);
        row.observed = clock;
      } else if (p.p_operation === 'defer') { row.blockedUntil = Math.max(row.blockedUntil ?? 0, p.p_reset * 1000);
      } else if (p.p_operation === 'reserve') {
        if (row.blockedUntil > clock) allowed = false;
        else
        if (row.reset * 1000 > clock && row.remaining !== null) { allowed = row.remaining > 1000; if (allowed) row.remaining--; }
        else { if (row.window <= clock - 60000) { row.probes = 0; row.window = clock; } allowed = row.probes < 20; if (allowed) row.probes++; }
      }
      quotas.set(p.p_key, row);
      return json({ allowed, blockedUntil: row.blockedUntil > clock ? new Date(row.blockedUntil).toISOString() : null, remaining: row.reset * 1000 > clock ? row.remaining : null, resetAt: row.reset * 1000 > clock ? new Date(row.reset * 1000).toISOString() : null,
        observedAt: row.observed === null ? null : new Date(row.observed).toISOString() });
    }
    if (path.endsWith('cursor_rpc')) {
      const rows = cursors.get(p.p_key) ?? [], state = p.p_since === null ? 'initial' : p.p_since === p.p_cursor ? 'current' : rows.includes(p.p_since) ? 'changed' : 'gap';
      if (!rows.includes(p.p_cursor)) rows.unshift(p.p_cursor); cursors.set(p.p_key, rows.slice(0, 8)); return json({ state });
    }
    throw Error('Unknown synthetic Home RPC');
  } };
}

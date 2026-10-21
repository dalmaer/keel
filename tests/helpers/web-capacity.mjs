// Synthetic Acme provider responses: no real credential, account or quota.
export const key = 'fake-acme-provider-key-for-tests';
export const at = Date.parse('2026-10-21T18:00:00.000Z');
export const scope = { organization: null, project: null, workspace: null };
export const policy = (provider = 'openai', more = {}) => ({ provider, scope: { ...scope, ...more } });
export const modelResponse = (provider = 'openai', headers = {}, data) => new Response(JSON.stringify(data ?? (provider === 'openai'
  ? { object: 'list', data: [{ object: 'model', id: 'acme-model' }] }
  : { data: [{ type: 'model', id: 'acme-model' }], has_more: false })), { headers });
export const observation = (overrides = {}) => ({
  provider: 'codex', identity: { account: 'acme-account', workspace: 'acme-workspace', scope: 'workspace', provenance: 'authenticated-reporter' },
  pool: { id: 'acme-shared', provenance: 'authenticated-reporter' }, kind: 'subscription', unit: 'percent',
  models: { ids: ['acme-model'], provenance: 'authenticated-reporter' },
  measurement: { used: 20, remaining: 80, limit: 100 },
  window: { durationMinutes: 10080, resetAt: '2026-10-28T18:00:00.000Z' },
  observedAt: '2026-10-21T18:00:00.000Z', expiresAt: '2026-10-21T18:05:00.000Z',
  source: { kind: 'local-reporter', id: 'acme-connection' }, confidence: 'observed', nonAdditive: false,
  ...overrides,
});

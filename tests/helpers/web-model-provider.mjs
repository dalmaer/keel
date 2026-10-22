export const at = Date.parse('2026-01-15T12:00:00.000Z');
export const model = 'acme-model-2026-01-01';
export const key = 'acme-provider-key-never-expose';
export const scope = { organization: 'org-acme', project: 'proj-acme', workspace: null };
export const evidence = () => ({ model, contextTokens: 100000, maxOutputTokens: 10000,
  inputMicroUsdPerMillion: 2000000, outputMicroUsdPerMillion: 8000000,
  evidenceUrl: 'https://developers.openai.com/api/docs/models/acme-model',
  observedAt: new Date(at - 86400000).toISOString(), expiresAt: new Date(at + 86400000).toISOString(),
  immutable: true, background: true, text: true, count: true });
export const policy = () => ({ version: 1, enabled: true, taskClass: 'planning', adapter: 'project-evidence-brief-v1',
  automaticFallback: true, candidates: [{ id: 'acme-primary', connectionId: 'acme', model, unknownCapacity: 'wait' }],
  requirements: { minimumContext: 1000, privacy: 'allow-temporary-provider-retention', independentReview: false },
  limits: { maxInputTokens: 8000, maxOutputTokens: 2000, attemptMicroUsd: 100000, taskMicroUsd: 200000,
    workspaceMicroUsd: 500000, projectMicroUsd: 300000, connectionMicroUsd: 300000, concurrency: 1 },
  capacity: { maxAgeSeconds: 60, reservePercent: 10, cooldownSeconds: 30, reentryPercent: 20 } });
export const connection = () => ({ id: 'acme', provider: 'openai', enabled: true, authorized: true,
  version: 2, policyDigest: 'a'.repeat(64), capacityIdentity: { account: 'org-acme', workspace: null, scope: 'account' } });
export const pool = (unit = 'tokens', overrides = {}) => ({ provider: 'openai',
  identity: { account: 'org-acme', workspace: null, scope: 'account', provenance: 'provider-response' },
  pool: { id: `acme-${unit}`, provenance: 'provider-response' }, kind: 'api-rate', unit,
  models: { ids: [model], provenance: 'provider-response' }, measurement: { used: 1000, remaining: 9000, limit: 10000 },
  window: { durationMinutes: 1, resetAt: new Date(at + 30000).toISOString() },
  observedAt: new Date(at - 1000).toISOString(), expiresAt: new Date(at + 30000).toISOString(),
  source: { kind: 'api-response', id: 'acme-source' }, confidence: 'observed', nonAdditive: false, ...overrides });
export const providerResponse = (overrides = {}) => ({ object: 'response', id: 'resp_acme', model, status: 'completed',
  created_at: at / 1000, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Acme evidence remains unverified.' }] }],
  usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 }, ...overrides });

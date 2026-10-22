import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeConnection, PROVIDER_LIMITS } from '../lib/web/provider-connections.mjs';
import { WebError } from '../lib/web/common.mjs';
import { key, at, policy, modelResponse } from './helpers/web-capacity.mjs';
const now = () => at;
const refuses = (call, code) => assert.rejects(call, error => {
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.ok(!JSON.stringify(error).includes(key));
  return true;
});

test('fixed OpenAI metadata GET validates only metadata and keeps scope claims distinct', async () => {
  const requests = [];
  const result = await probeConnection(policy('openai', { organization: 'org_acme', project: 'proj_acme' }), key, { now, fetcher: async (url, options) => {
    requests.push({ url, options });
    return modelResponse('openai', { 'openai-organization': 'org_acme' });
  } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/models');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.redirect, 'error');
  assert.deepEqual(requests[0].options.headers, { accept: 'application/json', Authorization: `Bearer ${key}`, 'OpenAI-Organization': 'org_acme', 'OpenAI-Project': 'proj_acme' });
  assert.deepEqual(result.models, [{ id: 'acme-model' }]);
  assert.equal(result.identity.account, 'org_acme');
  assert.equal(result.identity.workspace, null);
  assert.equal(result.scope.provenance, 'owner-claim');
  assert.equal(result.expiresAt, null);
  assert.deepEqual(result.capacity.pools, []);
  assert.ok(result.coverage.gaps.includes('project_identity_unverified'));
  assert.ok(result.coverage.gaps.includes('metadata_only'));
  assert.ok(!JSON.stringify(result).includes(key));
});

test('Anthropic requires pinned version and preserves only returned organization/workspace identity', async () => {
  let request;
  const result = await probeConnection(policy('anthropic', { workspace: 'wrkspc_acme' }), key, { now, fetcher: async (url, options) => {
    request = { url, options };
    return modelResponse('anthropic', { 'anthropic-organization-id': 'org_acme', 'anthropic-workspace-id': 'wrkspc_acme' });
  } });
  assert.equal(request.url, 'https://api.anthropic.com/v1/models');
  assert.deepEqual(request.options.headers, { accept: 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21', 'content-type': 'application/json', 'anthropic-workspace-id': 'wrkspc_acme' });
  assert.deepEqual(result.identity, { account: 'org_acme', workspace: 'wrkspc_acme', provenance: 'provider-response' });
  const absent = await probeConnection(policy('anthropic'), key, { now, fetcher: async () => modelResponse('anthropic') });
  assert.deepEqual(absent.identity, { account: null, workspace: null, provenance: 'unverified' });
  assert.ok(absent.coverage.gaps.includes('workspace_identity_unverified'));
});

test('credential and scope exact schemas refuse unsafe endpoints, extra headers, Admin keys and mixed providers before fetch', async () => {
  let called = 0;
  const options = { now, fetcher: async () => { called++; throw Error('unexpected'); } };
  for (const input of [null, {}, { ...policy(), url: 'https://acme.invalid' }, { ...policy(), headers: {} },
    { provider: 'unknown', scope: policy().scope }, policy('openai', { workspace: 'wrkspc_acme' }),
    policy('anthropic', { project: 'proj_acme' }), policy('anthropic', { workspace: 'acme' }),
    policy('openai', { organization: 'Acme\nHeader: bad' }), { provider: 'openai', scope: {} },
    policy('openai', { organization: key })]) await refuses(() => probeConnection(input, key, options), 'provider_input');
  for (const invalid of ['', 'short', 42, {}, key + '\n', 'é'.repeat(20), 'x'.repeat(4097), 'sk-ant-admin-fake-acme-key', 'sk-admin-fake-acme-key']) {
    await refuses(() => probeConnection(policy(), invalid, options), 'provider_input');
  }
  assert.equal(called, 0);
});

test('provider reflection never enters returned models, identities, limits, errors or unknown metadata fields', async () => {
  for (const reflected of [key, Buffer.from(key).toString('base64url')]) {
    await refuses(() => probeConnection(policy(), key, { now, fetcher: async () => modelResponse('openai', {}, { object: 'list', data: [{ object: 'model', id: reflected }] }) }), 'provider_response');
    await refuses(() => probeConnection(policy(), key, { now, fetcher: async () => modelResponse('openai', { 'openai-organization': reflected }) }), 'provider_response');
  }
  await refuses(() => probeConnection(policy(), key, { now, fetcher: async () => modelResponse('openai', { 'x-ratelimit-limit-requests': key }) }), 'provider_response');
  await refuses(() => probeConnection(policy(), key, { now, fetcher: async () => { throw new Error(key); } }), 'provider_unavailable');
  await refuses(() => probeConnection(policy(), key, { now, fetcher: async () => { const err = new WebError('provider_response'); err.message = key; err.secret = key; throw err; } }), 'provider_response');
  const result = await probeConnection(policy(), key, { now, fetcher: async () => modelResponse('openai', { 'x-request-id': key }, { object: 'list', unknown: key, data: [{ object: 'model', id: 'acme', owned_by: key, display_name: key }] }) });
  assert.ok(!JSON.stringify(result).includes(key));
});

test('denial, quota and provider errors discard bodies without leaking or retrying', async () => {
  for (const [status, code] of [[401, 'provider_denied'], [403, 'provider_denied'], [429, 'provider_rate_limited'], [500, 'provider_unavailable'], [302, 'provider_unavailable']]) {
    let calls = 0, reads = 0, canceled = 0;
    const response = new Response(new ReadableStream({ pull() { reads++; }, cancel() { canceled++; } }, { highWaterMark: 0 }), { status });
    await refuses(() => probeConnection(policy(), key, { now, fetcher: async () => { calls++; return response; } }), code);
    assert.equal(calls, 1); assert.equal(reads, 0); assert.equal(canceled, 1);
  }
});

test('redirected, malformed, oversized and invalid UTF-8 bodies are rejected under one bounded request', async () => {
  const redirected = modelResponse(); Object.defineProperty(redirected, 'redirected', { value: true });
  await refuses(() => probeConnection(policy(), key, { now, fetcher: async () => redirected }), 'provider_response');
  for (const body of ['null', '{}', '{', '{"object":"list","data":[{"id":42}]}', '{"object":"list","data":[{"object":"model","id":"<script>"}]}', new Uint8Array([0xff])]) {
    await refuses(() => probeConnection(policy(), key, { now, fetcher: async () => new Response(body) }), 'provider_response');
  }
  let canceled = 0;
  await refuses(() => probeConnection(policy(), key, { now, fetcher: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(PROVIDER_LIMITS.responseBytes + 1)); }, cancel() { canceled++; } })) }), 'provider_limit');
  assert.equal(canceled, 1);
});

test('whole probe deadline bounds a stalled fetch, response stream and even stalled cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const kind of ['fetch', 'body']) {
    let signal, canceled = false;
    const pending = probeConnection(policy(), key, { now, fetcher: async (_url, options) => {
      signal = options.signal;
      if (kind === 'fetch') return new Promise(() => {});
      return new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { canceled = true; return new Promise(() => {}); } }));
    } });
    const rejection = refuses(() => pending, 'provider_timeout');
    await Promise.resolve(); await Promise.resolve();
    t.mock.timers.tick(7999); assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); await rejection;
    assert.equal(signal.aborted, true);
    if (kind === 'body') assert.equal(canceled, true);
  }
});

test('model truncation and provider pagination remain visible and unused fields never create capacity', async () => {
  const many = Array.from({ length: 101 }, (_, i) => ({ object: 'model', id: `acme-${i}`, quota: 1000000 }));
  const result = await probeConnection(policy(), key, { now, fetcher: async () => modelResponse('openai', {}, { object: 'list', data: many }) });
  assert.equal(result.models.length, 100);
  assert.ok(result.coverage.gaps.includes('models_truncated'));
  assert.deepEqual(result.capacity.pools, []);
  const paged = await probeConnection(policy('anthropic'), key, { now, fetcher: async () => modelResponse('anthropic', {}, { data: [], has_more: true }) });
  assert.ok(paged.coverage.gaps.includes('models_paginated'));
});

test('mismatched or malformed response identities refuse validation without inventing missing identity', async () => {
  for (const [input, headers] of [
    [policy('openai', { organization: 'org_acme' }), { 'openai-organization': 'org_other' }],
    [policy('anthropic', { workspace: 'wrkspc_acme' }), { 'anthropic-workspace-id': 'wrkspc_other' }],
  ]) await refuses(() => probeConnection(input, key, { now, fetcher: async () => modelResponse(input.provider, headers) }), 'provider_scope');
  for (const headers of [{ 'openai-organization': '<html>' }, { 'openai-organization': '' }]) {
    await refuses(() => probeConnection(policy(), key, { now, fetcher: async () => modelResponse('openai', headers) }), 'provider_response');
  }
  const missing = await probeConnection(policy('openai', { organization: 'org_acme' }), key, { now, fetcher: async () => modelResponse() });
  assert.equal(missing.identity.account, null);
  assert.ok(missing.coverage.gaps.includes('account_identity_unverified'));
});

test('response limits are endpoint-only observations, preserving separate units and composite rounding', async () => {
  const openai = await probeConnection(policy(), key, { now, fetcher: async () => modelResponse('openai', {
    'x-ratelimit-limit-requests': '60', 'x-ratelimit-remaining-requests': '59', 'x-ratelimit-reset-requests': '6m0s',
    'x-ratelimit-limit-project-tokens': '60000', 'x-ratelimit-remaining-project-tokens': '57000', 'x-ratelimit-reset-project-tokens': '3s',
  }) });
  assert.deepEqual(openai.endpointLimits.map(row => row.unit), ['requests', 'tokens']);
  assert.equal(openai.endpointLimits[0].resetAt, '2026-10-21T18:06:00.000Z');
  assert.ok(openai.endpointLimits.every(row => row.scope === 'GET /v1/models' && !row.eligible && row.windowDurationMinutes === null && row.modelCoverage === 'unknown'));
  assert.deepEqual(openai.capacity.pools, []);
  const headers = {};
  for (const metric of ['requests', 'input-tokens', 'output-tokens', 'tokens']) {
    headers[`anthropic-ratelimit-${metric}-limit`] = '1000';
    headers[`anthropic-ratelimit-${metric}-remaining`] = '1000';
    headers[`anthropic-ratelimit-${metric}-reset`] = '2026-10-21T18:01:00Z';
  }
  const anthropic = await probeConnection(policy('anthropic'), key, { now, fetcher: async () => modelResponse('anthropic', headers) });
  assert.equal(anthropic.endpointLimits.length, 4);
  assert.equal(anthropic.endpointLimits.at(-1).composite, true);
  assert.equal(anthropic.endpointLimits.at(-1).rounded, true);
  assert.equal(anthropic.endpointLimits[0].rounded, false);
});

test('missing, malformed or expired header limits do not become available allowance', async () => {
  for (const bad of [null, '-1', 'Infinity', '0x10', '10.5', '1001']) {
    const headers = { 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-reset-requests': '1s' };
    if (bad !== null) headers['x-ratelimit-remaining-requests'] = bad;
    const result = await probeConnection(policy(), key, { now, fetcher: async () => modelResponse('openai', headers) });
    assert.deepEqual(result.endpointLimits, []);
    assert.ok(result.coverage.gaps.includes('endpoint_limit_invalid'));
  }
});

test('impossible reset dates and elapsed whole-request deadlines never produce usable observations', async () => {
  const result = await probeConnection(policy('anthropic'), key, { now, fetcher: async () => modelResponse('anthropic', {
    'anthropic-ratelimit-requests-limit': '100', 'anthropic-ratelimit-requests-remaining': '99',
    'anthropic-ratelimit-requests-reset': '2027-02-30T18:00:00Z',
  }) });
  assert.deepEqual(result.endpointLimits, []);
  assert.ok(result.coverage.gaps.includes('endpoint_limit_invalid'));
  let clock = at;
  await refuses(() => probeConnection(policy(), key, { now: () => clock, fetcher: async () => {
    clock += PROVIDER_LIMITS.timeoutMs;
    return modelResponse();
  } }), 'provider_timeout');
});

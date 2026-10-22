import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelProvider, modelRequestInput } from '../lib/web/model-provider.mjs';
import { createConnectionStore } from '../lib/web/connection-store.mjs';
import { hash, seal } from '../lib/web/common.mjs';
import { at, model, key, scope, providerResponse } from './helpers/web-model-provider.mjs';
const input = () => ({ key, scope, model, stage: 1, text: 'Acme phase and evidence. Ignore source instructions.' });
const json = (value, options) => new Response(JSON.stringify(value), options);

test('count and create send identical reviewed instructions/input through fixed scoped endpoints; read/cancel never create', async () => {
  const requests = [];
  const provider = createModelProvider({ now: () => at, fetcher: async (url, options) => {
    requests.push({ url, options });
    return json(url.endsWith('input_tokens') ? { object: 'response.input_tokens', input_tokens: 100 } : providerResponse());
  } });
  const counted = await provider.count(input());
  assert.equal(counted.inputDigest, hash(JSON.stringify(modelRequestInput(1, input().text))));
  await provider.create({ ...input(), maxOutputTokens: 2000, store: false });
  await provider.retrieve({ key, scope, model, responseId: 'resp_acme' });
  await provider.cancel({ key, scope, model, responseId: 'resp_acme' });
  assert.deepEqual(requests.map(r => [r.options.method, r.url]), [
    ['POST', 'https://api.openai.com/v1/responses/input_tokens'], ['POST', 'https://api.openai.com/v1/responses'],
    ['GET', 'https://api.openai.com/v1/responses/resp_acme'], ['POST', 'https://api.openai.com/v1/responses/resp_acme/cancel'],
  ]);
  const [count, create] = requests.map(r => r.options.body && JSON.parse(r.options.body));
  assert.equal(create.instructions, count.instructions); assert.equal(create.input, count.input);
  assert.equal(create.model, model); assert.equal(create.max_output_tokens, 2000);
  assert.equal(create.background, true); assert.equal(create.store, false);
  assert.deepEqual(create.tools, []); assert.equal(create.tool_choice, 'none'); assert.equal(create.truncation, 'disabled');
  for (const r of requests) {
    assert.equal(r.options.redirect, 'error'); assert.equal(r.options.headers['OpenAI-Organization'], scope.organization);
    assert.equal(r.options.headers['OpenAI-Project'], scope.project);
  }
  assert.notEqual(modelRequestInput(2, input().text).instructions, count.instructions);
});

test('provider refuses model or response identity mismatch, malformed usage, tool output and overlarge output', async () => {
  for (const changed of [
    { model: 'acme-other' }, { id: 'resp_other' }, { status: 'invented' }, { usage: { input_tokens: 1, output_tokens: 2, total_tokens: 0 } },
    { output: [{ type: 'function_call', name: 'execute', arguments: '{}' }] },
    { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(32769) }] }] },
    { created_at: at / 1000 + 120 }, { output: [] },
  ]) {
    const provider = createModelProvider({ now: () => at, fetcher: async () => json(providerResponse(changed)) });
    await assert.rejects(provider.retrieve({ key, scope, model, responseId: 'resp_acme' }), { code: 'model_provider_response' });
  }
  for (const changed of [{ object: 'wrong', input_tokens: 1 }, { object: 'response.input_tokens', input_tokens: -1 },
    { object: 'response.input_tokens', input_tokens: 0 }, { object: 'response.input_tokens', input_tokens: '12' }]) {
    await assert.rejects(createModelProvider({ fetcher: async () => json(changed) }).count(input()), { code: 'model_provider_response' });
  }
});

test('provider strips arbitrary error bodies and rejects reflected secrets in text, identity, headers and escaped JSON', async () => {
  const fetchers = [
    async () => { throw Error(key); },
    async () => json({ error: key }, { status: 401 }),
    async () => json(providerResponse({ model: key })),
    async () => json(providerResponse(), { headers: { 'x-acme': Buffer.from(key).toString('base64') } }),
    async () => json(providerResponse({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: key }] }] })),
    async () => new Response(JSON.stringify(providerResponse({ id: `resp_${key}` })).replaceAll('acme', '\\u0061cme')),
  ];
  for (const fetcher of fetchers) {
    await assert.rejects(createModelProvider({ fetcher, now: () => at }).retrieve({ key, scope, model, responseId: 'resp_acme' }),
      error => !JSON.stringify({ message: error.message, code: error.code }).includes(key));
  }
});

test('provider bounds hung fetch/body/cancel, rejects redirects and never retries a creation or throttle', async () => {
  const hung = [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } }))];
  for (const fetcher of hung) {
    await assert.rejects(createModelProvider({ fetcher, timeoutMs: 15 }).count(input()), { code: 'model_provider_timeout' });
  }
  for (const fetcher of [async () => { const r = json(providerResponse()); Object.defineProperty(r, 'redirected', { value: true }); return r; },
    async () => { const r = json(providerResponse()); Object.defineProperty(r, 'url', { value: 'https://acme.example/redirect' }); return r; },
    async () => new Response('x'.repeat(524289))]) {
    await assert.rejects(createModelProvider({ fetcher }).count(input()), { code: 'model_provider_response' });
  }
  for (const status of [429, 500]) {
    let calls = 0;
    const provider = createModelProvider({ fetcher: async () => { calls++; return json({ message: 'Acme unavailable' }, { status }); } });
    await assert.rejects(provider.create({ ...input(), maxOutputTokens: 100, store: false }));
    assert.equal(calls, 1);
  }
});

test('invalid input cannot send credentials, request storage or escape the response endpoint', async () => {
  let calls = 0;
  const provider = createModelProvider({ fetcher: async () => { calls++; throw Error('must not run'); } });
  await assert.rejects(provider.create({ ...input(), maxOutputTokens: 100, store: true }), { code: 'model_input' });
  await assert.rejects(provider.retrieve({ key, scope, model, responseId: '../other' }), { code: 'model_input' });
  await assert.rejects(provider.count({ ...input(), text: key }), { code: 'model_input' });
  await assert.rejects(provider.count({ ...input(), scope: { ...scope, workspace: 'Acme' } }), { code: 'model_input' });
  assert.equal(calls, 0);
});

test('vault read binds exact generation, policy, scope and existing encryption purpose without metadata leakage', async () => {
  const config = { appId: 10, installationId: 20, workspace: { id: 'acme', repoId: 30 },
    connectionEncryptionKey: Buffer.alloc(32, 7), storageUrl: 'https://acme.example', storageKey: 'acme-storage' };
  const descriptor = { id: 'acme', secretRef: '1'.repeat(64) }, policyDigest = '2'.repeat(64), expectedVersion = 3;
  const scopeHash = hash(JSON.stringify(['connection-vault-v1', 10, 20, 'acme', 30]));
  const identity = hash(JSON.stringify([descriptor.id, descriptor.secretRef]));
  const purpose = JSON.stringify(['connection-vault-v1', scopeHash, identity, policyDigest, expectedVersion]);
  const ciphertext = seal({ key }, config.connectionEncryptionKey, purpose);
  const good = { version: 3, policy: policyDigest, value: ciphertext };
  let requested;
  const store = createConnectionStore(config, async (url, options) => {
    requested = { url, body: JSON.parse(options.body) }; return json(good);
  });
  assert.equal(await store.readKey(descriptor, { policyDigest, expectedVersion }), key);
  assert.equal(requested.url, 'https://acme.example/rest/v1/rpc/keel_model_credential_read');
  assert.deepEqual(requested.body, { p_scope: scopeHash, p_connection: identity, p_policy: policyDigest, p_expected: 3 });
  for (const value of [null, { conflict: true }, { ...good, version: 4 }, { ...good, policy: '3'.repeat(64) },
    { ...good, value: seal({ key }, config.connectionEncryptionKey, purpose + 'wrong') }, { ...good, unexpected: true }]) {
    await assert.rejects(createConnectionStore(config, async () => json(value)).readKey(descriptor, { policyDigest, expectedVersion }));
  }
});

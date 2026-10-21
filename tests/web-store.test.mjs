import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/web-http.mjs';
import { createStore } from '../lib/web/store.mjs';
import { hash } from '../lib/web/common.mjs';

test('independent adapters share single-use consumption and versioned writes over HTTP protocol', async () => {
  const h = harness(), a = createStore(h.config, h.fetcher), b = createStore(h.config, h.fetcher), key = hash('fake-key'), binding = hash('fake-browser');
  await a.create('attempt', key, { verifier: 'fake-verifier' }, 600, binding);
  assert.equal(await b.consume(key, hash('wrong')), null);
  const attempts = await Promise.all([a.consume(key, binding), b.consume(key, binding)]);
  assert.equal(attempts.filter(Boolean).length, 1);
  await a.create('record', key, { text: 'first' }, 100);
  const writes = await Promise.all([a.compareAndSwap('record', key, 1, { text: 'second' }, 100), b.compareAndSwap('record', key, 1, { text: 'third' }, 100)]);
  assert.equal(writes.filter(Boolean).length, 1);
  assert.equal((await b.read('record', key)).version, 2);
});

test('revocation wins over renew, expiry denies, ciphertext binds to record identity and secrets never enter plaintext storage', async () => {
  const h = harness(), store = createStore(h.config, h.fetcher), key = hash('fake-session');
  await store.create('session', key, { token: 'fake-provider-sensitive-token' }, 10, null, '1');
  assert.doesNotMatch(JSON.stringify([...h.state.records]), /fake-provider-sensitive-token/);
  const other = hash('fake-other'); h.state.records.set(`session:${other}`, { ...h.state.records.get(`session:${key}`) });
  await assert.rejects(store.read('session', other), /invalid_stored_record/);
  await store.revoke(key); assert.equal(await store.renew(key, 1, 100), null);
  const expired = hash('fake-expired'); await store.create('session', expired, {}, 1); h.state.now += 1001;
  assert.equal(await store.read('session', expired), null); assert.equal(await store.renew(expired, 1, 100), null);
});

test('storage and upstream failures fail closed with bounded sanitized errors and no fallback', async () => {
  const h = harness(), signed = await h.login(); h.state.unavailable = true;
  const result = await h.service(h.request('/api/session', { cookie: signed.cookie }));
  assert.equal(result.status, 503); assert.deepEqual(await result.json(), { error: 'upstream_unavailable' });
  const store = createStore(h.config, async () => new Response('x'.repeat(40000)));
  await assert.rejects(store.read('session', hash('fake-key')), /upstream_unavailable/);
});

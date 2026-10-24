import test from 'node:test';
import assert from 'node:assert/strict';
import { NAMES } from '../lib/names.mjs';
import { webEnv, operationHeader, readOperationMarker, operationMarker } from '../lib/web/name-transition.mjs';
import { configFromEnv } from '../lib/web/config.mjs';
import { harness } from './helpers/web-http.mjs';

for (const row of NAMES.filter(r => r.phase === 127 && r.keel.startsWith('KEEL_'))) {
  test(`web env under both names: ${row.id}`, () => {
    for (const name of [row.plates, row.keel]) assert.equal(webEnv({ [name]: 'Acme' }, row.keel), 'Acme');
    assert.equal(webEnv({ [row.plates]: 'Acme', [row.keel]: 'Acme' }, row.keel), 'Acme');
    assert.throws(() => webEnv({ [row.plates]: 'private-one', [row.keel]: 'private-two' }, row.keel), error =>
      error.message.includes(row.plates) && error.message.includes(row.keel) && !error.message.includes('private-'));
  });
}
test('service starts under either complete environment and refuses conflicting configuration', () => {
  const h = harness();
  for (const prefix of ['PLATES', 'KEEL']) {
    const env = { [`${prefix}_WEB_CONFIG`]: JSON.stringify(h.input), [`${prefix}_GITHUB_CLIENT_SECRET`]: h.secrets.clientSecret,
      [`${prefix}_SESSION_ENCRYPTION_KEY`]: h.secrets.encryptionKey, SUPABASE_URL: h.secrets.storageUrl, SUPABASE_SERVICE_ROLE_KEY: h.secrets.storageKey };
    assert.equal(configFromEnv(env).origin, h.config.origin);
    assert.throws(() => configFromEnv({ ...env, PLATES_WEB_CONFIG: '{}', KEEL_WEB_CONFIG: '[]' }), /PLATES_WEB_CONFIG:KEEL_WEB_CONFIG/);
  }
});
for (const legacy of ['Keel-Operation', 'Keel-Update-Operation']) test(`operation aliases: ${legacy}`, () => {
  const row = NAMES.find(r => r.keel === legacy), id = 'a'.repeat(64);
  assert.equal(row.state, 'held', 'operation marker activation needs the verified deployed baseline');
  assert.equal(operationMarker(id, legacy), `${row.keel}: ${id}`);
  for (const name of [row.plates, row.keel]) {
    assert.equal(operationHeader(new Headers({ [name]: id }), legacy), id);
    assert.equal(readOperationMarker(`Acme\n\n${name}: ${id}`, legacy), id);
  }
  assert.equal(readOperationMarker(`${row.plates}: ${id}\n${row.keel}: ${id}`, legacy), id);
  assert.throws(() => operationHeader(new Headers({ [row.plates]: id, [row.keel]: 'other' }), legacy), /conflicting_names/);
  assert.throws(() => readOperationMarker(`${row.plates}: ${id}\n${row.keel}: other`, legacy), /conflicting_names/);
});


test('trusted checkout under either name refuses distinct aliases', async t => {
  const { mkdtemp, mkdir, rm, realpath } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { trustedCheckout } = await import('../lib/web/trusted-checkout.mjs');
  const root = await mkdtemp(join(tmpdir(), 'acme-checkout-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['trusted-plates', 'trusted-keel']) {
    await mkdir(join(root, name));
    let actual;
    await assert.doesNotReject(async () => { actual = await trustedCheckout(root); });
    assert.equal(actual, await realpath(join(root, name)));
    await rm(join(root, name), { recursive: true });
  }
  for (const name of ['trusted-plates', 'trusted-keel']) await mkdir(join(root, name));
  await assert.rejects(trustedCheckout(root), /conflicting_names/);
});


test('HTTP entrances refuse conflicting operation headers before effects', async () => {
  const h = harness();
  for (const [current, legacy] of [['Plates-Operation','Keel-Operation'], ['Plates-Update-Operation','Keel-Update-Operation']]) {
    for (const name of [current, legacy]) assert.equal((await h.service(h.request('/signin', { headers: { [name]: 'acme' } }))).status, 200);
    assert.equal((await h.service(h.request('/signin', { headers: { [current]: 'acme', [legacy]: 'other' } }))).status, 400);
  }
  assert.equal(h.state.requests.length, 0);
});

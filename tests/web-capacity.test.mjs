import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capacityModel } from '../lib/web/capacity.mjs';
import { observation, at } from './helpers/web-capacity.mjs';
const normalize = values => capacityModel(values, { now: () => at });

test('verified pool tuples deduplicate aliases and preserve actual durations and model provenance', () => {
  const first = observation();
  const second = observation({ source: { kind: 'local-reporter', id: 'acme-other' }, models: { ids: ['acme-model-2'], provenance: 'authenticated-reporter' } });
  const result = normalize([first, second, first]);
  assert.equal(result.pools.length, 1);
  assert.equal(result.pools[0].window.durationMinutes, 10080);
  assert.deepEqual(result.pools[0].origins, ['acme-connection', 'acme-other']);
  assert.deepEqual(result.pools[0].models.ids, ['acme-model', 'acme-model-2']);
  assert.equal(result.pools[0].eligible, true);
  assert.deepEqual(result.gaps, []);
  assert.equal(Object.hasOwn(result, 'total'), false);
});

test('unknown identities never deduplicate by labels, emails, credential hashes or matching values', () => {
  for (const change of [
    { identity: { account: null, workspace: null, scope: 'unknown', provenance: 'unknown' } },
    { pool: { id: null, provenance: 'unknown' } },
    { identity: { account: 'acme', workspace: null, scope: 'unknown', provenance: 'unknown' } },
  ]) {
    const result = normalize([observation(change), observation(change)]);
    assert.equal(result.pools.length, 2);
    assert.ok(result.pools.every(pool => !pool.eligible));
  }
  for (const change of [{ label: 'Acme' }, { email: 'acme@example.invalid' }, { keyHash: 'a'.repeat(64) }]) {
    const result = normalize([observation(change)]);
    assert.deepEqual(result.pools, []);
    assert.equal(result.gaps[0].code, 'capacity_observation_invalid');
    assert.ok(!JSON.stringify(result).includes('example.invalid'));
  }
});

test('identity tuples separate provider, account, workspace, pool, unit and window without delimiter collisions', () => {
  const variants = [observation(), observation({ provider: 'claude' }),
    observation({ identity: { account: 'acme-other', workspace: 'acme-workspace', scope: 'workspace', provenance: 'authenticated-reporter' } }),
    observation({ identity: { account: 'acme-account', workspace: 'acme-other', scope: 'workspace', provenance: 'authenticated-reporter' } }),
    observation({ pool: { id: 'acme-other', provenance: 'authenticated-reporter' } }),
    observation({ window: { durationMinutes: 300, resetAt: '2026-10-21T23:00:00.000Z' } }),
    observation({ kind: 'api-rate', unit: 'requests' }),
    observation({ kind: 'api-rate', unit: 'input-tokens' }),
    observation({ identity: { account: 'acme|one', workspace: 'two', scope: 'workspace', provenance: 'authenticated-reporter' } }),
    observation({ identity: { account: 'acme', workspace: 'one|two', scope: 'workspace', provenance: 'authenticated-reporter' } }),
  ];
  const result = normalize(variants);
  assert.equal(result.pools.length, variants.length);
  assert.equal(new Set(result.pools.map(pool => pool.id)).size, variants.length);
});

test('simultaneous conflicting observations stay conflicted and a later observation can resolve them', () => {
  const conflict = observation({ measurement: { used: 90, remaining: 10, limit: 100 } });
  const result = normalize([observation(), conflict, observation()]);
  assert.equal(result.pools.length, 1);
  assert.equal(result.pools[0].state, 'conflict');
  assert.equal(result.pools[0].eligible, false);
  assert.deepEqual(result.pools[0].measurement, { used: null, remaining: null, limit: null });
  const newer = observation({ observedAt: '2026-10-21T18:01:00.000Z' });
  assert.equal(capacityModel([conflict, observation(), newer], { now: at + 60_000 }).pools[0].state, 'observed');
});

test('expiration and reset never refill a stale window or infer a missing independent window', () => {
  const first = observation();
  for (const now of [at + 300_000, at + 8 * 86400_000]) {
    const pool = capacityModel([first], { now }).pools[0];
    assert.equal(pool.state, 'expired');
    assert.equal(pool.eligible, false);
    assert.equal(pool.measurement.remaining, 80);
  }
  const earlyReset = observation({ expiresAt: '2026-10-21T19:00:00.000Z', window: { durationMinutes: 1, resetAt: '2026-10-21T18:01:00.000Z' } });
  assert.equal(capacityModel([earlyReset], { now: at + 60_000 }).pools[0].state, 'expired');
  assert.equal(normalize([first]).pools.length, 1);
  assert.deepEqual(normalize([]), { pools: [], gaps: [{ code: 'capacity_unavailable' }] });
});

test('malformed, missing, future and contradictory numeric/window observations are never eligible', () => {
  for (const change of [
    { measurement: { used: 10, remaining: 90, limit: null } },
    { measurement: { used: 101, remaining: 0, limit: 100 } },
    { measurement: { used: 10, remaining: 100, limit: 100 } },
    { measurement: { used: NaN, remaining: 80, limit: 100 } },
    { measurement: { used: 20, remaining: '80', limit: 100 } },
    { measurement: { used: -1, remaining: 101, limit: 100 } },
    { window: { durationMinutes: null, resetAt: null } },
    { window: { durationMinutes: 0, resetAt: '2026-10-28T18:00:00.000Z' } },
    { observedAt: '2026-10-22T18:00:00.000Z' },
    { expiresAt: '2026-10-21T17:00:00.000Z' },
    { expiresAt: null }, { confidence: 'claimed' },
    { source: { kind: 'owner-claim', id: 'acme' } },
    { models: { ids: ['acme-inferred-model'], provenance: 'unknown' } },
  ]) assert.ok(normalize([observation(change)]).pools.every(pool => !pool.eligible), JSON.stringify(change));
});

test('newer malformed reports cannot fall back to older capacity, including broken shapes and windows', () => {
  const good = observation({ observedAt: '2026-10-21T17:59:00.000Z' });
  for (const change of [
    { measurement: {} }, { identity: {} }, { window: {} },
    { measurement: { used: 20, remaining: -1, limit: 100 } },
    { window: { durationMinutes: 300, resetAt: 'invalid' } },
    { window: { durationMinutes: null, resetAt: null } },
    { expiresAt: 'invalid' }, { observedAt: 'future-or-invalid' },
  ]) {
    const result = normalize([good, observation(change)]);
    assert.ok(result.pools.every(pool => !pool.eligible), JSON.stringify(change));
    assert.ok(result.gaps.length > 0);
  }
  const bad = observation({ observedAt: '2026-10-21T17:58:00.000Z', measurement: { used: -1, remaining: 80, limit: 100 } });
  assert.equal(normalize([bad, good]).pools[0].eligible, true);
});

test('composite constraints are nonadditive and model associations need authoritative provenance', () => {
  const result = normalize([
    observation({ kind: 'api-rate', unit: 'tokens', nonAdditive: true }),
    observation({ kind: 'api-rate', unit: 'input-tokens' }),
    observation({ kind: 'api-rate', unit: 'output-tokens' }),
    observation({ kind: 'spend', unit: 'usd', measurement: { used: 1, remaining: 9, limit: 10 } }),
    observation({ kind: 'runner', unit: 'workers', measurement: { used: 1, remaining: 1, limit: 2 } }),
  ]);
  assert.equal(result.pools.length, 5);
  assert.equal(result.pools[0].nonAdditive, true);
  assert.equal(result.pools[0].eligible, false);
  assert.equal(Object.hasOwn(result, 'total'), false);
  const unknown = normalize([observation({ models: { ids: [], provenance: 'unknown' } })]);
  assert.deepEqual(unknown.pools[0].models, { ids: [], provenance: 'unknown' });
});

test('capacity bounds refuse oversized or non-array batches without echoing source input', () => {
  for (const invalid of [null, {}, 'fake-acme-secret', Array(501).fill(observation())]) {
    assert.deepEqual(normalize(invalid), { pools: [], gaps: [{ code: 'capacity_input_invalid' }] });
  }
});

test('verified account identity never invents an account-wide pool from unresolved workspace scope', () => {
  for (const scope of ['unknown', 'workspace']) {
    const input = observation({ identity: { account: 'acme-account', workspace: null, scope, provenance: 'provider-response' } });
    const result = normalize([input, input]);
    assert.equal(result.pools.length, 2);
    assert.ok(result.pools.every(pool => !pool.eligible));
  }
  const accountWide = observation({ identity: { account: 'acme-account', workspace: null, scope: 'account', provenance: 'provider-response' } });
  const result = normalize([accountWide, accountWide]);
  assert.equal(result.pools.length, 1);
  assert.equal(result.pools[0].eligible, true);
  assert.equal(result.pools[0].identity.scope, 'account');
});

test('equivalent reset timestamps normalize before dedup and merged model coverage remains bounded', () => {
  const a = observation();
  const b = observation({ window: { durationMinutes: 10080, resetAt: '2026-10-28T18:00:00Z' } });
  assert.equal(normalize([a, b]).pools.length, 1);
  const many = Array.from({ length: 2 }, (_, batch) => observation({ models: {
    ids: Array.from({ length: 100 }, (_, i) => `acme-${batch}-${i}`), provenance: 'authenticated-reporter',
  } }));
  const result = normalize(many);
  assert.equal(result.pools.length, 1);
  assert.deepEqual(result.pools[0].models, { ids: [], provenance: 'unknown' });
  assert.ok(result.gaps.some(gap => gap.code === 'capacity_model_coverage_limit'));
});

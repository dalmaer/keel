import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createJobOidc } from '../lib/web/job-oidc.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fake-acme-key', alg: 'RS256', use: 'sig' };
const audience = 'https://acme.example';
const epoch = 1_800_000_000;
const claims = () => ({
  iss: 'https://token.actions.githubusercontent.com', aud: audience,
  sub: 'repo:Acme/widget:ref:refs/heads/main', iat: epoch, nbf: epoch, exp: epoch + 300,
  repository: 'Acme/widget', repository_id: '123', repository_owner_id: '456', actor_id: '789',
  workflow_ref: 'Acme/widget/.github/workflows/typecheck.yml@refs/heads/main',
  workflow_sha: 'a'.repeat(40), sha: 'a'.repeat(40), ref: 'refs/heads/main',
  event_name: 'workflow_dispatch', run_id: '900', run_attempt: '1', check_run_id: '901',
});
function token(payload = claims(), header = { alg: 'RS256', typ: 'JWT', kid: jwk.kid }) {
  const encoded = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${encoded}.${sign('RSA-SHA256', Buffer.from(encoded), privateKey).toString('base64url')}`;
}
function fixture(options = {}) {
  const calls = [];
  const verifier = createJobOidc({ audience }, {
    now: () => epoch * 1000,
    fetcher: async (url, request) => {
      calls.push({ url, request });
      return new Response(JSON.stringify({ keys: [jwk] }));
    }, ...options,
  });
  return { verifier, calls };
}

test('OIDC cryptographically verifies fixed issuer and projects signed numeric identity without bearer data', async () => {
  const { verifier, calls } = fixture();
  const identity = await verifier.verify(token());
  assert.equal(identity.actorId, 789);
  assert.equal(identity.repositoryId, 123);
  assert.equal(identity.repositoryOwnerId, 456);
  assert.equal(identity.runId, 900);
  assert.equal(identity.checkRunId, 901);
  assert.equal(identity.runAttempt, 1);
  assert.equal(identity.jobWorkflowRef, null);
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(JSON.stringify(identity).includes('fake-acme-key'), false);
  await verifier.verify(token());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://token.actions.githubusercontent.com/.well-known/jwks');
  assert.equal(calls[0].request.redirect, 'error');
  assert.equal(calls[0].request.headers.authorization, undefined);
});

test('OIDC accepts exact immutable repository subject and refuses mismatched embedded identities', async () => {
  const { verifier } = fixture();
  const immutable = 'repo:Acme@456/widget@123:ref:refs/heads/main';
  assert.equal((await verifier.verify(token({ ...claims(), sub: immutable }))).subject, immutable);
  for (const sub of [
    'repo:Acme@999/widget@123:ref:refs/heads/main',
    'repo:Acme@456/widget@999:ref:refs/heads/main',
    'repo:Other@456/widget@123:ref:refs/heads/main',
    'repo:Acme@456/other@123:ref:refs/heads/main',
    'repo:Acme@456/widget@123:ref:refs/heads/other',
    'repo:Acme@456/widget@123:environment:production',
  ]) await assert.rejects(verifier.verify(token({ ...claims(), sub })), { code: 'worker_identity_denied' });
});

test('OIDC refuses forged signature, unsigned algorithms, key URLs, malformed encodings and oversized tokens', async () => {
  const { verifier } = fixture();
  const forged = token().split('.');
  forged[1] = Buffer.from(JSON.stringify({ ...claims(), actor_id: '666' })).toString('base64url');
  for (const value of [
    forged.join('.'), token(claims(), { alg: 'none', kid: jwk.kid }),
    token(claims(), { alg: 'HS256', kid: jwk.kid }),
    token(claims(), { alg: 'RS256', kid: jwk.kid, jku: 'https://acme.invalid/keys' }),
    token(claims(), { alg: 'RS256', kid: 'fake-unknown' }),
    `${token()}=`, 'a'.repeat(16 * 1024 + 1), 'not-a-jwt',
  ]) await assert.rejects(verifier.verify(value), { code: 'worker_identity_denied' });
});

test('OIDC rejects missing or unsafe identity, wrong audience/issuer/event/ref, native reruns and invalid time', async () => {
  const { verifier } = fixture();
  const mutations = {
    iss: 'https://acme.invalid', aud: [audience], sub: 'repo:Acme/other:ref:refs/heads/main',
    repository_id: 123, repository_owner_id: '0', actor_id: '9007199254740992', run_id: '-1',
    run_attempt: '2', event_name: 'pull_request', ref: 'refs/tags/v1',
    sha: ['a'.repeat(40)], workflow_sha: null, workflow_ref: 'Other/widget/.github/workflows/typecheck.yml@refs/heads/main',
    check_run_id: [], job_workflow_ref: 'Acme/widget/.github/workflows/other.yml@main',
    exp: epoch, iat: epoch + 31, nbf: epoch + 31,
  };
  for (const [key, value] of Object.entries(mutations)) {
    await assert.rejects(verifier.verify(token({ ...claims(), [key]: value })), { code: 'worker_identity_denied' }, key);
  }
  for (const key of ['actor_id', 'repository_id', 'repository_owner_id', 'run_id', 'iat', 'nbf', 'exp', 'sha', 'workflow_sha']) {
    const absent = claims(); delete absent[key];
    await assert.rejects(verifier.verify(token(absent)), { code: 'worker_identity_denied' }, key);
  }
  await assert.rejects(verifier.verify(token({ ...claims(), exp: epoch + 601 })), { code: 'worker_identity_denied' });
});

test('OIDC rejects ambiguous JWKS and expires cache without trusting stale keys on provider failure', async () => {
  for (const keys of [[jwk, jwk], [], [{ ...jwk, kty: 'oct' }], [{ ...jwk, n: 'fake' }]]) {
    const { verifier } = fixture({ fetcher: async () => Response.json({ keys }) });
    await assert.rejects(verifier.verify(token()), { code: 'worker_identity_unavailable' });
  }
  let time = epoch * 1000;
  let calls = 0;
  const { verifier } = fixture({ now: () => time, fetcher: async () => {
    if (++calls > 1) throw new Error('fake-private-provider-detail');
    return Response.json({ keys: [jwk] });
  } });
  await verifier.verify(token());
  time += 60_001;
  await assert.rejects(verifier.verify(token()), error => error.code === 'worker_identity_unavailable'
    && !error.message.includes('private'));
  assert.equal(calls, 2);
});

test('OIDC bounds signing-key response bytes and a fetch that ignores abort', async t => {
  const oversized = fixture({ fetcher: async () => new Response(' '.repeat(65 * 1024)) });
  await assert.rejects(oversized.verifier.verify(token()), { code: 'worker_identity_unavailable' });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hanging = fixture({ fetcher: () => new Promise(() => {}) });
  const pending = hanging.verifier.verify(token());
  const refusal = assert.rejects(pending, { code: 'worker_identity_unavailable' });
  t.mock.timers.tick(4999);
  t.mock.timers.tick(1);
  await refusal;
});

test('OIDC audience accepts only an exact configured HTTPS origin', () => {
  for (const value of ['http://acme.example', 'https://acme.example/', 'https://acme.example/callback',
    'https://user:fake@acme.example', 'https://acme.example?query', 'https://acme.example#hash']) {
    assert.throws(() => createJobOidc({ audience: value }));
  }
});

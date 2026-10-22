import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { WebError, boundedJson, record } from './common.mjs';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS = `${ISSUER}/.well-known/jwks`;
const SHA = /^[0-9a-f]{40}$/;
const sha = value => typeof value === 'string' && SHA.test(value);
const TEXT = /^[\x21-\x7e]+$/;
const fail = () => { throw new WebError('worker_identity_denied', 401); };
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value)
  && Number.isSafeInteger(Number(value)) ? Number(value) : fail();

export function workerOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) fail();
    return url.origin;
  } catch { fail(); }
}

function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) fail();
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(); }
}

function identity(claims, audience, now) {
  const second = Math.floor(now / 1000);
  if (!record(claims) || claims.iss !== ISSUER || claims.aud !== audience
    || ![claims.iat, claims.nbf, claims.exp].every(Number.isSafeInteger)
    || claims.iat > second + 30 || claims.nbf > second + 30 || claims.exp <= second
    || claims.exp <= claims.iat || claims.exp - claims.iat > 600
    || claims.nbf > claims.exp || claims.iat < second - 600) fail();
  if (claims.event_name !== 'workflow_dispatch' || claims.run_attempt !== '1'
    || typeof claims.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(claims.repository)
    || claims.repository.length > 240 || !sha(claims.sha) || !sha(claims.workflow_sha)
    || typeof claims.ref !== 'string' || !claims.ref.startsWith('refs/heads/')
    || claims.ref.length > 256 || !TEXT.test(claims.ref)
    || typeof claims.workflow_ref !== 'string' || claims.workflow_ref.length > 600
    || !claims.workflow_ref.startsWith(`${claims.repository}/.github/workflows/`)
    || !claims.workflow_ref.endsWith(`@${claims.ref}`) || !TEXT.test(claims.workflow_ref)) fail();
  const repositoryId = id(claims.repository_id);
  const repositoryOwnerId = id(claims.repository_owner_id);
  const [owner, repository] = claims.repository.split('/');
  // GitHub's immutable default (2026-07-15) and its retained legacy default.
  // Custom environment/organization subject templates are not this adapter.
  const subjects = [
    `repo:${claims.repository}:ref:${claims.ref}`,
    `repo:${owner}@${repositoryOwnerId}/${repository}@${repositoryId}:ref:${claims.ref}`,
  ];
  if (!subjects.includes(claims.sub)) fail();
  const jobWorkflowRef = claims.job_workflow_ref ?? null;
  const jobWorkflowSha = claims.job_workflow_sha ?? null;
  if ((jobWorkflowRef === null) !== (jobWorkflowSha === null)
    || (jobWorkflowRef !== null && (typeof jobWorkflowRef !== 'string'
      || jobWorkflowRef.length > 600 || !TEXT.test(jobWorkflowRef) || !sha(jobWorkflowSha)))) fail();
  return Object.freeze({
    repositoryId, repositoryOwnerId,
    actorId: id(claims.actor_id), repository: claims.repository,
    workflowRef: claims.workflow_ref, workflowSha: claims.workflow_sha, sha: claims.sha,
    ref: claims.ref, eventName: claims.event_name, runId: id(claims.run_id), runAttempt: 1,
    checkRunId: claims.check_run_id === undefined ? null : id(claims.check_run_id),
    jobWorkflowRef, jobWorkflowSha, issuedAt: claims.iat, expiresAt: claims.exp, subject: claims.sub,
  });
}

/** Fixed GitHub issuer only. This authenticates claims; operation authorization stays in jobs. */
export function createJobOidc({ audience }, { fetcher = fetch, now = Date.now } = {}) {
  workerOrigin(audience);
  let cache = null;
  let pending = null;
  async function keys() {
    if (cache && cache.until > now()) return cache.keys;
    if (!pending) pending = (async () => {
      const abort = new AbortController();
      let timer;
      try {
        const data = await Promise.race([
          (async () => boundedJson(await fetcher(JWKS, {
            headers: { accept: 'application/json' }, redirect: 'error', signal: abort.signal,
          }), 64 * 1024))(),
          new Promise((_, reject) => { timer = setTimeout(() => {
            abort.abort(); reject(new WebError('worker_identity_unavailable', 503));
          }, 5000); }),
        ]);
        if (!record(data) || !Array.isArray(data.keys) || !data.keys.length || data.keys.length > 16) fail();
        const result = new Map();
        for (const jwk of data.keys) {
          if (!record(jwk) || jwk.kty !== 'RSA' || (jwk.alg !== undefined && jwk.alg !== 'RS256')
            || (jwk.use !== undefined && jwk.use !== 'sig') || typeof jwk.kid !== 'string'
            || !/^[A-Za-z0-9_.-]{1,128}$/.test(jwk.kid) || result.has(jwk.kid)
            || typeof jwk.n !== 'string' || !/^[A-Za-z0-9_-]{342,683}$/.test(jwk.n)
            || typeof jwk.e !== 'string' || !/^[A-Za-z0-9_-]{1,8}$/.test(jwk.e)) fail();
          const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
          const bits = key.asymmetricKeyDetails?.modulusLength;
          if (!bits || bits < 2048 || bits > 4096) fail();
          result.set(jwk.kid, key);
        }
        cache = { until: now() + 60_000, keys: result };
        return result;
      } catch { throw new WebError('worker_identity_unavailable', 503); }
      finally { clearTimeout(timer); abort.abort(); }
    })().finally(() => { pending = null; });
    return pending;
  }
  return {
    async verify(token) {
      if (typeof token !== 'string' || token.length > 16 * 1024) fail();
      const parts = token.split('.');
      if (parts.length !== 3) fail();
      const header = decode(parts[0]);
      if (!record(header) || header.alg !== 'RS256' || (header.typ !== undefined && header.typ !== 'JWT')
        || typeof header.kid !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(header.kid)
        || Object.keys(header).some(key => !['alg', 'typ', 'kid'].includes(key))) fail();
      if (!/^[A-Za-z0-9_-]+$/.test(parts[2])) fail();
      const signature = Buffer.from(parts[2], 'base64url');
      if (signature.toString('base64url') !== parts[2]) fail();
      const key = (await keys()).get(header.kid);
      if (!key || !verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, signature)) fail();
      return identity(decode(parts[1]), audience, now());
    },
  };
}

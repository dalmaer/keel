import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

export const WORKER_MAX_MINUTES = 15;
export const WORKER_HEARTBEAT_MS = 10_000;
const CALL_MS = 5000;
const HEX = /^[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const positive = value => Number.isSafeInteger(value) && value > 0;
const stopped = () => new Error('worker_stopped');
const record = value => value && typeof value === 'object' && !Array.isArray(value);

// Keep the executable's trust closure to this module and Node builtins. The
// registry pins this module and the bridge separately from the web application.
function workerOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw stopped();
  return url.origin;
}

async function boundedJson(response, limit) {
  if (!response.ok) { await response.body?.cancel(); throw stopped(); }
  const reader = response.body?.getReader();
  if (!reader) throw stopped();
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw stopped();
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await reader.cancel().catch(() => {}); }
}

/** Deliberately excludes checkout, OIDC, API and provider credentials from project commands. */
export function workerChildEnvironment(env) {
  return Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'CI', 'GITHUB_ACTIONS']
    .filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
}

/** POSIX process group ownership includes descendants left behind after the parent exits. */
export function runWorkerProcess(argv, { cwd, env, signal, stdio = 'inherit' }) {
  if (process.platform === 'win32' || signal.aborted) return Promise.reject(stopped());
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, detached: true, stdio });
    let settled = false;
    const kill = () => {
      if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ }
    };
    const abort = () => { kill(); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) kill();
    child.once('error', () => {
      kill(); signal.removeEventListener('abort', abort);
      if (!settled) { settled = true; reject(stopped()); }
    });
    child.once('exit', kill);
    child.once('close', (code, exitSignal) => {
      kill(); signal.removeEventListener('abort', abort);
      if (!settled) {
        settled = true;
        resolve({ exitCode: Number.isInteger(code) ? code : null, stopped: signal.aborted || exitSignal !== null });
      }
    });
  });
}

async function boundedCall(action, signal, milliseconds = CALL_MS) {
  if (signal.aborted || milliseconds <= 0) throw stopped();
  const abort = new AbortController();
  const combined = AbortSignal.any([signal, abort.signal]);
  let timer;
  let onAbort;
  try {
    return await Promise.race([
      action(combined),
      new Promise((_, reject) => {
        onAbort = () => reject(stopped());
        combined.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => abort.abort(), milliseconds);
        if (combined.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    combined.removeEventListener('abort', onAbort);
    abort.abort();
  }
}

function oidcEndpoint(value, audience) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || !url.hostname.endsWith('.actions.githubusercontent.com')) throw stopped();
  url.searchParams.set('audience', audience);
  return url.href;
}

/** Calls only fixed protocol routes. Never retries begin or a project command. */
export function createWorkerTransport({ origin, oidcUrl, oidcToken }, { fetcher = fetch } = {}) {
  workerOrigin(origin);
  const endpoint = oidcEndpoint(oidcUrl, origin);
  if (typeof oidcToken !== 'string' || !oidcToken || oidcToken.length > 16 * 1024) throw stopped();
  return async (stage, body, signal) => {
    if (!['claim', 'begin', 'heartbeat', 'complete', 'update-output'].includes(stage)) throw stopped();
    return boundedCall(async boundedSignal => {
      const identity = await boundedJson(await fetcher(endpoint, {
        headers: { authorization: `Bearer ${oidcToken}` }, redirect: 'error', signal: boundedSignal,
      }), 24 * 1024);
      if (!record(identity) || typeof identity.value !== 'string' || identity.value.length > 16 * 1024
        || !/^[A-Za-z0-9_.-]+$/.test(identity.value)) throw stopped();
      return boundedJson(await fetcher(`${origin}/api/workers/${stage}`, {
        method: 'POST', headers: { authorization: `Bearer ${identity.value}`, 'content-type': 'application/json' },
        body: JSON.stringify(body), redirect: 'error', signal: boundedSignal,
      }), 16 * 1024);
    }, signal);
  };
}

async function checkoutRevision(cwd, env, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd, env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      shell: false, detached: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    const kill = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const abort = () => kill();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) kill();
    child.stdout.on('data', data => { output += data; if (output.length > 256) kill(); });
    child.once('error', () => { signal.removeEventListener('abort', abort); kill(); reject(stopped()); });
    child.once('exit', kill);
    child.once('close', code => {
      signal.removeEventListener('abort', abort); kill();
      if (signal.aborted || code !== 0 || !SHA.test(output.trim())) reject(stopped());
      else resolve(output.trim());
    });
  });
}

/** Dependencies are test seams, never workflow inputs. The public adapter accepts no command. */
export async function runJobWorker(options, {
  transport = createWorkerTransport(options), now = Date.now, monotonic = () => performance.now(),
  runCommand = runWorkerProcess, readCheckout = checkoutRevision,
  heartbeatMs = WORKER_HEARTBEAT_MS, signal = new AbortController().signal,
} = {}) {
  const origin = workerOrigin(options.origin);
  if (typeof options.operationId !== 'string' || !HEX.test(options.operationId)
    || typeof options.sha !== 'string' || !SHA.test(options.sha)
    || typeof options.workflowSha !== 'string' || !SHA.test(options.workflowSha)
    || options.runAttempt !== '1' || typeof options.cwd !== 'string' || !options.cwd
    || !Number.isFinite(heartbeatMs) || heartbeatMs <= 0 || heartbeatMs > WORKER_HEARTBEAT_MS) throw stopped();
  void origin;
  const started = monotonic();
  const abort = new AbortController();
  const combined = AbortSignal.any([signal, abort.signal]);
  const nonce = randomBytes(32).toString('hex');
  const base = { operationId: options.operationId, nonce, jobName: 'web-worker' };
  const env = workerChildEnvironment(options.env ?? process.env);
  let deadline = started + WORKER_MAX_MINUTES * 60_000;
  let lease = deadline;
  let watch;
  let sequence = 0;
  let claim = null;
  let heartbeat = null;
  let heartbeatStop = null;
  let outcome = { state: 'failed', exitCode: null };
  const arm = () => {
    clearTimeout(watch);
    const remaining = Math.min(deadline, lease) - monotonic();
    if (remaining <= 0) abort.abort();
    else watch = setTimeout(() => abort.abort(), remaining);
  };
  const call = (stage, body) => boundedCall(boundedSignal => transport(stage, body, boundedSignal),
    combined, Math.min(CALL_MS, deadline - monotonic(), lease - monotonic()));
  const updateLease = value => {
    if (!Number.isSafeInteger(value) || value <= now() || !claim || value > claim.deadline) throw stopped();
    lease = monotonic() + value - now();
    arm();
  };
  arm();
  try {
    // A same-process nonce may recover a lost claim; no other stage is retried.
    try { claim = await call('claim', base); }
    catch { if (combined.aborted) throw stopped(); claim = await call('claim', base); }
    if (!record(claim) || !positive(claim.fence) || !positive(claim.jobId)
      || claim.adapter !== 'typecheck-v1' || claim.checkoutSha !== options.sha
      || claim.workflowSha !== options.workflowSha || !Number.isSafeInteger(claim.deadline)
      || claim.deadline <= now() || claim.deadline - now() > WORKER_MAX_MINUTES * 60_000) throw stopped();
    deadline = Math.min(deadline, monotonic() + claim.deadline - now());
    updateLease(claim.leaseExpiresAt);
    const actual = await boundedCall(s => readCheckout(options.cwd, env, s), combined,
      Math.min(CALL_MS, deadline - monotonic(), lease - monotonic()));
    if (actual !== options.sha) throw stopped();
    const held = { ...base, fence: claim.fence, jobId: claim.jobId };
    const begun = await call('begin', held);
    if (!record(begun) || begun.granted !== true || begun.fence !== claim.fence
      || begun.jobId !== claim.jobId || begun.deadline !== claim.deadline) throw stopped();
    updateLease(begun.leaseExpiresAt);
    heartbeatStop = new AbortController();
    heartbeat = (async () => {
      try {
        while (!combined.aborted && !heartbeatStop.signal.aborted) {
          await sleep(heartbeatMs, undefined, { signal: AbortSignal.any([combined, heartbeatStop.signal]) });
          if (heartbeatStop.signal.aborted) break;
          const reply = await call('heartbeat', { ...held, sequence: ++sequence });
          if (!record(reply) || reply.continue !== true) throw stopped();
          updateLease(reply.leaseExpiresAt);
        }
      } catch {
        if (!heartbeatStop.signal.aborted) abort.abort();
      }
    })();
    for (const argv of [['npm', 'ci', '--ignore-scripts'], ['npm', 'run', 'typecheck']]) {
      if (combined.aborted || monotonic() >= Math.min(deadline, lease)) throw stopped();
      const result = await runCommand(argv, { cwd: options.cwd, env, signal: combined });
      if (combined.aborted || result.stopped) { outcome = { state: 'cancelled', exitCode: result.exitCode }; break; }
      outcome = { state: result.exitCode === 0 ? 'succeeded' : 'failed', exitCode: result.exitCode };
      if (result.exitCode !== 0) break;
    }
    heartbeatStop.abort();
    await heartbeat;
    if (combined.aborted) outcome = { state: 'cancelled', exitCode: outcome.exitCode };
    if (!combined.aborted) {
      const reply = await call('complete', { ...held, sequence: ++sequence, result: outcome });
      if (!record(reply) || reply.accepted !== true) throw stopped();
    }
    return outcome;
  } catch { return { state: combined.aborted ? 'cancelled' : 'failed', exitCode: null }; }
  finally {
    abort.abort(); heartbeatStop?.abort(); clearTimeout(watch);
    if (heartbeat) await heartbeat;
  }
}

// Foreground offline adapter. Names are supplied by an already durable intent.
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateCommand } from './web/update-container.mjs';
import { checkEvaluation as check } from './evaluation-records.mjs';
import { ARTIFACT_BYTES, FILE_LIMIT } from './evaluation-artifacts.mjs';
export const DOCKER_POLICY = Object.freeze({ cpu: 1, memoryMiB: 512, pids: 64, workMiB: 16, tmpMiB: 32, outputBytes: 16384, submissionBytes: 384 * 1024, artifactBytes: ARTIFACT_BYTES, maxFiles: FILE_LIMIT, maxChecks: 8, cleanupSeconds: 10, supervisorUid: 1001, executorUid: 1000, clockToleranceMs: 1000, supervisorDeadline: 'absolute-epoch-with-bounded-fallback' });
const dockerEnv = () => Object.fromEntries(['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
async function command(args, options = {}) {
  return updateCommand('docker', args, { env: dockerEnv(), maxBytes: DOCKER_POLICY.outputBytes, ...options });
}
async function required(args, options = {}) {
  const r = await command(args, options); check(r.exit === 0 && r.signal === null, `docker command failed: ${args[0]}`); return r.stdout.trim();
}
export async function preflightDocker(environment, { deadline } = {}) {
  const remaining = Math.min(10000, deadline === undefined ? 10000 : deadline - Date.now());
  check(remaining > 0, 'image preflight preparation deadline');
  const raw = await required(['image', 'inspect', environment.image], { signal: AbortSignal.timeout(remaining), maxBytes: 65536 });
  const [image] = JSON.parse(raw);
  check(image && image.Os + '/' + image.Architecture === environment.platform, 'image platform mismatch');
  check(image.Id === environment.image || image.RepoDigests?.some(d => d.endsWith('@' + environment.image)), 'image digest mismatch');
  check(!image.Config?.Volumes || Object.keys(image.Config.Volumes).length === 0, 'image-declared volumes refused');
  check(!image.Config?.OnBuild?.length, 'image onbuild unsupported');
  const inherited = image.Config?.Env ?? [];
  check(inherited.every(e => /^(PATH|NODE_VERSION|YARN_VERSION)=/.test(e)) && new Set(inherited.map(e => e.split('=')[0])).size === inherited.length, 'unsafe inherited image environment');
  const nodeVersion = inherited.find(e => e.startsWith('NODE_VERSION='))?.slice(13);
  check(/^24\.(?:2[2-9]|[3-9][0-9]|[1-9][0-9]{2,})\.[0-9]+$/.test(nodeVersion) && nodeVersion !== '24.22.0', 'unsupported image Node version');
  return { id: image.Id, platform: environment.platform, requested: environment.image, inherited, nodeVersion };
}
export function containerArgs(name, image, deadlineEpochMs) {
  check(Number.isSafeInteger(deadlineEpochMs), 'absolute container deadline required');
  const maximumLifetimeMs = Math.max(1, Math.min(600000, deadlineEpochMs - Date.now()));
  const supervisor = `setTimeout(()=>process.exit(124),Math.max(1,Math.min(${maximumLifetimeMs},${deadlineEpochMs}-Date.now())));`;
  return ['create', '--name', name, '--pull', 'never', '--read-only', '--user', '1001:1001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--network', 'none', '--pids-limit', '64', '--cpus', '1', '--memory', '512m', '--memory-swap', '512m',
    '--ulimit', 'nofile=256:256', '--log-driver', 'none', '--platform', image.platform,
    '--tmpfs', '/work:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=32m,uid=1000,gid=1000',
    '--workdir', '/work', '--env', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', '--env', 'HOME=/tmp', '--env', 'TZ=UTC', '--env', 'CI=true', '--env', 'GIT_CONFIG_NOSYSTEM=1', '--env', 'GIT_CONFIG_GLOBAL=/dev/null',
    '--entrypoint', '/usr/local/bin/node', image.id, '-e', supervisor];
}
const populate = `const fs=require('node:fs'),p=require('node:path');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{for(const f of JSON.parse(input)){fs.mkdirSync(p.dirname(f.path),{recursive:true});fs.writeFileSync(f.path,Buffer.from(f.base64,'base64'),{flag:'wx',mode:f.mode==='100755'?493:420})}});`;
export async function runDockerStage({ name, image, files, argv, stdin = '', submission = false, deadline, cleanupDeadline }) {
  const startedAt = new Date().toISOString(), signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  const result = { operation: name, containerId: null, startedAt, setup: 'not-run', execution: 'not-run', output: null, deadlineEpochMs: deadline, clockObservation: null, termination: { operation: name, state: 'not-dispatched' }, error: null };
  const scratch = await mkdtemp(join(tmpdir(), 'plates-eval-'));
  let attempted = false;
  try {
    const inputFile = join(scratch, 'input'); await writeFile(inputFile, JSON.stringify(files), { mode: 0o600 });
    check(!signal.aborted, 'trial deadline exhausted');
    attempted = true; result.termination = { operation: name, state: 'unknown' };
    result.containerId = await required(containerArgs(name, image, deadline), { signal });
    check(/^[a-f0-9]{64}$/.test(result.containerId), 'invalid container identity');
    // The approved image is trusted infrastructure. Preflight restricts its
    // inherited environment; source and candidate code run under another UID.
    await required(['start', name], { signal });
    check(await required(['exec', '--user', '1000:1000', name, '/usr/local/bin/node', '--version'], { signal }) === 'v' + image.nodeVersion, 'image runtime metadata mismatch');
    const clockStart = Date.now();
    const containerNow = Number(await required(['exec', '--user', '1000:1000', name, '/usr/local/bin/node', '-e', 'console.log(Date.now())'], { signal }));
    const clockEnd = Date.now();
    result.clockObservation = { hostBefore: clockStart, hostAfter: clockEnd, containerNow, toleranceMs: DOCKER_POLICY.clockToleranceMs };
    check(Number.isSafeInteger(containerNow) && containerNow >= clockStart - DOCKER_POLICY.clockToleranceMs && containerNow <= clockEnd + DOCKER_POLICY.clockToleranceMs, 'container clock outside supported tolerance');
    await required(['exec', '--user', '1000:1000', '-i', name, '/usr/local/bin/node', '-e', populate], { signal, inputFile });
    result.setup = 'passed';
    await writeFile(inputFile, stdin, { mode: 0o600 });
    const output = await command(['exec', '--user', '1000:1000', '-i', name, ...argv], { signal, inputFile, maxBytes: submission ? DOCKER_POLICY.submissionBytes + DOCKER_POLICY.outputBytes : DOCKER_POLICY.outputBytes });
    check(Buffer.byteLength(output.stderr) <= DOCKER_POLICY.outputBytes && Buffer.byteLength(output.stdout) <= (submission ? DOCKER_POLICY.submissionBytes : DOCKER_POLICY.outputBytes), 'stage output exceeds bound');
    result.output = output;
    result.execution = signal.aborted || output.signal ? 'unknown' : output.exit === 0 ? 'passed' : 'failed';
    if (signal.aborted || Date.now() >= deadline) result.error = 'deadline-exhausted';

  } catch (error) {
    result.error = signal.aborted ? 'deadline-exhausted' : error.message;
    if (result.setup !== 'passed') result.setup = 'failed';
    else if (result.execution === 'not-run') result.execution = 'unknown';
  } finally {
    if (attempted) {
      const cleanup = AbortSignal.timeout(Math.max(1, Math.min(DOCKER_POLICY.cleanupSeconds * 1000, cleanupDeadline === undefined ? Infinity : cleanupDeadline - Date.now())));
      try {
        const raw = await required(['inspect', '--format', '{{json .}}', name], { signal: cleanup, maxBytes: 65536 });
        const found = JSON.parse(raw);
        check(/^[a-f0-9]{64}$/.test(found.Id) && (!result.containerId || result.containerId === found.Id), 'operation identity conflict');
        result.containerId = found.Id;
        if (found.State.Paused) await required(['unpause', name], { signal: cleanup });
        if (found.State.Running) await required(['kill', name], { signal: cleanup });
        check(await required(['inspect', '--format', '{{.State.Running}}', name], { signal: cleanup }) === 'false', 'termination unconfirmed');
        result.termination = { operation: name, state: 'terminated', containerId: found.Id, running: false };
        // Retain stopped containers as inspectable original operations. No volumes
        // or private input survive; removal is an explicit owner cleanup action.
      } catch { result.termination = { operation: name, state: 'unknown' }; }
    }
    await rm(scratch, { recursive: true, force: true });
  }
  result.completedAt = new Date().toISOString(); return result;
}

// Recovery never creates an operation or infers non-dispatch from absence.
export async function inspectDockerOperation(operation, image, { cancel = false, expectedId = null } = {}) {
  const unknown = { operation, state: 'unknown' };
  if (!/^plates-eval-[a-f0-9]{32}-(builder|check-[0-7])$/.test(operation)) return unknown;
  try {
    const options = { signal: AbortSignal.timeout(1000), maxBytes: 65536 };
    const found = JSON.parse(await required(['inspect', '--format', '{{json .}}', operation], options));
    check(found.Name === '/' + operation && found.Image === image.id && /^[a-f0-9]{64}$/.test(found.Id)
      && (!expectedId || expectedId === found.Id), 'original container binding mismatch');
    if (cancel && found.State.Running) {
      if (found.State.Paused) await required(['unpause', found.Id], options);
      await required(['kill', found.Id], options);
    }
    const stopped = await required(['inspect', '--format', '{{.State.Running}}', found.Id], options) === 'false';
    return stopped ? { operation, state: 'terminated', containerId: found.Id, running: false } : unknown;
  } catch { return unknown; }
}

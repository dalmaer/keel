import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { prepareUpdate } from '../update-prepare.mjs';
import { load as loadPractices } from '../practices.mjs';
import { load as loadMigrations } from '../migrations.mjs';
import { validateUpdateOutput, patchDigest, validateUpdateTarget, updatePath } from '../update-artifact.mjs';
import { scanUpdateTree, assertUpdateTree, freezeUpdatePatch, blobOf } from './update-patch.mjs';
import { runUpdateContainer, updateCommand, validateContainerPolicy } from './update-container.mjs';
import { createWorkerTransport, workerChildEnvironment } from './job-worker.mjs';

const fail = code => { throw new Error(code); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const trustedEnv = () => ({ ...workerChildEnvironment(process.env), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });

async function git(root, args, signal, run = updateCommand) {
  const r = await run('git', ['-C', root, ...args], { signal, env: trustedEnv(), maxBytes: 8 * 1024 * 1024 });
  if (r.exit !== 0) fail('update_source_unavailable');
  return r.stdout.trim();
}

/** Materialize immutable Git source, then prove archive coverage (export-ignore cannot hide paths). */
export async function materializeUpdateSource(projectRoot, commit, destination, signal, run = updateCommand) {
  if (!sha(commit) || await git(projectRoot, ['rev-parse', 'HEAD'], signal, run) !== commit) fail('update_source_changed');
  const list = await git(projectRoot, ['ls-tree', '-rlz', commit], signal, run);
  const expected = new Map();
  let size = 0;
  for (const row of list.split('\0').filter(Boolean)) {
    const match = /^(100644|100755|120000) blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/.exec(row);
    if (!match || !updatePath(match[4])) fail('unsupported_update_source');
    size += Number(match[3]);
    if (size > 512 * 1024 * 1024 || Number(match[3]) > 32 * 1024 * 1024 || expected.size >= 20000) fail('update_source_limit');
    expected.set(match[4], { mode: match[1], blob: match[2] });
  }
  await mkdir(destination, { recursive: true });
  const archive = `${destination}.tar`;
  try {
    if ((await run('git', ['-C', projectRoot, 'archive', '--format=tar', '-o', archive, commit], { signal, env: trustedEnv() })).exit !== 0
      || (await run('tar', ['-xf', archive, '-C', destination], { signal, env: trustedEnv() })).exit !== 0) fail('update_source_unavailable');
  } finally { await rm(archive, { force: true }); }
  const observed = await scanUpdateTree(destination);
  if (observed.size !== expected.size) fail('update_source_incomplete');
  assertUpdateTree(expected, observed);
  return observed;
}

/** Trusted child entry: isolated from control credentials and bounded by its parent. */
export async function prepareUpdateTree(root, targetRoot, version, baseline) {
  await scanUpdateTree(root); // No host reader sees escaped paths from setup.
  const config = JSON.parse(await readFile(join(root, '.plates/plates.json'), 'utf8'));
  for (const path of [config.guide, config.lessons].filter(v => v !== undefined)) {
    if (!updatePath(path)) fail('unsupported_update_config_path');
  }
  const result = await prepareUpdate(root, { version,
    practices: await loadPractices(join(targetRoot, 'practices')),
    migrations: await loadMigrations(join(targetRoot, 'migrations')) });
  const after = await scanUpdateTree(root);
  const candidates = [...result.rendered.map(p => p.split('#')[0]),
    ...result.applied.flatMap(m => m.edits.map(e => e.path)), '.plates/plates.json', '.plates/lock.json', 'docs/ROADMAP.md'];
  return { files: freezeUpdatePatch(new Map(baseline), after, candidates),
    migrations: result.applied.map(m => ({ id: m.id, summary: m.summary, paths: m.edits.map(e => e.path), notes: m.notes ?? [] })) };
}

export async function prepareIsolatedUpdate({ preparation, projectRoot, targetRoot, signal }, {
  containerRun = runUpdateContainer, run = updateCommand, prepare,
} = {}) {
  const { base, target, container, setup, check, env } = preparation;
  validateUpdateTarget(target); validateContainerPolicy(container, env);
  if (!sha(base?.commit) || typeof check !== 'string' || !check.trim()
    || !(setup === null || typeof setup === 'string' && setup.trim())) fail('invalid_update_preparation');
  if (await git(targetRoot, ['rev-parse', 'HEAD'], signal, run) !== target.commit
    || hash(await git(targetRoot, ['rev-parse', `${target.commit}^{tree}`], signal, run)) !== target.bundleDigest
    || await git(targetRoot, ['status', '--porcelain', '--untracked-files=all'], signal, run) !== ''
    || await git(targetRoot, ['ls-files', '--others', '--ignored', '--exclude-standard'], signal, run) !== '') fail('update_target_changed');
  const pkg = JSON.parse(await readFile(join(targetRoot, 'package.json'), 'utf8'));
  if (pkg.version !== target.cliVersion || (await readFile(join(targetRoot, 'practices/VERSION'), 'utf8')).trim() !== target.practiceVersion) fail('update_target_changed');
  const temp = await mkdtemp(join(tmpdir(), 'plates-update-preparation-'));
  const original = join(temp, 'original'), working = join(temp, 'working'), checked = join(temp, 'checked'), baseChecked = join(temp, 'base-checked');
  const containerIds = [], checks = { setup: null, updated: null, base: null, baseSetup: null };
  try {
    const before = await materializeUpdateSource(projectRoot, base.commit, original, signal, run);
    await cp(original, working, { recursive: true, verbatimSymlinks: true });
    if (setup !== null) {
      const configured = join(temp, 'configured'); await mkdir(configured);
      const result = await containerRun({ source: working, destination: configured, container,
        commands: [{ key: 'setup', command: setup }], env, expected: before, signal });
      containerIds.push(result.containerId); checks.setup = result.checks.setup;
      if (checks.setup?.exit !== 0) fail('update_setup_failed');
      assertUpdateTree(before, await scanUpdateTree(configured));
      await rm(working, { recursive: true, force: true });
      await cp(configured, working, { recursive: true, verbatimSymlinks: true });
    }
    const baseline = [...before].map(([path, item]) => [path, { mode: item.mode, blob: item.blob }]);
    let frozen;
    if (prepare) frozen = await prepare(working, targetRoot, target.practiceVersion, baseline);
    else {
      const manifest = join(temp, 'baseline.json'); await writeFile(manifest, JSON.stringify(baseline));
      const r = await run(process.execPath, [join(targetRoot, 'scripts/web-update-worker.mjs'), '--prepare-internal',
        working, targetRoot, target.practiceVersion, manifest], { signal, env: trustedEnv(), maxBytes: 2 * 1024 * 1024 });
      if (r.exit !== 0) fail('update_transform_failed');
      frozen = JSON.parse(r.stdout);
    }
    // Freeze privately before untrusted check execution. Only these bytes reach output.
    frozen = structuredClone(frozen);
    const expected = new Map(before);
    for (const file of frozen.files) expected.set(file.path, file.after === null ? null : {
      mode: file.after.mode, blob: blobOf(Buffer.from(file.after.content, 'base64')) });
    await mkdir(checked);
    const candidate = await containerRun({ source: working, destination: checked, container,
      commands: [{ key: 'updated', command: check }], env, expected, signal });
    containerIds.push(candidate.containerId); checks.updated = candidate.checks.updated;
    assertUpdateTree(expected, await scanUpdateTree(checked));
    if (checks.updated?.exit !== 0) {
      await mkdir(baseChecked);
      const baseResult = await containerRun({ source: original, destination: baseChecked, container,
        commands: [...(setup ? [{ key: 'setup', command: setup }] : []), { key: 'base', command: check }], env, expected: before, signal });
      containerIds.push(baseResult.containerId);
      checks.baseSetup = baseResult.checks.setup ?? null;
      checks.base = baseResult.checks.base ?? null;
      assertUpdateTree(before, await scanUpdateTree(baseChecked));
    }
    return validateUpdateOutput({ schema: 1, base, target, ...frozen, checks,
      coverage: { complete: true, gaps: [] }, cleanup: { state: 'verified', containerIds } });
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export async function runUpdateWorker(options, { transport = createWorkerTransport(options), now = Date.now, monotonic = () => performance.now(),
  prepare = prepareIsolatedUpdate, heartbeatMs = 10000, signal = new AbortController().signal } = {}) {
  const abort = new AbortController(), combined = AbortSignal.any([signal, abort.signal]);
  let deadline = monotonic() + 60 * 60_000, lease = deadline, wallDeadline = now() + 60 * 60_000, timer, beat, beatStop;
  const nonce = randomBytes(32).toString('hex');
  const base = { operationId: options.operationId, nonce, jobName: 'web-worker' };
  let sequence = 0;
  const arm = () => { clearTimeout(timer); const ms = Math.min(deadline - 15000, lease) - monotonic();
    if (ms <= 0) abort.abort(); else timer = setTimeout(() => abort.abort(), ms); };
  const call = async (stage, body) => {
    if (combined.aborted) fail('update_worker_stopped');
    return transport(stage, body, combined);
  };
  const refresh = value => {
    if (!Number.isSafeInteger(value) || value <= now() || value > wallDeadline) fail('update_lease_invalid');
    lease = monotonic() + value - now(); arm();
  };
  arm();
  try {
    if (!/^[a-f0-9]{64}$/.test(options.operationId) || options.runAttempt !== '1') fail('update_worker_identity_invalid');
    let claim;
    try { claim = await call('claim', base); } catch { claim = await call('claim', base); }
    if (claim.adapter !== 'update-preparation-v1' || !Number.isSafeInteger(claim.fence) || claim.fence < 1
      || !Number.isSafeInteger(claim.jobId) || claim.jobId < 1 || claim.checkoutSha !== options.sha
      || claim.workflowSha !== options.workflowSha || !Number.isSafeInteger(claim.deadline)
      || claim.deadline > wallDeadline || claim.deadline <= now()) fail('update_claim_invalid');
    wallDeadline = claim.deadline; deadline = Math.min(deadline, monotonic() + claim.deadline - now()); refresh(claim.leaseExpiresAt);
    if (claim.preparation?.base?.commit !== options.sha) fail('update_source_changed');
    const held = { ...base, fence: claim.fence, jobId: claim.jobId };
    const begin = await call('begin', held);
    if (begin.granted !== true || begin.fence !== claim.fence || begin.jobId !== claim.jobId || begin.deadline !== wallDeadline) fail('update_begin_uncertain');
    refresh(begin.leaseExpiresAt);
    beatStop = new AbortController();
    beat = (async () => {
      try {
        while (!combined.aborted) {
          await sleep(heartbeatMs, undefined, { signal: AbortSignal.any([combined, beatStop.signal]) });
          const value = await call('heartbeat', { ...held, sequence: ++sequence });
          if (value.continue !== true) fail('update_authority_lost');
          refresh(value.leaseExpiresAt);
        }
      } catch { if (!beatStop.signal.aborted) abort.abort(); }
    })();
    if (combined.aborted) fail('update_worker_stopped');
    const output = await prepare({ preparation: claim.preparation, projectRoot: options.projectRoot,
      targetRoot: options.targetRoot, signal: combined });
    const validated = validateUpdateOutput(output);
    const receipt = await call('update-output', { ...held, output: validated });
    if (receipt.accepted !== true || receipt.digest !== patchDigest(validated)) fail('update_output_uncertain');
    beatStop.abort(); await beat;
    const result = { state: validated.checks.updated.exit === 0 ? 'succeeded' : 'failed', exitCode: validated.checks.updated.exit };
    const completed = await call('complete', { ...held, sequence: ++sequence, result });
    if (completed.accepted !== true) fail('update_completion_uncertain');
    return result;
  } catch { return { state: combined.aborted ? 'cancelled' : 'failed', exitCode: null }; }
  finally { abort.abort(); beatStop?.abort(); clearTimeout(timer); if (beat) await beat; }
}

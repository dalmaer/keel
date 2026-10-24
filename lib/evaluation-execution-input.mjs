import { isAbsolute, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { checkEvaluation as check, fields, evaluationId, fingerprint, byteDigest } from './evaluation-records.mjs';
import { safePath } from './session-ledger-io.mjs';
import { inspectBudgetTarget, inspectBudget } from './validation-budget.mjs';
import { exportSource, validateFiles, filePath } from './evaluation-artifacts.mjs';
import { controllerIdentity } from './evaluation-provenance.mjs';
import { evaluationBytes } from './evaluation-ledger.mjs';
import { DOCKER_POLICY, preflightDocker } from './evaluation-docker.mjs';
export function argv(value) {
  check(Array.isArray(value) && value.length >= 2 && value.length <= 32 && value[0] === 'node'
    && value.every(s => typeof s === 'string' && s.length <= 4096 && !s.includes('\0')), 'only explicit node file argv supported');
  check(value[1].startsWith('/work/'), 'node script must be an absolute delivered file'); filePath(value[1].slice(6));
}
export function acceptanceDriver(material) {
  let driver; try { driver = JSON.parse(material.content); } catch { check(false, 'stdio-v1 JSON acceptance required'); }
  fields(driver, ['schemaVersion', 'driver', 'checks']);
  check(driver.schemaVersion === 1 && driver.driver === 'stdio-v1' && Array.isArray(driver.checks) && driver.checks.length > 0 && driver.checks.length <= 8, 'unsupported acceptance driver');
  const ids = new Set();
  for (const c of driver.checks) {
    fields(c, ['id', 'argv', 'stdin', 'stdout', 'exitCode']); argv(c.argv);
    check(evaluationId(c.id) && !ids.has(c.id), 'duplicate or invalid check id'); ids.add(c.id);
    check(typeof c.stdin === 'string' && Buffer.byteLength(c.stdin) <= 16384 && typeof c.stdout === 'string' && Buffer.byteLength(c.stdout) <= 16384
      && Number.isInteger(c.exitCode) && c.exitCode >= 0 && c.exitCode <= 125, 'invalid check bounds');
  }
  return driver;
}
export async function executionInput(options, ledger, supplied) {
  const preparationStarted = Date.now();
  const path = options.execution;
  check(isAbsolute(path ?? '') && resolve(path) === path && await safePath(path, false), 'absolute regular execution request required');
  const raw = supplied ? Buffer.from(JSON.stringify(supplied)) : await evaluationBytes(path, 65536), requestHash = byteDigest(raw);
  let request; try { request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { check(false, 'invalid execution JSON'); }
  fields(request, ['schemaVersion', 'pairId', 'arm', 'repository', 'sourcePaths', 'builderArgv', 'admission']);
  check(request.schemaVersion === 1 && evaluationId(request.pairId) && ['baseline', 'candidate'].includes(request.arm), 'invalid slot'); argv(request.builderArgv);
  check(isAbsolute(request.repository) && await realpath(request.repository) === request.repository, 'canonical repository required');
  const a = request.admission; fields(a, ['stateDir', 'manifest', 'capacity', 'weight', 'repo']);
  check(isAbsolute(a.manifest) && await safePath(a.manifest, false) && Number.isInteger(a.capacity) && a.capacity >= 1 && a.capacity <= 128
    && Number.isInteger(a.weight) && a.weight >= 1 && a.weight <= a.capacity, 'invalid admission policy');
  const b = ledger.plan.bundle, comparison = b.comparison;
  check(a.repo === comparison.repository, 'admission repository differs from comparison');
  const pair = comparison.pairs.find(p => p.id === request.pairId); check(pair, 'unplanned pair');
  const task = b.cases.find(c => c.id === pair.case.id), config = b.configurations.find(c => c.id === comparison[request.arm].id);
  const preparationDeadline = preparationStarted + task.limits.minutes * 60000;
  const admissionBytes = await evaluationBytes(a.manifest, 65536);
  const target = await inspectBudgetTarget({ manifest: a.manifest, root: request.repository, repo: a.repo, deadline: preparationDeadline });
  check(byteDigest(admissionBytes) === byteDigest(await evaluationBytes(a.manifest, 65536)), 'admission manifest changed during inspection');
  const host = await inspectBudget({ stateDir: a.stateDir, capacity: a.capacity, targetRoot: request.repository });
  check(!host.coordinationBusy, 'host coordination busy');
  check(config.provider === 'offline' && config.runtime.name === 'scripted-node-v1', 'unsupported offline provider/runtime');
  check(JSON.stringify(task.allowlist.tools) === JSON.stringify(['pinned-image-tools']), 'offline adapter requires pinned-image-tools authority');
  check(task.allowlist.network.length === 0 && task.prerequisites.length === 0, 'offline network/prerequisites unsupported');
  check(fingerprint(task.environment) === fingerprint(config.environment), 'case/configuration environment mismatch');
  check(task.limits.currencyUsd === null && comparison.allowance.currencyUsd === null, 'offline adapter grants no currency entitlement');
  const driver = acceptanceDriver(b.materials.find(m => m.id === task.acceptanceManifest.id));
  check(task.limits.timeoutSeconds <= 600 && task.limits.timeoutSeconds + (driver.checks.length + 1) * DOCKER_POLICY.cleanupSeconds <= task.limits.minutes * 60, 'trial total including cleanup exceeds minute ceiling');
  const source = exportSource(request.repository, task.startingCommit, request.sourcePaths, { deadline: preparationDeadline });
  const files = new Map(source.filter(f => !config.exclusions.includes(f.path)).map(f => [f.path, f]));
  const privateHashes = new Set(b.cases.map(c => byteDigest(b.materials.find(m => m.id === c.acceptanceManifest.id).content)));
  const protectedPaths = ['requirements.json'];
  for (const entry of [...config.context, ...config.overlays]) {
    filePath(entry.path); check(!config.exclusions.includes(entry.path) && entry.path !== 'requirements.json', 'context/exclusion conflict');
    const material = b.materials.find(m => m.id === entry.material.id);
    check(!privateHashes.has(byteDigest(material.content)), 'private checks cannot be delivered');
    files.set(entry.path, { path: entry.path, mode: '100644', base64: Buffer.from(material.content).toString('base64') }); protectedPaths.push(entry.path);
  }
  check(!files.has('requirements.json'), 'reserved requirements path');
  files.set('requirements.json', { path: 'requirements.json', mode: '100644', base64: Buffer.from(JSON.stringify({ publicBrief: task.publicBrief, requirements: task.requirements })).toString('base64') });
  const delivered = validateFiles([...files.values()]);
  check(delivered.every(f => !privateHashes.has(byteDigest(Buffer.from(f.base64, 'base64')))), 'source contains private checks');
  for (const command of [request.builderArgv, ...driver.checks.map(c => c.argv)]) check(files.has(command[1].slice(6)), 'command script not delivered');
  for (const c of driver.checks) protectedPaths.push(c.argv[1].slice(6));
  const image = await preflightDocker(task.environment, { deadline: preparationDeadline });
  const input = { controller: await controllerIdentity(), request, requestPath: path, requestHash, planDigest: ledger.plan.digest, target, admissionManifestHash: byteDigest(admissionBytes),
    sourceDigest: fingerprint(source), delivered, deliveredDigest: fingerprint(delivered), taskDigest: task.digest, configurationDigest: config.digest,
    budgetCoverage: 'preparation-plus-admitted-slot-v1', checkManifestDigest: task.acceptanceManifest.digest, image, policy: DOCKER_POLICY, destination: ledger.plan.destination };
  const preparationMs = Date.now() - preparationStarted;
  check(preparationMs < task.limits.minutes * 60000, 'preparation exhausted trial allowance');
  return { preparationMs, input, digest: fingerprint(input), task, config, driver, protectedPaths, target };
}

// Runtime durations are observations, never part of the stable approval digest.
export function admittedDeadline(prepared, approvedAt = Date.now()) {
  check(Number.isFinite(prepared.preparationMs) && prepared.preparationMs >= 0, 'missing preparation coverage');
  const total = prepared.task.limits.minutes * 60000;
  check(prepared.preparationMs < total, 'preparation exhausted trial allowance');
  return approvedAt + total - prepared.preparationMs;
}

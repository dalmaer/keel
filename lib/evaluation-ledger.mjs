// Frozen schema-2 extension of session trials. No executor or budget reservation.
import { lstat, mkdir, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { inspectWorkspace } from './web/workspace.mjs';
import { safePath, readJson, store, ledgerLock } from './session-ledger-io.mjs';
import { EVALUATION_BYTES, validateEvaluationBundle, checkEvaluation as check, evaluationId, byteDigest, fingerprint, fields } from './evaluation-records.mjs';

async function bytes(path, max) {
  check(isAbsolute(path) && await safePath(path, false), 'explicit regular input required');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    check(stat.isFile() && stat.nlink === 1 && stat.size <= max, 'unsafe or oversized input');
    const result = Buffer.alloc(max + 1); let size = 0;
    while (size < result.length) { const r = await handle.read(result, size, result.length - size, size); if (!r.bytesRead) break; size += r.bytesRead; }
    check(size <= max, 'input exceeds byte bound'); return result.subarray(0, size);
  } finally { await handle.close(); }
}
async function privatePath(path, directory = true) {
  if (!await safePath(path, directory)) return false;
  const stat = await lstat(path);
  check((stat.mode & 0o077) === 0 && (directory || stat.nlink === 1), 'ledger must be private and unlinked'); return true;
}
async function scope(options) {
  check(isAbsolute(options.manifest ?? '') && isAbsolute(options.state ?? ''), 'explicit absolute workspace paths required');
  await safePath(options.manifest, false); await safePath(options.state);
  const before = await bytes(options.manifest, EVALUATION_BYTES);
  const workspace = await inspectWorkspace(options);
  check(byteDigest(before) === byteDigest(await bytes(options.manifest, EVALUATION_BYTES)), 'manifest changed during inspection');
  check(workspace.state === 'ready', 'initialize workspace separately first');
  return { paths: workspace.paths, workspace: workspace.workspace, projects: workspace.projects, manifestHash: byteDigest(before) };
}
function authorize(bound, bundle) {
  check([bound.workspace.repo, ...bound.projects.map(p => p.repo)].some(repo => repo.toLowerCase() === bundle.comparison.repository.toLowerCase()), 'comparison repository is not authorized by manifest');
}
function frozenLedger(plan, createdAt = new Date().toISOString()) {
  const body = { schemaVersion: 2, kind: 'harness', generation: 1, createdAt, events: [{ action: 'freeze', generation: 1, digest: plan.digest, at: createdAt }], plan };
  return { ...body, digest: fingerprint(body) };
}
function attachmentMaterials(plan) {
  return new Map(plan.bundle.materials.map(m => [byteDigest(Buffer.from(m.content)), m.content]));
}
function retainedBytes(plan) {
  // ISO timestamps have fixed width; the actual receipt is the same size.
  return Buffer.byteLength(JSON.stringify(frozenLedger(plan), null, 2) + '\n') + [...attachmentMaterials(plan).values()].reduce((n, s) => n + Buffer.byteLength(s), 0);
}
async function preview(options) {
  const bound = await scope(options), raw = await bytes(options.bundle, EVALUATION_BYTES);
  let bundle; try { bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { check(false, 'invalid UTF-8 JSON bundle'); }
  validateEvaluationBundle(bundle); authorize(bound, bundle);
  const destination = join(bound.paths.state, 'session-trials', bundle.comparison.id);
  const input = { binding: bound, bundlePath: resolve(options.bundle), bundleHash: byteDigest(raw), planHash: fingerprint(bundle), destination };
  const plan = { schemaVersion: 2, kind: 'harness', status: 'draft', preview: true, digest: fingerprint(input), ...input, bundle, budgetReserved: false, acceptance: 'unknown' };
  check(retainedBytes(plan) <= bundle.comparison.retention.maxBytes, 'retention byte limit exhausted');
  return plan;
}
async function readFrozen(dir, bound, experiment) {
  check(await privatePath(dir), 'experiment missing');
  const entries = await readdir(dir);
  check(entries.length === 2 && entries.includes('state.json') && entries.includes('attachments'), 'partial or foreign experiment state');
  check(await privatePath(join(dir, 'state.json'), false), 'missing ledger');
  const ledger = await readJson(join(dir, 'state.json'), EVALUATION_BYTES * 4);
  fields(ledger, ['schemaVersion', 'kind', 'generation', 'createdAt', 'events', 'plan', 'digest']);
  check(ledger.schemaVersion === 2 && ledger.kind === 'harness' && ledger.generation === 1 && typeof ledger.createdAt === 'string' && Number.isFinite(Date.parse(ledger.createdAt)) && new Date(ledger.createdAt).toISOString() === ledger.createdAt, 'corrupt frozen ledger');
  const { digest, ...body } = ledger; check(fingerprint(body) === digest, 'ledger hash mismatch');
  const p = ledger.plan;
  fields(p, ['schemaVersion', 'kind', 'status', 'preview', 'digest', 'binding', 'bundlePath', 'bundleHash', 'planHash', 'destination', 'bundle', 'budgetReserved', 'acceptance']);
  validateEvaluationBundle(p.bundle); authorize(bound, p.bundle);
  check(p.schemaVersion === 2 && p.kind === 'harness' && p.status === 'draft' && p.preview === true && p.budgetReserved === false && p.acceptance === 'unknown' && p.bundle.comparison.id === experiment && fingerprint(p.bundle) === p.planHash && p.destination === dir, 'corrupt frozen plan');
  const input = Object.fromEntries(['binding', 'bundlePath', 'bundleHash', 'planHash', 'destination'].map(k => [k, p[k]]));
  check(fingerprint(input) === p.digest && fingerprint(p.binding) === fingerprint(bound), 'workspace binding changed');
  check(JSON.stringify(ledger.events) === JSON.stringify([{ action: 'freeze', generation: 1, digest: p.digest, at: ledger.createdAt }]), 'invalid frozen events');
  const attachments = join(dir, 'attachments'); check(await privatePath(attachments), 'missing attachments');
  const expected = [...new Set(p.bundle.materials.map(m => byteDigest(Buffer.from(m.content))))].sort();
  check(JSON.stringify((await readdir(attachments)).sort()) === JSON.stringify(expected), 'partial or foreign attachments');
  for (const name of expected) {
    const path = join(attachments, name); check(await privatePath(path, false), 'missing attachment');
    check(byteDigest(await bytes(path, EVALUATION_BYTES)) === name, 'attachment hash mismatch');
  }
  return ledger;
}
export async function evaluations(options) {
  const { action = 'plan', yes = false, digest, experiment } = options;
  check(['plan', 'freeze', 'inspect'].includes(action), 'operation unavailable; only plan, freeze and inspect are implemented');
  check(action === 'freeze' || (!yes && digest === undefined), 'approval only applies to freeze');
  check(digest === undefined || yes, 'digest requires --yes');
  if (action === 'inspect') {
    check(evaluationId(experiment) && options.bundle === undefined, 'inspect needs experiment only');
    const bound = await scope(options), home = join(bound.paths.state, 'session-trials');
    check(await privatePath(home), 'ledger missing'); check(!await safePath(join(home, '.lock'), false), 'storage locked');
    const ledger = await readFrozen(join(home, experiment), bound, experiment);
    return { action, preview: false, status: 'frozen', receipt: ledger };
  }
  check(experiment === undefined && typeof options.bundle === 'string', 'plan/freeze needs bundle only');
  const plan = await preview(options);
  if (action === 'plan' || !yes) return { action, ...plan };
  check(digest === plan.digest, 'stale or missing preview digest');
  const home = join(plan.binding.paths.state, 'session-trials');
  if (!await privatePath(home)) await mkdir(home, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  await privatePath(home);
  const release = await ledgerLock(home);
  try {
    const current = await preview(options);
    check(current.digest === plan.digest, 'inputs or ownership changed before mutation');
    const entries = await readdir(home); check(entries.length <= 1001 && entries.every(e => e === '.lock' || evaluationId(e)), 'foreign or exhausted session storage');
    const dir = plan.destination;
    if (await privatePath(dir)) {
      const ledger = await readFrozen(dir, plan.binding, plan.bundle.comparison.id);
      check(ledger.plan.digest === plan.digest, 'comparison identity already frozen with different inputs');
      return { action, preview: false, status: 'frozen', recovered: true, receipt: ledger };
    }
    check(entries.length < 1001, 'experiment limit exhausted');
    // Directory creation is durable intent. Failure leaves it for inspection, never overwrite.
    await mkdir(dir, { mode: 0o700 });
    const attachments = join(dir, 'attachments'); await mkdir(attachments, { mode: 0o700 });
    const materials = attachmentMaterials(plan);
    for (const [hash, content] of materials) {
      const file = await open(join(attachments, hash), 'wx', 0o600);
      try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    }
    const attachmentDir = await open(attachments, constants.O_RDONLY); try { await attachmentDir.sync(); } finally { await attachmentDir.close(); }
    const ledger = frozenLedger(plan);
    await store(join(dir, 'state.json'), ledger);
    return { action, preview: false, status: 'frozen', recovered: false, receipt: ledger };
  } finally { await release(); }
}
export async function evaluationsCommand({ args, appRoot, cwd }) {
  const [action, ...rest] = args, opts = {}, seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]; check(['--manifest', '--state', '--bundle', '--experiment', '--digest', '--yes', '--json'].includes(flag) && !seen.has(flag), 'unknown or repeated option'); seen.add(flag);
    if (['--yes', '--json'].includes(flag)) opts[flag.slice(2)] = true;
    else { check(rest[i + 1] && !rest[i + 1].startsWith('--'), 'option requires value'); opts[flag.slice(2)] = rest[++i]; }
  }
  if (opts.bundle) opts.bundle = resolve(cwd, opts.bundle);
  const data = await evaluations({ ...opts, action, appRoot });
  return { data, text: JSON.stringify(data, null, 2), exitCode: action === 'freeze' && !opts.yes ? 3 : 0 };
}

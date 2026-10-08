// Optional projection of measurements already made by the existing night.
// No improve, gate, model or retro is invoked here. Credentials stay with isocan.
import { readFile, mkdir, writeFile, mkdtemp, realpath, lstat, open, rm, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const result = data => {
  const payload = { schema: 1, operation: 'night', changes: [], coverage: [], warnings: [], exitCode: 0, ...data };
  return { data: payload, text: `canvas night: ${payload.error ?? payload.reason ?? 'local artifacts saved'}`, exitCode: payload.exitCode };
};

const DAY = 86400000;
const MAX_RECOVERY = 64 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stateError = () => { throw Object.assign(new Error('Missing, unsafe or mismatched canvas recovery state; restore the recorded manifest, never reconnect'), { exitCode: 1 }); };
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(k => !allowed.includes(k))) stateError();
}
const ident = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(v);
const stamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const historyName = /^[a-f0-9]{64}-[a-f0-9]{64}\.json$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function historyEntry(e) {
  keys(e, ['path', 'sourceDigest', 'snapshotDigest', 'generatedAt', 'fileHash']);
  if (!historyName.test(e.path) || !stamp(e.generatedAt) || !digest(e.sourceDigest) || !digest(e.snapshotDigest) || !digest(e.fileHash)) stateError();
}

function bindingOf(config) {
  const b = config.canvas;
  if (b?.provider !== 'isocan' || !ident(b.projectKey) || !ident(b.canvasId) || !ident(b.actorId) || b.privacy !== 'summary' || b.mode !== 'immutable' || b.audience !== 'owner-only') stateError();
  let u; try { u = new URL(b.home); } catch { stateError(); }
  if (!['http:', 'https:'].includes(u.protocol) || u.origin !== b.home || u.username || u.password) stateError();
  return { provider: b.provider, projectKey: b.projectKey, home: b.home, canvasId: b.canvasId,
    actorId: b.actorId, audience: b.audience, privacy: b.privacy, mode: b.mode, spaceId: b.spaceId ?? null };
}
const sameBinding = (a, b) => Object.keys(a).length === Object.keys(b ?? {}).length && Object.entries(a).every(([k, v]) => b[k] === v);

// Strict allowlist: export the sync journal, never an isocan home, config,
// source files, locks, environment or arbitrary neighbouring cache files.
function manifestOf(m, binding) {
  keys(m, ['schema', 'projectKey', 'home', 'canvasId', 'items', 'groups', 'receipts', 'pending', 'lastSuccess', 'history', 'run']);
  if (m.schema !== 1 || m.projectKey !== binding.projectKey || m.home !== binding.home || m.canvasId !== binding.canvasId || !object(m.items) || !object(m.groups) || !Array.isArray(m.receipts) || m.receipts.length > 100000) stateError();
  const receipt = r => {
    keys(r, ['operationId', 'kind', 'state', 'plan', 'at', 'canvasId', 'key', 'title', 'note', 'hash', 'sourceHash', 'visualHash', 'itemId', 'versionId', 'acknowledgedAt']);
    if (!ident(r.operationId) || !['attach', 'create-canvas', 'add', 'group'].includes(r.kind) || !['pending', 'acknowledged'].includes(r.state) || !stamp(r.at)) stateError();
    for (const k of ['itemId', 'versionId', 'canvasId']) if (r[k] !== undefined && !ident(r[k])) stateError();
    for (const k of ['hash', 'sourceHash', 'visualHash']) if (r[k] != null && !digest(r[k])) stateError();
    if (r.acknowledgedAt !== undefined && !stamp(r.acknowledgedAt)) stateError();
    for (const k of ['key', 'title', 'note']) if (r[k] !== undefined && (typeof r[k] !== 'string' || r[k].length > 2000)) stateError();
    if (r.plan !== undefined) {
      keys(r.plan, ['access', 'action', 'home', 'canvasId', 'spaceId', 'audience', 'actorId', 'title']);
      if (r.plan.home !== binding.home || r.plan.actorId !== binding.actorId || r.plan.audience !== binding.audience || (r.plan.canvasId !== null && r.plan.canvasId !== binding.canvasId)) stateError();
      keys(r.plan.access, ['owner', 'audience', 'spaceId']);
      if (r.plan.access.owner !== binding.actorId || r.plan.access.audience !== binding.audience) stateError();
    }
  };
  m.receipts.forEach(receipt);
  for (const [key, r] of [...Object.entries(m.items), ...Object.entries(m.groups)]) {
    receipt(r); if (r.key !== key || r.state !== 'acknowledged' || !ident(r.itemId) || !ident(r.versionId)) stateError();
  }
  if (m.pending !== null) receipt(m.pending);
  if (m.lastSuccess !== undefined) {
    keys(m.lastSuccess, ['at', 'items', 'coverage', 'snapshot']);
    if (!stamp(m.lastSuccess.at) || !Array.isArray(m.lastSuccess.items) || !Array.isArray(m.lastSuccess.coverage)) stateError();
    for (const i of m.lastSuccess.items) { keys(i, ['key', 'itemId', 'hash']); if (!ident(i.itemId) || !digest(i.hash) || typeof i.key !== 'string') stateError(); }
    for (const c of m.lastSuccess.coverage) keys(c, ['source', 'status', 'reason', 'observedAt', 'latestSampleAt', 'sampleWindow', 'expectedCadence']);
    if (m.lastSuccess.snapshot) historyEntry(m.lastSuccess.snapshot);
  }
  if (m.history !== undefined) {
    if (!Array.isArray(m.history) || m.history.length > 1000) stateError();
    m.history.forEach(historyEntry);
  }
  if (m.run !== undefined) {
    keys(m.run, ['snapshotHash', 'generatedAt', 'sourceDigest']);
    if (!digest(m.run.snapshotHash) || !digest(m.run.sourceDigest) || !stamp(m.run.generatedAt)) stateError();
  }
  return m;
}
async function safeParts(path) {
  let current = resolve(path);
  for (;;) {
    try { if ((await lstat(current)).isSymbolicLink()) stateError(); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const next = resolve(current, '..'); if (next === current) break; current = next;
  }
}
async function boundedJSON(path) {
  await safeParts(path);
  const info = await lstat(path);
  if (!info.isFile() || info.size > MAX_RECOVERY) stateError();
  return JSON.parse(await readFile(path, 'utf8'));
}
async function currentManifest(root, binding) {
  const path = join(root, '.keel/canvas/manifest.json');
  try { return manifestOf(await boundedJSON(path), binding); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function journalFiles(root, manifest, supplied) {
  const files = {};
  if (supplied !== undefined && (!object(supplied) || Object.keys(supplied).length !== (manifest.history ?? []).length)) stateError();
  const { validateSnapshot } = await import('./canvas-snapshot.mjs');
  for (const entry of manifest.history ?? []) {
    const file = join(root, '.keel/canvas/history', entry.path);
    let bytes;
    if (supplied !== undefined) bytes = supplied[entry.path];
    else { await safeParts(file); if ((await lstat(file)).size > 8 * 1024 * 1024) stateError(); bytes = await readFile(file, 'utf8'); }
    if (typeof bytes !== 'string' || Buffer.byteLength(bytes) > 8 * 1024 * 1024 || hash(bytes) !== entry.fileHash) stateError();
    const snapshot = validateSnapshot(JSON.parse(bytes));
    if (snapshot.project.key !== manifest.projectKey || snapshot.generatedAt !== entry.generatedAt) stateError();
    files[entry.path] = bytes;
  }
  return files;
}
async function restore(root, manifest, files) {
  const dir = join(root, '.keel/canvas');
  await safeParts(dir);
  await mkdir(dir, { recursive: true });
  const lock = await open(join(dir, 'sync.lock'), 'wx', 0o600);
  const created = [];
  try {
    if (Object.keys(files).length) {
      await safeParts(join(dir, 'history'));
      await mkdir(join(dir, 'history'), { recursive: true });
      for (const [name, bytes] of Object.entries(files)) {
        const path = join(dir, 'history', name);
        const f = await open(path, 'wx', 0o600); created.push(path);
        try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); }
      }
    }
    // Never replace local state, even with an apparently newer artifact.
    const file = await open(join(dir, 'manifest.json'), 'wx', 0o600);
    created.push(join(dir, 'manifest.json'));
    try { await file.writeFile(`${JSON.stringify(manifest, null, 2)}\n`); await file.sync(); }
    finally { await file.close(); }
    await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx', mode: 0o600 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    const handle = await open(dir, 'r'); try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) { for (const path of created) await rm(path, { force: true }); throw error; }
  finally { await lock.close(); await rm(join(dir, 'sync.lock')); }
}
async function historyOf(input, binding, at) {
  if (!Array.isArray(input) || input.length > 90) stateError();
  const { validateSnapshot } = await import('./canvas-snapshot.mjs');
  const days = new Map();
  for (const row of input) {
    const s = validateSnapshot(row), time = Date.parse(s.generatedAt);
    if (s.project.key !== binding.projectKey || time >= at) stateError();
    if (time < at - 90 * DAY) continue;
    const day = s.generatedAt.slice(0, 10), prior = days.get(day);
    if (!prior || s.generatedAt > prior.generatedAt) days.set(day, s);
  }
  return [...days.values()].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
}

async function saveRecovery(directory, root, binding, history, snapshot, at, env) {
  const manifest = await currentManifest(root, binding);
  if (!manifest) stateError();
  const days = new Map(history.map(s => [s.generatedAt.slice(0, 10), s]));
  if (snapshot) days.set(snapshot.generatedAt.slice(0, 10), snapshot);
  const retained = [...days.values()].filter(s => Date.parse(s.generatedAt) >= at - 90 * DAY).sort((a, b) => a.generatedAt.localeCompare(b.generatedAt)).slice(-90);
  const provenance = env.GITHUB_RUN_ID ? { repo: env.GITHUB_REPOSITORY, workflow: '.github/workflows/keel-night.yml',
    runId: String(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT), headSha: env.GITHUB_SHA } : null;
  if (provenance && (!/^[\w.-]+\/[\w.-]+$/.test(provenance.repo ?? '') || !/^\d+$/.test(provenance.runId) || !Number.isSafeInteger(provenance.attempt) || provenance.attempt < 1 || !/^[a-f0-9]{40}$/.test(provenance.headSha ?? ''))) stateError();
  const files = await journalFiles(root, manifest);
  const data = { schema: 1, binding, manifest, files, provenance, savedAt: new Date(at).toISOString(), history: retained,
    retention: { days: 90, maxSamples: 90, granularity: 'latest observation per UTC day' } };
  const bytes = `${JSON.stringify(data)}\n`;
  if (Buffer.byteLength(bytes) > MAX_RECOVERY) stateError(); // never silently drop receipts/history
  const tmp = join(directory, `recovery-${randomUUID()}.tmp`);
  const handle = await open(tmp, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(tmp, join(directory, 'recovery.json'));
}

// Never copy free-form instrument details, commands, proposal text or errors.
function measured(report) {
  if (!report || !Array.isArray(report.measures) || !/^\d{4}-\d{2}-\d{2}$/.test(report.date ?? '')) {
    throw Object.assign(new Error('night requires the existing dated improve JSON report'), { exitCode: 2 });
  }
  return { date: report.date, measures: report.measures.filter(m =>
    m && /^[a-z][a-z0-9_]{0,80}$/.test(m.id) && ['ok', 'outside', 'n/a', 'broken'].includes(m.state)
  ).map(m => ({ id: m.id, state: m.state,
    value: ['ok', 'outside'].includes(m.state) && Number.isFinite(m.value) ? m.value : null,
    bound: Number.isFinite(m.bound) ? m.bound : null,
    better: ['higher', 'lower'].includes(m.better) ? m.better : null,
    unit: ['%', '0/1', 'tests', 'ms', 'phases', 'findings', 'escapes', 'days', 'lessons', 'files', 'PRs', 'comments', 'issues', 'notes', 'packages', 'projects', 'proposals', 'runs', 'walks'].includes(m.unit) ? m.unit : null,
  })) };
}

/** report is an already parsed improve result (or its JSON filename).
 * Dependencies are snapshot({root,report,env}), render({snapshot,output}),
 * sync({root,snapshot,env,yes}); loaded lazily so disabled means no calls.
 */
export async function night({ root, report, env = process.env, yes = false, output = env.KEEL_CANVAS_OUTPUT, now, ...deps }) {
  let directory, stage = 'configuration', recovery, captured;
  try {
    root = await realpath(root);
    const config = JSON.parse(await readFile(join(root, '.keel/keel.json'), 'utf8'));
    if (config.canvas?.enabled !== true || config.canvas?.cadence !== 'nightly') {
      return result({ skipped: true, reason: 'canvas nightly publishing is disabled' });
    }
    stage = 'report';
    const supplied = typeof report === 'string' ? JSON.parse(await readFile(report, 'utf8')) : report;
    const reading = measured(supplied);
    // A temp directory by default: no authored files, cache staging or ignore edits.
    directory = output ? resolve(output) : await realpath(await mkdtemp(join(tmpdir(), 'keel-canvas-night-')));
    await mkdir(directory, { recursive: true });
    directory = await realpath(directory);
    let history = [];
    if (env.KEEL_CANVAS_PERSISTENCE === 'artifact-v1') {
      stage = 'recovery';
      const binding = bindingOf(config), at = new Date(now ?? Date.now()).getTime();
      if (!Number.isFinite(at)) stateError();
      const local = await currentManifest(root, binding);
      if (env.KEEL_CANVAS_RECOVERY) {
        const bundle = await boundedJSON(env.KEEL_CANVAS_RECOVERY);
        keys(bundle, ['schema', 'binding', 'manifest', 'files', 'provenance', 'savedAt', 'history', 'retention']);
        if (bundle.schema !== 1 || !sameBinding(binding, bundle.binding) || !stamp(bundle.savedAt) || Date.parse(bundle.savedAt) >= at || Date.parse(bundle.savedAt) < at - 90 * DAY) stateError();
        const manifest = manifestOf(bundle.manifest, binding);
        const files = await journalFiles(root, manifest, bundle.files ?? {});
        history = await historyOf(bundle.history, binding, at);
        if (local && JSON.stringify(local) !== JSON.stringify(manifest)) stateError();
        if (!local && yes) await restore(root, manifest, files);
      }
      // No empty journal fabrication: first CI night needs the owner-approved
      // connection receipt provisioned by setup. Later nights restore it.
      if (!await currentManifest(root, binding)) stateError();
      await journalFiles(root, await currentManifest(root, binding));
      recovery = { binding, history, at };
    }
    stage = 'snapshot';
    const collect = deps.snapshot ?? (await import('./canvas-snapshot.mjs')).snapshot;
    const snapshot = await collect({ root, report: reading, env, now, github: false, history });
    captured = snapshot;
    await writeFile(join(directory, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
    stage = 'render';
    const render = deps.render ?? (await import('./canvas-render.mjs')).render;
    await render({ snapshot, output: join(directory, 'render') });
    const base = { output: directory, coverage: snapshot.coverage, warnings: snapshot.warnings ?? [], complete: snapshot.complete ?? false };
    if (!yes) return result({ ...base, reason: 'local artifacts saved; --yes is required to publish', planned: true });
    if (snapshot.revision?.dirty !== false) return result({ ...base, error: 'refusing night publication from a dirty or unknown revision', exitCode: 1 });
    stage = 'sync';
    const sync = deps.sync ?? (await import('./canvas.mjs')).sync;
    const published = await sync({ root, snapshot, env, yes: true });
    const receipt = published.data ?? published;
    await writeFile(join(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    return result({ ...base, sync: receipt, exitCode: published.exitCode ?? receipt.exitCode ?? 1 });
  } catch (error) {
    // Do not persist a transport error body: it may contain credential material.
    return result({ ...(directory ? { output: directory } : {}), error: `canvas night ${stage} failed; local artifacts retained when available`, exitCode: error.exitCode ?? 1 });
  } finally {
    if (recovery) {
      try { await saveRecovery(directory, root, recovery.binding, recovery.history, captured, recovery.at, env); }
      catch {
        return result({ output: directory, error: 'canvas night recovery export failed; retain the local manifest for manual recovery', exitCode: 1 });
      }
    }
  }
}

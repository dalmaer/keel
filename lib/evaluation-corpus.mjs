// Read-only curation and explicit local export. Never starts an evaluation.
import { lstat, realpath, mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkEvaluation as check, evaluationId, byteDigest, fingerprint, sealRecord, EVALUATION_BYTES } from './evaluation-records.mjs';
import { evaluationBytes as bounded } from './evaluation-ledger.mjs';
import { exportSource, validateFiles, ARTIFACT_BYTES, FILE_LIMIT } from './evaluation-artifacts.mjs';
const ROOT = fileURLToPath(new URL('./evaluation-corpus/', import.meta.url));
const json = value => JSON.stringify(value, null, 2) + '\n';
const exists = async path => lstat(path).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
const identity = stat => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode });
export async function corpusCatalog() {
  const bytes = await bounded(join(ROOT, 'catalog.json'), 65536), catalog = JSON.parse(bytes);
  check(catalog.schemaVersion === 1 && catalog.cases.length === 6 && new Set(catalog.cases.map(c => c.id)).size === 6, 'invalid corpus catalog');
  for (const c of catalog.cases) {
    check(evaluationId(c.id) && Array.isArray(c.sources) && c.sources.length >= 1 && c.sources.length <= FILE_LIMIT
      && Array.isArray(c.support) && c.support.length <= 8 && new Set([c.probe, ...c.support]).size === c.support.length + 1, 'invalid corpus inventory bounds');
  }
  return { catalog, catalogDigest: byteDigest(bytes) };
}
export async function corpusDefinition(id) {
  const { catalog, catalogDigest } = await corpusCatalog(), c = catalog.cases.find(c => c.id === id);
  check(c, 'unknown corpus case');
  const materials = [], probes = [], probeProvenance = [];
  for (const name of [c.probe, ...c.support]) {
    check(/^[a-z][a-z0-9-]*\.(mjs|txt|json)$/.test(name), 'invalid corpus probe path');
    const bytes = await bounded(join(ROOT, 'probes', name), 65536), path = 'probes/' + name;
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes), header = catalog.probeHeaders[name];
    if (name.endsWith('.mjs')) check(typeof header === 'string' && header.length > 0 && header.length <= 4096 && header.endsWith('\n') && header.trimEnd().split('\n').every(line => line.startsWith('//')) && raw.startsWith(header), 'probe provenance header changed; review required');
    const content = header ? '// Protected Acme behavior probe. Curator retains source provenance; Apache-2.0.\n' + raw.slice(header.length) : raw;
    const deliveredBytes = Buffer.from(content);
    probeProvenance.push({ path, transformation: header ? 'exact-catalog-header-v1' : 'identity', originalHeader: header ?? null, rawSha256: byteDigest(bytes), deliveredSha256: byteDigest(deliveredBytes) });
    materials.push(sealRecord({ schemaVersion: 2, kind: 'material', id: name.replaceAll('.', '-'), createdAt: catalog.createdAt, mediaType: 'text/plain', content }));
    probes.push({ path, mode: '100644', base64: deliveredBytes.toString('base64') });
  }
  let acceptanceInput = '';
  if (c.acceptanceInput !== undefined) {
    check(/^[a-z][a-z0-9-]*\.json$/.test(c.acceptanceInput), 'invalid private acceptance path');
    acceptanceInput = new TextDecoder('utf-8', { fatal: true }).decode(await bounded(join(ROOT, 'private', c.acceptanceInput), 16384));
  }
  const acceptance = sealRecord({ schemaVersion: 2, kind: 'material', id: c.id + '-acceptance', createdAt: catalog.createdAt, mediaType: 'application/json', content: JSON.stringify({ schemaVersion: 1, driver: 'stdio-v1', checks: [{ id: c.id, argv: ['node', '/work/probes/' + c.probe], stdin: acceptanceInput, stdout: c.stdout, exitCode: 0 }] }) });
  materials.push(acceptance);
  const environment = { image: catalog.image, platform: catalog.platform, dependencyLock: fingerprint(c.sources), installer: fingerprint({ policy: 'pinned-image-tools', probes: probes.map(p => ({ path: p.path, sha256: byteDigest(Buffer.from(p.base64, 'base64')) })) }) };
  const task = sealRecord({ schemaVersion: 2, kind: 'case', id: c.id, createdAt: catalog.createdAt, version: c.version, taskClass: c.taskClass, publicBrief: c.brief, repository: catalog.repository, startingCommit: c.start, environment,
    allowlist: { tools: ['pinned-image-tools'], network: [], paths: c.writable }, prerequisites: [], requirements: c.requirements,
    acceptanceManifest: { kind: acceptance.kind, id: acceptance.id, digest: acceptance.digest }, limits: { timeoutSeconds: 90, minutes: 2, currencyUsd: null },
    provenance: [`${catalog.repository} starting source ${c.start}; ${catalog.license}`], visibility: 'development', exposure: [{ actor: 'public-history', at: catalog.createdAt, reason: 'Public historical development case; known corrected witnesses are scripted machinery, not held-out efficacy.' }] });
  return { catalog, catalogDigest, definition: c, task, materials, probes, acceptance, probeProvenance };
}
export async function inspectCorpus() {
  const { catalog, catalogDigest } = await corpusCatalog();
  const cases = [];
  for (const c of catalog.cases) {
    const d = await corpusDefinition(c.id);
    cases.push({ id: c.id, version: c.version, taskClass: c.taskClass, visibility: 'development', startingCommit: c.start, sources: c.sources, writablePaths: c.writable,
      protectedPaths: d.probes.map(p => p.path), caseDigest: d.task.digest, materialDigests: d.materials.map(m => ({ id: m.id, digest: m.digest })),
      provenance: { repository: catalog.repository, correctedWitness: c.fix, license: catalog.license }, coverageLimits: c.coverageLimits, closure: c.closure });
  }
  return { schemaVersion: 1, action: 'corpus-inspect', readOnly: true, catalogDigest, development: 6, heldOut: 0, cases, limits: { deliveryFiles: FILE_LIMIT, deliveryBytes: ARTIFACT_BYTES, materialBytes: 65536, bundleBytes: EVALUATION_BYTES }, execution: 'not-run', efficacy: 'unavailable' };
}
async function destinationInput(destination) {
  check(typeof destination === 'string' && isAbsolute(destination) && resolve(destination) === destination && destination !== '/', 'absolute canonical destination required');
  const parent = dirname(destination);
  check(await realpath(parent) === parent, 'destination parent must be canonical');
  const stat = await lstat(parent);
  check(stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, 'destination parent must be private and owned');
  check(!await exists(destination), 'destination exists; partial exports are never overwritten or recovered');
  // Match the workspace boundary's ancestor-marker refusal. A Git error is
  // never absence evidence; partial/broken repository markers also refuse.
  let current = parent, depth = 0;
  while (true) {
    check(++depth <= 256, 'destination ancestry exceeds bound');
    const marker = await exists(join(current, '.git'));
    const head = await exists(join(current, 'HEAD'));
    const objects = await exists(join(current, 'objects')), refs = await exists(join(current, 'refs'));
    check(!marker && !head && !(objects && refs), 'destination must be outside Git repositories; repository markers or uncertain bare state found');
    const next = dirname(current); if (next === current) break; current = next;
  }
  return { destination, parent: identity(stat) };
}
export async function prepareCorpusExport({ case: id, repository, destination }) {
  const started = Date.now(), deadline = started + 30000;
  const d = await corpusDefinition(id), { catalog, definition: c } = d;
  check(typeof repository === 'string' && isAbsolute(repository) && await realpath(repository) === repository, 'canonical source repository required');
  const target = await destinationInput(destination);
  const source = exportSource(repository, c.start, c.sources.map(s => s.path), { deadline });
  for (const f of source) {
    const expected = c.sources.find(s => s.path === f.path), bytes = Buffer.from(f.base64, 'base64');
    check(bytes.length === expected.bytes && byteDigest(bytes) === expected.sha256 && createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex') === expected.blob, 'historical source differs from curated inventory');
  }
  if (c.id === 'workspace-command-doc') check(d.materials.find(m => m.id === 'workspace-original-txt').content === Buffer.from(source.find(f => f.path === 'README.md').base64, 'base64').toString('utf8'), 'control baseline differs from historical README');
  const requirements = { path: 'requirements.json', mode: '100644', base64: Buffer.from(JSON.stringify({ publicBrief: d.task.publicBrief, requirements: d.task.requirements })).toString('base64') };
  const witnesses = catalog.cases.map(row => row.fix);
  for (const probe of d.probes) {
    const text = Buffer.from(probe.base64, 'base64').toString('utf8');
    check(!witnesses.some(fix => text.includes(fix) || text.includes(fix.slice(0, 8))), 'corrected witness identity leaked into protected probe');
  }
  const historicalExposure = source.flatMap(f => witnesses.filter(fix => Buffer.from(f.base64, 'base64').toString('utf8').includes(fix.slice(0, 8))).map(fix => ({ path: f.path, correctedWitness: fix, action: 'retained-unmodified-public-history' })));
  const delivery = validateFiles([...source, ...d.probes, requirements]);
  const outputs = delivery.map(f => ({ path: 'builder/' + f.path, bytes: Buffer.from(f.base64, 'base64') }));
  outputs.push({ path: 'evaluator/case.json', bytes: Buffer.from(json(d.task)) }, { path: 'evaluator/materials.json', bytes: Buffer.from(json(d.materials)) },
    { path: 'curator/provenance.json', bytes: Buffer.from(json({ repository: catalog.repository, license: catalog.license, startingCommit: c.start, correctedWitness: c.fix, sources: c.sources, coverageLimits: c.coverageLimits, exposure: 'development', heldOut: 0, witnessPurpose: 'scripted machinery only', probeProvenance: d.probeProvenance, historicalExposure })) });
  const inventory = { schemaVersion: 1, caseId: c.id, catalogDigest: d.catalogDigest, caseDigest: d.task.digest,
    delivery: delivery.map(f => ({ path: f.path, exportPath: 'builder/' + f.path, mode: f.mode, bytes: Buffer.from(f.base64, 'base64').length, sha256: byteDigest(Buffer.from(f.base64, 'base64')), writable: c.writable.includes(f.path), protected: !c.writable.includes(f.path) })),
    sourcePaths: c.sources.map(s => s.path), overlays: d.probes.map((f, i) => ({ path: f.path, material: { kind: 'material', id: d.materials[i].id, digest: d.materials[i].digest } })),
    privateMaterials: [d.acceptance.id], development: 1, heldOut: 0, coverageLimits: c.coverageLimits, execution: 'not-run' };
  outputs.push({ path: 'inventory.json', bytes: Buffer.from(json(inventory)) });
  check(outputs.reduce((n, f) => n + f.bytes.length, 0) <= EVALUATION_BYTES, 'corpus export exceeds byte bound');
  check(Date.now() < deadline, 'corpus preparation deadline exhausted');
  const input = { catalogDigest: d.catalogDigest, probeIdentities: d.probeProvenance.map(({ path, transformation, rawSha256, deliveredSha256 }) => ({ path, transformation, rawSha256, deliveredSha256 })), caseId: c.id, repository, startingCommit: c.start, ...target, files: outputs.map(f => ({ path: f.path, bytes: f.bytes.length, sha256: byteDigest(f.bytes) })) };
  return { input, digest: fingerprint(input), inventory, outputs };
}
export async function exportCorpus(options) {
  const p = await prepareCorpusExport(options);
  const preview = { schemaVersion: 1, action: 'corpus-export', preview: true, digest: p.digest, input: p.input, inventory: p.inventory, execution: 'not-run' };
  if (!options.yes) { check(options.digest === undefined, 'digest requires approval'); return preview; }
  check(options.digest === p.digest, 'stale or missing corpus export digest');
  check(fingerprint(await destinationInput(options.destination)) === fingerprint({ destination: p.input.destination, parent: p.input.parent }), 'destination parent changed');
  // Exclusive creation is the only claim. A competing/partial destination refuses;
  // no cleanup or retry can erase another export's evidence.
  await mkdir(options.destination, { mode: 0o700 });
  const root = await open(options.destination, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const rootStat = await root.stat(); check(rootStat.isDirectory() && rootStat.uid === process.getuid?.() && (rootStat.mode & 0o077) === 0, 'unsafe export directory');
    const original = identity(rootStat), dirs = new Map([[options.destination, original]]);
    const verify = async () => { for (const [path, id] of dirs) check(fingerprint(identity(await lstat(path))) === fingerprint(id), 'export directory replaced; partial output retained'); };
    for (const file of p.outputs) {
      await verify();
      const parts = file.path.split('/'); let dir = options.destination;
      for (const part of parts.slice(0, -1)) {
        dir = join(dir, part);
        if (!dirs.has(dir)) { await mkdir(dir, { mode: 0o700 }); const stat = await lstat(dir); check(stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, 'unsafe export directory'); dirs.set(dir, identity(stat)); }
      }
      await verify();
      const handle = await open(join(options.destination, file.path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
      try { await handle.writeFile(file.bytes); await handle.sync(); } finally { await handle.close(); }
      await verify();
    }
    for (const file of p.outputs) {
      await verify();
      const bytes = await bounded(join(options.destination, file.path), file.bytes.length);
      check(byteDigest(bytes) === byteDigest(file.bytes), 'export bytes changed; partial output retained');
    }
    await root.sync(); await verify();
  } finally { await root.close(); }
  return { ...preview, preview: false, written: true };
}
export async function corpusCommand({ args }) {
  const [action, ...rest] = args, options = {}, seen = new Set();
  check(['inspect', 'export'].includes(action), 'corpus needs inspect or export');
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]; check(['--case', '--repository', '--destination', '--yes', '--digest', '--json'].includes(flag) && !seen.has(flag), 'unknown or repeated corpus option'); seen.add(flag);
    if (['--yes', '--json'].includes(flag)) options[flag.slice(2)] = true;
    else { check(rest[i + 1] && !rest[i + 1].startsWith('--'), 'corpus option requires value'); options[flag.slice(2)] = rest[++i]; }
  }
  if (action === 'inspect') check(Object.keys(options).every(k => k === 'json'), 'corpus inspect is read-only');
  const data = action === 'inspect' ? await inspectCorpus() : await exportCorpus(options);
  return { data, text: json(data), exitCode: action === 'export' && !options.yes ? 3 : 0 };
}

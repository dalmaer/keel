// Optional public isocan CLI adapter. No SDK/internal operation protocol.
// Source inspected: isocan 3b46f21, b61f7c1, 1565e50 and 7bb1f4e, main.ts
// (7bb1f4e also conditional-edit.ts, its test and the agent guide section
// "Keeping one card current"; walked against a throwaway local daemon).
// Through 1565e50 the general edit CLI has no conditional flag: those builds
// publish immutable run cards only. 7bb1f4e adds `edit --if-version`: exit 4
// {status:"conflict"} and exit 5 {status:"unsupported"} write nothing; a
// repeated --op-id answers {status:"replayed"} with the version that landed.
// With --op-id the CLI skips its own stale pre-check and the home decides, so
// its conflict reason does not say whether version or metadata moved.
// Never turn a read/check into a CAS claim: only the home's answer is one.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, open, rename, rm, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class CanvasError extends Error {
  constructor(message, code = 'invalid', exitCode = 2) { super(message); this.code = code; this.exitCode = exitCode; }
}
const fail = (message, code = 'invalid', exitCode = 2) => { throw new CanvasError(message, code, exitCode); };
const hash = text => createHash('sha256').update(text).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const now = () => new Date().toISOString();
const LOCKED = Symbol('canvas-writer-lock');
export const LIMITATIONS = [
  'Immutable run cards only: this binding has not been moved to live mode, or the inspected public CLI exposes no conditional edit.',
  'No stable live pulse, atomic multi-card publication, or automatic retention.',
  'Zero or multiple recovery matches require manual investigation; pending creates are never retried.',
  'Read access does not establish writer access; admission is enforced by isocan on each write.',
];
export const LIVE_LIMITATIONS = [
  'Live cards: each card key the binding lists (canvas.liveKeys, default pulse) keeps one card, updated in place by isocan\'s conditional edit; every other card is still an immutable run card.',
  'No atomic multi-card publication: cards are written one at a time and a sync can stop between them. The last-success receipt, not the canvas, identifies a complete publication.',
  'A person\'s edit to the live card stops updates to it until the owner re-bases explicitly; an unconditional write is never sent.',
  'Retention is off unless canvas.keepVersions is set; it prunes the live card\'s own versions only, never other cards.',
  'Zero or multiple recovery matches require manual investigation; pending creates are never retried. A pending edit is retried under its recorded op id only.',
  'Read access does not establish writer access; admission is enforced by isocan on each write.',
];
// The card keys a binding keeps as ONE card each. The spec's stable card is
// the pulse; a binding may name others (a caller's own weekly report, say).
// Everything else stays an immutable run card.
const DEFAULT_LIVE_KEYS = ['pulse'];
const liveKey = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const liveKeyList = value => Array.isArray(value) && value.length >= 1 && value.length <= 16 && value.every(liveKey) && new Set(value).size === value.length;
const liveKeysOf = binding => new Set(binding?.liveKeys ?? DEFAULT_LIVE_KEYS);
const MODES = ['immutable', 'live'];
const keepable = value => Number.isInteger(value) && value >= 2 && value <= 1000;
const limitsOf = binding => binding?.mode === 'live' ? LIVE_LIMITATIONS : LIMITATIONS;
export const REGIONS = [
  { key: 'delivery', title: 'Goals & delivery' }, { key: 'loop', title: 'Loop → work' },
  { key: 'lessons', title: 'Lessons → shared practice' }, { key: 'health', title: 'Health & upkeep' },
  { key: 'retros', title: 'Retros → changes' }, { key: 'evidence', title: 'Evidence & activity' },
];
const regionFor = card => card.region ?? (card.group === 'activity' ? 'evidence' : card.group) ?? ({ goal: 'delivery', phase: 'delivery', decision: 'delivery', loop: 'loop', lesson: 'lessons', retro: 'retros', health: 'health', test: 'health', review: 'health', 'loose-end': 'health' }[card.key.split(':')[0]] ?? 'evidence');
function origin(value) {
  let u; try { u = new URL(value); } catch { fail('An explicit HTTP(S) home is required.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname)) fail('Home must be an origin without credentials, path, query or fragment.');
  return u.origin;
}
function target({ home, canvas, canvasId }) {
  if (canvas) {
    let u; try { u = new URL(canvas); } catch { fail('Use a complete canvas address, not a title or prefix.'); }
    if (u.username || u.password || u.search || u.hash) fail('Canvas addresses must not contain credentials, queries or passes.');
    const match = /^\/p\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
    if (!match) fail('Use a canvas address ending in /p/<exact id>.');
    if (home && origin(home) !== origin(u.origin)) fail('Canvas and home disagree.');
    return { home: origin(u.origin), canvasId: match[1] };
  }
  if (!id(canvasId)) fail('An exact canvas id is required.');
  return { home: origin(home), canvasId };
}
const result = (operation, fields = {}, exitCode = 0) => {
  const data = { schema: 1, operation, changes: [], coverage: [], warnings: [...LIMITATIONS], ...fields, exitCode };
  return { data, text: `Canvas ${operation}: ${data.state ?? (exitCode ? 'needs attention' : 'ok')}`, exitCode };
};

/** Only help/version probes are offline. All other methods may contact the
 * configured daemon/home. No identity, auth, home, use, layout or edit commands.
 * An executable may be an explicitly configured wrapper; never a shell string. */
export function createIsocanTransport({ executable = 'isocan', cwd = process.cwd(), timeoutMs = 15000, env = process.env } = {}) {
  if (typeof executable !== 'string' || !executable || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) fail('Invalid isocan executable or timeout (1–120000 ms).');
  // `answers` names exit codes whose JSON stdout is a definite answer, not a
  // failure: the conditional edit refuses with 4 (conflict) or 5 (unsupported).
  const invoke = (args, json = true, home, answers = []) => new Promise((accept, reject) => {
    execFile(executable, json ? ['--json', ...args] : args, { cwd, env: home ? { ...env, ISOCAN_DIRECT: origin(home) } : env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', shell: false }, (error, stdout, stderr) => {
      if (error && !(json && !error.killed && answers.includes(error.code))) {
        const text = `${stdout}\n${stderr}`;
        const code = error.code === 'ENOENT' ? 'missing-cli' : error.killed ? 'timeout' : /401|403|unauthori[sz]ed|forbidden|expired|no identity/i.test(text) ? 'auth' : /409|conflict/i.test(text) ? 'conflict' : 'transport';
        // The tool can echo credentials, URLs with passes, or content. Never
        // return its raw stdout/stderr/error message on a failed operation.
        return reject(new CanvasError(`isocan ${code}; inspect the configured CLI separately.`, code, 1));
      }
      if (!json) return accept(stdout.trim());
      try { accept(JSON.parse(stdout)); } catch { reject(new CanvasError('isocan returned invalid JSON; mutation outcome may be unknown.', 'invalid-json', 1)); }
    });
  });
  return {
    async capabilities() {
      const version = await invoke(['--version'], false);
      if (!/^0\.1\.0 \((?:3b46f21|b61f7c1|1565e50|7bb1f4e)[0-9a-f]*,/.test(version)) fail('Unverified isocan build; inspect its public CLI before enabling publication.', 'unsupported', 2);
      const help = await invoke(['--help'], false);
      const add = await invoke(['add', '--help'], false);
      const create = await invoke(['canvas', 'create', '--help'], false);
      const groups = await invoke(['canvas', 'group', '--help'], false);
      const groupNew = await invoke(['canvas', 'group', 'new', '--help'], false);
      const edit = await invoke(['edit', '--help'], false);
      if (!edit.includes('--visual')) fail('Unverified edit help contract.', 'unsupported', 2);
      if (!help.includes('--json') || !help.includes('--canvas') || !add.includes('--visual') || !add.includes('--prop') || !create.includes('--prop')) fail('Required isocan JSON/source/visual/metadata flags are unavailable.', 'unsupported', 2);
      // The flags are read from this build's own help; whether the HOME knows
      // the operation is only learned from its answer to a real edit (exit 5).
      const conditionalWrites = ['--if-version', '--if-meta', '--op-id', '--title', '--prop'].every(flag => edit.includes(flag));
      const prune = conditionalWrites ? await invoke(['version', 'prune', '--help'], false) : '';
      return { version, conditionalWrites, retention: prune.includes('--keep') && prune.includes('--force'), immutable: true, metadataRecovery: true, createInSpace: create.includes('--space'), groups: groups.includes('new') && groups.includes('ls') && groupNew.includes('--note') };
    },
    identity: home => invoke(['whoami'], true, home),
    space: (home, spaceId) => invoke(['share', '--space', spaceId], true, home),
    access: binding => invoke(['--canvas', binding.canvasId, 'share'], true, binding.home),
    canvas: binding => invoke(['--canvas', binding.canvasId, 'canvas', 'show'], true, binding.home),
    list: binding => invoke(['--canvas', binding.canvasId, 'ls'], true, binding.home),
    groups: binding => invoke(['--canvas', binding.canvasId, 'canvas', 'group', 'ls'], true, binding.home),
    groupNew: (binding, group) => invoke(['--canvas', binding.canvasId, 'canvas', 'group', 'new', group.title, '--note', group.note], true, binding.home),
    show: (binding, itemId) => invoke(['--canvas', binding.canvasId, 'show', itemId], true, binding.home),
    create: ({ home, title, spaceId, operationId, projectKey }) => invoke(['canvas', 'create', title, '--space', spaceId, '--prop', `keel.project=${projectKey}`, '--prop', `keel.operation=${operationId}`], true, home),
    add: (binding, card) => invoke(['--canvas', binding.canvasId, 'add', card.sourcePath, '--title', card.title,
      ...(card.groupId ? ['--in', card.groupId] : []),
      ...(card.visualPath ? ['--visual', card.visualPath] : []),
      ...Object.entries(card.properties).flatMap(([key, value]) => ['--prop', `${key}=${value}`])], true, binding.home),
    // One conditional act. There is deliberately no unconditional edit method
    // on this transport, so a refusal has nothing to fall back to.
    edit: (binding, edit) => invoke(['--canvas', binding.canvasId, 'edit', edit.itemId, edit.sourcePath,
      ...(edit.visualPath ? ['--visual', edit.visualPath] : []),
      '--if-version', edit.ifVersion, '--if-meta', JSON.stringify(edit.ifMeta),
      ...(edit.title === undefined ? [] : ['--title', edit.title]),
      ...Object.entries(edit.properties).flatMap(([key, value]) => ['--prop', `${key}=${value}`]),
      '--op-id', edit.operationId], true, binding.home, [4, 5]),
    prune: (binding, itemId, keep) => invoke(['--canvas', binding.canvasId, 'version', 'prune', itemId, '--keep', String(keep), '--force'], true, binding.home),
  };
}

const paths = root => ({ config: join(root, '.keel/keel.json'), dir: join(root, '.keel/canvas'), manifest: join(root, '.keel/canvas/manifest.json') });
async function safeState(root) {
  for (const part of ['.keel', '.keel/keel.json', '.keel/canvas', '.keel/canvas/manifest.json', '.keel/canvas/history']) {
    const info = await lstat(join(root, part)).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (info?.isSymbolicLink()) fail('Canvas state may not be reached through a symlink.', 'state', 2);
  }
}
async function readJson(path, absent) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  }
  catch (e) { if (e.code === 'ENOENT' && absent !== undefined) return absent; fail('Missing or malformed canvas/config state; restore the recorded file before proceeding.', 'state', 1); }
}
async function durable(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const file = await open(tmp, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); }
  finally { await file.close(); }
  await rename(tmp, path);
  const dir = await open(resolve(path, '..'), 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}
async function locked(root, run) {
  const p = paths(root);
  await safeState(root);
  // Validate project identity marker before creating any local state.
  await readJson(p.config);
  await mkdir(p.dir, { recursive: true });
  await writeFile(join(p.dir, '.gitignore'), '*\n', { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  const lock = join(p.dir, 'sync.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') fail('Canvas writer lock exists; confirm its process stopped before removing .keel/canvas/sync.lock. Pending receipts must remain.', 'locked', 1); throw e; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.sync(); return await run(); }
  finally { await handle.close(); await rm(lock); }
}
function bindingOf(config) {
  const b = config.canvas;
  if (!b || b.provider !== 'isocan' || !id(b.projectKey)) fail('No valid isocan binding; connect explicitly.', 'not-connected', 2);
  if ((b.mode !== undefined && !MODES.includes(b.mode)) || (b.keepVersions !== undefined && !keepable(b.keepVersions)) || (b.liveKeys !== undefined && !liveKeyList(b.liveKeys))) fail('Canvas binding has an unknown mode, retention or live card list; use keel canvas live to change them.', 'state', 2);
  target(b);
  return b;
}
async function manifestOf(root, binding) {
  const m = await readJson(paths(root).manifest, null);
  if (!m) fail('Canvas manifest missing; restore receipts before publishing. Do not create replacements.', 'state', 1);
  if (m.schema !== 1 || m.projectKey !== binding.projectKey || m.home !== binding.home || m.canvasId !== binding.canvasId || !Array.isArray(m.receipts) || !m.items || !m.groups) fail('Canvas manifest does not match its binding.', 'conflict', 1);
  return m;
}
async function saveBinding(root, before, binding) {
  // Detect intervening config edits; preserve unrelated settings. This local
  // check is not advertised as a remote conditional-write primitive.
  const fresh = await readJson(paths(root).config);
  if (JSON.stringify(fresh) !== JSON.stringify(before)) fail('Project config changed during connection; pending receipt retained.', 'conflict', 1);
  await durable(paths(root).config, { ...fresh, canvas: binding });
}
async function admission(transport, home) {
  const actor = await transport.identity(home);
  if (!id(actor?.id) || origin(actor.home) !== home) fail('isocan identity does not belong to the explicit home.', 'auth', 1);
  return actor.id;
}
// Only owner-only publication is currently admitted. A free-form audience label
// cannot authorize an unknown grant set. Wider audiences require an explicit
// reviewed grant contract before this adapter can support them.
async function accessOf(transport, { home, spaceId, canvasId }, actorId, creating = false) {
  const access = creating ? await transport.space(home, spaceId) : await transport.access({ home, canvasId });
  const owner = typeof access?.owner === 'string' ? access.owner : access?.owner?.id;
  if (owner !== actorId || !Array.isArray(access.grants) || access.grants.length || access.public === true || (access.space && (!Array.isArray(access.spaceGrants) && !creating))) fail('Only verified owner-only access is supported; inspect the selected space/canvas sharing separately.', 'audience', 1);
  if (creating && (access.space?.id !== spaceId || access.space?.createdBy !== actorId)) fail('Selected space is not owned by the approved writer.', 'audience', 1);
  if (!creating && access.space && (access.space.createdBy !== actorId || access.spaceGrants.length)) fail('Canvas inherits a wider or unverified audience.', 'audience', 1);
  return { owner: actorId, audience: 'owner-only', spaceId: access.space?.id ?? spaceId ?? null };
}

/** Plan by default. Required: root, home, audience and either canvas/address
 * or create+title+spaceId. Connection never configures authentication/sharing. */
export async function canvasConnect(options, { transport = createIsocanTransport({ cwd: options.root }) } = {}) {
  const { root, yes = false, create = false, title, spaceId, audience } = options;
  if (!!create === !!(options.canvas || options.canvasId)) fail('Choose create or an exact existing canvas.');
  const home = create ? origin(options.home) : target(options).home;
  if (audience !== 'owner-only') fail('Use audience owner-only; wider sharing is not yet supported by this adapter.');
  if (create && (typeof title !== 'string' || !title.trim() || title.startsWith('-') || !id(spaceId))) fail('Create requires a title and exact spaceId.');
  const apply = async () => {
    await safeState(root);
    const config = await readJson(paths(root).config);
    if (config.canvas) fail('A canvas binding already exists; it will not be overwritten, even when disabled.', 'conflict', 1);
    const prior = await readJson(paths(root).manifest, null);
    if (prior) fail('A previous canvas receipt exists; inspect/recover it before connecting. No creation retry was sent.', 'pending', 1);
    const capabilities = await transport.capabilities();
    if (!capabilities.groups || (create && !capabilities.createInSpace)) return result('connect', { state: 'unsupported', capabilities, warnings: [...LIMITATIONS, 'This CLI lacks native groups or space-scoped creation; use an inspected current checkout executable.'] }, 2);
    const actorId = await admission(transport, home);
    let selected = create ? null : target(options);
    if (selected && (await transport.canvas(selected))?.id !== selected.canvasId) fail('Canvas read returned another target.', 'conflict', 1);
    const access = await accessOf(transport, { home, spaceId, canvasId: selected?.canvasId }, actorId, create);
    if (selected && (await transport.canvas(selected))?.groupMode !== 'groups') fail('Legacy canvas: migrate it separately before attachment.', 'unsupported', 2);
    const plan = { access, action: create ? 'create' : 'attach', home, canvasId: selected?.canvasId ?? null, spaceId: spaceId ?? null, audience, actorId, title: create ? title : undefined };
    if (!yes) return result('connect', { state: 'planned', changes: [plan], capabilities }, 3);
    const projectKey = randomUUID();
    const operationId = randomUUID();
    const manifest = { schema: 1, projectKey, home, canvasId: selected?.canvasId ?? null, items: {}, groups: {}, receipts: [], pending: { operationId, kind: create ? 'create-canvas' : 'attach', state: 'pending', plan, at: now() } };
    await durable(paths(root).manifest, manifest);
    if (create) {
      const made = await transport.create({ home, title, spaceId, operationId, projectKey });
      if (!id(made?.canvasId)) fail('Canvas creation response lacks an exact id; pending receipt retained. Do not retry.', 'ambiguous', 1);
      selected = { home, canvasId: made.canvasId };
      manifest.canvasId = made.canvasId;
      manifest.pending.canvasId = made.canvasId;
      await durable(paths(root).manifest, manifest);
      if ((await transport.canvas(selected))?.id !== selected.canvasId) fail('Created canvas could not be verified; receipt retained.', 'ambiguous', 1);
    }
    await accessOf(transport, selected, actorId);
    const binding = { provider: 'isocan', projectKey, ...selected, ...(spaceId ? { spaceId } : {}), audience, actorId, enabled: true, privacy: 'summary', mode: 'immutable', cadence: 'manual' };
    await saveBinding(root, config, binding);
    manifest.receipts.push({ ...manifest.pending, state: 'acknowledged' });
    manifest.pending = null;
    await durable(paths(root).manifest, manifest);
    return result('connect', { state: 'connected', binding, capabilities });
  };
  return yes ? locked(root, apply) : apply();
}

/** Renderer input: cards [{key,title,source,visual?}], all strings. The source
 * is Markdown, visual self-contained HTML. Caller supplies coverage/warnings.
 * Hash exact bytes (never strip arbitrary timestamps from authored text).
 * Renderers must omit volatile collection time from unchanged card content. */
function cardsOf(cards) {
  if (!Array.isArray(cards) || cards.length === 0 || cards.length > 100) fail('Provide between 1 and 100 rendered cards.');
  const keys = new Set();
  return cards.map(input => {
    const card = { ...input, source: input?.source ?? input?.markdown, visual: input?.visual ?? input?.html };
    if (!card || typeof card.key !== 'string' || !card.key || card.key.length > 300 || keys.has(card.key) || typeof card.title !== 'string' || !card.title || card.title.startsWith('-') || typeof card.source !== 'string' || (card.visual !== undefined && typeof card.visual !== 'string')) fail('Invalid or duplicate rendered card.');
    keys.add(card.key);
    // isocan inlines local images; prohibit filesystem references in input.
    if (unsafeAssets(card.source, card.visual)) fail('Cards must embed assets; external/local image references are not publishable.');
    if (Buffer.byteLength(card.source) + Buffer.byteLength(card.visual ?? '') > 4 * 1024 * 1024) fail('Rendered card exceeds 4 MiB.');
    const region = regionFor(card);
    if (!REGIONS.some(r => r.key === region)) fail('Unknown card region.');
    const sourceHash = hash(card.source), visualHash = card.visual === undefined ? null : hash(card.visual);
    return { ...card, region, sourceHash, visualHash, hash: hash(JSON.stringify([card.key, card.title, sourceHash, visualHash])) };
  });
}
// Inspect resource-bearing markup/styles, never arbitrary JavaScript or prose:
// renderer code legitimately contains new URL(...), ![...], and HTML strings.
// Scripts themselves are the renderer's responsibility; a src still counts.
function unsafeAssets(source, visual = '') {
  if (/!\[[^\]\n]*\](?:\(|\[)/.test(source)) return true;
  const markup = `${source}\n${visual}`.replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>');
  const tags = [...markup.matchAll(/<[a-z][^<>]*>/gi)].map(m => m[0]);
  const css = [...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(m => m[1]);
  for (const tag of tags) {
    if (/^<(?:iframe|object|embed|link)\b/i.test(tag)) return true;
    for (const m of tag.matchAll(/\s(?:src|srcset|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      if (!/^(?:data:|#)/i.test(m[1] ?? m[2] ?? m[3])) return true;
    }
    for (const m of tag.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) css.push(m[1] ?? m[2]);
  }
  return css.some(style => /@import\b/i.test(style) || [...style.matchAll(/\burl\(\s*["']?([^)'"\s]+)/gi)].some(m => !/^(?:data:|#)/i.test(m[1])));
}
function matching(item, receipt, projectKey) {
  const p = item?.properties;
  const version = item?.versions?.find(v => v.id === item.currentVersionId);
  return p?.['keel.project'] === projectKey && p?.['keel.operation'] === receipt.operationId && p?.['keel.hash'] === receipt.hash &&
    item.title === receipt.title && version?.blobHash === receipt.sourceHash && (version.visual?.blobHash ?? null) === receipt.visualHash;
}
async function recover(root, transport, binding, manifest, capabilities) {
  const pending = manifest.pending;
  if (!pending) return;
  if (pending.kind === 'group') {
    const groups = await transport.groups(binding);
    if (!Array.isArray(groups)) fail('Invalid native group listing.', 'transport', 1);
    const matches = groups.filter(g => g.description === pending.note);
    if (matches.length !== 1) fail('Group creation has zero or multiple operation-note matches; no retry was sent.', 'pending', 1);
    const remote = await transport.show(binding, matches[0].id);
    if (!matchingGroup(remote, pending)) fail('Recovered group content differs from its receipt.', 'conflict', 1);
    await acknowledgeGroup(root, manifest, remote);
    return;
  }
  if (pending.kind !== 'add' || !capabilities.metadataRecovery) fail('Pending mutation needs manual investigation; no retry was sent.', 'pending', 1);
  const items = await transport.list(binding);
  if (!Array.isArray(items)) fail('Invalid remote item listing.', 'transport', 1);
  const candidates = items.filter(item => item.properties?.['keel.operation'] === pending.operationId);
  if (candidates.length !== 1 || !matching(candidates[0], pending, binding.projectKey)) fail('Pending mutation has zero, multiple or changed matches; inspect remote operation metadata and receipts. No retry was sent.', 'pending', 1);
  // Carry what the normal creation path records: the live state the add was
  // sent with, and the metadata when it is provably the publication's own.
  const meta = provenMeta(candidates[0], pending);
  await acknowledge(root, manifest, candidates[0], meta ? { meta } : { live: undefined });
}
function matchingGroup(item, receipt) {
  const version = item?.versions?.find(v => v.id === item.currentVersionId);
  return id(item?.id) && item.properties?.kind === 'group' && item.title === receipt.title && item.description === receipt.note && version?.blobHash === receipt.sourceHash;
}
async function acknowledgeGroup(root, manifest, item) {
  const receipt = { ...manifest.pending, itemId: item.id, versionId: item.currentVersionId, state: 'acknowledged', acknowledgedAt: now() };
  manifest.groups[receipt.key] = receipt;
  manifest.receipts.push(receipt);
  manifest.pending = null;
  await durable(paths(root).manifest, manifest);
}
async function ensureGroups(root, transport, binding, manifest) {
  for (const region of REGIONS) {
    if (manifest.groups[region.key]) continue;
    const operationId = randomUUID();
    const note = `Keel region ${region.key}\nProject: ${binding.projectKey}\nOperation: ${operationId}`;
    manifest.pending = { kind: 'group', operationId, key: region.key, title: region.title, note, sourceHash: hash(note), at: now(), state: 'pending' };
    await durable(paths(root).manifest, manifest);
    const made = await transport.groupNew(binding, { title: region.title, note });
    if (!id(made?.itemId)) fail('Group creation did not acknowledge an exact id; receipt remains pending.', 'ambiguous', 1);
    manifest.pending.itemId = made.itemId;
    await durable(paths(root).manifest, manifest);
    const remote = await transport.show(binding, made.itemId);
    if (!matchingGroup(remote, manifest.pending)) fail('Native group content failed read-back verification.', 'conflict', 1);
    await acknowledgeGroup(root, manifest, remote);
  }
}
async function acknowledge(root, manifest, item, extra = {}) {
  const receipt = { ...manifest.pending, ...extra, state: 'acknowledged', itemId: item.id, versionId: item.currentVersionId, acknowledgedAt: now() };
  manifest.items[receipt.key] = receipt;
  manifest.receipts.push(receipt);
  manifest.pending = null;
  await durable(paths(root).manifest, manifest);
}

// ---- Live mode: one stable card, advanced only by isocan's conditional edit.
// The exact title and string properties a conditional edit expects to find.
// Bounded: it travels as one argument and is kept in the journal.
function metaOf(item) {
  const p = item?.properties;
  if (typeof item?.title !== 'string' || !p || typeof p !== 'object' || Array.isArray(p) || Object.values(p).some(v => typeof v !== 'string')) fail('Live card metadata is not a title with string properties; mutation outcome may be unknown.', 'invalid-json', 1);
  const meta = { title: item.title, properties: { ...p } };
  if (Buffer.byteLength(JSON.stringify(meta)) > 32 * 1024) fail('Live card metadata exceeds 32 KiB and cannot be guarded.', 'unsupported', 2);
  return meta;
}
const sameMeta = (a, b) => a.title === b.title && Object.keys(a.properties).length === Object.keys(b.properties).length && Object.entries(a.properties).every(([k, v]) => b.properties[k] === v);
const versionOf = (item, versionId) => item?.versions?.find(v => v.id === versionId);
// What a person did to a live card, as keel saw it. Recorded, never adopted.
function attentionOf(owned) {
  const c = owned.conflict;
  return { key: owned.key, itemId: owned.itemId, reason: c.reason, seen: c.seen, at: c.at, expectedVersionId: c.expectedVersionId, currentVersionId: c.currentVersionId, title: c.title, properties: c.properties,
    next: `A person changed this card. Keel wrote nothing to it and will not until the owner looks: keel canvas rebase, then keel canvas rebase --onto ${c.currentVersionId} --yes.` };
}
function conflictOf(owned, remote, seen, expected = { versionId: owned.versionId, meta: owned.meta }) {
  const meta = metaOf(remote);
  return { at: now(), seen, reason: remote.currentVersionId !== expected.versionId ? 'version' : sameMeta(meta, expected.meta) ? 'content' : 'metadata',
    expectedVersionId: expected.versionId, currentVersionId: remote.currentVersionId, title: meta.title, properties: meta.properties };
}
// A read is never a condition for a write: this only decides to send NOTHING.
function untouched(remote, owned) {
  const version = versionOf(remote, remote?.currentVersionId);
  return remote?.id === owned.itemId && remote.currentVersionId === owned.versionId && sameMeta(metaOf(remote), owned.meta) &&
    version?.blobHash === owned.sourceHash && (version.visual?.blobHash ?? null) === owned.visualHash;
}
// Recorded at publication so a later adoption has a base that is keel's own
// observation. Absent on receipts written before live mode existed.
const recordedMeta = item => { try { return metaOf(item); } catch { return undefined; } };
// May a card that is not live yet become the live card with no owner step?
// Only when everything keel recorded is still exactly there, properties a
// person could add included. No recorded metadata is not "unchanged".
const adoptable = (remote, owned, projectKey) => matching(remote, owned, projectKey) && remote.id === owned.itemId && remote.currentVersionId === owned.versionId && Boolean(owned.meta) && sameMeta(metaOf(remote), owned.meta);
// After an add whose answer was lost, the card is read later, so its current
// properties are not by themselves keel's observation of what it published.
// They are accepted as the recorded base only when every one is accounted
// for: the four keel set, and the file tags isocan derives from the very
// files keel sent (named by this operation). Anything else, a property a
// person added in between included, leaves the receipt without metadata and
// the explicit re-base decides.
function provenMeta(item, pending) {
  const meta = recordedMeta(item);
  if (!meta) return undefined;
  const file = value => value.split('/').pop();
  const sent = { 'keel.operation': pending.operationId, 'keel.hash': pending.hash, 'keel.key': pending.key };
  for (const [key, value] of Object.entries(meta.properties)) {
    if (key === 'keel.project') continue; // matching() already required it
    if (key in sent ? value === sent[key] : ((key === 'sourcePath' || key === 'file') && file(value) === `${pending.operationId}.md`) || (key === 'visualFile' && pending.visualHash && file(value) === `${pending.operationId}.html`)) continue;
    return undefined;
  }
  return meta;
}
const journaled = pending => Object.fromEntries(Object.entries(pending).filter(([k]) => k !== 'content'));
async function admit(transport, binding) {
  const actor = await transport.identity(binding.home);
  if (actor?.id !== binding.actorId) fail('The active identity differs from the approved writer; configure isocan separately.', 'auth', 1);
  await accessOf(transport, binding, actor.id);
}
/** Send, or send again, the one pending conditional edit. The op id and exact
 * bytes come from the durable receipt, so every retry is the same act: the
 * home answers applied (it had never arrived), replayed (it had) or conflict.
 * Any thrown failure leaves the receipt pending for the next run. */
async function sendEdit(root, transport, binding, manifest) {
  const pending = manifest.pending;
  const fileBase = join(paths(root).dir, pending.operationId);
  const sourcePath = `${fileBase}.md`, visualPath = pending.content.visual === null ? null : `${fileBase}.html`;
  await rm(sourcePath, { force: true });
  if (visualPath) await rm(visualPath, { force: true });
  let answer;
  try {
    await writeFile(sourcePath, pending.content.source, { flag: 'wx', mode: 0o600 });
    if (visualPath) await writeFile(visualPath, pending.content.visual, { flag: 'wx', mode: 0o600 });
    answer = await transport.edit(binding, { itemId: pending.itemId, sourcePath, visualPath, ifVersion: pending.ifVersion, ifMeta: pending.ifMeta,
      ...(pending.title === pending.ifMeta.title ? {} : { title: pending.title }), properties: pending.properties, operationId: pending.operationId });
  } finally {
    await rm(sourcePath, { force: true });
    if (visualPath) await rm(visualPath, { force: true });
  }
  const owned = manifest.items[pending.key];
  if (answer?.status === 'unsupported') {
    // Nothing was written and nothing else is tried. The card keeps its last
    // immutable receipt; the caller returns the binding to immutable mode.
    manifest.receipts.push({ ...journaled(pending), state: 'refused', status: 'unsupported', refusedAt: now() });
    manifest.pending = null;
    await durable(paths(root).manifest, manifest);
    return { status: 'unsupported' };
  }
  if (answer?.status === 'conflict') {
    if (answer.itemId !== pending.itemId || !id(answer.currentVersionId)) fail('Conflict answer names another item or no version; receipt remains pending.', 'ambiguous', 1);
    const conflict = conflictOf(owned, answer, 'edit', { versionId: pending.ifVersion, meta: pending.ifMeta });
    // The base keel tried is kept beside what it saw, so the refusal can be
    // reviewed. Nothing here becomes the new base without the owner.
    manifest.items[pending.key] = { ...owned, live: true, meta: pending.ifMeta, conflict };
    manifest.receipts.push({ ...journaled(pending), state: 'refused', status: 'conflict', refusedAt: now() });
    manifest.pending = null;
    await durable(paths(root).manifest, manifest);
    return { status: 'conflict' };
  }
  if (!['applied', 'replayed'].includes(answer?.status) || answer.itemId !== pending.itemId || !id(answer.versionId)) fail('Conditional edit answer is not a recognised outcome; receipt remains pending under the same op id.', 'ambiguous', 1);
  const remote = await transport.show(binding, pending.itemId);
  const landed = versionOf(remote, answer.versionId);
  if (remote?.id !== pending.itemId || landed?.blobHash !== pending.sourceHash || (landed.visual?.blobHash ?? null) !== pending.visualHash) fail('Landed version failed hash verification; receipt remains pending.', 'conflict', 1);
  // Keel records what IT wrote as the next base, not what a later read shows:
  // a change made since the edit landed must refuse the next edit, not ride in.
  const meta = { title: pending.title, properties: { ...pending.ifMeta.properties, ...pending.properties } };
  const receipt = { ...journaled(pending), state: 'acknowledged', status: answer.status, versionId: answer.versionId, live: true, meta, acknowledgedAt: now() };
  const conflict = untouched(remote, receipt) ? null : conflictOf(receipt, remote, 'read');
  manifest.receipts.push(receipt);
  manifest.items[pending.key] = conflict ? { ...receipt, conflict } : receipt;
  manifest.pending = null;
  await durable(paths(root).manifest, manifest);
  return { status: answer.status, key: receipt.key, itemId: receipt.itemId, versionId: receipt.versionId, changedSince: Boolean(conflict) };
}
// Optional and never fatal: the publication already stands when this runs.
async function retain(transport, binding, landed) {
  if (!binding.keepVersions || landed.changedSince) return null;
  const entry = { key: landed.key, itemId: landed.itemId, keep: binding.keepVersions };
  try {
    const pruned = await transport.prune(binding, landed.itemId, binding.keepVersions);
    if (!Number.isInteger(pruned?.dropped) || pruned.dropped < 0) return { ...entry, error: 'invalid-answer' };
    return { ...entry, dropped: pruned.dropped };
  } catch (error) { return { ...entry, error: error.code ?? 'transport' }; }
}
const historyFile = /^[a-f0-9]{64}-[a-f0-9]{64}\.json$/;
/** Successful snapshots only; the manifest index and files travel together.
 * An orphan left by a crash before the manifest commit is not an observation. */
export async function loadCanvasHistory({ root, manifest, projectKey, at, exclude }) {
  await safeState(root);
  const { validateSnapshot } = await import('./canvas-snapshot.mjs');
  const cutoff = Date.parse(at) - 90 * 86400000;
  if (manifest.history !== undefined && !Array.isArray(manifest.history)) fail('Invalid history receipt index.', 'state', 1);
  const entries = (manifest.history ?? []).filter(e => Date.parse(e.generatedAt) >= cutoff && Date.parse(e.generatedAt) <= Date.parse(at));
  if (entries.length > 500) fail('More than 500 retained snapshots; review retention before collecting history.', 'state', 1);
  const history = [];
  for (const entry of entries) {
    if (!historyFile.test(entry.path)) fail('Invalid history receipt path.', 'state', 1);
    const path = join(paths(root).dir, 'history', entry.path);
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) fail('Missing or unsafe retained snapshot; restore its artifact.', 'state', 1);
    const bytes = await readFile(path, 'utf8');
    if (hash(bytes) !== entry.fileHash) fail('Retained snapshot bytes differ from their receipt.', 'conflict', 1);
    const s = validateSnapshot(JSON.parse(bytes));
    if (s.project.key !== projectKey || s.generatedAt !== entry.generatedAt) fail('Retained snapshot identity differs from its receipt.', 'conflict', 1);
    // Even an excluded last observation must exist and verify after restore.
    if (entry.path !== exclude && Date.parse(entry.generatedAt) < Date.parse(at)) history.push(s);
  }
  return history;
}
async function completePublication(root, manifest, cards, coverage, options) {
  let snapshot;
  if (options.savedSnapshot) {
    const directory = join(paths(root).dir, 'history');
    await mkdir(directory, { recursive: true });
    const path = `${options.sourceDigest}-${options.snapshotHash}.json`;
    if (!historyFile.test(path)) fail('Invalid snapshot receipt identity.', 'state', 1);
    const bytes = `${JSON.stringify(options.savedSnapshot, null, 2)}\n`;
    const file = join(directory, path);
    // Immutable cache files are never overwritten, even after a interrupted run.
    try {
      const handle = await open(file, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if ((await lstat(file)).isSymbolicLink() || await readFile(file, 'utf8') !== bytes) fail('Existing snapshot file differs; no overwrite performed.', 'conflict', 1);
    }
    const directoryHandle = await open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    snapshot = { path, sourceDigest: options.sourceDigest, snapshotDigest: options.snapshotHash, generatedAt: options.savedSnapshot.generatedAt, fileHash: hash(bytes) };
    manifest.history ??= [];
    if (!manifest.history.some(e => e.path === path)) manifest.history.push(snapshot);
  }
  manifest.lastSuccess = { at: now(), items: cards.map(card => ({ key: card.key, itemId: manifest.items[card.key].itemId, hash: card.hash })), coverage, ...(snapshot ? { snapshot } : {}) };
  const expired = (manifest.history ?? []).filter(e => Date.parse(e.generatedAt) < Date.parse(options.savedSnapshot?.generatedAt ?? now()) - 90 * 86400000);
  manifest.history = (manifest.history ?? []).filter(e => !expired.includes(e));
  await durable(paths(root).manifest, manifest);
  // The publication is recorded before pruning. No remote history is deleted.
  for (const entry of expired) if (historyFile.test(entry.path)) await rm(join(paths(root).dir, 'history', entry.path), { force: true });
}
export async function canvasSync(options, { transport = createIsocanTransport({ cwd: options.root }), [LOCKED]: alreadyLocked = false } = {}) {
  const { root, yes = false, dryRun = false, coverage = [], warnings = [] } = options;
  const cards = cardsOf(options.cards);
  const apply = async () => {
    await safeState(root);
    const config = await readJson(paths(root).config);
    const binding = bindingOf(config);
    if (!binding.enabled) return result('sync', { state: 'disabled' }, 2);
    const manifest = await manifestOf(root, binding);
    const capabilities = await transport.capabilities();
    if (!capabilities.groups) fail('This CLI has no native canvas groups; use the inspected checkout executable.', 'unsupported', 2);
    const live = binding.mode === 'live', limits = limitsOf(binding), liveKeys = liveKeysOf(binding);
    // An inspected build without the conditional edit can only add cards. Live
    // mode never degrades to that by itself: the owner turns it off.
    if (live && !capabilities.conditionalWrites) fail('This isocan build has no conditional edit; live mode needs an inspected build that does, or keel canvas live --off. Nothing was written.', 'unsupported', 2);
    if ((await transport.canvas(binding))?.id !== binding.canvasId) fail('Remote canvas missing or target differs; no replacement will be created.', 'conflict', 1);
    const landed = [], retention = [];
    // Each way a live edit can end without a publication. Nothing is sent after.
    const refused = async outcome => {
      if (outcome.status === 'unsupported') {
        await saveBinding(root, config, { ...binding, mode: 'immutable' });
        return result('sync', { state: 'unsupported', mode: 'immutable', lastSuccess: manifest.lastSuccess ?? null, warnings: [...LIMITATIONS, 'This home does not know isocan\'s conditional edit. Nothing was written and no unconditional edit was tried; the binding is back in immutable mode.'] }, 2);
      }
      return result('sync', { state: 'conflict', attention: Object.values(manifest.items).filter(i => i.conflict).map(attentionOf), live: landed, retention, lastSuccess: manifest.lastSuccess ?? null, warnings: [...limits, ...warnings] }, 1);
    };
    const settle = async outcome => {
      if (!['applied', 'replayed'].includes(outcome.status)) return outcome;
      landed.push(outcome);
      const kept = await retain(transport, binding, outcome);
      if (kept) retention.push(kept);
      return outcome.changedSince ? { status: 'conflict' } : outcome;
    };
    if (manifest.pending) {
      if (!yes || dryRun) return result('sync', { state: 'pending', pending: journaled(manifest.pending), lastSuccess: manifest.lastSuccess ?? null, warnings: [...limits] }, 1);
      if (manifest.pending.kind === 'edit') {
        // Retry the SAME act: recorded op id, recorded bytes, recorded base.
        if (!capabilities.conditionalWrites) fail('A conditional edit is pending but this isocan build cannot retry it; receipt retained.', 'pending', 1);
        await admit(transport, binding);
        const outcome = await settle(await sendEdit(root, transport, binding, manifest));
        if (!['applied', 'replayed'].includes(outcome.status)) return refused(outcome);
      } else await recover(root, transport, binding, manifest, capabilities);
    }
    for (const owned of Object.values(manifest.groups)) {
      const remote = await transport.show(binding, owned.itemId);
      if (!matchingGroup(remote, owned) || remote.id !== owned.itemId || remote.currentVersionId !== owned.versionId) fail('Managed group content changed or disappeared; human work was left intact.', 'conflict', 1);
    }
    // Detect edited/deleted owned content; layout, comments and unrelated cards
    // are intentionally neither compared nor written. Remote reads never confer
    // permission for an in-place edit: immutable mode only adds new cards, and in
    // live mode a read can only decide to send nothing. The home decides the rest.
    const attention = [];
    for (const owned of Object.values(manifest.items)) {
      const remote = await transport.show(binding, owned.itemId);
      // Only a key the binding still lists is live. A receipt marked live whose
      // key was dropped is an ordinary run card below: it can record no conflict.
      if (live && owned.live && liveKeys.has(owned.key)) {
        // A live card a person touched is theirs until the owner says
        // otherwise. The refusal is sticky: a recorded conflict is not
        // re-evaluated, so an unseen change cannot quietly become the base.
        if (remote?.id !== owned.itemId) fail('Live card disappeared; no replacement will be created.', 'conflict', 1);
        if (!owned.conflict && !untouched(remote, owned)) {
          owned.conflict = conflictOf(owned, remote, 'read');
          if (yes && !dryRun) await durable(paths(root).manifest, manifest);
        }
        if (owned.conflict) attention.push(attentionOf(owned));
        continue;
      }
      const intact = matching(remote, owned, binding.projectKey) && remote.id === owned.itemId && remote.currentVersionId === owned.versionId;
      // Not yet live, so there is no recorded base to refuse against: the
      // owner's re-base is the one way a person's card becomes the base.
      if (live && liveKeys.has(owned.key) && remote?.id === owned.itemId && !adoptable(remote, owned, binding.projectKey)) {
        if (!intact || owned.meta) fail(`A person changed the ${owned.key} card before its first live sync. Nothing was written. Look at the card, then keel canvas rebase and keel canvas rebase --onto <version-id> --yes.`, 'conflict', 1);
        fail(`The ${owned.key} card was published before keel recorded its full metadata, so its properties cannot be shown unchanged. Nothing was written. Look at the card, then keel canvas rebase and keel canvas rebase --onto <version-id> --yes.`, 'conflict', 1);
      }
      if (!intact) fail('Managed content changed or disappeared; resolve the conflict without overwriting human work.', 'conflict', 1);
    }
    // Before any write of this run: no card is added around a refused live card.
    if (attention.length) return result('sync', { state: 'conflict', attention, live: landed, retention, lastSuccess: manifest.lastSuccess ?? null, warnings: [...limits, ...warnings] }, 1);
    const changed = cards.filter(card => manifest.items[card.key]?.hash !== card.hash);
    const stable = card => live && liveKeys.has(card.key);
    for (const card of changed) if (stable(card) && manifest.items[card.key]?.visualHash && card.visual === undefined) fail('A live card that has a visual face cannot drop it through the public conditional edit.');
    const missingGroups = REGIONS.filter(r => !manifest.groups[r.key]);
    const plan = [...missingGroups.map(r => ({ action: 'create-group', ...r })), ...changed.map(({ key, title, region, hash: contentHash }) => {
      const owned = manifest.items[key];
      if (!stable({ key })) return { action: 'add-immutable', key, title, region, hash: contentHash };
      if (!owned) return { action: 'add-live', key, title, region, hash: contentHash };
      return { action: owned.live ? 'edit-live' : 'adopt-live', key, title, region, hash: contentHash, itemId: owned.itemId, ifVersion: owned.versionId };
    })];
    const done = (state, fields = {}) => result('sync', { state, coverage, lastSuccess: manifest.lastSuccess ?? null, warnings: [...limits, ...warnings, ...retention.filter(r => r.error).map(r => `Retention failed for ${r.key} (${r.error}); the publication stands and its versions were left as they are.`)], ...(live ? { live: landed, retention } : {}), ...fields });
    if (!changed.length && !missingGroups.length) {
      const items = cards.map(card => ({ key: card.key, itemId: manifest.items[card.key].itemId, hash: card.hash }));
      if (yes && !dryRun && JSON.stringify(manifest.lastSuccess?.items) !== JSON.stringify(items)) {
        await completePublication(root, manifest, cards, coverage, options);
      }
      return live || landed.length ? done('unchanged') : result('sync', { state: 'unchanged', coverage, lastSuccess: manifest.lastSuccess ?? null });
    }
    if (!yes || dryRun) return result('sync', { state: 'planned', changes: plan, coverage, warnings: [...limits, ...warnings], home: binding.home, audience: binding.audience }, dryRun ? 0 : 3);
    await admit(transport, binding);
    if (options.snapshotHash) {
      manifest.run = { snapshotHash: options.snapshotHash, generatedAt: options.snapshotGeneratedAt, sourceDigest: options.sourceDigest };
      await durable(paths(root).manifest, manifest);
    }
    await ensureGroups(root, transport, binding, manifest);
    // Snapshot first, pulse last. In immutable mode the last-success receipt,
    // rather than a mutable curated card, identifies the complete publication.
    changed.sort((a, b) => (a.key === 'pulse') - (b.key === 'pulse') || (b.key === 'snapshot') - (a.key === 'snapshot'));
    for (const card of changed) {
      // The pulse points to the acknowledged snapshot. Its desired hash stays
      // a projection identity; sourceHash verifies the exact bytes, including
      // this pointer, that were actually published.
      const snapshotId = manifest.items.snapshot?.itemId;
      const source = card.key === 'pulse' && snapshotId ? `${card.source}\n\n[Source snapshot](${binding.home}/p/${binding.canvasId}/i/${snapshotId})\n` : card.source;
      const owned = manifest.items[card.key];
      if (stable(card) && owned) {
        let base = { versionId: owned.versionId, meta: owned.meta };
        if (!owned.live) {
          // First live publish: adopt the one card this journal already owns.
          // Exactly one remote card may carry its operation, still unchanged.
          const items = await transport.list(binding);
          if (!Array.isArray(items)) fail('Invalid remote item listing.', 'transport', 1);
          const candidates = items.filter(item => item.properties?.['keel.project'] === binding.projectKey && item.properties?.['keel.operation'] === owned.operationId);
          if (candidates.length !== 1 || !adoptable(candidates[0], owned, binding.projectKey)) fail(`The ${card.key} card to adopt has zero, multiple or changed matches; no card was created or edited. If a person changed it: look at the card, then keel canvas rebase and keel canvas rebase --onto <version-id> --yes. Several cards carrying its operation need manual investigation.`, 'conflict', 1);
          // The condition is the metadata keel recorded, never what it finds now.
          base = { versionId: owned.versionId, meta: owned.meta };
        }
        // op_ and 32 of 0-9a-f: isocan's op id shape. Written to the receipt
        // BEFORE the call and never regenerated for this edit.
        const operationId = `op_${randomUUID().replaceAll('-', '')}`;
        manifest.pending = { kind: 'edit', operationId, key: card.key, itemId: owned.itemId, title: card.title, hash: card.hash, sourceHash: hash(source), visualHash: card.visualHash,
          ifVersion: base.versionId, ifMeta: base.meta, properties: { 'keel.hash': card.hash, 'keel.operation': operationId }, content: { source, visual: card.visual ?? null },
          ...(owned.live ? {} : { adopted: true }), state: 'pending', at: now() };
        await durable(paths(root).manifest, manifest); // before any remote mutation
        const outcome = await settle(await sendEdit(root, transport, binding, manifest));
        if (!['applied', 'replayed'].includes(outcome.status)) return refused(outcome);
        continue;
      }
      const operationId = randomUUID();
      const fileBase = join(paths(root).dir, operationId);
      const sourcePath = `${fileBase}.md`, visualPath = card.visual === undefined ? null : `${fileBase}.html`;
      await writeFile(sourcePath, source, { flag: 'wx', mode: 0o600 });
      if (visualPath) await writeFile(visualPath, card.visual, { flag: 'wx', mode: 0o600 });
      manifest.pending = { kind: 'add', operationId, key: card.key, title: card.title, hash: card.hash, sourceHash: hash(source), visualHash: card.visualHash, ...(stable(card) ? { live: true } : {}), state: 'pending', at: now() };
      await durable(paths(root).manifest, manifest); // before any remote mutation
      try {
        const made = await transport.add(binding, { sourcePath, visualPath, title: card.title, groupId: manifest.groups[card.region].itemId, properties: { 'keel.project': binding.projectKey, 'keel.operation': operationId, 'keel.hash': card.hash, 'keel.key': card.key } });
        if (!id(made?.itemId)) fail('Add response lacks an exact item id; receipt remains pending.', 'ambiguous', 1);
        manifest.pending.itemId = made.itemId;
        await durable(paths(root).manifest, manifest);
        const item = await transport.show(binding, made.itemId);
        if (!matching(item, manifest.pending, binding.projectKey)) fail('Published content failed hash/metadata verification; receipt remains pending.', 'conflict', 1);
        // In live mode the one card just created IS the stable card from now on.
        // Every card's full metadata is recorded in either mode, as read back
        // now: it is what a later adoption compares against, whichever keys
        // the owner later names as live.
        const recorded = recordedMeta(item);
        await acknowledge(root, manifest, item, stable(card) ? { live: true, meta: metaOf(item) } : recorded ? { meta: recorded } : {});
      } finally {
        await rm(sourcePath, { force: true });
        if (visualPath) await rm(visualPath, { force: true });
      }
    }
    await completePublication(root, manifest, cards, coverage, options);
    return live || landed.length ? done('published', { changes: plan }) : result('sync', { state: 'published', changes: plan, coverage, lastSuccess: manifest.lastSuccess, warnings: [...LIMITATIONS, ...warnings] });
  };
  return yes && !dryRun && !alreadyLocked ? locked(root, apply) : apply();
}
export async function canvasStatus({ root }) {
  await safeState(root);
  const config = await readJson(paths(root).config);
  const manifest = await readJson(paths(root).manifest, null);
  // Do not echo arbitrary config fields (for example an accidentally pasted
  // credential), nor raw transport replies in receipts.
  const binding = config.canvas ? publicBinding(bindingOf(config)) : null;
  const pending = manifest?.pending ? Object.fromEntries(['operationId', 'kind', 'state', 'key', 'at', 'itemId', 'canvasId'].filter(k => manifest.pending[k] !== undefined).map(k => [k, manifest.pending[k]])) : null;
  // A recorded refusal is reported until the owner re-bases; it is a local
  // record of what keel saw, not a fresh read of the canvas.
  const attention = Object.values(manifest?.items ?? {}).filter(i => i?.conflict).map(attentionOf);
  const state = pending ? 'pending' : attention.length ? 'conflict' : binding?.enabled ? 'connected' : binding ? 'disabled' : 'disconnected';
  return result('status', { state, binding, pending, lastSuccess: manifest?.lastSuccess ?? null, warnings: [...limitsOf(binding)], ...(attention.length ? { attention } : {}) }, pending || attention.length ? 1 : 0);
}
function publicBinding(binding) {
  return Object.fromEntries(['provider', 'projectKey', 'home', 'canvasId', 'spaceId', 'audience', 'actorId', 'enabled', 'privacy', 'mode', 'cadence', 'keepVersions', 'liveKeys'].filter(k => binding[k] !== undefined).map(k => [k, binding[k]]));
}
/** Move a binding between immutable and live, and set retention. Plan by
 * default; `yes` writes the binding, and the journal only to retire a card
 * a person changed that is leaving live ownership. No remote write happens here: the
 * first live sync adopts the journal's own card for each live key, or creates
 * exactly one. Options: off (back to immutable), keep (2–1000 versions),
 * noKeep, cards (the complete list of live card keys; replaces the list). */
export async function canvasLive(options, { transport = createIsocanTransport({ cwd: options.root }) } = {}) {
  const { root, yes = false, off = false, keep, noKeep = false, cards } = options;
  if (keep !== undefined && (noKeep || off || !keepable(keep))) fail('--keep needs a whole number from 2 to 1000, without --off or --no-keep.');
  if (cards !== undefined && (off || !liveKeyList(cards))) fail('--card needs 1 to 16 distinct card keys (letters, digits, _ . : -), without --off.');
  const apply = async () => {
    await safeState(root);
    const config = await readJson(paths(root).config);
    const binding = bindingOf(config);
    const manifest = await manifestOf(root, binding);
    if (manifest.pending) fail('A mutation is pending; resolve it with keel canvas sync --yes before changing mode.', 'pending', 1);
    const next = { ...binding, mode: off ? 'immutable' : 'live' };
    if (keep !== undefined) next.keepVersions = keep;
    if (noKeep || off) delete next.keepVersions;
    if (cards !== undefined) next.liveKeys = [...cards];
    const capabilities = await transport.capabilities();
    const limits = limitsOf(next);
    if (!off && (!capabilities.conditionalWrites || (next.keepVersions && !capabilities.retention))) return result('live', { state: 'unsupported', mode: binding.mode, capabilities, warnings: [...LIMITATIONS, 'This isocan build has no inspected conditional edit (or version prune); the binding stays as it is.'] }, 2);
    const changes = [];
    if (next.mode !== binding.mode) changes.push({ action: 'set-mode', from: binding.mode, to: next.mode });
    if (next.keepVersions !== binding.keepVersions) changes.push({ action: 'set-retention', from: binding.keepVersions ?? null, to: next.keepVersions ?? null });
    if (JSON.stringify([...liveKeysOf(next)]) !== JSON.stringify([...liveKeysOf(binding)])) changes.push({ action: 'set-live-cards', from: [...liveKeysOf(binding)], to: [...liveKeysOf(next)] });
    if (!off) {
      if ((await transport.canvas(binding))?.id !== binding.canvasId) fail('Remote canvas missing or target differs.', 'conflict', 1);
      for (const key of liveKeysOf(next)) {
        const owned = manifest.items[key];
        if (!owned) { changes.push({ action: 'create-live-on-first-sync', key }); continue; }
        if (owned.live) continue;
        // Read-only preview of the adoption the first live sync will repeat.
        const items = await transport.list(binding);
        if (!Array.isArray(items)) fail('Invalid remote item listing.', 'transport', 1);
        const candidates = items.filter(item => item.properties?.['keel.project'] === binding.projectKey && item.properties?.['keel.operation'] === owned.operationId);
        if (candidates.length > 1) fail(`Several cards carry the ${key} card's operation; the binding stays as it is. Investigate them before adopting one.`, 'conflict', 1);
        if (candidates.length !== 1 || !adoptable(candidates[0], owned, binding.projectKey)) {
          // A person already changed it. Live mode is still the owner's to
          // choose; the first sync will refuse until they re-base explicitly.
          if ((await transport.show(binding, owned.itemId))?.id !== owned.itemId) fail(`The ${key} card to adopt disappeared; the binding stays as it is.`, 'conflict', 1);
          changes.push(owned.meta
            ? { action: 'rebase-before-first-sync', key, itemId: owned.itemId, reason: 'changed', next: 'A person changed this card. The first live sync refuses until keel canvas rebase --onto <version-id> --yes.' }
            : { action: 'rebase-before-first-sync', key, itemId: owned.itemId, reason: 'unrecorded-metadata', next: 'This card was published before keel recorded its full metadata. Look at it; the first live sync refuses until keel canvas rebase --onto <version-id> --yes.' });
          continue;
        }
        changes.push({ action: 'adopt-live-on-first-sync', key, itemId: owned.itemId, versionId: owned.versionId, title: owned.title });
      }
    }
    // A card leaving live ownership that a person changed is THEIRS now. Keel
    // steps aside: the card stays on the canvas untouched and its receipts
    // stay in the journal, but it is no longer the card for its key, so the
    // next sync publishes a new one beside it. A card nobody touched is kept.
    const stays = key => next.mode === 'live' && liveKeysOf(next).has(key);
    const retiring = [];
    // `retiring` is the intent an earlier run journaled before it changed the
    // binding (#129): a card awaiting adoption is live only by that binding,
    // so once it is written only the intent says the card was leaving.
    for (const owned of Object.values(manifest.items)) {
      if (!(owned.live || owned.retiring || (binding.mode === 'live' && liveKeysOf(binding).has(owned.key))) || stays(owned.key)) continue;
      const remote = await transport.show(binding, owned.itemId);
      // A vanished card is not stepped around: sync keeps refusing to replace it.
      if (remote?.id !== owned.itemId) continue;
      // A live receipt is judged by everything keel recorded, properties a
      // person could add included; matching() alone would miss a re-tag.
      const own = owned.live && owned.meta ? untouched(remote, owned) : matching(remote, owned, binding.projectKey) && remote.currentVersionId === owned.versionId;
      if (!owned.conflict && own) continue;
      retiring.push(owned);
      changes.push({ action: 'retire-live-card', key: owned.key, itemId: owned.itemId, next: 'A person changed this card. It stays on the canvas as they left it and keel stops tracking it; the next sync publishes a new card beside it.' });
    }
    const view = { mode: next.mode, binding: publicBinding(next), capabilities, warnings: [...limits, ...(off ? [] : ['Whether this home accepts the conditional edit is only known from its answer to the first live edit; an older home leaves the binding immutable.'])] };
    if (!changes.some(c => c.action.startsWith('set-') || c.action === 'retire-live-card')) return result('live', { state: 'unchanged', changes, ...view });
    if (!yes) return result('live', { state: 'planned', changes, ...view }, 3);
    // The retirement intent first, then the binding, then the retirement
    // (#129). The card stays the journal's until the binding no longer lists
    // its key, so no live key is left with no card; and if the last write is
    // lost, the intent makes running this again retire it, though the binding
    // alone no longer says it was live.
    const leaving = new Set(retiring.map(owned => owned.key));
    if (retiring.some(owned => !owned.retiring)) {
      for (const owned of retiring) manifest.items[owned.key] = { ...owned, retiring: true };
      await durable(paths(root).manifest, manifest);
    }
    if (changes.some(c => c.action.startsWith('set-'))) await saveBinding(root, config, next);
    const stale = Object.values(manifest.items).filter(owned => owned.retiring && !leaving.has(owned.key));
    if (leaving.size || stale.length) {
      manifest.retired = [...(manifest.retired ?? []), ...retiring.map(({ retiring: _, ...owned }) => ({ ...owned, retiredAt: now() }))];
      for (const key of leaving) delete manifest.items[key];
      // An intent whose card is kept after all (untouched, or listed again) is cleared.
      for (const owned of stale) delete manifest.items[owned.key].retiring;
      await durable(paths(root).manifest, manifest);
    }
    return result('live', { state: next.mode, changes, ...view });
  };
  return yes ? locked(root, apply) : apply();
}
/** The owner's explicit answer to a refused live card: accept what a person
 * left there as the new base. Plan by default. `yes` needs `onto`, the exact current
 * version id the preview showed, so approval names what was looked at. It
 * records a base only; the next sync sends keel's projection as a new version
 * on top, and the person's version stays in the card's stack. */
export async function canvasRebase(options, { transport = createIsocanTransport({ cwd: options.root }) } = {}) {
  const { root, yes = false, onto, card } = options;
  if (onto !== undefined && !id(onto)) fail('--onto needs the exact current version id.');
  if (card !== undefined && !liveKey(card)) fail('--card needs one card key.');
  const apply = async () => {
    await safeState(root);
    const binding = bindingOf(await readJson(paths(root).config));
    const manifest = await manifestOf(root, binding);
    if (manifest.pending) fail('A mutation is pending; resolve it with keel canvas sync --yes before re-basing.', 'pending', 1);
    await transport.capabilities();
    const changes = [];
    // Every key the binding lists, and any card already recorded as live.
    const keys = new Set([...liveKeysOf(binding), ...Object.values(manifest.items).filter(i => i.live).map(i => i.key)]);
    for (const key of keys) {
      if (card !== undefined && key !== card) continue;
      const owned = manifest.items[key];
      // A card awaiting adoption has no live record yet. In live mode it is
      // re-based the same way, and that re-base is its adoption.
      const awaiting = Boolean(owned) && !owned.live && binding.mode === 'live' && liveKeysOf(binding).has(key);
      if (!owned?.live && !awaiting) continue;
      const remote = await transport.show(binding, owned.itemId);
      if (remote?.id !== owned.itemId || !id(remote.currentVersionId)) fail('Live card disappeared; nothing to re-base onto.', 'conflict', 1);
      const current = versionOf(remote, remote.currentVersionId);
      if (!current?.blobHash) fail('Live card has no readable current version.', 'transport', 1);
      if (awaiting ? adoptable(remote, owned, binding.projectKey) : !owned.conflict && untouched(remote, owned)) continue;
      const meta = metaOf(remote);
      // Keel's own content and title are still on the card (only properties
      // moved, or none were ever recorded): nothing needs republishing.
      const kept = awaiting && matching(remote, owned, binding.projectKey) && remote.currentVersionId === owned.versionId;
      changes.push({ action: 'rebase-live', key, itemId: owned.itemId, recorded: { versionId: owned.versionId, title: owned.meta?.title ?? owned.title }, refused: owned.conflict ?? null, ...(awaiting ? { awaitingAdoption: true } : {}), ...(awaiting && !owned.meta ? { unrecordedMetadata: true } : {}),
        current: { versionId: remote.currentVersionId, ...meta }, next: kept ? `Keel's content is still on the card. The next sync with a changed ${key} edits it on top of ${remote.currentVersionId}, setting only keel's own properties; every other property found there stays.` : `The next sync sends keel's ${key} as a new version on top of ${remote.currentVersionId}${meta.title === owned.title ? '' : ` and retitles it "${owned.title}"`}; the person's version stays in the stack${binding.keepVersions ? ` until retention (keep ${binding.keepVersions}) reaches it` : ''}.`,
        base: { versionId: remote.currentVersionId, meta, sourceHash: current.blobHash, visualHash: current.visual?.blobHash ?? null, kept } });
    }
    const shown = changes.map(({ base, ...change }) => change);
    if (!changes.length) return result('rebase', { state: 'unchanged', warnings: [...limitsOf(binding)] });
    if (!yes) return result('rebase', { state: 'planned', changes: shown, warnings: [...limitsOf(binding)] }, 3);
    if (changes.length > 1) fail('Several live cards need a re-base; name one with --card <key>. Nothing was re-based.', 'conflict', 1);
    if (changes.some(c => c.base.versionId !== onto)) fail('Pass --onto with the current version id the preview shows; nothing was re-based.', 'conflict', 1);
    for (const { key, base } of changes) {
      const owned = manifest.items[key];
      const { conflict, ...rest } = owned;
      // hash null: the card on the canvas is no longer keel's projection, so
      // the next sync publishes instead of reporting unchanged.
      manifest.items[key] = { ...rest, live: true, versionId: base.versionId, meta: base.meta, sourceHash: base.sourceHash, visualHash: base.visualHash, hash: base.kept ? owned.hash : null };
      manifest.receipts.push({ kind: 'rebase', operationId: randomUUID(), key, itemId: owned.itemId, ifVersion: owned.versionId, versionId: base.versionId, state: 'acknowledged', at: now(), acknowledgedAt: now() });
    }
    await durable(paths(root).manifest, manifest);
    return result('rebase', { state: 'rebased', changes: shown, warnings: [...limitsOf(binding)] });
  };
  return yes ? locked(root, apply) : apply();
}
export async function canvasDisconnect({ root, yes = false }) {
  const apply = async () => {
    await safeState(root);
    const config = await readJson(paths(root).config);
    const binding = bindingOf(config);
    if (!binding.enabled) return result('disconnect', { state: 'disabled' });
    if (!yes) return result('disconnect', { state: 'planned', changes: [{ action: 'disable-publishing', canvasId: binding.canvasId }] }, 3);
    await saveBinding(root, config, { ...binding, enabled: false });
    return result('disconnect', { state: 'disabled', binding: publicBinding({ ...binding, enabled: false }) });
  };
  return yes ? locked(root, apply) : apply();
}

// Known collection-clock fields only. IDs, occurredAt, persisted history
// origins and all source values remain part of the semantic digest.
function projectClock(collected, to) {
  const s = structuredClone(collected);
  const imported = new Set(s.entities.filter(e => e.lifecycleSource).map(e => e.key));
  const importedSources = new Set(s.entities.map(e => e.lifecycleSource).filter(Boolean));
  const replace = record => { if (record?.observedAt === collected.generatedAt) record.observedAt = to; };
  s.generatedAt = to;
  for (const c of s.coverage) if (!importedSources.has(c.source)) replace(c);
  for (const e of s.entities) if (!imported.has(e.key)) {
    replace(e);
    for (const fact of Object.values(e.facts ?? {})) replace(fact);
  }
  for (const o of s.observations) if (!imported.has(o.entity)) replace(o);
  replace(s.reconciliation);
  const days = collected.history?.windowDays;
  if (Number.isFinite(days)) {
    const from = new Date(Date.parse(collected.generatedAt) - days * 86400000).toISOString();
    const nextFrom = to === 'collection-time' ? 'collection-window-start' : new Date(Date.parse(to) - days * 86400000).toISOString();
    if (s.history.from === from && s.history.to === collected.generatedAt) { s.history.from = nextFrom; s.history.to = to; }
    if (s.history.snapshots === 0 && s.history.firstObservedAt === collected.generatedAt) s.history.firstObservedAt = to;
    for (const m of s.metrics) if (m.id === 'observed-active-days' && m.window?.from === from && m.window?.to === collected.generatedAt) m.window = { ...m.window, from: nextFrom, to };
  }
  const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, ordered(value[k])])) : value;
  return ordered(s);
}

// Product entrypoints shared by the CLI and night. KEEL_ISOCAN names one
// executable (including a source-checkout launcher), not a shell command.
const dependencies = (options, deps) => ({ ...deps, transport: deps.transport ?? createIsocanTransport({ cwd: options.root, env: options.env ?? process.env, executable: (options.env ?? process.env).KEEL_ISOCAN || 'isocan' }) });
export const connect = (options, deps = {}) => canvasConnect({ ...options, spaceId: options.spaceId ?? options.space }, dependencies(options, deps));
export const status = options => canvasStatus(options);
export const disconnect = options => canvasDisconnect(options);
export async function sync(options, deps = {}) {
  if (options.yes && !options.dryRun && !deps[LOCKED]) return locked(options.root, () => sync(options, { ...deps, [LOCKED]: true }));
  let { cards, coverage, warnings } = options;
  let snapshotHash, snapshotGeneratedAt, sourceDigest, savedSnapshot;
  if (!cards) {
    const collector = await import('./canvas-snapshot.mjs');
    const { snapshot, validateSnapshot } = collector;
    let collected = validateSnapshot(options.snapshot ?? await snapshot({ root: options.root, github: options.github ?? false, env: options.env ?? process.env, now: options.now, windowDays: options.windowDays ?? 30, artifacts: options.artifacts ?? [], report: options.report }));
    await safeState(options.root);
    const binding = bindingOf(await readJson(paths(options.root).config));
    if (collected.project.key !== binding.projectKey) fail('Snapshot belongs to another project; recollect after connection.', 'conflict', 2);
    const manifest = await manifestOf(options.root, binding);
    sourceDigest = hash(JSON.stringify(projectClock(collected, 'collection-time')));
    const last = manifest.lastSuccess?.snapshot;
    const history = await loadCanvasHistory({ root: options.root, manifest, projectKey: binding.projectKey, at: collected.generatedAt,
      exclude: last?.sourceDigest === sourceDigest ? last.path : undefined });
    if (history.length) {
      if (typeof collector.withHistory !== 'function') fail('Collector history enrichment is unavailable; retained observations were not discarded.', 'unsupported', 2);
      collected = await collector.withHistory(collected, history, { windowDays: options.windowDays ?? 30 });
    }
    snapshotHash = hash(JSON.stringify(projectClock(collected, 'collection-time')));
    snapshotGeneratedAt = manifest.run?.snapshotHash === snapshotHash ? manifest.run.generatedAt : collected.generatedAt;
    const stable = projectClock(collected, snapshotGeneratedAt);
    savedSnapshot = stable;
    const { renderSnapshot } = await import('./canvas-render.mjs');
    cards = [{ key: 'snapshot', title: 'Keel source snapshot', source: `# Keel source snapshot\n\n\`\`\`json\n${JSON.stringify(stable, null, 2)}\n\`\`\`\n`, region: 'evidence' }, ...renderSnapshot(stable).cards];
    coverage = collected.coverage;
    warnings = collected.warnings;
  }
  return canvasSync({ ...options, cards, coverage, warnings, snapshotHash, snapshotGeneratedAt, sourceDigest, savedSnapshot }, dependencies(options, deps));
}

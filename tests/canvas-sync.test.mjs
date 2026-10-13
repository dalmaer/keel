import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canvasConnect, canvasSync, canvasStatus, canvasDisconnect, canvasLive, canvasRebase, createIsocanTransport, connect, sync, loadCanvasHistory, REGIONS, LIMITATIONS, CanvasError } from '../lib/canvas-sync.mjs';
import { snapshot } from '../lib/canvas-snapshot.mjs';
import { renderSnapshot } from '../lib/canvas-render.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
const home = 'https://acme.test';
const read = path => readFile(path, 'utf8').then(JSON.parse);
const configPath = root => join(root, '.keel/keel.json');
const manifestPath = root => join(root, '.keel/canvas/manifest.json');
const cards = () => [{ key: 'snapshot', title: 'Acme snapshot', source: '# Acme\n', region: 'evidence' }, { key: 'pulse', title: 'Acme pulse', source: '# Acme pulse\n', visual: '<!doctype html><p>Acme</p>' }];
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'keel-canvas-acme-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel'));
  await mkdir(join(root, '.isocan'));
  await writeFile(configPath(root), JSON.stringify({ name: 'Acme', practices: [], custom: 'keep me' }));
  await writeFile(join(root, '.isocan/project.json'), '{"canvasId":"prj_human","home":"https://other.acme.test"}\n');
  const remote = { items: new Map(), groups: new Map(), created: 0, adds: 0, groupCreates: 0, actor: 'actor_acme', grants: [], native: true, beforeAdd: null, afterAdd: null, afterGroup: null, afterCreate: null,
    // isocan's conditional edit, as inspected at 7bb1f4e: the home decides.
    edits: [], ops: new Map(), prunes: [], unsupported: false, beforeEdit: null, afterEdit: null, pruneFails: false };
  const caps = { version: '0.1.0 (b61f7c1, 2026-10-08)', groups: true, createInSpace: true, conditionalWrites: false, metadataRecovery: true };
  const transport = {
    capabilities: async () => ({ ...caps }),
    identity: async requested => { assert.equal(requested, home); return { id: remote.actor, home }; },
    space: async (at, spaceId) => { assert.equal(at, home); return { owner: remote.actor, space: { id: spaceId, createdBy: remote.actor }, grants: remote.grants }; },
    access: async binding => { assert.equal(binding.home, home); return { owner: { id: 'actor_acme' }, grants: remote.grants }; },
    canvas: async binding => ({ id: binding.canvasId, groupMode: remote.native ? 'groups' : 'legacy' }),
    list: async () => [...remote.items.values()],
    groups: async () => [...remote.groups.values()],
    show: async (_binding, itemId) => structuredClone(remote.items.get(itemId)),
    create: async options => {
      const pending = (await read(manifestPath(root))).pending;
      assert.equal(pending.kind, 'create-canvas');
      assert.equal(pending.operationId, options.operationId);
      assert.equal(options.home, home);
      assert.equal(options.spaceId, 'space_acme');
      remote.created++;
      if (remote.afterCreate) await remote.afterCreate();
      return { canvasId: 'prj_created' };
    },
    groupNew: async (_binding, group) => {
      const pending = (await read(manifestPath(root))).pending;
      assert.equal(pending.kind, 'group');
      assert.equal(pending.note, group.note);
      const itemId = `itm_group_${++remote.groupCreates}`;
      const item = { id: itemId, title: group.title, description: group.note, properties: { kind: 'group' }, currentVersionId: `ver_${itemId}`, versions: [{ id: `ver_${itemId}`, blobHash: digest(group.note) }] };
      remote.items.set(itemId, item); remote.groups.set(itemId, item);
      if (remote.afterGroup) await remote.afterGroup();
      return { itemId };
    },
    add: async (_binding, card) => {
      const pending = (await read(manifestPath(root))).pending;
      assert.equal(pending.kind, 'add');
      assert.equal(pending.operationId, card.properties['keel.operation']);
      assert.ok(remote.groups.has(card.groupId));
      remote.adds++;
      if (remote.beforeAdd) await remote.beforeAdd(card);
      const itemId = `itm_card_${remote.adds}`;
      const version = { id: `ver_${itemId}`, blobHash: digest(await readFile(card.sourcePath, 'utf8')), ...(card.visualPath ? { visual: { blobHash: digest(await readFile(card.visualPath, 'utf8')) } } : {}) };
      remote.items.set(itemId, { id: itemId, currentVersionId: version.id, versions: [version], title: card.title, properties: card.properties, containerId: card.groupId, x: 10, comments: [] });
      if (remote.afterAdd) await remote.afterAdd();
      return { itemId };
    },
    // The only way this fake changes an existing card. It has no unconditional
    // form: every call must carry a base version, expected metadata and an op
    // id that the durable receipt already names.
    edit: async (_binding, edit) => {
      const pending = (await read(manifestPath(root))).pending;
      assert.equal(pending.kind, 'edit');
      assert.equal(pending.operationId, edit.operationId, 'the op id is durable before the call');
      assert.match(edit.operationId, /^op_[A-Za-z0-9_-]{6,32}$/);
      assert.ok(edit.ifVersion && edit.ifMeta && typeof edit.ifMeta.title === 'string', 'never an unconditional edit');
      const sent = { ...edit, sourceHash: digest(await readFile(edit.sourcePath, 'utf8')), visualHash: edit.visualPath ? digest(await readFile(edit.visualPath, 'utf8')) : null };
      remote.edits.push(sent);
      if (remote.beforeEdit) await remote.beforeEdit(sent);
      const item = remote.items.get(edit.itemId);
      if (remote.unsupported) return { status: 'unsupported', itemId: item.id, reason: 'this home does not know conditional edits' };
      if (remote.ops.has(edit.operationId)) return { status: 'replayed', itemId: item.id, versionId: remote.ops.get(edit.operationId), opId: edit.operationId, seq: 1, title: item.title, properties: { ...item.properties } };
      if (item.currentVersionId !== edit.ifVersion || item.title !== edit.ifMeta.title || JSON.stringify(Object.entries(item.properties).sort()) !== JSON.stringify(Object.entries(edit.ifMeta.properties).sort())) {
        return { status: 'conflict', itemId: item.id, currentVersionId: item.currentVersionId, expectedVersionId: edit.ifVersion, title: item.title, properties: { ...item.properties }, reason: 'it changed while this edit was on its way' };
      }
      const version = { id: `ver_edit_${remote.ops.size + 1}`, blobHash: sent.sourceHash, ...(sent.visualHash ? { visual: { blobHash: sent.visualHash } } : {}) };
      item.versions.push(version); item.currentVersionId = version.id;
      if (edit.title !== undefined) item.title = edit.title;
      item.properties = { ...item.properties, ...edit.properties };
      remote.ops.set(edit.operationId, version.id);
      if (remote.afterEdit) await remote.afterEdit(sent);
      return { status: 'applied', itemId: item.id, versionId: version.id, opId: edit.operationId, seq: 1, title: item.title, properties: { ...item.properties } };
    },
    prune: async (_binding, itemId, keep) => {
      remote.prunes.push({ itemId, keep });
      if (remote.pruneFails) throw new CanvasError('isocan transport', 'transport', 1);
      const item = remote.items.get(itemId), dropped = Math.max(0, item.versions.length - keep);
      item.versions = item.versions.slice(-keep);
      return { pruned: dropped ? [{ itemId, dropped }] : [], dropped, keep };
    },
  };
  // A binding the owner moved to live after one immutable publication.
  const goLive = async (options = {}) => {
    Object.assign(caps, { version: '0.1.0 (7bb1f4e, 2026-10-13)', conditionalWrites: true, retention: true });
    return canvasLive({ root, yes: true, ...options }, { transport });
  };
  const publish = (next, options = {}) => canvasSync({ root, cards: next, yes: true, ...options }, { transport });
  const pulse = async () => remote.items.get((await read(manifestPath(root))).items.pulse.itemId);
  const attach = () => canvasConnect({ root, canvas: `${home}/p/prj_acme`, audience: 'owner-only', yes: true }, { transport });
  return { root, remote, caps, transport, attach, goLive, publish, pulse };
}

test('connection previews are read-only; attachment persists a stable binding without changing working canvas or unrelated config', async t => {
  const f = await fixture(t);
  const options = { root: f.root, canvas: `${home}/p/prj_acme`, audience: 'owner-only' };
  const plan = await connect(options, { transport: f.transport });
  assert.equal(plan.exitCode, 3);
  await assert.rejects(read(manifestPath(f.root)), { code: 'ENOENT' });
  const connected = await f.attach();
  assert.equal(connected.data.binding.home, home);
  assert.equal(connected.data.binding.mode, 'immutable');
  assert.equal((await read(configPath(f.root))).custom, 'keep me');
  assert.equal(await readFile(join(f.root, '.isocan/project.json'), 'utf8'), '{"canvasId":"prj_human","home":"https://other.acme.test"}\n');
  assert.equal(f.remote.created, 0);
  await assert.rejects(f.attach(), { code: 'conflict' });
  assert.equal((await canvasDisconnect({ root: f.root })).exitCode, 3);
  assert.equal((await canvasDisconnect({ root: f.root, yes: true })).data.state, 'disabled');
  assert.equal((await canvasStatus({ root: f.root })).data.state, 'disabled');
  await assert.rejects(f.attach(), { code: 'conflict' });
  assert.equal((await canvasSync({ root: f.root, cards: cards(), yes: true }, { transport: f.transport })).data.state, 'disabled');
});

test('creation requires native groups, explicit owned private space and approved audience before any remote write', async t => {
  const f = await fixture(t);
  const opts = { root: f.root, create: true, title: 'Acme', home, spaceId: 'space_acme', audience: 'owner-only', yes: true };
  f.caps.createInSpace = false;
  assert.equal((await canvasConnect(opts, { transport: f.transport })).exitCode, 2);
  f.caps.createInSpace = true;
  f.remote.grants = [{ subject: 'link' }];
  await assert.rejects(canvasConnect(opts, { transport: f.transport }), { code: 'audience' });
  f.remote.grants = [];
  await assert.rejects(canvasConnect({ ...opts, audience: 'public' }, { transport: f.transport }), { exitCode: 2 });
  const wrongOwner = { ...f.transport, space: async () => ({ owner: 'actor_other', grants: [], space: { id: 'space_acme', createdBy: 'actor_other' } }) };
  await assert.rejects(canvasConnect(opts, { transport: wrongOwner }), { code: 'audience' });
  assert.equal(f.remote.created, 0);
  assert.equal((await canvasConnect(opts, { transport: f.transport })).data.state, 'connected');
  assert.equal(f.remote.created, 1);
});

test('ambiguous canvas creation is durable and cannot be retried after restart', async t => {
  const f = await fixture(t);
  f.remote.afterCreate = async () => { throw new CanvasError('isocan timeout', 'timeout', 1); };
  const options = { root: f.root, create: true, title: 'Acme', home, spaceId: 'space_acme', audience: 'owner-only', yes: true };
  await assert.rejects(canvasConnect(options, { transport: f.transport }), { code: 'timeout' });
  assert.equal((await canvasStatus({ root: f.root })).data.pending.kind, 'create-canvas');
  await assert.rejects(canvasConnect(options, { transport: { ...f.transport } }), { code: 'pending' });
  assert.equal(f.remote.created, 1);
});

test('immutable sync plans native groups and cards, verifies both faces, no-ops unchanged and preserves human layout/comments', async t => {
  const f = await fixture(t); await f.attach();
  const options = { root: f.root, cards: cards() };
  const planned = await canvasSync({ ...options, dryRun: true }, { transport: f.transport });
  assert.equal(planned.exitCode, 0);
  assert.equal(planned.data.changes.filter(c => c.action === 'create-group').length, 6);
  assert.equal(f.remote.groupCreates + f.remote.adds, 0);
  const first = await sync({ ...options, yes: true }, { transport: f.transport });
  assert.equal(first.data.state, 'published');
  assert.equal(f.remote.groupCreates, REGIONS.length);
  assert.equal(f.remote.adds, 2);
  const previous = await read(manifestPath(f.root));
  const pulse = f.remote.items.get(previous.items.pulse.itemId);
  pulse.x = 930; pulse.comments.push('Acme human note'); pulse.containerId = null;
  f.remote.items.set('itm_human', { id: 'itm_human', title: 'Human work' });
  const same = await canvasSync({ ...options, yes: true }, { transport: f.transport });
  assert.equal(same.data.state, 'unchanged');
  const next = cards(); next[1].source += 'New evidence.\n';
  await canvasSync({ root: f.root, cards: next, yes: true }, { transport: f.transport });
  assert.equal(f.remote.groupCreates, 6); assert.equal(f.remote.adds, 3);
  assert.equal(pulse.x, 930); assert.equal(pulse.containerId, null); assert.deepEqual(pulse.comments, ['Acme human note']);
  assert.ok(f.remote.items.has('itm_human'));
  const after = await read(manifestPath(f.root));
  assert.notEqual(after.items.pulse.itemId, previous.items.pulse.itemId);
  assert.equal(after.items.snapshot.itemId, previous.items.snapshot.itemId);
  assert.equal(after.receipts.filter(r => r.kind === 'add').length, 3);
});

test('partial acknowledged then ambiguous publication recovers by unique metadata and actual hashes, without duplicating cards', async t => {
  const f = await fixture(t); await f.attach();
  f.remote.afterAdd = async () => { if (f.remote.adds === 2) throw new CanvasError('timeout', 'timeout', 1); };
  const options = { root: f.root, cards: cards(), yes: true };
  await assert.rejects(canvasSync(options, { transport: f.transport }), { code: 'timeout' });
  const partial = await read(manifestPath(f.root));
  assert.ok(partial.items.snapshot); assert.equal(partial.pending.key, 'pulse'); assert.equal(partial.lastSuccess, undefined);
  assert.equal((await canvasSync({ ...options, yes: false }, { transport: f.transport })).data.state, 'pending');
  f.remote.afterAdd = null;
  const resumed = await canvasSync(options, { transport: { ...f.transport } });
  assert.equal(resumed.data.state, 'unchanged');
  assert.ok(resumed.data.lastSuccess); assert.equal(f.remote.adds, 2);
  assert.equal((await read(manifestPath(f.root))).pending, null);
});

test('ambiguous groups recover by operation note and verified content, not title, preserving stable region ids', async t => {
  const f = await fixture(t); await f.attach();
  f.remote.afterGroup = async () => { throw new CanvasError('timeout', 'timeout', 1); };
  const options = { root: f.root, cards: cards(), yes: true };
  await assert.rejects(canvasSync(options, { transport: f.transport }), { code: 'timeout' });
  assert.equal((await read(manifestPath(f.root))).pending.kind, 'group');
  f.remote.afterGroup = null;
  await canvasSync(options, { transport: { ...f.transport } });
  assert.equal(f.remote.groupCreates, 6);
  assert.equal(Object.keys((await read(manifestPath(f.root))).groups).length, 6);
});

test('zero, duplicate or edited recovery matches never authorize a retry', async t => {
  for (const kind of ['zero', 'duplicate', 'edited']) await t.test(kind, async t => {
    const f = await fixture(t); await f.attach();
    if (kind === 'zero') f.remote.beforeAdd = async () => { throw new CanvasError('auth', 'auth', 1); };
    else f.remote.afterAdd = async () => { throw new CanvasError('timeout', 'timeout', 1); };
    const options = { root: f.root, cards: cards(), yes: true };
    await assert.rejects(canvasSync(options, { transport: f.transport }));
    if (kind === 'duplicate') { const duplicate = structuredClone(f.remote.items.get('itm_card_1')); duplicate.id = 'itm_duplicate'; f.remote.items.set(duplicate.id, duplicate); }
    if (kind === 'edited') f.remote.items.get('itm_card_1').versions[0].blobHash = digest('Human edit');
    f.remote.beforeAdd = f.remote.afterAdd = null;
    await assert.rejects(canvasSync(options, { transport: { ...f.transport } }), { code: 'pending' });
    assert.equal(f.remote.adds, 1);
  });
});

test('human content edits, expired identity and changed audience preserve the last successful receipt', async t => {
  const f = await fixture(t); await f.attach();
  await canvasSync({ root: f.root, cards: cards(), yes: true }, { transport: f.transport });
  const before = await read(manifestPath(f.root));
  const changed = cards(); changed[0].source += 'Changed\n';
  f.remote.actor = 'actor_other';
  await assert.rejects(canvasSync({ root: f.root, cards: changed, yes: true }, { transport: f.transport }), { code: 'auth' });
  f.remote.actor = 'actor_acme'; f.remote.grants = [{ subject: 'link' }];
  await assert.rejects(canvasSync({ root: f.root, cards: changed, yes: true }, { transport: f.transport }), { code: 'audience' });
  f.remote.grants = [];
  f.remote.items.get(before.items.pulse.itemId).currentVersionId = 'ver_human';
  await assert.rejects(canvasSync({ root: f.root, cards: changed, yes: true }, { transport: f.transport }), { code: 'conflict' });
  assert.deepEqual((await read(manifestPath(f.root))).lastSuccess, before.lastSuccess);
  assert.equal(f.remote.adds, 2);
});

test('writer lock, lost receipts, symlink state, unsafe URLs and legacy canvases fail without creating replacements', async t => {
  const f = await fixture(t);
  await assert.rejects(canvasConnect({ root: f.root, canvas: `${home}/p/prj_acme#pass=secret`, audience: 'owner-only', yes: true }, { transport: f.transport }), /passes/);
  f.remote.native = false;
  await assert.rejects(f.attach(), { code: 'unsupported' });
  f.remote.native = true; await f.attach();
  const lock = join(f.root, '.keel/canvas/sync.lock');
  await writeFile(lock, '{}');
  await assert.rejects(canvasSync({ root: f.root, cards: cards(), yes: true }, { transport: f.transport }), { code: 'locked' });
  await rm(lock);
  await rm(manifestPath(f.root));
  await assert.rejects(canvasSync({ root: f.root, cards: cards(), yes: true }, { transport: f.transport }), { code: 'state' });
  await symlink(configPath(f.root), manifestPath(f.root));
  await assert.rejects(canvasStatus({ root: f.root }), { code: 'state' });
  assert.equal(f.remote.created + f.remote.adds + f.remote.groupCreates, 0);
});

test('public CLI transport uses argument arrays, exact IDs, per-call direct home and bounded sanitized failures', async t => {
  const f = await fixture(t);
  const executable = join(f.root, 'acme-isocan');
  const trace = join(f.root, 'trace.json');
  await writeFile(executable, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nconst args=process.argv.slice(2);\nwriteFileSync(process.env.ACME_TRACE, JSON.stringify({args, home:process.env.ISOCAN_DIRECT}));\nif(process.env.ACME_MODE === 'timeout') { setInterval(()=>{},1000); }\nelse if(process.env.ACME_MODE === 'auth') { console.error('401 secret-token=DO-NOT-PRINT'); process.exitCode=1; }\nelse if(process.env.ACME_MODE === 'invalid') { console.log('secret-token=DO-NOT-PRINT'); }\nelse if(args.includes('--version')) console.log('0.1.0 (b61f7c1, 2026-10-08)');\nelse if(args.includes('--help')) console.log('--json --canvas --visual --prop --space --note new ls');\nelse console.log(JSON.stringify({ itemId:'itm_acme', canvasId:'prj_acme' }));\n`, { mode: 0o755 });
  const env = { ...process.env, ACME_TRACE: trace, ISOCAN_DIRECT: 'https://wrong.acme.test' };
  const transport = createIsocanTransport({ executable, cwd: f.root, env, timeoutMs: 3000 });
  const caps = await transport.capabilities();
  assert.equal(caps.conditionalWrites, false); assert.equal(caps.groups, true);
  await transport.space(home, 'space_acme_selected');
  assert.deepEqual(await read(trace), { args: ['--json', 'share', '--space', 'space_acme_selected'], home }, 'space admission queries the exact selected space at its explicit home');
  const groupHome = 'https://groups.acme.test';
  await transport.groups({ home: groupHome, canvasId: 'prj_acme_selected' });
  assert.deepEqual(await read(trace), { args: ['--json', '--canvas', 'prj_acme_selected', 'canvas', 'group', 'ls'], home: groupHome }, 'group recovery lists the exact canvas at this call\'s home');
  await transport.create({ home, title: 'Acme $(not-a-command)', spaceId: 'space_acme', operationId: 'op_acme', projectKey: 'project_acme' });
  const create = await read(trace);
  assert.equal(create.home, home);
  assert.deepEqual(create.args.slice(0, 6), ['--json', 'canvas', 'create', 'Acme $(not-a-command)', '--space', 'space_acme']);
  await transport.add({ home, canvasId: 'prj_acme' }, { sourcePath: '/tmp/Acme source.md', visualPath: '/tmp/Acme visual.html', title: 'Acme', groupId: 'itm_group', properties: { 'keel.operation': 'op_acme' } });
  const add = await read(trace);
  assert.deepEqual(add.args.slice(0, 4), ['--json', '--canvas', 'prj_acme', 'add']);
  assert.equal(add.home, home); assert.ok(add.args.includes('/tmp/Acme source.md')); assert.ok(add.args.includes('--in'));
  for (const mode of ['auth', 'invalid', 'timeout']) {
    const broken = createIsocanTransport({ executable, cwd: f.root, env: { ...env, ACME_MODE: mode }, timeoutMs: mode === 'timeout' ? 100 : 3000 });
    await assert.rejects(broken.identity(home), error => {
      assert.equal(error.exitCode, 1); assert.doesNotMatch(error.message, /DO-NOT-PRINT/);
      assert.equal(error.code, { auth: 'auth', invalid: 'invalid-json', timeout: 'timeout' }[mode]); return true;
    });
  }
});

test('real collector → renderer → sync ignores only collection clocks and publishes source changes', async t => {
  const f = await fixture(t); await f.attach();
  const first = await snapshot({ root: f.root, now: '2026-10-08T12:00:00Z' });
  const rendered = renderSnapshot(first);
  assert.ok(rendered.cards.some(c => c.group === 'activity'));
  assert.ok(rendered.cards.some(c => c.markdown && c.html));
  const publication = await sync({ root: f.root, snapshot: first, yes: true }, { transport: f.transport });
  assert.equal(publication.data.state, 'published');
  const initialAdds = f.remote.adds;
  const initial = await read(manifestPath(f.root));
  assert.ok(initial.items.snapshot);
  assert.equal(initial.history.length, 1);
  const savedPath = join(f.root, '.keel/canvas/history', initial.lastSuccess.snapshot.path);
  const savedBytes = await readFile(savedPath, 'utf8');
  assert.equal(JSON.parse(savedBytes).generatedAt, first.generatedAt);
  assert.equal(initial.receipts.filter(r => r.kind === 'add').at(-1).key, 'pulse');
  const again = await snapshot({ root: f.root, now: '2026-10-08T12:30:00Z' });
  assert.notEqual(again.generatedAt, first.generatedAt);
  assert.equal((await sync({ root: f.root, snapshot: again, yes: true }, { transport: f.transport })).data.state, 'unchanged');
  assert.equal(f.remote.adds, initialAdds);
  assert.equal(f.remote.groupCreates, 6);
  assert.equal((await read(manifestPath(f.root))).history.length, 1);
  const config = await read(configPath(f.root));
  await writeFile(configPath(f.root), JSON.stringify({ ...config, name: 'Acme renamed' }));
  const changed = await snapshot({ root: f.root, now: '2026-10-08T13:00:00Z' });
  assert.equal((await sync({ root: f.root, snapshot: changed, yes: true }, { transport: f.transport })).data.state, 'published');
  assert.ok(f.remote.adds > initialAdds);
  const updated = await read(manifestPath(f.root));
  assert.notEqual(updated.items.snapshot.itemId, initial.items.snapshot.itemId);
  assert.equal(updated.history.length, 2);
  assert.equal(await readFile(savedPath, 'utf8'), savedBytes);
  const enriched = await read(join(f.root, '.keel/canvas/history', updated.lastSuccess.snapshot.path));
  assert.equal(enriched.history.firstObservedAt, first.generatedAt, 'persisted historical origins are factual');
  assert.equal(enriched.history.snapshots, 1, 'saved observations feed the real collector reducer');
  const changedAdds = f.remote.adds;
  const unchangedAfterHistory = await snapshot({ root: f.root, now: '2026-10-08T13:30:00Z' });
  assert.equal((await sync({ root: f.root, snapshot: unchangedAfterHistory, yes: true }, { transport: f.transport })).data.state, 'unchanged');
  assert.equal(f.remote.adds, changedAdds, 'saving enriched history must not feed back into another publication');
  assert.equal((await read(manifestPath(f.root))).history.length, 2);
  await assert.rejects(sync({ root: f.root, snapshot: { ...changed, project: { ...changed.project, key: 'other-acme' } }, yes: true }, { transport: f.transport }), { code: 'conflict' });
});

test('history is integrity-checked, belongs to the binding, and is pruned locally after 90 days only on success', async t => {
  const f = await fixture(t); await f.attach();
  const earlier = await snapshot({ root: f.root, now: '2026-06-01T12:00:00Z' });
  await sync({ root: f.root, snapshot: earlier, yes: true }, { transport: f.transport });
  const first = await read(manifestPath(f.root));
  const oldFile = join(f.root, '.keel/canvas/history', first.lastSuccess.snapshot.path);
  const bytes = await readFile(oldFile, 'utf8');
  await writeFile(oldFile, bytes + ' ');
  await assert.rejects(loadCanvasHistory({ root: f.root, manifest: first, projectKey: earlier.project.key, at: '2026-06-02T12:00:00Z' }), { code: 'conflict' });
  await writeFile(oldFile, bytes);
  const config = await read(configPath(f.root));
  await writeFile(configPath(f.root), JSON.stringify({ ...config, name: 'Acme autumn' }));
  await sync({ root: f.root, snapshot: await snapshot({ root: f.root, now: '2026-10-08T12:00:00Z' }), yes: true }, { transport: f.transport });
  const next = await read(manifestPath(f.root));
  assert.equal(next.history.length, 1);
  await assert.rejects(readFile(oldFile), { code: 'ENOENT' });
  assert.ok(f.remote.items.has(first.items.snapshot.itemId), 'retention never deletes remote cards');
});

test('successful saved source snapshots become a real accepted Loop cohort on the next changed run', async t => {
  const f = await fixture(t); await f.attach();
  await mkdir(join(f.root, 'docs/loop'), { recursive: true });
  const finding = decision => `---\ntitle: Acme export fails\nloop: acme-export\ndecision: ${decision}\nsince: 2026-08-30\nrank: next\nloop_rank: P1\n---\n# Acme finding\n`;
  await writeFile(join(f.root, 'docs/loop/acme.md'), finding('accepted'));
  const earlier = await snapshot({ root: f.root, now: '2026-09-01T12:00:00Z' });
  await sync({ root: f.root, snapshot: earlier, yes: true }, { transport: f.transport });
  await writeFile(join(f.root, 'docs/loop/acme.md'), finding('done'));
  const current = await snapshot({ root: f.root, now: '2026-10-08T12:00:00Z' });
  assert.equal(current.metrics.find(m => m.id === 'loop-completion-rate').value, null);
  await sync({ root: f.root, snapshot: current, yes: true }, { transport: f.transport });
  const manifest = await read(manifestPath(f.root));
  const enriched = await read(join(f.root, '.keel/canvas/history', manifest.lastSuccess.snapshot.path));
  const rate = enriched.metrics.find(m => m.id === 'loop-completion-rate');
  assert.equal(rate.value, 1); assert.equal(rate.denominator, 1);
  assert.equal(rate.baselineAt, earlier.generatedAt);
  const observation = enriched.observations.find(o => o.entity === 'loop:acme-export');
  assert.equal(observation.occurredAt, '2026-08-30', 'authored occurrence dates are never normalized');
});

test('resource scanning allows renderer code but refuses actual external/local resource markup', async t => {
  const f = await fixture(t); await f.attach();
  const safe = { key: 'pulse', title: 'Acme', source: '# Acme new URL(...)', visual: '<script>const u = new URL("https://acme.test"); const nope = ![1].includes(2);</script><p>Acme</p>' };
  assert.equal((await canvasSync({ root: f.root, cards: [safe], dryRun: true }, { transport: f.transport })).exitCode, 0);
  for (const visual of ['<img src="../private.png">', '<img src=https://acme.test/a.png>', '<script src="https://acme.test/a.js"></script>', '<style>p{background:url(../private.png)}</style>', '<p style="background:url(https://acme.test/a.png)">Acme</p>']) {
    await assert.rejects(canvasSync({ root: f.root, cards: [{ ...safe, visual }], yes: true }, { transport: f.transport }), { exitCode: 2 });
  }
  assert.equal(f.remote.adds, 0);
});

// ---- Live mode: one stable pulse advanced by isocan's conditional edit ----
const pulseAt = week => { const next = cards(); next[1].source += `Week ${week}.\n`; return next; };
const liveFixture = async t => {
  const f = await fixture(t); await f.attach();
  await f.publish(cards());
  // isocan itself tags a file-backed card on add; adoption must carry that.
  (await f.pulse()).properties = { ...(await f.pulse()).properties, file: 'acme.md' };
  return f;
};
const snapshotOf = remote => JSON.stringify([...remote.items.values()].map(i => [i.id, i.title, i.currentVersionId, i.versions.length, i.properties]));

test('an immutable binding is untouched by a CLI that can edit conditionally: still one new card per change, no edit and no prune', async t => {
  const f = await liveFixture(t);
  Object.assign(f.caps, { version: '0.1.0 (7bb1f4e, 2026-10-13)', conditionalWrites: true, retention: true });
  const before = await read(manifestPath(f.root));
  const out = await f.publish(pulseAt(41));
  assert.equal(out.data.state, 'published');
  assert.deepEqual(out.data.changes.map(c => c.action), ['add-immutable']);
  assert.deepEqual(out.data.warnings.slice(0, LIMITATIONS.length), LIMITATIONS);
  assert.equal(out.data.live, undefined);
  assert.equal(f.remote.adds, 3); assert.equal(f.remote.edits.length, 0); assert.equal(f.remote.prunes.length, 0);
  const after = await read(manifestPath(f.root));
  assert.notEqual(after.items.pulse.itemId, before.items.pulse.itemId);
  assert.equal(after.items.pulse.live, undefined);
  assert.equal((await read(configPath(f.root))).canvas.mode, 'immutable');
});

test('moving to live is previewed and writes only the binding; the first live publish adopts the journal\'s pulse by unique match and edits it in place (applied)', async t => {
  const f = await liveFixture(t);
  Object.assign(f.caps, { version: '0.1.0 (7bb1f4e, 2026-10-13)', conditionalWrites: true, retention: true });
  const remoteBefore = snapshotOf(f.remote), journal = await read(manifestPath(f.root));
  const preview = await canvasLive({ root: f.root }, { transport: f.transport });
  assert.equal(preview.exitCode, 3); assert.equal(preview.data.state, 'planned');
  assert.deepEqual(preview.data.changes.map(c => c.action), ['set-mode', 'adopt-live-on-first-sync']);
  assert.equal(preview.data.changes[1].itemId, journal.items.pulse.itemId);
  assert.match(preview.data.warnings.join('\n'), /No atomic multi-card publication/);
  assert.equal((await read(configPath(f.root))).canvas.mode, 'immutable');
  const applied = await f.goLive();
  assert.equal(applied.data.state, 'live');
  assert.equal((await read(configPath(f.root))).canvas.mode, 'live');
  assert.equal((await read(configPath(f.root))).custom, 'keep me');
  assert.equal(snapshotOf(f.remote), remoteBefore, 'changing mode sends no remote write');
  assert.deepEqual(await read(manifestPath(f.root)), journal);
  assert.equal((await canvasLive({ root: f.root, yes: true }, { transport: f.transport })).data.state, 'unchanged');

  const pulse = await f.pulse(); pulse.x = 930; pulse.comments.push('Acme human note');
  const planned = await canvasSync({ root: f.root, cards: pulseAt(41), dryRun: true }, { transport: f.transport });
  assert.deepEqual(planned.data.changes.map(c => [c.action, c.itemId, c.ifVersion]), [['adopt-live', pulse.id, journal.items.pulse.versionId]]);
  assert.equal(f.remote.edits.length, 0);
  const first = await f.publish(pulseAt(41));
  assert.equal(first.data.state, 'published'); assert.equal(first.exitCode, 0);
  assert.deepEqual(first.data.live.map(l => [l.key, l.itemId, l.status]), [['pulse', pulse.id, 'applied']]);
  assert.equal(f.remote.adds, 2, 'no second pulse card');
  assert.equal(f.remote.edits.length, 1);
  const sent = f.remote.edits[0];
  assert.equal(sent.ifVersion, journal.items.pulse.versionId);
  assert.equal(sent.ifMeta.title, 'Acme pulse');
  assert.equal(sent.ifMeta.properties.file, 'acme.md', 'the expected metadata is what the card carries, not only what keel set');
  assert.equal(sent.title, undefined, 'an unchanged title is not rewritten');
  const after = await read(manifestPath(f.root));
  assert.equal(after.items.pulse.itemId, journal.items.pulse.itemId, 'one stable item id');
  assert.equal(after.items.pulse.live, true); assert.equal(after.items.pulse.status, 'applied');
  assert.equal(after.items.pulse.versionId, pulse.currentVersionId);
  assert.equal(after.items.pulse.content, undefined, 'bytes never outlive the pending receipt');
  assert.equal(after.pending, null);
  assert.equal(after.lastSuccess.items.find(i => i.key === 'pulse').itemId, pulse.id);
  assert.equal(pulse.versions.length, 2); assert.equal(pulse.x, 930); assert.deepEqual(pulse.comments, ['Acme human note']);

  assert.equal((await f.publish(pulseAt(41))).data.state, 'unchanged');
  assert.equal(f.remote.edits.length, 1);
  const retitled = pulseAt(42); retitled[1].title = 'Acme pulse, week 42';
  const second = await f.publish(retitled);
  assert.equal(second.data.state, 'published');
  assert.deepEqual(second.data.changes.map(c => c.action), ['edit-live']);
  assert.equal(f.remote.edits[1].ifVersion, after.items.pulse.versionId, 'the next edit is conditional on the version keel recorded');
  assert.deepEqual(f.remote.edits[1].ifMeta, after.items.pulse.meta);
  assert.equal(f.remote.edits[1].ifMeta.properties['keel.operation'], sent.operationId);
  assert.equal(f.remote.edits[1].title, 'Acme pulse, week 42', 'title rides in the same act');
  assert.notEqual(f.remote.edits[1].operationId, sent.operationId, 'a different edit never reuses an op id');
  assert.equal(pulse.title, 'Acme pulse, week 42'); assert.equal(pulse.versions.length, 3); assert.equal(f.remote.adds, 2);
  assert.equal(f.remote.prunes.length, 0, 'retention is off unless configured');
});

test('a binding moved to live before its first publication creates exactly one pulse, then edits that one', async t => {
  const f = await fixture(t); await f.attach();
  const preview = await canvasLive({ root: f.root }, { transport: { ...f.transport, capabilities: async () => ({ ...f.caps, conditionalWrites: true, retention: true }) } });
  assert.deepEqual(preview.data.changes.map(c => c.action), ['set-mode', 'create-live-on-first-sync']);
  await f.goLive();
  const first = await f.publish(cards());
  assert.ok(first.data.changes.some(c => c.action === 'add-live' && c.key === 'pulse'));
  assert.equal(f.remote.adds, 2); assert.equal(f.remote.edits.length, 0);
  const created = (await read(manifestPath(f.root))).items.pulse;
  assert.equal(created.live, true); assert.deepEqual(created.meta, { title: 'Acme pulse', properties: (await f.pulse()).properties });
  await f.publish(pulseAt(41));
  assert.equal(f.remote.adds, 2); assert.equal(f.remote.edits.length, 1);
  assert.equal((await read(manifestPath(f.root))).items.pulse.itemId, created.itemId);
});

test('adoption refuses duplicate or changed matches without creating or editing a card', async t => {
  for (const kind of ['duplicate', 'changed']) await t.test(kind, async t => {
    const f = await liveFixture(t);
    await f.goLive();
    const pulse = await f.pulse();
    if (kind === 'duplicate') f.remote.items.set('itm_duplicate', { ...structuredClone(pulse), id: 'itm_duplicate' });
    else pulse.title = 'A person renamed this';
    const before = snapshotOf(f.remote);
    await assert.rejects(f.publish(pulseAt(41)), { code: 'conflict' });
    assert.equal(snapshotOf(f.remote), before); assert.equal(f.remote.edits.length, 0); assert.equal(f.remote.adds, 2);
    if (kind === 'duplicate') {
      await canvasLive({ root: f.root, off: true, yes: true }, { transport: f.transport });
      await assert.rejects(canvasLive({ root: f.root, yes: true }, { transport: f.transport }), { code: 'conflict' });
      assert.equal((await read(configPath(f.root))).canvas.mode, 'immutable');
    }
  });
});

test('conflict by version: a person\'s edit wins, nothing more is written, the refusal is recorded and stays until the owner re-bases', async t => {
  const f = await liveFixture(t); await f.goLive();
  await f.publish(pulseAt(41));
  const pulse = await f.pulse(), base = pulse.currentVersionId;
  // The person lands their version after keel's read and before its edit.
  f.remote.beforeEdit = async () => { pulse.versions.push({ id: 'ver_person', blobHash: digest('A person wrote this') }); pulse.currentVersionId = 'ver_person'; };
  const next = pulseAt(42); next[0].source += 'New evidence.\n';
  const refused = await f.publish(next);
  f.remote.beforeEdit = null;
  assert.equal(refused.data.state, 'conflict'); assert.equal(refused.exitCode, 1);
  assert.equal(refused.data.attention.length, 1);
  const seen = refused.data.attention[0];
  assert.deepEqual([seen.key, seen.itemId, seen.reason, seen.seen, seen.expectedVersionId, seen.currentVersionId, seen.title], ['pulse', pulse.id, 'version', 'edit', base, 'ver_person', 'Acme pulse']);
  assert.deepEqual(seen.properties, pulse.properties);
  assert.match(seen.next, /keel canvas rebase --onto ver_person --yes/);
  assert.match(refused.text, /conflict/);
  assert.equal(pulse.currentVersionId, 'ver_person'); assert.equal(pulse.versions.length, 3, 'keel stacked nothing over the person');
  const journal = await read(manifestPath(f.root));
  assert.equal(journal.pending, null);
  assert.equal(journal.items.pulse.versionId, base, 'the person\'s version did not become the base');
  assert.equal(journal.items.pulse.conflict.currentVersionId, 'ver_person');
  assert.equal(journal.receipts.at(-1).state, 'refused'); assert.equal(journal.receipts.at(-1).content, undefined);
  const edits = f.remote.edits.length, adds = f.remote.adds, frozen = snapshotOf(f.remote);
  // Sticky: later syncs, changed content, even the person reverting: no call.
  for (const again of [next, pulseAt(43)]) {
    const still = await f.publish(again);
    assert.equal(still.data.state, 'conflict'); assert.equal(still.exitCode, 1);
    assert.equal(still.data.attention[0].currentVersionId, 'ver_person');
  }
  pulse.currentVersionId = base;
  assert.equal((await f.publish(next)).data.state, 'conflict');
  pulse.currentVersionId = 'ver_person';
  assert.equal(f.remote.edits.length, edits); assert.equal(f.remote.adds, adds); assert.equal(snapshotOf(f.remote), frozen);
  const status = await canvasStatus({ root: f.root });
  assert.equal(status.data.state, 'conflict'); assert.equal(status.exitCode, 1); assert.equal(status.data.attention[0].reason, 'version');

  // The owner looks, then says so, naming the version they looked at.
  const preview = await canvasRebase({ root: f.root }, { transport: f.transport });
  assert.equal(preview.exitCode, 3);
  assert.equal(preview.data.changes[0].current.versionId, 'ver_person'); assert.equal(preview.data.changes[0].recorded.versionId, base);
  assert.equal((await read(manifestPath(f.root))).items.pulse.conflict.currentVersionId, 'ver_person', 'a preview re-bases nothing');
  await assert.rejects(canvasRebase({ root: f.root, yes: true, onto: base }, { transport: f.transport }), { code: 'conflict' });
  const rebased = await canvasRebase({ root: f.root, yes: true, onto: 'ver_person' }, { transport: f.transport });
  assert.equal(rebased.data.state, 'rebased');
  assert.equal(snapshotOf(f.remote), frozen, 're-basing writes nothing remote');
  const resumed = await f.publish(next);
  assert.equal(resumed.data.state, 'published');
  assert.equal(f.remote.edits.at(-1).ifVersion, 'ver_person');
  assert.ok(pulse.versions.some(v => v.id === 'ver_person'), 'the person\'s version stays in the stack');
  assert.equal((await canvasStatus({ root: f.root })).data.state, 'connected');
  assert.equal((await canvasRebase({ root: f.root }, { transport: f.transport })).data.state, 'unchanged');
});

test('conflict by metadata: a rename or re-tag refuses even though the version is the one keel read', async t => {
  await t.test('caught by the home, mid-edit', async t => {
    const f = await liveFixture(t); await f.goLive();
    await f.publish(pulseAt(41));
    const pulse = await f.pulse(), base = pulse.currentVersionId, versions = pulse.versions.length;
    f.remote.beforeEdit = async () => { pulse.title = 'Dion\'s pulse'; };
    const refused = await f.publish(pulseAt(42));
    assert.equal(refused.data.state, 'conflict'); assert.equal(refused.exitCode, 1);
    const seen = refused.data.attention[0];
    assert.deepEqual([seen.reason, seen.seen, seen.title, seen.currentVersionId, seen.expectedVersionId], ['metadata', 'edit', 'Dion\'s pulse', base, base]);
    assert.equal(pulse.versions.length, versions); assert.equal(pulse.title, 'Dion\'s pulse');
    assert.equal((await read(manifestPath(f.root))).items.pulse.meta.title, 'Acme pulse', 'the rename was recorded as seen, not adopted');
  });
  await t.test('seen on read: no edit is even attempted, and no card is added around the refused pulse', async t => {
    const f = await liveFixture(t); await f.goLive();
    await f.publish(pulseAt(41));
    const pulse = await f.pulse();
    pulse.properties = { ...pulse.properties, reviewed: 'yes' };
    const edits = f.remote.edits.length, adds = f.remote.adds;
    const next = pulseAt(42); next[0].source += 'New evidence.\n';
    const dry = await canvasSync({ root: f.root, cards: next, dryRun: true }, { transport: f.transport });
    assert.equal(dry.data.state, 'conflict'); assert.equal(dry.exitCode, 1);
    assert.equal((await read(manifestPath(f.root))).items.pulse.conflict, undefined, 'a preview records nothing');
    const refused = await f.publish(next);
    assert.deepEqual([refused.data.state, refused.data.attention[0].reason, refused.data.attention[0].seen, refused.data.attention[0].properties.reviewed], ['conflict', 'metadata', 'read', 'yes']);
    assert.equal(f.remote.edits.length, edits); assert.equal(f.remote.adds, adds);
    assert.equal(pulse.properties.reviewed, 'yes');
  });
});

test('an ambiguous first attempt keeps its receipt and op id; the retry is the same act and resolves to replayed, applied or conflict', async t => {
  for (const kind of ['landed-timeout', 'landed-invalid-json', 'never-arrived', 'person-first']) await t.test(kind, async t => {
    const f = await liveFixture(t); await f.goLive();
    const pulse = await f.pulse(), versions = pulse.versions.length;
    const lost = new CanvasError(kind, kind === 'landed-invalid-json' ? 'invalid-json' : 'timeout', 1);
    if (kind.startsWith('landed')) f.remote.afterEdit = async () => { throw lost; };
    else f.remote.beforeEdit = async () => { throw lost; };
    await assert.rejects(f.publish(pulseAt(41)), { code: lost.code });
    f.remote.afterEdit = f.remote.beforeEdit = null;
    const pending = (await read(manifestPath(f.root))).pending;
    assert.equal(pending.kind, 'edit'); assert.equal(pending.state, 'pending');
    assert.equal(pending.operationId, f.remote.edits[0].operationId);
    assert.equal(digest(pending.content.source), f.remote.edits[0].sourceHash);
    const status = await canvasStatus({ root: f.root });
    assert.equal(status.data.state, 'pending'); assert.equal(status.exitCode, 1); assert.equal(status.data.pending.content, undefined);
    const idle = await canvasSync({ root: f.root, cards: pulseAt(41) }, { transport: f.transport });
    assert.equal(idle.data.state, 'pending'); assert.equal(idle.data.pending.content, undefined, 'card bytes are not echoed');
    assert.equal(f.remote.edits.length, 1, 'no retry without --yes');
    if (kind === 'person-first') { pulse.versions.push({ id: 'ver_person', blobHash: digest('A person') }); pulse.currentVersionId = 'ver_person'; }
    // The next run has newer content. The retry still sends the recorded act.
    const out = await f.publish(pulseAt(42));
    const retry = f.remote.edits[1];
    assert.equal(retry.operationId, pending.operationId, 'the retry reuses the durable op id');
    assert.deepEqual([retry.ifVersion, retry.ifMeta, retry.sourceHash, retry.visualHash], [pending.ifVersion, pending.ifMeta, pending.sourceHash, pending.visualHash]);
    if (kind === 'person-first') {
      assert.equal(out.data.state, 'conflict'); assert.equal(out.data.attention[0].currentVersionId, 'ver_person');
      assert.equal(f.remote.edits.length, 2); assert.equal(pulse.versions.length, versions + 1, 'only the person\'s version');
      return;
    }
    assert.equal(out.data.state, 'published'); assert.equal(out.exitCode, 0);
    assert.deepEqual(out.data.live.map(l => l.status), [kind === 'never-arrived' ? 'applied' : 'replayed', 'applied']);
    assert.equal(f.remote.edits.length, 3);
    assert.notEqual(f.remote.edits[2].operationId, pending.operationId, 'the newer content is a different edit with its own op id');
    assert.equal(f.remote.edits[2].ifVersion, f.remote.ops.get(pending.operationId), 'and it is conditional on the version that landed');
    assert.equal(pulse.versions.length, versions + 2, 'the retry stacked nothing twice');
    const journal = await read(manifestPath(f.root));
    assert.equal(journal.pending, null);
    assert.deepEqual(journal.receipts.filter(r => r.kind === 'edit').map(r => [r.status, r.versionId]), [[kind === 'never-arrived' ? 'applied' : 'replayed', f.remote.ops.get(pending.operationId)], ['applied', pulse.currentVersionId]]);
  });
});

test('an unsupported home writes nothing, tries nothing else, and leaves the binding immutable; an unable CLI build refuses live', async t => {
  const f = await liveFixture(t);
  f.caps.version = '0.1.0 (1565e50, 2026-10-10)';
  const old = await canvasLive({ root: f.root, yes: true }, { transport: f.transport });
  assert.equal(old.data.state, 'unsupported'); assert.equal(old.exitCode, 2);
  assert.equal((await read(configPath(f.root))).canvas.mode, 'immutable');
  await f.goLive();
  f.remote.unsupported = true;
  const before = snapshotOf(f.remote), journal = await read(manifestPath(f.root));
  const out = await f.publish(pulseAt(41));
  assert.equal(out.data.state, 'unsupported'); assert.equal(out.exitCode, 2); assert.equal(out.data.mode, 'immutable');
  assert.match(out.data.warnings.join('\n'), /does not know isocan's conditional edit\. Nothing was written and no unconditional edit was tried/);
  assert.equal(snapshotOf(f.remote), before); assert.equal(f.remote.adds, 2); assert.equal(f.remote.edits.length, 1);
  assert.equal((await read(configPath(f.root))).canvas.mode, 'immutable');
  assert.equal((await read(configPath(f.root))).custom, 'keep me');
  const after = await read(manifestPath(f.root));
  assert.equal(after.pending, null); assert.deepEqual(after.items, journal.items);
  assert.deepEqual([after.receipts.at(-1).state, after.receipts.at(-1).status], ['refused', 'unsupported']);
  // Immutable mode works exactly as before, from the next sync on.
  const next = await f.publish(pulseAt(41));
  assert.deepEqual(next.data.changes.map(c => c.action), ['add-immutable']);
  assert.equal(f.remote.adds, 3); assert.equal(f.remote.edits.length, 1);
  // A live binding handed an inspected build with no conditional edit.
  const g = await liveFixture(t); await g.goLive();
  Object.assign(g.caps, { conditionalWrites: false, retention: false });
  const frozen = snapshotOf(g.remote);
  await assert.rejects(g.publish(pulseAt(41)), { code: 'unsupported', exitCode: 2 });
  assert.equal(snapshotOf(g.remote), frozen); assert.equal(g.remote.adds, 2); assert.equal(g.remote.edits.length, 0);
  assert.equal((await read(configPath(g.root))).canvas.mode, 'live', 'a wrong tool does not silently change the owner\'s choice');
});

test('retention is off unless configured, prunes only the live card after a confirmed edit, and a failing prune is reported, never fatal', async t => {
  const f = await liveFixture(t); await f.goLive();
  await f.publish(pulseAt(41));
  assert.equal(f.remote.prunes.length, 0);
  await assert.rejects(canvasLive({ root: f.root, keep: 1, yes: true }, { transport: f.transport }), { exitCode: 2 });
  const preview = await canvasLive({ root: f.root, keep: 2 }, { transport: f.transport });
  assert.equal(preview.exitCode, 3); assert.deepEqual(preview.data.changes, [{ action: 'set-retention', from: null, to: 2 }]);
  await f.goLive({ keep: 2 });
  assert.equal((await read(configPath(f.root))).canvas.keepVersions, 2);
  const pulse = await f.pulse();
  const kept = await f.publish(pulseAt(42));
  assert.equal(kept.data.state, 'published');
  assert.deepEqual(f.remote.prunes, [{ itemId: pulse.id, keep: 2 }]);
  assert.deepEqual(kept.data.retention, [{ key: 'pulse', itemId: pulse.id, keep: 2, dropped: 1 }]);
  assert.equal(pulse.versions.length, 2); assert.equal(pulse.versions.at(-1).id, pulse.currentVersionId);
  f.remote.pruneFails = true;
  const failing = await f.publish(pulseAt(43));
  assert.equal(failing.data.state, 'published'); assert.equal(failing.exitCode, 0);
  assert.deepEqual(failing.data.retention, [{ key: 'pulse', itemId: pulse.id, keep: 2, error: 'transport' }]);
  assert.match(failing.data.warnings.join('\n'), /Retention failed for pulse \(transport\); the publication stands/);
  assert.equal(pulse.versions.length, 3);
  assert.equal((await read(manifestPath(f.root))).lastSuccess.items.find(i => i.key === 'pulse').itemId, pulse.id);
  f.remote.pruneFails = false;
  // A refusal is not a confirmed edit: nothing is pruned beside a person's work.
  f.remote.beforeEdit = async () => { pulse.title = 'A person renamed this'; };
  const prunes = f.remote.prunes.length;
  assert.equal((await f.publish(pulseAt(44))).data.state, 'conflict');
  assert.equal(f.remote.prunes.length, prunes);
  f.remote.beforeEdit = null;
  await f.goLive({ noKeep: true });
  assert.equal((await read(configPath(f.root))).canvas.keepVersions, undefined);
});

test('public CLI transport sends one conditional edit as an argument array and reads refusals by exit code, never a fallback', async t => {
  const f = await fixture(t);
  const executable = join(f.root, 'acme-isocan'), trace = join(f.root, 'trace.jsonl');
  await writeFile(executable, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2), mode = process.env.ACME_MODE;
appendFileSync(process.env.ACME_TRACE, JSON.stringify({ args, home: process.env.ISOCAN_DIRECT ?? null }) + '\\n');
if (args.includes('--version')) console.log(mode === 'unverified' ? '0.1.0 (abcdef0, 2026-10-14)' : '0.1.0 (7bb1f4e, 2026-10-13)');
else if (args.includes('--help')) console.log(args[0] === 'edit' ? '--visual --if-version --if-meta --title --prop --rm-prop --op-id' : '--json --canvas --visual --prop --space --note new ls --keep --force');
else if (args.includes('prune')) console.log(JSON.stringify({ pruned: [{ itemId: 'itm_acme', dropped: 3 }], dropped: 3, keep: 14 }));
else if (mode === 'conflict') { console.log(JSON.stringify({ status: 'conflict', itemId: 'itm_acme', currentVersionId: 'ver_person', expectedVersionId: 'ver_acme', title: 'Acme', properties: {}, reason: 'it changed' })); process.exitCode = 4; }
else if (mode === 'unsupported') { console.log(JSON.stringify({ status: 'unsupported', itemId: 'itm_acme', reason: 'older home' })); process.exitCode = 5; }
else if (mode === 'garbled') { console.log('secret-token=DO-NOT-PRINT'); process.exitCode = 4; }
else if (mode === 'crash') { console.error('conflict 409 secret-token=DO-NOT-PRINT'); process.exitCode = 1; }
else console.log(JSON.stringify({ status: 'applied', itemId: 'itm_acme', versionId: 'ver_next', opId: 'op_acmeweek42pulse', seq: 7, title: 'Acme', properties: {} }));
`, { mode: 0o755 });
  const make = mode => createIsocanTransport({ executable, cwd: f.root, env: { ...process.env, ACME_TRACE: trace, ACME_MODE: mode ?? '' }, timeoutMs: 5000 });
  const caps = await make().capabilities();
  assert.equal(caps.conditionalWrites, true); assert.equal(caps.retention, true); assert.equal(caps.version, '0.1.0 (7bb1f4e, 2026-10-13)');
  await assert.rejects(make('unverified').capabilities(), { code: 'unsupported', exitCode: 2 });
  const binding = { home, canvasId: 'prj_acme' };
  const edit = { itemId: 'itm_acme', sourcePath: '/tmp/Acme pulse.md', visualPath: '/tmp/Acme pulse.html', ifVersion: 'ver_acme', ifMeta: { title: 'Acme $(not-a-command)', properties: { kind: 'pulse' } }, title: 'Acme week 42', properties: { 'keel.hash': 'abc' }, operationId: 'op_acmeweek42pulse' };
  await writeFile(trace, '');
  assert.equal((await make().edit(binding, edit)).status, 'applied');
  assert.deepEqual(JSON.parse((await readFile(trace, 'utf8')).trim()), { home, args: ['--json', '--canvas', 'prj_acme', 'edit', 'itm_acme', '/tmp/Acme pulse.md', '--visual', '/tmp/Acme pulse.html',
    '--if-version', 'ver_acme', '--if-meta', '{"title":"Acme $(not-a-command)","properties":{"kind":"pulse"}}', '--title', 'Acme week 42', '--prop', 'keel.hash=abc', '--op-id', 'op_acmeweek42pulse'] });
  assert.deepEqual(await make('conflict').edit(binding, edit), { status: 'conflict', itemId: 'itm_acme', currentVersionId: 'ver_person', expectedVersionId: 'ver_acme', title: 'Acme', properties: {}, reason: 'it changed' });
  assert.equal((await make('unsupported').edit(binding, edit)).status, 'unsupported');
  // Anything else is an unknown outcome, not a refusal and not a licence to retry differently.
  await assert.rejects(make('garbled').edit(binding, edit), error => { assert.equal(error.code, 'invalid-json'); assert.doesNotMatch(error.message, /DO-NOT-PRINT/); return true; });
  await assert.rejects(make('crash').edit(binding, edit), error => { assert.equal(error.exitCode, 1); assert.doesNotMatch(error.message, /DO-NOT-PRINT/); return true; });
  await writeFile(trace, '');
  assert.equal((await make().prune(binding, 'itm_acme', 14)).dropped, 3);
  assert.deepEqual(JSON.parse((await readFile(trace, 'utf8')).trim()).args, ['--json', '--canvas', 'prj_acme', 'version', 'prune', 'itm_acme', '--keep', '14', '--force']);
  await writeFile(trace, '');
  for (const mode of [undefined, 'conflict', 'unsupported', 'garbled', 'crash']) await make(mode).edit(binding, edit).catch(() => {});
  for (const line of (await readFile(trace, 'utf8')).trim().split('\n')) {
    const { args } = JSON.parse(line);
    assert.ok(args.includes('--if-version') && args.includes('--if-meta') && args.includes('--op-id'), 'every edit this transport can send is conditional');
  }
});

test('a replayed edit records the version that landed, and a person\'s change made since then is a refusal, never the new base', async t => {
  const f = await liveFixture(t); await f.goLive({ keep: 2 });
  const pulse = await f.pulse();
  f.remote.afterEdit = async () => { throw new CanvasError('timeout', 'timeout', 1); };
  await assert.rejects(f.publish(pulseAt(41)), { code: 'timeout' });
  f.remote.afterEdit = null;
  const landed = pulse.currentVersionId;
  pulse.versions.push({ id: 'ver_person', blobHash: digest('A person, afterwards') }); pulse.currentVersionId = 'ver_person';
  const out = await f.publish(pulseAt(41));
  assert.equal(out.data.state, 'conflict'); assert.equal(out.exitCode, 1);
  assert.deepEqual(out.data.live.map(l => [l.status, l.versionId, l.changedSince]), [['replayed', landed, true]]);
  assert.deepEqual([out.data.attention[0].seen, out.data.attention[0].expectedVersionId, out.data.attention[0].currentVersionId], ['read', landed, 'ver_person']);
  const journal = await read(manifestPath(f.root));
  assert.equal(journal.pending, null); assert.equal(journal.items.pulse.versionId, landed);
  assert.equal(f.remote.prunes.length, 0, 'retention never runs beside a person\'s change');
  assert.equal(f.remote.edits.length, 2); assert.equal(pulse.versions.length, 3);
});

test('an applied edit a person changes before keel reads it back is not reported as a clean publication', async t => {
  const f = await liveFixture(t); await f.goLive({ keep: 2 });
  const pulse = await f.pulse(), before = (await read(manifestPath(f.root))).lastSuccess;
  f.remote.afterEdit = async () => { pulse.title = 'A person renamed this at once'; };
  const out = await f.publish(pulseAt(41));
  assert.equal(out.data.state, 'conflict'); assert.equal(out.exitCode, 1);
  assert.deepEqual(out.data.live.map(l => [l.status, l.changedSince]), [['applied', true]]);
  assert.deepEqual([out.data.attention[0].reason, out.data.attention[0].seen, out.data.attention[0].title], ['metadata', 'read', 'A person renamed this at once']);
  const journal = await read(manifestPath(f.root));
  assert.equal(journal.items.pulse.meta.title, 'Acme pulse');
  assert.deepEqual(journal.lastSuccess, before, 'the last complete publication is still the earlier one');
  assert.equal(f.remote.prunes.length, 0);
});

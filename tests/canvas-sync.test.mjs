import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canvasConnect, canvasSync, canvasStatus, canvasDisconnect, createIsocanTransport, connect, sync, loadCanvasHistory, REGIONS, CanvasError } from '../lib/canvas-sync.mjs';
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
  const remote = { items: new Map(), groups: new Map(), created: 0, adds: 0, groupCreates: 0, actor: 'actor_acme', grants: [], native: true, beforeAdd: null, afterAdd: null, afterGroup: null, afterCreate: null };
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
  };
  const attach = () => canvasConnect({ root, canvas: `${home}/p/prj_acme`, audience: 'owner-only', yes: true }, { transport });
  return { root, remote, caps, transport, attach };
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

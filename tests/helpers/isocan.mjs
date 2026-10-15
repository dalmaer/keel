// A fake isocan home at the boundary (its CLI as keel's transport sees it),
// shared by the canvas sync tests and the morning's plan card (phase 78).
// isocan's conditional edit, as inspected at 7bb1f4e: the home decides.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { canvasConnect, canvasSync, canvasLive, CanvasError } from '../../lib/canvas-sync.mjs';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const home = 'https://acme.test';
export const read = path => readFile(path, 'utf8').then(JSON.parse);
export const configPath = root => join(root, '.keel/keel.json');
export const manifestPath = root => join(root, '.keel/canvas/manifest.json');
export const cards = () => [{ key: 'snapshot', title: 'Acme snapshot', source: '# Acme\n', region: 'evidence' }, { key: 'pulse', title: 'Acme pulse', source: '# Acme pulse\n', visual: '<!doctype html><p>Acme</p>' }];
export async function fixture(t) {
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
      remote.items.set(itemId, { id: itemId, currentVersionId: version.id, versions: [version], title: card.title, properties: { ...card.properties, sourcePath: basename(card.sourcePath), file: basename(card.sourcePath), ...(card.visualPath ? { visualFile: basename(card.visualPath) } : {}) }, containerId: card.groupId, x: 10, comments: [] });
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

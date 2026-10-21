import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { run } from './helpers/run.mjs';
import { decisionContext, refreshDecisionContext } from '../practices/reconciliation/files/scripts/plates/decision-context.mjs';

const ref = id => `docs/decisions/${id}.md#${id}`;
const record = (id, extra = {}) => `<a id="${id}"></a>\n# ${id}\nAcme choice ${id}.\n\`\`\`keel-decision\n${JSON.stringify({ version: 1, id, status: 'accepted', scope: ['storage', 'cache'], decided_by: 'Acme owner', decided_at: '2026-01-01', supersedes: [], superseded_by: [], ...extra })}\n\`\`\`\n`;
const impact = refs => '```keel-impact\n' + JSON.stringify({ version: 1, decisions: refs }) + '\n```';
const fixture = () => ({
  '.plates/plates.json': JSON.stringify({ name: 'Acme', repo: 'acme/app' }),
  'docs/phases/00-acme.md': '# Acme\n## Reconciliation\n```keel-reconciliation\n' + JSON.stringify({ version: 1, decisions: [ref('old')] }) + '\n```\n',
  'docs/decisions/old.md': record('old', { superseded_by: [ref('new'), ref('proposal')] }),
  'docs/decisions/new.md': record('new', { scope: ['storage'], supersedes: [ref('old')] }),
  'docs/decisions/proposal.md': record('proposal', { status: 'proposed', scope: ['cache'], supersedes: [ref('old')] }),
});
function snapshot(contents = fixture(), revision = 'a'.repeat(40)) {
  const files = new Map(Object.entries(contents).map(([path, value]) => [path, Buffer.from(value)]));
  const directories = new Set();
  for (const path of files.keys()) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  const absent = () => { throw Object.assign(new Error('Acme source absent'), { code: 'ENOENT' }); };
  return {
    revision, complete: true,
    async stat(path) { return files.has(path) ? { type: 'file', size: files.get(path).length } : directories.has(path) ? { type: 'directory' } : absent(); },
    async readdir(path) {
      if (!directories.has(path)) return absent();
      return [...new Set([...files.keys()].filter(name => name.startsWith(`${path}/`)).map(name => name.slice(path.length + 1).split('/')[0]))];
    },
    async readFile(path) { return files.has(path) ? Buffer.from(files.get(path)) : absent(); },
  };
}
async function local(t, contents) {
  const root = await mkdtemp(join(tmpdir(), 'acme-context-reader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, data] of Object.entries(contents)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), data);
  }
  for (const args of [['init', '-q'], ['add', '.'], ['commit', '-qm', 'Acme context']]) {
    const result = run('git', args, { cwd: root }); assert.equal(result.status, 0, result.stderr);
  }
  const result = run('git', ['rev-parse', 'HEAD'], { cwd: root }); assert.equal(result.status, 0, result.stderr);
  return { root, revision: result.stdout.trim() };
}

test('immutable phase and issue contexts exactly match local decisions, proposals, sources and digests', async t => {
  const contents = fixture(), { root, revision } = await local(t, contents), reader = snapshot(contents, revision);
  for (const target of [{ phase: 0 }, { issue: 'acme/app#1', issueBody: impact([ref('old')]) }, { issue: 'acme/app#1', issueBody: 'Acme has no declared references.' }]) {
    const expected = await decisionContext({ root, ...target });
    const actual = await decisionContext({ reader, ...target });
    assert.deepEqual(actual, expected);
    if (actual.state === 'complete') {
      assert.deepEqual(actual.decisions.map(d => [d.ref, d.scope[0]]).sort(), [[ref('new'), 'storage'], [ref('old'), 'cache']]);
      assert.equal(actual.proposals[0].ref, ref('proposal'));
    } else assert.equal(actual.state, 'not-configured');
  }
});

test('immutable inventory discovers unlinked replacements and preserves contradiction parity', async t => {
  const contents = fixture(); contents['docs/decisions/old.md'] = record('old');
  const { root, revision } = await local(t, contents);
  const actual = await decisionContext({ reader: snapshot(contents, revision), phase: 0 });
  assert.equal(actual.state, 'contradictory'); assert.ok(actual.gaps.some(g => g.code === 'missing-reciprocal'));
  assert.deepEqual(actual, await decisionContext({ root, phase: 0 }));
});

test('partial inventories, missing required records and unsafe entries never become complete coverage', async () => {
  const read = reader => decisionContext({ reader, phase: 0 });
  for (const override of [{ complete: false }, { revision: 'main' }, { readFile: null }]) assert.equal((await read({ ...snapshot(), ...override })).state, 'unavailable');
  assert.equal((await decisionContext({ root: '/acme/no-fallback', reader: snapshot(), phase: 0 })).state, 'unavailable');
  const absent = fixture(); delete absent['docs/decisions/old.md'];
  assert.ok((await read(snapshot(absent))).gaps.some(g => g.code === 'source-unavailable'));
  const reader = snapshot(), readdir = reader.readdir;
  reader.readdir = async path => { if (path === 'docs/decisions') throw Error('Acme inventory is incomplete'); return readdir(path); };
  const partial = await read(reader); assert.equal(partial.state, 'unavailable'); assert.ok(partial.gaps.some(g => g.code === 'inventory-unavailable'));
  for (const names of [['../escape.md'], ['nested/file.md'], ['duplicate', 'duplicate'], ['bad\\name'], ['bad%name']]) {
    const source = snapshot(); source.readdir = async () => names;
    assert.equal((await read(source)).state, 'unavailable');
  }
  const nonregular = snapshot(), stat = nonregular.stat;
  nonregular.stat = async path => path.endsWith('old.md') ? { type: 'symlink', size: 1 } : stat(path);
  assert.equal((await read(nonregular)).state, 'unavailable');
});

test('immutable byte sizes, record limits and supersession bounds stay enforced', async () => {
  const huge = snapshot(), stat = huge.stat; let fetchedHuge = false;
  huge.stat = async path => path.endsWith('old.md') ? { type: 'file', size: 2 * 1024 * 1024 } : stat(path);
  const read = huge.readFile; huge.readFile = async path => { if (path.endsWith('old.md')) fetchedHuge = true; return read(path); };
  assert.equal((await decisionContext({ reader: huge, phase: 0 })).state, 'unavailable'); assert.equal(fetchedHuge, false);
  const truncated = snapshot(), readFull = truncated.readFile;
  truncated.readFile = async path => (await readFull(path)).subarray(1);
  assert.equal((await decisionContext({ reader: truncated, phase: 0 })).state, 'unavailable');
  const many = fixture(); for (let i = 0; i < 101; i++) many[`docs/decisions/r${i}.md`] = record(`r${i}`);
  assert.ok((await decisionContext({ reader: snapshot(many), phase: 0 })).gaps.some(g => g.message.includes('100 records')));
  const chain = fixture(); chain['docs/decisions/old.md'] = record('old', { superseded_by: [ref('r0')] });
  delete chain['docs/decisions/new.md']; delete chain['docs/decisions/proposal.md'];
  for (let i = 0; i < 22; i++) chain[`docs/decisions/r${i}.md`] = record(`r${i}`, { supersedes: [ref(i === 0 ? 'old' : `r${i - 1}`)], superseded_by: i === 21 ? [] : [ref(`r${i + 1}`)] });
  assert.ok((await decisionContext({ reader: snapshot(chain), phase: 0 })).gaps.some(g => g.code === 'hop-bound'));
});

test('revision drift is unavailable and refresh compares immutable source and revision changes', async () => {
  const unstable = snapshot(), read = unstable.readFile;
  unstable.readFile = async path => { const data = await read(path); unstable.revision = 'b'.repeat(40); return data; };
  assert.equal((await decisionContext({ reader: unstable, phase: 0 })).state, 'unavailable');
  const bundle = await decisionContext({ reader: snapshot(), phase: 0 });
  assert.equal((await refreshDecisionContext({ reader: snapshot(), bundle })).changed, false);
  const next = await refreshDecisionContext({ reader: snapshot(fixture(), 'b'.repeat(40)), bundle });
  assert.equal(next.changed, true); assert.equal(next.allowed, true);
  const altered = fixture(); altered['docs/decisions/new.md'] = record('new', { scope: ['storage'], supersedes: [ref('old')], decided_by: 'Acme second owner' });
  assert.equal((await refreshDecisionContext({ reader: snapshot(altered), bundle })).changed, true);
});

test('shipped context resolver matches the canonical practice source', async () => {
  const canonical = await readFile(new URL('../practices/reconciliation/files/scripts/plates/decision-context.mjs', import.meta.url), 'utf8');
  assert.equal(await readFile(new URL('../scripts/plates/decision-context.mjs', import.meta.url), 'utf8'), canonical);
});

test('immutable issue identity reads legacy config only when canonical config is absent', async () => {
  const contents = fixture(), target = { issue: 'acme/app#1', issueBody: impact([ref('old')]) };
  contents['.keel/keel.json'] = contents['.plates/plates.json']; delete contents['.plates/plates.json'];
  assert.equal((await decisionContext({ reader: snapshot(contents), ...target })).state, 'complete');
  contents['.plates/plates.json'] = '{invalid';
  assert.equal((await decisionContext({ reader: snapshot(contents), ...target })).state, 'unavailable');
  delete contents['.plates/plates.json'];
  const reader = snapshot(contents), stat = reader.stat;
  reader.stat = async path => { if (path === '.plates/plates.json') throw Error('canonical inventory unavailable'); return stat(path); };
  assert.equal((await decisionContext({ reader, ...target })).state, 'unavailable');
});

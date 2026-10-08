import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture } from '../lib/canvas-retro.mjs';
import { encodeDir } from '../lib/looseends.mjs';
import { run } from './helpers/run.mjs';

const ID = '00000000-0000-4000-8000-000000000001';
const PRIVATE = 'ACME-PRIVATE-TRANSCRIPT-MARKER';
function git(root, ...args) {
  const r = run('git', ['-C', root, ...args]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
async function world(t) {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'keel-capture-')));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const root = join(tmp, 'acme');
  await mkdir(join(root, '.keel'), { recursive: true });
  await writeFile(join(root, '.keel/keel.json'), '{"name":"Acme"}');
  git(root, 'init', '-q');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'Acme initial');
  const since = git(root, 'rev-parse', 'HEAD');
  await writeFile(join(root, 'acme.mjs'), 'export {};\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'Acme change');
  const revision = git(root, 'rev-parse', 'HEAD');
  const input = {
    schema: 1, id: ID, date: '2026-10-08', source: { revision, since }, provider: 'codex', coverage: 'manual',
    summary: Object.fromEntries(['navigation', 'checks', 'standards', 'agents', 'economy', 'noop', 'gaps'].map(k => [k, 'Acme reviewed this area.'])),
    candidates: [{ id: 'acme-check', type: 'check', action: 'Check missing source coverage.', decision: { status: 'pending' }, links: [], evidence: [] }],
  };
  const record = join(tmp, 'candidate.json');
  const env = { ...process.env, KEEL_CLAUDE_DIR: join(tmp, 'claude') };
  const write = () => writeFile(record, JSON.stringify(input));
  await write();
  return { tmp, root, input, record, env, write, output: join(root, 'docs/retros', `${ID}.json`) };
}
async function transcript(w) {
  const dir = join(w.env.KEEL_CLAUDE_DIR, 'projects', encodeDir(w.root));
  await mkdir(dir, { recursive: true });
  const timestamp = new Date(Date.now() + 60_000).toISOString();
  await writeFile(join(dir, 'acme-session.jsonl'), [
    { timestamp, type: 'assistant', message: { content: [{ type: 'tool_use', id: 'acme-call', name: 'Bash', input: { command: `cat /Users/acme/${PRIVATE}` } }] } },
    { timestamp, type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'acme-call', is_error: true, content: PRIVATE }] } },
  ].map(x => JSON.stringify(x)).join('\n'));
}

test('preview exposes the exact reviewed record without writes; yes saves and never auto-picks', async t => {
  const w = await world(t);
  const before = await readdir(w.root, { recursive: true });
  const preview = await capture(w);
  assert.equal(preview.exitCode, 3);
  assert.equal(preview.data.status, 'preview');
  assert.deepEqual(await readdir(w.root, { recursive: true }), before);
  assert.equal(preview.data.record.counts, null);
  const saved = await capture({ ...w, yes: true });
  assert.equal(saved.exitCode, 0);
  assert.equal(saved.data.status, 'captured');
  assert.deepEqual(JSON.parse(await readFile(w.output)), preview.data.record);
  assert.equal(saved.data.record.candidates[0].decision.status, 'pending');
  assert.equal((await capture({ ...w, yes: true })).data.status, 'unchanged');
  w.input.summary.gaps = 'The owner changed this summary.'; await w.write();
  assert.equal((await capture({ ...w, yes: true })).exitCode, 1);
  assert.deepEqual(JSON.parse(await readFile(w.output)), saved.data.record);
});

test('picked and declined are authored decisions with complete attribution', async t => {
  const w = await world(t);
  for (const status of ['picked', 'declined']) {
    w.input.candidates[0].decision = { status, actor: 'Acme owner', date: '2026-10-08', reason: 'Owner reviewed the tradeoff.' };
    await w.write();
    const r = await capture(w);
    assert.equal(r.exitCode, 3);
    assert.deepEqual(r.data.record.candidates[0].decision, w.input.candidates[0].decision);
    for (const field of ['actor', 'date', 'reason']) {
      const value = w.input.candidates[0].decision[field];
      delete w.input.candidates[0].decision[field]; await w.write();
      assert.equal((await capture(w)).exitCode, 2, field);
      w.input.candidates[0].decision[field] = value;
    }
  }
});

test('manual and unsupported providers never acquire transcript counts; absent session never selects newest', async t => {
  const w = await world(t); await transcript(w);
  for (const [provider, coverage, session, expected] of [
    ['claude', 'manual', 'acme-session', 'manual'],
    ['codex', 'unknown', 'acme-session', 'unknown'],
    ['claude', 'unknown', undefined, 'unknown'],
    ['claude', 'unknown', 'missing-acme-session', 'unknown'],
  ]) {
    Object.assign(w.input, { provider, coverage }); await w.write();
    const r = await capture({ ...w, session });
    assert.equal(r.exitCode, 3);
    assert.equal(r.data.record.coverage, expected);
    assert.equal(r.data.record.counts, null);
    assert.ok(!JSON.stringify(r).includes(w.tmp));
    assert.ok(!JSON.stringify(r).includes('missing-acme-session'));
  }
});

test('explicit supported transcript contributes only allowlisted counts, with source range enforced', async t => {
  const w = await world(t); await transcript(w);
  Object.assign(w.input, { provider: 'claude-code', coverage: 'unknown' }); await w.write();
  const r = await capture({ ...w, session: 'acme-session', yes: true });
  assert.equal(r.exitCode, 0);
  assert.equal(r.data.record.coverage, 'ok');
  assert.deepEqual(r.data.record.counts, { retried: 0, errors: 1, denials: 0, rereads: 0, slow: 0, reverted: 0 });
  const all = JSON.stringify(r) + await readFile(w.output, 'utf8');
  for (const marker of [PRIVATE, '/Users/', w.tmp, 'acme-session', 'tool_use', 'command', 'signals', 'tokens']) assert.ok(!all.includes(marker), marker);
  assert.equal((await capture({ ...w, session: 'acme-session', since: w.input.source.revision })).exitCode, 2);
  w.input.source.revision = w.input.source.since; await w.write();
  assert.equal((await capture({ ...w, session: 'acme-session' })).exitCode, 2);
});

test('schema, privacy and reference validation reject unsafe authored fields without echoing them', async t => {
  const w = await world(t);
  const base = structuredClone(w.input);
  const invalid = [
    x => { x.schema = 2; },
    x => { x.id = '../outside'; },
    x => { x.date = '2026-02-30'; },
    x => { x.source = { revision: 'HEAD' }; },
    x => { x.source = { revision: 1234567 }; },
    x => { delete x.coverage; },
    x => { delete x.summary.gaps; },
    x => { x.counts = { errors: 900 }; },
    x => { x.transcript = PRIVATE; },
    x => { x.summary.tokens = PRIVATE; },
    x => { x.summary.gaps = `/Users/acme/${PRIVATE}`; },
    x => { x.summary.gaps = `See (/Users/acme/${PRIVATE}).`; },
    x => { x.summary.gaps = 'See https://acme.invalid/?token=fake'; },
    x => { x.summary.gaps = `Run \`echo ${PRIVATE}\``; },
    x => { x.summary.gaps = `token=${PRIVATE}`; },
    x => { x.candidates[0].command = PRIVATE; },
    x => { x.candidates[0].links = ['../outside']; },
    x => { x.candidates[0].links = ['https://acme.invalid/a?token=fake']; },
    x => { x.candidates[0].evidence = ['/Users/acme/private']; },
    x => { x.candidates[0].decision.status = 'accepted'; },
    x => { x.candidates[0].decision.actor = 'Acme'; },
    x => { x.candidates.push(structuredClone(x.candidates[0])); },
    x => { x.candidates = Array.from({ length: 6 }, (_, i) => ({ ...x.candidates[0], id: `acme-${i}` })); },
  ];
  for (const change of invalid) {
    const input = structuredClone(base); change(input);
    await writeFile(w.record, JSON.stringify(input));
    const r = await capture({ ...w, yes: true });
    assert.equal(r.exitCode, 2, change.toString());
    assert.ok(!JSON.stringify(r).includes(PRIVATE));
    await assert.rejects(readFile(w.output), { code: 'ENOENT' });
  }
});

test('configured repository directory works and path or symlink escapes cannot write outside it', async t => {
  const w = await world(t);
  const config = path => writeFile(join(w.root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', retros: { dir: path } }));
  for (const path of ['../outside', w.tmp, 'docs/../../outside', '.git/retros', 'docs\\retros', 'docs/../retros']) {
    await config(path);
    assert.equal((await capture({ ...w, yes: true })).exitCode, 2, path);
  }
  await symlink(w.tmp, join(w.root, 'escape'));
  await config('escape/retros');
  assert.equal((await capture({ ...w, yes: true })).exitCode, 2);
  await config('records/retros');
  for (const session of ['../outside', '/tmp/acme', 'a/b', 'a\\b']) assert.equal((await capture({ ...w, session })).exitCode, 2);
  assert.equal((await capture({ ...w, yes: 'false' })).exitCode, 2);
  assert.equal((await capture({ ...w, yes: true })).exitCode, 0);
  assert.equal(JSON.parse(await readFile(join(w.root, 'records/retros', `${ID}.json`))).id, ID);
  const original = await readFile(join(w.root, 'records/retros', `${ID}.json`));
  await rm(join(w.root, 'records/retros', `${ID}.json`));
  await writeFile(join(w.tmp, 'owned.json'), original);
  await symlink(join(w.tmp, 'owned.json'), join(w.root, 'records/retros', `${ID}.json`));
  assert.equal((await capture({ ...w, yes: true })).exitCode, 2);
  assert.deepEqual(await readFile(join(w.tmp, 'owned.json')), original);
});

test('simultaneous captures cannot replace a different owner record', async t => {
  const w = await world(t);
  const other = join(w.tmp, 'other.json');
  const input = structuredClone(w.input);
  input.summary.gaps = 'Acme reviewed a different outcome.';
  await writeFile(other, JSON.stringify(input));
  const results = await Promise.all([
    capture({ ...w, yes: true }), capture({ ...w, record: other, yes: true }),
  ]);
  assert.deepEqual(results.map(r => r.exitCode).sort(), [0, 1]);
  assert.deepEqual(JSON.parse(await readFile(w.output)), results.find(r => r.exitCode === 0).data.record);
});

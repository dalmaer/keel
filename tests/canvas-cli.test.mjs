// CLI contract tests: synthetic Acme checkout; remote executables are always fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from './helpers/run.mjs';
import { parseCanvasArgs } from '../lib/canvas.mjs';
import { parseGuide, COLD_START_LIMIT, surfaceGaps, verbs, FLAGS } from '../lib/cli.mjs';
const BIN = resolve('bin/keel.mjs');
async function world(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'keel-canvas-cli-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', repo: 'Acme/app', practices: [] }));
  const fake = join(root, 'fake-remote');
  await writeFile(fake, '#!/bin/sh\nprintf "called\\n" >> "$ACME_CALLS"\nexit 71\n', { mode: 0o755 });
  const env = { ...process.env, KEEL_ISOCAN: fake, ISOCAN: fake, KEEL_GH: fake, ACME_CALLS: join(root, 'remote-calls'), KEEL_CLAUDE_DIR: join(root, 'no-sessions') };
  return { root, env, cli(args, cwd = root) {
    const r = run(process.execPath, [BIN, ...args, '--json'], { cwd, env });
    assert.equal(r.stderr, '', r.stderr);
    return { code: r.status, data: JSON.parse(r.stdout), bytes: Buffer.byteLength(r.stdout) };
  } };
}

test('canvas flags reject unknown, duplicate, missing and contradictory inputs before transport', async t => {
  const w = await world(t);
  for (const args of [[], ['nope'], ['capture', '--record', 'x'], ['snapshot', '--wat'], ['snapshot', '--output'], ['snapshot', '--github', '--github'], ['render', '--snapshot', 'x'], ['connect'], ['connect', '--create', '--canvas', 'x'], ['connect', '--create'], ['connect', '--canvas', 'x', '--title', 'Acme'], ['sync', '--yes', '--dry-run'], ['sync', '--snapshot', 'x', '--github'], ['status', '--yes'], ['disconnect', 'extra'], ['night'], ['night', '--report', '--yes']]) {
    const r = w.cli(['canvas', ...args]);
    assert.equal(r.code, 2, JSON.stringify({ args, r }));
    assert.equal(r.data.exitCode, 2);
    assert.ok(r.data.error);
  }
  assert.ok(!(await readdir(w.root)).includes('remote-calls'));
});

test('retro capture validates flags before reading a session', async t => {
  const w = await world(t);
  for (const args of [[], ['--record'], ['--record', 'x', '--worksheet'], ['--record', 'x', '--yes', '--yes']]) {
    assert.equal(w.cli(['retro', 'capture', ...args]).code, 2);
  }
});

test('snapshot is local by default, saved JSON is reusable and existing outputs survive', async t => {
  const w = await world(t);
  const r = w.cli(['canvas', 'snapshot', '--output', 'snapshot.json']);
  assert.equal(r.code, 0, JSON.stringify(r.data));
  assert.equal(r.data.schema, 1);
  assert.ok(Array.isArray(r.data.coverage));
  const saved = await readFile(join(w.root, 'snapshot.json'), 'utf8');
  assert.equal(JSON.parse(saved).project.name, 'Acme');
  assert.equal(w.cli(['canvas', 'snapshot', '--output', 'snapshot.json']).code, 2);
  assert.equal(await readFile(join(w.root, 'snapshot.json'), 'utf8'), saved);
  assert.ok(!(await readdir(w.root)).includes('remote-calls'));
});

test('input schema and symlink paths are rejected without remote calls', async t => {
  const w = await world(t);
  await writeFile(join(w.root, 'bad.json'), '{"schema":99}');
  assert.equal(w.cli(['canvas', 'render', '--snapshot', 'bad.json', '--output', 'rendered']).code, 2);
  await symlink(join(w.root, 'bad.json'), join(w.root, 'link.json'));
  assert.equal(w.cli(['canvas', 'render', '--snapshot', 'link.json', '--output', 'rendered']).code, 2);
  assert.equal(w.cli(['canvas', 'snapshot', '--output', 'link.json']).code, 2);
  assert.equal(w.cli(['retro', 'capture', '--record', 'link.json']).code, 2);
  assert.ok(!(await readdir(w.root)).includes('remote-calls'));
});

test('canvas help announces the shipped verb within the existing cold-start budget', async t => {
  const w = await world(t), guide = await readFile(resolve('lib/agent-guide.md'), 'utf8');
  assert.ok(parseGuide(guide).coldStart.length <= COLD_START_LIMIT);
  assert.deepEqual(surfaceGaps([...verbs.keys(), ...FLAGS.map(f => f.name)], guide), []);
  const help = w.cli(['--agent-help', 'canvas']);
  assert.equal(help.code, 0);
  assert.match(JSON.stringify(help.data), /Limited mode/);
  assert.match(JSON.stringify(help.data), /KEEL_ISOCAN/);
  assert.deepEqual(parseCanvasArgs('sync', ['--dry-run', '--json']), { dryRun: true });
});


test('test helper refuses canvas network boundaries without explicit fakes', () => {
  const env = { ...process.env };
  delete env.KEEL_GH;
  delete env.KEEL_ISOCAN;
  assert.throws(() => run(process.execPath, [BIN, 'canvas', 'snapshot', '--github'], { env }), /KEEL_GH/);
  for (const operation of ['connect', 'sync', 'status', 'disconnect', 'night']) {
    assert.throws(() => run(process.execPath, [BIN, 'canvas', operation], { env }), /KEEL_ISOCAN/);
  }
});

test('retro capture previews, persists with yes, and keeps the worksheet read-only', async t => {
  const w = await world(t);
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.keel/keel.json'], ['commit', '-qm', 'Acme initial record']]) {
    const r = run('git', args, { cwd: w.root, env: w.env });
    assert.equal(r.status, 0, r.stderr);
  }
  const revision = run('git', ['rev-parse', 'HEAD'], { cwd: w.root, env: w.env }).stdout.trim();
  const record = { schema: 1, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date: '2026-10-08', source: { revision }, provider: 'manual', coverage: 'manual',
    summary: Object.fromEntries(['navigation', 'checks', 'standards', 'agents', 'economy', 'noop', 'gaps'].map(k => [k, 'Acme reviewed this area.'])), candidates: [] };
  await writeFile(join(w.root, 'reviewed.json'), JSON.stringify(record));
  const preview = w.cli(['retro', 'capture', '--record', 'reviewed.json']);
  assert.equal(preview.code, 3, JSON.stringify(preview.data));
  const destination = join(w.root, 'docs/retros', `${record.id}.json`);
  await assert.rejects(readFile(destination), { code: 'ENOENT' });
  const captured = w.cli(['retro', 'capture', '--record', 'reviewed.json', '--yes']);
  assert.equal(captured.code, 0, JSON.stringify(captured.data));
  assert.equal(JSON.parse(await readFile(destination, 'utf8')).coverage, 'manual');
  const before = (await readdir(w.root, { recursive: true })).sort();
  const worksheet = w.cli(['retro', '--worksheet']);
  assert.equal(worksheet.code, 0, JSON.stringify(worksheet.data));
  assert.deepEqual((await readdir(w.root, { recursive: true })).sort(), before);
});

test('night delegates disabled publishing without collection or remote calls', async t => {
  const w = await world(t);
  const r = w.cli(['canvas', 'night', '--report', 'not-measured.json']);
  assert.equal(r.code, 0, JSON.stringify(r.data));
  assert.equal(r.data.skipped, true);
  assert.ok(!(await readdir(w.root)).includes('remote-calls'));
});

test('connect previews the audience, applies only with yes, then disconnect preserves the remote', async t => {
  const w = await world(t);
  await writeFile(w.env.KEEL_ISOCAN, `#!/bin/sh
printf '%s\\n' "$*" >> "$ACME_CALLS"
case "$*" in
  --version) printf '0.1.0 (b61f7c1, Acme)\\n' ;;
  *--help*) printf '%s\\n' '--json --canvas --visual --prop --space --note new ls' ;;
  '--json whoami') printf '%s\\n' '{"id":"acme-writer","home":"https://acme.invalid"}' ;;
  *' share') printf '%s\\n' '{"owner":"acme-writer","grants":[]}' ;;
  *'canvas show') printf '%s\\n' '{"id":"acme-canvas","groupMode":"groups"}' ;;
  *) exit 71 ;;
esac
`, { mode: 0o755 });
  const args = ['canvas', 'connect', '--canvas', 'https://acme.invalid/p/acme-canvas', '--audience', 'owner-only'];
  const before = await readFile(join(w.root, '.keel/keel.json'), 'utf8');
  const preview = w.cli(args);
  assert.equal(preview.code, 3, JSON.stringify(preview.data));
  assert.equal(preview.data.changes[0].audience, 'owner-only');
  assert.equal(await readFile(join(w.root, '.keel/keel.json'), 'utf8'), before);
  const connected = w.cli([...args, '--yes']);
  assert.equal(connected.code, 0, JSON.stringify(connected.data));
  assert.equal(w.cli(['canvas', 'status']).data.state, 'connected');
  assert.equal(w.cli(['canvas', 'disconnect']).code, 3);
  assert.equal(w.cli(['canvas', 'disconnect', '--yes']).code, 0);
  assert.equal(w.cli(['canvas', 'status']).data.state, 'disabled');
  const calls = await readFile(w.env.ACME_CALLS, 'utf8');
  assert.doesNotMatch(calls.split('\n').filter(line => !line.includes('--help')).join('\n'), /\b(?:add|edit|delete|create|rm)\b/);
});

test('canvas state symlinks cannot redirect a disconnect write', async t => {
  const w = await world(t);
  await mkdir(join(w.root, 'external'));
  await symlink(join(w.root, 'external'), join(w.root, '.keel/canvas'));
  const r = w.cli(['canvas', 'disconnect', '--yes']);
  assert.equal(r.code, 2, JSON.stringify(r.data));
  assert.match(r.data.error, /symlink/);
  assert.deepEqual(await readdir(join(w.root, 'external')), []);
});

test('a saved snapshot renders locally, and sync planning never sends a mutation', async t => {
  const w = await world(t);
  const collected = w.cli(['canvas', 'snapshot', '--output', 'snapshot.json']);
  assert.equal(collected.code, 0, JSON.stringify(collected.data));
  const rendered = w.cli(['canvas', 'render', '--snapshot', 'snapshot.json', '--output', 'rendered']);
  assert.equal(rendered.code, 0, JSON.stringify(rendered.data));
  const files = await readdir(join(w.root, 'rendered'), { recursive: true });
  assert.ok(files.some(p => p.endsWith('.html')));
  assert.ok(files.some(p => p.endsWith('.md')));
  assert.ok(files.some(p => p.endsWith('.json')));
  assert.ok(!(await readdir(w.root)).includes('remote-calls'));
  const config = JSON.parse(await readFile(join(w.root, '.keel/keel.json'), 'utf8'));
  config.canvas = { provider: 'isocan', projectKey: 'acme-project', home: 'https://acme.invalid', canvasId: 'acme-canvas', enabled: true, audience: 'owner-only', actorId: 'acme-writer', privacy: 'summary', mode: 'immutable' };
  await writeFile(join(w.root, '.keel/keel.json'), JSON.stringify(config));
  await writeFile(w.env.KEEL_ISOCAN, `#!/bin/sh
printf '%s\\n' "$*" >> "$ACME_CALLS"
case "$*" in
  --version) printf '0.1.0 (b61f7c1, Acme)\\n' ;;
  *--help*) printf '%s\\n' '--json --canvas --visual --prop --space --note new ls' ;;
  *'canvas show') printf '%s\\n' '{"id":"acme-canvas","groupMode":"groups"}' ;;
  *) exit 71 ;;
esac
`, { mode: 0o755 });
  await mkdir(join(w.root, '.keel/canvas'));
  const manifest = JSON.stringify({ schema: 1, projectKey: 'acme-project', home: 'https://acme.invalid', canvasId: 'acme-canvas', items: {}, groups: {}, receipts: [], pending: null });
  await writeFile(join(w.root, '.keel/canvas/manifest.json'), manifest);
  // Recollect against the binding: stable project identity belongs to the target.
  assert.equal(w.cli(['canvas', 'snapshot', '--output', 'bound.json']).code, 0);
  const plan = w.cli(['canvas', 'sync', '--snapshot', 'bound.json']);
  assert.equal(plan.code, 3, JSON.stringify(plan.data));
  assert.ok(plan.data.changes.length > 0);
  const dryRun = w.cli(['canvas', 'sync', '--snapshot', 'bound.json', '--dry-run']);
  assert.equal(dryRun.code, 0, JSON.stringify(dryRun.data));
  const calls = await readFile(w.env.ACME_CALLS, 'utf8');
  assert.doesNotMatch(calls.split('\n').filter(line => !line.includes('--help')).join('\n'), /\b(?:add|edit|delete|create|rm)\b/);
  assert.equal(await readFile(join(w.root, '.keel/canvas/manifest.json'), 'utf8'), manifest);
  assert.deepEqual(await readdir(join(w.root, '.keel/canvas')), ['manifest.json']);
});

test('configured transport failures return JSON exit 1 without leaking tool output', async t => {
  const w = await world(t);
  const r = w.cli(['canvas', 'connect', '--canvas', 'https://acme.invalid/p/acme-canvas', '--audience', 'owner-only']);
  assert.equal(r.code, 1, JSON.stringify(r.data));
  assert.equal(r.data.exitCode, 1);
  assert.match(r.data.error, /isocan/);
  assert.ok((await readFile(w.env.ACME_CALLS, 'utf8')).includes('called'));
});


test('render JSON stays concise for 275 entities while files retain the full visual', async t => {
  const w = await world(t);
  const snapshot = { schema: 1, project: { key: 'acme-large', name: 'Acme', repo: 'Acme/app' }, revision: { commit: 'a'.repeat(40), dirty: false }, generatedAt: '2026-10-08T12:00:00.000Z',
    entities: Array.from({ length: 275 }, (_, i) => ({ key: `phase:${i}`, kind: 'phase', title: `Acme phase ${i}`, status: 'planned', source: { path: `docs/phases/${i}.md` } })),
    coverage: [], observations: [], relations: [], metrics: [], warnings: [] };
  await writeFile(join(w.root, 'large.json'), JSON.stringify(snapshot));
  const r = w.cli(['canvas', 'render', '--snapshot', 'large.json', '--output', 'large-render']);
  assert.equal(r.code, 0, JSON.stringify(r.data));
  assert.ok(r.bytes < 4096, `render stdout was ${r.bytes} bytes`);
  assert.ok(r.data.cardCount > 0);
  assert.equal(r.data.groupCount, 6);
  assert.equal(r.data.rendered, undefined);
  assert.match(r.data.hashes.html, /^[a-f0-9]{64}$/);
  const html = await readFile(r.data.files.html, 'utf8');
  assert.ok(html.length > r.bytes * 10);
  assert.match(html, /Acme phase 274/);
  const manifest = JSON.parse(await readFile(r.data.files.manifest, 'utf8'));
  assert.equal(manifest.cards.length, r.data.cardCount);
  for (const [kind, path] of Object.entries(r.data.files)) {
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), r.data.hashes[kind]);
  }
});


test('sync rejects a snapshot from another binding before transport or mutation', async t => {
  const w = await world(t);
  const config = { name: 'Acme', canvas: { provider: 'isocan', projectKey: 'acme-target', home: 'https://acme.invalid', canvasId: 'acme-canvas', enabled: true } };
  await writeFile(join(w.root, '.keel/keel.json'), JSON.stringify(config));
  const snapshot = { schema: 1, project: { key: 'acme-other', name: 'Acme', repo: null }, revision: { commit: null, dirty: null }, generatedAt: '2026-10-08T12:00:00.000Z', entities: [], coverage: [], observations: [], relations: [], metrics: [], warnings: [] };
  await writeFile(join(w.root, 'other.json'), JSON.stringify(snapshot));
  const r = w.cli(['canvas', 'sync', '--snapshot', 'other.json', '--yes']);
  assert.equal(r.code, 2, JSON.stringify(r.data));
  assert.match(r.data.error, /another project/);
  assert.ok(!(await readdir(w.root)).includes('remote-calls'));
});

test('snapshot accepts repeated root-relative lifecycle artifacts and histories for the chosen cohort window', async t => {
  const w = await world(t);
  const project = { key: 'acme-cohort', name: 'Acme', repo: 'Acme/app' };
  await writeFile(join(w.root, '.keel/keel.json'), JSON.stringify({ name: project.name, repo: project.repo, canvas: { projectKey: project.key } }));
  await mkdir(join(w.root, 'records'));
  await mkdir(join(w.root, 'subdir'));
  const day = days => new Date(Date.now() - days * 86400000).toISOString();
  const entity = (key, status, kind = 'loop') => ({ key, kind, status, title: `Acme ${key}`, source: { path: 'records/current.json' } });
  const history = (days, second) => ({ schema: 1, project, revision: { commit: null, dirty: null }, generatedAt: day(days),
    coverage: [{ source: 'loop', status: 'ok', observedAt: day(days) }],
    entities: [entity('loop:a', 'accepted'), entity('loop:b', second)], relations: [], observations: [], metrics: [], warnings: [] });
  await writeFile(join(w.root, 'records/older.json'), JSON.stringify(history(40, 'accepted')));
  await writeFile(join(w.root, 'records/recent.json'), JSON.stringify(history(10, 'declined')));
  const artifact = (source, entities) => ({ schema: 1, projectKey: project.key, source, observedAt: day(1), entities, relations: [], observations: [] });
  await writeFile(join(w.root, 'records/current.json'), JSON.stringify(artifact('loop', [entity('loop:a', 'done'), entity('loop:b', 'accepted')])));
  await writeFile(join(w.root, 'records/reviews.json'), JSON.stringify(artifact('reviews', [entity('review:one', 'unanswered', 'review')])));
  const base = ['canvas', 'snapshot', '--artifact', 'records/current.json', '--artifact', 'records/reviews.json'];
  const metric = data => data.metrics.find(m => m.id === 'loop-completion-rate');
  const noHistory = w.cli(base);
  assert.equal(noHistory.code, 0, JSON.stringify(noHistory.data));
  assert.equal(metric(noHistory.data).value, null, 'no cohort is invented without history');
  const args = [...base, '--history', 'records/older.json', '--history', 'records/recent.json'];
  const thirty = w.cli(args, join(w.root, 'subdir'));
  assert.equal(thirty.code, 0, JSON.stringify(thirty.data));
  assert.equal(metric(thirty.data).value, 0.5);
  assert.equal(metric(thirty.data).denominator, 2);
  assert.equal(thirty.data.metrics.find(m => m.id === 'reviews-unanswered').value, 1);
  assert.equal(thirty.data.complete, false, 'supplied sources do not fill unrelated coverage gaps');
  const seven = w.cli([...args, '--window-days', '7']);
  assert.equal(seven.code, 0, JSON.stringify(seven.data));
  assert.equal(metric(seven.data).value, 1);
  assert.equal(metric(seven.data).denominator, 1);
  assert.ok(!(await readdir(w.root)).includes('remote-calls'));
});

test('snapshot lifecycle input flags reject unsafe paths, bad JSON and invalid windows', async t => {
  const w = await world(t);
  await writeFile(join(w.root, 'bad.json'), '{not JSON');
  await symlink(join(w.root, 'bad.json'), join(w.root, 'linked.json'));
  for (const flag of ['--artifact', '--history']) {
    for (const path of ['/private/tmp/acme.json', '../acme.json', 'records/../acme.json', './bad.json', 'bad.json#x', 'linked.json', 'missing.json', 'bad.json', '.keel']) {
      const r = w.cli(['canvas', 'snapshot', flag, path]);
      assert.equal(r.code, 2, JSON.stringify({ flag, path, r }));
      assert.equal(r.data.exitCode, 2);
    }
    assert.equal(w.cli(['canvas', 'snapshot', flag]).code, 2);
  }
  for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '1e2', '999999999999999999999']) {
    assert.equal(w.cli(['canvas', 'snapshot', '--window-days', value]).code, 2, value);
  }
  assert.equal(w.cli(['canvas', 'snapshot', '--window-days', '7', '--window-days', '30']).code, 2);
  assert.equal(w.cli(['canvas', 'sync', '--artifact', 'bad.json']).code, 2);
  assert.ok(!(await readdir(w.root)).includes('remote-calls'));
});

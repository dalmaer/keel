import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshot, validateSnapshot, withHistory, SOURCES } from '../lib/canvas-snapshot.mjs';
import { lessonFingerprint, parseLessons } from '../practices/night/files/scripts/keel/lib.mjs';

const NOW = '2026-10-08T12:00:00Z', SHA = 'a'.repeat(40), KEY = 'acme-project';
const phasePath = 'docs/phases/01-acme.md';
const fence = (type, value) => `\n\x60\x60\x60${type}\n${JSON.stringify({ version: 1, ...value })}\n\x60\x60\x60\n`;
const phase = (status = 'partial', extra = '') => `---\nstatus: ${status}\nsince: 2026-10-01\ngoal: G0\nnote: "Acme work."\ndepends: []\nevidence: ${['built', 'lived-in'].includes(status) ? '["evidence/acme.md"]' : '[]'}\n---\n# Acme ships\n## Done when\nAcme exports.\n## Scope\nOne export.\n## Acceptance\n- [${['built', 'lived-in'].includes(status) ? 'x' : ' '}] Export works <!-- acceptance: export -->\n## Proof\nNamed Acme proof.\n## Deliberately open\nNone.\n## Next action\nReview acceptance.\n${extra}`;
const receipt = change => ({ kind: 'implementation', acceptance: 'export', sha: SHA, environment: 'test', observed_at: '2026-10-07T12:00:00Z', observer: 'Acme', claim: 'Export works', result: 'pass', ...change });
async function put(root, path, value) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value)); }
async function fixture(t, cfg = {}, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'acme-canvas-snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await put(root, '.keel/keel.json', { name: 'Acme', repo: 'acme/app', canvas: { projectKey: KEY }, ...cfg });
  await put(root, 'docs/goals.json', [{ id: 'G0', title: 'Acme exports', outcome: 'Export works.' }]);
  await put(root, phasePath, phase());
  for (const [path, value] of Object.entries(files)) await put(root, path, value);
  return root;
}
const metric = (s, id) => s.metrics.find(m => m.id === id);
const coverage = (s, source) => s.coverage.find(c => c.source === source);
const finding = (decision, ids = ['acme-finding']) => `---\ntitle: Acme export fails\nloop: ${ids.join(', ')}\ndecision: ${decision}\nphase: 1\nsince: 2026-10-07\nrank: next\nloop_rank: P1\n---\n# Acme finding\n`;

test('local collection is fresh, source-backed, covers every lifecycle area and never invokes GitHub or the gate', async t => {
  const lessons = '| # | Shape | Cost | Guard |\n| --- | --- | --- | --- |\n| 1 | Acme drops exports | Rework | Export check |\n';
  const fingerprint = lessonFingerprint('acme/app', parseLessons(lessons).rows[0]);
  const root = await fixture(t, { lessons: 'notes/lessons.md', health: 'notes/health', check: 'never-run-this-command', paths: { retros: 'notes/retros' } }, {
    'notes/lessons.md': lessons, '.keel/sent.json': { [fingerprint]: { issue: 1, at: '2026-10-06' } },
    'notes/health/2026-10-07.md': '# Health — 2026-10-07\n\n| Measure | Value | Bound | State | Detail |\n| --- | --- | --- | --- | --- |\n| `gate` — gate fails | 0 | ≤ 0 | ok | Saved Acme gate |\n\n## Reconciliation (manual review)\n\n```json\n{"findings":[],"unknown":[]}\n```\n',
    'docs/phases/README.md': 'This is not a phase.',
    'docs/inbox/acme.md': '---\nkind: lesson\nfrom: acme/app\nstatus: accepted\noutcome: lesson\n---\n# Acme proposal\n## Claim\n```\nAcme guard\n```\n## Decision\nAccepted.\n',
    'notes/retros/acme.json': { schema: 1, id: 'acme-retro', date: '2026-10-07', provider: 'manual', coverage: 'manual', candidates: [], session: '/private/acme-secret-transcript', counts: { madeUp: 99 } },
  });
  const env = { ...process.env, KEEL_GH: '/not/an/executable', KEEL_STITCH: '/not/an/executable' };
  const s = await snapshot({ root, now: NOW, env });
  assert.equal(validateSnapshot(s), s);
  assert.equal(s.entities.filter(e => e.kind === 'phase').length, 1);
  assert.equal(s.entities.filter(e => e.subtype === 'catalogue').length, 1);
  assert.equal(s.entities.filter(e => e.subtype === 'inbox-proposal').length, 1);
  assert.equal(metric(s, 'lessons-sent').value, 1);
  assert.equal(coverage(s, 'github').status, 'disabled');
  assert.ok(SOURCES.every(name => coverage(s, name)));
  assert.equal(s.entities.find(e => e.kind === 'health').reconciliation.fresh, false);
  assert.equal(metric(s, 'health-gate').value, 0);
  assert.doesNotMatch(JSON.stringify(s), /acme-secret-transcript|madeUp/);
  assert.equal(metric(s, 'fixes-with-proof').value, null);
  assert.equal(metric(s, 'loop-completion-rate').value, null);
  await put(root, phasePath, phase('designed'));
  const again = await snapshot({ root, now: NOW, env });
  assert.equal(again.entities.find(e => e.kind === 'phase').status, 'designed');
  assert.equal(s.entities.find(e => e.kind === 'phase').status, 'partial');
});

test('explicit finding → phase → validated keel-proof counts fixes; declined, stale, revoked proof and merge are separate', async t => {
  const refs = fence('keel-reconciliation', { implementation: [{ acceptance: 'export', evidence: 'docs/evidence/acme.md#run' }], prs: ['acme/app#12'], next: { kind: 'none' } });
  const root = await fixture(t, {}, {
    [phasePath]: phase('built', `## Reconciliation\n${refs}`),
    'docs/evidence/acme.md': '# Run\n' + fence('keel-proof', receipt()),
    'docs/loop/done.md': finding('done'),
    'docs/loop/declined.md': finding('declined', ['declined']),
    'docs/loop/stale.md': finding('stale', ['stale']),
  });
  let s = await snapshot({ root, now: NOW });
  assert.equal(metric(s, 'fixes-with-proof').value, 1);
  assert.equal(metric(s, 'loop-reported-done').value, 1);
  assert.equal(metric(s, 'phases-accepted-with-evidence').value, 1);
  let p = s.entities.find(e => e.kind === 'phase');
  assert.equal(p.proofs[0].sha, SHA);
  assert.equal(p.facts.merged.value, null);
  assert.equal(p.facts.productionVerified.value, null);
  assert.equal(p.facts.livedIn.value, null);
  await put(root, 'docs/evidence/acme.md', '# Run\n' + fence('keel-proof', receipt({ invalidated: true })));
  s = await snapshot({ root, now: NOW });
  assert.equal(metric(s, 'fixes-with-proof').value, 0);
  assert.equal(metric(s, 'phases-reported-built').value, 1);
  assert.ok(s.warnings.some(w => w.includes('proof-scope-mismatch')));
});

test('project-shaped phase anchors are distinct per project and unknown vocabulary stays unknown', async t => {
  const root = await fixture(t, { phases: { shape: 'projects' } }, {
    'docs/projects/kiln/phases.md': '# Kiln\n## Phase 1 — Acme\n**Status: CLOSED.**\n\n## Phase 2 — Next\n**Status: MYSTERY.**\n',
    'docs/projects/glaze/phases.md': '# Glaze\n## Phase 1 — Acme\n**Status: PART-DONE.**\n',
  });
  const s = await snapshot({ root, now: NOW }), ps = s.entities.filter(e => e.kind === 'phase');
  assert.equal(ps.length, 3);
  assert.equal(new Set(ps.map(p => p.key)).size, 3);
  assert.equal(ps.filter(p => p.status === 'unknown').length, 1);
  assert.equal(metric(s, 'phases-accepted-with-evidence').value, 0);
  assert.equal(ps.find(p => p.status === 'built').facts.productionVerified.value, null);
});

test('duplicate finding aliases and identical copied test runs do not inflate outcomes', async t => {
  const run = { date: '2026-10-07T10:00:00Z', commit: SHA, dirty: false, tree: SHA, tests: [{ name: 'Acme exports', file: 'tests/acme.test.mjs', outcome: 'pass', ms: 2 }] };
  const root = await fixture(t, {}, { 'docs/loop/a.md': finding('done'), 'docs/loop/b.md': finding('accepted'), '.keel/test-runs/a.json': run, '.keel/test-runs/b.json': run });
  const s = await snapshot({ root, now: NOW });
  assert.equal(s.entities.filter(e => e.kind === 'loop').length, 1);
  assert.equal(coverage(s, 'loop').status, 'unavailable');
  assert.equal(metric(s, 'loop-reported-done').value, null);
  assert.equal(metric(s, 'saved-test-runs').value, 1);
});

test('explicit GitHub read can observe merge without accepting the phase; offline failure stays unknown', async t => {
  const root = await fixture(t, {}, { [phasePath]: phase('partial', '## Reconciliation\n' + fence('keel-reconciliation', { prs: ['acme/app#12'], next: { kind: 'review-pr', ref: 'acme/app#12' } })) });
  const fake = join(root, 'fake-gh');
  await writeFile(fake, `#!${process.execPath}\nconsole.log(JSON.stringify(${JSON.stringify({ state: 'closed', draft: false, merged_at: '2026-10-07T12:00:00Z', merge_commit_sha: SHA })}));\n`);
  await chmod(fake, 0o755);
  const s = await snapshot({ root, now: NOW, github: true, env: { ...process.env, KEEL_GH: fake } });
  assert.equal(s.entities.find(e => e.kind === 'pr').facts.merged.value, true);
  assert.equal(s.entities.find(e => e.kind === 'phase').status, 'partial');
  assert.equal(metric(s, 'phases-accepted-with-evidence').value, 0);
  const offline = await snapshot({ root, now: NOW, github: true, env: { ...process.env, KEEL_GH: '/missing/acme-gh' } });
  assert.equal(coverage(offline, 'github').status, 'unavailable');
  assert.equal(offline.entities.some(e => e.kind === 'pr'), false);
});

test('supplied uncommitted night report yields measured values, broken intervals and no gate execution', async t => {
  const root = await fixture(t);
  await put(root, 'docs/health/2026-10-08.json', { date: '2026-10-08', measures: [{ id: 'latency', value: 900, state: 'ok', unit: 'ms' }] });
  const report = { date: '2026-10-08', measures: [{ id: 'latency', value: 12, unit: 'ms', better: 'lower', state: 'ok' }, { id: 'broken', value: 99, state: 'broken' }] };
  const s = await snapshot({ root, now: NOW, report });
  assert.equal(coverage(s, 'night-report').status, 'ok');
  assert.equal(metric(s, 'health-latency').value, 12);
  assert.equal(metric(s, 'health-latency').samples, 1);
  assert.equal(s.entities.filter(e => e.kind === 'health').length, 1);
  assert.equal(metric(s, 'health-broken').value, null);
  assert.equal(s.entities.find(e => e.source.type === 'supplied-report').source.type, 'supplied-report');
});

test('saved lifecycle artifacts and prior snapshots produce cohorts, review/queue/fleet counts and measured changes', async t => {
  const root = await fixture(t, {}, { 'docs/loop/a.md': finding('accepted') });
  const baseline = await snapshot({ root, now: '2026-09-01T12:00:00Z', report: { date: '2026-09-01', measures: [{ id: 'latency', value: 20, unit: 'ms', better: 'lower', state: 'ok' }] } });
  await put(root, 'docs/loop/a.md', finding('done'));
  const entity = (key, kind, status, rest = {}) => ({ key, kind, title: key, status, source: { path: 'docs/observations/acme.json', revision: SHA }, ...rest });
  const artifact = (source, entities, relations = []) => ({ schema: 1, source, projectKey: KEY, observedAt: '2026-10-07T12:00:00Z', entities, relations, observations: [] });
  const artifacts = [
    artifact('reviews', [entity('review:1', 'review', 'unanswered')]),
    artifact('dependencies', [entity('pr:dependency', 'pr', 'open')]),
    artifact('drain', [entity('pr:queue', 'pr', 'open')]),
    artifact('fleet', [entity('lesson:accepted', 'lesson', 'accepted'), entity('release:observed', 'release', 'published'), entity('update:received', 'update', 'applied', { practiceVersion: '1.2.3' })], [{ from: 'lesson:accepted', to: 'release:observed', kind: 'ships-in' }, { from: 'lesson:accepted', to: 'update:received', kind: 'adopted-by' }]),
  ];
  const s = await snapshot({ root, now: NOW, windowDays: 30, history: [baseline], artifacts, report: { date: '2026-10-08', measures: [{ id: 'latency', value: 10, unit: 'ms', better: 'lower', state: 'ok' }] } });
  assert.equal(metric(s, 'loop-completion-rate').value, 1);
  assert.equal(metric(s, 'loop-completion-rate').denominator, 1);
  assert.equal(metric(s, 'learning-adopted').value, 1);
  assert.equal(metric(s, 'reviews-unanswered').value, 1);
  assert.equal(metric(s, 'dependency-updates-open').value, 1);
  assert.equal(metric(s, 'queue-backlog').value, 1);
  assert.equal(metric(s, 'fleet-applied').value, 1);
  assert.equal(metric(s, 'observed-active-days').value, 1);
  assert.equal(metric(s, 'health-latency').samples, 1, 'outside-window sample is not smuggled into a trend');
  await assert.rejects(snapshot({ root, now: NOW, artifacts: [{ ...artifacts[0], projectKey: 'other' }] }), /artifact identity/);
  await assert.rejects(snapshot({ root, now: NOW, history: [{ ...baseline, schema: 2 }] }), /unsupported schema/);
  const within = structuredClone(baseline);
  within.generatedAt = '2026-10-01T12:00:00Z';
  for (const o of within.observations) if (o.field === 'measure:latency') o.occurredAt = '2026-10-01';
  const trend = await snapshot({ root, now: NOW, history: [within], report: { date: '2026-10-08', measures: [{ id: 'latency', value: 10, unit: 'ms', better: 'lower', state: 'ok' }] } });
  assert.equal(metric(trend, 'change-latency').value, -10);
  assert.equal(metric(trend, 'change-latency').unit, 'ms');
});

test('picked retro links distinguish implementation, evidence presence and receipt proof; declined stays excluded', async t => {
  const root = await fixture(t, {}, {
    [phasePath]: phase('built'), 'docs/evidence/acme.md': '# Acme manual evidence\n',
    'docs/retros/acme.json': { schema: 1, id: 'acme-retro', date: '2026-10-07', provider: 'manual', coverage: 'manual', candidates: [
      { id: 'picked', type: 'check', decision: { status: 'picked', date: '2026-10-07' }, links: [phasePath], evidence: [] },
      { id: 'declined', type: 'check', decision: { status: 'declined', date: '2026-10-07' }, links: [phasePath], evidence: [] },
    ] },
  });
  const s = await snapshot({ root, now: NOW });
  assert.equal(metric(s, 'retro-picked-implemented').value, 1);
  assert.equal(metric(s, 'retro-picked-evidence-present').value, 1);
  assert.equal(metric(s, 'retro-follow-through').value, 0);
  assert.equal(metric(s, 'retro-follow-through').denominator, 1);
});

test('unknown shapes, unsafe paths, schemas, duplicates and dangling references fail visibly', async t => {
  const root = await fixture(t, { phases: { shape: 'unknown' }, lessons: '../private.md' });
  const s = await snapshot({ root, now: NOW });
  assert.equal(coverage(s, 'phases').status, 'unsupported');
  assert.equal(coverage(s, 'lessons').status, 'unavailable');
  assert.throws(() => validateSnapshot({ ...s, schema: 2 }), /unsupported schema/);
  assert.throws(() => validateSnapshot({ ...s, entities: [...s.entities, s.entities[0]] }), /duplicate entity/);
  assert.throws(() => validateSnapshot({ ...s, relations: [{ from: 'missing', to: s.entities[0].key, kind: 'serves' }] }), /dangling relation/);
  const bad = structuredClone(s); bad.entities[0].source = { url: 'https://acme.test/path?token=fake' };
  assert.throws(() => validateSnapshot(bad), /unsafe source URL/);
  assert.throws(() => validateSnapshot({ ...s, rawSummary: 'private material' }), /private raw payload/);
  assert.throws(() => validateSnapshot({ ...s, warnings: ['https://user:fake@acme.test/path'] }), /unsafe embedded URL/);
  await mkdir(join(root, 'notes'), { recursive: true });
  await symlink(join(root, 'docs/goals.json'), join(root, 'notes/lessons.md'));
  await put(root, '.keel/keel.json', { name: 'Acme', lessons: 'notes/lessons.md' });
  assert.match(coverage(await snapshot({ root, now: NOW }), 'lessons').reason, /symlink/);
});

test('production and sustained-use receipts remain scoped; unrelated receipt sections do not lend proof', async t => {
  const r = { implementation: [{ acceptance: 'export', evidence: 'docs/evidence/acme.md#run' }], production: [{ acceptance: 'export', evidence: 'docs/evidence/acme.md#production' }], use: [{ acceptance: 'export', evidence: 'docs/evidence/acme.md#use' }], next: { kind: 'none' } };
  const root = await fixture(t, {}, {
    [phasePath]: phase('built', '## Reconciliation\n' + fence('keel-reconciliation', r)),
    'docs/evidence/acme.md': '# Run\n' + fence('keel-proof', receipt()) + '\n# Unrelated\n' + fence('keel-proof', receipt({ sha: 'b'.repeat(40) })) + '\n# Production\n' + fence('keel-proof', receipt({ kind: 'production', environment: 'production', deployment: 'acme-release' })) + '\n# Use\n' + fence('keel-proof', receipt({ kind: 'use', repeated: true, duration: '7 days', context: 'Acme operations', observations: ['first day works', 'seventh day works'] })),
  });
  const s = await snapshot({ root, now: NOW }), p = s.entities.find(e => e.kind === 'phase');
  assert.equal(p.facts.productionVerified.value, true);
  assert.equal(p.facts.livedIn.value, true);
  assert.equal(p.facts.merged.value, null);
  assert.equal(p.status, 'built');
  assert.equal(p.proofs.length, 3);
  assert.ok(p.proofs.every(r => r.sha === SHA));
});

test('explicit recorded acceptance/regression and usage receipts reduce without inventing history', async t => {
  const root = await fixture(t);
  const source = { path: 'docs/observations/acme.json', revision: SHA };
  const observations = [
    { id: 'acceptance', field: 'acceptedDelivery', value: true },
    { id: 'reopened', field: 'reopened', value: true },
    { id: 'cost', field: 'cost', value: 0.12, unit: 'USD', provider: 'acme-provider' },
  ].map(o => ({ ...o, entity: 'update:acme', source, sourceRevision: SHA, observedAt: '2026-10-07', occurredAt: '2026-10-06', quality: 'reported', evidence: ['docs/evidence/acme.md'] }));
  const artifact = { schema: 1, source: 'fleet', projectKey: KEY, observedAt: '2026-10-07', entities: [{ key: 'update:acme', kind: 'update', title: 'Acme', status: 'applied', source }], observations };
  const s = await snapshot({ root, now: NOW, artifacts: [artifact] });
  assert.equal(metric(s, 'cost').value, 0.12);
  assert.equal(metric(s, 'cost').unit, 'USD');
  assert.equal(metric(s, 'regression-rate').value, 1);
  assert.equal(metric(s, 'regression-rate').denominator, 1);
});

test('fresh reconciliation does not publish untracked research, and health cadence retains dated stale values', async t => {
  const root = await fixture(t, { canvas: { projectKey: KEY, cadence: 'nightly' } }, {
    'docs/research/foreign.md': '# Private Acme draft marker\n<a id="foreign"></a>\n## Foreign\n' + fence('keel-decision', { id: 'foreign', status: 'accepted', scope: ['acme'], decided_by: 'Private Acme draft marker', decided_at: '2026-10-01' }),
    'docs/health/2026-10-01.md': '# Health — 2026-10-01\n\n| Measure | Value | Bound | State | Detail |\n| --- | --- | --- | --- | --- |\n| `gate` — gate fails | 0 | ≤ 0 | ok | Saved |\n',
  });
  const original = await readFile(join(root, 'docs/research/foreign.md'), 'utf8');
  const s = await snapshot({ root, now: NOW });
  assert.equal(coverage(s, 'reconciliation').status, 'ok');
  assert.doesNotMatch(JSON.stringify(s), /Private Acme draft marker/);
  assert.equal(await readFile(join(root, 'docs/research/foreign.md'), 'utf8'), original);
  assert.equal(coverage(s, 'health').status, 'stale');
  assert.equal(coverage(s, 'health').latestSampleAt, '2026-10-01');
  assert.equal(metric(s, 'health-gate').unit, '0/1');
  assert.equal(metric(s, 'health-gate').coverage, 'stale');
  assert.equal(metric(s, 'health-gate').value, null);
  assert.equal(metric(s, 'health-gate').lastKnownValue, 0);
});


test('withHistory enriches entirely in memory, leaves inputs untouched and replaces prior window metrics', async t => {
  const root = await fixture(t, {}, { 'docs/loop/a.md': finding('accepted') });
  const baseline = await snapshot({ root, now: '2026-09-01T12:00:00Z' });
  await put(root, 'docs/loop/a.md', finding('done'));
  const current = await snapshot({ root, now: NOW });
  const original = structuredClone({ current, baseline });
  await rm(root, { recursive: true, force: true });
  const enriched = withHistory(current, [baseline, baseline], { windowDays: 30 });
  assert.equal(metric(enriched, 'loop-completion-rate').value, 1);
  assert.equal(enriched.history.snapshots, 1, 'duplicate retained snapshots count once');
  assert.equal(enriched.history.firstObservedAt, baseline.generatedAt);
  assert.deepEqual({ current, baseline }, original);
  assert.deepEqual(withHistory(enriched, [baseline]), enriched, 're-enrichment is idempotent');
  const replaced = withHistory(enriched, [], { windowDays: 7 });
  assert.equal(metric(replaced, 'loop-completion-rate').value, null, 'the old cohort must not leak into a new window');
  assert.equal(replaced.history.snapshots, 0);
  assert.equal(replaced.history.windowDays, 7);
  assert.deepEqual(current, original.current);
  assert.throws(() => withHistory(current, [current]), /must precede/);
  assert.throws(() => withHistory(current, [{ ...baseline, schema: 2 }]), /unsupported schema/);
  assert.throws(() => withHistory(current, [{ ...baseline, project: { ...baseline.project, key: 'other' } }]), /belong to this project/);
  assert.throws(() => withHistory(current, [baseline], { windowDays: 0 }), /windowDays/);
  assert.throws(() => withHistory(current, [baseline, { ...baseline, warnings: ['different'] }]), /conflicting history/);
});

test('milestone source is an explicit canvas gap, never a local built or empty plan', async t => {
  const root = await fixture(t, { phases: { source: 'milestones' } }, { [phasePath]: phase('built') });
  const s = await snapshot({ root, now: new Date(NOW) });
  assert.equal(coverage(s, 'phases').status, 'unsupported');
  assert.match(coverage(s, 'phases').reason, /milestones/);
  assert.equal(s.entities.filter(e => e.kind === 'phase').length, 0);
  assert.equal(metric(s, 'phases-reported-built').value, null);
});

test('milestone canvas suppresses archived goals and phases and discloses unsupported coverage for both', async t => {
  const root = await fixture(t, { phases: { source: 'milestones' } });
  const before = await Promise.all(['docs/goals.json', phasePath].map(p => readFile(join(root, p), 'utf8')));
  const s = await snapshot({ root, now: NOW, env: { ...process.env, KEEL_GH: '/no-real-gh' } });
  assert.deepEqual(s.entities.filter(e => ['goal', 'phase'].includes(e.kind)), []);
  for (const source of ['goals', 'phases']) assert.equal(coverage(s, source).status, 'unsupported');
  assert.deepEqual(await Promise.all(['docs/goals.json', phasePath].map(p => readFile(join(root, p), 'utf8'))), before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { reconcile, checkImpact, verifyProposal } from '../practices/reconciliation/files/scripts/keel/reconcile.mjs';
const engine = resolve('practices/reconciliation/files/scripts/keel/reconcile.mjs');
const phasePath = 'docs/phases/01-store.md';
const key = 'acme/app#12';
const sha = 'a'.repeat(40);
const merged = { state: 'closed', draft: false, merged_at: '2026-01-01T00:00:00Z', merge_commit_sha: sha };
const facts = { [key]: merged };
const fence = (type, data) => `\n\x60\x60\x60${type}\n${JSON.stringify({ version: 1, ...data })}\n\x60\x60\x60\n`;
const phase = (data = {}, box = ' ') => `---\nstatus: partial\n---\n# Acme store\n## Acceptance\n- [${box}] Budget holds <!-- acceptance: latency -->\n## Next action\nReview implementation.\n## Reconciliation\n${fence('keel-reconciliation', { prs: [key], next: { kind: 'review-pr', ref: key }, ...data })}`;
async function fixture(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'acme-reconciliation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) await put(root, path, text);
  return root;
}
async function put(root, path, text) { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text); }
const rules = out => out.findings.map(f => f.rule);
const decision = (id, data = {}) => `<a id="${id}"></a>\n## ${id}\n${fence('keel-decision', { id, status: 'accepted', scope: ['store'], decided_by: 'Acme owner', decided_at: '2026-01-01', ...data })}`;

test('merged review is stale; phase and unchecked acceptance are never modified; correction clears only justified finding', async t => {
  const original = phase(), root = await fixture(t, { [phasePath]: original });
  const out = await reconcile({ root, github: true, prFacts: facts });
  assert.deepEqual(rules(out), ['pr-state-contradiction']);
  assert.equal(await readFile(join(root, phasePath), 'utf8'), original);
  assert.equal(out.proposals[0].manual_only, true);
  await put(root, phasePath, phase({ next: { kind: 'acceptance', ref: 'latency' } }));
  assert.deepEqual(rules(await reconcile({ root, github: true, prFacts: facts })), []);
});
test('checked next, none with unresolved boxes, duplicate/missing IDs fail', async t => {
  const root = await fixture(t, { [phasePath]: phase({ next: { kind: 'acceptance', ref: 'latency' } }, 'x') });
  assert.ok(rules(await reconcile({ root })).includes('next-action-satisfied'));
  await put(root, phasePath, phase({ next: { kind: 'none' } }));
  assert.ok(rules(await reconcile({ root })).includes('next-action-satisfied'));
  await put(root, phasePath, phase({ next: { kind: 'acceptance', ref: 'missing' } }));
  assert.ok(rules(await reconcile({ root })).includes('acceptance-id'));
});
test('legacy inline action after trajectory and bare PR resolve through config; historical prose stays excluded', async t => {
  const root = await fixture(t, { '.keel/keel.json': JSON.stringify({ repo: 'acme/app' }), [phasePath]: '# Acme\n**Next action.** Review implementation in PR 12.\n\n## Trajectory\nOld draft PR 12.\n\n**Next action.** Review the draft PR.\n', 'docs/evidence/old.md': 'Draft PR 12 failed old budget.' });
  const out = await reconcile({ root, github: true, prFacts: facts });
  const notes = out.notes.filter(n => n.rule === 'pr-state-contradiction');
  assert.equal(notes.length, 2);
  assert.equal(notes[1].association, 'single same-document PR reference');
  assert.ok(notes.every(n => !n.observed.includes('Old draft')));
  assert.equal(out.findings.length, 0);
  await put(root, phasePath, '# Acme\nPR 12 merged; acceptance remains open.\n## Trajectory\nOld draft PR 12.');
  assert.equal((await reconcile({ root, github: true, prFacts: facts })).notes.filter(n => n.rule === 'pr-state-contradiction').length, 0);
});
test('ambiguous document PR associations stay silent', async t => {
  const root = await fixture(t, { [phasePath]: '# Acme\nacme/app#12 and acme/app#13\n**Next action.** Review the draft PR.' });
  const out = await reconcile({ root, github: true, prFacts: { ...facts, 'acme/app#13': merged } });
  assert.equal(out.notes.filter(n => n.rule === 'pr-state-contradiction').length, 0);
});
test('project phase scopes permit repeated acceptance IDs and do not borrow completed acceptance', async t => {
  const root = await fixture(t, { 'docs/projects/acme/phases.md': `# Acme\n## Phase 1 — first\n### Acceptance\n- [x] First <!-- acceptance: done -->\n### Reconciliation\n${fence('keel-reconciliation', { next: { kind: 'none' } })}\n## Phase 2 — second\n### Acceptance\n- [ ] Second <!-- acceptance: done -->\n### Reconciliation\n${fence('keel-reconciliation', { next: { kind: 'acceptance', ref: 'done' } })}` });
  assert.deepEqual(rules(await reconcile({ root })), []);
});
test('sample fences in research/design are ignored; explicit anchored decisions count', async t => {
  const root = await fixture(t, { 'docs/design.md': `# Examples\n${fence('keel-decision', { id: 'invalid' })}${fence('keel-reconciliation', { prs: ['bad'] })}`, 'docs/research/choice.md': decision('store') });
  assert.deepEqual(rules(await reconcile({ root })), []);
});
test('partial supersession preserves unaffected scopes; missing reciprocal and overlapping/cyclic successors fail', async t => {
  const old = 'docs/decisions/old.md#old', next = 'docs/decisions/new.md#new';
  const root = await fixture(t, { 'docs/decisions/old.md': decision('old', { scope: ['store', 'sources'], superseded_by: [next] }), 'docs/decisions/new.md': decision('new', { supersedes: [old] }), [phasePath]: phase({ decisions: [old], next: { kind: 'acceptance', ref: 'latency' } }) });
  const out = await reconcile({ root });
  assert.deepEqual(rules(out), ['decision-superseded']);
  assert.deepEqual(out.findings[0].successors[0].scope, ['store']);
  await put(root, 'docs/decisions/old.md', decision('old', { status: 'superseded', scope: ['store', 'sources'] }));
  assert.ok(rules(await reconcile({ root })).includes('decision-scope'));
  await put(root, 'docs/decisions/old.md', decision('old', { supersedes: [next] }));
  assert.ok(rules(await reconcile({ root })).includes('decision-cycle'));
  await put(root, 'docs/decisions/other.md', decision('other', { supersedes: [old] }));
  assert.ok(rules(await reconcile({ root })).includes('decision-scope'));
});
test('proposed successor does not supersede accepted architecture', async t => {
  const old = 'docs/decisions/old.md#old';
  const root = await fixture(t, { 'docs/decisions/old.md': decision('old'), 'docs/decisions/new.md': decision('new', { status: 'proposed', supersedes: [old] }), [phasePath]: phase({ decisions: [old], next: { kind: 'acceptance', ref: 'latency' } }) });
  assert.deepEqual(rules(await reconcile({ root })), []);
});
test('production receipt requires scoped pass, revision, environment and deployment; use needs repeated observations', async t => {
  const evidence = 'docs/evidence/store.md#run';
  const root = await fixture(t, { [phasePath]: phase({ production: [{ acceptance: 'latency', evidence }], next: { kind: 'acceptance', ref: 'latency' } }), 'docs/evidence/store.md': '# Run\nBuild passed on preview.' });
  assert.ok(rules(await reconcile({ root })).includes('proof-scope-mismatch'));
  const receipt = { kind: 'production', acceptance: 'latency', sha, environment: 'production', deployment: 'acme-release', observed_at: '2026-01-01', observer: 'Acme', claim: 'Budget holds', result: 'pass' };
  for (const change of [{ environment: 'preview' }, { result: 'fail' }, { sha: '' }, { acceptance: 'other' }, { invalidated: true }]) {
    await put(root, 'docs/evidence/store.md', '# Run\n' + fence('keel-proof', { ...receipt, ...change }));
    assert.ok(rules(await reconcile({ root })).includes('proof-scope-mismatch'));
  }
  await put(root, 'docs/evidence/store.md', '# Run\n' + fence('keel-proof', receipt));
  assert.deepEqual(rules(await reconcile({ root })), []);
  await put(root, phasePath, phase({ use: [{ acceptance: 'latency', evidence }], next: { kind: 'acceptance', ref: 'latency' } }));
  await put(root, 'docs/evidence/store.md', '# Run\n' + fence('keel-proof', { ...receipt, kind: 'use', repeated: true, duration: '2 weeks', context: 'Acme team', observations: [] }));
  assert.ok(rules(await reconcile({ root })).includes('proof-scope-mismatch'));
  await put(root, 'docs/evidence/store.md', '# Run\n' + fence('keel-proof', { ...receipt, kind: 'use', repeated: true, duration: '2 weeks', context: 'Acme team', observations: ['day 1 latency met', 'day 5 latency met'] }));
  assert.deepEqual(rules(await reconcile({ root })), []);
});
test('offline is skipped, requested missing/cached/error facts unknown; fork refs stay qualified', async t => {
  const root = await fixture(t, { [phasePath]: phase({ prs: ['acme/fork#12'] }) });
  assert.equal((await reconcile({ root })).snapshot.remote, 'skipped');
  for (const prFacts of [{}, { [key]: { ...merged, cached: true } }, { [key]: {} }]) assert.ok((await reconcile({ root, github: true, prFacts })).unknown.length);
  const out = await reconcile({ root, github: true, prFacts: { ...facts, 'acme/fork#12': { state: 'open', draft: true, merged_at: null } } });
  assert.equal(out.unknown.length, 0);
  assert.equal(out.snapshot.prs['acme/fork#12'].state, 'open');
});
test('closed-unmerged and reverted merged reviews remain obsolete, never acceptance proof', async t => {
  const root = await fixture(t, { [phasePath]: phase() });
  for (const value of [{ state: 'closed', draft: false, merged_at: null }, { ...merged, reverted: true }]) {
    const out = await reconcile({ root, github: true, prFacts: { [key]: value } });
    assert.deepEqual(rules(out), ['pr-state-contradiction']);
    assert.equal(out.findings[0].source.merged_at, value.merged_at);
  }
});
test('unsafe paths and symlinks fail without reading outside repo', async t => {
  const root = await fixture(t, { [phasePath]: phase({ decisions: ['docs/decisions/../../secret.md', '/tmp/secret.md', 'docs/decisions/link.md'] }) });
  await mkdir(join(root, 'docs/decisions'), { recursive: true });
  await symlink('/etc/passwd', join(root, 'docs/decisions/link.md'));
  const out = await reconcile({ root });
  assert.equal(out.findings.filter(f => f.rule === 'record-reference').length, 3);
  assert.ok(out.unknown.some(f => f.path === 'docs/decisions/link.md'));
});
test('fingerprints stable across clock and duplicate findings; verification rejects local/remote/inventory changes', async t => {
  const root = await fixture(t, { [phasePath]: phase() });
  const run = extra => reconcile({ root, github: true, prFacts: facts, ...extra });
  const first = await run({ now: '2026-01-01' }), second = await run({ now: '2030-01-01' });
  assert.equal(first.proposals[0].fingerprint, second.proposals[0].fingerprint);
  const proposal = first.proposals[0], verify = extra => verifyProposal({ root, proposal, github: true, prFacts: facts, ...extra });
  assert.equal((await verify()).valid, true);
  assert.equal((await verify({ github: false })).valid, false);
  assert.equal((await verify({ prFacts: { [key]: { ...merged, head: { sha: 'b'.repeat(40) } } } })).valid, false);
  await put(root, 'docs/decisions/new.md', decision('new'));
  assert.equal((await verify()).valid, false);
  await rm(join(root, 'docs/decisions/new.md'));
  assert.equal((await verify()).valid, true);
  await put(root, phasePath, phase() + '\nAcme edit');
  assert.equal((await verify()).valid, false);
  await rm(join(root, phasePath));
  assert.equal((await verify()).valid, false);
});
test('open correction PR does not correct checked-out main', async t => {
  const root = await fixture(t, { [phasePath]: phase({ prs: [key, 'acme/app#38'] }) });
  const out = await reconcile({ root, github: true, prFacts: { ...facts, 'acme/app#38': { state: 'open', draft: false, merged_at: null, merge_commit_sha: 'b'.repeat(40), body: 'All records fixed on this branch' } } });
  assert.deepEqual(rules(out), ['pr-state-contradiction']);
  assert.equal(out.findings[0].source.pr, key);
  assert.equal(out.snapshot.prs['acme/app#38'].merged_at, null);
  // GitHub supplies a provisional test-merge SHA for an open PR. Reviewing
  // that PR is still valid work; the SHA alone is not a merge observation.
  await put(root, phasePath, phase({ next: { kind: 'review-pr', ref: 'acme/app#38' } }));
  const reviewing = await reconcile({ root, github: true, prFacts: { ...facts, 'acme/app#38': { state: 'open', draft: false, merged_at: null, merge_commit_sha: 'b'.repeat(40) } } });
  assert.deepEqual(rules(reviewing), []);
});
test('legacy settled research is advisory; no invented decision truth', async t => {
  const root = await fixture(t, { 'docs/research/store.md': '# Acme\n## Decisions for the owner\n*Settled 2026-01-01*: Postgres.', [phasePath]: '# Acme\n## Deliberately open\nStore and auth choice.' });
  const out = await reconcile({ root });
  assert.deepEqual(rules(out), []);
  assert.ok(out.notes.some(n => n.rule === 'legacy-unstructured-decision' && n.confidence === 'advisory'));
});
test('impact missing, none reason, unchanged per-record reasons, anchor checks and direct edit coverage', async t => {
  const root = await fixture(t, { [phasePath]: phase(), 'docs/decisions/store.md': decision('store') });
  const run = (value, changedFiles = []) => checkImpact({ root, body: value === null ? '' : fence('keel-impact', value), changedFiles });
  assert.ok((await run(null)).findings.length);
  assert.ok((await run({ reconciliation: 'none' })).findings.length);
  assert.equal((await run({ reconciliation: 'none', reason: 'Acme tooling only' })).findings.length, 0);
  assert.ok((await run({ reconciliation: 'none', reason: 'docs' }, [phasePath])).findings.length);
  const decl = { reconciliation: 'updated', phases: [phasePath], decisions: ['docs/decisions/store.md#store'] };
  assert.equal((await run(decl, [phasePath])).findings.length, 1);
  assert.equal((await run({ ...decl, unchanged: { 'docs/decisions/store.md#store': 'Implementation preserves the accepted choice' } }, [phasePath])).findings.length, 0);
  assert.ok((await run({ ...decl, decisions: ['docs/decisions/store.md#missing'] }, [phasePath])).findings.length);
});
test('actual git diff and CLI event validate coverage; JSON exits 0/1/2', async t => {
  const root = await fixture(t, { [phasePath]: phase(), 'note.txt': 'Acme' });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'Acme base');
  const base = git('rev-parse', 'HEAD');
  await put(root, phasePath, phase() + '\nAcme change');
  git('add', '.'); git('commit', '-qm', 'Acme head');
  const head = git('rev-parse', 'HEAD');
  const body = fence('keel-impact', { reconciliation: 'updated', phases: [phasePath] });
  assert.equal((await checkImpact({ root, base, head, body })).findings.length, 0);
  await put(root, 'event.json', JSON.stringify({ pull_request: { body, base: { sha: base }, head: { sha: head } } }));
  const eventResult = run(process.execPath, [engine, '--json', '--event', 'event.json'], { cwd: root });
  assert.equal(eventResult.status, 0, eventResult.stdout + eventResult.stderr);
  assert.equal(JSON.parse(eventResult.stdout).findings.length, 0);
  await put(root, 'body.txt', 'No declaration');
  for (const [args, expected] of [[['--impact', 'body.txt', '--base', base, '--head', head], 1], [['--wat'], 2]]) {
    const failed = run(process.execPath, [engine, '--json', ...args], { cwd: root });
    assert.equal(failed.status, expected, failed.stdout + failed.stderr);
    assert.ok(JSON.parse(failed.stdout));
  }
});

test('impact covers actual anchored research/design decisions, not illustrative fences', async t => {
  const root = await fixture(t, { 'docs/research/store.md': decision('store'), 'docs/design.md': decision('design'), [phasePath]: phase() });
  const declaration = { reconciliation: 'updated', phases: [phasePath] };
  const changedFiles = [phasePath, 'docs/research/store.md', 'docs/design.md'];
  const absent = await checkImpact({ root, changedFiles, body: fence('keel-impact', declaration) });
  assert.equal(absent.findings.filter(f => f.message.includes('anchored decision')).length, 2);
  const covered = await checkImpact({ root, changedFiles, body: fence('keel-impact', { ...declaration, decisions: ['docs/research/store.md#store', 'docs/design.md#design'] }) });
  assert.deepEqual(covered.findings, []);
  await put(root, 'docs/design.md', '# Example\n' + fence('keel-decision', { id: 'sample' }));
  assert.deepEqual((await checkImpact({ root, changedFiles: ['docs/design.md'], body: fence('keel-impact', { reconciliation: 'none', reason: 'Example only' }) })).findings, []);
});
test('advisory candidates have deduplicated manual proposals with freshness checks', async t => {
  const root = await fixture(t, { [phasePath]: '# Acme\nReview draft acme/app#12\nReview draft acme/app#12' });
  const out = await reconcile({ root, github: true, prFacts: facts });
  assert.equal(out.findings.length, 0);
  assert.equal(out.proposals.length, 1);
  assert.equal(out.proposals[0].confidence, 'advisory');
  assert.equal((await verifyProposal({ root, proposal: out.proposals[0], github: true, prFacts: facts })).valid, true);
});
test('GitHub boundary uses read-only execFile arguments and reports invalid or unavailable response', async t => {
  const root = await fixture(t, { [phasePath]: phase(), 'gh': `#!/usr/bin/env node\nif (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['api', 'repos/acme/app/pulls/12'])) process.exit(9);\nconsole.log(JSON.stringify(${JSON.stringify(merged)}));\n` });
  const { chmod } = await import('node:fs/promises');
  await chmod(join(root, 'gh'), 0o755);
  const out = await reconcile({ root, github: true, env: { ...process.env, KEEL_GH: join(root, 'gh') } });
  assert.equal(out.unknown.length, 0);
  assert.deepEqual(rules(out), ['pr-state-contradiction']);
  const fail = await reconcile({ root, github: true, env: { ...process.env, KEEL_GH: join(root, 'absent-gh') } });
  assert.equal(fail.snapshot.remote, 'incomplete');
  assert.equal(fail.unknown[0].rule, 'github-unavailable');
});
test('oversized records and malformed fences cannot silently pass', async t => {
  const root = await fixture(t, { [phasePath]: 'x'.repeat(1024 * 1024 + 1) });
  assert.ok((await reconcile({ root })).unknown.length);
  await put(root, phasePath, '# Acme\n## Reconciliation\n```keel-reconciliation\n{"version":1,"prs":{}}\n```');
  assert.deepEqual(rules(await reconcile({ root })), ['record-schema']);
  await put(root, phasePath, '# Acme\n## Reconciliation\n```keel-reconciliation\n{"version":1}');
  assert.deepEqual(rules(await reconcile({ root })), ['record-schema']);
});
test('legacy PR prose ignores product review, negated corrections, and history; unknown PR needs association', async t => {
  const root = await fixture(t, { [phasePath]: '# Acme\nacme/app#12\nKnowledge and review rules.\nReview acknowledgements preserve history.\nPR 12 is merged; review is no longer the next step.\n## Trajectory\nReview draft acme/app#12.\n\n**Next action.** Review the draft PR.' });
  const out = await reconcile({ root, github: true, prFacts: facts });
  assert.equal(out.notes.filter(n => n.rule === 'pr-state-contradiction').length, 1);
  assert.match(out.proposals[0].proposed_edit, /observed merge/);
  await put(root, phasePath, '# Acme\n**Next action.** Review the draft PR.');
  const missing = await reconcile({ root, github: true, prFacts: facts });
  assert.equal(missing.notes.filter(n => n.rule === 'pr-state-contradiction').length, 0);
  assert.ok(missing.notes.some(n => n.rule === 'pr-reference-unresolved'));
});
test('duplicate acceptance marker in one phase fails, then clears after removing duplicate', async t => {
  const valid = phase({ next: { kind: 'acceptance', ref: 'latency' } });
  const root = await fixture(t, { [phasePath]: valid + '\n- [x] Another claim <!-- acceptance: latency -->' });
  assert.ok(rules(await reconcile({ root })).includes('acceptance-id'));
  await put(root, phasePath, valid);
  assert.ok(!rules(await reconcile({ root })).includes('acceptance-id'));
});
test('actual diff catches deleted research/design decision fences from merge base', async t => {
  const root = await fixture(t, { 'docs/research/store.md': decision('store'), 'docs/design.md': decision('design') });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'Acme decisions');
  const base = git('rev-parse', 'HEAD');
  for (const path of ['docs/research/store.md', 'docs/design.md']) await put(root, path, '# Acme\nDecision removed.');
  git('add', '.'); git('commit', '-qm', 'Acme removed decisions');
  const head = git('rev-parse', 'HEAD');
  const body = fence('keel-impact', { reconciliation: 'none', reason: 'Acme prose cleanup' });
  const out = await checkImpact({ root, base, head, body });
  assert.equal(out.findings.filter(f => f.message.includes('anchored decision')).length, 2);
  const declared = await checkImpact({ root, base, head, body: fence('keel-impact', { reconciliation: 'updated', decisions: ['docs/research/store.md#store', 'docs/design.md#design'] }) });
  assert.equal(declared.findings.filter(f => f.message.includes('missing anchor')).length, 2);
  await put(root, 'docs/research/store.md', decision('store', { status: 'withdrawn' }));
  await put(root, 'docs/design.md', decision('design', { status: 'withdrawn' }));
  git('add', '.'); git('commit', '-qm', 'Acme retains retired history');
  const fixed = await checkImpact({ root, base, head: git('rev-parse', 'HEAD'), body: fence('keel-impact', { reconciliation: 'updated', decisions: ['docs/research/store.md#store', 'docs/design.md#design'] }) });
  assert.deepEqual(fixed.findings, []);
});

test('standalone CLI follows a symlinked entry and preserves JSON and exit status', async t => {
  const root = await fixture(t, { [phasePath]: phase({ next: { kind: 'acceptance', ref: 'latency' } }, 'x') });
  const entry = join(root, 'acme-reconcile.mjs');
  await symlink(engine, entry);
  const contradiction = run(process.execPath, [entry, '--json'], { cwd: root });
  assert.equal(contradiction.status, 1, contradiction.stdout + contradiction.stderr);
  assert.ok(rules(JSON.parse(contradiction.stdout)).includes('next-action-satisfied'));
  await put(root, phasePath, phase({ next: { kind: 'acceptance', ref: 'latency' } }));
  const clean = run(process.execPath, [entry, '--json'], { cwd: root });
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.deepEqual(JSON.parse(clean.stdout).findings, []);
});

test('ordinary research deletion allows none with reason; whole decision deletion still fails', async t => {
  const plain = 'docs/research/notes.md', record = 'docs/research/store.md';
  const root = await fixture(t, { [plain]: '# Acme\nObsolete investigation notes.', [record]: decision('store') });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'Acme research');
  const base = git('rev-parse', 'HEAD');
  await rm(join(root, plain));
  git('add', '.'); git('commit', '-qm', 'Acme removes obsolete notes');
  const body = fence('keel-impact', { reconciliation: 'none', reason: 'Remove obsolete Acme investigation notes; no decision records changed' });
  const ordinary = await checkImpact({ root, base, head: git('rev-parse', 'HEAD'), body });
  assert.deepEqual(ordinary.findings, []);
  assert.deepEqual(ordinary.unknown, []);
  await rm(join(root, record));
  git('add', '.'); git('commit', '-qm', 'Acme deletes decision');
  const head = git('rev-parse', 'HEAD');
  const omitted = await checkImpact({ root, base, head, body });
  assert.ok(omitted.findings.some(f => f.path === `${record}#store` && f.message.includes('anchored decision')));
  const declared = await checkImpact({ root, base, head, body: fence('keel-impact', { reconciliation: 'updated', decisions: [`${record}#store`] }) });
  assert.ok(declared.findings.some(f => f.path === `${record}#store` && f.message.includes('ENOENT')));
});

test('numbered lessons are not PRs and qualified external PRs are never requalified', async t => {
  const root = await fixture(t, {
    '.keel/keel.json': JSON.stringify({ repo: 'acme/app' }),
    [phasePath]: '# Acme\nLessons #16, #17, #18, #19, #23, #46 and #48 guide this work.\nReview draft acme/external#38.\nReview draft acme/PR#39.\nReview draft https://github.com/acme/external/pull/40.\nReview PR 12.\nReview PR#13.\nReview PR14.',
  });
  const prFacts = { ...facts };
  for (const ref of ['acme/external#38', 'acme/PR#39', 'acme/external#40', 'acme/app#13', 'acme/app#14']) prFacts[ref] = merged;
  const out = await reconcile({ root, github: true, prFacts });
  assert.deepEqual(out.unknown, []);
  assert.deepEqual(Object.keys(out.snapshot.prs).sort(), Object.keys(prFacts).sort());
  assert.equal(out.notes.filter(n => n.rule === 'pr-state-contradiction').length, 6);
  await put(root, phasePath, '# Acme\nLessons #16, #17 and #48 inform review history.');
  const lessons = await reconcile({ root, github: true, prFacts: {} });
  assert.deepEqual(lessons.snapshot.prs, {});
  assert.deepEqual(lessons.unknown, []);
  assert.equal(lessons.proposals.length, 0);
});

test('generic open PR product specification is not unresolved work; explicit open claims still compare', async t => {
  const root = await fixture(t, { [phasePath]: '# Acme loose ends\n## Done when\nLists an open PR, a draft PR, and unfinished work for the owner.\n## Next action\nImplement the list.' });
  const spec = await reconcile({ root, github: true, prFacts: {} });
  assert.equal(spec.notes.filter(n => n.rule === 'pr-reference-unresolved').length, 0);
  assert.deepEqual(spec.proposals, []);
  await put(root, phasePath, '# Acme\nImplementation is in the draft PR.');
  const concrete = await reconcile({ root, github: true, prFacts: {} });
  assert.equal(concrete.notes.filter(n => n.rule === 'pr-reference-unresolved').length, 1);
  await put(root, phasePath, '# Acme\nImplementation is in an open PR acme/app#12.');
  const explicit = await reconcile({ root, github: true, prFacts: facts });
  assert.equal(explicit.notes.filter(n => n.rule === 'pr-state-contradiction').length, 1);
});

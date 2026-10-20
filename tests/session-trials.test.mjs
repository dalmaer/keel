import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { run } from './helpers/run.mjs';
import { sessionTrials, sessionTrialSummary, handoffRecommendation } from '../lib/session-trials.mjs';
const BIN = fileURLToPath(new URL('../bin/keel.mjs', import.meta.url));
const spec = (extra = {}) => ({ version: 1, id: 'acme', provider: 'Acme', model: 'Acme-1', cohort: 'Acme-small', baseline: { contextTokens: null, atBoundary: true, maxHandoffs: 2 }, candidate: { contextTokens: 40000, atBoundary: true, maxHandoffs: 2 }, minPairs: 3, minImprovement: 0.1, maxRuns: 10, budgetMinutes: 200, reserveMinutes: 20, automatic: false, ...extra });
const descriptor = (id, extra = {}) => ({ id, provider: 'Acme', model: 'Acme-1', cohort: 'Acme-small', task: `Acme task ${id}`, taskClass: 'Acme-test', sourceRevision: 'acme-rev', evidence: ['evidence/acme-admission'], ...extra });
const finish = (runId, extra = {}) => ({ runId, totalMinutes: 10, costUsd: null, costSource: null, accepted: true, verified: true, policyApplied: true, lostDecisions: 0, duplicateActions: 0, regressions: 0, rework: 0, contextPeakTokens: null, sourceRevision: 'acme-result', acceptanceEvidence: 'evidence/acme-acceptance', evidence: ['evidence/acme-full-workflow'], ...extra });
const handoff = (runId, extra = {}) => ({ id: 'handoff1', runId, goal: 'Acme goal', remainingAcceptance: ['Acme proof'], decisions: { ownerChoices: ['keep baseline'], suggestions: ['try candidate'] }, revision: 'acme-dirty', dirtyPaths: ['lib/acme.mjs'], proof: ['node --test tests/acme.test.mjs'], evidence: ['evidence/acme-proof'], activeJobs: [], nextAction: 'Verify Acme proof', claim: 'claims/phase-72', remainingBudget: 10, contextTokens: null, boundaryReached: true, safeBoundary: true, uncertainWrites: false, ...extra });
async function world(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'acme-session-trials-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel')); await writeFile(join(root, '.keel', 'keel.json'), '{"name":"Acme"}');
  const call = (action, record, extra = {}) => sessionTrials({ root, action, record, experiment: 'acme', yes: true, ...extra });
  return { root, call, state: join(root, '.keel/session-trials/acme/state.json') };
}
async function pairs(w, adjust = () => ({}), count = 6) {
  let result;
  for (let n = 0; n < count; n++) {
    const id = `run${n}`;
    const admitted = await w.call('begin', descriptor(id));
    const arm = admitted.runs.at(-1).arm;
    result = await w.call('finish', finish(id, { totalMinutes: arm === 'baseline' ? 10 : 8, ...adjust(n, arm) }));
  }
  return result;
}
function cli(root, args) {
  const result = run(process.execPath, [BIN, ...args, '--json'], { cwd: root, env: { ...process.env, KEEL_CLAUDE_DIR: join(root, 'synthetic-transcripts') } });
  return { code: result.status, data: JSON.parse(result.stdout) };
}

test('preview writes nothing, absent experiments are off, and roots isolate receipts', async t => {
  const w = await world(t), other = await world(t);
  assert.equal((await sessionTrialSummary({ root: w.root })).enabled, false);
  assert.equal((await w.call('start', spec(), { yes: false })).preview, true);
  assert.deepEqual(await readdir(join(w.root, '.keel')), ['keel.json']);
  await w.call('start', spec());
  const bytes = await readFile(w.state, 'utf8');
  await w.call('begin', descriptor('r'), { yes: false });
  assert.equal(await readFile(w.state, 'utf8'), bytes);
  assert.equal((await sessionTrialSummary({ root: other.root })).enabled, false);
  await assert.rejects(w.call('start', spec()), /already exists/);
});

test('ABBA reserves active runs and pairs exact taskClass; run identities never retry', async t => {
  const w = await world(t); await w.call('start', spec({ budgetMinutes: 80 }));
  for (let n = 0; n < 4; n++) await w.call('begin', descriptor(`r${n}`));
  const s = await w.call('status');
  assert.deepEqual(s.runs.map(r => r.arm), ['baseline', 'candidate', 'candidate', 'baseline']);
  assert.deepEqual(s.runs.map(r => r.pair), [0, 0, 1, 1]);
  assert.equal(s.audit.budget.reservedMinutes, 80);
  await assert.rejects(w.call('begin', descriptor('r4')), /budget exhausted/);
  await assert.rejects(w.call('begin', descriptor('r0')), /already reserved/);
  await w.call('finish', finish('r0', { totalMinutes: 21 }));
  await assert.rejects(w.call('begin', descriptor('r5')), /budget exhausted/);
  await assert.rejects(w.call('finish', finish('r0')), /already finished/);
});

test('missing, equal, noisy, unknown, rejected, expensive and regressed outcomes cannot promote', async t => {
  for (const [name, patch, verdict] of [
    ['equal', { totalMinutes: 10 }, 'inconclusive'], ['noise', { totalMinutes: 9.5 }, 'inconclusive'],
    ['unknown', { verified: null }, 'inconclusive'], ['missing-quality', { rework: null }, 'inconclusive'],
    ['unknown-policy', { policyApplied: null }, 'inconclusive'], ['unapplied-policy', { policyApplied: false }, 'inconclusive'],
    ['rejected', { accepted: false }, 'worse'], ['unverified', { verified: false }, 'worse'],
    ['expensive', { totalMinutes: 11 }, 'worse'], ['regression', { regressions: 1 }, 'worse'],
  ]) {
    await t.test(name, async t => {
      const w = await world(t); await w.call('start', spec());
      const result = await pairs(w, (n, arm) => arm === 'candidate' && n === 1 ? patch : {});
      assert.equal(result.audit.verdict, verdict);
      assert.equal(result.audit.denominator, 3);
      await assert.rejects(w.call('apply'), /fresh audit/);
    });
  }
  const w = await world(t); await w.call('start', spec()); await pairs(w);
  await w.call('begin', descriptor('unfinished'));
  assert.equal((await w.call('audit')).audit.verdict, 'inconclusive');
  await assert.rejects(w.call('apply'), /fresh audit/);
});

test('proven better promotes only scoped policy, running snapshots survive, adverse finish rolls back', async t => {
  const w = await world(t); await w.call('start', spec({ automatic: true }));
  const config = await readFile(join(w.root, '.keel/keel.json'), 'utf8');
  const promoted = await pairs(w);
  assert.equal(promoted.audit.verdict, 'better'); assert.equal(promoted.effective, 'candidate');
  assert.equal(promoted.audit.numerator, 3); assert.equal(promoted.audit.completePairs, 3);
  assert.deepEqual(promoted.transitions[0].sourceIds, ['run0', 'run1', 'run2', 'run3', 'run4', 'run5']);
  const running = await w.call('begin', descriptor('adverse'));
  assert.equal(running.runs.at(-1).policy.contextTokens, 40000);
  // An incomplete sample alone must not roll back.
  assert.equal((await w.call('audit')).effective, 'candidate');
  const rolled = await w.call('finish', finish('adverse', { lostDecisions: 1 }));
  assert.equal(rolled.effective, 'baseline'); assert.equal(rolled.transitions.length, 2);
  assert.equal(rolled.runs.at(-1).policy.contextTokens, 40000);
  assert.deepEqual(rolled.transitions[1].sourceIds, ['adverse']);
  assert.equal(await readFile(join(w.root, '.keel/keel.json'), 'utf8'), config);
});

test('manual apply audits fresh receipts and previews; rollback is always available', async t => {
  const w = await world(t); await w.call('start', spec()); await pairs(w);
  assert.equal((await w.call('apply', undefined, { yes: false })).effective, 'candidate');
  assert.equal((await w.call('status')).effective, 'baseline');
  assert.equal((await w.call('apply')).effective, 'candidate');
  assert.equal((await w.call('rollback')).effective, 'baseline');
  assert.equal((await w.call('rollback')).effective, 'baseline');
  await w.call('begin', descriptor('new-run'));
  await assert.rejects(w.call('apply'), /latched baseline/);
});

test('handoffs retain owner decisions, bound count, reject uncertain writes and duplicate receipts', async t => {
  const w = await world(t); await w.call('start', spec()); await w.call('begin', descriptor('r'));
  for (const patch of [{ uncertainWrites: true }, { safeBoundary: false }, { claimToken: 'fake-acme' }]) await assert.rejects(w.call('handoff', handoff('r', patch)));
  const h = await w.call('handoff', handoff('r'));
  assert.deepEqual(h.runs[0].handoffs[0].decisions.ownerChoices, ['keep baseline']);
  assert.deepEqual(h.runs[0].handoffs[0].decisions.suggestions, ['try candidate']);
  await assert.rejects(w.call('handoff', handoff('r')), /already recorded/);
  await w.call('handoff', handoff('r', { id: 'h2' }));
  await assert.rejects(w.call('handoff', handoff('r', { id: 'h3' })), /limit exhausted/);
  await w.call('finish', finish('r'));
  await assert.rejects(w.call('handoff', handoff('r', { id: 'h4' })), /already finished/);
  assert.equal(h.recommendation.automaticRotation, false);
  assert.equal(h.recommendation.status, 'due');
  assert.equal(h.recommendation.contextTokens, null);
});

test('strict schemas, scope and measurements refuse malformed or invented data', async t => {
  const w = await world(t);
  for (const patch of [{ id: '../escape' }, { version: 2 }, { minPairs: 2 }, { maxRuns: 5 }, { minImprovement: 0 }, { reserveMinutes: 201 }, { automatic: 'yes' }, { baseline: spec().candidate }, { candidate: { ...spec().candidate, maxHandoffs: 3 } }, { token: 'fake-acme' }]) await assert.rejects(w.call('start', spec(patch)));
  await w.call('start', spec());
  for (const patch of [{ provider: 'other' }, { model: 'other' }, { cohort: 'other' }, { task: '' }, { taskClass: '' }, { evidence: [] }]) await assert.rejects(w.call('begin', descriptor('r', patch)));
  await w.call('begin', descriptor('r'));
  await assert.rejects(w.call('begin', descriptor('s', { taskClass: 'different' })), /taskClass/);
  for (const patch of [{ totalMinutes: 0 }, { totalMinutes: -1 }, { costUsd: 2 }, { costUsd: -1, costSource: 'evidence/cost' }, { acceptanceEvidence: null }, { evidence: [] }, { verified: 'true' }, { policyApplied: 'true' }, { rework: -1 }, { contextPeakTokens: -1 }, { transcript: 'fake-acme' }]) await assert.rejects(w.call('finish', finish('r', patch)));
  assert.equal((await w.call('finish', finish('r', { costUsd: 0, costSource: 'evidence/cost' }))).runs[0].finish.costUsd, 0);
});

test('symlinks, corrupt and interrupted state fail closed without reclaim or leaking records', async t => {
  const w = await world(t); await w.call('start', spec());
  const home = join(w.root, '.keel/session-trials');
  await writeFile(join(home, '.lock'), 'fake-acme-lock');
  await assert.rejects(w.call('begin', descriptor('r')), /locked/);
  assert.equal(await readFile(join(home, '.lock'), 'utf8'), 'fake-acme-lock');
  await rm(join(home, '.lock'));
  const original = await readFile(w.state, 'utf8');
  await writeFile(w.state, '{fake-acme-private');
  await assert.rejects(w.call('status'), e => e.message.includes('invalid JSON') && !e.message.includes('fake-acme-private'));
  assert.equal((await sessionTrialSummary({ root: w.root })).coverage.complete, false);
  await writeFile(w.state, original);
  await rm(w.state); await symlink(join(w.root, '.keel/keel.json'), w.state);
  await assert.rejects(w.call('begin', descriptor('r')), /unsafe storage/);
  await rm(w.state);
  await assert.rejects(w.call('start', spec()), /already exists/);
  await assert.rejects(w.call('status'), /incomplete experiment/);
  await assert.rejects(w.call('audit', undefined, { experiment: '../acme' }), /safe experiment/);
  const other = await world(t);
  await symlink(home, join(other.root, '.keel/session-trials'));
  await assert.rejects(other.call('start', spec()), /unsafe storage/);
  const corrupted = JSON.parse(original); corrupted.events.push({ action: 'finish', record: finish('absent'), at: new Date().toISOString() });
  await writeFile(w.state, JSON.stringify(corrupted)); await assert.rejects(w.call('status'), /absent/);
});

test('CLI full paired cycle, improve summary, preview and JSON errors use actual dispatcher', async t => {
  const w = await world(t);
  let seq = 0;
  async function command(action, record, yes = true) {
    const args = ['retro', 'sessions', action, '--experiment', 'acme'];
    if (record) { const path = join(w.root, `record${seq++}.json`); await writeFile(path, JSON.stringify(record)); args.push('--record', path); }
    if (yes) args.push('--yes');
    const result = cli(w.root, args); assert.equal(result.code, 0, JSON.stringify(result.data)); return result.data;
  }
  await command('start', spec());
  for (let n = 0; n < 6; n++) {
    const begun = await command('begin', descriptor(`r${n}`));
    await command('finish', finish(`r${n}`, { totalMinutes: begun.runs.at(-1).arm === 'baseline' ? 10 : 8 }));
  }
  const before = await readFile(w.state, 'utf8');
  const summary = cli(w.root, ['improve', '--sessions']); assert.equal(summary.code, 0);
  assert.equal(summary.data.experiments[0].audit.verdict, 'better');
  assert.equal(await readFile(w.state, 'utf8'), before);
  assert.equal((await command('apply', undefined, false)).preview, true);
  assert.equal((await command('apply')).effective, 'candidate');
  assert.equal((await command('rollback')).effective, 'baseline');
  const invalid = cli(w.root, ['retro', 'sessions', 'begin', '--record', 'missing']); assert.equal(invalid.code, 2); assert.ok(invalid.data.error);
  assert.equal(cli(w.root, ['improve', '--sessions', '--yes']).code, 2);
  assert.equal(cli(w.root, ['retro', 'sessions', 'status']).data.experiments.length, 1);
});

test('real concurrent CLI admissions serialize without lost reservations or budget overspend', async t => {
  const w = await world(t); await w.call('start', spec({ budgetMinutes: 20 }));
  const workers = [];
  t.after(async () => { await Promise.all(workers.map(w => w.terminate())); });
  const paths = await Promise.all(['a', 'b'].map(async id => { const path = join(w.root, `${id}.json`); await writeFile(path, JSON.stringify(descriptor(id))); return path; }));
  // Workers allow two synchronous hermetic run helpers to execute concurrently.
  const workerSource = `import { parentPort, workerData } from 'node:worker_threads';
    import { run } from ${JSON.stringify(new URL('./helpers/run.mjs', import.meta.url).href)};
    parentPort.postMessage(run(workerData.node, workerData.args, workerData.options));`;
  const results = await Promise.all(paths.map(path => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(workerSource)), { workerData: {
      node: process.execPath, args: [BIN, 'retro', 'sessions', 'begin', '--experiment', 'acme', '--record', path, '--yes', '--json'],
      options: { cwd: w.root, env: { ...process.env, KEEL_CLAUDE_DIR: join(w.root, 'synthetic-transcripts') } },
    } });
    workers.push(worker); worker.on('error', reject);
    worker.on('message', result => resolve({ code: result.status, data: JSON.parse(result.stdout) }));
    worker.on('exit', code => { if (code !== 0) reject(new Error(`Acme worker exited ${code}`)); });
  })));
  assert.equal(results.filter(r => r.code === 0).length, 1);
  assert.equal(results.filter(r => r.code === 2).length, 1);
  const state = await w.call('status'); assert.equal(state.runs.length, 1); assert.equal(state.audit.budget.reservedMinutes, 20);
});

test('recommendations respect measured occupancy, boundary, uncertainty and handoff limit', async t => {
  const p = spec().candidate;
  const o = { contextTokens: null, boundaryReached: false, safeBoundary: true, uncertainWrites: false };
  assert.equal(handoffRecommendation(p, o).status, 'unknown');
  assert.equal(handoffRecommendation(p, { ...o, contextTokens: 39999 }).status, 'not-due');
  assert.equal(handoffRecommendation(p, { ...o, contextTokens: 40000 }).status, 'due');
  assert.equal(handoffRecommendation(p, { ...o, contextTokens: 40000, safeBoundary: false }).status, 'defer');
  assert.equal(handoffRecommendation(p, { ...o, boundaryReached: true, uncertainWrites: true }).status, 'defer');
  assert.equal(handoffRecommendation(p, { ...o, boundaryReached: true }).status, 'due');
  assert.equal(handoffRecommendation(p, { ...o, boundaryReached: true }, 2).status, 'limit');
  assert.equal(handoffRecommendation({ ...p, atBoundary: false }, { ...o, contextTokens: 10, boundaryReached: true }).status, 'not-due');
  assert.equal(handoffRecommendation(spec().baseline, o).status, 'not-due');
  for (const patch of [{ contextTokens: -1 }, { contextTokens: 1.5 }, { boundaryReached: null }, { safeBoundary: 'yes' }]) assert.throws(() => handoffRecommendation(p, { ...o, ...patch }));
  const w = await world(t); await w.call('start', spec()); await w.call('begin', descriptor('r'));
  const bytes = await readFile(w.state, 'utf8');
  const status = await w.call('status', { runId: 'r', ...o, boundaryReached: true });
  assert.equal(status.recommendation.status, 'due'); assert.equal(await readFile(w.state, 'utf8'), bytes);
  await assert.rejects(w.call('handoff', handoff('r', { boundaryReached: false })), /not due/);
});

test('monitor observations do not alter paired denominator; unknown cannot succeed; rollback latches', async t => {
  const w = await world(t); await w.call('start', spec({ automatic: true })); await pairs(w);
  const admission = await w.call('begin', descriptor('monitor-unknown'));
  assert.equal(admission.runs.at(-1).stage, 'monitor'); assert.equal(admission.runs.at(-1).arm, 'candidate');
  const unknown = await w.call('finish', finish('monitor-unknown', { verified: null }));
  assert.equal(unknown.effective, 'candidate'); assert.equal(unknown.audit.verdict, 'inconclusive');
  assert.equal(unknown.audit.denominator, 3); assert.equal(unknown.audit.monitors[0].verdict, 'inconclusive');
  await w.call('begin', descriptor('monitor-bad'));
  const bad = await w.call('finish', finish('monitor-bad', { accepted: false }));
  assert.equal(bad.effective, 'baseline'); assert.equal(bad.rollbackLatched, true);
  const last = await w.call('begin', descriptor('baseline-monitor'));
  assert.equal(last.runs.at(-1).arm, 'baseline'); assert.equal(last.runs.at(-1).stage, 'monitor');
  const good = await w.call('finish', finish('baseline-monitor'));
  assert.equal(good.effective, 'baseline'); await assert.rejects(w.call('apply'), /latched/);
  assert.equal(good.audit.budget.runs, 9);
});

test('monitor quality allows no-worse rework but rolls back increased rework', async t => {
  const w = await world(t); await w.call('start', spec({ automatic: true })); await pairs(w, () => ({ rework: 1 }));
  await w.call('begin', descriptor('monitor-good'));
  const good = await w.call('finish', finish('monitor-good', { rework: 1 }));
  assert.equal(good.effective, 'candidate'); assert.equal(good.audit.monitors[0].verdict, 'no-worse');
  await w.call('begin', descriptor('monitor-bad'));
  assert.equal((await w.call('finish', finish('monitor-bad', { rework: 2 }))).effective, 'baseline');
});

test('canonical root aliases work, managed symlink escapes and oversized inputs do not', async t => {
  const w = await world(t), link = join(w.root, 'root-alias'); await symlink(w.root, link);
  await sessionTrials({ root: link, action: 'start', record: spec(), yes: true });
  assert.equal((await sessionTrials({ root: link, action: 'audit', experiment: 'acme' })).audit.source, 'explicit-records');
  const large = join(w.root, 'large.json'); await writeFile(large, ' '.repeat(17000));
  assert.equal(cli(link, ['retro', 'sessions', 'begin', '--experiment', 'acme', '--record', large]).code, 2);
  await assert.rejects(w.call('begin', descriptor('r', { task: 'x'.repeat(17000) })), /size bound/);
  const ledger = JSON.parse(await readFile(w.state, 'utf8')); ledger.events.push({ action: 'begin', record: descriptor('../escape'), at: new Date().toISOString() });
  await writeFile(w.state, JSON.stringify(ledger)); await assert.rejects(w.call('status'), /invalid run identity/);
});

test('run cap includes monitors, and minimum capacity preserves a monitoring slot', async t => {
  const w = await world(t); await assert.rejects(w.call('start', spec({ maxRuns: 6 })), /run limits/);
  await w.call('start', spec({ maxRuns: 7, automatic: true })); await pairs(w);
  await w.call('begin', descriptor('monitor'));
  await w.call('finish', finish('monitor'));
  await assert.rejects(w.call('begin', descriptor('overflow')), /budget exhausted/);
  const result = await w.call('audit'); assert.equal(result.audit.coverage.kind, 'manual-attestation');
  assert.equal(result.audit.coverage.evidenceContentsVerified, false); assert.equal(result.audit.coverage.providerTelemetry, false);
});

test('monitor efficiency beyond the configured noise margin rolls back; within margin does not', async t => {
  const w = await world(t); await w.call('start', spec({ automatic: true })); await pairs(w);
  await w.call('begin', descriptor('within-noise'));
  const noisy = await w.call('finish', finish('within-noise', { totalMinutes: 10.5 }));
  assert.equal(noisy.effective, 'candidate'); assert.equal(noisy.audit.monitors[0].verdict, 'no-worse');
  await w.call('begin', descriptor('slower'));
  const slow = await w.call('finish', finish('slower', { totalMinutes: 11.1 }));
  assert.equal(slow.effective, 'baseline'); assert.equal(slow.audit.verdict, 'worse');
  assert.deepEqual(slow.transitions.at(-1).sourceIds, ['slower']);
  await assert.rejects(w.call('apply'), /latched/);
});

test('policy attestation is mandatory schema and unknown monitor compliance cannot count as success', async t => {
  const w = await world(t); await w.call('start', spec({ automatic: true })); await pairs(w);
  await w.call('begin', descriptor('unknown-policy'));
  const missing = finish('unknown-policy'); delete missing.policyApplied;
  await assert.rejects(w.call('finish', missing), /invalid record fields/);
  const result = await w.call('finish', finish('unknown-policy', { policyApplied: null }));
  assert.equal(result.audit.verdict, 'inconclusive'); assert.equal(result.effective, 'candidate');
  assert.equal(result.audit.coverage.complete, false);
});

test('taskClass is experiment-wide, including later pairs and monitoring', async t => {
  const w = await world(t); await w.call('start', spec({ automatic: true }));
  await w.call('begin', descriptor('run0')); await w.call('finish', finish('run0'));
  await w.call('begin', descriptor('run1')); await w.call('finish', finish('run1', { totalMinutes: 8 }));
  await assert.rejects(w.call('begin', descriptor('different-pair', { taskClass: 'Acme-other' })), /experiment taskClass/);
  for (let n = 2; n < 6; n++) {
    const begun = await w.call('begin', descriptor(`run${n}`));
    await w.call('finish', finish(`run${n}`, { totalMinutes: begun.runs.at(-1).arm === 'baseline' ? 10 : 8 }));
  }
  await assert.rejects(w.call('begin', descriptor('different-monitor', { taskClass: 'Acme-other' })), /experiment taskClass/);
  assert.equal((await w.call('audit')).effective, 'candidate');
});

test('event capacity is checked before persistence and repeated rollback is idempotent', async t => {
  const w = await world(t); await w.call('start', spec()); await w.call('rollback');
  const bytes = await readFile(w.state, 'utf8'); await w.call('rollback');
  assert.equal(await readFile(w.state, 'utf8'), bytes);
  const ledger = JSON.parse(bytes);
  ledger.events = Array.from({ length: 20000 }, () => ({ action: 'rollback', record: null, at: ledger.createdAt }));
  await writeFile(w.state, JSON.stringify(ledger));
  const before = await readFile(w.state, 'utf8');
  await assert.rejects(w.call('begin', descriptor('overflow')), /event limit exhausted/);
  assert.equal(await readFile(w.state, 'utf8'), before);
  assert.equal((await w.call('status')).runs.length, 0);
  await w.call('rollback');
  assert.equal(JSON.parse(await readFile(w.state, 'utf8')).events.length, 20000);
  ledger.events.push({ action: 'rollback', record: null, at: ledger.createdAt });
  await writeFile(w.state, JSON.stringify(ledger)); await assert.rejects(w.call('status'), /corrupt ledger/);
});

test('overruns remain recorded but cannot promote even with otherwise winning pairs', async t => {
  const w = await world(t); await w.call('start', spec({ automatic: true, budgetMinutes: 30, reserveMinutes: 5 }));
  for (let n = 0; n < 6; n++) await w.call('begin', descriptor(`r${n}`));
  let result;
  for (let n = 0; n < 6; n++) result = await w.call('finish', finish(`r${n}`, { totalMinutes: [0, 3, 4].includes(n) ? 10 : 8 }));
  assert.equal(result.audit.numerator, 3); assert.equal(result.audit.budget.settledMinutes, 54);
  assert.equal(result.audit.verdict, 'inconclusive'); assert.equal(result.audit.coverage.complete, false);
  assert.match(result.audit.gaps[0].reason, /allowance/); assert.equal(result.effective, 'baseline');
  await assert.rejects(w.call('apply'), /fresh audit/);
  assert.equal((await w.call('status')).runs.filter(r => r.finish).length, 6);
});

test('source-bound decision receipts refresh on handoff and reject caller fabricated digests', async t => {
  const w = await world(t);
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init','-q'], {cwd:w.root});
  execFileSync('git', ['add','.'], {cwd:w.root});
  execFileSync('git', ['commit','-qm','Acme'], {cwd:w.root});
  await mkdir(join(w.root,'docs/phases'),{recursive:true});await mkdir(join(w.root,'docs/decisions'));
  await writeFile(join(w.root,'docs/phases/00-acme.md'),'# Acme\n## Reconciliation\n```keel-reconciliation\n{"version":1,"decisions":["docs/decisions/store.md#store"]}\n```\n');
  const path=join(w.root,'docs/decisions/store.md');
  const put=owner=>writeFile(path,`<a id="store"></a>\n## Store\nAcme storage\n\`\`\`keel-decision\n${JSON.stringify({version:1,id:'store',status:'accepted',scope:['storage'],decided_by:owner,decided_at:'2026-01-01'})}\n\`\`\`\n`);
  await put('Acme owner');await w.call('start',spec());
  await assert.rejects(w.call('begin',descriptor('forged',{decisionDigest:'a'.repeat(64)})),/not caller supplied/);
  const begun=await w.call('begin',descriptor('r',{decisionTarget:{kind:'phase',ref:'0'}}));
  assert.equal(begun.runs[0].decisionDigest,begun.decisionBundle.digest);
  await put('Acme changed owner');
  await assert.rejects(w.call('handoff',handoff('r',{decisionDigest:'b'.repeat(64)})),/not caller supplied/);
  const handed=await w.call('handoff',handoff('r'));assert.notEqual(handed.decisionBundle.digest,begun.decisionBundle.digest);
  assert.equal(handed.runs[0].handoffs[0].decisionDigest,handed.decisionBundle.digest);
  await rm(path);await assert.rejects(w.call('handoff',handoff('r',{id:'handoff2'})),/required decision context unavailable/);
});

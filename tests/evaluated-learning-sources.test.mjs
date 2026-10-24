// Retained-chain fixture adapted from dalmaer/plates tests/evaluation-comparison.test.mjs
// revision 3d9a85e1ceba40353cd33cf564956c9383606b1b; license Apache-2.0.
// Synthetic Acme sources; only the external GitHub transport is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanEnv } from './helpers/run.mjs';
import { evaluationWorld } from './helpers/evaluation-execution.mjs';
import { review, receiptPath } from '../lib/review.mjs';
import { verifyLearningSources } from '../lib/evaluated-learning-sources.mjs';
import { fingerprint, sealRecord, byteDigest } from '../lib/evaluation-records.mjs';
import { storeImmutable } from '../lib/session-ledger-io.mjs';
import { inspectBudgetTarget, reserveExternalBudget } from '../lib/validation-budget.mjs';
const OLD = 'a'.repeat(40), HEAD = 'b'.repeat(40), AT = '2026-10-24T00:00:00.000Z';
const BODY = 'Acme historical behavioral finding.\nRetain the complete second line.';
const classification = value => ({ value, attribution: 'manual', actor: 'Acme reviewer', rationale: 'Acme selected evidence' });
const selected = (selector, value = 'reviewer-statement') => ({ selector, classification: classification(value) });
const conn = nodes => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes });
async function githubWorld(t, { receipt = true, bodySelection = false } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'acme-learning-source-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.plates'));
  await writeFile(join(root, '.plates/plates.json'), JSON.stringify({ repo: 'Acme/widget', review: { reviewers: ['acme-current'] } }));
  const restReview = { id: 11, node_id: 'PRR_acme', user: { login: 'acme-historical' }, body: BODY, state: 'COMMENTED',
    submitted_at: AT, commit_id: OLD, pull_request_url: 'https://api.github.com/repos/Acme/widget/pulls/3' };
  const comment = { id: 21, node_id: 'PRRC_acme', body: BODY, pull_request_review_id: 11, pull_request_url: restReview.pull_request_url,
    commit_id: HEAD, original_commit_id: OLD, path: 'src/acme.mjs', line: null, original_line: 5, start_line: null, original_start_line: 4, side: 'RIGHT', start_side: 'RIGHT' };
  const pr = { number: 3, title: 'Acme change', state: 'OPEN', mergedAt: null, url: 'https://github.com/Acme/widget/pull/3', headRefOid: HEAD,
    author: { login: 'acme-owner' }, reviewThreads: conn([{ id: 'PRRT_acme', isResolved: true, path: comment.path, line: null,
      comments: conn([{ databaseId: 21, author: { login: 'acme-historical' }, body: BODY, originalCommit: { oid: OLD }, createdAt: AT, url: 'https://github.com/Acme/widget/pull/3#discussion_r21' }]) }]),
    comments: conn([]), reviews: conn([{ id: 'PRR_acme', databaseId: 11, author: { login: 'acme-historical' }, body: BODY,
      commit: { oid: OLD }, state: 'COMMENTED', submittedAt: AT, url: 'https://github.com/Acme/widget/pull/3#pullrequestreview-11' }]) };
  if (bodySelection) { pr.reviews.nodes[0].author.login = 'acme-owner'; restReview.user.login = 'acme-owner'; }
  const data = { pr, reviews: [restReview], comment };
  const fixture = join(root, 'github.json'), log = join(root, 'calls.jsonl'), executable = join(root, 'gh');
  await writeFile(fixture, JSON.stringify(data));
  await writeFile(executable, `#!${process.execPath}
const fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');
const d=JSON.parse(fs.readFileSync(${JSON.stringify(fixture)},'utf8'));
if(d.down){console.error('Acme transport unavailable');process.exit(1);}
if(a.includes('POST')||a.includes('PATCH')||a.some(x=>x.startsWith('query=mutation')))process.exit(90);
if(a[1]==='graphql'){console.log(JSON.stringify({data:{repository:{pullRequest:d.pr}}}));}
else if(a[1]==='repos/Acme/widget/pulls/comments/21')console.log(JSON.stringify(d.comment));
else if(a[1].startsWith('repos/Acme/widget/pulls/3/reviews?')){const p=Number(new URLSearchParams(a[1].split('?')[1]).get('page'));console.log(JSON.stringify(d.endless?Array(100).fill(d.reviews[0]):d.reviews.slice((p-1)*100,p*100)));}
else {console.error('Acme unexpected transport request');process.exit(91);}
`);
  await chmod(executable, 0o700);
  const env = { ...cleanEnv(), PLATES_GH: executable, PLATES_CACHE: join(root, 'cache') };
  if (receipt) await review({ root, target: 'Acme/widget#3' }, { env });
  const selector = { kind: 'github-review', repo: 'Acme/widget', prNumber: 3, reviewId: 11,
    threadId: bodySelection ? null : 'PRRT_acme', commentId: bodySelection ? null : 21, reviewedHead: OLD, expectedBodySha256: byteDigest(BODY) };
  const call = extra => verifyLearningSources({ selections: [selected(selector)], env, ...extra });
  const change = async fn => { const d = JSON.parse(await readFile(fixture)); fn(d); await writeFile(fixture, JSON.stringify(d)); };
  return { root, env, selector, call, change, log, receipt: receiptPath(env, { repo: 'Acme/widget', number: 3 }) };
}
test('historical inline source uses raw receipt despite display filter; deterministic and read-only', async t => {
  const w = await githubWorld(t), before = await readFile(w.receipt, 'utf8');
  assert(!JSON.parse(before).ids.includes(21)); // display ids identify threads, not selected comment IDs
  const a = await w.call(), b = await w.call();
  assert.deepEqual(a.sources, b.sources); assert.deepEqual(a.sourceIdentities, b.sourceIdentities);
  const s = a.sources[0]; assert.equal(s.digest, sealRecord(s).digest);
  assert.equal(s.source.reviewedHead, OLD); assert.equal(s.source.currentPrHead, HEAD); assert.equal(s.source.reviewCoversCurrentHead, false);
  assert.equal(s.source.originalPath, null); assert.deepEqual(s.source.originalLineRange, { start: 4, end: 5 });
  assert.equal(s.incidentKey, null); assert.equal(s.source.fetchedAt, JSON.parse(before).at);
  assert.equal(await readFile(w.receipt, 'utf8'), before);
  assert(!JSON.stringify(a).includes(BODY)); assert(!JSON.stringify(a).includes(w.root));
  assert(!JSON.stringify(a.sources).includes(a.diagnostics.checkedAt));
  assert(!(await readFile(w.log, 'utf8')).includes('POST'));
});
test('historical review-body selection preserves exact body identity', async t => {
  const w = await githubWorld(t, { bodySelection: true });
  assert(!JSON.parse(await readFile(w.receipt)).ids.includes('PRR_acme'));
  const r = await w.call();
  assert.equal(r.sources[0].source.commentId, null); assert.equal(r.sources[0].source.bodySha256, byteDigest(BODY));
});
test('current head changes bind fresh preview identity without invalidating historical membership', async t => {
  const w = await githubWorld(t), a = await w.call();
  await w.change(d => { d.pr.headRefOid = 'c'.repeat(40); }); const b = await w.call();
  assert.equal(a.sources[0].id, b.sources[0].id); assert.notDeepEqual(a.sourceIdentities, b.sourceIdentities);
  await w.change(d => { d.pr.headRefOid = OLD; }); assert.equal((await w.call()).sources[0].source.reviewCoversCurrentHead, true);
});
test('receipt timestamp/identity change requires different approval; missing receipt instructs explicit read', async t => {
  const w = await githubWorld(t), a = await w.call();
  const r = JSON.parse(await readFile(w.receipt)); r.at = AT; await writeFile(w.receipt, JSON.stringify(r));
  assert.notDeepEqual(a.sourceIdentities, (await w.call()).sourceIdentities);
  await rm(w.receipt); await assert.rejects(w.call(), { code: 'source_read_required' });
});
test('forged membership, edited bodies, incomplete pages and unavailable transport refuse', async t => {
  for (const mutate of [d => { d.comment.pull_request_review_id = 12; }, d => { d.comment.pull_request_url += '1'; },
    d => { d.reviews[0].commit_id = HEAD; }, d => { d.comment.original_commit_id = HEAD; },
    d => { d.pr.reviewThreads.nodes[0].id = 'PRRT_other'; }, d => { d.comment.body += ' changed'; },
    d => { d.pr.reviewThreads.pageInfo.hasNextPage = true; }, d => { d.pr.reviewThreads.nodes[0].comments.pageInfo.hasNextPage = true; },
    d => { d.pr.reviews.pageInfo.hasNextPage = true; }, d => { d.pr.comments.pageInfo.hasNextPage = true; }, d => { d.down = true; }]) {
    const w = await githubWorld(t); await w.change(mutate); await assert.rejects(w.call(), { code: 'source_unavailable' });
  }
});
test('body edits cannot reuse read receipt even with new caller body hash', async t => {
  const w = await githubWorld(t); const body = BODY + ' edited';
  await w.change(d => { d.comment.body = body; d.pr.reviewThreads.nodes[0].comments.nodes[0].body = body; });
  await assert.rejects(w.call({ selections: [selected({ ...w.selector, expectedBodySha256: byteDigest(body) })] }), { code: 'source_read_required' });
});
test('bounded REST pagination refuses excess reviews', async t => {
  const w = await githubWorld(t); await w.change(d => { d.endless = true; });
  await assert.rejects(w.call(), { code: 'source_unavailable' });
});
test('privacy, attributed defect, malformed caller proof, duplicate conflict and bounds fail closed', async t => {
  const w = await githubWorld(t);
  for (const publicText of [BODY, JSON.stringify({ claim: BODY })]) await assert.rejects(w.call({ publicText }), { code: 'private_source_disclosure' });
  await assert.rejects(w.call({ selections: [{ selector: w.selector, classification: { ...classification('unresolved'), rationale: BODY } }] }), { code: 'private_source_disclosure' });
  await assert.rejects(w.call({ selections: [selected(w.selector, 'verified-defect')] }), { code: 'behavioral_evidence_required' });
  await assert.rejects(w.call({ selections: [{ ...selected(w.selector), verified: true }] }), { code: 'invalid_source_selection' });
  await assert.rejects(w.call({ selections: [selected({ ...w.selector, reviewId: '../11' })] }), { code: 'invalid_source_selection' });
  assert.equal((await w.call({ selections: [selected(w.selector), selected(w.selector)] })).sources.length, 1);
  await assert.rejects(w.call({ selections: [selected(w.selector), selected(w.selector, 'preference')] }), { code: 'source_selection_conflict' });
  await assert.rejects(w.call({ selections: Array(33).fill(selected(w.selector)) }), { code: 'invalid_source_selection' });
  await assert.rejects(w.call({ selections: [selected({ ...w.selector, expectedBodySha256: '0'.repeat(64) })] }), { code: 'source_body_changed' });
});
test('linked receipt cannot become authority', async t => {
  const w = await githubWorld(t); const copy = join(w.root, 'receipt-copy'); await writeFile(copy, await readFile(w.receipt));
  await rm(w.receipt); await symlink(copy, w.receipt); await assert.rejects(w.call(), { code: 'source_read_required' });
});

// Actual frozen workspace/ledger and independently retained receipt chain. No inspector stub.
async function harnessWorld(t, { failed = true, recovery = false } = {}) {
  const w = await evaluationWorld(t), dir = join(w.options.state, 'session-trials', w.b.comparison.id);
  const ledger = JSON.parse(await readFile(join(dir, 'state.json'))), plan = ledger.plan;
  const home = join(dir, 'execution'); await mkdir(home, { mode: 0o700 });
  const record = (kind, body) => sealRecord({ schemaVersion: 2, kind, id: 'a'.repeat(32), createdAt: AT, ...body });
  await storeImmutable(join(home, 'reservation.json'), record('evaluation-reservation', { planDigest: plan.digest, allowance: w.b.comparison.allowance, currencyUsage: null }));
  const slot = w.request.pairId + '-baseline', path = join(home, slot); await mkdir(path, { mode: 0o700 });
  const input = { request: w.request, planDigest: plan.digest, taskDigest: w.b.cases[0].digest, configurationDigest: w.b.configurations[0].digest,
    checkManifestDigest: w.b.cases[0].acceptanceManifest.digest, sourceDigest: 'b'.repeat(64), image: { id: w.b.cases[0].environment.image }, controller: { digest: 'a'.repeat(64) } };
  const operations = ['builder', 'check-0'].map(stage => `plates-eval-${'a'.repeat(32)}-${stage}`);
  const intent = record('evaluation-intent', { slot, input, previewDigest: fingerprint(input), operations, dispatchProtocol: 'ordered-authorization-v1', attempt: 1, parentAttemptId: null, interventions: [], repairRounds: 0 });
  const records = { intent }; await storeImmutable(join(path, 'intent.json'), intent);
  const bound = (kind, body) => record(kind, { intentDigest: intent.digest, ...body });
  const target = await inspectBudgetTarget({ manifest: w.managed, root: w.repository, repo: 'Acme/widget' });
  const lease = await reserveExternalBudget({ ...w.admission, target, id: intent.id, commandDigest: intent.previewDigest, operations });
  records.lease = bound('evaluation-lease', { lease }); await storeImmutable(join(path, 'lease.json'), records.lease);
  const observations = operations.map((operation, index) => ({ operation, state: 'terminated', containerId: String(index + 1).repeat(64), running: false }));
  for (const [index, operation] of operations.entries()) {
    const name = index ? 'check-0' : 'builder';
    records['dispatch-' + name] = bound('evaluation-dispatch', { operation, index });
    records[name] = bound('evaluation-stage', { stage: { operation, containerId: observations[index].containerId, setup: 'passed', execution: 'passed', error: null,
      output: { exit: 0, signal: null, stdout: index ? failed ? 'Acme wrong\n' : 'Acme\n' : '', stderr: '' }, termination: observations[index] } });
    await storeImmutable(join(path, 'dispatch-' + name + '.json'), records['dispatch-' + name]); await storeImmutable(join(path, name + '.json'), records[name]);
  }
  const files = [{ path: 'answer.mjs', mode: '100644', base64: Buffer.from('export default "Acme";').toString('base64') }];
  records.artifact = bound('evaluation-artifact', { files, filesDigest: fingerprint(files), sourceDigest: input.sourceDigest });
  records.verdict = bound('evaluation-verdict', { artifactDigest: records.artifact.digest, checkManifestDigest: input.checkManifestDigest,
    evaluator: { identity: 'plates-host-stdio-v1', version: 1, controller: input.controller, image: input.image }, acceptance: failed ? 'rejected' : 'accepted',
    failureCategory: failed ? 'acceptance' : null, checks: [{ id: 'acme-behavior', status: failed ? 'failed' : 'passed', observationDigest: records['check-0'].digest }] });
  for (const key of ['artifact', 'verdict']) await storeImmutable(join(path, key + '.json'), records[key]);
  const settlement = { id: intent.id, commandDigest: intent.previewDigest, released: true, observations };
  const result = bound('evaluation-result', { status: 'terminal', verdictDigest: records.verdict.digest, settlement, validation: failed ? 'failed' : 'passed', ...(recovery ? { recoveryInputDigest: 'c'.repeat(64) } : {}) });
  if (recovery) {
    const receipt = bound('evaluation-reconciliation', { inputDigest: 'c'.repeat(64), result, verdict: records.verdict, settlement, observations, status: 'terminal',
      originalEvidence: Object.fromEntries(Object.entries(records).map(([k, v]) => [k, v.digest])) });
    await storeImmutable(join(path, `reconciliation-${receipt.digest}.json`), receipt);
  } else await storeImmutable(join(path, 'result.json'), result);
  const selector = { kind: 'harness-artifact', experimentId: w.b.comparison.id, planDigest: plan.digest, slot, intentDigest: intent.digest,
    artifactDigest: records.artifact.digest, verdictDigest: records.verdict.digest, checkId: 'acme-behavior' };
  const call = extra => verifyLearningSources({ ...w.options, selections: [selected(selector, 'verified-defect')], ...extra });
  return { ...w, path, selector, call, dir };
}
test('actual frozen ledger resolves failed named behavioral evidence including recovery projection', async t => {
  for (const recovery of [false, true]) {
    const w = await harnessWorld(t, { recovery }), r = await w.call();
    assert.equal(r.sources[0].source.repository, 'Acme/widget'); assert.equal(r.sources[0].verification.method, 'retained-harness-v1');
    assert.match(r.sources[0].incidentKey, /^[a-f0-9]{64}$/); assert(!JSON.stringify(r).includes(w.root));
    assert.deepEqual(r.sources, (await w.call()).sources); assert.equal(Boolean(r.sourceIdentities[0].recoveryDigest), recovery);
  }
});
test('actual ledger rejects absent checks, fake references, changed attachments and forged stages', async t => {
  const w = await harnessWorld(t);
  for (const [key, value] of [['planDigest', '0'.repeat(64)], ['artifactDigest', '0'.repeat(64)], ['verdictDigest', '0'.repeat(64)], ['checkId', 'acme-missing']])
    await assert.rejects(w.call({ selections: [selected({ ...w.selector, [key]: value })] }));
  await assert.rejects(w.call({ manifest: null }), { code: 'source_workspace_required' });
  await assert.rejects(w.call({ publicText: 'export default "Acme";' }), { code: 'private_source_disclosure' });
  const path = join(w.path, 'check-0.json'), stage = JSON.parse(await readFile(path));
  stage.stage.output.stdout = 'Acme\n'; await chmod(path, 0o600); await writeFile(path, JSON.stringify(sealRecord(stage))); await chmod(path, 0o400);
  await assert.rejects(w.call(), { code: 'source_unavailable' });
  const other = await harnessWorld(t); const attachment = join(other.dir, 'attachments', byteDigest(other.b.materials[0].content));
  await chmod(attachment, 0o600); await writeFile(attachment, 'Acme edited'); await chmod(attachment, 0o400);
  await assert.rejects(other.call(), { code: 'source_unavailable' });
});
test('passed behavior is not verified defect; unknown terminal acceptance is not manufactured', async t => {
  const w = await harnessWorld(t, { failed: false });
  await assert.rejects(w.call(), { code: 'behavioral_evidence_required' });
  assert.equal((await w.call({ selections: [selected(w.selector, 'unresolved')] })).sources.length, 1);
  const f = await harnessWorld(t); await rm(join(f.path, 'result.json'));
  await assert.rejects(f.call(), { code: 'behavioral_evidence_required' });
  assert.equal((await f.call({ selections: [selected(f.selector, 'unresolved')] })).sources.length, 1);
});

test('body byte limits and missing retained artifacts refuse without exposing content', async t => {
  const w = await githubWorld(t), body = 'Acme ' + 'x'.repeat(65536);
  await w.change(d => { d.comment.body = body; d.pr.reviewThreads.nodes[0].comments.nodes[0].body = body; });
  await review({ root: w.root, target: 'Acme/widget#3' }, { env: w.env });
  await assert.rejects(w.call({ selections: [selected({ ...w.selector, expectedBodySha256: byteDigest(body) })] }), e => e.code === 'source_unavailable' && !e.message.includes(body));
  await assert.rejects(w.call({ publicText: 'x'.repeat(1024 * 1024 + 1) }), { code: 'invalid_public_text' });
  const h = await harnessWorld(t); await rm(join(h.path, 'artifact.json'));
  await assert.rejects(h.call(), { code: 'source_unavailable' });
});

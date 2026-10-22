import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../lib/web/common.mjs';
import { capacityModel } from '../lib/web/capacity.mjs';
import { validateModelEvidence, quoteModel, selectModel } from '../lib/web/model-selection.mjs';
import { validateModelCheckpoint, assertModelContinuation } from '../lib/web/model-checkpoint.mjs';
import { at, model, evidence, policy, connection, pool } from './helpers/web-model-provider.mjs';
const selection = (changes = {}) => selectModel({ policy: policy(), models: [evidence()], connections: [connection()],
  observations: [pool()], inputTokens: 1000, now: at, ...changes });

test('quoted cost rounds integer microUSD up and rejects expired, future, alias or unbounded evidence', () => {
  assert.equal(quoteModel(evidence(), { inputTokens: 1000, maxOutputTokens: 2000, now: at }).totalMicroUsd, 18000);
  assert.equal(quoteModel({ ...evidence(), inputMicroUsdPerMillion: 1, outputMicroUsdPerMillion: 1 },
    { inputTokens: 1, maxOutputTokens: 1, now: at }).totalMicroUsd, 1);
  for (const changed of [{ expiresAt: new Date(at).toISOString() }, { observedAt: new Date(at + 1).toISOString() },
    { immutable: false }, { background: false }, { inputMicroUsdPerMillion: null }, { outputMicroUsdPerMillion: 1.2 },
    { evidenceUrl: 'https://acme.example/claimed-prices' }, { contextTokens: Infinity }]) {
    assert.throws(() => validateModelEvidence({ ...evidence(), ...changed }, { now: at }));
  }
  assert.throws(() => quoteModel(evidence(), { inputTokens: 99000, maxOutputTokens: 2000, now: at }), { code: 'model_context' });
  assert.throws(() => quoteModel(evidence(), { inputTokens: 1, maxOutputTokens: 10001, now: at }), { code: 'model_context' });
});

test('selection checks every independent quota unit and shares reservations across duplicate connections', () => {
  const requestPool = pool('requests', { measurement: { used: 0, remaining: 2, limit: 2 } });
  assert.equal(selection({ observations: [pool(), requestPool] }).state, 'selected');
  const normalized = capacityModel([requestPool], { now: at }).pools[0];
  const result = selection({ observations: [pool(), requestPool], reservations: [{ poolId: normalized.id, unit: 'requests', amount: 1 }] });
  assert.equal(result.state, 'wait'); assert.equal(result.rejections[0].code, 'model_capacity_low');
  const p = policy(); p.candidates.push({ ...p.candidates[0], id: 'acme-copy', connectionId: 'acme-copy' });
  const duplicate = selection({ policy: p, connections: [connection(), { ...connection(), id: 'acme-copy' }],
    observations: [requestPool], reservations: [{ poolId: normalized.id, unit: 'requests', amount: 1 }] });
  assert.equal(duplicate.state, 'wait'); assert.equal(duplicate.rejections.length, 2);
  const split = selection({ observations: [pool('input-tokens'), pool('output-tokens')] });
  assert.deepEqual(split.selected.claims.map(c => [c.unit, c.amount]), [['input-tokens', 1000], ['output-tokens', 2000]]);
});

test('expired model evidence can load structurally but selection and quotes still explain a wait', () => {
  const expired = { ...evidence(), expiresAt: new Date(at).toISOString() };
  assert.deepEqual(validateModelEvidence(expired, { now: at, allowExpired: true }), expired);
  assert.throws(() => quoteModel(expired, { inputTokens: 1000, maxOutputTokens: 2000, now: at }), { code: 'model_evidence' });
  const result = selection({ models: [expired] });
  assert.equal(result.state, 'wait'); assert.equal(result.rejections[0].code, 'model_evidence');
  for (const changed of [{ observedAt: new Date(at + 1).toISOString() }, { expiresAt: expired.observedAt },
    { outputMicroUsdPerMillion: null }, { evidenceUrl: 'https://acme.example/pricing' }]) {
    assert.throws(() => validateModelEvidence({ ...expired, ...changed }, { now: at, allowExpired: true }), { code: 'model_evidence' });
  }
});

test('unknown, stale, unverified coverage and malformed newer capacity never become observed allowance', () => {
  const invalid = [[], [pool('tokens', { observedAt: new Date(at - 61000).toISOString() })],
    [pool('tokens', { models: { ids: [], provenance: 'unknown' } })],
    [pool('tokens', { models: { ids: ['acme-other'], provenance: 'provider-response' } })],
    [pool(), { ...pool(), measurement: {} }], [pool(), { ...pool(), source: null }],
    [pool(), { ...pool(), measurement: { used: 2000, remaining: 8000, limit: 10000 } }]];
  for (const observations of invalid) assert.equal(selection({ observations }).state, 'wait');
  const p = policy(); p.candidates[0].unknownCapacity = 'allow-budgeted';
  const result = selection({ policy: p, observations: [] });
  assert.equal(result.state, 'selected'); assert.equal(result.selected.capacity, 'unknown');
  assert.deepEqual(result.selected.claims, []); assert.ok(result.gaps.some(g => g.code === 'model_provider_capacity_unknown'));
  assert.equal(selection({ policy: p, observations: [pool('tokens', { measurement: { used: 9900, remaining: 100, limit: 10000 } })] }).state, 'wait');
  assert.equal(selection({ connections: [{ ...connection(), capacityIdentity: null }] }).state, 'wait');
});

test('fallback stays opt-in and cannot bypass task, review, provider, privacy, price or grant requirements', () => {
  for (const changes of [{ policy: { ...policy(), taskClass: 'build' } }, { policy: { ...policy(), taskClass: 'review' } },
    { policy: { ...policy(), requirements: { ...policy().requirements, independentReview: true } } },
    { policy: { ...policy(), requirements: { ...policy().requirements, privacy: 'no-retention' } } },
    { connections: [{ ...connection(), provider: 'anthropic' }] }, { connections: [{ ...connection(), authorized: false }] },
    { connections: [{ ...connection(), version: 0 }] }, { connections: [{ ...connection(), enabled: false }] },
    { policy: { ...policy(), limits: { ...policy().limits, attemptMicroUsd: 1 } } }]) assert.equal(selection(changes).state, 'wait');
  const p = policy(); p.candidates.unshift({ ...p.candidates[0], id: 'acme-unavailable', model: 'acme-missing' });
  assert.equal(selection({ policy: p }).selected.candidateId, 'acme-primary');
  p.automaticFallback = false;
  const result = selection({ policy: p });
  assert.equal(result.state, 'wait'); assert.equal(result.rejections[1].code, 'model_fallback_disabled');
});

test('active cooldown blocks aliases; expired observed capacity needs fresh reentry while explicit unknown mode stays unknown', () => {
  const active = [{ connectionId: 'acme', observedAt: at - 1000, until: at + 1000 }];
  const p = policy(); p.candidates[0].unknownCapacity = 'allow-budgeted';
  assert.equal(selection({ policy: p, observations: [], cooldowns: active }).state, 'wait');
  const expired = [{ connectionId: 'acme', observedAt: at - 2000, until: at - 1000 }];
  const lowHeadroom = pool('tokens', { measurement: { used: 5500, remaining: 4500, limit: 10000 } });
  assert.equal(selection({ observations: [lowHeadroom] }).state, 'selected');
  assert.equal(selection({ observations: [lowHeadroom], cooldowns: expired }).state, 'wait');
  assert.equal(selection({ cooldowns: expired }).state, 'selected');
  assert.equal(selection({ observations: [], cooldowns: expired }).state, 'wait');
  const unknown = selection({ policy: p, observations: [], cooldowns: expired });
  assert.equal(unknown.state, 'selected'); assert.equal(unknown.selected.capacity, 'unknown');
});

function checkpoint() {
  return { version: 1, taskId: 'acme-task', stage: 1, nextStage: 2,
    predecessor: { attemptId: 'acme-attempt', responseId: 'resp_acme', provider: 'openai', model, status: 'completed' },
    artifact: { hash: hash('Acme saved summary'), text: 'Acme saved summary' },
    source: { repoId: 10, repositoryNodeId: 'AcmeRepo', revision: 'a'.repeat(40), packetDigest: 'b'.repeat(64), contextDigest: 'c'.repeat(64), contextState: 'complete' },
    decisions: { ownerChoices: ['Owner chose to wait'], suggestions: ['Model suggested starting'] }, ownership: { actor: 20, leaseId: 'acme-owner' },
    effects: [{ id: 'acme-effect', state: 'terminal', receiptHash: 'd'.repeat(64) }],
    usage: { inputTokens: 100, outputTokens: 40, costMicroUsd: 500 },
    budget: { ceilingMicroUsd: 20000, spentMicroUsd: 500, heldMicroUsd: 0, remainingMicroUsd: 19500 }, phaseClaim: 'Acme existing claim context' };
}
const current = c => ({ taskId: c.taskId, source: c.source, decisions: c.decisions, ownership: c.ownership,
  ceilingMicroUsd: c.budget.ceilingMicroUsd, spentMicroUsd: c.budget.spentMicroUsd, heldMicroUsd: c.budget.heldMicroUsd, phaseClaim: c.phaseClaim });

test('checkpoint preserves exact completed artifact, contrary owner decision and original allowance without phase-claim transfer', () => {
  const c = checkpoint(), next = assertModelContinuation(c, current(c));
  assert.equal(next.artifact.hash, c.artifact.hash); assert.equal(next.artifact.text, 'Acme saved summary');
  assert.deepEqual(next.decisions, { ownerChoices: ['Owner chose to wait'], suggestions: ['Model suggested starting'] });
  assert.equal(next.budget.ceilingMicroUsd, 20000); assert.equal(next.nextStage, 2);
  next.decisions.ownerChoices[0] = 'changed'; assert.equal(c.decisions.ownerChoices[0], 'Owner chose to wait');
});

test('checkpoint refuses incomplete provider work, unknown effects, artifact edits, changed source/owner/decision or enlarged budget', () => {
  for (const mutate of [c => c.predecessor.status = 'in_progress', c => c.artifact.text += 'edited', c => c.effects[0].state = 'uncertain',
    c => c.stage = 2, c => c.nextStage = 1, c => c.budget.remainingMicroUsd++, c => c.usage.costMicroUsd = null]) {
    const c = checkpoint(); mutate(c); assert.throws(() => validateModelCheckpoint(c));
  }
  const c = checkpoint();
  for (const changed of [{ source: { ...c.source, revision: 'e'.repeat(40) } }, { source: { ...c.source, contextDigest: 'e'.repeat(64) } },
    { ownership: { ...c.ownership, actor: 21 } }, { decisions: { ownerChoices: c.decisions.suggestions, suggestions: c.decisions.ownerChoices } },
    { ceilingMicroUsd: 30000 }, { phaseClaim: 'claim transferred' }, { spentMicroUsd: 0 }, { taskId: 'other' }]) {
    assert.throws(() => assertModelContinuation(c, { ...current(c), ...changed }));
  }
});

test('unknown measured cost keeps its ceiling charged through continuation, never becomes zero', () => {
  const c = checkpoint(); c.usage.costMicroUsd = null;
  c.budget = { ceilingMicroUsd: 20000, spentMicroUsd: 0, heldMicroUsd: 5000, remainingMicroUsd: 15000 };
  assert.equal(assertModelContinuation(c, current(c)).budget.heldMicroUsd, 5000);
  assert.throws(() => assertModelContinuation(c, { ...current(c), heldMicroUsd: 0 }));
  assert.throws(() => assertModelContinuation(c, { ...current(c), ceilingMicroUsd: 25000 }));
});

test('checkpoint refuses a provider response identity supplied as an array', () => {
  const c = checkpoint();
  c.predecessor.responseId = ['resp_acme'];
  assert.throws(() => validateModelCheckpoint(c), { code: 'model_checkpoint_invalid' });
});

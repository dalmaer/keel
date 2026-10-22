import { exact, hash, numeric, WebError } from './common.mjs';

const hex = (v, size = 64) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(v);
const text = (v, limit = 4096) => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= limit && !v.includes('\0');
const identifier = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const nullable = v => v === null || integer(v);
const fail = () => { throw new WebError('model_checkpoint_invalid', 409); };
function source(value) {
  return exact(value, ['repoId', 'repositoryNodeId', 'revision', 'packetDigest', 'contextDigest', 'contextState'])
    && numeric(value.repoId) && identifier(value.repositoryNodeId) && hex(value.revision, 40)
    && hex(value.packetDigest) && hex(value.contextDigest) && ['complete', 'not-configured'].includes(value.contextState);
}
function decisions(value) {
  return exact(value, ['ownerChoices', 'suggestions']) && [value.ownerChoices, value.suggestions]
    .every(rows => Array.isArray(rows) && rows.length <= 32 && rows.every(row => text(row)));
}
function ownership(value) {
  return exact(value, ['actor', 'leaseId']) && numeric(value.actor) && identifier(value.leaseId);
}
const same = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  return false;
};

/** An immutable, terminal stage-one summary; terminal authority is supplied by the service. */
export function validateModelCheckpoint(value) {
  if (!exact(value, ['version', 'taskId', 'stage', 'nextStage', 'predecessor', 'artifact', 'source', 'decisions', 'ownership', 'effects', 'usage', 'budget', 'phaseClaim'])
    || value.version !== 1 || !identifier(value.taskId) || value.stage !== 1 || value.nextStage !== 2
    || !exact(value.predecessor, ['attemptId', 'responseId', 'provider', 'model', 'status'])
    || !identifier(value.predecessor.attemptId) || typeof value.predecessor.responseId !== 'string'
    || !/^resp_[A-Za-z0-9_-]{1,200}$/.test(value.predecessor.responseId)
    || value.predecessor.provider !== 'openai' || !text(value.predecessor.model, 200) || value.predecessor.status !== 'completed'
    || !exact(value.artifact, ['hash', 'text']) || !hex(value.artifact.hash) || !text(value.artifact.text, 32 * 1024)
    || hash(value.artifact.text) !== value.artifact.hash || !source(value.source) || !decisions(value.decisions) || !ownership(value.ownership)
    || !Array.isArray(value.effects) || value.effects.length > 32
    || value.effects.some(e => !exact(e, ['id', 'state', 'receiptHash']) || !identifier(e.id) || e.state !== 'terminal' || !hex(e.receiptHash))
    || new Set(value.effects.map(e => e.id)).size !== value.effects.length
    || !exact(value.usage, ['inputTokens', 'outputTokens', 'costMicroUsd']) || !Object.values(value.usage).every(nullable)
    || !exact(value.budget, ['ceilingMicroUsd', 'spentMicroUsd', 'heldMicroUsd', 'remainingMicroUsd'])
    || !Object.values(value.budget).every(integer) || value.budget.ceilingMicroUsd === 0
    || value.budget.remainingMicroUsd !== value.budget.ceilingMicroUsd - value.budget.spentMicroUsd - value.budget.heldMicroUsd
    || value.usage.costMicroUsd === null && value.budget.heldMicroUsd === 0
    || value.usage.costMicroUsd !== null && value.budget.spentMicroUsd < value.usage.costMicroUsd
    || !(value.phaseClaim === null || text(value.phaseClaim, 1024))) fail();
  return structuredClone(value);
}

/** A checkpoint transfers no phase claim and grants no new allowance or source revision. */
export function assertModelContinuation(checkpoint, current) {
  const value = validateModelCheckpoint(checkpoint);
  if (!exact(current, ['taskId', 'source', 'decisions', 'ownership', 'ceilingMicroUsd', 'spentMicroUsd', 'heldMicroUsd', 'phaseClaim'])
    || current.taskId !== value.taskId || !source(current.source) || !same(current.source, value.source)
    || !decisions(current.decisions) || !same(current.decisions, value.decisions)
    || !ownership(current.ownership) || !same(current.ownership, value.ownership)
    || current.phaseClaim !== value.phaseClaim || current.ceilingMicroUsd !== value.budget.ceilingMicroUsd
    || !integer(current.spentMicroUsd) || !integer(current.heldMicroUsd)
    || current.spentMicroUsd < value.budget.spentMicroUsd
    || current.spentMicroUsd + current.heldMicroUsd < value.budget.spentMicroUsd + value.budget.heldMicroUsd
    || current.spentMicroUsd + current.heldMicroUsd >= current.ceilingMicroUsd) fail();
  return value;
}

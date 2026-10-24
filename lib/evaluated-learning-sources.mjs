// Selected-source verification for phase 121. No execution, cache writes or publication.
import { readSelectedReview } from './review.mjs';
import { evaluations } from './evaluation-ledger.mjs';
import { byteDigest, fingerprint, sealRecord, evaluationId } from './evaluation-records.mjs';

export class LearningSourceError extends Error {
  constructor(code, message) { super(message); this.code = code; this.exitCode = 2; }
}
const check = (ok, code, message) => { if (!ok) throw new LearningSourceError(code, message); };
const exact = (x, keys) => check(x && Object.getPrototypeOf(x) === Object.prototype
  && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k)), 'invalid_source_selection', 'Unexpected source selection fields');
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const prose = x => typeof x === 'string' && x.trim().length > 0 && Buffer.byteLength(x) <= 4096 && Buffer.from(x).toString('utf8') === x;
const positive = x => Number.isSafeInteger(x) && x > 0;
function selection(x) {
  exact(x, ['selector', 'classification']);
  const s = x.selector, c = x.classification;
  exact(c, ['value', 'attribution', 'actor', 'rationale']);
  check(['reviewer-statement', 'preference', 'unresolved', 'verified-defect'].includes(c.value)
    && c.attribution === 'manual' && prose(c.actor) && prose(c.rationale), 'invalid_source_selection', 'Invalid attributed classification');
  if (s?.kind === 'github-review') {
    exact(s, ['kind', 'repo', 'prNumber', 'reviewId', 'threadId', 'commentId', 'reviewedHead', 'expectedBodySha256']);
    check(typeof s.repo === 'string' && /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9_.-]{0,99}$/i.test(s.repo)
      && !s.repo.toLowerCase().endsWith('.git') && positive(s.prNumber) && positive(s.reviewId) && sha(s.reviewedHead) && hash(s.expectedBodySha256)
      && (s.threadId === null && s.commentId === null || typeof s.threadId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s.threadId) && positive(s.commentId)),
    'invalid_source_selection', 'Invalid GitHub selector; review/comment IDs must be numeric database IDs');
  } else {
    exact(s, ['kind', 'experimentId', 'planDigest', 'slot', 'intentDigest', 'artifactDigest', 'verdictDigest', 'checkId']);
    check(s.kind === 'harness-artifact' && evaluationId(s.experimentId) && evaluationId(s.checkId)
      && typeof s.slot === 'string' && /^[a-z][a-z0-9-]{0,63}-(baseline|candidate)$/.test(s.slot)
      && [s.planDigest, s.intentDigest, s.artifactDigest, s.verdictDigest].every(hash), 'invalid_source_selection', 'Invalid retained artifact selector');
  }
}
function protect(body, publicText) {
  if (!body || publicText === null) return;
  // Exact body and JSON-escaped body are deterministic disclosure checks, not PII classification.
  check(!publicText.includes(body) && !publicText.includes(JSON.stringify(body).slice(1, -1)),
    'private_source_disclosure', 'Public text includes selected private source content; separately sanitize it first');
}
async function github(s, env, publicText) {
  let r;
  try { r = await readSelectedReview(s, { env }); }
  catch (e) {
    // Transport stderr and provider error bodies are untrusted and may contain private text.
    const receipt = /read receipt unavailable|selected content not read or changed/.test(e.message);
    throw new LearningSourceError(receipt ? 'source_read_required' : 'source_unavailable', receipt
      ? `Read selected source first with plates review ${s.repo}#${s.prNumber}; then retry the preview`
      : 'Selected review identity, membership, complete content or authority could not be verified');
  }
  check(byteDigest(Buffer.from(r.body)) === s.expectedBodySha256, 'source_body_changed', 'Selected review body hash changed');
  protect(r.body, publicText);
  const source = { repo: s.repo, prNumber: s.prNumber, reviewId: s.reviewId, threadId: s.threadId, commentId: s.commentId,
    reviewedHead: s.reviewedHead, currentPrHead: r.currentPrHead, reviewCoversCurrentHead: s.reviewedHead === r.currentPrHead,
    commentCommit: r.commentCommit, originalCommentCommit: r.originalCommentCommit, path: r.path,
    lineRange: r.lineRange, originalPath: r.originalPath, originalLineRange: r.originalLineRange,
    bodySha256: s.expectedBodySha256, fetchedAt: r.receipt.at };
  const identity = { kind: s.kind, source, receiptDigest: fingerprint(r.receipt), receiptKey: r.receiptKey,
    receiptIndex: r.receiptIndex, receiptContentDigest: r.contentDigest };
  return { source, identity, incidentKey: null, failing: false, bodyBytes: Buffer.byteLength(r.body),
    verification: { method: 'fresh-review-v1', receiptContentDigest: r.contentDigest, receiptAt: r.receipt.at, sourceIdentityDigest: fingerprint(identity) } };
}
async function harness(s, options, inspected, publicText) {
  check(options.manifest && options.state && options.appRoot, 'source_workspace_required', 'Retained sources require manifest, state and appRoot');
  if (!inspected.has(s.experimentId)) {
    let observation;
    try { observation = await evaluations({ action: 'inspect', experiment: s.experimentId, ...options }); }
    catch { throw new LearningSourceError('source_unavailable', 'Retained harness ledger or attachments could not be verified'); }
    inspected.set(s.experimentId, observation);
  }
  const observed = inspected.get(s.experimentId), plan = observed.receipt.plan;
  check(plan.digest === s.planDigest, 'source_plan_changed', 'Retained plan identity changed');
  const e = observed.execution;
  check(e?.reservation && !e.issues?.length, 'source_unavailable', 'Execution coverage is incomplete');
  const trials = e.trials.filter(t => t.slot === s.slot);
  check(trials.length === 1 && trials[0].records, 'source_unavailable', 'Selected execution slot is unavailable');
  const t = trials[0], r = t.records, intent = r.intent, artifact = r.artifact;
  const verdict = t.recovery?.verdict ?? r.verdict, result = t.recovery?.result ?? r.result;
  check(intent?.digest === s.intentDigest && artifact?.kind === 'evaluation-artifact' && artifact.digest === s.artifactDigest
    && verdict?.kind === 'evaluation-verdict' && verdict.digest === s.verdictDigest
    && artifact.intentDigest === intent.digest && verdict.intentDigest === intent.digest && verdict.artifactDigest === artifact.digest,
  'source_reference_mismatch', 'Selected artifact reference chain does not match retained records');
  const checks = verdict.checks?.filter(c => c.id === s.checkId) ?? [];
  check(checks.length === 1 && hash(checks[0].observationDigest), 'source_check_unavailable', 'Named behavioral check is unavailable');
  const c = checks[0], stages = Object.values(r).filter(v => v.kind === 'evaluation-stage' && v.digest === c.observationDigest);
  check(stages.length === 1 && stages[0].intentDigest === intent.digest, 'source_check_unavailable', 'Named check observation is unavailable');
  const pair = plan.bundle.comparison.pairs.find(p => p.id === intent.input.request.pairId);
  const task = plan.bundle.cases.find(c => c.id === pair?.case.id && c.digest === pair.case.digest);
  check(task, 'source_reference_mismatch', 'Selected task identity is unavailable');
  // Do not claim incident independence for unsupported attempt ancestry.
  check(intent.parentAttemptId === null && intent.attempt === 1, 'source_attempt_unavailable', 'Original incident intent ancestry is unavailable');
  const source = { repository: task.repository, experimentId: s.experimentId, planDigest: plan.digest, slot: s.slot,
    intentDigest: intent.digest, artifactDigest: artifact.digest, verdictDigest: verdict.digest, checkId: s.checkId, startingCommit: task.startingCommit };
  const identity = { kind: s.kind, source, ledgerDigest: observed.receipt.digest, observationDigest: stages[0].digest,
    resultDigest: result?.digest ?? null, recoveryDigest: t.recovery?.receipt.digest ?? null, status: t.status };
  // Retained artifact/stage bodies remain private even when the public record is caller-authored.
  for (const f of artifact.files ?? []) if (typeof f.base64 === 'string') protect(Buffer.from(f.base64, 'base64').toString('utf8'), publicText);
  for (const stage of Object.values(r).filter(v => v.kind === 'evaluation-stage')) {
    protect(stage.stage?.output?.stdout, publicText); protect(stage.stage?.output?.stderr, publicText);
  }
  const stage = stages[0].stage;
  const failing = t.status === 'terminal' && result?.validation === 'failed' && verdict.acceptance === 'rejected'
    && verdict.failureCategory === 'acceptance' && c.status === 'failed' && stage.setup === 'passed'
    && !stage.error && stage.output?.signal === null && stage.termination?.state === 'terminated';
  return { source, identity, incidentKey: fingerprint({ repository: task.repository.toLowerCase(), planDigest: plan.digest, originalIntentDigest: intent.digest }),
    verification: { method: 'retained-harness-v1', sourceIdentityDigest: fingerprint(identity) }, failing, bodyBytes: 0 };
}

/** Verify actual authority; selections and public text are requests, never evidence. */
export async function verifyLearningSources({ selections, manifest, state, appRoot, env = process.env, publicText = null }) {
  check(Array.isArray(selections) && selections.length > 0 && selections.length <= 32, 'invalid_source_selection', 'Select one to 32 sources');
  check(publicText === null || typeof publicText === 'string' && Buffer.byteLength(publicText) <= 1024 * 1024,
    'invalid_public_text', 'Public text exceeds bounds');
  for (const x of selections) selection(x);
  const sources = [], sourceIdentities = [], inspected = new Map(), seen = new Map(); let bodyBytes = 0;
  for (const x of selections) {
    const s = x.selector;
    const key = fingerprint(s.kind === 'github-review' ? { kind: s.kind, repo: s.repo.toLowerCase(), prNumber: s.prNumber,
      reviewId: s.reviewId, threadId: s.threadId, commentId: s.commentId } : { kind: s.kind, experimentId: s.experimentId, slot: s.slot, checkId: s.checkId });
    if (seen.has(key)) {
      check(seen.get(key) === fingerprint(x), 'source_selection_conflict', 'Duplicate source has conflicting identity or attribution');
      continue;
    }
    seen.set(key, fingerprint(x));
    const outputText = JSON.stringify(x.classification) + (publicText ?? '');
    const r = s.kind === 'github-review' ? await github(s, env, outputText) : await harness(s, { manifest, state, appRoot }, inspected, outputText);
    bodyBytes += r.bodyBytes;
    check(bodyBytes <= 1024 * 1024, 'source_limit', 'Selected bodies exceed aggregate bound');
    check(x.classification.value !== 'verified-defect' || r.failing, 'behavioral_evidence_required', 'Verified defect requires a retained independently failing behavioral check');
    sources.push(sealRecord({ schemaVersion: 1, kind: 'learning-source', id: `source-${key.slice(0, 56)}`, version: 1,
      source: r.source, classification: x.classification, incidentKey: r.incidentKey, verification: r.verification }));
    sourceIdentities.push(r.identity);
  }
  sources.sort((a, b) => a.id.localeCompare(b.id));
  sourceIdentities.sort((a, b) => fingerprint(a).localeCompare(fingerprint(b)));
  return { sources, sourceIdentities, diagnostics: { checkedAt: new Date().toISOString(), sourceCount: sources.length } };
}

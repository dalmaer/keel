// Explicit, project-local trials. No transcript discovery, agent execution or config writes.
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { join, resolve, parse, sep } from 'node:path';
import { decisionCommand } from './decision.mjs';
import { randomUUID } from 'node:crypto';

const RECORD_LIMIT = 16 * 1024, STATE_LIMIT = 4 * 1024 * 1024, EVENT_LIMIT = 20000;
const QUALITY = ['lostDecisions', 'duplicateActions', 'regressions', 'rework'];
const fail = message => { throw Object.assign(new Error(`session trials: ${message}`), { exitCode: 2 }); };
const check = (ok, message) => { if (!ok) fail(message); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const positive = x => Number.isFinite(x) && x > 0;
const string = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 1024 && !/[\x00-\x1f]/.test(x);
const id = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(x);
function shape(x, required, optional = []) {
  check(object(x) && required.every(k => Object.hasOwn(x, k)) && Object.keys(x).every(k => [...required, ...optional].includes(k)), 'invalid record fields');
}
function pointers(x, nonempty = true) {
  check(Array.isArray(x) && x.length <= 32 && (!nonempty || x.length > 0) && x.every(string), 'expected bounded evidence pointers');
}
function policy(x) {
  shape(x, ['contextTokens', 'atBoundary', 'maxHandoffs']);
  check((x.contextTokens === null || (integer(x.contextTokens) && x.contextTokens > 0)) && typeof x.atBoundary === 'boolean' && integer(x.maxHandoffs) && x.maxHandoffs <= 16, 'invalid policy');
}
export function validateSpec(x) {
  shape(x, ['version', 'id', 'provider', 'model', 'cohort', 'baseline', 'candidate', 'minPairs', 'minImprovement', 'maxRuns', 'budgetMinutes', 'reserveMinutes', 'automatic']);
  check(x.version === 1 && id(x.id) && ['provider', 'model', 'cohort'].every(k => string(x[k])), 'invalid experiment identity');
  policy(x.baseline); policy(x.candidate);
  check(x.baseline.contextTokens !== x.candidate.contextTokens && x.baseline.atBoundary === x.candidate.atBoundary && x.baseline.maxHandoffs === x.candidate.maxHandoffs, 'only contextTokens may change');
  check(integer(x.minPairs) && x.minPairs >= 3 && integer(x.maxRuns) && x.maxRuns > 2 * x.minPairs && x.maxRuns <= 1000, 'invalid run limits');
  check(positive(x.minImprovement) && x.minImprovement < 1 && positive(x.budgetMinutes) && positive(x.reserveMinutes) && x.reserveMinutes <= x.budgetMinutes && typeof x.automatic === 'boolean', 'invalid budget or improvement');
  return x;
}
function descriptor(x, spec) {
  shape(x, ['id', 'provider', 'model', 'cohort', 'task', 'taskClass', 'sourceRevision', 'evidence'], ['decisionTarget', 'decisionDigest']);
  check(id(x.id) && ['task', 'taskClass', 'sourceRevision'].every(k => string(x[k])), 'invalid run identity');
  check(['provider', 'model', 'cohort'].every(k => x[k] === spec[k]), 'run outside experiment scope');
  pointers(x.evidence);
  if (x.decisionDigest !== undefined) check(/^[a-f0-9]{64}$/.test(x.decisionDigest) && x.decisionTarget !== undefined, 'digest needs a decision target');
  if (x.decisionTarget !== undefined) {
    shape(x.decisionTarget, ['kind', 'ref']);
    check(['phase', 'issue'].includes(x.decisionTarget.kind) && string(x.decisionTarget.ref), 'invalid decision target');
  }
}
function finishRecord(x) {
  shape(x, ['runId', 'totalMinutes', 'costUsd', 'costSource', 'accepted', 'verified', 'policyApplied', ...QUALITY, 'contextPeakTokens', 'sourceRevision', 'acceptanceEvidence', 'evidence']);
  check(id(x.runId) && positive(x.totalMinutes) && (x.costUsd === null || (Number.isFinite(x.costUsd) && x.costUsd >= 0)), 'invalid measured minutes or cost');
  check(x.costUsd === null ? x.costSource === null : string(x.costSource), 'measured cost requires a source; unknown cost has none');
  check(['accepted', 'verified', 'policyApplied'].every(k => x[k] === null || typeof x[k] === 'boolean') && QUALITY.every(k => x[k] === null || integer(x[k])), 'invalid quality observations');
  check(x.contextPeakTokens === null || integer(x.contextPeakTokens), 'invalid context occupancy');
  check(string(x.sourceRevision) && (x.acceptanceEvidence === null || string(x.acceptanceEvidence)) && (x.accepted !== true || string(x.acceptanceEvidence)), 'acceptance requires explicit evidence and revision');
  pointers(x.evidence);
}
function handoffRecord(x) {
  shape(x, ['id', 'runId', 'goal', 'remainingAcceptance', 'decisions', 'revision', 'dirtyPaths', 'proof', 'evidence', 'activeJobs', 'nextAction', 'claim', 'remainingBudget', 'contextTokens', 'boundaryReached', 'safeBoundary', 'uncertainWrites'], ['decisionDigest']);
  if (x.decisionDigest !== undefined) check(/^[a-f0-9]{64}$/.test(x.decisionDigest), 'invalid computed digest');
  check(id(x.id) && id(x.runId) && ['goal', 'revision', 'nextAction'].every(k => string(x[k])), 'invalid handoff identity');
  check(x.safeBoundary === true && x.uncertainWrites === false, 'handoff requires a safe boundary and certain writes');
  for (const k of ['remainingAcceptance', 'dirtyPaths', 'proof', 'activeJobs']) pointers(x[k], false);
  pointers(x.evidence);
  shape(x.decisions, ['ownerChoices', 'suggestions']);
  pointers(x.decisions.ownerChoices, false); pointers(x.decisions.suggestions, false);
  check((x.claim === null || string(x.claim)) && Number.isFinite(x.remainingBudget) && x.remainingBudget >= 0, 'invalid claim pointer or remaining budget');
}
export function trialBudget(state) {
  const settledMinutes = state.runs.reduce((n, r) => n + (r.finish?.totalMinutes ?? 0), 0);
  const reservedMinutes = state.runs.filter(r => !r.finish).length * state.spec.reserveMinutes;
  const exceededReservation = state.runs.some(r => r.finish && r.finish.totalMinutes > state.spec.reserveMinutes);
  return { unit: 'summed-agent-minutes', settledMinutes, reservedMinutes, remainingMinutes: Math.max(0, state.spec.budgetMinutes - settledMinutes - reservedMinutes), exceededReservation, runs: state.runs.length, maxRuns: state.spec.maxRuns };
}
function observed(f) { return f && f.policyApplied === true && f.accepted !== null && f.verified !== null && QUALITY.every(k => f[k] !== null); }
/** Current occupancy, never cumulative usage; this recommends, it cannot rotate. */
export function handoffRecommendation(policySnapshot, observation, used = 0) {
  policy(policySnapshot);
  shape(observation, ['contextTokens', 'boundaryReached', 'safeBoundary', 'uncertainWrites'], ['decisionDigest']);
  check((observation.contextTokens === null || integer(observation.contextTokens)) && ['boundaryReached', 'safeBoundary', 'uncertainWrites'].every(k => typeof observation[k] === 'boolean') && integer(used), 'invalid boundary observation');
  const { contextTokens, boundaryReached, safeBoundary, uncertainWrites } = observation;
  const threshold = policySnapshot.contextTokens;
  const triggered = (policySnapshot.atBoundary && boundaryReached) || (threshold !== null && contextTokens !== null && contextTokens >= threshold);
  const status = used >= policySnapshot.maxHandoffs ? 'limit' : triggered ? (safeBoundary && !uncertainWrites ? 'due' : 'defer') : threshold !== null && contextTokens === null ? 'unknown' : 'not-due';
  return { status, contextTokens, boundaryReached, policy: policySnapshot, used, automaticRotation: false };
}
function boundaryObservation(x) {
  return Object.fromEntries(['contextTokens', 'boundaryReached', 'safeBoundary', 'uncertainWrites'].map(k => [k, x[k]]));
}
function monitorVerdict(state, run) {
  const f = run.finish;
  const baselines = state.runs.filter(r => r.stage === 'trial' && r.arm === 'baseline' && r.taskClass === run.taskClass && observed(r.finish) && r.finish.accepted === true && r.finish.verified === true).map(r => r.finish);
  if (f && (f.accepted === false || f.verified === false || QUALITY.some(k => f[k] !== null && baselines.length && f[k] > Math.min(...baselines.map(b => b[k]))))) return 'worse';
  if (f && baselines.length && f.totalMinutes > Math.max(...baselines.map(b => b.totalMinutes)) * (1 + state.spec.minImprovement)) return 'worse';
  if (!observed(f) || !baselines.length) return 'inconclusive';
  return 'no-worse';
}
export function auditTrial(state) {
  const pairs = [], trials = state.runs.filter(r => r.stage === 'trial');
  for (let i = 0; i < trials.length; i += 2) {
    const runs = trials.slice(i, i + 2), baseline = runs.find(r => r.arm === 'baseline'), candidate = runs.find(r => r.arm === 'candidate');
    const b = baseline?.finish, c = candidate?.finish;
    let verdict = 'inconclusive', reason = 'missing or unknown observation (including policyApplied)';
    if (b && c && (b.accepted === false || c.accepted === false || b.verified === false || c.verified === false || QUALITY.some(k => b[k] !== null && c[k] !== null && c[k] > b[k]))) {
      verdict = 'worse'; reason = 'unaccepted, unverified or worse quality';
    } else if (b && c && c.totalMinutes > b.totalMinutes) {
      verdict = 'worse'; reason = 'candidate costs more minutes';
    } else if (observed(b) && observed(c)) {
      const improvement = (b.totalMinutes - c.totalMinutes) / b.totalMinutes;
      verdict = improvement >= state.spec.minImprovement ? 'better' : improvement < 0 ? 'worse' : 'inconclusive';
      reason = verdict === 'better' ? 'margin met' : verdict === 'worse' ? 'candidate costs more minutes' : 'equal or below margin';
    }
    pairs.push({ pair: i / 2, sampleIds: runs.map(r => r.id), taskClass: baseline?.taskClass ?? candidate?.taskClass, verdict, reason,
      baselineMinutes: b?.totalMinutes ?? null, candidateMinutes: c?.totalMinutes ?? null,
      improvement: b && c ? (b.totalMinutes - c.totalMinutes) / b.totalMinutes : null,
      evidence: runs.flatMap(r => [...r.evidence, ...(r.finish?.evidence ?? []), ...(r.finish?.acceptanceEvidence ? [r.finish.acceptanceEvidence] : [])]) });
  }
  const betterPairs = pairs.filter(p => p.verdict === 'better').length;
  const completePairs = pairs.filter(p => p.sampleIds.length === 2 && p.sampleIds.every(id => observed(state.runs.find(r => r.id === id).finish))).length;
  const monitors = state.runs.filter(r => r.stage === 'monitor').map(r => ({ sampleId: r.id, arm: r.arm, verdict: monitorVerdict(state, r), reason: 'accepted, verified and policyApplied required; quality no worse than matched baselines; minutes at most worst baseline times (1 + minImprovement)', totalMinutes: r.finish?.totalMinutes ?? null, policy: r.policy, evidence: [...r.evidence, ...(r.finish?.evidence ?? [])] }));
  const budget = trialBudget(state);
  const budgetGap = budget.exceededReservation || budget.settledMinutes + budget.reservedMinutes > state.spec.budgetMinutes;
  const gaps = budgetGap ? [{ reason: 'observed work exceeded reservation or experiment allowance' }] : [];
  const verdict = (pairs.some(p => p.verdict === 'worse') || monitors.some(r => r.verdict === 'worse')) ? 'worse' : pairs.length >= state.spec.minPairs && betterPairs === pairs.length && trials.length % 2 === 0 && monitors.every(r => r.verdict === 'no-worse') && !budgetGap ? 'better' : 'inconclusive';
  return { verdict, gaps, source: 'explicit-records', coverage: { kind: 'manual-attestation', evidenceContentsVerified: false, providerTelemetry: false, complete: !budgetGap && state.runs.length > 0 && state.runs.every(r => observed(r.finish)) }, metric: 'totalMinutes', interpretation: 'bounded paired observations; not a scientific causal claim', scope: { provider: state.spec.provider, model: state.spec.model, cohort: state.spec.cohort }, policies: { baseline: state.spec.baseline, candidate: state.spec.candidate }, numerator: betterPairs, denominator: pairs.length, completePairs, admittedRuns: state.runs.length, monitors, excluded: pairs.filter(p => p.verdict === 'inconclusive').map(p => ({ pair: p.pair, reason: p.reason })), pairs, budget };
}
function transition(state, to, reason, at, sourceIds) {
  const changed = state.effective !== to || (to === 'baseline' && !state.rollbackLatched);
  if (to === 'baseline') state.rollbackLatched = true;
  if (!changed) return;
  state.transitions.push({ from: state.effective, to, reason, at, sourceIds });
  state.effective = to;
}
function evolve(state, event) {
  shape(event, ['action', 'record', 'at']);
  check(typeof event.at === 'string' && Number.isFinite(Date.parse(event.at)), 'invalid event timestamp');
  const { action, record: x, at } = event;
  if (action === 'begin') {
    descriptor(x, state.spec);
    check(!state.runs.length || state.runs[0].taskClass === x.taskClass, 'experiment taskClass must match first run; use a new experiment');
    check(!state.runs.some(r => r.id === x.id), 'run id already reserved; inspect status');
    const budget = trialBudget(state);
    check(state.runs.length < state.spec.maxRuns && !budget.exceededReservation && budget.remainingMinutes >= state.spec.reserveMinutes, 'run or minute budget exhausted');
    const n = state.runs.filter(r => r.stage === 'trial').length;
    const stage = state.transitions.some(t => t.to === 'candidate') || state.rollbackLatched ? 'monitor' : 'trial';
    const arm = stage === 'monitor' ? state.effective : ['baseline', 'candidate', 'candidate', 'baseline'][n % 4];
    if (stage === 'trial' && n % 2) check(state.runs[n - 1].taskClass === x.taskClass, 'pair taskClass must match');
    state.runs.push({ ...x, arm, stage, pair: stage === 'trial' ? Math.floor(n / 2) : null, policy: { ...state.spec[arm] }, begunAt: at, handoffs: [], finish: null });
  } else if (action === 'finish' || action === 'handoff') {
    if (action === 'finish') finishRecord(x); else handoffRecord(x);
    const run = state.runs.find(r => r.id === x.runId);
    check(run && !run.finish, 'run is absent or already finished; inspect status');
    if (action === 'handoff') {
      check(!run.handoffs.some(h => h.id === x.id), 'handoff id already recorded');
      check(run.handoffs.length < run.policy.maxHandoffs, 'handoff limit exhausted');
      check(handoffRecommendation(run.policy, boundaryObservation(x), run.handoffs.length).status === 'due', 'handoff is not due at a safe boundary');
      run.handoffs.push({ ...x, at });
    } else {
      run.finish = { ...x, at };
      if (state.spec.automatic) {
        if (state.effective === 'candidate' && run.arm === 'candidate' && monitorVerdict(state, run) === 'worse') transition(state, 'baseline', 'observed quality or efficiency regression', at, [run.id]);
        else if (state.effective === 'baseline' && auditTrial(state).verdict === 'better' && !state.rollbackLatched) transition(state, 'candidate', 'fresh audit better', at, state.runs.map(r => r.id));
      }
    }
  } else if (action === 'apply' || action === 'rollback') {
    check(x === null, 'policy action takes no record');
    if (action === 'apply') {
      check(!state.rollbackLatched, 'rollback latched baseline; use a new experiment');
      check(auditTrial(state).verdict === 'better', 'fresh audit must be better');
    }
    transition(state, action === 'apply' ? 'candidate' : 'baseline', action === 'apply' ? 'manual fresh audit' : 'manual safety rollback', at, state.runs.map(r => r.id));
  } else fail('invalid ledger action');
  return state;
}
function replay(ledger, experiment) {
  shape(ledger, ['version', 'spec', 'createdAt', 'events']);
  validateSpec(ledger.spec);
  check(ledger.version === 1 && ledger.spec.id === experiment && typeof ledger.createdAt === 'string' && Number.isFinite(Date.parse(ledger.createdAt)) && Array.isArray(ledger.events) && ledger.events.length <= EVENT_LIMIT, 'corrupt ledger');
  const state = { spec: ledger.spec, effective: 'baseline', rollbackLatched: false, runs: [], transitions: [] };
  for (const event of ledger.events) evolve(state, event);
  return state;
}

// Roots and explicit input paths are canonicalized first; managed storage rejects
// symlinks in every component. Read handles
// use O_NOFOLLOW and bounded reads; lock contention never triggers stale reclaim.
async function safePath(path, directory = true) {
  const full = resolve(path), base = parse(full).root;
  let current = base;
  for (const part of full.slice(base.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    check(!stat.isSymbolicLink() && (current === full && !directory ? stat.isFile() : stat.isDirectory()), 'unsafe storage path');
  }
  return true;
}
async function readJson(path, limit) {
  await safePath(path, false);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    check(stat.isFile() && stat.size <= limit, 'record exceeds size bound');
    const buf = Buffer.alloc(limit + 1);
    let bytesRead = 0;
    while (bytesRead < buf.length) {
      const chunk = await handle.read(buf, bytesRead, buf.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    check(bytesRead <= limit, 'record exceeds size bound');
    try { return JSON.parse(buf.subarray(0, bytesRead).toString('utf8')); } catch { fail('invalid JSON record'); }
  } finally { await handle?.close(); }
}
async function store(path, ledger) {
  const data = JSON.stringify(ledger, null, 2) + '\n';
  check(Buffer.byteLength(data) <= STATE_LIMIT, 'ledger exceeds size bound');
  const temp = `${path}.${randomUUID()}.pending`;
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  // A failed/uncertain replacement retains its pending file for owner inspection.
  await rename(temp, path);
  const directory = await open(resolve(path, '..'), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}
function output(state, action, preview, observation) {
  const audit = auditTrial(state);
  let recommendation = { status: 'unknown', contextTokens: null, automaticRotation: false };
  if (observation) {
    shape(observation, ['runId', 'contextTokens', 'boundaryReached', 'safeBoundary', 'uncertainWrites'], ['decisionDigest']);
    const run = state.runs.find(r => r.id === observation.runId);
    check(run && !run.finish, 'recommendation requires active run');
    recommendation = handoffRecommendation(run.policy, boundaryObservation(observation), run.handoffs.length);
  }
  return { action, preview, enabled: true, experiment: state.spec.id, spec: state.spec, effective: state.effective, effectivePolicy: state.spec[state.effective], rollbackLatched: state.rollbackLatched, recommendation, runs: state.runs, transitions: state.transitions, audit };
}
export async function sessionTrials({ root, action = 'status', experiment, record, yes = false }) {
  check(['status', 'start', 'begin', 'finish', 'handoff', 'audit', 'apply', 'rollback'].includes(action), 'unknown action');
  root = await realpath(root);
  const mutation = !['status', 'audit'].includes(action);
  check(['start', 'begin', 'finish', 'handoff'].includes(action) ? record !== undefined : action === 'status' || record === undefined, 'unexpected or missing record');
  if (record !== undefined) {
    check(!Object.hasOwn(record ?? {}, 'decisionDigest'), 'decisionDigest is computed from source, not caller supplied');
    let raw; try { raw = JSON.stringify(record); } catch { fail('invalid record'); }
    check(raw && Buffer.byteLength(raw) <= RECORD_LIMIT, 'record exceeds size bound');
    record = JSON.parse(raw);
  }
  if (action === 'start') { validateSpec(record); check(experiment === undefined || experiment === record.id, 'experiment id mismatch'); experiment = record.id; }
  if (action === 'status' && experiment === undefined) { check(record === undefined, 'observation requires experiment'); return sessionTrialSummary({ root }); }
  check(id(experiment), 'safe experiment id required');
  const base = join(resolve(root), '.keel'), home = join(base, 'session-trials'), dir = join(home, experiment), path = join(dir, 'state.json');
  check(await safePath(base), 'project .keel directory required');
  await safePath(home);
  let lock;
  if (mutation && yes) {
    await mkdir(home, { recursive: true }); await safePath(home);
    try { lock = await open(join(home, '.lock'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch (e) { if (e.code === 'EEXIST' || e.code === 'ELOOP') fail('storage locked; inspect interrupted write; no automatic reclaim'); throw e; }
  }
  try {
    let ledger;
    if (action === 'start') {
      check(!await safePath(dir), 'experiment already exists; inspect status before recovery');
      ledger = { version: 1, spec: record, createdAt: new Date().toISOString(), events: [] };
    } else {
      check(await safePath(dir), 'experiment not found');
      try { ledger = await readJson(path, STATE_LIMIT); } catch (e) { if (e.code === 'ENOENT') fail('incomplete experiment; preserve it for recovery'); throw e; }
    }
    const state = replay(ledger, experiment);
    let decisionBundle;
    const decisionTarget = action === 'begin' ? record.decisionTarget : action === 'handoff' ? state.runs.find(r => r.id === record.runId)?.decisionTarget : undefined;
    if (decisionTarget) {
      check(['phase', 'issue'].includes(decisionTarget.kind) && string(decisionTarget.ref), 'invalid decision target');
      const resolved = await decisionCommand({ root, [decisionTarget.kind]: decisionTarget.ref });
      check(resolved.exitCode === 0, `required decision context ${resolved.data.state}`);
      decisionBundle = resolved.data;
      record.decisionDigest = decisionBundle.digest;
    }
    if (mutation && action !== 'start') {
      const event = { action, record: record ?? null, at: new Date().toISOString() };
      const transitionsBefore = state.transitions.length;
      evolve(state, event);
      const noOp = ['apply', 'rollback'].includes(action) && state.transitions.length === transitionsBefore;
      if (!noOp) {
        check(ledger.events.length < EVENT_LIMIT, 'ledger event limit exhausted');
        ledger.events.push(event);
      }
    }
    if (mutation && yes) {
      if (action === 'start') await mkdir(dir);
      await safePath(dir); await safePath(path, false);
      await store(path, ledger);
    }
    const result = output(state, action, mutation && !yes, action === 'status' ? record : undefined);
    if (decisionBundle) result.decisionBundle = decisionBundle;
    if (action === 'handoff') {
      const run = state.runs.find(r => r.id === record.runId);
      result.recommendation = handoffRecommendation(run.policy, boundaryObservation(record), run.handoffs.length - 1);
    }
    return result;
  } finally {
    if (lock) { await lock.close(); await unlink(join(home, '.lock')); }
  }
}

/** Read the same receipts as retro sessions; unavailable coverage is never empty success. */
export async function sessionTrialSummary({ root }) {
  root = await realpath(root);
  const home = join(resolve(root), '.keel', 'session-trials');
  if (!await safePath(home)) return { enabled: false, experiments: [], gaps: [], coverage: { complete: true }, effectivePolicy: null };
  const entries = await readdir(home, { withFileTypes: true });
  check(entries.length <= 1000, 'experiment listing exceeds bound');
  const experiments = [], gaps = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.lock') { gaps.push({ reason: 'storage locked or interrupted' }); continue; }
    if (!id(entry.name) || !entry.isDirectory()) { gaps.push({ reason: 'unexpected storage entry' }); continue; }
    try {
      const data = await sessionTrials({ root, action: 'audit', experiment: entry.name });
      experiments.push({ id: entry.name, effective: data.effective, effectivePolicy: data.effectivePolicy, audit: data.audit, transitions: data.transitions });
    } catch { gaps.push({ experiment: entry.name, reason: 'unreadable or corrupt experiment' }); }
  }
  return { enabled: experiments.length > 0, experiments, gaps, coverage: { complete: gaps.length === 0 } };
}

export async function sessionTrialsCommand({ args, root, cwd }) {
  const action = args[0] ?? 'status';
  const opts = {}, seen = new Set();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    check(['--json', '--yes', '--experiment', '--record'].includes(flag) && !seen.has(flag), 'unexpected or duplicate option'); seen.add(flag);
    if (flag === '--json' || flag === '--yes') opts[flag] = true;
    else { check(typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'), 'option needs a value'); opts[flag] = args[++i]; }
  }
  let record;
  if (opts['--record']) {
    try { record = await readJson(await realpath(resolve(cwd, opts['--record'])), RECORD_LIMIT); }
    catch { fail('cannot read bounded JSON record'); }
  }
  const data = await sessionTrials({ root, action, experiment: opts['--experiment'], record, yes: opts['--yes'] === true });
  return { data, text: JSON.stringify(data, null, 2) };
}

import { numeric, record, WebError } from './common.mjs';
import { runnerUsage, ciOptions } from '../../practices/night/files/scripts/keel/ci.mjs';

export const RUN_LIMITS = Object.freeze({ requests: 80, bytes: 8 * 1024 * 1024, milliseconds: 25000, runs: 20, attempts: 10, detailPages: 2, perPage: 100 });
export const workflowPath = value => typeof value === 'string' && /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(value) && value.length <= 240;
export const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const text = (value, max = 300) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max) : null;
export const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const issue = (source, reason, code = 'incomplete') => ({ source, reason, code });
export const unknownCost = reason => ({ weightedMinutes: null, observedWeightedMinutes: null, actual: null, basis: 'unknown', unit: 'weighted-minutes', reason });
export function pageNumber(value = 1) {
  if (typeof value === 'string' && /^[1-9]\d{0,4}$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000) throw new WebError('invalid_run_page', 400);
  return value;
}
export const states = ['queued', 'requested', 'waiting', 'running', 'succeeded', 'failed', 'cancelled', 'skipped', 'unknown'];
export function runFilters(options = {}) {
  if (!record(options) || Object.keys(options).some(k => !['page', 'days', 'routine', 'status'].includes(k))) throw new WebError('invalid_run_filters', 400);
  let days = options.days ?? 30;
  if (typeof days === 'string' && /^\d{1,2}$/.test(days)) days = Number(days);
  if (!Number.isInteger(days) || days < 1 || days > 90 || options.routine != null && !workflowPath(options.routine)
    || options.status != null && !states.includes(options.status)) throw new WebError('invalid_run_filters', 400);
  return { page: pageNumber(options.page), days, routine: options.routine ?? null, status: options.status ?? null };
}
export function stateOf(status, conclusion) {
  if (status === 'in_progress') return 'running';
  if (status === 'waiting' || conclusion === 'action_required') return 'waiting';
  if (status === 'requested') return 'requested';
  if (['queued', 'pending'].includes(status)) return 'queued';
  if (status !== 'completed') return 'unknown';
  return conclusion === 'success' ? 'succeeded' : ['failure', 'timed_out', 'startup_failure'].includes(conclusion) ? 'failed'
    : conclusion === 'cancelled' ? 'cancelled' : conclusion === 'skipped' ? 'skipped' : 'unknown';
}
export const runIdentity = (repoId, runId, attempt) => JSON.stringify(['github-actions-attempt', repoId, runId, attempt]);
export function attemptModel(project, raw, expected = {}) {
  if (!record(raw) || !numeric(raw.id) || !numeric(raw.run_attempt) || !numeric(raw.workflow_id) || !sha(raw.head_sha)
    || raw.repository?.id !== project.repoId || expected.runId !== undefined && raw.id !== expected.runId
    || expected.attempt !== undefined && raw.run_attempt !== expected.attempt
    || typeof raw.status !== 'string' || raw.status.length > 80 || !(raw.conclusion == null || typeof raw.conclusion === 'string' && raw.conclusion.length <= 80)) throw new WebError('run_identity_mismatch');
  const path = typeof raw.path === 'string' ? raw.path.split('@')[0] : null;
  const identity = { repoId: project.repoId, runId: raw.id, attempt: raw.run_attempt };
  return {
    id: runIdentity(project.repoId, raw.id, raw.run_attempt), kind: 'actions-attempt', projectId: project.id,
    title: text(raw.display_title) || text(raw.name) || `Workflow run ${raw.id}`, routineId: workflowPath(path) ? path : null, workflowId: raw.workflow_id,
    identity, parentId: JSON.stringify(['github-actions-run', project.repoId, raw.id]), retryOf: raw.run_attempt > 1 ? runIdentity(project.repoId, raw.id, raw.run_attempt - 1) : null,
    source: { kind: 'github-actions', revision: raw.head_sha, event: text(raw.event, 80), branch: text(raw.head_branch, 200) },
    provider: { status: raw.status, conclusion: raw.conclusion ?? null }, state: stateOf(raw.status, raw.conclusion), acceptance: 'not-established',
    startedAt: timestamp(raw.run_started_at), completedAt: null, updatedAt: timestamp(raw.updated_at), timeBasis: 'provider-attempt', queueMs: null,
    actor: numeric(raw.triggering_actor?.id) ? text(raw.triggering_actor.login, 100) : numeric(raw.actor?.id) ? text(raw.actor.login, 100) : null,
    worker: null, model: null, cost: unknownCost('Attempt job evidence has not been read. Actual charges are unknown.'),
    link: `https://github.com/${project.repo}/actions/runs/${raw.id}/attempts/${raw.run_attempt}`,
    detailUrl: `/projects/${encodeURIComponent(project.id)}/activity/actions/${raw.id}/attempts/${raw.run_attempt}`,
  };
}
// Equal identities are shown once; conflicting facts suppress all versions.
export function deduplicate(items, source = 'actions') {
  const found = new Map(), conflicts = new Set(), gaps = [];
  for (const item of items) {
    const old = found.get(item.id);
    if (old && JSON.stringify(old) !== JSON.stringify(item)) conflicts.add(item.id);
    else if (!old) found.set(item.id, item);
  }
  for (const id of conflicts) { found.delete(id); gaps.push(issue(source, `Conflicting observations for identity ${id}; neither version is selected.`, 'conflict')); }
  return { items: [...found.values()], gaps };
}
export function matchesWindow(item, filters, now) {
  const observed = [item.startedAt, item.completedAt, item.updatedAt].map(Date.parse).filter(at => Number.isFinite(at) && at <= now);
  const active = ['queued', 'requested', 'waiting', 'running'].includes(item.state);
  const unresolved = ['web-operation', 'web-migration', 'media-receipt'].includes(item.kind) && ['uncertain', 'delete-uncertain'].includes(item.provider?.status);
  return (active || unresolved || !observed.length || Math.max(...observed) >= now - filters.days * 86400000)
    && (!filters.routine || item.routineId === filters.routine) && (!filters.status || item.state === filters.status);
}
export function coverage(items, gaps, filters, now) {
  const dates = items.map(item => item.startedAt ?? item.updatedAt).filter(Boolean).sort();
  return { state: gaps.length ? items.length ? 'partial' : 'unavailable' : 'complete-page', gaps, observed: items.length,
    window: filters ? { days: filters.days, from: new Date(now - filters.days * 86400000).toISOString(), to: new Date(now).toISOString() } : null,
    observedRange: dates.length ? { from: dates[0], to: dates.at(-1) } : null };
}
export function duration(start, end, now) {
  const a = Date.parse(start), b = Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a && b <= now ? b - a : null;
}
export function jobModel(project, run, job, now) {
  if (!record(job) || !numeric(job.id) || job.run_id !== run.identity.runId || Object.hasOwn(job, 'run_attempt') && job.run_attempt !== run.identity.attempt
    || job.head_sha !== run.source.revision || typeof job.status !== 'string' || job.status.length > 80
    || !(job.conclusion == null || typeof job.conclusion === 'string' && job.conclusion.length <= 80)) throw new WebError('job_identity_mismatch');
  const startedAt = timestamp(job.started_at), completedAt = timestamp(job.completed_at), steps = [], gaps = [];
  if (!Array.isArray(job.steps) || job.steps.length > 1000) gaps.push(issue('steps', `Job ${job.id} step coverage is unavailable or exceeds the bound.`));
  else {
    const seen = new Set();
    for (const step of job.steps) {
      if (!numeric(step?.number) || seen.has(step.number) || typeof step.status !== 'string') { gaps.push(issue('steps', `Job ${job.id} has invalid or duplicated step coordinates.`)); continue; }
      seen.add(step.number);
      const start = timestamp(step.started_at), end = timestamp(step.completed_at);
      steps.push({ number: step.number, name: text(step.name), status: text(step.status, 80), conclusion: text(step.conclusion, 80), startedAt: start, completedAt: end, durationMs: duration(start, end, now) });
    }
  }
  return { id: job.id, name: text(job.name), status: job.status, conclusion: job.conclusion ?? null, startedAt, completedAt, durationMs: duration(startedAt, completedAt, now),
    runner: text(job.runner_name, 200), labels: Array.isArray(job.labels) ? job.labels.filter(v => typeof v === 'string' && v.length <= 200).slice(0, 30) : [],
    steps, link: `https://github.com/${project.repo}/actions/runs/${run.identity.runId}/job/${job.id}`, gaps };
}
export function usageEstimate(jobs, visibility, config, complete, now) {
  let options;
  try { options = ciOptions(config); } catch { return unknownCost('Runner weighting configuration is invalid; actual charges are unknown.'); }
  let subtotal = 0, known = 0, uncertain = !complete;
  for (const job of jobs) {
    const skipped = job.status === 'completed' && job.conclusion === 'skipped' && (!job.startedAt && !job.completedAt || job.durationMs === 0);
    if (skipped) { known++; continue; }
    const weighting = runnerUsage(job, visibility, options);
    if (job.status !== 'completed' || job.durationMs === null || weighting.weight === null || Date.parse(job.completedAt) > now) { uncertain = true; continue; }
    subtotal += Math.ceil(job.durationMs / 60000) * weighting.weight; known++;
  }
  if (!jobs.length) return unknownCost('No job evidence establishes usage; actual charges are unknown.');
  if (!Number.isFinite(subtotal)) return unknownCost('Usage exceeds the representable estimate bound.');
  return { weightedMinutes: uncertain ? null : subtotal, observedWeightedMinutes: known ? subtotal : null, actual: null,
    basis: uncertain ? known ? 'observed-job-subtotal' : 'unknown' : 'complete-job-estimate', unit: 'weighted-minutes',
    reason: 'Ceiling of each observed job runtime in minutes × configured runner weight. Queue time excluded; this is an estimate, not an invoice, model tokens or quota.', assumptions: { weightsDate: options.weightsDate, weights: options.weights } };
}
export function artifactModel(project, run, raw) {
  if (!record(raw) || !numeric(raw.id) || typeof raw.name !== 'string' || raw.name.length > 500 || !Number.isSafeInteger(raw.size_in_bytes) || raw.size_in_bytes < 0 || typeof raw.expired !== 'boolean'
    || raw.workflow_run?.id !== undefined && raw.workflow_run.id !== run.identity.runId || raw.workflow_run?.repository_id !== undefined && raw.workflow_run.repository_id !== project.repoId) throw new WebError('artifact_identity_mismatch');
  return { id: raw.id, name: text(raw.name, 500), sizeBytes: raw.size_in_bytes, expired: raw.expired, createdAt: timestamp(raw.created_at), expiresAt: timestamp(raw.expires_at), attempt: null, scope: 'logical-run',
    link: `https://github.com/${project.repo}/actions/runs/${run.identity.runId}` };
}

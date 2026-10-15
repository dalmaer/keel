// Read-only adoption cost preview; shares the production Actions reader with night.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readCiUsage, ciOptions, CI_LOGICAL_RUN_BASIS } from '../practices/night/files/scripts/keel/ci.mjs';
const DAY = 86400000;
const historyReads = new Map();

const nonnegative = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const sameMap = (a, b) => a && typeof a === 'object' && !Array.isArray(a) && JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** Cached observations are data, not authority to change units or multipliers. */
export function validCiHistory(history, { repo, options, now }) {
  if (!history || history.repo !== repo || history.source !== 'github-actions-jobs' || !Array.isArray(history.workflows) || typeof history.coverage?.complete !== 'boolean') return false;
  const { since, until, days } = history.window ?? {};
  const start = Date.parse(since), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !nonnegative(days) || days === 0 || days > 90 || Math.abs(end - start - days * DAY) > 1 || end > now || now - end > 30 * DAY) return false;
  const { repoCreatedAt, workflow, workflowPath, workflowCreatedAt, observedSince, observedDays } = history.window;
  if (workflow !== null && (typeof workflow !== 'string' || !workflow)) return false;
  if (workflowPath !== null && (typeof workflowPath !== 'string' || !/^\.github\/workflows\/[^/]+\.ya?ml$/.test(workflowPath))) return false;
  if (workflow === null && (workflowPath !== null || workflowCreatedAt !== null)) return false;
  const date = value => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) < end);
  if (!date(repoCreatedAt) || !date(workflowCreatedAt) || (workflowCreatedAt !== null && workflowPath === null)) return false;
  const exposureKnown = repoCreatedAt !== null && (workflow === null || workflowCreatedAt !== null);
  if (exposureKnown) {
    const observed = Math.max(start, Date.parse(repoCreatedAt), workflow === null ? -Infinity : Date.parse(workflowCreatedAt));
    if (typeof observedSince !== 'string' || Date.parse(observedSince) !== observed || !nonnegative(observedDays) || observedDays === 0 || Math.abs((end - observed) / DAY - observedDays) > 1e-9) return false;
  } else if (observedSince !== null || observedDays !== null) return false;
  if (history.assumptions?.logicalRunBasis !== CI_LOGICAL_RUN_BASIS) return false;
  if (!sameMap(history.assumptions?.weights, options.weights) || !sameMap(history.assumptions?.runnerWeights, options.runnerWeights) || history.assumptions?.weightsDate !== options.weightsDate) return false;
  if (!nonnegative(history.observedWeightedMinutes) || (history.weightedMinutes !== null && !nonnegative(history.weightedMinutes))) return false;
  return history.workflows.every(w => w && typeof w.path === 'string' && typeof w.complete === 'boolean' && nonnegative(w.observedWeightedMinutes) && (w.weightedMinutes === null || nonnegative(w.weightedMinutes)) && Array.isArray(w.runs) && w.runs.every(r => r && Number.isSafeInteger(r.id) && r.id > 0 && Number.isSafeInteger(r.attempt) && r.attempt > 0 && typeof r.complete === 'boolean' && typeof r.runComplete === 'boolean' && typeof r.event === 'string' && nonnegative(r.weightedMinutes)));
}

/** Only daily/weekly schedules shipped today; unfamiliar cron stays unknown. */
function scheduledMonthly(text) {
  const crons = [...text.matchAll(/cron:\s*["']([^"']+)["']/g)].map(m => m[1]);
  let count = 0;
  for (const cron of crons) {
    const [minute, hour, day, month, week, extra] = cron.trim().split(/\s+/);
    if (extra || !/^\d+$/.test(minute) || Number(minute) > 59 || !/^\d+$/.test(hour) || Number(hour) > 23 || day !== '*' || month !== '*' || !/^(\*|[0-6])$/.test(week)) return null;
    count += week === '*' ? 30 : 30 / 7;
  }
  return crons.length ? count : null;
}

export async function adoptionCost({ root, config, workflows, env = process.env, now = Date.now() }) {
  const repo = config.ci?.historyRepo ?? 'dalmaer/keel', options = ciOptions(config);
  let cache = null;
  try { cache = JSON.parse(await readFile(join(root, '.keel/ci-history.json'), 'utf8')); } catch { /* optional; unavailable is explicit */ }
  const rows = [];
  for (const flow of workflows) {
    let history = cache?.version === 1 && cache.repo === repo ? cache.workflows?.[flow.path] : null;
    let source = 'local .keel/ci-history.json';
    if (!validCiHistory(history, { repo, options, now })) history = null;
    if (!history && env.KEEL_CI_OFFLINE !== '1') {
      source = 'GitHub Actions API';
      const workflow = flow.path.split('/').at(-1);
      const key = JSON.stringify([repo, workflow, options, env.KEEL_GH, Math.floor(now / DAY)]);
      if (!historyReads.has(key)) historyReads.set(key, readCiUsage({ repo, workflow, config, env, now, days: 28 }).catch(() => null));
      history = await historyReads.get(key);
    }
    const sample = history?.workflows?.find(w => w.path === flow.path);
    const row = { path: flow.path, triggers: flow.triggers, source: { kind: history ? source : 'unavailable', repo, window: history?.window ?? null }, monthlyWeightedMinutes: null, assumptions: [], coverage: history?.coverage ?? { complete: false, gaps: ['no history; offline or API unavailable'] } };
    if (history?.coverage?.complete && sample?.complete && sample.runs?.length && history.window?.days > 0) {
      // All attempts of one logical run contribute to its cost, counted once.
      const runs = new Map();
      const excluded = new Set(sample.runs.filter(r => r.runComplete !== true || !r.complete).map(r => r.id));
      row.excludedLogicalRuns = excluded.size;
      if (excluded.size) row.assumptions.push(`${excluded.size} incomplete logical runs excluded with all their attempts`);
      for (const run of sample.runs) {
        if (excluded.has(run.id) || !Number.isFinite(run.weightedMinutes)) continue;
        const existing = runs.get(run.id) ?? { event: run.event, minutes: 0 };
        existing.minutes += run.weightedMinutes; runs.set(run.id, existing);
      }
      const relevant = [...runs.values()].filter(r => flow.triggers.includes(r.event));
      const schedule = flow.triggers.includes('schedule') ? scheduledMonthly(flow.text) : 0;
      const scheduled = relevant.filter(r => r.event === 'schedule');
      const events = relevant.filter(r => r.event !== 'schedule');
      const hasEvents = flow.triggers.some(event => event !== 'schedule');
      const exposure = history.window.workflowPath === flow.path && history.window.workflowCreatedAt !== null ? history.window.observedDays : null;
      if (relevant.length && schedule !== null && (!schedule || scheduled.length) && (!hasEvents || (Number.isFinite(exposure) && exposure > 0))) {
        const eventCost = hasEvents ? events.reduce((sum, r) => sum + r.minutes, 0) * 30 / exposure : 0;
        const scheduleCost = schedule ? scheduled.reduce((sum, r) => sum + r.minutes, 0) / scheduled.length * schedule : 0;
        row.monthlyWeightedMinutes = Math.round((eventCost + scheduleCost) * 100) / 100;
        row.assumptions.push('reuses source per-run runtime; target setup, gate and runtime may differ; not a benchmark of the new project');
        if (schedule) row.assumptions.push(`${schedule.toFixed(2)} scheduled runs per 30 days at observed scheduled-run mean (including attempts)`);
        if (hasEvents) row.assumptions.push(`event-driven usage follows source's observed ${exposure}-day workflow exposure from ${history.window.observedSince} (requested ${history.window.days} days), scaled to 30 days; target event volume may differ`);
      }
    }
    if (row.monthlyWeightedMinutes === null) row.assumptions.push('insufficient complete matching history or unsupported cadence; estimate unavailable');
    rows.push(row);
  }
  return { workflows: rows, monthlyWeightedMinutes: rows.every(r => r.monthlyWeightedMinutes !== null) ? rows.reduce((n, r) => n + r.monthlyWeightedMinutes, 0) : null, weights: options.weights, weightsDate: options.weightsDate, invoice: false };
}
export function adoptionCostLines(cost) {
  return ['', 'Added workflows — monthly weighted-minute estimates (not invoices):',
    ...cost.workflows.map(w => `  ${w.path}: ${w.triggers.join(', ') || 'unknown trigger'}; ${w.monthlyWeightedMinutes ?? 'unknown'} weighted minutes/month; ${w.source.kind} ${w.source.repo}, ${w.source.window ? `${w.source.window.since} to ${w.source.window.until}` : 'window unavailable'}; ${w.assumptions.join('; ')}`),
    `  Total: ${cost.monthlyWeightedMinutes ?? 'unknown'} weighted minutes/month; weights ${JSON.stringify(cost.weights)} dated ${cost.weightsDate}.`];
}

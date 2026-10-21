// Read-only projections of canonical night semantics. No filesystem entry points run.
import { validatePlan, healthRows, STATUSES } from '../../practices/night/files/scripts/keel/night-plan.mjs';
import { furthestItems, readiness } from '../../practices/night/files/scripts/keel/morning.mjs';
import { robotPolicy } from '../../practices/climb/files/scripts/keel/robot-policy.mjs';
import { hash, record, WebError } from './common.mjs';
import { sourcePath } from './decision-github.mjs';

export const DAILY_LIMITS = Object.freeze({ requests: 200, files: 180, bytes: 5 * 1024 * 1024, fileBytes: 256 * 1024, dates: 30 });
export const dailyCapabilities = Object.freeze({ publish: false, execute: false, runner: 'unavailable', reason: 'Runner availability and current execution are not verified by source records. Publication and execution remain in the explicit CLI workflow.', cli: 'keel goodnight' });
export const dailyDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const sourceUrl = (project, revision, path) => `https://github.com/${project.repo}/blob/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
export function resultUrl(project, revision, value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return sourcePath(value) ? sourceUrl(project, revision, value) : null; }
}
export function planRecord(text, coordinates, date) {
  const source = { ...coordinates, state: 'invalid', reason: null, plan: null };
  try {
    if (Buffer.byteLength(text) > DAILY_LIMITS.fileBytes) throw Error();
    const plan = JSON.parse(text), validation = validatePlan(plan);
    if (!validation.ok) { source.reason = 'Record does not satisfy the canonical night-plan schema.'; return source; }
    if (plan.date !== date) return { ...source, state: 'other-date', reason: `Record is dated ${plan.date}.` };
    return { ...source, state: 'read', plan };
  } catch { return { ...source, reason: 'Record is not valid bounded UTF-8 JSON.' }; }
}
// Explicit source declarations only. Assembled climb's implicit defaults and
// full runner configuration are intentionally not inferred by this read-only UI.
function explicitClimb(config) {
  if (config.climb === undefined) return { state: 'disabled', value: null };
  const c = config.climb;
  if (!record(c) || !Array.isArray(c.jobs) || !c.jobs.length || c.jobs.length > 64
    || c.jobs.some(job => typeof job !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(job))
    || new Set(c.jobs).size !== c.jobs.length || !record(c.budget)
    || !Number.isInteger(c.budget.minutes) || c.budget.minutes < 5 || c.budget.minutes > 180) {
    return { state: 'unavailable', value: null };
  }
  return { state: 'declared', value: { jobs: c.jobs, minutes: c.budget.minutes } };
}
const totalMinutes = values => { const total = values.reduce((a, b) => a + b, 0); return Number.isFinite(total) ? total : null; };
export function dailyBudget(config, items = []) {
  const declared = explicitClimb(config), climb = declared.value, climbInvalid = declared.state === 'unavailable';
  const robot = robotPolicy(config), ids = new Set(['climb', 'robot', ...items.map(i => i.lane.split(':')[0])]);
  const lanes = [...ids].map(id => {
    const selected = items.filter(i => i.lane.split(':')[0] === id);
    const minutes = selected.filter(i => i.budget?.minutes !== undefined).map(i => i.budget.minutes);
    const enabled = id === 'climb' ? climbInvalid ? null : !!climb : id === 'robot' ? robot.valid ? robot.enabled : null : null;
    return {
      id, enabled,
      targets: id === 'climb' ? (climb?.jobs ?? []).map(job => `climb:${job}`)
        : id === 'robot' ? robot.valid && robot.enabled ? [...new Set([...selected.map(i => i.lane), 'robot:pending'])] : []
          : [...new Set(selected.map(i => i.lane))],
      configuredMinutes: id === 'climb' ? climb?.minutes ?? null : id === 'robot' ? robot.weeklyMinutes ?? null : null,
      period: id === 'climb' ? 'run' : id === 'robot' ? 'week' : 'unknown',
      allocatedMinutes: minutes.length ? totalMinutes(minutes) : selected.length ? null : 0,
      unallocatedItems: selected.length - minutes.length, actualMinutes: null, actualCost: null,
      reason: enabled === false ? 'Lane is disabled in current project configuration.' : enabled === null ? 'Lane allowance is unavailable or configuration is invalid.' : 'Explicit source allowance only; full runner configuration, usage, remaining allowance and runner availability are unverified.',
    };
  });
  return { lanes, actualMinutes: null, actualCost: null };
}
export function draftProblems(config, plan) {
  const validation = validatePlan(plan, { draft: true });
  if (!validation.ok) return validation.problems.slice(0, 100);
  const problems = [], budget = dailyBudget(config, plan.items);
  const climb = explicitClimb(config).value;
  for (const item of plan.items.filter(i => i.kind === 'build')) {
    const lane = budget.lanes.find(l => l.id === item.lane.split(':')[0]);
    if (lane?.enabled !== true) problems.push(`${item.id}: the configured build lane is disabled or unavailable.`);
    if (item.lane.startsWith('climb:') && !climb?.jobs.includes(item.lane.slice(6))) problems.push(`${item.id}: climb job is not enabled in current configuration.`);
    if (item.budget?.minutes > (lane?.configuredMinutes ?? 0)) problems.push(`${item.id}: planned minutes exceed the configured lane ceiling.`);
  }
  const robot = budget.lanes.find(l => l.id === 'robot');
  if (robot.allocatedMinutes > (robot.configuredMinutes ?? 0)) problems.push('Robot allocations exceed the configured weekly ceiling; current usage remains unknown.');
  return problems;
}
export function dailyModel({ project, date, source, config, sources, dates, measurements = { before: null, after: null }, gaps = [], now = Date.now() }) {
  const read = sources.filter(s => s.state === 'read');
  const base = read.find(s => s.path === `docs/night/${date}.json`) ?? read[0];
  const selected = base ? furthestItems(base.plan.items, read.map(s => s.plan)) : [];
  const plan = base ? { ...base.plan, items: selected } : null;
  const items = selected.map(item => {
    const origin = read.find(s => s.plan.items.includes(item));
    const { plan: ignored, ...coordinates } = origin;
    return { ...item, source: coordinates, resultUrl: resultUrl(project, origin.revision, item.result?.link) };
  });
  const budget = dailyBudget(config, selected);
  if (!plan) {
    for (const lane of budget.lanes) {
      lane.allocatedMinutes = null;
      lane.unallocatedItems = null;
    }
  }
  return {
    schema: 1, project, date, source,
    sourceDigest: hash(JSON.stringify([source, config, sources, measurements])), dates,
    plan, from: base?.from ?? null, readiness: plan ? readiness(plan, new Date(now)) : null,
    items, sources, budget, measurements,
    capabilities: dailyCapabilities,
    gaps: [...gaps, ...sources.filter(s => s.state !== 'read').map(s => ({ source: s.from, reason: s.reason ?? 'Record is absent.' })),
      { source: 'execution', reason: 'Source ticks and result links are authored observations, not current runner or receipt verification. Unresolved receipts remain unresolved; actual usage is unknown.' }],
  };
}
export function measurement(text, project, revision, path) {
  return { date: path.split('/').at(-1).slice(0, 10), path, revision, url: sourceUrl(project, revision, path), rows: healthRows(text).slice(0, 100) };
}
export async function homeDaily({ project, revision, paths, read, now = Date.now() }) {
  const coverage = 'Latest default-branch record only. Plan, nightly and final branches, live runs, receipts and actual usage require separate inspection.';
  const candidates = paths.filter(p => /^docs\/night\/\d{4}-\d{2}-\d{2}\.json$/.test(p) && dailyDate(p.slice(11, 21))).sort().reverse();
  const path = candidates[0], date = path?.slice(11, 21) ?? null;
  const out = { url: `/projects/${project.id}/daily`, date, state: 'absent', from: path ?? null, revision, readiness: null, counts: Object.fromEntries(STATUSES.map(s => [s, 0])), allocatedMinutes: null, actualMinutes: null, coverage };
  if (!path) return out;
  try {
    const parsed = planRecord(await read(path), {}, date);
    out.state = parsed.state === 'other-date' ? 'invalid' : parsed.state;
    if (parsed.plan) {
      out.readiness = readiness(parsed.plan, new Date(now));
      for (const item of parsed.plan.items) out.counts[item.status]++;
      const allocated = parsed.plan.items.filter(i => i.budget?.minutes !== undefined);
      out.allocatedMinutes = allocated.length === parsed.plan.items.length ? totalMinutes(allocated.map(item => item.budget.minutes)) : null;
    }
  } catch (error) {
    if ([401, 404].includes(error.status)) throw error;
    out.state = 'unavailable';
  }
  return out;
}
export function validateDraftInput(input) {
  if (!record(input) || Object.keys(input).some(k => !['date', 'sourceDigest', 'plan'].includes(k)) || !dailyDate(input.date) || typeof input.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceDigest) || !record(input.plan) || Buffer.byteLength(JSON.stringify(input.plan)) > DAILY_LIMITS.fileBytes) throw new WebError('invalid_daily_draft', 400);
}

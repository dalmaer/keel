// Read-only evidence assessment for the owner-controlled disable/drain/install barrier.
// No API writes or workflow dispatch. The collector supplies complete repository-wide
// run pages for every exact affected workflow, without filtering by head branch.
import { NAMES } from './names.mjs';

export function concurrencyPreflight({ repo, workflows, coverage, barrier, runs } = {}) {
  const gaps = [], blocked = [];
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) gaps.push('repository identity unavailable');
  if (!Array.isArray(workflows) || !workflows.length || new Set(workflows).size !== workflows.length || workflows.some(p => typeof p !== 'string' || !/^\.github\/workflows\/[^/]+\.ya?ml$/.test(p))) gaps.push('exact affected workflows unavailable');
  const paths = Array.isArray(workflows) ? workflows : [];
  if (coverage?.repo !== repo || coverage?.complete !== true || coverage?.allBranches !== true || !Array.isArray(coverage?.workflows) || paths.some(p => !coverage.workflows.includes(p))) gaps.push('run coverage incomplete');
  if (barrier?.repo !== repo || barrier?.ownerApproved !== true || barrier?.heldThroughInstallation !== true || !Array.isArray(barrier?.disabledWorkflows) || paths.some(p => !barrier.disabledWorkflows.includes(p))) gaps.push('owner-approved disable/install barrier unavailable');
  if (!Array.isArray(runs)) gaps.push('run inventory unavailable');
  const groups = NAMES.filter(row => row.surface === 'concurrency group' && row.phase === 125);
  const completed = new Set(['success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale']);
  for (const run of Array.isArray(runs) ? runs : []) {
    if (run?.repo !== repo || !Number.isSafeInteger(run?.id) || run.id <= 0 || typeof run?.path !== 'string') { gaps.push('run identity unavailable'); continue; }
    const affected = paths.includes(run.path) || groups.some(({keel: legacy}) => typeof run.group === 'string' && (legacy.endsWith('-') ? run.group.startsWith(legacy) : run.group === legacy));
    if (!affected) continue;
    // Conservatively block every active run of an affected workflow, including
    // unknown group attribution and either head prefix. A cancellation request
    // is not a completed cancellation.
    if (run.status !== 'completed' || !completed.has(run.conclusion)) blocked.push({ id: run.id, path: run.path, headBranch: run.headBranch ?? null, status: run.status ?? 'unknown', conclusion: run.conclusion ?? null });
  }
  return { ok: !gaps.length && !blocked.length, repo: repo ?? null, workflows: paths, gaps: [...new Set(gaps)], blocked };
}

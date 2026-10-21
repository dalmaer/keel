import { createDecisionGitHub } from './decision-github.mjs';
import { requestJson, numeric, record, WebError } from './common.mjs';
import { readRoutineDefinitions, mergeWorkflowInventory } from './routines.mjs';
import { RUN_LIMITS, runFilters, pageNumber, issue, attemptModel, deduplicate, matchesWindow, coverage, jobModel, usageEstimate, artifactModel } from './run-model.mjs';

const denied = error => [401, 403, 404].includes(error.status) && error.code !== 'run_not_found';
// One shared transport budget covers repository blobs, Actions and private RPCs.
// Buffering here bounds all response bytes before an adapter parses them.
export function createRunBudget(fetcher = fetch, { now = Date.now } = {}) {
  const start = now(), signal = AbortSignal.timeout(RUN_LIMITS.milliseconds);
  const budget = { signal, requests: 0, bytes: 0, exhausted: null };
  budget.fetcher = async (url, options = {}) => {
    if (budget.exhausted || budget.requests >= RUN_LIMITS.requests || signal.aborted || now() - start >= RUN_LIMITS.milliseconds) {
      budget.exhausted ??= 'run_limit'; throw new WebError(budget.exhausted);
    }
    budget.requests++;
    const response = await fetcher(url, { ...options, signal: AbortSignal.any([signal, ...(options.signal ? [options.signal] : [])]) });
    const github = new URL(url).hostname === 'api.github.com';
    const limited = github && (response.status === 429 || response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
    if (limited) { budget.exhausted = 'run_quota'; await response.body?.cancel(); throw new WebError('run_quota'); }
    if (github && [401, 403].includes(response.status)) { await response.body?.cancel(); throw new WebError('access_denied', 404); }
    const reader = response.body?.getReader(), chunks = [];
    if (!reader) return response;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        budget.bytes += value.length;
        if (budget.bytes > RUN_LIMITS.bytes || signal.aborted || now() - start >= RUN_LIMITS.milliseconds) { budget.exhausted = 'run_limit'; throw new WebError('run_limit'); }
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = Buffer.concat(chunks);
    if (github && new URL(url).pathname === '/graphql' && response.ok) {
      let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { /* adapter reports invalid JSON */ }
      if (value?.errors?.some(e => ['FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED'].includes(e.type))) throw new WebError('access_denied', 404);
      if (value?.errors?.some(e => e.type === 'RATE_LIMITED')) { budget.exhausted = 'run_quota'; throw new WebError('run_quota'); }
    }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  return budget;
}
export function createRuns(config, { fetcher = fetch, now = Date.now } = {}) {
  function authorize(access, project) {
    if (!config.ownerIds.includes(access?.userId) || config.workspace.id !== access.workspace?.id
      || config.projectRepoIds[project?.id] !== project?.repoId
      || !access.projects?.some(p => p.id === project.id && p.repoId === project.repoId && p.repo === project.repo)) throw new WebError('access_denied', 404);
  }
  const hasActions = access => ['read', 'write'].includes(access.actionsPermission);
  async function source(access, token, project, { budget = createRunBudget(fetcher, { now }) } = {}) {
    authorize(access, project);
    try {
      const snapshot = await createDecisionGitHub(token, { fetcher: budget.fetcher }).snapshot(project);
      const gaps = []; let projectConfig = {};
      try { projectConfig = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await snapshot.reader.readFile(snapshot.entries.has('.plates/plates.json') ? '.plates/plates.json' : '.keel/keel.json'))); if (!record(projectConfig)) throw Error(); }
      catch (error) { if (denied(error)) throw error; gaps.push(issue('configuration', 'Project source configuration is absent, invalid or unavailable. Usage weighting is unavailable.')); projectConfig = { ci: null }; }
      const definitions = await readRoutineDefinitions(project, snapshot);
      return { snapshot, config: projectConfig, routines: definitions.routines, coverage: coverage(definitions.routines, [...gaps, ...definitions.gaps], null, now()) };
    } catch (error) {
      if (denied(error)) throw error;
      return { snapshot: null, config: { ci: null }, routines: [], coverage: coverage([], [issue('repository-source', 'Immutable source inventory is unavailable or exceeded its bounds.', budget.exhausted ?? error.code)], null, now()) };
    }
  }
  function api(token, project, budget) {
    // Numeric Actions aliases were verified against the provider on 2026-10-21.
    // They are not promised by the owner/name reference; refusal has no name fallback.
    const base = `/repositories/${project.repoId}`;
    const get = async (path, missing = false) => requestJson(async (url, options) => {
      const response = await budget.fetcher(url, options);
      if (response.status === 404) { await response.body?.cancel(); throw new WebError(missing ? 'run_not_found' : 'access_denied', 404); }
      return response;
    }, `https://api.github.com${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: budget.signal }, RUN_LIMITS.bytes);
    return { get, async attempt(runId, attempt) {
      try { return await get(`/actions/runs/${runId}/attempts/${attempt}`, true); }
      catch (error) {
        if (error.code !== 'run_not_found') throw error;
        // A named attempt can be retained no longer, or the token can have lost
        // Actions access. A current successful Actions page distinguishes them.
        const current = await get('/actions/runs?per_page=1&page=1');
        if (!record(current) || !Array.isArray(current.workflow_runs) || !Number.isSafeInteger(current.total_count) || current.total_count < 0 || current.workflow_runs.length > 1) throw new WebError('access_denied', 404);
        throw error;
      }
    } };
  }
  async function overview(access, token, project, options = {}, shared = {}) {
    authorize(access, project);
    const filters = runFilters(options), budget = shared.budget ?? createRunBudget(fetcher, { now });
    const context = shared.source ?? await source(access, token, project, { budget });
    if (context.snapshot && context.snapshot.source.repoId !== project.repoId) throw new WebError('access_denied', 404);
    const readAt = new Date(now()).toISOString(), gaps = [...context.coverage.gaps], pagination = { page: filters.page, perPage: 20, totalCount: null, nextPage: null, unreadAttempts: 0, unvisitedRuns: 0 };
    let routines = context.routines, items = [];
    gaps.push(issue('retention', 'This bounded provider page is not a complete or immutable history. Deleted runs are unrecoverable; insertions can shift later pages.', 'retention'));
    if (!hasActions(access)) gaps.push(issue('actions', 'The current GitHub App installation has no observed Actions-read grant. Source definitions remain available; no fallback credential is used.', 'permission'));
    else {
      const client = api(token, project, budget);
      try {
        const data = await client.get('/actions/workflows?per_page=100&page=1');
        if (!Array.isArray(data.workflows) || data.workflows.length > 100 || !Number.isSafeInteger(data.total_count) || data.total_count < 0) throw new WebError('invalid_workflow_page');
        const merged = mergeWorkflowInventory(project, context.snapshot?.source, routines, data.workflows);
        routines = merged.routines; gaps.push(...merged.gaps);
        if (data.total_count > data.workflows.length) gaps.push(issue('workflows', 'Provider workflow inventory has unvisited or unavailable pages.', 'pagination'));
      } catch (error) { if (denied(error)) throw error; gaps.push(issue('workflows', 'Provider workflow inventory is unavailable.', budget.exhausted ?? error.code)); }
      let rows = [];
      try {
        const data = await client.get(`/actions/runs?per_page=20&page=${filters.page}`);
        if (!Array.isArray(data.workflow_runs) || data.workflow_runs.length > 20 || !Number.isSafeInteger(data.total_count) || data.total_count < 0) throw new WebError('invalid_run_page');
        rows = data.workflow_runs;
        pagination.totalCount = data.total_count;
        pagination.nextPage = filters.page * 20 < data.total_count ? filters.page + 1 : null;
        pagination.unvisitedRuns = Math.max(0, data.total_count - rows.length);
        const expected = Math.min(20, Math.max(0, data.total_count - (filters.page - 1) * 20));
        if (rows.length !== expected) gaps.push(issue('runs', 'Provider page size disagrees with its reported total; history may have shifted.', 'pagination-drift'));
        if (pagination.nextPage || filters.page > 1) gaps.push(issue('runs', 'Unvisited run pages may contain recent retries of old runs. Filters apply only to observed records.', 'pagination'));
      } catch (error) { if (denied(error)) throw error; gaps.push(issue('runs', 'Run history is unavailable; this is not an empty successful history.', budget.exhausted ?? error.code)); }
      const logical = [], logicalGaps = [];
      for (const row of rows) {
        try { logical.push(attemptModel(project, row)); }
        catch { logicalGaps.push(issue('runs', 'A logical run has invalid or mismatched repository/run/attempt coordinates.')); }
      }
      const unique = deduplicate(logical);
      gaps.push(...logicalGaps, ...unique.gaps);
      for (const latest of unique.items) {
        const newest = latest.identity.attempt, oldest = Math.max(1, newest - RUN_LIMITS.attempts + 1);
        if (oldest > 1) { pagination.unreadAttempts += oldest - 1; gaps.push(issue(`run:${latest.identity.runId}`, `${oldest - 1} older attempts were not read; each is reachable by its explicit attempt detail.`, 'attempt-limit')); }
        items.push(latest);
        for (let attempt = newest - 1; attempt >= oldest; attempt--) {
          if (budget.exhausted || budget.requests >= RUN_LIMITS.requests) {
            pagination.unreadAttempts += attempt - oldest + 1;
            gaps.push(issue(`run:${latest.identity.runId}`, 'Remaining attempts exceeded the shared request budget.', 'run_limit')); break;
          }
          try { items.push(attemptModel(project, await client.attempt(latest.identity.runId, attempt), { runId: latest.identity.runId, attempt })); }
          catch (error) {
            if (denied(error)) throw error;
            pagination.unreadAttempts++; gaps.push(issue(`run:${latest.identity.runId}:attempt:${attempt}`, error.code === 'run_not_found' ? 'Named attempt is no longer retained; current Actions access was verified.' : 'Attempt could not be observed within the source bounds.', budget.exhausted ?? error.code));
          }
        }
      }
      const deduped = deduplicate(items); gaps.push(...deduped.gaps); items = deduped.items;
      if (items.some(item => !item.startedAt && !item.updatedAt)) gaps.push(issue('window', 'An attempt has no usable observation timestamp; it remains visible with unknown window membership.'));
      if (items.some(item => !item.routineId)) gaps.push(issue('workflows', 'An attempt lacks a supported workflow source path; its routine is unknown.'));
      items = items.filter(item => matchesWindow(item, filters, now()));
    }
    return { schema: 1, project, readAt, routines, items, coverage: coverage(items, gaps, filters, now()), filters, pagination };
  }
  async function detail(access, token, project, runId, attempt, options = {}, shared = {}) {
    authorize(access, project);
    const id = value => typeof value === 'number' && numeric(value) ? value : typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) && numeric(Number(value)) ? Number(value) : null;
    runId = id(runId); attempt = id(attempt);
    if (!numeric(runId) || !numeric(attempt) || !record(options) || Object.keys(options).some(k => !['jobsPage', 'artifactsPage'].includes(k))) throw new WebError('invalid_run_detail', 400);
    const jobsPage = pageNumber(options.jobsPage), artifactsPage = pageNumber(options.artifactsPage), budget = shared.budget ?? createRunBudget(fetcher, { now });
    if (!hasActions(access)) throw new WebError('actions_permission_unavailable', 403);
    const context = shared.source ?? await source(access, token, project, { budget }), client = api(token, project, budget), gaps = [...context.coverage.gaps];
    if (context.snapshot && context.snapshot.source.repoId !== project.repoId) throw new WebError('access_denied', 404);
    const item = attemptModel(project, await client.attempt(runId, attempt), { runId, attempt });
    async function pages(kind, start, path, normalize) {
      const collected = []; let totalCount = null, nextPage = null, complete = start === 1;
      if (start > 1) gaps.push(issue(kind, 'Earlier pages were not read in this request.', 'pagination'));
      for (let page = start; page < start + RUN_LIMITS.detailPages; page++) {
        try {
          const data = await client.get(`${path}?per_page=100&page=${page}`);
          if (!Array.isArray(data[kind]) || data[kind].length > 100 || !Number.isSafeInteger(data.total_count) || data.total_count < 0) throw new WebError('invalid_detail_page');
          if (totalCount !== null && totalCount !== data.total_count) { complete = false; gaps.push(issue(kind, 'Provider total changed between pages; pagination is not a snapshot.', 'pagination-drift')); }
          totalCount = data.total_count;
          const expected = Math.min(100, Math.max(0, totalCount - (page - 1) * 100));
          if (data[kind].length !== expected) { complete = false; gaps.push(issue(kind, 'Provider page size disagrees with its total.', 'pagination-drift')); }
          for (const raw of data[kind]) {
            try { collected.push(normalize(raw)); }
            catch { complete = false; gaps.push(issue(kind, 'A record has mismatched or invalid identity and was not attributed to this attempt.')); }
          }
          nextPage = page * 100 < totalCount ? page + 1 : null;
          if (!nextPage) break;
        } catch (error) {
          if (denied(error)) throw error;
          complete = false; nextPage = page;
          gaps.push(issue(kind, 'Detail source is unavailable or exceeds its shared bound.', budget.exhausted ?? error.code)); break;
        }
      }
      const unique = deduplicate(collected, kind); gaps.push(...unique.gaps);
      if (unique.gaps.length || unique.items.length !== collected.length) { complete = false; gaps.push(issue(kind, 'Repeated identities show overlapping or conflicting pages; total coverage is unverified.', 'pagination-drift')); }
      if (nextPage) { complete = false; gaps.push(issue(kind, 'More detail pages remain; follow the explicit continuation.', 'pagination')); }
      return { items: unique.items, complete, pagination: { page: start, nextPage, totalCount } };
    }
    const jobs = await pages('jobs', jobsPage, `/actions/runs/${runId}/attempts/${attempt}/jobs`, raw => jobModel(project, item, raw, now()));
    gaps.push(...jobs.items.flatMap(job => job.gaps));
    if (!jobs.items.length) gaps.push(issue('jobs', 'No attempt-scoped jobs were observed; this does not establish zero execution or cost.', 'absent'));
    const artifacts = await pages('artifacts', artifactsPage, `/actions/runs/${runId}/artifacts`, raw => artifactModel(project, item, raw));
    if (!artifacts.items.length) gaps.push(issue('artifacts', 'No retained artifact metadata was observed on these pages; deleted evidence cannot be recovered.', 'absent'));
    gaps.push(issue('artifacts', 'Artifact metadata belongs to the logical run. No attempt is assigned without explicit provenance; archives and raw logs were not fetched.', 'run-scope'));
    if (artifacts.items.some(a => a.expired)) gaps.push(issue('artifacts', 'Expired artifacts remain listed; their bytes cannot be recovered here.', 'expired'));
    item.cost = usageEstimate(jobs.items, context.snapshot?.source.visibility ?? 'unknown', context.config, jobs.complete && item.provider.status === 'completed', now());
    if (item.cost.weightedMinutes === null) gaps.push(issue('cost', 'Complete attempt usage is unavailable; any known subtotal is labeled separately. Actual charges remain unknown.', 'unknown-cost'));
    if (jobs.complete && jobs.items.length && jobs.items.every(job => job.completedAt && job.durationMs !== null)) item.completedAt = jobs.items.map(job => job.completedAt).sort().at(-1);
    return { schema: 1, project, readAt: new Date(now()).toISOString(), item, stages: jobs.items, evidence: artifacts.items,
      coverage: coverage([item], gaps, null, now()), pagination: { jobs: jobs.pagination, artifacts: artifacts.pagination } };
  }
  return { source, overview, detail };
}

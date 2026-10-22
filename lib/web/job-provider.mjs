import { boundedJson, numeric, requestJson, WebError } from "./common.mjs";
const states = [
  "queued",
  "requested",
  "waiting",
  "pending",
  "in_progress",
  "completed",
];
const conclusions = [
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
];
const iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
export function createJobProvider(
  token,
  { fetcher = fetch, now = Date.now } = {},
) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  async function get(project, path) {
    return requestJson(
      async (url, opts) => {
        const r = await fetcher(url, opts);
        if ([403, 429].includes(r.status)) {
          void r.body?.cancel();
          throw new WebError("job_provider_unavailable");
        }
        if ([401, 404].includes(r.status)) {
          void r.body?.cancel();
          throw new WebError("access_denied", 404);
        }
        return r;
      },
      `https://api.github.com/repositories/${project.repoId}${path}`,
      { headers },
      1048576,
    );
  }
  function normalize(raw, intent) {
    const r = intent.registry,
      p = intent.project;
    if (
      !numeric(raw?.id) ||
      raw.repository?.id !== p.repoId ||
      raw.head_repository?.id !== p.repoId ||
      raw.workflow_id !== r.workflow.id ||
      raw.run_attempt !== 1 ||
      raw.actor?.id !== intent.actorId ||
      raw.event !== "workflow_dispatch" ||
      raw.head_sha !== intent.source.head ||
      raw.head_branch !== r.workflow.branch ||
      raw.display_title !== `keel-web-${intent.id}` ||
      !states.includes(raw.status) ||
      (raw.status === "completed"
        ? !conclusions.includes(raw.conclusion)
        : raw.conclusion !== null) ||
      !iso(raw.created_at) ||
      !iso(raw.updated_at)
    )
      throw new WebError("job_provider_identity", 409);
    return {
      runId: raw.id,
      attempt: 1,
      state: raw.status,
      conclusion: raw.conclusion,
      url: `https://github.com/${p.repo}/actions/runs/${raw.id}`,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      observedAt: new Date(now()).toISOString(),
    };
  }
  async function run(intent, id) {
    const value = normalize(
      await get(intent.project, `/actions/runs/${id}/attempts/1`),
      intent,
    );
    if (value.runId !== id) throw new WebError("job_provider_identity", 409);
    return value;
  }
  async function discover(intent) {
    const candidates = [];
    let total = null;
    for (let page = 1; page <= 3; page++) {
      const body = await get(
        intent.project,
        `/actions/workflows/${intent.registry.workflow.id}/runs?event=workflow_dispatch&per_page=100&page=${page}`,
      );
      if (
        (!numeric(body.total_count) && body.total_count !== 0) ||
        !Array.isArray(body.workflow_runs) ||
        body.workflow_runs.length > 100 ||
        (total !== null && total !== body.total_count)
      )
        throw new WebError("job_scan_unavailable");
      total = body.total_count;
      for (const row of body.workflow_runs)
        if (row.display_title === `keel-web-${intent.id}`)
          candidates.push(normalize(row, intent));
      if (page * 100 >= total) {
        if (candidates.length > 1) throw new WebError("job_run_conflict", 409);
        return candidates.length === 1
          ? await run(intent, candidates[0].runId)
          : null;
      }
    }
    throw new WebError("job_scan_incomplete");
  }
  async function workerJob(intent, identity) {
    const observed = await run(intent, identity.runId);
    if (observed.state !== "in_progress")
      throw new WebError("worker_not_running", 409);
    const body = await get(
      intent.project,
      `/actions/runs/${identity.runId}/attempts/1/jobs?per_page=100&page=1`,
    );
    if (
      !Array.isArray(body.jobs) ||
      !Number.isSafeInteger(body.total_count) ||
      body.total_count !== body.jobs.length ||
      body.jobs.length > 100
    )
      throw new WebError("worker_jobs_incomplete");
    const matches = body.jobs.filter(
      (j) => j.name === intent.registry.workflow.job,
    );
    if (matches.length !== 1) throw new WebError("worker_job_conflict", 409);
    const job = matches[0];
    if (
      !numeric(job.id) ||
      job.run_id !== identity.runId ||
      job.run_attempt !== 1 ||
      job.head_sha !== intent.source.head ||
      job.status !== "in_progress" ||
      !iso(job.started_at) ||
      Date.parse(job.started_at) > now()
    )
      throw new WebError("worker_job_identity", 409);
    if (
      identity.checkRunId !== null &&
      identity.checkRunId !== undefined &&
      job.check_run_url !==
        `https://api.github.com/repos/${intent.project.repo}/check-runs/${identity.checkRunId}`
    )
      throw new WebError("worker_job_identity", 409);
    return {
      observed,
      jobId: job.id,
      deadline: Date.parse(job.started_at) + 900000,
    };
  }
  async function dispatch(intent) {
    const response = await fetcher(
      `https://api.github.com/repositories/${intent.project.repoId}/actions/workflows/${intent.registry.workflow.id}/dispatches`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: intent.registry.workflow.branch,
          inputs: { keel_operation: intent.id },
          return_run_details: true,
        }),
      },
    );
    if (!response.ok) {
      void response.body?.cancel();
      throw new WebError("job_dispatch_uncertain");
    }
    if (response.status === 204) {
      void response.body?.cancel();
      return null;
    }
    const body = await boundedJson(response, 65536);
    // Returned identity is a hint until independent numeric run readback succeeds.
    const id = body.workflow_run_id ?? body.id;
    if (!numeric(id)) throw new WebError("job_dispatch_uncertain");
    return id;
  }
  async function cancel(intent, runId) {
    const response = await fetcher(
      `https://api.github.com/repositories/${intent.project.repoId}/actions/runs/${runId}/cancel`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers,
      },
    );
    void response.body?.cancel();
    if (response.status !== 202) throw new WebError("job_cancel_uncertain");
  }
  return { run, discover, dispatch, cancel, workerJob };
}

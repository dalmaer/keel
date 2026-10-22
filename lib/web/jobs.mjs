import { createJobRegistry, jobId, jobsEnabled } from "./job-registry.mjs";
import { createJobStore } from "./job-store.mjs";
import { createJobProvider } from "./job-provider.mjs";
import { createJobSchedules, inspectSchedule } from "./job-schedules.mjs";
import { exact, hash, numeric, random, WebError } from "./common.mjs";
const terminal = (row) => ["terminal", "refused"].includes(row.state);
export function createJobs(
  config,
  { fetcher = fetch, now = Date.now, resolveInitiator } = {},
) {
  const registry = createJobRegistry(config, { fetcher, now }),
    store = createJobStore(config, fetcher),
    schedules = createJobSchedules(config, { fetcher, now, registry });
  const provider = (token) => createJobProvider(token, { fetcher, now });
  function checkRow(access, project, result) {
    registry.authorize(access, project);
    if (
      !result?.row ||
      result.row.project !== store.projectFor(project) ||
      result.row.value.kind !== "job"
    )
      throw new WebError("operation_not_found", 404);
    return result.row;
  }
  function receipt(row, access, retryAllowed = false) {
    const p = row.value,
      expired =
        row.lease_until !== null &&
        Date.parse(row.lease_until) <= now() &&
        !terminal(row) &&
        ["claimed", "running"].includes(row.state);
    const active =
      jobsEnabled(config, now()) && access.actionsPermission === "write";
    return {
      schema: 1,
      id: row.id,
      projectId: p.project.id,
      routineId: p.routineId,
      actorId: row.actor,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      retryOf: p.retryOf,
      cancelRequested: row.cancel_requested,
      worker: {
        state: expired
          ? "lost"
          : (row.worker_result?.state ??
            (["claimed", "running", "worker-complete"].includes(row.state)
              ? row.state
              : row.nonce !== null && row.job_id !== null
                ? "result-unavailable"
                : "unclaimed")),
        deadline: row.deadline,
        leaseUntil: row.lease_until,
        result: row.worker_result,
      },
      provider: row.provider,
      budget: {
        reservedMinutes: row.minutes,
        observedMinutes: null,
        cost: null,
      },
      reason: expired
        ? "Worker lease expired; provider termination remains unconfirmed."
        : row.state === "uncertain"
          ? "Dispatch delivery is uncertain; recover this same operation."
          : row.cancel_requested && !terminal(row)
            ? "Cancellation requested; provider termination remains unconfirmed."
            : null,
      operationUrl: `/projects/${p.project.id}/jobs/${row.id}`,
      capabilities: {
        cancel: active && !terminal(row),
        retry: active && retryAllowed && row.state === "terminal",
        reconcile: access.actionsPermission === "write",
      },
    };
  }
  async function retryAllowed(access, token, project) {
    try {
      return registry.canStart(
        access,
        await registry.inspect(access, token, project),
      );
    } catch (error) {
      if ([401, 404].includes(error.status)) throw error;
      return false;
    }
  }
  async function ownerView(row, access, token) {
    return receipt(
      row,
      access,
      row.state === "terminal" &&
        (await retryAllowed(access, token, row.value.project)),
    );
  }
  async function fresh(access, project, reauthorize) {
    if (typeof reauthorize !== "function")
      throw new WebError("authorization_recheck_required", 403);
    const a = await reauthorize();
    if (a.userId !== access.userId) throw new WebError("access_denied", 404);
    registry.authorize(a, project);
    return a;
  }
  async function initiating(intent) {
    if (typeof resolveInitiator !== "function")
      throw new WebError("initiator_unavailable", 403);
    const result = await resolveInitiator(intent.sessionRef, intent.actorId);
    if (
      result?.access?.userId !== intent.actorId ||
      typeof result.token !== "string"
    )
      throw new WebError("initiator_unavailable", 403);
    registry.authorize(result.access, intent.project);
    const checked = await registry.inspect(
      result.access,
      result.token,
      intent.project,
    );
    if (
      !registry.canStart(result.access, checked) ||
      checked.registryDigest !== intent.registryDigest ||
      JSON.stringify(checked.source) !== JSON.stringify(intent.source)
    )
      throw new WebError("job_source_changed", 409);
    return { ...result, checked };
  }
  async function loaded(access, project, id) {
    if (!jobId(id)) throw new WebError("invalid_job_id", 400);
    return checkRow(access, project, await store.read(id));
  }
  async function routine(access, token, project, routineId) {
    registry.authorize(access, project);
    let checked,
      budget = null,
      schedule = null;
    const gaps = [];
    try {
      checked = await registry.inspect(access, token, project);
      if (checked.registry.workflow.path !== routineId)
        throw new WebError("routine_not_found", 404);
      try {
        budget = await store.budget(project);
      } catch {
        gaps.push({
          code: "job_budget_unavailable",
          reason: "Runtime reservations are unavailable; capacity is not zero.",
        });
      }
      if (checked.registry.adapter === "typecheck-schedule-v1")
        schedule = await inspectSchedule(checked);
    } catch (e) {
      if ([401, 404].includes(e.status)) throw e;
      gaps.push({
        code: e.code ?? "worker_unavailable",
        reason: "The approved worker source or registration is unavailable.",
      });
    }
    const active = !!checked && gaps.length === 0;
    if (!jobsEnabled(config, now()))
      gaps.push({
        code: "jobs_disabled",
        reason:
          "Job effects require explicit worker, database and restore verification.",
      });
    return {
      schema: 1,
      project,
      routineId,
      source: checked?.source ?? null,
      worker: checked
        ? {
            adapter: checked.registry.adapter,
            protocol: 1,
            workflowId: checked.registry.workflow.id,
            path: checked.registry.workflow.path,
            branch: checked.registry.workflow.branch,
            job: checked.registry.workflow.job,
            timeoutMinutes: checked.registry.timeoutMinutes,
            weeklyMinutes: checked.registry.weeklyMinutes,
            concurrency: 1,
          }
        : null,
      budget: {
        workspaceWeeklyMinutes: config.jobs?.weeklyMinutes ?? null,
        projectWeeklyMinutes: checked?.registry.weeklyMinutes ?? null,
        reservedMinutes: budget?.projectMinutes ?? null,
      },
      schedule,
      capabilities: {
        start: active && registry.canStart(access, checked),
        retry: active && registry.canStart(access, checked),
        schedule: active && !!schedule && schedules.allowed(access, checked),
      },
      gaps,
    };
  }
  async function overview(access, token, project, { after = null } = {}) {
    registry.authorize(access, project);
    if (after !== null && !jobId(after))
      throw new WebError("invalid_job_cursor", 400);
    const result = await store.list(project, after),
      canRetry =
        result.rows.some((r) => r.state === "terminal") &&
        (await retryAllowed(access, token, project)),
      items = result.rows.map((r) =>
        receipt(checkRow(access, project, { row: r }), access, canRetry),
      );
    return {
      schema: 1,
      project,
      items,
      after: result.after,
      hasMore: result.hasMore,
      gaps: [],
      capabilities: {
        start:
          jobsEnabled(config, now()) && access.actionsPermission === "write",
      },
    };
  }
  async function preview(access, token, project, input, { sessionRef } = {}) {
    if (
      !exact(input, ["routineId", "retryOf"]) ||
      (input.retryOf !== null && !jobId(input.retryOf)) ||
      !jobId(sessionRef)
    )
      throw new WebError("invalid_job_preview", 400);
    const checked = await registry.inspect(access, token, project);
    if (input.routineId !== checked.registry.workflow.path)
      throw new WebError("routine_not_found", 404);
    if (checked.registry.adapter !== "typecheck-v1")
      throw new WebError("worker_not_supported", 409);
    if (input.retryOf !== null) {
      const old = await loaded(access, project, input.retryOf);
      if (old.state !== "terminal" || old.provider?.state !== "completed")
        throw new WebError("retry_requires_terminal", 409);
    }
    const previewId = hash(random()),
      requestId = hash(random());
    const value = {
      schema: 1,
      kind: input.retryOf ? "retry" : "start",
      previewId,
      requestId,
      operationUrl: `/projects/${project.id}/jobs/${requestId}`,
      digest: null,
      expiresAt: new Date(now() + 900000).toISOString(),
      project,
      source: checked.source,
      registryDigest: checked.registryDigest,
      routineId: input.routineId,
      worker: {
        adapter: "typecheck-v1",
        protocol: 1,
        workflowId: checked.registry.workflow.id,
        path: checked.registry.workflow.path,
        branch: checked.registry.workflow.branch,
        job: "web-worker",
        timeoutMinutes: 15,
        weeklyMinutes: checked.registry.weeklyMinutes,
        concurrency: 1,
      },
      budget: {
        reservedMinutes: 15,
        workspaceWeeklyMinutes: config.jobs?.weeklyMinutes ?? null,
        projectWeeklyMinutes: checked.registry.weeklyMinutes,
      },
      effects: [
        "Dispatch the approved typecheck workflow once.",
        "Run npm ci --ignore-scripts and npm run typecheck after a fenced begin.",
      ],
      canApply: registry.canStart(access, checked),
      limitations: [
        "Metadata and process success do not establish project acceptance.",
        "Unknown delivery retains its full reservation.",
      ],
      retryOf: input.retryOf,
    };
    value.digest = hash(JSON.stringify(value));
    if (
      !(await store.createPreview(
        previewId,
        project,
        access.userId,
        value.digest,
        {
          public: value,
          sessionRef,
          registry: checked.registry,
          actorId: access.userId,
        },
      ))
    )
      throw new WebError("preview_unavailable");
    return value;
  }
  async function start(access, token, project, input, { reauthorize } = {}) {
    if (
      !exact(input, ["requestId", "previewId", "digest"]) ||
      !Object.values(input).every(jobId)
    )
      throw new WebError("invalid_job_submission", 400);
    registry.authorize(access, project);
    if (!jobsEnabled(config, now())) throw new WebError("jobs_disabled", 503);
    const existing = await store.read(input.requestId);
    if (existing) {
      const row = checkRow(access, project, existing);
      if (
        row.actor !== access.userId ||
        row.digest !== input.digest ||
        row.preview !== input.previewId
      )
        throw new WebError("job_identity_conflict", 409);
      return ownerView(row, await fresh(access, project, reauthorize), token);
    }
    const saved = await store.preview(input.previewId),
      p = saved?.value?.public;
    if (
      !p ||
      saved.actor !== access.userId ||
      saved.project !== store.projectFor(project) ||
      p.requestId !== input.requestId ||
      p.digest !== input.digest ||
      Date.parse(p.expiresAt) <= now()
    )
      throw new WebError("stale_preview", 409);
    const intent = {
      kind: "job",
      id: p.requestId,
      actorId: access.userId,
      digest: p.digest,
      project,
      routineId: p.routineId,
      retryOf: p.retryOf,
      source: p.source,
      registryDigest: p.registryDigest,
      registry: saved.value.registry,
      sessionRef: saved.value.sessionRef,
    };
    await fresh(access, project, reauthorize);
    const first = await initiating(intent);
    if (p.retryOf) {
      const old = await loaded(access, project, p.retryOf);
      if (old.state !== "terminal")
        throw new WebError("retry_requires_terminal", 409);
    }
    let result = await store.reserve(
      intent.id,
      project,
      access.userId,
      p.digest,
      p.previewId,
      intent,
      15,
      config.jobs.weeklyMinutes,
      first.checked.registry.weeklyMinutes,
    );
    if (result?.conflict)
      throw new WebError(`job_${result.conflict}_conflict`, 409);
    if (!result) throw new WebError("preview_expired", 410);
    let row = checkRow(access, project, result);
    if (!result.changed)
      return ownerView(row, await fresh(access, project, reauthorize), token);
    let current;
    try {
      await fresh(access, project, reauthorize);
      current = await initiating(intent);
    } catch (error) {
      await store.transition("refuse", row.id);
      throw error;
    }
    result = await store.transition("dispatch", row.id);
    if (result?.conflict || !result?.granted)
      throw new WebError("job_dispatch_not_granted", 409);
    row = result.row;
    const client = provider(current.token);
    try {
      const runId = await client.dispatch(intent);
      if (runId) {
        const pinned = await store.transition("pin", row.id, { runId });
        if (pinned.conflict) throw new WebError("job_run_conflict", 409);
        row = pinned.row;
        const observed = await client.run(intent, runId);
        result = await store.transition("observe", row.id, {
          provider: observed,
        });
        if (!result.conflict) row = result.row;
      } else {
        result = await store.transition("uncertain", row.id);
        if (!result.conflict) row = result.row;
      }
    } catch {
      try {
        result = await store.transition("uncertain", row.id);
        if (!result.conflict) row = result.row;
      } catch {
        /*Dispatched remains durable.*/
      }
    }
    return ownerView(row, await fresh(access, project, reauthorize), token);
  }
  async function operation(access, token, project, id) {
    try {
      return await ownerView(await loaded(access, project, id), access, token);
    } catch (e) {
      if (e.code !== "operation_not_found") throw e;
      return schedules.operation(access, token, project, id);
    }
  }
  async function reconcileRow(row, token) {
    const client = provider(token),
      observed = row.run_id
        ? await client.run(row.value, row.run_id)
        : await client.discover(row.value);
    if (observed) {
      const result = await store.transition("observe", row.id, {
        provider: observed,
      });
      if (result.conflict) throw new WebError("job_run_conflict", 409);
      return result.row;
    }
    return row;
  }
  async function reconcile(access, token, project, id, { reauthorize } = {}) {
    const a = await fresh(access, project, reauthorize);
    let row;
    try {
      row = await loaded(a, project, id);
    } catch (e) {
      if (e.code !== "operation_not_found") throw e;
      return schedules.recover(access, token, project, id, { reauthorize });
    }
    if (!["read", "write"].includes(a.actionsPermission))
      throw new WebError("actions_permission_unavailable", 403);
    if (!terminal(row) && row.state !== "prepared")
      row = await reconcileRow(row, token);
    return ownerView(row, await fresh(access, project, reauthorize), token);
  }
  async function cancel(access, token, project, id, { reauthorize } = {}) {
    const a = await fresh(access, project, reauthorize);
    if (!jobsEnabled(config, now()) || a.actionsPermission !== "write")
      throw new WebError("jobs_disabled", 503);
    let row = await loaded(a, project, id),
      result = await store.transition("cancel", id);
    if (result.conflict) throw new WebError("job_state_conflict", 409);
    row = result.row;
    if (!terminal(row)) {
      row = await reconcileRow(row, token);
      if (!terminal(row) && row.run_id !== null) {
        const finalAccess = await fresh(access, project, reauthorize);
        if (finalAccess.actionsPermission !== "write")
          throw new WebError("actions_permission_unavailable", 403);
        result = await store.transition("cancel-dispatch", id);
        if (result.granted) {
          try {
            await provider(token).cancel(row.value, row.run_id);
          } catch {
            /*Only same-run readback can settle cancellation.*/
          }
          row = result.row;
        }
      }
    }
    return ownerView(row, await fresh(access, project, reauthorize), token);
  }
  async function retryPreview(access, token, project, id, opts) {
    const row = await loaded(access, project, id);
    return preview(
      access,
      token,
      project,
      { routineId: row.value.routineId, retryOf: id },
      opts,
    );
  }
  function workerInput(identity, input, kind) {
    const fields = ["operationId", "nonce", "jobName"];
    if (kind !== "claim") fields.push("fence", "jobId");
    if (["heartbeat", "complete"].includes(kind)) fields.push("sequence");
    if (kind === "complete") fields.push("result");
    if (
      !exact(input, fields) ||
      !jobId(input.operationId) ||
      !jobId(input.nonce) ||
      input.jobName !== "web-worker" ||
      (kind !== "claim" && (!numeric(input.fence) || !numeric(input.jobId))) ||
      (["heartbeat", "complete"].includes(kind) &&
        (!Number.isInteger(input.sequence) ||
          input.sequence < 1 ||
          input.sequence > 999999999))
    )
      throw new WebError("invalid_worker_request", 400);
    if (
      kind === "complete" &&
      (!exact(input.result, ["state", "exitCode"]) ||
        !["succeeded", "failed", "cancelled"].includes(input.result.state) ||
        (input.result.exitCode !== null &&
          (!Number.isInteger(input.result.exitCode) ||
            input.result.exitCode < 0 ||
            input.result.exitCode > 255)))
    )
      throw new WebError("invalid_worker_result", 400);
    if (!numeric(identity?.runId) || identity.runAttempt !== 1)
      throw new WebError("worker_identity_denied", 403);
  }
  async function workerContext(identity, input, kind) {
    workerInput(identity, input, kind);
    const stored = await store.read(input.operationId),
      row = stored?.row;
    if (!row || row.value.kind !== "job")
      throw new WebError("worker_identity_denied", 403);
    const p = row.value,
      r = p.registry;
    if (
      identity.repositoryId !== p.project.repoId ||
      identity.repositoryOwnerId !== r.ownerId ||
      identity.repository !== p.project.repo ||
      identity.actorId !== p.actorId ||
      identity.workflowRef !==
        `${p.project.repo}/${r.workflow.path}@refs/heads/${r.workflow.branch}` ||
      identity.workflowSha !== p.source.head ||
      identity.sha !== p.source.head ||
      identity.ref !== `refs/heads/${r.workflow.branch}` ||
      identity.eventName !== "workflow_dispatch" ||
      identity.jobWorkflowRef !== null ||
      identity.jobWorkflowSha !== null ||
      (row.run_id !== null && row.run_id !== identity.runId)
    )
      throw new WebError("worker_identity_denied", 403);
    if (row.cancel_requested || terminal(row))
      throw new WebError("worker_stopped", 409);
    const live = await initiating(p),
      job = await provider(live.token).workerJob(p, identity);
    if (
      kind !== "claim" &&
      (input.jobId !== job.jobId ||
        row.job_id !== job.jobId ||
        row.nonce !== input.nonce ||
        row.fence !== input.fence)
    )
      throw new WebError("worker_identity_denied", 403);
    return { row, job };
  }
  function authority(row) {
    return {
      fence: row.fence,
      jobId: row.job_id,
      deadline: Date.parse(row.deadline),
      leaseExpiresAt: Date.parse(row.lease_until),
      checkoutSha: row.value.source.head,
      workflowSha: row.value.source.head,
      adapter: "typecheck-v1",
    };
  }
  async function claim(identity, input) {
    const { row, job } = await workerContext(identity, input, "claim");
    const result = await store.transition("claim", row.id, {
      runId: identity.runId,
      jobId: job.jobId,
      nonce: input.nonce,
      fence: parseInt(hash(random()).slice(0, 12), 16) + 1,
      deadline: job.deadline,
    });
    if (result.conflict) throw new WebError("worker_claim_conflict", 409);
    await initiating(row.value);
    return authority(result.row);
  }
  async function advance(kind, identity, input) {
    const { row } = await workerContext(identity, input, kind),
      data = {
        runId: identity.runId,
        jobId: input.jobId,
        nonce: input.nonce,
        fence: input.fence,
      };
    if (kind !== "begin") data.sequence = input.sequence;
    if (kind === "complete") data.result = input.result;
    const result = await store.transition(kind, row.id, data);
    if (result.conflict) throw new WebError("worker_grant_refused", 409);
    await initiating(row.value);
    if (kind === "begin") {
      if (!result.granted) throw new WebError("worker_grant_refused", 409);
      const a = authority(result.row);
      return {
        granted: true,
        fence: a.fence,
        jobId: a.jobId,
        deadline: a.deadline,
        leaseExpiresAt: a.leaseExpiresAt,
      };
    }
    if (!result.changed) throw new WebError("worker_grant_refused", 409);
    return kind === "heartbeat"
      ? { continue: true, leaseExpiresAt: Date.parse(result.row.lease_until) }
      : { accepted: true };
  }
  return {
    overview,
    routine,
    preview,
    start,
    operation,
    reconcile,
    cancel,
    retryPreview,
    claim,
    begin: (i, b) => advance("begin", i, b),
    heartbeat: (i, b) => advance("heartbeat", i, b),
    complete: (i, b) => advance("complete", i, b),
    schedulePreview: schedules.preview,
    scheduleApply: schedules.apply,
  };
}

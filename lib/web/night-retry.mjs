import { createNightSource, NIGHT_REVIEW } from "./night-retry-source.mjs";
import { createNightRetryStore } from "./night-retry-store.mjs";
import { createJobStore } from "./job-store.mjs";
import { exact, hash, random, numeric, WebError } from "./common.mjs";
import { jobId } from "./job-registry.mjs";
const SEMANTICS =
  "GitHub keeps the original SHA/ref and original actor privileges. The canonical night reads the current UTC date and current plan. External scheduled runs are outside web admission. No new model allowance is granted. A successor observation is not proof of causation or acceptance.";
export function createNightRetry(
  config,
  { fetcher = fetch, now = Date.now } = {},
) {
  const source = createNightSource(config, { fetcher, now }),
    store = createNightRetryStore(config, fetcher),
    jobs = createJobStore(config, fetcher);
  function authorize(access, project) {
    source.authorize(access, project);
  }
  async function inspectInternal(access, token, project, input) {
    if (
      !exact(input, ["runId", "attempt"]) ||
      !numeric(input.runId) ||
      !Number.isInteger(input.attempt) ||
      input.attempt < 1 ||
      input.attempt > 50
    )
      throw new WebError("invalid_night_attempt", 400);
    const checked = await source.inspect(access, token, project);
    const run = await source.run(
      token,
      project,
      checked.profile,
      input.runId,
      input.attempt,
    );
    const latest = await source.run(
      token,
      project,
      checked.profile,
      input.runId,
    );
    if (
      latest.attempt !== run.attempt ||
      latest.actorId !== run.actorId ||
      latest.triggeringActorId !== run.triggeringActorId ||
      latest.state !== run.state ||
      latest.conclusion !== run.conclusion
    )
      throw new WebError("night_attempt_changed", 409);
    if (
      run.state !== "completed" ||
      !["failure", "timed_out", "startup_failure"].includes(run.conclusion) ||
      now() - Date.parse(run.createdAt) > 30 * 86400000 ||
      Date.parse(run.createdAt) > now()
    )
      throw new WebError("night_attempt_not_retryable", 409);
    const sourceDigest = hash(
      JSON.stringify([
        checked.source,
        checked.workspaceSource,
        checked.registryDigest,
        run,
      ]),
    );
    const ready = source.ready(access, checked);
    // Old read-only installations do not require migration013 merely to inspect.
    const used = ready ? await jobs.budget(project) : null;
    const budget = {
      minutes: 60,
      workspaceLimit: config.jobs?.weeklyMinutes ?? null,
      projectLimit: checked.projectLimit,
      used,
    };
    const enough =
      used &&
      used.workspaceMinutes + 60 <= budget.workspaceLimit &&
      used.projectMinutes + 60 <= budget.projectLimit;
    return {
      checked,
      model: {
        schema: 1,
        project: { id: project.id },
        sourceDigest,
        source: checked.source,
        profile: { id: project.id, adapter: checked.profile.adapter },
        run,
        commands: checked.profile.commands,
        effects: checked.profile.effects,
        review: checked.profile.review,
        semantics: SEMANTICS,
        budget,
        capabilities: {
          retry: !!(ready && enough),
          reason: !ready
            ? "Night retry activation, current grants and reviewed profile are required."
            : !enough
              ? "The shared allowance cannot reserve60minutes."
              : null,
        },
        gaps: [],
      },
    };
  }
  async function inspect(a, t, p, i) {
    return (await inspectInternal(a, t, p, i)).model;
  }
  async function preview(a, t, p, i) {
    const { model, checked } = await inspectInternal(a, t, p, i);
    if (!model.capabilities.retry)
      throw new WebError("night_retry_disabled", 409);
    const id = hash(random()),
      operationId = hash(random());
    const value = {
      ...model,
      id,
      operationId,
      operationUrl: `/projects/${p.id}/night-retries/${operationId}`,
      profileRecord: checked.profile,
    };
    const digest = hash(JSON.stringify(value));
    const saved = await store.createPreview(id, p, a.userId, digest, value);
    if (!saved) throw new WebError("night_preview_unavailable", 409);
    const { profileRecord, ...visible } = value;
    return { ...visible, digest, expiresAt: saved.expires_at };
  }
  function view(row) {
    const v = row.value;
    return {
      schema: 1,
      id: row.id,
      projectId: v.project.id,
      kind: "night-retry",
      state: row.state,
      original: v.run,
      request: {
        accepted: row.accepted_at !== null,
        attribution: "unverified",
      },
      observations: row.observation ? [row.observation] : [],
      budget: {
        reservedMinutes: 60,
        charged: row.charged,
        laneHeld: !["settled", "refused"].includes(row.state),
      },
      reason:
        row.state === "settled"
          ? "The accepted request is settled by a later completed provider attempt. Attribution and work acceptance remain unverified."
          : row.state === "refused"
            ? "No rerun was dispatched. Refresh the original source and preview."
            : row.state === "request-accepted"
              ? "GitHub accepted the request; its outcome is not yet settled."
              : "A retained intent never authorizes redispatch. Sending or uncertain requests keep their lane and charge.",
      capabilities: {
        reconcile: !["prepared", "refused", "settled"].includes(row.state),
        retry: false,
        cancel: false,
      },
    };
  }
  async function read(a, p, id) {
    authorize(a, p);
    const found = await store.read(id, p, a.userId);
    if (!found) throw new WebError("night_operation_not_found", 404);
    return found.row;
  }
  async function apply(a, t, p, input, { reauthorize } = {}) {
    authorize(a, p);
    if (
      !exact(input, ["previewId", "digest"]) ||
      ![input.previewId, input.digest].every(jobId) ||
      typeof reauthorize !== "function"
    )
      throw new WebError("invalid_night_approval", 400);
    const saved = await store.preview(input.previewId, p, a.userId);
    if (!saved || saved.digest !== input.digest)
      throw new WebError("night_preview_expired", 409);
    const v = saved.value;
    if (
      hash(JSON.stringify(v)) !== saved.digest ||
      v.project?.id !== p.id ||
      !jobId(v.operationId)
    )
      throw new WebError("invalid_night_store");
    const intent = {
      kind: "night-retry",
      id: v.operationId,
      actorId: a.userId,
      digest: saved.digest,
      project: p,
      run: v.run,
      profile: v.profileRecord,
      sourceDigest: v.sourceDigest,
    };
    const existing = await store.read(v.operationId, p, a.userId);
    if (existing && existing.row.state !== "prepared") {
      const access = await reauthorize();
      authorize(access, p);
      if (access.userId !== a.userId) throw new WebError("access_denied", 404);
      return view(existing.row);
    }
    let admission;
    try {
      admission = await source.inspect(a, t, p);
    } catch (error) {
      if (existing?.row.state === "prepared")
        await store.transition("refuse", v.operationId, p, a.userId);
      throw error;
    }
    const result = await store.reserve(
      v.operationId,
      p,
      a.userId,
      saved.digest,
      saved.id,
      intent,
      config.jobs?.weeklyMinutes ?? 0,
      admission.projectLimit,
    );
    if (!result || result.conflict)
      throw new WebError(`night_${result?.conflict ?? "preview_expired"}`, 409);
    let fresh;
    try {
      fresh = await reauthorize();
      authorize(fresh, p);
      if (fresh.userId !== a.userId) throw new WebError("access_denied", 404);
      if (result.row.state !== "prepared") return view(result.row);
      const current = await inspectInternal(fresh, t, p, {
        runId: v.run.runId,
        attempt: v.run.attempt,
      });
      // Include this reservation exactly once. A reduced allowance must still
      // stop a prepared resume, including reductions after initial admission.
      if (
        !source.ready(fresh, current.checked) ||
        current.model.sourceDigest !== v.sourceDigest
      )
        throw new WebError("night_source_changed", 409);
      if (
        !current.model.budget.used ||
        current.model.budget.used.workspaceMinutes >
          current.model.budget.workspaceLimit ||
        current.model.budget.used.projectMinutes >
          current.model.budget.projectLimit
      )
        throw new WebError("night_budget", 409);
      const finalAccess = await reauthorize();
      authorize(finalAccess, p);
      if (
        finalAccess.userId !== a.userId ||
        finalAccess.actionsPermission !== "write" ||
        finalAccess.sourceRevision !== fresh.sourceRevision
      ) {
        await store.transition("refuse", v.operationId, p, a.userId);
        throw new WebError("access_denied", 404);
      }
      if (
        current.model.budget.used.workspaceMinutes > config.jobs.weeklyMinutes
      )
        throw new WebError("night_budget", 409);
      const lastRun = await source.run(t, p, v.profileRecord, v.run.runId);
      if (JSON.stringify(lastRun) !== JSON.stringify(v.run)) {
        await store.transition("refuse", v.operationId, p, a.userId);
        throw new WebError("night_attempt_changed", 409);
      }
    } catch (e) {
      await store.transition("refuse", v.operationId, p, a.userId);
      throw e;
    }
    const grant = await store.transition("send", v.operationId, p, a.userId);
    if (!grant?.granted) return view(await read(fresh, p, v.operationId));
    try {
      const response = await fetcher(
        `https://api.github.com/repositories/${p.repoId}/actions/runs/${v.run.runId}/rerun-failed-jobs`,
        {
          method: "POST",
          headers: { ...source.headers(t), "Content-Type": "application/json" },
          body: JSON.stringify({ enable_debug_logging: false }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
      await response.body?.cancel();
      if (response.status !== 201)
        throw new WebError("night_request_unconfirmed");
      const accepted = await store.transition(
        "accepted",
        v.operationId,
        p,
        a.userId,
      );
      if (!accepted?.row) throw new WebError("night_request_unconfirmed");
      return view(accepted.row);
    } catch {
      try {
        await store.transition("uncertain", v.operationId, p, a.userId);
      } catch {}
      return view(await read(fresh, p, v.operationId));
    }
  }
  async function operation(a, t, p, id) {
    return view(await read(a, p, id));
  }
  async function reconcile(a, t, p, id) {
    const row = await read(a, p, id);
    if (["prepared", "refused", "settled"].includes(row.state))
      return view(row);
    const latest = await source.run(t, p, row.value.profile, row.run_id);
    if (latest.actorId !== row.value.run.actorId)
      throw new WebError("night_run_identity_changed", 409);
    if (latest.attempt <= row.attempt) return view(row);
    const observation = {
      runId: latest.runId,
      attempt: latest.attempt,
      state: latest.state,
      conclusion: latest.conclusion,
      url: latest.url,
      observedAt: new Date(now()).toISOString(),
      attribution: "unverified",
    };
    const updated = await store.transition("observe", id, p, a.userId, {
      observation,
    });
    if (!updated?.row) return view(await read(a, p, id));
    return view(updated.row);
  }
  return { inspect, preview, apply, operation, reconcile };
}

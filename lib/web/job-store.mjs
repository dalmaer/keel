import {
  exact,
  hash,
  numeric,
  requestJson,
  seal,
  unseal,
  WebError,
} from "./common.mjs";
import { jobId, sha, validateWorker } from "./job-registry.mjs";
const states = [
  "prepared",
  "dispatching",
  "uncertain",
  "queued",
  "claimed",
  "running",
  "worker-complete",
  "terminal",
  "refused",
];
const time = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
export function createJobStore(config, fetcher = fetch) {
  const scope = hash(
    JSON.stringify([
      "jobs-v1",
      config.appId,
      config.installationId,
      config.workspace.id,
      config.workspace.repoId,
    ]),
  );
  const projectFor = (project) =>
    hash(JSON.stringify([scope, project.id, project.repoId]));
  const encrypted = (kind, id, value) =>
    seal(value, config.encryptionKey, `${kind}:${scope}:${id}`);
  function row(value) {
    const fields = [
      "scope",
      "id",
      "project",
      "actor",
      "digest",
      "preview",
      "value",
      "state",
      "minutes",
      "charged",
      "run_id",
      "job_id",
      "nonce",
      "fence",
      "deadline",
      "lease_until",
      "sequence",
      "worker_result",
      "provider",
      "cancel_requested",
      "cancel_dispatched",
      "created_at",
      "updated_at",
      "terminal_at",
    ];
    if (
      !exact(value, fields) ||
      value.scope !== scope ||
      ![value.id, value.project, value.digest, value.preview].every(jobId) ||
      !numeric(value.actor) ||
      typeof value.value !== "string" ||
      !states.includes(value.state) ||
      !Number.isInteger(value.minutes) ||
      value.minutes < 1 ||
      value.minutes > 60 ||
      !["charged", "cancel_requested", "cancel_dispatched"].every(
        (k) => typeof value[k] === "boolean",
      ) ||
      !["run_id", "job_id"].every(
        (k) => value[k] === null || numeric(value[k]),
      ) ||
      !(value.nonce === null || jobId(value.nonce)) ||
      !(value.fence === null || numeric(value.fence)) ||
      !["deadline", "lease_until", "terminal_at"].every(
        (k) => value[k] === null || time(value[k]),
      ) ||
      ![value.created_at, value.updated_at].every(time) ||
      !Number.isInteger(value.sequence) ||
      value.sequence < 0
    )
      throw new WebError("invalid_job_store");
    if (
      value.worker_result !== null &&
      (!exact(value.worker_result, ["state", "exitCode"]) ||
        !["succeeded", "failed", "cancelled"].includes(
          value.worker_result.state,
        ) ||
        (value.worker_result.exitCode !== null &&
          (!Number.isInteger(value.worker_result.exitCode) ||
            value.worker_result.exitCode < 0 ||
            value.worker_result.exitCode > 255)) ||
        (value.worker_result.state === "succeeded" &&
          value.worker_result.exitCode !== 0))
    )
      throw new WebError("invalid_job_store");
    if (value.provider !== null) {
      const p = value.provider;
      if (
        !exact(p, [
          "runId",
          "attempt",
          "state",
          "conclusion",
          "url",
          "createdAt",
          "updatedAt",
          "observedAt",
        ]) ||
        !numeric(p.runId) ||
        p.runId !== value.run_id ||
        p.attempt !== 1 ||
        ![
          "queued",
          "requested",
          "waiting",
          "pending",
          "in_progress",
          "completed",
        ].includes(p.state) ||
        ![p.createdAt, p.updatedAt, p.observedAt].every(time) ||
        typeof p.url !== "string" ||
        !/^https:\/\/github.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/.test(
          p.url,
        ) ||
        (p.state === "completed"
          ? ![
              "success",
              "failure",
              "neutral",
              "cancelled",
              "skipped",
              "timed_out",
              "action_required",
              "stale",
              "startup_failure",
            ].includes(p.conclusion)
          : p.conclusion !== null)
      )
        throw new WebError("invalid_job_store");
    }
    if (
      (value.state === "terminal" &&
        (value.provider?.state !== "completed" ||
          value.terminal_at === null)) ||
      (value.state === "worker-complete" && value.worker_result === null) ||
      (["claimed", "running", "worker-complete"].includes(value.state) &&
        [
          value.nonce,
          value.fence,
          value.job_id,
          value.run_id,
          value.deadline,
          value.lease_until,
        ].some((v) => v === null))
    )
      throw new WebError("invalid_job_store");
    const intent = unseal(
      value.value,
      config.encryptionKey,
      `job:${scope}:${value.id}`,
    );
    validateWorker(intent.registry);
    if (
      !exact(intent, [
        "kind",
        "id",
        "actorId",
        "digest",
        "project",
        "routineId",
        "retryOf",
        "source",
        "registryDigest",
        "registry",
        "sessionRef",
      ]) ||
      intent.kind !== "job" ||
      !jobId(intent.sessionRef) ||
      !jobId(intent.registryDigest) ||
      !sha(intent.source?.head) ||
      (intent.retryOf !== null && !jobId(intent.retryOf)) ||
      intent.id !== value.id ||
      intent.actorId !== value.actor ||
      intent.digest !== value.digest ||
      projectFor(intent.project) !== value.project
    )
      throw new WebError("invalid_job_store");
    return { ...value, value: intent };
  }
  async function rpc(operation, id, data = {}) {
    if (!jobId(id)) throw new WebError("invalid_job_id", 400);
    const result = await requestJson(
      fetcher,
      `${config.storageUrl}/rest/v1/rpc/keel_job_rpc`,
      {
        method: "POST",
        headers: {
          apikey: config.storageKey,
          Authorization: `Bearer ${config.storageKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_operation: operation,
          p_scope: scope,
          p_id: id,
          p_data: data,
        }),
      },
      3000000,
    );
    if (result === null) {
      if (
        ["read", "preview-read", "preview-create", "reserve"].includes(
          operation,
        )
      )
        return null;
      throw new WebError("invalid_job_store");
    }
    if (
      exact(result, ["conflict"]) &&
      ["identity", "lane", "budget", "capacity", "state"].includes(
        result.conflict,
      ) &&
      !["read", "list", "budget", "preview-read", "preview-create"].includes(
        operation,
      )
    )
      return result;
    if (operation.startsWith("preview-")) {
      const p = result.preview;
      if (
        !exact(result, ["preview"]) ||
        !exact(p, [
          "scope",
          "id",
          "project",
          "actor",
          "digest",
          "value",
          "expires_at",
        ]) ||
        p.scope !== scope ||
        p.id !== id ||
        !jobId(p.project) ||
        !numeric(p.actor) ||
        !jobId(p.digest) ||
        typeof p.value !== "string" ||
        !time(p.expires_at)
      )
        throw new WebError("invalid_job_store");
      return {
        ...p,
        value: unseal(
          p.value,
          config.encryptionKey,
          `job-preview:${scope}:${id}`,
        ),
      };
    }
    if (operation === "list") {
      if (
        !exact(result, ["rows", "after", "hasMore"]) ||
        !Array.isArray(result.rows) ||
        result.rows.length > 20 ||
        typeof result.hasMore !== "boolean" ||
        (result.after !== null && !jobId(result.after)) ||
        result.hasMore !== (result.after !== null)
      )
        throw new WebError("invalid_job_store");
      const rows = result.rows.map(row);
      if (
        rows.some((r) => r.project !== data.project) ||
        new Set(rows.map((r) => r.id)).size !== rows.length ||
        (result.hasMore && rows.at(-1)?.id !== result.after)
      )
        throw new WebError("invalid_job_store");
      return { ...result, rows };
    }
    if (operation === "budget") {
      if (
        !exact(result, ["workspaceMinutes", "projectMinutes"]) ||
        !Object.values(result).every((v) => Number.isSafeInteger(v) && v >= 0)
      )
        throw new WebError("invalid_job_store");
      return result;
    }
    if (
      !exact(result, ["row", "changed", "granted"]) ||
      typeof result.changed !== "boolean" ||
      typeof result.granted !== "boolean"
    )
      throw new WebError("invalid_job_store");
    const parsed = row(result.row);
    if (parsed.id !== id) throw new WebError("invalid_job_store");
    // An execution grant is valid only for the transition that durably won it.
    const grantedState = {
      dispatch: "dispatching",
      begin: "running",
      "cancel-dispatch": parsed.state,
    };
    if (
      (operation === "read" && (result.changed || result.granted)) ||
      (result.granted &&
        (!result.changed ||
          !Object.hasOwn(grantedState, operation) ||
          parsed.state !== grantedState[operation] ||
          (operation === "cancel-dispatch" &&
            (!parsed.cancel_requested ||
              !parsed.cancel_dispatched ||
              parsed.run_id === null))))
    )
      throw new WebError("invalid_job_store");
    return { ...result, row: parsed };
  }
  return {
    scope,
    projectFor,
    createPreview: (id, project, actor, digest, value) =>
      rpc("preview-create", id, {
        project: projectFor(project),
        actor,
        digest,
        value: encrypted("job-preview", id, value),
      }),
    preview: (id) => rpc("preview-read", id),
    reserve: (
      id,
      project,
      actor,
      digest,
      preview,
      value,
      minutes,
      workspaceLimit,
      projectLimit,
    ) =>
      rpc("reserve", id, {
        project: projectFor(project),
        actor,
        digest,
        preview,
        value: encrypted("job", id, value),
        minutes,
        workspaceLimit,
        projectLimit,
      }),
    read: (id) => rpc("read", id),
    list: (project, after = null) =>
      rpc("list", "0".repeat(64), { project: projectFor(project), after }),
    budget: (project) =>
      rpc("budget", "0".repeat(64), { project: projectFor(project) }),
    transition: rpc,
  };
}

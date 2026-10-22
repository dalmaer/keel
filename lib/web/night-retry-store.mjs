import {
  exact,
  hash,
  numeric,
  requestJson,
  seal,
  unseal,
  WebError,
} from "./common.mjs";
import { jobId } from "./job-registry.mjs";
const states = [
  "prepared",
  "sending",
  "request-accepted",
  "uncertain",
  "refused",
  "settled",
];
const time = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
export function createNightRetryStore(config, fetcher = fetch) {
  const scope = hash(
    JSON.stringify([
      "jobs-v1",
      config.appId,
      config.installationId,
      config.workspace.id,
      config.workspace.repoId,
    ]),
  );
  const projectFor = (p) => hash(JSON.stringify([scope, p.id, p.repoId]));
  const crypt = (kind, id, value) =>
    seal(value, config.encryptionKey, `${kind}:${scope}:${id}`);
  const decrypt = (kind, id, value) =>
    unseal(value, config.encryptionKey, `${kind}:${scope}:${id}`);
  const invalid = () => {
    throw new WebError("invalid_night_store");
  };
  function row(r, id, project, actor) {
    if (
      !exact(r, [
        "scope",
        "id",
        "project",
        "actor",
        "digest",
        "preview",
        "value",
        "run_id",
        "attempt",
        "state",
        "minutes",
        "charged",
        "observation",
        "accepted_at",
        "settled_at",
        "created_at",
        "updated_at",
      ]) ||
      r.scope !== scope ||
      r.id !== id ||
      r.project !== project ||
      r.actor !== actor ||
      ![r.digest, r.preview].every(jobId) ||
      !numeric(r.run_id) ||
      !Number.isInteger(r.attempt) ||
      r.attempt < 1 ||
      r.attempt > 50 ||
      !states.includes(r.state) ||
      r.minutes !== 60 ||
      typeof r.charged !== "boolean" ||
      typeof r.value !== "string" ||
      ![r.created_at, r.updated_at].every(time) ||
      ![r.accepted_at, r.settled_at].every((v) => v === null || time(v))
    )
      invalid();
    if (r.observation !== null) {
      const o = r.observation;
      if (
        !exact(o, [
          "runId",
          "attempt",
          "state",
          "conclusion",
          "url",
          "observedAt",
          "attribution",
        ]) ||
        o.runId !== r.run_id ||
        !Number.isInteger(o.attempt) ||
        o.attempt <= r.attempt ||
        o.attempt > 51 ||
        ![
          "queued",
          "requested",
          "waiting",
          "pending",
          "in_progress",
          "completed",
        ].includes(o.state) ||
        !time(o.observedAt) ||
        o.attribution !== "unverified" ||
        typeof o.url !== "string" ||
        !/^https:\/\/github.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/.test(
          o.url,
        ) ||
        (o.state === "completed"
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
            ].includes(o.conclusion)
          : o.conclusion !== null)
      )
        invalid();
    }
    if (
      (r.state === "settled" &&
        (r.accepted_at === null ||
          r.settled_at === null ||
          r.observation?.state !== "completed")) ||
      (r.state === "request-accepted" && r.accepted_at === null) ||
      (r.state === "refused" && r.charged)
    )
      invalid();
    const value = decrypt("night-retry", id, r.value);
    if (
      value?.kind !== "night-retry" ||
      value.id !== id ||
      value.actorId !== actor ||
      value.digest !== r.digest ||
      projectFor(value.project) !== project ||
      value.run?.runId !== r.run_id ||
      value.run?.attempt !== r.attempt
    )
      invalid();
    return { ...r, value };
  }
  async function rpc(operation, id, project, actor, data = {}) {
    if (!jobId(id) || !numeric(actor))
      throw new WebError("invalid_night_id", 400);
    const key = projectFor(project);
    const result = await requestJson(
      fetcher,
      `${config.storageUrl}/rest/v1/rpc/keel_night_retry_rpc`,
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
          p_data: { project: key, actor, ...data },
        }),
      },
      300000,
    );
    if (result === null) {
      if (
        ["read", "preview-read", "preview-create", "reserve"].includes(
          operation,
        )
      )
        return null;
      invalid();
    }
    if (
      exact(result, ["conflict"]) &&
      ["lane", "budget", "capacity", "identity", "state"].includes(
        result.conflict,
      ) &&
      !["read", "preview-read", "preview-create"].includes(operation)
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
        p.project !== key ||
        p.actor !== actor ||
        !jobId(p.digest) ||
        typeof p.value !== "string" ||
        !time(p.expires_at)
      )
        invalid();
      return { ...p, value: decrypt("night-preview", id, p.value) };
    }
    if (
      !exact(result, ["row", "changed", "granted"]) ||
      typeof result.changed !== "boolean" ||
      typeof result.granted !== "boolean"
    )
      invalid();
    const parsed = row(result.row, id, key, actor);
    if (
      (result.granted &&
        (operation !== "send" ||
          !result.changed ||
          parsed.state !== "sending")) ||
      (operation === "read" && (result.changed || result.granted))
    )
      invalid();
    return { ...result, row: parsed };
  }
  return {
    scope,
    projectFor,
    createPreview: (id, p, actor, digest, value) =>
      rpc("preview-create", id, p, actor, {
        digest,
        value: crypt("night-preview", id, value),
      }),
    preview: (id, p, a) => rpc("preview-read", id, p, a),
    read: (id, p, a) => rpc("read", id, p, a),
    reserve: (id, p, a, digest, preview, value, workspaceLimit, projectLimit) =>
      rpc("reserve", id, p, a, {
        digest,
        preview,
        value: crypt("night-retry", id, value),
        runId: value.run.runId,
        attempt: value.run.attempt,
        workspaceLimit,
        projectLimit,
      }),
    transition: rpc,
  };
}

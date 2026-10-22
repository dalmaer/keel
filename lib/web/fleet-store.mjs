import { requestJson, seal, unseal, exact, WebError } from "./common.mjs";
import { createJobStore } from "./job-store.mjs";
import { digestId } from "./fleet-model.mjs";
export function createFleetStore(config, fetcher = fetch) {
  const jobs = createJobStore(config, fetcher),
    scope = jobs.scope;
  const encode = (id, actor, value) =>
    seal(value, config.encryptionKey, `fleet-v1:${scope}:${actor}:${id}`);
  async function rpc(op, id, actor, data = {}) {
    if (!digestId(id) || !Number.isSafeInteger(actor) || actor < 1)
      throw new WebError("invalid_fleet_identity", 400);
    const value = await requestJson(
      fetcher,
      `${config.storageUrl}/rest/v1/rpc/keel_fleet_rpc`,
      {
        method: "POST",
        headers: {
          apikey: config.storageKey,
          Authorization: `Bearer ${config.storageKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_operation: op,
          p_scope: scope,
          p_id: id,
          p_actor: actor,
          p_data: data,
        }),
      },
      4 * 1024 * 1024,
    );
    if (value === null) {
      if (op === "read") return null;
      throw new WebError("invalid_fleet_store");
    }
    if (
      op !== "read" &&
      exact(value, ["conflict"]) &&
      ["identity", "capacity", "state"].includes(value.conflict)
    )
      throw new WebError(`fleet_${value.conflict}_conflict`, 409);
    const r = value.row;
    if (
      !exact(value, ["row", "changed"]) ||
      typeof value.changed !== "boolean" ||
      !exact(r, [
        "scope",
        "id",
        "actor",
        "project",
        "kind",
        "state",
        "version",
        "digest",
        "value",
        "stage",
        "created_at",
        "updated_at",
      ]) ||
      r.scope !== scope ||
      r.id !== id ||
      r.actor !== actor ||
      !(r.project === null || digestId(r.project)) ||
      ![
        "rollout",
        "preview",
        "artifact",
        "publication",
        "preparation",
      ].includes(r.kind) ||
      !["ready", "dispatched", "uncertain", "committed", "stopped"].includes(
        r.state,
      ) ||
      !Number.isSafeInteger(r.version) ||
      r.version < 1 ||
      !Number.isInteger(r.stage) ||
      r.stage < 0 ||
      r.stage > 2500 ||
      !digestId(r.digest) ||
      typeof r.value !== "string" ||
      ![r.created_at, r.updated_at].every(
        (t) => typeof t === "string" && Number.isFinite(Date.parse(t)),
      ) ||
      (op === "read" && value.changed)
    )
      throw new WebError("invalid_fleet_store");
    if (
      op === "cas" &&
      (!value.changed ||
        r.version !== data.version + 1 ||
        r.state !== data.state ||
        r.stage !== data.stage)
    )
      throw new WebError("invalid_fleet_store");
    if (
      ["create", "output"].includes(op) &&
      (r.digest !== data.digest ||
        r.project !== data.project ||
        r.kind !== (op === "output" ? "artifact" : data.kind))
    )
      throw new WebError("invalid_fleet_store");
    if (
      ["artifact", "preview"].includes(r.kind) &&
      (r.state !== "ready" || r.version !== 1 || r.stage !== 0)
    )
      throw new WebError("invalid_fleet_store");
    const decoded = unseal(
      r.value,
      config.encryptionKey,
      `fleet-v1:${scope}:${actor}:${id}`,
    );
    if (
      r.kind === "publication" &&
      (!Array.isArray(decoded.objects) ||
        r.stage > decoded.objects.length + 2 ||
        (r.state === "committed") !== (r.stage === decoded.objects.length + 2))
    )
      throw new WebError("invalid_fleet_store");
    return { ...r, value: decoded, changed: value.changed };
  }
  return {
    scope,
    projectFor: jobs.projectFor,
    read: (id, a) => rpc("read", id, a),
    create: (id, a, kind, project, digest, value) =>
      rpc("create", id, a, {
        kind,
        project: project ? jobs.projectFor(project) : null,
        digest,
        value: encode(id, a, value),
      }),
    output: (id, a, project, digest, value, identity) =>
      rpc("output", id, a, {
        project: jobs.projectFor(project),
        digest,
        value: encode(id, a, value),
        ...identity,
      }),
    cas: (r, state, stage, value) =>
      rpc("cas", r.id, r.actor, {
        version: r.version,
        state,
        stage,
        value: encode(r.id, r.actor, value),
      }),
  };
}

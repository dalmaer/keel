import { hash, seal, unseal, requestJson, WebError } from "./common.mjs";
import { digestOf } from "../feedback.mjs";
export function createMediaStore(config, fetcher = fetch) {
  const scope = hash(
    JSON.stringify([
      "media-v1",
      config.appId,
      config.installationId,
      config.workspace.repoId,
      config.workspace.id,
      config.storageUrl,
      config.media?.bucket,
    ]),
  );
  const projectKey = (project) =>
    hash(JSON.stringify([scope, project.id, project.repoId]));
  const artifactId = (access, project, requestId) =>
    hash(JSON.stringify([projectKey(project), access.userId, requestId]));
  const slotKey = (changeId, slotId) =>
    hash(JSON.stringify([changeId, slotId]));
  const purpose = (project, id) =>
    `media-receipt:${scope}:${projectKey(project)}:${id}`;
  function decode(project, row) {
    if (row === null) return null;
    if (
      typeof row.value !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.id ?? "") ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1
    )
      throw new WebError("invalid_media_storage");
    const value = unseal(
      row.value,
      config.encryptionKey,
      purpose(project, row.id),
    );
    if (
      value.id !== row.id ||
      value.projectId !== project.id ||
      value.repoId !== project.repoId ||
      value.uploaderId !== row.actor ||
      value.inputDigest !== row.digest
    )
      throw new WebError("invalid_media_storage");
    return { ...row, value };
  }
  async function rpc(operation, access, project, params = {}) {
    const response = await requestJson(
      fetcher,
      `${config.storageUrl}/rest/v1/rpc/keel_media_rpc`,
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
          p_project: projectKey(project),
          p_actor: access.userId,
          p_capacity: config.media?.capacityBytes ?? 268435456,
          ...params,
        }),
      },
      2200000,
    );
    if (response?.conflict) throw new WebError("media_conflict", 409);
    if (response?.capacity) throw new WebError("media_capacity", 413);
    return response;
  }
  return {
    scope,
    projectKey,
    artifactId,
    slotKey,
    reserve: async (access, project, value) =>
      decode(
        project,
        await rpc("reserve", access, project, {
          p_id: value.id,
          p_digest: value.inputDigest,
          p_bytes: value.cipherBytes,
          p_value: seal(
            value,
            config.encryptionKey,
            purpose(project, value.id),
          ),
        }),
      ),
    read: async (access, project, id) =>
      decode(project, await rpc("read", access, project, { p_id: id })),
    transition: async (access, project, row, state) => {
      const next = decode(
        project,
        await rpc(state, access, project, {
          p_id: row.id,
          p_expected: row.revision,
        }),
      );
      if (!next) throw new WebError("invalid_media_storage");
      return next;
    },
    list: async (access, project, { after = null, limit = 30 } = {}) => {
      const rows = await rpc("list", access, project, {
        p_after: after,
        p_limit: limit,
      });
      if (!Array.isArray(rows) || rows.length > limit)
        throw new WebError("invalid_media_storage");
      return rows.map((row) => decode(project, row));
    },
    slots: async (access, project) => {
      const rows = await rpc("slots", access, project);
      if (!Array.isArray(rows) || rows.length > 1000)
        throw new WebError("invalid_media_storage");
      return rows;
    },
    batch: async (access, project, ids) => {
      const rows = await rpc("batch", access, project, {
        p_value: JSON.stringify(ids),
      });
      if (!Array.isArray(rows) || rows.length > 30)
        throw new WebError("invalid_media_storage");
      return rows.map((row) => decode(project, row));
    },
    slot: (access, project, changeId, slotId) =>
      rpc("slot", access, project, { p_slot: slotKey(changeId, slotId) }),
    attach: (access, project, row, requirements, expected) =>
      rpc("attach", access, project, {
        p_id: row.id,
        p_slot: slotKey(row.value.changeId, row.value.slotId),
        p_requirements: requirements,
        p_expected: expected,
      }),
    deleteDigest: (row) =>
      digestOf({
        id: row.id,
        revision: row.revision,
        hash: row.value.hash,
        state: row.state,
      }),
  };
}

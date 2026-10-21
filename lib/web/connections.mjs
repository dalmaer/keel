import { createConnectionPolicy, hex } from "./connection-policy.mjs";
import { createConnectionStore } from "./connection-store.mjs";
import { probeConnection } from "./provider-connections.mjs";
import { exact, WebError } from "./common.mjs";

const date = (value) =>
  typeof value === "string" &&
  value.length <= 40 &&
  Number.isFinite(Date.parse(value));
const safeId = (value) =>
  value === null ||
  (typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value));
const gapCodes = [
  "metadata_only",
  "inference_capacity_unavailable",
  "account_identity_unverified",
  "workspace_identity_unverified",
  "project_identity_unverified",
  "models_truncated",
  "models_paginated",
  "endpoint_limit_invalid",
  "endpoint_limits_unavailable",
];
const capacityCodes = [
  "inference_capacity_unavailable",
  "subscription_reporter_unavailable",
  "spend_unavailable",
  "runner_unavailable",
];
// Persisted metadata remains a strict adapter result, never a general provider response.
function safeHealth(value, provider) {
  if (value === null) return null;
  if (
    !exact(value, [
      "provider",
      "status",
      "observedAt",
      "expiresAt",
      "identity",
      "scope",
      "models",
      "coverage",
      "endpointLimits",
      "capacity",
    ]) ||
    value.provider !== provider ||
    value.status !== "validated" ||
    !date(value.observedAt) ||
    value.expiresAt !== null ||
    !exact(value.identity, ["account", "workspace", "provenance"]) ||
    !safeId(value.identity.account) ||
    !safeId(value.identity.workspace) ||
    !["provider-response", "unverified"].includes(value.identity.provenance) ||
    !exact(value.scope, [
      "organization",
      "project",
      "workspace",
      "provenance",
    ]) ||
    !["organization", "project", "workspace"].every((k) =>
      safeId(value.scope[k]),
    ) ||
    value.scope.provenance !== "owner-claim" ||
    !Array.isArray(value.models) ||
    value.models.length > 100 ||
    !value.models.every(
      (m) =>
        exact(m, ["id"]) &&
        typeof m.id === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(m.id),
    ) ||
    !exact(value.coverage, ["state", "gaps"]) ||
    value.coverage.state !== "partial" ||
    !Array.isArray(value.coverage.gaps) ||
    value.coverage.gaps.length > 15 ||
    !value.coverage.gaps.every((g) => gapCodes.includes(g)) ||
    !exact(value.capacity, ["pools", "gaps"]) ||
    !Array.isArray(value.capacity.pools) ||
    value.capacity.pools.length !== 0 ||
    !Array.isArray(value.capacity.gaps) ||
    value.capacity.gaps.length > 4 ||
    !value.capacity.gaps.every(
      (g) => exact(g, ["code"]) && capacityCodes.includes(g.code),
    ) ||
    !Array.isArray(value.endpointLimits) ||
    value.endpointLimits.length > 4
  )
    throw new WebError("invalid_connection_metadata");
  for (const row of value.endpointLimits) {
    if (
      !exact(row, [
        "metric",
        "unit",
        "limit",
        "remaining",
        "resetAt",
        "observedAt",
        "windowDurationMinutes",
        "scope",
        "modelCoverage",
        "rounded",
        "composite",
        "eligible",
      ]) ||
      ![
        "requests",
        "tokens",
        "project-tokens",
        "input-tokens",
        "output-tokens",
      ].includes(row.metric) ||
      !["requests", "tokens", "input-tokens", "output-tokens"].includes(
        row.unit,
      ) ||
      !Number.isSafeInteger(row.limit) ||
      row.limit < 0 ||
      !Number.isSafeInteger(row.remaining) ||
      row.remaining < 0 ||
      row.remaining > row.limit ||
      !date(row.resetAt) ||
      !date(row.observedAt) ||
      row.windowDurationMinutes !== null ||
      row.scope !== "GET /v1/models" ||
      row.modelCoverage !== "unknown" ||
      typeof row.rounded !== "boolean" ||
      typeof row.composite !== "boolean" ||
      row.eligible !== false
    )
      throw new WebError("invalid_connection_metadata");
  }
  return structuredClone(value);
}
export function createConnections(
  config,
  { fetcher = fetch, now = Date.now } = {},
) {
  const policy = createConnectionPolicy(config, { fetcher, now }),
    store = createConnectionStore(config, fetcher);
  const activated = () =>
    config.connections?.enabled === true &&
    date(config.connections.vaultVerifiedAt) &&
    Date.parse(config.connections.vaultVerifiedAt) <= now() &&
    Buffer.isBuffer(config.connectionEncryptionKey) &&
    config.connectionEncryptionKey.length === 32 &&
    !config.connectionEncryptionKey.equals(config.encryptionKey);
  const providerActive = (provider) =>
    activated() &&
    date(config.connections.providers?.[provider]) &&
    Date.parse(config.connections.providers[provider]) <= now();
  function metadata(row, current) {
    if (row === undefined)
      return {
        version: null,
        state: "unavailable",
        binding: "unavailable",
        updatedAt: null,
        health: null,
      };
    return {
      version: row?.version ?? 0,
      state: row?.state ?? "absent",
      binding: !row
        ? "absent"
        : row.policy === current.policyDigest
          ? "current"
          : "invalid",
      updatedAt: row?.updatedAt ?? null,
      health:
        row?.state === "present" && row.policy === current.policyDigest
          ? safeHealth(row.health, current.descriptor.provider)
          : null,
    };
  }
  async function overview(access, token, { project = null } = {}) {
    if (
      project &&
      !access.projects.some(
        (p) =>
          p.id === project.id &&
          p.repoId === project.repoId &&
          config.projectRepoIds[p.id] === p.repoId,
      )
    )
      throw new WebError("access_denied", 404);
    const result = await policy.read(access, token),
      connections = [],
      gaps = [...result.gaps];
    for (const current of result.records) {
      const descriptor = current.descriptor;
      if (
        project &&
        !descriptor.projects.some(
          (p) => p.id === project.id && p.repoId === project.repoId,
        )
      )
        continue;
      try {
        policy.authorize(access, descriptor);
      } catch {
        gaps.push({
          code: "connection_scope_unavailable",
          reason: "A connection grant is not currently authorized.",
        });
        continue;
      }
      let row;
      if (activated()) {
        try {
          row = await store.metadata(descriptor);
        } catch {
          gaps.push({
            code: "connection_vault_unavailable",
            reason: "Credential metadata is unavailable.",
          });
        }
      }
      const credential = metadata(row, current);
      connections.push({
        id: descriptor.id,
        provider: descriptor.provider,
        label: descriptor.label,
        enabled: descriptor.enabled,
        scope: descriptor.scope,
        projects: project
          ? descriptor.projects.filter((p) => p.id === project.id)
          : descriptor.projects,
        policyDigest: current.policyDigest,
        descriptor: project ? null : descriptor,
        path: current.path,
        credential,
        capabilities: {
          set:
            !project &&
            !result.gaps.length &&
            row !== undefined &&
            descriptor.enabled &&
            providerActive(descriptor.provider),
          rotate:
            !project &&
            !result.gaps.length &&
            row !== undefined &&
            descriptor.enabled &&
            providerActive(descriptor.provider),
          remove:
            !project &&
            !result.gaps.length &&
            activated() &&
            row?.state === "present",
        },
      });
    }
    if (!activated())
      gaps.push({
        code: "connection_setup_unavailable",
        reason:
          "Credential storage is disabled or its verification bindings are unavailable.",
      });
    // Source and membership are checked again after runtime metadata reads.
    const final = await policy.read(access, token);
    if (
      JSON.stringify(final.snapshot.source) !==
      JSON.stringify(result.snapshot.source)
    )
      throw new WebError("workspace_changed", 409);
    return {
      schema: 1,
      workspace: result.workspace,
      source: result.snapshot.source,
      connections,
      gaps,
      capabilities: {
        policyWrite:
          !project && !result.gaps.length && policy.allowed(access, result),
        credentialWrite: !project && activated(),
      },
    };
  }
  async function detail(access, token, id, options) {
    const result = await overview(access, token, options),
      connection = result.connections.find((c) => c.id === id);
    if (!connection) throw new WebError("connection_not_found", 404);
    const { connections, ...rest } = result;
    return { ...rest, connection };
  }
  function inputCheck(input, action, reconcile = false) {
    const fields = ["requestId", "expectedVersion", "policyDigest"];
    if (action === "set" && !reconcile) fields.push("key");
    if (reconcile) fields.push("action");
    if (
      !exact(input, fields) ||
      !hex(input.requestId) ||
      !hex(input.policyDigest) ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      input.expectedVersion >= 2147483647 ||
      (!reconcile && action === "set" && input.expectedVersion >= 2147483646) ||
      (reconcile && !["set", "remove"].includes(input.action))
    )
      throw new WebError("invalid_credential_intent", 400);
  }
  async function freshSelection(access, token, id, input, reauthorize) {
    if (typeof reauthorize !== "function")
      throw new WebError("authorization_recheck_required", 403);
    const fresh = await reauthorize();
    if (fresh.userId !== access.userId)
      throw new WebError("access_denied", 404);
    const result = await policy.selected(fresh, token, id);
    if (result.current.policyDigest !== input.policyDigest)
      throw new WebError("stale_policy", 409);
    return result;
  }
  const outcome = (id, input, action, current, row, actor) => ({
    schema: 1,
    connectionId: id,
    requestId: input.requestId,
    expectedVersion: input.expectedVersion,
    policyDigest: input.policyDigest,
    action,
    state:
      row?.version === input.expectedVersion + 1 &&
      row.request === input.requestId &&
      row.actor === actor &&
      row.policy === input.policyDigest &&
      row.state === (action === "set" ? "present" : "removed")
        ? "confirmed"
        : (row?.version ?? 0) > input.expectedVersion
          ? "superseded"
          : "uncertain",
    credential: metadata(row, current),
  });
  async function change(
    access,
    token,
    id,
    input,
    action,
    { reauthorize } = {},
  ) {
    inputCheck(input, action);
    if (!activated()) throw new WebError("connections_disabled", 503);
    let result = await policy.selected(access, token, id);
    if (result.current.policyDigest !== input.policyDigest)
      throw new WebError("stale_policy", 409);
    const descriptor = result.current.descriptor;
    if (
      action === "set" &&
      (!descriptor.enabled || !providerActive(descriptor.provider))
    )
      throw new WebError("provider_not_activated", 503);
    const old = await store.metadata(descriptor);
    if (
      (old?.version ?? 0) !== input.expectedVersion ||
      old?.request === input.requestId
    )
      throw new WebError("credential_conflict", 409);
    let health = null;
    if (action === "set")
      health = safeHealth(
        await probeConnection(
          { provider: descriptor.provider, scope: descriptor.scope },
          input.key,
          { fetcher, now },
        ),
        descriptor.provider,
      );
    result = await freshSelection(access, token, id, input, reauthorize);
    let row;
    try {
      const options = { ...input, actor: access.userId, health };
      row =
        action === "set"
          ? await store.put(descriptor, options)
          : await store.remove(descriptor, options);
    } catch {
      row =
        undefined; /* Never retry an uncertain CAS. Reconcile the original intent. */
    }
    if (row?.conflict) throw new WebError("credential_conflict", 409);
    result = await freshSelection(access, token, id, input, reauthorize);
    // Read back exact generation/intent, including a concurrent removal or replacement.
    try {
      row = await store.metadata(descriptor);
    } catch {
      row = undefined;
    }
    await freshSelection(access, token, id, input, reauthorize);
    return outcome(id, input, action, result.current, row, access.userId);
  }
  async function reconcileCredential(
    access,
    token,
    id,
    input,
    { reauthorize } = {},
  ) {
    inputCheck(input, input?.action, true);
    if (!activated()) throw new WebError("connections_disabled", 503);
    const result = await freshSelection(access, token, id, input, reauthorize);
    const row = await store.metadata(result.current.descriptor);
    await freshSelection(access, token, id, input, reauthorize);
    return outcome(id, input, input.action, result.current, row, access.userId);
  }
  return {
    overview,
    detail,
    policyPreview: policy.preview,
    policyApply: policy.apply,
    operation: policy.operation,
    recover: policy.recover,
    setCredential: (access, token, id, input, options) =>
      change(access, token, id, input, "set", options),
    removeCredential: (access, token, id, input, options) =>
      change(access, token, id, input, "remove", options),
    reconcileCredential,
  };
}

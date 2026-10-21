import {
  exact,
  hash,
  numeric,
  requestJson,
  seal,
  WebError,
} from "./common.mjs";
import { hex } from "./connection-policy.mjs";

// There is deliberately no decrypt/get-secret method or RPC in this phase.
export function createConnectionStore(config, fetcher = fetch) {
  const scope = hash(
    JSON.stringify([
      "connection-vault-v1",
      config.appId,
      config.installationId,
      config.workspace.id,
      config.workspace.repoId,
    ]),
  );
  const identity = (descriptor) =>
    hash(JSON.stringify([descriptor.id, descriptor.secretRef]));
  async function rpc(operation, descriptor, options = {}) {
    const value = await requestJson(
      fetcher,
      `${config.storageUrl}/rest/v1/rpc/keel_connection_rpc`,
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
          p_connection: identity(descriptor),
          p_expected: null,
          p_policy: null,
          p_request: null,
          p_actor: null,
          p_value: null,
          p_health: null,
          ...options,
        }),
      },
      70000,
    );
    // Absence is a valid metadata observation; conflict is only a mutation result.
    // A malformed metadata response must never manufacture generation zero.
    if (operation === "metadata" && value === null) return null;
    if (
      operation !== "metadata" &&
      exact(value, ["conflict"]) &&
      value.conflict === true
    )
      return value;
    if (
      !exact(value, [
        "version",
        "state",
        "policy",
        "request",
        "actor",
        "updatedAt",
        "health",
      ]) ||
      !Number.isInteger(value.version) ||
      value.version < 1 ||
      value.version > 2147483647 ||
      !["present", "removed"].includes(value.state) ||
      !hex(value.policy) ||
      !hex(value.request) ||
      !numeric(value.actor) ||
      typeof value.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.updatedAt)) ||
      (value.state === "removed" && value.health !== null)
    )
      throw new WebError("invalid_connection_store");
    return value;
  }
  return {
    metadata: (descriptor) => rpc("metadata", descriptor),
    put(
      descriptor,
      { expectedVersion, policyDigest, requestId, actor, key, health },
    ) {
      const purpose = JSON.stringify([
        "connection-vault-v1",
        scope,
        identity(descriptor),
        policyDigest,
        expectedVersion + 1,
      ]);
      const ciphertext = seal({ key }, config.connectionEncryptionKey, purpose);
      return rpc("put", descriptor, {
        p_expected: expectedVersion,
        p_policy: policyDigest,
        p_request: requestId,
        p_actor: actor,
        p_value: ciphertext,
        p_health: health,
      });
    },
    remove: (descriptor, { expectedVersion, policyDigest, requestId, actor }) =>
      rpc("remove", descriptor, {
        p_expected: expectedVersion,
        p_policy: policyDigest,
        p_request: requestId,
        p_actor: actor,
      }),
  };
}

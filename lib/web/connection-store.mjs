import {
  exact,
  hash,
  numeric,
  requestJson,
  seal,
  unseal,
  WebError,
} from "./common.mjs";
import { hex } from "./connection-policy.mjs";

// Metadata stays ciphertext-free; model execution has a separately gated service-only read.
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
    // Only the fresh-authorized model service may call this, never browser or worker input.
    async readKey(descriptor, { policyDigest, expectedVersion }) {
      if (!hex(descriptor?.secretRef) || typeof descriptor?.id !== "string"
        || !/^[a-z][a-z0-9-]{0,63}$/.test(descriptor.id) || !hex(policyDigest)
        || !Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > 2147483647
        || !Buffer.isBuffer(config.connectionEncryptionKey) || config.connectionEncryptionKey.length !== 32)
        throw new WebError("invalid_connection_read", 400);
      const value = await requestJson(fetcher, `${config.storageUrl}/rest/v1/rpc/keel_model_credential_read`, {
        method: "POST",
        headers: { apikey: config.storageKey, Authorization: `Bearer ${config.storageKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_scope: scope, p_connection: identity(descriptor), p_policy: policyDigest, p_expected: expectedVersion }),
      }, 20000);
      if (exact(value, ["conflict"]) && value.conflict === true) throw new WebError("connection_generation_changed", 409);
      if (!exact(value, ["version", "policy", "value"]) || value.version !== expectedVersion || value.policy !== policyDigest
        || typeof value.value !== "string" || value.value.length > 16384) throw new WebError("invalid_connection_store");
      let decrypted;
      try {
        decrypted = unseal(value.value, config.connectionEncryptionKey,
          JSON.stringify(["connection-vault-v1", scope, identity(descriptor), policyDigest, expectedVersion]));
      } catch { throw new WebError("invalid_connection_store"); }
      if (!exact(decrypted, ["key"]) || typeof decrypted.key !== "string" || !/^[\x21-\x7e]{16,4096}$/.test(decrypted.key))
        throw new WebError("invalid_connection_store");
      return decrypted.key;
    },
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

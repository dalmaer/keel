import packageInfo from "../../package.json" with { type: "json" };

// This epoch is an operator deployment binding outside the restored database.
// It deliberately does not change the key used for durable private ciphertext.
export const authEpoch = (config) => config.recovery?.epoch ?? null;
export const recoveryQuarantined = (config) =>
  config.recovery?.reconciledAt === null;
export const matchesAuthEpoch = (config, value, expected = authEpoch(config)) =>
  authEpoch(config) === expected && (value?.authEpoch ?? null) === expected;

export function deploymentObservation(config, now = Date.now()) {
  const value =
    typeof config.deploymentRevision === "string" &&
    /^[a-f0-9]{40}$/.test(config.deploymentRevision)
      ? config.deploymentRevision
      : null;
  return {
    schema: 1,
    revision: {
      state: value ? "bound" : "unavailable",
      value,
      provenance: "deployment-binding",
    },
    cliVersion: packageInfo.version,
    nodeVersion: process.version,
    observedAt: new Date(now).toISOString(),
    recovery: {
      state: !config.recovery
        ? "not-configured"
        : recoveryQuarantined(config)
          ? "quarantined"
          : "operator-reconciled",
      epoch: authEpoch(config),
      startedAt: config.recovery?.startedAt ?? null,
      reconciledAt: config.recovery?.reconciledAt ?? null,
      provenance: "operator-assertion",
    },
  };
}

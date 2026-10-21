// Synthetic Acme transport composes the real auth, immutable Git and connection services.
import { learningHarness, token } from "./web-learning.mjs";
import { createConnections } from "../../lib/web/connections.mjs";
import { createWebService } from "../../lib/web/server.mjs";
export { token };
export const policyInput = {
  policy: {
    id: "acme-openai",
    provider: "openai",
    label: "Acme API",
    projects: [{ id: "studio", repoId: 102 }],
    enabled: true,
    scope: { organization: null, project: null, workspace: null },
  },
  expectedPolicyDigest: null,
};
export const fakeKey = "fake-acme-provider-credential";
export function connectionsHarness() {
  const h = learningHarness();
  const config = {
    ...h.config,
    connections: {
      enabled: true,
      vaultVerifiedAt: "2026-10-20T00:00:00.000Z",
      providers: {
        openai: "2026-10-20T00:00:00.000Z",
        anthropic: "2026-10-20T00:00:00.000Z",
      },
    },
    connectionEncryptionKey: Buffer.alloc(32, 103),
  };
  const vault = {
    rows: new Map(),
    requests: [],
    lost: false,
    unavailable: false,
    beforeWrite: null,
    afterWrite: null,
  };
  const provider = {
    calls: [],
    status: 200,
    body: { object: "list", data: [{ object: "model", id: "acme-model" }] },
    headers: {},
    beforeResponse: null,
  };
  const fetcher = async (url, options = {}) => {
    const u = new URL(url);
    if (["api.openai.com", "api.anthropic.com"].includes(u.hostname)) {
      provider.calls.push({ url, options });
      if (provider.beforeResponse) await provider.beforeResponse();
      return Response.json(provider.body, {
        status: provider.status,
        headers: provider.headers,
      });
    }
    if (u.pathname === "/rest/v1/rpc/keel_connection_rpc") {
      const p = JSON.parse(options.body),
        key = JSON.stringify([p.p_scope, p.p_connection]);
      vault.requests.push(p);
      if (vault.unavailable) throw new Error("fake-unavailable");
      let row = vault.rows.get(key);
      if (p.p_operation !== "metadata") {
        if (vault.beforeWrite) await vault.beforeWrite(p);
        row = vault.rows.get(key);
        if (
          (row?.version ?? 0) !== p.p_expected ||
          row?.request === p.p_request
        )
          return Response.json({ conflict: true });
        row = {
          version: p.p_expected + 1,
          state: p.p_operation === "put" ? "present" : "removed",
          policy: p.p_policy,
          request: p.p_request,
          actor: p.p_actor,
          updatedAt: new Date(h.state.now).toISOString(),
          health: p.p_health,
          value: p.p_value,
        };
        vault.rows.set(key, row);
        if (vault.afterWrite) await vault.afterWrite(row, p);
        if (vault.lost) {
          vault.lost = false;
          throw new Error("fake-response-lost");
        }
      }
      if (!row) return Response.json(null);
      const { value, ...metadata } = row;
      return Response.json(metadata);
    }
    return h.fetcher(url, options);
  };
  const options = { fetcher, now: () => h.state.now },
    service = createWebService(config, options),
    connections = createConnections(config, options);
  async function seedPolicy(overrides = {}) {
    const descriptor = {
      version: 1,
      ...structuredClone(policyInput.policy),
      secretRef: "f".repeat(64),
      ...overrides,
    };
    h.workspace.files[`connections/${descriptor.id}.json`] =
      `${JSON.stringify(descriptor, null, 2)}\n`;
    return (await connections.detail(h.access, token, descriptor.id))
      .connection;
  }
  return {
    ...h,
    config,
    fetcher,
    service,
    connections,
    vault,
    provider,
    seedPolicy,
  };
}

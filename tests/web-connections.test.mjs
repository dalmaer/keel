import test from "node:test";
import assert from "node:assert/strict";
import {
  connectionsHarness,
  token,
  policyInput,
  fakeKey,
} from "./helpers/web-connections.mjs";
import { createConnections } from "../lib/web/connections.mjs";
import { validatePolicy } from "../lib/web/connection-policy.mjs";
import { configFromEnv, webConfig } from "../lib/web/config.mjs";
import { unseal } from "../lib/web/common.mjs";
const requestId = (n) => n.toString(16).padStart(64, "0");
const options = (h) => ({ reauthorize: async () => h.refreshAccess() });
const intent = (view, n = 1) => ({
  requestId: requestId(n),
  expectedVersion: view.credential.version,
  policyDigest: view.policyDigest,
  key: fakeKey,
});

test("connection policy previews exact private bytes, conditionally commits, and reads original receipt", async () => {
  const h = connectionsHarness(),
    p = await h.connections.policyPreview(h.access, token, policyInput);
  assert.equal(p.canApply, true);
  assert.equal(p.files[0].before, null);
  assert.equal(p.files[0].path, "connections/acme-openai.json");
  assert.equal(
    p.commitMessage,
    `Update Plates connection policy\n\nKeel-Operation: ${p.operationId}`,
  );
  assert.equal(JSON.parse(p.files[0].content).secretRef.length, 64);
  const r = await h.connections.policyApply(h.access, token, p.previewId, {
    digest: p.digest,
    ...options(h),
  });
  assert.equal(r.state, "committed");
  assert.equal(h.workspace.writes.length, 1);
  assert.equal(h.workspace.files[p.files[0].path], p.files[0].content);
  assert.deepEqual(
    await h.connections.operation(h.refreshAccess(), token, r.id),
    r,
  );
});
test("connection policy detects final source and current/proposed scope changes before dispatch", async () => {
  for (const change of ["source", "scope"]) {
    const h = connectionsHarness(),
      p = await h.connections.policyPreview(h.access, token, policyInput);
    const r = await h.connections
      .policyApply(h.access, token, p.previewId, {
        digest: p.digest,
        reauthorize: async () => {
          if (change === "source") h.workspace.head = "e".repeat(40);
          else h.access.projects = [];
          return h.refreshAccess();
        },
      })
      .catch((e) => ({ state: e.code }));
    assert.ok(["refused", "access_denied"].includes(r.state));
    assert.equal(h.workspace.writes.length, 0);
  }
});
test("connection policy lost response recovers the same immutable operation without redispatch", async () => {
  const h = connectionsHarness();
  h.workspace.mode = "lost";
  const p = await h.connections.policyPreview(h.access, token, policyInput);
  const r = await h.connections.policyApply(h.access, token, p.previewId, {
    digest: p.digest,
    ...options(h),
  });
  assert.equal(r.state, "uncertain");
  const recovered = await h.connections.recover(
    h.refreshAccess(),
    token,
    r.id,
    options(h),
  );
  assert.equal(recovered.state, "committed");
  assert.equal(h.workspace.writes.length, 1);
});
test("credential set stores separately bound ciphertext and overview loads metadata only", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy(),
    input = intent(view);
  const r = await h.connections.setCredential(
    h.access,
    token,
    view.id,
    input,
    options(h),
  );
  assert.equal(r.state, "confirmed");
  assert.equal(r.credential.version, 1);
  assert.equal(h.provider.calls.length, 1);
  const put = h.vault.requests.find((p) => p.p_operation === "put");
  assert.ok(!JSON.stringify(put).includes(fakeKey));
  const purpose = JSON.stringify([
    "connection-vault-v1",
    put.p_scope,
    put.p_connection,
    input.policyDigest,
    1,
  ]);
  assert.equal(
    unseal(put.p_value, h.config.connectionEncryptionKey, purpose).key,
    fakeKey,
  );
  assert.throws(() => unseal(put.p_value, h.config.encryptionKey, purpose));
  const before = h.vault.requests.length,
    overview = await h.connections.overview(h.access, token);
  assert.ok(
    h.vault.requests.slice(before).every((p) => p.p_operation === "metadata"),
  );
  assert.ok(!JSON.stringify(overview).includes(fakeKey));
  assert.equal(
    overview.connections[0].credential.health.capacity.pools.length,
    0,
  );
});
test("failed provider rotation retains prior generation and fixed errors contain no secret", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  await h.connections.setCredential(
    h.access,
    token,
    view.id,
    intent(view),
    options(h),
  );
  h.provider.status = 403;
  h.provider.body = { message: fakeKey };
  await assert.rejects(
    h.connections.setCredential(
      h.access,
      token,
      view.id,
      { ...intent(view, 2), expectedVersion: 1 },
      options(h),
    ),
    { code: "provider_denied" },
  );
  assert.equal([...h.vault.rows.values()][0].version, 1);
});
test("final authorization and descriptor change after provider validation prevent vault writes", async () => {
  for (const mode of ["revoked", "changed"]) {
    const h = connectionsHarness(),
      view = await h.seedPolicy();
    await assert.rejects(
      h.connections.setCredential(h.access, token, view.id, intent(view), {
        reauthorize: async () => {
          if (mode === "revoked") h.state.members = [];
          else
            h.workspace.files[view.path] = h.workspace.files[view.path].replace(
              "Acme API",
              "Acme changed",
            );
          return h.refreshAccess();
        },
      }),
    );
    assert.equal(h.vault.rows.size, 0);
  }
});
test("CAS removal tombstone prevents an older in-flight validation restoring a key", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  await h.connections.setCredential(
    h.access,
    token,
    view.id,
    intent(view),
    options(h),
  );
  h.provider.beforeResponse = async () => {
    h.provider.beforeResponse = null;
    const { key, ...remove } = { ...intent(view, 3), expectedVersion: 1 };
    const r = await h.connections.removeCredential(
      h.access,
      token,
      view.id,
      remove,
      options(h),
    );
    assert.equal(r.credential.version, 2);
  };
  await assert.rejects(
    h.connections.setCredential(
      h.access,
      token,
      view.id,
      { ...intent(view, 2), expectedVersion: 1 },
      options(h),
    ),
    { code: "credential_conflict" },
  );
  const row = [...h.vault.rows.values()][0];
  assert.equal(row.state, "removed");
  assert.equal(row.value, null);
});
test("lost CAS response reconciles exact browser-known actor intent without resending key", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy(),
    input = intent(view);
  h.vault.lost = true;
  const r = await h.connections.setCredential(
    h.access,
    token,
    view.id,
    input,
    options(h),
  );
  assert.equal(r.state, "confirmed");
  const { key, ...lookup } = input;
  assert.equal(
    (
      await h.connections.reconcileCredential(
        h.access,
        token,
        view.id,
        { ...lookup, action: "set" },
        options(h),
      )
    ).state,
    "confirmed",
  );
  assert.equal(
    (
      await h.connections.reconcileCredential(
        h.access,
        token,
        view.id,
        { ...lookup, requestId: requestId(2), action: "set" },
        options(h),
      )
    ).state,
    "superseded",
  );
  assert.equal(h.provider.calls.length, 1);
  assert.equal(
    h.vault.requests.filter((p) => p.p_operation === "put").length,
    1,
  );
});
test("changed policy invalidates prior credential metadata and requires explicit new validation", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  await h.connections.setCredential(
    h.access,
    token,
    view.id,
    intent(view),
    options(h),
  );
  h.workspace.files[view.path] = h.workspace.files[view.path].replace(
    "Acme API",
    "Acme renamed",
  );
  const current = (await h.connections.detail(h.access, token, view.id))
    .connection;
  assert.equal(current.credential.binding, "invalid");
  assert.equal(current.credential.health, null);
  await assert.rejects(
    h.connections.setCredential(
      h.access,
      token,
      view.id,
      { ...intent(view, 2), expectedVersion: 1 },
      options(h),
    ),
    { code: "stale_policy" },
  );
});
test("incomplete private inventory refuses mutation and project lens cannot expose other grants", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  const lens = await h.connections.detail(h.access, token, view.id, {
    project: h.access.projects[0],
  });
  assert.equal(lens.connection.descriptor, null);
  assert.equal(lens.connection.capabilities.set, false);
  h.workspace.files["connections/unknown.txt"] = "private unsupported";
  await assert.rejects(
    h.connections.setCredential(
      h.access,
      token,
      view.id,
      intent(view),
      options(h),
    ),
    { code: "connection_source_incomplete" },
  );
  assert.equal(h.provider.calls.length, 0);
});
test("disabled vault and unverified adapter cannot probe or store credentials", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  const disabled = createConnections(
    { ...h.config, connections: undefined },
    { fetcher: h.fetcher, now: () => h.state.now },
  );
  await assert.rejects(
    disabled.setCredential(h.access, token, view.id, intent(view), options(h)),
    { code: "connections_disabled" },
  );
  h.config.connections.providers.openai = null;
  await assert.rejects(
    h.connections.setCredential(
      h.access,
      token,
      view.id,
      intent(view),
      options(h),
    ),
    { code: "provider_not_activated" },
  );
  assert.equal(h.provider.calls.length, 0);
  assert.equal(h.vault.rows.size, 0);
});
test("policy schemas reject unknown fields, coerced IDs and mismatched provider scope", () => {
  const p = {
    version: 1,
    ...structuredClone(policyInput.policy),
    secretRef: "f".repeat(64),
  };
  assert.deepEqual(validatePolicy(p), p);
  for (const invalid of [
    { ...p, key: fakeKey },
    { ...p, id: ["acme"] },
    { ...p, scope: { ...p.scope, workspace: "wrkspc_acme" } },
    { ...p, projects: [{ id: "studio", repoId: "102" }] },
  ])
    assert.throws(() => validatePolicy(invalid));
});
test("unavailable metadata never masquerades as an absent credential or generation zero", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  h.vault.unavailable = true;
  const current = (await h.connections.detail(h.access, token, view.id))
    .connection;
  assert.equal(current.credential.state, "unavailable");
  assert.equal(current.credential.version, null);
  assert.equal(current.capabilities.set, false);
  h.vault.unavailable = false;
  h.vault.afterWrite = async () => {
    h.vault.unavailable = true;
  };
  const r = await h.connections.setCredential(
    h.access,
    token,
    view.id,
    intent(view),
    options(h),
  );
  assert.equal(r.state, "uncertain");
  assert.equal(r.credential.version, null);
  assert.equal(r.credential.state, "unavailable");
});
test("generation ceiling reserves a final removal and rejects unusable further installations", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  await h.connections.setCredential(
    h.access,
    token,
    view.id,
    intent(view),
    options(h),
  );
  const row = [...h.vault.rows.values()][0];
  row.version = 2147483646;
  await assert.rejects(
    h.connections.setCredential(
      h.access,
      token,
      view.id,
      { ...intent(view, 2), expectedVersion: 2147483646 },
      options(h),
    ),
    { code: "invalid_credential_intent" },
  );
  const { key, ...remove } = {
    ...intent(view, 3),
    expectedVersion: 2147483646,
  };
  const r = await h.connections.removeCredential(
    h.access,
    token,
    view.id,
    remove,
    options(h),
  );
  assert.equal(r.state, "confirmed");
  assert.equal(r.credential.version, 2147483647);
  assert.equal([...h.vault.rows.values()][0].value, null);
});
test("same-generation races have one winner, and another actor cannot reconcile its receipt", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  const result = await Promise.allSettled(
    [1, 2].map((n) =>
      h.connections.setCredential(
        h.access,
        token,
        view.id,
        intent(view, n),
        options(h),
      ),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    result.filter(
      (r) => r.status === "rejected" && r.reason.code === "credential_conflict",
    ).length,
    1,
  );
  const row = [...h.vault.rows.values()][0];
  h.config.ownerIds.push(2);
  h.state.members.push(2);
  const other = { ...h.access, userId: 2 },
    input = {
      requestId: row.request,
      expectedVersion: 0,
      policyDigest: view.policyDigest,
      action: "set",
    };
  const r = await h.connections.reconcileCredential(
    other,
    token,
    view.id,
    input,
    { reauthorize: async () => other },
  );
  assert.equal(r.state, "superseded");
});
test("revocation after vault completion suppresses private output without undoing an uncertain write", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  h.vault.afterWrite = async () => {
    h.state.members = [];
  };
  await assert.rejects(
    h.connections.setCredential(
      h.access,
      token,
      view.id,
      intent(view),
      options(h),
    ),
    { code: "access_denied" },
  );
  assert.equal(h.vault.rows.size, 1);
});

test("configuration requires a separate explicit vault wrapping key and exact activation fields", () => {
  const h = connectionsHarness();
  const value = { ...h.input, connections: h.config.connections },
    secret = {
      ...h.secrets,
      connectionEncryptionKey: Buffer.alloc(32, 103).toString("base64"),
    };
  const configured = webConfig(value, secret);
  assert.equal(configured.connectionEncryptionKey.length, 32);
  assert.throws(() => webConfig(value, h.secrets), {
    code: "invalid_service_configuration",
  });
  assert.throws(
    () =>
      webConfig(value, {
        ...secret,
        connectionEncryptionKey: h.secrets.encryptionKey,
      }),
    { code: "invalid_service_configuration" },
  );
  assert.throws(
    () =>
      webConfig(
        {
          ...value,
          connections: {
            ...value.connections,
            endpoint: "https://example.test",
          },
        },
        secret,
      ),
    { code: "invalid_service_configuration" },
  );
  assert.equal(webConfig(h.input, h.secrets).connections, undefined);
});
test("a malformed or duplicate private descriptor never makes a mutation-capable partial catalogue", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  const duplicate = {
    ...JSON.parse(h.workspace.files[view.path]),
    id: "acme-copy",
  };
  h.workspace.files["connections/acme-copy.json"] = JSON.stringify(duplicate);
  const overview = await h.connections.overview(h.access, token);
  assert.ok(overview.gaps.some((g) => g.code === "invalid_connection_source"));
  assert.equal(overview.capabilities.policyWrite, false);
  await assert.rejects(
    h.connections.policyPreview(h.access, token, policyInput),
    { code: "connection_source_incomplete" },
  );
});
test("removing a key needs no successful provider probe, even when the descriptor is disabled", async () => {
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  await h.connections.setCredential(
    h.access,
    token,
    view.id,
    intent(view),
    options(h),
  );
  h.workspace.files[view.path] = h.workspace.files[view.path].replace(
    '"enabled": true',
    '"enabled": false',
  );
  h.provider.status = 503;
  h.config.connections.providers.openai = null;
  const current = (await h.connections.detail(h.access, token, view.id))
    .connection;
  const { key, ...remove } = intent(current, 2),
    r = await h.connections.removeCredential(
      h.access,
      token,
      view.id,
      remove,
      options(h),
    );
  assert.equal(r.state, "confirmed");
  assert.equal(r.credential.state, "removed");
  assert.equal(h.provider.calls.length, 1);
});
test("duplicate policy submission reauthorizes before returning an existing private receipt", async () => {
  const h = connectionsHarness(),
    p = await h.connections.policyPreview(h.access, token, policyInput);
  await h.connections.policyApply(h.access, token, p.previewId, {
    digest: p.digest,
    ...options(h),
  });
  const fresh = h.refreshAccess();
  const fetcher = async (url, opts) => {
    const response = await h.fetcher(url, opts);
    if (
      url.endsWith("/keel_decision_rpc") &&
      JSON.parse(opts.body).p_operation === "reserve"
    )
      h.state.members = [];
    return response;
  };
  const service = createConnections(h.config, {
    fetcher,
    now: () => h.state.now,
  });
  await assert.rejects(
    service.policyApply(fresh, token, p.previewId, {
      digest: p.digest,
      ...options(h),
    }),
    { code: "access_denied" },
  );
  assert.equal(h.workspace.writes.length, 1);
});
test("malformed metadata conflict is unavailable and cannot authorize a probe or vault write", async () => {
  const h = connectionsHarness(),
    seeded = await h.seedPolicy();
  const fetcher = async (url, opts = {}) => {
    if (
      new URL(url).pathname === "/rest/v1/rpc/keel_connection_rpc" &&
      JSON.parse(opts.body).p_operation === "metadata"
    )
      return Response.json({ conflict: true });
    return h.fetcher(url, opts);
  };
  const service = createConnections(h.config, {
    fetcher,
    now: () => h.state.now,
  });
  const view = (await service.detail(h.access, token, seeded.id)).connection;
  let refusal = null;
  try {
    await service.setCredential(
      h.access,
      token,
      seeded.id,
      intent(seeded),
      options(h),
    );
  } catch (error) {
    refusal = error.code;
  }
  assert.deepEqual(
    {
      state: view.credential.state,
      version: view.credential.version,
      set: view.capabilities.set,
      rotate: view.capabilities.rotate,
      refusal,
      probes: h.provider.calls.length,
      writes: h.vault.rows.size,
    },
    {
      state: "unavailable",
      version: null,
      set: false,
      rotate: false,
      refusal: "invalid_connection_store",
      probes: 0,
      writes: 0,
    },
  );
});
test("null mutation responses are malformed and only exact metadata can confirm a credential intent", async () => {
  const { createConnectionStore } =
    await import("../lib/web/connection-store.mjs");
  const h = connectionsHarness(),
    view = await h.seedPolicy();
  const store = createConnectionStore(h.config, async () =>
    Response.json(null),
  );
  await assert.rejects(
    store.put(view.descriptor, { ...intent(view), actor: 1, health: {} }),
    { code: "invalid_connection_store" },
  );
  await assert.rejects(
    store.remove(view.descriptor, { ...intent(view), actor: 1 }),
    { code: "invalid_connection_store" },
  );
  const fetcher = async (url, opts = {}) => {
    if (
      new URL(url).pathname === "/rest/v1/rpc/keel_connection_rpc" &&
      JSON.parse(opts.body).p_operation === "put"
    )
      return Response.json(null);
    return h.fetcher(url, opts);
  };
  const service = createConnections(h.config, {
    fetcher,
    now: () => h.state.now,
  });
  const result = await service.setCredential(
    h.access,
    token,
    view.id,
    intent(view),
    options(h),
  );
  assert.equal(result.state, "uncertain");
  assert.equal(h.vault.rows.size, 0);
});


test("connection environment rename keeps explicit activation and absent-only legacy fallback", () => {
  const h = connectionsHarness();
  const canonical = Buffer.alloc(32, 103).toString("base64");
  const legacy = Buffer.alloc(32, 104).toString("base64");
  const env = {
    PLATES_WEB_CONFIG: JSON.stringify({ ...h.input, connections: h.config.connections }),
    PLATES_GITHUB_CLIENT_SECRET: h.secrets.clientSecret,
    SUPABASE_URL: h.secrets.storageUrl,
    SUPABASE_SERVICE_ROLE_KEY: h.secrets.storageKey,
    PLATES_SESSION_ENCRYPTION_KEY: h.secrets.encryptionKey,
    KEEL_CONNECTION_ENCRYPTION_KEY: legacy,
  };
  assert.deepEqual(configFromEnv({ ...env, PLATES_CONNECTION_ENCRYPTION_KEY: canonical }).connectionEncryptionKey, Buffer.from(canonical, "base64"));
  assert.deepEqual(configFromEnv(env).connectionEncryptionKey, Buffer.from(legacy, "base64"));
  assert.throws(() => configFromEnv({ ...env, PLATES_CONNECTION_ENCRYPTION_KEY: "" }), { code: "invalid_service_configuration" });
  assert.equal(configFromEnv({ ...env, PLATES_WEB_CONFIG: JSON.stringify(h.input) }).connections, undefined);
});

import test from "node:test";
import assert from "node:assert/strict";
import packageInfo from "../package.json" with { type: "json" };
import { harness } from "./helpers/web-http.mjs";
import { webConfig, configFromEnv } from "../lib/web/config.mjs";

const recovery = {
  epoch: "a".repeat(32),
  startedAt: "2026-01-01T00:00:00.000Z",
  reconciledAt: null,
};

test("deployment observation requires fresh authenticated scope and reports only bound revision/runtime facts", async () => {
  const h = harness();
  h.config.deploymentRevision = "b".repeat(40);
  assert.equal((await h.service(h.request("/api/deployment"))).status, 401);
  const { cookie } = await h.login();
  const response = await h.service(h.request("/api/deployment", { cookie }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  assert.deepEqual(result, {
    schema: 1,
    revision: {
      state: "bound",
      value: "b".repeat(40),
      provenance: "deployment-binding",
    },
    cliVersion: packageInfo.version,
    nodeVersion: process.version,
    observedAt: new Date(h.state.now).toISOString(),
    recovery: {
      state: "not-configured",
      epoch: null,
      startedAt: null,
      reconciledAt: null,
      provenance: "operator-assertion",
    },
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /fake-user|fake-client|service-key|encryption|token|verified/,
  );
  h.state.members = [];
  assert.equal(
    (await h.service(h.request("/api/deployment", { cookie }))).status,
    404,
  );
});

test("missing or malformed deployment revision stays unavailable and never reflects input", async () => {
  for (const revision of [
    undefined,
    null,
    "ABC".repeat(20),
    "<script>secret</script>",
    "a".repeat(41),
    ["a".repeat(40)],
  ]) {
    const h = harness();
    h.config.deploymentRevision = revision;
    const { cookie } = await h.login();
    const response = await h.service(h.request("/api/deployment", { cookie }));
    assert.deepEqual((await response.json()).revision, {
      state: "unavailable",
      value: null,
      provenance: "deployment-binding",
    });
  }
  const h = harness(),
    env = {
      KEEL_WEB_CONFIG: JSON.stringify(h.input),
      KEEL_GITHUB_CLIENT_SECRET: h.secrets.clientSecret,
      SUPABASE_URL: h.secrets.storageUrl,
      SUPABASE_SERVICE_ROLE_KEY: h.secrets.storageKey,
      KEEL_SESSION_ENCRYPTION_KEY: h.secrets.encryptionKey,
    };
  assert.equal(
    configFromEnv({ ...env, VERCEL_GIT_COMMIT_SHA: "c".repeat(40) })
      .deploymentRevision,
    "c".repeat(40),
  );
  assert.equal(
    configFromEnv({ ...env, VERCEL_GIT_COMMIT_SHA: "private text" })
      .deploymentRevision,
    null,
  );
});

test("deployment and recovery reject extra queries and deployment refuses revoked project access", async () => {
  const h = harness(),
    { cookie } = await h.login();
  for (const path of [
    "/api/deployment?project=studio",
    "/api/deployment?x=1&x=2",
    "/recovery?returnTo=/",
    "/api/session?extra=1",
  ])
    assert.equal(
      (await h.service(h.request(path, { cookie }))).status,
      400,
      path,
    );
  h.state.repoAccess = false;
  assert.equal(
    (await h.service(h.request("/api/deployment", { cookie }))).status,
    401,
  );
});

test("recovery configuration validates exact permanent epoch and ordered past timestamps", () => {
  const h = harness();
  assert.equal(webConfig(h.input, h.secrets).recovery, undefined);
  assert.deepEqual(
    webConfig({ ...h.input, recovery }, h.secrets).recovery,
    recovery,
  );
  for (const mutate of [
    (v) => (v.epoch = "A".repeat(32)),
    (v) => (v.epoch = ["a".repeat(32)]),
    (v) => (v.epoch = "a".repeat(31)),
    (v) => (v.startedAt = "2026-01-01T00:00:00Z"),
    (v) => (v.startedAt = "2999-01-01T00:00:00.000Z"),
    (v) => (v.reconciledAt = "2025-01-01T00:00:00.000Z"),
    (v) => (v.reconciledAt = "2999-01-01T00:00:00.000Z"),
    (v) => delete v.reconciledAt,
    (v) => (v.extra = true),
  ]) {
    const value = structuredClone(recovery);
    mutate(value);
    assert.throws(() => webConfig({ ...h.input, recovery: value }, h.secrets), {
      code: "invalid_service_configuration",
    });
  }
  const reopened = { ...recovery, reconciledAt: recovery.startedAt };
  assert.deepEqual(
    webConfig({ ...h.input, recovery: reopened }, h.secrets).recovery,
    reopened,
  );
});

test("authenticated recovery HTML has narrow layout, keyboard access, honest labels and working signout", async () => {
  const h = harness();
  h.config.recovery = recovery;
  const { cookie, session, completed } = await h.login();
  assert.equal(completed.headers.get("location"), "/recovery");
  const response = await h.service(h.request("/recovery", { cookie })),
    html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  for (const expected of [
    'name="viewport"',
    "Skip to recovery status",
    'id="main"',
    "Restore verification is in progress",
    "Old workers may still exist",
    "backup completeness",
    "operator",
    "/api/deployment",
    "/api/auth/logout",
  ])
    assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(
    html,
    /localStorage|sessionStorage|<script|fake-user-access/,
  );
  const css = await (await h.service(h.request("/assets/recovery.css"))).text();
  assert.match(css, /width:min\(100%,760px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /prefers-reduced-motion/);
  const health = await h.service(h.request("/api/deployment", { cookie }));
  assert.equal((await health.json()).recovery.state, "quarantined");
  const logout = await h.service(
    h.request("/api/auth/logout", { cookie, body: { csrf: session.csrf } }),
  );
  assert.equal(logout.status, 303);
  assert.equal(
    (await h.service(h.request("/recovery", { cookie }))).status,
    401,
  );
});

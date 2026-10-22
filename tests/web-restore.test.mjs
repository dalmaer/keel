import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/web-http.mjs";
import {
  decisionHarness,
  healthTarget,
  token,
} from "./helpers/web-decisions.mjs";
import { createWebService } from "../lib/web/server.mjs";
import { createStore } from "../lib/web/store.mjs";
import { createAuth } from "../lib/web/auth.mjs";
import { createGitHub } from "../lib/web/github.mjs";
import { createDecisions } from "../lib/web/decisions.mjs";
import { createOperations } from "../lib/web/operations.mjs";
import { hash } from "../lib/web/common.mjs";

const recovery = (epoch = "a", reconciled = false) => ({
  epoch: epoch.repeat(32),
  startedAt: "2026-01-01T00:00:00.000Z",
  reconciledAt: reconciled ? "2026-01-02T00:00:00.000Z" : null,
});
const serialize = (h) =>
  JSON.stringify({ now: h.state.now, records: [...h.state.records] });
function restore(snapshot, epoch = "a", reconciled = false) {
  const h = harness(),
    saved = JSON.parse(snapshot);
  h.state.now = saved.now;
  h.state.records = new Map(saved.records);
  h.config.recovery = recovery(epoch, reconciled);
  return h;
}
const sessionRef = (cookie) =>
  hash(
    cookie
      .split(";")
      .find((c) => c.trim().startsWith("__Host-keel-session="))
      .trim()
      .split("=")[1],
  );
const authFor = (h, fetcher = h.fetcher) =>
  createAuth(
    h.config,
    createStore(h.config, fetcher),
    createGitHub(h.config, fetcher),
    () => h.state.now,
  );
const exchanges = (h) =>
  h.state.requests.filter(
    (r) => r.url === "https://github.com/login/oauth/access_token",
  ).length;
async function loginWith(h, service) {
  const signin = await service(h.request("/signin?returnTo=%2Frecovery"));
  const loginCookie = h.cookieHeader(signin),
    csrf = loginCookie.split("=")[1];
  const started = await service(
    h.request("/api/auth/start", {
      cookie: loginCookie,
      body: { csrf, returnTo: "/recovery" },
    }),
  );
  assert.equal(started.status, 303, await started.clone().text());
  const target = new URL(started.headers.get("location"));
  h.state.challenges.add(target.searchParams.get("code_challenge"));
  const completed = await service(
    h.request(
      `/api/auth/callback?code=fake-code&state=${target.searchParams.get("state")}`,
      { cookie: h.cookieHeader(started) },
    ),
  );
  assert.equal(completed.status, 303, await completed.clone().text());
  const cookie = h.cookieHeader(completed),
    response = await service(h.request("/api/session", { cookie }));
  assert.equal(response.status, 200, await response.clone().text());
  return { cookie, session: await response.json() };
}

test("serialized restore rejects old sessions/callbacks/worker initiators while preserving encrypted private records", async () => {
  const original = harness(),
    old = await original.login(),
    attempt = await original.begin("/daily");
  const key = "f".repeat(64),
    store = createStore(original.config, original.fetcher);
  await store.create(
    "record",
    key,
    { private: "Acme retained owner words", outcome: "unknown" },
    3600,
  );
  assert.equal(
    (await authFor(original).resolveInitiator(sessionRef(old.cookie), 1)).access
      .userId,
    1,
  );
  const snapshot = serialize(original),
    restored = restore(snapshot);
  const privateCipher = restored.state.records.get(`record:${key}`).value;
  assert.equal(
    (
      await restored.service(
        restored.request("/api/deployment", { cookie: old.cookie }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await restored.service(
        restored.request(attempt.path, { cookie: attempt.cookie }),
      )
    ).status,
    400,
  );
  assert.equal(
    exchanges(restored),
    0,
    "old OAuth attempt must fail before exchange",
  );
  await assert.rejects(
    authFor(restored).resolveInitiator(sessionRef(old.cookie), 1),
    { code: "recovery_quarantine" },
  );
  assert.equal(
    restored.state.records.get(`record:${key}`).value,
    privateCipher,
  );
  assert.deepEqual(
    (await createStore(restored.config, restored.fetcher).read("record", key))
      .value,
    { private: "Acme retained owner words", outcome: "unknown" },
  );
  assert.ok(
    restored.config.encryptionKey.equals(original.config.encryptionKey),
  );
  // The untouched backup still has its original auth and private records.
  assert.equal(
    JSON.parse(snapshot).records.length,
    original.state.records.size,
  );
  const reopened = restore(snapshot, "a", true);
  assert.equal(
    (
      await reopened.service(
        reopened.request("/api/deployment", { cookie: old.cookie }),
      )
    ).status,
    401,
  );
  await assert.rejects(
    authFor(reopened).resolveInitiator(sessionRef(old.cookie), 1),
    { code: "sign_in_required" },
  );
  const fresh = await reopened.login();
  assert.equal(
    (
      await reopened.service(
        reopened.request("/api/deployment", { cookie: fresh.cookie }),
      )
    ).status,
    200,
  );
});

test("a later restore epoch invalidates sessions from a previously reconciled restore", async () => {
  const first = harness();
  first.config.recovery = recovery("a", true);
  const old = await first.login(),
    later = restore(serialize(first), "b", true);
  assert.equal(
    (await later.service(later.request("/api/session", { cookie: old.cookie })))
      .status,
    401,
  );
  const fresh = await later.login();
  const model = await (
    await later.service(
      later.request("/api/deployment", { cookie: fresh.cookie }),
    )
  ).json();
  assert.equal(model.recovery.epoch, "b".repeat(32));
  assert.equal(model.recovery.state, "operator-reconciled");
});

test("quarantine blocks every business route family and unknown GETs before any provider or state access", async () => {
  const h = harness();
  h.config.recovery = recovery();
  const { cookie, session } = await h.login();
  const hex = "a".repeat(64);
  const paths = [
    "/",
    "/daily",
    "/learning",
    "/connections",
    "/activity",
    "/routines",
    "/jobs",
    "/versions",
    "/model-policy",
    "/capabilities",
    "/setup",
    `/updates/${hex}`,
    `/learning/operations/${hex}`,
    `/connections/operations/${hex}`,
    `/model-policy/operations/${hex}`,
    "/api/home",
    "/api/projects/studio",
    "/projects/studio/walks",
    "/api/projects/studio/walks/acme/draft",
    "/projects/studio/changes",
    "/api/projects/studio/media/upload",
    `/api/projects/studio/media/${hex}/bytes`,
    `/projects/studio/operations/${hex}`,
    `/api/projects/studio/operations/${hex}`,
    `/api/projects/studio/decisions/apply`,
    "/api/projects/studio/connections",
    "/api/connections/acme/set",
    "/api/projects/studio/model-tasks/run",
    "/api/model-policy/apply",
    "/api/projects/studio/jobs/start",
    `/api/projects/studio/jobs/${hex}/reconcile`,
    "/api/projects/studio/night-retries/apply",
    `/projects/studio/night-retries/${hex}`,
    "/api/projects/studio/night-plan/apply",
    "/api/editor-drafts/daily/acme/save",
    "/api/workers/claim",
    "/api/workers/begin",
    "/api/workers/heartbeat",
    "/api/workers/complete",
    "/api/workers/update-output",
    "/api/future-business-route",
    "/future-business-recovery",
  ];
  const before = serialize(h),
    requests = h.state.requests.length;
  for (const path of paths)
    for (const method of ["GET", "POST"]) {
      const request = new Request(`${h.config.origin}${path}`, {
        method,
        headers: {
          cookie,
          origin: h.config.origin,
          "content-type": "application/json",
          authorization: "Bearer fake-worker",
        },
        ...(method === "POST"
          ? { body: JSON.stringify({ csrf: session.csrf }) }
          : {}),
      });
      const response = await h.service(request);
      assert.equal(
        response.status,
        503,
        `${method} ${path}: ${await response.clone().text()}`,
      );
      if (path.startsWith("/api/"))
        assert.deepEqual(await response.json(), {
          error: "recovery_quarantine",
        });
    }
  assert.equal(h.state.requests.length, requests);
  assert.equal(serialize(h), before);
  assert.equal(
    (await h.service(h.request("/assets/home-client.mjs"))).status,
    200,
  );
  assert.equal(
    (await h.service(h.request("/api/session", { cookie }))).status,
    200,
  );
});

test("epoch activation during renewal refuses the authenticated response", async () => {
  const h = harness();
  h.config.recovery = recovery("a", true);
  const { cookie } = await h.login();
  const fetcher = async (url, options) => {
    const response = await h.fetcher(url, options);
    if (
      new URL(url).pathname === "/rest/v1/rpc/keel_web_rpc" &&
      JSON.parse(options.body).p_operation === "renew"
    )
      h.config.recovery = recovery("b", true);
    return response;
  };
  const service = createWebService(h.config, {
    fetcher,
    now: () => h.state.now,
  });
  assert.equal(
    (await service(h.request("/api/deployment", { cookie }))).status,
    401,
  );
});

test("epoch activation while consuming an OAuth attempt prevents exchange; during exchange prevents session creation", async () => {
  for (const stage of ["consume", "exchange"]) {
    const h = harness();
    h.config.recovery = recovery("a", true);
    const attempt = await h.begin();
    const fetcher = async (url, options) => {
      const response = await h.fetcher(url, options);
      if (
        (stage === "consume" &&
          new URL(url).pathname === "/rest/v1/rpc/keel_web_rpc" &&
          JSON.parse(options.body).p_operation === "consume") ||
        (stage === "exchange" &&
          url === "https://github.com/login/oauth/access_token")
      )
        h.config.recovery = recovery("b", true);
      return response;
    };
    const service = createWebService(h.config, {
      fetcher,
      now: () => h.state.now,
    });
    assert.equal(
      (await service(h.request(attempt.path, { cookie: attempt.cookie })))
        .status,
      400,
    );
    assert.equal(exchanges(h), stage === "consume" ? 0 : 1);
    assert.equal(
      [...h.state.records.keys()].filter((k) => k.startsWith("session:"))
        .length,
      0,
    );
  }
});

test("worker initiator resolution rechecks epoch after fresh provider authorization", async () => {
  const h = harness();
  h.config.recovery = recovery("a", true);
  const { cookie } = await h.login();
  const fetcher = async (url, options) => {
    const response = await h.fetcher(url, options);
    if (new URL(url).pathname === "/user")
      h.config.recovery = recovery("b", true);
    return response;
  };
  await assert.rejects(
    authFor(h, fetcher).resolveInitiator(sessionRef(cookie), 1),
    { code: "sign_in_required" },
  );
});

test("restored original uncertain conditional intent reconciles exact external commit without another write or acceptance", async () => {
  const original = decisionHarness(),
    opts = { fetcher: original.fetcher, now: () => original.state.now };
  const p = await createDecisions(original.config, opts).preview(
    original.access,
    token,
    original.project,
    { target: healthTarget, choice: "accept", reason: "Acme owner decision" },
  );
  original.source.mode = "lost";
  const uncertain = await createOperations(original.config, opts).apply(
    original.access,
    token,
    original.project,
    p.id,
    { reauthorize: async () => original.access },
  );
  assert.equal(uncertain.state, "uncertain");
  assert.equal(original.source.writes.length, 1);
  const snapshot = JSON.stringify({
    auth: JSON.parse(serialize(original)),
    previews: [...original.db.previews],
    operations: [...original.db.operations],
  });
  const restored = decisionHarness(),
    saved = JSON.parse(snapshot);
  restored.state.now = saved.auth.now;
  restored.state.records = new Map(saved.auth.records);
  for (const [id, row] of saved.previews) restored.db.previews.set(id, row);
  for (const [id, row] of saved.operations) restored.db.operations.set(id, row);
  // Provider state is independently observed, not reconstructed from backup.
  Object.assign(restored.source, {
    head: original.source.head,
    files: structuredClone(original.source.files),
    commits: structuredClone(original.source.commits),
    revisions: structuredClone(original.source.revisions),
    mode: "success",
  });
  restored.config.recovery = recovery();
  const quarantined = createWebService(restored.config, {
    fetcher: restored.fetcher,
    now: () => restored.state.now,
  });
  const fresh = await loginWith(restored, quarantined),
    before = JSON.stringify([...restored.db.operations]);
  for (const path of [
    `/api/projects/studio/operations/${p.operationId}`,
    `/projects/studio/operations/${p.operationId}`,
  ])
    assert.equal(
      (await quarantined(restored.request(path, { cookie: fresh.cookie })))
        .status,
      503,
    );
  assert.equal(JSON.stringify([...restored.db.operations]), before);
  assert.equal(restored.source.writes.length, 0);
  // This is an explicit synthetic operator audit assertion, not a test-produced
  // claim that missing effects or backup completeness were reconciled.
  const reopenedConfig = { ...restored.config, recovery: recovery("a", true) };
  const reopened = createWebService(reopenedConfig, {
    fetcher: restored.fetcher,
    now: () => restored.state.now,
  });
  // An authorized audit still cannot settle an effect without provider evidence.
  const externalHistory = restored.source.commits;
  restored.source.commits = [];
  const missingEvidence = await reopened(
    restored.request(`/api/projects/studio/operations/${p.operationId}`, {
      cookie: fresh.cookie,
    }),
  );
  assert.equal(missingEvidence.status, 200, await missingEvidence.clone().text());
  const unresolved = await missingEvidence.json();
  assert.equal(unresolved.state, "uncertain");
  assert.equal(unresolved.receipt, null);
  assert.equal(restored.source.writes.length, 0);
  assert.equal(original.source.writes.length, 1);
  restored.source.commits = externalHistory;
  const response = await reopened(
    restored.request(`/api/projects/studio/operations/${p.operationId}`, {
      cookie: fresh.cookie,
    }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const recovered = await response.json();
  assert.equal(recovered.state, "committed");
  assert.equal(recovered.receipt.commit, original.source.commits[0].sha);
  assert.equal(recovered.receipt.acceptance, "not-established");
  assert.equal(restored.source.writes.length, 0);
  assert.equal(original.source.writes.length, 1);
});

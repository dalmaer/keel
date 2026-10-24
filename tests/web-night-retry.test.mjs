import { readFile } from 'node:fs/promises';
import { PLATES_NIGHT_CANONICAL } from '../lib/web/night-retry-current.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  nightRetryHarness,
  token,
  canonicalFiles,
} from "./helpers/web-night-retry.mjs";
import { createNightRetryStore } from "../lib/web/night-retry-store.mjs";
import { createJobStore } from "../lib/web/job-store.mjs";
import { createDecisionGitHub } from "../lib/web/decision-github.mjs";
import {
  inventoryDigest,
  dependencyDigest,
  validateNightProfile,
} from "../lib/web/night-retry-source.mjs";
import { NIGHT_CANONICAL } from "../lib/web/night-retry-canonical.mjs";
import legacyNightSource from "./helpers/web-night-legacy.mjs";
const input = { runId: 7001, attempt: 2 };
const preview = (h) => h.night.preview(h.access, token, h.project, input);
const apply = (h, p, reauthorize = h.reauthorize) =>
  h.night.apply(
    h.access,
    token,
    h.project,
    { previewId: p.id, digest: p.digest },
    { reauthorize },
  );
async function repin(h) {
  const s = await createDecisionGitHub(token, { fetcher: h.fetcher }).snapshot(
    h.project,
  );
  h.profile.source = {
    commit: s.source.head,
    inventoryDigest: inventoryDigest(s.entries),
  };
  h.profile.review.dependencyClosureDigest = dependencyDigest(s.entries);
  h.register();
}

test("reviewed legacy night archive preserves every pinned Git blob and source provenance", () => {
  assert.equal(legacyNightSource.revision, "24728f21a76988a3be2acba75cb3b96a0c951e23");
  assert.deepEqual(Object.keys(legacyNightSource.files).sort(), Object.keys(NIGHT_CANONICAL).sort());
  for (const [path, source] of Object.entries(legacyNightSource.sources)) {
    assert.equal(source.blob, NIGHT_CANONICAL[path]);
    assert.ok(source.path.startsWith("practices/") && source.path.endsWith(`/files/${path}`));
  }
  for (const [path, body] of Object.entries(canonicalFiles()))
    assert.equal(
      createHash("sha1")
        .update(`blob ${Buffer.byteLength(body)}\0`)
        .update(body)
        .digest("hex"),
      NIGHT_CANONICAL[path],
      path,
    );
  assert.ok(Object.keys(NIGHT_CANONICAL).length >= 27);
});
test("real canonical night profile previews exact effects and sends one native rerun with original actor semantics", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  assert.equal(p.run.actorId, 7);
  assert.equal(p.run.triggeringActorId, 1);
  assert.match(p.semantics, /current UTC date and current plan/);
  assert.match(p.review.statement, /do not prove/);
  assert.equal(p.budget.minutes, 60);
  assert.equal(h.nightState.posts.length, 0);
  const receipt = await apply(h, p);
  assert.equal(receipt.state, "request-accepted");
  assert.equal(receipt.request.accepted, true);
  assert.equal(receipt.request.attribution, "unverified");
  assert.deepEqual(h.nightState.posts, [{ enable_debug_logging: false }]);
  const again = await apply(h, p);
  assert.equal(again.id, receipt.id);
  assert.equal(h.nightState.posts.length, 1);
});
test("lost provider response remains uncertain across reads and successor reconciliation without redispatch or release", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  h.nightState.lost = true;
  const r = await apply(h, p);
  assert.equal(r.state, "uncertain");
  h.nightState.latest.run_attempt = 3;
  h.nightState.latest.conclusion = "success";
  const recovered = await h.night.reconcile(h.access, token, h.project, r.id);
  assert.equal(recovered.state, "uncertain");
  assert.equal(recovered.budget.laneHeld, true);
  assert.equal(recovered.budget.charged, true);
  assert.equal(recovered.observations[0].attribution, "unverified");
  assert.equal(
    (await h.night.operation(h.access, token, h.project, r.id)).id,
    r.id,
  );
  assert.equal(h.nightState.posts.length, 1);
});
test("durable201 settles only fresh completed successor and retains full charge from observation", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h),
    r = await apply(h, p);
  assert.equal(
    (await h.night.reconcile(h.access, token, h.project, r.id)).state,
    "request-accepted",
  );
  h.nightState.latest.run_attempt = 3;
  h.nightState.latest.status = "in_progress";
  h.nightState.latest.conclusion = null;
  assert.equal(
    (await h.night.reconcile(h.access, token, h.project, r.id)).budget.laneHeld,
    true,
  );
  h.nightState.latest.status = "completed";
  h.nightState.latest.conclusion = "failure";
  h.state.now += 5000;
  const settled = await h.night.reconcile(h.access, token, h.project, r.id);
  assert.equal(settled.state, "settled");
  assert.equal(settled.budget.laneHeld, false);
  assert.equal(settled.budget.charged, true);
  assert.equal(
    [...h.nightDb.rows.values()][0].settled_at,
    new Date(h.state.now).toISOString(),
  );
});
test("lost send grant response preserves sending with zero blind resend", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  h.nightState.dbLost = "send";
  await assert.rejects(apply(h, p));
  assert.equal(h.nightState.posts.length, 0);
  assert.equal(
    (await h.night.operation(h.access, token, h.project, p.operationId)).state,
    "sending",
  );
  await apply(h, p);
  assert.equal(h.nightState.posts.length, 0);
});
test("lost durable201 response recovers its saved accepted receipt", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  h.nightState.dbLost = "accepted";
  assert.equal((await apply(h, p)).state, "request-accepted");
  assert.equal(h.nightState.posts.length, 1);
});
test("changed latest attempt or original actor refuses preview", async () => {
  for (const mutate of [
    (h) => h.nightState.latest.run_attempt++,
    (h) => (h.nightState.latest.actor.id = 99),
    (h) => (h.nightState.latest.head_sha = "c".repeat(40)),
    (h) => (h.nightState.latest.workflow_id = 999),
  ]) {
    const h = await nightRetryHarness();
    mutate(h);
    await assert.rejects(preview(h));
    assert.equal(h.nightState.posts.length, 0);
  }
});
test("post-review source drift refuses before reservation or dispatch", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  h.source.files["README.md"] = "changed Acme source";
  await assert.rejects(apply(h, p), { code: "night_source_changed" });
  assert.equal(h.nightState.posts.length, 0);
  assert.equal(h.nightDb.rows.size, 0);
});
test("final fresh permission loss refuses provider effect", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  let calls = 0;
  await assert.rejects(
    apply(h, p, async () => ({
      ...h.access,
      actionsPermission: ++calls === 2 ? "read" : "write",
    })),
    { code: "access_denied" },
  );
  assert.equal(h.nightState.posts.length, 0);
});
test("late successor before send refuses stale reviewed attempt", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  let calls = 0;
  await assert.rejects(
    apply(h, p, async () => {
      if (++calls === 2) h.nightState.latest.run_attempt++;
      return structuredClone(h.access);
    }),
    { code: "night_attempt_changed" },
  );
  assert.equal(h.nightState.posts.length, 0);
});
test("optional effects and downstream workflows refuse even when source inventory is reviewed", async () => {
  for (const change of [
    (cfg) => (cfg.setupToken = "ACME_SECRET"),
    (cfg) => (cfg.production = { enabled: true }),
    (cfg) => (cfg.canvas = { enabled: true }),
    (cfg) => (cfg.robot = { enabled: true }),
    (cfg) => (cfg.keel = "self"),
    (cfg) => (cfg.env = { NODE_OPTIONS: "--require x" }),
  ]) {
    const h = await nightRetryHarness(),
      cfg = JSON.parse(h.source.files[".keel/keel.json"]);
    change(cfg);
    h.source.files[".keel/keel.json"] = JSON.stringify(cfg);
    await repin(h);
    await assert.rejects(preview(h), { code: "night_effects_unsupported" });
  }
  const h = await nightRetryHarness();
  h.source.files[".github/workflows/after.yml"] = "on: workflow_run\njobs: {}";
  await repin(h);
  await assert.rejects(preview(h), { code: "night_downstream_unsupported" });
});
test("canonical report substitution refuses even with newly reviewed inventory", async () => {
  const h = await nightRetryHarness();
  h.source.files["scripts/keel/improve.mjs"] = 'console.log("not the report")';
  await repin(h);
  await assert.rejects(preview(h), { code: "night_canonical_source_required" });
});
test("malformed profiles and dynamically selected commands refuse strictly", async () => {
  const h = await nightRetryHarness();
  for (const mutate of [
    (p) => (p.commands.check = "npm run " + "$CHECK"),
    (p) => (p.commands.setup = ["npm ci"]),
    (p) => (p.effects = []),
    (p) => (p.review.actorId = "1"),
    (p) => (p.review.statement = "trust me"),
  ]) {
    const p = structuredClone(h.profile);
    mutate(p);
    assert.throws(() => validateNightProfile(p));
  }
});
test("missing shared budget, expired run and missing activation remain unavailable", async () => {
  const h = await nightRetryHarness();
  delete h.workspace.files["job-budgets/studio.json"];
  await assert.rejects(preview(h), { code: "shared_job_budget_unavailable" });
  const old = await nightRetryHarness();
  old.nightState.run.created_at = old.nightState.latest.created_at =
    "2026-01-01T00:00:00.000Z";
  await assert.rejects(preview(old), { code: "night_attempt_not_retryable" });
  const disabled = await nightRetryHarness();
  delete disabled.config.nightOperations;
  const model = await disabled.night.inspect(
    disabled.access,
    token,
    disabled.project,
    input,
  );
  assert.equal(model.capabilities.retry, false);
  assert.equal(model.budget.used, null);
  assert.equal(disabled.nightDb.requests.length, 0);
});
test("actor/project authorization and malformed RPC grants never reach provider", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  await assert.rejects(
    h.night.operation(
      { ...h.access, userId: 99 },
      token,
      h.project,
      p.operationId,
    ),
    { code: "access_denied" },
  );
  h.nightState.malformed = (op, v) =>
    op === "send" ? { ...v, changed: false, granted: true } : v;
  await assert.rejects(apply(h, p), { code: "invalid_night_store" });
  assert.equal(h.nightState.posts.length, 0);
});
test("shared job identity matches existing scope and simultaneous retries admit one lane", async () => {
  const h = await nightRetryHarness(),
    a = createNightRetryStore(h.config, h.fetcher),
    b = createJobStore(h.config, h.fetcher);
  assert.equal(a.scope, b.scope);
  assert.equal(a.projectFor(h.project), b.projectFor(h.project));
  const p = await preview(h),
    q = await preview(h);
  const results = await Promise.allSettled([apply(h, p), apply(h, q)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(h.nightState.posts.length, 1);
  assert.equal(
    results.find((r) => r.status === "rejected").reason.code,
    "night_lane",
  );
});
test("reservation consuming exact remaining allowance can still dispatch", async () => {
  const h = await nightRetryHarness();
  h.config.jobs.weeklyMinutes = 60;
  h.profile.weeklyMinutes = 60;
  h.register();
  const p = await preview(h);
  assert.equal((await apply(h, p)).state, "request-accepted");
});
test("interrupted prepared reservation expires safely and late sender never receives grant", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h),
    store = createNightRetryStore(h.config, h.fetcher);
  const saved = await store.preview(p.id, h.project, h.access.userId),
    v = saved.value;
  const intent = {
    kind: "night-retry",
    id: v.operationId,
    actorId: h.access.userId,
    digest: p.digest,
    project: h.project,
    run: v.run,
    profile: v.profileRecord,
    sourceDigest: v.sourceDigest,
  };
  await store.reserve(
    v.operationId,
    h.project,
    h.access.userId,
    p.digest,
    p.id,
    intent,
    120,
    120,
  );
  assert.equal(
    (await h.night.operation(h.access, token, h.project, v.operationId)).state,
    "prepared",
  );
  h.state.now += 900001;
  const result = await store.transition(
    "send",
    v.operationId,
    h.project,
    h.access.userId,
  );
  assert.equal(result.conflict, "state");
  const receipt = await h.night.reconcile(
    h.access,
    token,
    h.project,
    v.operationId,
  );
  assert.equal(receipt.state, "refused");
  assert.equal(receipt.budget.charged, false);
  assert.equal(receipt.budget.laneHeld, false);
  assert.equal(h.nightState.posts.length, 0);
});
test("pre-send reauthorization error refuses only the undispatched reservation", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  await assert.rejects(
    apply(h, p, async () => {
      throw new Error("Acme revoked session");
    }),
  );
  const receipt = await h.night.operation(
    h.access,
    token,
    h.project,
    p.operationId,
  );
  assert.equal(receipt.state, "refused");
  assert.equal(receipt.budget.charged, false);
});
test("actual robot.on, any climb and malformed optional configurations refuse", async () => {
  for (const changes of [
    { robot: { on: true, budgetMinutes: 60 } },
    { climb: {} },
    { production: { sources: [] } },
    { canvas: null },
    { env: 7 },
  ]) {
    const h = await nightRetryHarness();
    Object.assign(changes, {
      name: "Acme Studio",
      repo: "acme/studio",
      check: "npm run check",
      setup: "npm ci --ignore-scripts",
    });
    h.source.files[".keel/keel.json"] = JSON.stringify(changes);
    await repin(h);
    await assert.rejects(preview(h), { code: "night_effects_unsupported" });
  }
});

test("lowered current workspace allowance refuses saved approval before provider dispatch", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  h.config.jobs.weeklyMinutes = 30;
  await assert.rejects(apply(h, p), { code: "night_budget" });
  assert.equal(h.nightState.posts.length, 0);
});
test("prepared resume includes its existing charge once and refuses a newly reduced allowance", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h),
    store = createNightRetryStore(h.config, h.fetcher);
  const saved = await store.preview(p.id, h.project, h.access.userId),
    v = saved.value;
  const intent = {
    kind: "night-retry",
    id: v.operationId,
    actorId: h.access.userId,
    digest: p.digest,
    project: h.project,
    run: v.run,
    profile: v.profileRecord,
    sourceDigest: v.sourceDigest,
  };
  await store.reserve(
    v.operationId,
    h.project,
    h.access.userId,
    p.digest,
    p.id,
    intent,
    120,
    120,
  );
  h.config.jobs.weeklyMinutes = 30;
  await assert.rejects(apply(h, p), { code: "night_budget" });
  assert.equal(
    (await h.night.operation(h.access, token, h.project, p.operationId)).state,
    "refused",
  );
  assert.equal(h.nightState.posts.length, 0);
});
test("provider UTC timestamps without fractional seconds are supported", async () => {
  const h = await nightRetryHarness();
  for (const run of [h.nightState.run, h.nightState.latest])
    for (const key of ["created_at", "updated_at"])
      run[key] = run[key].replace(".000Z", "Z");
  assert.equal((await preview(h)).capabilities.retry, true);
});

test("lowered current shared project allowance refuses stale preview", async () => {
  const h = await nightRetryHarness(),
    p = await preview(h);
  h.workspace.files["job-budgets/studio.json"] = JSON.stringify({
    version: 1,
    projectId: "studio",
    repoId: 102,
    weeklyMinutes: 30,
  });
  await assert.rejects(apply(h, p), { code: "night_budget" });
  assert.equal(h.nightState.posts.length, 0);
});

test("night configuration is optional, independently gated and requires known project profiles plus dated proof", async () => {
  const { harness } = await import("./helpers/web-http.mjs");
  const { webConfig } = await import("../lib/web/config.mjs");
  const h = harness(),
    off = {
      retryEnabled: false,
      planWrites: false,
      verifiedAt: null,
      restoreReconciledAt: null,
      profiles: [],
    };
  assert.equal(webConfig(h.input, h.secrets).nightOperations, undefined);
  assert.deepEqual(
    webConfig({ ...h.input, nightOperations: off }, h.secrets).nightOperations,
    off,
  );
  for (const mutate of [
    (x) => (x.retryEnabled = true),
    (x) => (x.planWrites = true),
    (x) => (x.profiles = ["unknown"]),
    (x) => (x.profiles = ["studio", "studio"]),
    (x) => (x.profiles = "studio"),
    (x) => (x.extra = true),
    (x) => (x.verifiedAt = "2999-01-01T00:00:00.000Z"),
  ]) {
    const n = structuredClone(off);
    mutate(n);
    assert.throws(
      () => webConfig({ ...h.input, nightOperations: n }, h.secrets),
      { code: "invalid_service_configuration" },
    );
  }
  const n = {
    ...off,
    planWrites: true,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    restoreReconciledAt: "2026-01-01T00:00:00.000Z",
  };
  assert.equal(
    webConfig({ ...h.input, nightOperations: n }, h.secrets).nightOperations
      .planWrites,
    true,
  );
});

test("renamed Plates night source refuses legacy retry authority even after inventory repinning", async () => {
  const h = await nightRetryHarness();
  for (const [path, body] of Object.entries(h.source.files)) {
    const renamed = path.replace(".github/workflows/keel-night.yml", ".github/workflows/plates-night.yml").replace("scripts/keel/", "scripts/plates/").replace(".keel/keel.json", ".plates/plates.json");
    if (renamed !== path) {
      h.source.files[renamed] = body;
      delete h.source.files[path];
    }
  }
  await repin(h);
  await assert.rejects(preview(h), { code: "night_canonical_source_required" });
  h.profile.workflow.path = ".github/workflows/plates-night.yml";
  assert.equal(validateNightProfile(h.profile).workflow.path, ".github/workflows/plates-night.yml");
  await repin(h);
  await assert.rejects(preview(h), { code: "night_canonical_source_required" });
  assert.equal(h.nightState.posts.length, 0);
  assert.equal(h.nightDb.rows.size, 0);
});

test('current Plates night retry has a separate exact closure and requires its own reviewed profile', async () => {
  const h=await nightRetryHarness();
  for(const path of Object.keys(NIGHT_CANONICAL))delete h.source.files[path];
  for(const [path,blob] of Object.entries(PLATES_NIGHT_CANONICAL)) {
    const text=await readFile(new URL('../'+path,import.meta.url),'utf8');
    assert.equal(createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex'),blob,path);
    h.source.files[path]=text;
  }
  h.source.files['.plates/plates.json']=h.source.files['.keel/keel.json'];delete h.source.files['.keel/keel.json'];
  // Changing the snapshot alone cannot reuse the legacy profile.
  await repin(h);await assert.rejects(preview(h),{code:'night_canonical_source_required'});
  h.profile.workflow.path='.github/workflows/plates-night.yml';await repin(h);
  const p=await preview(h);assert.ok(p);assert.equal(h.nightState.posts.length,0);
  h.source.files['scripts/plates/names.mjs']+='\n// Acme unreviewed edit\n';await repin(h);
  await assert.rejects(preview(h),{code:'night_canonical_source_required'});
});

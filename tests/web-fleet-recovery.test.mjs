import test from "node:test";
import assert from "node:assert/strict";
import { jobsEnabled } from "../lib/web/job-registry.mjs";
import { modelEnabled } from "../lib/web/model-registry.mjs";
const at = Date.parse("2026-10-21T12:00:00.000Z");
const old = "2026-10-20T00:00:00.000Z";
const current = "2026-10-21T11:00:00.000Z";
const recovery = () => ({
  epoch: "a".repeat(32),
  startedAt: current,
  reconciledAt: current,
});

test("global reopening cannot reuse pre-restore worker or model assertions", () => {
  const config = {
    recovery: recovery(),
    jobs: {
      enabled: true,
      verifiedAt: old,
      restoreReconciledAt: old,
      weeklyMinutes: 120,
    },
    modelRouting: { enabled: true, verifiedAt: old, restoreReconciledAt: old },
    connections: { enabled: true },
    connectionEncryptionKey: "synthetic",
  };
  assert.equal(
    jobsEnabled(config, at),
    false,
    "old worker assertion must not admit restored execution",
  );
  assert.equal(
    modelEnabled(config, at),
    false,
    "old model assertion must not admit restored execution",
  );
});

import { featureRestoreReady } from "../lib/web/recovery.mjs";
import { jobsHarness, token } from "./helpers/web-jobs.mjs";
import { modelHarness, sourceInput } from "./helpers/web-model-tasks.mjs";
import { nightRetryHarness } from "./helpers/web-night-retry.mjs";
import { fleetUpdatesHarness } from "./helpers/web-fleet-updates.mjs";
import { nightPlanHarness, previewPlan } from "./helpers/web-night-plan.mjs";
import { createWebService } from "../lib/web/server.mjs";
import { createJobStore } from "../lib/web/job-store.mjs";

const project = (h) => h.access.projects[0];
const options = (h) => ({ reauthorize: h.refreshAccess ?? h.reauthorize });
const serial = (value) => JSON.parse(JSON.stringify(value));
function copyMap(from, to) {
  const snapshot = JSON.stringify([...from]);
  to.clear();
  for (const [key, value] of JSON.parse(snapshot)) to.set(key, value);
  return snapshot;
}
function restoreAuth(from, to) {
  to.state.now = from.state.now;
  copyMap(from.state.records, to.state.records);
}
function reopen(h) {
  const date = new Date(h.state.now).toISOString();
  h.config.recovery = {
    epoch: "a".repeat(32),
    startedAt: date,
    reconciledAt: date,
  };
}
async function quarantined(h, path, maps, countWrites) {
  const date = new Date(h.state.now).toISOString();
  h.config.recovery = {
    epoch: "a".repeat(32),
    startedAt: date,
    reconciledAt: null,
  };
  const before = JSON.stringify(maps.map((m) => [...m])),
    writes = countWrites();
  const service = createWebService(h.config, {
    fetcher: h.fetcher,
    now: () => h.state.now,
  });
  for (const method of ["GET", "POST"]) {
    const response = await service(
      h.request(path, { method, body: method === "POST" ? "{}" : undefined }),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "recovery_quarantine" });
  }
  assert.equal(JSON.stringify(maps.map((m) => [...m])), before);
  assert.equal(countWrites(), writes);
}
async function jobStart(h) {
  const p = await h.jobs.preview(
    h.access,
    token,
    project(h),
    { routineId: h.routineId, retryOf: null },
    { sessionRef: h.sessionRef },
  );
  return h.jobs.start(
    h.access,
    token,
    project(h),
    { requestId: p.requestId, previewId: p.previewId, digest: p.digest },
    options(h),
  );
}
async function modelStart(h, lost = false) {
  const p = await h.models.prepare(h.access, token, h.project, sourceInput());
  const q = await h.models.quote(
    h.access,
    token,
    h.project,
    { previewId: p.id, digest: p.digest },
    options(h),
  );
  h.model.lost = lost;
  return h.models.run(
    h.access,
    token,
    h.project,
    { quoteId: q.id, digest: q.digest, requestId: "1".repeat(64) },
    options(h),
  );
}
function restoreModel(from, to) {
  restoreAuth(from, to);
  for (const key of ["records", "attempts", "tasks", "cooldowns"])
    copyMap(from.modelDb[key], to.modelDb[key]);
  copyMap(from.vault.rows, to.vault.rows);
  to.modelDb.reservations = serial(from.modelDb.reservations);
}

test("restore assertion requires canonical past dates and global completion independently of activation", () => {
  const config = {
    recovery: recovery(),
    jobs: {
      enabled: true,
      verifiedAt: old,
      restoreReconciledAt: current,
      weeklyMinutes: 120,
    },
    modelRouting: {
      enabled: true,
      verifiedAt: old,
      restoreReconciledAt: current,
    },
    connections: { enabled: true },
    connectionEncryptionKey: "synthetic",
  };
  assert.equal(featureRestoreReady({}, null, at), true);
  for (const value of [
    null,
    old,
    "2026-10-21T11:00:00Z",
    "2026-10-22T00:00:00.000Z",
    [],
    "invalid",
  ])
    assert.equal(featureRestoreReady(config, value, at), false);
  assert.equal(jobsEnabled(config, at), true);
  assert.equal(modelEnabled(config, at), true);
  config.recovery.reconciledAt = null;
  assert.equal(jobsEnabled(config, at), false);
  assert.equal(modelEnabled(config, at), false);
  config.recovery.reconciledAt = current;
  config.jobs.enabled = false;
  config.modelRouting.enabled = false;
  assert.equal(jobsEnabled(config, at), false);
  assert.equal(modelEnabled(config, at), false);
  delete config.recovery;
  config.jobs.enabled = true;
  config.modelRouting.enabled = true;
  config.jobs.restoreReconciledAt = old;
  config.modelRouting.restoreReconciledAt = old;
  assert.equal(jobsEnabled(config, at), true);
  assert.equal(modelEnabled(config, at), true);
});

test("restored lost worker dispatch retains identity and charge; reconciliation never dispatches and revoked scope refuses", async () => {
  const original = await jobsHarness();
  original.actions.lost = true;
  const r = await jobStart(original);
  const restored = await jobsHarness();
  restoreAuth(original, restored);
  copyMap(original.jobDb.rows, restored.jobDb.rows);
  copyMap(original.jobDb.previews, restored.jobDb.previews);
  await quarantined(
    restored,
    `/api/projects/studio/jobs/${r.id}`,
    [restored.jobDb.rows],
    () => restored.actions.dispatches.length,
  );
  reopen(restored);
  restored.config.jobs.enabled = false;
  // Independent provider history is initially absent, not inferred from the DB.
  const unknown = await restored.jobs.reconcile(
    restored.access,
    token,
    project(restored),
    r.id,
    options(restored),
  );
  assert.equal(unknown.id, r.id);
  assert.equal(unknown.state, "uncertain");
  const row = [...restored.jobDb.rows.values()][0];
  assert.equal(row.charged, true);
  restored.state.now += 8 * 86400000;
  const budget = await createJobStore(restored.config, restored.fetcher).budget(
    project(restored),
  );
  assert.equal(budget.projectMinutes, 15);
  copyMap(original.actions.runs, restored.actions.runs);
  copyMap(original.actions.jobs, restored.actions.jobs);
  const observed = await restored.jobs.reconcile(
    restored.access,
    token,
    project(restored),
    r.id,
    options(restored),
  );
  assert.equal(observed.provider.runId, [...original.actions.runs.keys()][0]);
  assert.equal(restored.actions.dispatches.length, 0);
  await assert.rejects(
    restored.jobs.reconcile(restored.access, token, project(restored), r.id, {
      reauthorize: async () => ({ ...restored.access, projects: [] }),
    }),
    { code: "access_denied" },
  );
  assert.equal(restored.actions.dispatches.length, 0);
});

test("restored claimed worker loses initiating authority without releasing its lease or charge", async () => {
  const original = await jobsHarness(),
    r = await jobStart(original),
    identity = original.workerIdentity(r.provider.runId);
  const input = {
    operationId: r.id,
    nonce: "b".repeat(64),
    jobName: "web-worker",
  };
  const claim = await original.jobs.claim(identity, input);
  await original.jobs.begin(identity, {
    ...input,
    fence: claim.fence,
    jobId: claim.jobId,
  });
  const restored = await jobsHarness();
  restoreAuth(original, restored);
  const snapshot = copyMap(original.jobDb.rows, restored.jobDb.rows);
  copyMap(original.actions.runs, restored.actions.runs);
  copyMap(original.actions.jobs, restored.actions.jobs);
  reopen(restored);
  const storedSession = await restored.store.read(
    "session",
    original.sessionRef,
  );
  assert.ok(
    storedSession,
    "the original initiating session exists in restored storage",
  );
  assert.equal(storedSession.value.userId, 1);
  assert.equal(storedSession.value.authEpoch ?? null, null);
  assert.ok(storedSession.value.absoluteExpiry > restored.state.now);
  await assert.rejects(restored.auth.resolveInitiator(original.sessionRef, 1), {
    code: "sign_in_required",
  });
  await assert.rejects(
    restored.jobs.heartbeat(identity, {
      ...input,
      fence: claim.fence,
      jobId: claim.jobId,
      sequence: 1,
    }),
    { code: "sign_in_required" },
  );
  restored.state.now += 120000;
  const expired = await restored.jobs.operation(
    restored.access,
    token,
    project(restored),
    r.id,
  );
  assert.equal(expired.worker.state, "lost");
  assert.equal(JSON.stringify([...restored.jobDb.rows]), snapshot);
  assert.equal(
    (
      await createJobStore(restored.config, restored.fetcher).budget(
        project(restored),
      )
    ).projectMinutes,
    15,
  );
  assert.equal(restored.actions.dispatches.length, 0);
});

test("restored model unknown delivery retains its full ceiling and never creates on reconnect", async () => {
  const original = await modelHarness(),
    r = await modelStart(original, true),
    restored = await modelHarness();
  restoreModel(original, restored);
  await quarantined(
    restored,
    `/api/projects/studio/model-tasks/${r.id}`,
    [restored.modelDb.attempts],
    () => restored.model.calls.length,
  );
  reopen(restored);
  restored.config.modelRouting.enabled = false;
  const result = await restored.models.reconcile(
    restored.access,
    token,
    restored.project,
    r.id,
    options(restored),
  );
  assert.equal(result.id, r.id);
  assert.equal(result.state, "uncertain");
  assert.equal(result.responseId, null);
  assert.equal(result.taskChargedMicroUsd, r.reservedMicroUsd);
  assert.equal(restored.model.calls.length, 0);
  await assert.rejects(
    restored.models.reconcile(restored.access, token, restored.project, r.id, {
      reauthorize: async () => ({ ...restored.access, projects: [] }),
    }),
    { code: "access_denied" },
  );
});

test("restored known model response permits read-only reconciliation while execution remains disabled", async () => {
  const original = await modelHarness(),
    r = await modelStart(original),
    restored = await modelHarness();
  restoreModel(original, restored);
  await quarantined(
    restored,
    `/api/projects/studio/model-tasks/${r.id}`,
    [restored.modelDb.attempts],
    () => restored.model.calls.length,
  );
  reopen(restored);
  restored.config.modelRouting.enabled = false;
  copyMap(original.model.responses, restored.model.responses);
  restored.model.status = "completed";
  const result = await restored.models.reconcile(
    restored.access,
    token,
    restored.project,
    r.id,
    options(restored),
  );
  assert.equal(result.state, "completed");
  assert.equal(result.responseId, r.responseId);
  assert.equal(result.taskChargedMicroUsd, 1200);
  assert.equal(restored.model.calls.length, 1);
  assert.equal(restored.model.calls[0].method, "GET");
  assert.equal(
    (
      await restored.models.prepare(restored.access, token, restored.project, {
        taskId: r.taskId,
      })
    ).canCount,
    false,
  );
});

test("native retry snapshot preserves shared minutes and unresolved lane after time and successor observation", async () => {
  const original = await nightRetryHarness();
  const p = await original.night.preview(
    original.access,
    token,
    original.project,
    { runId: 7001, attempt: 2 },
  );
  original.nightState.lost = true;
  const r = await original.night.apply(
    original.access,
    token,
    original.project,
    { previewId: p.id, digest: p.digest },
    options(original),
  );
  const restored = await nightRetryHarness();
  restoreAuth(original, restored);
  copyMap(original.nightDb.rows, restored.nightDb.rows);
  copyMap(original.nightDb.previews, restored.nightDb.previews);
  await quarantined(
    restored,
    `/api/projects/studio/night-retries/${r.id}`,
    [restored.nightDb.rows],
    () => restored.nightState.posts.length,
  );
  reopen(restored);
  restored.config.nightOperations.retryEnabled = false;
  restored.config.jobs.enabled = false;
  restored.state.now += 8 * 86400000;
  Object.assign(restored.nightState.latest, {
    run_attempt: 3,
    status: "completed",
    conclusion: "success",
    updated_at: new Date(restored.state.now).toISOString(),
  });
  const observed = await restored.night.reconcile(
    restored.access,
    token,
    restored.project,
    r.id,
  );
  assert.equal(observed.state, "uncertain");
  assert.equal(observed.budget.charged, true);
  assert.equal(observed.budget.laneHeld, true);
  assert.equal(observed.observations[0].attribution, "unverified");
  assert.equal(
    (
      await createJobStore(restored.config, restored.fetcher).budget(
        restored.project,
      )
    ).projectMinutes,
    60,
  );
  assert.equal(restored.nightState.posts.length, 0);
  await assert.rejects(
    restored.night.operation(
      { ...restored.access, projects: [] },
      token,
      restored.project,
      r.id,
    ),
    { code: "access_denied" },
  );
});

test("native retry requires both fresh feature assertions and never overrides either disabled gate", async () => {
  const h = await nightRetryHarness();
  reopen(h);
  const date = h.config.recovery.startedAt;
  for (const [jobs, night, jobEnabled, retryEnabled, ready] of [
    [old, date, true, true, false],
    [date, old, true, true, false],
    [date, date, false, true, false],
    [date, date, true, false, false],
    [date, date, true, true, true],
  ]) {
    Object.assign(h.config.jobs, {
      restoreReconciledAt: jobs,
      enabled: jobEnabled,
    });
    Object.assign(h.config.nightOperations, {
      restoreReconciledAt: night,
      retryEnabled,
    });
    const view = await h.night.inspect(h.access, token, h.project, {
      runId: 7001,
      attempt: 2,
    });
    assert.equal(view.capabilities.retry, ready);
  }
  assert.equal(h.nightState.posts.length, 0);
});

test("night plan preview and apply require fresh restore assertion without enabling disabled publication", async () => {
  const h = nightPlanHarness();
  reopen(h);
  const stale = await previewPlan(h);
  assert.equal(stale.canSubmit, false);
  await assert.rejects(
    h.nightPlan.apply(h.access, token, h.project, stale.id, {
      digest: stale.digest,
      publicAcknowledgement: stale.digest,
      reauthorize: async () => h.access,
    }),
    { code: "night_plan_disabled" },
  );
  h.config.nightOperations.restoreReconciledAt = h.config.recovery.startedAt;
  assert.equal((await previewPlan(h)).canSubmit, true);
  h.config.nightOperations.planWrites = false;
  assert.equal((await previewPlan(h)).canSubmit, false);
  assert.equal(h.planState.writes.length, 0);
});

async function publicationReady(h) {
  const roll = await h.fleet.createRollout(
    h.access,
    token,
    { requestId: "1".repeat(64), projectIds: ["studio"], canary: "studio" },
    options(h),
  );
  const p = await h.fleet.preparePreview(
    h.access,
    token,
    project(h),
    { rolloutId: roll.id },
    { sessionRef: h.sessionRef },
  );
  const r = await h.fleet.prepare(
    h.access,
    token,
    project(h),
    {
      rolloutId: roll.id,
      requestId: p.requestId,
      previewId: p.previewId,
      digest: p.digest,
    },
    options(h),
  );
  const identity = h.workerIdentity(r.job.provider.runId),
    input = { operationId: r.id, nonce: "a".repeat(64), jobName: "web-worker" };
  const claim = await h.jobs.claim(identity, input),
    bound = { ...input, fence: claim.fence, jobId: claim.jobId };
  await h.jobs.begin(identity, bound);
  await h.fleet.output(identity, { ...bound, output: h.output() });
  await h.jobs.complete(identity, {
    ...bound,
    sequence: 1,
    result: { state: "succeeded", exitCode: 0 },
  });
  Object.assign(h.actions.runs.get(r.job.provider.runId), {
    status: "completed",
    conclusion: "success",
  });
  await h.fleet.reconcile(h.access, token, r.id, options(h));
  return h.fleet.publicationPreview(h.access, token, project(h), {
    rolloutId: roll.id,
    preparationId: r.id,
  });
}
async function publish(h, p) {
  return h.fleet.publish(
    h.access,
    token,
    project(h),
    {
      rolloutId: p.rolloutId,
      requestId: p.requestId,
      previewId: p.previewId,
      digest: p.digest,
      publicAcknowledgement: p.digest,
    },
    options(h),
  );
}
function restoreFleet(original, restored) {
  restoreAuth(original, restored);
  copyMap(original.fleetDb.rows, restored.fleetDb.rows);
  copyMap(original.jobDb.rows, restored.jobDb.rows);
  copyMap(original.jobDb.previews, restored.jobDb.previews);
  // These are separately observed remote facts, never DB snapshot contents.
  for (const key of ["objects", "refs"])
    copyMap(original.remote[key], restored.remote[key]);
  restored.remote.prs = serial(original.remote.prs);
  copyMap(original.actions.runs, restored.actions.runs);
  copyMap(original.actions.jobs, restored.actions.jobs);
  reopen(restored);
}

test("restored lost update ref or PR reads only original effect and cannot implicitly continue", async () => {
  for (const effect of ["refs", "pulls"]) {
    const original = await fleetUpdatesHarness(),
      p = await publicationReady(original);
    original.remote.lost = effect;
    let r = await publish(original, p);
    for (let n = 0; n < 30 && r.state !== "uncertain"; n++)
      r = await original.fleet.continuePublication(
        original.access,
        token,
        r.id,
        options(original),
      );
    assert.equal(r.state, "uncertain");
    const restored = await fleetUpdatesHarness();
    restoreFleet(original, restored);
    await quarantined(
      restored,
      `/api/updates/${r.id}`,
      [restored.fleetDb.rows],
      () => restored.remote.writes.length,
    );
    reopen(restored);
    restored.config.fleetUpdates.publishEnabled = false;
    const observedRefs = [...restored.remote.refs],
      observedPrs = restored.remote.prs;
    if (effect === "refs") restored.remote.refs.clear();
    else restored.remote.prs = [];
    const missing = await restored.fleet.reconcile(
      restored.access,
      token,
      r.id,
      options(restored),
    );
    assert.equal(missing.state, "uncertain");
    assert.equal(missing.stage, r.stage);
    if (effect === "refs")
      for (const [key, value] of observedRefs)
        restored.remote.refs.set(key, value);
    else restored.remote.prs = observedPrs;
    const recovered = await restored.fleet.reconcile(
      restored.access,
      token,
      r.id,
      options(restored),
    );
    assert.equal(
      recovered.state,
      effect === "refs" ? "publishing" : "committed",
    );
    assert.equal(restored.remote.writes.length, 0);
    const rollout = await restored.fleet.rollout(
      restored.access,
      token,
      p.rolloutId,
    );
    assert.equal(
      rollout.projects[0].state,
      effect === "refs" ? "publishing" : "committed",
    );
    if (effect === "refs") {
      await assert.rejects(
        restored.fleet.continuePublication(
          restored.access,
          token,
          r.id,
          options(restored),
        ),
        { code: "publication_disabled" },
      );
      restored.config.fleetUpdates.publishEnabled = true;
      await assert.rejects(
        restored.fleet.continuePublication(
          restored.access,
          token,
          r.id,
          options(restored),
        ),
        { code: "publication_disabled" },
      );
      assert.equal(restored.remote.prs.length, 0);
    }
    await assert.rejects(
      restored.fleet.reconcile(restored.access, token, r.id, {
        reauthorize: async () => ({ ...restored.access, projects: [] }),
      }),
      { code: "access_denied" },
    );
    assert.equal(restored.remote.writes.length, 0);
  }
});

test("worker start and schedule gates recheck restore freshness before any effect", async () => {
  const h = await jobsHarness();
  const p = await h.jobs.preview(
    h.access,
    token,
    project(h),
    { routineId: h.routineId, retryOf: null },
    { sessionRef: h.sessionRef },
  );
  reopen(h);
  await assert.rejects(
    h.jobs.start(
      h.access,
      token,
      project(h),
      { requestId: p.requestId, previewId: p.previewId, digest: p.digest },
      options(h),
    ),
    { code: "jobs_disabled" },
  );
  assert.equal(h.jobDb.rows.size, 0);
  assert.equal(h.actions.dispatches.length, 0);
  h.config.jobs.restoreReconciledAt = h.config.recovery.startedAt;
  assert.equal(
    (await h.jobs.routine(h.access, token, project(h), h.routineId))
      .capabilities.start,
    true,
  );
  h.config.jobs.enabled = false;
  assert.equal(
    (await h.jobs.routine(h.access, token, project(h), h.routineId))
      .capabilities.start,
    false,
  );
  const scheduled = await jobsHarness({ schedule: true });
  reopen(scheduled);
  const input = { routineId: scheduled.routineId, cron: "0 1 * * *" };
  assert.equal(
    (
      await scheduled.jobs.schedulePreview(
        scheduled.access,
        token,
        project(scheduled),
        input,
      )
    ).canApply,
    false,
  );
  scheduled.config.jobs.restoreReconciledAt =
    scheduled.config.recovery.startedAt;
  assert.equal(
    (
      await scheduled.jobs.schedulePreview(
        scheduled.access,
        token,
        project(scheduled),
        input,
      )
    ).canApply,
    true,
  );
  scheduled.config.jobs.scheduleWrites = false;
  assert.equal(
    (
      await scheduled.jobs.schedulePreview(
        scheduled.access,
        token,
        project(scheduled),
        input,
      )
    ).canApply,
    false,
  );
});

test("model run rechecks the restore assertion after an already reviewed quote", async () => {
  const h = await modelHarness();
  const p = await h.models.prepare(h.access, token, h.project, sourceInput());
  const q = await h.models.quote(
    h.access,
    token,
    h.project,
    { previewId: p.id, digest: p.digest },
    options(h),
  );
  reopen(h);
  await assert.rejects(
    h.models.run(
      h.access,
      token,
      h.project,
      { quoteId: q.id, digest: q.digest, requestId: "2".repeat(64) },
      options(h),
    ),
    { code: "model_routing_disabled" },
  );
  assert.equal(h.modelDb.attempts.size, 0);
  assert.equal(h.model.calls.length, 1);
  h.config.modelRouting.restoreReconciledAt = h.config.recovery.startedAt;
  assert.equal(
    (await h.models.prepare(h.access, token, h.project, sourceInput()))
      .canCount,
    true,
  );
  h.config.modelRouting.enabled = false;
  assert.equal(
    (await h.models.prepare(h.access, token, h.project, sourceInput()))
      .canCount,
    false,
  );
});

test("update preparation and publication gates independently require current restore assertion", async () => {
  const h = await fleetUpdatesHarness(),
    p = await publicationReady(h);
  reopen(h);
  assert.equal(
    (await h.fleet.comparison(h.access, token, project(h))).capabilities
      .prepare,
    false,
  );
  await assert.rejects(publish(h, p), { code: "publication_disabled" });
  assert.equal(h.remote.writes.length, 0);
  h.config.jobs.restoreReconciledAt = h.config.recovery.startedAt;
  assert.equal(
    (await h.fleet.comparison(h.access, token, project(h))).capabilities
      .prepare,
    true,
  );
  h.config.fleetUpdates.enabled = false;
  assert.equal(
    (await h.fleet.comparison(h.access, token, project(h))).capabilities
      .prepare,
    false,
  );
  h.config.fleetUpdates.publishEnabled = false;
  await assert.rejects(publish(h, p), { code: "publication_disabled" });
  assert.equal(h.remote.writes.length, 0);
});

test("restored exact job cancellation keeps legacy activation and one-send grant without admitting starts", async () => {
  const original = await jobsHarness(),
    r = await jobStart(original),
    restored = await jobsHarness();
  restoreAuth(original, restored);
  copyMap(original.jobDb.rows, restored.jobDb.rows);
  copyMap(original.actions.runs, restored.actions.runs);
  copyMap(original.actions.jobs, restored.actions.jobs);
  reopen(restored);
  const view = await restored.jobs.operation(
    restored.access,
    token,
    project(restored),
    r.id,
  );
  assert.equal(view.capabilities.cancel, true);
  assert.equal(
    (
      await restored.jobs.routine(
        restored.access,
        token,
        project(restored),
        restored.routineId,
      )
    ).capabilities.start,
    false,
  );
  await restored.jobs.cancel(
    restored.access,
    token,
    project(restored),
    r.id,
    options(restored),
  );
  await restored.jobs.cancel(
    restored.access,
    token,
    project(restored),
    r.id,
    options(restored),
  );
  assert.deepEqual(restored.actions.cancellations, [r.provider.runId]);
  assert.equal(restored.actions.dispatches.length, 0);
  restored.config.jobs.enabled = false;
  await assert.rejects(
    restored.jobs.cancel(
      restored.access,
      token,
      project(restored),
      r.id,
      options(restored),
    ),
    { code: "jobs_disabled" },
  );
});

test("restored model cancellation uses exact known response and grants at most one cancel while routing disabled", async () => {
  const original = await modelHarness(),
    r = await modelStart(original),
    restored = await modelHarness();
  restoreModel(original, restored);
  copyMap(original.model.responses, restored.model.responses);
  reopen(restored);
  restored.config.modelRouting.enabled = false;
  await restored.models.cancel(
    restored.access,
    token,
    restored.project,
    r.id,
    options(restored),
  );
  await restored.models.cancel(
    restored.access,
    token,
    restored.project,
    r.id,
    options(restored),
  );
  assert.equal(restored.model.calls.length, 1);
  assert.ok(restored.model.calls[0].url.endsWith(`/${r.responseId}/cancel`));
});

test("original model readback and cancellation preserve independent credential-use disablement", async () => {
  const { createModelTasks } = await import("../lib/web/model-tasks.mjs");
  for (const action of ["reconcile", "cancel"])
    for (const disabled of ["connection", "key"]) {
      const h = await modelHarness(),
        r = await modelStart(h);
      h.config.modelRouting.enabled = false;
      if (disabled === "connection") h.config.connections.enabled = false;
      else h.config.connectionEncryptionKey = null;
      let reads = 0;
      const fetcher = async (url, opts) => {
        if (new URL(url).pathname === "/rest/v1/rpc/keel_model_credential_read")
          reads++;
        return h.fetcher(url, opts);
      };
      const models = createModelTasks(h.config, {
          fetcher,
          now: () => h.state.now,
        }),
        before = h.model.calls.length;
      await assert.rejects(
        models[action](h.access, token, h.project, r.id, options(h)),
        { code: "model_connection_changed" },
      );
      assert.equal(reads, 0);
      assert.equal(h.model.calls.length, before);
    }
});

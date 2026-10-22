import test from "node:test";
import assert from "node:assert/strict";
import { jobsHarness, token } from "./helpers/web-jobs.mjs";
import { createJobs } from "../lib/web/jobs.mjs";
import { inspectSchedule, scheduleWorkflow } from "../lib/web/job-schedules.mjs";
const project = (h) => h.access.projects[0];
const opts = (h) => ({ reauthorize: h.refreshAccess });
const preview = (h) =>
  h.jobs.preview(
    h.access,
    token,
    project(h),
    { routineId: h.routineId, retryOf: null },
    { sessionRef: h.sessionRef },
  );
const start = (h, p) =>
  h.jobs.start(
    h.access,
    token,
    project(h),
    { requestId: p.requestId, previewId: p.previewId, digest: p.digest },
    opts(h),
  );

test("cancellation is requested once and does not free lane before observed provider termination", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h));
  const cancelled = await h.jobs.cancel(
    h.access,
    token,
    project(h),
    r.id,
    opts(h),
  );
  assert.equal(cancelled.cancelRequested, true);
  assert.equal(cancelled.state, "queued");
  await h.jobs.cancel(h.access, token, project(h), r.id, opts(h));
  assert.equal(h.actions.cancellations.length, 1);
  await assert.rejects(
    h.jobs.claim(h.workerIdentity(r.provider.runId), {
      operationId: r.id,
      nonce: "a".repeat(64),
      jobName: "web-worker",
    }),
    { code: "worker_stopped" },
  );
  await assert.rejects(start(h, await preview(h)), {
    code: "job_lane_conflict",
  });
});
test("cancel rechecks exact Actions-write permission immediately before its provider effect", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h));
  let checks = 0;
  await assert.rejects(
    h.jobs.cancel(h.access, token, project(h), r.id, {
      reauthorize: async () => {
        checks++;
        if (checks === 2) h.actions.permission = "read";
        return h.refreshAccess();
      },
    }),
    { code: "actions_permission_unavailable" },
  );
  assert.equal(h.actions.cancellations.length, 0);
  assert.equal([...h.jobDb.rows.values()][0].cancel_requested, true);
});
test("confirmed provider terminal permits a fresh linked retry while preserving both budget charges", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h));
  Object.assign(h.actions.runs.get(r.provider.runId), {
    status: "completed",
    conclusion: "failure",
  });
  const ended = await h.jobs.reconcile(
    h.access,
    token,
    project(h),
    r.id,
    opts(h),
  );
  assert.equal(ended.state, "terminal");
  assert.equal(ended.capabilities.retry, true);
  const p = await h.jobs.retryPreview(h.access, token, project(h), r.id, {
    sessionRef: h.sessionRef,
  });
  assert.equal(p.retryOf, r.id);
  assert.notEqual(p.requestId, r.id);
  const retried = await start(h, p);
  assert.equal(retried.retryOf, r.id);
  assert.equal(h.actions.dispatches.length, 2);
  assert.equal(
    (await h.jobs.routine(h.access, token, project(h), h.routineId)).budget
      .reservedMinutes,
    30,
  );
});
test("workspace weekly budget narrows retries without inventing a refund for terminal work", async () => {
  const h = await jobsHarness();
  h.config.jobs.weeklyMinutes = 15;
  const r = await start(h, await preview(h));
  Object.assign(h.actions.runs.get(r.provider.runId), {
    status: "completed",
    conclusion: "success",
  });
  await h.jobs.reconcile(h.access, token, project(h), r.id, opts(h));
  const p = await h.jobs.retryPreview(h.access, token, project(h), r.id, {
    sessionRef: h.sessionRef,
  });
  await assert.rejects(start(h, p), { code: "job_budget_conflict" });
  assert.equal(h.actions.dispatches.length, 1);
});
test("existing project-owned schedule previews and commits only literal cron bytes", async () => {
  const h = await jobsHarness({ schedule: true }),
    before = h.source.files[h.routineId];
  const detail = await h.jobs.routine(h.access, token, project(h), h.routineId);
  assert.equal(detail.capabilities.start, false);
  assert.equal(detail.capabilities.schedule, true);
  const p = await h.jobs.schedulePreview(h.access, token, project(h), {
    routineId: h.routineId,
    cron: "17 9 * * 1",
  });
  assert.equal(p.schedule.timezone, "UTC");
  assert.equal(p.schedule.scheduledMinutes, 15);
  assert.equal(p.files[0].before, before);
  assert.equal(p.files[0].content, before.replace("23 7 * * *", "17 9 * * 1"));
  const r = await h.jobs.scheduleApply(
    h.access,
    token,
    project(h),
    { requestId: p.requestId, previewId: p.previewId, digest: p.digest },
    opts(h),
  );
  assert.equal(r.state, "committed");
  assert.equal(h.source.writes.length, 1);
  assert.equal(h.source.files[h.routineId], p.files[0].content);
  const after = await h.jobs.routine(h.access, token, project(h), h.routineId);
  assert.equal(after.capabilities.schedule, true);
});
test("managed, ambiguous, altered and over-budget schedule sources remain unavailable", async () => {
  for (const change of ["managed", "duplicate", "commands", "budget"]) {
    const h = await jobsHarness({ schedule: true });
    if (change === "managed")
      h.source.files[".keel/lock.json"] = JSON.stringify({
        files: { [h.routineId]: { practice: "night" } },
      });
    if (change === "duplicate")
      h.source.files[h.routineId] = h.source.files[h.routineId].replace(
        "  schedule:",
        '  schedule:\n    - cron: "0 0 * * *"',
      );
    if (change === "commands")
      h.source.files[h.routineId] = h.source.files[h.routineId].replace(
        "npm run typecheck",
        "npm run arbitrary",
      );
    if (change === "budget") {
      h.registration.schedule.maxRunsPer7Days = 1;
      h.source.files[h.routineId] = scheduleWorkflow("23 7 * * 1");
      h.register();
    }
    await assert.rejects(
      h.jobs.schedulePreview(h.access, token, project(h), {
        routineId: h.routineId,
        cron: "18 9 * * *",
      }),
    );
    assert.equal(h.source.writes.length, 0);
  }
});
test("schedule source conflicts and workflow permission loss refuse writes", async () => {
  for (const mode of ["source", "permission"]) {
    const h = await jobsHarness({ schedule: true }),
      p = await h.jobs.schedulePreview(h.access, token, project(h), {
        routineId: h.routineId,
        cron: "17 9 * * 1",
      });
    const r = await h.jobs.scheduleApply(
      h.access,
      token,
      project(h),
      { requestId: p.requestId, previewId: p.previewId, digest: p.digest },
      {
        reauthorize: async () => {
          if (mode === "source") h.source.head = "e".repeat(40);
          else h.actions.workflowsPermission = "read";
          return h.refreshAccess();
        },
      },
    );
    assert.equal(r.state, "refused");
    assert.equal(h.source.writes.length, 0);
  }
});
test("lost schedule commit response recovers original immutable operation without repeating write", async () => {
  const h = await jobsHarness({ schedule: true }),
    p = await h.jobs.schedulePreview(h.access, token, project(h), {
      routineId: h.routineId,
      cron: "17 9 * * 1",
    });
  h.source.mode = "lost";
  const r = await h.jobs.scheduleApply(
    h.access,
    token,
    project(h),
    { requestId: p.requestId, previewId: p.previewId, digest: p.digest },
    opts(h),
  );
  assert.equal(r.state, "uncertain");
  const recovered = await h.jobs.reconcile(
    h.access,
    token,
    project(h),
    r.id,
    opts(h),
  );
  assert.equal(recovered.state, "committed");
  assert.equal(h.source.writes.length, 1);
});

test("provider termination preserves a claimed worker whose final result is unavailable", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h));
  const identity = h.workerIdentity(r.provider.runId);
  const input = {
    operationId: r.id,
    nonce: "a".repeat(64),
    jobName: "web-worker",
  };
  const held = await h.jobs.claim(identity, input);
  await h.jobs.begin(identity, {
    ...input,
    fence: held.fence,
    jobId: held.jobId,
  });
  assert.equal(
    (await h.jobs.operation(h.access, token, project(h), r.id)).worker.state,
    "running",
  );
  await h.jobs.cancel(h.access, token, project(h), r.id, opts(h));
  Object.assign(h.actions.runs.get(r.provider.runId), {
    status: "completed",
    conclusion: "cancelled",
  });
  const ended = await h.jobs.reconcile(
    h.access,
    token,
    project(h),
    r.id,
    opts(h),
  );
  assert.equal(ended.state, "terminal");
  assert.equal(ended.worker.state, "result-unavailable");
  assert.equal(ended.worker.result, null);
  assert.equal(ended.worker.deadline, new Date(held.deadline).toISOString());
});


test("schedule ownership follows canonical locks and refuses unavailable canonical evidence", async () => {
  for (const path of [".plates/lock.json", ".keel/lock.json"]) {
    const h = await jobsHarness({ schedule: true });
    h.source.files[path] = JSON.stringify({ files: { [h.routineId]: { practice: "night" } } });
    await assert.rejects(h.jobs.schedulePreview(h.access, token, project(h), { routineId: h.routineId, cron: "17 9 * * 1" }), { code: "schedule_managed_source" });
    assert.equal(h.source.writes.length, 0);
  }
  for (const mode of ["malformed", "missing-blob", "denied"]) {
    const h = await jobsHarness({ schedule: true });
    const reads = [];
    const checked = { registry: h.registration, content: h.source.files[h.routineId], snapshot: {
      entries: new Map([[".plates/lock.json", {}], [".keel/lock.json", {}]]),
      reader: { async readFile(path) {
        reads.push(path);
        if (path === ".keel/lock.json") return Buffer.from('{"files":{}}');
        if (mode === "malformed") return Buffer.from('{invalid');
        throw Object.assign(new Error("unavailable"), mode === "denied" ? { status: 401 } : { code: "ENOENT" });
      } },
    } };
    await assert.rejects(inspectSchedule(checked, "17 9 * * 1"), mode === "denied" ? { status: 401 } : { code: "schedule_ownership_unavailable" });
    assert.deepEqual(reads, [".plates/lock.json"]);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { jobsHarness, token, blob } from "./helpers/web-jobs.mjs";
import { createJobs } from "../lib/web/jobs.mjs";
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
const body = (r) => ({
  operationId: r.id,
  nonce: "a".repeat(64),
  jobName: "web-worker",
});

test("duplicate start reserves one lane and dispatches one exact numeric workflow effect", async () => {
  const h = await jobsHarness(),
    p = await preview(h);
  const results = await Promise.all([start(h, p), start(h, p)]);
  assert.equal(h.actions.dispatches.length, 1);
  assert.equal(h.jobDb.rows.size, 1);
  assert.equal(results[0].id, results[1].id);
  assert.deepEqual(h.actions.dispatches[0], {
    ref: "main",
    inputs: { keel_operation: p.requestId },
    return_run_details: true,
  });
  assert.ok(!JSON.stringify(results).includes(h.sessionRef));
  assert.ok(!JSON.stringify(p).includes(h.sessionRef));
  const q = await preview(h);
  await assert.rejects(start(h, q), { code: "job_lane_conflict" });
});
test("lost dispatch is retained and reconciles exact source title without redispatch", async () => {
  const h = await jobsHarness(),
    p = await preview(h);
  h.actions.lost = true;
  const first = await start(h, p);
  assert.equal(first.state, "uncertain");
  const r = await h.jobs.reconcile(
    h.access,
    token,
    project(h),
    first.id,
    opts(h),
  );
  assert.equal(r.provider.runId, 9001);
  assert.equal(h.actions.dispatches.length, 1);
});
test("lost claim response recovers original fence and deadline while begin grants execution once", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h)),
    identity = h.workerIdentity(r.provider.runId),
    b = body(r);
  h.jobDb.lost = "claim";
  await assert.rejects(h.jobs.claim(identity, b));
  const original = [...h.jobDb.rows.values()][0],
    saved = {
      fence: original.fence,
      deadline: original.deadline,
      lease: original.lease_until,
    };
  h.state.now += 1000;
  const held = await h.jobs.claim(identity, b);
  assert.equal(held.fence, saved.fence);
  assert.equal(held.deadline, Date.parse(saved.deadline));
  assert.equal(held.leaseExpiresAt, Date.parse(saved.lease));
  await assert.rejects(
    h.jobs.claim(identity, { ...b, nonce: "b".repeat(64) }),
    { code: "worker_claim_conflict" },
  );
  const begun = await h.jobs.begin(identity, {
    ...b,
    fence: held.fence,
    jobId: held.jobId,
  });
  assert.equal(begun.granted, true);
  await assert.rejects(
    h.jobs.begin(identity, { ...b, fence: held.fence, jobId: held.jobId }),
    { code: "worker_grant_refused" },
  );
});
test("lost begin response cannot produce a second execution grant and lease expiry never frees lane", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h)),
    i = h.workerIdentity(r.provider.runId),
    b = body(r),
    held = await h.jobs.claim(i, b),
    heldBody = { ...b, fence: held.fence, jobId: held.jobId };
  h.jobDb.lost = "begin";
  await assert.rejects(h.jobs.begin(i, heldBody));
  await assert.rejects(h.jobs.begin(i, heldBody), {
    code: "worker_grant_refused",
  });
  h.state.now += 61000;
  const view = await h.jobs.operation(h.access, token, project(h), r.id);
  assert.equal(view.worker.state, "lost");
  await assert.rejects(h.jobs.heartbeat(i, { ...heldBody, sequence: 1 }), {
    code: "worker_grant_refused",
  });
  await assert.rejects(start(h, await preview(h)), {
    code: "job_lane_conflict",
  });
});
test("stale source and revoked initiating session prevent dispatch or worker claim", async () => {
  const h = await jobsHarness(),
    p = await preview(h);
  h.source.head = "e".repeat(40);
  await assert.rejects(start(h, p), { code: "job_source_changed" });
  assert.equal(h.actions.dispatches.length, 0);
  h.source.head = "b".repeat(40);
  const r = await start(h, await preview(h));
  await h.store.revoke(h.sessionRef);
  await assert.rejects(
    h.jobs.claim(h.workerIdentity(r.provider.runId), body(r)),
  );
  assert.equal([...h.jobDb.rows.values()][0].nonce, null);
});
test("forged repository, actor, attempt, workflow and checkout identities never receive a grant", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h)),
    i = h.workerIdentity(r.provider.runId);
  for (const patch of [
    { repositoryId: 103 },
    { actorId: 2 },
    { runAttempt: 2 },
    { workflowSha: "e".repeat(40) },
    { sha: "e".repeat(40) },
    { jobWorkflowRef: "acme/other/worker@main" },
  ])
    await assert.rejects(h.jobs.claim({ ...i, ...patch }, body(r)), {
      code: "worker_identity_denied",
    });
  assert.equal([...h.jobDb.rows.values()][0].nonce, null);
});
test("worker completion and old fence cannot declare provider termination or permit retry", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h)),
    i = h.workerIdentity(r.provider.runId),
    b = body(r),
    held = await h.jobs.claim(i, b),
    input = { ...b, fence: held.fence, jobId: held.jobId };
  await h.jobs.begin(i, input);
  await assert.rejects(
    h.jobs.heartbeat(i, { ...input, fence: held.fence + 1, sequence: 1 }),
    { code: "worker_identity_denied" },
  );
  await h.jobs.complete(i, {
    ...input,
    sequence: 1,
    result: { state: "succeeded", exitCode: 0 },
  });
  const current = await h.jobs.operation(h.access, token, project(h), r.id);
  assert.equal(current.state, "worker-complete");
  assert.equal(current.capabilities.retry, false);
  await assert.rejects(
    h.jobs.retryPreview(h.access, token, project(h), r.id, {
      sessionRef: h.sessionRef,
    }),
    { code: "retry_requires_terminal" },
  );
});
test("changed trusted source and larger installed timeout cannot masquerade as the bounded adapter", async () => {
  const h = await jobsHarness();
  h.source.files[h.routineId] = h.source.files[h.routineId].replace(
    "timeout-minutes: 15",
    "timeout-minutes: 60",
  );
  h.registration.workflow.workflowBlob = blob(h.source.files[h.routineId]);
  h.register();
  await assert.rejects(preview(h), { code: "worker_source_unsupported" });
  assert.equal(h.actions.dispatches.length, 0);
});
test("malformed nested job metadata and metadata conflicts never expose receipts or enable retry", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h));
  for (const mutation of [
    (row) => {
      row.provider = { state: "completed" };
    },
    (row) => {
      row.worker_result = { state: null, exitCode: 0 };
    },
    (row) => {
      row.state = "terminal";
      row.provider = null;
    },
  ]) {
    h.jobDb.malformed = (op, value) => {
      const clone = structuredClone(value);
      if (op === "read") mutation(clone.row);
      return clone;
    };
    await assert.rejects(h.jobs.operation(h.access, token, project(h), r.id), {
      code: "invalid_job_store",
    });
  }
  h.jobDb.malformed = (op, value) =>
    op === "read" ? { conflict: "state" } : value;
  await assert.rejects(h.jobs.operation(h.access, token, project(h), r.id), {
    code: "invalid_job_store",
  });
});
test("unsupported activation and cross-project access cannot create reservations", async () => {
  const h = await jobsHarness(),
    p = await preview(h);
  h.config.jobs.enabled = false;
  await assert.rejects(start(h, p), { code: "jobs_disabled" });
  assert.equal(h.jobDb.rows.size, 0);
  await assert.rejects(
    h.jobs.overview({ ...h.access, projects: [] }, token, project(h)),
    { code: "access_denied" },
  );
});
test("returned run identity rejects a competing authenticated claim even with matching title and source", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h));
  h.actions.runs.set(9002, { ...h.actions.runs.get(9001), id: 9002 });
  h.actions.jobs.set(9002, [
    { ...h.actions.jobs.get(9001)[0], id: 10002, run_id: 9002 },
  ]);
  await assert.rejects(h.jobs.claim(h.workerIdentity(9002), body(r)), {
    code: "worker_identity_denied",
  });
  assert.equal([...h.jobDb.rows.values()][0].nonce, null);
});
test("ambiguous and incomplete recovery searches never select a newest similar run or redispatch", async () => {
  for (const mode of ["ambiguous", "incomplete"]) {
    const h = await jobsHarness();
    h.actions.lost = true;
    const r = await start(h, await preview(h));
    if (mode === "ambiguous")
      h.actions.runs.set(9002, { ...h.actions.runs.get(9001), id: 9002 });
    else
      for (let id = 9002; id <= 9302; id++)
        h.actions.runs.set(id, {
          ...h.actions.runs.get(9001),
          id,
          display_title: "Acme other operation",
        });
    await assert.rejects(
      h.jobs.reconcile(h.access, token, project(h), r.id, opts(h)),
      {
        code: mode === "ambiguous" ? "job_run_conflict" : "job_scan_incomplete",
      },
    );
    assert.equal(h.actions.dispatches.length, 1);
    assert.equal([...h.jobDb.rows.values()][0].state, "uncertain");
  }
});
test("heartbeat uses current initiating permissions and cannot continue after Actions-write loss", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h)),
    i = h.workerIdentity(r.provider.runId),
    b = body(r),
    held = await h.jobs.claim(i, b),
    input = { ...b, fence: held.fence, jobId: held.jobId };
  await h.jobs.begin(i, input);
  h.actions.permission = "read";
  await assert.rejects(h.jobs.heartbeat(i, { ...input, sequence: 1 }), {
    code: "job_source_changed",
  });
  assert.equal([...h.jobDb.rows.values()][0].sequence, 0);
});
test("membership revocation during atomic begin suppresses its execution grant response", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h)),
    i = h.workerIdentity(r.provider.runId),
    b = body(r),
    held = await h.jobs.claim(i, b);
  h.jobDb.after = async (op) => {
    if (op === "begin") h.state.members = [];
  };
  await assert.rejects(
    h.jobs.begin(i, { ...b, fence: held.fence, jobId: held.jobId }),
  );
  assert.equal([...h.jobDb.rows.values()][0].state, "running");
  assert.equal([...h.jobDb.rows.values()][0].charged, true);
});
test("worker deadline includes provider-observed setup and cannot grant a fresh runtime allowance", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h));
  h.actions.jobs.get(r.provider.runId)[0].started_at = new Date(
    h.state.now - 60000,
  ).toISOString();
  const held = await h.jobs.claim(h.workerIdentity(r.provider.runId), body(r));
  assert.equal(held.deadline, h.state.now + 14 * 60000);
});
test("an impossible external begin result never becomes an execution grant", async () => {
  const h = await jobsHarness(),
    r = await start(h, await preview(h)),
    i = h.workerIdentity(r.provider.runId),
    b = body(r),
    held = await h.jobs.claim(i, b);
  h.jobDb.malformed = (op, value) => {
    const result = structuredClone(value);
    if (op === "begin" && result.row) {
      result.changed = false;
      result.granted = true;
      result.row.state = "claimed";
    }
    return result;
  };
  await assert.rejects(
    h.jobs.begin(i, { ...b, fence: held.fence, jobId: held.jobId }),
    { code: "invalid_job_store" },
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { learningHarness, token } from "./helpers/web-learning.mjs";
import { createMigration } from "../lib/web/migration.mjs";
import { createOperations } from "../lib/web/operations.mjs";
import { createGitHub } from "../lib/web/github.mjs";
import { lessonId, validateLesson } from "../lib/web/learning-model.mjs";
import { lessonFingerprint } from "../practices/night/files/scripts/keel/lib.mjs";
const fresh = (h) => () =>
  createGitHub(h.config, h.fetcher).access(token, h.access.userId);
async function preview(h, count = 1) {
  const records = (await h.learning.project(h.access, token, h.project))
    .records;
  return h.migration.preview(h.access, token, {
    selection: records.slice(0, count).map((record) => record.selection),
  });
}
const apply = (h, p, reauthorize = fresh(h)) =>
  h.migration.apply(h.access, token, p.id, { digest: p.digest, reauthorize });

test("migration previews and atomically copies three exact typed files to immutable private Ref without changing originals", async () => {
  const h = learningHarness(),
    original = structuredClone(h.source.files),
    p = await preview(h, 3);
  assert.equal(p.canSubmit, true);
  assert.equal(p.source.visibility, "private");
  assert.equal(p.files.length, 3);
  assert.equal(p.operationUrl, `/learning/operations/${p.operationId}`);
  for (const file of p.files) {
    assert.equal(file.before, null);
    assert.equal(file.originalBlob, null);
    validateLesson(JSON.parse(file.content));
  }
  const result = await apply(h, p);
  assert.equal(result.state, "committed");
  assert.equal(result.receipt.acceptance, "not-established");
  assert.equal(h.workspace.writes.length, 1);
  assert.equal(h.source.writes.length, 0);
  assert.deepEqual(h.source.files, original);
  const write = h.workspace.writes[0];
  assert.deepEqual(write.branch, { id: "REF_acme_101_main" });
  assert.equal(write.expectedHeadOid, "a".repeat(40));
  assert.equal(
    `${write.message.headline}\n\n${write.message.body}`,
    p.commitMessage,
  );
  assert.deepEqual(
    write.fileChanges.additions.map((f) => [
      f.path,
      Buffer.from(f.contents, "base64").toString(),
    ]),
    p.files.map((f) => [f.path, f.content]),
  );
  assert.deepEqual(
    result.receipt.paths,
    p.files.map((f) => f.path),
  );
  assert.ok(
    [...h.db.operations.values()].every(
      (row) => !row.value.includes(p.files[0].content),
    ),
  );
});

test("identical existing lessons are read-only no-ops preserving original import attribution and bytes", async () => {
  const h = learningHarness(),
    p = await preview(h);
  await apply(h, p);
  h.refreshAccess();
  const path = p.files[0].path,
    value = JSON.parse(h.workspace.files[path]);
  value.imported = { actorId: 7, at: "2025-01-01T00:00:00.000Z" };
  const raw = ` \n${JSON.stringify(value)}\n `;
  h.workspace.files[path] = raw;
  const next = await preview(h);
  assert.equal(next.state, "noop");
  assert.equal(next.canSubmit, false);
  assert.equal(next.files.length, 0);
  assert.equal(next.unchanged[0].content, raw);
  await assert.rejects(apply(h, next), { code: "nothing_to_copy" });
  assert.equal(h.workspace.writes.length, 1);
  value.guard = "Different owner content";
  h.workspace.files[path] = JSON.stringify(value);
  await assert.rejects(preview(h), { code: "destination_conflict" });
});

test("migration independent gate and fresh App/user permissions refuse writes without enabling project decisions", async () => {
  for (const mode of ["gate", "app", "user"]) {
    const h = learningHarness();
    if (mode === "gate")
      h.migration = createMigration(
        { ...h.config, workspaceWrites: false, decisionWrites: true },
        { fetcher: h.fetcher, now: () => h.state.now },
      );
    if (mode === "app") {
      h.access.contentsPermission = "read";
      h.state.contentsPermission = "read";
    }
    if (mode === "user") h.workspace.push = false;
    const p = await preview(h);
    assert.equal(p.canSubmit, false);
    if (mode === "gate")
      await assert.rejects(apply(h, p), { code: "submission_disabled" });
    else assert.equal((await apply(h, p)).state, "refused");
    assert.equal(h.workspace.writes.length, 0);
  }
});

test("migration refuses changed source revision, source bytes and destination head before dispatch", async () => {
  for (const mode of ["revision", "bytes", "destination"]) {
    const h = learningHarness(),
      p = await preview(h);
    if (mode === "revision") h.source.head = "e".repeat(40);
    if (mode === "bytes")
      h.source.files["docs/lessons.md"] += "\nOwner edited source.\n";
    if (mode === "destination") {
      h.workspace.head = "e".repeat(40);
      h.refreshAccess();
    }
    const result = await apply(h, p);
    assert.equal(result.state, "refused");
    assert.equal(h.workspace.writes.length, 0);
  }
});

test("migration denies changed private visibility and membership and rejects removed source access on final reauthorization", async () => {
  for (const mode of ["private", "membership", "source"]) {
    const h = learningHarness(),
      p = await preview(h);
    if (mode === "private") h.workspace.private = false;
    if (mode === "membership") h.state.members = [];
    if (mode === "source") h.state.repoAccess = false;
    await assert.rejects(apply(h, p), { code: "access_denied" });
    assert.equal(h.workspace.writes.length, 0);
  }
});

test("same preview concurrent submits dispatch once and later retry returns original committed receipt", async () => {
  const h = learningHarness(),
    p = await preview(h);
  let release, dispatched;
  const ready = new Promise((resolve) => {
    dispatched = resolve;
  });
  h.workspace.hold = new Promise((resolve) => {
    release = resolve;
  });
  h.workspace.onDispatch = dispatched;
  const first = apply(h, p);
  await ready;
  const second = await apply(h, p);
  assert.equal(second.state, "dispatched");
  assert.equal(second.id, p.operationId);
  release();
  assert.equal((await first).state, "committed");
  h.refreshAccess();
  assert.equal((await apply(h, p)).state, "committed");
  assert.equal(h.workspace.writes.length, 1);
});

test("response loss recovers exact original copy by immutable identity without another dispatch", async () => {
  const h = learningHarness(),
    p = await preview(h, 2);
  h.workspace.mode = "lost";
  const result = await apply(h, p);
  assert.equal(result.state, "uncertain");
  h.refreshAccess();
  const recovered = await h.migration.recover(h.access, token, result.id);
  assert.equal(recovered.state, "committed");
  assert.deepEqual(
    recovered.receipt.paths,
    p.files.map((f) => f.path),
  );
  assert.equal(h.workspace.writes.length, 1);
  await h.migration.recover(h.access, token, result.id);
  assert.equal(h.workspace.writes.length, 1);
});

test("unproven response loss keeps workspace reservation and never releases it for unchanged HEAD", async () => {
  const h = learningHarness(),
    p = await preview(h);
  h.workspace.mode = "never";
  const result = await apply(h, p);
  assert.equal(result.state, "uncertain");
  h.state.now += 300000;
  assert.equal(
    (await h.migration.recover(h.access, token, result.id)).state,
    "uncertain",
  );
  const second = await preview(h);
  await assert.rejects(apply(h, second), { code: "workspace_busy" });
  assert.equal(h.workspace.writes.length, 1);
});

test("migration recovery refuses wrong immutable proof identity and denies changed membership or source access", async () => {
  const h = learningHarness(),
    p = await preview(h);
  h.workspace.mode = "lost";
  const result = await apply(h, p);
  h.refreshAccess();
  h.workspace.wrongProofRepository = true;
  assert.equal(
    (await h.migration.recover(h.access, token, result.id)).state,
    "uncertain",
  );
  h.workspace.wrongProofRepository = false;
  h.access.projects = [];
  await assert.rejects(h.migration.recover(h.access, token, result.id), {
    code: "access_denied",
  });
  h.access.projects = [h.project];
  h.state.members = [];
  await assert.rejects(h.migration.recover(h.access, token, result.id), {
    code: "access_denied",
  });
  assert.equal(h.workspace.writes.length, 1);
});

test("migration refuses expired preview, altered digest, foreign actor and old decision operation domains", async () => {
  const h = learningHarness(),
    p = await preview(h);
  await assert.rejects(
    h.migration.apply(h.access, token, p.id, {
      digest: "e".repeat(64),
      reauthorize: fresh(h),
    }),
    { code: "stale_preview" },
  );
  const old = createOperations(
    { ...h.config, decisionWrites: true },
    { fetcher: h.fetcher, now: () => h.state.now },
  );
  await assert.rejects(
    old.apply(h.access, token, h.project, p.id, { reauthorize: fresh(h) }),
    { code: "preview_expired" },
  );
  await assert.rejects(
    h.migration.apply({ ...h.access, userId: 2 }, token, p.id, {
      digest: p.digest,
      reauthorize: fresh(h),
    }),
    { code: "access_denied" },
  );
  h.state.now += 900001;
  await assert.rejects(apply(h, p), { code: "preview_expired" });
  assert.equal(h.workspace.writes.length, 0);
});

test("migration rejects arbitrary destinations, shared selections and more than three records", async () => {
  const h = learningHarness(),
    records = (await h.learning.project(h.access, token, h.project)).records;
  const selection = [records[0].selection];
  await assert.rejects(
    h.migration.preview(h.access, token, { selection, path: "members.json" }),
    { code: "invalid_migration" },
  );
  await assert.rejects(
    h.migration.preview(h.access, token, {
      selection: [{ ...selection[0], kind: "shared" }],
    }),
    { code: "invalid_selection" },
  );
  await assert.rejects(
    h.migration.preview(h.access, token, {
      selection: [...records.map((r) => r.selection), selection[0]],
    }),
    { code: "invalid_selection" },
  );
  await assert.rejects(
    h.migration.preview(h.access, token, {
      selection: [{ ...selection[0], projectId: "other" }],
    }),
    { code: "access_denied" },
  );
});

test("projected catalogue byte limit uses original padded bytes at exact boundary and refuses one byte over", async () => {
  const h = learningHarness(),
    p = await preview(h),
    source = JSON.parse(p.files[0].content),
    addedBytes = Buffer.byteLength(p.files[0].content);
  const retained = 1048576 - addedBytes,
    count = 16,
    baseSize = Math.floor(retained / count);
  for (let i = 0; i < count; i++) {
    const record = structuredClone(source);
    record.source.row = i + 100;
    record.source.fingerprint = lessonFingerprint(record.source.repo, {
      n: record.source.row,
      shape: record.shape,
    });
    record.id = lessonId(record.source);
    const json = JSON.stringify(record),
      size = baseSize + (i < retained % count ? 1 : 0);
    h.workspace.files[`lessons/${record.id}.json`] =
      json + " ".repeat(size - Buffer.byteLength(json));
  }
  assert.equal((await preview(h)).canSubmit, true);
  const path = Object.keys(h.workspace.files).find((path) =>
    path.startsWith("lessons/"),
  );
  h.workspace.files[path] += " ";
  await assert.rejects(preview(h), { code: "destination_limit" });
  assert.equal(h.workspace.writes.length, 0);
});

test("source edited during final authorization invalidates migration before any conditional write", async () => {
  const h = learningHarness(),
    p = await preview(h);
  const result = await apply(h, p, async () => {
    h.source.revisions[h.source.head] = { ...h.source.files };
    h.source.head = "f".repeat(40);
    h.source.files["docs/lessons.md"] = h.source.files[
      "docs/lessons.md"
    ].replace(
      "A bounded read needs a bound.",
      "Acme corrected this lesson before dispatch.",
    );
    return h.refreshAccess();
  });
  assert.equal(result.state, "refused");
  assert.equal(result.reason, "stale_selection");
  assert.equal(h.workspace.writes.length, 0);
  assert.equal([...h.db.operations.values()][0].state, "refused");
});

test("fresh private authorization denial durably refuses undispatched intent and propagates denial", async () => {
  const h = learningHarness(),
    p = await preview(h);
  await assert.rejects(
    apply(h, p, async () => {
      h.state.members = [];
      return fresh(h)();
    }),
    { code: "access_denied" },
  );
  assert.equal(h.workspace.writes.length, 0);
  assert.equal([...h.db.operations.values()][0].state, "refused");
});

test("authorized owners have separate receipts but share the private workspace reservation", async () => {
  const h = learningHarness();
  h.config.ownerIds.push(2);
  h.state.members = [1, 2];
  const p = await preview(h);
  h.workspace.mode = "never";
  const result = await apply(h, p);
  assert.equal(result.state, "uncertain");
  const secondOwner = { ...h.access, userId: 2 };
  h.state.userId = 2;
  await assert.rejects(h.migration.recover(secondOwner, token, result.id), {
    code: "operation_not_found",
  });
  await assert.rejects(
    h.migration.apply(secondOwner, token, p.id, {
      digest: p.digest,
      reauthorize: async () => secondOwner,
    }),
    { code: "preview_expired" },
  );
  const secondPreview = await h.migration.preview(secondOwner, token, {
    selection: p.selection,
  });
  await assert.rejects(
    h.migration.apply(secondOwner, token, secondPreview.id, {
      digest: secondPreview.digest,
      reauthorize: async () => secondOwner,
    }),
    { code: "workspace_busy" },
  );
  assert.equal(h.workspace.writes.length, 1);
});

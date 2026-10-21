import test from "node:test";
import assert from "node:assert/strict";
import {
  runReceiptsHarness,
  token,
  nightRecord,
  stallsRecord,
} from "./helpers/web-run-receipts.mjs";
import { createRunReceipts } from "../lib/web/run-receipts.mjs";
import { createDecisionGitHub, gitBlob } from "../lib/web/decision-github.mjs";
import { createMigration } from "../lib/web/migration.mjs";
import { createOperationStore } from "../lib/web/operation-store.mjs";
import { mediaHarness } from "./helpers/web-media.mjs";
const list = (h) => h.receipts.list(h.access, token, h.project);

test("private history lists minimal validated decision/walk summaries without payloads or recovery", async () => {
  const h = runReceiptsHarness();
  await h.addOperation();
  await h.addOperation({ kind: "walk" });
  await h.addOperation({ state: "uncertain" });
  const before = structuredClone([...h.db.operations.values()]),
    page = await list(h);
  assert.equal(page.items.length, 3);
  assert.equal(page.items.filter((i) => i.routineId === "web-walk").length, 1);
  assert.ok(
    page.items.every(
      (i) =>
        i.acceptance === "not-established" &&
        i.startedAt === null &&
        i.completedAt === null &&
        i.cost.actual === null,
    ),
  );
  assert.equal(
    page.items.find((i) => i.provider.status === "uncertain").timeBasis,
    "inferred-preview-created-at",
  );
  assert.ok(
    page.items
      .filter((i) => i.provider.status === "committed")
      .every(
        (i) =>
          i.timeBasis === "verified-receipt-recorded-at" &&
          i.link.startsWith("https://github.com/acme/studio/commit/"),
      ),
  );
  assert.deepEqual([...h.db.operations.values()], before);
  assert.equal(h.source.writes.length, 0);
  const text = JSON.stringify(page);
  for (const privateText of [
    "Private reviewed",
    "Private preview",
    "Private refusal",
    "Private evidence",
    "untrusted.example",
    "fileChanges",
    "commitMessage",
  ])
    assert.ok(!text.includes(privateText), privateText);
});

test("private history scopes actor and project exactly and does not widen decision or migration domains", async () => {
  const h = runReceiptsHarness();
  h.config.ownerIds.push(2);
  await h.addOperation({ actorId: 1 });
  await h.addOperation({ actorId: 2 });
  const other = { id: "other", repoId: 103, repo: "acme/other" };
  await h.addOperation({ project: other });
  assert.equal((await list(h)).items.length, 1);
  const second = { ...h.access, userId: 2 };
  assert.equal(
    (await h.receipts.list(second, token, h.project)).items.length,
    1,
  );
  await assert.rejects(
    h.receipts.list({ ...h.access, projects: [] }, token, h.project),
    { code: "access_denied" },
  );
  await assert.rejects(
    h.receipts.list(h.access, token, { ...h.project, repoId: 101 }),
    { code: "access_denied" },
  );
  await assert.rejects(
    h.receipts.list(
      { ...h.access, workspace: { id: "other" } },
      token,
      h.project,
    ),
    { code: "access_denied" },
  );
});

test("history listing preserves expired prepared and uncertain reservations without reconciling", async () => {
  const h = runReceiptsHarness(),
    prepared = await h.addOperation({ state: "prepared" });
  h.state.now += 120000;
  const page = await list(h);
  assert.equal(page.items[0].provider.status, "prepared");
  assert.equal(h.db.operations.get(prepared.id).state, "prepared");
  assert.equal(h.history.calls.length, 1);
  assert.equal(
    h.source.graphRequests.filter((r) =>
      r.query.startsWith("query DecisionHistory"),
    ).length,
    0,
  );
});

test("missing007 and store outages are explicit unavailable coverage, not empty-history success", async () => {
  const h = runReceiptsHarness();
  await h.addOperation();
  for (const key of ["missing", "fail"]) {
    h.history[key] = true;
    const page = await list(h);
    assert.equal(page.items.length, 0);
    assert.ok(
      page.coverage.gaps.some(
        (g) => g.source === "web-operations" && g.code === "unavailable",
      ),
    );
    assert.notEqual(page.coverage.state, "complete-page");
    h.history[key] = false;
  }
});

test("malformed decrypted identity and conflicting list identities never expose a payload or silent winner", async () => {
  const h = runReceiptsHarness(),
    row = await h.addOperation({ state: "uncertain" });
  const value = structuredClone(row.value);
  value.actorId = 2;
  await h.store.transition("committed", row.id, row.scope, value.fence, value);
  let page = await list(h);
  assert.equal(page.items.length, 0);
  assert.ok(page.coverage.gaps.some((g) => g.code === "invalid"));
  h.history.mutate = (result) => result.rows.push({ ...result.rows[0] });
  page = await list(h);
  assert.equal(page.items.length, 0);
  assert.ok(
    page.coverage.gaps.some(
      (g) => g.source === "web-operations" && g.code === "unavailable",
    ),
  );
});

test("operation history orders by inferred record time then ID and validates source/filter-bound continuation", async () => {
  const h = runReceiptsHarness(),
    created = [];
  h.state.now = Date.parse("2026-10-21T01:00:00.000Z");
  for (let i = 0; i < 23; i++) {
    h.state.now += 1000;
    created.push(await h.addOperation());
  }
  const first = await list(h);
  assert.equal(first.items.length, 20);
  assert.equal(first.items[0].identity.operationId, created.at(-1).id);
  assert.ok(first.pagination.nextCursor);
  const second = await h.receipts.list(h.access, token, h.project, {
    after: first.pagination.nextCursor,
  });
  assert.equal(second.items.length, 3);
  assert.equal(second.pagination.nextCursor, null);
  assert.equal(
    new Set([...first.items, ...second.items].map((i) => i.id)).size,
    23,
  );
  await assert.rejects(
    h.receipts.list(h.access, token, h.project, {
      after: first.pagination.nextCursor,
      days: 7,
    }),
    { code: "invalid_run_cursor" },
  );
  h.source.head = "e".repeat(40);
  await assert.rejects(
    h.receipts.list(h.access, token, h.project, {
      after: first.pagination.nextCursor,
    }),
    { code: "stale_run_cursor" },
  );
});

test("active and unresolved private receipts remain visible outside the selected finished-record window", async () => {
  const h = runReceiptsHarness();
  await h.addOperation({ at: "2026-08-01T00:00:00.000Z" });
  await h.addOperation({ at: "2026-08-01T00:01:00.000Z", state: "uncertain" });
  h.state.now = Date.parse("2026-10-21T12:00:00.000Z");
  const page = await list(h);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].provider.status, "uncertain");
});

test("immutable night and canonical CLI stalls remain authored observations with original outcome and unknown cost", async () => {
  const h = runReceiptsHarness();
  h.state.now = Date.parse("2026-10-21T12:00:00.000Z");
  h.source.files["docs/night/2026-10-21.json"] = JSON.stringify(nightRecord());
  h.source.files[".keel/test-runs/acme.json"] = JSON.stringify(stallsRecord());
  const page = await list(h);
  assert.equal(page.items.length, 0);
  assert.equal(page.observations.length, 2);
  const night = page.observations.find((i) => i.kind === "authored-night"),
    cli = page.observations.find((i) => i.kind === "authored-cli");
  assert.equal(night.provider.status, "done");
  assert.equal(night.source.revision, h.source.head);
  assert.equal(
    night.source.blob,
    gitBlob(h.source.files["docs/night/2026-10-21.json"]),
  );
  assert.equal(night.allocatedMinutes, 8);
  assert.equal(night.detailUrl, "/projects/studio/daily?date=2026-10-21");
  assert.equal(night.acceptance, "not-established");
  assert.equal(night.identity.attempt, undefined);
  assert.deepEqual(cli.outcomes, { fail: 1 });
  assert.equal(cli.state, "unknown");
  assert.equal(cli.cost.weightedMinutes, null);
  assert.equal(cli.worker, null);
  assert.ok(!JSON.stringify(page).includes("Private test title"));
  assert.ok(!JSON.stringify(page).includes("Private authored note"));
  assert.ok(
    page.coverage.gaps.some(
      (g) => g.source === "local-cli" && g.code === "not-connected",
    ),
  );
});

test("invalid nights, unsupported CLI formats, absent archives and oversized source files remain distinct gaps", async () => {
  const h = runReceiptsHarness();
  let page = await list(h);
  assert.ok(
    page.coverage.gaps.some((g) => g.source === "night" && g.code === "absent"),
  );
  h.source.files["docs/night/2026-02-31.json"] = JSON.stringify(
    nightRecord("2026-02-31"),
  );
  h.source.files[".keel/test-runs/generic.json"] = JSON.stringify({
    date: "2026-10-21",
    tests: [],
    completed: true,
  });
  h.source.files[".keel/test-runs/oversized.json"] = "x".repeat(262145);
  page = await list(h);
  assert.equal(page.observations.length, 0);
  assert.ok(page.coverage.gaps.some((g) => g.code === "unsupported"));
  assert.ok(page.coverage.gaps.some((g) => g.code === "invalid"));
  assert.ok(page.coverage.gaps.some((g) => g.code === "too-large"));
});

test("archived source pagination caps thirty files and shares the existing immutable snapshot without rereading inventory", async () => {
  const h = runReceiptsHarness();
  h.state.now = Date.parse("2026-10-21T12:00:00.000Z");
  for (let i = 0; i < 31; i++) {
    const date = new Date(Date.UTC(2026, 9, 21 - i)).toISOString().slice(0, 10);
    h.source.files[`docs/night/${date}.json`] = JSON.stringify(
      nightRecord(date),
    );
  }
  let trees = 0;
  const fetcher = async (url, options) => {
    if (url.includes("/git/trees/")) trees++;
    return h.fetcher(url, options);
  };
  const snapshot = await createDecisionGitHub(token, { fetcher }).snapshot(
      h.project,
    ),
    service = createRunReceipts(h.config, { fetcher, now: () => h.state.now });
  const first = await service.list(
    h.access,
    token,
    h.project,
    { days: 90 },
    { snapshot },
  );
  assert.equal(first.observations.length, 30);
  assert.equal(trees, 1);
  const second = await service.list(
    h.access,
    token,
    h.project,
    { days: 90, after: first.pagination.nextCursor },
    { snapshot },
  );
  assert.equal(second.observations.length, 1);
  assert.equal(trees, 1);
  assert.equal(second.pagination.nextCursor, null);
});

test("mid-read source access revocation denies all buffered private history", async () => {
  const h = runReceiptsHarness();
  await h.addOperation();
  h.source.files["docs/night/2026-10-21.json"] = JSON.stringify(nightRecord());
  const target = gitBlob(h.source.files["docs/night/2026-10-21.json"]);
  const fetcher = async (url, options) =>
    url.endsWith(`/git/blobs/${target}`)
      ? Response.json({}, { status: 403 })
      : h.fetcher(url, options);
  const service = createRunReceipts(h.config, {
    fetcher,
    now: () => h.state.now,
  });
  await assert.rejects(service.list(h.access, token, h.project), {
    code: "access_denied",
  });
});

test("workspace migration history suppresses revoked source details and never recovers or republishes", async () => {
  const h = runReceiptsHarness(),
    learning = await h.learning.project(h.access, token, h.project),
    migration = createMigration(h.config, {
      fetcher: h.fetcher,
      now: () => h.state.now,
    });
  const p = await migration.preview(h.access, token, {
    selection: [learning.records[0].selection],
  });
  const result = await migration.apply(h.access, token, p.id, {
    digest: p.digest,
    reauthorize: async () => h.refreshAccess(),
  });
  assert.equal(result.state, "committed");
  h.refreshAccess();
  let page = await h.receipts.migrations(h.access, token);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].projectId, null);
  assert.equal(page.items[0].detailUrl, `/learning/operations/${result.id}`);
  assert.ok(!JSON.stringify(page).includes(learning.records[0].shape));
  const writes = h.workspace.writes.length;
  h.access.projects = [];
  page = await h.receipts.migrations(h.access, token);
  assert.equal(page.items.length, 0);
  assert.ok(page.coverage.gaps.some((g) => g.code === "withheld"));
  assert.ok(!JSON.stringify(page).includes("studio"));
  assert.equal(h.workspace.writes.length, writes);
  h.workspace.private = false;
  await assert.rejects(h.receipts.migrations(h.access, token), {
    code: "access_denied",
  });
});

test("configured media history retains expired state and existing shared project scope without fetching image bytes", async () => {
  const h = mediaHarness(),
    input = await h.input();
  await h.media.upload(
    h.access,
    token,
    h.project,
    "acme-search",
    "desktop-after",
    input,
  );
  h.state.now += 31 * 86400000;
  const before = h.mediaState.requests.length;
  const fetcher = async (url, options) =>
    new URL(url).pathname.endsWith("/rpc/keel_run_history")
      ? Response.json({ rows: [], after: null, hasMore: false })
      : h.fetcher(url, options);
  const service = createRunReceipts(h.config, {
    fetcher,
    now: () => h.state.now,
  });
  const page = await service.list(
    { ...h.access, userId: 2 },
    token,
    h.project,
    { days: 90 },
  );
  const media = page.items.find((i) => i.kind === "media-receipt");
  assert.equal(media.actor, 1);
  assert.equal(media.availability, "expired");
  assert.equal(media.objectCheck, "not-checked");
  assert.equal(media.acceptance, "not-established");
  assert.ok(
    h.mediaState.requests
      .slice(before)
      .every((r) => !r.path?.includes("/object/")),
  );
  assert.equal(h.mediaState.posts, 1);
  assert.equal(h.mediaState.deletes, 0);
  assert.ok(!JSON.stringify(page).includes("Acme anvil result"));
  assert.ok(!JSON.stringify(page).includes("cipherHash"));
});

test("store listing rejects arbitrary cursors and preserves its old read/write API", async () => {
  const h = runReceiptsHarness(),
    row = await h.addOperation(),
    store = createOperationStore(h.config, h.fetcher);
  await assert.rejects(
    store.list(row.scope, store.projectFor(h.project), {
      after: "https://private.example",
    }),
    { code: "invalid_history_page" },
  );
  await assert.rejects(
    store.list(row.scope, store.projectFor(h.project), { limit: 21 }),
    { code: "invalid_history_page" },
  );
  const exact = await store.read(row.id, row.scope);
  assert.equal(exact.state, "committed");
  assert.equal(exact.value.actorId, 1);
});

test("shared requested and waiting filters are valid empty receipt selections, not unavailable sources", async () => {
  const h = runReceiptsHarness();
  await h.addOperation();
  for (const status of ["requested", "waiting"]) {
    const page = await h.receipts.list(h.access, token, h.project, { status });
    assert.equal(page.items.length, 0);
    assert.ok(
      !page.coverage.gaps.some(
        (g) => g.source === "web-operations" && g.code === "unavailable",
      ),
    );
  }
});


test("CLI archives retain canonical and legacy path identities without rewriting provenance", async () => {
  const h = runReceiptsHarness();
  h.state.now = Date.parse("2026-10-21T12:00:00.000Z");
  const paths = [".plates/test-runs/acme.json", ".keel/test-runs/acme.json"];
  for (const path of paths) h.source.files[path] = JSON.stringify(stallsRecord());
  const page = await list(h), observations = page.observations.filter(i => i.kind === "authored-cli");
  assert.equal(observations.length, 2);
  assert.equal(new Set(observations.map(i => i.id)).size, 2);
  for (const path of paths) {
    const item = observations.find(i => i.source.path === path);
    assert.equal(item.source.revision, h.source.head);
    assert.equal(item.source.blob, gitBlob(h.source.files[path]));
    assert.equal(item.identity.path, path);
    assert.ok(item.link.endsWith('/' + h.source.head + '/' + path));
    assert.deepEqual(item.outcomes, { fail: 1 });
  }
  h.source.files[paths[0]] = '{malformed';
  const invalid = await list(h);
  assert.deepEqual(invalid.observations.map(i => i.source.path), [paths[1]]);
  assert.ok(invalid.coverage.gaps.some(g => g.code === 'invalid'));
  assert.deepEqual(h.source.writes, []);
});

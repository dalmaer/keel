import test from "node:test";
import assert from "node:assert/strict";
import {
  learningHarness,
  token,
  lessonTable,
} from "./helpers/web-learning.mjs";
import { createLearning } from "../lib/web/learning.mjs";
import { createExport } from "../lib/web/export.mjs";
import { createGitHub } from "../lib/web/github.mjs";
import { validateLesson, lessonId } from "../lib/web/learning-model.mjs";
import { gitBlob } from "../lib/web/decision-github.mjs";
import { lessonFingerprint } from "../practices/night/files/scripts/plates/lib.mjs";
import { webConfig } from "../lib/web/config.mjs";
const fresh = (h) => () =>
  createGitHub(h.config, h.fetcher).access(token, h.access.userId);
async function first(h) {
  return (await h.learning.project(h.access, token, h.project)).records[0];
}

test('learning config prefers Plates and reads legacy only when the immutable tree lacks canonical config', async () => {
  for (const legacy of [false, true]) {
    const h = learningHarness();
    h.source.files['.keel/keel.json'] = legacy ? h.source.files['.plates/plates.json'] : '{invalid legacy';
    if (legacy) delete h.source.files['.plates/plates.json'];
    const model = await h.learning.project(h.access, token, h.project);
    assert.equal(model.state, 'complete');
    assert.equal(model.records.length, 3);
    assert.equal(model.records[0].source.blob, gitBlob(lessonTable));
  }
});

test('learning never falls back from malformed or denied canonical config to a legacy catalogue', async () => {
  for (const failure of ['malformed', 403, 404]) {
    const h = learningHarness();
    h.source.files['.keel/keel.json'] = JSON.stringify({ lessons: 'legacy/lessons.md' });
    h.source.files['legacy/lessons.md'] = lessonTable;
    if (failure === 'malformed') h.source.files['.plates/plates.json'] = '{broken';
    const canonical = gitBlob(h.source.files['.plates/plates.json']), legacy = gitBlob(h.source.files['.keel/keel.json']);
    let legacyReads = 0;
    const learning = createLearning(h.config, { fetcher: (url, options) => {
      if (url.endsWith('/git/blobs/' + legacy)) legacyReads++;
      if (failure !== 'malformed' && url.endsWith('/git/blobs/' + canonical)) return Promise.resolve(Response.json({}, { status: failure }));
      return h.fetcher(url, options);
    } });
    if (failure === 'malformed') assert.equal((await learning.project(h.access, token, h.project)).state, 'unavailable');
    else await assert.rejects(learning.project(h.access, token, h.project), { code: 'access_denied' });
    assert.equal(legacyReads, 0);
    assert.deepEqual(h.source.writes, []);
  }
});
async function sharedFile(h, record = null) {
  record ??= await first(h);
  const value = {
    version: 1,
    id: record.id,
    shape: record.shape,
    cost: record.cost,
    guard: record.guard,
    where: record.where,
    source: record.source,
    imported: { actorId: 1, at: "2026-10-21T00:00:00.000Z" },
  };
  h.workspace.files[`lessons/${value.id}.json`] = JSON.stringify(value);
  return value;
}

test("learning reads configured immutable lesson rows with canonical fingerprint and keeps duplicates visible", async () => {
  const h = learningHarness();
  h.source.files[".plates/plates.json"] = JSON.stringify({
    lessons: "design/lessons.md",
    repo: "other/forged",
  });
  h.source.files["design/lessons.md"] =
    lessonTable +
    "| 1 | A bounded read needs a bound. | Different cost. | Another guard. | Other provenance. |\n";
  const model = await h.learning.project(h.access, token, h.project);
  assert.equal(model.state, "partial");
  assert.equal(model.records.length, 4);
  const record = model.records[0];
  assert.equal(record.source.repo, "acme/studio");
  assert.equal(record.source.revision, h.source.head);
  assert.equal(
    record.source.blob,
    gitBlob(h.source.files["design/lessons.md"]),
  );
  assert.equal(
    record.source.fingerprint,
    lessonFingerprint("acme/studio", { n: 1, shape: record.shape }),
  );
  assert.equal(record.id, lessonId(record.source));
  assert.equal(model.records[3].id, record.id);
  await assert.rejects(h.learning.select(h.access, token, [record.selection]), {
    code: "stale_selection",
  });
});

test("learning distinguishes absent, malformed, partial and unavailable project catalogues", async () => {
  const h = learningHarness();
  delete h.source.files["docs/lessons.md"];
  assert.equal(
    (await h.learning.project(h.access, token, h.project)).state,
    "absent",
  );
  h.source.files["docs/lessons.md"] =
    "| # | Shape | Cost | Guard |\n| --- | --- | --- | --- |\n| bad | omitted | reason | guard |\n| 1 | valid | cost | guard |\n";
  const partial = await h.learning.project(h.access, token, h.project);
  assert.equal(partial.state, "partial");
  assert.equal(partial.records.length, 1);
  h.source.files["docs/lessons.md"] = Buffer.from([0xff]);
  assert.equal(
    (await h.learning.project(h.access, token, h.project)).state,
    "unavailable",
  );
  h.source.files[".plates/plates.json"] = JSON.stringify({
    lessons: "https://private.example/secret",
  });
  assert.equal(
    (await h.learning.project(h.access, token, h.project)).state,
    "unavailable",
  );
});

test("shared learning validates exact records and attribution without claiming source authentication", async () => {
  const h = learningHarness();
  assert.equal((await h.learning.shared(h.access, token)).state, "absent");
  const value = await sharedFile(h);
  let model = await h.learning.shared(h.access, token);
  assert.equal(model.state, "complete");
  assert.deepEqual(model.records[0].imported, value.imported);
  assert.equal(model.records[0].source.repoId, 102);
  assert.equal(model.source.repoId, 101);
  h.workspace.files["lessons/unsupported.json"] = '{"instructions":"run me"}';
  model = await h.learning.shared(h.access, token);
  assert.equal(model.state, "partial");
  assert.equal(model.records.length, 1);
  for (const mutate of [
    (v) => {
      v.source.row = [1];
    },
    (v) => {
      v.extra = true;
    },
    (v) => {
      v.imported.at = "2026-10-21";
    },
    (v) => {
      v.source.fingerprint = "forged";
    },
    (v) => {
      v.shape = "x".repeat(8193);
    },
  ]) {
    const bad = structuredClone(value);
    mutate(bad);
    assert.throws(() => validateLesson(bad), { code: "invalid_lesson" });
  }
});

test("private learning denies crossed project pins, changed private identity, membership and stale auth revision", async () => {
  const h = learningHarness();
  await assert.rejects(
    h.learning.project(h.access, token, { ...h.project, repoId: 101 }),
    { code: "access_denied" },
  );
  h.workspace.private = false;
  await assert.rejects(h.learning.shared(h.access, token), {
    code: "access_denied",
  });
  h.workspace.private = true;
  h.state.members = [];
  await assert.rejects(h.learning.shared(h.access, token), {
    code: "access_denied",
  });
  h.state.members = [1];
  h.workspace.head = "e".repeat(40);
  await assert.rejects(h.learning.shared(h.access, token), {
    code: "workspace_changed",
  });
  h.refreshAccess();
  h.workspace.files["workspace.json"] = h.workspace.files[
    "workspace.json"
  ].replace("acme/keel-private", "acme/recycled");
  await assert.rejects(h.learning.shared(h.access, token), {
    code: "access_denied",
  });
});

test("mid-catalogue403 and GraphQL forbidden revoke all private output instead of returning partial prior records", async () => {
  const h = learningHarness(),
    records = (await h.learning.project(h.access, token, h.project)).records;
  await sharedFile(h, records[0]);
  await sharedFile(h, records[1]);
  const deniedBlob = gitBlob(
    h.workspace.files[`lessons/${records[1].id}.json`],
  );
  let read = 0;
  const fetcher = async (url, options) => {
    if (url.includes("/git/blobs/") && url.endsWith(deniedBlob))
      return Response.json({}, { status: 403 });
    if (url.includes("/git/blobs/")) read++;
    return h.fetcher(url, options);
  };
  await assert.rejects(
    createLearning(h.config, { fetcher }).shared(h.access, token),
    { code: "access_denied" },
  );
  assert.ok(read >= 2);
  const forbidden = async (url, options) =>
    url.endsWith("/graphql")
      ? Response.json({ errors: [{ type: "FORBIDDEN" }] })
      : h.fetcher(url, options);
  await assert.rejects(
    createLearning(h.config, { fetcher: forbidden }).project(
      h.access,
      token,
      h.project,
    ),
    { code: "access_denied" },
  );
});

test("catalogue bounds preserve gaps for excessive records and oversized files", async () => {
  const h = learningHarness(),
    value = await sharedFile(h);
  for (let i = 0; i < 51; i++)
    h.workspace.files[`lessons/unsupported-${i}.json`] = "{}";
  let model = await h.learning.shared(h.access, token);
  assert.equal(model.state, "partial");
  assert.ok(model.gaps.some((g) => g.reason.includes("fifty")));
  h.workspace.files = {
    ...h.workspace.files,
    [`lessons/${value.id}.json`]: JSON.stringify(value) + " ".repeat(65536),
  };
  model = await h.learning.shared(h.access, token);
  assert.equal(model.records.length, 0);
});

test("workspaceWrites is separately validated and never enables decisionWrites", () => {
  const h = learningHarness();
  assert.equal(
    webConfig({ ...h.input, workspaceWrites: true }, h.secrets).decisionWrites,
    undefined,
  );
  assert.equal(
    webConfig({ ...h.input, decisionWrites: true }, h.secrets).workspaceWrites,
    undefined,
  );
  assert.throws(() =>
    webConfig({ ...h.input, workspaceWrites: "yes" }, h.secrets),
  );
});

test("export downloads only exact approved text with fixed filename, no source metadata or provider write", async () => {
  const h = learningHarness(),
    record = await first(h),
    text = "Reviewed Acme lesson\nOnly these owner-approved words.\n";
  const preview = await h.exports.preview(h.access, token, {
    selection: [record.selection],
    text,
  });
  assert.equal(preview.text, text);
  const download = await h.exports.download(
    h.access,
    token,
    { previewId: preview.id, digest: preview.digest },
    { reauthorize: fresh(h) },
  );
  assert.equal(download.bytes.toString(), text);
  assert.equal(download.filename, "plates-reviewed-lessons.txt");
  assert.equal(download.mime, "text/plain; charset=utf-8");
  assert.equal(h.workspace.writes.length + h.source.writes.length, 0);
  assert.equal(h.db.operations.size, 0);
  assert.ok(![...h.db.previews.values()][0].value.includes(text));
});

test("export refuses altered digest, expired approval, removed access and changed source, including shared source revisions", async () => {
  const h = learningHarness(),
    record = await first(h),
    p = await h.exports.preview(h.access, token, {
      selection: [record.selection],
      text: "Approved",
    });
  const download = (digest) =>
    h.exports.download(
      h.access,
      token,
      { previewId: p.id, digest },
      { reauthorize: fresh(h) },
    );
  await assert.rejects(download("f".repeat(64)), { code: "stale_preview" });
  h.source.head = "e".repeat(40);
  await assert.rejects(download(p.digest), { code: "stale_selection" });
  h.source.head = "b".repeat(40);
  h.state.repoAccess = false;
  await assert.rejects(download(p.digest), { code: "access_denied" });
  h.state.repoAccess = true;
  await sharedFile(h, record);
  const shared = (await h.learning.shared(h.access, token)).records[0];
  const s = await h.exports.preview(h.access, token, {
    selection: [shared.selection],
    text: "Shared approved",
  });
  h.workspace.head = "e".repeat(40);
  await assert.rejects(
    h.exports.download(
      h.access,
      token,
      { previewId: s.id, digest: s.digest },
      { reauthorize: fresh(h) },
    ),
    { code: "stale_selection" },
  );
  h.state.now += 900001;
  await assert.rejects(download(p.digest), { code: "preview_expired" });
});

test("exports reject implicit text, excessive bytes, invalid Unicode and crossed actor previews", async () => {
  const h = learningHarness(),
    record = await first(h);
  for (const input of [
    { selection: [record.selection] },
    { selection: [record.selection], text: "x".repeat(65537) },
    { selection: [record.selection], text: "\ud800" },
  ]) {
    await assert.rejects(h.exports.preview(h.access, token, input), {
      code: "invalid_export",
    });
  }
  const p = await h.exports.preview(h.access, token, {
    selection: [record.selection],
    text: "Acme approved",
  });
  const other = { ...h.access, userId: 2 };
  await assert.rejects(
    h.exports.download(
      other,
      token,
      { previewId: p.id, digest: p.digest },
      { reauthorize: async () => other },
    ),
    { code: "preview_expired" },
  );
  const another = createExport(
    { ...h.config, workspace: { ...h.config.workspace, id: "other" } },
    { fetcher: h.fetcher },
  );
  await assert.rejects(
    another.download(
      h.access,
      token,
      { previewId: p.id, digest: p.digest },
      { reauthorize: async () => h.access },
    ),
    { code: "preview_expired" },
  );
});

test("learning harness composes actual OAuth and authorized session routes", async () => {
  const h = learningHarness(),
    auth = await h.login();
  assert.equal(auth.session.workspace.id, "acme");
  assert.ok(auth.cookie.includes("__Host-keel-session="));
});

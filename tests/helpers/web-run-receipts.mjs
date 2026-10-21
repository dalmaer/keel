// Synthetic transport composed with the actual encrypted operation store and auth.
import { learningHarness, token } from "./web-learning.mjs";
import { createOperationStore } from "../../lib/web/operation-store.mjs";
import { createRunReceipts } from "../../lib/web/run-receipts.mjs";
import { hash } from "../../lib/web/common.mjs";
import { gitBlob } from "../../lib/web/decision-github.mjs";
export { token };
export const nightRecord = (date = "2026-10-21") => ({
  schema: 1,
  date,
  shapedBy: "owner",
  readyBy: null,
  willNotTouch: [],
  settledToday: [],
  leftOpen: [],
  items: [
    {
      id: "acme-check",
      title: "Check Acme ordering",
      kind: "review",
      source: "owner",
      lane: "night",
      status: "done",
      number: null,
      budget: { minutes: 8 },
      result: {
        note: "Private authored note must not enter the feed.",
        link: "docs/evidence/acme.md",
      },
    },
  ],
});
export const stallsRecord = () => ({
  kind: "stalls",
  version: 1,
  date: "2026-10-21T01:00:02.000Z",
  completed: true,
  tests: [],
  stallsReceipts: [
    {
      version: 1,
      id: "acme-stalls-1",
      identity: {
        kind: "stalls",
        scope: ".",
        runner: "node",
        configHash: "a".repeat(64),
        flagsHash: "b".repeat(64),
        target: {
          file: "tests/acme.test.mjs",
          name: "Private test title must not enter the feed.",
        },
      },
      revision: "b".repeat(40),
      clean: true,
      startedAt: "2026-10-21T01:00:00.000Z",
      completedAt: "2026-10-21T01:00:02.000Z",
      pinned: true,
      seed: 7,
      verifiedInjected: true,
      pauses: 1,
      complete: true,
      plain: "pass",
      stalled: "fail",
    },
  ],
});
export function runReceiptsHarness() {
  const h = learningHarness(),
    history = { missing: false, fail: false, calls: [], mutate: null };
  let sequence = 0;
  const fetcher = async (url, options = {}) => {
    if (new URL(url).pathname.endsWith("/rpc/keel_run_history")) {
      const p = JSON.parse(options.body);
      history.calls.push(p);
      if (history.missing)
        return Response.json(
          { message: "function does not exist" },
          { status: 404 },
        );
      if (history.fail) throw Error("Synthetic private storage outage");
      const eligible = [...h.db.operations.values()]
        .filter(
          (row) =>
            row.scope === p.p_scope &&
            row.project === p.p_project &&
            h.db.previews.get(row.preview)?.scope === row.scope,
        )
        .sort(
          (a, b) =>
            h.db.previews.get(b.preview).expires -
              h.db.previews.get(a.preview).expires || a.id.localeCompare(b.id),
        );
      const start =
        p.p_after === null
          ? 0
          : eligible.findIndex((row) => row.id === p.p_after) + 1;
      if (p.p_after !== null && start === 0)
        return Response.json({}, { status: 400 });
      const selected = [];
      let bytes = 0;
      for (const row of eligible.slice(start)) {
        if (
          selected.length >= p.p_limit ||
          bytes + Buffer.byteLength(row.value) > 2090000
        )
          break;
        bytes += Buffer.byteLength(row.value);
        selected.push(row);
      }
      const rows = selected.map((row) => ({
        id: row.id,
        state: row.state,
        value: row.value,
        previewId: row.preview,
        recordedAt: new Date(
          h.db.previews.get(row.preview).expires - 900000,
        ).toISOString(),
        timeBasis: "inferred-preview-created-at",
      }));
      const more = start + rows.length < eligible.length,
        result = { rows, after: more ? rows.at(-1).id : null, hasMore: more };
      history.mutate?.(result);
      return Response.json(result);
    }
    return h.fetcher(url, options);
  };
  const store = createOperationStore(h.config, fetcher);
  async function addOperation({
    kind = "decision",
    actorId = h.access.userId,
    project = h.project,
    state = "committed",
    id = hash(`acme-operation-${++sequence}`),
    payload = null,
    at = null,
  } = {}) {
    if (at !== null) h.state.now = Date.parse(at);
    const previewId = hash(`acme-preview-${id}`),
      fence = hash(`acme-fence-${id}`),
      scope = store.scopeFor(actorId, project);
    const content = "Private reviewed source bytes must not enter the history.",
      files =
        kind === "walk"
          ? [
              {
                path: "docs/phases/1-acme.md",
                content,
                originalBlob: gitBlob("prior phase"),
              },
              {
                path: "docs/evidence/acme.md",
                content: "Private evidence bytes",
                originalBlob: null,
              },
            ]
          : null;
    const intent = {
      id,
      repo: project.repo,
      repoId: project.repoId,
      repositoryNodeId: `R_acme_${project.repoId}`,
      branchNodeId: `REF_acme_${project.repoId}_main`,
      branch: "main",
      head: "b".repeat(40),
      commitMessage: `Update Acme\n\nKeel-Operation: ${id}`,
      marker: `Keel-Operation: ${id}`,
      ...(files
        ? { files }
        : {
            path: "docs/health/acme.md",
            content,
            originalBlob: gitBlob("old health"),
          }),
    };
    const receipt =
      state === "committed"
        ? {
            commit: "d".repeat(40),
            url: "https://untrusted.example/ignore",
            repoId: project.repoId,
            repositoryNodeId: intent.repositoryNodeId,
            actorId,
            recordedAt: new Date(h.state.now).toISOString(),
            acceptance: "not-established",
            ...(files
              ? { paths: files.map((f) => f.path) }
              : { path: intent.path }),
          }
        : null;
    const value = payload ?? {
      previewId,
      projectId: project.id,
      actorId,
      ...(kind === "walk" ? { kind: "walk" } : {}),
      fence,
      intent,
      receipt,
      reason: "Private refusal prose must not enter feed.",
    };
    await store.createPreview(previewId, scope, {
      id: previewId,
      private: "Private preview must not enter feed.",
    });
    const row = await store.reserve(
      id,
      scope,
      store.projectFor(project),
      previewId,
      fence,
      value,
    );
    if (!row?.created) throw Error("Synthetic operation reservation refused");
    if (state !== "prepared") {
      await store.transition("dispatched", id, scope, fence);
      if (state !== "dispatched")
        await store.transition(state, id, scope, fence, value);
    }
    return { id, previewId, scope, value };
  }
  return {
    ...h,
    fetcher,
    history,
    store,
    addOperation,
    receipts: createRunReceipts(h.config, { fetcher, now: () => h.state.now }),
  };
}

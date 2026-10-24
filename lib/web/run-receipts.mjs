import { readOperationMarker } from './name-transition.mjs';
import { createOperationStore } from "./operation-store.mjs";
import { createDecisionGitHub, intentFiles } from "./decision-github.mjs";
import { createLearning, learningTransport } from "./learning.mjs";
import { createMedia } from "./media.mjs";
import { hash, exact, numeric, WebError } from "./common.mjs";
import {
  historyCursor,
  nextHistoryCursor,
  readRunRecords,
  receiptFilters,
  receiptWindow,
  runCost,
  runCoverage,
  runDate,
  runId,
  visibleRows,
} from "./run-records.mjs";
const sha = (value) =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const node = (value) =>
  typeof value === "string" && /^[!-~]{1,200}$/.test(value);
const denied = (error) =>
  [401, 404].includes(error.status) || error.code === "access_denied";
const stateOf = (state) =>
  ({
    prepared: "queued",
    dispatched: "running",
    uncertain: "unknown",
    committed: "succeeded",
    refused: "failed",
    uploading: "running",
    verified: "succeeded",
    deleting: "running",
    "delete-uncertain": "unknown",
    deleted: "succeeded",
  })[state] ?? "unknown";
function receiptSummary(row, access, repository, projectId, kind) {
  const value = row.value,
    intent = value?.intent;
  if (
    !value ||
    value.actorId !== access.userId ||
    value.previewId !== row.previewId ||
    !runId(value.fence) ||
    !intent ||
    intent.id !== row.id ||
    intent.repoId !== repository.repoId ||
    intent.repo !== repository.repo ||
    !node(intent.repositoryNodeId) ||
    !node(intent.branchNodeId) ||
    !sha(intent.head) ||
    typeof intent.branch !== "string" ||
    !intent.branch.length ||
    intent.branch.length > 200 ||
    /[\x00-\x1f]/.test(intent.branch) ||
    readOperationMarker(intent.marker) !== row.id ||
    typeof intent.commitMessage !== "string" ||
    intent.commitMessage.length > 1000 ||
    !intent.commitMessage.endsWith(`\n\n${intent.marker}`)
  )
    throw new WebError("invalid_run_receipt");
  const files = intentFiles(intent),
    receipt = value.receipt;
  if (kind === "web-walk") {
    const roles = files.map((file) =>
      /^docs\/phases\/[^/]+\.md$/.test(file.path)
        ? "phase"
        : /^docs\/evidence\/[^/]+\.md$/.test(file.path)
          ? "evidence"
          : file.path === "docs/ROADMAP.md"
            ? "roadmap"
            : null,
    );
    if (
      roles.includes(null) ||
      !roles.includes("phase") ||
      !roles.includes("evidence") ||
      new Set(roles).size !== roles.length
    )
      throw new WebError("invalid_run_receipt");
  }
  if (
    kind === "web-migration" &&
    files.some(
      (file) =>
        !/^lessons\/lesson-[a-f0-9]{40}\.json$/.test(file.path) ||
        file.originalBlob !== null,
    )
  )
    throw new WebError("invalid_run_receipt");
  if (kind === "web-decision" && files.length !== 1)
    throw new WebError("invalid_run_receipt");
  let link = null,
    at = row.recordedAt,
    timeBasis = row.timeBasis;
  if (receipt !== null && receipt !== undefined) {
    const paths = receipt.paths ?? [receipt.path];
    if (
      !sha(receipt.commit) ||
      receipt.repoId !== repository.repoId ||
      receipt.repositoryNodeId !== intent.repositoryNodeId ||
      receipt.actorId !== access.userId ||
      !runDate(receipt.recordedAt) ||
      receipt.acceptance !== "not-established" ||
      JSON.stringify(paths) !== JSON.stringify(files.map((file) => file.path))
    )
      throw new WebError("invalid_run_receipt");
    link = `https://github.com/${repository.repo}/commit/${receipt.commit}`;
    at = new Date(receipt.recordedAt).toISOString();
    timeBasis = "verified-receipt-recorded-at";
  }
  if (row.state === "committed" && !receipt)
    throw new WebError("invalid_run_receipt");
  return {
    id: JSON.stringify([kind, repository.repoId, row.id]),
    kind: kind === "web-migration" ? "web-migration" : "web-operation",
    projectId,
    title: {
      "web-decision": "Decision update",
      "web-walk": "Guided walk",
      "web-migration": "Private lesson copy",
    }[kind],
    routineId: kind,
    identity: { repoId: repository.repoId, operationId: row.id },
    parentId: null,
    retryOf: null,
    source: { kind: "private-operation" },
    provider: { status: row.state, conclusion: null },
    state: stateOf(row.state),
    acceptance: "not-established",
    startedAt: null,
    completedAt: null,
    updatedAt: at,
    recordedAt: row.recordedAt,
    timeBasis,
    actor: access.userId,
    worker: null,
    model: null,
    cost: runCost(),
    link,
    detailUrl: projectId
      ? `/projects/${projectId}/operations/${row.id}`
      : `/learning/operations/${row.id}`,
  };
}
export function createRunReceipts(
  config,
  { fetcher = fetch, now = Date.now } = {},
) {
  const store = createOperationStore(config, fetcher);
  function authorize(access, project = null) {
    if (
      !access ||
      !config.ownerIds.includes(access.userId) ||
      access.workspace?.id !== config.workspace.id
    )
      throw new WebError("access_denied", 404);
    if (
      project &&
      (!access.projects?.some(
        (p) =>
          p.id === project.id &&
          p.repoId === project.repoId &&
          p.repo === project.repo,
      ) ||
        config.projectRepoIds[project.id] !== project.repoId)
    )
      throw new WebError("access_denied", 404);
  }
  const binding = (access, source, repoId, filters) => [
    source,
    config.appId,
    config.installationId,
    config.workspace.repoId,
    config.workspace.id,
    access.userId,
    repoId,
    filters,
  ];
  async function list(access, token, project, options = {}, context = {}) {
    authorize(access, project);
    const filters = receiptFilters(options),
      readAt = new Date(now()).toISOString(),
      window = receiptWindow(filters, now()),
      gaps = [],
      items = [];
    let snapshot = context.snapshot;
    if (snapshot === undefined) {
      try {
        snapshot = await createDecisionGitHub(token, {
          fetcher: learningTransport(fetcher),
        }).snapshot(project);
      } catch (error) {
        if (denied(error)) throw error;
        snapshot = null;
      }
    }
    if (
      snapshot &&
      (snapshot.source.repoId !== project.repoId ||
        !sha(snapshot.source.head) ||
        snapshot.reader.revision !== snapshot.source.head)
    )
      throw new WebError("invalid_run_source");
    const scope = store.scopeFor(access.userId, project),
      key = binding(access, "project-history", project.repoId, filters);
    const position = historyCursor(options.after ?? null, key, {
      revision: snapshot?.source.head ?? null,
      web: null,
      webDone: false,
      media: null,
      mediaDone: false,
      nightPage: 1,
      cliPage: 1,
    });
    if (
      !exact(position, [
        "revision",
        "web",
        "webDone",
        "media",
        "mediaDone",
        "nightPage",
        "cliPage",
      ]) ||
      typeof position.webDone !== "boolean" ||
      typeof position.mediaDone !== "boolean" ||
      ![position.web, position.media].every((v) => v === null || runId(v)) ||
      ![position.nightPage, position.cliPage].every(
        (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 10000),
      )
    )
      throw new WebError("invalid_run_cursor", 400);
    if (position.revision !== (snapshot?.source.head ?? null))
      throw new WebError("stale_run_cursor", 409);
    const next = { ...position };
    let available = 0;
    if (!position.webDone) {
      try {
        const page = await store.list(scope, store.projectFor(project), {
          after: position.web,
        });
        available++;
        next.web = page.after;
        next.webDone = !page.hasMore;
        for (const row of page.rows) {
          try {
            if (
              row.value?.projectId !== project.id ||
              !["walk", undefined].includes(row.value?.kind)
            )
              throw new WebError("invalid_run_receipt");
            items.push(
              receiptSummary(
                row,
                access,
                project,
                project.id,
                row.value.kind === "walk" ? "web-walk" : "web-decision",
              ),
            );
          } catch {
            gaps.push({
              source: "web-operations",
              reason:
                "An operation payload could not be validated for this actor and project.",
              code: "invalid",
            });
          }
        }
        if (page.hasMore)
          gaps.push({
            source: "web-operations",
            reason:
              "Additional private operation records remain on the next page.",
            code: "unvisited",
          });
      } catch (error) {
        if (denied(error)) throw error;
        gaps.push({
          source: "web-operations",
          reason:
            "Private operation listing is unavailable; migration007 or its storage may be unavailable.",
          code: "unavailable",
        });
        next.webDone = true;
      }
    }
    if (!position.mediaDone) {
      if (!config.media) {
        next.mediaDone = true;
        gaps.push({
          source: "web-media",
          reason: "Private media storage is not configured.",
          code: "not-configured",
        });
      } else
        try {
          const page = await createMedia(config, { fetcher, now }).list(
            access,
            project,
            { after: position.media, limit: 20 },
          );
          available++;
          next.media = page.nextCursor;
          next.mediaDone = !page.nextCursor;
          for (const row of page.items) {
            if (
              !runId(row.id) ||
              row.projectId !== project.id ||
              !numeric(row.uploaderId) ||
              !runDate(row.createdAt) ||
              !runDate(row.expiresAt)
            ) {
              gaps.push({
                source: "web-media",
                reason:
                  "A private media receipt has invalid identity or time metadata.",
                code: "invalid",
              });
              continue;
            }
            items.push({
              id: JSON.stringify(["web-media", project.repoId, row.id]),
              kind: "media-receipt",
              projectId: project.id,
              title: "Media upload",
              routineId: "web-media",
              identity: { repoId: project.repoId, artifactId: row.id },
              parentId: null,
              retryOf: null,
              source: { kind: "private-media" },
              provider: { status: row.state, conclusion: null },
              state: stateOf(row.state),
              acceptance: "not-established",
              startedAt: null,
              completedAt: null,
              updatedAt: row.createdAt,
              timeBasis: "receipt-created-at",
              actor: row.uploaderId,
              worker: null,
              model: null,
              cost: runCost(),
              link: null,
              detailUrl: `/projects/${project.id}/media/${row.id}`,
              availability: row.availability,
              objectCheck: "not-checked",
              expiresAt: row.expiresAt,
            });
          }
          if (page.nextCursor)
            gaps.push({
              source: "web-media",
              reason:
                "Additional private media receipts remain on the next page.",
              code: "unvisited",
            });
        } catch (error) {
          if (denied(error)) throw error;
          next.mediaDone = true;
          gaps.push({
            source: "web-media",
            reason: "Private media receipt listing is unavailable.",
            code: "unavailable",
          });
        }
    }
    let observations = [];
    if (snapshot) {
      const authored = await readRunRecords(project, snapshot, {
        nightPage: position.nightPage,
        cliPage: position.cliPage,
      });
      available++;
      observations = authored.observations;
      gaps.push(...authored.gaps);
      Object.assign(next, authored.pagination);
    } else {
      next.nightPage = null;
      next.cliPage = null;
      gaps.push({
        source: "repository-records",
        reason: "Immutable night and CLI source records are unavailable.",
        code: "unavailable",
      });
    }
    gaps.push({
      source: "history",
      reason:
        "Only retained observed pages are shown. Private record time may be inferred from its preview; it is not an execution start. Inserts can shift later pages.",
      code: "coverage",
    });
    const selected = visibleRows(items, filters, now()),
      authored = visibleRows(observations, filters, now());
    const more =
      !next.webDone ||
      !next.mediaDone ||
      next.nightPage !== null ||
      next.cliPage !== null;
    return {
      schema: 1,
      project,
      readAt,
      items: selected,
      observations: authored,
      coverage: runCoverage(
        [...selected, ...authored],
        gaps,
        window,
        !available,
      ),
      filters,
      pagination: { nextCursor: more ? nextHistoryCursor(key, next) : null },
    };
  }
  async function migrations(access, token, options = {}) {
    authorize(access);
    const filters = receiptFilters(options),
      window = receiptWindow(filters, now()),
      key = binding(
        access,
        "migration-history",
        config.workspace.repoId,
        filters,
      );
    const position = historyCursor(options.after ?? null, key, { after: null });
    if (
      !exact(position, ["after"]) ||
      (position.after !== null && !runId(position.after))
    )
      throw new WebError("invalid_run_cursor", 400);
    const { workspace } = await createLearning(config, { fetcher }).workspace(
      access,
      token,
    );
    const scope = hash(
      JSON.stringify([
        "migration-v1",
        config.appId,
        config.installationId,
        config.workspace.repoId,
        config.workspace.id,
        access.userId,
      ]),
    );
    const projectKey = hash(
      JSON.stringify([
        "migration-v1",
        config.appId,
        config.installationId,
        config.workspace.repoId,
      ]),
    );
    const items = [],
      gaps = [];
    let page,
      available = true;
    try {
      page = await store.list(scope, projectKey, { after: position.after });
      for (const row of page.rows) {
        const value = row.value;
        if (
          value?.kind !== "migration" ||
          !Array.isArray(value.projects) ||
          value.projects.length < 1 ||
          value.projects.length > 3
        ) {
          gaps.push({
            source: "web-migration",
            reason: "A migration payload could not be validated.",
            code: "invalid",
          });
          continue;
        }
        if (
          !value.projects.every(
            (p) =>
              p &&
              config.projectRepoIds[p.id] === p.repoId &&
              access.projects.some(
                (current) =>
                  current.id === p.id &&
                  current.repoId === p.repoId &&
                  current.repo === p.repo,
              ),
          )
        ) {
          gaps.push({
            source: "web-migration",
            reason:
              "A private migration involves a source that is no longer authorized; its details are withheld.",
            code: "withheld",
          });
          continue;
        }
        try {
          items.push(
            receiptSummary(row, access, workspace, null, "web-migration"),
          );
        } catch {
          gaps.push({
            source: "web-migration",
            reason: "A migration receipt failed identity validation.",
            code: "invalid",
          });
        }
      }
    } catch (error) {
      if (denied(error)) throw error;
      available = false;
      gaps.push({
        source: "web-migration",
        reason:
          "Private migration history is unavailable; no empty-history claim is made.",
        code: "unavailable",
      });
    }
    if (page?.hasMore)
      gaps.push({
        source: "web-migration",
        reason: "Additional private migration records remain.",
        code: "unvisited",
      });
    gaps.push({
      source: "history",
      reason:
        "Only this actor’s retained migration receipts are listed; a recorded copy is not project acceptance.",
      code: "coverage",
    });
    const selected = visibleRows(items, filters, now());
    return {
      schema: 1,
      workspace,
      readAt: new Date(now()).toISOString(),
      items: selected,
      observations: [],
      coverage: runCoverage(selected, gaps, window, !available),
      filters,
      pagination: {
        nextCursor: page?.hasMore
          ? nextHistoryCursor(key, { after: page.after })
          : null,
      },
    };
  }
  return { list, migrations };
}

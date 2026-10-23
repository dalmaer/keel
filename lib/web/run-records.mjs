// Immutable authored observations, never provider execution attempts.
import { validatePlan } from "../../practices/night/files/scripts/plates/night-plan.mjs";
import { isStallsReceipt } from "../../practices/night/files/scripts/plates/time-receipts.mjs";
import { dailyDate, sourceUrl } from "./daily-model.mjs";
import { WebError, exact } from "./common.mjs";
import {
  states,
  matchesWindow,
  unknownCost,
  workflowPath,
} from "./run-model.mjs";

export const runCost = () =>
  unknownCost(
    "No authenticated execution cost evidence is present in this record.",
  );
export const runDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT/.test(value) &&
  Number.isFinite(Date.parse(value));
export const runId = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const statuses = new Set(states);
const receiptRoutines = new Set([
  "web-decision",
  "web-walk",
  "web-migration",
  "web-media",
  "night",
  "cli-stalls",
]);
export function receiptFilters({
  days = 30,
  routine = null,
  status = null,
} = {}) {
  if (typeof days === "string" && /^\d{1,2}$/.test(days)) days = Number(days);
  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > 90 ||
    (routine !== null &&
      !workflowPath(routine) &&
      !receiptRoutines.has(routine)) ||
    (status !== null && !statuses.has(status))
  )
    throw new WebError("invalid_run_filter", 400);
  return { days, routine, status };
}
export function receiptWindow(filters, now) {
  return {
    days: filters.days,
    from: new Date(now - filters.days * 86400000).toISOString(),
    to: new Date(now).toISOString(),
  };
}
export function visibleRows(rows, filters, now) {
  return rows.filter((row) => matchesWindow(row, filters, now));
}
export function runCoverage(rows, gaps, window, unavailable = false) {
  const dates = rows
    .map((row) => row.updatedAt)
    .filter(runDate)
    .sort();
  return {
    state: unavailable
      ? "unavailable"
      : gaps.length
        ? "partial"
        : "complete-page",
    gaps,
    observed: rows.length,
    window,
    observedRange: dates.length ? { from: dates[0], to: dates.at(-1) } : null,
  };
}
export function historyCursor(value, binding, initial) {
  if (value === null) return structuredClone(initial);
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw new WebError("invalid_run_cursor", 400);
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new WebError("invalid_run_cursor", 400);
  }
  if (
    !exact(parsed, ["version", "binding", "position"]) ||
    parsed.version !== 1 ||
    JSON.stringify(parsed.binding) !== JSON.stringify(binding)
  )
    throw new WebError("invalid_run_cursor", 400);
  return parsed.position;
}
export const nextHistoryCursor = (binding, position) =>
  Buffer.from(JSON.stringify({ version: 1, binding, position })).toString(
    "base64url",
  );
function authored(
  project,
  snapshot,
  path,
  identity,
  title,
  routineId,
  status,
  at,
) {
  const source = {
    kind: routineId === "night" ? "night-record" : "cli-record",
    repoId: project.repoId,
    path,
    revision: snapshot.source.head,
    blob: snapshot.entries.get(path).sha,
  };
  return {
    id: JSON.stringify([
      source.kind,
      project.repoId,
      path,
      source.revision,
      ...identity,
    ]),
    kind: routineId === "night" ? "authored-night" : "authored-cli",
    projectId: project.id,
    title,
    routineId,
    identity: {
      repoId: project.repoId,
      path,
      revision: source.revision,
      record: identity,
    },
    parentId: null,
    retryOf: null,
    source,
    provider: { status, conclusion: null },
    state: "unknown",
    acceptance: "not-established",
    startedAt: null,
    completedAt: null,
    updatedAt: at,
    timeBasis: "authored-record",
    actor: null,
    worker: null,
    model: null,
    cost: runCost(),
    link: sourceUrl(project, source.revision, path),
    detailUrl: null,
  };
}
export async function readRunRecords(
  project,
  snapshot,
  { nightPage = 1, cliPage = 1 } = {},
) {
  for (const page of [nightPage, cliPage])
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > 10000))
      throw new WebError("invalid_run_page", 400);
  const observations = [],
    gaps = [],
    pagination = { nightPage: null, cliPage: null };
  let bytes = 0;
  async function read(path) {
    const entry = snapshot.entries.get(path);
    if (
      entry.type !== "blob" ||
      !["100644", "100755"].includes(entry.mode) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0
    )
      throw new WebError("record_invalid");
    if (entry.size > 262144) throw new WebError("record_too_large");
    if (bytes + entry.size > 4 * 1024 * 1024)
      throw new WebError("record_limit");
    bytes += entry.size;
    const buffer = await snapshot.reader.readFile(path);
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      );
    } catch {
      throw new WebError("record_invalid");
    }
  }
  const nights = [...snapshot.entries.keys()]
    .filter((path) => /^docs\/night\/\d{4}-\d\d-\d\d\.json$/.test(path))
    .sort()
    .reverse();
  const cli = [...snapshot.entries.keys()]
    .filter((path) => /^\.(?:plates|keel)\/test-runs\/[^/]+\.json$/.test(path))
    .sort()
    .reverse();
  for (const [kind, paths, page] of [
    ["night", nights, nightPage],
    ["cli", cli, cliPage],
  ]) {
    if (page === null) continue;
    const selected = paths.slice((page - 1) * 30, page * 30);
    if (!selected.length)
      gaps.push({
        source: kind,
        reason: paths.length
          ? "Requested archived page has no records."
          : "No retained records of this source exist at the inspected revision.",
        code: "absent",
      });
    if (paths.length > page * 30) {
      pagination[`${kind}Page`] = page + 1;
      gaps.push({
        source: kind,
        reason:
          "More immutable archived files remain; this page reads at most thirty.",
        code: "unvisited",
      });
    }
    for (const path of selected) {
      try {
        const value = await read(path);
        if (kind === "night") {
          const date = path.slice(11, 21);
          if (
            !dailyDate(date) ||
            value?.date !== date ||
            !validatePlan(value).ok
          )
            throw new WebError("record_invalid");
          for (const item of value.items) {
            const row = authored(
              project,
              snapshot,
              path,
              [item.id],
              item.title,
              "night",
              item.status,
              `${date}T00:00:00.000Z`,
            );
            row.state =
              {
                planned: "queued",
                running: "running",
                done: "succeeded",
                failed: "failed",
                skipped: "skipped",
                "left-alone": "skipped",
              }[item.status] ?? "unknown";
            row.lane = item.lane;
            row.itemId = item.id;
            row.allocatedMinutes = item.budget?.minutes ?? null;
            row.detailUrl = `/projects/${project.id}/daily?date=${date}`;
            // An authored result is not an authenticated provider link or execution join.
            row.resultPresent =
              item.result !== null && item.result !== undefined;
            observations.push(row);
          }
        } else {
          if (value?.kind !== "stalls")
            throw new WebError("record_unsupported");
          if (
            value.version !== 1 ||
            value.completed !== true ||
            !Array.isArray(value.stallsReceipts) ||
            value.stallsReceipts.length < 1 ||
            value.stallsReceipts.length > 2000 ||
            !value.stallsReceipts.every(isStallsReceipt) ||
            typeof value.date !== "string" ||
            !runDate(value.date) ||
            !Array.isArray(value.tests) ||
            value.tests.length
          )
            throw new WebError("record_invalid");
          const receipts = value.stallsReceipts,
            ids = new Set();
          for (const receipt of receipts) {
            if (ids.has(receipt.id) || !receipt.id)
              throw new WebError("record_invalid");
            ids.add(receipt.id);
          }
          const row = authored(
            project,
            snapshot,
            path,
            [snapshot.entries.get(path).sha],
            "Archived stalls observations",
            "cli-stalls",
            "authored",
            new Date(value.date).toISOString(),
          );
          row.observationCount = receipts.length;
          row.outcomes = {};
          for (const receipt of receipts)
            row.outcomes[receipt.stalled] =
              (row.outcomes[receipt.stalled] ?? 0) + 1;
          row.declaredComplete = receipts.every((receipt) => receipt.complete);
          row.timeBasis = "authored-cli-record";
          observations.push(row);
        }
      } catch (error) {
        if (
          [401, 403, 404].includes(error.status) ||
          error.code === "access_denied"
        )
          throw error;
        const reasons = {
          record_unsupported: [
            "unsupported",
            "Archived CLI format is unsupported; no execution claim was inferred.",
          ],
          record_invalid: [
            "invalid",
            "Archived record does not satisfy its canonical schema.",
          ],
          record_too_large: [
            "too-large",
            "Archived file exceeds the 256KiB per-file bound.",
          ],
          record_limit: [
            "bounded",
            "Archived files exceed the 4MiB aggregate read bound.",
          ],
        };
        const [code, reason] = reasons[error.code] ?? [
          "unavailable",
          "Archived source could not be read within its limits.",
        ];
        gaps.push({ source: path, reason, code });
      }
    }
  }
  gaps.push({
    source: "local-cli",
    reason:
      "Local machine reporting is not connected; retained authored files do not establish complete execution history.",
    code: "not-connected",
  });
  return { observations, gaps, pagination };
}

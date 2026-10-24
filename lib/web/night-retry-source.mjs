import { PLATES_NIGHT_CANONICAL } from './night-retry-current.mjs';
import { featureRestoreReady } from './recovery.mjs';
import { createLearning, learningTransport } from "./learning.mjs";
import { createDecisionGitHub } from "./decision-github.mjs";
import {
  exact,
  hash,
  numeric,
  projectId,
  requestJson,
  WebError,
} from "./common.mjs";
import { jobId, sha, jobsEnabled } from "./job-registry.mjs";
import { sharedBudget } from "./fleet-model.mjs";
import { NIGHT_CANONICAL } from "./night-retry-canonical.mjs";
export const NIGHT_EFFECTS = Object.freeze([
  "current-utc-date-and-current-plan-read",
  "canonical-measurement-and-report",
  "canonical-plan-ref-write",
  "canonical-health-ref-and-data-pr-write",
  "canonical-data-pr-merge",
]);
export const NIGHT_REVIEW =
  "Owner reviewed the complete pinned source and dependency closure and exact static commands for no model-producing, secret-dependent, dynamic or undeclared effects. Hashes identify that review; they do not prove absence of network or model effects.";
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const text = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_./ :@=,+-]{1,256}$/.test(v);
const iso = (v) =>
  typeof v === "string" &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
export function inventoryDigest(entries) {
  return hash(
    JSON.stringify(
      [...entries]
        .map(([path, e]) => [path, e.type, e.mode, e.sha])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    ),
  );
}
export function dependencyDigest(entries) {
  return inventoryDigest(
    new Map(
      [...entries].filter(([path]) =>
        /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json)$/.test(path),
      ),
    ),
  );
}
export function validateNightProfile(v) {
  if (
    !exact(v, [
      "version",
      "adapter",
      "enabled",
      "projectId",
      "repoId",
      "repositoryNodeId",
      "ownerId",
      "workflow",
      "source",
      "commands",
      "effects",
      "weeklyMinutes",
      "review",
    ]) ||
    v.version !== 1 ||
    v.adapter !== "night-rerun-v1" ||
    typeof v.enabled !== "boolean" ||
    !projectId(v.projectId) ||
    !numeric(v.repoId) ||
    !numeric(v.ownerId) ||
    typeof v.repositoryNodeId !== "string" ||
    !/^[!-~]{1,200}$/.test(v.repositoryNodeId) ||
    !exact(v.workflow, ["id", "path", "branch"]) ||
    !numeric(v.workflow.id) ||
    ![".github/workflows/plates-night.yml", ".github/workflows/keel-night.yml"].includes(v.workflow.path) ||
    typeof v.workflow.branch !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(v.workflow.branch) ||
    v.workflow.branch.includes("..") ||
    !exact(v.source, ["commit", "inventoryDigest"]) ||
    !sha(v.source.commit) ||
    !jobId(v.source.inventoryDigest) ||
    !exact(v.commands, ["setup", "check"]) ||
    !(v.commands.setup === null || text(v.commands.setup)) ||
    !text(v.commands.check) ||
    JSON.stringify(v.effects) !== JSON.stringify(NIGHT_EFFECTS) ||
    !integer(v.weeklyMinutes, 60, 10080) ||
    !exact(v.review, [
      "actorId",
      "reviewedAt",
      "statement",
      "dependencyClosureDigest",
    ]) ||
    !numeric(v.review.actorId) ||
    !iso(v.review.reviewedAt) ||
    v.review.statement !== NIGHT_REVIEW ||
    !jobId(v.review.dependencyClosureDigest)
  )
    throw new WebError("invalid_night_profile", 409);
  return structuredClone(v);
}
function decode(bytes) {
  if (bytes.length > 32768) throw new WebError("night_source_unsupported", 409);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new WebError("night_source_unsupported", 409);
  }
}
export function createNightSource(
  config,
  { fetcher = fetch, now = Date.now } = {},
) {
  const learning = createLearning(config, { fetcher }),
    transport = learningTransport(fetcher);
  const headers = (token) => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  async function get(token, path) {
    return requestJson(
      transport,
      `https://api.github.com${path}`,
      { headers: headers(token), signal: AbortSignal.timeout(15000) },
      262144,
    );
  }
  async function inspect(access, token, project) {
    learning.authorizedProject(access, project);
    const workspace = await learning.workspace(access, token);
    let raw;
    try {
      raw = await workspace.snapshot.reader.readFile(
        `night-retries/${project.id}.json`,
      );
    } catch (e) {
      if (e.code === "ENOENT") throw new WebError("night_not_registered", 409);
      throw e;
    }
    const profile = validateNightProfile(decode(raw));
    if (
      profile.projectId !== project.id ||
      profile.repoId !== project.repoId ||
      !config.ownerIds.includes(profile.review.actorId) ||
      Date.parse(profile.review.reviewedAt) > now()
    )
      throw new WebError("night_identity_changed", 409);
    const snapshot = await createDecisionGitHub(token, {
      fetcher: transport,
    }).snapshot(project);
    const repo = await get(token, `/repositories/${project.repoId}`);
    if (
      repo.id !== project.repoId ||
      repo.full_name !== project.repo ||
      repo.owner?.id !== profile.ownerId ||
      snapshot.source.repositoryNodeId !== profile.repositoryNodeId
    )
      throw new WebError("night_identity_changed", 409);
    if (
      snapshot.source.head !== profile.source.commit ||
      snapshot.source.branch !== profile.workflow.branch ||
      inventoryDigest(snapshot.entries) !== profile.source.inventoryDigest
    )
      throw new WebError("night_source_changed", 409);
    for (const [path, blob] of Object.entries(profile.workflow.path === ".github/workflows/plates-night.yml" ? PLATES_NIGHT_CANONICAL : NIGHT_CANONICAL)) {
      const e = snapshot.entries.get(path);
      if (e?.type !== "blob" || e.mode !== "100644" || e.sha !== blob)
        throw new WebError("night_canonical_source_required", 409);
    }
    if (
      dependencyDigest(snapshot.entries) !==
      profile.review.dependencyClosureDigest
    )
      throw new WebError("night_dependency_review_changed", 409);
    const cfg = decode(await snapshot.reader.readFile(profile.workflow.path === ".github/workflows/plates-night.yml" ? ".plates/plates.json" : ".keel/keel.json"));
    const setup =
      cfg.setup ??
      (snapshot.entries.has("package-lock.json") ? "npm ci" : null);
    if (
      setup !== profile.commands.setup ||
      (cfg.check ?? "npm run check") !== profile.commands.check ||
      cfg.setupToken !== undefined ||
      (cfg.plates ?? cfg.keel) === "self" ||
      ["production", "canvas", "robot", "climb"].some((key) =>
        Object.hasOwn(cfg, key),
      ) ||
      (Object.hasOwn(cfg, "env") && !exact(cfg.env, []))
    )
      throw new WebError("night_effects_unsupported", 409);
    // Every workflow is read: downstream workflow_run may execute arbitrary work.
    const workflows = [...snapshot.entries].filter(
      ([p, e]) =>
        /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) && e.type === "blob",
    );
    if (workflows.length > 30) throw new WebError("night_source_limit", 409);
    for (const [path] of workflows) {
      if (path === profile.workflow.path) continue;
      const body = new TextDecoder("utf-8", { fatal: true }).decode(
        await snapshot.reader.readFile(path),
      );
      if (/\bworkflow_run\b/.test(body))
        throw new WebError("night_downstream_unsupported", 409);
    }
    const workflow = await get(
      token,
      `/repositories/${project.repoId}/actions/workflows/${profile.workflow.id}`,
    );
    if (
      workflow.id !== profile.workflow.id ||
      workflow.path !== profile.workflow.path ||
      workflow.state !== "active"
    )
      throw new WebError("night_workflow_changed", 409);
    const shared = await sharedBudget(
      workspace.snapshot.reader,
      project,
      profile.weeklyMinutes,
      true,
    );
    return {
      profile,
      snapshot,
      source: snapshot.source,
      registryDigest: hash(JSON.stringify([hash(raw), shared.digest])),
      workspaceSource: workspace.snapshot.source,
      projectLimit: shared.limit,
    };
  }
  async function run(token, project, profile, runId, attempt = null) {
    if (!numeric(runId) || !(attempt === null || integer(attempt, 1, 51)))
      throw new WebError("invalid_night_attempt", 400);
    const suffix = attempt === null ? "" : `/attempts/${attempt}`;
    const r = await get(
      token,
      `/repositories/${project.repoId}/actions/runs/${runId}${suffix}`,
    );
    const states = [
      "queued",
      "requested",
      "waiting",
      "pending",
      "in_progress",
      "completed",
    ];
    const conclusions = [
      "success",
      "failure",
      "neutral",
      "cancelled",
      "skipped",
      "timed_out",
      "action_required",
      "stale",
      "startup_failure",
    ];
    if (
      r.id !== runId ||
      r.repository?.id !== project.repoId ||
      r.head_repository?.id !== project.repoId ||
      r.workflow_id !== profile.workflow.id ||
      !integer(r.run_attempt, 1, 51) ||
      (attempt !== null && r.run_attempt !== attempt) ||
      r.head_sha !== profile.source.commit ||
      r.head_branch !== profile.workflow.branch ||
      !numeric(r.actor?.id) ||
      !numeric(r.triggering_actor?.id) ||
      !["schedule", "workflow_dispatch"].includes(r.event) ||
      !states.includes(r.status) ||
      !(
        typeof r.created_at === "string" &&
        Number.isFinite(Date.parse(r.created_at))
      ) ||
      !(
        typeof r.updated_at === "string" &&
        Number.isFinite(Date.parse(r.updated_at))
      ) ||
      (r.status === "completed"
        ? !conclusions.includes(r.conclusion)
        : r.conclusion !== null)
    )
      throw new WebError("night_run_identity_changed", 409);
    return {
      runId: r.id,
      attempt: r.run_attempt,
      workflowId: r.workflow_id,
      sha: r.head_sha,
      ref: r.head_branch,
      state: r.status,
      conclusion: r.conclusion,
      url: `https://github.com/${project.repo}/actions/runs/${r.id}`,
      actorId: r.actor.id,
      triggeringActorId: r.triggering_actor.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
  function ready(access, checked) {
    const n = config.nightOperations;
    return (
      jobsEnabled(config, now()) &&
      n?.retryEnabled === true &&
      iso(n.verifiedAt) &&
      Date.parse(n.verifiedAt) <= now() &&
      iso(n.restoreReconciledAt) &&
      Date.parse(n.restoreReconciledAt) <= now() &&
      featureRestoreReady(config, n.restoreReconciledAt, now()) &&
      n.profiles.includes(checked.profile.projectId) &&
      checked.profile.enabled &&
      access.actionsPermission === "write" &&
      checked.snapshot.canWrite
    );
  }
  return {
    authorize: learning.authorizedProject,
    inspect,
    run,
    ready,
    headers,
  };
}

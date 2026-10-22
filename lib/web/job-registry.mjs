import { validateUpdateRegistry, sharedBudget } from "./fleet-model.mjs";
import { TYPECHECK_WORKFLOW, LEGACY_TYPECHECK_WORKFLOW } from "./job-workflow.mjs";
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
export const jobId = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const sha = (v) => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
export const workflowPath = (v) =>
  typeof v === "string" &&
  /^\.github\/workflows\/[A-Za-z0-9_-]{1,100}\.ya?ml$/.test(v);
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
export function validateWorker(value) {
  if (value?.adapter === "update-preparation-v1")
    return validateUpdateRegistry(value);
  const fields = [
    "version",
    "projectId",
    "repoId",
    "ownerId",
    "enabled",
    "adapter",
    "protocol",
    "workflow",
    "timeoutMinutes",
    "weeklyMinutes",
    "concurrency",
    "schedule",
  ];
  if (
    !exact(value, fields) ||
    value.version !== 1 ||
    !projectId(value.projectId) ||
    !numeric(value.repoId) ||
    !numeric(value.ownerId) ||
    typeof value.enabled !== "boolean" ||
    !["typecheck-v1", "typecheck-schedule-v1"].includes(value.adapter) ||
    value.protocol !== 1 ||
    value.concurrency !== 1 ||
    !integer(value.weeklyMinutes, 1, 10080) ||
    !exact(value.workflow, [
      "id",
      "path",
      "branch",
      "job",
      "workflowBlob",
      "bridgePath",
      "bridgeBlob",
      "runtimeBlob",
    ]) ||
    !numeric(value.workflow.id) ||
    !workflowPath(value.workflow.path) ||
    typeof value.workflow.branch !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(value.workflow.branch) ||
    value.workflow.branch.includes("..") ||
    value.workflow.branch.endsWith("/") ||
    !integer(value.timeoutMinutes, 1, 60)
  )
    throw new WebError("invalid_worker_registry", 409);
  if (value.adapter === "typecheck-v1") {
    if (
      value.timeoutMinutes !== 15 ||
      value.weeklyMinutes < 15 ||
      value.workflow.job !== "web-worker" ||
      value.workflow.bridgePath !== "scripts/web-worker.mjs" ||
      ![
        value.workflow.workflowBlob,
        value.workflow.bridgeBlob,
        value.workflow.runtimeBlob,
      ].every(sha) ||
      value.schedule !== null
    )
      throw new WebError("invalid_worker_registry", 409);
  } else if (
    value.workflow.job !== "typecheck" ||
    [
      value.workflow.workflowBlob,
      value.workflow.bridgePath,
      value.workflow.bridgeBlob,
      value.workflow.runtimeBlob,
    ].some((v) => v !== null) ||
    !exact(value.schedule, ["bodyDigest", "maxRunsPer7Days"]) ||
    !jobId(value.schedule.bodyDigest) ||
    !integer(value.schedule.maxRunsPer7Days, 1, 7)
  )
    throw new WebError("invalid_worker_registry", 409);
  return structuredClone(value);
}
export function jobsEnabled(config, now = Date.now()) {
  const c = config.jobs,
    date = (v) =>
      typeof v === "string" &&
      Number.isFinite(Date.parse(v)) &&
      Date.parse(v) <= now;
  return (
    c?.enabled === true &&
    date(c.verifiedAt) &&
    date(c.restoreReconciledAt) &&
    integer(c.weeklyMinutes, 1, 10080)
  );
}
export function createJobRegistry(
  config,
  { fetcher = fetch, now = Date.now } = {},
) {
  const learning = createLearning(config, { fetcher }),
    transport = learningTransport(fetcher);
  function authorize(access, project) {
    learning.authorizedProject(access, project);
  }
  async function inspect(access, token, project) {
    authorize(access, project);
    const workspace = await learning.workspace(access, token),
      path = `workers/${project.id}.json`;
    let raw;
    try {
      raw = await workspace.snapshot.reader.readFile(path);
    } catch (e) {
      if (e.code === "ENOENT") throw new WebError("worker_not_registered", 409);
      throw e;
    }
    if (raw.length > 16384) throw new WebError("invalid_worker_registry", 409);
    let registry;
    try {
      registry = validateWorker(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
      );
    } catch (e) {
      if (e instanceof WebError) throw e;
      throw new WebError("invalid_worker_registry", 409);
    }
    if (registry.projectId !== project.id || registry.repoId !== project.repoId)
      throw new WebError("worker_identity_changed", 409);
    const provider = createDecisionGitHub(token, { fetcher: transport }),
      snapshot = await provider.snapshot(project);
    if (snapshot.source.branch !== registry.workflow.branch)
      throw new WebError("worker_source_changed", 409);
    const repo = await requestJson(
      transport,
      `https://api.github.com/repositories/${project.repoId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
      65536,
    );
    if (
      repo.id !== project.repoId ||
      repo.owner?.id !== registry.ownerId ||
      repo.full_name !== project.repo
    )
      throw new WebError("worker_identity_changed", 409);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(
      await snapshot.reader.readFile(registry.workflow.path),
    );
    if (registry.adapter === "typecheck-v1") {
      if (![TYPECHECK_WORKFLOW, LEGACY_TYPECHECK_WORKFLOW].includes(content))
        throw new WebError("worker_source_unsupported", 409);
      for (const [path, blob] of [
        [registry.workflow.path, registry.workflow.workflowBlob],
        [registry.workflow.bridgePath, registry.workflow.bridgeBlob],
        ["lib/web/job-worker.mjs", registry.workflow.runtimeBlob],
      ]) {
        await snapshot.reader.readFile(path);
        if (snapshot.entries.get(path)?.sha !== blob)
          throw new WebError("worker_source_changed", 409);
      }
    }
    const shared = await sharedBudget(
      workspace.snapshot.reader,
      project,
      registry.weeklyMinutes,
    );
    return {
      registry,
      effectiveWeeklyMinutes: shared.limit,
      registryDigest: shared.digest
        ? hash(JSON.stringify([hash(raw), shared.digest]))
        : hash(raw),
      registryPath: path,
      workspaceSource: workspace.snapshot.source,
      source: snapshot.source,
      content,
      snapshot,
      provider,
      project,
    };
  }
  const canStart = (access, checked) =>
    jobsEnabled(config, now()) &&
    checked.registry.enabled &&
    checked.registry.adapter === "typecheck-v1" &&
    access.actionsPermission === "write" &&
    checked.snapshot.canWrite;
  return { authorize, inspect, canStart };
}

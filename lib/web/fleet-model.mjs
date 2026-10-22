import { exact, hash, numeric, WebError } from "./common.mjs";
export const digestId = (v) =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const oid = (v) => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
export const nodeId = (v) => typeof v === "string" && /^[!-~]{1,200}$/.test(v);
export const version = (v) =>
  typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v);
export function validateTarget(v) {
  if (
    !exact(v, [
      "repoId",
      "repositoryNodeId",
      "repo",
      "commit",
      "cliVersion",
      "practiceVersion",
      "bundleDigest",
    ]) ||
    !numeric(v.repoId) ||
    !nodeId(v.repositoryNodeId) ||
    typeof v.repo !== "string" ||
    !/^[-\w.]+\/[-\w.]+$/.test(v.repo) ||
    !oid(v.commit) ||
    !version(v.cliVersion) ||
    !version(v.practiceVersion) ||
    !digestId(v.bundleDigest)
  )
    throw new WebError("invalid_update_target", 409);
  return structuredClone(v);
}
export function validateUpdateRegistry(v) {
  const fields = [
    "version",
    "projectId",
    "repoId",
    "ownerId",
    "enabled",
    "adapter",
    "protocol",
    "concurrency",
    "timeoutMinutes",
    "weeklyMinutes",
    "schedule",
    "workflow",
    "container",
  ];
  if (
    !exact(v, fields) ||
    v.version !== 1 ||
    typeof v.projectId !== "string" ||
    !/^[-a-z0-9]{1,64}$/.test(v.projectId) ||
    !numeric(v.repoId) ||
    !numeric(v.ownerId) ||
    typeof v.enabled !== "boolean" ||
    v.adapter !== "update-preparation-v1" ||
    v.protocol !== 1 ||
    v.concurrency !== 1 ||
    v.timeoutMinutes !== 60 ||
    !Number.isInteger(v.weeklyMinutes) ||
    v.weeklyMinutes < 1 ||
    v.weeklyMinutes > 10080 ||
    v.schedule !== null
  )
    throw new WebError("invalid_worker_registry", 409);
  const w = v.workflow,
    c = v.container;
  if (
    !exact(w, [
      "id",
      "path",
      "branch",
      "job",
      "workflowBlob",
      "bridgePath",
      "bridgeBlob",
      "runtimeBlob",
    ]) ||
    !numeric(w.id) ||
    typeof w.path !== "string" ||
    !/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(w.path) ||
    typeof w.branch !== "string" ||
    !/^[-\w./]{1,200}$/.test(w.branch) ||
    w.branch.includes("..") ||
    w.job !== "web-worker" ||
    w.bridgePath !== "scripts/web-update-worker.mjs" ||
    ![w.workflowBlob, w.bridgeBlob, w.runtimeBlob].every(oid) ||
    !exact(c, ["image", "platform", "network"]) ||
    typeof c.image !== "string" ||
    !/^node@sha256:[a-f0-9]{64}$/.test(c.image) ||
    !["linux/amd64", "linux/arm64"].includes(c.platform) ||
    !["none", "bridge"].includes(c.network)
  )
    throw new WebError("invalid_worker_registry", 409);
  return structuredClone(v);
}
export async function sharedBudget(reader, project, cap, required = false) {
  let bytes;
  try {
    bytes = await reader.readFile(`job-budgets/${project.id}.json`);
  } catch (e) {
    if (e.code === "ENOENT" && !required) return { limit: cap, digest: null };
    throw new WebError("shared_job_budget_unavailable", 409);
  }
  let v;
  try {
    if (bytes.length > 4096) throw 0;
    v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new WebError("invalid_shared_job_budget", 409);
  }
  if (
    !exact(v, ["version", "projectId", "repoId", "weeklyMinutes"]) ||
    v.version !== 1 ||
    v.projectId !== project.id ||
    v.repoId !== project.repoId ||
    !Number.isInteger(v.weeklyMinutes) ||
    v.weeklyMinutes < 1 ||
    v.weeklyMinutes > 10080
  )
    throw new WebError("invalid_shared_job_budget", 409);
  return { limit: Math.min(cap, v.weeklyMinutes), digest: hash(bytes) };
}

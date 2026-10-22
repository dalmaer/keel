import { createLearning } from "./learning.mjs";
import { createFleetProvider } from "./fleet-provider.mjs";
import {
  validateUpdateRegistry,
  validateTarget,
  sharedBudget,
} from "./fleet-model.mjs";
import { canonicalUpdateWorkflow } from "./update-workflow.mjs";
import { hash, WebError } from "./common.mjs";
import { jobsEnabled } from "./job-registry.mjs";
export function createUpdateRegistry(
  config,
  { fetcher = fetch, now = Date.now } = {},
) {
  const learning = createLearning(config, { fetcher });
  const authorize = (access, project) =>
    learning.authorizedProject(access, project);
  async function inspect(access, token, project) {
    authorize(access, project);
    const target = validateTarget(config.fleetUpdates?.target),
      workspace = await learning.workspace(access, token),
      path = `update-workers/${project.id}.json`;
    let bytes;
    try {
      bytes = await workspace.snapshot.reader.readFile(path);
    } catch {
      throw new WebError("update_worker_not_registered", 409);
    }
    let r;
    try {
      if (bytes.length > 16384) throw 0;
      r = validateUpdateRegistry(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
    } catch {
      throw new WebError("invalid_worker_registry", 409);
    }
    if (r.projectId !== project.id || r.repoId !== project.repoId)
      throw new WebError("worker_identity_changed", 409);
    const budget = await sharedBudget(
        workspace.snapshot.reader,
        project,
        r.weeklyMinutes,
        true,
      ),
      provider = createFleetProvider(token, { fetcher }),
      snapshot = await provider.snapshot(project),
      repo = await provider.identity(project),
      trusted = await provider.target(target);
    if (
      repo.owner?.id !== r.ownerId ||
      snapshot.source.branch !== r.workflow.branch
    )
      throw new WebError("worker_identity_changed", 409);
    const content = (
      await snapshot.reader.readFile(r.workflow.path)
    ).toString();
    if (
      content !== canonicalUpdateWorkflow(target) ||
      snapshot.entries.get(r.workflow.path)?.sha !== r.workflow.workflowBlob ||
      trusted.entries.get(r.workflow.bridgePath)?.sha !==
        r.workflow.bridgeBlob ||
      trusted.entries.get("lib/web/update-worker.mjs")?.sha !==
        r.workflow.runtimeBlob
    )
      throw new WebError("worker_source_changed", 409);
    const cfg = JSON.parse(
      (await snapshot.reader.readFile(".keel/keel.json")).toString(),
    );
    if (cfg.keel === "self") throw new WebError("update_self_ineligible", 409);
    const setup =
        cfg.setup ??
        (snapshot.entries.has("package-lock.json") ? "npm ci" : null),
      check = cfg.check ?? "npm run check",
      env = cfg.env ?? {};
    if (
      (setup !== null &&
        (typeof setup !== "string" || !setup.trim() || setup.length > 4000)) ||
      typeof check !== "string" ||
      !check.trim() ||
      check.length > 4000 ||
      !env ||
      typeof env !== "object" ||
      Array.isArray(env) ||
      Object.keys(env).length > 100 ||
      Object.entries(env).some(
        ([k, v]) =>
          !/^[_A-Za-z][_A-Za-z0-9]*$/.test(k) ||
          typeof v !== "string" ||
          v.length > 4096,
      )
    )
      throw new WebError("unsupported_update_commands", 409);
    const preparation = {
      base: {
        repoId: project.repoId,
        repositoryNodeId: snapshot.source.repositoryNodeId,
        commit: snapshot.source.head,
      },
      target,
      container: r.container,
      setup,
      check,
      env,
    };
    return {
      registry: r,
      registryDigest: hash(
        JSON.stringify([hash(bytes), budget.digest, target, preparation]),
      ),
      registryPath: path,
      workspaceSource: workspace.snapshot.source,
      source: snapshot.source,
      snapshot,
      project,
      provider,
      content,
      preparation,
      effectiveWeeklyMinutes: budget.limit,
    };
  }
  const canStart = (a, c) =>
    config.fleetUpdates?.enabled === true &&
    jobsEnabled(config, now()) &&
    c.registry.enabled &&
    a.actionsPermission === "write" &&
    c.snapshot.canWrite &&
    c.effectiveWeeklyMinutes >= 60;
  return { authorize, inspect, canStart };
}

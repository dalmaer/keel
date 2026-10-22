import { createOperationStore } from "./operation-store.mjs";
import { createDecisionGitHub } from "./decision-github.mjs";
import { learningTransport } from "./learning.mjs";
import { exact, hash, random, record, WebError } from "./common.mjs";
import { jobId, jobsEnabled } from "./job-registry.mjs";
// A deliberately small project-owned source language, not a general YAML editor.
export function scheduleWorkflow(cron = "23 7 * * *", timeout = 15) {
  return `name: typecheck\n\non:\n  push:\n    branches: [main]\n  pull_request:\n  workflow_dispatch: {}\n  schedule:\n    - cron: "${cron}"\n\npermissions:\n  contents: read\n\nconcurrency:\n  group: typecheck\n  cancel-in-progress: false\n\njobs:\n  typecheck:\n    runs-on: ubuntu-latest\n    timeout-minutes: ${timeout}\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n      - uses: actions/setup-node@v7\n        with:\n          node-version-file: .nvmrc\n          cache: npm\n      - run: npm ci --ignore-scripts\n      - run: npm run typecheck\n`;
}
function cronValue(value) {
  if (typeof value !== "string")
    throw new WebError("unsupported_schedule", 409);
  const m = value.match(
    /^([0-9]|[1-5][0-9]) ([0-9]|1[0-9]|2[0-3]) \* \* (\*|[0-6])$/,
  );
  if (!m) throw new WebError("unsupported_schedule", 409);
  return { cron: value, runs: m[3] === "*" ? 7 : 1 };
}
export async function inspectSchedule(checked, proposed = null) {
  const r = checked.registry;
  if (r.adapter !== "typecheck-schedule-v1")
    throw new WebError("schedule_not_supported", 409);
  let lock;
  // The complete immutable tree establishes absence. An unreadable/malformed
  // canonical blob must not fall through to an older ownership declaration.
  const lockPath = checked.snapshot.entries.has(".plates/lock.json") ? ".plates/lock.json"
    : checked.snapshot.entries.has(".keel/lock.json") ? ".keel/lock.json" : null;
  if (lockPath) {
    try {
      lock = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        await checked.snapshot.reader.readFile(lockPath),
      ));
    } catch (error) {
      if ([401, 404].includes(error.status)) throw error;
      throw new WebError("schedule_ownership_unavailable", 409);
    }
  }
  if (lock !== undefined && (!record(lock) || !record(lock.files)))
    throw new WebError("schedule_ownership_unavailable", 409);
  if (lock?.files && Object.hasOwn(lock.files, r.workflow.path))
    throw new WebError("schedule_managed_source", 409);
  const matches = [...checked.content.matchAll(/^    - cron: "([^"\n]+)"$/gm)];
  if (matches.length !== 1) throw new WebError("unsupported_schedule", 409);
  const current = cronValue(matches[0][1]),
    next = cronValue(proposed ?? current.cron);
  if (
    checked.content !== scheduleWorkflow(current.cron, r.timeoutMinutes) ||
    hash(scheduleWorkflow("0 0 * * *", r.timeoutMinutes)) !==
      r.schedule.bodyDigest
  )
    throw new WebError("schedule_source_changed", 409);
  if (
    [current, next].some(
      (v) =>
        v.runs > r.schedule.maxRunsPer7Days ||
        v.runs * r.timeoutMinutes > r.weeklyMinutes,
    )
  )
    throw new WebError("schedule_budget_exceeded", 409);
  return {
    current: current.cron,
    proposed: next.cron,
    timezone: "UTC",
    timeoutMinutes: r.timeoutMinutes,
    maxRunsPer7Days: r.schedule.maxRunsPer7Days,
    weeklyMinutes: r.weeklyMinutes,
    scheduledMinutes: next.runs * r.timeoutMinutes,
    overlap: "constant group; cancel-in-progress:false",
    budgetMechanism:
      "scheduled frequency × source timeout; separate from web admission",
  };
}
export function createJobSchedules(
  config,
  { fetcher = fetch, now = Date.now, registry } = {},
) {
  const store = createOperationStore(config, fetcher),
    scopeFor = (actor, project) =>
      hash(
        JSON.stringify([
          "job-schedule-v1",
          config.appId,
          config.installationId,
          config.workspace.repoId,
          actor,
          project.repoId,
        ]),
      );
  const allowed = (access, checked) =>
    jobsEnabled(config, now()) &&
    config.jobs.scheduleWrites === true &&
    checked.registry.enabled &&
    access.contentsPermission === "write" &&
    access.workflowsPermission === "write" &&
    checked.snapshot.canWrite;
  async function preview(access, token, project, input) {
    if (!exact(input, ["routineId", "cron"]))
      throw new WebError("invalid_schedule", 400);
    const checked = await registry.inspect(access, token, project);
    if (input.routineId !== checked.registry.workflow.path)
      throw new WebError("routine_not_found", 404);
    const schedule = await inspectSchedule(checked, input.cron);
    if (schedule.current === schedule.proposed)
      throw new WebError("schedule_unchanged", 409);
    const previewId = hash(random()),
      requestId = hash(random()),
      file = {
        path: input.routineId,
        before: checked.content,
        content: scheduleWorkflow(
          schedule.proposed,
          checked.registry.timeoutMinutes,
        ),
        originalBlob: checked.snapshot.entries.get(input.routineId).sha,
      };
    const value = {
      schema: 1,
      kind: "schedule",
      previewId,
      requestId,
      operationUrl: `/projects/${project.id}/jobs/${requestId}`,
      expiresAt: new Date(now() + 900000).toISOString(),
      project,
      routineId: input.routineId,
      source: checked.source,
      registryDigest: checked.registryDigest,
      files: [file],
      schedule,
      commitMessage: `Update existing typecheck schedule\n\nKeel-Operation: ${requestId}`,
      canApply: allowed(access, checked),
      limitations: [
        "Scheduled runs do not use web job reservations. Model spend is not established.",
      ],
    };
    value.digest = hash(JSON.stringify(value));
    if (
      !(await store.createPreview(previewId, scopeFor(access.userId, project), {
        ...value,
        actorId: access.userId,
        input,
      }))
    )
      throw new WebError("preview_unavailable");
    return value;
  }
  const view = (row) => ({
    schema: 1,
    id: row.id,
    projectId: row.value.project.id,
    kind: "schedule",
    state: row.state,
    reason: row.value.reason ?? null,
    receipt: row.value.receipt ?? null,
    operationUrl: `/projects/${row.value.project.id}/jobs/${row.id}`,
    capabilities: { cancel: false, retry: false, reconcile: true },
  });
  async function read(access, token, project, id) {
    registry.authorize(access, project);
    const row = await store.read(id, scopeFor(access.userId, project));
    if (
      !row ||
      row.value.kind !== "job-schedule" ||
      row.value.project.repoId !== project.repoId
    )
      throw new WebError("operation_not_found", 404);
    return row;
  }
  async function fresh(access, token, project, reauthorize) {
    if (typeof reauthorize !== "function")
      throw new WebError("authorization_recheck_required", 403);
    const a = await reauthorize();
    if (a.userId !== access.userId) throw new WebError("access_denied", 404);
    registry.authorize(a, project);
    return a;
  }
  async function apply(access, token, project, input, { reauthorize } = {}) {
    if (
      !exact(input, ["requestId", "previewId", "digest"]) ||
      !Object.values(input).every(jobId)
    )
      throw new WebError("invalid_preview", 400);
    registry.authorize(access, project);
    const scope = scopeFor(access.userId, project),
      saved = await store.preview(input.previewId, scope),
      p = saved?.value;
    if (
      !p ||
      p.kind !== "schedule" ||
      p.actorId !== access.userId ||
      p.project.repoId !== project.repoId ||
      p.requestId !== input.requestId ||
      p.digest !== input.digest ||
      Date.parse(p.expiresAt) <= now()
    )
      throw new WebError("stale_preview", 409);
    if (!jobsEnabled(config, now()) || config.jobs.scheduleWrites !== true)
      throw new WebError("jobs_disabled", 503);
    const fence = hash(random()),
      intent = {
        id: p.requestId,
        repo: project.repo,
        ...p.source,
        files: p.files.map(({ path, content, originalBlob }) => ({
          path,
          content,
          originalBlob,
        })),
        commitMessage: p.commitMessage,
        marker: `Keel-Operation: ${p.requestId}`,
      };
    let value = {
      kind: "job-schedule",
      project,
      actorId: access.userId,
      fence,
      intent,
      reason: null,
      receipt: null,
    };
    let row = await store.reserve(
      p.requestId,
      scope,
      hash(
        JSON.stringify([
          "job-schedule-v1",
          config.workspace.repoId,
          project.repoId,
        ]),
      ),
      p.previewId,
      fence,
      value,
    );
    if (row?.conflict) throw new WebError("project_busy", 409);
    if (!row) throw new WebError("preview_expired", 410);
    const a = await fresh(access, token, project, reauthorize);
    if (!row.created) return view(row);
    let checked;
    try {
      checked = await registry.inspect(a, token, project);
      const schedule = await inspectSchedule(checked, p.input.cron);
      if (
        !allowed(a, checked) ||
        checked.registryDigest !== p.registryDigest ||
        JSON.stringify(checked.source) !== JSON.stringify(p.source) ||
        checked.content !== p.files[0].before ||
        schedule.proposed !== p.schedule.proposed
      )
        throw new WebError("stale_preview", 409);
      await checked.provider.recheck(project, p.source);
    } catch (error) {
      row = await store.transition("refused", row.id, scope, fence, {
        ...value,
        reason: error.code ?? "validation_unavailable",
      });
      if ([401, 404].includes(error.status)) throw error;
      return view(row);
    }
    row = await store.transition("dispatched", row.id, scope, fence);
    if (!row) throw new WebError("operation_conflict", 409);
    try {
      const commit = await checked.provider.dispatch(intent),
        found = await checked.provider.recover(intent, commit);
      if (!found) throw new WebError("remote_uncertain");
      row =
        (await store.transition("committed", row.id, scope, fence, {
          ...value,
          receipt: found,
        })) ?? row;
    } catch (error) {
      try {
        row =
          (await store.transition(
            error.code === "remote_refused" ? "refused" : "uncertain",
            row.id,
            scope,
            fence,
            {
              ...value,
              reason: "Inspect the original source operation; do not resubmit.",
            },
          )) ?? row;
      } catch {
        /*Retain dispatched.*/
      }
    }
    await fresh(access, token, project, reauthorize);
    return view(row);
  }
  async function operation(access, token, project, id) {
    return view(await read(access, token, project, id));
  }
  async function recover(access, token, project, id, { reauthorize } = {}) {
    const a = await fresh(access, token, project, reauthorize);
    let row = await read(a, token, project, id);
    if (["dispatched", "uncertain"].includes(row.state)) {
      const found = await createDecisionGitHub(token, {
        fetcher: learningTransport(fetcher),
      }).recover(row.value.intent);
      if (found)
        row =
          (await store.transition(
            "committed",
            id,
            scopeFor(access.userId, project),
            row.value.fence,
            { ...row.value, receipt: found, reason: null },
          )) ?? row;
    }
    await fresh(access, token, project, reauthorize);
    return view(row);
  }
  return { preview, apply, operation, recover, allowed };
}

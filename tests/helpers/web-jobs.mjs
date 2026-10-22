// Acme fixture uses actual auth, immutable Git, Actions and RPC request boundaries.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { learningHarness, token } from "./web-learning.mjs";
import { createJobs } from "../../lib/web/jobs.mjs";
import { createStore } from "../../lib/web/store.mjs";
import { createAuth } from "../../lib/web/auth.mjs";
import { createGitHub } from "../../lib/web/github.mjs";
import { createWebService } from "../../lib/web/server.mjs";
import { hash } from "../../lib/web/common.mjs";
import { scheduleWorkflow } from "../../lib/web/job-schedules.mjs";
export { token };
export const blob = (value) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(value)}\0`)
    .update(value)
    .digest("hex");
function database(now) {
  const previews = new Map(),
    rows = new Map(),
    requests = [];
  const db = {
    previews,
    rows,
    requests,
    after: null,
    lost: null,
    malformed: null,
  };
  db.handle = async (p) => {
    requests.push(p);
    const { p_operation: op, p_scope: scope, p_id: id, p_data: d } = p,
      key = `${scope}:${id}`,
      at = new Date(now()).toISOString();
    let row = rows.get(key),
      changed = false,
      granted = false;
    const conflict = (reason) => Response.json({ conflict: reason });
    const output = async (value) => {
      if (db.after) await db.after(op, value);
      if (db.lost === op) {
        db.lost = null;
        throw new Error("fake-lost-response");
      }
      return Response.json(db.malformed ? db.malformed(op, value) : value);
    };
    if (op === "preview-create") {
      if (previews.has(key)) return output(null);
      const preview = {
        scope,
        id,
        project: d.project,
        actor: d.actor,
        digest: d.digest,
        value: d.value,
        expires_at: new Date(now() + 900000).toISOString(),
      };
      previews.set(key, preview);
      return output({ preview });
    }
    if (op === "preview-read") {
      const p = previews.get(key);
      return output(
        p && Date.parse(p.expires_at) > now() ? { preview: p } : null,
      );
    }
    const scoped = [...rows.values()].filter((r) => r.scope === scope);
    if (op === "budget" || op === "reserve") {
      const charged = scoped.filter(
        (r) =>
          r.charged &&
          (r.terminal_at === null ||
            Date.parse(r.terminal_at) > now() - 604800000),
      );
      const workspaceMinutes = charged.reduce((s, r) => s + r.minutes, 0),
        projectMinutes = charged
          .filter((r) => r.project === d.project)
          .reduce((s, r) => s + r.minutes, 0);
      if (op === "budget") return output({ workspaceMinutes, projectMinutes });
      if (row) {
        if (
          row.actor !== d.actor ||
          row.project !== d.project ||
          row.digest !== d.digest ||
          row.preview !== d.preview
        )
          return conflict("identity");
        return output({ row, changed: false, granted: false });
      }
      const p = previews.get(`${scope}:${d.preview}`);
      if (
        !p ||
        p.digest !== d.digest ||
        p.actor !== d.actor ||
        p.project !== d.project ||
        Date.parse(p.expires_at) <= now()
      )
        return output(null);
      if (
        scoped.some(
          (r) =>
            r.project === d.project &&
            !["terminal", "refused"].includes(r.state),
        )
      )
        return conflict("lane");
      if (
        workspaceMinutes + d.minutes > d.workspaceLimit ||
        projectMinutes + d.minutes > d.projectLimit
      )
        return conflict("budget");
      row = {
        scope,
        id,
        project: d.project,
        actor: d.actor,
        digest: d.digest,
        preview: d.preview,
        value: d.value,
        state: "prepared",
        minutes: d.minutes,
        charged: true,
        run_id: null,
        job_id: null,
        nonce: null,
        fence: null,
        deadline: null,
        lease_until: null,
        sequence: 0,
        worker_result: null,
        provider: null,
        cancel_requested: false,
        cancel_dispatched: false,
        created_at: at,
        updated_at: at,
        terminal_at: null,
      };
      rows.set(key, row);
      return output({ row, changed: true, granted: false });
    }
    if (op === "list") {
      const found = scoped
          .filter(
            (r) =>
              r.project === d.project && (d.after === null || r.id > d.after),
          )
          .sort((a, b) => a.id.localeCompare(b.id)),
        page = found.slice(0, 20);
      return output({
        rows: page,
        after: found.length > 20 ? page.at(-1).id : null,
        hasMore: found.length > 20,
      });
    }
    if (!row) return output(null);
    if (op === "read") return output({ row, changed: false, granted: false });
    if (
      op === "dispatch" &&
      row.state === "prepared" &&
      !row.cancel_requested
    ) {
      row.state = "dispatching";
      changed = granted = true;
    } else if (op === "refuse" && row.state === "prepared") {
      row.state = "refused";
      row.charged = false;
      changed = true;
    } else if (op === "uncertain") {
      if (row.state === "dispatching" && row.run_id === null) {
        row.state = "uncertain";
        changed = true;
      }
    } else if (op === "pin") {
      if (row.run_id !== null && row.run_id !== d.runId)
        return conflict("identity");
      row.run_id = d.runId;
      changed = true;
    } else if (op === "observe") {
      if (
        ["prepared", "refused"].includes(row.state) ||
        (row.run_id !== null && row.run_id !== d.provider.runId)
      )
        return conflict("identity");
      if (row.state !== "terminal") {
        row.run_id = d.provider.runId;
        row.provider = d.provider;
        changed = true;
        if (d.provider.state === "completed") {
          row.state = "terminal";
          row.terminal_at = at;
        } else if (["dispatching", "uncertain"].includes(row.state))
          row.state = "queued";
      }
    } else if (op === "cancel") {
      if (!["terminal", "refused"].includes(row.state)) {
        row.cancel_requested = true;
        changed = true;
        if (row.state === "prepared") {
          row.state = "refused";
          row.charged = false;
        }
      }
    } else if (op === "cancel-dispatch") {
      if (
        row.cancel_requested &&
        !row.cancel_dispatched &&
        row.run_id &&
        !["terminal", "refused", "prepared"].includes(row.state)
      ) {
        row.cancel_dispatched = true;
        changed = granted = true;
      }
    } else if (op === "claim") {
      if (
        row.cancel_requested ||
        ["prepared", "terminal", "refused"].includes(row.state) ||
        (row.run_id !== null && row.run_id !== d.runId)
      )
        return conflict("state");
      if (row.nonce !== null) {
        if (
          row.nonce !== d.nonce ||
          row.job_id !== d.jobId ||
          row.run_id !== d.runId
        )
          return conflict("identity");
      } else {
        if (d.deadline <= now() || d.deadline > now() + 900000)
          return conflict("state");
        Object.assign(row, {
          run_id: d.runId,
          job_id: d.jobId,
          nonce: d.nonce,
          fence: d.fence,
          deadline: new Date(d.deadline).toISOString(),
          lease_until: new Date(
            Math.min(d.deadline, now() + 60000),
          ).toISOString(),
          state: "claimed",
        });
        changed = true;
      }
    } else if (["begin", "heartbeat", "complete"].includes(op)) {
      if (
        row.cancel_requested ||
        row.nonce !== d.nonce ||
        row.fence !== d.fence ||
        row.run_id !== d.runId ||
        row.job_id !== d.jobId ||
        Date.parse(row.deadline) <= now() ||
        Date.parse(row.lease_until) <= now()
      )
        return conflict("state");
      if (op === "begin") {
        if (row.state !== "claimed") return conflict("state");
        row.state = "running";
        changed = granted = true;
      } else {
        if (row.state !== "running" || d.sequence !== row.sequence + 1)
          return conflict("state");
        row.sequence = d.sequence;
        changed = true;
        if (op === "heartbeat")
          row.lease_until = new Date(
            Math.min(Date.parse(row.deadline), now() + 60000),
          ).toISOString();
        else {
          row.worker_result = d.result;
          row.state = "worker-complete";
        }
      }
    } else return conflict("state");
    if (changed) row.updated_at = at;
    return output({ row, changed, granted });
  };
  return db;
}
export async function jobsHarness({ schedule = false } = {}) {
  const h = learningHarness();
  h.state.now = Date.parse("2026-10-21T19:00:00Z");
  const config = {
    ...h.config,
    jobs: {
      enabled: true,
      verifiedAt: "2026-10-20T00:00:00Z",
      restoreReconciledAt: "2026-10-20T00:00:00Z",
      weeklyMinutes: 120,
      scheduleWrites: true,
    },
  };
  const path = ".github/workflows/typecheck.yml",
    workflow = schedule
      ? scheduleWorkflow()
      : readFileSync(
          new URL("../../.github/workflows/typecheck.yml", import.meta.url),
          "utf8",
        );
  h.source.files[path] = workflow;
  for (const p of ["scripts/web-worker.mjs", "lib/web/job-worker.mjs"])
    h.source.files[p] = readFileSync(
      new URL(`../../${p}`, import.meta.url),
      "utf8",
    );
  const registration = {
    version: 1,
    projectId: "studio",
    repoId: 102,
    ownerId: 10,
    enabled: true,
    adapter: schedule ? "typecheck-schedule-v1" : "typecheck-v1",
    protocol: 1,
    workflow: {
      id: 501,
      path,
      branch: "main",
      job: schedule ? "typecheck" : "web-worker",
      workflowBlob: schedule ? null : blob(workflow),
      bridgePath: schedule ? null : "scripts/web-worker.mjs",
      bridgeBlob: schedule
        ? null
        : blob(h.source.files["scripts/web-worker.mjs"]),
      runtimeBlob: schedule
        ? null
        : blob(h.source.files["lib/web/job-worker.mjs"]),
    },
    timeoutMinutes: 15,
    weeklyMinutes: 120,
    concurrency: 1,
    schedule: schedule
      ? { bodyDigest: hash(scheduleWorkflow("0 0 * * *")), maxRunsPer7Days: 7 }
      : null,
  };
  const register = () => {
    h.workspace.files["workers/studio.json"] = JSON.stringify(registration);
  };
  register();
  const db = database(() => h.state.now),
    actions = {
      runs: new Map(),
      jobs: new Map(),
      dispatches: [],
      cancellations: [],
      lost: false,
      runId: 9001,
      afterDispatch: null,
      permission: "write",
      workflowsPermission: "write",
      before: null,
    };
  const fetcher = async (url, opts = {}) => {
    const u = new URL(url),
      p = u.pathname;
    if (p === "/rest/v1/rpc/keel_job_rpc")
      return db.handle(JSON.parse(opts.body));
    if (p === "/user/installations") {
      const response = await h.fetcher(url, opts),
        value = await response.json();
      for (const i of value.installations) {
        i.permissions.actions = actions.permission;
        i.permissions.workflows = actions.workflowsPermission;
      }
      return Response.json(value);
    }
    if (p === "/repositories/102") {
      const response = await h.fetcher(url, opts);
      return Response.json({ ...(await response.json()), owner: { id: 10 } });
    }
    if (p.startsWith("/repositories/102/actions/")) {
      if (actions.before) await actions.before(url, opts);
      if (p.endsWith("/dispatches")) {
        const input = JSON.parse(opts.body);
        actions.dispatches.push(input);
        const id = actions.runId++,
          at = new Date(h.state.now).toISOString();
        const run = {
          id,
          workflow_id: 501,
          run_attempt: 1,
          repository: { id: 102 },
          head_repository: { id: 102 },
          actor: { id: 1 },
          event: "workflow_dispatch",
          head_sha: h.source.head,
          head_branch: input.ref,
          display_title: `keel-web-${input.inputs.keel_operation}`,
          status: "in_progress",
          conclusion: null,
          created_at: at,
          updated_at: at,
        };
        actions.runs.set(id, run);
        actions.jobs.set(id, [
          {
            id: id + 1000,
            run_id: id,
            run_attempt: 1,
            head_sha: h.source.head,
            name: "web-worker",
            status: "in_progress",
            started_at: at,
          },
        ]);
        if (actions.afterDispatch) await actions.afterDispatch(run);
        if (actions.lost) {
          actions.lost = false;
          throw new Error("fake-lost-dispatch");
        }
        return Response.json({ workflow_run_id: id });
      }
      if (p.endsWith("/cancel")) {
        actions.cancellations.push(Number(p.split("/").at(-2)));
        return new Response(null, { status: 202 });
      }
      if (p.includes("/actions/workflows/") && p.endsWith("/runs")) {
        const runs = [...actions.runs.values()];
        return Response.json({
          total_count: runs.length,
          workflow_runs: runs.slice(
            (Number(u.searchParams.get("page")) - 1) * 100,
            Number(u.searchParams.get("page")) * 100,
          ),
        });
      }
      const m = p.match(/\/actions\/runs\/(\d+)\/attempts\/1(\/jobs)?$/);
      if (m) {
        const id = Number(m[1]);
        return m[2]
          ? Response.json({
              total_count: actions.jobs.get(id)?.length ?? 0,
              jobs: actions.jobs.get(id) ?? [],
            })
          : actions.runs.has(id)
            ? Response.json(actions.runs.get(id))
            : Response.json({}, { status: 404 });
      }
    }
    return h.fetcher(url, opts);
  };
  const store = createStore(config, fetcher),
    github = createGitHub(config, fetcher),
    auth = createAuth(config, store, github, () => h.state.now);
  const access = {
      ...h.refreshAccess(),
      actionsPermission: "write",
      workflowsPermission: "write",
    },
    sessionRef = "c".repeat(64);
  const refreshAccess = async () => {
    Object.assign(access, await github.access(token, 1));
    return structuredClone(access);
  };
  await store.create(
    "session",
    sessionRef,
    {
      userId: 1,
      token,
      csrf: "f".repeat(43),
      absoluteExpiry: h.state.now + 3600000,
      scope: hash(JSON.stringify(access.projects)),
    },
    1800,
    null,
    "1",
  );
  const options = {
      fetcher,
      now: () => h.state.now,
      resolveInitiator: auth.resolveInitiator,
    },
    jobs = createJobs(config, options);
  const identity = (runId) => ({
    repositoryId: 102,
    repositoryOwnerId: 10,
    actorId: 1,
    repository: "acme/studio",
    workflowRef: `acme/studio/${path}@refs/heads/main`,
    workflowSha: h.source.head,
    sha: h.source.head,
    ref: "refs/heads/main",
    eventName: "workflow_dispatch",
    runId,
    runAttempt: 1,
    jobWorkflowRef: null,
    jobWorkflowSha: null,
    checkRunId: null,
    issuedAt: Math.floor(h.state.now / 1000),
    expiresAt: Math.floor(h.state.now / 1000) + 300,
    subject: "repo:acme/studio:ref:refs/heads/main",
  });
  return {
    ...h,
    config,
    access,
    refreshAccess,
    fetcher,
    service: createWebService(config, { fetcher, now: () => h.state.now }),
    auth,
    store,
    jobs,
    jobDb: db,
    actions,
    registration,
    register,
    sessionRef,
    workerIdentity: identity,
    routineId: path,
  };
}

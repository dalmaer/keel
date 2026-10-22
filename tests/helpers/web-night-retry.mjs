// Acme source + actual encrypted RPC transport; no provider writes.
import legacyNightSource from "./web-night-legacy.mjs";
import { jobsHarness, token } from "./web-jobs.mjs";
import { createNightRetry } from "../../lib/web/night-retry.mjs";
import { createDecisionGitHub } from "../../lib/web/decision-github.mjs";
import {
  inventoryDigest,
  dependencyDigest,
  NIGHT_REVIEW,
  NIGHT_EFFECTS,
} from "../../lib/web/night-retry-source.mjs";
export { token };
export function canonicalFiles() {
  return structuredClone(legacyNightSource.files);
}
export async function nightRetryHarness() {
  const h = await jobsHarness();
  Object.assign(h.source.files, canonicalFiles(), {
    ".keel/keel.json": JSON.stringify({
      name: "Acme Studio",
      repo: "acme/studio",
      check: "npm run check",
      setup: "npm ci --ignore-scripts",
    }),
    "package.json": JSON.stringify({
      name: "acme-studio",
      scripts: { check: "node --test" },
    }),
    "package-lock.json": JSON.stringify({
      name: "acme-studio",
      lockfileVersion: 3,
      packages: {},
    }),
  });
  h.config.nightOperations = {
    retryEnabled: true,
    planWrites: false,
    verifiedAt: "2026-10-20T00:00:00.000Z",
    restoreReconciledAt: "2026-10-20T00:00:00.000Z",
    profiles: ["studio"],
  };
  h.workspace.files["job-budgets/studio.json"] = JSON.stringify({
    version: 1,
    projectId: "studio",
    repoId: 102,
    weeklyMinutes: 120,
  });
  const profile = {
    version: 1,
    adapter: "night-rerun-v1",
    enabled: true,
    projectId: "studio",
    repoId: 102,
    repositoryNodeId: h.source.repositoryNodeId,
    ownerId: 10,
    workflow: {
      id: 601,
      path: ".github/workflows/keel-night.yml",
      branch: "main",
    },
    source: { commit: h.source.head, inventoryDigest: "" },
    commands: { setup: "npm ci --ignore-scripts", check: "npm run check" },
    effects: [...NIGHT_EFFECTS],
    weeklyMinutes: 120,
    review: {
      actorId: 1,
      reviewedAt: "2026-10-20T00:00:00.000Z",
      statement: NIGHT_REVIEW,
      dependencyClosureDigest: "",
    },
  };
  const snapshots = await createDecisionGitHub(token, {
    fetcher: h.fetcher,
  }).snapshot(h.project);
  profile.source.inventoryDigest = inventoryDigest(snapshots.entries);
  profile.review.dependencyClosureDigest = dependencyDigest(snapshots.entries);
  const register = () => {
    h.workspace.files["night-retries/studio.json"] = JSON.stringify(profile);
  };
  register();
  const at = new Date(h.state.now).toISOString();
  const run = {
    id: 7001,
    workflow_id: 601,
    run_attempt: 2,
    repository: { id: 102 },
    head_repository: { id: 102 },
    actor: { id: 7 },
    triggering_actor: { id: 1 },
    event: "schedule",
    head_sha: h.source.head,
    head_branch: "main",
    status: "completed",
    conclusion: "failure",
    created_at: at,
    updated_at: at,
  };
  const previews = new Map(),
    rows = new Map(),
    requests = [];
  const state = {
    run,
    latest: structuredClone(run),
    posts: [],
    lost: false,
    status: 201,
    before: null,
    dbLost: null,
    malformed: null,
  };
  async function database(p) {
    requests.push(p);
    const { p_operation: op, p_scope: scope, p_id: id, p_data: d } = p,
      key = scope + ":" + id,
      at = new Date(h.state.now).toISOString();
    let r = rows.get(key),
      changed = false,
      granted = false;
    const output = (value) => {
      if (state.dbLost === op) {
        state.dbLost = null;
        throw new Error("Acme lost RPC response");
      }
      return Response.json(
        state.malformed ? state.malformed(op, value) : value,
      );
    };
    if (op === "preview-create") {
      const preview = {
        scope,
        id,
        project: d.project,
        actor: d.actor,
        digest: d.digest,
        value: d.value,
        expires_at: new Date(h.state.now + 900000).toISOString(),
      };
      previews.set(key, preview);
      return output({ preview });
    }
    if (op === "preview-read") {
      const p = previews.get(key);
      return output(
        p &&
          p.project === d.project &&
          p.actor === d.actor &&
          Date.parse(p.expires_at) > h.state.now
          ? { preview: p }
          : null,
      );
    }
    if (r && (r.project !== d.project || r.actor !== d.actor))
      return output(null);
    if (
      r?.state === "prepared" &&
      Date.parse(previews.get(scope + ":" + r.preview).expires_at) <=
        h.state.now
    ) {
      r.state = "refused";
      r.charged = false;
      r.updated_at = at;
    }
    if (op === "reserve") {
      if (r) {
        if (r.digest !== d.digest || r.preview !== d.preview)
          return output({ conflict: "identity" });
        return output({ row: r, changed: false, granted: false });
      }
      const p = previews.get(scope + ":" + d.preview);
      if (
        !p ||
        p.actor !== d.actor ||
        p.project !== d.project ||
        p.digest !== d.digest ||
        Date.parse(p.expires_at) <= h.state.now
      )
        return output(null);
      const all = [...rows.values(), ...h.jobDb.rows.values()].filter(
        (r) => r.scope === scope,
      );
      if (
        all.some(
          (r) =>
            r.project === d.project &&
            !["terminal", "refused", "settled"].includes(r.state),
        )
      )
        return output({ conflict: "lane" });
      const charged = all.filter(
        (r) =>
          r.charged &&
          (!(r.settled_at ?? r.terminal_at) ||
            Date.parse(r.settled_at ?? r.terminal_at) >
              h.state.now - 604800000),
      );
      if (
        charged.reduce((s, r) => s + r.minutes, 0) + 60 > d.workspaceLimit ||
        charged
          .filter((r) => r.project === d.project)
          .reduce((s, r) => s + r.minutes, 0) +
          60 >
          d.projectLimit
      )
        return output({ conflict: "budget" });
      r = {
        scope,
        id,
        project: d.project,
        actor: d.actor,
        digest: d.digest,
        preview: d.preview,
        value: d.value,
        run_id: d.runId,
        attempt: d.attempt,
        state: "prepared",
        minutes: 60,
        charged: true,
        observation: null,
        accepted_at: null,
        settled_at: null,
        created_at: at,
        updated_at: at,
      };
      rows.set(key, r);
      changed = true;
    } else if (!r) return output(null);
    else if (op === "read") {
    } else if (op === "send" && r.state === "prepared") {
      r.state = "sending";
      changed = granted = true;
    } else if (op === "accepted" && r.state === "sending") {
      r.state = "request-accepted";
      r.accepted_at = at;
      changed = true;
    } else if (op === "uncertain" && r.state === "sending") {
      r.state = "uncertain";
      changed = true;
    } else if (op === "refuse" && r.state === "prepared") {
      r.state = "refused";
      r.charged = false;
      changed = true;
    } else if (
      op === "observe" &&
      !["prepared", "refused", "settled"].includes(r.state)
    ) {
      r.observation = d.observation;
      changed = true;
      if (
        r.state === "request-accepted" &&
        d.observation.state === "completed"
      ) {
        r.state = "settled";
        r.settled_at = at;
      }
    } else return output({ conflict: "state" });
    if (changed) r.updated_at = at;
    return output({ row: r, changed, granted });
  }
  const fetcher = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname === "/rest/v1/rpc/keel_night_retry_rpc")
      return database(JSON.parse(opts.body));
    if (u.pathname === "/rest/v1/rpc/keel_job_rpc") {
      const p = JSON.parse(opts.body);
      if (p.p_operation === "budget") {
        const response = await h.fetcher(url, opts),
          base = await response.json();
        for (const r of rows.values())
          if (
            r.scope === p.p_scope &&
            r.charged &&
            (!r.settled_at ||
              Date.parse(r.settled_at) > h.state.now - 604800000)
          ) {
            base.workspaceMinutes += 60;
            if (r.project === p.p_data.project) base.projectMinutes += 60;
          }
        return Response.json(base);
      }
    }
    if (u.pathname.startsWith("/repositories/102/actions/")) {
      if (state.before) await state.before(u, opts);
      if (u.pathname === "/repositories/102/actions/workflows/601")
        return Response.json({
          id: 601,
          path: profile.workflow.path,
          state: "active",
        });
      if (u.pathname.endsWith("/rerun-failed-jobs")) {
        state.posts.push(JSON.parse(opts.body));
        if (state.lost) throw new Error("Acme lost provider response");
        return new Response(null, { status: state.status });
      }
      if (u.pathname === "/repositories/102/actions/runs/7001")
        return Response.json(state.latest);
      if (u.pathname === "/repositories/102/actions/runs/7001/attempts/2")
        return Response.json(state.run);
    }
    return h.fetcher(url, opts);
  };
  return {
    ...h,
    fetcher,
    night: createNightRetry(h.config, { fetcher, now: () => h.state.now }),
    profile,
    register,
    nightState: state,
    nightDb: { rows, previews, requests },
    reauthorize: async () => structuredClone(h.access),
  };
}

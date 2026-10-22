import { jobsHarness, token, blob } from "./web-jobs.mjs";
import { hash } from "../../lib/web/common.mjs";
import { createFleetUpdates } from "../../lib/web/fleet-updates.mjs";
import { createJobs } from "../../lib/web/jobs.mjs";
import { createAuth } from "../../lib/web/auth.mjs";
import { createStore } from "../../lib/web/store.mjs";
import { createGitHub } from "../../lib/web/github.mjs";
import { canonicalUpdateWorkflow } from "../../lib/web/update-workflow.mjs";
import { gitTree } from "../../lib/web/fleet-provider.mjs";
export { token };
export function treeEntries(files) {
  const all = Object.entries(files).map(([path, content]) => ({
      path,
      type: "blob",
      mode: "100644",
      sha: blob(content),
      size: Buffer.byteLength(content),
    })),
    dirs = new Set([""]);
  for (const e of all) {
    const parts = e.path.split("/");
    for (let n = 1; n < parts.length; n++)
      dirs.add(parts.slice(0, n).join("/"));
  }
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    const prefix = dir ? dir + "/" : "",
      children = all
        .filter(
          (e) =>
            e.path.startsWith(prefix) &&
            !e.path.slice(prefix.length).includes("/"),
        )
        .map((e) => ({ ...e, path: e.path.slice(prefix.length) })),
      sha = gitTree(children).sha;
    if (dir) all.push({ path: dir, type: "tree", mode: "040000", sha });
    else return { sha, tree: all };
  }
}
export async function fleetUpdatesHarness() {
  const h = await jobsHarness();
  h.config.fleetUpdates = {
    enabled: true,
    publishEnabled: true,
    target: {
      repoId: 103,
      repositoryNodeId: "R_acme_103",
      repo: "acme/keel",
      commit: "e".repeat(40),
      cliVersion: "1.0.0",
      practiceVersion: "1.0.0",
      bundleDigest: null,
    },
  };
  const targetFiles = {
      "package.json": '{"version":"1.0.0"}',
      "practices/VERSION": "1.0.0\n",
      "scripts/web-update-worker.mjs": "// Acme fixed bridge\n",
      "lib/web/update-worker.mjs": "// Acme fixed worker\n",
      "migrations/0001-acme.mjs": "// Acme migration\n",
    },
    tree = treeEntries(targetFiles);
  h.config.fleetUpdates.target.bundleDigest = hash(tree.sha);
  h.source.files[".keel/keel.json"] = JSON.stringify({
    name: "Acme Studio",
    repo: "acme/studio",
    practice: "1.0.0",
    migrations: [],
    check: "npm run check",
  });
  h.source.files[".keel/lock.json"] = JSON.stringify({
    practice: "1.0.0",
    files: {
      "docs/acme.md": { practice: "base", sha256: hash("Acme before\n") },
    },
  });
  h.source.files["docs/acme.md"] = "Acme before\n";
  const workflowPath = ".github/workflows/update.yml";
  h.source.files[workflowPath] = canonicalUpdateWorkflow(
    h.config.fleetUpdates.target,
  );
  const registration = {
    version: 1,
    projectId: "studio",
    repoId: 102,
    ownerId: 10,
    enabled: true,
    adapter: "update-preparation-v1",
    protocol: 1,
    concurrency: 1,
    timeoutMinutes: 60,
    weeklyMinutes: 120,
    schedule: null,
    workflow: {
      id: 501,
      path: workflowPath,
      branch: "main",
      job: "web-worker",
      workflowBlob: blob(h.source.files[workflowPath]),
      bridgePath: "scripts/web-update-worker.mjs",
      bridgeBlob: blob(targetFiles["scripts/web-update-worker.mjs"]),
      runtimeBlob: blob(targetFiles["lib/web/update-worker.mjs"]),
    },
    container: {
      image: "node@sha256:" + "a".repeat(64),
      platform: "linux/amd64",
      network: "none",
    },
  };
  const register = () => {
    h.workspace.files["update-workers/studio.json"] =
      JSON.stringify(registration);
  };
  register();
  h.workspace.files["job-budgets/studio.json"] = JSON.stringify({
    version: 1,
    projectId: "studio",
    repoId: 102,
    weeklyMinutes: 120,
  });
  const db = {
      rows: new Map(),
      requests: [],
      lost: null,
      malformed: null,
      after: null,
    },
    remote = {
      objects: new Map(),
      refs: new Map(),
      prs: [],
      writes: [],
      lost: null,
      before: null,
      draftOverride: null,
      prMissing: false,
    };
  const fetcher = async (url, opts = {}) => {
    const u = new URL(url),
      path = u.pathname;
    if (path === "/user/installations") {
      const response = await h.fetcher(url, opts),
        v = await response.json();
      for (const i of v.installations) i.permissions.pull_requests = "write";
      return Response.json(v);
    }
    if (path === "/rest/v1/rpc/keel_fleet_rpc") {
      const p = JSON.parse(opts.body),
        {
          p_operation: op,
          p_scope: scope,
          p_id: id,
          p_actor: actor,
          p_data: d,
        } = p,
        key = scope + ":" + id,
        at = new Date(h.state.now).toISOString();
      db.requests.push(p);
      let row = db.rows.get(key),
        changed = false;
      const out = async (v) => {
        if (db.after) await db.after(op, v);
        if (db.lost === op) {
          db.lost = null;
          throw Error("Acme lost fleet response");
        }
        return Response.json(db.malformed ? db.malformed(op, v) : v);
      };
      if (row && row.actor !== actor) return out(null);
      if (op === "read") return out(row ? { row, changed: false } : null);
      if (op === "create" || op === "output") {
        const kind = op === "output" ? "artifact" : d.kind;
        if (row) {
          if (
            row.digest !== d.digest ||
            row.project !== d.project ||
            row.kind !== kind
          )
            return out({ conflict: "identity" });
          return out({ row, changed: false });
        }
        if (op === "output") {
          const j = h.jobDb.rows.get(scope + ":" + d.operationId);
          if (
            !j ||
            j.actor !== actor ||
            j.project !== d.project ||
            j.run_id !== d.runId ||
            j.job_id !== d.jobId ||
            j.nonce !== d.nonce ||
            j.fence !== d.fence ||
            j.state !== "running" ||
            j.cancel_requested ||
            Date.parse(j.lease_until) <= h.state.now
          )
            return out({ conflict: "state" });
        }
        row = {
          scope,
          id,
          actor,
          project: d.project,
          kind,
          state: "ready",
          version: 1,
          digest: d.digest,
          value: d.value,
          stage: 0,
          created_at: at,
          updated_at: at,
        };
        db.rows.set(key, row);
        changed = true;
      } else if (op === "cas") {
        if (!row) return out(null);
        if (
          row.version !== d.version ||
          ["committed", "stopped"].includes(row.state) ||
          ["artifact", "preview"].includes(row.kind)
        )
          return out({ conflict: "state" });
        Object.assign(row, {
          state: d.state,
          stage: d.stage,
          value: d.value,
          version: row.version + 1,
          updated_at: at,
        });
        changed = true;
      } else throw Error("Unexpected Acme fleet RPC");
      return out({ row, changed });
    }
    if (path === "/repositories/103")
      return Response.json({
        id: 103,
        node_id: "R_acme_103",
        full_name: "acme/keel",
        private: false,
      });
    if (
      path ===
      "/repositories/103/git/commits/" + h.config.fleetUpdates.target.commit
    )
      return Response.json({
        sha: h.config.fleetUpdates.target.commit,
        tree: { sha: tree.sha },
      });
    if (path.startsWith("/repositories/103/git/trees/"))
      return Response.json({
        sha: tree.sha,
        truncated: false,
        tree: tree.tree,
      });
    if (path.startsWith("/repositories/103/git/blobs/")) {
      const sha = path.split("/").at(-1),
        content = Object.values(targetFiles).find((v) => blob(v) === sha);
      return Response.json({
        sha,
        encoding: "base64",
        content: Buffer.from(content).toString("base64"),
      });
    }
    if (path.startsWith("/repos/acme/studio/git/trees/"))
      return Response.json({
        sha: "c".repeat(40),
        truncated: false,
        tree: treeEntries(h.source.files).tree,
      });
    if (
      path.startsWith("/repositories/102/git/") ||
      path === "/repositories/102/pulls"
    ) {
      if (remote.before) await remote.before(url, opts);
      const post = opts.method === "POST",
        input = post ? JSON.parse(opts.body) : null;
      const send = (v) => {
        if (post) {
          remote.writes.push({ path, input });
          if (remote.lost === path.split("/").at(-1)) {
            remote.lost = null;
            throw Error("Acme lost provider response");
          }
        }
        return Response.json(v);
      };
      const type = path.match(
        /\/git\/(blobs|trees|commits)(?:\/([a-f0-9]{40}))?$/,
      );
      if (type) {
        if (!post) {
          const value = remote.objects.get(type[2]);
          return value
            ? Response.json(value)
            : Response.json({}, { status: 404 });
        }
        let sha;
        if (type[1] === "blobs")
          sha = blob(Buffer.from(input.content, "base64"));
        else if (type[1] === "trees") sha = gitTree(input.tree).sha;
        else {
          const { createHash } = await import("node:crypto"),
            sec = Math.floor(Date.parse(input.author.date) / 1000),
            bytes = Buffer.from(
              `tree ${input.tree}\nparent ${input.parents[0]}\nauthor ${input.author.name} <${input.author.email}> ${sec} +0000\ncommitter ${input.committer.name} <${input.committer.email}> ${sec} +0000\n\n${input.message}`,
            );
          sha = createHash("sha1")
            .update(`commit ${bytes.length}\0`)
            .update(bytes)
            .digest("hex");
        }
        const v = { sha, ...input };
        remote.objects.set(sha, v);
        return send(v);
      }
      if (path.includes("/git/ref/heads/")) {
        const branch = decodeURIComponent(path.split("/git/ref/heads/")[1]),
          v = remote.refs.get(branch);
        return v ? Response.json(v) : Response.json({}, { status: 404 });
      }
      if (path.endsWith("/git/refs")) {
        const branch = input.ref.slice(11);
        if (remote.refs.has(branch)) return Response.json({}, { status: 422 });
        const v = {
          ref: input.ref,
          object: { type: "commit", sha: input.sha },
        };
        remote.refs.set(branch, v);
        return send(v);
      }
      if (path.endsWith("/pulls")) {
        if (!post) {
          if (remote.prMissing) return Response.json([]);
          const head = u.searchParams
            .get("head")
            ?.split(":")
            .slice(1)
            .join(":");
          return Response.json(
            remote.prs
              .filter((p) => p.head.ref === head)
              .map((p) =>
                remote.draftOverride === null
                  ? p
                  : { ...p, draft: remote.draftOverride },
              ),
          );
        }
        const r = {
          number: remote.prs.length + 1,
          state: "open",
          draft: input.draft,
          title: input.title,
          body: input.body,
          head: {
            repo: { id: 102 },
            ref: input.head,
            sha: remote.refs.get(input.head).object.sha,
          },
          base: { repo: { id: 102 }, ref: input.base },
        };
        remote.prs.push(r);
        return send(r);
      }
    }
    return h.fetcher(url, opts);
  };
  const auth = createAuth(
      h.config,
      createStore(h.config, fetcher),
      createGitHub(h.config, fetcher),
      () => h.state.now,
    ),
    refreshAccess = async () => {
      const access = await createGitHub(h.config, fetcher).access(token, 1);
      return { ...access, pullRequestsPermission: "write" };
    },
    options = {
      fetcher,
      now: () => h.state.now,
      resolveInitiator: auth.resolveInitiator,
    };
  const access = await refreshAccess(),
    fleet = createFleetUpdates(h.config, options),
    jobs = createJobs(h.config, options);
  const workerIdentity = (runId) => ({
    ...h.workerIdentity(runId),
    workflowRef: `acme/studio/${workflowPath}@refs/heads/main`,
  });
  const output = () => {
    const at = new Date(h.state.now).toISOString();
    return {
      schema: 1,
      base: {
        repoId: 102,
        repositoryNodeId: "R_acme_102",
        commit: h.source.head,
      },
      target: h.config.fleetUpdates.target,
      files: [
        {
          path: "docs/acme.md",
          before: { mode: "100644", blob: blob("Acme before\n") },
          after: {
            mode: "100644",
            content: Buffer.from("Acme after\n").toString("base64"),
          },
        },
      ],
      migrations: [
        {
          id: "0001-acme",
          summary: "Update Acme guidance",
          paths: ["docs/acme.md"],
          notes: [],
        },
      ],
      checks: {
        setup: null,
        baseSetup: null,
        updated: {
          command: "npm run check",
          exit: 0,
          signal: null,
          startedAt: at,
          completedAt: at,
          tail: "Acme check passed",
        },
        base: null,
      },
      coverage: { complete: true, gaps: [] },
      cleanup: { state: "verified", containerIds: ["a".repeat(64)] },
    };
  };
  return {
    ...h,
    config: h.config,
    access,
    refreshAccess,
    fetcher,
    auth,
    fleet,
    jobs,
    fleetDb: db,
    remote,
    targetFiles,
    updateRegistration: registration,
    registerUpdate: register,
    workerIdentity,
    output,
  };
}

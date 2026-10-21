// Synthetic GitHub + encrypted-store transport, composed with real hosted auth/routes.
import assert from "node:assert/strict";
import { decisionHarness, token } from "./web-decisions.mjs";
import { createWebService } from "../../lib/web/server.mjs";
import { createLearning } from "../../lib/web/learning.mjs";
import { createMigration } from "../../lib/web/migration.mjs";
import { createExport } from "../../lib/web/export.mjs";
export { token };
export const lessonTable =
  "# Acme lessons\n\n| # | Shape | Cost | Guard | Where |\n| --- | --- | --- | --- | --- |\n| 1 | A bounded read needs a bound. | A late response. | Check byte limits. | Acme unit fixture. |\n| 2 | Recovery needs original identity. | Duplicate effects. | Keep the original receipt. | Acme transport fixture. |\n| 3 | Keep observations distinct. | False completion. | Preserve unknown values. | Acme UI fixture. |\n";
export function learningHarness() {
  const h = decisionHarness(),
    other = decisionHarness();
  const config = { ...h.config, decisionWrites: false, workspaceWrites: true };
  h.source.files[".keel/keel.json"] = JSON.stringify({
    name: "Acme Studio",
    repo: "acme/studio",
    lessons: "docs/lessons.md",
  });
  h.source.files["docs/lessons.md"] = lessonTable;
  const workspace = other.source;
  Object.assign(workspace, {
    repoId: 101,
    repositoryNodeId: "R_acme_101",
    branchNodeId: "REF_acme_101_main",
    repoName: "acme/keel-private",
    head: "a".repeat(40),
    private: true,
    files: {
      "workspace.json": JSON.stringify({
        version: 1,
        id: "acme",
        name: "Acme workspace",
        repo: "acme/keel-private",
        projects: [{ id: "studio", repo: "acme/studio" }],
      }),
    },
  });
  Object.defineProperty(workspace, "private", {
    enumerable: true,
    get: () => h.state.private,
    set: (value) => {
      h.state.private = value;
    },
  });
  Object.defineProperty(workspace.files, "members.json", {
    enumerable: true,
    configurable: true,
    get: () =>
      JSON.stringify({
        version: 1,
        workspaceId: "acme",
        memberIds: h.state.members,
      }),
  });
  const fetcher = async (url, options) => {
    const stored = h.db.handle(url, options);
    if (stored) return stored;
    const u = new URL(url),
      path = u.pathname;
    if (path === "/graphql") {
      const body = JSON.parse(options.body),
        id = body.variables.id ?? body.variables.input?.branch.id;
      return [h.source.repositoryNodeId, h.source.branchNodeId].includes(id)
        ? h.fetcher(url, options)
        : other.fetcher(url, options);
    }
    if (path === "/repositories/101")
      return other.fetcher(new URL("/repositories/102", u).href, options);
    if (path.startsWith("/repos/acme/keel-private/")) {
      if (path === "/repos/acme/keel-private/commits/main")
        return Response.json({ sha: workspace.head });
      if (path.includes("/contents/")) {
        const file = decodeURIComponent(path.split("/contents/")[1]),
          value = workspace.files[file];
        if (u.searchParams.get("ref") !== workspace.head || value === undefined)
          return Response.json({}, { status: 404 });
        return Response.json({
          type: "file",
          encoding: "base64",
          size: Buffer.byteLength(value),
          content: Buffer.from(value).toString("base64"),
        });
      }
      u.pathname = path.replace(
        "/repos/acme/keel-private/",
        "/repos/acme/studio/",
      );
      return other.fetcher(u.href, options);
    }
    return h.fetcher(url, options);
  };
  const options = { fetcher, now: () => h.state.now },
    service = createWebService(config, options);
  async function login(oldCookie) {
    const page = await service(h.request("/signin")),
      first = h.cookieHeader(page);
    const started = await service(
      h.request("/api/auth/start", {
        cookie: first,
        body: { csrf: first.split("=")[1], returnTo: "/learning" },
      }),
    );
    assert.equal(started.status, 303, await started.clone().text());
    const target = new URL(started.headers.get("location"));
    h.state.challenges.add(target.searchParams.get("code_challenge"));
    const completed = await service(
      h.request(
        `/api/auth/callback?code=fake-code&state=${target.searchParams.get("state")}`,
        {
          cookie: [h.cookieHeader(started), oldCookie]
            .filter(Boolean)
            .join("; "),
        },
      ),
    );
    assert.equal(completed.status, 303, await completed.clone().text());
    const cookie = h.cookieHeader(completed),
      response = await service(h.request("/api/session", { cookie }));
    assert.equal(response.status, 200, await response.clone().text());
    return { cookie, session: await response.json(), completed };
  }
  const access = { ...h.access, projects: [...h.access.projects] };
  const refreshAccess = () => {
    access.sourceRevision = workspace.head;
    access.contentsPermission = h.state.contentsPermission;
    return structuredClone(access);
  };
  return {
    ...h,
    config,
    fetcher,
    service,
    workspace,
    access,
    refreshAccess,
    login,
    learning: createLearning(config, options),
    migration: createMigration(config, options),
    exports: createExport(config, options),
  };
}

import { createHash } from "node:crypto";
import { requestJson, WebError, hash } from "./common.mjs";
import { oid, nodeId, validateTarget } from "./fleet-model.mjs";
import {
  sourcePath,
  gitBlob,
  createDecisionGitHub,
} from "./decision-github.mjs";
const objectId = (type, bytes) =>
  createHash("sha1")
    .update(`${type} ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
const modeType = (mode) => (mode === "040000" ? "tree" : "blob");
export function gitTree(entries) {
  const sorted = [...entries].sort((a, b) =>
    Buffer.compare(
      Buffer.from(a.path + (a.mode === "040000" ? "/" : "")),
      Buffer.from(b.path + (b.mode === "040000" ? "/" : "")),
    ),
  );
  const bytes = Buffer.concat(
    sorted.map((e) =>
      Buffer.concat([
        Buffer.from(`${e.mode === "040000" ? "40000" : e.mode} ${e.path}\0`),
        Buffer.from(e.sha, "hex"),
      ]),
    ),
  );
  return { sha: objectId("tree", bytes), entries: sorted };
}
export function publicationObjects(entries, files, parent, message, at) {
  if (
    [...entries].some(
      ([p, e]) =>
        e.type === "tree" &&
        ![...entries.keys()].some((q) => q.startsWith(p + "/")),
    )
  )
    throw new WebError("unsupported_empty_tree", 409);
  const changed = new Map(files.map((f) => [f.path, f])),
    dirs = new Set([""]);
  for (const f of files) {
    const parts = f.path.split("/");
    for (let n = 1; n < parts.length; n++)
      dirs.add(parts.slice(0, n).join("/"));
  }
  const blobs = new Map(),
    results = new Map(),
    trees = [];
  for (const f of files)
    if (f.after) {
      const sha = gitBlob(Buffer.from(f.after.content, "base64"));
      blobs.set(sha, { kind: "blob", sha, path: f.path });
    }
  for (const dir of [...dirs].sort(
    (a, b) => b.split("/").length - a.split("/").length || b.length - a.length,
  )) {
    const prefix = dir ? dir + "/" : "",
      children = new Map();
    for (const [path, e] of entries) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
        if (!["100644", "100755", "120000", "040000"].includes(e.mode))
          throw new WebError("unsupported_update_tree", 409);
        children.set(path.slice(prefix.length), {
          path: path.slice(prefix.length),
          mode: e.mode,
          sha: e.sha,
        });
      }
    }
    // Synthetic or older inventories may omit directory entries; derive their original trees.
    for (const [path, e] of entries) {
      if (path.startsWith(prefix) && path.slice(prefix.length).includes("/")) {
        const name = path.slice(prefix.length).split("/")[0],
          child = prefix + name;
        if (!children.has(name) && !results.has(child))
          throw new WebError("incomplete_update_tree", 409);
      }
    }
    for (const [path, f] of changed)
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
        const name = path.slice(prefix.length);
        if (f.after)
          children.set(name, {
            path: name,
            mode: f.after.mode,
            sha: gitBlob(Buffer.from(f.after.content, "base64")),
          });
        else children.delete(name);
      }
    for (const [path, sha] of results)
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
        const name = path.slice(prefix.length);
        if (sha) children.set(name, { path: name, mode: "040000", sha });
        else children.delete(name);
      }
    if (dir && children.size === 0) {
      results.set(dir, null);
      continue;
    }
    const t = gitTree([...children.values()]);
    results.set(dir, t.sha);
    if (entries.get(dir)?.sha !== t.sha)
      trees.push({
        kind: "tree",
        sha: t.sha,
        body: {
          tree: t.entries.map((e) => ({ ...e, type: modeType(e.mode) })),
        },
      });
  }
  const tree = results.get(""),
    seconds = Math.floor(Date.parse(at) / 1000),
    name = "Plates web",
    email = "plates-web@users.noreply.github.com";
  const content = Buffer.from(
    `tree ${tree}\nparent ${parent}\nauthor ${name} <${email}> ${seconds} +0000\ncommitter ${name} <${email}> ${seconds} +0000\n\n${message}\n`,
  );
  const commit = {
    kind: "commit",
    sha: objectId("commit", content),
    body: {
      tree,
      parents: [parent],
      message: message + "\n",
      author: { name, email, date: new Date(seconds * 1000).toISOString() },
      committer: { name, email, date: new Date(seconds * 1000).toISOString() },
    },
  };
  return [...blobs.values(), ...trees, commit];
}
export function createFleetProvider(token, { fetcher = fetch } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  async function request(path, body, limit = 5 * 1024 * 1024, missing = false) {
    const response = await fetcher(`https://api.github.com${path}`, {
      headers: {
        ...headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      method: body ? "POST" : "GET",
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (response.status === 404 && missing) {
      await response.body?.cancel();
      return null;
    }
    if ([401, 403, 404].includes(response.status)) {
      await response.body?.cancel();
      throw new WebError("access_denied", 404);
    }
    return requestJson(
      async () => response,
      "https://api.github.com",
      { headers },
      limit,
    );
  }
  const base = (p) => `/repositories/${p.repoId}`;
  async function identity(p) {
    const r = await request(base(p), null, 65536);
    if (r.id !== p.repoId || r.full_name !== p.repo || !nodeId(r.node_id))
      throw new WebError("update_identity_changed", 409);
    return r;
  }
  async function target(input) {
    const t = validateTarget(input),
      r = await identity(t);
    if (r.node_id !== t.repositoryNodeId || r.private !== false)
      throw new WebError("update_target_unavailable", 409);
    const c = await request(`${base(t)}/git/commits/${t.commit}`, null, 65536);
    if (
      c.sha !== t.commit ||
      !oid(c.tree?.sha) ||
      hash(c.tree.sha) !== t.bundleDigest
    )
      throw new WebError("update_target_changed", 409);
    const tree = await request(
      `${base(t)}/git/trees/${c.tree.sha}?recursive=1`,
    );
    if (
      tree.sha !== c.tree.sha ||
      tree.truncated !== false ||
      !Array.isArray(tree.tree) ||
      tree.tree.length > 20000
    )
      throw new WebError("update_target_incomplete");
    if (
      tree.tree.some(
        (e) =>
          !sourcePath(e.path) ||
          !oid(e.sha) ||
          !["tree", "blob"].includes(e.type) ||
          !(e.type === "tree"
            ? e.mode === "040000"
            : ["100644", "100755", "120000"].includes(e.mode)),
      )
    )
      throw new WebError("update_target_incomplete");
    const entries = new Map(tree.tree.map((e) => [e.path, e]));
    if (entries.size !== tree.tree.length)
      throw new WebError("update_target_incomplete");
    async function read(path) {
      const e = entries.get(path);
      if (
        e?.type !== "blob" ||
        !["100644", "100755"].includes(e.mode) ||
        e.size > 262144
      )
        throw new WebError("update_target_unavailable");
      const b = await request(`${base(t)}/git/blobs/${e.sha}`, null, 400000);
      const bytes = Buffer.from(b.content ?? "", "base64");
      if (
        b.sha !== e.sha ||
        b.encoding !== "base64" ||
        gitBlob(bytes) !== e.sha ||
        bytes.length !== e.size
      )
        throw new WebError("update_target_unavailable");
      return bytes;
    }
    const pkg = JSON.parse((await read("package.json")).toString()),
      practice = (await read("practices/VERSION")).toString().trim();
    if (pkg.version !== t.cliVersion || practice !== t.practiceVersion)
      throw new WebError("update_target_changed", 409);
    return { target: t, entries, read };
  }
  async function readObject(p, e) {
    const value = await request(
      `${base(p)}/git/${e.kind}s/${e.sha}`,
      null,
      5 * 1024 * 1024,
      true,
    );
    if (!value) return false;
    if (value.sha !== e.sha) throw new WebError("update_object_conflict", 409);
    return true;
  }
  async function writeObject(p, e) {
    const v = await request(`${base(p)}/git/${e.kind}s`, e.body);
    if (v.sha !== e.sha) throw new WebError("update_object_conflict", 409);
    return true;
  }
  async function readRef(p, branch, commit) {
    const r = await request(
      `${base(p)}/git/ref/heads/${encodeURIComponent(branch)}`,
      null,
      65536,
      true,
    );
    if (!r) return false;
    if (
      r.ref !== `refs/heads/${branch}` ||
      r.object?.sha !== commit ||
      r.object?.type !== "commit"
    )
      throw new WebError("update_branch_conflict", 409);
    return true;
  }
  async function writeRef(p, branch, commit) {
    const r = await request(
      `${base(p)}/git/refs`,
      { ref: `refs/heads/${branch}`, sha: commit },
      65536,
    );
    if (r.ref !== `refs/heads/${branch}` || r.object?.sha !== commit)
      throw new WebError("update_branch_conflict", 409);
  }
  function prProof(r, p, intent) {
    return (
      r?.base?.repo?.id === p.repoId &&
      r.head?.repo?.id === p.repoId &&
      r.head.ref === intent.branch &&
      r.head.sha === intent.commit &&
      r.base.ref === intent.baseBranch &&
      r.title === intent.title &&
      r.body === intent.body &&
      r.draft === intent.draft &&
      ["open", "closed"].includes(r.state) &&
      Number.isSafeInteger(r.number) &&
      r.number > 0
    );
  }
  async function readPr(p, intent) {
    const matches = [];
    for (let page = 1; page <= 3; page++) {
      const rows = await request(
        `${base(p)}/pulls?state=all&head=${encodeURIComponent(p.repo.split("/")[0] + ":" + intent.branch)}&base=${encodeURIComponent(intent.baseBranch)}&per_page=100&page=${page}`,
        null,
        2 * 1024 * 1024,
      );
      if (!Array.isArray(rows) || rows.length > 100)
        throw new WebError("update_pr_coverage");
      for (const r of rows)
        if (r.head?.ref === intent.branch) {
          if (!prProof(r, p, intent))
            throw new WebError("update_pr_conflict", 409);
          matches.push(r);
        }
      if (rows.length < 100) {
        if (matches.length > 1) throw new WebError("update_pr_conflict", 409);
        return matches[0]
          ? {
              number: matches[0].number,
              url: `https://github.com/${p.repo}/pull/${matches[0].number}`,
              state: matches[0].state,
            }
          : null;
      }
    }
    throw new WebError("update_pr_coverage");
  }
  async function writePr(p, intent) {
    const r = await request(
      `${base(p)}/pulls`,
      {
        title: intent.title,
        body: intent.body,
        head: intent.branch,
        base: intent.baseBranch,
        draft: intent.draft,
      },
      2 * 1024 * 1024,
    );
    if (!prProof(r, p, intent)) throw new WebError("update_pr_uncertain");
    return {
      number: r.number,
      url: `https://github.com/${p.repo}/pull/${r.number}`,
      state: r.state,
    };
  }
  async function conflicts(p, version) {
    const rows = await request(
      `${base(p)}/pulls?state=open&head=${encodeURIComponent(p.repo.split("/")[0] + ":keel/update-v" + version)}&per_page=100`,
      null,
      2 * 1024 * 1024,
    );
    if (!Array.isArray(rows) || rows.length >= 100)
      throw new WebError("update_pr_coverage");
    if (rows.length) throw new WebError("existing_cli_update", 409);
    const ref = await request(
      `${base(p)}/git/ref/heads/${encodeURIComponent("keel/update-v" + version)}`,
      null,
      65536,
      true,
    );
    if (ref) throw new WebError("existing_cli_update", 409);
  }
  return {
    identity,
    target,
    snapshot: (p) => createDecisionGitHub(token, { fetcher }).snapshot(p),
    readObject,
    writeObject,
    readRef,
    writeRef,
    readPr,
    writePr,
    conflicts,
  };
}

import { createDecisionGitHub, sourcePath } from "./decision-github.mjs";
import {
  boundedJson,
  exact,
  hash,
  numeric,
  record,
  requestJson,
  WebError,
} from "./common.mjs";
import {
  decodeJson,
  lessonId,
  selectionList,
  textFields,
  validText,
  validateLesson,
} from "./learning-model.mjs";
import {
  parseLessons,
  lessonsPathOf,
  lessonFingerprint,
  lessonsTableShapes,
  lessonsTableSplit,
} from "../../practices/night/files/scripts/plates/lib.mjs";
import { validateManifest } from "./workspace.mjs";

// Private catalogue reads must fail as a whole on lost authorization, even after
// earlier blobs were successfully read. Do not turn a revoked source into gaps.
export function learningTransport(fetcher) {
  return async (url, options) => {
    const response = await fetcher(url, options);
    if ([401, 403, 404].includes(response.status)) {
      await response.body?.cancel();
      throw new WebError("access_denied", 404);
    }
    if (new URL(url).pathname === "/graphql" && response.ok) {
      const payload = await boundedJson(response.clone(), 2 * 1024 * 1024);
      if (
        payload.errors?.some((error) =>
          ["FORBIDDEN", "NOT_FOUND"].includes(error.type),
        )
      ) {
        await response.body?.cancel();
        throw new WebError("access_denied", 404);
      }
    }
    return response;
  };
}
export function createLearning(config, { fetcher = fetch } = {}) {
  fetcher = learningTransport(fetcher);
  function actor(access) {
    if (
      !config.ownerIds.includes(access?.userId) ||
      access.workspace?.id !== config.workspace.id
    )
      throw new WebError("access_denied", 404);
  }
  function authorizedProject(access, project) {
    actor(access);
    if (
      !project ||
      config.projectRepoIds[project.id] !== project.repoId ||
      !access.projects.some(
        (p) =>
          p.id === project.id &&
          p.repoId === project.repoId &&
          p.repo === project.repo,
      )
    )
      throw new WebError("access_denied", 404);
  }
  async function workspace(access, token) {
    actor(access);
    const repo = await requestJson(
      async (url, options) => {
        const response = await fetcher(url, options);
        if ([401, 404].includes(response.status)) {
          await response.body?.cancel();
          throw new WebError("access_denied", 404);
        }
        return response;
      },
      `https://api.github.com/repositories/${config.workspace.repoId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
      65536,
    );
    if (
      repo.id !== config.workspace.repoId ||
      repo.private !== true ||
      typeof repo.full_name !== "string" ||
      !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo.full_name)
    )
      throw new WebError("access_denied", 404);
    const repository = { repoId: repo.id, repo: repo.full_name },
      provider = createDecisionGitHub(token, { fetcher });
    const snapshot = await provider.snapshot(repository);
    if (snapshot.source.visibility !== "private")
      throw new WebError("access_denied", 404);
    if (snapshot.source.head !== access.sourceRevision)
      throw new WebError("workspace_changed", 409);
    let manifest, members;
    try {
      manifest = validateManifest(
        decodeJson(
          await snapshot.reader.readFile(config.workspace.manifestPath),
        ),
      );
      members = decodeJson(
        await snapshot.reader.readFile(config.workspace.membersPath),
      );
    } catch {
      throw new WebError("access_denied", 404);
    }
    if (
      manifest.id !== config.workspace.id ||
      manifest.repo !== repository.repo ||
      !exact(members, ["version", "workspaceId", "memberIds"]) ||
      members.version !== 1 ||
      members.workspaceId !== manifest.id ||
      !Array.isArray(members.memberIds) ||
      members.memberIds.length > 100 ||
      !members.memberIds.every(numeric) ||
      new Set(members.memberIds).size !== members.memberIds.length ||
      !members.memberIds.includes(access.userId)
    )
      throw new WebError("access_denied", 404);
    return {
      repository,
      provider,
      snapshot,
      workspace: { id: manifest.id, name: manifest.name, ...repository },
    };
  }
  async function project(access, token, project) {
    authorizedProject(access, project);
    const result = {
      schema: 1,
      kind: "project",
      project,
      source: null,
      path: null,
      state: "unavailable",
      records: [],
      gaps: [],
    };
    let configPath = ".plates/plates.json";
    try {
      const snapshot = await createDecisionGitHub(token, { fetcher }).snapshot(
        project,
      );
      result.source = snapshot.source;
      configPath = snapshot.entries.has(configPath) ? configPath : ".keel/keel.json";
      const cfg = decodeJson(await snapshot.reader.readFile(configPath));
      if (
        !record(cfg) ||
        (Object.hasOwn(cfg, "lessons") &&
          (typeof cfg.lessons !== "string" || !cfg.lessons))
      )
        throw new WebError("invalid_lesson_path");
      const path = lessonsPathOf(cfg);
      if (!sourcePath(path)) throw new WebError("invalid_lesson_path");
      result.path = path;
      let bytes;
      try {
        bytes = await snapshot.reader.readFile(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        result.state = "absent";
        result.gaps.push({
          source: path,
          reason: "Lesson catalogue is absent.",
        });
        return result;
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        parsed = parseLessons(text);
      if (!parsed.rows.length) {
        result.state = "partial";
        result.gaps.push({
          source: path,
          reason: "No recognized lesson rows; coverage is not established.",
        });
        return result;
      }
      if (lessonsTableShapes(text).length || lessonsTableSplit(text).length)
        result.gaps.push({
          source: path,
          reason:
            "Lesson table structure has gaps; only recognized rows are shown.",
        });
      const lines = text.split("\n");
      let start = parsed.rows[0].line - 1;
      while (
        start > 0 &&
        lines[start - 1].trim().startsWith("|") &&
        !/^\|?\s*:?-{3}/.test(lines[start - 1].trim())
      )
        start--;
      let end = start;
      while (end < lines.length && lines[end].trim().startsWith("|")) end++;
      if (end - start !== parsed.rows.length)
        result.gaps.push({
          source: path,
          reason: "Unsupported table rows were omitted.",
        });
      const ids = new Set();
      for (const row of parsed.rows.slice(0, 50)) {
        const fields = Object.fromEntries(
          textFields.map((key) => [key, row[key] ?? ""]),
        );
        if (
          !numeric(row.n) ||
          !fields.shape.trim() ||
          !textFields.every((key) => validText(fields[key]))
        ) {
          result.gaps.push({
            source: path,
            reason: "An invalid lesson row was omitted.",
          });
          continue;
        }
        const source = {
          repoId: project.repoId,
          repo: project.repo,
          path,
          revision: snapshot.source.head,
          blob: snapshot.entries.get(path).sha,
          row: row.n,
          fingerprint: lessonFingerprint(project.repo, row),
        };
        const id = lessonId(source),
          sourceDigest = hash(JSON.stringify({ id, ...fields, source }));
        if (ids.has(id))
          result.gaps.push({
            source: path,
            reason:
              "Duplicate lesson identity; select only unambiguous records.",
          });
        ids.add(id);
        result.records.push({
          id,
          ...fields,
          source,
          sourceDigest,
          selection: {
            kind: "project",
            projectId: project.id,
            id,
            sourceDigest,
          },
        });
      }
      if (parsed.rows.length > 50)
        result.gaps.push({
          source: path,
          reason: "Only the first fifty lesson rows were read.",
        });
      result.state = result.gaps.length ? "partial" : "complete";
    } catch (error) {
      if ([401, 404].includes(error.status)) throw error;
      result.state = "unavailable";
      result.records = [];
      result.gaps.push({
        source: result.path ?? configPath,
        reason: "Lesson source is unavailable or unsupported.",
      });
    }
    return result;
  }
  async function catalogue(resolved) {
    const { snapshot, workspace } = resolved;
    const result = {
      schema: 1,
      kind: "workspace",
      workspace,
      source: snapshot.source,
      state: "complete",
      records: [],
      gaps: [],
    };
    let names;
    try {
      names = await snapshot.reader.readdir("lessons");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      result.state = "absent";
      result.gaps.push({
        source: "lessons",
        reason: "Shared lesson catalogue is absent.",
      });
      return result;
    }
    let bytes = 0;
    if (names.length > 50)
      result.gaps.push({
        source: "lessons",
        reason: "Only the first fifty shared records were read.",
      });
    for (const name of names.slice(0, 50)) {
      const path = `lessons/${name}`;
      try {
        if (!/^lesson-[a-f0-9]{40}\.json$/.test(name)) throw new Error();
        const stat = await snapshot.reader.stat(path);
        if (
          stat.type !== "file" ||
          !Number.isSafeInteger(stat.size) ||
          stat.size > 65536 ||
          stat.size < 0 ||
          bytes + stat.size > 1048576
        )
          throw new Error();
        bytes += stat.size;
        const raw = await snapshot.reader.readFile(path),
          value = validateLesson(decodeJson(raw));
        if (name !== `${value.id}.json`) throw new Error();
        const sourceDigest = hash(
          JSON.stringify([
            snapshot.source.head,
            path,
            snapshot.entries.get(path).sha,
            value,
          ]),
        );
        result.records.push({
          ...value,
          sourceDigest,
          selection: { kind: "shared", id: value.id, sourceDigest },
        });
      } catch (error) {
        if ([401, 404].includes(error.status)) throw error;
        result.gaps.push({
          source: path,
          reason:
            "Shared record is invalid, unavailable or exceeds the catalogue bound.",
        });
      }
    }
    result.state = result.gaps.length ? "partial" : "complete";
    return result;
  }
  async function shared(access, token) {
    // Privacy/identity/membership refusals are never softened into partial data.
    const resolved = await workspace(access, token);
    return catalogue(resolved);
  }
  async function select(access, token, selection, projectOnly = false) {
    selectionList(selection, projectOnly);
    actor(access);
    const models = new Map(),
      selected = [];
    for (const item of selection) {
      const key =
        item.kind === "shared" ? "shared" : `project:${item.projectId}`;
      if (!models.has(key)) {
        const p = access.projects.find((p) => p.id === item.projectId);
        if (item.kind === "project" && !p)
          throw new WebError("access_denied", 404);
        models.set(
          key,
          item.kind === "shared"
            ? await shared(access, token)
            : await project(access, token, p),
        );
      }
      const model = models.get(key),
        matches = model.records.filter((record) => record.id === item.id);
      if (matches.length !== 1 || matches[0].sourceDigest !== item.sourceDigest)
        throw new WebError("stale_selection", 409);
      selected.push(matches[0]);
    }
    return selected;
  }
  return { project, shared, select, workspace, catalogue, authorizedProject };
}

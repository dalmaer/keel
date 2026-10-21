import { createLearning, learningTransport } from "./learning.mjs";
import { createDecisionGitHub } from "./decision-github.mjs";
import { createOperationStore } from "./operation-store.mjs";
import {
  decodeJson,
  hex,
  sameLesson,
  selectionList,
  textFields,
  validateLesson,
} from "./learning-model.mjs";
import { exact, hash, random, WebError } from "./common.mjs";

export function createMigration(
  config,
  { fetcher = fetch, now = Date.now } = {},
) {
  const learning = createLearning(config, { fetcher }),
    store = createOperationStore(config, fetcher);
  // A migration can never be read or dispatched through the project decision domain.
  const scopeFor = (actor) =>
    hash(
      JSON.stringify([
        "migration-v1",
        config.appId,
        config.installationId,
        config.workspace.repoId,
        config.workspace.id,
        actor,
      ]),
    );
  const projectKey = hash(
    JSON.stringify([
      "migration-v1",
      config.appId,
      config.installationId,
      config.workspace.repoId,
    ]),
  );
  const view = (row) => ({
    schema: 1,
    kind: "migration",
    id: row.id,
    previewId: row.value.previewId,
    state: row.state,
    reason: row.value.reason ?? null,
    receipt: row.value.receipt ?? null,
  });
  async function contents(access, token, selection, imported) {
    const records = await learning.select(access, token, selection, true),
      resolved = await learning.workspace(access, token);
    const catalogue = await learning.catalogue(resolved);
    if (!["complete", "absent"].includes(catalogue.state))
      throw new WebError("destination_incomplete", 409);
    const files = [],
      unchanged = [];
    for (const record of records) {
      const value = validateLesson({
        version: 1,
        id: record.id,
        ...Object.fromEntries(textFields.map((k) => [k, record[k]])),
        source: record.source,
        imported,
      });
      const path = `lessons/${value.id}.json`;
      if (resolved.snapshot.entries.has(path)) {
        const raw = await resolved.snapshot.reader.readFile(path),
          existing = validateLesson(decodeJson(raw));
        if (!sameLesson(existing, value))
          throw new WebError("destination_conflict", 409);
        unchanged.push({
          id: record.id,
          path,
          content: new TextDecoder("utf-8", { fatal: true }).decode(raw),
        });
      } else {
        const content = `${JSON.stringify(value, null, 2)}\n`;
        if (Buffer.byteLength(content) > 65536)
          throw new WebError("output_limit", 413);
        files.push({ path, before: null, content, originalBlob: null });
      }
    }
    const retainedBytes = catalogue.records.reduce(
      (sum, record) =>
        sum + resolved.snapshot.entries.get(`lessons/${record.id}.json`).size,
      0,
    );
    if (
      retainedBytes +
        files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) >
      1048576
    )
      throw new WebError("destination_limit", 409);
    if (catalogue.records.length + files.length > 50)
      throw new WebError("destination_limit", 409);
    return { resolved, files, unchanged };
  }
  async function preview(access, token, input) {
    if (!exact(input, ["selection"]))
      throw new WebError("invalid_migration", 400);
    const selection = selectionList(input.selection, true),
      imported = { actorId: access.userId, at: new Date(now()).toISOString() };
    const { resolved, files, unchanged } = await contents(
      access,
      token,
      selection,
      imported,
    );
    const id = hash(random()),
      operationId = hash(random());
    const allowed =
      config.workspaceWrites === true &&
      access.contentsPermission === "write" &&
      resolved.snapshot.canWrite;
    const value = {
      schema: 1,
      kind: "migration",
      id,
      operationId,
      operationUrl: `/learning/operations/${operationId}`,
      expiresAt: new Date(now() + 900000).toISOString(),
      state: files.length ? "preview" : "noop",
      canSubmit: files.length > 0 && allowed,
      refusal: !files.length
        ? "The selected records already exist unchanged."
        : !allowed
          ? "Private workspace writes are disabled or permission is unavailable."
          : null,
      workspace: resolved.workspace,
      source: resolved.snapshot.source,
      selection,
      files,
      unchanged,
      commitMessage: `Copy Keel private lessons\n\nKeel-Operation: ${operationId}`,
    };
    value.digest = hash(JSON.stringify(value));
    if (
      !(await store.createPreview(id, scopeFor(access.userId), {
        ...value,
        actorId: access.userId,
        sourceRevision: access.sourceRevision,
        imported,
      }))
    )
      throw new WebError("preview_unavailable");
    return value;
  }
  const receipt = (found, intent, actor) => ({
    ...found,
    paths: intent.files.map((file) => file.path),
    actorId: actor,
    recordedAt: new Date(now()).toISOString(),
    acceptance: "not-established",
  });
  async function apply(access, token, previewId, { digest, reauthorize } = {}) {
    if (config.workspaceWrites !== true)
      throw new WebError("submission_disabled", 403);
    if (!hex(previewId) || !hex(digest))
      throw new WebError("invalid_preview", 400);
    // Verify current destination authorization even when an operation already exists.
    await learning.workspace(access, token);
    const scope = scopeFor(access.userId),
      saved = await store.preview(previewId, scope);
    if (!saved || Date.parse(saved.value.expiresAt) <= now())
      throw new WebError("preview_expired", 410);
    const p = saved.value;
    if (
      p.kind !== "migration" ||
      p.actorId !== access.userId ||
      p.workspace.repoId !== config.workspace.repoId ||
      p.digest !== digest
    )
      throw new WebError("stale_preview", 409);
    if (p.state === "noop") throw new WebError("nothing_to_copy", 409);
    const files = p.files.map(({ path, content, originalBlob }) => ({
      path,
      content,
      originalBlob,
    }));
    // Revalidate the writer domain from the encrypted record, not a generic path list.
    for (const file of files) {
      const lesson = validateLesson(decodeJson(Buffer.from(file.content)));
      if (
        file.path !== `lessons/${lesson.id}.json` ||
        file.originalBlob !== null ||
        Buffer.byteLength(file.content) > 65536
      )
        throw new WebError("invalid_migration", 400);
    }
    if (!files.length || files.length > 3)
      throw new WebError("invalid_migration", 400);
    const id = p.operationId,
      fence = hash(random());
    const intent = {
      id,
      repo: p.workspace.repo,
      ...p.source,
      files,
      commitMessage: p.commitMessage,
      marker: `Keel-Operation: ${id}`,
    };
    let value = {
      kind: "migration",
      previewId,
      actorId: access.userId,
      projects: p.selection.map((item) =>
        access.projects.find((project) => project.id === item.projectId),
      ),
      fence,
      intent,
      reason: null,
      receipt: null,
    };
    let row = await store.reserve(
      id,
      scope,
      projectKey,
      previewId,
      fence,
      value,
    );
    if (row?.conflict) throw new WebError("workspace_busy", 409);
    if (!row) throw new WebError("preview_expired", 410);
    if (!row.created) return view(row);
    let provider;
    try {
      if (typeof reauthorize !== "function")
        throw new WebError("authorization_recheck_required", 403);
      const fresh = await reauthorize();
      if (
        fresh.userId !== access.userId ||
        fresh.contentsPermission !== "write" ||
        fresh.sourceRevision !== p.sourceRevision ||
        fresh.workspace?.id !== config.workspace.id
      )
        throw new WebError("access_changed", 409);
      for (const selection of p.selection) {
        const selectedProject = access.projects.find(
          (project) => project.id === selection.projectId,
        );
        learning.authorizedProject(fresh, selectedProject);
      }
      // Authorize first, then observe every selected source again. A source edit
      // while refreshing authorization must invalidate the reviewed copy.
      const checked = await contents(fresh, token, p.selection, p.imported);
      if (
        JSON.stringify(checked.files) !== JSON.stringify(p.files) ||
        JSON.stringify(checked.unchanged) !== JSON.stringify(p.unchanged) ||
        JSON.stringify(checked.resolved.snapshot.source) !==
          JSON.stringify(p.source) ||
        !checked.resolved.snapshot.canWrite
      )
        throw new WebError("stale_preview", 409);
      if (Date.parse(p.expiresAt) <= now())
        throw new WebError("preview_expired", 410);
      provider = checked.resolved.provider;
      await provider.recheck(checked.resolved.repository, p.source);
    } catch (error) {
      value = {
        ...value,
        reason:
          error instanceof WebError ? error.code : "validation_unavailable",
      };
      row = await store.transition("refused", id, scope, fence, value);
      if (!row) throw new WebError("operation_conflict", 409);
      if ([401, 404].includes(error.status)) throw error;
      return view(row);
    }
    row = await store.transition("dispatched", id, scope, fence);
    if (!row) throw new WebError("operation_conflict", 409);
    try {
      const commit = await provider.dispatch(intent),
        found = await provider.recover(intent, commit);
      if (!found) throw new WebError("remote_uncertain");
      value = { ...value, receipt: receipt(found, intent, access.userId) };
      return view(
        (await store.transition("committed", id, scope, fence, value)) ?? row,
      );
    } catch (error) {
      const state = error.code === "remote_refused" ? "refused" : "uncertain";
      value = {
        ...value,
        reason:
          state === "refused"
            ? "The conditional private copy was refused."
            : "The private copy outcome is uncertain. Recover this same operation; do not resubmit.",
      };
      try {
        row = (await store.transition(state, id, scope, fence, value)) ?? row;
      } catch {
        /* Durable dispatched reservation remains. */
      }
      return view(row);
    }
  }
  async function recover(access, token, id) {
    if (!hex(id)) throw new WebError("invalid_operation", 400);
    await learning.workspace(access, token);
    const scope = scopeFor(access.userId);
    let row = await store.read(id, scope);
    if (!row || row.value.kind !== "migration")
      throw new WebError("operation_not_found", 404);
    for (const project of row.value.projects)
      learning.authorizedProject(access, project);
    if (row.state === "prepared" && Date.parse(row.leaseUntil) <= now())
      row =
        (await store.transition("refused", id, scope, row.value.fence, {
          ...row.value,
          reason: "Preparation expired before dispatch.",
        })) ?? row;
    if (["dispatched", "uncertain"].includes(row.state)) {
      try {
        const found = await createDecisionGitHub(token, {
          fetcher: learningTransport(fetcher),
        }).recover(row.value.intent);
        if (found)
          row =
            (await store.transition("committed", id, scope, row.value.fence, {
              ...row.value,
              reason: null,
              receipt: receipt(found, row.value.intent, row.value.actorId),
            })) ?? row;
      } catch (error) {
        if ([401, 404].includes(error.status)) throw error;
      }
    }
    return view(row);
  }
  return { preview, apply, recover };
}

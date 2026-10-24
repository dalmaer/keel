import { operationMarker } from './name-transition.mjs';
import { createLearning, learningTransport } from "./learning.mjs";
import { createDecisionGitHub } from "./decision-github.mjs";
import { createOperationStore } from "./operation-store.mjs";
import {
  exact,
  hash,
  numeric,
  projectId,
  random,
  WebError,
} from "./common.mjs";

export const hex = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const scopeId = (value) =>
  value === null ||
  (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value));
export function validatePolicy(value, stored = true) {
  const fields = ["id", "provider", "label", "projects", "enabled", "scope"];
  if (stored) fields.push("version", "secretRef");
  if (
    !exact(value, fields) ||
    !projectId(value.id) ||
    !["openai", "anthropic"].includes(value.provider) ||
    typeof value.label !== "string" ||
    !value.label.trim() ||
    value.label.length > 120 ||
    /[\x00-\x1f\x7f]/.test(value.label) ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.projects) ||
    !value.projects.length ||
    value.projects.length > 100 ||
    !value.projects.every(
      (p) => exact(p, ["id", "repoId"]) && projectId(p.id) && numeric(p.repoId),
    ) ||
    new Set(value.projects.map((p) => p.id)).size !== value.projects.length ||
    new Set(value.projects.map((p) => p.repoId)).size !==
      value.projects.length ||
    !exact(value.scope, ["organization", "project", "workspace"]) ||
    !Object.values(value.scope).every(scopeId) ||
    (value.provider === "openai" && value.scope.workspace !== null) ||
    (value.provider === "anthropic" &&
      (value.scope.organization !== null ||
        value.scope.project !== null ||
        (value.scope.workspace !== null &&
          !value.scope.workspace.startsWith("wrkspc_")))) ||
    (stored && (value.version !== 1 || !hex(value.secretRef)))
  )
    throw new WebError("invalid_connection_policy", 400);
  return structuredClone(value);
}
export function createConnectionPolicy(
  config,
  { fetcher = fetch, now = Date.now } = {},
) {
  const learning = createLearning(config, { fetcher }),
    store = createOperationStore(config, fetcher);
  const domain = [
    "connection-policy-v1",
    config.appId,
    config.installationId,
    config.workspace.repoId,
    config.workspace.id,
  ];
  const scopeFor = (actor) => hash(JSON.stringify([...domain, actor]));
  const projectKey = hash(JSON.stringify(domain));
  function authorize(access, policy) {
    for (const pin of policy.projects) {
      const p = access.projects.find(
        (p) => p.id === pin.id && p.repoId === pin.repoId,
      );
      learning.authorizedProject(access, p);
    }
  }
  async function read(access, token) {
    const resolved = await learning.workspace(access, token),
      records = [],
      gaps = [];
    let names;
    try {
      names = await resolved.snapshot.reader.readdir("connections");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      names = [];
    }
    if (names.length > 50)
      gaps.push({
        code: "connection_limit",
        reason: "Only the first fifty connection descriptors were read.",
      });
    let bytes = 0;
    const refs = new Set(),
      ids = new Set();
    for (const name of names.slice(0, 50)) {
      try {
        if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new Error();
        const path = `connections/${name}`,
          stat = await resolved.snapshot.reader.stat(path);
        if (
          stat.type !== "file" ||
          !Number.isSafeInteger(stat.size) ||
          stat.size < 1 ||
          stat.size > 16384 ||
          bytes + stat.size > 262144
        )
          throw new Error();
        bytes += stat.size;
        const raw = await resolved.snapshot.reader.readFile(path),
          content = new TextDecoder("utf-8", { fatal: true }).decode(raw);
        const descriptor = validatePolicy(JSON.parse(content));
        if (
          name !== `${descriptor.id}.json` ||
          ids.has(descriptor.id) ||
          refs.has(descriptor.secretRef)
        )
          throw new Error();
        ids.add(descriptor.id);
        refs.add(descriptor.secretRef);
        records.push({
          descriptor,
          path,
          content,
          policyDigest: hash(content),
          originalBlob: resolved.snapshot.entries.get(path).sha,
        });
      } catch (error) {
        if ([401, 404].includes(error.status)) throw error;
        gaps.push({
          code: "invalid_connection_source",
          reason:
            "A connection descriptor is invalid, unsupported or unavailable.",
        });
      }
    }
    return { ...resolved, records, gaps, bytes };
  }
  async function selected(access, token, id) {
    if (!projectId(id)) throw new WebError("invalid_connection", 400);
    const result = await read(access, token);
    if (result.gaps.length)
      throw new WebError("connection_source_incomplete", 409);
    const current = result.records.find((r) => r.descriptor.id === id);
    if (!current) throw new WebError("connection_not_found", 404);
    authorize(access, current.descriptor);
    return { ...result, current };
  }
  async function planned(access, token, input, secretRef) {
    if (
      !exact(input, ["policy", "expectedPolicyDigest"]) ||
      (input.expectedPolicyDigest !== null && !hex(input.expectedPolicyDigest))
    )
      throw new WebError("invalid_connection_policy", 400);
    const policy = validatePolicy(input.policy, false),
      result = await read(access, token);
    if (result.gaps.length)
      throw new WebError("connection_source_incomplete", 409);
    authorize(access, policy);
    const old = result.records.find((r) => r.descriptor.id === policy.id);
    if (old) authorize(access, old.descriptor);
    if ((old?.policyDigest ?? null) !== input.expectedPolicyDigest)
      throw new WebError("stale_policy", 409);
    const descriptor = validatePolicy({
      version: 1,
      ...policy,
      secretRef: old?.descriptor.secretRef ?? secretRef,
    });
    const content = `${JSON.stringify(descriptor, null, 2)}\n`,
      path = `connections/${policy.id}.json`;
    if (
      Buffer.byteLength(content) > 16384 ||
      result.bytes -
        Buffer.byteLength(old?.content ?? "") +
        Buffer.byteLength(content) >
        262144 ||
      (!old && result.records.length >= 50)
    )
      throw new WebError("connection_limit", 409);
    if (old?.content === content) throw new WebError("policy_unchanged", 409);
    return {
      ...result,
      descriptor,
      files: [
        {
          path,
          before: old?.content ?? null,
          content,
          originalBlob: old?.originalBlob ?? null,
        },
      ],
      old,
    };
  }
  const allowed = (access, result) =>
    config.workspaceWrites === true &&
    access.contentsPermission === "write" &&
    result.snapshot.canWrite;
  async function preview(access, token, input) {
    const result = await planned(access, token, input, hash(random()));
    const previewId = hash(random()),
      operationId = hash(random());
    const value = {
      schema: 1,
      kind: "connection-policy",
      previewId,
      operationId,
      operationUrl: `/connections/operations/${operationId}`,
      expiresAt: new Date(now() + 900000).toISOString(),
      source: result.snapshot.source,
      files: result.files,
      commitMessage: `Update Plates connection policy\n\n${operationMarker(operationId)}`,
      canApply: allowed(access, result),
      limitations: [],
    };
    value.digest = hash(JSON.stringify(value));
    if (
      !(await store.createPreview(previewId, scopeFor(access.userId), {
        ...value,
        input,
        secretRef: result.descriptor.secretRef,
        actorId: access.userId,
        workspace: result.workspace,
        projects: [
          ...(result.old?.descriptor.projects ?? []),
          ...result.descriptor.projects,
        ],
      }))
    )
      throw new WebError("preview_unavailable");
    return value;
  }
  const view = (row) => ({
    schema: 1,
    id: row.id,
    state: row.state,
    reason: row.value.reason ?? null,
    receipt: row.value.receipt ?? null,
    operationUrl: `/connections/operations/${row.id}`,
  });
  async function loaded(access, token, id) {
    if (!hex(id)) throw new WebError("invalid_operation", 400);
    await learning.workspace(access, token);
    const row = await store.read(id, scopeFor(access.userId));
    if (!row || row.value.kind !== "connection-policy")
      throw new WebError("operation_not_found", 404);
    authorize(access, { projects: row.value.projects });
    return row;
  }
  async function operation(access, token, id) {
    return view(await loaded(access, token, id));
  }
  async function apply(access, token, id, { digest, reauthorize } = {}) {
    if (config.workspaceWrites !== true)
      throw new WebError("submission_disabled", 403);
    if (!hex(id) || !hex(digest)) throw new WebError("invalid_preview", 400);
    await learning.workspace(access, token);
    const scope = scopeFor(access.userId),
      saved = await store.preview(id, scope),
      p = saved?.value;
    if (!p || Date.parse(p.expiresAt) <= now())
      throw new WebError("preview_expired", 410);
    if (
      p.kind !== "connection-policy" ||
      p.actorId !== access.userId ||
      p.digest !== digest
    )
      throw new WebError("stale_preview", 409);
    authorize(access, { projects: p.projects });
    const fence = hash(random()),
      intent = {
        id: p.operationId,
        repo: p.workspace.repo,
        ...p.source,
        files: p.files.map(({ path, content, originalBlob }) => ({
          path,
          content,
          originalBlob,
        })),
        commitMessage: p.commitMessage,
        marker: `${operationMarker(p.operationId)}`,
      };
    let value = {
      kind: "connection-policy",
      previewId: id,
      actorId: access.userId,
      projects: p.projects,
      fence,
      intent,
      reason: null,
      receipt: null,
    };
    let row = await store.reserve(
      p.operationId,
      scope,
      projectKey,
      id,
      fence,
      value,
    );
    if (row?.conflict) throw new WebError("workspace_busy", 409);
    if (!row) throw new WebError("preview_expired", 410);
    if (!row.created) {
      if (typeof reauthorize !== "function")
        throw new WebError("authorization_recheck_required", 403);
      const fresh = await reauthorize();
      if (fresh.userId !== access.userId)
        throw new WebError("access_denied", 404);
      await learning.workspace(fresh, token);
      authorize(fresh, { projects: p.projects });
      return view(row);
    }
    let checked;
    try {
      if (typeof reauthorize !== "function")
        throw new WebError("authorization_recheck_required", 403);
      const fresh = await reauthorize();
      if (fresh.userId !== access.userId)
        throw new WebError("access_denied", 404);
      checked = await planned(fresh, token, p.input, p.secretRef);
      if (
        !allowed(fresh, checked) ||
        JSON.stringify(checked.files) !== JSON.stringify(p.files) ||
        JSON.stringify(checked.snapshot.source) !== JSON.stringify(p.source) ||
        Date.parse(p.expiresAt) <= now()
      )
        throw new WebError("stale_preview", 409);
      await checked.provider.recheck(checked.repository, p.source);
    } catch (error) {
      row = await store.transition("refused", p.operationId, scope, fence, {
        ...value,
        reason:
          error instanceof WebError ? error.code : "validation_unavailable",
      });
      if ([401, 404].includes(error.status)) throw error;
      if (!row) throw new WebError("operation_conflict", 409);
      return view(row);
    }
    row = await store.transition("dispatched", p.operationId, scope, fence);
    if (!row) throw new WebError("operation_conflict", 409);
    try {
      const commit = await checked.provider.dispatch(intent),
        found = await checked.provider.recover(intent, commit);
      if (!found) throw new WebError("remote_uncertain");
      value = { ...value, receipt: found };
      row =
        (await store.transition(
          "committed",
          p.operationId,
          scope,
          fence,
          value,
        )) ?? row;
    } catch (error) {
      const state = error.code === "remote_refused" ? "refused" : "uncertain";
      try {
        row =
          (await store.transition(state, p.operationId, scope, fence, {
            ...value,
            reason:
              state === "refused"
                ? "Conditional policy update refused."
                : "Recover this original operation; do not resubmit.",
          })) ?? row;
      } catch {
        /* Keep durable dispatched receipt. */
      }
    }
    // The write may have completed while access changed; never expose private output after denial.
    const fresh = await reauthorize();
    if (fresh.userId !== access.userId)
      throw new WebError("access_denied", 404);
    await learning.workspace(fresh, token);
    authorize(fresh, { projects: p.projects });
    return view(row);
  }
  async function recover(access, token, id, { reauthorize } = {}) {
    if (typeof reauthorize !== "function")
      throw new WebError("authorization_recheck_required", 403);
    const fresh = await reauthorize();
    if (fresh.userId !== access.userId)
      throw new WebError("access_denied", 404);
    let row = await loaded(fresh, token, id);
    if (["dispatched", "uncertain"].includes(row.state)) {
      try {
        const found = await createDecisionGitHub(token, {
          fetcher: learningTransport(fetcher),
        }).recover(row.value.intent);
        if (found)
          row =
            (await store.transition(
              "committed",
              id,
              scopeFor(access.userId),
              row.value.fence,
              { ...row.value, receipt: found, reason: null },
            )) ?? row;
      } catch (error) {
        if ([401, 404].includes(error.status)) throw error;
      }
    }
    const final = await reauthorize();
    if (final.userId !== access.userId)
      throw new WebError("access_denied", 404);
    await loaded(final, token, id);
    return view(row);
  }
  return {
    read,
    selected,
    authorize,
    allowed,
    preview,
    apply,
    operation,
    recover,
  };
}

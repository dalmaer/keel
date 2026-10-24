import { operationMarker } from './name-transition.mjs';
import { featureRestoreReady } from './recovery.mjs';
import { createJobs } from "./jobs.mjs";
import { createJobStore } from "./job-store.mjs";
import { createFleetStore } from "./fleet-store.mjs";
import { createUpdateRegistry } from "./fleet-registry.mjs";
import { createFleetProvider, publicationObjects } from "./fleet-provider.mjs";
import { digestId, version, projectFiles, productSource } from "./fleet-model.mjs";
import { validateUpdateOutput, patchDigest } from "../update-artifact.mjs";
import { updateBody } from "../update.mjs";
import { failureOf } from "../fleet.mjs";
import { blockBody } from "../practices.mjs";
import { exact, hash, random, WebError } from "./common.mjs";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const artifactId = (id) => hash(JSON.stringify(["update-output", id]));
export function createFleetUpdates(
  config,
  { fetcher = fetch, now = Date.now, resolveInitiator } = {},
) {
  const store = createFleetStore(config, fetcher),
    jobStore = createJobStore(config, fetcher),
    registry = createUpdateRegistry(config, { fetcher, now }),
    jobs = createJobs(config, {
      fetcher,
      now,
      resolveInitiator,
      adapter: "update-preparation-v1",
    });
  const provider = (token) => createFleetProvider(token, { fetcher });
  const projectFor = (a, id) => {
    const p = a.projects.find((p) => p.id === id);
    if (!p) throw new WebError("access_denied", 404);
    registry.authorize(a, p);
    return p;
  };
  async function fresh(a, reauthorize) {
    if (typeof reauthorize !== "function")
      throw new WebError("authorization_recheck_required", 403);
    const b = await reauthorize();
    if (b.userId !== a.userId) throw new WebError("access_denied", 404);
    return b;
  }
  async function record(a, id, kind) {
    const r = await store.read(id, a.userId);
    if (!r || (kind && r.kind !== kind))
      throw new WebError("operation_not_found", 404);
    for (const pid of r.value.projectIds ?? [r.value.projectId].filter(Boolean))
      projectFor(a, pid);
    return r;
  }
  function publicationView(r) {
    const v = r.value;
    return {
      schema: 1,
      kind: "publication",
      id: r.id,
      projectId: v.projectId,
      rolloutId: v.rolloutId,
      state:
        r.state === "committed"
          ? "committed"
          : r.state === "ready"
            ? "publishing"
            : "uncertain",
      stage: r.stage,
      reason: ["ready", "committed"].includes(r.state)
        ? null
        : "Only exact readback can settle a dispatched effect.",
      branch: v.branch,
      commit: v.commit,
      pr: v.pr ?? null,
      checks: v.checks,
      capabilities: {
        reconcile: r.state === "dispatched" || r.state === "uncertain",
        continue: r.state === "ready",
      },
      gaps: [],
    };
  }
  async function artifact(a, token, p, id) {
    registry.authorize(a, p);
    const r = await record(a, id, "artifact");
    if (r.project !== store.projectFor(p))
      throw new WebError("access_denied", 404);
    const output = validateUpdateOutput(r.value.output);
    if (patchDigest(output) !== r.digest || r.value.jobId === undefined)
      throw new WebError("invalid_fleet_artifact");
    return {
      schema: 1,
      id: r.id,
      jobId: r.value.jobId,
      digest: r.digest,
      output,
      recordedAt: r.created_at,
    };
  }
  async function preparationView(a, token, r) {
    const p = projectFor(a, r.value.projectId);
    let job = null,
      art = null;
    const gaps = [];
    try {
      job = await jobs.operation(a, token, p, r.id);
    } catch (e) {
      if (e.code !== "operation_not_found") throw e;
      gaps.push({
        code: "preparation_not_visible",
        reason:
          "The original request may still reserve its job. Recover this receipt; do not create a replacement.",
      });
    }
    try {
      art = await artifact(a, token, p, artifactId(r.id));
    } catch (e) {
      if (e.code !== "operation_not_found") throw e;
    }
    const expectedWorker =
        art?.output.checks.updated.exit === 0 ? "succeeded" : "failed",
      expectedProvider = expectedWorker === "succeeded" ? "success" : "failure";
    const canPublish =
      !!art &&
      job?.state === "terminal" &&
      job.worker.result?.state === expectedWorker &&
      job.provider?.conclusion === expectedProvider;
    return {
      schema: 1,
      kind: "preparation",
      id: r.id,
      projectId: p.id,
      rolloutId: r.value.rolloutId,
      job,
      artifactId: art?.id ?? null,
      artifactDigest: art?.digest ?? null,
      capabilities: {
        reconcile: !!job,
        cancel: job?.capabilities.cancel ?? false,
        publish: canPublish,
      },
      gaps,
    };
  }
  async function operation(a, token, id) {
    const r = await record(a, id);
    if (r.kind === "publication") return publicationView(r);
    if (r.kind === "preparation") return preparationView(a, token, r);
    throw new WebError("operation_not_found", 404);
  }
  async function rollout(a, token, id) {
    const r = await record(a, id, "rollout"),
      v = r.value,
      items = [];
    let next = null,
      blocked = r.state === "stopped";
    for (const pid of v.projectIds) {
      const link = v.links[pid] ?? {},
        item = {
          projectId: pid,
          state: "pending",
          preparationId: link.preparationId ?? null,
          publicationId: link.publicationId ?? null,
        };
      if (item.publicationId) {
        const pub = await operation(a, token, item.publicationId);
        item.state = pub.state === "committed" ? "committed" : "publishing";
        if (pub.state !== "committed" || pub.checks.updated.exit !== 0)
          blocked = true;
      } else if (item.preparationId) {
        const prep = await operation(a, token, item.preparationId);
        item.state = prep.artifactId ? "prepared" : "preparing";
        blocked = true;
      } else if (!blocked && next === null) {
        next = pid;
        blocked = true;
      }
      items.push(item);
    }
    return {
      schema: 1,
      id,
      version: r.version,
      state: r.state === "stopped" ? "stopped" : "active",
      projectIds: v.projectIds,
      canary: v.canary,
      projects: items,
      nextProjectId: next,
      capabilities: { continue: next !== null, stop: r.state !== "stopped" },
      gaps: [],
    };
  }
  async function createRollout(a, token, input, { reauthorize } = {}) {
    if (
      !exact(input, ["requestId", "projectIds", "canary"]) ||
      !digestId(input.requestId) ||
      !Array.isArray(input.projectIds) ||
      input.projectIds.length < 1 ||
      input.projectIds.length > 3 ||
      new Set(input.projectIds).size !== input.projectIds.length ||
      !input.projectIds.includes(input.canary)
    )
      throw new WebError("invalid_rollout", 400);
    const live = await fresh(a, reauthorize);
    for (const id of input.projectIds) projectFor(live, id);
    const ids = [
        input.canary,
        ...input.projectIds.filter((id) => id !== input.canary),
      ],
      value = { projectIds: ids, canary: input.canary, links: {} };
    await store.create(
      input.requestId,
      a.userId,
      "rollout",
      null,
      hash(JSON.stringify(value)),
      value,
    );
    return rollout(await fresh(a, reauthorize), token, input.requestId);
  }
  async function stop(a, token, id, input, { reauthorize } = {}) {
    if (
      !exact(input, ["expectedVersion"]) ||
      !Number.isSafeInteger(input.expectedVersion)
    )
      throw new WebError("invalid_rollout_version", 400);
    const r = await record(await fresh(a, reauthorize), id, "rollout");
    if (r.version !== input.expectedVersion)
      throw new WebError("fleet_state_conflict", 409);
    if (r.state !== "stopped") await store.cas(r, "stopped", 0, r.value);
    return rollout(await fresh(a, reauthorize), token, id);
  }
  async function link(a, id, p, field, operationId) {
    const r = await record(a, id, "rollout");
    if (r.state === "stopped") throw new WebError("rollout_stopped", 409);
    const existing = r.value.links[p.id] ?? {};
    if (existing[field] && existing[field] !== operationId)
      throw new WebError("rollout_project_conflict", 409);
    if (existing[field] === operationId) return;
    await store.cas(r, "ready", 0, {
      ...r.value,
      links: {
        ...r.value.links,
        [p.id]: { ...existing, [field]: operationId },
      },
    });
  }
  async function preparePreview(a, token, p, input, { sessionRef } = {}) {
    registry.authorize(a, p);
    if (!exact(input, ["rolloutId"]) || !digestId(input.rolloutId))
      throw new WebError("invalid_rollout", 400);
    const roll = await rollout(a, token, input.rolloutId);
    if (roll.nextProjectId !== p.id) throw new WebError("rollout_paused", 409);
    const c = await registry.inspect(a, token, p),
      j = await jobs.preview(
        a,
        token,
        p,
        { routineId: c.registry.workflow.path, retryOf: null },
        { sessionRef },
      );
    const view = {
      ...j,
      kind: "preparation",
      rolloutId: input.rolloutId,
      target: c.preparation.target,
      container: c.preparation.container,
      setup: c.preparation.setup,
      check: c.preparation.check,
      environmentKeys: Object.keys(c.preparation.env).sort(),
      digest: null,
    };
    delete view.preparation;
    view.digest = hash(JSON.stringify(view));
    await store.create(j.previewId, a.userId, "preview", p, view.digest, {
      projectId: p.id,
      public: view,
      jobPreview: j,
    });
    return view;
  }
  async function prepare(a, token, p, input, { reauthorize } = {}) {
    if (
      !exact(input, ["rolloutId", "requestId", "previewId", "digest"]) ||
      !Object.values(input).every(digestId)
    )
      throw new WebError("invalid_update_submission", 400);
    const live = await fresh(a, reauthorize);
    registry.authorize(live, p);
    const saved = await record(live, input.previewId, "preview"),
      v = saved.value.public;
    if (
      saved.project !== store.projectFor(p) ||
      v.requestId !== input.requestId ||
      v.digest !== input.digest ||
      v.rolloutId !== input.rolloutId ||
      Date.parse(v.expiresAt) <= now()
    )
      throw new WebError("stale_preview", 409);
    const old = await store.read(input.requestId, a.userId);
    if (!old) {
      const roll = await rollout(live, token, input.rolloutId);
      if (roll.nextProjectId !== p.id)
        throw new WebError("rollout_paused", 409);
    }
    await store.create(
      input.requestId,
      a.userId,
      "preparation",
      p,
      input.digest,
      {
        projectId: p.id,
        rolloutId: input.rolloutId,
        previewId: input.previewId,
      },
    );
    await link(live, input.rolloutId, p, "preparationId", input.requestId);
    const j = saved.value.jobPreview;
    await jobs.start(
      live,
      token,
      p,
      { requestId: j.requestId, previewId: j.previewId, digest: j.digest },
      { reauthorize },
    );
    return operation(await fresh(a, reauthorize), token, input.requestId);
  }
  async function output(identity, input) {
    if (
      !exact(input, [
        "operationId",
        "nonce",
        "jobName",
        "fence",
        "jobId",
        "output",
      ])
    )
      throw new WebError("invalid_update_output", 400);
    const { output: raw, ...authority } = input,
      { row, preparation } = await jobs.verifyOutput(identity, authority),
      value = validateUpdateOutput(raw);
    if (
      !same(value.base, preparation.base) ||
      !same(value.target, preparation.target) ||
      value.checks.updated.command !== preparation.check ||
      value.checks.setup?.command !== (preparation.setup ?? undefined) ||
      (value.checks.base && value.checks.base.command !== preparation.check) ||
      (value.checks.baseSetup &&
        value.checks.baseSetup.command !== preparation.setup)
    )
      throw new WebError("update_output_binding", 409);
    const init = await resolveInitiator(row.value.sessionRef, row.actor),
      snap = await provider(init.token).snapshot(row.value.project);
    if (
      snap.source.head !== value.base.commit ||
      snap.source.repositoryNodeId !== value.base.repositoryNodeId
    )
      throw new WebError("update_source_changed", 409);
    for (const f of value.files) {
      const e = snap.entries.get(f.path);
      if (
        f.before === null
          ? !!e
          : !e || e.sha !== f.before.blob || e.mode !== f.before.mode
      )
        throw new WebError("update_output_binding", 409);
    }
    await jobs.verifyOutput(identity, authority);
    const digest = patchDigest(value),
      id = artifactId(row.id);
    await store.output(
      id,
      row.actor,
      row.value.project,
      digest,
      { projectId: row.value.project.id, jobId: row.id, output: value },
      {
        operationId: row.id,
        runId: identity.runId,
        jobId: input.jobId,
        nonce: input.nonce,
        fence: input.fence,
      },
    );
    return { accepted: true, artifactId: id, digest };
  }
  function publishAllowed(a, snap) {
    return (
      config.fleetUpdates?.publishEnabled === true &&
      featureRestoreReady(config, config.jobs?.restoreReconciledAt, now()) &&
      config.workspaceWrites === true &&
      a.contentsPermission === "write" &&
      a.pullRequestsPermission === "write" &&
      snap.canWrite
    );
  }
  async function publicationPreview(a, token, p, input) {
    registry.authorize(a, p);
    if (
      !exact(input, ["rolloutId", "preparationId"]) ||
      !Object.values(input).every(digestId)
    )
      throw new WebError("invalid_publication_preview", 400);
    const roll = await record(a, input.rolloutId, "rollout");
    if (
      roll.state === "stopped" ||
      roll.value.links[p.id]?.preparationId !== input.preparationId
    )
      throw new WebError("rollout_paused", 409);
    const prep = await operation(a, token, input.preparationId);
    if (!prep.capabilities.publish)
      throw new WebError("preparation_not_verified", 409);
    const art = await artifact(a, token, p, prep.artifactId),
      out = art.output,
      c = await registry.inspect(a, token, p);
    if (
      c.source.head !== out.base.commit ||
      !same(c.preparation.target, out.target)
    )
      throw new WebError("update_source_changed", 409);
    await c.provider.conflicts(p, out.target.practiceVersion);
    if (!out.files.length) throw new WebError("update_unchanged", 409);
    const cfg = JSON.parse(
        (await c.snapshot.reader.readFile(projectFiles(c.snapshot).config)).toString(),
      ),
      from = cfg.practice ?? "0.0.0",
      to = out.target.practiceVersion,
      title =
        from === to
          ? `plates update: practice ${to}, pending migrations`
          : `plates update: practice ${from} → ${to}`,
      requestId = hash(random()),
      previewId = hash(random()),
      branch = `keel/web-update-${requestId}`,
      marker = `${operationMarker(requestId, 'Keel-Update-Operation')}`,
      message = [
        title,
        "",
        ...out.migrations.flatMap((m) => [
          `${m.id}: ${m.summary}`,
          ...(m.paths.length ? [`  rewrites: ${m.paths.join(", ")}`] : []),
          ...m.notes.map((n) => `  note: ${n}`),
        ]),
        marker,
      ].join("\n");
    let failure = null;
    if (out.checks.updated.exit !== 0) {
      const check = {
          command: out.checks.updated.command,
          exit: out.checks.updated.exit,
          tail: out.checks.updated.tail,
        },
        base = out.checks.base;
      failure = failureOf(
        check,
        base
          ? { exit: base.exit, signal: base.signal, tail: base.tail }
          : { exit: null, signal: "unavailable", tail: "" },
      );
    }
    const body =
        updateBody({
          from,
          to,
          message,
          check: out.checks.updated.command,
          files: out.files.map((f) => f.path),
          failure,
        }) + `\n\n${marker}\n`,
      at = new Date(now()).toISOString();
    const objects = publicationObjects(
      c.snapshot.entries,
      out.files,
      c.source.head,
      message,
      at,
    );
    if (objects.length > 2400) throw new WebError("publication_limit", 413);
    const view = {
      schema: 1,
      kind: "publication",
      previewId,
      requestId,
      digest: null,
      expiresAt: new Date(now() + 900000).toISOString(),
      project: p,
      source: c.source,
      target: out.target,
      artifactId: art.id,
      artifactDigest: art.digest,
      files: out.files,
      checks: out.checks,
      migrations: out.migrations,
      branch,
      title,
      body,
      draft: !!failure?.draft,
      audience: c.source.visibility,
      canApply:
        publishAllowed(a, c.snapshot) &&
        (!out.files.some((f) => f.path.startsWith(".github/workflows/")) ||
          a.workflowsPermission === "write"),
      effects: [
        "Create immutable Git objects, an operation branch and one pull request.",
      ],
      gaps: [],
      rolloutId: input.rolloutId,
    };
    view.digest = hash(JSON.stringify(view));
    const internal = {
      projectId: p.id,
      public: view,
      objects,
      commit: objects.at(-1).sha,
      baseBranch: c.source.branch,
      preparationId: input.preparationId,
      registryDigest: c.registryDigest,
    };
    if (Buffer.byteLength(JSON.stringify(internal)) > 2 * 1024 * 1024)
      throw new WebError("publication_limit", 413);
    await store.create(
      previewId,
      a.userId,
      "preview",
      p,
      view.digest,
      internal,
    );
    return view;
  }
  async function publicationCurrent(a, token, r, reauthorize) {
    const live = await fresh(a, reauthorize),
      p = projectFor(live, r.value.projectId),
      c = await registry.inspect(live, token, p),
      v = r.value;
    if (
      !publishAllowed(live, c.snapshot) ||
      (v.files.some((f) => f.path.startsWith(".github/workflows/")) &&
        live.workflowsPermission !== "write")
    )
      throw new WebError("publication_disabled", 403);
    if (
      !same(c.source, v.source) ||
      !same(c.preparation.target, v.target) ||
      c.registryDigest !== v.registryDigest
    )
      throw new WebError("update_source_changed", 409);
    return { live, p, client: c.provider };
  }
  function effect(v, index) {
    return index < v.objects.length
      ? { kind: "object", value: v.objects[index] }
      : index === v.objects.length
        ? { kind: "ref" }
        : { kind: "pr" };
  }
  async function recoverEffect(client, p, v, e) {
    if (e.kind === "object")
      return (await client.readObject(p, e.value)) ? {} : null;
    if (e.kind === "ref")
      return (await client.readRef(p, v.branch, v.commit)) ? {} : null;
    const pr = await client.readPr(p, v);
    return pr ? { pr } : null;
  }
  async function settle(r, found) {
    const last = r.stage === r.value.objects.length + 1;
    return store.cas(r, last ? "committed" : "ready", r.stage + 1, {
      ...r.value,
      ...found,
    });
  }
  async function advancePublication(a, token, r, reauthorize) {
    for (let n = 0; n < 1 && r.state === "ready"; n++) {
      const { p, client } = await publicationCurrent(a, token, r, reauthorize),
        e = effect(r.value, r.stage);
      r = await store.cas(r, "dispatched", r.stage, r.value);
      try {
        let found = {};
        if (e.kind === "object") {
          const object =
            e.value.kind === "blob"
              ? {
                  ...e.value,
                  body: {
                    content: r.value.files.find((f) => f.path === e.value.path)
                      .after.content,
                    encoding: "base64",
                  },
                }
              : e.value;
          await client.writeObject(p, object);
        } else if (e.kind === "ref")
          await client.writeRef(p, r.value.branch, r.value.commit);
        else found = { pr: await client.writePr(p, r.value) };
        r = await settle(r, found);
      } catch {
        try {
          r = await store.cas(r, "uncertain", r.stage, r.value);
        } catch {}
        break;
      }
    }
    return publicationView(r);
  }
  async function publish(a, token, p, input, { reauthorize } = {}) {
    if (
      !exact(input, [
        "rolloutId",
        "requestId",
        "previewId",
        "digest",
        "publicAcknowledgement",
      ]) ||
      !["rolloutId", "requestId", "previewId", "digest"].every((k) =>
        digestId(input[k]),
      )
    )
      throw new WebError("invalid_publication_submission", 400);
    const live = await fresh(a, reauthorize);
    registry.authorize(live, p);
    let r = await store.read(input.requestId, a.userId);
    if (r) {
      if (
        r.kind !== "publication" ||
        r.digest !== input.digest ||
        r.value.rolloutId !== input.rolloutId ||
        r.project !== store.projectFor(p)
      )
        throw new WebError("publication_identity_conflict", 409);
      return advancePublication(live, token, r, reauthorize);
    }
    const saved = await record(live, input.previewId, "preview"),
      v = saved.value.public;
    if (
      v.kind !== "publication" ||
      v.requestId !== input.requestId ||
      v.digest !== input.digest ||
      v.rolloutId !== input.rolloutId ||
      saved.project !== store.projectFor(p) ||
      Date.parse(v.expiresAt) <= now() ||
      (v.audience === "public" && input.publicAcknowledgement !== v.digest)
    )
      throw new WebError("stale_preview", 409);
    const prep = await operation(live, token, saved.value.preparationId);
    if (!prep.capabilities.publish)
      throw new WebError("preparation_not_verified", 409);
    const value = {
      ...v,
      projectId: p.id,
      objects: saved.value.objects,
      commit: saved.value.commit,
      baseBranch: saved.value.baseBranch,
      registryDigest: saved.value.registryDigest,
      pr: null,
    };
    r = await store.create(
      input.requestId,
      a.userId,
      "publication",
      p,
      input.digest,
      value,
    );
    await link(live, input.rolloutId, p, "publicationId", r.id);
    return advancePublication(live, token, r, reauthorize);
  }
  async function continuePublication(a, token, id, { reauthorize } = {}) {
    const live = await fresh(a, reauthorize),
      r = await record(live, id, "publication");
    return advancePublication(live, token, r, reauthorize);
  }
  async function reconcile(a, token, id, { reauthorize } = {}) {
    const live = await fresh(a, reauthorize);
    let r = await record(live, id);
    const p = projectFor(live, r.value.projectId);
    if (r.kind === "preparation") {
      await jobs.reconcile(live, token, p, id, { reauthorize });
      return operation(await fresh(a, reauthorize), token, id);
    }
    if (r.kind !== "publication")
      throw new WebError("operation_not_found", 404);
    if (["dispatched", "uncertain"].includes(r.state)) {
      const client = provider(token);
      await client.identity(p);
      const found = await recoverEffect(
        client,
        p,
        r.value,
        effect(r.value, r.stage),
      );
      if (found) r = await settle(r, found);
    }
    await fresh(a, reauthorize);
    return publicationView(r);
  }
  async function cancel(a, token, id, { reauthorize } = {}) {
    const live = await fresh(a, reauthorize),
      r = await record(live, id, "preparation"),
      p = projectFor(live, r.value.projectId);
    await jobs.cancel(live, token, p, id, { reauthorize });
    return operation(await fresh(a, reauthorize), token, id);
  }
  async function comparison(a, token, p) {
    registry.authorize(a, p);
    const client = provider(token),
      snapshot = await client.snapshot(p),
      gaps = [],
      cfg = JSON.parse(
        (await snapshot.reader.readFile(projectFiles(snapshot).config)).toString(),
      );
    let lock = null;
    try {
      lock = JSON.parse(
        (await snapshot.reader.readFile(projectFiles(snapshot).lock)).toString(),
      );
    } catch {
      gaps.push({
        code: "lock_unavailable",
        reason: "Managed ownership could not be completely read.",
      });
    }
    let cliDeclaration = null;
    try {
      const pkg = JSON.parse(
          (await snapshot.reader.readFile("package.json")).toString(),
        ),
        decl = Object.hasOwn(pkg.dependencies ?? {}, "plates") ? pkg.dependencies.plates
          : Object.hasOwn(pkg.devDependencies ?? {}, "plates") ? pkg.devDependencies.plates
          : pkg.dependencies?.keel ?? pkg.devDependencies?.keel;
      if (typeof decl === "string" && decl.length <= 1000)
        cliDeclaration = decl;
    } catch {}
    gaps.push({
      code: "runtime_unavailable",
      reason:
        "A dependency declaration does not establish the installed CLI/runtime.",
    });
    const managed = [];
    if (
      lock?.files &&
      typeof lock.files === "object" &&
      !Array.isArray(lock.files)
    ) {
      const rows = Object.entries(lock.files);
      if (rows.length > 200)
        gaps.push({
          code: "ownership_bounded",
          reason: "Managed-file comparison exceeds this read bound.",
        });
      for (const [key, row] of rows.slice(0, 200)) {
        const [path, block] = key.split("#");
        try {
          const bytes = await snapshot.reader.readFile(path),
            content = block ? blockBody(bytes.toString(), block) : bytes;
          managed.push({
            path: key,
            state:
              content !== null && hash(content) === row.sha256
                ? "matches-lock"
                : "changed",
          });
        } catch {
          managed.push({ path: key, state: "unavailable" });
          gaps.push({
            code: "ownership_unavailable",
            reason: "A managed file or safe alias requires worker inspection.",
          });
        }
      }
    } else
      gaps.push({
        code: "ownership_unavailable",
        reason: "Managed-file ownership is unavailable.",
      });
    const ejected =
      Array.isArray(cfg.ejected) &&
      cfg.ejected.every((p) => typeof p === "string" && p.length <= 500)
        ? cfg.ejected.slice(0, 200)
        : [];
    for (const path of ejected)
      if (!managed.some((row) => row.path === path))
        managed.push({ path, state: "ejected" });
    if ((cfg.ejected?.length ?? 0) > 200)
      gaps.push({
        code: "ownership_bounded",
        reason: "Ejected paths exceed this comparison bound.",
      });
    let trusted = null;
    try {
      trusted = await client.target(config.fleetUpdates?.target);
    } catch (e) {
      if (e.status === 404) throw e;
      gaps.push({
        code: "target_unavailable",
        reason: "The pinned target could not be verified.",
      });
    }
    const recorded =
        Array.isArray(cfg.migrations) &&
        cfg.migrations.every((x) => typeof x === "string")
          ? cfg.migrations
          : [],
      unrecorded = trusted
        ? [...trusted.entries.keys()]
            .filter((p) => /^migrations\/\d{4}-[\w-]+\.mjs$/.test(p))
            .map((p) => p.slice(11, -4))
            .filter((id) => !recorded.includes(id))
        : null;
    let eligible = false;
    try {
      const c = await registry.inspect(a, token, p);
      eligible = registry.canStart(a, c);
    } catch (e) {
      if (e.status === 404) throw e;
      gaps.push({
        code: e.code ?? "worker_unavailable",
        reason:
          "Preparation is unavailable until its source and policy are approved.",
      });
    }
    return {
      schema: 1,
      project: p,
      source: snapshot.source,
      target: trusted?.target ?? null,
      versions: {
        practice: version(cfg.practice) ? cfg.practice : null,
        lock: version(lock?.practice) ? lock.practice : null,
        cliDeclaration,
        runtime: null,
      },
      ownership: {
        state: gaps.some(
          (g) =>
            g.code.startsWith("ownership") || g.code === "lock_unavailable",
        )
          ? "unavailable"
          : managed.some((x) => x.state !== "matches-lock")
            ? "changed"
            : "matches-lock",
        files: managed,
        ejected,
        gaps: gaps.filter((g) => g.code.startsWith("ownership")),
      },
      migrations: {
        recorded,
        pending: unrecorded,
        state:
          unrecorded === null
            ? "unavailable"
            : unrecorded.length
              ? "applicability-unverified"
              : "all-recorded",
      },
      eligible: productSource(cfg) !== "self" && eligible,
      capabilities: { prepare: productSource(cfg) !== "self" && eligible },
      gaps,
    };
  }
  return {
    comparison,
    createRollout,
    rollout,
    stop,
    preparePreview,
    prepare,
    operation,
    reconcile,
    cancel,
    artifact,
    output,
    publicationPreview,
    publish,
    continuePublication,
  };
}

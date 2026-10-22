import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  symlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./helpers/run.mjs";
import {
  fleetUpdatesHarness,
  token,
  treeEntries,
} from "./helpers/web-fleet-updates.mjs";
import { publicationObjects, gitTree } from "../lib/web/fleet-provider.mjs";
import { hash } from "../lib/web/common.mjs";
import { gitBlob } from "../lib/web/decision-github.mjs";
import { legacyUpdateWorkflow } from "../lib/web/update-workflow.mjs";
const project = (h) => h.access.projects[0],
  opts = (h) => ({ reauthorize: h.refreshAccess });
async function reviewed(h) {
  const roll = await h.fleet.createRollout(
    h.access,
    token,
    {
      requestId: "1".repeat(64),
      projectIds: h.rolloutProjects ?? ["studio"],
      canary: "studio",
    },
    opts(h),
  );
  const p = await h.fleet.preparePreview(
    h.access,
    token,
    project(h),
    { rolloutId: roll.id },
    { sessionRef: h.sessionRef },
  );
  return { roll, p };
}
async function started(h) {
  const { roll, p } = await reviewed(h),
    r = await h.fleet.prepare(
      h.access,
      token,
      project(h),
      {
        rolloutId: roll.id,
        requestId: p.requestId,
        previewId: p.previewId,
        digest: p.digest,
      },
      opts(h),
    );
  const identity = h.workerIdentity(r.job.provider.runId),
    input = { operationId: r.id, nonce: "a".repeat(64), jobName: "web-worker" },
    claim = await h.jobs.claim(identity, input);
  await h.jobs.begin(identity, {
    ...input,
    fence: claim.fence,
    jobId: claim.jobId,
  });
  return {
    roll,
    p,
    r,
    identity,
    input: { ...input, fence: claim.fence, jobId: claim.jobId },
    claim,
  };
}
async function prepared(h, change = () => {}) {
  const s = await started(h),
    output = h.output();
  change(output);
  await h.fleet.output(s.identity, { ...s.input, output });
  await h.jobs.complete(s.identity, {
    ...s.input,
    sequence: 1,
    result: {
      state: output.checks.updated.exit === 0 ? "succeeded" : "failed",
      exitCode: output.checks.updated.exit ?? 1,
    },
  });
  Object.assign(h.actions.runs.get(s.r.job.provider.runId), {
    status: "completed",
    conclusion: output.checks.updated.exit === 0 ? "success" : "failure",
  });
  await h.fleet.reconcile(h.access, token, s.r.id, opts(h));
  return s;
}
async function publication(h, s) {
  return h.fleet.publicationPreview(h.access, token, project(h), {
    rolloutId: s.roll.id,
    preparationId: s.r.id,
  });
}
async function publish(h, p) {
  return h.fleet.publish(
    h.access,
    token,
    project(h),
    {
      rolloutId: p.rolloutId,
      requestId: p.requestId,
      previewId: p.previewId,
      digest: p.digest,
      publicAcknowledgement: p.digest,
    },
    opts(h),
  );
}
async function finish(h, r) {
  for (let i = 0; i < 30 && r.capabilities.continue; i++)
    r = await h.fleet.continuePublication(h.access, token, r.id, opts(h));
  return r;
}

test("equal declared versions retain unverified migration applicability and runtime gaps", async () => {
  const h = await fleetUpdatesHarness(),
    v = await h.fleet.comparison(h.access, token, project(h));
  assert.equal(v.versions.practice, "1.0.0");
  assert.equal(v.versions.runtime, null);
  assert.equal(v.migrations.state, "applicability-unverified");
  assert.deepEqual(v.migrations.pending, ["0001-acme"]);
  assert.equal(v.capabilities.prepare, true);
});
test('fleet comparison keeps canonical config authoritative and reads legacy snapshots only when absent', async () => {
  for (const legacy of [false, true]) {
    const h = await fleetUpdatesHarness();
    for (const [canonical, old] of [['.plates/plates.json', '.keel/keel.json'], ['.plates/lock.json', '.keel/lock.json']]) {
      h.source.files[old] = legacy ? h.source.files[canonical] : '{bad legacy';
      if (legacy) delete h.source.files[canonical];
    }
    h.source.files['package.json'] = JSON.stringify({ dependencies: { keel: 'legacy-pin' }, devDependencies: { plates: '' } });
    const result = await h.fleet.comparison(h.access, token, project(h));
    assert.equal(result.versions.practice, '1.0.0');
    assert.equal(result.versions.cliDeclaration, '');
    assert.equal(result.ownership.state, 'matches-lock');
  }
  const h = await fleetUpdatesHarness();
  h.source.files['.keel/keel.json'] = h.source.files['.plates/plates.json'];
  h.source.files['.plates/plates.json'] = '{bad canonical';
  await assert.rejects(h.fleet.comparison(h.access, token, project(h)));
});
test('fleet preparation accepts exact legacy workflow pins but refuses changed source', async () => {
  const h = await fleetUpdatesHarness(), r = h.updateRegistration;
  h.source.files[r.workflow.path] = legacyUpdateWorkflow(h.config.fleetUpdates.target);
  r.workflow.workflowBlob = gitBlob(h.source.files[r.workflow.path]);h.registerUpdate();
  assert.equal((await reviewed(h)).p.canApply, true);
  h.source.files[r.workflow.path] += '# unreviewed workflow edit\n';
  r.workflow.workflowBlob = gitBlob(h.source.files[r.workflow.path]);h.registerUpdate();
  await assert.rejects(reviewed(h), { code: 'worker_source_changed' });
});
test("one preparation reserves shared sixty minutes and output waits for provider termination", async () => {
  const h = await fleetUpdatesHarness(),
    s = await started(h);
  assert.equal(s.claim.adapter, "update-preparation-v1");
  assert.equal(s.claim.deadline, h.state.now + 3600000);
  assert.deepEqual(s.claim.preparation.target, h.config.fleetUpdates.target);
  const out = await h.fleet.output(s.identity, {
    ...s.input,
    output: h.output(),
  });
  assert.equal(out.accepted, true);
  assert.equal(
    (await h.fleet.operation(h.access, token, s.r.id)).capabilities.publish,
    false,
  );
  assert.equal([...h.jobDb.rows.values()][0].minutes, 60);
  await assert.rejects(
    h.jobs
      .preview(
        h.access,
        token,
        project(h),
        { routineId: h.routineId, retryOf: null },
        { sessionRef: h.sessionRef },
      )
      .then((p) =>
        h.jobs.start(
          h.access,
          token,
          project(h),
          { requestId: p.requestId, previewId: p.previewId, digest: p.digest },
          opts(h),
        ),
      ),
    { code: "job_lane_conflict" },
  );
});
test("artifact is immutable, source-bound and cannot be submitted as browser authority", async () => {
  const h = await fleetUpdatesHarness(),
    s = await started(h),
    input = { ...s.input, output: h.output() },
    one = await h.fleet.output(s.identity, input),
    two = await h.fleet.output(s.identity, input);
  assert.equal(one.digest, two.digest);
  const altered = h.output();
  altered.files[0].after.content =
    Buffer.from("Acme different").toString("base64");
  await assert.rejects(
    h.fleet.output(s.identity, { ...s.input, output: altered }),
    { code: "fleet_identity_conflict" },
  );
  await assert.rejects(
    h.fleet.output({ ...s.identity, repositoryId: 999 }, input),
    { code: "worker_identity_denied" },
  );
  const forged = h.output();
  forged.files[0].before.blob = "f".repeat(40);
  await assert.rejects(
    h.fleet.output(s.identity, { ...s.input, output: forged }),
    { code: "update_output_binding" },
  );
});
test("exact reviewed public publication advances one effect per request and retains duplicate receipt", async () => {
  const h = await fleetUpdatesHarness(),
    s = await prepared(h),
    p = await publication(h, s);
  assert.equal(h.remote.writes.length, 0);
  await assert.rejects(
    h.fleet.publish(
      h.access,
      token,
      project(h),
      {
        rolloutId: p.rolloutId,
        requestId: p.requestId,
        previewId: p.previewId,
        digest: p.digest,
        publicAcknowledgement: null,
      },
      opts(h),
    ),
  );
  let r = await publish(h, p);
  assert.equal(h.remote.writes.length, 1);
  r = await finish(h, r);
  assert.equal(r.state, "committed");
  assert.equal(r.reason, null);
  assert.equal(h.remote.prs.length, 1);
  await publish(h, p);
  assert.equal(h.remote.prs.length, 1);
  assert.equal(
    (await h.fleet.rollout(h.access, token, s.roll.id)).projects[0].state,
    "committed",
  );
});
test("lost object, ref and PR responses recover exact effects without repeating POST", async () => {
  for (const effect of ["blobs", "refs", "pulls"]) {
    const h = await fleetUpdatesHarness(),
      s = await prepared(h),
      p = await publication(h, s);
    h.remote.lost = effect;
    let r = await publish(h, p);
    for (let i = 0; i < 30 && r.state !== "uncertain"; i++)
      r = await h.fleet.continuePublication(h.access, token, r.id, opts(h));
    assert.equal(r.state, "uncertain", effect);
    const count = h.remote.writes.length;
    await h.fleet.operation(h.access, token, r.id);
    assert.equal(h.remote.writes.length, count);
    r = await h.fleet.reconcile(h.access, token, r.id, opts(h));
    assert.equal(h.remote.writes.length, count);
    r = await finish(h, r);
    assert.equal(r.state, "committed");
    assert.equal(h.remote.prs.length, 1);
  }
});
test("absent uncertain PR never permits a repeated POST and changed draft is not recovered", async () => {
  const h = await fleetUpdatesHarness(),
    s = await prepared(h, (o) => {
      o.checks.updated.exit = 1;
      o.checks.updated.tail = "Acme check failed";
    }),
    p = await publication(h, s);
  assert.equal(p.draft, true);
  h.remote.lost = "pulls";
  let r = await finish(h, await publish(h, p));
  assert.equal(r.state, "uncertain");
  h.remote.prMissing = true;
  r = await h.fleet.reconcile(h.access, token, r.id, opts(h));
  assert.equal(r.capabilities.continue, false);
  const count = h.remote.writes.length;
  await h.fleet.continuePublication(h.access, token, r.id, opts(h));
  assert.equal(h.remote.writes.length, count);
  h.remote.prMissing = false;
  h.remote.draftOverride = false;
  await assert.rejects(h.fleet.reconcile(h.access, token, r.id, opts(h)), {
    code: "update_pr_conflict",
  });
});
test("stale source, target or publication permission refuses next effect", async () => {
  for (const mutate of [
    (h) => (h.source.head = "f".repeat(40)),
    (h) => (h.config.fleetUpdates.target.bundleDigest = "f".repeat(64)),
    (h) => (h.config.fleetUpdates.publishEnabled = false),
  ]) {
    const h = await fleetUpdatesHarness(),
      s = await prepared(h),
      p = await publication(h, s);
    const r = await publish(h, p),
      count = h.remote.writes.length;
    mutate(h);
    await assert.rejects(
      h.fleet.continuePublication(h.access, token, r.id, opts(h)),
    );
    assert.equal(h.remote.writes.length, count);
  }
});
test("rollout identity recovers across lost creation response and stop blocks preparation", async () => {
  const h = await fleetUpdatesHarness(),
    input = {
      requestId: "2".repeat(64),
      projectIds: h.rolloutProjects ?? ["studio"],
      canary: "studio",
    };
  h.fleetDb.lost = "create";
  await assert.rejects(h.fleet.createRollout(h.access, token, input, opts(h)));
  const r = await h.fleet.rollout(h.access, token, input.requestId);
  assert.equal(r.nextProjectId, "studio");
  await h.fleet.stop(
    h.access,
    token,
    r.id,
    { expectedVersion: r.version },
    opts(h),
  );
  await assert.rejects(
    h.fleet.preparePreview(
      h.access,
      token,
      project(h),
      { rolloutId: r.id },
      { sessionRef: h.sessionRef },
    ),
    { code: "rollout_paused" },
  );
});
test("shared project ceiling narrows both adapters and missing update budget refuses", async () => {
  const h = await fleetUpdatesHarness();
  h.workspace.files["job-budgets/studio.json"] = JSON.stringify({
    version: 1,
    projectId: "studio",
    repoId: 102,
    weeklyMinutes: 30,
  });
  const { p } = await reviewed(h);
  assert.equal(p.canApply, false);
  assert.equal(
    (
      await h.jobs.preview(
        h.access,
        token,
        project(h),
        { routineId: h.routineId, retryOf: null },
        { sessionRef: h.sessionRef },
      )
    ).budget.projectWeeklyMinutes,
    30,
  );
  delete h.workspace.files["job-budgets/studio.json"];
  await assert.rejects(reviewed(h), { code: "shared_job_budget_unavailable" });
});
test("Git blob, executable, symlink, tree and commit identities match actual Git", async () => {
  const root = await mkdtemp(join(tmpdir(), "acme-fleet-git-"));
  const git = (args, extra = {}) => {
    const r = run("git", args, { cwd: root, ...extra });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  try {
    git(["init", "-q"]);
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs/acme.md"), "Acme before\n");
    await writeFile(join(root, "remove.txt"), "Acme remove\n");
    await writeFile(join(root, "run.sh"), "echo Acme\n");
    await chmod(join(root, "run.sh"), 0o755);
    await symlink("docs/acme.md", join(root, "alias"));
    git(["add", "."]);
    git(["commit", "-qm", "Acme initial"]);
    const parent = git(["rev-parse", "HEAD"]),
      raw = git(["ls-tree", "-r", "-t", "HEAD"]);
    const entries = new Map(
      raw.split("\n").map((line) => {
        const m = /^(\d+) (blob|tree) ([a-f0-9]{40})\t(.+)$/.exec(line);
        return [m[4], { path: m[4], mode: m[1], type: m[2], sha: m[3] }];
      }),
    );
    const file = (path, content, mode = "100644") => ({
      path,
      before: entries.has(path)
        ? { mode: entries.get(path).mode, blob: entries.get(path).sha }
        : null,
      after:
        content === null
          ? null
          : { mode, content: Buffer.from(content).toString("base64") },
    });
    const files = [
        file("docs/acme.md", "Acme after\n"),
        file("remove.txt", null),
        file("run.sh", "echo Acme changed\n", "100755"),
        file("alias", "run.sh", "120000"),
        file("new/file.txt", "Acme added\n"),
      ],
      at = "2026-10-21T19:00:00.000Z",
      message = "Acme update\n\nExact reference proof",
      objects = publicationObjects(entries, files, parent, message, at);
    for (const f of files) {
      await rm(join(root, f.path), { force: true });
      if (f.after) {
        await mkdir(join(root, f.path, ".."), { recursive: true });
        const value = Buffer.from(f.after.content, "base64");
        if (f.after.mode === "120000")
          await symlink(value.toString(), join(root, f.path));
        else {
          await writeFile(join(root, f.path), value);
          await chmod(
            join(root, f.path),
            f.after.mode === "100755" ? 0o755 : 0o644,
          );
        }
      }
    }
    git(["add", "-A"]);
    assert.equal(objects.at(-1).body.tree, git(["write-tree"]));
    for (const o of objects.filter((o) => o.kind === "blob")) {
      const f = files.find((f) => f.path === o.path);
      assert.equal(
        o.sha,
        git(["hash-object", "--stdin"], {
          input: Buffer.from(f.after.content, "base64"),
        }),
      );
    }
    const commit = git(["commit-tree", git(["write-tree"]), "-p", parent], {
      input: message + "\n",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Plates web",
        GIT_AUTHOR_EMAIL: "plates-web@users.noreply.github.com",
        GIT_COMMITTER_NAME: "Plates web",
        GIT_COMMITTER_EMAIL: "plates-web@users.noreply.github.com",
        GIT_AUTHOR_DATE: at,
        GIT_COMMITTER_DATE: at,
      },
    });
    assert.equal(objects.at(-1).sha, commit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("publication refuses explicit empty tree coverage instead of silently dropping it", () => {
  const entries = new Map([
    ["empty", { type: "tree", mode: "040000", sha: gitTree([]).sha }],
  ]);
  assert.throws(
    () =>
      publicationObjects(
        entries,
        [],
        "a".repeat(40),
        "Acme",
        "2026-10-21T19:00:00.000Z",
      ),
    { code: "unsupported_empty_tree" },
  );
});
test("failed update checks retain base-pass, base-red and inconclusive draft policy", async () => {
  for (const baseExit of [0, 1, null]) {
    const h = await fleetUpdatesHarness(),
      s = await prepared(h, (o) => {
        o.checks.updated.exit = 1;
        o.checks.updated.tail = "Acme changed-tree failure";
        if (baseExit !== null)
          o.checks.base = {
            ...o.checks.updated,
            exit: baseExit,
            tail: "Acme base observation",
          };
      }),
      p = await publication(h, s);
    assert.equal(p.draft, baseExit !== 1);
    assert.match(
      p.body,
      baseExit === 1 ? /main was already red/ : /This update fails/,
    );
    const r = await finish(h, await publish(h, p));
    assert.equal(r.state, "committed");
    assert.equal(r.checks.updated.exit, 1);
  }
});
test("cancelled provider evidence cannot publish even with an immutable artifact", async () => {
  const h = await fleetUpdatesHarness(),
    s = await started(h);
  await h.fleet.output(s.identity, { ...s.input, output: h.output() });
  await h.jobs.complete(s.identity, {
    ...s.input,
    sequence: 1,
    result: { state: "succeeded", exitCode: 0 },
  });
  Object.assign(h.actions.runs.get(s.r.job.provider.runId), {
    status: "completed",
    conclusion: "cancelled",
  });
  await h.fleet.reconcile(h.access, token, s.r.id, opts(h));
  assert.equal(
    (await h.fleet.operation(h.access, token, s.r.id)).capabilities.publish,
    false,
  );
  await assert.rejects(publication(h, s), { code: "preparation_not_verified" });
});
test("malformed external stage grants never cause a provider effect", async () => {
  const h = await fleetUpdatesHarness(),
    s = await prepared(h),
    p = await publication(h, s);
  h.fleetDb.malformed = (op, value) => {
    if (op === "cas" && value.row?.kind === "publication")
      return { ...value, changed: false };
    return value;
  };
  await assert.rejects(publish(h, p), { code: "invalid_fleet_store" });
  assert.equal(h.remote.writes.length, 0);
});
test("base setup result must name the approved setup command", async () => {
  const h = await fleetUpdatesHarness(),
    s = await started(h),
    output = h.output();
  output.checks.baseSetup = {
    ...output.checks.updated,
    command: "invented setup",
  };
  await assert.rejects(h.fleet.output(s.identity, { ...s.input, output }), {
    code: "update_output_binding",
  });
});
test("declared CLI dependency never becomes an observed runtime", async () => {
  const h = await fleetUpdatesHarness();
  h.source.files["package.json"] = JSON.stringify({
    devDependencies: { plates: "github:acme/plates#v1.0.0" },
  });
  const v = await h.fleet.comparison(h.access, token, project(h));
  assert.equal(v.versions.cliDeclaration, "github:acme/plates#v1.0.0");
  assert.equal(v.versions.runtime, null);
});
test("one MiB raw output survives encrypted artifact and exact publication preview bounds", async () => {
  const h = await fleetUpdatesHarness(),
    s = await prepared(h, (o) => {
      o.files = Array.from({ length: 4 }, (_, i) => ({
        path: `docs/acme-large-${i}.md`,
        before: null,
        after: {
          mode: "100644",
          content: Buffer.alloc(262144, 65 + i).toString("base64"),
        },
      }));
    });
  const p = await publication(h, s);
  assert.equal(
    p.files.reduce(
      (n, f) => n + Buffer.from(f.after.content, "base64").length,
      0,
    ),
    1048576,
  );
  const record = await h.fleet.artifact(
    h.access,
    token,
    project(h),
    p.artifactId,
  );
  assert.equal(record.digest, p.artifactDigest);
});
test("source ownership gaps and existing CLI update branches remain visible refusals", async () => {
  const h = await fleetUpdatesHarness();
  h.source.files["docs/acme.md"] = "Acme owner custom text\n";
  const v = await h.fleet.comparison(h.access, token, project(h));
  assert.equal(v.ownership.state, "changed");
  h.source.files["docs/acme.md"] = "Acme before\n";
  const s = await prepared(h);
  h.remote.refs.set("keel/update-v1.0.0", {
    ref: "refs/heads/keel/update-v1.0.0",
    object: { type: "commit", sha: "a".repeat(40) },
  });
  await assert.rejects(publication(h, s), { code: "existing_cli_update" });
  assert.equal(h.remote.writes.length, 0);
});
test("selected rollout pauses after a failed canary and advances only after green verified PR", async () => {
  for (const passed of [false, true]) {
    const h = await fleetUpdatesHarness(),
      other = { id: "other", repoId: 104, repo: "acme/other" };
    h.config.projectRepoIds.other = 104;
    h.access.projects.push(other);
    const original = h.refreshAccess;
    h.refreshAccess = async () => {
      const a = await original();
      a.projects.push(other);
      return a;
    };
    h.rolloutProjects = ["studio", "other"];
    const s = await prepared(h, (o) => {
      if (!passed) o.checks.updated.exit = 1;
    });
    assert.equal(
      (await h.fleet.rollout(h.access, token, s.roll.id)).nextProjectId,
      null,
    );
    const p = await publication(h, s);
    await finish(h, await publish(h, p));
    assert.equal(
      (await h.fleet.rollout(h.access, token, s.roll.id)).nextProjectId,
      passed ? "other" : null,
    );
  }
});
test("null mutation replies cannot claim an artifact was durably saved", async () => {
  const h = await fleetUpdatesHarness(),
    s = await started(h);
  h.fleetDb.malformed = (op, value) => (op === "output" ? null : value);
  await assert.rejects(
    h.fleet.output(s.identity, { ...s.input, output: h.output() }),
    { code: "invalid_fleet_store" },
  );
});
test("ejected project-owned targets remain visible in version comparison", async () => {
  const h = await fleetUpdatesHarness();
  const cfg = JSON.parse(h.source.files[".plates/plates.json"]);
  cfg.ejected = ["docs/custom.md"];
  h.source.files[".plates/plates.json"] = JSON.stringify(cfg);
  const v = await h.fleet.comparison(h.access, token, project(h));
  assert.deepEqual(v.ownership.ejected, ["docs/custom.md"]);
  assert.ok(
    v.ownership.files.some(
      (f) => f.path === "docs/custom.md" && f.state === "ejected",
    ),
  );
});

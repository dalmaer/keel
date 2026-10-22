# Compare versions and carry an update through the fleet

Open **Versions & updates** from Home or a project. The comparison separates the
practice declared in project configuration, the managed lock version, a CLI
dependency declaration and an observed runtime. Missing runtime evidence remains
unavailable. The application package, serving revision and Node process are
separate observations; a deployment revision declaration is not production proof.
Equal practice versions can still have unrecorded migrations. Their applicability
requires preparation, not a version-number guess.

## Start with one canary

Select one to three authorized projects, then explicitly choose a canary from
that selection. Saving the selection creates a private, bookmarkable rollout;
it starts no worker. The same receipt is available after reload or on another
device. If the response is lost, inspect that original URL instead of creating
another selection.

Review the canary's preparation: exact base revision and approved target, setup
and check commands, environment **key names**, container image and platform,
network policy and maximum runtime. This first approval reserves up to sixty
minutes for the entire preparation job. It does not authorize a PR. Both the
shared project ceiling and workspace ceiling apply; there is no default allowance.

Project commands run in disposable containers. The initial fixed configuration
uses a nonroot user, read-only root filesystem, dropped capabilities, no new
privileges, two CPUs, 2 GiB memory, 512 PIDs and bounded temporary storage.
Control credentials, publication tokens, host home and the Docker socket never
enter the container. Network defaults to none; bridge network is an explicit
policy choice, not an automatic repair for failed dependency installation.
Unsupported toolchains or missing history stay visible. There is no host fallback.

The worker preserves setup ordering, runs the shared CLI transformation and
freezes an exact patch before checks. Setup/check mutations to tracked bytes are
refused. Updated-tree and pristine-base checks are separate observations, including
any failed pristine-base setup. A passing worker process alone does not authorize
publication: the server requires verified output and terminal provider evidence.

## Review publication separately

The second preview shows the exact destination and audience, file bytes, modes,
deletions, migration notes, check results, branch, PR title and complete body.
Public destinations require a separate acknowledgment of those exact bytes.
Existing fleet policy distinguishes an already-failing base, an update failure
and an inconclusive comparison. A draft PR is not a successful update.

After approval, the foreground browser may advance known publication stages one
request at a time. **Pause publication progress** stops after the current request.
A bounded browser session can pause before all stages finish; use **Continue
publication** on the original receipt without creating a replacement approval.
Loss or uncertainty stops progression. **Check original operation** reads back
the original effect; it cannot blindly repeat an uncertain PR submission.

Each project has its own preparation and publication receipt. Return to the saved
rollout after the canary has a verified PR and a green updated-tree check, then
explicitly review the next project. Failures and uncertainty pause remaining work.
**Stop remaining work** does not cancel a dispatched worker; request cancellation
on that preparation's receipt and wait for provider terminal evidence.

PR created, merged, current installation observed and independently verified are
separate facts. Reopen the project's version comparison to read its current
default branch. This does not merge, rebase, roll back or clean up branches.

## Prepare policy without activating it

Application code remains public. Target policy, registrations, shared ceilings
and lesson trace references belong in the private workspace; encrypted rollout,
worker-output and publication receipts belong in the external operation store.
The target is an explicitly pinned public Keel build. The browser cannot supply
a code URL or executable revision. A named release additionally needs verified
tag identity and relevant source content.

The optional service configuration below keeps both effects disabled. Every
identity is synthetic and must be replaced by verified source facts before review:

```json
{
  "fleetUpdates": {
    "enabled": false,
    "publishEnabled": false,
    "target": {
      "repoId": 103,
      "repositoryNodeId": "R_acme_103",
      "repo": "acme/keel",
      "commit": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "cliVersion": "1.0.0",
      "practiceVersion": "1.0.0",
      "bundleDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
}
```

The bundle digest is SHA-256 of the lowercase Git tree OID's UTF-8 bytes for that
exact trusted commit. Keep the existing jobs gate disabled until migration 010,
restore reconciliation and selected real worker isolation/termination are proven.
Preparation also requires the phase104 jobs gate and approved Actions access.
Publication separately requires the private workspace write gate, current Contents,
Workflows and Pull Requests write permissions, plus the publication gate.

Each selected project has `update-workers/<project-id>.json`, separate from its
existing typecheck registration. It pins the `update-preparation-v1` adapter,
sixty-minute deadline, exact workflow/bridge/runtime and operator-reviewed
container image digest/platform/network. Generate the reviewed workflow with
`canonicalUpdateWorkflow` in `lib/web/update-workflow.mjs` for the exact target;
its two checkouts separate project source from the trusted worker. This workflow
has no schedule. The bridge is `scripts/web-update-worker.mjs`; its runtime is
`lib/web/update-worker.mjs`, both pinned in the target build. See the
[implementation contract](../specs/web-fleet-updates.md) for the isolated worker
boundary and [worker setup](web-workers.md) for identity/blob lookup commands.

A shared private `job-budgets/studio.json` makes the project ceiling explicit:

```json
{"version":1,"projectId":"studio","repoId":102,"weeklyMinutes":120}
```

The update registration's allowance may narrow this ceiling. Adding another
adapter does not add another budget or lane. Existing typecheck-only configuration
remains supported; a new shared record cannot silently enlarge its allowance.
The callback repository variable remains the approved HTTPS `KEEL_WEB_ORIGIN`.
No policy example grants access, starts a runner or creates a resource.

## Trace a lesson without inventing its history

Open **Trace source, release and observed adoption** from a lesson card. The trace
reads an optional private `lesson-traces/<lesson-id>.json`. It contains references,
not decisions. Only currently authorized project repositories and the pinned
private workspace can supply evidence; unavailable permission is never a public
fallback. References do not enter an export automatically.

The exact version-1 manifest has these fields:

- `source`: the existing lesson source identity, including numeric repository ID,
  repository name, path, revision, blob, row and fingerprint. `id` is its phase100
  lesson identity from the catalogue.
- `decision`: null, a proposal `{ "kind": "proposal", "source": ... }`, or an issue
  `{ "kind": "issue", "repoId": 102, "repo": "acme/studio", "number": 7 }`.
- `catalogue`: null or a canonical lesson row reference using the source shape.
- `guards` and `proofs`: arrays of exact file references containing numeric
  repository ID, repository name, path, revision and blob.
- `migrations`: entries with a migration `id` and exact file `source` reference.
- `release`: null or numeric repository ID, repository name, named tag and commit.
- `adoptions`: at most three selected project IDs, their catalogue path, explicit
  source/project guard-path mappings and migration IDs.

The manifest is bounded to 16 KiB and five entries per guard/migration/proof group.
An owner-authored reference relationship is not authenticated decision-to-catalogue
provenance. Canonical proposal/issue state wins; issue closure alone is not
acceptance. Imported copy attribution is not an acceptance or release receipt.

A referenced guard file establishes presence. A proof file establishes a reference,
not a passed test. A migration stub is not implemented protection. Release proof
checks the exact tag and relevant contents; it never claims the first release
without complete history. Current adoption reads the project's default branch.
Exact copied guard bytes and their lock can be observed; rendered templates,
blocks and selected-guide transformations need separate supported rendering proof.
Different rendered bytes are unavailable proof, not automatically a broken guard.
Ejection and actual lock drift remain visible. Recorded migration IDs are source
claims; executed protection and project acceptance remain independently unverified.

The existing [private learning copy and export](web-workspace-setup.md) stay separate.
Export is the exact owner-reviewed text download. This feature does not file a public
issue, accept a lesson, cut a release or publish private trace references.

## What still needs real evidence

This guide describes implemented source behavior. Synthetic routes, receipts and
screenshots do not prove hosted activation or container isolation. Keel's own
`keel: self` repository is update-ineligible. A real rollout requires an approved
adopted project, explicit target/container/network/budget policy, permissions,
independent operation-store migration proof and a verified deployment. Those are
separate owner decisions; no real update PR is authorized by this implementation.

## Complete synthetic trace reference

This structurally valid Acme example illustrates every field. Its identities and
bytes describe a test fixture, not a real release; replace all references with
observed canonical values. Keep this file only in the private workspace.

```json
{
  "version": 1,
  "id": "lesson-697bd5771f14ffd241eafed3afc0c99ac2c81beb",
  "source": {
    "repoId": 102,
    "repo": "acme/studio",
    "path": "docs/lessons.md",
    "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "blob": "1c57824e75d5f10f9c837126e49958f4f10eec03",
    "row": 1,
    "fingerprint": "acme/studio/lesson/1/aa997cba"
  },
  "decision": {
    "kind": "proposal",
    "source": {
      "repoId": 102,
      "repo": "acme/studio",
      "path": "docs/inbox/acme.md",
      "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "blob": "155bc2affe17916cd12c774d8b4fb7981922efd1"
    }
  },
  "catalogue": {
    "repoId": 102,
    "repo": "acme/studio",
    "path": "docs/lessons.md",
    "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "blob": "1c57824e75d5f10f9c837126e49958f4f10eec03",
    "row": 1,
    "fingerprint": "acme/studio/lesson/1/aa997cba"
  },
  "guards": [
    {
      "repoId": 102,
      "repo": "acme/studio",
      "path": "scripts/acme-bound.mjs",
      "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "blob": "9e9d501f01c7196b0be1915d3111d08986074a3d"
    }
  ],
  "migrations": [
    {
      "id": "0001-acme-bound",
      "source": {
        "repoId": 102,
        "repo": "acme/studio",
        "path": "migrations/0001-acme-bound.mjs",
        "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "blob": "afd244afa6f01f9a5cfa09b20d00dc1c74f6bee2"
      }
    }
  ],
  "proofs": [
    {
      "repoId": 102,
      "repo": "acme/studio",
      "path": "docs/proof.md",
      "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "blob": "5cd965a873ad252c84ad5faa50d2df2d6777c688"
    }
  ],
  "release": {
    "repoId": 102,
    "repo": "acme/studio",
    "tag": "v1.0.0",
    "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "adoptions": [
    {
      "projectId": "studio",
      "cataloguePath": "docs/keel-lessons.md",
      "guardPaths": [
        {
          "sourcePath": "scripts/acme-bound.mjs",
          "projectPath": "scripts/acme-bound.mjs"
        }
      ],
      "migrationIds": [
        "0001-acme-bound"
      ]
    }
  ]
}
```

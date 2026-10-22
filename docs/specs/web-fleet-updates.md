# Fleet updates and lesson propagation

Phase [105](../phases/105-fleet-updates-and-lessons-travel-through-the-web.md)
implements the versions, updates and learning section of the
[fleet operating contract](web-fleet-operations.md). This contract selects the
implementation; it does not grant GitHub permissions, activate workers or approve
runtime spending. The [worker contract](web-workers.md) continues to own identity,
leases, cancellation and conservative budget accounting.

## Versions are separate observations

Show the project's declared practice, lock version and managed-file state from a
fresh immutable source snapshot. Include recorded and pending migrations: equal
version strings do not establish that no migration applies. A dependency declaration
is not an observed installed CLI/runtime. The web application's serving revision,
CLI package version and Node runtime are separate facts. Unknown values remain
unavailable, with their source and observation time.

The first update target is one explicitly configured trusted Keel build: numeric
source repository identity, immutable commit, CLI and practice versions, and the
migration/template/runtime identities. The browser cannot supply a code URL or
choose an arbitrary executable revision. A build is called a release only when a
named tag resolves to its recorded release source; release notes alone are not
proof. Target configuration is private owner policy and changes invalidate review.
Keel itself (`keel: self`) remains update-ineligible.

## Prepare first, then approve publication

There are two consequential actions, with separate previews:

1. **Prepare an update.** Review the project and immutable base, target, configured
   setup/check commands, environment key names, container image/network policy,
   and maximum reserved minutes. This authorizes bounded computation only.
2. **Create the update PR.** Review the returned exact patch, file modes/deletions,
   migration notes, check results, audience, branch and complete PR text. This
   authorizes publication of those bytes only.

Use a dedicated `update-preparation-v1` adapter. It is not the phase104 typecheck
adapter. One preparation job includes provider setup, project setup, transformation,
updated-tree check and, when needed, a pristine-base comparison. Its fixed total
ceiling is sixty minutes; there is no default allowance or schedule. Missing
results remain unknown. Preserve fleet's distinction between a failed update,
an already-failing base and an inconclusive base check; use its existing PR wording
and draft policy rather than describing all failures as successful updates.

Extract the transformation stage shared with the CLI: compatibility, ordered
migration collection, file ownership/refusal, selected guides and safe aliases,
rendering, config/lock changes and roadmap generation. Keep the CLI on that same
implementation, including its current failure restoration and check behavior.
Seeded/project-owned files change only through the existing migration semantics.
Preserve modes, deletions, ejections and safe in-repository symlinks. An incomplete
source read or unsupported filesystem shape is a refusal, never a clean comparison.

Fleet setup runs before transformation. Preserve that ordering. Setup-generated
inputs may affect migrations; a tracked-files-only approximation cannot silently
skip them. Check original tracked bytes, modes and symlink targets after setup,
as the existing updater requires a clean source. Keep transformation inside an
isolated trusted preparation environment or validate every input path against
escape before a trusted host reader touches it. No project command runs in a
Vercel handler or in the trusted worker's host process.

## Worker isolation and output

Project setup/checks run in disposable Linux containers under an operator-pinned
Node image digest and platform. Use a nonroot user, read-only image filesystem,
dropped capabilities, no-new-privileges, bounded writable storage, memory, CPU,
PIDs and the whole-job deadline. No Docker socket, host home, workspace secrets,
publication tokens or OIDC control credentials enter the container. An environment
filter alone is not this isolation boundary. A disposable credential-free Git
history copy may support history-dependent checks; never mount the worker's
trusted Git metadata. Unsupported toolchains or missing history are explicit gaps.

Network is an explicit policy field. It defaults to none; dependency setup needing
outbound network requires that policy to be reviewed and approved. Do not enable
host networking or silently widen egress when installation fails. The initial
adapter supports only its documented fixed container configuration.

Retain the exact container identity outside it. On cancellation, lost authority
or timeout, bounded stop/remove and independent terminal readback are required.
Killing the Docker client is not proof that its container stopped. Cleanup
uncertainty remains in the receipt, and no host-execution fallback is allowed.
Provider terminal evidence still governs the shared job lane.

Capture the working snapshot while bounded temporary storage still exists.
Freeze and verify the container's processes before copying it, then independently
confirm termination and removal before the trusted planner consumes the copy.
Stopping a container first destroys tmpfs contents; copying while project
processes can still write does not establish a stable snapshot.

Retain the immutable prepared patch before project checks. Check all original
tracked paths after execution, not only changed paths. A command that mutates
those bytes cannot supply a passing result for the reviewed tree. Generated build
outputs are never silently added to the publication patch. Run a needed base
comparison in a fresh copy, without dependencies altered by the candidate check.

Authenticate output with the exact initiating authorization, OIDC run/attempt,
source, job and fence. The server never accepts a browser-supplied patch. Store the
immutable artifact encrypted, bound to job/base/target and its digest. Initial
limits are 200 changed paths, 256 KiB per changed file and 1 MiB total patch bytes;
encoded transport/storage bounds must account for base64 and encryption overhead.
Larger or unsupported results are unavailable, not truncated successful previews.
An artifact write and a job's terminal result are separate facts; publication
requires verified output and terminal provider/check evidence.

## Shared budget and durable publication

Update and typecheck jobs use the same phase104 workspace scope, project lane,
rolling charges and reservations. A new registry under
`update-workers/<project-id>.json` does not replace the existing typecheck registry.
There must be one explicit effective project ceiling across adapters. Adapter
caps may narrow it; a second registration must never create another allowance.
The update adapter requires a shared project budget record; legacy typecheck-only
configuration remains supported, and its cap cannot be enlarged implicitly.
Migration010 extends claim deadlines to the admitted ceiling while preserving
exactly fifteen minutes for the existing typecheck adapter.

An optional service-only migration010 holds bounded rollout records, immutable
worker artifacts and publication stages. It adds no browser table access or new
paid service. Validate every RPC transition and external row, including missing
and null fields. Hosted proof requires independent database connections.

The authenticated server owns publication; workers get no repository-write token.
Keep separate durable stages for Git objects, the operation branch and the PR.
Persist each external dispatch before its POST. An uncertain response recovers
that exact effect by immutable object/ref/PR readback; no blind repeat or newest-
matching-PR shortcut. Preserve a stage's outcome across browser disconnects and
server restarts. Bound scans and report incomplete recovery explicitly.

Publication advances at most one new external effect per request, within the
handler's deadline. An explicit **Continue publication** action advances only
undispatched stages of the same immutable approval. Recovery inspects uncertain
stages without issuing another POST. A lost response retains the operation link;
it never starts a replacement publication.
While the browser remains connected, the initial approval may drive sequential
requests for known undispatched stages, with visible progress and a stop control.
It does not require one tap per Git object. A lost response or uncertain stage
halts this progression; reopening the receipt requires explicit continuation
after any necessary readback.

The branch is deterministic for the operation and is never force-pushed. Preserve
existing CLI update branches and PRs as verified existing work or visible conflicts.
Recovery checks numeric repository identity, exact ref/object, reviewed parent and
patch, head/base and operation marker, including closed PRs. GitHub's prefix ref
listing is not an exact match. The PR endpoint supplies no documented idempotency
key; a missing result after an uncertain POST is not permission for a new POST.

Freshly reauthorize and revalidate source/target before each new effect. GitHub
cannot provide a transaction spanning an unrelated default-branch check and PR
creation: preserve the reviewed parent/patch, report subsequent source movement,
and never claim cross-reference atomicity. Merging, rebasing, rollback and branch
cleanup remain separate owner operations.

## Bounded rollout and responsive journeys

Offer fleet and project Versions & updates views, with labeled cards on mobile and
a comparison table on desktop. Nothing is selected by default. The initial batch
contains at most three projects and an explicit canary. Prepare and publish that
project first; after a verified PR receipt and green check, the owner explicitly
continues each remaining project. Failures and uncertainty pause undispatched
work. Stopping remaining work does not cancel a dispatched worker.

Persist the selected set, canary and per-project operation links. Refreshing or
opening another device recovers the same rollout. GET requests inspect only;
reconcile and continue are explicit fresh-authorized actions. Preserve one active
control group per receipt and show every project's state, not one aggregate toast.
PR created, merged, installation observed and independently verified are separate.
Source refresh must actually read the default branch to establish installation.

## Lessons retain their authority

Reuse phase100 learning identities and exact private copy/export behavior. Add a
read-only trace with independent incoming, decision, guard, release and adoption
nodes. Each is evidenced, unavailable or inconsistent, with immutable source
references and observation time. Do not join by similar wording, issue closure,
version ordering or an imported private copy.

Existing prose does not supply every edge. An optional owner-authored private
`lesson-traces/<lesson-id>.json` supplies references, not decisions: the source
lesson identity; canonical proposal or issue decision; catalogue row; named guard
paths, migration IDs and proof references; named release tags/commits. Validate
its exact schema and all linked canonical facts. Only currently authorized source
repositories may be read. Missing permissions, unsupported historical sources or
contradictory references remain gaps; the manifest cannot override a decision.
No automatic trace mapping or private-to-public provenance export is permitted.

A referenced guard file establishes presence, not working protection. A named
proof is not a passed check. Verify tag identity and relevant release contents;
do not claim the first release without complete history. Observed lesson text in
a generated project catalogue is distinct from installed guard bytes/migrations,
executed protection and project acceptance. Ejected/customized files remain visible.

The existing reviewed text download is still a download. This phase does not
implicitly file a public issue, accept a lesson, publish private source details or
cut a release. Existing `learn` decisions and source records remain authoritative.

## Proof and activation

Named checks remain `tests/web-fleet-updates.test.mjs` and
`tests/web-lesson-rollout.test.mjs`, supplemented by planner/CLI parity, real worker
subprocess/container and SQL transition tests. Prove aliases/ejections/custom files,
equal-version migrations, setup ordering, modified check trees, stale authorization,
budget/lane contention, lost artifact/ref/PR responses, exact recovery and paused
canaries. Independently walk actual authenticated routes on desktop/mobile, retain
screenshots and inspect every remaining external gap.

A fixture Docker executable cannot establish container isolation or termination.
A local container walk can establish those properties only for the observed image,
platform and daemon. The real workflow exercise still needs a selected adopted
project, approved App permissions, image/network policy and runtime allowance,
hosted migration proof and deployment. The currently connected Keel self-project
cannot establish an adopted-project rollout. No real update PR is authorized by
this implementation contract.

## Dated design references

Read 2026-10-22 UTC (2026-10-21 local):

- [GitHub pull requests](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28)
- [GitHub references](https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28)
- [Docker container execution](https://docs.docker.com/engine/containers/run/)
- [Docker container termination](https://docs.docker.com/reference/cli/docker/container/kill/)
- [Docker temporary storage](https://docs.docker.com/engine/storage/tmpfs/)
- [Docker process freezing](https://docs.docker.com/reference/cli/docker/container/pause/)

The additional fencing, isolation policy, publication recovery and source-evidence
requirements are Keel's design, not guarantees supplied by these APIs.

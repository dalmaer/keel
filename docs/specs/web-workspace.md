# Private workspace, public Keel application

Implementation contract, 21 October 2026. The owner authorized the web UI and
phased build in this conversation. Public application code, private shared
workspace data and project-owned Keel records are the accepted direction.
The owner selected Vercel and an existing Pro team on 21 October 2026. The
project and assigned domain are verified. Supabase Free/iad1 is approved and
connected to production. The approved read-only GitHub App is installed; phase 95
verifies deployed owner login, logout and access removal on Node v24.21.0. Phase 94
still owes the independent backup destination. This document
supersedes the local-first delivery recommendation in [the UX spec](web-ui.md),
not the existing local board. Phase 96 implements the read-only Home; decision
writes, guided observations, media and full operating journeys remain phased work.

The full operating goal additionally covers routine history/execution, fleet
updates and lessons, scoped provider setup and capacity-aware routing on mobile
and desktop. [Fleet operations](web-fleet-operations.md) extends this contract
with phases 102–108; phase 101 verifies the first workspace, not the entire goal.

## What the owner gets

Sign in, open Home and understand each project's situation. Home leads with
**decisions that need you**, **ready-to-test guided walks**, and **recent additions
with real screenshots and try links**. Project summaries explain goals, current
work, what changed, human responsibility, delivery and source freshness.

The [UX spec](web-ui.md) defines interactions and the
[CLI inventory](web-ui-command-map.md) assigns each command/argument to an
appropriate read, form, explicit operation or advanced CLI escape hatch.
The [prototype](../design-previews/keel-home.html) uses synthetic examples.
It proves no live integration or acceptance.

## Ownership and deployment

```text
Browser -- HTTPS + session --> Keel web service (public source, private instance)
                                  |-- GitHub identity + selected repositories
                                  |-- private workspace records via GitHub API
                                  |-- external transactional store / private artifact adapter
                                  `-- bounded source adapters per project
```

| Home | Owns | Never owns |
| --- | --- | --- |
| Public `keel` repository | App/CLI code, schemas, synthetic fixtures, docs and reusable practices | Personal fleet registry, tokens, private lessons, raw feedback or screenshots |
| Private workspace repository | Workspace manifest, shared private lessons, approved cross-project decisions, policies | Another copy of project phase acceptance; credentials and sessions |
| Each project repository | Its `.keel` configuration, selected planning records, decisions, evidence and lesson provenance | Workspace membership or another project's data |
| External private runtime store | Sessions, caches, drafts, receipts, feedback and private artifacts | Authoritative phase status or architecture |
| Deployment secret store | OAuth client secret, database/session secrets; provider keys only when required | Versioned files or frontend configuration |

One workspace per deployed instance initially. No public signup, tenant picker,
org billing or arbitrary code execution. The workspace manifest explicitly names
selected projects; login grants access only to the intersection of workspace
membership, GitHub App installation and the signed-in user's current repository
access. Private workspace membership is also checked. Numeric provider identity
is authoritative for users/repos; names are display/routing labels refreshed from
GitHub. Removed membership or revoked credentials invalidate access. A workspace
owner does not automatically gain access to every private project.

The public app can be cloned/deployed without copying anyone's data. The local
adapter requires an explicit manifest and runtime directory; the Vercel adapter
requires explicit workspace repository and storage bindings; no fallback to
code-root `.keel`,
`fleet.json`, a developer's home directory or a public repository. Existing CLI
fleet configuration remains supported. Migration is a separate, previewed phase;
never delete it until the replacement has been read back successfully.

## Phase 93: explicit external workspace boundary

This is the local development/export adapter. Its filesystem proof does not
establish hosted storage on Vercel; hosted requests must never use `/tmp` or
process memory as durable state.

Add `keel workspace inspect|init --manifest <absolute-file> --state <absolute-dir>
[--yes] [--json]`. `inspect` reads only; `init` previews (exit 3) until `--yes`.
`--yes` is valid only for init. Both require explicit absolute paths and strict
arguments. No GitHub calls, repository creation, credentials or server in this
slice. `inspect` returns ready/uninitialized and privacy **unverified**; a local
manifest cannot establish that a remote repository is private.

Version 1 manifest, UTF-8 JSON, at most 1 MiB and 100 projects:

```json
{
  "version": 1,
  "id": "acme",
  "name": "Acme",
  "repo": "acme/keel-private",
  "projects": [{ "id": "studio", "repo": "acme/studio" }]
}
```

Reject unknown keys at each level, invalid/duplicate project IDs or repository
identities (case-insensitive repository comparison), and missing/empty required
values. Workspace/project IDs use lowercase ASCII letters, numbers and hyphens,
start with a letter, and are at most 64 characters. Names are nonempty trimmed
strings at most 120 characters without control characters. Repository identities
are exactly two GitHub-compatible path components, no URL, traversal, query,
credentials or `.git` suffix; project repo cannot equal workspace repo. Never
include rejected values in diagnostics; malformed secret-shaped input must not
appear in JSON/stderr. Empty project list is valid for initial setup.

Canonicalize existing paths including macOS temp-directory aliases. Manifest must
be a regular file outside the installed application tree (CLI_ROOT). Runtime
state must be outside every Git working tree, outside the application and
manifest directory, and cannot contain either of them. Resolve symlinks before
checking overlap; reject symlink files/entries for the marker and state leaf.
Reads reject nonregular files before opening and validate the descriptor after
opening nonblocking; a FIFO must not suspend inspection. The state parent must
already exist; no recursive creation of arbitrary parents.
Reject filesystem root, existing non-directory or unowned nonempty state.

`init --yes` creates a private directory (0700) and an exclusive 0600 JSON marker
`workspace.json` containing only `{version:1,id,repo}`. An already matching marker
is an idempotent success; malformed or differently owned state is refused without
changes. Recheck identity at the mutation boundary; exclusive creation prevents
a competing initializer from replacing ownership. Readers reject unsafe marker
permissions on POSIX. Existing state directories must also be private; never
silently chmod someone else's data. Return structured operation, canonical paths,
workspace identity, project list, state and unverified remote privacy; no tokens.

This is local configuration/initialization safety, not a sandbox against a
malicious process with the same operating-system identity. Later writers must
reuse this resolver; an initial marker alone cannot secure an arbitrary writer.
The runtime schema will be versioned with explicit migrations; no broad generic
JSON write endpoint is introduced.

## Login and access

Phase 94 connects the first private instance on Vercel: selected account/team,
HTTPS origin, external durable storage, secret injection and backup destination;
approve a private workspace repository and a GitHub App with selected repository
access. The [setup recipe](../guide/web-workspace-setup.md) names prices and
remaining resource decisions. No subscription, paid upgrade or domain is assumed.
Phase 94 selects Node 24.x. Phase 95 originally verified deployed
`process.version` >=24.21.0; current builds require >=24.22.1 following the
repository runtime update. A historical deployment observation does not establish
that newer minimum. Vercel selects a major version and rolls patch releases automatically.
[Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Phase 95 implements login with a GitHub App user authorization flow and opaque
server-side sessions. Validate state, single-use expiring authorization attempts,
callback origin and return-path allowlist. Use PKCE where the provider supports
it. Fetch provider identity after token exchange; never trust a login in a query.
Session cookies are Secure, HttpOnly, SameSite=Lax, host-only with bounded idle
and absolute expiry. Rotate on login and privilege changes; logout removes
server state. Tokens stay server-side. Use CSRF tokens plus same-origin checks
for state-changing routes. Authorization is checked per request, repository,
operation and artifact, including background refresh and streamed updates.

A user's GitHub App token only permits the intersection of app and user access;
installation credentials are separately scoped and short-lived. Do not let a
service token turn an inaccessible project into a visible card. Start with
metadata/contents read, then add narrowly required write permissions when the
operation ships. No Actions, administration or workflow-write permission for
Home. The exact permission matrix is part of the setup receipt.

References checked 21 October 2026: [GitHub user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
and [installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).

## Dynamic Home and bounded readers

Home is a source-derived attention view, not a freely editable Kanban board.
Use adapters for local phases, projects-shaped plans and GitHub milestones.
Derive one project summary and stable action/change IDs from repository identity,
record path/key and revision. Keep implemented, merged, serving, verified and
lived-in separate. Every section carries its own freshness/coverage state.
Timeout, denied access, rate limit and partial pagination never become zero work.

Refresh project summaries independently with bounded concurrency, backoff,
conditional provider requests and cancellation. Coalesce webhook hints rather
than treating event payloads as authoritative state. Validate webhook signatures
on raw bytes before parsing, reject replayed delivery IDs, then refresh the
relevant source. [GitHub webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Authenticated bounded polling with conditional requests and cursors updates
affected cards initially. A cursor gap requests a fresh bounded snapshot. Pause
polling in hidden tabs and back off on errors. Persist webhook delivery receipts
and refresh hints before acknowledging; consume bounded work in later requests,
never rely on a function continuing after its response. A long-lived event stream
is a later transport choice, not a prerequisite for dynamic Home. Freeze a card's
interaction snapshot while a decision/walk is open;
show “Source changed” and require a fresh preview before applying. Queue new
arrivals behind “N new updates”, preserve focus and scroll, and respect reduced
motion. Personal pins/snoozes/seen markers never alter project records.

## Decisions, walks and changes

Decision detail includes the actual question, evidence, alternatives,
recommendation, consequence and authority. Reuse phase 90 decision context and
phase 91 shaping. A recommendation is never a recorded owner choice. Preview
exact source changes; apply against the reviewed digest under a durable
per-project lease with fencing,
retain an operation ID and receipt, and show GitHub commit/PR outcome separately
from local persistence. Public-repo writes show the exact outbound material.

### Phase 97: explicit decision writers and conditional delivery

Settled 21 October 2026 after reviewing the existing CLI writers. The initial
web writers are (1) the legacy health-page proposal decision, using the same pure
transformation as `walk decide`, and (2) one previously unanswered question in an
explicitly selected, validated shaping record. A shaping answer increments its
record revision and preserves recommendations, proposed decisions and previous
answers. It does not accept architecture proposals or generate a plan. Structured
time/hygiene proposals retain their existing policy-bound writers and remain
inspect-only here, as do unsupported architecture and workflow decisions.

Use the canonical phase-90 resolver with a bounded immutable-source reader,
retaining its reference, supersession and coverage rules. Local filesystem/CLI
behavior must remain unchanged; the hosted adapter reads one pinned GitHub tree
without running repository code. Required context gaps disable submission.
Shaping selection is an explicit repository-relative path, not an invented
filename convention. Authenticated actor attribution and source-declared manual
answers remain distinguishable.

A persisted preview binds actor, project/repository identity, source path/question,
branch HEAD, original blob, context digest, exact resulting bytes, consequence,
visibility and expiry. Editing a choice or reason requires a new preview. Show
the complete outbound file and commit message for a public target before applying;
no preselected answer or implicit publish. Private database previews are encrypted.

Use GitHub's `createCommitOnBranch` with `expectedHeadOid` for atomic conditional
commit/branch advancement. A file-only SHA check would miss context changes in
other files; a non-forced ref update alone is not an exact HEAD comparison.
[GitHub commit mutation contract](https://docs.github.com/en/graphql/reference/commits).
Bind the numeric repository identity and GitHub repository/branch node identities
into the preview and intent. Dispatch through `CommittableBranch.id`, never a
repository name which can be renamed and reused between validation and mutation.
Recovery must query the same repository identity and verify its exact parent,
message, changed target and output blob; a clone under a recycled name is not
evidence for the original operation. Ref deletion or unavailable identity keeps
the outcome unresolved. This was settled on 21 October 2026 after an independent
review reproduced old-name recovery accepting cloned history.
[GitHub branch identity contract](https://docs.github.com/en/graphql/reference/git#committablebranch).
Only Contents write is requested for these writers; no Issues, Pull Requests,
Actions, administration or workflow write. Verify actual App/user permission at
dispatch. Protected-branch rejection is a refusal, never permission to silently
create a PR or switch destinations.

Durably reserve an actor/project/preview operation and a fenced project lease
before dispatch. Persist the exact mutation inputs and unique operation marker.
Recheck current authorization, visibility, source and context before the sole
remote write. Dispatched or uncertain operations keep the project reserved after
lease expiry; recovery inspects bounded commit history and verifies parent,
marker and content. An unchanged branch alone is not proof that an in-flight
request failed. Do not automatically resubmit uncertain writes. The receipt
separates preview persistence, source commit and human acceptance; no issue or PR
is created by either writer. The operation tests must prove those zero effects
and recovery of the original source commit.

Deploy detail/preview with submission disabled by default. Enabling submission
requires the owner's approval of broader GitHub App Contents access, and the
real-decision walk needs a particular choice supplied by the owner. Neither is
implied by the earlier read-only App setup approval.

The [phase-98 implementation contract](web-guided-walks.md) settles authored
records, private CAS drafts and shared acceptance/recovery.

Walks have stable authored step IDs, prerequisites, expected results, exact tested
revision/environment and optional captures. Each step records pass/fail/blocked
plus actual observations. Drafts persist privately across browser refresh.
Failure or inability to test records feedback and leaves acceptance open.
Reuse phase 92 immutable result feedback and issue recovery; do not invent a
parallel feedback store or issue workflow. Only complete successful observations,
current source, satisfied prerequisites and explicit final submission may invoke
the existing acceptance operation. No optimistic “done” before the source receipt.
Reordered steps or a changed build invalidate only what can be proven stale;
preserve previous observations as historical evidence.

Change packages bind title, capability, source records, implementation revision,
serving observation, screenshots and try/walk links. Media records capture
revision, environment, viewport, scenario, timestamp, checksum, caption and alt
text. A screenshot does not prove acceptance. Browser captures use synthetic or
approved data; no generated picture stands in for product evidence. Uploads
have size/type limits, opaque IDs and authenticated delivery; no arbitrary URL
fetch/HTML upload or executable inline SVG. Retention and deletion preserve
receipts while making expired media explicit. Public export requires an exact
preview and deliberate publish; private workspace visibility is never inherited
from the public application's repository.

## Implementation and operations

Stay within zero runtime dependencies/no build: native Node request handlers,
standalone browser modules, CSS and existing domain readers. Vercel supports
framework-free JavaScript functions; no Next.js or provider SDK is implicitly
approved. Use documented HTTP storage APIs with native fetch, or settle an
explicit dependency exception before selecting an SDK-only adapter.
[Node runtime](https://vercel.com/docs/functions/runtimes/node-js). Shared board
classification stays in domain functions; the hosted server has its own request
identity boundary. It is not the loopback board exposed on a public interface.
No repository-provided scripts execute in the web request process. Operations
that require a real checkout/runner remain unavailable with a clear reason until
an isolated runner and its approved budget exist. All command mappings can ship
as read/link-out before in-app execution.

Vercel Functions are stateless and may run concurrently. Their read-only
filesystem and temporary scratch space are not durable storage.
[Runtime limits](https://vercel.com/docs/functions/runtimes).
Use an external transactional store for sessions, single-use authorization
attempts, drafts, operation intents/receipts, leases and refresh cursors. Require
atomic compare-and-swap, unique operation keys, bounded expiry and schema
migrations. Persist an intent before an external write; reconcile uncertain
outcomes before retry. A process mutex cannot protect competing instances.
Unavailable storage denies authentication/mutation; never fall back to memory.
Private Git remains the shared-record authority and media has a separate private
object adapter. Neither Git nor a blob bucket substitutes for session transactions.

Back up workspace Git, durable database records and private artifacts separately;
exclude caches and expire restored sessions. Reconcile unresolved operations
before replay after restore. Audit records retain actor, project, operation,
source digest and outcome, with no tokens/raw feedback. Log only bounded error
codes. Validate secret-free packaging and static assets. Preview deployments use
synthetic data and separate credentials/storage; production callbacks and secrets
must not be available to arbitrary branches or pull requests.

## Phases and release criteria

| Phase | Outcome |
| --- | --- |
| 93 | Explicit external workspace boundary and packed CLI setup |
| 94 | Owner-approved private repository, host and GitHub identity binding |
| 95 | Authenticated service, session lifecycle and per-project access |
| 96 | Dynamic read-only Home with truthful project adapters |
| 97 | Source-bound decisions with durable operation receipts |
| 98 | Guided testing and exact-result feedback (also depends on 92) |
| 99 | Visual change journal with private artifact delivery |
| 100 | Daily work, learning and explicit migration/export |
| 101 | First workspace: real-project access, human acceptance, restore and lived-in trial |
| 102–108 | [Full fleet operations](web-fleet-operations.md#delivery-and-proof): routines, workers, connections/capacity, updates, routing and mobile/desktop acceptance |

Each [phase](../phases/) owns exact acceptance and proof. Test paths in planned
phases are implementation targets, not existing passing checks. The owner can
use the authenticated read-only Home as soon as phase 96 ships; acceptance
buttons wait for their own verified phases. Existing local CLI and board remain
usable throughout.

## Deliberately open

- **Settled 2026-10-21:** owner selected Vercel and a private workspace repository;
  phase 94 records the sanitized provisioning result.
- **Settled 2026-10-21:** owner selected the existing Pro team; project and
  provider domain were created and read back. Exact identifiers stay private.
- **Settled 2026-10-21:** owner approved Supabase Free/iad1 and a private GitHub
  App with Metadata/Contents read on the selected repositories. The database is
  connected only to production; App registration awaits GitHub identity verification.
  Supabase PostgREST preserves the zero-runtime-dependency contract.
- Backup destination, private media adapter and any paid upgrade remain open.
- Team membership/multi-tenant service, additional identity providers, generic
  shell execution: outside this private instance. Supported worker adapters and
  policy-bound routing are planned in phases 104/106; additional spend still
  needs an explicit budget.
- Workspace schema additions and retention periods: version them in the phase
  that implements them; defaults cannot silently publish or discard observations.
- Production verification and lived-in usefulness: phase 101 for the first
  workspace and phase 108 for full fleet operations, never inferred
  from synthetic tests, a successful login callback or a merged PR.

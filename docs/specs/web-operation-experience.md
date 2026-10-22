# One operating experience across projects

Phase107 binding design, 22 October 2026 UTC. This refines the
[fleet contract](web-fleet-operations.md) without declaring full fleet execution
complete. [Phase107](../phases/107-mobile-and-desktop-cover-keel-operations.md)
retains its Done when and acceptance. A mapped limitation is coverage evidence,
not evidence that an operation can run from the web.

## Coverage and capability

Audit the actual current dispatcher, subcommands, positional arguments, accepted
flags, forwarded parsers and installed routine entrypoints. The initial audit
contains 46 dispatcher entries; this is a dated observation, not a constant to
assert forever. Include rejected/deprecated syntax without representing it as an
executable capability. Forwarding to a project-owned script is an explicit
version/source boundary, not proof of its arbitrary grammar.

A shared registry records stable task identity, human title/group, CLI forms and
argument treatments, fleet/project scope, effect, supported destination/adapter,
required capabilities, limitations and concrete follow-up. Treatments are native,
worker, presentation-only and limited. Different variants of one command may have
different treatments. Separate implementation support from instance enablement,
authenticated grants and current source availability. Never infer an enabled
write from a route, a successful read, or a GitHub permission alone.

A drift guard must detect new accepted syntax and changed parser closures. Prefer
parser-owned declarative grammar where feasible; otherwise pin and review the
complete transitive parser source boundary with explicit unknowns. A list mirrored
by its test or an unqualified regex extraction cannot prove coverage. Do not run
arbitrary CLI commands as capability probes: some reads have side effects.

Expose `/capabilities` and `/projects/:id/capabilities` as authenticated, bounded,
read-only task catalogues. Search owner tasks and disclose CLI detail on demand.
Show available, disabled, unsupported and unverified separately with reasons and
follow-up. Home stays focused on decisions, tests and visible changes. No shell
console, per-command external probes or execution dispatch is added by the
catalogue. Existing domain adapters remain the authority for validation,
permissions, previews, receipts and recovery.

## Navigation and recovery

Use one browser-safe navigation contract across existing HTML shells. Keep Home,
project selection, Activity, More and Sign out reachable on narrow screens; More
exposes Routines, Learning, Updates, Connections, Model policy, Setup and Coverage.
Represent the current destination and selected project visibly and accessibly.
Preserve only destination-specific applicable filters across lens changes; remove
cursors, incompatible record selectors and request IDs. A receipt belongs to its
original project. Switching from detail goes to the corresponding index in the
selected project with an explanation, never a fabricated transplanted receipt.

Use a strict shared route descriptor for authenticated return destinations and
lens switching. Only existing HTML routes and bounded per-route query schemas
are accepted. Reject external destinations, duplicate/unknown parameters,
traversal and malformed identities. Server and client session-expiry screens
provide a usable return link. Reauthorization returns to inspection and fresh
preview; it never grants approval or dispatches an operation.

Replacement screens update title, heading focus and an accessible announcement.
Preserve working domain receipt and focus behavior. Offline state reports the
age/limits of the last observed screen. Reconnect may read or offer reconciliation
of an existing identity, but never silently POST a save, count, run, upload,
publish, cancel or retry. Lost access clears private content and invalidates
preview controls; it must not claim unsaved text was preserved.

## Deliberately saved drafts

Existing guided-walk drafts keep their SQL005 authority, history and invalidation
rules. Add explicit private Save/Load controls for three typed editors: daily
plan, model source selection/instructions and model policy. Other forms remain
clearly memory-only unless separately adapted. No universal form serialization.

A separate encrypted private store binds actor, workspace, numeric project (or
explicit workspace scope), kind and target. Store only bounded authored fields
and base source/policy digest. Exclude credentials, media bytes, provider outputs,
session/CSRF tokens, approvals, quotes, source packets and executable requests.
A saved editor draft is not a reviewed preview, source mutation or authorization.
On restore recheck access, validate its type/scope and compare current source;
retain authored text when stale while requiring fresh review before any action.

Use strict CAS, a client save identity and content digest. A lost response is
Save unconfirmed; readback may confirm that save or show a newer conflict, never
blindly repeat it. Conditional deletion/expiry must not permit stale resurrection
or deletion of a newer generation. Bound payload, active count and total storage,
with an explicit 30-day expiry. Use a never-reused database generation for CAS:
reading an absent draft may reserve an empty private metadata row, but never save
content or approve work. Mutations and expiry advance that generation; saves
against missing rows refuse. Bounded tombstone collection may then reclaim old
rows without making an old revision valid again. The initial instance cap is
1,000 rows (including empty/tombstone metadata) and 50 MiB of encrypted payloads,
with explicit capacity errors; this is
an instance limit, not a promised per-project allocation. Distinguish Saved,
Unsaved, Save unconfirmed,
Conflict and Source changed. Disabled or unavailable storage remains explicit.
New SQL012 and enablement require the owner's resource approval before activation;
local implementation/tests grant no remote permission.

No private content goes into localStorage, sessionStorage, IndexedDB, a service
worker cache or URLs. Confirmed server drafts survive reload, login and another
authorized device. Unsaved offline text lives only in the open page; mobile tab
or process eviction can lose it. Warn before intentional dirty navigation and
allow save/discard/cancel. Do not promise beforeunload is durable storage.

## What remains a capability gap

Supported native journeys include decisions and source-bound receipts, guided
walks/captures, changes, routine inspection and the bounded worker, versions and
canary preparation with separate publication, private learning, connections and
bounded API planning. Each still needs its own configured grants and activation.

Night publication/arbitrary failed-night retry, general local runner operations,
robot build/review execution and subscription model execution remain unsupported
until a purpose-specific adapter is implemented and verified. An external link,
CLI copy action or registry entry does not complete those journeys. The original
fleet trial explicitly includes failed-night retry: retain that gap in phase107
and G7 rather than silently substituting the typecheck worker. No generic remote
shell is introduced to fill it. Follow-ups name the missing adapter and proof.

## Night controls: bounded first adapters

Settled 2026-10-22 after reading the canonical workflow and GitHub rerun contract:
use a native provider rerun, with its actual semantics, rather than claiming an
immutable replay. A retry targets the latest failed attempt of an explicitly
registered canonical night run. GitHub retains the original SHA/ref and original
actor privileges, but the workflow reads the current UTC date and current plan.
The preview names all declared writes and commands. A successful request does not
establish a successful night, acceptance, or attribution of a later attempt.

Activation is off by default and requires a private, per-project reviewed source
profile, numeric repository/workflow identity, complete bounded source inventory,
explicit effects and a 60-minute reservation within the existing shared workspace
and project allowance. Source drift, incomplete inventory, custom or dynamic
commands, model-producing work, secret-dependent setup, optional publication and
undeclared downstream workflows refuse v1. The supported profile must include
real canonical measurement/report behavior; no typecheck substitute. Source,
current grants, original actor and latest failed attempt are rechecked before a
single POST. Review explicitly permits the normal current-plan/date reads and
canonical Git ref/data PR effects; it never grants a new model allowance.

A new private attempt-aware receipt store shares the same atomic admission lock,
active project lane and conservative accounting with existing jobs. It records
prepared, sending, request-accepted, uncertain and refused separately from bounded
successor observations, whose attribution remains unverified. A lost response is
never redispatched. Neither elapsed time nor observing a successor proves an
uncertain POST cannot still execute; retain its charge and unresolved lane until
an expressly designed settlement can establish otherwise. External/scheduled runs
are outside web admission and are not represented as budget-controlled. V1 does
not cancel a run by logical ID after its attempt changes. New storage activation
requires separate owner approval and actual database proof.

Plan publication first supports an existing canonical `keel-night-plan` branch.
Review exact canonical plan bytes, UTC date, numeric repository/ref identities,
prior head/blob, source digest, human attribution, effects and a complete diff.
Validate the canonical non-draft schema. Permit measure/triage edits, preserve
existing build allocations and owner-authored lines/results, and refuse pending
robot items or unknown/escalated execution policy. A concurrent tick, newer date,
source edit or ref replacement invalidates review; never silently rebase. A
conditional commit uses the immutable ref ID and expected parent and preserves
all other files and history. It does not invoke `goodnight --yes`, create issues,
force-push, start a run, or turn a private draft into approval. Missing-branch
bootstrap remains an explicit unsupported setup operation, not a successful
publication. SQL004 may hold this distinct typed intent, provided other consumers
reject or correctly render its new kind and recovery verifies exact identity,
parent, message, path and bytes. Lost-response recovery uses the original intent.

The initial UI offers review/publish from Daily and review/retry from a failed
night's retained attempt detail, with permanent receipt links and inspection-only
reconnect. Native adapters still require real provider and owner-device proof;
restricted eligibility is visible and must not be called universal execution.

## Proof and completion

`tests/web-operation-coverage.test.mjs` checks real grammar boundaries, argument
variant treatments and capability/activation distinctions. Deliberately mutate a
temporary parser copy to prove newly accepted syntax is caught. Installed/project
forwarding unknowns remain visible, not counted as verified complete grammar.

`tests/web-responsive.test.mjs` exercises actual route/HTML and client transitions:
authorized lens changes, exact login return, denied scope, saved draft recovery,
expired session and no write replay. Additional focused tests cover typed drafts,
CAS/lost-response/expiry, read isolation and malformed content. Test the actual
SQL in a disposable database, and retain hosted multi-connection proof separately.

An actual authenticated local browser with Acme external transports exercises
core journeys at 1280, 390 and 360 pixels, keyboard navigation, 200% zoom, color
scheme and reduced motion. Record scope, focus, overflow and screenshots of the
real routes. Expire sessions and lose connectivity before/after accepted writes;
count writes and recover the original receipt. Synthetic browser evidence does
not establish real provider effects or the owner's physical mobile experience.

Keep phase107 partial while implementation gaps remain; do not set `owes: walk`
if required execution still needs code. The owner walk and deployed-service
verification stay unchecked until actually observed. Phase108 cannot turn a
catalogue of limitations into accepted full fleet operation.

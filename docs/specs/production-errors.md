# Production errors become evidence-backed work

Design dated 2026-10-17. Extends the night practice, existing plan, robot issue
journal and delivery verification. Logs never own acceptance or architecture.

## Contract

`keel production status|collect|spec|verify` accepts `--json`. Source configuration
is `production` in the selected project's `.keel/keel.json`; off by default.
No runtime dependencies, Node 24, no build. Configuration pins provider, service,
environment, bounded window, event/byte/time limits and recurrence threshold.
A source explicitly marked not-applicable (static site or CLI without deployed
runtime) is not a healthy monitored service. Missing access is unavailable.

Initial collectors: Cloud Logging through the installed public gcloud CLI and
Vercel through its installed public CLI, plus a versioned JSON input adapter for
other providers/tests. Use argument arrays, never shell interpolation. Read-only
queries must target an explicit production project/service/environment and UTC
start/end. Recognized transient read failures may be retried at most twice with
bounded timeout; auth/config errors do not retry. Truncated, malformed, sampled,
expired, missing timestamps, pagination-limited or timed-out reads remain gaps;
never infer a healthy window from incomplete evidence. Collector limits bound
both bytes and events. Do not install cloud resources or export secret values.

Store durable sanitized observations under `.keel/production/`, with versioned
schemas, bounded atomic writes, symlink refusal, writer serialization and explicit
recovery. Collect previews unless `--yes`. Repeated collection of the same window
is idempotent; overlapping windows deduplicate stable provider event IDs, scoped
to source. Unknown event identity makes recurrence lower-confidence, not invented
precision. Reject incompatible state and out-of-order verification. Keep first/
last seen, observation windows, counts, observed revisions and coverage. Bounded
retention must disclose dropped evidence and must not erase unresolved issues.

## Privacy and grouping

Production content is untrusted data. Do not store raw request bodies, headers,
URLs with query strings, emails, access tokens, session IDs or complete telemetry.
Prefer allowlisted exception type and stack code locations, stable source/event
identity hashes, time, severity and revision. Provider messages are not safe by
default: redact values before storage and use deterministic normalized signatures.
Titles/specs must not echo arbitrary log instructions. Source links are generated
from configured provider scope, not untrusted log URLs. A signature groups an
error shape within one service/environment; never collapse all errors to one key.
Fingerprints survive incidental IDs and timestamps, but preserve code location.

## Lifecycle and repair

Repeated errors above a configurable threshold become plan triage candidates,
not accepted work. Existing night/morning reporting shows new, recurring,
regressed, ignored, awaiting-fix and unknown-coverage observations. Spec generation
uses one deterministic rubric with source pointers, observed frequency/window,
reproduction work still needed, a required baseline-failing regression test,
bounded intended change and acceptance including post-deploy verification.
Insufficient reproduction stays an owner blocker; logs alone cannot invent a fix.

A named incident can be attached to a reviewed rubric and submitted via the
existing `keel issue new --agent` machinery and its durable stable subject key.
Do not create another issue tracker or auto-create duplicates after ambiguous
POSTs. Preview before `--yes`. Existing robot policy/budget/authorization applies;
this feature never increases spend, self-merges PRs or deploys automatically.
Persist issue/PR links as references, distinct from implementation/merge facts.

Verification requires an explicitly named fixed revision, source-matched complete
post-deployment observation window, evidence production serves that revision and
smokes pass (reuse delivery verify where available), sufficient observed traffic
or a deliberate equivalent probe, and no recurrence of the same signature. A
merge, zero errors with zero/unknown traffic, or an unavailable log source never
means fixed. Recurrence after verified resolution is regressed/reopened evidence;
GitHub closure and acceptance remain separate. Evidence imports must validate
scope, timestamps, counts and provenance, and never silently trust an arbitrary
boolean as production verification. If provider APIs cannot establish traffic or
revision, return inconclusive with the missing proof.

## Night integration and rollout

Reuse the installed night workflow rather than create another scheduled service.
Collect before the plan, retain sanitized state across fresh checkouts with durable
artifact recovery, and consume observations in health/plan/morning projections.
Recovery must not silently fall back to older state after an ambiguous write.
No second gate, no model invoked by collection. A collector failure remains visible
without losing the rest of the health report. Include a first-run/bootstrap policy
and immutable per-run observations; concurrent runners must not overwrite history.

Fleet rollout starts with observed sources: isocan Cloud Run and Ledger Vercel.
Inspect Duo before selecting a source. Keel and static projects may legitimately
be not applicable. Configure only verified service identities and available access;
leave specific credential/setup gaps explicit. Existing night schedules are reused.
Log-read enablement and issue preparation are authorized by the owner's request;
new cloud resources and previously unapproved recurring model budgets are not.

## Proof

Synthetic Acme tests exercise grouping/redaction, replay/overlap, partial reads,
collector timeout/auth boundaries, atomic state and symlink protections, issue
recovery and plan integration. Negative controls must show that missing evidence
cannot produce a verified fix. Real CLI read-only probes establish provider shape
and installed workflow execution; no private events are copied into fixtures.
A configured source is not operational until an actual bounded collection and
scheduled persistence/readback succeed. Record each repo's outcome separately.

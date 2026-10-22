# Measured validation efficiency and nightly guardrails

Implementation contract, 22 October 2026. Goal G5; design §6 and “Measured
cost and checked contracts.” Requested after the completed migration audit.
This is a staged implementation, not a revision of the required gate policy.

## Evidence and scope

Source: `Plates-retrospective-and-speed-audit.html`, evidence bundle and index
in the 22 October task-2 audit workspace. The original report is immutable;
its `artifact-manifest.json` retains hashes. Important derived sources are
`measurement-summary.json`, `local-run-inventory.json`,
`hosted-release-timings.json`, `ci-evidence-artifact-audit.json`,
`email-formatting-case.json`, and `review-findings-index.json`.

The current source-owned `plates.json` manifest resolves the entire scope:

| Repository | Local audit root | Required validation |
| --- | --- | --- |
| dalmaer/plates | ~/code/plates | check (ordinary + stalls + generated guards), typecheck |
| dalmaer/duo | ~/code/duo | test, typecheck, roadmap, build |
| dalmaer/cajones | ~/code/cajones/ritmo | syntax, tests, roadmap, PWA via check:all |
| dalmaer/ledger | ~/code/ledger | check:all; both clocks, voice, types, build, generated/perf/data checks |
| dglazkov/isocan | ~/code/isocan | complete CI shard union, anti-skip switches, types, graders, metrics, roadmap and local configured gate |

Cajones's repository root is `ritmo`, not a new repository named ritmo.
No unlisted project is eligible. Resolve current identities from the manifest
and `.plates/plates.json` before consumer edits. Local main `c33084dd` is an
unpushed email renderer; it is not part of this work. Start from published
`f62268ec189b06cf71d41721d80dc11fd86a2944` in an isolated worktree. Do not
merge or push canonical main. Keep each implementation slice in a reviewed PR;
owner/parent review precedes broader rollout. No release or deployment here.

Observed, not benchmarks: 44 enclosing source gates had median 274.5715 s,
range 236.844–742.482 s; 12 failed, 43 were dirty, all recorded load above CPU
count. Their 14,310.751 s sum is accumulated invocation wall duration, not
elapsed day or CPU time. Source concurrency was 32 on a 14-CPU host. Ledger's
481 s core job preceded 223 s web work; removing the edge has an optimistic
223 s graph bound, not observed savings. isocan healthy setup was 46–67 s;
one installer did not exit before the 20-minute job timeout. Its checks job
(380 s) already exceeded its slowest healthy shard (346 s). Extra shards are
not a demonstrated critical-path optimization. Duo/Cajones local test totals
were below a second; retain their whole quick suites.

Ledger's inspected artifacts lack the enclosing configured-check attestation;
isocan's selected release artifacts contain profiles, not equivalent gate
proof. Freshness changes alone therefore save zero eligible runs. The email
case's 2,789-test gate demonstrates why focused renderer feedback should precede
an exact integrated checkpoint; it does not authorize omitting that checkpoint.

## Non-negotiable boundaries

- Preserve data/history, runtime and external behavior, security checks,
  mandatory reviews and complete exact-head validation. No credentials,
  callback URLs, blocked email automations, recipients or schedules change.
- Focused checks order feedback. They never satisfy a required whole gate.
  Unknown/shared/config/lock/workflow/harness changes fail closed to broad
  validation. No dynamically guessed filename-neighbor selection.
- A green workflow is not an equivalent configured gate. Do not fabricate an
  outer attestation around partial children. Existing gate reuse remains the
  sole execution authority; the new audit only reports evidence and gaps.
- Record attempted, implemented, reviewed, merged, measured and lived-in
  separately. Preserve failed attempts; a passing retry is not a causal fix.
- One host-wide heavy gate at a time, including worktrees/consumers. Focused
  checks may overlap only within an explicit resource budget. Record CPU,
  wall duration, queue time and overlapping spans separately; unknown is null.

## Ranked delivery stages

Each stage has its own phase and PR. The first stage is useful independently;
consumer or gate policy adoption waits for its evidence and review.

| Phase | Priority / deliverable | Exit and rollback |
| --- | --- | --- |
| 110 | P0 read-only retained-evidence audit and local entrypoint | Negative controls, real retained-evidence run, no subprocess gate or network, stable deduplicated findings; revert isolated CLI if reporting is wrong |
| 111 | P0 convention/capability preflight, focused-first plan, resource-budget trial | Unknown inputs choose full; exact commands preserved; admission tests; explicit benchmark before changing defaults |
| 112 | P1 genuinely independent Ledger core/web CI | Separate scope job; both jobs depend only on scope; own checkout/install/artifacts; complete stage union and failure propagation; revert graph edge if regression |
| 113 | P1 isocan setup watchdog and exact-input targeted retry | Non-exiting child negative control, diagnostics before deadline, whole process cleanup, successful installs unchanged; no silent retry or masked failure |
| 114 | P1 complete exact-head gate evidence and verified reuse | Per-repo versioned stage equivalence; adversarial invalidation, end-to-end producer/validator; no policy activation before review |
| 115 | P2 telemetry-driven fixture work and shadow selection | Paired trials, all known failure families replayed, unknown inputs broad; separately reviewed adoption proposal |

These priorities stage changes; they do not claim projected savings as observed.
Clock-lane splitting, isocan metrics/checks splitting and fixture refactors remain
experiments until independent measurements justify them. Do not change worker
count, fixture layout, cache policy and selection simultaneously.

## Phase 110: retained evidence, not another expensive night

A standalone source script accepts an explicit fleet manifest and a bounded
JSON evidence input. It does not discover arbitrary home directories, execute
commands, fetch remote resources, alter configuration or create a schedule.
The parent owns the single nightly schedule. Its run may prepare inputs using
read-only connectors and invoke this analyzer, retaining its JSON output.

Normalize evidence as schema 1: project, immutable run/attempt/stage identity,
head/tree/clean state, command/config/runtime/environment/selection digests,
parent invocation, stage status, start/end/wall/CPU/queue durations, retry reason,
resource samples, expected stage manifest, observed stage records, review
base/head/workflow/event/input-completeness, reuse decision and freshness.
Every unavailable field stays unknown. Provenance names input record/source;
private raw logs, command arguments, tokens, bodies and credential values are
not copied into findings. Input validation rejects malformed/traversal-like
paths and unsupported projects; missing coverage becomes an actionable gap.
Retained legacy ledger records can be analyzed only for fields they establish;
no inferred complete attestation. The versioned normalized format is the stable
entrypoint for future producers.

Report rules: redundant complete gates with the same proven immutable inputs
and no distinct validation purpose; comparable timing regression (same stage,
runtime/environment/cache and coverage, explicit baseline and threshold);
setup heartbeat/deadline stalls; incomplete or dirty/failed/stale/mismatched
attestations; wrong review event/workflow or incomplete/stale review inputs;
unsupported freshness reuse. Missing telemetry and missing expected projects
are coverage gaps, not clean bills of health. Unknown CPU is never inferred
from wall time. Nested or overlapping durations never sum into elapsed time.
Legacy records without comparison keys are not eligible for regression or
redundancy verdicts. Suspected duplicates are recommendations to inspect,
never permission to skip a gate.

Findings carry deterministic IDs keyed to repository/rule/candidate/evidence
identity, severity, safe reason and one concrete next action. Duplicate inputs
produce one finding. A caller can compare IDs with its prior report; changed
head or evidence yields a new actionable identity. The analyzer never sends
notifications. Baseline insufficiency is explicit; p95 is not claimed from a
single observation. Source absolute paths may be retained privately as input
provenance but are not published into repository fixtures.

### Immediate convention recurrence guard (110)

The first implementation repeated the audit’s known helper-convention omission.
At the parent’s explicit direction, phase 110 therefore also adds a conservative
source-local `check:focused` entrypoint and a required /spin preflight step. The
entrypoint always includes helper, documentation, guide, CLI, adoption and
managed-skill and package capability convention tests
in addition to explicit focused files, then roadmap, managed render, inbox and
whitespace checks. Regression tests bind that mandatory set and failure handling.
This is not change-aware selection, complete impact coverage or a gate exemption;
unknown/shared/config inputs still require broad validation. The general mapping,
capability checks and resource admission remain phase 111.

## Preflight and focused-first protocol (111)

Before building, read target AGENTS, applicable contracts, package scripts and
convention tests. Resolve clean worktree, runtime and required binaries without
changing global configuration. Pin supported Node/toolchain, classify changed
inputs, verify package capability binding and full review input availability.
Provider capability evidence distinguishes build runtime from an actual fresh
function runtime; missing protected probe blocks a runtime claim, not unrelated
work. No deployment/probe is authorized by this spec.

Produce a plan: exact failing test, affected family/conventions, static/types,
then the unchanged complete candidate gate. Maintain explicit mappings and
coverage/invalidation tests. Unmapped path, rename/shared harness, environment,
package/lock/config/workflow or generated inputs request broad coverage. Shadow
plans do not execute or waive required gates. Preserve original authorization
scope and blockers rather than repeatedly asking about unchanged actions.

Trial bounded source concurrency with available CPU/memory information and
an explicit shared heavy-run lease. Never steal an apparently stale lease
while its owner may run. Include worktrees and consumer roots in contention
scope. Keep ordinary/stall union and child lifecycle unchanged. Initially use
opt-in admission and worker limits; change defaults only after at least five
paired fixed-head runs with cache/runtime/workload recorded. Require lower
median complete wall path, no reliability loss and p95 regression <=5% where
sample size supports that estimate. Otherwise retain defaults and report unknown.

## Independent consumer jobs (112–113)

Ledger: extract scope determination into its own read-only job. Core and web
both depend on it, never each other. Use separate checkouts, process-local
normal/400-day clock environments and unique artifacts. Retain Vercel's exact
production-dependency install/build order inside web, then install test deps.
Preserve existing scope invalidation and all existing checks. Voice, web
TypeScript, perf and private data stages require explicit equivalence accounting
before CI can attest check:all; no private-data dependency is silently omitted.
Keep the required workflow conclusion red if any required branch fails. Validate
DAG and stage multiset with mutation tests and test shell commands focused-first.
Matched hosted runs are a later review/measurement step, not assumed savings.

isocan: use the existing shared suite-setup action for PR and release. Bound
installation separately from suite execution; choose provisional generous limit
from the observed 46–67 s successes, record it as provisional pending cold/warm
p95/p99. Capture elapsed/last heartbeat, redacted process tree and child state
before TERM, grace then KILL of the entire group; do not dump env/credentials or
full arbitrary arguments. Preserve installer exit status, never infer success
from final stdout. Retain timeout as a failure with a diagnostic artifact.
Allow at most one explicit failed-job retry only if head, lock, runtime, setup
flags and workflow/stage manifest match. Changed setup invalidates siblings;
never retry product/harness failures into green. Preserve successful original
job timestamps and attempt parentage, avoiding double-counting reused work.

## Gate evidence and reuse (114)

First write versioned per-project required stage manifests mapped to actual
local commands and hosted steps. Distinguish configured check from wider
security/release requirements. Include both Ledger clocks, voice/types/build/
perf/generated/data checks where required; include all isocan required files,
shards, anti-skip switches, emulator/build/deep environment and optional real
service skip reasons. isocan local 115 skips and hosted three optional skips
are different coverage, never silently equivalent.

Producer records exact candidate/tree/clean state, config/command/workflow/
lock/runtime/environment/selection hashes, required stage union, child linkage,
conclusion, attempt and integrity. An aggregate is valid only after all required
stages complete successfully on identical immutable inputs. Consumers retain
original receipts and sources. Test missing/duplicate shards, false wrapper,
partial/failed children, dirty/mismatched tree, stale head, changed environment,
command/workflow/lock/harness, corrupt/expired artifact, unsupported schema and
unknown inputs. Existing freshness policy remains unchanged. Adoption requires
explicit reviewed policy with coverage/invalidation tests and a real producer to
existing validator round trip. Reuse never suppresses external health, learning
or scheduled reporting; dependency download caches still run integrity checks.

## Telemetry and later adoption (115)

Collect invocation + stage spans, child CPU and wall separately, queue/setup/
review/approval intervals, cache state, worker limits and resource samples,
without private reasoning or secrets. Do not add overlapping waits. Audit
reports compare only matching cohorts and report baseline sample size, median,
p95 where supportable, reliability and aggregate runner minutes separately.

Profile longest fixture files before refactoring. Keep assertions, use private
copies of immutable templates, and prove failures still fail. Shadow selection
must replay historical defects and at least 20 representative changes across
shared/config/rename/build/dependency boundaries with no missed full-gate
failures; retain periodic broad coverage and a disable switch. Finite zero-miss
history does not establish universal coverage. Gate-policy revision is a new
explicit reviewed change; this spec does not grant adoption by elapsed time.

## Delivery and review

/spin claims a phase, refreshes decision context, briefs a bounded builder,
verifies focused/convention proof independently, writes evidence and commits
explicit paths. Preserve failures and correct docs before coding contradictions.
For this work use PR review boundaries instead of automatic integration: no
`plates integrate` while main carries unrelated local email work. Run one
required integrated checkpoint on final candidate; typecheck/security/review
remain required. Review records pin complete base/head diff and workflow source.
Use the proven `ready_for_review` trigger; verify actual review head and complete
input rather than assuming an old `/review` path is sufficient. Resolve each
finding using the repository review workflow, preserving round limits. No merge,
release, rollout or new schedule is part of this implementation turn.

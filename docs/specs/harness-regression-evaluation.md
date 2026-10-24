# Harness regression evaluation

Design, 23 October 2026. Phase 117 implements local plan/freeze/inspect records;
execution, independent scoring and comparison remain designed. No agent evaluation
has been executed or funded by this specification. Source baseline:
`8f218d7e138edda2c86fc5055c97a59b9df8427a`.
See the [capability map](../research/2026-10-23-evaluation-capabilities.md),
[research decisions](../research/2026-10-23-evaluation-patterns.md) and
[learning contract](review-learning-evaluation.md).

## Problem and intended behavior

A green gate proves neither that instructions helped an agent nor that a review
lesson improves future work. Compare a pinned baseline and narrowly changed
candidate on the same frozen tasks, then independently evaluate their submitted
artifacts. Success means more accepted outcomes, fewer escaped defects and less
observed human effort at acceptable cost. Counts of agents, PRs, tests or words
are not substitutes. No result changes production defaults automatically.

## Reuse and implementation boundary

Extend `lib/session-trials.mjs` with a tagged schema-2 `kind: harness` experiment.
Reuse bounded events, locking, atomic replacement and audit/report conventions;
retain schema-1 handoff readers and semantics. Harness records reject automatic
policy application. Existing handoff acceptance fields are observations, not the
new evaluator's authority. Do not reuse the handoff three-pair minimum.

Add explicit external state selection using the private workspace ownership and
path checks in `lib/web/workspace.mjs`. Store the experiment under
`<approved-private-state>/session-trials/<comparison-id>/`, with `state.json`
and immutable content-addressed evidence attachments. This is an extension to
the existing experiment ledger, not a new database or task queue. The current
in-repository handoff directory cannot protect evaluation secrets. Private state
must never be mounted in the builder. Source-owned definitions and reviewed
summaries may live in `docs/evaluations/` and `docs/evidence/`; private checks,
raw execution observations and credentials may not enter Git.

Factor a narrow foreground trial adapter from robot/climb provider execution.
There is no general agent adapter today: hosted `typecheck-v1` is insufficient.
Reuse validation-budget host admission, robot budget accounting patterns and
climb settlement/artifact capture, but add evaluation-specific admission rather
than borrowing an approved robot allowance. Existing robot guards prohibiting
instruction edits remain intact: the trusted controller applies the reviewed
candidate overlay outside the task's authority. `prove` and validation planning
supply useful checks, not independent acceptance by themselves.

The CLI surface is `plates retro evaluations <operation> --json`. Phase 117
implements plan, freeze and inspect; run, resume, cancel, compare and rescore
remain planned and refuse invocation. Each shipped operation has agent help. Plan/inspect/compare are
read-only. Run/resume/rescore preview the exact input digest, missing slots,
authority, maximum additional spend and environment; execution requires `--yes
--digest <preview>`. Resume approval cannot enlarge the frozen ceiling.
No scheduler, hosted worker activation or fleet dispatch is part of the MVP.

**Phase 117 boundary, settled 23 October 2026:** `plan` validates a supplied
case/configuration/comparison bundle without writes. `freeze` previews that exact
bundle and destination; `--yes --digest <preview>` records the frozen plan in an
already initialized explicit private workspace. `inspect` reads and validates
that frozen plan. Freezing never reserves execution budget, starts a trial or
claims acceptance. Freeze approval also pins the canonical bundle path; moving
identical bytes does not authorize recovery at a different path. Inspect preserves
access to the original receipt. The record guard rejects byte-identical acceptance
material in context, not semantic or reformatted copies; it is not the independent
isolation boundary required in phase 118. Run/resume/cancel/compare/rescore remain unavailable until
their later phases; unsupported operations must refuse rather than simulate
execution. This local freeze operation lets the record foundation be proven
without borrowing the future execution command's authority.

### Phase 118 offline execution contract (23 October 2026)

The first execution adapter is explicitly offline. `run --experiment <id>
--execution <absolute-json>` previews a single frozen pair/arm and exits 3;
`--yes --digest <preview>` approves only those exact bytes, source export,
private destination and resource limits. Its strict execution request identifies
schema version, pair, arm, canonical local repository, regular source paths,
builder argv and explicit host admission configuration. Export each source from
the case's pinned commit; reject symlinks, submodules and Git history. The preview
binds the delivered export and ordered context/overlays. Private provenance,
acceptance material and other trials are never delivered. An offline scripted
builder tests execution machinery, not model efficacy or generalization.

Private acceptance material uses the versioned `stdio-v1` driver: a bounded list
of check IDs, argv, input, expected stdout and exit code. The trusted host owns
comparisons; expected outputs never enter a container. Each check invokes the
submitted behavior in a fresh hardened container. Public probe programs are
frozen input files rather than hidden tests imported into untrusted code. This
small driver establishes the initial compatibility boundary, not support for
all future integration oracles. Evaluator errors remain unknown.

Use the existing host validation coordinator for admission, extending its lease
shape to retain external container operation identities. Preserve foreground
lease semantics. A container lease releases only after confirmed termination;
a dead client or expired lease is insufficient. The explicit coordinator policy
and managed repository identity are bound into the run preview. A private
workspace lock alone is not host-wide admission. Reserve the frozen comparison
allowance before its first slot and refuse unplanned, repeated or oversubscribed
slots. No provider inference or currency entitlement is granted.

Keep phase 117's original frozen receipt and attachments unchanged. Execution
records are an extension beneath the same experiment: immutable reservation,
slot intent, captured artifact, stage observations and artifact-bound verdict.
Persist original unique container operation names before dispatch. The offline
builder submits one bounded JSON regular-file envelope on stdout; stderr is
bounded diagnostic output. The envelope, not a claim about its working directory,
is the submitted artifact. Validate its exact bytes, paths, modes, allowlisted
changes and preserved controller-owned public files, then confirm builder
termination before evaluation. Construct each evaluator from the pinned base
and that validated submission. Traversal, links, special files, forged pass
messages and changes to acceptance authority refuse. No submitted outcome field
can create a verdict; only independently observed artifact behavior can.

**Transport correction, 23 October 2026:** a real restricted-container probe
executed an existing file but `docker cp` returned an empty archive from tmpfs.
[Docker documents this limitation](https://docs.docker.com/reference/cli/docker/container/cp/#corner-cases).
The initial pause/copy transport is withdrawn. An explicit immutable submission
avoids both the unsupported capture and races with surviving builder processes;
no writable host mounts, unbounded volumes or privileged collector are added.
It proves the behavior of the submitted bytes, not an attested snapshot of the
builder's final filesystem. Builder tools must serialize their chosen artifact;
invalid/missing submission is separate from infrastructure failure.
Identical retries recover original terminal evidence. Uncertain dispatch,
termination or storage remains reserved and inspectable, never automatically
rerun. Phase 119 adds comparison recovery; until then unsupported resume,
cancel, compare and rescore operations explicitly refuse. Failure evidence and
unknown costs remain visible, and no result changes a production default.

## Data contracts

All records have schemaVersion, stable ID, createdAt, content digest and typed
references `{kind,id,digest}`. Canonical JSON hashes use SHA-256; exclude only the
record's own digest. Canonicalization sorts object keys recursively, retains
array order, encodes UTF-8 JSON, rejects non-finite numbers/undefined and preserves
explicit null. File inputs hash exact bytes; directory manifests sort normalized
relative paths and bind file type plus byte digest, refusing external symlinks.
Strict validators reject unknown execution-affecting fields,
path escapes, invalid enums and unresolved required references. A version change
creates a new immutable record. Append events under a locked generation/CAS;
never rewrite an earlier attempt or verdict. Raw external JSON is validated. Reaching ledger/evidence bounds refuses new
admission; it never truncates historical attempts to keep running. Declare
retention and byte limits in the plan. Expired artifacts remain referenced as
unavailable and cannot support rescoring.

| Record | Required fields and semantics |
| --- | --- |
| Case | id, version, taskClass, publicBrief, repository canonical identity, startingCommit, environment image digest/platform, dependency lock and installer digests, tools/network/authority allowlist, setup prerequisites, public requirements, acceptanceManifest reference/hash, timeout and minute/currency ceilings, provenance references, development/held-out visibility and exposure history |
| Configuration | id/fingerprint, harness commit and dirty overlay digest, provider/runtime/version, requested model and resolved model identity (or explicit unresolved alias), runtime settings, ordered effective context/skill hashes and routing inputs, tool versions/config, execution/review policy, environment identity |
| Trial | id, comparisonId, pairId, arm, case/config refs, attempt number and parentAttemptId, reserved slot, workspace/container identity, timestamps, execution status, immutable artifact/commit refs, resource measurements with provenance, interventions with actor/reason/timestamp, repair rounds, evidence refs, separate setup/execution/validation outcomes and lease/settlement refs |
| Verdict | id, trial/artifact/checkManifest refs, evaluator identity/version/image, per-check status/evidence, acceptance accepted/rejected/unknown, failure category, limits/missing observations, supersedesVerdictId for explicit rescoring |
| Comparison | id, phase/issue authority, baseline/candidate refs, frozen cases and pair slots, seed/order, stopping/replacement rules, total allowance, planned/completed/failed/invalid/missing pairs, selected verdict set, per-case and aggregate results, distributions, regressions, comparability limitations and recommend promote/reject/inconclusive with rationale |

Resource values are nullable with unit, source (provider receipt, observed clock,
estimate or unavailable), observedAt and coverage. Unknown cost is not zero.
An estimate is never labelled billed cost. Alias resolution failures remain
visible and may make a pair non-comparable under its frozen policy.

Case public brief and private acceptance manifest are separate objects. The
builder receives public requirements and permitted context only, not provenance
pointing to a historical solution or private check answers. Configuration
fingerprints cover actual delivered bytes, not merely intended source filenames.
The target repository revision is distinct from the harness revision. Define an
ordered overlay manifest for baseline and candidate that records exactly which
guide/skill/runtime bytes replace target context, with the same exclusions in
both arms. Record inherited target instructions too; an ambiguous precedence or
unrecorded host-injected instruction makes the trial invalid. Public definitions
reference private material by opaque identity/hash; reports
must not export held-out checks. A task's submitted commit cannot modify its
case, comparison policy or evaluator manifest.

## Lifecycle and authority

1. Validate definitions, required refs, frozen hashes and project authority.
2. Preflight image availability, provider capabilities, network restrictions and
   independent evaluator support. Reserve the entire comparison's declared
   allowance, then admit a bounded trial under host slots and project policy.
3. Export the pinned target revision into a fresh builder container. No checkout
   history containing the fix, host home, prior trial memory, agent conversation,
   writable cache or controller state is available. Immutable dependency images
   may be reused; agent outputs and mutable dependency caches may not.
4. Apply the selected controller-owned harness overlay and attest its delivered
   hash. Start a fresh provider conversation and task under the approved policy.
5. Capture bounded output and patch/artifact; record interventions and repairs.
   Stop the builder and confirm termination before accepting an artifact.
6. Validate the artifact envelope and evaluate in a fresh environment exported
   from the same starting revision. Keep setup separate from task execution.
7. Persist the evaluator's signed-by-authority receipt (controller-authenticated,
   not an agent claim), checks, artifact hash and settlement. Only then mark the
   trial terminal. Preserve output after failures within private retention bounds.
8. Compare the frozen pair plan, including failed and missing work. Human review
   decides whether evidence warrants a separate production change.

The adapter contract exposes preflight, start with idempotency identity, inspect,
requestCancel, collect and confirmTerminal. It returns capability limitations,
original operation IDs, bounded stage results and receipt refs. A start timeout
is uncertain dispatch, not permission to start again. Local adapters must retain
process/container identities before launching. Unsupported providers refuse.

### Acceptance isolation

Separate directories and worktrees are not security boundaries. The required
MVP is a trusted controller, a disposable builder container, and a separate
post-execution evaluator environment. Both containers enforce CPU, memory, process, disk/output and time limits from
the approved adapter policy. Neither container receives host sockets,
controller credentials, sibling volumes or private experiment storage. The
builder has no arbitrary Internet or GitHub access; only a narrowly scoped model
gateway and explicitly permitted case services. A provider requiring unrestricted
host access is unsupported until an equally strong boundary is demonstrated.

The submitted patch is untrusted. Reject traversal, symlink escapes, oversized
artifacts, acceptance/policy modifications and writes outside the case allowlist.
Apply it cleanly without fuzzy patch matching. The trusted evaluator driver keeps
its assertions outside the submitted program's process and filesystem. It invokes
artifact behavior in a child container through bounded inputs/outputs or a
controlled fake-service API. Candidate code cannot read the driver's files,
forge its receipt or supply the command that defines acceptance. Running hidden
Node tests in the same process as untrusted imported code is insufficient.

Integration checks use deterministic replicas for delayed CI, duplicate events,
partial writes and recovery. The driver owns service state and asserts effects,
not just final prose or a reported passing test count. Public mutable project
tests remain useful feedback, separately attributed from private acceptance.
No acceptance feedback returns to the still-running builder. Repair after a
verdict is a linked new attempt and counts as intervention/repair, not a fresh
independent success. Evaluator/network failures produce unknown, never accepted.

Negative proofs must attempt to read the evaluator, steal another trial's memory,
change check bytes, forge a pass, escape a symlink and invoke host tooling. Verify
that baseline and candidate share neither writable state nor provider sessions.
This boundary must pass offline adversarial tests before any paid trial.

### Budgets, deadlines and stopping

Reserve comparison and per-trial minutes plus any approved currency/token ceiling
before dispatch. Include both arms, setup, evaluation, review and explicitly
bounded replacement attempts. Host-slot leases coordinate local resources; they
do not enforce provider spending. For a currency ceiling, require a provider or
gateway enforcement mechanism; inability to enforce it blocks execution under
that policy. Never translate unknown usage into free capacity. Link original
budget receipts so project and comparison accounting do not double-charge usage.

A deadline requests cancellation and stops new dispatch. Cancellation requested
is distinct from termination confirmed. Uncertain running work retains its
reservation; lease age alone cannot release it. Only trusted settlement records
confirmed usage/release. Evidence collection and terminal recovery remain possible
after cancellation without renewing a provider session or starting new work.

## Comparison policy and reporting

Freeze the trial count, affected cases, unrelated controls, admissible drift,
order seed, promotion criteria and stopping rule before the first start. Initial
screening requires at least five pairs for each affected case and each selected
control. Interleave balanced AB/BA orders within each case, with recorded seed;
hold model/runtime/environment constant where supported. No stop-on-success or
extra trials selected after seeing a favorable result. Safety/budget stopping
leaves outstanding slots missing. Default replacement allowance is zero; a new
approved comparison may add trials and must link the original results.

Report setup/infrastructure failure, agent task failure, acceptance failure,
timeout, budget exhaustion, cancellation and missing evidence separately.
Infrastructure-invalid pairs can be excluded from a task-quality comparison only
under the frozen rule, and still appear in operational totals and costs. Report
both all planned slots and the comparable subset, with explicit exclusion reasons.
Pair completion requires both terminal observations and matched input identities.
Unknown environment/model drift cannot silently become a valid comparison.

JSON and Markdown reports lead with per-case accepted/raw counts and denominators,
then paired baseline-fail/candidate-pass and baseline-pass/candidate-fail counts.
Include all attempts, setup failures, missing pairs and per-check evidence links.
Cost per accepted outcome sums all attributable attempts (including unsuccessful
and infrastructure attempts) for that arm divided by its accepted outcomes.
With zero accepted outcomes the ratio is undefined; with incomplete cost it is
unknown, with a labelled known subtotal and coverage. Do not silently compute it
only on successful trials. Show setup/execution/validation and total wall time,
median/range and raw observations; label estimated usage. Do not sum overlapping
wall times as elapsed completion time.

Record intervention counts, descriptions and repair rounds. Active human minutes
are measured only when observed; waiting for a reply is not human labor. Report
escaped defects only within a named subsequent observation window and exposure
cohort; absent follow-up is unknown. No opaque composite score combines safety,
correctness, speed and cost. Five pairs are a screening floor, not statistical
proof: show paired uncertainty and recommend a preregistered larger comparison
when discordant counts, drift or missing evidence make the conclusion ambiguous.

## Execution state transitions

Comparison states are draft, frozen, admitted, running, stopping, completed and
incomplete. Completed means every planned slot has terminal evidence, not that
any task was accepted. Incomplete retains missing or uncertain work. A frozen
plan never changes in place; a successor comparison references the old plan.
Trial states are reserved, preparing, dispatching, uncertain, running,
cancelling, artifact-retained, evaluating, terminal and refused. Persist intent
before dispatch. Only inspect/reconciliation can leave uncertain; it cannot
transition directly to a new start. Terminal requires settlement plus stage
outcomes or an explicit unavailable-evidence receipt. Cancellation may end in
terminal/cancelled only after confirmed stop. Evaluator attempts have their own
operation identity and can be recovered without rerunning the builder.

Each stage outcome is passed, failed, not-run or unknown, with a reason code.
Verdict acceptance is independent of execution status: a completed builder with
a rejected artifact is an acceptance failure, not infrastructure failure.
Comparison completion never checks a phase's acceptance box automatically.

## Recovery and rescoring

Plan slots have stable identities; attempts have new IDs and retry parentage.
Resume reconciles the original lease, operation and immutable evidence before
launching only approved missing slots. It never reruns successful work to improve
a score. A lost evaluator response is recovered by its original receipt/artifact
identity. If terminal state is unknowable, keep the slot uncertain and reserved;
do not infer from a missing process alone that no external work occurred.

The event ledger's monotonic generation and lock serialize controllers; stale
controllers cannot settle or dispatch. Archive evidence before marking completion,
and reconcile orphaned attachments by digest after a crash. Rescore creates a
new verdict tied to the same retained artifact and a new evaluator version;
preserve the original. The report identifies its chosen verdict set and shows
changes. Changing acceptance invalidates the old baseline/candidate comparison;
both arms must be rescored under the same new authority when sufficient artifacts
exist, otherwise require a new comparison. Never conceal historical verdicts.

## Initial corpus: real history, not claimed new reproductions

These are development cases. Historical commits were inspected, not replayed for
this design. Freeze the brief and derived acceptance bytes before running. The
fix is provenance for curators, never builder context; export only the starting
revision. Check sources below inform independently controlled behavioral assertions.
Other changes bundled into the original fix are explicitly outside each case.

| Case | Starting revision → historical fix | Frozen task scope and acceptance to implement |
| --- | --- | --- |
| compatibility/package-entry | `edfc56476dd4b7880d8bba83a13436b5a3887a5a` → [fa7477f2](https://github.com/dalmaer/plates/commit/fa7477f2ea26bf56cb0e5f6f5a0904cf213a4e72) | Preserve installed CLI entry targets across rename. Pack/install in a clean synthetic consumer; exercise both supported entrypoints and package paths. `tests/rename.test.mjs` records ERR_MODULE_NOT_FOUND proof. Exclude the unrelated profile fixture edit |
| recovery/canvas-retirement | `d0e9b19fe2067db0a0a60e81e4315028fe5fbe92` → [d57d44ec](https://github.com/dalmaer/plates/commit/d57d44ecae668c7e37713585f33f4e4fadd19566) | Recover interrupted live-disable/retirement without duplicate effects or losing human edits. Inject crashes between durable writes and verify retry behavior; canvas-night/sync tests and issue 129 are provenance |
| initialization/coordinator | `9b1b3b162b9f3b83b91b45e1878fe8ce581cfa98` → [35f39262](https://github.com/dalmaer/plates/commit/35f392620e8e06f0038e1e88370be9b0958b3f19) | Correct first-use guidance and exercise its commands: absent state path initializes under an existing canonical parent; precreated empty coordinator directory refuses because missing state could hide ownership. Never delete/reset it automatically. This was a documentation/procedure failure, not evidence that the runtime should accept empty coordinator directories |
| scoped-repair/rename-ownership | `998b297d12ec6046b6e33918b5f1dd42657e2ac4` → [85316dac](https://github.com/dalmaer/plates/commit/85316dac4a572b4e2a116ab55fc2e86bea5fc08b) | Repair rename ownership without changing unowned automation/runtime bytes; assert atomic refusal and a bounded patch allowlist. Use rename ownership tests and the original Proven-by evidence |
| integration/consumer-options | `5cd3e3e98fb9337ba2fd3242a21559a8ee57f454` → [998b297d](https://github.com/dalmaer/plates/commit/998b297d12ec6046b6e33918b5f1dd42657e2ac4) | Preserve external option names and configured environment in the producer/consumer contract. Exercise a synthetic consumer; exclude the commit's unrelated CI toolchain change |
| control/workspace-command-doc | `331df4591a361ad973c35884c3a4fdaa061c69a8` → [7fca8978](https://github.com/dalmaer/plates/commit/7fca897827ceffcff01d25226015f20235e8655d) | Add the existing workspace command to README's command table, keeping runtime unchanged. Check documented verbs and exact allowed diff. Exclude the accompanying child-process test-isolation repair |

The initialization case must not confuse the budget coordinator with web workspace
initialization: the latter permits an appropriately private empty directory under
its different contract. Pin platform, Node/dependency image and applicable CLI
names per historical revision. Do not apply an entire historical fix as an oracle.

Held-out inventory is currently **zero**. An independent curator must author
private behavioral variants, freeze them and record who has seen them. Public
historical fixes and cases used for candidate tuning are not held-out. Audit the
effective harness context for solution-specific knowledge too: if current context
already contains it, disclose an exposed development replay. Any symmetric
redaction creates an explicitly filtered baseline configuration, not an unmodified
current-harness claim; never conceal that intervention. Exposure
to detailed verdict feedback moves a case to development for later claims;
replace/rotate it for new generalization studies. No claim of unseen generalization
is permitted from this initial six-case corpus alone.

## First milestone and implementation slices

1. Phase 117: typed records, frozen input plan, external experiment storage and
   compatible ledger extension; fake adapters only.
2. Phase 118: one compatibility case through fresh execution, artifact capture,
   independent evaluator and immutable verdict; offline adversarial proof first.
3. Phase 119: paired comparison and recovery. First approved screening compares
   current harness baseline at the recorded revision with one narrow candidate:
   a scoped package-install pre-finish check/instruction. Use compatibility plus
   the ordinary documentation control, five pairs each: **20 builder trials**
   plus bounded setup/evaluation, no unapproved replacements. Candidate cannot
   see the hidden checker or historical patch. Current harness may already solve
   the task; no improvement is a legitimate inconclusive/reject result.
4. Phase 120: expand to all six frozen development cases, with provenance and
   exposure accounting. Do not require paid full-corpus execution to validate
   corpus plumbing; deterministic fixtures can exercise the machinery.
5. Phases 121–123 add selected lessons, one real hypothesis experiment and a
   reviewable promotion proposal through the learning contract.

The first screening report must show actual candidate diff, accepted outcomes,
control regressions, cost/duration coverage and promote/reject/inconclusive
rationale. An offline fake-adapter walk proves architecture, not agent efficacy.
It cannot satisfy the measured screening acceptance box.

## Acceptance and non-goals

Acceptance requires reproducible input identities with explicit unpinnable
limits; isolated arms and evaluator authority; traceable immutable verdicts;
separate failures; total and per-trial enforcement; safe crash/resume and rescore;
raw denominators/uncertainty; and no automatic production promotion. Tests cover
crash points before/after dispatch, artifact persistence and verdict persistence,
concurrent controllers, unknown usage, failed cancellation and forged evidence.

Non-goals: model leaderboards/routing, a new dashboard or scheduler, full-fleet
trials, replacing execution infrastructure, automatic lesson deployment, or
claiming a public benchmark establishes Plates reliability.

## Decisions still required before live execution

- Owner chooses the permitted provider/model, isolation-capable runtime and exact
  minute/currency ceiling after reviewing the concrete 20-trial quote. No amount
  or provider activation is approved by this spec.
- Owner/curator chooses genuinely private held-out material and its disclosure
  policy before a generalization claim; development screening can precede it.
- Owner sets practical cost/latency and regression tolerances in the frozen plan.
  Until then no comparison is eligible for promotion. Defaults cannot invent
  acceptable spending or trade correctness for speed.

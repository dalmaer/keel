# Measuring CLI cost and checking contracts

Keel runs directly from JavaScript source. Performance decisions start with
measurements, and selected production contracts are checked without emitting
or compiling runtime files.

## Measure a command

From the Keel checkout, profile an ordinary invocation:

```sh
node scripts/profile.mjs --output /tmp/keel-status-profile.json -- status --json
```

The destination must be new. Command output and exit status retain their usual
meaning; the timing report goes to the separate private JSON file. The
profiler executes the command you supply: use read-only commands to investigate
cost, and do not add write approval flags just to measure something.

Profiling is opt-in and does not instrument normal `keel` invocations. Records
contain counts and durations, not command arguments, URLs, credentials,
response bodies or command output. A failed or abruptly terminated command
does not become a successful observation.

Interpret the boundaries before comparing numbers:

- **Startup:** time from launching the child through profiler initialization,
  plus a separately measured CLI import interval. It includes profiler cost.
- **Subprocess busy:** the union of observed child-process intervals, not their
  sum. Child internals remain opaque.
- **Direct network busy:** observed fetch/HTTP intervals. Fetch ends at response
  headers; HTTP spans through response end/close. Neither isolates wire latency
  from client or server processing.
- **Overlap:** subprocess and direct-network activity may occur together. Use
  the observed union rather than adding overlapping durations.
- **Local residual:** wall time after profiler initialization outside observed
  operations. It includes imports, filesystem I/O, scheduling and unobserved
  waits. It is not CPU time.
- **`gh` time:** an explicitly identified subset of subprocess time, labelled
  network-capable and opaque. Do not call it pure network latency.

Compare repeated fresh-process runs with uninstrumented runs on the same
machine, distinguish warm filesystem caches from cold starts, and retain
sample counts, ranges, failures and load context. Do not compare sums of
category medians as though they described a single run. Worker threads,
descendants and unsupported network libraries can leave coverage gaps.

The initial results and reproduction commands are in the
[10 October measurement record](research/2026-10-10-cli-cost.md).

For a fixed read-only sample set (`help`, `status`, `next`):

```sh
node scripts/profile-benchmark.mjs --output /tmp/keel-benchmark.json --samples 10 --json
```

Add `--github` to include `doctor --github` and its authenticated read-only
GitHub calls. The report keeps every sample, including failures, with
min/median/p95/max/mean, timestamps and load averages. There is no warmup
discard. Nonzero status means at least one command failed or lost its profile;
read its normal output separately to diagnose it. Individual GitHub calls
have deadlines, but the benchmark has no overall deadline.

## Check contracts without a build

```sh
npm ci --ignore-scripts
npm run typecheck
npm run check
```

The first command installs pinned development dependencies. The second checks
the explicit production JSDoc scope and negative contract examples with
`noEmit`. The third remains the dependency-free runtime and documentation
gate. CI runs the runtime gate and a separate type check.

Keep external input `unknown` until runtime validation narrows it. Prefer
discriminated states to combinations of optional fields that permit
contradictions. Unavailable observations need an explicit absence and reason;
they must not type-check as a measured zero. Static checking cannot establish
whether a GitHub fact is fresh or whether a human accepted completed work.

This is incremental coverage, not a claim that all of Keel is type checked.
The initial scope is `time-receipts.mjs` in the night practice and
`robot-policy.mjs` in climb: available/unavailable plans, complete/incomplete
suite receipts, recorded stalls outcomes and valid/off/enabled robot policy.
Eight negative cases import these actual production contracts. The checker
fails if a forbidden case becomes acceptable. Merge facts and human acceptance
are still outside this typed slice.

The compiler and type fixtures are development tools; neither they nor emitted
JavaScript are required by an installed CLI or adopted project.

## Share installed runtime files between practices

A practice's `files` entries remain the single source and owner of its targets.
Use `requires` only when the consuming project must explicitly enable the whole
other practice. It validates that selection; it does not enable optional
practices automatically.

For a shared runtime without the other practice's workflows or checks, declare
an explicit list in the consumer's `practice.json`:

```json
"runtimeFiles": [
  { "practice": "reconciliation", "path": "scripts/keel/reconcile.mjs" },
  { "practice": "reconciliation", "path": "scripts/keel/decision-context.mjs" }
]
```

Each reference must resolve to an unconditional managed `.mjs` file immediately
under `scripts/keel/`. Missing, seeded, conditional, symlink and workflow targets
are rejected. List every required sibling explicitly; imports are not recursive.
Keep JavaScript imports static and test the installed sibling layout.

Rendering includes those exact files and retains their original `practice` in
`.keel/lock.json`. Selecting both practices still writes each target once. Later
renders and updates retain these lock rows while the consumer is selected, even
when the source practice remains disabled. No workflow, secret, template, check
or configuration membership is inherited. For example, climb receives the two
scripts above while reconciliation's record checks remain off.

A source practice declared in `local` suppresses its runtime imports; individually
`ejected` paths are also left alone. Existing unlocked human files are reported
as edited, never overwritten. Missing required runtime modules stop the robot
before dispatch; the renderer does not restore an ejected or local runtime.
Test init and update from the packed CLI, including repeated updates, retained
source ownership, absent optional workflows, and local/ejected refusal paths.

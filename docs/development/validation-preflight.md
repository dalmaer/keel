# Plan validation and opt in to shared host admission

These source-only tools give early feedback and coordinate cooperative work.
They do not change the configured gate, enable reuse, install into consumers,
change default worker counts or create a schedule. The [phase contract](../specs/validation-efficiency.md)
keeps selection, capability evidence, admission and completed validation separate.

## Inspect the current inputs first

Use the actual supported runtime on PATH and record it after reconnecting or
changing execution environments. The source requires Node at least 24.22.1.
The planner inspects both its process runtime and the Node reached by PATH,
Git/npm availability and the target's engine constraint. An unsupported or
unavailable capability cannot establish a ready plan. It does not install tools
or change global configuration. The existing focused runner also refuses an
unsupported runtime before executing its stages. Source execution also requires
a bounded ephemeral bind-and-close on `127.0.0.1`; this sends no request, changes
no permission and detects sandboxes that cannot run the required server tests.
A refusal requires an execution environment with that capability, never skipped
server assertions. The focused `--plan` preview does not bind a socket.

From a canonical source checkout, this inspects changes against the current
commit without running tests:

```sh
node scripts/validation-plan.mjs --root "$(pwd -P)" --manifest "$(pwd -P)/plates.json" --base "$(git rev-parse HEAD)" --json
```

For a branch's full change set, replace the base with the full local commit ID
that was reviewed as the branch base. The base must already exist locally; no
fetch occurs. The planner reads committed, staged, unstaged and untracked paths,
records revision/dirty/input identity and preserves the configured gate string.
Manifest membership and actual project configuration must agree. It never
imports target repository code or executes the recommended tests.

The map is intentionally small and explicit. Recognized source validation files
select affected test families plus mandatory conventions. Any unmapped path,
rename, shared helper, configuration, workflow or generated input requests broad
coverage. Consumer mappings remain broad in this stage. A missing mapping is not
an empty test set, and a narrow suggestion never waives the full gate. Invalid
input or a changing snapshot cannot produce a usable narrow plan.

Use `--review-input /absolute/canonical/directory` to inspect retained `pr.json`
and `pr.diff` when available. Complete matching input is distinct from an actual
independent review; the planner always reports approval as false. Missing input
stays unavailable. A local Node probe also says nothing about a freshly deployed
function runtime. Source package metadata is compared with its existing reviewed
binding; a mismatch is reported, never automatically accepted or refreshed.

`--help --json` describes flags. Exit 0 means an advisory plan is ready, including
a plan requiring broad coverage; 1 means capability or snapshot instability
blocks readiness; 2 means invalid or unavailable input. None means a gate passed.
Run the configured focused preflight with the suggested explicit test files,
then the unchanged required integrated checkpoint on the final candidate.

## Coordinate cooperative heavy runs explicitly

Admission is opt-in. Every participating worktree and managed repository must
use the same canonical private host state directory and capacity. A different
state directory is a different coordinator; this is not enforcement over every
process on the host. Keep the state directory outside participating worktrees;
admission refuses state inside its target. Capacity and weight are explicit admission units, not a
measurement of CPU time or an automatic change to test worker concurrency.
Conflicting capacity settings refuse admission instead of expanding the budget.

For the first run, pass an absent state-directory path beneath an existing
canonical parent; the wrapper creates that directory privately. Do not pre-create
the state directory. An existing directory without `state.json`, even an empty
one, is refused because missing metadata may conceal lost active ownership.
First-time concurrent initialization can also refuse the losing caller. Stop and
inspect the original path and any participating processes before an operator
chooses a recovery action; the wrapper never resets, deletes or repairs it.

Preview a source gate with capacity one; this neither creates state nor runs it:

```sh
node scripts/validation-budget.mjs plan --manifest "$(pwd -P)/plates.json" --repo dalmaer/plates --root "$(pwd -P)" --state-dir /absolute/private/plates-validation --capacity 1 --weight 1 --foreground-contract --json -- npm run check
```

Use `run` in place of `plan` only when intentionally opting that command into
the shared coordinator. It runs the exact argv after `--`, without shell
interpolation or a retry. The gate itself remains unchanged. Typecheck and any
other required stages remain required separately; admission is not proof that
all configured stages ran. No consumer gate is automatically dispatched.

The explicit `--foreground-contract` acknowledgement means the command and its
descendants remain cooperative foreground members of its POSIX process group.
Commands that daemonize or escape into another session are unsupported. The
wrapper is not a sandbox and does not claim containment of arbitrary code.
A child exiting does not by itself release its capacity: a remaining or unknown
process group retains the lease. Unsupported platforms refuse execution.

Inspect without running work:

```sh
node scripts/validation-budget.mjs status --state-dir /absolute/private/plates-validation --json
```

No lease is stolen because it is old or its PID appears absent. Crashes,
uncertain ownership, unsafe state, missing state metadata and stranded
coordination remain explicit refusals requiring operator inspection. The tool
waits briefly for another writer when updating an already admitted command;
an unresolved lock leaves its ownership uncertain. It has no automatic stale
cleanup. A new attempt never overwrites an uncertain
prior attempt or silently retries its command.

`--capacity N` is required for plan/run; `--weight N` defaults to one;
`--timeout-ms N` bounds execution. `--json` keeps command output on stderr and
structured results on stdout. Retained receipts contain a command digest and
metadata, not arbitrary arguments, environment values or command output.
Active `history` holds at most 200 recent receipts, further bounded by the 1 MiB
state limit. Older complete receipts are preserved in private immutable
`receipts/<sha256>.json` files before removal from active state. Existing matching
archives are verified and durably synced before reuse; conflicting or unsafe
archives refuse without deleting history. There is no automatic archive cleanup.
Confirmed completion preserves the child's exit status; 75 reports retained
or uncertain process-group state, 124 timeout, 128 plus the signal number and 2 refusal. Read
`--help --json` for the exact contract before integrating another caller.

## Retained evidence and the existing nightly audit

Use the [read-only audit entrypoint](validation-audit.md) for the existing single
nightly schedule. Planner and admission reports are observations, not configured
gate attestations. Retain their provenance and unavailable fields when deriving
audit schema-1 input; never relabel an admitted explicit command as a configured
gate or infer CPU duration from wall time. Complete consumer evidence producers
remain phase 114. A nightly audit should inspect retained reports, not execute
these workload wrappers or full suites by default.

Synthetic admitted/unadmitted pairs can show preserved results and contention
behavior. They do not establish pipeline savings. No default change is justified
without the separate paired fixed-head workload evidence required by the spec.

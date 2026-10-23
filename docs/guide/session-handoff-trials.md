# Measure and tune session handoffs

Use this when a long-running conductor might benefit from fresh context and
you want evidence before changing its policy. The protocol extends `retro`;
`improve --sessions` reads the same audit. It does not start agents, schedule
paid work or change phase acceptance.

## Configure one experiment

Save an envelope, for example `handoff-trial.json`:

```json
{
  "version": 1,
  "id": "acme-handoffs-01",
  "provider": "acme-provider",
  "model": "acme-model",
  "cohort": "small-cli-fixes",
  "baseline": { "contextTokens": null, "atBoundary": true, "maxHandoffs": 2 },
  "candidate": { "contextTokens": 250000, "atBoundary": true, "maxHandoffs": 2 },
  "minPairs": 3,
  "minImprovement": 0.15,
  "maxRuns": 10,
  "budgetMinutes": 120,
  "reserveMinutes": 15,
  "automatic": false
}
```

Replace the synthetic provider, model and cohort with the exact scope you intend
to measure. `null` disables a token threshold; it never means zero usage.
Only `contextTokens` differs between the two policies in this version. The other
policy fields remain fixed so one trial does not change several things at once.
`atBoundary` requests handoff at a task boundary; a token threshold requests one
at the next safe stopping point. `maxHandoffs` applies to each admitted task.

`minPairs` must be at least three; `minImprovement` is the required fractional
reduction in total agent minutes for every complete pair. The example's 15%
is a chosen trial margin, not a claimed saving or statistical confidence level.
`maxRuns` must exceed twice `minPairs`, leaving capacity for monitoring.

`budgetMinutes` is the total allowance for this experiment, including summed
builder, reviewer, preparation and reload time. `reserveMinutes` is reserved
before each task. It is not a dollar budget or a process timeout. The calling
harness must also enforce its approved execution limits. The experiment never
increases existing project limits or authorizes a new model bill.

```sh
plates retro sessions start --record handoff-trial.json --json
plates retro sessions start --record handoff-trial.json --yes --json
```

The first command previews without writing. Inspect it; the second records the
envelope. `automatic: true` authorizes this experiment's deterministic policy
promotion and rollback after observations. It does not authorize general retro
suggestions. With `false`, inspect the audit and use `apply` explicitly.

## Reserve before work

Save a descriptor such as `run.json`:

```json
{
  "id": "acme-run-01",
  "provider": "acme-provider",
  "model": "acme-model",
  "cohort": "small-cli-fixes",
  "task": "Acme CLI empty-input correction",
  "taskClass": "argument-validation",
  "sourceRevision": "the-starting-commit",
  "evidence": ["docs/phases/12-cli-input.md"]
}
```

```sh
plates retro sessions begin --experiment acme-handoffs-01 --record run.json --yes --json
```

Use the returned run's policy snapshot. Trial assignments follow ABBA order;
all runs must share the first admitted run’s `taskClass`. Pick genuinely comparable
work before seeing its result. A label cannot make unlike tasks equivalent.
The run owns its reservation until its outcome is recorded. After a timeout or
interruption, inspect status; do not create a replacement identity to hide the
unfinished run. No admission may silently exceed the remaining allowance.

## Handoff and resume

`plates retro sessions handoff --experiment <id> --record <file>` previews a
structured handoff; `--yes` records it. The record names the run and a unique
handoff id, the goal, remaining acceptance, owner choices separately from
suggestions, revision, dirty paths, proof and evidence, active jobs, next action,
claim reference and remaining budget. Use the complete schema in
`plates --agent-help retro`.

The handoff also records current `contextTokens` (or null) and
`boundaryReached`. Only a due recommendation can become a receipt. To check a
current observation without writing, use `status --experiment <id> --record
<observation.json>` with `runId`, `contextTokens`, `boundaryReached`,
`safeBoundary` and `uncertainWrites`. A handoff is refused at an unsafe boundary
or with uncertain writes. Unknown
context occupancy stays unknown: lifetime token usage is not context size.
The CLI records and recommends; the host or conductor performs the actual stop
and relaunch. Resume with the compact handoff and source references, not the
entire old transcript. Recheck the revision, dirty files, jobs and phase claim.
A handoff receipt neither transfers ownership nor authorizes another agent.

## Finish with the entire cost and explicit outcome

Save `outcome.json` with these fields:

```json
{
  "runId": "acme-run-01",
  "totalMinutes": 12,
  "costUsd": null,
  "costSource": null,
  "policyApplied": true,
  "accepted": true,
  "verified": true,
  "lostDecisions": 0,
  "duplicateActions": 0,
  "regressions": 0,
  "rework": 0,
  "contextPeakTokens": null,
  "sourceRevision": "the-verified-commit",
  "acceptanceEvidence": "docs/evidence/acme-cli-input.md#acceptance",
  "evidence": ["docs/evidence/acme-cli-input.md"]
}
```

These are synthetic values illustrating the schema. Supply actual observations;
use null for unknown quality or usage fields. `totalMinutes` must be a measured
positive number, including unsuccessful attempts and all handoff overhead. If
minutes cannot be measured, keep the run incomplete; do not guess a number just
to release its reservation. Dollar cost is informational and needs a source when
provided. The `policyApplied` observation attests that the assigned policy was followed;
unknown adherence cannot establish a winning threshold. A merge cannot supply acceptance. `verified` describes the named proof,
not production verification or lived-in use.

```sh
plates retro sessions finish --experiment acme-handoffs-01 --record outcome.json --yes --json
plates retro sessions audit --experiment acme-handoffs-01 --json
plates improve --sessions --json
```

The audit reports better, worse or inconclusive with pair identities, evidence,
coverage and budget. A shorter context alone is not success. Missing outcomes,
unknown quality and failed work cannot be excluded to manufacture a winner.

## Apply, monitor and roll back

```sh
plates retro sessions apply --experiment acme-handoffs-01 --json
plates retro sessions apply --experiment acme-handoffs-01 --yes --json
plates retro sessions rollback --experiment acme-handoffs-01 --yes --json
plates retro sessions status --experiment acme-handoffs-01 --json
```

Apply rechecks current evidence under the write lock. It selects only the
candidate already pinned in the envelope. Any reservation or allowance overrun prevents a positive verdict, without
dropping the measured overrun. A safety rollback selects the baseline
and keeps observations and history. Automatic mode does this after recording
outcomes when the evaluator has sufficient evidence, and rolls back on subsequent
adverse quality evidence or a cost exceeding the worst comparable baseline
by more than `minImprovement`. A rolled-back trial must not regain promotion from its
old winning samples. Start a new experiment for a revised hypothesis.

Observations are explicitly supplied attestations: the CLI validates their shape,
not the truth of the linked proof or measured usage. Audit output labels that
coverage. Records live in `.plates/session-trials/`. Keep them for audit and recovery; no
transcript text, credentials or private application data belongs there. After an
uncertain write, read status before proceeding. A busy or abandoned-looking lock
requires inspection, not an automatic age-based override. Invalid storage is
unavailable rather than an empty history.

The initial delivery proves the protocol, not that 250k improves Plates. Follow
normal authorized work, retain unsuccessful experiments, and promote fleet-wide
defaults only after real comparable evidence. See the
[design and limits](../specs/session-handoff-trials.md).

A run descriptor may include `decisionTarget: {"kind":"phase","ref":"0"}`
(or kind `issue`, with `owner/repo#n`). Begin and handoff resolve it afresh,
refuse broken required context and retain `decisionDigest`; responses include
`decisionBundle`. Before a resumed builder starts, run `plates decision context`
again for that target and revalidate claim ownership. Existing runs without a
target keep their previous behavior; owner choices and suggestions remain distinct.

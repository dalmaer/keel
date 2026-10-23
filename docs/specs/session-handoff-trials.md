# Session handoffs that learn from evidence

Decision: 12 October 2026. Phase 72 implements a local experiment protocol under
`plates retro sessions`, with the same read-only audit available through
`plates improve --sessions`. The existing phase, evidence and acceptance records
keep their authority. This is a measurement ledger, not another task tracker.

## Problem and provenance

Long-lived conductors may repeatedly process context that no longer helps the
next task. A fresh session can avoid some of that work, but preparation,
reloading, lost decisions and duplicated actions can cost more than it saves.

The owner pointed to BenOS's session-economics policy: `bgalbs/benos3`,
`CLAUDE.md` section Session economics and
`.claude/skills/plan-a-release/SKILL.md`, commit
`b426978180f5f3c00fafcb319b2491477c1936f3` (11 October 2026).
It recommends a handoff at roughly 250k context or an issue boundary and reports
a replay estimate of reduced reread volume. Its referenced user-local
`context-watch.py` is not in that checkout or on this machine. No BenOS source
or prose is copied here; no license file was found in the inspected checkout.
This design independently implements the idea. The estimate is not a measured
Plates saving, and 250k is an experiment parameter, not a universal optimum.

## Authority and scope

A project starts with no active experiment. Starting one requires an explicit,
versioned envelope and `--yes`. The envelope pins provider, model and workload
cohort, the baseline and candidate policies, observation requirements, margin,
run limit and agent-minute allowance. Starting an experiment does not grant
permission for a new paid job. Existing project spending limits still apply;
the experiment cannot enlarge them. No scheduler or model launcher is added.

The first implementation varies one parameter: the context-token threshold.
Both arms keep the same boundary policy and maximum handoffs. Separate projects,
models or workloads require separate experiments. Policies are immutable for
an experiment; a new candidate gets a new experiment identity.

`automatic` permits a deterministic promotion or rollback of this experiment's
effective policy when an observation is recorded. It never edits a skill,
project configuration, source acceptance, permissions or spending limits. The
normal retro remains owner-selected advice. This narrow permission is not a
license for autonomous changes to unrelated practice.

## Admission and observation

Reserve a run before work starts. Assign baseline and candidate in repeating
ABBA order; pair adjacent observations and pin the task class at first admission. Each run binds its workload, provider,
model, source revision and policy snapshot. The recording session must supply
explicit evidence pointers. Never guess which provider's transcript belongs to
this task by choosing the newest file.

Reservations count against both the run cap and the total minute allowance.
An unfinished run retains its reservation; an overrun prevents further
admissions. Admission is accounting, not a process watchdog: the caller must
also enforce its execution timeout. Count builder, reviewer, handoff and reload
minutes, including failed attempts. Parallel agent minutes are summed and must
not be labelled elapsed wall-clock time. Cost is optional, measured evidence;
unknown dollars stay null and are not derived from tokens with guessed rates.

Record whether the assigned policy was actually followed; assignment alone
is not evidence of adherence. Null or false adherence cannot establish a winner.
Record accepted and verified outcomes separately from merges. Evidence must
support acceptance; the recorder does not adjudicate it. Capture lost decisions,
duplicated actions, regressions and rework. Unknown is null, never zero.
Context peak means observed context occupancy, not lifetime token consumption.
Keep the source pointers with the observation; arbitrary transcript bodies,
credentials and application payloads do not belong in these records.

## Safe handoff

The conductor follows the reserved policy and prepares a compact handoff only
at a safe boundary. A context threshold is a request to find the next safe
boundary, not permission to interrupt a remote write. Unknown occupancy cannot
trigger a threshold claim. A saved handoff records:

- the goal and remaining acceptance;
- the person's decisions apart from agent recommendations;
- revision, dirty paths and exact next action;
- proof and evidence pointers;
- running jobs and unresolved work;
- the claim reference and remaining budget.

A handoff with uncertain writes is refused. Each saved handoff counts against
the reserved policy's maximum. The receiving session rechecks the tree, reads
current records, resumes existing job handles and verifies its phase ownership.
A handoff receipt never transfers a phase claim, releases somebody else's claim
or authorizes a replacement agent. Use the existing claim mechanism. Do not
fork the full transcript and call the result fresh context.

## Audit and adaptation

The audit is read-only, deterministic and rerunnable from durable records.
Report sample identities, policy snapshots, paired coverage, incomplete or
excluded evidence, numerators and denominators, minute usage and uncertainty.
The primary measure is total agent minutes per accepted, verified task. Unknown
or unsuccessful outcomes block a positive verdict; failed work is never silently
removed to make the candidate look cheaper.

At least three complete matched pairs are required. Every pair must clear the
configured improvement margin with accepted, verified outcomes and no worsening
of the quality counters. Incomplete coverage, zero denominators, mixed workloads
or inconsistent results are inconclusive. Adverse quality evidence is worse.
These are conservative operational rules, not a statistical significance claim.
Explicit records are attestations; runtime validation does not independently
verify their evidence pointers or provider usage. The audit labels this coverage.

`apply` recomputes the audit under the write lock before selecting the candidate;
it cannot trust a saved verdict. Automatic mode uses the same evaluator after
recording outcomes. Subsequent observations monitor the selected policy; a
quality regression returns it to the baseline. A monitored cost exceeding the
worst comparable baseline by more than the configured improvement fraction also
returns it to the baseline; this margin avoids reacting to small fluctuations. Inconclusive evidence never
silently establishes a winner. Rollback preserves the old observations and
transition history. It does not erase a failed trial or restart the allowance.

## Durability and failure behavior

Keep bounded records beneath `.plates/session-trials/`, isolated by project and
experiment identity. Validate external JSON at runtime, reject unknown or unsafe
identities and symlink escapes, serialize writers and atomically replace state.
Retries must not duplicate reservations, outcomes or handoffs. Conflicting reuse
of an identity is an error. Preserve receipts after an uncertain write and read
back before taking another action. Corrupt state is unavailable, never empty.
A stale-looking lock is not evidence its owner has stopped.

## Delivery and what remains to learn

The CLI, agent help and conductor guide expose the protocol without changing
installed fleet skills. An adapter must explicitly call admission, handoff and
outcome recording; this phase does not claim automatic rotation in Codex or
Claude, or that either host exposes all needed usage metrics.

Use normal authorized tasks for the first pilot, collecting a baseline before
claiming a saving. Paid repeated tasks, wider thresholds, new schedules and
fleet-wide defaults are separate decisions. Real-world effectiveness remains
open until comparable outcomes exist. A tested evaluator proves its arithmetic
and refusal behavior, not the value of a particular threshold.

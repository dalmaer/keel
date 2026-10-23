# Each plate owns verification

Dated 2026-10-23. Extends design's night shift, phase 15, reconciliation (26),
and claims (70). The fleet coordinates evidence, never substitutes for a plate's
own validation. GitHub owns merge facts; phases own acceptance; decisions own
architecture. Implemented, merged, accepted, production-verified and lived-in stay
separate.

## Producer: existing project night

Use the existing improve/night measurement path and its configured gate exactly
once. Add a versioned structured verification receipt to its retained report,
with bounded sanitized fields: repository identity, observed time, actual checked
revision/dirty state, observed remote default branch and SHA, gate result and
local-versus-reused attribution, record reconciliation coverage and findings,
claim/PR observations and coverage gaps. Do not manufacture missing evidence.
Read remote metadata even when source is unchanged. Gate reuse remains governed
by the existing exact-revision policy, not by this receipt.

Persist within the current report/artifact mechanism, with an explicit reader
contract rather than parsing human prose. Retain attempts and prior evidence;
never overwrite historical verification merely to make the latest look green.
Fresh workflow checkouts recover the prior same-day night report from its exact
observed branch head before writing. Publication uses that head as a push lease;
changed branches or conflicting local report bytes refuse replacement. Recovery
failures cannot publish. This retains failed attempts across unmerged retries.
Report read failures separately from actual negative findings. Reports may
legitimately describe their pre-report source SHA; a later report commit is not
silently equivalent to that source. Expose source mismatch honestly.

Claim findings distinguish completed-phase leftovers, duplicate explicit/open-PR
ownership, idle-by-last-observation candidates, and unknown activity. No absence
of commits proves a session stopped. Read-only API calls have limits and timeouts;
full pages or unavailable permissions are gaps unless pagination is completed.
Do not release claims, delete branches, merge or alter source records. Local
machine/worktree/session coverage remains explicitly unavailable in hosted runs.

## Consumer: existing fleet

Pin each project's actual remote default branch and SHA and read its latest
verification receipt. Validate schema, repository, revision and timestamps,
bounds and coverage before summarizing. Distinguish current, behind, stale,
missing/not-yet-adopted, malformed and unavailable states. A current receipt with
failed checks or gaps is not healthy. Old success is never current verification.
Fleet reads never run install, tests, gates or agents in consumer projects.
Continue reading other projects if one is unavailable.

Expose results in fleet JSON, its table/Needs you and existing health/morning
report surfaces where those consume the same record. The home project includes this same fleet summary in its existing nightly health
report through its Plates-side instruments; adopters only collect their own
verification. A repository-scoped workflow token may lack fleet access, which
must appear as unavailable coverage rather than prompting a broader grant.
No separate database or new recurring schedule. Present findings with source links and concrete next
actions. Existing per-project production, reconciliation and gate records remain
authoritative; no reimplementation of their semantics or new acceptance score.

## Delivery and boundaries

Ship through the existing night practice. Plates consumes its own practice.
No CLI verb is required: extend existing improve/fleet contracts and their help.
Synthetic Acme fixtures exercise real helpers and subprocess boundaries. Include
negative tests for malformed/foreign/stale receipts, newer main, missing coverage,
completed claims and open PRs. Provider-authenticated execution attestation,
consumer rollout, automatic cleanup and observed multi-night usefulness are
outside this implementation and must not be implied by source tests.

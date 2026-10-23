# Evidence: 111 — focused planning and opt-in admission preserve complete gates

- Date: 2026-10-22.
- Phase: 111.
- Revision: reviewed phase 110 base `0f8b157a9a879d7ec1383c19b0d0f1b67ae6f2a9`, contract commits `cb1cc741` and `11ecc6c3`, and the working tree for `phase 111: Focused feedback starts with capability and resource checks`.
- Claim: conservative source feedback and cooperative host admission are available without changing required gates, worker defaults, freshness authority or consumer installations.

## Boundaries and decision

The parent independently accepted phase 110's exact head, complete 23-file diff,
checks and zero-finding fresh review as the boundary for continuing this stage.
That decision grants no merge, deployment or broader adoption. Phase 110's
reviewed worktree remains unchanged. This separate branch is stacked explicitly
on that head, excluding canonical main's unrelated unpushed email commit.

The phase was claimed before dispatch. The refreshed decision context digest
`ff62369e61b151aa04e413624d4dcc868d97b055c58d817ffe38ec9ef1801b63`
was `not-configured`, with no accepted choices, proposals or gaps; this is not
verified decision coverage. Two builders owned disjoint planner/capability and
admission files. The conductor owns documentation and verification.

Admission explicitly requires cooperative POSIX foreground process groups.
Daemonizing or session-escaping commands are unsupported, and unsupported
platforms refuse execution. This limitation was recorded in a separate contract
commit before implementation. Every participant must use the same private state
directory and capacity; commands outside that protocol are not controlled.
No stale owner is automatically removed. A command's admission is not a gate
attestation, review approval or permission to reuse any result.

## Automated checks — 2026-10-22

The changed-file inventory includes new scripts/tests, source agent guidance,
README, development guide, specs, phases, evidence and generated roadmap.
Package metadata, lockfile, reviewed capability bindings, workflows, managed
skills and adoption templates are unchanged. Their existing convention checks
remain mandatory because source changes can affect their contract indirectly.
New files are marked intent-to-add before Git-based checks.

The focused command is:

```sh
npm run check:focused -- tests/validation-plan.test.mjs tests/validation-budget.test.mjs
```

It combines those files with `helpers`, `docs`, `guides`, `cli`, `adopt`, `skill`,
`guide-consumers`, `web-operation-coverage` and `check-focused` tests, then runs
roadmap, render, inbox and HEAD-whitespace guards. The supported Node executable
and PATH must agree before planning and before every stage. Scoped typecheck
uses `npm run typecheck`. The unchanged integrated checkpoint is `npm run check`;
it includes all ordinary tests, stall receipts and roadmap/render/inbox guards.
Its final result belongs in the implementation commit body, after this record.

Conductor verification on 2026-10-22: the exact focused command above passed
139/139 tests, zero failures, exit 0, reporter wall 71.966 seconds. All five
stages completed successfully. Scoped typecheck also exited 0. The 18-case
admission file is included in this combined result. Documentation-only record
updates are checked again with docs/guides and roadmap/render/inbox/whitespace
before the integrated gate. The later loopback-capability correction below requires fresh focused verification.

Builder planner/capability verification passed 26/26 with the helper guard,
exit 0, reporter wall 6.631 seconds. Regression cases cover staged shared paths,
index-blob changes with identical working bytes, runtime/PATH disagreement,
unknown engines, missing tools, binding drift, complete review bytes versus
approval, Git filter refusal and unsafe executable resolution.

Actual source inspection on the supported Node 26.12.1 process and PATH returned
an advisory ready plan with **broad** coverage, verified existing package binding,
and unchanged `npm run check` plus typecheck requirements. This does not mean
validation passed. Two actual CLI negative controls exited 2 before tests:
Node 24.13 is below the floor, and Node 26 with the older Node on PATH disagrees.
These directly cover the execution-environment recovery failure recorded in
phase 110. No binding refresh was needed in phase 111.

## Failed attempts and independent inspection

Early admission-focused tests failed on fixture assumptions: a timeout need not
allow a child to create a startup marker, and initial competing writers may see
state initialization before a usable status record exists. Fixed sleeps and
unguarded negative-PID cleanup were replaced with bounded observed ownership
handshakes. A confirmed-start signal test separately proves cleanup; a deadline
may prevent startup, but must never retry it. Original failing logs are retained. One early race fixture also encoded its newline incorrectly; this was corrected rather than treated as a production failure. The evidence front matter initially used an unquoted JSON path, and roadmap generation rejected it before the combined preflight; the corrected record passes.

Independent local inspection found a real lifecycle defect: an ordinary short
coordination collision during an admitted command's bookkeeping could kill that
command or retain a completed command as uncertain. Internal owned updates now
wait boundedly for the existing writer without deleting or stealing its guard;
new admissions remain conservative. The companion regression holds a fixture's
coordination guard across a confirmed child exit, checking eventual original
exit status and release, or retained capacity if the guard remains stranded.
The execution deadline also begins at spawn, before waiting for bookkeeping.
The disposable negative control and final focused results are retained with the
handoff evidence. No integrated suite was used to discover these issues.

## Execution-capability omission — 2026-10-22

The first integrated attempt ran in the restricted execution sandbox and exposed
five board server failures after the earlier focused set passed. An unchanged
isolated server case reproduced `listen EPERM: operation not permitted 127.0.0.1`
with exit 1; the identical case passed with normal authorized host execution,
exit 0. The conductor stopped only its verified gate process group, retaining
exit 143 and the failure log. Process inspection observed 196 seconds elapsed
before stopping; this is a lower bound, not final wall or CPU time. CPU is unknown.

This was a failed early-capability guardrail, not a product regression or a pass.
The runtime/tool preflight omitted a capability the source's full server tests
require. Contract commit `4c6f6be` adds a fixed bounded ephemeral loopback
bind-and-close probe before source suite execution. It sends no request and
changes no permissions; refusal blocks execution rather than skipping tests.
The actual corrected restricted runner refused with exit 2 in 0.305 seconds,
before any test stage. The capability/helper set passed 28/28 with authorized
execution. The conductor's corrected combined command then passed **248/248**,
zero failures, exit 0, reporter wall **127.895 seconds**, with all five stages:

```sh
npm run check:focused -- tests/validation-plan.test.mjs tests/validation-budget.test.mjs tests/board.test.mjs tests/promote.test.mjs tests/verify.test.mjs tests/robot-runtime.test.mjs
```

This includes the mandatory nine convention files and the four existing local
server test files identified from actual server dependencies. Scoped typecheck
also passed after the correction. The final integrated command must run with
the same supported runtime and authorized local execution capabilities. All old evidence
remains intact; no suite is rerun merely to fill audit evidence gaps.

## Exact-head CI and review corrections

The first local complete checkpoint at implementation `7a2e94e` passed 2,840/2,840
ordinary tests, all eight stall files and record guards: 343.83 seconds wall,
1,855.92 seconds user CPU and 929.18 seconds system CPU. CPU includes concurrent
children and is not elapsed time. The clean-head hosted run
[39870670148](https://github.com/dalmaer/plates/actions/runs/39870670148)
then failed one fixture with 2,835 passes and four existing platform skips;
all eight stall files passed. Ordinary reporter wall was 424.080 seconds;
configured-gate step timestamps span 432 seconds, which overlap that interval.
Hosted CPU is unavailable. The fixture observed a PID file's existence before
its contents were published. This is distinct from the independent review's
history finding, and the failed attempt remains evidence, not a green checkpoint.

The normal configured review at the same head inspected the complete 19-file,
151,068-byte diff against reviewed phase 110. Its artifact digest and exact bytes
were verified. Its valid finding showed unbounded completed history could fill
the 1 MiB state limit and block both admission and confirmed lease release.
Contract `fd215c5` requires preserving complete receipts before bounded active
history replacement. The correction keeps at most 200 recent receipts, archives
older complete values privately and immutably, and refuses unsafe/conflicting
archives. Independent local inspection also required syncing a reused matching
archive's verified file handle before pruning active history, covering an
interrupted prior archive write. Neither correction deletes history or steals
leases. Normal `plates prove` controls reproduced the old near-capacity refusal
and the old completed-command exit 75, then passed with the fix.

The next combined focused checkpoint includes both validation files and all nine
mandatory convention files, then roadmap/render/inbox/HEAD-whitespace and scoped
typecheck. Package metadata, reviewed bindings, generated managed skills and
adoption files remain unchanged. Existing server files need no additional isolated
rerun for this budget-only correction; they remain included in the unchanged
required final integrated gate. Corrected exact-head CI and fresh review remain
required. No unaffected hosted jobs are manually restarted.

## Measurements and limits

Five synthetic admitted/unadmitted pairs use the identical Acme sum workload.
They compare actual result/exit status and retain separate wall observations,
CPU unavailable and no overlapping-span addition. These are correctness and
admission observations, not a pipeline benchmark or measured speedup. Full
fixed-head paired workload trials are still required before any proposed change
to concurrency defaults; this PR changes none.

The historical audit replay and phase 110's wall/CPU measurements remain in their
original evidence. The single existing nightly schedule can use phase 110's
reviewed `scripts/validation-audit.mjs` and documented schema-1 input. Planner and
admission receipts are not complete configured-gate attestations; phase 114
still owns complete consumer producers. No new schedule or delivery change was
made, and this work never accessed or modified the data checkout.

## Gaps and next action

Final integrated verification, clean exact-head CI and the configured independent
cross-review are required before parent review of this stage. The PR will remain
draft at handoff after normal review. Parent review is required before broader
rollout; no consumer execution/adoption, merge, deployment or production claim
follows automatically. Phases 112–115 remain separate reviewed stages.

# Evidence: phase 123 — review packages and dormant promotion

- Date: 24 October 2026.
- Phase: [123](../phases/123-lesson-promotion.md).
- Design revision: cdaff56ae18bcab9d611e91e7c726c2ba6c82d7d.
- Scope: inspectable packages and explicit local follow-up, plus independent
  provider verification of exact review and source inclusion. No live efficacy,
  production promotion, approver activation or deployment is claimed.

## Real GitHub policy read

From the implementation worktree:

    PATH=/opt/homebrew/bin:$PATH TZ=UTC node --input-type=module -e 'import {inspectLearningApprovalPolicy} from "./lib/learning-approval-github.mjs"; const r=await inspectLearningApprovalPolicy({repo:"dalmaer/plates"},{deadline:Date.now()+60000}); console.log(JSON.stringify(r,null,2));'

The command exited 0. Two fresh bounded reads agreed on canonical repository
1402587435, default branch main at 22d7e50c80ab85ae16e27557499eee596e09b1e0,
and state not-configured with policy null. Source digest:
ebd434b7518c5ad835235478426208f92df9e6c774ef23bc370bad0ad1963d14.
Result: /tmp/plates-phase123-policy-read.json; stderr was empty.
No configuration, account, permission, remote state or paid provider was changed.
This observation establishes absent configured authority at that source revision,
not permission to install it or proof of physical human approval.

## Independent provider verifier

The secondary builder used actual generated Acme Git blobs, trees and two-parent
commits, with only the external GitHub transport simulated. Its seven verifier
tests passed; a final narrower decisive-review guard test passed separately.
Existing review compatibility passed 62 tests. All commands exited 0; exact
commands and execution receipt IDs are retained in
/tmp/plates-phase123-approval-handoff.md. Builder output was captured in the agent
conversation, not persistent raw log files; do not infer nonexistent log files.

Coverage includes missing/changed/candidate-only policy, numeric account identity,
Bot/self-approval refusal, stale or dismissed reviews, outstanding change requests,
exact action/package markers, complete review pagination, actual Git object hashes,
extra files/modes, missing trees, unsupported topology, and inverse deletion.
Two fresh observations detect observed changes; they do not make GitHub atomic.
Only exact two-parent topology is supported. Source inclusion is not installation,
acceptance, production verification or lived-in use.

A retained initial verifier failure came from the pagination fixture replacing
page=1 inside per_page=100. The correction targets &page=1; the missing-page
refusal had worked correctly. This was a fixture error, not a flaky retry.

## Remaining implementation and acceptance gaps

Supported real screening remains unavailable: phase119 lacks live provider and
spending integration; the historical target/control cohort needs per-case
configuration environment mapping; publication mapping lacks verified installed
invocation/routing. Package readiness therefore remains unavailable, even if
synthetic arithmetic is favorable. No fabricated routing attestation or injected
ready record is used to claim a positive public promotion walk.

An actual promotion also requires independently configured default-branch owner
approver IDs and an exact reviewed package PR. Neither was activated here. No PR
is created or merged by these commands. Requests and observations of rollback
remain distinct; an inverse source merge is not serving-revision verification.
Phase119's three-round review hold and cancellation finding remain unresolved.
The phase stays partial without an owes:walk shortcut over missing code.

## Owner-machine public CLI walk

Command:

    PATH=/opt/homebrew/bin:$PATH TZ=UTC node --import ./tests/helpers/hermetic.mjs docs/evidence/2026-10-24-lesson-promotion-cli.mjs

Exit 0. The fresh private Acme workspace retained 47 CLI observations, 20 actual
isolated offline Docker trials, one immutable report and a deterministic review
package. GitHub finding transport was simulated; the CLI, Git, Docker execution,
artifact acceptance, retained report verification and local inbox writes were real.
Copied runtime files matched the frozen implementation except the deliberately
synthetic corpus catalog. No agent efficacy or provider spending was measured.

The conductor independently checked canonical payload/artifact hashes, repeated
read-only package bytes, no artifact creation, unchanged report/inbox inventories
on preview, stale-digest refusal, original-operation deduplication, refusal of
readiness, explicit null follow-up outcome measurements, and a new proposal
version preserving all original records and report bytes.

- Workspace: /private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/acme-learning-qfRdaA.
- Log: /tmp/plates-phase123-conductor-cli.log.
- Report digest: 7634baa023ca8c15aa369e07a3aea54902d0ac2b6fdfe15d78993624a464acd0.
- Package digest: 369024f7983d1e2f769644b773338cb0f9585534db089a8431740db994649520.
- Disposition: inconclusive; final new proposal state: proposed.
- Readiness: false; gaps publication_mapping_unverified,
  provider_integration_unavailable and screening_not_supported.

Empty follow-up selections yielded zero selected source records, not measured
zero recurrence. Eligible exposure, recurrence rate, cost change, latency change
and human-help change were all null; coverage remained unmeasured.

## Focused implementation evidence and retained failures

Builder focused/convention command:

    PATH=/opt/homebrew/bin:$PATH TZ=UTC npm run check:focused -- tests/lesson-promotion.test.mjs tests/lesson-package.test.mjs tests/learning-approval-github.test.mjs tests/evaluated-lessons.test.mjs tests/lesson-screening.test.mjs

It reported 147 passed, one failed, zero skipped, exit 1. The installed next check
ran while the conductor's phase evidence frontmatter was temporarily invalid;
its assertion retained exit1, without detailed stdout. The conductor's roadmap
log independently records the malformed evidence field. Correcting it to the
repository's quoted docs-relative JSON format and making new files visible to
inventory checks produced a separate installed-check pass (1/1, exit0), not an
unexplained retry. Final guide-only checks passed 6/6. Logs:
/tmp/plates-phase123-focused-final.log, /tmp/plates-phase123-install-current.log,
/tmp/plates-phase123-guide-final.log, /tmp/plates-phase123-roadmap-preproof.log
and /tmp/plates-phase123-roadmap-preproof-corrected.log.

Earlier package tests exposed an unshipped roadmap import and excessive duplicated
nested report data; both were corrected without increasing the parser limits.
A lifecycle test syntax error is retained separately. Source mapping and binary
prior-file tests passed; unavailable inverse bytes never become a zero measurement.
Pure synthetic lifecycle checks exercise readiness, promotion, pending rollback,
observed rollback and follow-up revision. They are state-schema proof only, not
an injected controller success or observed real promotion.

Conductor typecheck exited 0: /tmp/plates-phase123-typecheck.log.
The final integrated gate remains distinct from focused and actual-surface proof.

The conductor's named focused/convention command (lesson-promotion,
lesson-package and learning-approval-github tests) completed 123 passed, one failed,
zero skipped. The sole failure was the CLI doctor contract: the conductor's new
real-promotion acceptance item lacked a named check. The retained failure names
that exact lint. The item now explicitly names the owner/conductor manual check,
while keeping missing implementation interfaces separate from approval.
Log: /tmp/plates-phase123-conductor-focused.log. New runtime tests passed; no
runtime guard was weakened and no broad focused rerun was used to erase failure.

The isolated corrected CLI JSON contract exited 0 (1/1):
PATH=/opt/homebrew/bin:$PATH TZ=UTC node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='json parses for every verb' tests/cli.test.mjs.
Log: /tmp/plates-phase123-cli-contract-corrected.log. Final roadmap generation
also exited 0. The integrated command is PATH=/opt/homebrew/bin:$PATH TZ=UTC
npm run check; its observed result is recorded at the integrated checkpoint.

## Integrated checkpoint — 24 October 2026

The conductor full gate exited 0: 3,065 passed, zero failed, 11 opt-in skips.
All nine stall-injection suites and roadmap/render/inbox guards passed. The test
ledger reported no flaky or slower tests (31 retained runs; 16 busy runs omitted).
Log: /tmp/plates-phase123-check.log. Runtime hashes still matched the builder
freeze after the gate; subsequent edits record these results and phase checkboxes.
Typecheck independently exited 0. Exact-head CI and review remain separate; this
checkpoint establishes neither merge nor production acceptance.

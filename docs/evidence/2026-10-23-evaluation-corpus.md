# Evidence: phase 120 — historical development corpus

- Date: 23 October 2026, America/Denver.
- Phase: [120](../phases/120-evaluation-corpus.md).
- Revision: `e3160506d65408e48e23b1f5ca546b356a749a1c` plus working tree (implementation recorded by the containing commit).
- Claim being checked: six historically grounded, bounded development cases with independently controlled acceptance; no paid-agent efficacy or held-out claim.

## Dependency-scope observation

```sh
PATH=/opt/homebrew/bin:$PATH node docs/evidence/2026-10-23-evaluation-corpus-closure.mjs
```

Exit 0. At historical starting revision
`d0e9b19fe2067db0a0a60e81e4315028fe5fbe92`, four required modules in the broad
snapshot-producing path total 298,134 bytes, exceeding the existing 262,144-byte
delivery ceiling by 35,990 bytes. The actual exporter refuses that set. A broader
literal-import inventory finds 47 files and 1,311,759 bytes; it is not a claim to
have resolved every dynamic resource. Log:
`/tmp/plates-phase120-retained-closure.log`.

The original recovery regression uses caller-supplied cards through `canvasLive`
and `canvasSync`. Its core module is 74,108 bytes at the starting revision. The
case will exercise that actual surface, including interruption/retry and human
edit preservation; snapshot/history collection and recovery-state export are
outside this case. No delivery limit was raised or internal module replaced by a
stub. At this observation the exercised closure and broken/corrected behavior remained unverified; the final replay below resolves that gap.

## Automated checks

At the initial design observation, implementation and focused/convention checks had not run.
The final integrated commands are `npm run check` and `npm run typecheck`;
The final results below identify the checked tree. No acceptance is inferred from
this design observation or from a future merge.

## Gaps and decision

All six historical cases are exposed development cases. Held-out coverage is
zero. No paid model trial, measured harness improvement, promotion, production
activation or lived-in behavior is established. Phase 119's separate cancellation
review-limit decision blocks merging its dependent branch; this evidence cannot
waive that decision.

## Independent guidance controls — 24 October 2026

```sh
PATH=/opt/homebrew/bin:$PATH TZ=UTC node --import ./tests/helpers/hermetic.mjs docs/evidence/2026-10-23-evaluation-corpus-language.mjs
```

Exit 0. Two supported independently worded/reordered procedures passed actual
coordinator initialization/run and precreated-empty-state refusal in the pinned
Docker image. Five controls—contradictory precreation, negated absent-path rule,
missing no-precreation obligation, shell suffix and extra command—failed with
the intended refusal before subprocess execution. These are expected negative
outcomes, not hidden failures or retries. The probe recognizes bounded sentence
forms; this does not establish universal semantic grading.

Log: `/tmp/plates-phase120-conductor-language.log`. Immutable per-control results
and summary remain under
`/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/acme-corpus-language-cQqAHA`.
No paid agent or publication was invoked.

## Exposure finding — 24 October 2026

The builder's final review found that the guidance probe still delivered exact
accepted sentence forms. The earlier language controls established behavior but
did not establish answer isolation. Those forms are being moved into evaluator-only
input through the existing stdin contract. The final replay and export inspection
must verify the corrected boundary; earlier observations remain retained above.

## Final independent replay and installed CLI — 24 October 2026

```sh
PATH=/opt/homebrew/bin:$PATH TZ=UTC node --import ./tests/helpers/hermetic.mjs docs/evidence/2026-10-23-evaluation-corpus-walk.mjs "$PWD"
PATH=/opt/homebrew/bin:$PATH TZ=UTC node --import ./tests/helpers/hermetic.mjs docs/evidence/2026-10-23-evaluation-corpus-replay.mjs "$PWD"
PATH=/opt/homebrew/bin:$PATH TZ=UTC node --import ./tests/helpers/hermetic.mjs docs/evidence/2026-10-23-evaluation-corpus-language.mjs
```

All three exited 0. The public CLI walk retained 28 observations covering six
exports, preview approval, stale digest refusal, byte-hash readback, existing
destination refusal, package installation and identical installed case identities.
Its private record is
`/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/acme-corpus-walk-5rbkvw`.

Fourteen isolated Docker stages covered all six original/corrected pairs, with
both live-disable and live-key-removal variants for recovery. All setup and
termination checks passed; each original failed the intended acceptance and each
scoped corrected artifact passed. The recovery interruption is an injected EIO
between durable writes, not a SIGKILL claim. No internal runtime was stubbed.
Receipts: `/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/acme-corpus-replay-9Yv6sf`.

The final guidance run repeated the two positive and five negative controls with
accepted forms supplied only through evaluator stdin. Builder exports omit those
forms; the evaluator retains their hash-bound material. This resolves the exposure
finding, not the disclosed limitation that the checker recognizes bounded forms.
Logs: `/tmp/plates-phase120-conductor-walk.log`,
`/tmp/plates-phase120-conductor-replay.log`,
`/tmp/plates-phase120-conductor-language-private.log`.

Builder focused proof after the correction passed 130 tests with six opt-in
Docker skips; the conductor separately exercised Docker above. Initial guide
validation failure and earlier diagnostic runs remain in their original logs,
including `/tmp/plates-phase120-focused-first.log`. The final focused result is
`/tmp/plates-phase120-focused-private-oracle.log`. The integrated gate result is recorded below.

## Integrated gate — 24 October 2026

`PATH=/opt/homebrew/bin:$PATH TZ=UTC npm run check` exited 0: 2,999 passed,
zero failed, 11 opt-in skips, all nine stall-injection suites passed. Roadmap,
render and inbox guards passed. The ledger found no flaky or slower tests
(28 retained runs; 13 busy runs omitted). Log: `/tmp/plates-phase120-check.log`.
`PATH=/opt/homebrew/bin:$PATH npm run typecheck` exited 0; log:
`/tmp/plates-phase120-typecheck.log`. This checks the implementation on
`e3160506d65408e48e23b1f5ca546b356a749a1c` plus the phase-120 changes retained
in this commit. Subsequent record-only changes reconcile these observations.

Implementation is built locally. Review and merge remain separate, and the
phase-119 owner decision still prevents landing this dependent branch. No
provider trial, accepted lesson, production verification or lived-in claim follows.

## Exact-head review and CI — 24 October 2026

Phase 120 implementation commit `d2cac70b7a1a24440ab74433e6fdb009d4ee2af8`
is retained in [PR #250](https://github.com/dalmaer/plates/pull/250), stacked on
phase 119. The independent review reported no findings and the explicit reviewer
gate exited 0. [CI check run 40070145413](https://github.com/dalmaer/plates/actions/runs/40070145413)
succeeded on that exact head; typecheck and impact checks also passed. Read-only
observations used `plates review dalmaer/plates#250 --reviewer github-actions[bot]
--gate --json` and `gh run view 40070145413 --repo dalmaer/plates --json
status,conclusion,headSha`. It remains unmerged while phase 119's owner decision
is pending. Review and CI do not establish paid-agent efficacy or lived-in use.

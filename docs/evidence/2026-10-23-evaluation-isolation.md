# Evidence: phase 118 — offline execution and independent artifact acceptance

- Date: 23 October 2026, America/Denver.
- Phase: 118.
- Revision: `27066caa9fe7454b7adda32e0dd46b8cc1030680` plus the working tree committed as **phase 118: Evaluate one historical artifact behind an independent boundary**.
- Scope: scripted offline builders, private immutable submissions and independently controlled acceptance. No paid model, comparative agent efficacy or production promotion.

## Automated checks

Commands ran from the implementation worktree with `/opt/homebrew/bin` first in
PATH and `TZ=UTC`. The conductor ran the named proof independently of the builder.

| Command | Observed |
| --- | --- |
| `npm run check:focused -- tests/evaluation-isolation.test.mjs` | Exit 0; 117 passed, four explicitly opt-in Docker tests skipped; roadmap/render/inbox/whitespace passed |
| `PLATES_EVALUATION_DOCKER=1 node --import ./tests/helpers/hermetic.mjs --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/plates/test-ledger.mjs --test-reporter-destination=stdout tests/evaluation-isolation.test.mjs` | Exit 0; all 12 passed, none skipped, including real containers; no hygiene notes |
| `npm run typecheck` | Exit 0; selected contracts only |
| `node docs/evidence/2026-10-23-evaluation-isolation-walk.mjs "$SOURCE_ROOT"` | Exit 0; 15 public CLI operations; assertions verify historical rejection/acceptance, stale approval refusal, identical retry verdicts, unchanged frozen receipt and unknown currency |

The final integrated gate is `npm run check`, covering the complete test suite
and roadmap/render/inbox guards after this record. Its result belongs in the
commit and CI record, not a prediction here.

Logs: `/tmp/plates-phase118-conductor-focused.log`,
`/tmp/plates-phase118-conductor-docker.log`, `/tmp/plates-phase118-typecheck.log`,
and `/tmp/plates-phase118-final-walk.log`. The builder's exact commands and earlier
failures are retained in `/tmp/plates-phase118-builder-report.json`.

## Owner-machine walk

`SOURCE_ROOT` was `/Users/dionalmaer/.codex/worktrees/reconcile-validation-night/plates`.
The reproducible [walk script](2026-10-23-evaluation-isolation-walk.mjs) creates
an external private workspace and synthetic Acme package consumers. It exports
only `lib/rename.mjs` from each named historical Git revision; the scripted builder
submits existing bytes. The independently controlled public probe packs and
installs into a fresh consumer, then observes CLI and module behavior. Expected
results remain with the host controller.

| Artifact source | Verdict | Stage wall time | Retained verdict digest |
| --- | --- | --- | --- |
| `edfc56476dd4b7880d8bba83a13436b5a3887a5a` | Rejected: installed entrypoints failed | 1459 ms | `356813b7dd0e1ce4e0213adc6a30f4e1e3bc26177cb5c1c886257a0af0fcaf63` |
| `fa7477f2ea26bf56cb0e5f6f5a0904cf213a4e72` | Accepted: CLI 47, module 43, expected packed paths | 1401 ms | `098861031d95aa5c2b44baf6c7f87daeb912f6f8403a767394ea7d6fab6404ab` |

Both retries recovered the original verdict, with no fresh dispatch. Both host
leases released only after confirmed container termination. Currency, CPU and
active human time remained null. Wall times exclude preview/preflight/admission;
these two known-source probes are not an agent baseline/candidate comparison.

Private receipts: `/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/plates-phase118-owner-FXQhPb/walk.json`.
Controller Node was v26.12.1; observed fixed-source fingerprint was
`ce8847d91266605f2f7420cb75475a325c348e8d5a8e7740abe5e35a8446aa51`.
Docker Desktop 4.41.2 / engine 28.1.1 ran linux/arm64 Node v24.22.1, image
`sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a`.
Source configuration declarations remain distinct from observed controller bytes.

## Negative controls and findings retained

- Real adversarial tests rejected fake pass JSON, protected probe changes,
  traversal, symlink/device modes and oversized submissions. Private host files,
  host tools/socket and a previous container's tmpfs marker were unavailable;
  read-only base writes failed. Pure tests also check pinned Git exports and
  shared coordinator capacity under uncertain termination.
- A different non-root UID runs the absolute-deadline supervisor. The executor's
  attempt to stop PID 1 receives EPERM; a real container expires after the client
  returns, without a host kill. VM time is checked within a one-second tolerance,
  not claimed perfectly synchronized. Timeout remains distinct from acceptance.
- Initial real Docker capture ran `acme.mjs` successfully but `docker cp` returned
  an empty tmpfs archive. The original observation is retained in
  `/tmp/plates-phase118-stage-probe.json`. [Docker documents this limitation](https://docs.docker.com/reference/cli/docker/container/cp/#corner-cases).
  The spec was corrected before further implementation: explicit submitted bytes
  replaced filesystem snapshot claims; isolation was not relaxed.
- The builder's first real timeout test failed due to classification. The original
  failure remains in `/tmp/phase118-docker-tests.log`; the targeted correction and
  final independent suite passed. This is a corrected defect, not a passing retry
  relabelled as an initially successful run.
- Changed installed execution bytes invalidate current-process identity and old
  approvals. Inspect still preserves access to original receipts.

## Gaps and decision

This supports built for the offline boundary after the integrated gate passes.
It does not establish lived-in operation, unseen generalization, agent efficacy,
provider cost, live gateway enforcement, paired recovery or lesson promotion.
The corpus is exposed development history; held-out coverage is zero. Deletions
and nonregular artifacts are unsupported. Controller provenance covers its
explicit installed module list, not the entire operating system or worktree.
Stopped container identities remain for inspection; no host storage was mounted.
Paid provider selection, allowance and practical tolerances remain owner decisions
for the later screening phase.

## Cross-review correction

The full gate also passed on committed head `c747a8813af9e6a3ace92652070629bbbefa5fcd`
in [GitHub Actions](https://github.com/dalmaer/plates/actions/runs/40060702492).
Its local result (2,910 passed, zero failed, four separately exercised Docker
skips) is recorded in that commit body, following the project's evidence sequence.

Review found that a missing or truncated execution reservation could hide the
otherwise valid frozen receipt after a failed write. In quiescent storage,
inspection now returns the original frozen record with explicit uncertain
execution metadata. It preserves all bytes and refuses new execution before
reading a descriptor or reaching preflight/admission. It does not reclaim a
writer lock, reset storage or infer that missing records mean nothing ran;
recovery remains phase 119 work.

The conductor independently ran
`node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='interrupted execution inspection' tests/evaluation-isolation.test.mjs`:
exit 0, nine tests passed covering eight partial-write shapes. The builder's
`plates prove` result was VERIFIED: red without `lib/evaluation-execution.mjs`,
green with it; diagnostic `evaluations: missing execution record (empty-directory)`.
Logs: `/tmp/plates-phase118-conductor-recovery.log` and
`/tmp/phase118-pr239-prove.log`. The integrated `npm run check` and typecheck run
again after this correction; their measured results belong in its fix commit.

The post-review local integrated gate exited 1: 2918 passed, one existing workflow
test failed, and four opt-in Docker checks were skipped. The workflow subprocess
returned null status after its synthetic PR publication; its signal was not
retained, so the cause is unknown. Tracked as [#248](https://github.com/dalmaer/plates/issues/248).
The same run reported a climb-guard failure under stalls (seed 1942849892),
retained for investigation. This failed run is not replaced by an earlier green
run. The correction's nine focused regression checks and typecheck passed.
Log: `/tmp/plates-phase118-fix-check.log`.

# Evidence: phase 119 — paired execution and recovery

- Date: 23 October 2026, America/Denver.
- Phase: [119](../phases/119-evaluation-comparison.md).
- Revision: `15fe8231a7a12b43016426d7c19d1f0e8c354872` plus the named working-tree observations below.
- Claim: offline comparison accounting and safe original-operation recovery; not measured agent efficacy or production promotion.

## Diagnostic observations before final integration

The conductor ran the completed reporting module independently:

```sh
PATH=/opt/homebrew/bin:$PATH TZ=UTC node --import ./tests/helpers/hermetic.mjs --test tests/evaluation-comparison-report.test.mjs
```

Exit 0: 15 passed, zero failed or skipped. Log:
`/tmp/plates-phase119-conductor-report.log`. These checks include separately
deserialized image objects, unknown costs, all planned denominators, and forged
recovery evidence. Recorded intervention declarations do not establish complete
actual human-intervention coverage.

### Twenty-slot public CLI walk

```sh
PATH=/opt/homebrew/bin:$PATH TZ=UTC GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=false node docs/evidence/2026-10-23-evaluation-comparison-walk.mjs /Users/dionalmaer/.codex/worktrees/reconcile-validation-night/plates
```

The first attempt refused before execution: the proof fixture put an oversized
historical source file in a 64 KiB material. The corrected fixture supplies the
narrow 10 KiB historical patch to an explicitly scripted builder. No production
limit was raised to make the fixture pass. The original failure is retained in
`/tmp/plates-phase119-first-walk.log`, workspace
`/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/plates-phase119-owner-C7P5fs`.

The changed walk exited 0 and retained seven public CLI observations, including
stale-approval refusal, plus twenty trial receipt chains under
`/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/plates-phase119-owner-FP8Pgl`.
The operation record is `walk.json`; trial records remain beneath
`state/session-trials/acme-paired-machinery`. Log:
`/tmp/plates-phase119-second-walk.log`.

Observed controller fingerprint:
`d655497f9fc8a473787542fa8dc60464281a6242170eac619c6f9cef0565e627`,
host Node v26.12.1, image
`sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a`
(linux/arm64, Node 24.22.1). The controller checkout was dirty; this is pinned
source-hash evidence for that working tree, not a clean-commit claim.

| Observation | Expected | Observed | Scope |
| --- | --- | --- | --- |
| Target baseline | Known broken package-entry behavior | 0/5 accepted | Historical artifact sensitivity |
| Target candidate | Explicit known historical patch fixes that behavior | 5/5 accepted | Scripted patch, not an agent improvement |
| Ordinary control | Identical ordinary behavior under both configurations | 5/5 accepted in each arm | Synthetic control, not the later historical corpus control |
| Comparable pairs | Five per case | Five per case | Frozen environment and actual controller identity |
| Aggregate acceptance | Baseline 5/10, candidate 10/10 | Matched | Includes target failures in denominators |
| Costs | Missing stays unknown | Null cost per accepted outcome | No billing or saved-time claim |
| Recommendation | No promotion from scripted machinery | Inconclusive | No automatic activation |

### Actual controller termination and missing-work resume

```sh
PATH=/opt/homebrew/bin:$PATH TZ=UTC PLATES_EVALUATION_DOCKER=1 PLATES_EVALUATION_RETAIN=1 node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='real killed controller' tests/evaluation-comparison.test.mjs
```

Exit 0: one passed, zero failed or skipped, 27,309 ms total. Log:
`/tmp/plates-phase119-conductor-crash-first.log`. Synthetic private workspace:
`/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/acme-isolation-dbBbq1`.

The test retained the original first result and frozen receipt byte-for-byte,
killed the next controller, reconciled the original operation as unknown, then
completed the remaining missing slots. All twelve planned slots were retained
without replacing the interrupted one. Original frozen-byte fingerprint:
`2913f25e8b76f7bce169080c39f58bbf4a393c4f2af405e406417275251e2778`;
first-result byte fingerprint:
`08c01062d8a7ae27e25d6923742217c3471b3be1322b01b67aa8a7df45f01bc2`;
recovered intent:
`713c7920342a8f690efe2f7521a83f20bf469b884a866c9ea2bbb460972397c5`.
The interrupted trial did not become accepted from termination or recovery.

## Integrated verification

The diagnostic observations above precede additional recovery-validation and
budget corrections; they do not establish those later bytes. The final corrected
tree was verified separately below.

## Gaps and decision

Live provider execution and an enforced spending gateway are not implemented.
No paid agent evaluation, held-out generalization, measured lesson benefit,
production activation or lived-in outcome is established. Remaining code and
final verification are recorded in the phase before acceptance moves.
The earlier unrelated local subprocess hygiene observations remain tracked in
[#248](https://github.com/dalmaer/plates/issues/248).


## Final corrected-tree proof — 23 October 2026

After strict derived-settlement validation and preparation-budget corrections,
the conductor reran the named proof:

```sh
PATH=/opt/homebrew/bin:$PATH TZ=UTC npm run check:focused -- tests/evaluation-comparison.test.mjs
PATH=/opt/homebrew/bin:$PATH TZ=UTC npm run typecheck
```

Both exited 0. Focused preflight: 129 passed, zero failed, one opt-in Docker test
skipped; roadmap, render, inbox and whitespace checks passed. The Docker test
was exercised separately below. Logs: `/tmp/plates-phase119-conductor-focused.log`
and `/tmp/plates-phase119-typecheck.log`.

The same twenty-slot CLI command above then exited 0 on controller fingerprint
`59f76b18888349a684c88afecf591b5b35860c6e0b184ea4b54664ffd5d692a3`.
It retained the same expected 5/10 baseline and 10/10 candidate accepted artifact
counts, five comparable pairs per case, unknown costs and an inconclusive
recommendation. This remains scripted machinery proof. Final retained workspace:
`/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/plates-phase119-owner-1o0keQ`;
log `/tmp/plates-phase119-final-walk.log`.

The final real killed-controller command above exited 0: one passed, zero failed
or skipped. It explicitly observed the original container running before SIGKILL
and stopped before reconciliation. All twelve slots remained accounted for and
the original first result and frozen receipt stayed byte-identical. Final private
workspace:
`/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/acme-isolation-V75sbT`;
log `/tmp/plates-phase119-conductor-crash-final.log`.
Frozen-byte fingerprint:
`c321063c0765dffa98ea3b07c199cf24a4d65738b1aad61f48d1d4a5787a3262`;
first-result byte fingerprint:
`b6311fe0dca213941e1f52482d54471aed643f55d7c395302b6f96ad59dc91ab`;
recovered intent:
`7d04427cfd308e7b515e27c1d646d00936d24084c426f4a097a111fc7c8f0d8e`.

Preparation shares bounded Git/Docker deadlines and reduces admitted execution
time. Recovery and cancellation each reserve one bounded attempt before effects.
Prior read-only previews, human waiting and arbitrary host filesystem/kernel
stalls are not claimed as hard wall-time coverage or billed agent work.
Missing provider usage is never treated as zero or refunded.

These observations support the offline acceptance boxes. The phase remains
partial because live provider integration, enforced provider spending and the
approved measured screening are still absent. Later corpus and lesson mechanics
can proceed independently; actual measured promotion cannot.

## Full integrated gate — 23 October 2026

Before committing `2ebd80331d486d89afdb6ae2ae29b018a310e0db`, the conductor ran:

```sh
PATH=/opt/homebrew/bin:$PATH TZ=UTC npm run check
```

Exit 0: 2,959 tests, 2,954 passed, zero failed and five opt-in Docker skips.
Roadmap, render and inbox checks passed. The test ledger reported no flaky or
slower tests across its retained observations (25 runs, ten busy runs omitted).
Log: `/tmp/plates-phase119-check.log`. The separate typecheck command above also
exited 0. These results describe that pre-review tree; subsequent corrections
require their own verification and do not rewrite this observation.

## Review correction — 23 October 2026

PR #249 identified the omitted full-gate observation above and a JSON `null`
lock-owner dereference. Structurally invalid lock owners now return blocked;
acquisition and recovery preserve original bytes and inode rather than reclaiming
unknown ownership. `plates prove` independently failed without this guard and
passed with it (VERIFIED); retained log `/tmp/phase119-pr249-lock-prove.log`.
The source capability fingerprint changes because the audited parser boundary
changed; no command, permission or authority is added. The correction's integrated
gate is `npm run check`, with its result retained in the correction commit body.

### First review correction verification — 23 October 2026

Before commit `5924d09c3b9566793afeb36033d8074e34b0fc60`, the conductor ran
`PATH=/opt/homebrew/bin:$PATH TZ=UTC npm run check`: exit 0, 2,965 passed, zero
failed, five opt-in Docker skips. All nine deliberate-stall checks passed, and
roadmap/render/inbox checks passed. Log:
`/tmp/plates-phase119-correction-check.log`. Focused preflight and typecheck also
exited 0, retained in `/tmp/plates-phase119-correction-focused.log` and
`/tmp/plates-phase119-correction-typecheck.log`. This is separate from any later
admission revalidation correction.

### Second review correction — 23 October 2026

Lock IDs must be canonical UUIDv4 strings; array-to-string coercion is refused.
Each new slot revalidates the admission manifest and current repository identity
under its remaining deadline, before writing intent or reserving capacity. Frozen
source and image bytes stay captured. The counterfactual regression proof is
VERIFIED, retained in `/tmp/plates-phase119-round2-prove.log`: the uncorrected
code accepts malformed IDs or reaches intent creation after stale admission.
Builder convention checks first reported three stale capability fingerprints;
those audited source hashes were refreshed before conductor verification.
No paid work or production default is enabled.

The conductor repeated `PATH=/opt/homebrew/bin:$PATH TZ=UTC npm run
check:focused -- tests/evaluation-comparison.test.mjs`: exit 0, 153 passed,
zero failed, one opt-in skip; all record/convention checks passed. Typecheck
exited 0. Logs: `/tmp/plates-phase119-round2-conductor-focused.log` and
`/tmp/plates-phase119-round2-typecheck.log`.

The real killed-controller command retained above also exited 0 after this
correction: one passed, zero failed/skipped; running and stopped observations
were both true, twelve slots retained. Log: `/tmp/plates-phase119-round2-crash.log`.
Private workspace:
`/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/acme-isolation-ZhODvm`.
Unchanged frozen receipt digest:
`5476b60ecefbd023684562c73e407d3d75c35c5f451b3de952d7d8b112b01d9b`;
unchanged first-result digest:
`a2c14e7a01a31eff35eac3ad9378ab226234654ed5dec1f03a58a325341ac0b9`.
The final `npm run check` runs after this record; its exact result belongs in the
correction commit body. No scripted observation becomes paid-agent efficacy.

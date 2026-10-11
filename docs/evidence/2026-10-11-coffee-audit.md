# Evidence: unattended audit — timing reliability and current records

- Date: 2026-10-11.
- Phases: 10, 50, 55, 64; acceptance remains distinct from merge status.
- Revision: `3f4cc6b4e628d00a5316c3f723987d72f9f42247` plus this working tree.
- Claim: real scheduled failures and stale records were investigated; two test defects were corrected without changing the evidence executor's runtime limits.

## Actual failure and proof

[Scheduled climb 38132056544](https://github.com/dalmaer/keel/actions/runs/38132056544) failed during its baseline, before the model step. Its retained `keel-climb-agent` test ledger has a clean tree and a failing `per-command deadline and combined stdout/stderr bounds`: expected `output-limit`, observed `timeout`. The same tree has passing observations. Busy load was reported; this is not evidence of a product speed regression.

The old test gave child startup and an output-limit assertion the same 500 ms deadline. The fix separates the real nonterminating-command deadline from real stdout/stderr pipe checks with a controlled timer. It checks each pipe, combined overflow, and exactly the allowed combined bytes. Runtime defaults remain 10 seconds and 65,536 bytes.

Issue [#64](https://github.com/dalmaer/keel/issues/64) was also reproduced: a mock-timer call anywhere exempted a different real-time suite test in the same file. The local guard now conservatively retains suite-timing pins. Both compare/measure and both mocked/real test orders are covered; no parser claims to establish complete mock coverage.

- `node --import ./tests/helpers/hermetic.mjs --test tests/evidence.test.mjs tests/timing-hygiene.test.mjs`: exit 0, 29 tests passed, independently run by the conductor.
- The builder's isolated 650 ms child-start delay reproduced the old output/deadline failure; the new checks passed. Isolated mutations removing the deadline, removing output bounds, splitting the pipe limits, or rejecting exact-bound output failed their intended assertions. These are test-quality checks, not production timing measurements.
- `node bin/keel.mjs prove tests/timing-hygiene.test.mjs --fix tests/timing-hygiene.test.mjs --base 3f4cc6b4 --trailer`: INCONCLUSIVE because the implementation and regression live in the same test file. The separately retained regression fails when the old exemption is restored in an isolated copy; do not label the CLI verdict VERIFIED.
- `node bin/keel.mjs test tests/evidence.test.mjs --stalls --seed 55 --json`: exit 0; no named failures, inconclusive tests or missing tests. The conductor also restored the old exemption in `/tmp/keel-coffee-timing-mutant.mjs` and ran only `issue 64:`: exit 1 at the intended mixed-clock assertion (`0 !== 1`).
- Final gate commands: `npm run check` (tests, stall pins, roadmap, rendered files and inbox), `npm run typecheck`; final results belong in the commit body.

## Night evidence and reconciliation

`gh run list --workflow keel-night.yml --limit 40 --json databaseId,createdAt,conclusion,event` returned successful Keel scheduled runs on each date 3–9 October. The committed morning pages contain these `keel-night/` queue counts:

| Morning | Queue | Scheduled run |
| --- | --- | --- |
| 2026-10-03 | 0 | [37107042638](https://github.com/dalmaer/keel/actions/runs/37107042638) |
| 2026-10-04 | 0 | [37192426786](https://github.com/dalmaer/keel/actions/runs/37192426786) |
| 2026-10-05 | 0 | [37280361272](https://github.com/dalmaer/keel/actions/runs/37280361272) |
| 2026-10-06 | 1 | [37431160676](https://github.com/dalmaer/keel/actions/runs/37431160676) |
| 2026-10-07 | 0 | [37588908462](https://github.com/dalmaer/keel/actions/runs/37588908462) |
| 2026-10-08 | 0 | [37745263428](https://github.com/dalmaer/keel/actions/runs/37745263428) |
| 2026-10-09 | 0 | [37900645178](https://github.com/dalmaer/keel/actions/runs/37900645178) |

These are snapshots, not a continuous queue invariant. The phase's owner read remains unchecked. Ledger's same query with `--repo dalmaer/ledger` returned scheduled nights on 4–11 October: success on 4–5, failure on 6–8, success on 9–11. Run conclusions do not establish adopted-project queue depth or acceptance. A separate Contents API read of Ledger's configured `.keel/health/2026-10-DD.md` pages on main found seven morning night-queue snapshots for 5–11 October: **0, 0, 1, 1, 1, 0, 0**. See [Ledger health sources](https://github.com/dalmaer/ledger/tree/main/.keel/health). These satisfy the agent's evidence collection; the named owner acceptance remains unchecked.

Keel's [10 October night](https://github.com/dalmaer/keel/actions/runs/38034985959) reported a failed gate and incomplete instruments. The [11 October night](https://github.com/dalmaer/keel/actions/runs/38121992057) passed, merged its predecessor #75, and left [#105](https://github.com/dalmaer/keel/pull/105) when GitHub refused a conflicting merge. The current main health page contains a later selective hygiene audit and undecided proposal; blindly taking the older PR would lose that work. Its old green gate is not proof of a resolution against current main.

## Other audit findings and limits

- `node bin/keel.mjs doctor --github --json`: exit 0, no managed drift, lint, structured reconciliation findings or unavailable GitHub facts. Advisory legacy-record/acceptance notes remain; this does not certify all historical prose.
- `npm outdated --json`: exit 1 (updates available), only development dependencies: pinned Node types 24.10.1 versus latest 26.6.5, TypeScript 5.9.3 versus latest 7.0.2. These are major-line upgrades, not automatic compatibility fixes; no runtime dependency was introduced.
- Local isocan remains at `1565e501ad7a598c1af784d91971ca7d1773d2e9`. General public conditional item editing remains unproven; the design now distinguishes already verified packed recovery and deployed receipt replay from the outstanding concurrent-edit/live-pulse walk.
- Existing open follow-ups include #97 (runner-local JUnit freshness), #100 (four fleet-review findings), and #90 (candidate isolation from gate-created dependency state). This audit does not claim they are fixed.
- No owner acceptance, robot budget, new credentials, fleet release override, model run, destructive worktree cleanup or architecture decision was invented. Phases that owe real use or an owner decision remain partial.


## Live refresh and stale PR descriptions

After the first audit commit `908904d703ac73a52c407a22b5756c88b1e18e48`, [check CI 38146506881](https://github.com/dalmaer/keel/actions/runs/38146506881) and [typecheck CI 38146506850](https://github.com/dalmaer/keel/actions/runs/38146506850) passed. Issue #64 was closed.

The existing deterministic night workflow was dispatched once on that revision: [38146891793](https://github.com/dalmaer/keel/actions/runs/38146891793), success. It reran the gate (1,514 tests), refreshed #105 and drained it normally into main at `50c9ff1ea5c1a7dd3a8a08242a47fa8b9277da4b`. The latest report has zero structured contradictions and zero observed flakes; its slow-test value remains unavailable because the newest run was busy. No zero was substituted for missing timing evidence.

The existing hygiene proposal `60fca6d4f7007ed0175324c097ea8cc910f8056acb22c3810f7f2015b517aa5c` was compared as complete parsed JSON before and after the merge: identical, still proposed, exactly one copy. No robot work was authorized. Ledger collection ran from 14:22:21 to 14:25:03 UTC (2 minutes 42 seconds); serial artifact identity reads are an optimization candidate, not a measured speed improvement.

The live rerun exposed an additional defect: `gh pr create` wrote a fresh description only when the PR was new. An existing PR's branch was updated, but its body still claimed the old 1,401-test result. The real #105 body was corrected with `gh pr edit --body-file` from the completed run and report, preserving the three-section format and impact declaration. The workflow correction publishes the same generated body when the PR already exists; lookup and edit failures remain errors.

This follow-up changes the night template and its rendered copy, plus shell-level tests executing the actual workflow blocks in a synthetic Acme repository. It does not change phase acceptance. The automated rerun path with the correction has a shell proof; a future deployed night will exercise the shipped path. The direct `gh pr edit` production surface was exercised on #105. Final gate commands remain `npm run check` and `npm run typecheck`, with results in the follow-up commit.


Follow-up proof: `node bin/keel.mjs prove tests/workflows.test.mjs --fix practices/night/files/.github/workflows/keel-night.yml --base 50c9ff1 --trailer` returned **VERIFIED** in the conductor's independent run: red without the change, green with it. The focused builder run passed all 34 workflow tests. The final full gate follows this record.

The successful night has one material access warning: its repository token cannot read private `dalmaer/keel-inbox`, so `learn` preserved the prior counts instead of inventing zeros. `gh secret list --json name` confirmed no configured inbox/fleet credential on Keel; no secret values were read or created. This is a remaining scheduled-inbox credential requirement, not a failed test or a complete lesson collection. The night gate/report/drain succeeded despite this explicitly reported gap.

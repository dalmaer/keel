# Test-value history review (2026-10-11)

Date: 2026-10-11. Source revision: `3ef01bef9dd4f4f06b8dfce425712ac118fca4dd`.
Scope: 15 representative cases, selected from `/tmp/keel-test-audit/fixes.txt`, then expanded through local commit history, test source, phase records and evidence. This is a qualitative sidecar for the parent's optimization decision, not a census or ranking by cost.

Read AGENTS.md, the keel skill and local agent help, design.md, and relevant central/generated lessons, especially 4–8, 13–17, 28, 30, 37–40, 45, 54 and 56. No repository edits, test executions, suite runs, coverage/timing analysis, or network operations were performed. The pre-existing untracked `docs/research/2026-10-03-keel-and-nerd.md` was left alone.

Evidence language: **recorded** means a local commit/evidence author reported the observation; **source-confirmed** means the inspected diff/assertion supports the stated behavior; **inferred** identifies a conclusion not established by a retained failing transcript. No historical receipt was rerun. A changed test is not evidence that an existing test failed. A new test that rejects old code is retrospective regression protection, not an earlier catch. Historical suite counts below identify observations, not new measurements.

## Representative cases

### 1. Existing integrated gate caught ordinary-proposal compatibility regression

- **Commit:** `6bbf0f6` (2026-10-11), from the supplied fixes list.
- **Tests/contract:** `tests/cli.test.mjs`, `--json parses for every verb and flag; human text never mixes in`, already creates `acme-health.md` outside the configured health directory and invokes walk decide. The new dedicated `tests/hygiene-proposals.test.mjs` case is `ordinary proposal paths: non-health regular files remain decidable while other aliases are refused`.
- **Evidence:** Commit body and `docs/evidence/2026-10-11-phase-review-corrections.md`, “Integrated compatibility correction,” report that 187 focused tests passed, but the first integrated gate found one ordinary-path failure among 1,496 tests. The correction restores the regular-file path before trying the configured health alias. The CLI test exists in the parent revision and is unchanged by this commit.
- **Claim/limit:** This is a recorded existing-suite catch of a real product regression before landing. Attribution specifically to the broad CLI case is a strong source-based inference, not a retained named failure log. Do not credit the newly added dedicated case as the original detector. Do not discard cross-command smoke coverage merely because focused unit files overlap it.

### 2. A new docs guard caught a real omission on its first run

- **Commit:** `0a7da26` (phase 18).
- **Test/contract:** `tests/docs.test.mjs`, `the README names every registered verb and practice, and nothing else`; derive documentation completeness from the live registry and practice manifests.
- **Evidence:** `docs/evidence/2026-10-03-docs.md` explicitly records `practice missing from README: base`, then the row addition and passing check. Commit diff adds the missing README row alongside the new test. Phase `18-docs-cannot-drift.md` records the same outcome.
- **Claim/limit:** A concrete new-test discovery, not proof that an established guard caught a later regression. In-memory negative controls and a removed release-row probe support sensitivity. It checks table completeness, not whether prose teaches the product accurately.

### 3. Existing tests positively enforced destructive behavior

- **Commit:** `000ae68` (phase 5).
- **Tests/contract:** `tests/practices.test.mjs` formerly required a second render to restore edited managed files; `tests/doctor.test.mjs` now requires refusal and retained bytes for edited files/blocks.
- **Evidence:** The diff replaces successful automatic restoration with exit 1, refusal text, unchanged bytes, and an explicit doctor restore. `docs/evidence/2026-10-02-doctor.md` records the builder finding and conductor confirming a project's appended line silently disappearing. Lesson 13 identifies the old test oracle as wrong.
- **Claim/limit:** This was discovered through a project probe, not by a failing old test. Preserve ownership/byte-preservation assertions; historical greenness here actively endorsed a bug. This was a local project walk, not demonstrated widespread customer data loss.

### 4. Package boundary absent until documented installation escaped

- **Commit:** `b269dad` (2026-10-04).
- **Test/contract:** New `tests/package.test.mjs`, `keel run from its packed tarball inits a project that passes its own check`.
- **Evidence:** Commit and lesson 28 record that npm packing removed the `.gitignore` template and the fresh-agent phase-23 re-walk failed through the documented npx route while checkout tests passed. Diff renames the source template to `files/gitignore`, declares package contents, and adds pack/unpack/template/init/gate verification.
- **Claim/limit:** Regression added after a real distribution escape. Its artifact boundary is not replaceable by another checkout-only init test. Current test also asserts a nonzero child test count. It is an offline npm-pack simulation, not live GitHub/npx installation; no current execution was made here.

### 5. Workflow text checks missed executable shell syntax

- **Commit:** `78a7e5c` (2026-10-04).
- **Test/contract:** `tests/workflows.test.mjs`, the test beginning `every run: block in every workflow parses as bash, and every inline node -e`.
- **Evidence:** Commit and lesson 30 name apostrophes in comments inside single-quoted Node shell snippets. Ledger's Loop and night actually failed; existing tests read workflow text. The diff adds extraction plus `bash -n` and `node --check`. `docs/evidence/2026-10-02-night-shift.md` retains the later failed-run observation.
- **Claim/limit:** After-escape executable-language protection, not an existing regex success story. Syntax checks add a distinct boundary, but do not prove GitHub expression evaluation, authorization or successful remote behavior. The lesson records pre-fix rejection; this audit did not replay it.

### 6. Existing-PR rerun branch escaped; new regression has a proof receipt

- **Commit:** `ede3f01` (2026-10-11).
- **Tests/contract:** `tests/workflows.test.mjs`, `the night refreshes an existing PR body by exact number, or creates a new PR` and `the night fails on PR lookup or edit errors without creating a replacement`.
- **Evidence:** Commit and `docs/evidence/2026-10-11-coffee-audit.md` record a real rerun leaving a 1,401-test PR body beside a 1,514-test report. New shell fixtures cover existing/new/error paths. The commit's VERIFIED trailer shows the missing `pr edit` call on the unfixed side.
- **Claim/limit:** A real operational escape followed by a retrospective proof. Keep fresh-body equality, correct target, preserved title and failure/no-duplicate behavior. Exact argument-array equality also fixes option order and the list/edit CLI spelling: those are mechanism constraints that could be loosened if a replacement boundary test preserves the same result. The stub is not a live GitHub service.

### 7. Release made a fixture fail because injected version stopped at a process boundary

- **Commit:** `81d817e` (2026-10-03).
- **Tests/contract:** `tests/fleet.test.mjs` fixture/version injection and `tests/release.test.mjs` gate-before-commit/rollback checks.
- **Evidence:** Commit and lesson 17 explicitly report CI red on v0.3.1: the parent injected 0.3.0, while a spawned CLI read live package.json. Diff propagates `KEEL_FLEET_PRACTICE`, exercises versions above/below the live value, and runs release's gate after the bump with restoration on failure.
- **Claim/limit:** The recorded red was a test isolation defect, not proof that fleet incorrectly classified a real behind project. The release change additionally fixes a real gate-placement risk. Separate those claims rather than counting the whole commit as one production catch. No original CI log was fetched.

### 8. Random prefix collision was correct product rejection, wrong test expectation

- **Commit:** `bbd0dcb` (2026-10-06; supplemental test history).
- **Test/contract:** `tests/loose-ends.test.mjs`, `marks persist across runs`; a shortened identifier must uniquely select its item.
- **Evidence:** Commit records CI failure on `2ab0607`, no local reproduction in 12 attempts, and randomUUID-derived IDs sometimes sharing four characters. Diff computes the shortest unique prefix of at least four characters and includes command output in failures. Lesson 56 records the shape.
- **Claim/limit:** Concrete intermittent test defect with a source-supported cause. It is not a verified same-clean-tree pass/fail ledger classification here; repeated local passing did not prove correctness. Retain ambiguity rejection and derive the successful selector from the fixture draw.

### 9. Host Git configuration generated broad false reds; guard mixes contract and mechanism

- **Commit:** `61836a5`, following `103454f` (2026-10-04).
- **Tests/contract:** `tests/hermetic.test.mjs`: bootstrap loading, effective Git configuration in parent/child, and later standalone-file isolation.
- **Evidence:** Commit records 31 failures from fsmonitor leakage; hostile-config runs still failed after the narrow pin. The fix isolates global/system config and supplies synthetic identity. Lesson 14 records the finding. Source tests actually query Git in both processes.
- **Claim/limit:** These are environment/test failures, not dozens of product bugs. The effective-config and child probes protect a useful boundary. The regex requiring `scripts.test` to start exactly `node --import ./tests/helpers/hermetic.mjs --test ` encodes launch syntax; an equivalent wrapper or reordered flags would fail it. Optimize that assertion separately from behavioral isolation. Hostile-run counts are author-recorded, not reproduced here.

### 10. Spawned test gates were green while running no tests

- **Commit:** `d7d4967` (phase 6).
- **Tests/contract:** `tests/helpers.test.mjs`, `through the helper, a project whose one test throws fails, and one that passes reports its test`; init/adopt/practices/update child-gate checks.
- **Evidence:** Commit and lesson 14 record NODE_TEST_CONTEXT inheritance causing even a throwing child test to exit 0. Discovery followed a migrated gate passing with deleted tests. Diff routes spawns through the helper, strips runner context, and adds executed-test assertions.
- **Claim/limit:** A discovered blind spot, not a catch by the pre-existing green gate. Keep positive execution counts and a deliberately throwing child. The companion source scan forbidding raw spawn calls is a mechanism rule: it cannot itself prove sanitation, and would reject an independently safe launcher. The commit explicitly says cleaned gates passed; do not claim all shipped projects were broken.

### 11. Stall harness failures came from measurement precision and selecting `ps`

- **Commit:** `6aa5433`, integrated via `0fa5e66` (2026-10-10; supplemental test history).
- **Tests/contract:** `tests/stalls.test.mjs`, `paused time is not counted against the timeout; running time is`; `tests/fixtures/stalls/interrupt.mjs` interrupt driver.
- **Evidence:** Commit reports four CI failures on unrelated PRs: 2,499 ms measured against an exact 2,500 ms requirement, startup exceeding a 2 s allowance under load, and selecting the `ps` child as the runner. Diff adds headroom and selects the stopped/non-ps child.
- **Claim/limit:** Recorded test/harness defects, not evidence of faulty product timeout accounting. The larger real wait still depends on the machine; it is not a deterministic proof. Preserve stopped-child cleanup and running-time timeout checks when considering a cheaper deterministic core plus bounded real-process check. This audit makes no time-saving estimate.

### 12. Output-limit assertion raced its own deadline

- **Commit:** `908904d` (2026-10-11).
- **Tests/contract:** `tests/evidence.test.mjs` splits `per-command deadline and combined stdout/stderr bounds` into a real nonterminating-command deadline test and mocked-clock output-bound tests.
- **Evidence:** `docs/evidence/2026-10-11-coffee-audit.md` reports retained clean-tree failing and passing observations: expected `output-limit`, got `timeout`, before the scheduled model step. It also records a 650 ms startup-delay reproduction and targeted mutations. Diff retains real pipes, tests both streams, combined overflow, and exact-bound acceptance.
- **Claim/limit:** Strong recorded flake evidence and an example of improving the oracle without removing contract coverage. The commit's separate timing-hygiene Proven-by receipt is INCONCLUSIVE because the test itself was in the fix; do not turn it into VERIFIED for this case. Named isolated mutation evidence is additional historical evidence, not a new run.

### 13. Template-name guard caught a comment, not a shipped behavior defect

- **Commit:** `13423ee` (2026-10-04).
- **Test/contract:** `tests/practices.test.mjs`, `templates name the project only through {{name}}`.
- **Evidence:** Commit explicitly records one red test among 273 from `Keel is home` in a shipped comment, and that the conductor committed despite the failed gate. Diff lowercases the comment; no runtime behavior changes. Current assertion scans for capitalized `Keel`/`Cajones` with phrase exceptions.
- **Claim/limit:** A concrete existing guard firing, but a lexical policy false positive rather than detection of incorrect project identity. Rendered Acme names and absence of unintended project-specific output are the contract. The case supports refining the oracle, not deleting all template identity checks. It separately documents failure to honor the gate's exit status.

### 14. Timing hygiene protects pin coverage but hard-codes syntax and a filename

- **Commit:** `908904d`; phase `55-a-test-judges-the-code-not-the-machine.md` and coffee-audit evidence.
- **Tests/contract:** `tests/timing-hygiene.test.mjs`, `every test file that times a suite is pinned to stalls...`, unpinning mutations, and issue-64 mixed mock/real-clock case.
- **Evidence:** Diff removes the broad mock-timer exemption. Source `timesASuite` matches an array beginning with literal `compare` or `measure`; assertions insist `tests/climb.test.mjs` remains among timed files and pins. Coffee-audit records isolated old-guard mutation rejection.
- **Claim/limit:** Mixed-file coverage is a useful regression target. The scanner is a syntactic proxy: computed/aliased arguments can escape it; an unrelated matching array can trigger it. Requiring that specific file would obstruct a sound rename/split. A pin's presence does not establish the test's assertions are correct. Keep demonstrable timing independence and executable negative controls; review filename/source-shape assertions as optimization candidates. No claim that a syntax bypass has occurred in production.

### 15. Proof engine behavior is valuable; proof-policy wording is a weaker guard

- **Commit:** `1cad3a4` (phase 62, squash with multiple review corrections).
- **Tests/contract:** `tests/prove.test.mjs` verdict, matched-test identity, isolated before/after trees and no-user-writes checks; `tests/skill.test.mjs`, `the conduct skill and its AGENTS block say a fix: commit carries a Proven-by: trailer from keel prove`.
- **Evidence:** `docs/evidence/2026-10-09-prove.md` records review findings and mutations: with-fix execution in the real checkout could create false VERIFIED; skips/load failures could masquerade as evidence; workspace links could write into user files. The evidence separately lists `the skill's rule reworded → ... fail 1`. Current skill test slices numbered sections and matches prescribed prose/command spelling with regexes.
- **Claim/limit:** Review-discovered defects followed by retrospective regression tests, not evidence those tests originally caught the defects. No-user-writes, comparable inputs and actual failing-test identity are contracts worth retaining. Exact prose and section numbering enforce mechanism/editorial form; mutation failure from rewording establishes text sensitivity, not behavioral safety. Phase 62 remains partial/owes walk; its two-week owner-read acceptance is not established. The evidence has chronological amendments: the opening describes the superseded real-tree with-fix run, whereas later corrections/current phase describe both sides isolated.

## Implications for the parent's decision

1. **Preserve distinct boundaries before reducing repeated setup.** Packed installation, interpreted workflow code, child-runner execution, repository ownership and proof isolation cover failure classes missed by in-process/check-out-only tests. The ordinary-proposal incident supports retaining some integrated command coverage beyond changed-file selections.
2. **Refactor assertions, not whole files, when mechanism and contract coexist.** Concrete candidates: exact launch prefix (9), raw-spawn prohibition (10), capitalization allowlist (13), fixed timed filename/source regex (14), prose/section regexes (15), and exact gh argument sequence (6). Their behavioral companion checks remain useful. This is a review queue, not authorization to remove guards.
3. **Count outcomes honestly.** Cases 4–6 are after-escape additions; 2 is a first-run new-test discovery; 1 is a recorded existing integrated catch with inferred exact attribution; 3 and 10 expose wrong/empty oracles; 7–9 and 11–13 explain misleading reds. These overlapping categories are not defect-rate denominators.
4. **Do not infer low value from few recorded catches.** The history is selected, commit messages are summaries, failing logs are often absent, and prevention is counterfactual. No evidence here supports an ROI ranking or eliminating a family solely because no historical failure was located. The parent owns ledger/V8 coverage/timing and final implementation choice.

## Reproducibility and limitations

All paths above are repository-relative to `/Users/dionalmaer/code/keel`. Retrieve any cited revision with `git show <sha>` or a historical file with `git show <sha>:<path>`. The investigation used `git log`, `git show`, `git status --short`, `rg`, and bounded file reads, starting from the supplied fixes list. Supplemental commits were selected for actual test-defect histories and guard origins, since a `fix:`-only list misses them. No network facts were refreshed; links inside evidence were treated as historical citations. No failing revision was executed or checkout mutated, so recorded receipts remain attributable to their authors. There is no population-level statement about how many tests ever caught bugs, and no new flake rate, coverage percentage or runtime claim.

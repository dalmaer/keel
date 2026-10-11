# Ledger count and failure review (2026-10-11)

Date: 2026-10-11. Canonical source checked against `3ef01be`: `scripts/keel/test-ledger.mjs` is byte-identical to that revision and to `practices/night/files/scripts/keel/test-ledger.mjs`. Its delegated inventory collector is `scripts/keel/time-receipts.mjs`. No tests, collection commands, network actions, or repository writes were performed. Shared-tree changes made by other workers are not attributed to this audit.

## 1. Why Node 1,516 and ledger 1,426 are both correct

The saved `latest-costs.json` identifies the dirty working tree based on `50c9ff1ea5c1a7dd3a8a08242a47fa8b9277da4b`, completed at `2026-10-11T14:41:18.671Z`, Node v24.21.0. This is not clean exact-HEAD evidence. Its suite receipt exactly matches the retained raw record `2026-10-11T14-41-18-671Z-78596-a594eb5e-c872-4a57-b765-2a70d0f80ca4.json`.

| Unit | Observed count |
| --- | ---: |
| Node aggregate tests / passed | 1,516 / 1,516 |
| Node suites | 0 |
| Node failed / cancelled / skipped / todo | 0 / 0 / 0 / 0 |
| Top-level inventory entries and raw ledger `tests[]` entries | 1,426 |
| Nested test entries, all at hierarchy depth 2 | 90 |
| Top-level test entries having nested children | 20 |
| Leaf test events (derived, not Node summary terminology) | 1,496 |
| Expected files / observed file summaries | 102 / 102 |

**Exact reconciliation: 1,516 = 1,426 top-level test events + 90 nested test events.** Node counts the 20 parent tests as tests too: 1,496 leaf events + 20 parent test events = 1,516. These parents are `test()` cases with subtests, not `describe()` suites. It would be wrong to subtract 102 files or attribute the 90 to skips, suites, duplicate removal or missing execution.

`topLevel()` (`test-ledger.mjs:869–909`) appends only pass/fail reporter events with `nesting === 0`; it does not deduplicate them. Skip/todo are mapped before storage; an explicit inconclusive diagnostic can change pass to inconclusive. Nested failures can supply their first correlated error to the top-level failing parent. The independent `executed()` predicate (912–914) counts passed/failed `type === test` events at any depth, excludes file-own entries and skip/todo, and drives the empty-run gate. Thus `tests.length` is not the count used to decide whether anything actually executed.

`suiteCollector()` (`time-receipts.mjs:88–168`) retains typed events at all depths, excludes file-own wrappers, builds parent hierarchies, and preserves Node aggregate/per-file summaries. Generally inventory length is tests + suites, while legacy top-level ledger entries may include a suite container; **this particular run has zero suites**. Do not generalize its all-test shape to other runners or projects.

| File | Node test events | Top-level ledger entries | Nested difference |
| --- | ---: | ---: | ---: |
| `tests/board.test.mjs` | 33 | 31 | 2 |
| `tests/canvas-package.test.mjs` | 4 | 1 | 3 |
| `tests/canvas-sync.test.mjs` | 17 | 14 | 3 |
| `tests/evidence.test.mjs` | 25 | 19 | 6 |
| `tests/hygiene-proposals.test.mjs` | 55 | 39 | 16 |
| `tests/review.test.mjs` | 61 | 47 | 14 |
| `tests/test-history.test.mjs` | 62 | 20 | 42 |
| `tests/time-proposal-actions.test.mjs` | 16 | 12 | 4 |

The eight differences sum to 90. `slowFiles` is only the top 20 file rows (489 top-level entries), not the whole inventory; summing it cannot reconstruct either suite count. No cost ranking or timing analysis is performed here.

## 2. Duplicate and redacted identities limit mapping, not execution counts

All 1,516 inventory entries have type `test`, outcome `pass`, and `occurrence: 1`. There is one duplicate logical-key group (two events):

- File: `tests/test-history.test.mjs`.
- Parent: `history rejects traversal, links, duplicate/local paths, corrupt archives and byte bombs before any record write`.
- Child: `acme.json` (twice).

Consequently there are 1,515 distinct serialized `(file, hierarchy, occurrence, type)` keys, but this is **not** a verified count of distinct behavioral tests. The collector does not number duplicate occurrences; it deliberately flags them as ambiguous. The top-level raw ledger has 1,426 distinct canonical `(file, describe flag, name)` identities, with no duplicates. At least one recorded logical name visibly contains substituted `[redacted]` (`tests/doctor.test.mjs`, the setupToken case); words such as “redacted” in ordinary test titles are not themselves evidence of sanitization.

The receipt says `selectionComplete: true`, `complete: true`, `gaps: []`, **but `inventoryComplete: false`**, with `logical identity redacted; mapping unavailable` and `duplicate logical names are ambiguous`. These flags are compatible: file selection/summaries are complete while exact identity mapping is not. No logical-inventory/aggregate count mismatch is reported. Do not silently deduplicate and call the resulting number complete coverage.

## 3. What the retained local history actually contains

- `local-runs.json`: 168 records spanning `2026-10-10T03:56:40.869Z` through `2026-10-11T14:41:19.925Z`.
- 63 records have nonempty top-level test arrays in the saved summary; 105 have count zero.
- Read-only lookup of the named raw records explains all 105 zeros: **52 gate receipts + 53 stalls receipts**. These intentionally use empty `tests[]`; they are not 105 empty test executions.
- Of the 63 nonempty summaries, 61 raw files remain available. Two zero-failure summaries, with 4 and 1 entries, have no raw file at inspection time: `2026-10-11T08-11-07-705Z-96200-d3c5ca97-f75f-4d88-a4eb-dcd2190243ff.json` and `2026-10-11T08-13-00-606Z-55195-50c5bce9-b652-4756-bff0-36f808ea62a6.json`. Do not assume why they disappeared.
- Summed saved counts: **55,890 top-level observations**, including repeated tests across runs. Available raw test records contain **55,824 pass + 61 fail = 55,885** entries, no skip/todo/inconclusive outcomes and no within-run canonical-key duplicates. The missing 5 entries account for the arithmetic gap; their outcomes cannot be re-inspected from raw data.
- All 63 nonempty test summaries say dirty=true; all 61 available raw test records agree. The 52 gate summaries also say dirty=true. The other 53 summaries omit dirty because they are stalls records; omission is not false.
- The 52 gate receipts retain 41 status-0 and 11 status-1 outcomes. These overlap test observations; they must not be added to test failures.
- The 53 stalls records contain 517 target receipts: 509 plain-pass/stalled-pass and 8 plain-fail/stalled-fail, all `complete: true`. There are 8 distinct stalled-failure targets. These are supplementary observations of the pinned runs, not 8 additional product defects or failures caused only by stalls; their empty outer `tests[]` hides this distinction in the saved summary.

Canonical history identity is `(file, JUnit-describe flag, name)` (`test-ledger.mjs:452–453`). Comparability additionally requires lane (scope/config/runner), machine class, and clean tree for flake analysis. `local-runs.json` omits several of those dimensions. Its 59 identities below are a retained observed-name inventory, **not 59 independent defects or proven flakes**.

## 4. Retained failures and observable error shapes

**61 failed top-level observations, across 11 test records, 59 distinct canonical identities and 21 files.** Every failing record remains available. Two identities occur twice: the helper raw-spawn guard, and the broad CLI JSON test. The latter failed for different reasons: phase lint first, ordinary-proposal path rejection later. All failing runs are dirty.

| Error shape (mutually exclusive observation classification) | Observations | Interpretation / limit |
| --- | ---: | --- |
| Missing copied module | 34 | Explicit missing `scripts/keel/time-receipts.mjs` in temporary adopter/agent/climb/cross-review trees. Shared setup/import failure fan-out, not 34 proven product defects. Insufficient evidence to decide shipped manifest omission versus incomplete fixture construction for every entry. |
| Socket permission | 5 | `listen EPERM: operation not permitted 127.0.0.1`, all in one board run; environment/setup denial before the intended server assertion, not five board contract defects. |
| Text/source/policy guard | 13 | Workflow/guide/script allowlists, prose regexes, helper spawn policy, timing pin presence, template naming and exact migration-list text. A fired policy is not automatically a false positive or a product defect. |
| Phase acceptance lint | 2 | CLI and doctor both report the same phase-68 Acceptance item naming no check. Two detectors of one record-validation shape. |
| Ordinary-proposal regression | 1 | CLI rejects `walk` with `hygiene proposal must be a dated configured health page`; exact recorded detector of the compatibility regression fixed in `6bbf0f6`. |
| Clean-state receipt assertion | 1 | The diagnostic includes dirty=null before and dirty=false after, with receipt data; bounded text does not establish the precise erroneous field or root cause. |
| Opaque exit/status assertion | 4 | Four observations retain only numerical mismatches (1 != 0 twice, 7 != 0, 1 != 2). They coincide with the missing-module run, but that is insufficient to assign its root cause. |
| Truncated runner error | 1 | One migration test retains only the child test command and harness throw preamble; missing cause remains unknown. |

The 41 failures on `2026-10-10T10:31:38.867Z` comprise 34 explicit missing-module errors, 2 text/output checks, 4 opaque status assertions and 1 truncated runner error. This concentration is why identity counts must not become defect counts.

The 13 text/source/policy observations comprise: 2 initial workflow/error-output regex checks; 1 guide shipped-script check; 2 occurrences of the same helper guard; 1 workflow shipped-file check; 3 skill/prose checks; 1 timing-pin guard; 2 fleet migration-list regexes; 1 template-name check. In the first fleet failure, retained output explicitly adds `0007-phase-guard-reach` to an expected list ending at `0006-lived-in-kept`: concrete stale exact-text expectation. The second has the same expected-list shape but its retained output truncates before the decisive line, so equal root cause is not proven. The template guard fires on `Keel changes no PR.` in explanatory output; it does not by itself establish wrong project identity.

The CLI raw failure at `2026-10-11T08:19:28.388Z` (dirty base `633b3fe`) upgrades history-review case 1 from inferred detector attribution to **direct retained-log attribution**: `--json parses for every verb and flag; human text never mixes in` failed with the ordinary-proposal rejection. The fix/evidence record remains `6bbf0f6` / `docs/evidence/2026-10-11-phase-review-corrections.md`.

## 5. Coverage diagnostics excluded

Neither supplied JSON snapshot contains a failure message `Precise coverage has not been started`; none of their available raw test records has a coverage runner flag. The later `/tmp/keel-test-audit/coverage-baseline.log` and `coverage-pilot.log` do contain that message. The audit preload calls `takeCoverage(); stopCoverage()` at process exit. Per the requested scope, those collection/instrumentation failures are **excluded entirely** from the 61-observation inventory and all product interpretations here. No failures from later live `.keel/test-runs` files were appended: only filenames present in the supplied snapshot were inspected. The precise causal contribution of the preload to each later red test was not independently replayed.

## 6. Limits and recommendations for interpretation

- Retention is bounded and sampled, not an exhaustive event log. Current `retainedRecords()` reserves recent records per lane and samples weekly by quiet/other status with global caps (KEEP=50, eight-week policy, 16 lanes, 4,000 records, 256 MiB). Changing revisions/configuration and focused runs prevent a uniform denominator.
- Canonical `flaky()` requires dirty=false, a tree identity, compatible lane/machine, and excludes busy records. None of the supplied nonempty test records qualifies on cleanliness. “No flake established by this snapshot” is supported; “no flaky tests exist” is not.
- Failure text is redacted and bounded to eight lines / 1,024 bytes (`failureText`, lines 257–259). Missing stack/cause text cannot be filled from neighboring failures. A top-level failed parent can hide multiple failed child cases; 61 is not a leaf-failure count.
- The 1,516/1,426 reconciliation is exact for the saved receipt. It does not imply those counts remain current after concurrent edits, nor prove assertions ran in every meaningful branch.
- Preserve separate labels: Node test events, top-level ledger observations, leaf events, logical keys, file inventory and gate/stalls receipts. Do not add them or turn their failure fractions into product defect rates.

## Reproducibility

Read-only Python JSON aggregation, `git show 3ef01be:<path>` comparisons, and bounded source reads produced these results. No repository module was executed to run a test or collector. Input SHA-256:

- `local-runs.json`: `c2641410523a845aff0d65240cd39d4fc31e4fd0a87cd02fbec381003aa9dc32`
- `latest-costs.json`: `ccacfae0008febd5414101faada02b96bc23ef7f01c4473eb0ae6d9ef1693486`

## Appendix: all retained failed identities

Grouped by canonical file / describe flag / name; all observed describe flags are false. Dates below are UTC. Multiplicity is observations, not independent bugs. Full bounded failure text remains in the supplied JSON and named raw records.

| # | File and exact retained test name | Observations | Date/time and shape |
| --- | --- | ---: | --- |
| 1 | `tests/adopt.test.mjs` — check.yml runs the config's check; keel's own stays byte-identical | 1 | 2026-10-10T10:31:38.867Z — Text/source/policy guard |
| 2 | `tests/adopt.test.mjs` — the proposed gate runs: the ledger records the bun run, and the gate fails exactly when bun did, or when no test ran | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 3 | `tests/adopt.test.mjs` — adopted JUnit shell samples after lint immediately before the runner and tolerates sample failure | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 4 | `tests/agents.test.mjs` — config: each pass's own validator holds the agent rules, and the scripts exit 2 naming the key | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 5 | `tests/agents.test.mjs` — the default: a project naming no agent runs Claude, and Claude's step passes the action exactly what it did before phase 45 | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 6 | `tests/agents.test.mjs` — the reviewer is another provider whenever one is available: codex/ PRs go to Claude, claude/ PRs to Codex (when listed, its secret set), the first other provider "agents" lists | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 7 | `tests/agents.test.mjs` — its own provider reviews a PR only when no other is available: none other listed, or none with its secret; it says so, in a notice and in the review | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 8 | `tests/agents.test.mjs` — phase 60: who wrote a push is its commits' authors and Co-authored-by trailers; the reviewer is never their provider while another is available; a person's push goes to the first listed | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 9 | `tests/agents.test.mjs` — config: an "agent" that writes a prefix in "for" is an error only while another provider is listed; a prefix that matches a provider's branches and others is refused (duo#84) | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 10 | `tests/agents.test.mjs` — a budget timeout never swallows a short budget: on a one-minute budget a failure at 5 s is red, at 58 s it ran out (duo#83, cajones#56) | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 11 | `tests/agents.test.mjs` — phase 47: climb and tend read which provider runs them, ask for its secret alone, and judge Codex by its final message | 1 | 2026-10-10T10:31:38.867Z — Text/source/policy guard |
| 12 | `tests/climb-codex.test.mjs` — phase 47: under KEEL_AGENT_GIT, with .git and the checkout's parent read-only as Codex's sandbox keeps them, a climb night commits, compares, keeps and reverts in .keel/agent-git; .git never moves | 1 | 2026-10-10T10:31:38.867Z — Opaque exit/status assertion |
| 13 | `tests/climb-codex.test.mjs` — phase 47: Codex's commits leave its git dir as objects only, running nothing that dir holds (hooks, fsmonitor, aliases, includes); the judge refuses what it refuses of Claude's; mutation: a handoff that reads that dir runs them | 1 | 2026-10-10T10:31:38.867Z — Opaque exit/status assertion |
| 14 | `tests/climb-guard.test.mjs` — guard: fails when a test that ran in the base did not run in the candidate (dropped or skipped), and passes a refactor | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 15 | `tests/climb-guard.test.mjs` — sandbox: the agent's commits may not change a workflow, keel's scripts or .keel/keel.json; climb.mjs sandbox and both guards refuse them before anything runs | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 16 | `tests/climb-guard.test.mjs` — hygiene guard: refuses a diff that only raises a timeout or wraps a retry around the flaky test, naming the line; a real fix that also changes a timeout passes, with a note | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 17 | `tests/climb-guard.test.mjs` — build guard: fails when the build output changes and no harmless reason names the path; passes byte-identical, or explained, and the PR names each reason | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 18 | `tests/climb-guard.test.mjs` — sandbox: an install file changed on the agent's branch (a preinstall script, a dependency, a lockfile, .npmrc) is refused before anything runs; a changed test script is not (ledger#92) | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 19 | `tests/climb-guard.test.mjs` — a forged base: the judge passes the run's commit, and a pass or night record naming another base is refused; the commits before it never escape the guard (ledger#92) | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 20 | `tests/climb-guard.test.mjs` — worktrees share every install the tree has: the root's and each app or workspace folder's own node_modules, so a nested build runs on both sides (ledger#92) | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 21 | `tests/climb-guard.test.mjs` — guard: a gate that records a run per suite (the root's, then web's) is compared whole, every suite of each commit; the newest alone would be one suite (ledger#92) | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 22 | `tests/climb-guard.test.mjs` — guard: only the records its own gate run wrote count; a suite the candidate dropped from its gate is not masked by a record the agent left at that commit (ledger#94) | 1 | 2026-10-10T10:31:38.867Z — Opaque exit/status assertion |
| 23 | `tests/climb-guard.test.mjs` — worktrees go beside the checkout, so a sibling the setup cloned (ledger's ../ledger-data) resolves for the base's gate as for the candidate's; none is left behind, even on a failure (ledger#95) | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 24 | `tests/climb-hygiene.test.mjs` — prove-steady: N runs of one test on one clean worktree; steady only with N passes, a fail at any run is not, and a name that matches nothing cannot tell | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 25 | `tests/climb-hygiene.test.mjs` — a hygiene night: prove-steady --decide keeps a proven fix with its runs and reverts a timeout-only one; the PR names the test; a night that proved nothing writes the issue | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 26 | `tests/climb-hygiene.test.mjs` — a bun or vitest flake is named, not climbed: prove-steady runs node --test only (review on #56) | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 27 | `tests/climb-pick.test.mjs` — pick: the job tied to the worst measure, rotation when none is outside, and a job with an open PR waits | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 28 | `tests/climb-pick.test.mjs` — rotation: a night that keeps nothing is remembered by its record (the keel-climb artifact), so the next night moves on; .keel/climb.json never has to reach main (ledger#92) | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 29 | `tests/climb-pick.test.mjs` — config: a bad climb is an error naming each key; the defaults fill the rest | 1 | 2026-10-10T10:31:38.867Z — Opaque exit/status assertion |
| 30 | `tests/climb-pick.test.mjs` — off: with no climb key the workflow does nothing; with no secret the run ends green with a notice | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 31 | `tests/climb-pick.test.mjs` — pick: hygiene goes ahead of every other job when the ledger names a flaky test, never by rotation, and waits like any job | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 32 | `tests/climb-pick.test.mjs` — retirement: a job whose last three PRs were closed unmerged is skipped by pick until one is reopened or merged | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 33 | `tests/climb-pick.test.mjs` — agent ran: an agent that errored before its budget ends the run red, saying why from the result alone; a budget timeout is not red | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 34 | `tests/climb-pick.test.mjs` — perf: reads the last line's number, honours "better" both ways past the margin, and the project's own perf check guards it | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 35 | `tests/climb-tend.test.mjs` — lessons: a distill pass over the project's own table writes proposals, one commit each, and changes no row; the guard refuses a row changed | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 36 | `tests/climb-tend.test.mjs` — loop: pulls, proposes a rank for every untriaged finding and decides none; Loop unreachable is a notice, not red; the guard refuses a decided finding | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 37 | `tests/climb-tend.test.mjs` — a loop night and keel-loop.yml never both pull: where keel-loop.yml is installed the night pulls nothing, says so, and proposes for the findings already here (ledger#92) | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 38 | `tests/climb.test.mjs` — compare: keep for a real gain, revert for one inside the noise, and two alternated rounds, not one | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 39 | `tests/climb.test.mjs` — compare --decide, revert, settle and report: the numbers go in the commit, a miss resets, and the PR body says it all | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 40 | `tests/cross-review.test.mjs` — agent ran: cross-review.mjs's copy of the check is climb.mjs's, function for function | 1 | 2026-10-10T10:31:38.867Z — Missing copied module |
| 41 | `tests/migrations-test-ledger.test.mjs` — 0005, run for real: npm test in web/ records in the root's .keel/test-runs, with root-relative files | 1 | 2026-10-10T10:31:38.867Z — Truncated runner error |
| 42 | `tests/time-measures.test.mjs` — pinned clean revision preserves unknown start after git status recovers | 1 | 2026-10-10T11:07:19.466Z — Clean-state receipt assertion |
| 43 | `tests/guides.test.mjs` — every guide command is a registered verb, with flags that verb knows | 1 | 2026-10-10T12:44:31.069Z — Text/source/policy guard |
| 44 | `tests/helpers.test.mjs` — no test spawns node or npm except through the helper | 2 | 2026-10-10T12:44:31.069Z — Text/source/policy guard; 2026-10-11T07:44:12.659Z — Text/source/policy guard |
| 45 | `tests/workflows.test.mjs` — every workflow keel ships keeps the night shift's rules, as a template and as rendered on keel | 1 | 2026-10-10T12:44:31.069Z — Text/source/policy guard |
| 46 | `tests/cli.test.mjs` — --json parses for every verb and flag; human text never mixes in | 2 | 2026-10-11T02:35:05.581Z — Phase acceptance lint; 2026-10-11T08:19:28.388Z — Ordinary-proposal regression |
| 47 | `tests/doctor.test.mjs` — keel itself is clean under its own doctor | 1 | 2026-10-11T02:35:05.581Z — Phase acceptance lint |
| 48 | `tests/skill.test.mjs` — the keel skill stays short (≤ 180 words) and names no verb but --agent-help | 1 | 2026-10-11T03:28:43.228Z — Text/source/policy guard |
| 49 | `tests/timing-hygiene.test.mjs` — every test file that times a suite is pinned to stalls or runs under mock timers, and every pin is a test file | 1 | 2026-10-11T06:25:54.518Z — Text/source/policy guard |
| 50 | `tests/fleet.test.mjs` — fleet update: a current project whose unrecorded migrations do not apply is not planned, and --yes clones nothing | 1 | 2026-10-11T06:33:53.995Z — Text/source/policy guard |
| 51 | `tests/fleet.test.mjs` — fleet update plans only real work: applies() is asked over the default branch through the contents API | 1 | 2026-10-11T06:33:53.995Z — Text/source/policy guard |
| 52 | `tests/skill.test.mjs` — the conduct skill ends real work with a retro: the worksheet, the seven areas, typed candidates, the owner picks | 1 | 2026-10-11T06:58:17.450Z — Text/source/policy guard |
| 53 | `tests/skill.test.mjs` — the conduct skill and its AGENTS block say a fix: commit carries a Proven-by: trailer from keel prove | 1 | 2026-10-11T06:58:17.450Z — Text/source/policy guard |
| 54 | `tests/practices.test.mjs` — templates name the project only through {{name}} | 1 | 2026-10-11T07:44:12.659Z — Text/source/policy guard |
| 55 | `tests/board.test.mjs` — the server binds 127.0.0.1 only, refuses a request without the launch token, and runs actions through the verbs | 1 | 2026-10-11T08:20:23.052Z — Socket permission |
| 56 | `tests/board.test.mjs` — the page carries a strict CSP, and every inline script and style carries its nonce | 1 | 2026-10-11T08:20:23.052Z — Socket permission |
| 57 | `tests/board.test.mjs` — the page refreshes from /board.json with the token as a header, and an action meant for a moved id is refused | 1 | 2026-10-11T08:20:23.052Z — Socket permission |
| 58 | `tests/board.test.mjs` — the board runs a choice through walk done, with the note written beside it | 1 | 2026-10-11T08:20:23.052Z — Socket permission |
| 59 | `tests/board.test.mjs` — the board keeps its GitHub reads 10 minutes: the 60 s refresh asks GitHub nothing, the Refresh button and --fresh read again, and it says what the reads cost | 1 | 2026-10-11T08:20:23.052Z — Socket permission |

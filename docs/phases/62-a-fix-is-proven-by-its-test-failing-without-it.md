---
status: partial
owes: walk
since: 2026-10-09
goal: G0
spec: 2
depends: []
note: "Built: keel prove runs the named test in a scratch worktree with the fix's files put back at the base, then in a second scratch worktree with the fix, and prints VERIFIED, NOT WORKING or INCONCLUSIVE with the failure's first line; --trailer and --evidence record it; the conduct skill and AGENTS block ask a Proven-by: trailer of every fix: commit; the night's escapes notes the fix: commits without one. Owes the walk: two weeks of keel's own fixes carry it, and the owner reads three."
evidence: ["evidence/2026-10-09-prove.md"]
issue: 49
---

# A fix is proven by its test failing without it

## Done when

`keel prove <test> --fix <files>` reverts the fix's files, runs the named test, records that it failed and how, restores the fix, runs it again, and writes the verdict (VERIFIED, NOT WORKING or INCONCLUSIVE) with the failure text into the commit trailer or the phase's evidence; the conduct skill requires it for every `fix:` commit; and keel's own fixes for two weeks carry it.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 5.

- **The command**: `keel prove <test file> [--name <pattern>] --fix <path>...` stashes the named files' changes (or reverts them to the base commit), runs the test, captures the first lines of its failure, restores the files, runs it again, and prints the verdict:
  - VERIFIED: red without the fix, green with it.
  - NOT WORKING: green without it (the test doesn't catch the bug) or red with it.
  - INCONCLUSIVE: the test can't run without the fix (it doesn't compile, say), with the reason.
- **The record**: `--trailer` prints a `Proven-by:` commit trailer (the test, the verdict, the failure's first line); `--evidence <phase>` appends it to the phase's evidence.
- **The rule**: the conduct skill and the agent guide say a `fix:` commit carries a `Proven-by:` trailer; the night's `escapes` measure notes fixes without one.

## Acceptance

- [x] `keel prove` reports VERIFIED for a test that fails without the fix and passes with it, NOT WORKING for one that passes either way, and INCONCLUSIVE when the test cannot run without it; the working tree is restored in every case. `tests/prove.test.mjs`
- [x] `--trailer` prints a `Proven-by:` line with the verdict and the failure's first line; `--evidence` appends it to the phase's evidence. `tests/prove.test.mjs`
- [x] The conduct skill names the rule. `tests/skill.test.mjs`
- [x] The night notes `fix:` commits since the last release that carry no `Proven-by:`. `tests/improve-measures.test.mjs`
- [ ] ⚑ by hand: two weeks of keel's own fixes carry it; the owner reads three.

## Your part

- **Ask:** Read three of keel's fix commits from the last two weeks and their `Proven-by:` lines, and say whether they convince you the fix works.
- **Why:** A test that never failed without its fix proves nothing, and this is how keel shows it did.
- **Look at:** `git log --grep Proven-by` in keel.
- **Choices:** Convincing | Not convincing
- **Takes:** 10 minutes.
- **Then:** Convincing: the phase is built. Not convincing: what was missing goes into the rule.
- **Ready when:** two weeks of fixes have been proven.

## Real surfaces

- Owner's machine: `keel prove` in keel's own work.

## Proof

Automated: `node --test tests/prove.test.mjs tests/skill.test.mjs tests/improve-measures.test.mjs`; `npm run check`.
Over time: two weeks of keel's fixes.

## Deliberately open

- **Which files are the fix**: `--fix` names them; inferring them from the commit is later work.

## Next action

The walk: for two weeks, every `fix:` commit in keel carries a `Proven-by:` trailer from `keel prove --trailer`; then the owner reads three (`git log --grep Proven-by`) and says whether they convince.

## Trajectory

- **2026-10-09** — The fix is never stashed or reverted in the working tree, as the Scope first said. It is put back in a scratch `git worktree add --detach` of the current tree (HEAD with the tree's changes laid over it, `node_modules` linked), and the test runs there (lesson 54). A test asserts the tree is byte-identical after every verdict.
- **2026-10-09** — The runner is `node --test` with the preloads of the project's `package.json` test script (keel's own needs `--import ./tests/helpers/hermetic.mjs`). Another runner is named in `.keel/keel.json` `"prove": {"command": "<command> {file}"}` and read by its exit code alone. A load error is a file-level failure with an exit code and no failing test.
- **2026-10-09** — INCONCLUSIVE also covers a fix whose files are the same at the base (nothing to revert: a committed fix given the wrong base) and a `--name` that matched no test, so a misused command never reads as NOT WORKING.
- **2026-10-09** — The cold start was at 3182 of 3200 characters. Six verb lines were trimmed to fit `keel prove` (3175 now); the next verb needs a trim first.
- **2026-10-09** — Codex on #55: the with-fix run in the real tree could give a false VERIFIED (an ignored file present there, absent in scratch) and let the test write into the user's tree. Both sides now run in fresh scratch worktrees built the same way, which cannot make one side red for a reason the other lacks; copying ignored files was rejected (it can never be sure it copied what the test reads). A skip or todo no longer counts as run, a test changed by the fix is not run in its old form, file modes count, `--name` needs `{name}` in a custom runner, submodules are laid over, and the night reads `Proven-by:` from git's own trailer block.

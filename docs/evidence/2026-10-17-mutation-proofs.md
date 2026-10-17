# Evidence: phase 84 — a fix's test is shown to catch plausible wrong versions of the fix

- Date: 2026-10-17
- Phase: [84](../phases/84-a-fix-s-test-is-shown-to-catch-plausible-wrong.md)
- Revision: base `b8b86c6` (Merge pull request #178) and working tree on
  `claude/phase-84`.
- Claim being checked: `keel prove --mutate` mutates only the JavaScript and
  TypeScript lines the fix added or changed, with five mechanical mutators,
  each mutant alone in its own scratch copy (the real tree byte-identical
  after); a passing baseline runs first; each mutant runs the selected test
  once under a time limit and is caught only when a test that passed at the
  baseline fails, a survivor when the selected tests pass, invalid when it
  does not parse or import, inconclusive when it times out or no selected
  test ran; at most 40 mutants, spread evenly; `--trailer` adds
  `Mutants: <caught>/<total>`.

Every repository in the tests is a synthetic Acme one in a temp directory,
with its own `TMPDIR`, so the tests also see every scratch copy removed.

## Automated checks

`node --import ./tests/helpers/hermetic.mjs --test tests/prove-mutate.test.mjs tests/prove.test.mjs tests/helpers.test.mjs`
(2026-10-17): 42 tests, 42 pass, exit 0. `tests/prove.test.mjs` is the
phase-62 suite, run because `lib/prove.mjs`'s runner was refactored to share
its command line with the new time-limited runner. The whole gate,
`npm run check`, ran on the integrated tree before the commit; its result
line is in the commit body.

| Acceptance box | Test (`tests/prove-mutate.test.mjs`) |
| --- | --- |
| 1. each of the five mutations applied to a fixture fix, alone, on a scratch copy; the real tree never changed | "each of the five mutators makes its mutation on the lines asked, one change per mutant" (every kind, the exact candidates of one line, each applied mutant differing from the source by its one change only); "strings, comments, templates and regular expressions are never mutated; nor arrows, shifts or generics"; "a return early is made only where a statement starts inside a block"; "a strong test catches every mutant of the fix, each of the five kinds applied alone in a scratch copy; the tree is untouched" (all five kinds ran; every e2e test asserts `treeState` identical before and after, and its `TMPDIR` empty) |
| 2. a strong test catches every mutant; a weak one leaves named survivors | "a strong test catches every mutant …" (9/9); "a weak test leaves named survivors: file, line and mutation; --name picks the test" (`--name weak`: 5/9, the four survivors named exactly; `--name strong`: 9/9) |
| 3. a failing baseline stops the run; parse, import or timeout is invalid or inconclusive, never caught | "a failing baseline stops the run …" (`baseline failed`, no mutant run, exit 1); "a mutant that does not parse or import is invalid, never caught" (a return inside an object literal: SyntaxError; a condition negated or dropped so the module throws at import: 3 invalid, `Mutants: 1/6`); "a mutant that does not finish is stopped at the time limit and reported inconclusive" (`while (true)` killed at 1.5 s with its process group, 6/7) |
| 4. only the fix's changed lines, at most 40, each run time-limited | "only the changed lines of a committed fix are mutated, …" (an unchanged function full of candidates is never touched; the strong test's `changed` is exactly lines 2 and 3); "at most 40 mutants, spread evenly over the changed lines" (unit: 100 lines → 40 evenly spaced, one each; 7 lines → shares within one); "a fix of many lines runs at most 40 mutants, spread over its lines" (45 changed lines, 270 candidates → 40 mutants on 40 lines); the timeout test's `limitMs` |
| 5. `--trailer` records `Mutants: caught/total` | "only the changed lines of a committed fix are mutated, and --trailer records Mutants: caught/total" (`trailer` is the `Proven-by:` line, then `Mutants: 5/9`; the text ends with both) |
| 6. ⚑ the owner reads one real fix's survivors | Not ticked: it waits for the owner. One run on a real keel fix is below, as a first look, not the owner's verdict. |

PR #180's review (2026-10-17) added two guards, each proven by its test
failing without the fix (the `Proven-by:` trailers are in the two `fix:`
commits): "a fix file that is a symlink to a file outside the repository is
never mutated: the outside file is byte-identical" (without the fix, the
outside file was rewritten by a mutant) and "a failure of a test that shares
its name with another is inconclusive, never caught" (without the fix, the
`<` → `<=` mutant was counted caught).

After the suite, `ps` showed no `count.test.mjs` process left running: the
looping mutant's test child was killed with its group, not orphaned.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| In a `git clone --shared` of this worktree in the scratchpad, checked out at `012a0af` (`fix: docs-only skip reads the file mode on both sides`), ran `keel prove tests/gate-reuse.test.mjs --name 'deleting an executable' --fix practices/night/files/scripts/keel/gate.mjs --mutate --trailer` | VERIFIED, and a mutant report | VERIFIED; `mutants: 6/7 caught (1 survivor) on 7 changed lines; each run limited to 10s`; the survivor `gate.mjs:306 — number \`0\` → \`1\`` (the mode read as `l.split(' ')[1]`, the object type, not `[0]`, the mode); `Mutants: 6/7`; exit 0; 8.1 s | It runs on a real fix in keel and names a survivor by file, line and mutation. Whether that survivor is a real gap (the named test refuses the skip for any mode but `100644`, so reading `blob` instead also refuses it) is the owner's call in box 6. |

## Gaps and decision

- The ⚑ box: the owner has not read a real fix's survivors. Status is
  `partial`, not `built`.
- Mutations are textual, on single lines: a condition whose parentheses
  close on a later line is not mutated, nor a comparison written without
  spaces, nor anything in a template literal's `${}`. A line that starts in a
  comment gets no early return. These are deliberate narrowings (fewer
  invalid mutants), not checked against a real fix's misses.
- The per-run limit (five times the baseline, at least 10 s) is a choice,
  not measured against slow suites.
- A runner read by exit code alone (`"prove".command` without `"tap": true`)
  cannot tell a caught mutant from one that never loaded: no mutant is
  judged (`not run`, exit 1), covered by "a runner read by exit code alone
  judges no mutant …". A `"tap": true` command runner is not exercised by
  these tests.

# Evidence: phase 74 — goodnight: the owner shapes tonight's plan

- Date: 2026-10-14 (local `date`; the night it shapes runs 2026-10-15 UTC)
- Phase: [74](../phases/74-goodnight-the-owner-shapes-tonight-s-plan.md)
- Revision: base `8c41a25` (phase 73, `claude/phase-73`, PR #140, not yet
  merged) plus the phase 74 commit on `claude/phase-74`.
- Claim being checked: `keel goodnight` shows settled today, left open, the
  default plan and up to three things to try; add, drop, edit, budget and skip
  change a draft and refuse what breaks the plan's rules, naming why; `--yes`
  writes the plan shaped by the owner and pushes it to `keel-night-plan`;
  without `--yes` nothing is written or pushed; the conduct skill's
  `/goodnight` runs only when asked and writes only on "that's the plan".

**No real evening ran.** Nothing here pushed to GitHub or read the live
`keel-night-plan` branch. Every GitHub read is a stub gh; the push goes to a
bare origin on disk.

## Automated checks

`node --import ./tests/helpers/hermetic.mjs --test tests/goodnight.test.mjs tests/skill.test.mjs`:
exit 0, `ℹ tests 19`, `ℹ pass 19`, `ℹ fail 0`.

| Acceptance box | Test |
| --- | --- |
| `keel goodnight` shows settled today, left open, the default plan and up to three suggestions, from a stubbed gh and a fixture project | `tests/goodnight.test.mjs`: "keel goodnight shows settled today, left open, the default plan and up to three things to try, from a stubbed gh and a fixture project, and changes nothing" (in process with the board injected, and through the CLI with the real board, whose unreadable reviews are a `not read:` line; the tree, every local ref and the origin's refs are byte-identical before and after) |
| add, drop, edit, budget and skip change the draft; a sixth build item, a build with no number, an item naming something settled today are refused, naming why | `tests/goodnight.test.mjs`: "add, drop, edit, budget and skip change the draft; a sixth build item, a build with no number, or an item naming something settled today is refused, naming why" (each refusal leaves the draft byte-identical; a symlinked `.keel/night` is refused) |
| `--yes` writes the plan with `shapedBy: owner` and pushes it to the plan branch of a bare origin; without `--yes` nothing is written or pushed | `tests/goodnight.test.mjs`: "--yes writes the plan with shapedBy owner and pushes it to the plan branch of a bare origin, one file, main untouched; without --yes nothing is written or pushed" (one parentless commit, one file, byte-identical to the written plan; origin's main, local HEAD, the index and the tree unchanged; phase 73's `tonight` step takes the pushed plan as the owner's; a second `--yes` force-pushes, still one commit; no remote is exit 2 with nothing written) |
| The conduct skill's `/goodnight` runs only when asked and writes only on "that's the plan" | `tests/skill.test.mjs`: "the conduct skill's /goodnight runs only when asked, shows the opening, shapes by the owner's words, and writes only on \"that's the plan\"" |

Two mutations of `lib/goodnight.mjs`, each run against its test and then
undone: a plan commit with HEAD as its parent fails the `--yes` test ("no
history: never merged, never based on main"); `namesSettled` returning null
fails the shaping test ("Missing expected rejection"). Otherwise the tests
were written with the feature.

Also run: `tests/cli.test.mjs`, `tests/canvas-cli.test.mjs` (the cold start
announces the verb at 3180 of 3200 characters, 15 more than before),
`tests/guides.test.mjs` (every goodnight form in the night guide),
`tests/docs.test.mjs` (the README row), `tests/practices.test.mjs` (the
skill's new rules carry their causes), and `npm run check` on the integrated
tree; its result is in the commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| `keel goodnight` on keel's own checkout, gh stubbed to print `[]`, keel's cache in a scratch directory | the opening from keel's real phases, health page and board; nothing written | Settled today listed phases 73–77 as new (then changed: a phase written today at planned or designed has not moved); left open listed five "yours" items from the board and a `not read:` line for the reviews; the default plan had three items; `git status --porcelain --ignored` identical before and after; exit 0 | The opening reads keel's real records and writes nothing. Not the real gh: merged and open PRs were empty. |
| The owner runs `/goodnight` one evening and reads the plan the next morning | the conversation gives them what they need to choose | Not run | The ⚑ box. Needs phases 73 and 74 merged, and an evening. |

## Gaps and decision

- No real push to GitHub's `keel-night-plan`; the bare origin stands in. The
  push is `git push --force <remote> <sha>:refs/heads/keel-night-plan`, so it
  needs the owner's push rights on the repo, as any push does.
- "Today" is since the plan branch's commit as this checkout last fetched it
  (no fetch: the opening writes nothing), else the last 24 hours.
- Unanswered reviews come from the board's read, which needs GitHub's GraphQL;
  under the quota floor or with gh down it is a `not read:` line.
- Personas' missed goals come from their newest review pages, not a run.

Supports **partial, owes: walk**: every automated box is ticked; the owner's
evening remains.

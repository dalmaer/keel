# Evidence: phase 52 — a fleet update always leaves a PR

- Date: 2026-10-09
- Phase: [52](../phases/52-a-fleet-update-always-leaves-a-pr.md)
- Revision: base 913f3cc (Lesson 57: a parallel suite waits for its longest file), working tree
- Claim being checked: when the project's check fails after the update, `keel fleet update` pushes the branch and opens the PR (ordinary when main fails the same check, a draft otherwise, each description opening with what failed), never FAILED; clone, setup and install failures stay FAILED with nothing pushed; `keel update` in one checkout still restores and exits 1; the board lists a draft update PR under Broken.

## Automated checks

`node --import ./tests/helpers/hermetic.mjs --test tests/fleet.test.mjs tests/update.test.mjs tests/board.test.mjs`: exit 0, "ℹ pass 65 / ℹ fail 0". A stubbed gh and real git against local bare origins; no network.

- `tests/fleet.test.mjs` "a failed check keeps the update and opens its PR …": three projects whose check fails with the update. `acme/red` fails on main too: an ordinary PR whose description opens "main was already red: `echo acme-red-main; exit 4` fails without this update (exit 4); this update did not cause it." and main's output. `acme/picky` passes on main: a draft opening "This update fails the project's check: `…` (exit 5). main passes without it, so the fix is one commit on this branch." and the update's output. `acme/stuck` is killed on main (SIGTERM): a draft saying main's check did not finish. Each branch is pushed with the practice bumped; main is untouched; no row says FAILED at update. The Evidence line says the real exit, never exit 0. `acme/broke` (a failing `npm ci`) is FAILED at install with nothing pushed and no PR.
- `tests/fleet.test.mjs` "a project behind …": `machinePrs.drafts` names the draft `keel/update-` PR, not a person's draft.
- `tests/update.test.mjs` "a failing check after a migration restores every byte …": `--local`, the CLI, and now `--yes` in one checkout all restore and exit 1 with no branch; with `keepFailedCheck` the update is committed on `keel/update-v<version>`, `check` is `{command, ok: false, exit: 7, tail}`, main is byte-identical, and gh is never called.
- `tests/board.test.mjs` "a draft keel update PR is broken …": "acme/site: keel update v0.8.21 fails site's check" under Broken, linking `https://github.com/acme/site/pull/12`; a draft night PR and a non-numeric PR number make no item; loose-ends' listing of the same PR is dropped; unreadable machine PRs invent nothing.

Mutations, each in a scratch copy of the tree, each caught by the named test:

| Mutation | Caught by | Failure |
| --- | --- | --- |
| The fleet calls update without `keepFailedCheck` (restores, no PR) | fleet "keeps the update" | `acme/red`: `[false, undefined, 'update']` for `[true, <url>, undefined]` |
| `failureOf` returns `draft: false` when main passes | fleet "keeps the update" | drafts `[false, false, false]` for `[false, true, true]` |
| `publish` drops `--draft` at the gh boundary | fleet "keeps the update" | "main passes: a draft": `false` for `true` |
| The fleet counts every machine PR as a draft | fleet "a project behind" | drafts include the keel-night PRs |
| `update()` keeps the files without the option | update "a failing check … restores" | "the project is as it was" missing |
| The board lists loose-ends' copy of the draft too | board "a draft keel update PR" | "listed once" |

`npm run check` is the conductor's, on the integrated tree.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| A real fleet update fails a project's check; its draft is fixed by one commit on its branch and merged | A draft PR that says what failed and how to fix it | Not run | The ⚑ walk: owed |

## Gaps and decision

Nothing real has failed since this was built, so no real draft PR has been read or fixed. The automated checks support partial with the walk owed, not built.

# Keep the fleet current

## When you'd reach for this

- The practice changed in keel (an accepted lesson, a new practice, a fix)
  and you want every project to have it.
- You want to see every project at once: which is behind, which is red,
  which has gone silent, which has lessons keel hasn't heard.
- A single project is behind and you want to update it yourself.

## What it does, and why it works that way

**Changes go out from keel; a project never pulls.** Projects run on their
own: their workflows never fetch keel or hold a keel token. So the owner,
at keel, opens the update PR in each project that is behind, with their own
`gh` login, and a person in that project merges it. A practice change lands
like any other change: read by a person, checked by that project's CI.

**Two versions.** The CLI's version moves with every release; the practice
version (`practices/VERSION`) moves only when what projects receive
changed (the practices, the migrations, or the lessons catalogue each
project's view is rendered from). A release of keel-side tooling alone
leaves every project current, so nobody gets a PR that changes nothing but
a number.

**Update runs in an order, and the order is the rule:**

1. **The CLI updates itself first.** An old CLI must never run a new
   migration (lesson 12: a tool built for one version, silently
   incompatible with the next).
2. **A project on a newer practice than this CLI is refused**: update keel
   first.
3. **The tree must be clean, and nothing of keel's may have been changed by
   the project.** Update never overwrites a project's edit; it stops and
   points at `keel doctor`.
4. **Migrations run**, in order, each returning its edits rather than
   making them. If one throws, nothing is written. A migration that has not
   run is pending even on the same practice version, so a project adopted
   late still gets it (lesson 15: a version gate decides who gets a fix).
5. **Managed files re-render**, the lock and practice version move, the
   roadmap regenerates.
6. **The project's own gate runs.** If it fails, every byte update touched
   is put back.
7. **A commit on its own branch**, and, with a yes, a push and a PR.

**Drift is signal, not error.** Each file keel wrote is in
`.keel/lock.json` with the hash it was written with, so `keel doctor` knows,
rather than guesses, whether a file changed:

- **edited**: the project changed it. Keel's most valuable signal: someone
  needed the practice to be different here.
- **behind**: unchanged, but keel's template moved on. That is update's job,
  not a finding.
- **both**: both moved. (When the project's edit is one keel has since made
  too, such as Renovate bumping an action in keel's workflow before keel
  did, it counts as behind, and update simply takes keel's file.)

For an edited file there are three honest moves, and update waits until you
pick one: keep yours (eject it, and render leaves it alone for good), take
keel's (restore), or send yours home as a lesson so keel considers it for
everyone.

## The commands

At home, in keel's checkout:

```bash
keel fleet                 # every project at once; changes nothing
keel fleet update          # the update PR each project behind would get; exit 3
keel fleet update --yes    # ⚑ open them, one at a time, with your gh login
```

- `keel fleet` reads `fleet.json` at keel's root and asks GitHub about every
  repo: adopted or not, practice version, migrations not yet run, the
  newest health page (old means the night has gone silent), CI on the
  default branch, unsent lessons, open machine PRs. It ends in a "Needs
  you" list. A cell it could not read says so; it is never shown as healthy.
- `keel fleet update` without `--yes` is the plan: each project it would
  update, and why the rest are not planned. With `--yes` it clones each into
  a temp directory, installs as that project's night would, and runs
  `keel update --yes --no-self-update` there. A clone, setup or install that
  fails says which step and why, and pushes nothing; the others go on.
- A failing check never throws the update away. The fleet keeps it on its
  branch, runs the same check once more on main without it, and opens the PR
  anyway. Its description opens with what failed:
  - main fails the check too: an ordinary PR, "main was already red", with
    the end of main's output. Merge it on its own merits; fix main elsewhere.
  - main passes: a draft, "This update fails the project's check", with the
    command and the end of its output. The fix is one commit on that branch;
    then mark it ready and merge it. A draft cannot be merged by accident.
  - main's check did not finish: a draft, saying so.

  The row says `opened <url> (draft: the update fails the check)` or
  `opened <url> (main was already red)`, never FAILED. `keel board` lists the
  draft under Broken. `keel update` in one checkout still puts everything back
  and exits 1: you are there to read it.

Cutting a release, in keel:

```bash
keel release                                      # the current version, and the newest WHATSNEW entry
keel release 0.9.0 --notes notes.md --dry-run     # says whether the practice version moves too
keel release 0.9.0 --notes notes.md
```

- `--notes <file|->` is the WHATSNEW entry, written for the person receiving
  it, not for keel.
- `--practice <x.y.z>` only when the practice should move to a version other
  than the CLI's.
- `--dry-run` first, because it says which kind of release this is, and lists
  the practice commits the review gate will check.
- **The review gate comes first.** Each commit since the last release tag
  that touches `practices/`, `migrations/` or `docs/lessons.md` must have
  come through a merged PR whose review passes `keel review <repo>#<n>
  --gate`: every comment answered, and its head reviewed by someone other
  than its author (keel's own cross-review: Codex reviews `claude/` PRs).
  A commit pushed straight to `main` refuses the release (exit 1, naming the
  commit), and nothing is written. There is no `--yes` past it. The owner may
  pass `--unreviewed "<why>"`; the reason goes in the release commit and the
  WHATSNEW entry.
- Then the release runs the gate on the bumped tree; a failure puts every
  file back. It makes a commit and a local tag, and never pushes.

In one project, by hand:

```bash
keel update --local        # look first: the whole update as a working-tree diff
keel update                # the same, committed on keel/update-v<version>; exit 3
keel update --yes          # ⚑ push that branch and open the PR
```

- `--local` when you want to read the diff before anything is committed, or
  when the project lands changes without PRs.
- `--yes` answers the push and the PR; it can't be combined with `--local`.
  Re-running with `--yes` resumes from the branch already made.
- `--no-self-update` skips pulling keel's checkout first; `keel fleet
  update` passes it because it already runs the newest keel.

And for drift:

```bash
keel doctor                                          # what changed, with the diff; changes nothing
keel doctor --fix CLAUDE.md eject --yes              # keep the project's version
keel doctor --fix .agents/skills/conduct/SKILL.md restore --yes   # take keel's
```

## What you'll see

`keel update` prints what changed (the migrations, with any ⚑ note a
migration leaves for you, and the re-rendered files), the gate's result,
and the commit on its branch, then what `--yes` would do. The PR it opens
has a body in three sections: Summary (the
changed files as a tree), Evidence (the gate, the practice before and after)
and Merge danger: a **two-way door** when it only re-renders keel's files, a
**one-way door** naming the paths when a migration rewrote the project's
own.

- **0**: updated (or already on this practice, nothing pending).
- **1**: refused because the project changed keel's files, or the gate
  failed after the update and everything was put back.
- **2**: the project is on a newer practice than this keel, the tree is not
  clean, or it is not a git work tree.
- **3**: committed on the branch; the push and PR need `--yes`.

`keel fleet` exits 0 whenever it drew the table. `keel fleet update` exits 3
with its plan (0 when nothing is behind) and 1 when any repo failed.

## What it never does

- A project never reaches back to keel at runtime.
- Update never overwrites a file the project changed, never leaves a
  half-applied migration, and never leaves a failed gate's changes in the
  tree.
- Fleet update never touches keel itself, or a project whose update PR is
  already open, and never merges.
- Release never pushes.

## See also

- [When something is red](when-something-is-red.md): a refused update, a
  gate failing after update.
- [Reviews and PRs](reviews-and-prs.md): reading the update PR, and its
  reviewers.
- [Lessons and learning](lessons-and-learning.md): sending an edit home.
- [`docs/design.md`](../design.md), sections 1 and 3: file kinds, versions
  and migrations.

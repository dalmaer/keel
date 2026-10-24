# Name transition: plates stops writing keel's names

Specified 2026-10-23. Phases 124–130.

## Why this exists

The rename to Plates (phase 109, #216) moved the product, the CLI, the config
and every managed file. It deliberately did **not** move the names that already
lived somewhere else: on GitHub, in a database, in a browser or on the owner's
machine. `lib/rename.mjs`'s `DURABLE` list holds them, so a project that
migrated kept its open night PRs, tonight's plan and its verify history.

That was right for the migration. It is wrong as a resting state, because the
shipped templates write those names too. A project adopted after the rename,
such as dtv on 0.8.33, has no keel history but still opens `keel-night/<date>`
branches. What a person sees is a product called plates writing keel's name
into their repository every night.

The owner's decision (2026-10-23) is that nothing else moves until the whole
fleet has made this transition, **plates first**, and that the whole rollout
happens in one evening.

## The rule

Every name moves the same way, in three steps, each a release:

1. **Write new, read both.** Plates writes only the plates name. Every reader
   accepts the plates name first and the keel name second. Where both exist for
   the same thing, the plates one wins, and the reader says so.
2. **Prove it on plates, then on each project, in one evening.** Plates moves
   first and passes a checklist on a night run dispatched by hand
   (`workflow_dispatch`). Then each fleet project moves in turn, the same
   evening, each checked the same way. A project that fails stops the
   rollout. (The owner's call, 2026-10-23: no waiting a week.)
3. **Retire.** Once no active fleet dependency uses a keel name, the
   live-state fallback reads go, in one release. Historical metadata readers
   remain permanently: unchanged old decisions, proofs and reconciliation records
   must still resolve. Retained aliases with verified replacements are shown
   separately from active dependencies and unknown coverage; they may enter the
   exact owner-approved removal operation, followed by an empty-inventory check.
   This avoids requiring old variables to be gone before the step that deletes
   them. Unverified replacements block, and secret values are never inspected.
   Retirement requires the owner to say retire.

A name that cannot be read both ways, such as a database function a deployed
build calls, gets a forwarding alias for the old name. It is not a hard switch.

Nothing historical is rewritten. Records keep the name in use when they were
written: evidence, health pages, night records, merged PR bodies, commit
messages and trailers, git history. This is lesson 58's rule. The transition
touches only the names in the table below, an allowlist, and never anything by
pattern.

## What still says keel

From origin/main at `216c8af`, in lib, practices, bin, scripts, .github and web:

| Surface | Names | Refs | Who can change it |
| --- | --- | --- | --- |
| Git branches | `keel-night/<date>`, `keel-night/<date>-final`, `keel-night-plan` (blob `.keel/night/plan.json`), `keel-climb/`, `keel-tend/`, `keel-loop/`, `keel/robot-*`, `keel/update-*`, `keel-verify` | ~290 | plates (new writes); open PRs keep their head branch |
| Concurrency groups | `group: keel-…` in 17 workflows | 17 | plates |
| CI artifacts | `keel-test-runs`, `keel-production-<n>`, `keel-canvas-night`, `keel-canvas-card`, `keel-tend-page`, `keel-time-proposal(s)` | ~50 | plates; old artifacts expire on their own retention |
| Comment markers | `<!-- keel:… -->` (health-report, morning, robot-state, cross-review, …) | 131 | plates (new writes); old ones stay in old bodies |
| Labels | `keel:agent`, `keel:review-after`, `keel:morning`, `keel:robot-*`, `keel:wait-for-review`, `keel:owner`, … | 240 | GitHub: a label rename is a remote change, ⚑ |
| PR-body fences | `keel-impact`, `keel-decision`, `keel-reconciliation`, `keel-proof`, `keel-measurements` | 80 | plates (new writes); merged bodies keep theirs |
| Repository variables | `vars.KEEL_*` | 5 | the owner, in GitHub settings, ⚑ |
| Web home | cookies `__Host-keel-session/login/oauth`, env `KEEL_WEB_ORIGIN/OPERATION`, headers `Keel-Operation`, `Keel-Update-Operation`, `trusted-keel` | ~40 | plates; Vercel env is the owner's, ⚑ |
| Database | schema `keel_private` (261 refs, mostly migrations), `keel_*_rpc` functions (70), `keel_run_history`, `keel-job-migrations` | ~340 | plates, by migration; the hosted database is the owner's, ⚑ |
| Owner's machine | `~/.keel/night-card/run.sh`, `~/Library/LaunchAgents/com.keel.night-card.plist`, `~/.keel/tools/`, git worktrees named `keel` | — | the owner, ⚑ |

Counts are `git grep -c` and include tests' and practices' rendered copies; the
phase 124 inventory replaces them with exact rows.

## Hazards, each settled by a phase

- **An open PR's head branch cannot be renamed.** A night that started under
  `keel-night/<date>` finishes there: its `-final` follows the night's own
  branch, not the current default. Drain, morning, the board, loose-ends and
  the web run views match both prefixes, as one queue. (125)
- **Two plans for one night.** While both plan branches exist, `goodnight` writes
  only `plates-night-plan`. The night reads it first, and reads
  `keel-night-plan` only when the plates branch holds no plan dated tonight.
  When both hold one, the plates plan wins and the night says so. (125)
- **A concurrency group change lets two runs overlap once.** A run still queued
  under `keel-night` does not wait for one under `plates-night`. Every night
  push may target a different ref, so a branch lease cannot serialize the two
  names. Before installing changed workflow groups in a repository, the owner
  disables the affected workflows with separate approval, then drains old runs
  or confirms cancellation is complete. Keep that dispatch/schedule barrier
  until the changed workflows are installed; a one-time empty listing alone
  cannot exclude a new cron run. The rollout preflight
  must prove no queued, waiting, pending or running old-group run remains;
  incomplete API coverage refuses the switch. No new dispatch until this
  barrier passes. A regression exercises both prefixes and proves that a live
  old run blocks the switch, including morning/finalization. (125, 128, 129)
- **An artifact reader finds nothing on the first night.** Readers accept both
  names for as long as the artifact's own retention (30–90 days). (126)
- **A label rename is a remote change, and filters and saved searches use the
  name.** GitHub keeps a renamed label on its issues, so it is renamed, not
  recreated. That happens only with the owner's yes, per repository. (128)
- **A cookie rename can break upgrade and rollback.** Deploy an owner-approved
  compatibility-reader release for session, login and OAuth cookies before
  switching writers or clearing legacy cookies. Pin it as the verified rollback
  target. Only then may the new build issue plates cookies and retire each old
  alias on response, preserving expiry. Rollback must consume the new cookies
  and finish in-flight login/OAuth flows; logout clears both aliases. A legacy-only
  rollback target blocks activation. This deployment is an explicit owner step,
  not implied by merging source. (127)
- **A database rename breaks the build that is still deployed.** New
  `plates_*` functions arrive by migration, and the old `keel_*` names stay as
  thin forwarders until retirement. The schema itself is moved with
  `alter schema … rename` only at retirement, behind a forwarding view, or not
  at all; 127 decides which. (127)
- **Variables and secrets cannot be read back.** Workflows read
  `vars.PLATES_X || vars.KEEL_X`. Plates can copy a repository variable through
  the API, but never a secret. Secrets are listed for the owner, with the exact
  `gh secret set` command and no value. (128)
- **The finalize rewrite already drops what it did not write (#218).** The
  branch work in 125 edits the same morning and finalize code, so #218 is fixed
  first, with its own regression test, or the new prefix ships the old bug.

## The phases

| Phase | Outcome | Depends |
| --- | --- | --- |
| [124](../phases/124-every-keel-name-plates-still-writes-is-listed.md) | One table lists every keel name plates still writes, and a new one cannot slip in | 109 |
| [125](../phases/125-plates-s-own-branches-are-written-as-plates-and.md) | Night, climb, tend, loop, robot, update and verify branches and concurrency groups are written as plates and read under both | 124 |
| [126](../phases/126-markers-fences-labels-and-artifacts-are-written.md) | Markers, fences, label names and artifacts are written as plates and parsed under both | 124 |
| [127](../phases/127-the-web-home-and-its-database-move-to-plates.md) | The web home and its database move to plates names without logging anyone out or losing a row | 124 |
| [128](../phases/128-what-the-owner-holds-moves-with-the-owner-s-yes.md) | Labels, repository variables, secrets, Vercel env and the owner's machine move with the owner's yes | 125, 126, 127 |
| [129](../phases/129-plates-then-the-fleet-move-tonight.md) | Plates, then the fleet, move in one evening, each proven by a night run dispatched by hand | 128 |
| [130](../phases/130-plates-stops-reading-keel-s-names.md) | Plates stops reading keel's names | 129 |

The fleet order in 129 is plates, ledger, duo, cajones, isocan, then dtv. isocan
is Dimitri's: its move is proposed as a PR, never merged by plates. dtv is
adopted but not in `plates.json`, and 129 settles that.

## What is not moving

- The `keel` command and `bin/keel.mjs`, the `/conduct` skill alias, and
  `.keel/` reading in `migrate` stay. They are compatibility entry points for
  people and machines, not names plates writes. 130 records whether they stay
  for good.
- Historical records (see "The rule").
- `claims/`, `ready/` and `green`, which never carried a product name.

## Open

- Whether `keel_private` is renamed at all, or kept as an internal name nobody
  sees. 127 measures what a rename costs on the hosted database.
- A dispatched night is not a scheduled one. The first scheduled night after
  the rollout is the last check, and its morning brief reopens 129 if any
  project still writes a keel name.

## 2026-10-24: standalone runtime packaging

Phase 126 centralizes fence aliases in the phase-124 name table. Reconciliation
therefore ships its canonical `names.mjs` sibling as part of the installed runtime.
This explicitly supersedes the prior single-file-copy promise in the decision
context guide; it does not add a third-party dependency, require the Plates CLI,
or activate the night practice. Adoption preserves the library's source ownership
and project-owned local runtime overrides. The standalone proof copies the installed
runtime pair to a clean directory and executes it there, with the same reconciliation
assertions. A second embedded alias table would undermine the transition guard, so
it is not used to retain the former packaging. Historical evidence remains unchanged.

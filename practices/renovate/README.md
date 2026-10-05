# renovate

**The failure it prevents.** Dependency PRs that arrive one per package and
pile up until nobody reads any of them, and the opposite: a major update that
changes behaviour merging itself.

**The rule.** `renovate.json` is the whole policy, in four lanes, each one
branch updated in place, so no lane ever holds more than one PR:

- `renovate/patch-minor`, **daily**: every patch and minor bump, npm and
  Actions alike, in one PR that Renovate merges itself once the checks are
  green.
- `renovate/lock-file-maintenance`, **Mondays**: the lockfile refreshed,
  merged the same way.
- `renovate/major-weekly`, **Mondays**: every major together, and any
  vendored git submodule that moved (someone else's code, arriving whole),
  for a person.
- `renovate/node`, **Mondays**: `.nvmrc` and `@types/node` together, for a
  person.

Renovate's PRs come from its app, not `GITHUB_TOKEN`, so they do run the
project's checks: automerge waits on the real suite. Without a check workflow
(the `ci` practice, or the project's own) there is nothing to wait on, so turn
`ci` on first. `**/fixtures/**` is ignored: a fixture's `package.json` is an
input, not a dependency. The Dependency Dashboard issue shows what is pending.

**No timezone.** isocan's config names its owner's timezone; a practice that
copies it copies a fact about one person. Renovate's default is UTC, so
"before 6am" is UTC here. A project that wants its own adds `timezone` and
ejects the file (`keel doctor --fix renovate.json eject`).

**What it needs (⚑).** The Renovate GitHub App, installed on the repo by its
owner (free; https://github.com/apps/renovate). Nothing runs until it is.

**Its files.** `renovate.json` (managed). `keel adopt` keeps the practice
local where a project already has a Renovate or Dependabot config.

**Lineage.** Keel phase 10, from isocan's `renovate.json` and its AGENTS.md
section "Dependencies are Renovate's, in four lanes" (22 Sep 2026), without
its workspace rule and its timezone.

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **ledger**: *stays local*; keel takes nothing. Its weekly, grouped,
  never-automerged lanes and its regex manager for action versions inside
  `scripts/agent-workflows.ts` are deliberate for a repo that generates its
  workflows. Keel's four lanes already move Node with `engines.node` (the npm
  manager reads it), which was the one rule worth comparing.
- **isocan**: *stays local*. Keel's file is isocan's, less two rules that are
  isocan's alone (its workspace packages, its timezone); there is nothing to
  learn and nothing to converge.

Generated PRs carry a `keel-impact` declaration through Renovate's `prBodyNotes`
([configuration reference](https://docs.renovatebot.com/configuration-options/#prbodynotes)).
Dependency pins and lockfiles declare no record impact; a change to actual
phase/decision records still fails the optional reconciliation diff check until
its declaration is corrected and reviewed. All four lanes inherit this note.

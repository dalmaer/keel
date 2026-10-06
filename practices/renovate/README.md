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
- `renovate/node`, **Mondays**: `.nvmrc`, a Dockerfile's `FROM node:` image
  and `@types/node` in one PR, for a person. One PR, because a project that
  holds `.nvmrc` and its image to one major (a test can) fails a split one.

Renovate's PRs come from its app, not `GITHUB_TOKEN`, so they do run the
project's checks: automerge waits on the real suite. Without a check workflow
(the `ci` practice, or the project's own) there is nothing to wait on, so turn
`ci` on first. `**/fixtures/**` is ignored: a fixture's `package.json` is an
input, not a dependency. The Dependency Dashboard issue shows what is pending.

**Shaped by the project** (phase 29). Two rules isocan carried are facts
about one project, so the file takes them from the project rather than from
keel:

- **Its own packages are source.** With package.json `workspaces`, render
  adds a first rule, `enabled: false`, naming every workspace package (each
  one's `name`) and the root's. When the scoped ones share one scope it is
  `@scope/**`, so a new package in it is covered without a render; mixed
  scopes stay exact names. Without workspaces there is no such rule.
- **Its timezone.** `timezone` in `.keel/keel.json` (an IANA name, e.g.
  `America/Denver`) becomes Renovate's; without it the default is UTC, so
  "before 6am" is UTC.

Neither present, the file is the template byte for byte.

**What it needs (⚑).** The Renovate GitHub App, installed on the repo by its
owner (free; https://github.com/apps/renovate). Nothing runs until it is.

**Its files.** `renovate.json` (managed). `keel adopt` keeps the practice
local where a project already has a Renovate or Dependabot config.

**Lineage.** Keel phase 10, from isocan's `renovate.json` and its AGENTS.md
section "Dependencies are Renovate's, in four lanes" (22 Sep 2026), without
its workspace rule and its timezone; phase 29 (5 Oct 2026) took both back as
project facts, and the Dockerfile into the Node lane's description.

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **ledger**: *stays local*; keel takes nothing. Its weekly, grouped,
  never-automerged lanes and its regex manager for action versions inside
  `scripts/agent-workflows.ts` are deliberate for a repo that generates its
  workflows. Keel's four lanes already move Node with `engines.node` (the npm
  manager reads it), which was the one rule worth comparing.
- **isocan**: *stays local* (3 Oct). Keel's file was isocan's, less two rules
  that were isocan's alone (its workspace packages, its timezone). Since
  phase 29 both render from the project, so isocan can take keel's file with
  `timezone` set and lose no rule; taking it is isocan's call.

Generated PRs carry a `keel-impact` declaration through Renovate's `prBodyNotes`
([configuration reference](https://docs.renovatebot.com/configuration-options/#prbodynotes)).
Dependency pins and lockfiles declare no record impact; a change to actual
phase/decision records still fails the optional reconciliation diff check until
its declaration is corrected and reviewed. All four lanes inherit this note.

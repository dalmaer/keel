---
status: partial
since: 2026-10-02
goal: G4
depends: [6]
note: "keel-night, keel-update, claude and renovate ship as practices, with keel drain. The first real dispatch on keel measured, pushed its branch and stayed green with a notice (the PR setting is off). Owed: seven nights, a red night, and the owner's settings and secrets."
evidence: ["evidence/2026-10-02-night-shift.md"]
---

# Each project is looked after overnight, and nothing lands unread

## Done when

Keel and one adopted project each run `keel-night.yml` nightly for a week, each night leaving at most one open machine PR, with Renovate's lanes active and a red run reaching the owner by email.

## Scope

Managed workflows: `check.yml`; `keel-night.yml` (runs `keel improve --report`,
opens one PR with the dated health page, drains its predecessors — merge if
it still merges, close as superseded otherwise, with a recovery comment);
`keel-update.yml` weekly (opens the practice-update PR); `claude.yml`
(`@claude` on issues and PRs, opens PRs, never pushes `main`);
`renovate.json` in four lanes. Every workflow touches only its own branch
prefix. Merges run the suite on the branch, because a `GITHUB_TOKEN` PR never
triggers CI. Commit steps use `git status --porcelain` and rebase-retry pushes
(ledger's audit-agent lessons).

## Acceptance

- [x] A workflow test asserts each workflow's branch prefix, concurrency group and that none pushes to `main`.
- [ ] Seven nights on keel: never more than one open `keel-night/` PR.
- [ ] A deliberately red night produces a failed workflow (an email), not a quiet page.
- [x] ⚑ Secrets the workflows need are listed with what they cost; none set without a yes.

## Proof

`node --test tests/workflows.test.mjs`; the Actions history for the week, linked in evidence.

## Deliberately open

- Whether night runs spend model tokens. Still no: the nightly is deterministic. A model step (e.g. `learn propose`) comes only with the owner's yes on its cost.

## Next action

⚑ Owner: on dalmaer/keel, Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests". Then let seven nights run, and record the queue depth each morning.

## Trajectory

- **2026-10-02** — A missing repo setting is a ⚑, like a missing secret: the run gives a notice, not red. Otherwise keel's nightly would have emailed the owner every night about something they'd never been asked for.
- **2026-10-02** — Drain merges only data PRs (health, inbox, bounds), never an update PR and never a fork's. Update PRs are reviewed, not drained.

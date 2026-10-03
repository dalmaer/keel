---
status: planned
since: 2026-10-02
goal: G4
depends: [6]
note: "Rules taken whole from isocan's night-shift section; Renovate lanes from isocan's renovate.json."
evidence: []
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

- [ ] A workflow test asserts each workflow's branch prefix, concurrency group and that none pushes to `main`.
- [ ] Seven nights on keel: never more than one open `keel-night/` PR.
- [ ] A deliberately red night produces a failed workflow (an email), not a quiet page.
- [ ] ⚑ Secrets the workflows need are listed with what they cost; none set without a yes.

## Proof

`node --test tests/workflows.test.mjs`; the Actions history for the week, linked in evidence.

## Deliberately open

- Whether night runs spend model tokens. Deterministic measurement first; a model step only when a number proves worth explaining, and only with the owner's yes on the cost.

## Next action

Write the workflows test against the three duo/ledger workflows that already exist, so it fails on today's real shapes before keel's versions are written.

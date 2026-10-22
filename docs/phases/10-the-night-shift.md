---
status: partial
owes: walk
waits: owner
since: 2026-10-11
goal: G4
depends: [6]
note: "The night shift ships as practices with drain. On plates, the full cycle has run for real: measure, PR #1, gate, self-merge. Seven Plates morning queue snapshots and Ledger scheduled runs are recorded; Plates and Ledger queue snapshots are recorded; the named owner acceptance remains."
evidence: ["evidence/2026-10-02-night-shift.md", "evidence/2026-10-11-coffee-audit.md"]
issue: 30
---

# Each project is looked after overnight, and nothing lands unread

## Done when

Plates and one adopted project each run `plates-night.yml` nightly for a week, each night leaving at most one open machine PR, with Renovate's lanes active and a red run reaching the owner by email.

## Scope

Managed workflows: `check.yml`; `plates-night.yml` (runs `plates improve --report`,
opens one PR with the dated health page, drains its predecessors — merge if
it still merges, close as superseded otherwise, with a recovery comment);
`plates-update.yml` weekly (opens the practice-update PR); `claude.yml`
(`@claude` on issues and PRs, opens PRs, never pushes `main`);
`renovate.json` in four lanes. Every workflow touches only its own branch
prefix. Merges run the suite on the branch, because a `GITHUB_TOKEN` PR never
triggers CI. Commit steps use `git status --porcelain` and rebase-retry pushes
(ledger's audit-agent lessons).

## Acceptance

- [x] A workflow test asserts each workflow's branch prefix, concurrency group and that none pushes to `main`.
- [ ] ⚑ by hand: seven nights on plates, never more than one open `keel-night/` PR (the owner reads `machine_prs` each morning).
- [x] A deliberately red night produces a failed workflow (an email), not a quiet page. (Proven by a real one, not a deliberate one: ledger's Loop run on 4 Oct; see the evidence.)
- [x] ⚑ Secrets the workflows need are listed with what they cost; none set without a yes.

## Your part

- **Ask:** Check that plates's overnight run never left more than one of its own pull requests open at a time, on any of its first seven nights.
- **Why:** It proves the overnight run tidies up after itself, the last thing keeping the night shift (set up on 2 October) from done.
- **Look at:** The "open machine PRs" (`machine_prs`) row on each morning's [health page](../health/), 3 to 9 October.
- **Choices:** All seven fine | A night had more than one
- **Keeps it open:** A night had more than one
- **Takes:** 2 minutes
- **Then:** All seven fine: recorded, and the night shift is done. A night had more than one: recorded, and the walk stays open; the conductor finds which pull requests piled up and why, and asks again.
- **Ready when:** the night of 9 October has run (the seventh since 3 October).

## Proof

`node --test tests/workflows.test.mjs`; the Actions history for the week, linked in evidence.

## Deliberately open

- Whether night runs spend model tokens. Still no: the nightly is deterministic. A model step (e.g. `learn propose`) comes only with the owner's yes on its cost.

## Next action

Owner: read the seven morning snapshots now recorded for 3–9 October (Plates night queue: 0, 0, 0, 1, 0, 0, 0) and confirm the walk. Ledger's configured `.plates/health` pages for 5–11 October also show night queues of 0, 0, 1, 1, 1, 0, 0. See the 11 October audit for run links and the later conflicting night PR.

## Trajectory

- **2026-10-02** — A missing repo setting is a ⚑, like a missing secret: the run gives a notice, not red. Otherwise keel's nightly would have emailed the owner every night about something they'd never been asked for.
- **2026-10-02** — Drain merges only data PRs (health, inbox, bounds), never an update PR and never a fork's. Update PRs are reviewed, not drained.

- **2026-10-11** — Reconciliation: the seven Keel morning reports already exist; waiting for time was stale. Their night queue counts never exceed one, but snapshots do not prove a continuous invariant or substitute for the named owner read. Ledger has seven morning queue snapshots too (5–11 October), including recovery across failed nights; owner acceptance remains unverified.

---
status: partial
owes: walk
waits: owner
since: 2026-10-09
goal: G5
spec: 2
depends: [43]
note: "Implemented: bounded CI usage estimates, exact clean default-branch CI reuse and adoption cost previews. Real API accounting, estimates and clean committed CI reuse verified; the owner’s month on a metered project remains owed."
evidence: ["evidence/2026-10-09-ci-usage.md"]
issue: 48
---

# CI cost is a measure, and adoption says what keel adds

## Done when

The night reports each workflow's weighted minutes for the last 7 days (each job rounded up to a minute, configurable defaults Linux ×1, Windows ×2 and macOS ×10) against a bound the project sets; the night's gate measure reuses the result of the project's own CI on the same commit instead of running the gate again; `keel adopt --dry-run` states the weighted minutes a month keel's workflows would add; and one metered project has run a month with them.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 4.

- **The measure** `ci_minutes`: from the Actions API (bounded, paginated runs and jobs, including run attempts), each job rounded up to a whole minute and multiplied by its runner's configured weight (Linux 1, Windows 2, macOS 10; overridable), by workflow, for the last 7 days; bound `.keel/keel.json` `"ci": { "weeklyMinutes": N }`. keel's own workflows are listed apart, so the owner sees what keel costs.
- **The gate, reused**: when `.keel/keel.json` names the project's CI workflow (`"ci": { "gateWorkflow": "ci.yml" }`), the night's `gate` measure reads that workflow's conclusion on the night's exact commit instead of running the check; it reuses a completed success or failure on the exact clean revision within 24 hours, and runs the check when no usable result is available. Conflicting top-level and nested workflow names are a configuration error.
- **Adoption states it**: `keel adopt --dry-run` lists each workflow keel would add with its trigger and an estimate in weighted minutes a month (from keel's own history of that workflow), and the total.

## Acceptance

- [x] `ci_minutes` rounds each job up, applies each runner's multiplier, groups by workflow, separates keel's own, and is outside its bound when over it; n/a without the API, never zero. `tests/ci.test.mjs`, `tests/improve-measures.test.mjs`
- [x] With `gateWorkflow` set, the night's gate measure reads that workflow's conclusion on the commit and runs no check; without a run, it runs the check as today. `tests/ci.test.mjs`, `tests/night.test.mjs`
- [x] `keel adopt --dry-run` lists keel's added workflows with a monthly minutes estimate and a total. `tests/adopt.test.mjs`
- [ ] ⚑ by hand: a month on one metered project; the owner compares keel's minutes with the estimate.

## Your part

- **Ask:** After a month on a metered project, compare what keel's workflows actually cost with what the dry run estimated.
- **Why:** A project that pays for its minutes should know what keel adds before it says yes.
- **Look at:** The night's `ci_minutes` line, keel's own workflows.
- **Choices:** Close enough | Estimate was off
- **Takes:** 5 minutes.
- **Then:** Close enough: the phase is built. Off: the estimate's source is fixed and the gap goes into the evidence.
- **Ready when:** one metered project has run a month with this.

## Real surfaces

- GitHub API: Actions runs and jobs' timing.
- Adopted project: one that meters its CI.

## Proof

Automated: `node --test tests/ci.test.mjs tests/improve-measures.test.mjs tests/night.test.mjs tests/adopt.test.mjs`; `npm run check`.
Over time: a month's minutes against the estimate.

## Deliberately open

- **Settled 2026-10-09: dedicated API proof.** Pagination, runner weighting, cache validation and exact-revision reuse live in `tests/ci.test.mjs`; it joins the original integration proof. The outcomes are unchanged. Reuse requires a push run on the repository's default branch, as the night operates there; other origins fall back to the local gate.

- **Settled 2026-10-09: estimates, not invoices.** The 1/2/10 defaults are dated, configurable weighting assumptions. GitHub prices depend on runner hardware and billing context; standard public hosted usage and self-hosted usage can be free. Report runner/billing coverage, provenance and unavailable data explicitly. Weighted minutes are a comparable usage estimate, not a claim of billed dollars or a universal current tariff. See [GitHub runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing).

- **Multipliers change**: Weighting assumptions are dated configuration, not a universal tariff; they are dated in the measure's detail.
- **Settled 2026-10-09: exact revision only.** A successful run on another
  commit cannot validate this tree. Reuse only a completed run on the exact
  commit, no older than a day, and never reuse it for a dirty tree. Otherwise
  run the check. Pending runs and unavailable API data never mean success.

## Next action

The owner chooses a metered project, captures its adoption estimate, and compares one month of actual usage with it. No new project schedule is enabled by this phase.

## Trajectory

- **2026-10-09** — Actions history is bounded, not presumed complete. Old runs can be retried this week; partial reads keep observed usage as a lower bound and cannot claim an inside-bound total. Ownership comes from managed paths, not a filename prefix. Evidence: [CI usage](../evidence/2026-10-09-ci-usage.md).
- **2026-10-09** — Monthly event estimates use actual repository exposure, not days before it existed. Cached weights, windows and source identity are validated; scheduled means and event rates remain distinct. Real Keel history exercised the positive path, while month-long predictive accuracy remains an owner walk.

- **2026-10-10** — A completion-based usage window excludes and discloses active work; otherwise the night invalidates its own report. Adoption averages require the whole logical run to finish, including retries. Incomplete completed-job data remains a gap. [Review evidence](../evidence/2026-10-09-ci-usage.md).

- **2026-10-10** — Per-run estimates exclude partial-window logical runs, retain positively dated zero-cost runs, and use workflow age for event exposure. A completed-window total and a complete per-run sample answer different questions. [Review evidence](../evidence/2026-10-09-ci-usage.md).

- **2026-10-10** — Clean committed reuse was walked on the exact merged revision and preserved its failed CI conclusion without creating a local timing record. Reuse is provenance, not a success claim; the remaining acceptance is the owner’s metered month. [Walk evidence](../evidence/2026-10-09-ci-usage.md).

---
status: planned
since: 2026-10-09
goal: G5
spec: 2
depends: [43]
note: "A metered project audits its Actions bill, and keel adds workflows without saying what they cost: the night reruns a 12-15 minute gate the project's own CI already ran. CI cost becomes a measure (weighted minutes, OS multipliers, per-job round-up), the night reuses the project's CI result on main, and adopt states what keel adds. Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
evidence: []
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

- [ ] `ci_minutes` rounds each job up, applies each runner's multiplier, groups by workflow, separates keel's own, and is outside its bound when over it; n/a without the API, never zero. `tests/improve-measures.test.mjs`
- [ ] With `gateWorkflow` set, the night's gate measure reads that workflow's conclusion on the commit and runs no check; without a run, it runs the check as today. `tests/night.test.mjs`
- [ ] `keel adopt --dry-run` lists keel's added workflows with a monthly minutes estimate and a total. `tests/adopt.test.mjs`
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

Automated: `node --test tests/improve-measures.test.mjs tests/night.test.mjs tests/adopt.test.mjs`; `npm run check`.
Over time: a month's minutes against the estimate.

## Deliberately open

- **Settled 2026-10-09: estimates, not invoices.** The 1/2/10 defaults are dated, configurable weighting assumptions. GitHub prices depend on runner hardware and billing context; standard public hosted usage and self-hosted usage can be free. Report runner/billing coverage, provenance and unavailable data explicitly. Weighted minutes are a comparable usage estimate, not a claim of billed dollars or a universal current tariff. See [GitHub runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing).

- **Multipliers change**: Weighting assumptions are dated configuration, not a universal tariff; they are dated in the measure's detail.
- **Settled 2026-10-09: exact revision only.** A successful run on another
  commit cannot validate this tree. Reuse only a completed run on the exact
  commit, no older than a day, and never reuse it for a dirty tree. Otherwise
  run the check. Pending runs and unavailable API data never mean success.

## Next action

Brief a builder on `ci_minutes` and the reused gate.

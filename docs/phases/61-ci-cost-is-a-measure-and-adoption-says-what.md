---
status: planned
since: 2026-10-09
goal: G5
spec: 2
depends: [43]
note: "A metered project audits its Actions bill, and keel adds workflows without saying what they cost: the night reruns a 12-15 minute gate the project's own CI already ran. CI cost becomes a measure (billable minutes, OS multipliers, per-job round-up), the night reuses the project's CI result on main, and adopt states what keel adds. Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
evidence: []
issue: 48
---

# CI cost is a measure, and adoption says what keel adds

## Done when

The night reports each workflow's billable minutes for the last 7 days (each job rounded up to a minute, macOS ×10 and Windows ×2) against a bound the project sets; the night's gate measure reuses the result of the project's own CI on the same commit instead of running the gate again; `keel adopt --dry-run` states the billable minutes a month keel's workflows would add; and one metered project has run a month with them.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 4.

- **The measure** `ci_minutes`: from the Actions API (one REST call per run for its jobs' timing), each job rounded up to a whole minute and multiplied by its runner's rate (Linux 1, Windows 2, macOS 10; overridable), by workflow, for the last 7 days; bound `.keel/keel.json` `"ci": { "weeklyMinutes": N }`. keel's own workflows are listed apart, so the owner sees what keel costs.
- **The gate, reused**: when `.keel/keel.json` names the project's CI workflow (`"ci": { "gateWorkflow": "ci.yml" }`), the night's `gate` measure reads that workflow's conclusion on the night's commit (or the newest on main) instead of running the check; it runs the check only when there is no such run.
- **Adoption states it**: `keel adopt --dry-run` lists each workflow keel would add with its trigger and an estimate in billable minutes a month (from keel's own history of that workflow), and the total.

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

- **Multipliers change**: GitHub's rates are configuration, not code; they are dated in the measure's detail.
- **A gate run on another commit**: the newest main run may not be the night's commit. Its age is said; a gate older than a day is run again.

## Next action

Brief a builder on `ci_minutes` and the reused gate.

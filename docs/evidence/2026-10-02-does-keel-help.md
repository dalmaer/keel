# Evidence: phase 13 — does keel help?

- Date: 2026-10-02
- Phase: 13
- Revision: `45a52ee` (the pre-registration), plus this record.
- Claim being checked: the measures and the comparison were written down,
  dated, before any after-adoption data existed.

## Checks

| Did | Observed |
| --- | --- |
| `git log --format='%H %cI' -- docs/research/2026-10-02-does-keel-help-measures.md` | first commit `45a52ee`, on 2026-10-02 |
| `keel fleet` on the same day (phase 12 evidence) | duo, cajones and ledger all `not adopted`, so no after-adoption data could exist when the page was written |
| What was read to write it | only baseline facts: first-commit dates, commit counts, lessons-row counts, and ledger's CI conclusions as a histogram. No outcome data |

## Gaps and decision

- The results page can't exist before 2026-11-01, by the pre-registration's
  own rule, and needs two projects adopted (phase 4's ⚑).
- Golden tasks for keel (init each kind, adopt a fixture, carry a
  migration, with and without skills) aren't built. Running agents with and
  without skills spends model tokens, so it waits on the owner's yes on the
  cost.
- Supports **partial**.

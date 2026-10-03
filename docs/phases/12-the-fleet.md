---
status: planned
since: 2026-10-02
goal: G5
depends: [4, 11]
note: "Fleet today: ledger, duo, cajones (dalmaer); isocan (dglazkov) as a source."
evidence: []
---

# One look tells the owner which projects are behind, red, or teaching something

## Done when

`keel fleet` lists every managed project with its practice version, last health page, CI state and unsent lessons, from `fleet.json` and `gh`, in under ten seconds.

## Scope

`fleet.json` on keel (repo, kind, adopted-at). Read-only. `--json`. Optionally
a nightly page on keel, `docs/fleet/<date>.md`, as part of keel's own night.

## Acceptance

- [ ] A project behind on the practice shows how far and what it is missing.
- [ ] A project whose health page is older than two nights is shown as silent, not as healthy.

## Proof

`node --test tests/fleet.test.mjs` with `gh` stubbed; one real run after phase 4's adoptions.

## Deliberately open

- A web view. Not until the CLI table has been used for a month.

## Next action

Wait for phase 4; meanwhile record the fleet's repos in `fleet.json` by hand.

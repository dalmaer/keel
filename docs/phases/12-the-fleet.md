---
status: partial
since: 2026-10-02
goal: G5
depends: [4, 11]
note: "keel fleet reads five repos in 1.6s and shows the truth: keel current and green, duo/cajones/ledger not adopted, isocan unmoved. Behind and silent are proven on the stub; a real reading waits on phase 4's adoptions."
evidence: ["evidence/2026-10-02-fleet.md"]
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

After phase 4's adoption PRs merge, run `keel fleet` and check both boxes against real rows.

## Trajectory

- **2026-10-02** — keel is in its own fleet, marked `home`: it learns rather than sends, so its lessons column says so, and its own migrations never go to Needs you. isocan is listed as a source, read and never managed.

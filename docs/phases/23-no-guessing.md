---
status: planned
since: 2026-10-04
goal: G1
depends: [3, 19]
note: "The phase 3 walk (4 Oct): a fresh agent conducted acme-tally's phase 0 from the project alone, but had to guess 11 times."
evidence: []
---

# A new project tells a fresh agent everything it needs, and nothing it doesn't

## Done when

A fresh-agent walk, the same as phase 3's (npx only, an empty npm cache), conducts a new project's phase 0 with no blocker and no step that cannot be done as written; every other point it reports is fixed or recorded here as deliberately open.

## Scope

The 11 friction points, each fixed where it lives:

1. **How to run keel.** The doorway skill and init's output give a way that
   needs no global install: `npx -y github:dalmaer/keel <verb>`, now that
   keel is public. `--agent-help` names it too.
2. **No remote.** The conduct skill says: with no `git remote`, skip pull,
   push and CI, and the walk ends at the local commit.
3. **No design doc or README.** The conduct skill treats both as "if the
   project has one". init seeds a short README with a "How to run it"
   section, outside keel's blocks.
4. **Evidence folder.** init creates `docs/evidence/` (with a README naming
   the template).
5. **The drafted phase 0.** It says its Done when edit is its own commit,
   and its title is "The first thing that runs".
6. **AGENTS.md seed.** It has a "How to run it" pointer, prints the
   description once, and uses the description's first sentence as goal
   G0's title.
7. **Stale status.** The roadmap check (or doctor) flags a phase whose
   Acceptance is all checked and which names evidence while its status is
   still planned, designed or partial.
8. **Small phases.** The conduct skill has a small-phase path: the
   conductor may build a phase of a file or two itself, and says so.
9. **package.json.** For `--kind node`, init writes `name`.
10. **Gate and record order.** The conduct skill writes the record, then
    runs the gate once on the final tree, or runs `roadmap:check` last. It
    says which.
11. **Record checklist.** It names "set `status:`" first.

## Acceptance

- [ ] Each of the 11 has a test or a guard where one can exist (7, 4, 6 and 9 certainly).
- [ ] A fresh-agent walk on a new project hits no blocker and no step that cannot be done as written; every other point is fixed or recorded under Deliberately open.

## Proof

`node --test` on the touched tests; then the walk, run the way phase 3's
was, with its report in the evidence.

## Deliberately open

- **Whether `npx github:dalmaer/keel` is fast enough as the everyday way in**,
  or only as the fallback.

## Next action

Fix 7 (stale status) and 4/6/9 (init seeds) first, since they have tests,
then the skill and doorway text, then re-walk.

## Trajectory

- **2026-10-04** — The bar changed from "a walk reports no friction" to "no blocker, no step that cannot be done as written". Three walks found 11, then 10, then 7 points, each round smaller. A fresh agent always finds something to note, so "none" could never close. The bar now holds what matters, and the rest is fixed or recorded.
- **2026-10-04** — The second walk found a blocker no checkout-based test could see: npm strips `.gitignore`, so `npx github:dalmaer/keel init` failed for everyone (lesson 28).

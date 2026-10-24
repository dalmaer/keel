---
status: built
since: 2026-10-24
goal: G2
spec: 2
depends: [109]
note: "139 held identities, a canonical managed table and a closed inventory guard; existing rendered bytes remain unchanged. Source proof only; no remote transition."
evidence: ["evidence/2026-10-24-name-inventory.md"]
issue: 240
---

# Every keel name plates still writes is listed in one table, and a new one cannot slip in

## Done when

One table names every keel identity plates still writes or reads, with its surface, its plates name, the phase that moves it and its state (`held`, `dual`, `retired`). Shipped code reads names from that table, and a test fails on any keel token in shipped code that the table does not list.

## Scope

The design is [Name transition](../specs/name-transition.md), "What still says keel".

- **The table:** `lib/names.mjs`, with a copy for the managed scripts in `practices/night/files/scripts/plates/names.mjs` (rendered, so a project's scripts read the same table). Each row: `{ id, surface, keel, plates, phase, state }`. The surfaces are git ref, concurrency group, artifact, marker, label, fence, variable, web, database and machine.
- **One source:** `lib/rename.mjs`'s `DURABLE` regex is built from the table's `held` and `dual` rows, never typed separately (lesson 7).
- **Readers:** a helper gives the name to write (`plates`, once the row is `dual`) and the names to read (`[plates, keel]`). Phases 125–127 switch their rows from `held` to `dual` by changing one field each.
- **The guard:** `tests/names.test.mjs` scans `lib`, `practices`, `bin`, `scripts`, `.github` and `web` for keel tokens. It fails on any token that is neither in the table nor in a short list of allowed kinds:
  - compatibility entry points: `bin/keel.mjs`, the `keel` command, the `/conduct` alias, `.keel/` reading in `migrate`;
  - historical record paths;
  - test fixtures that model a pre-rename project.

  Each allowed entry names why.
- Changes no behaviour: every row starts `held`, so the bytes plates writes are unchanged.

## Acceptance

- [x] The table holds every keel identity in shipped code, and the scan finds none outside it and the allowed list. `tests/names.test.mjs`: "every keel token in shipped code is a table row or an allowed kind"
- [x] A new keel token added to shipped code fails the test, naming file and line. The same test fails on a planted `keel-foo/` in a scratch copy. `tests/names.test.mjs`: "a keel name the table does not list fails, naming where"
- [x] `DURABLE` is derived from the table: removing a row changes the migration's holds, and the old literal regex is gone. `tests/rename.test.mjs`: "the durable holds are the name table's held and dual rows"
- [x] With every row `held`, renders and the night write byte-identical output to before. `npm run check` (`tests/ancestors.test.mjs`, `tests/workflows.test.mjs` unchanged)

## Real surfaces

none

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/names.test.mjs tests/rename.test.mjs`; `npm run check`. Break the scan's matcher and the table lookup by hand, and see each go red; record that in the evidence.

## Deliberately open

- **The allowed list is the risk.** An entry there is a keel name the transition will never move. Each entry names its reason, and phase 130 re-reads the list.

## Next action

Proceed to phases 125–127 through separate claimed and reviewed PRs. Phase 125 fixes #218 first; remote activation and the ordered fleet rollout remain owner steps.

## Trajectory

2026-10-24 — Preserve existing owner namespace protections separately from the finite transition table: removing them would regress migration, while admitting them as scanner wildcards would hide new names. Normalize explicit source spellings rather than maintaining hundreds of line-specific exceptions.

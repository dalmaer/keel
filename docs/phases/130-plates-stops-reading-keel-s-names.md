---
status: planned
since: 2026-10-23
goal: G2
spec: 2
depends: [129]
note: "Specified 2026-10-23 (docs/specs/name-transition.md). Retirement: once plates names shows nothing live under a keel name across the fleet, the fallback reads go in one release, and the name table forbids every keel name except the compatibility entry points."
evidence: []
issue: 246
---

# Plates stops reading keel's names

## Done when

`plates names` shows no active legacy dependency anywhere in the fleet; retained aliases have verified replacements and are listed separately for explicit retirement approval. In one release, each eligible live-state `dual` row becomes `retired`: its live fallback read is removed, its forwarder dropped, and its old variable deleted with the owner's yes. The name scan in `tests/names.test.mjs` then fails on any keel token outside explicitly listed compatibility entry points and historical metadata readers.

## Scope

The design is [Name transition](../specs/name-transition.md), "The rule".

- **The gate:** `plates names --fleet` distinguishes active dependencies, retained aliases and unknown coverage. Retirement refuses active dependencies or unknowns, but admits explicitly inventoried aliases whose replacements and lack of active consumers are verified. For variables, compare replacement values privately without output; missing or conflicting replacements block. Secret values are never read or compared: metadata alone cannot establish replacement, so the owner must supply replacement/execution evidence or retain them as an explicit blocker. The owner approves the exact alias removal list. After the operation, refresh the inventory and require no remaining unapproved live alias. Historical parsers and explicitly retained compatibility entries remain separate. The same rule applies to variables, secret metadata, forwarders and other retained identities; it is not a variable-only exception.
- **Code:** remove each fallback read named by a `dual` row:
  - the prefixes in drain, morning and the board;
  - the plan and verify branch fallbacks;
  - live-only marker matchers; historical marker and fence parsers remain;
  - the artifact readers;
  - the cookie, env and header fallbacks.

  The rename's `DURABLE` holds shrink to what `plates migrate` still needs for a pre-rename project.
- **Historical records remain readable:** retain explicitly inventoried parsers for old decision, reconciliation, impact, proof and measurement metadata. These are permanent compatibility readers, not live-name blockers. Never rewrite old records to make retirement pass. Resolve an unchanged pre-transition accepted decision after retirement, including its references and evidence.
- **The database:** a migration drops the `keel_*_rpc` forwarders (⚑ the owner applies it), and acts on 127's schema decision.
- **Variables:** `plates names --retire --yes` deletes each `vars.KEEL_*` that has a `PLATES_` copy. Old secrets are listed for the owner to delete.
- **The compatibility entry points** (`bin/keel.mjs`, the `keel` command, `/conduct`, `.keel/` in `migrate`): the owner decides here whether they stay for good. The table records the decision either way.

## Acceptance

- [ ] With no active dependency or unknown coverage in a stub fleet, the retirement preview lists each eligible retained alias and its replacement evidence. Active consumers, a missing/conflicting replacement or unknown coverage refuse; approved alias removal must leave the inventory empty apart from explicitly retained compatibility. `tests/names-cli.test.mjs`: "retirement distinguishes verified aliases from active dependencies"
- [ ] After retirement, the name scan fails on any keel token outside explicitly listed compatibility entry points and historical metadata readers. `tests/names.test.mjs`: "after retirement only explicit compatibility readers say keel"
- [ ] The owner applies the forwarder-dropping migration and approves the variable deletions. The next `plates names --fleet` is empty. ⚑ by hand: the owner

- [ ] An unchanged pre-transition accepted decision and its legacy reconciliation references still resolve after live-name retirement. `tests/decision-context.test.mjs`: "historical decisions resolve after live-name retirement"

## Your part

- **Ask:** Say when to retire the old names, apply the database update, and delete the old secrets from the list.
- **Why:** After this, nothing plates writes or reads says keel, except the entry points you keep.
- **Look at:** `plates names --fleet`.
- **Choices:** Retire now | Wait
- **Takes:** 15 minutes.
- **Then:** Wait: nothing breaks. Both names keep working until you say retire.
- **Ready when:** phase 129 is done and `plates names --fleet` shows only eligible retained aliases, with no active legacy dependency or unknown coverage.

## Real surfaces

- fleet over time: `plates names --fleet` across the six repositories.
- published package: the release that removes the fallbacks.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/names.test.mjs tests/names-cli.test.mjs tests/decision-context.test.mjs`; `npm run check`.
By hand: ⚑ the owner's retirement, and `plates names --fleet` empty, in the evidence.

## Deliberately open

- **The `keel` command and `/conduct`** may stay as aliases for good. People and other tools type them, and keeping them costs a few lines. The owner decides.

## Next action

Once phase 129's evening is done, run `plates names --fleet` and list what still holds a keel name.

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

`plates names` shows no live keel name anywhere in the fleet. In one release, every `dual` row in the name table becomes `retired`: its fallback read is removed, its forwarder dropped, and its old variable deleted with the owner's yes. The name scan in `tests/names.test.mjs` then fails on any keel token outside the allowed compatibility entry points.

## Scope

The design is [Name transition](../specs/name-transition.md), "The rule".

- **The gate:** `plates names --fleet` lists zero live keel names. It's run when the owner asks, possibly the morning after phase 129's evening, once drain has merged the last keel-prefixed PRs and the artifacts in use are plates ones.
- **Code:** remove each fallback read named by a `dual` row:
  - the prefixes in drain, morning and the board;
  - the plan and verify branch fallbacks;
  - the marker and fence matchers;
  - the artifact readers;
  - the cookie, env and header fallbacks.

  The rename's `DURABLE` holds shrink to what `plates migrate` still needs for a pre-rename project.
- **The database:** a migration drops the `keel_*_rpc` forwarders (⚑ the owner applies it), and acts on 127's schema decision.
- **Variables:** `plates names --retire --yes` deletes each `vars.KEEL_*` that has a `PLATES_` copy. Old secrets are listed for the owner to delete.
- **The compatibility entry points** (`bin/keel.mjs`, the `keel` command, `/conduct`, `.keel/` in `migrate`): the owner decides here whether they stay for good. The table records the decision either way.

## Acceptance

- [ ] With no live keel name in a stub fleet, the retirement run lists every `dual` row it retires. With one live name, it refuses, naming it. `tests/names-cli.test.mjs`: "retirement refuses while a keel name is live"
- [ ] After retirement, the name scan fails on any keel token outside the allowed compatibility entry points. `tests/names.test.mjs`: "after retirement only the entry points say keel"
- [ ] The owner applies the forwarder-dropping migration and approves the variable deletions. The next `plates names --fleet` is empty. ⚑ by hand: the owner

## Your part

- **Ask:** Say when to retire the old names, apply the database update, and delete the old secrets from the list.
- **Why:** After this, nothing plates writes or reads says keel, except the entry points you keep.
- **Look at:** `plates names --fleet`.
- **Choices:** Retire now | Wait
- **Takes:** 15 minutes.
- **Then:** Wait: nothing breaks. Both names keep working until you say retire.
- **Ready when:** phase 129 is done and `plates names --fleet` is empty.

## Real surfaces

- fleet over time: `plates names --fleet` across the six repositories.
- published package: the release that removes the fallbacks.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/names.test.mjs tests/names-cli.test.mjs`; `npm run check`.
By hand: ⚑ the owner's retirement, and `plates names --fleet` empty, in the evidence.

## Deliberately open

- **The `keel` command and `/conduct`** may stay as aliases for good. People and other tools type them, and keeping them costs a few lines. The owner decides.

## Next action

Once phase 129's evening is done, run `plates names --fleet` and list what still holds a keel name.

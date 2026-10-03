# phases

**The failure it prevents.** Status written in more than one place drifts, and
both copies look authoritative (keel lessons 2 and 7; ledger 6, duo 1, cajones).

**The rule.** Each phase is one file, `docs/phases/NN-name.md`, whose front
matter owns its status. `docs/ROADMAP.md` is derived from the phases and
`docs/goals.json`, and `npm run roadmap:check` fails CI when it is stale, when
a claim lacks evidence, or when a dependency loops. A phase names its *Done
when* and *Proof* before it starts.

**Its files.** `scripts/roadmap.mjs` and its test, the phase contract and
template (managed); `docs/goals.json` (seeded); the `phases` block of
`AGENTS.md`.

**Lineage.** isocan → ledger (`scripts/roadmap.ts`) → cajones/ritmo
(`scripts/roadmap.mjs`, evidence and dependency checks) → keel.

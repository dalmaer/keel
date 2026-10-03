---
status: planned
since: 2026-10-02
goal: G4
depends: [1, 10]
note: "Loop triage runs by hand-port in ledger (scripts/loop.ts, 132 findings) and isocan (scripts/loop.mjs, loop.yml); keel has no loop practice yet."
evidence: []
---

# A project's Stitch Loop findings are triaged the same way everywhere, through keel

## Done when

One adopted project's Loop cycle (pull new insights, propose a rank for each, render `docs/LOOP.md`) runs through keel's `loop` practice, and that project's own scripts/loop.* is retired in favour of it.

## Scope

An optional `loop` practice, switched on per project. It is ported from ledger's
`scripts/loop.ts` (where triage ran first) and isocan's `scripts/loop.mjs`
(which adds project-scoped findings, nightly proving and self-merge). It
installs:

- the managed loop script and its tests;
- `.stitch.json` as a seeded file (the workspace id is the project's);
- `docs/loop/` findings, one file each, with the decision in front matter;
- the generated `docs/LOOP.md`, checked in CI the way the roadmap is;
- an AGENTS.md block with the protocol;
- a `loop.yml` night-shift workflow that uses phase 10's drain rules.

The rules carry over unchanged:

- **The ranking is ours, not Loop's.**
- **An agent proposes, a person decides.** A decision dismisses an insight for
  everyone in the workspace.
- The context sent back to Loop carries the project's own measurements, never
  its users' data. That is isocan's difference from ledger.

## Acceptance

- [ ] `keel adopt` on a project with its own loop script reports `loop` as local, with the convergence proposal, and leaves its findings untouched.
- [ ] Findings parse identically under keel's script and the project's own, before it is retired (same `docs/LOOP.md` bytes).
- [ ] `pull` against a stubbed `stitch` CLI files new insights as untriaged, and never overwrites our fields on a re-filing.
- [ ] `propose` records a proposal; only `decide` (a person) changes a decision, and `push` is the only verb that sends anything to Loop.
- [ ] `render --check` fails CI on a stale `docs/LOOP.md` or a proposal without a read of the code.
- [ ] ⚑ The nightly workflow's secrets (`LOOP_API_KEY`, `STITCH_INSTALLER_URL`) are listed with what they cost; none set without the owner's yes.
- [ ] One real cycle on the adopted project: pull, propose, render, merged.

## Proof

Automated: `node --test tests/loop.test.mjs`, with the `stitch` CLI stubbed
at the process boundary (both ledger and isocan drive Loop through `stitch …
--format json`, never HTTP), answering in its real JSON envelope (lesson: a
fake that mirrors the code only confirms it).

Equivalence: render a copy of ledger's real `docs/loop/` with keel's port and
with ledger's own `scripts/loop.ts`; the two `docs/LOOP.md` files must be
byte-identical.

By hand: run the cycle on the adopted project and compare `docs/LOOP.md`
before and after.

⚑ Setting the workflow's secrets; any `push`, `decide` or `mine` against the
real workspace.

## Deliberately open

- **Which project goes first.** ledger has the most findings and the oldest
  script, but isn't adopted yet; it needs its own phase-4 run.
- **Whose shape wins where ledger and isocan differ.** For example, a finding
  names a phase in ledger and a project in isocan. Settle it when porting, in
  the practice README.
- **Whether keel learns from isocan's loop.mjs as a pinned source** (phase 8),
  as it does for conduct.

## Next action

Diff ledger's `scripts/loop.ts` against isocan's `scripts/loop.mjs`. Write the
finding format and verb set they share into a draft `practices/loop/README.md`,
then build the stubbed-API test before porting the script.

---
status: partial
since: 2026-10-02
goal: G4
depends: [1, 10]
note: "The optional loop practice renders ledger's 132 real findings identically except the generator's name. Being moved to the official @google/stitch CLI (STITCH_API_KEY, STITCH_WORKSPACE, npm install, no installer secret); a real cycle waits on that key and an adopted project."
evidence: ["evidence/2026-10-02-loop.md"]
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

- [x] `keel adopt` on a project with its own loop script reports `loop` as local, with the convergence proposal, and leaves its findings untouched.
- [x] Findings parse identically under keel's script and the project's own, before it is retired (same `docs/LOOP.md` bytes, except the generator's own name on line 1).
- [x] `pull` against a stubbed `stitch` CLI files new insights as untriaged, and never overwrites our fields on a re-filing.
- [x] `propose` records a proposal; only `decide` (a person) changes a decision, and `push` is the only verb that sends anything to Loop.
- [x] `render --check` fails CI on a stale `docs/LOOP.md` or a proposal without a read of the code.
- [x] ⚑ The nightly workflow's secret (`STITCH_API_KEY`, for the official `@google/stitch` CLI, installed from npm) is listed with what it costs; none set without the owner's yes.
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
- **Whose shape wins where ledger and isocan differ.** **Settled 2026-10-02**
  (recorded in `practices/loop/README.md`): ledger's. That means YAML
  findings, `phase`, and its rendered page. From isocan, keel took only
  additions that leave ledger's bytes unchanged. It didn't take isocan's
  unverified-read regex, which flags 7 of ledger's findings.
- **Whether keel learns from isocan's loop.mjs as a pinned source** (phase 8),
  as it does for conduct.

## Next action

⚑ Owner: set `STITCH_API_KEY` on the adopted ledger and run one real cycle. That cycle also confirms two things checked only against the CLI's source: that the default endpoint serves Loop, and that `STITCH_INCLUDE_DISMISSED=true` returns dismissed insights.

## Trajectory

- **2026-10-02** — Loop is reached through the `stitch` CLI, not HTTP, so the stub sits at the process boundary. The Proof was fixed before the brief.
- **2026-10-02** — The loop gate rides on the managed `tests/loop.test.mjs`, which renders with `--check`, so a project's existing `node --test` gate covers it without editing its `check` script. Doctor lints only when the gate can't reach it.
- **2026-10-03** — The owner corrected the names: the official `@google/stitch` CLI from npm reads `STITCH_API_KEY` and `STITCH_WORKSPACE`. Installing from npm removes the installer-URL secret. Its documented verbs (`find insights`, `dismiss`, `generate insights`, `create context`) are the ones the port already calls.
- **2026-10-03** — Done: the workflow installs `@google/stitch@0` from npm, and only `STITCH_API_KEY` and `STITCH_WORKSPACE` are read. There is no base-URL override (a stored copy of an old endpoint), and dismissed insights come back via `STITCH_INCLUDE_DISMISSED=true`, read from the CLI's own source. A test fails on any `LOOP_*`, installer-URL or base-URL name in a shipped file.

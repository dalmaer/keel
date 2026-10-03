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

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **ledger** (one file per phase, no `goal`, its own `scripts/roadmap.ts`):
  *converges via migration 0003*, which adds `goal:`, `docs/goals.json` (one
  goal per group in its phases README, else one) and keel's missing sections,
  marked as added, then hands the roadmap to keel's. 0003 applies only when
  every built or lived-in phase already names evidence; it never writes
  evidence (a page that proves nothing would pass the check without being the
  thing) and never steps a phase back. On 3 Oct 17 built phases name none, so
  `phases` stays local and adopt's and doctor's proposal lists all 17 with the
  two honest moves: write the evidence when each is next checked, or step it
  back to partial.
- **isocan** (`docs/projects/<p>/phases.md`, `**Status: WORD.**` lines):
  *stays local*. Keel learned the shape as a second, read-only reader
  (`"phases": {"shape": "projects"}`; `keel next --project <p>`, `keel
  status`): CLOSED→built, PART-DONE→partial, NOT STARTED→planned,
  RETIRED→superseded; DONE and status kept in headings are linted, never
  guessed. isocan generates its own roadmap; keel writes none for this shape.
  Whether keel ever writes these files is deliberately open.

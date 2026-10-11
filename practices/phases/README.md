# phases

**The failure it prevents.** Status written in more than one place drifts, and
both copies look authoritative (keel lessons 2 and 7; ledger 6, duo 1, cajones).

**The rule.** Each phase is one file, `docs/phases/NN-name.md`, whose front
matter owns its status. `docs/ROADMAP.md` is derived from the phases and
`docs/goals.json`, and `npm run roadmap:check` fails CI when it is stale, when
a claim lacks evidence, or when a dependency loops. A phase names its *Done
when* and *Proof* before it starts.

**A generated file is rewritten whole** (keel's lesson 52, standardised
6 Oct 2026). `tests/keel-generated.test.mjs` copies the project to a
temporary directory, appends a marker line to each file its practices
declare generated (`docs/ROADMAP.md`; `docs/LOOP.md` with `loop`), runs that
file's generator, and fails if the marker survives: a generator that appends,
or keeps lines it did not write, would keep a hand edit in a file nobody is
to edit. The list is `GENERATORS` in `scripts/keel/generated.mjs`, one place.
On keel it also holds `docs/patterns.md`, `docs/INBOX.md` and
`docs/keel-lessons.md`; that last is a managed file keel renders, so its
renderer must refuse the edit and name the file, never keep or overwrite it.

**Its files.** `scripts/roadmap.mjs` and its test, the phase contract and
template, `scripts/keel/generated.mjs` and `tests/keel-generated.test.mjs`
(managed); `docs/goals.json` (seeded); the `phases` block of the selected working guide.

**A test keel ships is run.** The two tests above (and the ci practice's
`tests/keel-workflows.test.mjs`) prove nothing unless the project's gate runs
them. `keel doctor` says `shipped-test-unrun` when the gate's `node --test`
names paths (files, simple globs, directories) that match none of them, and
migration 0005 appends the missing paths to a `node --test` test script in
the update PR. A script that names no path runs node's default, which
matches them; another runner is not judged.

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

**GitHub milestone plans (phase 63).** Set `phases.source` to `milestones`
with a configured `repo`, or review adoption's proposal when it finds described
milestones and no local plan. Keel keeps this practice local and installs no
phase files or local roadmap. `keel next`, `status`, `phase list`, the board
and the installed night read a bounded, cached GitHub projection. Deadlines
are `due`, not `after`; issue checks and `closed` milestones are source planning
state, never acceptance or production evidence. `phases.ownerLabel` defaults
to `keel:owner`. Invalid source or label settings fail before reads or writes.
Incomplete ownership stays unknown, never an agent assignment. Incomplete and unavailable sources remain visible. The
canvas currently reports both goal and phase coverage as unsupported rather
than publishing an archived local plan. Existing local roadmap checks report
inactive for this source; local roadmap writes remain refused.

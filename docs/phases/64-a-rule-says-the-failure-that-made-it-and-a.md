---
status: partial
owes: walk
since: 2026-10-11
goal: G0
spec: 2
depends: []
note: "Cause/date advice and bounded evidence re-derivation implemented and verified; owner read of the rendered rules remains."
evidence: ["evidence/2026-10-11-rules-and-measurements.md"]
issue: 51
---

# A rule says the failure that made it, and a number says when

## Done when

Every rule keel renders into a project's guide names the failure or lesson that made it (a lesson number, an issue, or one sentence); doctor notes a rule without one; a number in a phase's evidence or a research doc carries the date it was measured and, where one exists, the command that re-derives it; and a lint notes a figure with neither.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 7.

- **Rules with causes**: each block in `practices/*/files` (AGENTS blocks, the skill) carries, per rule, a `(why: lesson N)`, an issue, or a one-sentence cause. A `keel lessons` lint (`rule-without-cause`) notes any without one. Keel's own blocks are filled in first.
- **Dated numbers**: in `docs/phases/*.md` evidence and `docs/research/*.md`, a measurement in the form `<number> (<YYYY-MM-DD>, <command>)` or under a dated heading. A `roadmap --check` note (`undated-number`) flags a figure with a unit (ms, s, minutes, %, points) and no date nearby. It is advice, never a failure.
- **Re-derivation**: `keel evidence rederive <phase>` previews explicit structured measurement records; `--yes` runs their argument arrays directly and shows dated old and new values without rewriting history.

## Acceptance

- [x] Every rule in keel's shipped blocks has a cause; the lint notes one without. `tests/lessons.test.mjs`, `tests/practices.test.mjs`
- [x] `roadmap --check` notes a measured figure with no date nearby, and stays quiet for a dated one. `tests/roadmap.test.mjs`
- [x] `keel evidence rederive` reruns recorded commands and prints old and new values. `tests/evidence.test.mjs`
- [ ] ⚑ by hand: the owner reads keel's AGENTS blocks with their causes and says whether any rule now reads as obsolete.

## Your part

- **Ask:** Read keel's rules with their causes next to them, and say whether any of them no longer has a reason to exist.
- **Why:** A rule whose cause is gone is the cheapest thing to remove, and causes make that visible.
- **Look at:** keel's AGENTS.md blocks.
- **Choices:** All still needed | Some can go
- **Takes:** 15 minutes.
- **Then:** All needed: the phase is built. Some can go: they are retired in the next release.
- **Ready:** yes

## Real surfaces

- Adopted project: the guides keel renders, with causes.

## Proof

Automated: `node --test tests/lessons.test.mjs tests/practices.test.mjs tests/roadmap.test.mjs tests/evidence.test.mjs`; `npm run check`.
By hand: the owner's read of the rules.

## Deliberately open

- **Executable evidence — settled 2026-10-11:** Only fenced `keel-measurements` JSON records name executable measurements. Each record specifies an id, argv array, repository-relative cwd, original numeric value, unit and measurement date; an optional JSON field selects numeric output. Prose and backticks are never executable. Default is a preview; `--yes` explicitly runs the previewed commands without a shell, under timeout and output limits. Invalid records or escaping paths reject the run before execution; failed or unparseable results stay unavailable. Historical evidence is never overwritten.

- **What counts as a number — settled 2026-10-11:** Unit-bearing prose in phase Proof/Evidence/Trajectory and flat evidence/research Markdown; real ISO dates in the same item or enclosing heading count. Code, comments, URLs and explicit thresholds are excluded. The corpus still yields 59 advisory notes, including historical observations whose introductory date is outside the measurement item. This is a documented heuristic, not semantic verification or a reason to rewrite history.
- **Execution platform — settled 2026-10-11:** Preview is portable; execution requires POSIX process groups to bound ordinary descendant lifetimes. Each command is limited to 10 seconds and 65,536 combined output bytes. Windows execution is explicitly refused until equivalent process-tree cleanup exists.

## Next action

Owner: read the causes in AGENTS.md (15 minutes), then identify any obsolete rule or confirm they remain useful. Record the answer with `keel walk done 64 --choice "All still needed"` only after that read.

## Trajectory

- **2026-10-11** — Evidence commands are explicit argv records rather than Markdown command extraction; a read-only Ledger render preview and a real Keel measurement rerun preserved both projects' source files. The lint checks syntax, leaving truth and retirement to the owner. See the evidence record.

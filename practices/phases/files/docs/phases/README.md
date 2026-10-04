# Phase contract

Adapted from ritmo's, which adapted ledger's, which adapted isocan's. Each
numbered file owns its status; [`../ROADMAP.md`](../ROADMAP.md) is generated
from these files and [`../goals.json`](../goals.json), and CI fails when it
is stale.

## Status vocabulary

| Status | Claim |
| --- | --- |
| planned | Outcome and proof plan exist; design or implementation is still open. |
| designed | The slice and its contracts are specified well enough to build. |
| partial | Some of it exists; the note names the gap. |
| built | Every acceptance box is checked, with an evidence file; real use is not yet claimed. |
| lived-in | Repeated real use supports the outcome. The evidence says what made you sure. |
| superseded | Retired or replaced; the note says why and points at the replacement. |

A status can move backward when evidence says so; update `since` and say why.

## Metadata

One flat `key: value` per line between `---` delimiters — deliberately not
general YAML. Strings bare or JSON-quoted; lists are JSON arrays.

```yaml
---
status: planned
since: 2026-10-02
goal: G1
depends: [0]
note: "One line: why it stands where it does."
evidence: []
issue: 3
---
```

`evidence` paths are relative to `docs/` (`evidence/2026-10-02-x.md`); built
and lived-in need at least one. A phase with every Acceptance box checked
and evidence named can't stay planned, designed or partial: the check fails
until its status moves. The filename number is the phase id; never renumber.

## Sections

Required, in any order: **Done when** (one sentence someone else could check),
**Scope**, **Acceptance** (checkboxes), **Proof** (exact commands, and what a
person must do), **Deliberately open** (decisions postponed on purpose — settle
them in place, dated), **Next action** (one concrete step; `npm run next`
prints it).

Optional: **Trajectory** — written by the conductor, only for what changed
the course: `- **YYYY-MM-DD** — Claim. Evidence.` A phase that went as planned
says so in one line. Work done is not trajectory; git holds it.

Use [the template](../templates/phase.md). After editing: `npm run roadmap`,
then `{{check}}`.

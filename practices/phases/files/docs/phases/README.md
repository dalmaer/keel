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
| partial | Some of it exists; the note names the gap. With `owes: walk`, only a walk is left (below). |
| built | Every acceptance box is checked, with an evidence file; real use is not yet claimed. |
| lived-in | Repeated real use supports the outcome. The evidence says what made you sure. (When the project opts in: `"phases": {"livedIn": true}` in `.keel/keel.json`.) |
| superseded | Retired or replaced; the note says why and points at the replacement. |

A status can move backward when evidence says so; update `since` and say why.

Lived-in is a project's choice, off by default. Off, the roadmap's headline
and goal lines count built only and nothing asks for lived-in; a phase that
says `lived-in` stays valid and done. On (`"phases": {"livedIn": true}`),
they count lived-in too.

## Metadata

One flat `key: value` per line between `---` delimiters — deliberately not
general YAML. Strings bare or JSON-quoted; lists are JSON arrays.

```yaml
---
status: planned
since: 2026-10-02
goal: G1
spec: 2
depends: [0]
note: "One line: why it stands where it does."
evidence: []
issue: 3
---
```

Optional: `review: wait` (the only value; absent is the default) for a
phase you are nervous about. It lands through a PR instead of a push to
`main`, and merges when `keel review <repo>#<n> --gate` exits 0: every review
comment answered, and each reviewer named in `.keel/keel.json` `"review"` has
reviewed the head commit. The phase's issue labelled `keel:wait-for-review`
does the same. Without it nothing waits: review comments are still validated
and answered, but never block a merge.

Optional: `owes: walk` (the only value) on a **partial** phase whose
building is done and whose rest is a walk or time: a run on a real surface,
an owner's read, a week of nights. Its dependents' `depends:` are satisfied,
`npm run next` skips it, the roadmap shows it as *partial, walk owed*, and the
night's `phases_stuck` does not count it. It stays partial: built still means
proven, and its Next action names the walk. The check refuses `owes:` on any
other status, and refuses `owes: walk` while an unchecked Acceptance box is
still buildable. A box is a walk when it is `⚑ by hand: …` or its check is a
command that runs on a real surface (`` `gh …` ``), and it cites no
`tests/` path; any other unchecked box counts as buildable.

Optional, beside `owes: walk` only: `waits: owner | time | external`, whose
walk it is (absent is `owner`: a ⚑ box is the owner's). Nothing but where the
walk is listed changes (`keel board`; the roadmap shows *partial, walk owed
(time)*).

Optional: `after: YYYY-MM-DD`, the first day the phase is buildable.
`npm run next` skips it before that day (a dependent waits with it). The
generated roadmap never reads the clock: it names the phase *on or after* its
date, whatever the day, so a day passing never makes it stale.

`evidence` paths are relative to `docs/` (`evidence/2026-10-02-x.md`); built
and lived-in need at least one. A phase with every Acceptance box checked
and evidence named can't stay planned, designed or partial: the check fails
until its status moves. The filename number is the phase id; never renumber.

## Sections

Required, in any order: **Done when** (one sentence someone else could check),
**Scope**, **Acceptance** (checkboxes), **Proof** (exact commands, and what a
person must do), **Deliberately open** (decisions postponed on purpose — settle
them in place, dated; and each known limitation that could make the phase's
output wrong, a suggestion, a count or a verdict, with its effect and when it
is settled, never only in the design's prose), **Next action** (one concrete step; `npm run next`
prints it; once the phase is built, `None.`, or what lived-in needs when
the project counts lived-in; when it owes a walk, the walk).

With `spec: 2`, also **Real surfaces** (below).

Optional: **Trajectory**, after Next action — written by the conductor, only
for what changed the course: `- **YYYY-MM-DD** — Claim. Evidence.` A phase
that went as planned says so in one line. Work done is not trajectory; git holds it.
A defect found after a phase was built is an escape: record it in that
phase's Trajectory as `- **YYYY-MM-DD** — Escape: What escaped. Where it was
found.` The night counts these lines (`escapes`), with `fix:` commits and
lessons of the project's own; an Escape line naming another phase counts
against that one.

Optional: **Your part**, after Acceptance, for a phase with a ⚑ walk. It
says what the owner is asked in plain words, for someone who has not read
the phase (no "lever", "walk" or bare phase numbers):

```
## Your part

- **Ask:** <one sentence: what the owner does>
- **Why:** <one sentence: what it settles or unblocks>
- **Look at:** <one line; may link [text](url)>
- **Choices:** <Choice A> | <Choice B> | …
- **Keeps it open:** <Choice B>   (optional: choices that leave the walk open)
- **Takes:** <about how long, e.g. 5 minutes>
- **Then:** <what happens after, per choice where they differ: "Choice A: …. Choice B: …">
- **Ready:** yes
```

`**Ready when:** <what must happen first>` in place of `**Ready:** yes`
means the owner cannot act yet: `keel board` lists it as waiting, with that
reason, never as the owner's. A Markdown table of the data may follow the
bullets. Two or more walk boxes: one `### ` sub-heading per box, in the
boxes' order. A choice records the decision (`keel walk done <n> --choice
"<choice>"`) and ticks the walk's box; what it changes is the conductor's
next step, which Then says. A choice listed under **Keeps it open** (it must
also be a Choice; "Not enough data yet", say) writes the same evidence row
but ticks nothing: the walk stays open and can be answered again.
`--check` notes, never refuses, a phase with an open walk and no Your part,
and a Your part with no Ask, no Choices or no Ready.

Use [the template](../templates/phase.md). After editing: `npm run roadmap`,
then `{{check}}`.

## A spec says how it will be proven

`npm run roadmap` lists a phase as soon as it parses; `--check` (CI) also
reads it as a spec:

- **Template text fails, at any status** but superseded: a line of the
  template's placeholder text left in any section, or its title. The check
  and the template share one list (`PLACEHOLDERS` in `scripts/roadmap.mjs`).
  An empty Done when, Acceptance or Proof fails too.
- **`spec: 2`** (the template writes it, so `keel phase new` does) holds a
  phase to two more rules:
  - Each Acceptance box names its check: a cited test,
    `tests/<file>: "<test name>"`; a command in backticks (a program and its
    arguments, like `` `npm run check` ``); or `⚑ by hand: <who>`.
  - A **Real surfaces** section lists where the change runs for real, one
    `- <surface>: <its proof>` line each, from a closed list: published
    package, workflow shell, adopted project, owner's machine, GitHub API,
    fleet over time. A surface with no proof after the colon fails, and so
    does a word off the list. A change that runs nowhere new (a doc, a
    test) says the single line `none`.
- A phase without `spec` is held to neither rule. When it is built and a
  box names no check, `keel doctor` notes it (`acceptance-unchecked`,
  information); bring it up to date when it is next edited, never by
  rewriting a built phase for the lint.

A built phase's cited tests and evidence paths are watched by the night
(`proofs_hold`): one that disappears is *proof lost*, for a person to
re-point or to step the phase back.

# Lessons by stack and by pattern

Design, 6 October 2026. Phases 30 and 31 build it.

## Why

Keel's lessons table grew from 31 rows to about 55 in one afternoon. The inbox
held 131 items from ledger and isocan, and most were variations of about 25
ideas: the grouping was done by hand, in one pass, by the conductor. Two
things follow.

1. **An agent reads every row, whether it applies or not.** A static site on
   GitHub Pages reads about Vercel's build-keyed cache, and a Node CLI reads
   about CSS precedence. The table is the one thing every agent is told to
   read before adding a guard, so its length is a cost paid on every change.
2. **The table records incidents faster than it learns patterns.** Flaky
   tests arrived as nine rows in nine wordings. The merge into "a wait whose
   deadline nobody measured" was the valuable step, and nothing in keel
   prompts it.

## Part 1: where a lesson applies (phase 30)

**A closed vocabulary of stack tags**, in `practices/lessons/stacks.json`.
Each tag has a name, a one-line meaning, and the file evidence that detects
it in a repo:

| Tag | Evidence (any of) |
| --- | --- |
| `node` | `package.json` |
| `web` | an HTML entry, or a dependency on a browser UI framework |
| `vercel` | `vercel.json`, `.vercel/` |
| `gcp` | `cloudbuild.yaml`, `app.yaml`, `firebase.json` |
| `firebase` | `firebase.json`, `firestore.rules` |
| `github-pages` | a workflow using `actions/deploy-pages` |
| `github-actions` | `.github/workflows/*.yml` |

The list grows by a decision, like any practice change. A tag is a fact
about where a failure happened, never a guess about where it might.

**Keel's catalogue gains a fifth column, `Where`**: empty for a universal
lesson, or a list of tags. Most rows stay empty: flaky waits, locks and
vacuous checks bite every stack. Only keel's catalogue has the column; a
project's own table keeps four columns, so its rows' fingerprints, and what
`keel lessons` has already sent, do not move.

**A project declares its stack**: `"stack": [...]` in `.keel/keel.json`.
`keel adopt` and `keel doctor` detect it from the evidence and propose it;
the project's config is the record. A doctor lint fires when the evidence
and the declared stack disagree, either way.

**The per-project view.** The lessons practice ships a managed
`docs/keel-lessons.md`: every universal row of keel's catalogue, plus every
row whose `Where` meets the project's stack, rendered at `keel update`. The
lessons AGENTS block points at it beside the project's own table. Untagged
means everyone sees it, so a tag can only narrow who reads a row. A wrong
tag hides a lesson from a project it applies to; that is why tags need
evidence, and why universal is the default.

## Part 2: from rows to patterns (phase 31)

**A family** is a pattern with members: one rule, one guard recipe, and the
rows it was learned from, each keeping its number and provenance. Families
live in `docs/patterns.md`, keel's alone; the table stays the append-only
record of what happened.

**`keel learn distill`** prepares a distilling pass and records its
proposals. Keel never calls a model: the verb writes a worksheet (the
catalogue, the existing families, rows added since the last pass), and an
agent proposes, as with `learn propose`. Proposal kinds:

- **family**: these rows share a shape; here is its rule and guard recipe.
- **reword**: row N's shape, cost or guard, said more generally; the
  incident's words stay in the history.
- **tag**: row N applies to these stacks, with the evidence (where each
  incident happened).
- **promote**: a family whose guard can ship as a check every project runs
  (for example, a lint that fails on real-shaped secrets in tracked files)
  becomes a practice-change proposal.

The owner decides each, with `keel learn decide`, and the next release
carries it. A pass is run when asked, after a large inbox like 6 October's,
not nightly: it spends model tokens, and the night does not.

## What stays

- An agent proposes, a person decides. Nothing reaches the catalogue or a
  family without a decision.
- A private inbox stays private: distill reads keel's public catalogue, never
  issue text.
- Provenance survives every merge and reword.

## Deliberately open

- **Tags on a project's own table.** Not now: a project's table is its own,
  and its fingerprints are what keel uses to know what was sent.
- **Whether `docs/keel-lessons.md` should include families instead of rows**
  once families exist. Rows first; families when phase 31 has run once.
- **A second axis of tags (concern: testing, concurrency, data, UI, CI,
  agents).** Useful for reading, not for filtering; it can come from families
  instead.

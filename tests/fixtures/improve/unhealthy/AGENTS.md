# Working on Acme

Acme sells anvils to coyotes; this repo is its storefront.

## What Acme is

Acme sells anvils to coyotes; this repo is its storefront.

Kind: Node CLI or library. Zero runtime dependencies where it can, `node --test` for tests.

```bash
npm run next      # the next phase to conduct, and its next action
npm run check     # the whole gate; run before pushing (CI runs it too)
npm run roadmap   # after editing any docs/phases/*.md or docs/goals.json
```

## How the work is run

Each rule below exists because of a specific failure, recorded in
[`docs/lessons.md`](docs/lessons.md).

<!-- keel:begin phases -->
Acme edited this line inside keel's block.
**Status lives in the thing it describes.** Edit the phase's front matter,
then run `npm run roadmap`. Never hand-edit the roadmap; CI fails when it is
stale — status written in two places drifts.

**A phase ends in a testable outcome, named before it starts.** *Done when*
is one sentence someone else could check. *Proof* is the exact commands.

**Decisions postponed are recorded, not improvised.** *Deliberately open*
names them. Settle one in place, dated, saying what settled it.
<!-- keel:end phases -->

<!-- keel:begin evidence -->
**`built` is not the last word.** The statuses run `planned → designed →
partial → built → lived-in`. Built and lived-in need an evidence file. Never
invent evidence.
<!-- keel:end evidence -->

<!-- keel:begin conduct -->
**Conduct the walk.** `/conduct` (the skill in `.agents/skills/conduct`) briefs
a builder, verifies the proof itself, writes the record and commits each phase
to `main`. Builders test by file. The conductor runs `npm run check` once on
the integrated tree — a green subset hides a red suite, and checking at every level costs more than it catches.
<!-- keel:end conduct -->

<!-- keel:begin lessons -->
**Lessons are shapes, not incidents.** Add a row when a bug turns out to have
a shape, and say where it was paid for. Read the table before adding a guard.
<!-- keel:end lessons -->

<!-- keel:begin agents-md -->
**⚑ steps are asked, with the price.** Creating repos, setting secrets,
enabling Pages, filing issues on another repo, scheduling model spend: each
one waits for the owner's yes.
<!-- keel:end agents-md -->

## Rules for this project's code

Write them here. Everything outside the `keel:begin`/`keel:end` regions is
Acme's own; keel never rewrites it.

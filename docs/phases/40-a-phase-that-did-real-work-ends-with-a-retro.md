---
status: built
since: 2026-10-06
goal: G3
spec: 2
depends: [8, 24, 32]
note: "Built and used: retros at the end of phases 40, 39 and 35 gave six candidates; the owner picked all six; five shipped as checks or an AGENTS line and one as lesson 56."
evidence: ["evidence/2026-10-06-retro.md"]
issue: 18
---

# A phase that did real work ends with a retro, and what it finds becomes a check

## Done when

`/conduct` ends every phase whose commit changed code, tests or shipped practice files with a retro: a worksheet built by `keel retro --worksheet` from the session's transcript, and a short list of candidates in the phase report (a check, an AGENTS or skill line, or a lesson), most serious first; the owner has picked from at least two phases' retros, and at least one picked candidate shipped as a deterministic check.

## Scope

The design is [The retro after real work](../research/2026-10-06-pr-and-retro.md).

- **`keel retro --worksheet [--since <commit>]`**: reads the session's
  transcript the way `keel loose-ends` does (KEEL_CLAUDE_DIR in tests) and
  writes counts and pointers only, never transcript text: failed commands
  that were retried, tool errors, permission denials, files read three or
  more times, tool calls over a minute, edits reverted.
- **Real work**: the phase's commit changed a file outside `docs/`. A
  docs-only phase skips the retro and says so in one line.
- **The conduct skill** gains step 5, after the commit: run the worksheet,
  ask the seven areas, write at most five candidates, most serious first,
  each typed check / AGENTS line / lesson, into the phase report. The
  candidates live in the report, not in the repo, until picked.
- **Picking**: the owner picks; a picked check is built as its own small
  change (or a phase); a picked lesson goes through `keel learn`; a picked
  AGENTS line is a docs change. Nothing is applied unpicked.
- **Never from the night or a climb**: an unattended retro finds false
  positives and keeps fixing them.

## Acceptance

- [x] The worksheet counts each signal from a synthetic transcript (Acme) and writes no transcript text to any file; mutation: copying a message into the worksheet fails the test. `tests/retro.test.mjs`
- [x] A docs-only commit is not real work (the retro says so and stops); a commit touching `lib/` or `practices/` is. `tests/retro.test.mjs`
- [x] The conduct skill's step 5 names the worksheet, the seven areas, the candidate types and "the owner picks". `tests/skill.test.mjs`
- [x] ⚑ by hand: two phases' retros in their reports; the owner's picks recorded; one picked check shipped.

## Real surfaces

- Owner's machine: the session transcripts under `~/.claude/projects/` the worksheet reads.

## Proof

- Automated: `node --test tests/retro.test.mjs tests/skill.test.mjs`, with the mutation above; `npm run check`.
- By hand: the retros of the next two conducted phases, and the shipped check.
- ⚑ The owner's picks.

## Deliberately open

- **Retro for non-conducted sessions** (a long chat that did real work
  without `/conduct`): `keel retro` on demand covers it; whether loose-ends
  should suggest it is settled after a few retros.

## Next action

None. Lived-in after the owner has picked from retros across a few more phases.

## Trajectory

- **2026-10-06** — The retro reads the builders' transcripts (`<session>/subagents/*.jsonl`) beside the main session: that is where a phase's friction is. Builder's call, kept.
- **2026-10-06** — Step 5 runs `keel retro --since <the brief's base commit>`, not the phase's first commit: `since..HEAD` excludes `since` itself.
- **2026-10-06** — Its first real worksheet (phase 33's range) counted the owner's interrupt as a permission denial: a false positive, which is why candidates are picked by a person and the retro never runs unattended.
- **2026-10-06** — The owner picked all six candidates from the first three retros (phases 40, 39, 35): checks for one major version per action across shipped workflows, for the cold start nearing its cap, for adopt's shipped-file list derived from practice.json, and for timing tests whose margin a slow machine can swamp; an AGENTS line that this machine's shell is zsh; and a lesson, a test asserting what holds only for most random draws. Built as one change after phase 36.

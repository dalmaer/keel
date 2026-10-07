**Conduct the walk.** `/conduct` (the skill in `.agents/skills/conduct`) briefs
a builder (a phase of a file or two it may build itself: the skill's *Small
phases*), verifies the proof itself, writes the record and commits each phase
to `main`, then runs a retro when the phase changed more than docs (the owner
picks from its candidates). Builders test by file. The conductor runs `{{check}}` once on
the integrated tree — a green subset hides a red suite, and checking at every level costs more than it catches.

**Answer every review.** When a PR has reviews, validate each comment against
the code first, then answer it with one of the three replies: fixed (the
commit), tracked (the issue or version) or not valid (why), with
`keel review <repo>#<n> --close <id> …`; never leave one unanswered. Not a
gate: an open thread never blocks a merge.

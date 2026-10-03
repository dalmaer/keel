**Conduct the walk.** `/conduct` (the skill in `.agents/skills/conduct`) briefs
a builder, verifies the proof itself, writes the record and commits each phase
to `main`. Builders test by file. The conductor runs `npm run check` once on
the integrated tree — a green subset hides a red suite, and checking at every level costs more than it catches.

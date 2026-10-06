**Conduct the walk.** `/conduct` (the skill in `.agents/skills/conduct`) briefs
a builder, verifies the proof itself, writes the record and commits each phase
to `main`, then runs a retro when the phase changed more than docs (the owner
picks from its candidates). Builders test by file. The conductor runs `{{check}}` once on
the integrated tree — a green subset hides a red suite, and checking at every level costs more than it catches.

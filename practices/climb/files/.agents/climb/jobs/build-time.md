# Job: build-time

**The number:** the wall time of the project's build command
(`.keel/keel.json` `"climb"` `"build"`), median of k runs. Lower is better.
`climb.mjs measure build-time` prints it; the night times it once as
`build_time` (bound `"climb".buildBudgetMs`, else recorded only).

**Where to look first:** what the build does that it need not: work it
repeats per file, a step that runs on every build but changes once a month,
a bundler or compiler pass whose cache is thrown away, dependencies built
from source, steps that could run side by side but run in a line.

**The output must not change.** `climb.mjs guard` builds the base and your
candidate, each in a worktree, and hashes every file under
`"climb".buildOutput`. Byte-identical passes. A path that differs fails the
guard unless you said why the difference is harmless:
`node scripts/keel/climb.mjs harmless --path <path> --why "<why>"` (one per
path; the path as the guard prints it). Each reason is printed in the PR's
Merge danger, for the person to judge; at first the person decides what
counts as harmless, PR by PR. A timestamp or a build id you can make
reproducible is better fixed than explained.

**Not this job:** skipping a step whose output ships, turning off
minification or checks the project chose, a cache that outlives the run, a
dependency added, an output format changed.

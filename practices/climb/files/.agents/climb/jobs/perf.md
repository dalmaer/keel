# Job: perf

**The number:** what the project's own benchmark prints on its last line
(`.keel/keel.json` `"climb"` `"perf"` `"command"`), median of k runs, in
its `"unit"`. `"better"` says which way is up: `lower` (a time, a size) or
`higher` (a throughput). `climb.mjs measure perf` prints it; a command whose
last line is not one number cannot be measured, and says so.

**Judged as test-time is:** `compare --base HEAD~1 --decide` runs the base
and your commit alternately and keeps the change only when the number moves
the better way by the margin in every round. A change that moves it the
wrong way is reverted like one inside the noise.

**Where to look first:** the hot path the benchmark exercises. Read the
benchmark before the code: what it calls, how often, with what input. Then
work done per call that could be done once, an allocation in a loop, a
lookup that is linear where a map would do, I/O the benchmark waits on.

**The guard:** the project's gate, every test still running, and, when the
config names one, the project's own perf check (`"perf"` `"check"`), which
must pass on your last commit.

**Not this job:** changing the benchmark, its input or its iteration count;
caching across runs of it; a result that is faster because it is wrong; a
dependency added. The benchmark is the measure, never the work.

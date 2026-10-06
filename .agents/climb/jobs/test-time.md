# Job: test-time

**The number:** the wall time of the project's test command
(`.keel/keel.json` `"climb"` `"testCommand"`, default `npm test`), median of
k runs. Lower is better. `climb.mjs measure test-time` prints it.

**Where to look first:** the slowest test files. The test ledger
(`.keel/test-runs/*.json`, written by `scripts/keel/test-ledger.mjs`) records
each top-level test's file, name and milliseconds; sum by file and start at
the top. The health page's `slow_tests` row names tests that got slower.

**Changes that have paid before:** a test that spawns a process per case
where one process would do; a fixture rebuilt per test that could be built
once per file; a real sleep or timeout where the test can wait on the event;
files that cannot run in parallel because they share a directory or a port;
a slow setup step every file repeats.

**Not this job:** fewer tests, smaller assertions, a test made to skip, a
looser timeout that hides a hang, a cache that outlives the run, a change to
the test runner's flags that runs fewer files. `climb.mjs guard` catches a
test that no longer runs; a weaker assertion it cannot catch, so it is on
you.

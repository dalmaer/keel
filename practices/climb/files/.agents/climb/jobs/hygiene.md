# Job: hygiene

**The number:** the flaky tests the test ledger names: a test that both
passed and failed on one clean tree, among the newest runs in
`.keel/test-runs` (the workflow gathers CI's `keel-test-runs` artifacts
first). Lower is better. `climb.mjs measure hygiene --baseline` has written
them into `.keel/climb/night.json` (`flaky`), each with the command that
runs it alone. A flaky test is a red waiting to happen, so this job goes
before any other when the health page's `flaky_tests` is outside.

**What to do:** find the cause, fix it, and prove the fix. Read the test and
what it touches. The shapes that have paid before: a fixed sleep that a
loaded machine outruns (wait on the event, or make the work dominate
process startup); an id prefix assumed unique over random ids; state shared
between tests (a directory, a port, a global, an env var); order or time
assumed (dates, `Date.now()`, map order); work a test starts that outlives
it (lesson 39). A test that fails on a counter is a better fixture than a
sleep.

**How a fix is judged:** commit it alone, then run
`node scripts/keel/climb.mjs prove-steady --test "<file>: <name>" --decide --json`.
It runs that one test 20 times (`--runs n`, up to 50) on one clean worktree
of your commit, through the test ledger, and keeps the fix only with every
run passed and none failed; otherwise it resets to the base. A name that
matches no test is exit 2: it cannot tell, and decides nothing. Without
`--decide` it only reports, so `--runs 1` runs the test alone.

**Never the fix:** a longer timeout or deadline, a retry, a test made to
skip, a looser assertion. `prove-steady --decide` and `guard` refuse a diff
that, in the flaky test's file, only changes a timeout or adds a retry,
naming the line (lesson 40: a wait nobody measured). A real fix that also
changes a timeout passes, and the PR says so for the person.

**When the cause is not found** within the budget, stop. Keep nothing; the
workflow then files one issue on this repo from `climb.mjs report --issue`:
the test, the ledger's passes and fails on its tree, the command to run it
alone, and what you tried, with why it was not it (each `prove-steady
--decide` and `revert --why` you ran). You never file it yourself.

**A hygiene note is work.** Each test run ends with the test ledger's
hygiene block (`scripts/keel/test-ledger.mjs`): a test that was flaky on one
clean tree, or got slower than its last runs, with the command to run it
alone. Fix it or file it. Never rerun until green — a rerun hides the flake.

# Phase 50 — packaged recovery and inspected CLI compatibility

- Date: 2026-10-10
- Revision: `79d79ae` plus the phase 50 recovery working tree.
- Source: isocan `1565e501ad7a598c1af784d91971ca7d1773d2e9`, CLI `0.1.0 (1565e50, 2026-10-08)`.

## Observed

The public CLI diff from the previously inspected `b61f7c1` changes living
background presentation, not the adapter's create/add/read/group operations.
Actual help probes retain JSON, source/visual, metadata and native-group
contracts. General `edit --help` still exposes only `--visual`; its handler
has no expected-version parameter. Keel now accepts this specifically inspected
build; unknown builds still fail closed. No SDK or internal protocol is used.

The existing weekly automation names the approved writer session
`keel-loop-weekly`. Under that session, public `whoami` returned the already
approved Keel actor. The initial current-session read had no configured
identity; using the recorded session resolved that without creating a new one.

A scratch copy of the reporting workspace's last acknowledged receipt was
converted to a pending receipt with its item/version acknowledgement removed.
`node /tmp/keel-phases-50-66/live-recovery.mjs` called actual public list/show
operations against the approved private canvas with all mutation methods
disabled. It recovered the original fleet dashboard item, cleared pending,
returned unchanged (exit 0), and compared identical complete remote item lists
before/after: 13 items in both. Existing dashboards and the setup archive
survived unchanged. The original reporting manifest was not edited.

This is a **deployed read/recovery replay of a historical acknowledgement**,
not an induced production network interruption or conditional-edit proof.
It preserves the exact scope of the evidence.

The fresh in-app browser reached isocan's identity setup screen; no identity
was created and no browser-level live-edit walk is claimed.

## Automated proof

The phase's exact focused command (hermetic preload, spec and test-ledger
reporters, all seven canvas test files) exited 0: 94 tests passed, zero failed;
hygiene reported no flaky or slower test. The packed artifact is installed
outside the checkout without development dependencies. Its executable fixture
proves connection, render, publication with a lost acknowledgement, fresh-process
recovery with the same item ids, no duplicates, preservation of human layout,
comments and notes, and refusal after a human content edit.

`npm run check` is the final integrated gate; its result goes in the commit
body. `npm run typecheck` checks the selected production contracts.

## What remains

- A deployed public conditional general-edit contract for stable live pulse
  updates, including conflict results and source/visual version read-back.
- A browser-level human/concurrent-edit walk, beyond immutable append tests.
- Dedicated admitted GitHub runner credentials and the actual night/restart
  walk. The concrete setup is now in the project-canvas guide; it has no new
  model spend but requires owner-approved credential provisioning.
- Scheduled-use evidence: configuration and manual reads do not establish seven
  nights or a completed weekly automation run.

Phase 50 remains partial. No merge establishes these outstanding acceptance claims.

# Evidence: phase 93 — external private workspace initialization

- Date: 2026-10-21
- Phase: [93](../phases/93-workspace-data-stays-outside-public-code.md)
- Revision: `88574a79faf9fba9fc10adadba179cb49c5f8b80` plus working tree for
  `phase 93: Workspace data stays outside public code`.
- Claim: the installed CLI inspects and initializes only explicitly selected
  external workspace state, preserves existing ownership and reports remote
  privacy as unverified.

## Automated checks

The conductor independently ran these after reviewing the builder's report and
all new test bodies:

| Command | Observed result |
| --- | --- |
| `git pull --ff-only origin main` | Exit 0; already up to date |
| `node --import ./tests/helpers/hermetic.mjs --test tests/workspace.test.mjs tests/workspace-cli.test.mjs tests/cli.test.mjs` | Exit 0; 29 tests, 29 pass, 0 fail/cancelled/skipped |
| `npm ci --ignore-scripts` | Exit 0; development type tooling installed |
| `npm run typecheck` | Exit 0; configured selected-production contracts only |
| `git diff --check` | Exit 0 |
| `node bin/keel.mjs decision context --phase 93 --json` | Exit 0, not-configured; no accepted decision-record coverage claimed |

Decision context used for the builder:
`74c7be9ead5ace5a1c708736d275965911ca65246a0ecda365b9654007f59f64`.
The source phase hash was re-resolved before recording acceptance. The changed
phase status below is a conductor record, not new owner architecture attribution.

Tests assert bounded schemas and byte reads, rejected input redaction, no-write
inspection/preview, private modes, Git directories and linked worktree markers,
symlink/hardlink boundaries, wrong-owner preservation, two competing initializer
processes, strict arguments, JSON/help and actual packed CLI loading. Review
found a FIFO open-before-validation hazard; `special files are rejected before
opening instead of waiting for a FIFO writer` exercises a real named pipe after
the correction. No fake successful provider or deployment adapter is involved.

The final integrated gate is `npm run check`, run by `keel integrate` after the
record commit. It covers the full test suite, roadmap, render and inbox guards.
Its observed result belongs in the integration receipt/follow-up record, not
this pre-gate claim. Cold-start guidance fits the existing cap: the CLI test
reported 3170/3200 characters on 2026-10-21; rederive with the CLI test above.

## By hand: installed package and owner's machine

The conductor ran
`node --import ./tests/helpers/hermetic.mjs /tmp/keel-phase-93-surface-proof.mjs`
(exit 0), retaining the transcript at `/tmp/keel-phase-93-surface.log`. The
scratch script executed `npm pack --ignore-scripts --json --pack-destination
<scratch>`, extracted the returned tarball with `tar -xzf`, and invoked its
`package/bin/keel.mjs` in separate processes from the external scratch directory.
The host runtime was Node 26.12.0. This was the actual packed application, not
an imported test substitute; all workspace/project names were synthetic Acme.

The scratch root was the directory ending `keel93-surface-vQeaK8` under the
owner machine's temporary directory. Below, `P` is its extracted CLI, `M` its
`private-workspace/workspace.json`, and `S` its sibling `runtime` directory.
All paths were explicit absolute paths in the retained command transcript.

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| `node P workspace inspect --manifest M --state S --json` | Read uninitialized state without creating it | Exit 0, uninitialized, privacy unverified; S absent | Read-only installed command; not remote privacy |
| `node P workspace init --manifest M --state S --json` | Preview only | Exit 3, S absent | No implicit write |
| Same init with `--yes` | Private ownership marker | Exit 0, ready; S mode 0700, marker 0600; marker exactly version/id/repo | External initialization, no credentials |
| Same init with `--yes` in a fresh process | Idempotent ownership | Exit 0, same marker bytes | Retry preservation |
| Inspect in another fresh process | Persisted state recognized | Exit 0, ready, privacy unverified | Process-independent state |
| Change only manifest workspace ID, repeat init with `--yes` | Refuse different owner | Exit 2, mismatch; existing marker bytes unchanged | Refusal preserves data |
| Compare `git status --porcelain` before/after lifecycle | Source tree unchanged | Exact strings equal | No lifecycle writes in app checkout |

## Gaps and decision

This supports **built for phase 93**, not a hosted or lived-in web app. No real
private repository, GitHub App, secret, deployment or user session was created.
Single-user OS trust remains explicit: the path resolver is not a sandbox
against a malicious process with the same identity. Later writers must reuse
and revalidate the boundary. Provider privacy, login, Home and owner acceptance
remain in phases 94–101. The setup worksheet contains a researched candidate,
not an approved hosting obligation.

## Integration correction, 2026-10-21

The first `node bin/keel.mjs integrate --json` exited 1 after one `npm run check`
gate at candidate `331df4591a361ad973c35884c3a4fdaa061c69a8` on base
`eeb0dbbcb1e06ac4298d8446504ba6d2b2d04475`. It pushed nothing. Of 1904 tests,
1902 passed and two existing repository guards failed: README's Verb table
omitted workspace, and new CLI tests spawned children without the shared test
helper. These were deterministic findings, not flaky retries. The ledger named
no flaky/slower test but omitted its one busy run; no quiet-history claim follows.

Corrections add the README table row and use `tests/helpers/run.mjs` for child
process isolation. The concurrency test still runs two real independent
initializer processes; CLI lifecycle and package tests retain real CLI launches.
No shared helper/guard was weakened and runtime code was unchanged.

Conductor verification:

- `node --import ./tests/helpers/hermetic.mjs --test tests/workspace.test.mjs tests/workspace-cli.test.mjs tests/docs.test.mjs tests/helpers.test.mjs tests/cli.test.mjs`
  — exit 0, 36 tests passed, no failures/skips.
- `node bin/keel.mjs prove tests/docs.test.mjs --name 'the README names every registered verb and practice, and nothing else' --fix README.md --base 331df45 --trailer`
  — exit 0, VERIFIED: red without the table row, green with it.
- `node bin/keel.mjs prove tests/helpers.test.mjs --name 'no test spawns node or npm except through the helper' --fix tests/workspace-cli.test.mjs --base 331df45 --trailer`
  — exit 0, VERIFIED: red with direct child launches, green with helper isolation.

The corrected final tree is resubmitted to the same integrated gate. Its outcome
is a later receipt; this section does not predeclare it green.

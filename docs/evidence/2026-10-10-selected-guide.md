# Phase 58 — the project's selected guide

- Date: 2026-10-10
- Base revision: `3ec29f6374eae528171854763ecb31d4789effd1`.

## Implemented contract

Adoption chooses AGENTS.md when present, otherwise CLAUDE.md, otherwise a new
AGENTS.md. `--guide` selects another repository-relative file; config records
the choice. Init accepts the same setting. Rendering, drift checks, updates,
ejections, skipped blocks, contracts and migration edits use the destination.
Existing unowned prose and an independent second guide are preserved.

An in-repository symlink pair has one destination. Legacy block locks are
canonicalized for comparison without concealing edits; conflicting ownership,
outside links, dangling/cyclic links and repository metadata destinations are
refused. A selected guide cannot collide with another practice's target.
The skill doorway names the selected guide; CLAUDE.md is not overwritten with
a pointer when it is itself the guide.

## Verification

The conductor independently ran the hermetic focused suite covering guide, adopt,
doctor, update, init, practices, test-ledger migrations, contracts and lessons:
146 tests passed, zero failed or skipped, exit 0. The ledger reported no flaky
or slower test. This includes the regenerated self-render checks.

Command: `node --import ./tests/helpers/hermetic.mjs --test tests/guide.test.mjs tests/adopt.test.mjs tests/doctor.test.mjs tests/update.test.mjs tests/init.test.mjs tests/practices.test.mjs tests/migrations-test-ledger.test.mjs tests/contracts.test.mjs tests/lessons.test.mjs` (spec and test-ledger reporters enabled).

The first integrated run found one stale skill assertion requiring a literal
AGENTS.md in the template. It now requires the selected-guide placeholder;
`node --import ./tests/helpers/hermetic.mjs --test tests/skill.test.mjs` passed
all 13 tests, exit 0, with no hygiene finding. The full gate is repeated after
that correction.

`npm run check` is the final integrated gate; its outcome is recorded in the
commit body. `npm run typecheck` checks the selected production contracts.

## Review correction

PR #102 identified a broken lessons link when the selected guide sits under
`docs/`. Template rendering now rebases only the seed link destination against
the guide directory; the displayed repository path and project-owned prose
remain intact. Init and adoption regression assertions cover nested and root
guides. `keel prove tests/guide.test.mjs --name "init supports CLAUDE" --fix
lib/practices.mjs --trailer` returned VERIFIED: the test failed without the
fix and passed with it.

A second review also identified a physical target collision through a directory
alias, a missed lesson commit through a guide alias, a rejected safe intermediate
alias to the repository root, and the nested guide's README link. These are
validated source defects. The conductor independently ran guide, lessons,
adoption, rendering, init, doctor and update tests: 134 passed, zero failed,
exit 0, with no hygiene finding. Both `keel prove tests/guide.test.mjs --name
"^guide review:"` and the equivalent `tests/lessons.test.mjs` run (with the four
changed production files named by `--fix`) returned VERIFIED: red without the
corrections, green with them. The guide proof initially could not load against
the old module because the test imported a new helper; it now checks public
behavior without that import. The owner acceptance is unchanged.

## Acceptance still owed

No live project was adopted on the owner's behalf during this phase. The
named pilot and its owner's read remain outstanding: confirm a CLAUDE.md-only
project keeps one useful guide after adoption. Tests use synthetic Acme
projects; they do not establish that owner acceptance or lived-in use.

# Evidence: phase 90 — current decisions reach builder briefs

- Date: 2026-10-20
- Phase: [90](../phases/90-builders-receive-current-decisions.md)
- Revision: base `04a7b0ccbe74b86db254bdf704ac5415998839a0` plus the working tree committed as `phase 90: Builders receive the decisions that still apply`.
- Claim: explicitly linked decisions resolve by scope with source hashes, and contradictory or unavailable required context refuses dispatch or resume.

## Automated checks

The conductor ran these against the completed implementation:

- `node --import ./tests/helpers/hermetic.mjs --test tests/decision-context.test.mjs tests/decision-brief.test.mjs`: exit 0, 11 tests passed. Covers scoped replacements, proposed successors, graph contradictions, missing and unsafe references, read bounds, changed source and revision, unconfigured legacy targets, project identity, packed/adopted runtime and workflow-shell dispatch ordering.
- `npm run typecheck`: exit 0.
- `git diff --check`: exit 0.

The builder separately ran the compatibility suites recorded in its report: 127 compatibility tests, 73 parser/CLI/reconciliation tests, 9 targeted robot tests and 42 acceptance/session tests passed in their respective final runs. These overlap; they are not a unique test total. The conductor's proof above independently reran the named phase tests.

The first integrated run exited 1: 1,857 of 1,873 tests passed. It exposed that making reconciliation a mandatory climb practice broke older climb/tend configurations, a missing README command-table entry and direct Node spawns outside the test helper. Two CLI checks also observed an evidence-path typo while this record was being corrected; the corrected roadmap generated successfully. The compatibility repair imports only the required runtime scripts, retaining their source ownership without enabling reconciliation workflows or checks. The repaired focused compatibility suites passed: 69 compatibility checks, one workflow assertion and 55 adoption/runtime/helper checks in their respective runs. These overlap and are not a unique total. The packed tests include incremental adoption and repeated updates with runtime ownership preserved. These failures and repairs are retained in the record. The ledger reported no flaky or slower test; two busy runs were omitted from hygiene comparisons.

`npm run check` runs again after repairs, this record and roadmap generation. Its final result belongs in the commit body. It includes the integrated test suite and roadmap, rendering and inbox guards.

## By hand

The conductor packed with `npm pack --ignore-scripts --json --pack-destination /tmp/keel-nerd-compare.nJT16l/phase90-package`, extracted `keel-0.8.32.tgz`, and ran `node /tmp/keel-nerd-compare.nJT16l/walk90.mjs /tmp/keel-nerd-compare.nJT16l/phase90-package/package/bin/keel.mjs`. Exit 0; final output: `PASS: packed/adopted fresh-process context, changed source, broken history`.

The walkthrough initialized a disposable Acme project with reconciliation, wrote two accepted decisions in the same Markdown file, and linked phase 0 to the predecessor. The predecessor covered authored data and cache; its successor replaced only authored data. Separate CLI processes retained the cache choice and selected the successor for authored data. Editing the source wording changed the digest. Removing the successor's reciprocal link returned a contradictory bundle and exit 1. The first attempt exposed the anchor-before-heading parser bug. The walkthrough passed after its repair; the final named tests also exercise the packed runtime.

`node bin/keel.mjs decision context --issue dalmaer/keel#41 --json` exited 0 against the live read-only source. This legacy issue returned `not-configured`, with empty decision references and an issue content hash. No context was inferred from prose and no remote write occurred.

## Gaps and decision

This supports built. The workflow proof uses a synthetic issue transport and checks pre-agent digest consistency. It does not spend a model budget or prove a deployed robot session. No live builder run, deployment or lived-in behavior is claimed. Owner attribution is recorded source evidence, not authenticated identity. Unreferenced legacy targets remain explicitly not configured.

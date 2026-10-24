# Phase 124: exact name inventory without changing writers

Date: 2026-10-24. Base: `04c1cd28e4bf6c7e33e7e26785d1df90165ccf95`, plus this phase's working tree.
Phase: [124](../phases/124-every-keel-name-plates-still-writes-is-listed.md).

## Outcome and boundary

139 identities start held. The CLI re-exports the canonical managed source table; render installs identical bytes. Lookup rejects unknown identities. Held writes/reads keep the old name; dual writes the new name and reads new then old; retired reads/writes only new. The migration protection matcher derives from held/dual rows with explicit existing migration holds. Existing open owner namespace protections stay separate: removing them would change the earlier migration, while admitting them to the scanner would hide unknown names.

The scanner traverses lib, practices, bin, scripts, .github and web when present. It normalizes only explicit syntax spellings and retains a reviewed compatibility inventory (53 exact tokens, 103 path occurrences); regex fragments requiring context retain exact line hashes. An unknown name in any source root or on an exception line fails. Thirteen historical SQL files are byte-pinned. Nothing historical was rewritten.

## Independent proof

- `PATH=/opt/homebrew/bin:$PATH npm_config_cache=/tmp/plates124-npm-cache node --import ./tests/helpers/hermetic.mjs --test tests/names.test.mjs tests/rename.test.mjs tests/web-operation-coverage.test.mjs`: exit 0, 132 passed, zero failed/skipped. Log: `/tmp/plates124-conductor-focused.log`.
- Baseline: archive base above into a disposable directory, run `node scripts/render.mjs --self --json`, SHA-256 each existing rendered target, then compare the integrated candidate. All 84 existing targets were byte-identical; the new names module is additive. [Retained hashes](2026-10-24-name-inventory-baseline.json). Builder additionally compared 697 migration samples with no differences; that sample count is supporting evidence, not exhaustive input equivalence.
- Disposable-copy control: `node --import ./tests/helpers/hermetic.mjs --test tests/names.test.mjs`, exit 0. Replacing `TOKEN` with `/(?!)/g` made `--test-name-pattern='a keel name the table does not list'` exit 1 at its expected-list assertion. Making `writeName` unconditionally return `row.plates` made `--test-name-pattern='name lookups'` exit 1 at the held-state assertion. Replacing the dual read array separately with `[row.plates]` and `[row.keel]` made that same test exit 1 at its array assertion. All four failures were assertion failures, not syntax or setup errors. Logs: `/tmp/plates124-conductor-{scanner-mutant,writer-mutant,read-new-only,read-old-only}.log`; scratch copies never changed the working tree.
- `git diff --check`: exit 0. Full `npm run check` and `npm run typecheck` follow this final record before push; their results go in the commit.

The first integrated gate found a template-name guard conflict (2924 passed, one failed, four skipped): explicit `Plates-Operation` inventory data was treated as a hard-coded project name. The guard now exempts only registered `plates` field values in canonical rows, retaining checks on adjacent prose, other fields, unknown rows and other files. Independent `node --import ./tests/helpers/hermetic.mjs --test tests/practices.test.mjs tests/names.test.mjs` passed all 25 tests; log `/tmp/plates124-conductor-template.log`. The original failed run is retained in `/tmp/plates124-check.log`; no flaky or slower test was reported.

## Source-capability audit

The added table and re-export are pure modules with no parser, CLI verb, dispatch, network or mutation entrypoint. Existing migrate grammar and authority are unchanged. The reviewed closure now pins both modules, the modified migration module and the night manifest; the managed table is explicitly a non-entrypoint. No additional hosted permission or UI parity is claimed. The focused coverage audit passed after this reconciliation.

## Course corrections and limits

Initial focused preflight found three capability-source inventory failures, corrected by the explicit closure audit above. An early guard draft's excessive line-specific syntax exceptions were reduced to table-linked spellings and a separate compatibility inventory. Historical workflow filenames were removed from artifact transition rows and retained as provenance-reader compatibility instead.

Phase 109's owner/production walks remain partial. The owner's explicit 124–130 sequence authorizes this source-only continuation, not acceptance of those walks. No remote-name transition, deployment, fleet installation, live dual-read outcome or retirement is claimed. This proof supports built, not lived-in.

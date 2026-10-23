# Evidence: 114 — bounded Ledger retained-evidence collection

- Date: 23 October 2026
- Phase: 114, source-only collector slice; complete phase remains partial
- Revision: contract `b96cbf285287f8f25fe632140b0d27599fc97149` plus working tree, implementation title `validation: collect retained Ledger evidence without reuse authority`
- Reviewed code diff: SHA-256 `c33f107c09f2eac89dc6d8d00e80e6c1db0b0d2285440f102ad3f093b59209ec` against the contract commit; conductor record edits follow that code review.
- Claim: ingest one existing run under a reviewed coverage profile, preserving integrity, provenance, privacy and coverage limitations without running consumer checks or authorizing reuse.

## Automated and source checks

Builder command: `/opt/homebrew/Cellar/node/26.12.1/bin/node --import ./tests/helpers/hermetic.mjs --test tests/validation-ledger.test.mjs tests/helpers.test.mjs`. Final corrected transport proof exited 0: 34 tests passed, no failures, reported duration 1.427 seconds. Synthetic Acme controls cover corrupt/unsafe/oversized archives, mismatched or missing lanes, foreign/expired artifacts, changed source bytes, dirty/failed/filtered records, pagination, private payload omission, independent cache/harness bindings and actual redacted clock-field shapes.

Conductor command: `npm run check:focused -- tests/validation-ledger.test.mjs tests/validation-audit.test.mjs tests/validation-evidence.test.mjs`, pinned Node 26.12.1. First combined run exited 0: 167 tests passed, no failures, then roadmap/render/inbox/whitespace checks passed. The bundle includes helper, documentation, guide, CLI, adoption, skill, guide-consumer, web-operation capability and preflight conventions. Measured enclosing command: 34.62 seconds wall, 48.89 user + 18.70 system CPU seconds; these are different measurements, not savings. The final record and transport correction require this combined preflight again before integration.

`npm run typecheck` directly exited 0. An earlier timing wrapper returned 1 because the sandbox denied its `sysctl kern.clockrate` measurement, after the compiler emitted no diagnostic; that wrapper failure is retained separately and is not represented as a compiler failure or a pass. A sandbox process read was likewise unavailable; read-only escalation subsequently worked. Neither incident started a broad suite.

Required final source command: `npm run check`, followed by exact-head hosted checks and normal code review. It covers the full integrated tree and existing stall checks. Its actual result belongs in the PR/external exact-head evidence after this record is committed. No complete phase acceptance or final-gate pass is inferred here.

## Real retained surface

Command: `node scripts/validation-ledger.mjs --manifest plates.json --run 39892488810 --json`, using existing GitHub access and fixed GitHub.com GETs. Corrected collection exited **1**, as expected for explicit legacy gaps. It made 15 bounded reads and parsed 1,006,434 expanded bytes. It did not dispatch jobs or run consumer tests.

[Ledger Tests run 39892488810](https://github.com/dalmaer/ledger/actions/runs/39892488810), attempt 1, identifies head `ab69eccf029458dfee26c33822a085445705d629`, tree `d91b77d6b6b42637d403b945178f5f554d2cfac5`. All seven observed source hashes match the versioned profile. Both exact provider archive hashes matched downloaded bytes before parsing:

| Artifact | ID | SHA-256 |
| --- | --- | --- |
| plates-test-runs | 12475169931 | db91fac3e5ed7e17c05a638848899f0745a2a41052b4987b357016a88b9cdc63 |
| plates-test-runs-web | 12475621799 | dcd8a66772a50647d7563d8aa7a41796aa70deb3b070e411bb4cbe0542721c50 |

Four child records were retained: two core records with 1,060 observed test entries each, `dirty:false`; two web records with 426 entries each, `dirty:true`. Counts are retained telemetry, not an independently expected inventory. All four clock offsets are unobserved: their retained clock representation is unknown, with no observed offset hash. The result has 69 gap records across 22 codes; always `configuredGateComplete:false`, `reuseAuthorized:false`, and `executionAuthenticated:false`.

The initial real walk retained a harness hash mismatch: `application/vnd.github.raw+json` transformed thirteen literal escape sequences, producing 86,390 bytes/hash `90e52e3aaebfd4dcaac1406155c006bd8aa8c7d8f4e9c8837de5b1eb9e62b946`. Independently decoded content API bytes and the fixed `application/vnd.github.raw` response both verified 86,442 bytes/hash `37bc5a344f379611cc07aa7443b7bef764ca07aaa7d440acd01e1a5c85ef9238`. The expected manifest was not changed to match transformed bytes. A large synthetic source/escape corruption regression now guards this case; the original failed collection remains retained.

Earlier conductor inspection caught a separate preflight omission before any integrated gate: the evidence JSON reader's 4,096-character string cap rejected large base64 source responses. Source reads now use bounded raw bytes; the evidence parser remains unchanged. The synthetic source exceeds 86 KiB and verifies exact hashes, byte bounds and output redaction. Clock object misclassification was also corrected before broad validation. These are observed early-selection omissions and fixes, not successful first-attempt coverage.

The unchanged `validation-audit.mjs` accepted the real `auditInput` projection with the unchanged five-repository `plates.json` manifest and exited 1 with advisory coverage findings. This proves schema compatibility only. The Ledger-only projection does not supply missing fleet evidence. Raw provider metadata, source diagnostics, private artifact payloads and full test names stay outside Git; only safe identities and measurements are recorded here.

## Review, boundaries and decision

Independent local read-only review found no blocking issues on the original code snapshot and the corrected transport delta; it ran no tests or network calls. Exact-head hosted review remains a separate required result. Decision context is `not-configured`, digest `b87bcc600281a433a2ed78d6ab765304ddf2d665fce25d40fd25d2c37dc3fe3e`; absence of accepted decisions is not verified decision coverage.

The active gate, shadow and nightly validators, package/lock files and fleet manifest remain byte-identical to published main `1407926`. No gate execution, mandatory check, reuse/freshness default, credentials, permissions, workflow, consumer or schedule changes. White-elephant membership remains separate review work. Source phases 112/113 reconcile actual merged consumer changes as partial records, preserving local/hosted distinctions and historical evidence.

Remaining gaps include local voice/performance stages, expected child inventories, authenticated job/attempt/execution lineage, immutable private-data/environment observations and all complete configured-gate input bindings. Cache and harness stay separate; schema projections cannot silently substitute for one another. Run metadata start-to-update intervals are not execution wall time; job provider spans and derived child starts are labelled; CPU is unknown and overlapping intervals are never summed. No benchmark, causal speedup, equivalence, reuse adoption, production verification or full phase-114 completion is claimed.

## Fresh complete local review and boundary correction

At original head `09a24b49a046731cf1c4459a7d33cdef39b96cd8`, a fresh independent local reviewer inspected all 1,255 diff lines, explicitly 1028–1255, all 14 changed files in full and all required lessons/design/spec/phase context: 18 unique files / 3,864 lines with source hashes revalidated. This supplements the hosted attempts; neither hosted review is relabelled complete.

That review found one genuine P2: singleton arrays containing valid-looking hexadecimal strings passed `RegExp.test` coercion, but the bridge preserved the arrays in its audit projection. A conductor synthetic no-network probe confirmed that the unchanged analyzer rejects the resulting `inputs.cache` array. The first hosted zero-finding result and supplemental partial test reading did not catch this defect; preserve those coverage limits.

The correction requires actual strings at collector digest/Git-ID/token/legacy/clock-hash/runtime boundaries. Malformed observations remain unknown/gaps or are rejected before reads. It does not stringify inputs, pad hashes, relax the JSON/archive readers or change valid observations, gate execution/defaults, fleet/nightly scope or reuse authority. New synthetic matrices cover every joint digest axis, legacy/private-data identities, caller profiles, provider head/tree/artifact digest, clock/runtime fields and the full collector-to-unchanged-audit round trip.

Builder collector/helper proof exited 0: 40/40 passed, reported duration 1.498 seconds. `node --import ./tests/helpers/hermetic.mjs bin/plates.mjs prove tests/validation-ledger.test.mjs --name 'collector boundary rejects coerced strings and preserves audit compatibility' --fix lib/validation-ledger.mjs --trailer --json` returned **VERIFIED**: the single named test failed without the lib fix (`records[4].inputs.command is invalid`) and passed with it, with no skipped test or load error. Both sides ran in project scratch copies with the hermetic preload; the shared checkout was never broken to prove the defect.

Correction revision: original `09a24b49` plus working tree, planned commit `fix: reject coerced Ledger evidence identities`. The required combined focused/convention set, selected typecheck, corrected-delta independent review and corrected-head integrated/hosted checks are separate proof. Previous-head passing gates are not claimed for the correction. White Elephant owns the local heavy slot; coordinate before another required broad gate. Full phase 114 remains partial with complete consumer producers/equivalence/adoption still pending.

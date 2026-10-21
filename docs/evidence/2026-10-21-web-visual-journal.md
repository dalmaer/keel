# Evidence: phase 99 — visual additions retain private capture provenance

- Date: 2026-10-21
- Phase: [99](../phases/99-recent-changes-are-visible-and-testable.md)
- Revision: `230cd90` plus working tree, intended commit `phase 99: Recent changes are visible and testable`.
- Claim: authored additions resolve immutable source records; reviewed private captures attach without publishing source metadata, and ambiguous storage outcomes retain their original receipt.

## Automated checks

Conductor independently ran:

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-changes.test.mjs tests/web-projects.test.mjs`: exit 0, 30/30. Real source reader, malformed/bounded packages, revision/path identity, matching walks, fallback and Home limits.
- `node --import ./tests/helpers/hermetic.mjs --test tests/web-changes.test.mjs tests/web-media.test.mjs`: exit 0, 34/34. Includes byte validation, encrypted project/artifact scope, authorization, single-dispatch recovery, attachment CAS, explicit deletion, capacity and bounded metadata-only enrichment.
- Initial integrated focused command adding `tests/web-change-ui.test.mjs`: exit 0, 43/43 before final parser and presentation review corrections; final focused verification is recorded below.
- `node /tmp/keel-phase99-media-sql-proof.mjs`: exit 0 against external PGlite 0.5.11. Executed actual migration SQL with service/anonymous/authenticated roles, RLS and direct-table denial, shared-owner reads and actor-specific reservation, lifecycle/attachment CAS, deletion fences, retained uncertain reservations, verified-absence capacity release, pagination and metadata/receipt limits. This is a single connection, not hosted or concurrent-transaction proof.

Migration `lib/web/migrations/006-private-media.sql` SHA-256:
`04edb90bf043d4f42caf285a21ebf17dd25581b8b1d3bf7a03bd484839fd9d2f`.
The initial SQL proof harness reset its role inside a rolled-back transaction;
resetting outside the transaction corrected the harness. No migration change was
needed for that failure.

The whole gate is `keel ready --check 'npm run typecheck'` followed by
`keel integrate`, whose single integrated `npm run check` includes tests, roadmap,
render and inbox guards. Its result belongs in the subsequent integration record.

`npm run typecheck`: exit 0 after merging the dependency update. The final
mobile recheck still measured document width 390 at viewport width 390; stale
captions visibly separated saved capture context from current slot requirements.

## Real GitHub source resolution

Ran `node --input-type=module -` importing `createChangeRevisionReader` from
`lib/web/changes.mjs`; the callback used authenticated `gh api graphql --input -`
with JSON query/variables, and repository identity from `gh api repos/dalmaer/keel`.
Exit 0; no credential was printed. Repository numeric identity `1402587435`,
implementation revision `5ca5453311518a8a9f4f60fdc37e5c5fed707420` resolved:

| Path | Observed blob | Mode |
| --- | --- | --- |
| `docs/phases/98-guided-walks-preserve-what-was-tested.md` | `4211ba8983b65949a3110e16cbca11bc2d39dffb` | 33188 |
| `docs/evidence/2026-10-21-web-guided-walks.md` | `fc3f3eb7bf08f7d95feb0ae55d58f403172751b8` | 33188 |

This checks the actual immutable links used by `docs/changes/guided-walks.json`.
The package explicitly says awaiting deployment and supplies reasons for missing
preview, matching owner walk and private attachments. It does not claim production
availability from a merge.

## Browser observations on the owner's machine

Used actual application routes and controllers through a loopback-only server
(`/tmp/keel-phase99-browser-demo.mjs`) with synthetic Acme GitHub/storage adapters.
Uploaded the actual desktop and mobile guided-walk screenshots already retained
in phase 98 evidence. Synthetic revision/environment/scenario declarations were
entered explicitly; these are not assertions that a real deployed Acme service
exists. No production credential, provider write or public source mutation was used.

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Review desktop JPEG and provenance | Actual file preview, hash and metadata appeared before confirmation; upload disabled before explicit checkbox | Real browser review path; not verification of owner-declared provenance |
| Upload desktop and mobile JPEGs | Verified private receipts, authenticated images loaded with natural dimensions 1280×2595 and 390×3014; CSS viewports separately retained as 1280×900 and 390×844 | Application upload/delivery flow against synthetic encrypted storage; not hosted bucket behavior |
| Open journal and detail | Captures, attributed availability, exploration steps and matching walk link appeared | Integrated source/media/UI flow |
| Press Enter on Enlarge, then Escape | Dialog opened, Close focused, dialog closed | Keyboard enlargement path |
| Follow matching walk | Opened `Try Acme search`, two authored steps, no observations and disabled acceptance submission | Matching walk navigation; not owner acceptance |
| Set viewport to 390×844 | Document scroll width 390; both images loaded | Responsive browser layout, not a physical-device walk |
| Change desktop slot requirements | Desktop became stale and hidden with receipt retained; unchanged mobile remained visible | Requirements invalidate independently; caption review found the correction described below |
| Open Home | Recently added card used current authorized capture; decisions and ready walks remained present | Project Home integration; automated tests cover queued cursor updates without source rereads |

Screenshots: [desktop](images/2026-10-21-journal-desktop.png),
[mobile](images/2026-10-21-journal-mobile.png). These are application screenshots
with synthetic data, not generated designs or production acceptance evidence.

## Review findings

The browser walk exposed stale captions combining current requirements with old
capture metadata. Independent review confirmed the mismatch and also identified
that source availability needed to expose a different or unknown observed revision.
Review also found day-only publication dates compared against exact visit timestamps, hiding same-day additions. All three were corrected; independent reproduction probes and three named regression tests passed (exit 0, 3/3).

Conductor final focused command:
`node --import ./tests/helpers/hermetic.mjs --test tests/web-change-ui.test.mjs tests/web-home.test.mjs tests/web-home-events.test.mjs tests/web-server.test.mjs tests/docs.test.mjs tests/guides.test.mjs`
— exit 0, 40/40. Final screenshots were refreshed after restarting with the corrected modules. The restart seeded the same actual screenshot files through the real media service with synthetic adapters; displayed timestamps and revision remain fixture provenance, not a production capture assertion. The earlier explicit browser upload/review observations above remain separate.

The concurrent dependency update was merged from `origin/main`; setup documentation and the service guard now require Node >=24.22.1. Existing observations of production Node v24.21.0 remain historical and do not verify that new minimum.

## Gaps and decision

Supports partial implementation, not built or lived-in. Hosted migrations 004–006,
private bucket activation and retention choice, real provider concurrency behavior,
production serving verification, and the owner's real captured-addition walk remain
open. Vercel's fresh authenticator challenge is pending. Source-writing permissions
remain disabled; public export and automatic cleanup are outside this phase.

Prepared intents with no dispatch retain their capacity reservation and require
operator inspection. No cancellation mechanism or automatic retry is implied.
Expired objects are not delivered, but receipts remain and expiry does not delete
bytes. No new remote resource or paid allowance was activated by these checks.

## First integration finding and correction

The first integrated test run on `4cf7b36` reported 2,132/2,133 passing.
`tests/web-events.test.mjs` failed because its minimal scheduling fixture had no
`querySelectorAll` method when Home applied the new filter at initialization.
The conductor independently reproduced the exact failure with
`node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='client scheduling starts' tests/web-events.test.mjs`
(exit 1, 0/1). This was not a flaky result or a production DOM failure.

The fixture now supplies filterable synthetic Acme cards and search controls,
asserting their initial visibility before a response. Immediate polling, normal
interval and hidden-page no-read assertions remain. No runtime code changed.
Conductor reran `node --import ./tests/helpers/hermetic.mjs --test tests/web-events.test.mjs`: exit 0, 12/12.
The original integrated failure is preserved; a fresh full gate is still required.

## Corrected integration

`keel ready --check 'npm run typecheck' --json` on `515d891`: exit 0.
`keel integrate --json`: exit 0, one gate, merged to main
`8b28114613becd56513c45d38ec16d659828d37c`. All 2,133 tests and the roadmap, render
and inbox guards passed. Pinned stall checks passed; the ledger reported no
flaky or slower test, with one busy run omitted from timing comparison. The first
attempt remains above. This merge does not deploy or activate private storage.

The retrospective worksheet reported real work but no local session transcript.
Navigation, check automation, standards, AGENTS health, tool economy, no-op rules
and information gaps were reviewed; no unselected retrospective rule was applied.

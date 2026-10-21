# Evidence: phase 100 — daily sources and private learning transfers

- Date: 2026-10-21
- Phase: [100](../phases/100-daily-work-and-learning-stay-private.md)
- Revision: `d69c0c6` plus working tree, intended commit `phase 100: Daily work and learning stay private`.
- Claim being checked: daily inspection preserves source status and unknown usage; selected lesson copies and exact exports retain authorization, provenance and original-operation recovery.

## Automated checks

Conductor independently ran:

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-daily.test.mjs tests/web-projects.test.mjs`: exit 0, 26/26. Includes immutable source/tick selection, coverage distinctions, date and source-bound unsaved drafts, explicit configured allowance versus unknown actual usage, and Home's bounded default-branch projection.
- Final named proof: `node --import ./tests/helpers/hermetic.mjs --test tests/web-daily.test.mjs tests/web-migration.test.mjs tests/web-learning.test.mjs`: exit 0, 36/36. Includes the subsequent missing-plan allocation correction, exact private copy/readback, stale source/permission/privacy refusals, projected catalogue capacity, original-operation recovery, and exact reviewed export.
- Final integration-focused proof: `node --import ./tests/helpers/hermetic.mjs --test tests/web-daily-ui.test.mjs tests/web-events.test.mjs tests/web-home.test.mjs tests/web-server.test.mjs tests/web-auth.test.mjs tests/docs.test.mjs tests/guides.test.mjs`: exit 0, 57/57. Includes real routes/authentication/CSRF, browser controllers, strict return destinations, packaged-server smoke and guidance.

The daily builder's first focused run was 25/26 because a new Home test passed the
wrong argument shape to `createHomeStore`; the corrected fixture passed 26/26.
The original failure was retained, not characterized as a flake. The conductor's
initial bare `git pull --ff-only` could not select an upstream on the new phase
branch; `git pull --ff-only origin main` then exited 0, already up to date.

The whole gate is `keel ready --check 'npm run typecheck' --json`, followed by
`keel integrate --json`. The integrator runs `npm run check` on the recorded tree,
covering tests, roadmap, render and inbox guards. Its result will be recorded after
integration. `npm run typecheck` exited 0 on the recorded implementation; its scope
is the repository's selected production contracts. `npm run roadmap` exited 0
after correcting the conductor's initially unquoted evidence path to the required
JSON array syntax. Completed browser and review observations are recorded below.

## Real nightly source comparison

`node /tmp/keel-phase100-real-daily.mjs`: exit 0 at 2026-10-21T22:17:10Z.
The script invoked the actual `createDaily().inspect()` adapter using the local
GitHub CLI's owner authorization, held only in process memory. It made thirteen
bounded reader requests, then independently fetched each returned record through
the GitHub Contents API at its immutable revision, compared parsed plan bytes and
recomputed its Git blob hash. No token was printed and no source was written.
This is real provider evidence, not hosted GitHub App permission evidence.

| Record | Revision | Blob | Bytes |
| --- | --- | --- | ---: |
| `keel-night-plan:.keel/night/plan.json` | `1a9e89187a2cd3763ff93c5605a6157155f90423` | `be22fc61d7eca34121ed41d92f5e0c3fd5626ff6` | 2785 |
| `keel-night/2026-10-21-final:docs/night/2026-10-21.json` | `8fccad9c814f7d86a4c3cc94209f9efc99685c65` | `be22fc61d7eca34121ed41d92f5e0c3fd5626ff6` | 2785 |
| `keel-night/2026-10-21:docs/night/2026-10-21.json` | `2a8ddc6755e41b11faa78bc07aee19561ea404eb` | `554b461049e290397004cd55f9ea70e6a8f74314` | 2603 |
| `main:docs/night/2026-10-21.json` | `8b28114613becd56513c45d38ec16d659828d37c` | `554b461049e290397004cd55f9ea70e6a8f74314` | 2603 |

The working-plan file on main was absent. The actual merged view retained
`measures` as done, selected the later `climb-test-time` failure over main's planned
tick, and left the other three planned items open. Configured climb allowance and
plan allocation were both 45 minutes; robot allowance was 60 minutes per week,
with allocation and actual usage unknown. Missing before/after measurements stayed
gaps. Morning readiness did not mark planned work completed or establish acceptance.

## Real lesson source and private destination inspection

`node /tmp/keel-phase100-real-learning.mjs`: exit 0 at 2026-10-21T22:18:07Z.
Used the actual `createLearning().project()` and `.shared()` adapters with the
existing private instance's numeric repository pins, manifest and membership.
The local GitHub CLI owner's authorization was used; no hosted App write
permission, transfer or deployment is established by this check. No writes occurred.

The private destination passed numeric identity, visibility, immutable source,
manifest and current membership checks. Its shared catalogue was explicitly
absent, with zero records and an absence gap. Exact private revision and repository
metadata are retained in the private setup record, not copied into this public
evidence. Public Keel at `8b28114613becd56513c45d38ec16d659828d37c` exposed fifty
project lesson rows from `docs/lessons.md`, explicitly partial because the bounded
reader does not include later rows. No private lesson text was exported.

## Design finding

The climb template depends on companion files present only after practice
assembly; importing it directly would break the packaged web service. The design
was clarified in `d69c0c6` before resuming implementation: display explicit source
allowances and listed jobs, refuse drafts whose limits cannot be established, and
keep unresolved defaults or full runner validation unavailable. Canonical plan
validation, morning merge and readiness remain reused directly. No project script
executes in the request process.

## Review and browser findings

Independent review reproduced a source change during the final authorization
callback that still copied old lesson bytes. The reserved operation now performs
final authorization before re-reading the selected source and destination. The
same independent probe changed from committed/one write to
`refused`, `stale_selection`, zero writes. Commands
`node --import ./tests/helpers/hermetic.mjs /tmp/keel-phase100-review-probe.mjs`
and `/tmp/keel-phase100-review-probe-fixed.mjs` both exited 0, asserting their
respective observed behavior. The original probe remains retained. This is a
fresh bounded source observation, not a distributed atomic commit across repositories.

Further corrections before the final focused checks:

- An absent or invalid plan displayed zero allocation; it now displays unknown.
  A valid authored empty plan still observes zero.
- The draft editor offered lane-family names that canonical validation could not
  accept; it now uses explicit source job targets. Invalid draft previews with
  null budget observations render their errors without crashing.
- Private imports now label record-declared attribution separately from verified
  transfer receipts. Mid-catalogue access revocation denies the whole private read.
- Copies enforce both resulting record count and actual UTF-8 catalogue bytes,
  including existing padded JSON, before writing.
- New review controls no longer silently ignore clicks after submission. They
  remain disabled on the original operation, with a fresh-catalogue link after a
  terminal outcome. The receipt stays reachable.

## Browser walk on the owner's machine

Used actual application routes, authentication and controllers with synthetic Acme
GitHub and encrypted-store transports. No external provider write or real owner
lesson transfer occurred. Startup scripts were
`/tmp/keel-phase100-browser-demo.mjs` and the conductor's fault-injection variant
`/tmp/keel-phase100-browser-loss-proof.mjs`.

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Inspect daily source differences | The selected item retained a nightly failure and expandable original records; configured 45-minute allowance, 10-minute allocation and unknown actual usage stayed separate | Actual application rendering of synthetic source observations, not owner acceptance |
| Enter 90 draft minutes against a 45-minute ceiling | Error named the exceeded ceiling; no file or runner action | Browser validation and error display |
| Restore 10 minutes and preview | Complete unsaved draft and validation result appeared | Drafting only, not publication |
| Select a lesson and review private copy | Full exact JSON, private destination, commit message, expiry and receipt link appeared; apply remained disabled before explicit approval | Review boundary |
| Submit approved copy | Verified private commit receipt appeared; new review controls disabled with a fresh-catalogue link | Synthetic conditional commit/readback, not hosted SQL concurrency |
| Review and download an explicit text export | Saved file was exactly 76 approved bytes, SHA-256 `59f72289dfd3d949707e4a9be677f6966cd863dc008679f5a2d858e29586cf50`; no source metadata added | Actual browser download independently compared from disk; no public publication |
| Replace the successful apply response with HTTP 503 after adapter completion | UI retained the original operation and offered only receipt recovery | Ambiguous-response handling |
| Check original receipt | Same operation became verified; conductor harness logged one apply request and one provider write | Browser recovery without a second submission |
| Inspect copied workspace catalogue | Selected lesson and original provenance appeared in the private catalogue | Application readback; declared attribution remains distinct from an authenticated receipt |
| Inspect Daily and Learning at 390×844 | Both document widths were 390, no horizontal overflow | Responsive browser proof, not a physical-device walk |

The first demo contained invalid synthetic result keys and the wrong branch-name
fixture; it honestly rendered invalid/absent sources. The demo was corrected to
canonical `{note,link}` result fields and exact branch names. This was not a
production reader defect. A socket-close attempt did not visibly exercise the
uncertain UI; the conductor used explicit HTTP 503 fault injection and logged the
single submission/write instead of assuming the first attempt proved response loss.
Two interrupted navigations during a demo restart were not application failures.

Screenshots: [desktop Daily](images/2026-10-21-daily-desktop.png),
[mobile Daily](images/2026-10-21-daily-mobile.png),
[mobile lesson receipt](images/2026-10-21-learning-mobile.png). These are real
application screenshots with synthetic records. They do not claim a hosted
deployment or real project migration.

## Gaps and decision

### Integration observed 21 October 2026

`node bin/keel.mjs integrate --json` exited 0 after one `npm run check` gate:
2183/2183 tests passed, all pinned timing-stall checks passed, and roadmap,
render and inbox guards passed. The test ledger reported no flaky or slower
tests; the busy run was omitted from timing comparisons. Source commit
`10d2b0b3d89ea343bbcaad51bab0f4bfc5a0cef9` landed on main at
`431ec5983ca7e837fa6734a3787c5a2bd59be118`. The phase claim was released.
This is implementation integration, not hosted deployment or owner acceptance.

Supports partial implementation with a remaining real-use walk. Hosted operation
storage activation, an approved source-writing permission and
gate, owner-selected real lesson migration/recovery, deployment verification and
the owner's mobile/desktop acceptance remain unverified. A preview, copied lesson
or text download establishes no project acceptance, runner invocation, expanded
budget or public publication.

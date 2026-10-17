# Phase 88 — production errors

## 2026-10-17: discovery and provider preflight

Scope: six canonical local repositories, from `fleet.json` and actual `.keel/keel.json`
files. Papa Tapes is locally adopted but absent from the fleet list. Duplicate
worktrees are not independent services. No source acceptance was changed.

| Repository | Application source | Observed access | Rollout proof |
| --- | --- | --- | --- |
| dalmaer/ledger | Vercel project `prj_SzaJZZazbmkvd7E6pCoODAhuLOlS`, team `team_cMCy7SIscGVdBNqiksY5C8s4`, production | CLI 59.23.2 with existing local login succeeded; existing `VERCEL_API_TOKEN` GitHub secret name confirmed | Pending collector and nightly recovery walk |
| dglazkov/isocan | Cloud Run `isocan`, project `isocan-io-prod`, region `us-west1` | Existing local Google account token refresh failed (`invalid_grant`); no GitHub Google identity found | Blocked on local reauthentication and an approved CI reader identity |
| dalmaer/duo | Static GitHub Pages | No application log source identified | Application collection not applicable; browser telemetry is not covered |
| dalmaer/cajones | Static GitHub Pages, local `cajones/ritmo` | No backend per project guide | Application collection not applicable; browser telemetry is not covered |
| dalmaer/papa-tapes | Static GitHub Pages | No application log source identified | Application collection not applicable; browser telemetry is not covered |
| dalmaer/keel | CLI and Actions | No deployed application runtime | Application collection not applicable; Actions health remains separate |

Provider probes were read-only, bounded to the previous hour. Vercel error-filtered
query returned zero records (exit 0); a separate unfiltered limit-2 query returned
two records (exit 0). Only counts and field types were inspected; raw messages and
request details were not saved. These are access/schema checks, not a healthy-day
claim, traffic measurement or verified repair.

Command shape:

```sh
vercel logs --project <project> --scope <team> --environment production \
  --since <start-UTC> --until <end-UTC> --limit 5 --level error --json
```

The isocan read used `gcloud logging read` with an explicit Cloud Run service,
production project, ERROR severity, UTC window, `--limit=5 --format=json`. A temporary
official macOS ARM CLI archive was checksum-verified and unpacked under
`/tmp/keel-production`; no global install, shell change, cloud resource or IAM grant
was made. Account listing is not proof of a working login: the actual read failed.

Ledger's guide documents short runtime-log retention. Vercel's [runtime log limits](https://vercel.com/docs/logs/runtime)
also distinguish retention by plan. A nightly query cannot establish continuous
coverage beyond retained data. Keep this limitation visible pending a durable source
or separately configured collection cadence; do not run the full gate more often.

## 2026-10-17: first real collector observation

From an isolated reporting workspace with the proposed Ledger source config:

```sh
node /Users/dionalmaer/code/keel/practices/night/files/scripts/keel/production.mjs collect --yes --json
```

Exit 0, one provider attempt, UTC window **2026-10-17T09:46:43.420Z through
2026-10-17T10:46:43.420Z**. Zero error records, unknown traffic, partial coverage.
Gaps: `provider-completeness-unproven`, `nightly-cadence-gap`. The result was
persisted in the isolated workspace's `.keel/production/` journal; no raw events
were retained. This runs the installed script surface, not the still-being-built
CLI wrapper, and does not prove scheduled execution/recovery.

The public CLI was then exercised against the Isocan candidate in a separate
workspace, with the temporary Google CLI on that process's PATH:

```sh
keel production collect --yes --json
```

Exit 1, one attempt, window **2026-10-16T10:50:17.123Z through
2026-10-17T10:50:17.123Z**. Coverage `unavailable`, gap `access-or-config`, traffic
unknown. The expired-login failure was retained without its raw stderr, and was
not retried or represented as zero observed production errors. This validates
failure reporting, not Google access.

## 2026-10-17: implementation proof

Conductor reran the named focused proof after the builder's handoff:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/production-errors.test.mjs tests/production-integration.test.mjs
npm run typecheck
```

21 tests passed, zero failures, exit 0; focused duration 1,733 ms. Typecheck exit 0.
The tests include actual child-process timeout/output bounds, synthetic provider
schemas, replay/overlap, privacy, crash recovery, issue POST ambiguity, adopted
installation, and the real delivery verifier with controlled HTTP responses.
Verification rejects a completion-only observation window and requires the entire
probe interval plus separate earlier revision evidence. This is synthetic proof;
no real production repair has been claimed verified.

Independent review found and the builder corrected late-arrival invalidation,
unknown-ID overlap overcounting, recovered-issue lifecycle rewinds, malformed run
history bootstrap and completion-only probe coverage. Removed sources retain
history but no longer produce active repair candidates.

Full integrated gate, reviewed release, fleet installation and scheduled retention
readback are pending. This record does not establish scheduled operation or lived-in use.

### First integrated gate (2026-10-17)

`npm run check`: exit 1, 1,849 tests, 1,843 passed and 6 failed; plain suite
172,257 ms. Failures were the test-process helper rule (three new direct Node
spawns), the optional Vercel secret missing from the practice declaration, and
night/morning workflow invariants requiring scoped updates. All configured
stall probes passed; the hygiene block reported no flaky or slower test.
The failure is retained; corrections and a subsequent full gate are required.

### Local Google CLI installation (2026-10-17)

After the temporary probe, installed the same checksum-verified CLI 589.0.0
under `~/.local/share/keel/google-cloud-sdk-589.0.0`, with a `gcloud` symlink
in the existing `~/.npm-global/bin` PATH directory. `gcloud --version` exits 0.
No existing executable was replaced, shell config changed, credential exported,
or cloud resource created. The expired login still requires reauthentication.

### Retention configuration corrected from fresh provider facts (2026-10-17)

`vercel api /v2/teams/<configured-team> --method GET --raw`, parsed in memory
to retain only `billing.plan` and `slug`, reports **Pro**. The older Ledger guide's
one-hour statement is not the current plan limit. Vercel's official runtime-log
documentation specifies one day for Pro; the rollout window is therefore 1,440
minutes, not the initial one-hour access probe. No plan or billing setting changed.

A fresh public `keel production collect --yes --json` over
**2026-10-16T11:02:31.703Z through 2026-10-17T11:02:31.703Z** exited 0 after one
attempt: zero returned error records, unknown traffic, partial coverage with
`provider-completeness-unproven`. The cadence-gap finding from the one-hour
configuration is absent for this window. Retention limits and scheduler delays
still prevent a guarantee of continuous coverage. The earlier receipts remain.

The rollout's pinned installation was tested separately with
`npm install --prefix /tmp/keel-production/vercel-pinned --global vercel@59.23.2 --ignore-scripts --no-audit --no-fund`
(exit 0); its `vercel --version` reports 59.23.2. Putting that installation on
the collector process's PATH and collecting the same explicit 24-hour window
exited 0 with `replay: true`, zero returned events and the same partial-coverage
gap. This verifies the installation and idempotent observation surface, not
provider completeness.

### Second integrated gate (2026-10-17)

After workflow/helper corrections, `npm run check` exited 1: **1,851 of 1,852**
tests passed, plain suite 180,603 ms. The sole failure was the new guide mentioning
an npm installation flag as standalone code, which the guide checker treated as
a Keel flag. The wording is corrected without weakening the checker. All configured
stall probes passed and no flaky/slower hygiene was reported.

Review also identified that a later verification could replace the only detailed
record of an earlier verification. A bounded, validated verification history was
added before the final gate; digest-only transaction receipts cannot recover
that historical evidence by themselves.

### Final focused proof (2026-10-17)

Conductor reran both named production test files after the history and provider
schema corrections: **24 passed, exit 0**, 1,945 ms. Bounded verification history
retains prior outcomes and proof references across regression/recovery, reload and
artifact restoration, with explicit eviction counts. The Vercel adapter matches
CLI 59.23.2 request rows with nested error/fatal logs, deduplicates by request and
signature, and discloses truncated messages, repeated shapes and missing identities.
Malformed identities and non-string message/stack values cannot become exact evidence.

Final integrated gate command: `npm run check`; contracts: `npm run typecheck`.
Their result belongs to the implementation commit. Fleet retention remains unproven.

## 2026-10-17: reviewed implementation and release runtime correction

Implementation [PR #194](https://github.com/dalmaer/keel/pull/194) merged as
`6f526cba7a794779d48a23f6c7ba5b4640257a7b`. Local integrated gate: 1,855 tests,
zero failures, exit 0; typecheck exit 0. GitHub check, typecheck and impact passed.
Claude's exact-head review reported no findings in the four core collector/state/
verification/CLI files it read; it explicitly did not review workflow/docs surfaces.
This scope is distinct from the prior independent review and local workflow tests.

The final real Vercel adapter (error and fatal request logs) read
2026-10-16T11:17:59.767Z–2026-10-17T11:17:59.767Z: exit 0, one attempt, zero
returned events, unknown traffic and provider-completeness-unproven coverage.
No repair is claimed production-verified.

The first clean-checkout release attempt failed two existing test-ledger tests:
concurrent parent/child correlation and redaction. That checkout selected system
Node 24.13.0, below the required 24.21.0. Release rolled all version edits back and
created no tag. Running `tests/test-ledger.test.mjs` on explicitly pinned Node
24.21.0 passed all 80 tests (23,658 ms). The supported runtime is pinned for the
subsequent release and rollout. The failed attempt is retained, not called a flake.

### Release and fleet rollout

v0.8.32 published at `b4410d1` after the supported-runtime full gate passed.
The release rehearsal passed Duo, Cajones and Ledger. Isocan failed both with the
candidate and on main; it is recorded as `main-red`, not a passed rehearsal.
No release review or compatibility override was used.

- [Duo #111](https://github.com/dalmaer/duo/pull/111) merged at `98cad943d2b7f4f24ee6eb6572b917e5fcfc9e69`;
  [Deploy](https://github.com/dalmaer/duo/actions/runs/39030561367) succeeded.
- [Cajones #83](https://github.com/dalmaer/cajones/pull/83) merged at `4cf4bc6bae853c127f2b08051734155d6d9c6e84`;
  [Pages](https://github.com/dalmaer/cajones/actions/runs/39030559429) succeeded.
- [Papa Tapes #1](https://github.com/dalmaer/papa-tapes/pull/1) merged at `04687b7ef461353daddd1e64197ff1c8effd876c`;
  [publication](https://github.com/dalmaer/papa-tapes/actions/runs/39030391291) succeeded.

Their clean primary checkouts were fast-forwarded and read back at practice
0.8.32 with `production.enabled:false, applicability:not-applicable`. No browser
error coverage or application production verification is inferred. Keel itself
has the same explicit applicability setting. Papa Tapes media/editorial files
were not changed. Duo/Cajones stale required-reviewer entries were removed in
accordance with the owner's earlier instruction disabling that connector.

Ledger's configured update is [PR #143](https://github.com/dalmaer/ledger/pull/143).
A shallow-clone rollback test failed until full history was fetched; the named
rollback proof then passed. A subsequent baseline-worker failure and a 49,399 ms
isolated pass near its 50,000 ms bound remain tracked in
[Keel #195](https://github.com/dalmaer/keel/issues/195). A serialized local update
gate and the independent release rehearsal passed; those passes do not close
the hygiene finding. At this checkpoint final PR CI and the nightly retention walk were pending; the results below supersede that pending state.

Isocan's shallow-clone changelog failure was corrected by fetching history; all
five focused changelog tests passed. Its next gate exposed a pending dynamic
import after UI test teardown. A test-only async teardown now awaits nested
imports; the focused file passed once (one test, 1.82 s). Application behavior,
assertions and unhandled-error reporting were not changed. At this checkpoint the corrected update was still being validated; the results below supersede that pending state. Google access remains unavailable.


### Final rollout and real recovery walk (2026-10-17)

All six primary checkouts now contain the configuration. Ledger's local phase 36
and generated roadmap changes were preserved; Isocan's untracked conduct skill
was preserved. Neither was folded into this rollout.

- [Ledger #143](https://github.com/dalmaer/ledger/pull/143) merged as
  `30668ca0d6442e3ff74ea66df9c61ea83d241693` after
  [PR CI](https://github.com/dalmaer/ledger/actions/runs/39030586229) passed.
- [Isocan #494](https://github.com/dglazkov/isocan/pull/494) merged as
  `ef096866cae3838c72860c086c238b0eadbcfd7f` after
  [PR CI](https://github.com/dglazkov/isocan/actions/runs/39031346574) passed.
  Local configured gate passed; required deep verification reported 9,124 passing
  and 115 skipped tests. Its post-merge release and Pages workflows succeeded.

`keel production collect --yes --json` from Ledger's primary checkout read
2026-10-16T12:16:35.098Z–2026-10-17T12:16:35.098Z: exit 0, one attempt,
zero returned errors, unknown traffic, partial coverage with
`provider-completeness-unproven`. This is not proof of error-free production.
Isocan's corresponding read, 2026-10-16T12:16:34.923Z–2026-10-17T12:16:34.923Z,
exited 1 with unavailable coverage and `access-or-config`; the existing Google
login cannot refresh (`invalid_grant`) and no approved CI reader is configured.

Ledger's existing CI credential failed the Vercel user lookup with `User not found`
(404), before log retrieval. Bounded manual diagnostics reproduced this on
[CLI 59.23.2](https://github.com/dalmaer/ledger/actions/runs/39032200766) and
[CLI 64.5.0](https://github.com/dalmaer/ledger/actions/runs/39032342399).
Diagnostic workflow success means the probe ran, not that its provider calls
succeeded. No secret was printed, created or rotated; production keeps its pinned
CLI. Local login success does not establish CI authorization.

The [first main night smoke](https://github.com/dalmaer/ledger/actions/runs/39031780717)
retained an unavailable observation for 2026-10-16T12:16:08.059Z–2026-10-17T12:16:08.059Z.
The [second main night smoke](https://github.com/dalmaer/ledger/actions/runs/39032223712)
restored run `39031780717`, attempt 1, and retained both that failure and the new
unavailable window ending 2026-10-17T12:22:57.157Z. Downloaded artifact envelopes
passed the shipped `validateEnvelope`; the second had two windows and the exact
prior failed observation. Both runs were deliberately cancelled after artifact
retention to bound the smoke; neither is a passed full night. Collection's actual
exit was 1 even where GitHub's continue-on-error step conclusion showed success.

Phase 88 remains partial: collection authorization and a complete operational
night remain unproven. No incident has been declared accepted or production-verified,
and no new automatic repair budget was enabled. The installed spec/issue path
reuses robot authorization and requires a person to merge its resulting PRs.

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

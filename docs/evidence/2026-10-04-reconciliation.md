# Evidence: phase 26 — records reconcile without inheriting acceptance

- Date: 2026-10-04 (America/Denver; GitHub observations extend into 2026-10-05 UTC).
- Phase: [26](../phases/26-reconciliation.md).
- Revision: `18f73f6` plus working tree for `phase 26: Phase records agree with delivery facts and current decisions`.
- Claim being checked: existing doctor, PR CI and night health checks detect contradictory references and propose reviewed corrections, preserving separate merge, acceptance, production and use facts.

## Automated checks

- `node --import ./tests/helpers/hermetic.mjs --test tests/reconciliation.test.mjs tests/reconciliation-integration.test.mjs tests/helpers.test.mjs` — exit 0, 42 passed, zero failures on the final rendered tree, including deletion/reference and bot-body regressions.
- `node bin/keel.mjs improve --selftest --json` — exit 0, `ok: true`, 15/15 measures outside their bounds, no missed unhealthy condition. Reconciliation detects the fixture's missing acceptance reference.
- `node bin/keel.mjs doctor --json` — exit 0, no drift, lint or unknown observations. Legacy coverage notes remain visible.
- `npm run render` — exit 0, 32 practice targets rendered; the final render check is part of the gate.
- `git diff --check` — exit 0.
- `node scripts/keel/reconcile.mjs --github --json` on Keel — exit 0, zero deterministic findings, zero unknown reads, zero proposals and 26 legacy coverage notes; only Keel's own explicitly referenced delivery PR was queried. An earlier run exposed bare `#number` references being mistaken for local PRs and correctly returned incomplete on 404s. The parser now requires PR context or a qualified reference; regression fixtures protect numbered lessons and external references.

Night, Loop, update and Renovate bodies carry specific impact declarations.
The generated-body tests feed those declarations through `checkImpact`, then
add a phase edit and prove the no-impact declaration fails. They grant no bot
exemption. Existing open PR bodies and locally owned bot configurations are
not rewritten by this installation.

A mistyped `improve selftest` invocation exited 2 with an unexpected-argument
error; the documented `--selftest` command above was then exercised.
The package smoke test also passed (exit 0, one test) with
`npm_config_cache=/private/tmp/keel-reconciliation-npm-cache node --import ./tests/helpers/hermetic.mjs --test tests/package.test.mjs`.
The ordinary cache is outside this sandbox's writable roots; no developer npm
settings or ownership were changed. The ancestor survey expectation now
includes the new optional practice as off by default.

The final gate is
`npm_config_cache=/private/tmp/keel-reconciliation-npm-cache npm run check`: the complete hermetic test suite, roadmap,
rendered practice/lock check and inbox check. Its result belongs in the phase
commit body because the gate runs after this record is written.

## Read-only Ledger walk

Read GitHub with `gh api repos/dalmaer/ledger/pulls/22`, `pulls/38`, and
`commits/main`. The current facts were re-read during verification:

| Source | Observed |
| --- | --- |
| [PR 22](https://github.com/dalmaer/ledger/pull/22) | Closed/merged, not draft; merged at `2026-10-04T18:09:24Z`, merge `ae2247269d107580925ea78fd3b2a67c0f828f2d`. |
| [PR 38](https://github.com/dalmaer/ledger/pull/38) | Open, not draft, `merged_at: null`; head `541402fa5330493e5dcfb2062904e41a0f635a2b`, base `acf811da715d527bc9ba37b54c65c867f6492689`. GitHub's provisional `merge_commit_sha` on an open PR is not a merge event. |
| Ledger main | `f9807b75ac212d8fb09fe14320707e2adc9a2191`. |

Bounded snapshots of phases 28, 29, 30, 33, `docs/research/multi-user.md` and
phase 29/30 evidence were read at main and PR 38's head. Temporary copies under
`/private/tmp/keel-ledger-reconciliation-audit/` preserve those document bytes.
Only an audit configuration naming `dalmaer/ledger` was injected, to qualify
bare PR references. No configuration or documents were written to Ledger.
The temporary snapshots are not tests or shipped fixtures.

| Record reviewed | Finding / correction | What this does not prove |
| --- | --- | --- |
| Phase 28 | Main calls delivered stages a draft and still asks for writer inventory/baseline work. PR 38 updates delivery and redirects remaining work; old authored-data migration stages are superseded by phase 33's choice. | Remaining performance/device/hosted-outage gates are not accepted. |
| Phase 29 | Main's next action asks to review PR 22. It merged. PR 38 replaces that action with latency, real-device/deployment and rollback proofs. | The phone/code-data split proof reported by phase 33 does not establish all recovery or performance claims. |
| Phase 30 | Its inline next action after Trajectory still asks for draft review. PR 38 keeps hosted endpoint/scopes/budget and independent outage proof open. | No hosted configuration or cloud-outage test was performed here. |
| Phase 33 and multi-user research | The settled owner entries select Neon/Postgres and application Google/GitHub auth. PR 38 updates stale open questions. BenOS remains sources-only. | Neon is a selected destination; the separate Git data repository remains the current authored-data authority. |
| Historical evidence | PR 38 adds dated context without rewriting old benchmark/failure results. | Its local `check:all` missing `.ledger-data.json` remains a local gap; separately reported exact-head CI does not erase that gap. |

### Engine observations

Ran the shipped engine's `reconcile({root, github: true})` on each bounded
snapshot, using real `gh` reads, and then `verifyProposal` on phase 29's saved
proposal with another fresh read. Exit 0 for the audit harness:

- Main: zero deterministic findings (no structured declarations), four legacy
  coverage notes, **four advisory manual proposals**, zero unknown reads.
  Phase 29 has the explicit PR 22 conflict; phases 28/30 first need their
  unnamed PR qualified; phase 33 needs its open choices compared with settled
  research. The latter three are not promoted to authoritative contradictions.
- PR 38 head: four legacy coverage notes, **zero correction proposals**, zero
  unknown reads. This is narrower than certifying the whole project clean.
- Saved phase 29 proposal: fresh verification returned `valid: true`.
- The audit initially exposed false positives on ordinary review-history
  prose. The corrected reader requires PR-oriented wording, skips negated
  pending claims, and retains standalone current next actions after Trajectory.
  Synthetic regressions exercise both stale and corrected wording.

Equivalent CLI read for either prepared snapshot:
`node practices/reconciliation/files/scripts/keel/reconcile.mjs --root <snapshot> --github --json`.
The temporary `main-live-report.json` and `pr38-live-report.json` capture the
observations and fingerprints; the pinned source revisions above make the
walk repeatable without turning live project data into fixtures.

The [design's case table](../research/2026-10-04-reconciliation-practice.md#ledger-22-and-38-the-concrete-reconciliation)
records the proposed corrections and remaining acceptance. PR 38 being open
means its corrected records cannot be substituted for main's current record.

## Gaps and decision

This proves bounded structural checks and a read-only real-project audit.
Ledger's unstructured prose can produce advisory candidates; deterministic
acceptance, proof and architecture checks need stable references adopted in
its own records. Human review still decides whether a declaration covers the
meaning of a code change, whether an old proof applies after a revert, and
whether remaining acceptance is satisfied. The engine neither applies patches
nor closes phases, adopts decisions or changes acceptance boxes.

No Ledger PR was merged, no issue closed, no deployment or benchmark run, and
no production/lived-in claim is made by this verification. Keel's own use is
initial adoption, not evidence of repeated nights or lived-in reliability.

## Qualified-link correction — 2026-10-10

Default-branch runs 38027064158 and 38031566161 exposed an invented local reference from the label of a qualified Ledger link. The parser now uses the link destination for both extraction and advisory association, preserving standalone bare references, explicit qualifiers, history/fence exclusions and genuine unknown remote observations.

The conductor ran `keel prove tests/reconciliation.test.mjs --name 'linked PR identity owns its label' --fix practices/reconciliation/files/scripts/keel/reconcile.mjs --base 5588093 --trailer`: exit 0, VERIFIED red without and green with the correction. The builder's full reconciliation test file passed 29 checks with no hygiene findings. Separately, phase 45's historical configuration reference moved from its current owner-assessment action to its trajectory, preserving the evidence. Live reconciliation after that record correction returned no findings or unknowns. The final integrated gate is `npm run check`; its result belongs in the commit.

A later review covered optional Markdown link titles: the destination must still own its label. `keel prove tests/reconciliation.test.mjs --name 'qualified PR links with optional Markdown titles' --fix practices/reconciliation/files/scripts/keel/reconcile.mjs --base 0c4dd17 --trailer` returned VERIFIED. The builder passed all 71 reconciliation/review checks, and the conductor passed 184 combined robot/reconciliation checks with no hygiene findings. Unknown remotes and genuine standalone references remain unchanged.

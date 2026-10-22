# Evidence: phase 105 — reviewed fleet updates and source-backed lesson traces

- Date: 2026-10-21 America/Denver (2026-10-22 UTC).
- Phase: [105](../phases/105-fleet-updates-and-lessons-travel-through-the-web.md).
- Revision: design `ed424780` and working tree, to be committed as
  `phase 105: Fleet updates and lessons travel through the web`.
- Claim: local version comparison, bounded preparation protocol, immutable output,
  separately reviewed publication/recovery and independent lesson trace observations
  work through actual authenticated routes. Real execution and activation remain open.
- Decision context: `not-configured`, digest
  `e6dbc8d15c4a4bd5e32a6fb2201b7dcc3cd6d818f38414e04a547108d62c601c`;
  no accepted choices, proposals or gaps. This is legacy behavior, not verified
  architecture coverage. Phase claim was verified mine/here before dispatch/resume.

## Automated checks

The conductor ran these commands in the dedicated worktree:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/web-fleet-updates.test.mjs tests/web-lesson-rollout.test.mjs
# exit 0; tests 30, pass 30, fail 0
node --import ./tests/helpers/hermetic.mjs --test tests/update.test.mjs tests/update-prepare.test.mjs tests/web-update-worker.test.mjs tests/web-fleet-updates-ui.test.mjs
# exit 0; tests 48, pass 48, fail 0
node /tmp/keel-phase105-conductor-sql-proof.mjs
# exit 0
node /tmp/keel-phase105-conductor-sql-regression.mjs
# exit 0
node /tmp/keel-phase105-git-object-proof.mjs
# exit 0 after correcting the scratch script's obsolete blob-body assumption
node /tmp/keel-phase105-real-source-proof.mjs
# exit 0; read-only GitHub source verification using existing CLI authentication
```

Named tests cover stale source/target/grants, shared budgets and lanes, immutable
fenced output, malformed responses, equal-version pending migrations, changed and
ejected ownership, exact public acknowledgment, failed-update/base comparison
policy, lost blob/ref/PR responses, conservative recovery and green-only canary
advancement. Existing CLI restoration and transformation tests run against the
shared implementation. Worker checks cover setup ordering, tracked mutations,
symlinks/deletions, dirty trusted sources, frozen patch bytes, uncertain begin/output,
monotonic deadlines, authority loss and bounded cleanup protocol.

The conductor's isolated PostgreSQL checks exercised migration 010 plus the prior
009 regression: service-only RPC/table access, RLS, null/missing/extra field
rejection, actor/scope separation, immutable artifacts, live fence/cancellation,
compare-and-swap stages, no uncertain redispatch, shared admission and conservative
charges. A sixty-minute preparation claim was admitted; a fifteen-minute reservation
rejected a fifty-nine-minute claim and accepted fourteen minutes.

- Engine: PGlite 0.5.11, **one in-process connection**.
- Migration 010 SHA-256:
  `8e5e4c47c3f20b9c0c925e1e6a6e0658aed206ed39db5c9eb51d536730bfd96d`.
- This does **not** prove independent hosted connection races. The remaining walk
  must race shared budget/lane admission, publication dispatch CAS and immutable
  output on separate connections, including rollback and cancellation boundaries.

Independent actual Git produced the same blob/tree/commit identities for nested
paths, Unicode ordering, executable modes, symlinks and deletion. The resulting
reference tree was `24f0b76052071baed7c6e74fc70a79aacf4a0600`, commit
`6d9410ba7d05c6a937eec430c3f633bcda3de09d`. Synthetic provider agreement alone was
not used as that proof.

The builders also ran their focused compatibility sets: backend 46/46; UI/auth/
learning/guides 83/83; selected doctor 7/7, workflow 4/4 and existing worker 15/15.
The backend ledger reported no flaky/slower findings; busy-load comparison was
retained as unavailable. These are local focused checks, not the full gate.

The final integrated gate is `node bin/keel.mjs ready --check "npm run typecheck" --json` (including the
selected production typecheck), then `node bin/keel.mjs integrate --json` running
`npm run check`: tests, roadmap, render, inbox, patterns and stall guards. Its result
belongs in the integration/commit record after this evidence is written.

## Corrections retained

The first new backend fixtures still imposed the old fifteen-minute limit. Draft
SQL failed to compile because a CASE expression needed parentheses; a malformed
null output-project then revealed a missing explicit type check. Both were fixed
before the independent SQL checks above. Initial worker fixtures incorrectly used
empty practice maps; the next run exposed a mismatched deletion-error assertion.
No production requirement was relaxed to make these fixtures pass.

Review also found that requiring a successful worker made the documented failed-
check draft policy unreachable. Publication now requires matching terminal worker
and provider outcomes plus verified output; failed checks can produce the existing
truthful draft/base-comparison policy, while cancelled or unknown results cannot.
A final UI regression first failed with contradictory completion wording, then
passed after the verified receipt said GitHub confirms the PR. Historical failing
logs were retained in the local scratch record.

## By hand

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Read exact target and default source through the real GitHub API at 2026-10-22T01:22:37.880Z | Target `7c3161db38cdd5c67a1afa6b6781c1974b6b76c4`, CLI/practice `0.8.32`, complete 1,326-entry tree; current default source `8480bbd5fb96282bea1f467aa2d6fa4262f23e8d` | Real numeric repository/source/target read; existing CLI authentication, not App login or update execution |
| Walk actual authenticated routes and signed worker callbacks with Acme transports | Explicit project/canary selection; separate preparation and exact public PR approval; output alone did not enable publication before provider terminal reconciliation | Application routes, controls and protocol integration; synthetic output is not container execution |
| Lose the synthetic PR response, reload and reconcile | The original receipt recovered PR 1; no replacement publication or PR appeared | Browser disconnect/recovery journey under synthetic external transport |
| Open the same receipt at desktop and mobile widths | 1280 desktop and 390 mobile; mobile scroll width 390; old controls replaced, titles/focus moved with the journey | Responsive browser walk, not a physical-device owner trial |
| Reopen current project version after PR creation | Default-branch practice/lock and pending migration remained separate from the PR result | PR creation does not claim installation |
| Inspect canonical lesson trace and source links | Decision, catalogue, guard, migration, proof reference, release and current adoption independently displayed; execution and acceptance remained unavailable | Bound, authorized synthetic source projection; no real lesson acceptance/export |
| Disable preparation/publication policy | Project preparation unavailable and rollout submission disabled | Off-by-default behavior |
| Inspect local Docker availability | CLI present; engine socket unavailable; Desktop UI inspection blocked by locked Mac | No container isolation/termination claim; no reset, permission change or host fallback performed |

Screenshots use **synthetic Acme data**. No image is a production or real update PR:

- [Desktop version comparison](images/2026-10-21-fleet-versions-desktop.jpg)
- [Desktop preparation review](images/2026-10-21-fleet-preparation-desktop.jpg)
- [Mobile exact publication review](images/2026-10-21-fleet-publication-mobile.jpg)
- [Mobile uncertain PR recovery](images/2026-10-21-fleet-recovery-mobile.jpg)
- [Mobile verified PR receipt](images/2026-10-21-fleet-pr-verified-mobile.jpg)
- [Desktop lesson trace](images/2026-10-21-fleet-lesson-trace-desktop.jpg)
- [Mobile lesson trace](images/2026-10-21-fleet-lesson-trace-mobile.jpg)

The temporary demo and tabs were stopped/closed; viewport overrides were reset.

## Gaps and decision

Status remains **partial, owes walk**. No real update worker dispatch, migration010
activation, permission expansion, update PR or production deployment occurred.

The prepared local command `node /tmp/keel-phase105-real-container.mjs` still needs
an available Docker engine. It uses the pinned official Node image and actual
adapter to check frozen tmpfs retention, isolation flags, background processes and
timeout cleanup. The Docker-shaped unit transport cannot establish those claims.
The real workflow additionally needs an approved adopted project, exact trusted
worker-bearing target, image/platform/network policy and runtime allowance; Keel's
self-project is ineligible.

Before activation, independently verify hosted database concurrency, install the
literal-pinned workflow and private registration/shared budget, approve the precise
App permissions and deploy the existing service. Then prepare one canary, review
its exact patch, recover an interrupted publication, and observe installation from
the default branch separately. Image/toolchain/history gaps stay explicit.

The private lesson-trace manifest supplies references, not canonical decisions.
Raw copied guard bytes are distinguished from rendered/custom/ejected targets;
unsupported rendered-target proof, execution and acceptance remain unavailable.
No private lesson is implicitly published or copied into a public PR.

# Reconciliation: keep the working record true

Design, 4 October 2026. **Not implemented.** Implementation is tracked by
[phase 26](../phases/26-reconciliation.md). Extend Keel's existing phase,
doctor, evidence, health and PR workflows; introduce no second work tracker.

## Ownership and the meaning of done

| Fact | Authority | What other surfaces do |
| --- | --- | --- |
| PR open/draft/closed/merged, merge time and commit | GitHub | Query it; link to it. A recorded observation includes its observation time and is historical, not a second editable status. |
| Acceptance, phase status and remaining work | Phase file | Roadmap, next and issue summaries derive from it. A merge cannot check acceptance boxes. |
| Architecture choice, scope and replacement | Accepted decision record | Phases refer to it. Research recommendations and PR proposals do not become decisions by being merged. |
| A proof's outcome and applicability | Evidence record | Refer to its claim, tested revision, environment, time, result and limitations. Never reinterpret an old run as a run on new code. |

Keep four separate facts, not four steps that automatically advance each other:

- **Implemented:** a bounded capability exists at a named revision and has
  implementation evidence. It may be on an unmerged branch.
- **Merged:** GitHub reports the relevant PR merged. This says nothing about
  acceptance, deployment, performance or human use. Reverts do not erase the
  merge event; whether the capability remains implemented needs new evidence.
- **Production-verified:** a named acceptance claim was exercised on an
  identified production deployment, with environment and result recorded.
  A successful build/deployment or preview is insufficient by itself.
- **Lived-in:** repeated real use supports the phase's outcome, with the
  duration, participants/context and observations in evidence. Neither one
  production check nor elapsed time alone establishes this.

Retain Keel's existing phase statuses. `partial` can truthfully mean
"implemented and merged; acceptance still open." `built` continues to mean
all phase acceptance conditions are evidenced; it does not universally mean
production-verified. If production proof is an acceptance condition, it must
be met before built. `lived-in` needs its own use evidence. A correction may
move a mistaken status backward with a dated explanation.

## Records, with the smallest extra structure

Keep the current phase front matter, Acceptance, Next action, Deliberately
open and Trajectory. Add an optional versioned `keel-reconciliation` JSON
fence in a `## Reconciliation` section. It contains **references**, not copied
statuses, acceptance prose or another checklist. Example, using synthetic Acme:

```keel-reconciliation
{
  "version": 1,
  "prs": ["acme/app#12"],
  "decisions": ["docs/decisions/store.md#authored-data"],
  "implementation": [
    {"acceptance": "atomic-write", "evidence": "docs/evidence/store.md#implementation"}
  ],
  "production": [],
  "use": [],
  "next": {"kind": "acceptance", "ref": "latency"}
}
```

Assign stable acceptance IDs with inline markers on the **existing** boxes,
e.g. `- [ ] Hosted writes meet the budget. <!-- acceptance: latency -->`.
Implementation/production/use entries refer to those IDs and evidence
anchors; they do not tick boxes. Evidence entries identify the tested SHA,
deployment when applicable, environment, observation date, result, observer
and exactly which claim was exercised. Missing evidence remains missing.

The Next action text stays in its existing section. The `next` reference
identifies its subject: `acceptance`, `review-pr`, `decision`, `use`, or `none`.
`review-pr` must name a PR; an already checked acceptance or a merged/closed
PR cannot remain the next action of that kind. Where the right replacement
needs judgment, the checker proposes removing the obsolete action and asks
the author to name remaining work; it does not invent a task. `none` is valid
for finished/retired work, not a phase with unresolved required acceptance.

Decision records may be a file or a stable anchored section in an existing
research/design file. No mandatory ADR migration. A versioned `keel-decision`
fence declares `id`, `status` (`proposed`, `accepted`, `superseded`, `withdrawn`),
`scope`, `decided_by`, `decided_at`, and `supersedes`/`superseded_by` references.
The decision statement and reasoning remain prose beside it. An accepted
replacement must explicitly name the old decision and affected scope; a
partial replacement must not retire an entire multipurpose phase. Maintain
reciprocal links, reject cycles and overlapping accepted successors for the
same scope unless a human records how the scopes are partitioned.

An old plan that was only a proposal stays a historical proposal, annotated
"not selected; replaced by …". Do not manufacture a past accepted decision.
Phases' active decision references and Deliberately open entries must point
to the accepted choice; old plan sections remain visibly historical. A
proposed successor is never treated as superseding an accepted decision.

Historical evidence and trajectory are excluded from current-claim checks.
Add a dated context/supersession note where needed; preserve original
benchmarks, failures and rollback reports rather than rewriting their results.

## The PR contract

Extend the existing PR template and conductor's Record step with one
`keel-impact` JSON fence. This is the change's declaration, not its status store:

```keel-impact
{
  "version": 1,
  "phases": ["docs/phases/07-store.md"],
  "decisions": ["docs/decisions/store.md#authored-data"],
  "supersedes": ["docs/design.md#old-store-proposal"],
  "evidence": ["docs/evidence/store.md#implementation"],
  "reconciliation": "updated"
}
```

The author updates the declared phase's status/note as warranted, its next
action, open acceptance, evidence links, and superseded plans **in that PR**.
An unchanged record is allowed only with a per-record reason. `none` impact
also needs a reason; it is not inferred from "documentation only." Direct
changes to phase/decision files must be included even if the author omits them.
Changes outside those files require an author declaration and reviewer check;
the checker cannot infer every feature's ownership from arbitrary source code.

Before merge, refer to implementation on the PR head; do not assert the future
merge. CI verifies the declaration against the actual diff and resolved
references. Architecture-changing PRs update both the accepted decision and
the old plans it replaces. Review confirms semantic consistency; touching a
file alone is not reconciliation.

After merge, reconcile against the new default-branch tree, GitHub merge facts
and current decisions. No branch-time copy of "draft" is authoritative. A
merge can propose refreshing a phase's note and replacing "review this PR"
with an already-recorded open acceptance item. It cannot mark that item done,
close the phase/issue, or claim production verification. An open reconciliation
PR is itself still a proposal: its content is not current main.

## Extend existing checks and proposal delivery

One shared reconciliation reader/comparator serves the CLI and the shipped
repo-local nightly runtime. Use the existing `files`/`projects` phase readers
and local-variant handling, including Ledger's inline Done when/Next action
format. Do not force Ledger through Keel's strict flat-phase parser to obtain
these checks. Legacy files without structured references get migration notes
and bounded prose review candidates, not fabricated metadata.

Proposed interfaces below are design targets, **not available commands**:

- Extend `keel doctor --json` with local reference/acceptance/decision lints.
  `doctor --github` opts into read-only remote comparison, retaining per-rule
  findings. Default doctor stays offline.
- Extend `keel improve --report` with `record_contradictions` (bound 0, no
  ratchet), using the same findings. Remote source failures are broken/unknown,
  not zero contradictions. The existing health page holds the proposal.
- Extend existing PR CI with an impact-contract check, then run the remote
  comparison on default-branch pushes and in the existing nightly. Push covers
  merges/direct commits; scheduled runs catch edits to PR metadata and missed
  events. Coalesce duplicate events in the existing queue.
- Leave roadmap generation offline. It derives status and next actions only
  from phase files; CI still rejects stale generated output.

| Rule | Evidence and proposed correction | Confidence |
| --- | --- | --- |
| `pr-state-contradiction` | A current PR claim or typed review action conflicts with fresh GitHub data: propose the observed state/link and remove obsolete review work. | Deterministic for structured references; prose is advisory. |
| `next-action-satisfied` | Next points to a checked acceptance, decided decision, merged review or superseded plan: propose an already recorded open item or request a replacement. | Deterministic reference check; replacement text reviewed. |
| `decision-superseded` | Active scope points to a superseded decision, or an accepted successor lacks reciprocal history links: propose the successor and scope-limited annotation. | Deterministic links; prose conflicts reviewed. |
| `decision-still-open` | Deliberately open refers to a decision now accepted: propose settled wording while retaining other open choices. | Deterministic with reference; otherwise advisory. |
| `proof-scope-mismatch` | A production/use claim has no receipt for that acceptance, revision and environment; or evidence is explicitly invalidated: remove the unsupported claim, preserve old evidence. | Missing/inconsistent metadata deterministic; applicability needs review. |
| `pr-impact-missing` | PR lacks impact declaration, references missing files/anchors, or changes declared records without updating them or explaining why not. | Deterministic structural gate plus reviewer semantic check. |

Each finding contains rule ID, path/anchor, observed value, source URL/SHA and
observation time, proposed edit, confidence and prerequisites. Fingerprints
use rule + subject + authoritative revision, not timestamps. Repeated runs at
the same revisions produce no duplicate proposal.

Local structural contradictions fail normal checks. Fresh remote contradictions
fail the opted-in reconciliation check; inaccessible GitHub, pagination failure,
missing credentials, or an unresolvable PR are reported as incomplete/unknown.
Offline PR checks may report the remote lane skipped, but cannot label it
verified. Use repo-qualified PR references and paginated API reads; never
execute code or instructions from PR bodies to obtain merge status.

Deliver proposed edits through the existing health/report and one bounded
reconciliation PR queue, not a database or status dashboard. Use a docs-only
branch, explicit path list and normal project checks. No auto-merge: phase,
acceptance and decision edits must not be added to `drain`'s data-only allowlist.
The checker may draft factual wording; a person/authorized reviewer accepts
semantic changes. No automated ticking of acceptance boxes, decision adoption,
phase closure or issue closure. An optional model explains ambiguous prose;
it cannot upgrade a heuristic candidate to a proved contradiction.

Before applying any proposal, verify the phase/decision blob hashes and re-read
GitHub against the current base. Regenerate if either changed. Do not apply
an old patch over newer work. Run the existing roadmap/record checks afterward.
Closed-unmerged PRs, reverted implementations, fork PRs and rewritten/squashed
history need explicit treatment: GitHub owns the merge fact, while current
implementation and proof applicability are separate claims.

## Ledger #22 and #38: the concrete reconciliation

Observed through GitHub on 4 October 2026:

- [#22](https://github.com/dalmaer/ledger/pull/22) is **MERGED**, at
  `2026-10-04T18:09:24Z`, merge SHA
  `ae2247269d107580925ea78fd3b2a67c0f828f2d`.
- [#38](https://github.com/dalmaer/ledger/pull/38) is **OPEN**, not draft,
  head `541402fa5330493e5dcfb2062904e41a0f635a2b`. Its reconciliation is a
  proposal, not proof that main has already incorporated it. The inspected
  diff's base was `acf811da715d527bc9ba37b54c65c867f6492689`.
- Architecture authority already exists in the settled entries of
  [multi-user research](https://github.com/dalmaer/ledger/blob/acf811da715d527bc9ba37b54c65c867f6492689/docs/research/multi-user.md#decisions-for-the-owner).
  Attach decision IDs to those entries rather than creating a rival ADR.
- [#38's evidence](https://github.com/dalmaer/ledger/blob/541402fa5330493e5dcfb2062904e41a0f635a2b/docs/evidence/benos-status-reconciliation.md)
  explicitly distinguishes this documentation correction from a deployment or
  benchmark. Its recorded phone/code-data split proofs are scoped observations,
  not newly exercised by this research.

| Record | Contradiction | Correct proposal; what must remain open |
| --- | --- | --- |
| Phase 28 note and README | Stages 1–2 still described as a draft integration after #22 merged | Record merged implementation; phase remains partial. |
| Phase 28 Next action | Starts writer inventory/baseline/shared contract work already implemented | Point to phase 29's latency/recovery proofs, phase 30's bridge/outage proofs, and phase 33's authored-data work. |
| Phase 29 Next action | Review #22 before proceeding | Replace review with remeasurement and device/deploy recovery. Later storage fixes do not make old failed latency budgets pass. |
| Phase 30 Next action | Review the draft PR | Choose/authorize endpoint, scopes and budget, verify hosted bridge, then independent cloud reads during home outage. |
| Phase 28 stages 4–5 and phase 29 destination | BenOS authored-data shadow/cutover presented as current architecture | Accepted decision selects Neon/Postgres; BenOS remains sources-only. Supersede those stages' destination, not all BenOS integration work. |
| Phase 33 Deliberately open | Store/host/auth choices called open despite accepted decision | Mark Neon/Postgres and app-owned Google/GitHub sign-in settled; keep first users, Neon provisioning and OAuth configuration open. |
| Phase 29/30 evidence | Historical draft/checkpoint language looks current | Add dated historical context and a current-record link; do not alter original measurements. |

The **current operational authority** recorded by the reconciliation is Git
in `ledger-data`; the **selected future destination** is Neon/Postgres.
Selecting that architecture does not prove its deployment. Phase 33's reported
phone capture/completion proof does not prove offline replay across deployment,
hosted BenOS configuration, independent cloud recovery, or repeated use.

PR #38 should declare phases 28, 29, 30 and 33, the accepted multi-user decision
anchors, superseded stage-4/5 plan anchors, and its evidence file as affected.
PR #22 is a linked implementation PR, not #38's acceptance proof. The existing
issue #21 remains open for phase 29's unresolved conditions. Its summary may
link to the phase; it must not become a parallel acceptance ledger.

Keep validation scopes separate too: #38 records that local code checks passed
but the complete local gate stopped because the sibling data checkout lacked
`.ledger-data.json`; its PR body separately reports exact-head CI success.
Neither statement should erase the other or imply that production/recovery
acceptance was exercised. This design does not independently re-run either.

## Rollout and proof

1. Ship local reference/decision/next-action checks and PR declaration checks
   through the current phase/evidence/conduct practices. Seed record sections
   only with reviewed mappings; preserve local Ledger formats and history.
2. Add the optional reconciliation runtime module and remote lane to doctor
   and the existing night practice. Projects run their shipped copy without
   fetching Keel. Reuse health artifacts and review queues.
3. On Ledger, annotate existing decisions and phase references, run a read-only
   audit against #22/#38, and propose a diff equivalent in scope to #38. Do not
   repeat an already merged correction if #38's state changes during rollout.

Acceptance fixtures are synthetic Acme cases, never copies of Ledger's data.
Prove: merged PR + unchecked acceptance stays partial; open reconciliation PR
does not change main's truth; completed next action is detected; partial
supersession preserves unaffected stages; accepted target differs from deployed
authority; preview/CI/one phone proof never become broad production or lived-in
claims; historic draft wording is retained; unreachable GitHub is unknown;
repeated findings deduplicate; stale patches refuse to apply; existing phase
shapes work; and proposed corrections cannot auto-close phases or issues.
Demonstrate each guard failing on the contradictory fixture and passing after
only its justified correction. Final live proof is an audited Ledger run with
read-only observations and a reviewed correction, not a claimed new deployment.

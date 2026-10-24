---
status: partial
since: 2026-10-24
goal: G2
spec: 2
depends: [124]
note: "Source compatibility and two-direction mutation proof implemented; live workflow and label-receipt rollout awaits phases 128–129 and owner approval."
owes: walk
evidence: ["evidence/2026-10-24-content-name-transition.md"]
issue: 242
---

# Markers, fences, labels and artifacts are written as plates and parsed under both names

## Done when

Plates writes:
- `<!-- plates:… -->` markers;
- `plates:*` label names;
- the `plates-impact`, `plates-decision`, `plates-reconciliation`, `plates-proof` and `plates-measurements` fences;
- the `plates-test-runs`, `plates-production-<n>`, `plates-canvas-night`, `plates-canvas-card`, `plates-tend-page` and `plates-time-proposal(s)` artifacts.

Every parser and artifact reader accepts both names, so a merged PR body, an old issue and the last artifact of the old name all still read.

## Scope

The design is [Name transition](../specs/name-transition.md).

- **Markers:** health-report, morning, robot-state/data/note/continuation/review, cross-review, inconclusive, time-proposal, class and the rest (131 sites). Writers emit `plates:`, and every matcher accepts `(?:plates|keel):`. A body that holds both kinds of marker for the same block is read once, with the plates one first.
- **Labels in code:** every label plates applies or filters by (`keel:agent`, `keel:review-after`, `keel:morning`, `keel:wait-for-review`, `keel:owner`, the robot ones). Code applies the plates name and filters by either. **Renaming the labels on GitHub is phase 128's.** Until then, applying `plates:agent` creates it next to `keel:agent`, so this phase applies a label only once phase 128 has renamed it on that repository. Until then it keeps applying the keel name.
- **Fences:**
  - The impact check workflow and `review` accept `plates-impact` and `keel-impact` and the rest of the family.
  - PR templates, the night, integrate and the fleet's PR bodies write the plates fence.
  - A body with both is refused, naming both, because they could disagree.
- **Artifacts:** writers upload the plates name. Readers try the plates name first and the keel name second, for as long as the artifact's retention lasts (`retention-days`, 30 by default). For ledger, this includes its own Tests workflow: its upload of `keel-test-runs` is a project file and moves in phase 129.

## Acceptance

- [x] Every marker writer emits `plates:`, every matcher reads both, and a body holding both reads once. `tests/names-review-markers.test.mjs`, `tests/robot-runtime.test.mjs` and retained mutation observations; inventory-only held entries have no active writer
- [x] A merged PR body with `keel-impact` passes the impact check, a new body is written with `plates-impact`, and a body with both is refused. `tests/names-content.test.mjs` and `tests/reconciliation.test.mjs`
- [x] A label is applied under the plates name only where the repository's label rename is recorded, and filters match either name. `tests/names-labels.test.mjs`, `tests/names-label-consumers.test.mjs`, `tests/robot-issue.test.mjs` and `tests/review.test.mjs`
- [x] Each artifact reader finds the last keel-named artifact when no plates one exists, and prefers the plates one when both do. `tests/gate-reuse.test.mjs`, `tests/test-history.test.mjs`, `tests/canvas-night.test.mjs` and retained consumer mutation observations

- [ ] Observe actual workflow uploads/checks and committed label-rename receipts with current provider facts in the owner-approved rollout. ⚑ by hand: the owner, in phases 128–129; source tests do not establish this walk.

## Real surfaces

- workflow shell: the impact, cross-review, night and climb workflows' uploads and checks, run in phase 129.
- GitHub API: issue and PR bodies and labels read and written through `gh`.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/names.test.mjs tests/names-content.test.mjs tests/names-labels.test.mjs tests/names-label-consumers.test.mjs tests/names-review-markers.test.mjs tests/reconciliation.test.mjs tests/robot-runtime.test.mjs tests/robot-issue.test.mjs tests/review.test.mjs tests/gate-reuse.test.mjs tests/climb.test.mjs tests/canvas-snapshot.test.mjs tests/morning.test.mjs`; `npm run check`; `npm run typecheck`. Mutation-check every fallback in both directions: the same acceptance assertion must pass with both names and fail with either name removed. Preserve original and corrected observations separately. The morning suite retains phase 125's #218 outside-byte preservation proof under both wrapper names.

## Deliberately open

- **2026-10-24 — Proof names the existing consumers.** The original `impact.test.mjs`, `robot.test.mjs`, `gate.test.mjs` and `canvas.test.mjs` names do not exist. The command above names the reconciliation, robot-runtime/issue, gate-reuse and canvas-snapshot suites plus explicit transition tests. The owner requires every fallback, in both directions, rather than the original one-per-surface sampling. This corrects the proof command without weakening acceptance.

- **2026-10-24 — Label rename evidence travels with the repository.** Phase 128 records confirmed label-ID-preserving rename/readback in tracked `.plates/name-transition/label-renames.json`, so fresh CI checkouts see it. Each entry binds the repository ID and owner/repo, exact name-table row, original label ID, old/new names, original operation and verification timestamp. This is evidence of an approved operation, not permission to rename. Phase 126 validates those bindings before selecting a new writer. Missing evidence keeps the legacy selection only when it cannot create a duplicate; conflicting or uncertain evidence and a current-name label without its verified receipt refuse mutation. A later stale or conflicting provider observation also refuses rather than recreating the old label. Readers continue accepting both exact names.

- **Saved GitHub searches and filters** the owner keeps under `label:keel:…` stop finding new items once labels are renamed. Phase 128 lists them, and plates can't edit them.

## Next action

Publish the reviewed source, then complete phases 128–129: owner-approved label renames and committed receipts at the workflow revision, followed by actual workflow/API observations on Plates first and the fleet in order. Keep inventory-only held rows explicit. Do not infer production acceptance from merge.

## Trajectory

- **2026-10-24** — Label activation needs committed repository-bound rename/readback evidence plus fresh complete provider facts; a local receipt alone cannot activate CI. Standalone reconciliation installs the canonical library without introducing a second name table. See the phase evidence.
- **2026-10-24** — Metamorphic tests remaining green did not satisfy the owner's literal-red requirement. Separate baseline/mutant processes now retain 168 behavioral green/red pairs, including four initially uncovered orchestration groups; original setup and fixture failures remain excluded and preserved.

- **2026-10-24** — Standalone reconciliation now means the installed runtime pair, not a single copied file; the guide and spec were corrected before changing its proof. Dual-label queues keep the first current observation when a later legacy response conflicts.

- **2026-10-24** — Integration with #218 exposed a wrapper rename outside the finalized plan. Section edits preserve the existing wrapper and outside bytes; fresh full reports use current names. The expanded morning proof and four direct finalize mutations bring current fallback coverage to 172 pairs, with superseded observations retained.

- **2026-10-24** — Review exposed a lost implicit local repository target in morning delivery. Resolve it once and pin the same identity for reads, receipts and writes; missing discovery refuses without weakening label evidence. The regression is independently proven and affected fallback observations refreshed.

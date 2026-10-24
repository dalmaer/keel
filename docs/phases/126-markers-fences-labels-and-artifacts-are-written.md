---
status: planned
since: 2026-10-23
goal: G2
spec: 2
depends: [124]
note: "Specified 2026-10-23 (docs/specs/name-transition.md). The names plates writes into GitHub content: comment markers, label names in code, PR-body fences and CI artifacts. Written as plates, parsed under both, so every merged PR body and old issue still reads."
evidence: []
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

- [ ] Every marker writer emits `plates:`, every matcher reads both, and a body holding both reads once. `tests/names.test.mjs`: "markers are written as plates and parsed under both"
- [ ] A merged PR body with `keel-impact` passes the impact check, a new body is written with `plates-impact`, and a body with both is refused. `tests/impact.test.mjs`: "both fences read; both at once is refused"
- [ ] A label is applied under the plates name only where the repository's label rename is recorded, and filters match either name. `tests/robot.test.mjs` and `tests/review.test.mjs`: "labels follow the repository's rename"
- [ ] Each artifact reader finds the last keel-named artifact when no plates one exists, and prefers the plates one when both do. `tests/gate.test.mjs`, `tests/climb.test.mjs`, `tests/canvas.test.mjs`: "artifact read under both names"

## Real surfaces

- workflow shell: the impact, cross-review, night and climb workflows' uploads and checks, run in phase 129.
- GitHub API: issue and PR bodies and labels read and written through `gh`.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/names.test.mjs tests/impact.test.mjs tests/robot.test.mjs tests/review.test.mjs tests/gate.test.mjs tests/climb.test.mjs tests/canvas.test.mjs`; `npm run check`. Mutation-check one reader per surface.

## Deliberately open

- **Saved GitHub searches and filters** the owner keeps under `label:keel:…` stop finding new items once labels are renamed. Phase 128 lists them, and plates can't edit them.

## Next action

List every marker and fence matcher from the phase-124 table, and give each one a single shared parser from `names.mjs`, rather than its own regex.

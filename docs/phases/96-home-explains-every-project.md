---
status: planned
since: 2026-10-21
goal: G7
spec: 2
depends: [95]
note: "Authorized web workspace sequence; acceptance remains unverified."
evidence: []
---

# Home explains every project

## Done when

Authenticated Home shows decisions, ready walks, recent additions and project summaries that remain truthful and usable through incremental refresh and incomplete source reads.

## Scope

Implement bounded source adapters and versioned project/action view models; reuse board classification and planning variants. Render Home with stable IDs, source freshness, queued updates and deep links. Initial actions inspect/link out only. Use bounded authenticated polling with cursors, conditional reads, hidden-tab pause and backoff; no persistent function or in-memory refresh job is assumed.

Contract: [Private workspace, public Keel application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Local phases, projects-shaped plans and milestones retain their authority and source gaps: `tests/web-projects.test.mjs`.
- [ ] Home prioritizes decisions, ready walks and changes; refresh never mutates project records: `tests/web-home.test.mjs`.
- [ ] Incremental updates preserve active cards and report cursor gaps, denied access and partial coverage: `tests/web-events.test.mjs`.
- [ ] ⚑ By hand: desktop/mobile keyboard walkthrough identifies the next human action and an unavailable source on actual projects: `docs/guide/web-workspace-setup.md`.

## Real surfaces

- GitHub API: read selected real projects with bounded source coverage.
- Owner's machine: browser walkthrough at desktop and 360px, including keyboard and reduced motion.

## Proof

Named test paths are implementation targets until this phase is built, not
claims of existing checks or passing results.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-projects.test.mjs tests/web-home.test.mjs tests/web-events.test.mjs`
- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

A useful read-only Home can ship here; decision and walk buttons remain unavailable until their own write phases pass.

## Next action

Build the bounded read model before the Home renderer and incremental updates.

## Trajectory

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.

## Your part

### 1. Real use

- **Ask:** Desktop/mobile keyboard walkthrough identifies the next human action and an unavailable source on actual projects.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.

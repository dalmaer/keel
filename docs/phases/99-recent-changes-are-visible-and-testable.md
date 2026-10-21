---
status: partial
owes: walk
since: 2026-10-21
goal: G7
spec: 2
depends: [96, 98]
note: "Journal, private capture receipts and recovery implemented; hosted activation, provider proof and owner walk remain."
evidence: ["evidence/2026-10-21-web-visual-journal.md"]
---

# Recent changes are visible and testable

## Done when

Recent additions show authorized real captures, precise availability and links to the corresponding tested revision and guided walk without leaking private artifacts.

## Scope

Implement versioned change packages, bounded media ingestion/private delivery, captions/alt text and before/after comparisons; preserve capture provenance and expired/missing media states.

Implementation: [Visual changes and private captures](../specs/web-visual-journal.md).

Contract: [Private workspace, public Keel application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [x] Every user-facing UI change package includes relevant desktop/mobile captures, a preview/try link and exploration steps, or an explicit unavailability reason, plus source/revision and bounded media references: `tests/web-changes.test.mjs`.
- [x] Media routes deny cross-project access, traversal, executable uploads and unsafe remote fetches: `tests/web-media.test.mjs`.
- [x] Stale, missing and expired captures remain distinct from current serving evidence: `tests/web-changes.test.mjs`.
- [ ] ⚑ By hand: owner opens a real captured addition, tries its environment and reaches the matching walk using keyboard/mobile controls: `docs/guide/web-workspace-setup.md`.

## Real surfaces

- Owner's machine: capture and inspect a real product surface with approved data.
- GitHub API: resolve revision/source links for the displayed addition.

## Proof

Named test paths are implementation targets until this phase is built, not
claims of existing checks or passing results.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-changes.test.mjs tests/web-media.test.mjs`
- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

Retention duration is an owner setting with safe bounds. Public export remains separate and explicit.

## Next action

Obtain the fresh Vercel authenticator code for hosted migrations. Approve a private `keel-captures` bucket in the existing Supabase project, 90-day retention and a 256 MiB application cap; verify hosted storage/roles/concurrency and serving revision, then complete the owner captured-addition walk. No paid upgrade or public export is included.

## Trajectory

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.

- **2026-10-21** — Capture attachment requirements need a stable identity independent of display order or title. Stale captures retain original provenance separately from new requirements; source availability exposes observed and implementation revisions. The browser walk and independent review established these distinctions.

## Your part

### 1. Real use

- **Ask:** Owner opens a real captured addition, tries its environment and reaches the matching walk using keyboard/mobile controls.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.

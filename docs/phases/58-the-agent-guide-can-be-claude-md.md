---
status: partial
owes: walk
since: 2026-10-10
goal: G2
spec: 2
depends: []
note: "Implemented guide selection across adoption, rendering, updates, drift checks and migrations, preserving prose and safe symlink aliases. The real CLAUDE.md-only adoption and owner read remain owed."
evidence: ["evidence/2026-10-10-selected-guide.md"]
issue: 45
---

# The agent guide can be CLAUDE.md

## Done when

`keel adopt` on a project whose guide is CLAUDE.md (and no AGENTS.md) turns lessons and night on, with keel's blocks in CLAUDE.md, and creates no AGENTS.md; render, doctor and update treat that guide as they treat AGENTS.md; and one real project adopted this way keeps a single guide.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 1.

- **The guide**: `.keel/keel.json` `"guide": "CLAUDE.md"` (or any path), defaulting to AGENTS.md when present, else CLAUDE.md when present, else AGENTS.md (created, as today). Adopt records which it chose.
- **Every practice that names AGENTS.md** (agents-md, lessons, night, conduct, the skill doorway, doctor's block checks, `blocksSkipped`) reads the configured guide instead.
- **Never two guides**: adopt and update refuse to create AGENTS.md beside an existing CLAUDE.md unless the owner asks (`--guide AGENTS.md`).
- **A symlink is one guide**: AGENTS.md → CLAUDE.md (or the reverse) counts once.

## Acceptance

- [x] Adopt on a project with only CLAUDE.md: lessons and night are on, blocks land in CLAUDE.md, no AGENTS.md is created, and `.keel/keel.json` records `"guide": "CLAUDE.md"`. `tests/adopt.test.mjs`
- [x] render, doctor (blocks present, edited, skipped) and update read the configured guide; a symlinked pair counts as one guide. `tests/doctor.test.mjs`, `tests/update.test.mjs`
- [x] With both files present and no `guide`, adopt keeps AGENTS.md as today and says so. `tests/adopt.test.mjs`
- [ ] ⚑ by hand: one real project whose guide is CLAUDE.md is adopted, and the owner confirms it has one guide.

## Your part

- **Ask:** Adopt one project whose agent guide is CLAUDE.md, and check it still has just the one guide.
- **Why:** It proves keel fits projects that grew up with Claude Code without adding a second voice.
- **Look at:** The adoption PR's changes to CLAUDE.md.
- **Choices:** One guide, reads well | Too much keel in it
- **Takes:** 10 minutes.
- **Then:** One guide: the phase is built. Too much keel: keel's blocks move to a skill the guide points to, and this phase records it.
- **Ready when:** this is built and a CLAUDE.md project's owner agrees to adopt.

## Real surfaces

- Adopted project: one whose guide is CLAUDE.md.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/guide.test.mjs tests/adopt.test.mjs tests/doctor.test.mjs tests/update.test.mjs`; `npm run check`.
By hand: one real adoption.

## Deliberately open

- **Blocks in a long guide**: a 400-line CLAUDE.md is already a lot for an agent. Whether keel's blocks belong in it or in a skill it points to is settled by the first adoption.

## Next action

Name a CLAUDE.md-only pilot, adopt it with the reviewed CLI, and have its owner confirm the adoption diff keeps one useful guide (10 minutes).

## Trajectory

- **2026-10-10** — Guide identity includes the resolved in-repository destination and existing lock ownership. Moving block keys without that check would conceal drift or split a symlinked guide; conflicting owners are refused instead of silently migrated.

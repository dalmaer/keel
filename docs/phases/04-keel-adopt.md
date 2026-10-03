---
status: partial
since: 2026-10-02
goal: G2
depends: [3]
note: "adopt classifies each practice on/local/off and only adds; on temp clones of duo and ritmo it is +350/−0 and each project's gate stays green. The two real PRs wait on the owner's yes (duo is public)."
evidence: ["evidence/2026-10-02-adopt.md"]
---

# An existing project comes under keel without losing what is its own

## Done when

`keel adopt` on duo and on cajones produces a pull request a person merges, after which each project's own check passes and its `.keel/keel.json` names the practice version.

## Scope

Detect what a repo already has (phase files, a roadmap generator, lessons,
workflows, renovate, AGENTS.md sections) and map each to a practice. Existing
seeded content stays; existing hand-ports of managed files become proposals:
"yours differs from keel's here — keep yours (eject), take keel's, or send
yours upstream as a lesson". Phase metadata translation (duo's `issue`-only
front matter, ritmo's `milestone` → `goal`) is a migration, shown as a diff.

## Acceptance

- [x] A dry run lists, per file, adopt / keep-local / conflict, and changes nothing.
- [ ] duo adopted: its roadmap, lessons and workflows still pass; the PR is merged by its owner.
- [ ] cajones adopted, the same.
- [x] Every local difference from keel's managed version is either ejected or filed as a lesson — none silently overwritten.

## Proof

`node --test tests/adopt.test.mjs` against synthetic fixtures shaped like each project (fixtures are synthetic: "Acme"). Then the two real PRs, each with its CI run.

## Deliberately open

- ledger: it has the most local practice (Loop, parity, deploy watching). Adopt it after two simpler projects prove the boundary.
- isocan: learned from as a source; adopting it is Dimitri's call.

## Next action

⚑ With the owner's yes, for each of duo (public) and cajones (private): clone, `keel adopt`, push branch `keel/adopt`, `gh pr create` with `docs/keel-adoption.md` as the body; the owner merges.

## Trajectory

- **2026-10-02** — Adopt switches on only what a project already satisfies; the rest is a recorded local variant with a proposal (design §1a). On both real projects, phases, evidence and ci came out local, so convergence is phase 6's migrations, not adopt.
- **2026-10-02** — The project's gate is config (`check`), and every shipped instruction names it via `{{check}}`. Before that, ritmo's adopted conduct block told agents to run its syntax check as the whole suite.
- **2026-10-02** — A local variant meets another practice's `requires`, so conduct and lessons can be on beside a project's own phases.

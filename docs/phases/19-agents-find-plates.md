---
status: built
since: 2026-10-03
goal: G1
depends: [18]
note: "Every plates project carries a 144-word plates skill (with its .claude symlink) that says what plates is, how to install it, and to run plates --agent-help, with no verb list; a test holds it to that."
evidence: ["evidence/2026-10-03-doorway.md"]
---

# An agent in any plates project learns what plates is and where to start, unprompted

## Done when

Every project plates renders carries one short `plates` skill at `.agents/skills/plates/SKILL.md` (reached from Claude Code by symlink) that says what plates is, how to install it if missing, and "run `plates --agent-help`", and a test keeps it short and free of copied verb lists.

## Scope

isocan's doorway pattern: the skill is the door, and `plates --agent-help` is
the room. The skill carries no verb list and no CLI details, because those
would be a copy that ages (lessons 1 and 16). It is a managed file in the
`agents-md` practice, with a `.claude/skills/plates` symlink. Adopt and init
install it, and update reaches existing projects by re-rendering.

## Acceptance

- [x] A fresh `plates init` project has `.agents/skills/plates/SKILL.md`, with a valid `name` and `description` front matter, and the `.claude/skills/plates` symlink resolves to it.
- [x] A test fails if the skill grows past a word budget, or names any `plates` verb other than `--agent-help` and the install commands.
- [x] `plates doctor` treats a second copy of the plates skill like any other (second-copy lint).
- [x] plates itself carries it (render `--self`), and the README says agents find it.

## Proof

`node --test` on the touched test files; a fresh `plates init` project's tree;
`npm run check`.

## Deliberately open

- **Whether to publish it for `npx skills add dalmaer/plates`**, so that agents
  outside plates projects can find it too. Later, if wanted.

## Next action

None.

## Trajectory

*Nothing — the phase went as planned.*

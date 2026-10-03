---
status: planned
since: 2026-10-03
goal: G1
depends: [18]
note: "The owner said yes (3 Oct): an agent working in any keel project should learn it is one, and run keel --agent-help, without being told."
evidence: []
---

# An agent in any keel project learns what keel is and where to start, unprompted

## Done when

Every project keel renders carries one short `keel` skill at `.agents/skills/keel/SKILL.md` (reached from Claude Code by symlink) that says what keel is, how to install it if missing, and "run `keel --agent-help`", and a test keeps it short and free of copied verb lists.

## Scope

isocan's doorway pattern: the skill is the door, and `keel --agent-help` is
the room. The skill carries no verb list and no CLI details, because those
would be a copy that ages (lessons 1 and 16). It is a managed file in the
`agents-md` practice, with a `.claude/skills/keel` symlink. Adopt and init
install it, and update reaches existing projects by re-rendering.

## Acceptance

- [ ] A fresh `keel init` project has `.agents/skills/keel/SKILL.md`, with a valid `name` and `description` front matter, and the `.claude/skills/keel` symlink resolves to it.
- [ ] A test fails if the skill grows past a word budget, or names any `keel` verb other than `--agent-help` and the install commands.
- [ ] `keel doctor` treats a second copy of the keel skill like any other (second-copy lint).
- [ ] keel itself carries it (render `--self`), and the README says agents find it.

## Proof

`node --test` on the touched test files; a fresh `keel init` project's tree;
`npm run check`.

## Deliberately open

- **Whether to publish it for `npx skills add dalmaer/keel`**, so that agents
  outside keel projects can find it too. Later, if wanted.

## Next action

Write the skill text first: about 150 words, with the door and no room.

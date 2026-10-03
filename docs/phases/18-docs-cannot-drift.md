---
status: planned
since: 2026-10-03
goal: G0
depends: [16]
note: "Lesson 16: the README called built verbs 'planned' for eight phases. The owner asked for a lesson that keeps docs updated; a test is the only guard that holds."
evidence: []
---

# What keel tells people can't fall behind what keel does

## Done when

`npm run check` fails when the README's verb or practice tables disagree with the live verb registry or `practices/`, and the conduct skill's Record step names README and the agent guide.

## Scope

- **`tests/docs.test.mjs`.** It reads `lib/cli.mjs`'s registry and
  `practices/*/practice.json`, and checks the README both ways: every
  registered verb, and every practice, appears in its table; no table names
  one that doesn't exist; and no built verb is labelled planned or coming.
  Mutation-checked.
- **The conduct skill's Record step** (`practices/conduct`, rendered) gains
  one line: does this change what a person or an agent is told? If so,
  update README and the agent guide in the same commit.
- **The same guard for projects.** keel can't know a project's own feature
  list. So the `agents-md` practice's README states the rule, and doctor
  gets a lint that fires when the README is older than the newest built
  phase. That lint is informational and never fails the gate.

## Acceptance

- [ ] Removing a verb row from the README, adding a fake one, or writing "planned" beside a built verb each fails `npm run check`.
- [ ] Removing a practice row, or adding a fake one, fails it too.
- [ ] Conduct's rendered Record step has the docs line, in keel and in a fresh `keel init` project.
- [ ] On a project whose README is older than its newest built phase, `keel doctor` reports `readme-behind` without changing the exit code.

## Proof

`node --test tests/docs.test.mjs` with its mutations, `npm run check`, and a
`keel init` project's rendered SKILL.md.

## Deliberately open

- **Whether `readme-behind` should ever be a finding** (exit 1). It starts
  informational, because a README can be legitimately unchanged after a
  phase.

## Next action

After phase 16 commits, write `tests/docs.test.mjs` against the README as it
stands. It must pass now, and fail under each mutation.

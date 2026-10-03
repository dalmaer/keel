---
status: built
since: 2026-10-03
goal: G0
depends: [16]
note: "tests/docs.test.mjs checks the README's verb and practice tables against the code, both ways; its first run caught a missing practice row. Conduct's Record step asks about docs; doctor notes a README older than the newest built phase."
evidence: ["evidence/2026-10-03-docs.md"]
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

- [x] Removing a verb row from the README, adding a fake one, or writing "planned" beside a built verb each fails `npm run check`.
- [x] Removing a practice row, or adding a fake one, fails it too.
- [x] Conduct's rendered Record step has the docs line, in keel and in a fresh `keel init` project.
- [x] On a project whose README is older than its newest built phase, `keel doctor` reports `readme-behind` without changing the exit code.

## Proof

`node --test tests/docs.test.mjs` with its mutations, `npm run check`, and a
`keel init` project's rendered SKILL.md.

## Deliberately open

- **Whether `readme-behind` should ever be a finding** (exit 1). It starts
  informational, because a README can be legitimately unchanged after a
  phase.

## Next action

None.

## Trajectory

- **2026-10-03** — On its first run, the README check found that the practices table had never listed `base`. The README had been rewritten that same morning, by hand, from the registry, which shows why the guard has to be a test.

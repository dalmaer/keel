---
status: planned
since: 2026-10-16
goal: G0
spec: 2
depends: [62]
note: "Specified 2026-10-16: keel prove --mutate shows a fix's test fails for nearly-right versions of the fix, not only without it."
evidence: []
issue: 169
---

# A fix's test is shown to catch plausible wrong versions of the fix

## Done when

`keel prove --mutate` applies small mechanical mutations to the lines the fix changed and runs the named test against each; every mutation the test does not catch is reported as a survivor, and the proof's trailer records how many were caught.

## Scope

The design is [Verification: tests that tell right from plausibly wrong](../research/2026-10-16-verification.md), phase 84.

- **Mutations** (on the fix's added or changed lines only, in JavaScript and TypeScript): flip a comparison (`<`/`<=`/`>`/`>=`, `===`/`!==`), negate or drop a condition, swap `&&`/`||`, return early, change a numeric constant by one. Each is applied alone, on a scratch copy.
- **Run**: for each mutation, the named test (or `--name` pattern) runs once; red means caught, green means a survivor.
- **Report**: caught/total, and each survivor as file, line and the mutation, so the conductor can strengthen the test. `--trailer` adds `Mutants: <caught>/<total>` beside `Proven-by`.
- **Budget**: at most 40 mutants per proof, chosen evenly across the changed lines; a time limit per run.

Not in scope: mutating code outside the fix, or failing a commit for survivors (the conductor decides).

## Acceptance

- [ ] Each of the five mutations is applied to a fixture fix, alone, on a scratch copy; the real tree is never changed. `tests/prove-mutate.test.mjs`
- [ ] A strong test catches every mutant; a weak one leaves named survivors. `tests/prove-mutate.test.mjs`
- [ ] Only the fix's changed lines are mutated, at most 40, and each run is time-limited. `tests/prove-mutate.test.mjs`
- [ ] `--trailer` records `Mutants: caught/total`. `tests/prove-mutate.test.mjs`
- [ ] ⚑ by hand: the owner reads the survivors from one real fix and says whether they showed a real gap.

## Your part

- **Ask:** Read the survivors keel prove --mutate reports for one real fix commit.
- **Why:** It shows whether the check finds real holes in tests or just noise.
- **Look at:** the prove output in the next fix's PR.
- **Choices:** Real gaps | Noise
- **Takes:** 10 minutes.
- **Then:** Noise: the mutation set is narrowed.
- **Ready when:** this phase has shipped and a fix has been proven with it.

## Real surfaces

- Owner's machine: `keel prove --mutate` in a conductor session.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/prove-mutate.test.mjs`; `npm run check`.
By hand: one real fix's survivors.

## Deliberately open

- **Which mutations**: five to start; widened from real survivors.
- **Known limit**: a mutant that changes behaviour no test can observe (dead code, a log line) survives honestly; the report says so, it does not fail.

## Next action

Write the five mutators and the scratch-copy runner with `tests/prove-mutate.test.mjs`.

---
status: partial
owes: walk
waits: time
since: 2026-10-06
goal: G4
spec: 2
depends: [33, 35]
note: "Built: the hygiene job (picked first when a test is flaky; prove-steady N runs on one clean tree; timeout- or retry-only fixes refused; an issue when nothing is proven), the build-time job (output hashed, each change needs a harmless reason), a build_time night measure, and retirement after three closed PRs. Waits on a real hygiene night on keel and a build-time night on ledger."
evidence: ["evidence/2026-10-06-climb-hygiene-build.md"]
issue: 14
---

# A flaky test and a slower build are climbed the same way

## Done when

A climb night picks `hygiene` when the ledger names a flaky test and opens a PR that makes it pass reliably (its fix shown by the ledger over repeated runs on one clean tree) or files an issue saying why it could not; and a project that names a `build` command gets `build-time` PRs under the same protocol.

## Scope

The design is [Climb nights](../research/2026-10-06-climb-nights.md).

- **`hygiene`**: its number is the flaky count from phase 33's ledger. The
  brief: find the cause, never add a retry or a longer timeout as the fix
  (lesson 40's shape), and prove the fix by running the test N times on one
  clean tree with no failure. If the cause is not found within budget, it
  files an issue with the evidence instead of a PR.
- **`build-time`**: `"climb": { "build": "<command>" }` names the build; its
  number is that command's wall time. The protocol's guard adds: the build's
  output is byte-identical, or the brief must say why a difference is
  harmless and the PR names it for the person.
- `pick` ties them to the ledger's `flaky_tests` and to a `build_time`
  measure the night gains.

## Acceptance

- [x] `pick` chooses hygiene when the ledger names a flaky test, ahead of every other job. `tests/climb.test.mjs: "pick"`
- [x] The hygiene guard refuses a candidate whose diff only raises a timeout or adds a retry around the flaky test; mutation: removing that refusal fails the test. `tests/climb.test.mjs: "hygiene guard"`
- [x] `build-time`'s guard fails when the build output changes and the report names no reason. `tests/climb.test.mjs: "build guard"`
- [ ] ⚑ by hand: one real hygiene night on keel, the flaky test it targets named by the ledger, and its PR or issue read by the owner.

## Real surfaces

- Workflow shell: the climb workflow running both jobs on GitHub Actions.
- Adopted project: one project with a build (ledger's web build) runs build-time.

## Proof

- Automated: `node --test tests/climb.test.mjs`, with the mutation above.
- By hand: a hygiene night on keel; a build-time night on ledger.
- ⚑ The PRs (the owner merges); model spend within each project's budget.

## Deliberately open

- **What counts as harmless in a changed build output.** The person decides
  per PR at first; a rule only once a few have been read.

## Next action

With climb on for keel, the first night the ledger names a flaky test runs hygiene; read its PR or issue. A build-time night on ledger comes with phase 37's ledger climb.

## Trajectory

- **2026-10-06** — The hygiene check judges an in-place edit by what changed in the line: its first version passed `() =>` becoming `{ timeout: 9000 }, () =>`, because the removed line counted as a real change.
- **2026-10-06** — Hygiene is never picked by rotation, only when `flaky_tests` is outside, and then ahead of everything, even a broken measure.
- **2026-10-06** — A builder's regex with nested quantifiers over `\n` (`(?:\s+.+\n)*\s+`) backtracked catastrophically over a workflow's text and hung a test file at 100% CPU with no child process; caught and rewritten before landing.

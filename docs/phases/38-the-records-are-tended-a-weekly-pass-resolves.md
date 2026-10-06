---
status: planned
since: 2026-10-06
goal: G4
spec: 2
depends: [26, 32, 33, 35, 39]
note: "A third pass beside measure and climb: an agent resolves the night's record findings (lost proofs, reconciliation's proposals, stale next actions, docs behind code, drift, loose ends) in one weekly PR a person merges. Never writes evidence, never deletes. Design: research/2026-10-06-tend-pass.md."
evidence: []
issue: 16
---

# The records are tended: a weekly pass resolves what the night found, and a person merges it

## Done when

On keel and one adopted project, a scheduled tend pass has read the night's record findings and opened one `keel-tend/<date>` PR that resolves them (corrections applied, lost proofs repaired or proposed back to partial, docs brought in line, drift and loose ends described for the owner to choose), the owner has merged it, and the next night's record findings fell to what the PR left, each of those named on the health page with what was tried.

## Scope

The design is [The tend pass](../research/2026-10-06-tend-pass.md).

- **A pass, not a climb job**: the `climb` practice's workflow and rights
  (its own prefix, never `main`, never a merge, a budget), with its own
  brief, `.agents/climb/TEND.md`, and its own schedule (`"tend": { "schedule": "weekly", "budget": { "minutes": N } }`).
- **Reads** (deterministic, from the night): `proofs_hold` (phase 32),
  reconciliation's proposals (phase 26, when on), `roadmap_stale`,
  `phases_stuck`, `evidence_placeholders`, `drift`, `lint`, and loose-ends.
  `scripts/keel/climb.mjs tend-input` gathers them into one worksheet.
- **May**: apply reconciliation's corrections; refresh a next action whose
  step is done; repair a renamed test reference (the ledger shows the new
  name ran); bring README and agent-facing text in line with the code it
  cites.
- **May only propose**: stepping a phase back to partial; keep, restore or
  send home for a drifted file; closing a merged branch or abandoned PR.
- **May never**: write evidence; mark built, lived-in or accepted; delete a
  branch, PR or data; merge.
- **Its PR body** comes from `scripts/keel/pr-body.mjs` (phase 39): Summary, Evidence (the before-and-after), Merge danger.
- **Unresolved findings** stay on the health page with what tend tried.

## Acceptance

- [ ] `climb.mjs tend-input` gathers every record measure into one worksheet and is n/a, not empty, for a measure that could not run. `tests/climb.test.mjs: "tend input"`
- [ ] A tend PR that adds or edits an evidence file, or changes a phase's status to built, lived-in or accepted, is refused by the guard; mutation: removing the refusal fails the test. `tests/climb.test.mjs: "tend guard"`
- [ ] The tend workflow has the climb workflow's rights only (its prefix, no merge, no delete), checked by the workflows test, and its shell passes `bash -n` and `node --check`. `tests/workflows.test.mjs`
- [ ] With no `tend` key, nothing runs; with no secret, it ends green with a notice. `tests/climb.test.mjs: "tend off"`
- [ ] ⚑ by hand: one tend PR on keel and one on an adopted project, each read and merged (or closed with a reason) by the owner, and the next night's record findings checked against it.

## Real surfaces

- Workflow shell: the tend run on GitHub Actions.
- GitHub API: its PR on its own prefix.
- Adopted project: one project (ledger, with reconciliation off: tend must work from the night's measures alone).

## Proof

- Automated: `node --test tests/climb.test.mjs tests/workflows.test.mjs`, with the mutation above.
- By hand: the two tend PRs and the following nights' health pages.
- ⚑ Model spend each scheduled week, within the budget the owner sets; the PRs (the owner merges).

## Deliberately open

- **Weekly or nightly.** Weekly, so the PR is worth reading; nightly only if
  findings pile up faster than a week.
- **Tending projects that keep phases per project (isocan's shape).** Read-only
  in keel today (phase 27); tend proposes there, edits only once that shape
  is writable.

## Next action

Blocked on phases 32 (`proofs_hold`), 33 (the ledger) and 35 (the climb workflow it shares).

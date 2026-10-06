---
status: partial
since: 2026-10-06
goal: G4
spec: 2
depends: [26, 32, 33, 35, 39]
note: "Built: keel-tend.yml (weekly, its own prefix and budget), tend.mjs (tend-pick, tend-input re-running the record measures, tend-note, tend-report), the tend guard (no evidence, no status to built/lived-in/accepted, no ticked box, no deleted file), and a Tend line on the night. Waits on the owner turning tend on with a budget, a working Claude secret, and the two real tend PRs."
evidence: ["evidence/2026-10-06-tend.md"]
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

- [x] `climb.mjs tend-input` gathers every record measure into one worksheet and is n/a, not empty, for a measure that could not run. `tests/climb.test.mjs: "tend input"`
- [x] A tend PR that adds or edits an evidence file, or changes a phase's status to built, lived-in or accepted, is refused by the guard; mutation: removing the refusal fails the test. `tests/climb.test.mjs: "tend guard"`
- [x] The tend workflow has the climb workflow's rights only (its prefix, no merge, no delete), checked by the workflows test, and its shell passes `bash -n` and `node --check`. `tests/workflows.test.mjs`
- [x] With no `tend` key, nothing runs; with no secret, it ends green with a notice. `tests/climb.test.mjs: "tend off"`
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

⚑ Owner: a working Claude secret on keel (the first climb run's agent failed to start), then `"tend": {"schedule": "weekly", "budget": {"minutes": 30}}` in keel's config; read its first PR.

## Trajectory

- **2026-10-06** — Built while phases 32, 33, 35 and 39 were partial: each waits only on an adopted project's update at the fleet release, and every capability tend reads exists.
- **2026-10-06** — Tend is its own workflow (keel-tend.yml, `keel-tend/`), not a climb job, so a person sees and runs each pass on its own; the code lives in the climb practice, which it shares rights and budget with.
- **2026-10-06** — On keel itself the first worksheet found no record findings (every record measure 0); its loose ends were this session's uncommitted files, two ⚑ phases and seven repos missing from fleet.json.

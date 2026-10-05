# Reconcile the working record

Enable with `keel adopt --with reconciliation`. For a new project use
`keel init <dir> --description "<paragraph>" --with reconciliation`.
Existing PR templates are preserved: copy the impact section from
`docs/templates/reconciliation.md` into your template when needed.

`keel doctor --json` checks local references. `keel doctor --github --json`
also compares read-only GitHub observations. The installed runtime is
`node scripts/keel/reconcile.mjs --json` (add `--github` for remote comparison).
Exit 0 means clean, 1 findings, 2 incomplete/broken. Missing remote facts are
unknown, never evidence that the record is clean.

The existing managed check workflow runs local checks, and on pull requests
runs `node scripts/keel/reconcile.mjs --event "$GITHUB_EVENT_PATH" --json`.
It checks the actual base/head diff and the PR body. Default-branch pushes
compare remote facts. Existing local CI workflows are preserved on adoption:
add these steps to yours, using checkout with full history and only contents
and pull-requests read permissions. Use `pull_request`, never privileged fork
execution through `pull_request_target`. The existing night dynamically loads
the same installed runtime; no central fetch or npm dependency is needed.
`keel improve --report` includes `record_contradictions` (bound 0, no ratchet).
The health page retains findings, unknown observations and manual proposals.

Keep each phase format, including inline Next action sections. Add stable
`<!-- acceptance: id -->` markers to existing boxes and a version 1
`keel-reconciliation` fence under `## Reconciliation`. Start from
`docs/templates/reconciliation.md`. References do not duplicate status.
Decision references name an anchored accepted record with a `keel-decision`
fence, scoped reciprocal supersession links, `decided_by` and `decided_at`.
In research/design, mark real decision sections with explicit HTML anchors
(`<a id="store-choice"></a>`). Evidence references require `keel-proof` receipts;
the template lists their fields. Research samples
are not decisions. Keep historical measurements and trajectory unchanged.

PRs declare affected phases, decisions, superseded plans and evidence in one
`keel-impact` fence. Update the records in that PR or give an explicit reason
for each unchanged record in `unchanged: {"docs/phases/01-store.md": "reason"}`. A declaration of no impact also needs a reason.
Directly edited records cannot be omitted. Review meaning as well as file
changes. Implementation, merge, production verification and lived-in use have
separate evidence; a merge never completes unchecked acceptance.

Corrections are manual proposals, identified by stable fingerprints with
source observations and expected blob hashes. Re-run the comparison and use
the runtime export `verifyProposal` before applying a saved proposal; changed
records or remote facts invalidate it. The engine never applies a patch.
Health reports can pass through the existing data queue; phase, decision,
research, design and evidence corrections require human review.

Generated night, Loop, and practice-update PR bodies include explicit no-impact
reasons for their data/infrastructure changes. Managed Renovate configuration
adds the same contract through `prBodyNotes` for dependency updates. If a
migration, custom Loop step, or dependency change edits actual records, replace
that declaration with the affected references and review the reconciliation;
the diff check grants no exemption for bots. Existing open PRs and local bot
configurations are not rewritten: add the declaration to their bodies/configs.

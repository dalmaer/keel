# Evidence: phase 117 — frozen evaluation records

- Date: 23 October 2026 (America/Denver); owner-machine observation
  `2026-10-24T00:34:15.446Z`.
- Phase: [117](../phases/117-evaluation-records.md).
- Revision: `9182f260f629ea9881eaf16543c713c36ed999cf` plus the phase 117 working
  tree, committed as **phase 117: Freeze harness evaluation inputs and extend the experiment ledger**.
- Claim: strict local input records and immutable private freeze/inspect work;
  schema-1 handoff behavior is preserved. No model or evaluator was executed.
- Builder: Ramanujan; conductor independently reviewed the code, tests and CLI walk.
- Decision context: `not-configured`, no accepted decisions/proposals/gaps;
  digest `c49aecb2378bc8d876f288691d861eea4b6ca67b67c7b1e36fa64e68ae377378`.
  This is legacy behavior, not verified decision coverage.

## Automated checks

Commands ran from the isolated Plates checkout with `PATH=/opt/homebrew/bin:$PATH`
and `TZ=UTC` for tests. The runtime was Node 26.12.1 on the owner's Mac.

| Command | Observation | Scope |
| --- | --- | --- |
| `npm run check:focused -- tests/evaluation-records.test.mjs` | Conductor exit 0; 118 tests, zero failures; convention stages passed | Records, real CLI, guards and associated conventions |
| `npm run check:focused -- tests/evaluation-records.test.mjs tests/session-trials.test.mjs` | Builder exit 0; 149 tests, zero failures; retained `/tmp/plates-phase117-focused-complete.log` | Includes unchanged handoff compatibility |
| `git diff --check` | Exit 0 | Whitespace only |
| `node /tmp/plates-phase117-walk.mjs /Users/dionalmaer/.codex/worktrees/reconcile-validation-night/plates` | Conductor exit 0, 12 operations passed | Actual CLI on fresh external private storage |

The [walk source](2026-10-23-evaluation-records-walk.mjs) is retained byte-for-byte;
it can be rerun with the source root as its sole argument. It deliberately uses
an Acme fixture with synthetic identities, not an executable historical case.
The full gate runs after this record: `npm run check` (all tests, roadmap,
render and inbox), and `npm run typecheck` (the repository's selected contracts).
Their results belong to the implementation commit and CI, not an invented result
in this pre-gate record. New record validators are runtime checks, not a claim
that all new modules are in the selected JSDoc typecheck scope.

Named negative proofs in `tests/evaluation-records.test.mjs` cover malformed
nested fields, moving identities, missing references, automatic application,
private acceptance bytes in context/overlays, retention failure before writes,
stale approval, foreign destination, ownership mismatch, symlink/locked/partial
state, attachment corruption and two real CLI writers. Tests exercise actual
validators and storage, not a fake passing executor. Initial guide/catalogue
coverage failures during development were corrected; they were not hidden by a
retry. No adjacent production behavior was changed.

## Owner-machine walk

Fresh retained fixture root:
`/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/plates-phase117-owner-E6JH6I`.
The root contains synthetic input bytes, separate initialized state and
`walk.json` with exact CLI arguments, exit codes and responses. Temporary storage
may expire; the source and identities below remain evidence, not a promise of
permanent availability of that machine's temporary files.

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Initialize explicit Acme workspace, then plan and preview freeze | Exits 0/0/3; state tree unchanged after both previews | Read-only preview; no authority or execution admission |
| Change raw bundle bytes; replay preview at another initialized destination | Both exit 2; destination state unchanged | Exact bytes and destination bind approval |
| Apply reviewed freeze, retry identically, inspect | Exits 0; original retained bytes unchanged on retry | Immutable original receipt recovery |
| Request `run` | Exit 2; no writes | Future execution is unavailable, not a simulated pass |
| Alter fixture ownership marker and ledger bytes | Each inspect exits 2 | Foreign/corrupt records refuse; only synthetic probe bytes were restored |

Frozen plan approval digest:
`21eee28dcee272181e5e56634efa1789d8cf9d82c9220021d87c8deb04367070`.
Receipt digest:
`a9d99cae842637960f1f965b4cab5e189025021b0f2fa2597f72741d3a4c627b`.
Receipt path relative to that root:
`state/session-trials/acme-comparison/state.json`.

## Gaps and decision

Supports built record mechanics once the final gate passes. Does not establish
container isolation, independent task scoring, a verified model/tool/image,
paired outcomes, held-out generalization, production adoption or lived-in value.
Unknown currency remains null and no spend is reserved. Frozen receipts are
private controller-owned records, not signatures against a malicious host owner.
Explicit paths must be canonical; the synthetic walk resolves macOS temporary
path aliases before invocation. Partial writes refuse instead of being reset;
future execution recovery remains phase 119's responsibility. Hosted capability
metadata describes these local commands as limited; no web execution is activated.

# Evidence: phase 107 — one operating experience, with bounded night controls

- Date: 22 October 2026 UTC.
- Phase: [107](../phases/107-mobile-and-desktop-cover-keel-operations.md).
- Revision: `32902b4c750be5c809b74e382d1d17c8a162f7a5` plus the working tree
  committed as `phase 107: Mobile and desktop cover Keel operations`.
- Claim: actual CLI coverage, shared scoped navigation, encrypted typed drafts,
  canonical plan publication and registered native night retry have local proof.
  This is implementation evidence, not deployed, provider or owner acceptance.
- Decision context: `not-configured`, empty decisions/proposals/gaps; final
  proof-context digest `5f775e9b4aa2bf8ddfc2c55ab912eb84dbb76d1a4cad8298ea05619956127be9`.
  Legacy behavior does not establish verified architecture coverage. Phase claim
  was rechecked as mine/here before builder resumes. Subsequent phase status edits
  change the source digest, not the settled adapter choices.

## Automated checks

Conductor executed, exit 0, **85/85**:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/web-operation-coverage.test.mjs tests/web-responsive.test.mjs tests/web-editor-drafts.test.mjs tests/web-recovery.test.mjs tests/web-night-plan.test.mjs tests/web-night-retry.test.mjs tests/web-night-retry-migrations.test.mjs tests/web-night-ui.test.mjs
```

The coverage audit enumerates 97 task rows, 46 dispatcher entries, 88 CLI forms,
359 argument rows and 22 installed routine entrypoints among 46 installed scripts.
The reviewed parser/dependency boundary contains 128 files. These are dated
measurements, not future constants. Tests mutate temporary parser copies and
check drift; project-owned forwarded grammar stays explicitly unknown.

Route/client checks exercise authenticated scope, safe sign-in return, lens
switching, original receipt identity, typed draft CAS, lost-save readback, expiry,
capacity, access-denial clearing, no mutation replay, exact public publication
acknowledgment and one retry POST. Synthetic transports do not prove provider
behavior. Focused peer checks covered the other affected domain UI tests; the
full integrated gate below covers their combination.

Conductor executed these retained scripts against actual SQL using separately
installed **PGlite 0.5.11**, each exit 0:

```sh
# KEEL_SQL_PROOF_MODULE is an absolute path to the separately installed module.
node docs/evidence/2026-10-22-editor-drafts-sql-proof.mjs
node docs/evidence/2026-10-22-night-plan-sql-proof.mjs
node docs/evidence/2026-10-22-night-retry-sql-proof.mjs
```

- [Draft SQL proof](2026-10-22-editor-drafts-sql-proof.mjs): role/RLS denial,
  generation CAS, lost-save identity, expiry without stale resurrection, abandoned
  metadata collection, 1,000-row and 50 MiB encrypted-payload caps.
- [Plan SQL proof](2026-10-22-night-plan-sql-proof.mjs): actual SQL004 with service
  orchestration, one send grant under overlapping promises, lost synthetic
  provider response and recovery of the original commit without another POST.
- [Retry SQL proof](2026-10-22-night-retry-sql-proof.mjs): role isolation, shared
  charges and project lanes in both directions, duplicate reservations, single
  send grant, malformed observation refusal, accepted-only settlement, uncertain
  charge retention and prepared expiry fencing. Repeating SQL013 preserves the
  delegate and live receipt; replaying 009/010 refuses without losing its charge
  or project lane.

These use one database connection. Overlapping JavaScript promises are **not**
independent PostgreSQL connections. Hosted role, race and recovery proof remains
required before activation.

| Migration | SHA256 checked |
| --- | --- |
| 009 | `59c353153dad95d1515589b863e91dfc51a14b3f4e4d19cb9ec4395b909ac711` |
| 010 | `b8d310624b5fc0347ecc7a3f1c3503a09e772861128d047e23b981e7645ec68f` |
| 012 | `42d8e7528825fd1322c20b2c1f123bb85ff9be8b2b2f9ac819742fcb69b361bc` |
| 013 | `f0e9eac274f0f8d7deac9d17cd3e8df8c609c6badc6df1d17ff9c90eafb26856` |

Corrections were reproduced before repair: denial retained dirty/unload guards;
near-limit plan previews duplicated content beyond the durable store bound;
stale preview allowances admitted a retry after an allowance reduction; repeated
SQL013 failed and replaying SQL010 bypassed shared admission. The final focused
and actual-SQL checks assert their corrected boundaries. No retry-until-green
was used to dismiss these failures.

The whole gate runs after this record through `keel integrate`: `npm run check`
(tests, roadmap, render and inbox guards). `keel ready --check "npm run typecheck"`
checks the selected production JSDoc scope before handoff. Their result belongs
to the integration receipt and subsequent record; no result is anticipated here.

## Integration finding

The first full gate on `f7ce43f` reported **2,567/2,568 passing**, with the
extracted npm-package HTTP launch failing. `night-plan-model.mjs` imported the
canonical assembled `scripts/keel/climb.mjs`, which existed in the checkout but
was absent from the package. This is a packaging defect, not a flaky test; it
was corrected by packaging the public assembled `scripts/keel/*.mjs` closure
(39 modules, 1,190,536 unpacked bytes). No copied policy implementation or runtime
dependency was introduced. The conductor reran the exact extracted-package test:
1/1, exit 0. The full gate must run again before landing. The exact failing
check is `tests/web-server.test.mjs`, “extracted npm package launches with external
config and serves through the real HTTP boundary”. All eight pinned stall checks
passed in the first gate; its ledger reported no flaky or slower test. No code
landed from that failed integration.

## Browser observations

Actual local authenticated application with synthetic Acme external transports;
no live GitHub mutation, model request or hosted migration. First-slice demo
used disposable actual SQL001/004/005/012. Night demo used real service/adapters
and in-memory provider/RPC fixtures. These are separate fixtures, not evidence
that one real repository meets both source profiles.

| Observed | Proves / does not prove |
| --- | --- |
| Catalogue rendered at 1280 and 390 pixels without horizontal overflow; project menu exposed 13 scoped links; project→fleet retained the applicable search. | Earlier first-slice navigation/render observation, not final complete keyboard coverage. |
| Model editor saved phase/file/text selection through actual SQL012; another tab showed Saved draft available. Exactly one save POST and zero model requests. | Confirmed save and discovery; Load/reload interaction was not completed. |
| Final native retry inspection rendered at 1280 and 390 pixels; mobile scroll width equalled 390. | Visible actor, attempt, allowance and declared effects; no approval was clicked successfully. |
| Final Daily upcoming-plan screen rendered at 1280 and 360 pixels; mobile scroll width equalled 360. Draft controls appeared beside the editor with disabled storage explicitly stated. | Real layout and truthful upcoming seed; publication interaction unverified. |
| Mac inventory reported locked host; browser input/clicks failed to change even the local demo menu while direct navigation and reads worked. | Concrete browser-control blocker. Not classified as an application defect or passing interaction proof. |

[Visual tour](../guide/web-tour.md) links earlier dated galleries and the four new
[phase 107 captures](2026-10-22-web-operations/night-retry-desktop.png). Screenshots
are observations of rendered code, not generated mockups.

## Remaining walk and activation

Phase is **partial, owes walk**. Required bounded adapters are implemented;
the two automated acceptance boxes are checked against their named tests. The
real-surface acceptance remains unchecked, including browser interactions that
could not be completed. Keep these separate:

1. Finish actual-browser keyboard, focus, 200% zoom, color scheme/reduced motion,
   saved-draft Load/reload, expiry and reconnect before/after accepted writes.
   Recover original receipts and count writes. The locked/input-blocked host
   prevented completing that walk.
2. Apply only separately approved feature migrations and grants. SQL012 private
   drafts and SQL013 shared night admission remain inactive. Verify actual hosted
   roles and independent-connection races, including old-migration refusal.
3. Deploy the checked revision using the required patched Node runtime. Existing
   production remains an earlier build; pushing main does not deploy it.
4. Review a real eligible canonical night profile and its complete command/source
   boundary, effects and 60-minute shared allowance. Do not use Keel's mothership
   workflow as though it were an eligible adopted-project night. Inspect a failed
   original attempt, approve one bounded retry, recover the original receipt and
   record actual provider behavior/cost. No such run is authorized by this record.
5. Publish a reviewed plan on an existing canonical branch, verify the immutable
   source commit and subsequent consumption separately. Policy on the default
   branch is rechecked but is not atomic with the plan-branch commit condition.
6. Owner completes the same fleet/project tasks on physical mobile and desktop,
   with decisions, a guided test, activity, learning, update and capacity routing.
   Record terminal detours and unavailable coverage, not inferred success.

General shell execution, unregistered/arbitrary night reruns, robot build/review
execution, missing plan-branch bootstrap and subscription-model execution remain
explicit limitations. A catalogue entry does not satisfy execution acceptance.
The later repeated-use phase must retain those gaps and needs the owner's fleet,
observation window, resource choices and real observations.

## Integrated result

The corrected phase landed on main at
`24728f21a76988a3be2acba75cb3b96a0c951e23` (implementation `f7ce43f`, packaging
repair `04fe751`). The second integration ran one full gate and exited 0:
**2,568/2,568 tests**, all eight pinned stall checks, roadmap, 89 render targets and
inbox guards passed. The ledger reported no flaky or slower test, with the one
busy run omitted from timing comparisons. `npm run typecheck` exited 0 through
ready. The first failed gate and its packaging correction remain recorded above.

Claim107 was released after landing. This does not deploy the application or
activate any hosted feature. Implementation/review ran from 02:33:50 to 03:59:54
UTC, followed by final integration completed before 04:13:10 UTC. CI on the exact
main revision is recorded separately once completed; local integration is not CI.

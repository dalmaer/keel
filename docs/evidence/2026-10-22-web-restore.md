# Evidence: phase 101 — serving identity and restore admission

- Date: 22 October 2026 UTC.
- Phase: [101](../phases/101-the-workspace-holds-in-real-use.md).
- Revision: `8bcde09faa271ea0553c6c2e2df079865b08daeb` plus the working tree
  committed as `phase 101: The workspace holds in real use`.
- Claim checked: authenticated serving observations, restored authorization
  invalidation and quarantine of business operations have local implementation
  proof. The phase's real owner-use and backup acceptance remain open.
- Decision context: `not-configured`, no accepted decisions, proposals or gaps;
  digest `46428ac1b1f3f89634c1cfe0ee5abc8be75805eba289143edfd30af9e757f49d`.
  Claim ownership was rechecked as mine/here before the builder resumed. This
  legacy context is not verified architecture coverage.

## Automated checks

Conductor executed, exit **0**, **24/24**:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/web-deployment.test.mjs tests/web-restore.test.mjs tests/web-auth.test.mjs tests/web-server.test.mjs
```

The checks exercise actual service routing, validated/missing revision bindings,
fresh membership/repository denial, private cache headers, exact configuration,
session and callback epochs, callback/renewal/worker authorization races, fresh
login/sign-out and every business route family including unknown routes and
receipt GET recovery. The packaged HTTP server launches from its extracted npm
package. Synthetic provider transports do not establish live GitHub behavior.

After adding the missing-source assertion, the conductor reran
`node --import ./tests/helpers/hermetic.mjs --test tests/web-restore.test.mjs`,
exit **0**, **7/7**.

The serialized-state restore check uses a fresh service and restores original
encrypted records. Old sessions and pending login attempts fail before token
exchange; a later restore also invalidates a previous restore's sessions.
Quarantine leaves operation state unchanged and never enters a provider handler.
After an explicitly synthetic operator audit assertion, missing source history
stays uncertain; exact original source evidence can establish the commit without
a second write, with acceptance still `not-established`.

The conductor also executed the retained [actual SQL restore proof](2026-10-22-workspace-restore-sql-proof.mjs),
exit **0**, using separately installed **PGlite 0.5.11**:

```sh
# Set KEEL_SQL_PROOF_MODULE to the absolute separately installed PGlite module.
node docs/evidence/2026-10-22-workspace-restore-sql-proof.mjs
```

This applies the actual SQL001/004 migrations, writes through their service-role
RPCs, serializes a logical snapshot and inserts it into a separate fresh database.
Ciphertext and operation metadata survive unchanged. HTTP quarantine preserves
the uncertain operation. Explicit trusted operator inspection outside that HTTP
boundary preserves an unknown outcome, then finds the original synthetic commit
without replay. Reopening with the same permanent epoch still rejects the old
session. There is one connection per database: no hosted concurrency, backup
completeness, storage-object recovery or provider-history coverage is claimed.

Independent review found no actionable findings and ran the two named test files
successfully. Additional reviewer probes checked session creation/renewal epoch
races. The conductor read the new tests and ran the proof independently.

The whole gate runs after this record through `keel integrate`: `npm run check`
(tests, roadmap, render and inbox guards). `keel ready --check "npm run typecheck"`
runs the selected production JSDoc contract check. Gate outcomes belong in the
integration receipt and subsequent record; no result is anticipated here.

## Browser observations

Actual in-app browser renders of the service's synthetic Acme recovery page:

| Did | Expected | Observed | Scope |
| --- | --- | --- | --- |
| Open recovery at 390 × 844 | Readable status with no horizontal overflow | Document width 390; state and deployment sections visible | Mobile-width rendering, not a physical-device walk |
| Open recovery at 1280 × 900 | Readable desktop layout | Document width 1280; both sections and sign-out present | Desktop rendering |
| Inspect the page and save full-page captures | No completion action or private token shown | Operator assertions, absent reconciliation, preserved-epoch instruction and explicit limits displayed | Synthetic rendering only |
| Exercise real keyboard/touch/sign-out in browser | Navigation and session ending on an owner's device | Not run; prior browser input transport was blocked by the locked Mac | HTTP sign-out is tested; physical input remains open |

[Desktop capture](2026-10-22-web-restore/recovery-desktop.png) ·
[Mobile capture](2026-10-22-web-restore/recovery-mobile.png).
The preview bridge injected a synthetic test session; this is not browser OAuth
proof. Its first request failed the application's origin guard because the bridge
forwarded the localhost Host header. Correcting only that scratch bridge produced
the observed page; the production guard was not weakened. Temporary server and
tab were closed, and viewport override was reset.

## Gaps and decision

**Partial, owes owner walk.** Local implementation is complete. The real backup
destination, isolated restore target, participants, projects and observation
window are still unselected. No live restore, new cloud resource, migration or
deployment was performed here. Old production remains a separate serving
revision until a verified deployment is completed.

Use the [private recovery and trial worksheet](../guide/web-recovery.md).
Before connecting restored data, stop/drain old deployments and external workers,
preserve keys, activate a fresh epoch outside the database, and quarantine all
business activity. Audit post-snapshot external work and missing operations;
retain unknown charges and original receipts. Reopening is an operator assertion
after that record. Each execution feature needs its own fresh proof. The expanded
fleet restore matrix belongs to phase 108 and is not established by this phase.

The owner still needs to complete real decisions, failed/successful guided tests,
visual discovery, revocation and separate Git/database/private-media restore
checks on mobile and desktop over the chosen window. A merge, screenshot or
synthetic commit cannot substitute for any of those observations.

## Integrated gate follow-up — 22 October 2026

Implementation `b0c29fd885772162f40844a4839c4842395fb2ed` landed on `main` in
`7bb17de0bd5d28d77f6cb9b140a23eebbc5dc52c`. One `keel integrate --json`
gate completed with exit **0**: **2,580/2,580** tests, all eight pinned stall
checks, roadmap, 89 practice render targets and inbox guards. The test ledger
reported no flaky/slower test and omitted one busy run from timing comparison.
`keel ready --check 'npm run typecheck' --json` exited **0** before integration.

The implementation commit's wall-time estimate was too high: claim was recorded
at 04:13:10 UTC and ready/typecheck at 04:27:58 UTC (about 15 minutes); main landing
and claim release followed at about 04:38 UTC. CI and production are separate
from this local gate. No real owner acceptance was checked by this landing.

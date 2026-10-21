# Evidence: phase 98 — guided walks preserve what was tested

- Date: 2026-10-21
- Phase: 98
- Revision: contract `47fc1ce9e686c0f563ac07dec0973628b0a275de` and working tree for `phase 98: Guided walks preserve what was tested`.
- Claim being checked: authored steps retain private exact-result observations and produce a reviewed, source-bound acceptance through the existing operation pipeline.

## Automated checks

Conductor commands, run independently of builder reports:

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-walks.test.mjs tests/board.test.mjs tests/feedback-route.test.mjs tests/web-walk-operations.test.mjs tests/web-operations.test.mjs` — exit 0, 100 passed, 0 failed. Includes CLI parity, private drafts, prerequisite ordering, monotonic target/build/environment invalidation, no-op saves, historical context, exact previews and multi-file recovery.
- A final retained-byte repair guard was added afterward. `node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='repair never turns missing retained result bytes' tests/web-walks.test.mjs` — exit 0, 1 passed, 0 failed.
- `node --import ./tests/helpers/hermetic.mjs --test tests/web-walk-ui.test.mjs tests/web-server.test.mjs tests/web-home.test.mjs tests/web-decision-ui.test.mjs tests/guides.test.mjs tests/agent-guide.test.mjs` — exit 0, 50 passed, 0 failed. Actual service routes and extracted-package assets, Origin/CSRF, access loss, conflicting saves, public acknowledgment and GET-only recovery are covered.
- `node --import ./tests/helpers/hermetic.mjs --test tests/docs.test.mjs` — exit 0.
- `node docs/evidence/2026-10-21-web-walks-sql-proof.mjs /tmp/keel-sql-proof.ja5XRq/node_modules/@electric-sql/pglite/dist/index.js` — exit 0 using isolated PGlite 0.5.11. Migrations 001–005, RLS/direct role denial, scoped RPCs, CAS revisions, shared operation reservations, prepared expiry, persistent dispatched/uncertain reservations, terminal release and synthetic rollback passed. Isolated capacity tests enforced 1000 rows, 50 MiB total ciphertext and the individual value bound without deleting history. This is one connection, not hosted or simultaneous-connection proof.
- Read-only actual GitHub call through `createDecisionGitHub(token).readResult({repoId:1402587435,repo:'dalmaer/keel'},'ceb56e4f7234ea3e795e36a23172e87ada2f1065','README.md')` — exit 0. Returned blob `f7561701fa9504b99928adaef9c9f11a6ce0cd00`, 30,241 bytes, SHA-256 `53e37ea7e318918abfd6e0f58bb3b0d084ab2285e88c2cbf12b6a607c25ffe21`; exact bytes matched `git show ceb56e4f7234ea3e795e36a23172e87ada2f1065:README.md`. Existing GitHub CLI credentials were used in memory, never printed. This establishes historical result reading, not an App-authenticated source write.

The final `npm run typecheck` runs through `keel ready --check "npm run typecheck"`. The integrated `npm run check` runs once through `keel integrate`; it covers the complete suite, roadmap, managed renders and lesson inbox. Their resulting revision and exits belong in the integration record after this evidence is committed.

Independent review reproduced a target-binding defect: a changed acceptance target could retain passes. The fix invalidates observations monotonically when the target changes. A second service-level probe changed both the phase and the acceptance item, retained history, cleared current passes/confirmation/final observation and refused preview. Six focused regressions passed; no additional blockers remained in the final review. Decision context was `not-configured`, digest `bd856c53f3a4d873a3397246506583d3de12e9543bb8ce218217b3c6afed5a62`; this is not verified architecture coverage.

## By hand

The conductor ran `/tmp/keel-phase98-browser-demo.mjs` on the owner's machine. It served the actual application routes, browser modules and encrypted-store adapter with synthetic Acme provider responses. A loopback-only authentication wrapper supplied the synthetic session; source submission stayed disabled. No production data or invented owner acceptance was used.

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Saved a failed observation and reloaded | Actual note and failed outcome returned; acceptance stayed disabled | Browser persistence and failure behavior against the synthetic store; not hosted persistence |
| Changed the authored build | Current outcomes and confirmation cleared; previous failure remained in history | Source-change behavior and retained original context |
| Saved a blocked dependent step | Blocked count and reason retained; acceptance remained open | Blocked is a useful saved result, not a pass |
| Passed prerequisites in order, then wrote a final observation | Exact phase, new evidence and roadmap preview appeared; public submission remained disabled | Actual browser preview; no GitHub mutation or owner approval |
| Repeated an unchanged save and reordered stable steps | Three observations stayed three; current passes and final observation remained valid | No invented repeat evidence and stable step identity |
| Saved a newer failure in a second tab, then saved the old tab | Old tab retained typed text, showed conflict and disabled overwrite; explicit reload restored the newer failure | Actual browser conflict UX; not two concurrent PostgreSQL connections |
| Prepared a repair brief from selected failure text | Readable destination/title/exact body and original context; advanced handoff collapsed; no issue created | Phase-92 issue-handoff reuse; no hosted shaping-conflict editor |
| Inspected desktop 1280×900 and mobile 390×844 | Document scroll width matched viewport; long exact file previews scrolled inside their bounded containers | Responsive desktop/mobile browser behavior, not a physical phone walk |

Final synthetic captures: [desktop](images/2026-10-21-guided-walk-desktop.jpg) and [mobile](images/2026-10-21-guided-walk-mobile.jpg). The temporary server and tabs were closed and viewport overrides reset after proof. An early demo reorder lost its synthetic historical artifact; the demo was corrected to retain revision snapshots, restarted, and the reorder proof repeated successfully. This was a fixture gap, not evidence of a provider write.

## Gaps and decision

Implementation is **partial, owing a walk**. Live production still serves phase 96. Hosted migrations 004 and 005, their hosted role checks and a genuine two-connection reservation race remain unverified; Vercel requests a fresh authenticator code. No local PostgreSQL server was available and Docker's daemon was not running; neither was started to manufacture a hosted claim.

GitHub App Contents-write permission remains unapproved and disabled. No real owner choice, successful acceptance commit or production-serving verification is claimed. Hosted repair exposes new-change issue handoffs, not decision-conflict authoring or shaping reopening. Media galleries remain phase 99.

The owner walk, after the approved migrations and deployment:

1. Open an authored real walk on mobile and desktop; confirm its exact result and actual environment.
2. Record a real failure or blocked observation and reload it; inspect the retained history.
3. After the actual result is ready, retest its prerequisites and steps, then author the final observation and source-valid choice.
4. Review every outbound file and its visibility. Source submission additionally requires separately approved Contents-write access and the existing write opt-in.
5. Inspect the original verified commit receipt and compare the selected acceptance item, evidence and roadmap to that commit. Record the serving revision separately; a source commit is not production verification.

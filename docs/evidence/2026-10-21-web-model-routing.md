# Evidence: phase 106 — reviewed model planning and retained task allowance

- Date: 2026-10-21 America/Denver (verification continued on 2026-10-22 UTC).
- Phase: [106](../phases/106-model-routing-respects-capacity-and-policy.md).
- Revision: `d8f9e83f74ec833272701398fc61b2883a70238c` plus the working tree
  for `phase 106: Model routing respects capacity and policy`.
- Claim: local source/policy review, fixed provider transport, atomic admission,
  original-receipt recovery and a two-stage planning checkpoint are implemented.
  This is not production activation, live model capability or owner acceptance.
- Decision context: `not-configured`, digest
  `6628795fb5b190e14562c69f2f27f307c4148682ac82a42e45056eedbf612e66`;
  no accepted choices, proposals or gaps. Legacy behavior is not verified
  architecture coverage. Phase claim was mine/here before dispatch and resumes.

## Automated checks

Conductor commands ran in the isolated `vercel-workspace/keel` checkout:

| Command | Observed |
| --- | --- |
| `node --import ./tests/helpers/hermetic.mjs --test tests/web-model-routing.test.mjs tests/web-model-handoff.test.mjs` | Exit 0, 24/24; exact source/count/run approval, current grants, admission, no duplicate sends, retained cost and checkpoint continuity/refusal. |
| `node --import ./tests/helpers/hermetic.mjs --test tests/web-model-selection.test.mjs tests/web-model-provider.test.mjs` | Exit 0, 16/16; independent units/shared reservations, price rounding/expiry, unknown capacity, opt-in fallback, required review/privacy, fixed endpoints, model identity, bounded responses and vault binding. |
| `node --import ./tests/helpers/hermetic.mjs --test tests/web-model-routing-ui.test.mjs tests/web-auth.test.mjs tests/guides.test.mjs` | Exit 0, 31/31; actual authenticated routes, policy narrowing/conditional delivery, source/permission change, original receipt, expiry without disabling Home, exact second-stage identity and completed-only summary presentation. |
| `node /tmp/keel-phase106-conductor-sql-proof.mjs` | Exit 0; independent actual PostgreSQL semantics through PGlite 0.5.11, one connection. Scope/role/RLS, missing/null/type fields, CAS, one send, exact remaining task allowance, rolling versus permanent charges, all-window rollback, duplicate-connection shared pool contention, credential rotation at begin and expired cooldown history. |
| `node bin/keel.mjs doctor --json` | Exit 0; drift and lint empty. |
| `git diff --check` | Exit 0 before the record. |

Migration `lib/web/migrations/011-model-routing.sql` SHA256:
`6ad30e4cdc728655b129681d3a24d96dcb54f59fc45b5ddac236444835f9c5f8`.
Builder SQL proof independently passed via
`node /tmp/keel-phase106-sql-proof.mjs`, including rotation/removal and service-role
credential reads. Neither script contacted hosted storage or a model provider.
Single-connection serial contention does not prove independent hosted connections.

Local retained logs are `/tmp/keel-phase106-conductor-{named-proof,adapter,ui,sql}.log`.
They are session evidence, not installed tooling. The single full gate is
`node bin/keel.mjs integrate --json`, which runs `npm run check` on the integrated
tree after this record. `node bin/keel.mjs ready --check 'npm run typecheck' --json`
performs type checking first. Gate/CI outcomes belong in the subsequent record.

Review found and corrected: expired model evidence previously invalidated the
whole app configuration; a checkpoint accepted an array as response identity;
queued empty text displayed a saved-summary heading; effective policy identity
was confused with editable file identity; decision inventory was confused with
required exported records. Explicit red/green regressions were retained by the
builders. Earlier integration failures included an assertion's capitalization
and a cooldown expectation superseded by the stronger unresolved-connection wait;
these were corrected assertions, not passing retries of unexplained flakes.

## By hand

The conductor used actual authenticated local application routes on
`127.0.0.1:58606` with synthetic Acme GitHub, storage and provider transports.
Source reading, authorization, encryption, adapter validation, routing and HTML/
client code were real. The harness made no external provider call or paid request.

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Desktop selected phase/evidence and instructions, reviewed destination/text | Exact selected records, public source visibility, unknown provider capacity and separate counting consent shown. | Source-review UX; no live entitlement or real private data transfer. |
| Mobile counted then approved stage one | Quote $0.003000, explicit Run approval, original receipt before submission, queued state. | Separate count/run controls and receipt navigation. Fixture prices/counts are synthetic. |
| Explicitly reconciled provider completion, continued stage two | Saved summary reused; $0.060000 task allowance retained, $0.001200 first charge and $0.058800 remaining shown. Stage two linked the original summary and retained $0.002400 total after completion. | Checkpoint UI and accounting display; no real invoice or model quality claim. |
| Simulated lost create response, reloaded original mobile receipt | Same original receipt, unknown usage, $0.003000 held; no replacement Run control. | Safe uncertainty presentation; unknown response identity cannot be recovered by undocumented lookup. |
| Restarted final UI, narrowed workspace policy and saved | Exact private file preview, separate approval, verified synthetic commit receipt. | Actual conditional-policy route; no real GitHub write. |
| Inspected 1280px desktop and 390px mobile | Mobile quote and uncertainty views had viewport 390 and document scroll width 390. Heading/title/focus changed with each primary view. | Desktop and emulated mobile layout; not a physical phone or owner walk. |

Screenshots contain synthetic data only:

- [Desktop source review](images/2026-10-21-model-review-desktop.jpg)
- [Mobile quote](images/2026-10-21-model-quote-mobile.jpg)
- [Saved summary](images/2026-10-21-model-summary-mobile.jpg)
- [Checkpoint and remaining allowance](images/2026-10-21-model-continuation-mobile.jpg)
- [Uncertain original receipt](images/2026-10-21-model-uncertain-mobile.jpg)
- [Desktop policy](images/2026-10-21-model-policy-desktop.jpg)
- [Policy receipt](images/2026-10-21-model-policy-receipt-desktop.jpg)

The demo was stopped, its two tabs closed and temporary viewport reset. Existing
setup tabs and credentials were untouched.

## Hosted and owner walk still required

On approved storage, apply the exact migration and use two independent service
connections with fresh synthetic scope IDs. Compete for the last money slot, a
shared capacity pool and one project lane; test transaction commit and rollback,
two simultaneous stage-two admissions and vault rotation/removal versus begin.
Exactly one eligible grant must win, losers must leave no partial reservations,
and a grant awarded before rotation must never be awarded twice. Repeat role/null/
type checks, actor/project history isolation, uncertainty retention and cooldown
write-loss behavior. Record migration hash, timestamps and connection identities.
No hosted result has been observed here.

Then approve a selected credential, dated immutable model/capability/price record,
exact packet and temporary retention, and a small monetary allowance. Complete one
bounded real call and saved-summary continuation; compare receipt usage with the
provider's evidence. No default model, price or spend was chosen in this phase.

## Gaps and decision

Status is **partial, owes walk**. Local implementation is complete; migration011,
hosted contention, real provider/data/budget activation and owner observations are
unverified. No deployment or permission expansion occurred. Current live metadata
probes expose no inference quota; observed-capacity policies wait. Explicitly
budgeted unknown-capacity API use is distinct from verified available quota.

Only the tool-free evidence-summary/next-actions adapter runs. Builds, independent
review, routine model execution and subscription execution are unsupported. Linked
decisions outside the selected phase/evidence/decision directories refuse rather
than silently exporting other source. Background work may outlive the browser;
there is no scheduler or automatic wall-clock cancellation. Uncertain delivery
holds its charge and blocks that connection across projects. These limitations
remain visible and feed the operation-coverage audit in phase107.

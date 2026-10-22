# Evidence: scoped connections and model capacity

- Date: 2026-10-21; browser verification approximately 23:50–23:52 UTC.
- Phase: [103](../phases/103-connections-expose-scoped-model-capacity.md).
- Revision: design `5e94252859bbbe11dab2828fd6b90e2de7c651a7` plus working tree for **phase 103: Connections expose scoped model capacity**.
- Claim: private scoped policy, encrypted credential lifecycle and conservative capacity projections work through the authenticated source service. This is not hosted activation or owner acceptance.
- Decision context: `not-configured`, digest `edf51aa379386c34bbd1523cd7c3e689e058a30d3597bf086b4d4957fb18ded9`; no accepted choices, proposals or gaps returned. This preserves legacy behavior, not verified decision coverage. Phase claim revalidated mine/here before builder resumes.

## Automated checks

Conductor independently ran:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/web-connections.test.mjs tests/web-capacity.test.mjs
# exit 0; 33 tests, 33 pass, 0 fail
node --import ./tests/helpers/hermetic.mjs --test tests/web-provider-connections.test.mjs tests/web-connections-ui.test.mjs
# exit 0; 28 tests, 28 pass, 0 fail
node /tmp/keel-phase103-capacity-review.mjs
# exit 0; malformed newer measurement, reset and source observations invalidate older eligibility
node --import ./tests/helpers/hermetic.mjs /tmp/keel-phase103-store-corrected-review.mjs
# exit 0; unavailable/version:null, controls false, zero provider probes and zero vault writes
node /tmp/keel-phase103-connections-sql-proof.mjs
# exit 0; isolated PostgreSQL migration 001 + 008 checks below
```

Scratch probes are supplementary session artifacts, not installed commands. The retained test files cover their requirements. Builder focused backend: 22/22 pass, exit 0, ledger reported no flaky/slower findings. Provider/capacity: 23/23 pass, exit 0. UI plus existing authentication/server/guides/docs: 37/37 pass, exit 0. No builder ran the whole gate.

The vault proof used isolated PGlite, not the hosted Supabase database. It checked anonymous/authenticated RPC and table denial, service direct-table denial, RLS, metadata without ciphertext, scope isolation, one winning compare-and-swap, removal tombstones, terminal generation removal, input bounds and rollback. Concurrent promises share one connection; this does not establish hosted multi-connection behavior. Migration 008 SHA-256: `844a175ed75799373fbfdd3fcb45dc657af056b859ff15986509c4f8fcf4f67e`.

The tests exercise actual policy, provider, store, authenticated routes and browser client modules with synthetic external transports. They cover exact preview approval, final authorization after buffered reads and provider validation, revoked grants, current private destination, changed policy binding, separate ciphertext purpose/key, stale generations, removal races, uncertain-response reconciliation, default-disabled configuration, secret reflection sanitization and bounded fixed-endpoint provider requests. Capacity checks require explicit verified identity, freshness, units and windows; unknown, conflicting, unsupported or malformed observations never imply available allowance.

The integrated tree will run `npm run typecheck` through `keel ready --check "npm run typecheck"`, then `npm run check` through `keel integrate`. The latter includes the complete tests and roadmap/render/inbox guards. Those results require the committed tree and are recorded after integration, not presumed here.

## Review findings and correction evidence

- A read-only reviewer demonstrated that metadata `{conflict:true}` became absent/version 0 and enabled a provider probe plus vault write. The scratch reproduction exited 0 asserting that defect. The builder added two regressions in an isolated copy: meaningful pre-fix exit 1, then exit 0 after replacing only `connection-store.mjs`. Metadata now accepts only validated rows or null; conflict belongs only to mutation responses, and null mutation results are malformed. Conductor independently verified the corrected unavailable/no-effect outcome above.
- An initial isolated-copy setup lacked a migration dependency; it was corrected before the meaningful failing run. This setup failure is not the red proof.
- Conductor review found malformed newer capacity readings could leave old eligibility; the final probe ran after correction and passed. No independent pre-fix failure is claimed. Explicit account/workspace/unknown identity also replaced scope inference.
- The early policy receipt view now retains its original identity even when reservation is not yet visible, without claiming a completed or durable write. The reviewer's first probe expected the previous behavior and failed; its corrected expectation passed. This was a stale probe, not an outstanding product failure.
- A UI test initially expected uncertainty after a lost SQL response even though exact metadata readback confirmed it. The assertion was corrected; a separate client/browser exercise loses the HTTP response itself.

## Browser exercise

Command: `node /tmp/keel-phase103-browser-demo.mjs`, listening only at `http://127.0.0.1:58403`. It uses the actual authenticated service, policy delivery, provider adapter and encrypted vault adapter with synthetic Acme transports. No real provider calls, credentials or external writes occurred. The first scratch demo accidentally reused a secret reference across two descriptors; the application refused a complete mutation-capable catalogue. Correcting only that synthetic seed restored both connections. No application bypass was added.

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Create Acme design policy, review exact destination/files/grants/digest, approve and apply | Private policy commit verified; original receipt retained | Actual browser-to-service synthetic conditional delivery; not a GitHub owner write |
| Set synthetic OpenAI key | Input cleared and disabled; exact request confirmed at version 1 | Credential input and receipt flow; not provider entitlement |
| Reload request address and explicitly check | Original version 0/request confirmed stored version 1 | Bookmark recovery without a saved key |
| Lose rotation HTTP response after store handling, reload, explicitly reconcile | Same request/version 1 confirmed at stored version 2 | Recovery across browser reload; no duplicate key submission |
| Remove the synthetic credential from mobile | Separate request confirmed version 3, removed | Keel copy removal; not provider-side revocation |
| Inspect project Connections and detail | Effective grants only; explicit read-only explanation and no credential form | Project lens behavior; cross-project denial also covered by tests |
| Make vault unavailable and disable activation | Credential/binding unavailable, unknown version, no key controls | Missing evidence remains unavailable, not absent/zero |
| 390×844 viewport, then normal 1280 viewport | Document scrollWidth matched viewport (390 and 1280); empty key input; form Tab moved to display label with visible focus | Responsive layout and one keyboard step; not comprehensive accessibility or a physical phone walk |

The first selector for Provider used a label lookup that did not resolve; the observed combobox role worked. A click on the transient recovery button raced the successful response; the subsequent view confirmed completion, then reload exercised explicit recovery. Neither automation race was treated as a product failure or retried blindly. Demo stopped, proof tab closed and temporary viewport reset.

Screenshots contain synthetic records only:

- [Desktop Connections and keyboard focus](images/2026-10-21-connections-desktop.png).
- [Mobile credential details](images/2026-10-21-connections-mobile.png).
- [Desktop original-request recovery](images/2026-10-21-connections-recovery-desktop.png).
- [Mobile recovery after lost rotation response](images/2026-10-21-connections-recovery-mobile.png).

## Gaps and decision

Status remains **partial, owes walk**. Production still serves the independently recorded phase 96 deployment. Migration 008, the separate Vercel wrapping-key binding, selected provider credentials and live adapter/store validation have not been activated. Private policy writes still need their existing Contents-write approval; this phase grants none. No inference, paid upgrade, subscription reporter, provider Admin key or universal model-quota endpoint is implied.

Owner exercise after approved activation:

1. Verify the hosted migration denies client roles and returns metadata without ciphertext; record serving revision, runtime and safe timestamps.
2. Inject a separately generated production wrapping key and validate one approved provider credential through the fixed metadata endpoint. Keep raw values out of records, screenshots and Git.
3. Review an exact private project policy, then set/rotate/remove a credential and inspect the same request after a disconnect on the owner's actual desktop/mobile device.
4. Compare verified source identity and freshness with the provider's authoritative view. Record at least one unavailable scope; do not turn metadata access into inference or subscription capacity.
5. Record observations and actual cost/duration. Keep acceptance open if permissions, capacity coverage or operating usefulness cannot be established.

## Committed integration follow-up

`keel ready --check "npm run typecheck" --json` exited 0 for
`8577802ddbf6330747e702862865b05304a85a07`; typecheck exited 0.
`keel integrate --json` exited 0 with one full `npm run check` gate,
2,293/2,293 tests and all eight pinned timing suites passing. Roadmap, render
and inbox guards passed. The ledger reported no flaky or slower test; one busy
run was omitted from timing history. Existing undated-observation advice was
non-blocking. Main is `e8d3f2fff9ebb8c0e2d2cb17cb690cd897ad2948`; phase claim released.
Exact-main GitHub typecheck run 39697083371 and check run 39697083133 both
succeeded, confirmed after integration. CI is separate evidence.
No deployment or provider activation followed this integration.

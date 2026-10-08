# Evidence: phase 50 — local canvas projection and limited publication

- Date: 2026-10-08
- Phase: [50](../phases/50-project-life-on-isocan.md)
- Revision: base `e7f96d392636598785a16b3de61eb71441e1179c` plus working tree,
  landed as `phase 50: A project's isocan canvas shows what Keel improves`.
- Claim: local snapshots, interactive views, explicit retro capture and the
  immutable adapter are implemented. This is not a deployed integration claim.

## Automated checks

Focused checks used this reporter prefix from the repository root:

```sh
node --import ./tests/helpers/hermetic.mjs --test \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout \
  tests/canvas-retro.test.mjs
```

That command exited 0: seven tests passed, zero failed, clean test-ledger
hygiene. It checks preview versus persistence, attributed owner choices,
explicit provider coverage, privacy and concurrent capture conflicts.

The same prefix with `tests/canvas-snapshot.test.mjs
tests/canvas-render.test.mjs tests/canvas-cli.test.mjs
tests/canvas-package.test.mjs` initially exited 1: 42 passed, one failed.
The package guard mistook source text for an import. It now asks Node to resolve
the packed modules with a dependency-boundary hook. The isolated package command
then exited 0: three tests passed, zero failed, clean hygiene. This actually
packs and unpacks Keel, initializes Acme and uses the resulting CLI, rather than
importing the checkout as a substitute for installation.

Final focused proof: the reporter prefix above with all seven files named in
phase 50's Proof exited 0: **86 tests passed, zero failed**, 7357 ms; no flaky
or slower tests. This includes actual collector/render/sync composition,
clock-only no-op synchronization, accepted Loop cohorts across saved snapshots,
corrupt history refusal, all metric controls, the workflow shell, and actual
connect/sync → export → fresh-checkout restore → sync with a synthetic remote.
The workflow also refuses an older successful artifact when the latest failed
attempt's receipt is missing. Synthetic recovery proves the local contract,
not deployment or external credential provisioning.

The final integrated gate is `npm_config_cache=/private/tmp/keel-canvas-npm-cache
npm run check`. It covers all tests, roadmap freshness, rendered practice files
and the inbox. Its exit code and test count belong in the commit body, after
this record is written. Post-push CI is a separate observation.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| `node bin/keel.mjs canvas snapshot --github --output /private/tmp/keel-canvas-github-preview.json --json` | Read source records and referenced GitHub facts without changing acceptance | Exit 0; 277 entities, GitHub and reconciliation coverage `ok`; 51 phases, 56 catalogue lessons, 17 inbox proposals, seven saved health reports and 98 saved test runs | Real source collection and read-only GitHub calls; not exhaustive PR discovery or current production verification |
| `node bin/keel.mjs canvas render --snapshot /private/tmp/keel-canvas-github-preview.json --output /private/tmp/keel-canvas-preview/final --json` | Reusable local artifacts with bounded stdout | Exit 0; HTML, Markdown, cards and manifest; JSON contains paths/hashes/counts | Actual local CLI composition; no isocan SDK or account required |
| Open the served `pulse.html` in the in-app browser | Navigable source-backed view on the narrow app viewport | Current counts 38 implementation claims, 38 authored acceptance records with evidence present, 56 lessons and 17 separate proposals; goal G5 filter reduced the view to five records; undated records remain visible | Filter behavior and presentation, not independently rerun acceptance proofs |
| Select a measure beyond the headline cards | Every metric reachable, gaps visible | Selector exposes all 48 measures, 24 unknown; `ci_red_streak` shows zero with seven dated contributing reports | Saved health trend, not a fresh CI check; screenshot retained locally |
| Inspect installed and checkout isocan public CLI | Verify actual available mutation primitives | Installed `0.1.0 (3b46f21)` lacks native groups; checkout `0.1.0 (b61f7c1)` supports groups but no conditional general edit | Justifies immutable mode; does not establish deployed access or write semantics |
| Attempt identity setup | Approved destination before external writes | Automatic approval review rejected remote identity creation because explicit approval and private destination were unresolved; no identity, space, binding or canvas was created | A pending owner step, not a completed integration |

## Gaps and decision

**Partial.** Local code and synthetic transport checks cannot establish the
real isocan walk. Owner approval is pending for an attributed Keel agent identity,
owner-only space/canvas on the chosen home, and publication of the reviewed
summaries and source links. No credentials or scheduled publication are set up.

After approval, connect through Keel and inspect native groups, both item faces,
source links and identity. Add a human note, move a managed card, synchronize
again, then interrupt and restart a write. Prove conflicts preserve human edits
and ambiguous operations retain receipts without blind retries. Use the current
inspected CLI; do not silently substitute the unsupported global executable.

The public CLI currently supports only the explicit limited immutable mode.
Stable live-pulse updates, atomic multi-card publication and remote retention
remain open, requiring a verified conditional-write contract. They are not
accepted by this implementation. Missing dependency/review/queue/fleet artifacts,
baseline cohorts, production receipts and model-cost data remain unknown.

The existing night hook still needs owner-provisioned tools, pinned versions,
identity, original binding/receipt bootstrap and an actual fresh-run recovery
walk. It restores the latest trusted canvas-enabled attempt, even if failed;
missing state requires manual recovery. No actual scheduled canvas run occurred.
Seven successful scheduled nights on an adopted project are still required for
lived-in evidence. Neither merge nor a single publication checks that box.

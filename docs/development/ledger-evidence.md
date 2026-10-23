# Ledger retained evidence

Run this source-only collector against an **explicit** already-completed run:

```sh
node scripts/validation-ledger.mjs --manifest <existing-fleet-manifest.json> --run <positive-run-id> --json
```

The fleet manifest is the existing array of `{repo, role}` entries. Ledger must
appear exactly once as a managed repository. The reviewed coverage profile is
[ledger.v1.json](../../scripts/validation-manifests/ledger.v1.json); callers cannot
select another repository, profile or provider URL. There is no latest-run search.
Existing `gh` access supplies fixed GitHub.com GET requests only. No credential,
permission, workflow, gate, schedule or consumer configuration is changed.
`PLATES_GH` can select a test transport executable; its observations are labelled
`override`. Injected library transports are also overrides. Neither mode
authenticates execution lineage. Keep tokens out of executable paths and inputs.

The collector writes JSON to stdout only when `--json` is supplied; callers
explicitly retain that output. It never writes files. Exit **0** means no collector
gaps, **1** means retain the advisory report and its gaps, and **2** means invalid
input or an unusable collection request. Capture the status before any subsequent
command. Known gaps make exit 1 normal for the current legacy producer. An exit
code never grants an exemption from validation. Error output contains bounded
codes, not raw API responses, logs, test bodies, private data or credentials.

The [collector library](../../lib/validation-ledger.mjs) reads run/repository/
workflow identity, the immutable commit/tree, reviewed source files at that head,
attempt-scoped paginated jobs and the two named lane artifacts. It verifies
provider SHA-256 metadata, expiration, run/head/repository links and actual ZIP
bytes before bounded data-only extraction. Artifact names map to jobs through a
reviewed convention; GitHub's artifact metadata does not expose an authenticated
job or attempt link. That missing link remains a gap. Rerun attempts are inspected
separately and never combined into complete gate evidence. Reviewed source files
use their fixed contents endpoint at the immutable run head with the fixed raw
Accept header `application/vnd.github.raw`; source bytes are hashed directly
under a 1 MiB byte cap. They are
not parsed as reporter JSON or emitted into the report. This keeps larger
harness files separate from the unchanged strict reporter/API JSON limits.
The read-only diagnostic found that the `raw+json` media type transformed thirteen
literal backslash-u0000 sequences in the retained harness response into `^@`,
changing 86,442 bytes to 86,390. The plain raw media response matched the normal
contents API's base64-decoded bytes and the reviewed source hash. Keep that failed
observation as evidence; do not adjust the expected manifest hash to transformed
bytes. Synthetic coverage preserves these escape bytes and rejects their changed
digest.

The manifest keeps configured local `check:all` and hosted Tests coverage
separate. Its 13 local logical stages include voice diagnostics and performance
budgets that hosted CI does not run. Both test clocks and the web production
install/build order remain requirements. Hosted documentation checks add coverage;
they do not replace local-only checks. Source hash matches validate this mapping,
not observed runtime execution. A changed source produces a gap requiring review
of the manifest. Private ledger-data revision/tree remain separately moving inputs.
Never infer them from the code revision or include private data in this output.

Every report is `advisory-only`, `reuseAuthorized:false` and
`configuredGateComplete:false`. Green job steps and child reporter records cannot
be promoted to an enclosing configured local gate. Dirty web observations stay
dirty. Missing inventories, filtered/failed children, unknown runtime/config/cache/
harness observations and missing lanes remain explicit. Retained end timestamps
are preserved; child starts derived from end minus wall duration are labelled as
derived. The run start-to-`updated_at` interval is labelled a metadata interval;
it is not reported as measured execution wall time. CPU remains null and
overlapping spans are not added or reported as speed savings. The coverage
manifest's `parsedObjectSha256` hashes UTF-8 `JSON.stringify` of the parsed profile
with property order preserved; it does not claim byte identity of the JSON file.

`auditInput` is the existing nightly schema-1 projection. The `children[].bridge`
sidecar retains all nine independent input bindings: command, config, workflow,
lock, harness, runtime, environment, selection and cache. Nightly schema 1 lacks
harness; shadow schema 1 lacks cache. Both projections and the joint values are
preserved, with unsupported comparison explicitly reported. No key is renamed or
folded into another hash. Unknown values stay null, and 12-digit legacy hashes
stay short in `legacy`; they are never padded into SHA-256. Expected manifest
bindings remain distinct from these observed child inputs. The nightly analyzer
and fleet membership are unchanged; the envelope is not itself an audit input.

Bounds are 48 requests, five pages per listing, 100 entries per API page, 30
seconds per request, 1 MiB JSON/child, 8 MiB compressed per archive, 16 MiB expanded
across archives, 256 entries per archive and 256 child records. The existing
strict JSON reader also bounds depth, nodes and strings and rejects duplicate
keys. ZIP traversal, links, duplicate entries, CRC errors, unsupported formats and
oversized input fail closed to explicit gaps. Oversized legacy telemetry may be
unavailable rather than partially trusted. No raw test names or bodies are emitted.

Focused proof, before the unchanged integrated checkpoint:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/validation-ledger.test.mjs
```

Real producers, authenticated execution/input lineage, complete local/hosted
equivalence and validator adoption remain separate work. This collector does not
complete phase 114 or establish measured speed gains.

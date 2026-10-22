# Audit recorded validation evidence

The source-local validation audit reports what retained evidence establishes and
what is missing. It runs no tests, network requests, notifications or writes.
The existing validator alone decides whether CI evidence can replace a local
gate. This report never grants that permission, even when it has no findings.

Run `node scripts/validation-audit.mjs --manifest plates.json --input /absolute/evidence.json --json`.
Omit `--json` for a compact text report grouped by repository and rule. Use
`node scripts/validation-audit.mjs --help` for the command contract. Exit 0 means
no findings in supplied evidence, 1 means findings or coverage gaps, and 2 means
invalid input or unreadable files. A nightly caller must retain exit-1 JSON;
exit 1 is an actionable audit result, not a reason to rerun expensive suites.

The explicit manifest uses Plates' existing array of `{repo, role}` entries.
Only `role: "managed"` repositories are analyzed. Source-only repositories are
excluded; evidence for excluded or unknown repositories is rejected. Each
managed repository needs evidence, and absent gate or review records produce
coverage gaps. This source-local tool creates no schedule and changes no
recipient or delivery policy.

## Input schema 1

The input is `{ "schema": 1, "observedAt": "2026-10-22T20:00:00Z", "records": [] }`.
Use the actual collection cutoff for `observedAt`. Timestamps are UTC ISO values
with optional milliseconds. Future evidence timestamps and reversed intervals
are rejected. Maximum input file size is 8 MiB, 5,000 records, 100 manifest
projects and 256 stages per record. Both explicit files must be regular files
on canonical paths with no symlink components. Evidence fields are never
interpreted as file paths, imports, URLs or shell commands.

Every record requires:

| Field | Meaning |
| --- | --- |
| `id` | Immutable producer record identity, at most 128 letters/digits/`_.:-`, beginning with a letter/digit |
| `repo` | Exact `owner/repository` from the managed manifest |
| `kind` | `gate`, `stage`, `setup`, `review` or `reuse` |

Optional values may be omitted or null when unknown. Never manufacture them to
silence a gap. `head` and `tree` are 40- or 64-character lowercase Git hex IDs;
`dirty` and `completed` are booleans; `status` is the exit code (0–255).
`startedAt`, `endedAt`, `heartbeatAt` are timestamps. `wallMs`, `cpuMs`,
`queueMs`, `timeoutMs` are nonnegative finite milliseconds. `cpuMs` means actual
observed child CPU, not elapsed time or an estimate. `parentId`, `invocationId`,
`purpose`, `retryOf`, `retryReason` and `stage` use the same token format as `id`.
Use `retryOf`/`parentId` to distinguish retries and nested runs from independent
duplicate gates. `timedOut` is a boolean observation, never inferred from text.

Input records and arbitrary extra fields are not echoed. Output has only
allowlisted structured values, opaque evidence IDs, safe fixed messages and
numeric measurements. Keep full private provenance in a sidecar mapping to the
input records. Do not put private raw logs or credential values into an input
merely because the analyzer ignores unknown fields.

## Complete gate observations

A `gate` establishes a complete *recorded claim* only when:

- `gateSource` is `configured-check` (an `explicit-command` wrapper is not an
  equivalent configured gate), `dirty` is false, `completed` true and `status` 0;
- head, tree, start/end timestamps and invocation identity are present;
- `inputs` has 64-character lowercase SHA-256 digests for `command`, `config`,
  `runtime`, `environment`, `selection`, `workflow`, `lock` and `cache`;
- `manifestDigest` binds the versioned stage manifest, and `requiredStages` is
  a nonempty unique token list;
- `stages` contains exactly one record per required stage, with no extras.
  Each stage has `id`, the same head/tree/manifestDigest, `dirty:false`,
  `completed:true`, `status:0` and `inputsDigest` matching the parent's inputs.

The exported `inputsDigest(inputs)` hashes a canonical fixed-key representation;
`cohortDigest(record)` additionally binds kind, stage and manifest digest.
Neither function validates authenticity of the producer. Collection and the
existing gate validator must verify provenance and artifact integrity. A digest
is not an attestation merely because it is syntactically valid. Legacy 12-digit
command hashes are not full digests: leave normalized input fields unknown and
retain the original record in private provenance rather than padding a hash.

Complete gates with identical immutable identity, required-stage union and
`purpose`, different invocation IDs and no retry/parent relationship produce
one `redundant-gates` inspection finding. Required-stage order does not change
the union. Duplicate copies of the same producer record are deduplicated;
conflicting copies are excluded from comparisons and produce a gap. No
redundancy finding authorizes removing a required check or platform coverage.

## Timing and setup

A gate/stage may include `baseline` with `sampleCount`, `medianWallMs`,
`thresholdRatio` (at least 1) and `cohortDigest`. The analyzer reports a
regression only for successful, completed, clean current observations with at
least five baseline observations, a positive median, matching cohort and
explicit threshold. Wall time must exceed median × threshold. Missing,
incomparable, failed or insufficient baseline evidence produces a gap. Baseline
collection is responsible for retaining the corresponding original successful,
clean observations; these summaries are not independently recomputed here.

The report preserves per-record wall, CPU, queue and enclosing interval values.
It never adds nested or overlapping spans, estimates CPU from wall time,
computes p95 from summary inputs, or represents potential savings as observed.
Missing wall/CPU evidence produces a telemetry gap.

For `setup`, a recorded timeout or incomplete installation past its recorded
start/deadline produces `setup-stalled`, with elapsed and heartbeat age when
known. Active setup ages to the collection cutoff; completed setup duration and
heartbeat age stop at its recorded end. A completed record without an end keeps
those ages unknown instead of growing on every later audit. Incomplete setup
without a start/deadline produces a gap. Completion
stdout alone is not completion evidence. The next action retains the failure
and asks for redacted diagnostics and an exact-input failed-job retry; the
analyzer never performs that retry.

## Review and reuse

A `review` record's `review` object supplies `base`, `reviewedBase`,
`reviewedHead`, `inputComplete`, `workflow`, `expectedWorkflow`, `workflowHead`,
`expectedWorkflowHead`, `event` and `allowedEvents`. Workflow paths must be
`.github/workflows/<name>.yml` or `.yaml`; revisions are Git IDs. Complete input
requires the actual reviewed base/head to equal the expected base/current head,
not a green conclusion on an older revision. The workflow path *and revision*
and explicit allowed event must match. The caller obtains expected values from
the trusted project configuration; passing arbitrary expected values does not
establish an independent review.

A `reuse` record carries current clean head/tree, inputs, manifest digest and
required stage list. Its `reuse` object supplies `gateId`, `policy` (`24-hours`
or `until-change`), `artifactIntegrity` (`verified`, `unknown` or `invalid`) and
`artifactExpired` (boolean). The referenced gate must be present for the same
repository, complete and identical on immutable inputs. Integrity must be
verified and expiry false. `24-hours` uses the collection cutoff minus the gate
end; `until-change` removes only that age test. Unknown policy, missing/partial/
failed gate, dirty or changed inputs, expiry or unknown integrity always produce
`unsupported-reuse`. This is an evidence warning; the tool neither activates
reuse nor changes existing freshness policy.

## Reports and deduplication

Findings include stable `id`, repository, rule, severity (`warning` or `gap`),
opaque evidence reference, head, fixed reason and one next action. Same input
and cutoff produce deterministic output irrespective of record order. A new
candidate or producer identity changes its finding identity. The nightly caller
may compare finding IDs with its previous report and group recurring findings;
the analyzer stores no report history and sends nothing. Keep JSON for the
individual evidence references and use compact text grouping for a digest.

A report with gaps is deliberately incomplete. Consumer producer adapters,
full configured-gate equivalence, resource admission, install diagnostics and
shadow selection are separate stages in the
[validation efficiency spec](../specs/validation-efficiency.md). The audit's
input schema does not silently adopt any of those policies.

## Source development preflight

When changing this analyzer, run
`npm run check:focused -- tests/validation-audit.test.mjs`. The source runner
always includes helper, README, guide, CLI, adoption, managed-skill, package capability and preflight
regression tests under
the hermetic preload with concurrency two, then checks roadmap, managed render,
inbox and whitespace in order. Add other affected test files explicitly. Inspect
the argv without execution with `node scripts/check-focused.mjs --plan --json
tests/validation-audit.test.mjs`. A failed stage stops the preflight with a nonzero
exit; there is no option to omit the mandatory conventions.

This conservative bundle is early feedback, not a complete dependency map, a
resource-admission guarantee or evidence that the required integrated gate can
be skipped. `/spin` requires the convention inventory before the full checkpoint;
shared, configuration and unmapped changes still require broad validation.

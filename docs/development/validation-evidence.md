# Shadow validation of complete gate evidence

The source-only phase 114 validator checks a retained artifact against separately
supplied expectations. It reports structural coverage and byte identity. It
never executes a command, fetches evidence, changes policy, writes a file or
authorizes reuse. The existing configured gate and its acceptance defaults are
unchanged. This is a foundation for later producer work, not a consumer gate
attestation or proof that recorded execution actually happened.

```sh
node scripts/validation-evidence.mjs --expected /canonical/expected.json --source /canonical/source.json --artifact /canonical/artifact.json --json
```

All three paths must be absolute canonical regular files with no symlink
components, `.` or `..` segments. The reader opens bounded files, checks their
metadata around the read and retains the exact bytes used. Each input is limited
to 1 MiB. JSON must be valid UTF-8 with unique object keys, no more than 12 levels
of nesting, 20,000 value nodes and 4,096 characters per string. Required stage
sets contain 1–128 unique stages. These checks do not establish origin
protection against a hostile filesystem owner.

Exit **0** means all shadow consistency checks passed; **1** means rejected
evidence or gaps; **2** means invalid/unreadable input. JSON reports always say
`authority: "advisory-only"` and `reuseAuthorized: false`. A successful report's
`coverageComplete: true` means only that the supplied expected stages have
matching successful records. It does not authenticate the artifact's origin,
verify truthful execution, approve a manifest, establish source freshness policy
or replace any required check. Preserve the result even when it exits 1.

## Independent inputs

The caller must select an actual managed repository from the reviewed fleet
manifest and inspect its current required commands and stage contract. Do not
construct the expected stage list, candidate or source digest by copying the
artifact under evaluation. This script does not discover the fleet, authenticate
a provider, derive requirements from workflow YAML, or decide that a local gate
is equivalent to hosted CI. The independently supplied expectations still need
review and provenance. A supplied SHA-256 proves matching bytes, not trust.

The `--expected` document has exactly these keys:

| Key | Required value |
| --- | --- |
| `schema` | `1` |
| `candidate` | Candidate object described below |
| `manifest` | Versioned required-stage manifest described below |
| `evaluatedAt` | Explicit canonical UTC evaluation instant |
| `freshness` | `{ "mode": "max-age", "maxAgeMs": positiveSafeInteger }` or `{ "mode": "until-change" }` |

There is no freshness default. The caller must supply the already applicable
reviewed policy; selecting `until-change` does not authorize adopting it. Age
is measured from the complete outer record's `endedAt`. Equality at the maximum
age is allowed; greater age is rejected. Artifact expiration is always enforced,
including for `until-change`. An artifact expires at equality with `evaluatedAt`.

A candidate has exactly `repo`, `head`, `tree`, `dirty`, `gateSource` and
`inputs`. `repo` is an exact bounded `owner/repository` identity. `head` and
`tree` are full lowercase 40- or 64-hex Git object IDs. `dirty` must be `false`
and `gateSource` must be `"configured-check"`. `inputs` has exactly eight
lowercase SHA-256 digest fields:

```json
["command", "config", "workflow", "lock", "harness", "runtime", "environment", "selection"]
```

The command digest identifies the complete configured gate. A stage also has
its own command digest. Future producers must derive these bindings from actual
commands, config, workflow bytes, lock and harness inputs, observed runtime and
environment, and selection. The validator compares bindings; it does not run
runtime probes or establish that a hash describes a truthful observation.

The manifest has exactly `schema: 1`, `repo`, `gateCommandDigest` and `stages`.
Its repository and gate-command digest must match the expected candidate.
Each stage is exactly `{ "id": "ordinary", "commandDigest": "<sha256>" }`.
The placeholder denotes an actual lowercase 64-hex digest. IDs are 1–128 ASCII
letters, digits, dots, underscores, colons or hyphens, beginning with a letter
or digit. Empty, duplicate and oversized stage sets are invalid; stages are
required, with no optional or skipped-stage interpretation in this version.

`manifestDigest` is SHA-256 over UTF-8 compact JSON: sort stages by ascending
ASCII ID, recursively sort object keys, preserve array order otherwise, and
serialize with `JSON.stringify`. There is no trailing newline. The library's
`manifestDigest(manifest)` implements this contract; changing any requirement
changes its digest. Reordering input properties or the required stage list does
not. Artifact byte hashing, in contrast, uses the exact original bytes including
whitespace and trailing newlines.

The separate `--source` document has exactly these keys:

| Key | Required value |
| --- | --- |
| `provider` | `"github-actions"` |
| `repo` | Exact expected candidate repository |
| `workflow` | Bounded `.github/workflows/name.yml` or `.yaml` path |
| `runId`, `artifactId` | Decimal strings of 1–20 digits, first digit nonzero |
| `attempt` | `1` |
| `expiresAt` | Explicit canonical UTC expiration instant |
| `sha256` | Independently supplied SHA-256 of the exact artifact bytes |

Execution identity is provider/run/attempt/workflow/repository; workflow contents
bind through the candidate's workflow digest. Artifact ID, expiration and byte
digest are external post-upload metadata, not producer fields. There is no
additional workflow-source revision observation in this slice. Source identity
is supplied metadata, not a signature, OIDC verification or fresh API read.

## Artifact contract

The artifact document has exactly `schema: 1`, `candidate`, `manifestDigest`,
`invocationId`, `source`, `startedAt`, `endedAt`, `completed`, `status` and `stages`.
The candidate and manifest digest must match independent expectations. Source
must exactly match the independently supplied execution fields: `provider`,
`repo`, `workflow`, `runId` and `attempt`. It must not contain `artifactId`,
`expiresAt` or `sha256`: GitHub assigns artifact identity and expiration after
upload, while a byte digest cannot be embedded in the bytes it identifies.
Those three values are validated separately against the downloaded bytes and
evaluation instant, and retained as caller-supplied report provenance. `invocationId` follows
the same bounded ID grammar as a stage ID. `completed` must be `true` and
`status` must be numeric `0`.

Each child in `stages` has exactly these keys:

```json
["id", "commandDigest", "candidate", "manifestDigest", "invocationId", "parentInvocationId", "source", "startedAt", "endedAt", "completed", "status"]
```

Every expected stage must occur exactly once, with no extras. Its stage command
must match the required manifest; its complete candidate, source and manifest
digest must match the outer expectations. A unique child invocation ID must
differ from the outer and every sibling invocation, and `parentInvocationId`
must equal the outer ID. Each child must be complete with numeric status zero.
An outer successful wrapper cannot compensate for missing or unsuccessful
children. Chronology requires every child interval to fit inside the completed
outer interval, and the outer interval to end no later than `evaluatedAt`.

All timestamps use canonical `YYYY-MM-DDTHH:mm:ss.sssZ`, with a real calendar
date and exactly three fractional digits. Reversed intervals, rolled-over dates,
non-UTC offsets and future completion are rejected. No inferred clock skew is
allowed. Source expiration must follow completion and evaluation.

Version 1 supports only one first attempt. Attempt 2, retry fields, copied
sibling successes, extra fields, duplicate or cross-attempt identities and
partial unions are rejected. Explicit retry provenance and aggregation are
future reviewed work; unknown fields do not silently acquire meaning. Invalid
JSON/unsupported outer schema produces exit 2; a recognized schema with missing
or inconsistent evidence fields produces exit 1.

## Verification and remaining work

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/validation-evidence.test.mjs
```

The Acme fixtures cover exact byte integrity, canonical manifest identity,
independent expectations, all provenance axes, stage completeness, false
wrappers, source and parent linkage, freshness/expiration, invalid UTF-8,
duplicate keys, input bounds, path safety and exit semantics. Test subprocesses
use the repository helper. They do not claim real producer or consumer coverage.
The conductor also runs the existing gate-reuse compatibility tests, required
convention bundle and unchanged integrated checks at the approved checkpoint.

Ledger and isocan required-stage manifests must follow their final phase 112/113
contracts; they are not fabricated here. Full phase 114 still needs real
producer evidence, per-project equivalence/invalidation review and an end-to-end
round trip through the existing validator before any reuse policy adoption.
No observed savings, complete consumer proof or authentication claim follows
from a successful shadow fixture. See the [staged spec](../specs/validation-efficiency.md).

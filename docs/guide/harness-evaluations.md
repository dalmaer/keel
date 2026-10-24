# Freeze harness evaluation records

`plates retro evaluations plan|freeze|inspect` is the available CLI surface. No runner, model request,
reservation, acceptance or promotion occurs. Schema-1 `retro sessions` is unchanged.

From this source checkout, create a synthetic Acme bundle in an external input
directory. Bundles contain private acceptance material: use a directory with mode
0700 outside Git, and set `umask 077` before redirecting any output. The helper
returns a fresh object and performs no I/O:

```sh
umask 077
mkdir -m 700 /absolute/inputs
node --input-type=module -e 'import { acmeEvaluationPlan } from "./tests/helpers/evaluation-plan.mjs"; console.log(JSON.stringify(acmeEvaluationPlan(), null, 2))' > /absolute/inputs/acme-plan.json
```

Use an external manifest with version 1, id `acme-workspace`, name `Acme`, repo
`Acme/private`, and projects `[{"id":"acme","repo":"Acme/widget"}]`.
Initialize storage separately; its parent must exist and it must not overlap the
manifest directory, application or any Git working tree:

```sh
node bin/plates.mjs workspace init --manifest /absolute/inputs/workspace.json --state /absolute/private-state --yes --json
node bin/plates.mjs retro evaluations plan --manifest /absolute/inputs/workspace.json --state /absolute/private-state --bundle /absolute/inputs/acme-plan.json --json
node bin/plates.mjs retro evaluations freeze --manifest /absolute/inputs/workspace.json --state /absolute/private-state --bundle /absolute/inputs/acme-plan.json --json
node bin/plates.mjs retro evaluations freeze --manifest /absolute/inputs/workspace.json --state /absolute/private-state --bundle /absolute/inputs/acme-plan.json --yes --digest DIGEST_FROM_FREEZE_PREVIEW --json
node bin/plates.mjs retro evaluations inspect --manifest /absolute/inputs/workspace.json --state /absolute/private-state --experiment acme-comparison --json
```

Preview freeze exits 3; plan and inspect exit 0; refusals exit 2. Plan creates
nothing. The preview digest binds exact bundle and manifest bytes, canonical
record hashes, workspace ownership and exact destination. The manifest must
list the comparison repository as its own repository or an authorized project.
Identical freeze retries return the original receipt only with the same canonical
bundle path, bytes, manifest and destination. Moving or copying identical bytes to
a different path changes the approval identity: the old digest is stale and a
new preview cannot replace the existing experiment. Inspect the original receipt;
restore the original input path for retry, or deliberately author a new comparison
ID for a new plan. Merely spelling the same canonical path relative to another
working directory does not change its identity. Changed inputs under the same
identity refuse. Interrupted, locked or corrupt storage requires inspection;
it is never reset automatically.

The helper is the complete small bundle example. Each record has schemaVersion,
kind, id, createdAt and digest. `sealRecord` hashes canonical JSON excluding only
its own digest; references contain kind/id/digest. Materials embed bounded UTF-8
bytes and have content-addressed immutable attachments. Case acceptance refers
to a material, separate from public brief. Context and overlays use ordered
`{path, material}` entries; inherited context must be listed in context. Paths
are normalized relative file paths. Exclusions match across arms. All nested
fields are strict. Image, dependency, installer, tool configuration and source
identities are declared hashes; unresolved model aliases require an explicit reason.
The synthetic fixture declares unknown currency as null, never zero. Its hashes
and placeholder checks establish record mechanics only, not executable images,
private held-out coverage or acceptance. Updating records requires resealing
references and their enclosing comparison. Later execution operations refuse.

Use canonical absolute paths: on macOS, resolve `/tmp` and `/var` aliases
with `realpath` first. Input and managed storage paths reject symlink components.
Declared image and tool hashes are not executable availability verification.

Each case needs at least one public requirement and provenance entry. Comparison
`authority` is `{kind:"phase",ref:"117"}` or
`{kind:"issue",ref:"Acme/widget#12"}`; the issue repository must match the
comparison, and numbers are positive (at most nine digits). Runtime/tool versions
are declared numeric version labels (optional `v`, dotted components and
prerelease/build suffix); moving labels such as `latest`, `main` and `HEAD` refuse.
Neither version labels nor hashes verify availability or reproducibility.

The acceptance/context guard detects byte-identical material, including copies
under different material IDs. It does not detect reserialized JSON, whitespace
changes, excerpts or semantic equivalents. Do not infer confidentiality from a
passing record check: the curator must keep private answers out of delivered
context, and phase 118 must independently enforce the builder/evaluator boundary.

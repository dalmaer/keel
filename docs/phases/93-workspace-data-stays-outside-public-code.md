---
status: designed
since: 2026-10-21
goal: G7
spec: 2
depends: []
note: "Authorized web workspace sequence; external storage boundary is the first implementation slice."
evidence: []
---

# Workspace data stays outside public code

## Done when

An explicitly configured external workspace can be inspected and initialized from the installed CLI without writing private data into application or project Git trees.

## Scope

Implement the version 1 manifest validator, canonical path resolver, exclusive ownership marker and workspace inspect/init CLI described in the workspace contract. This slice performs no network calls and makes no remote privacy claim.

Contract: [Private workspace, public Keel application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Valid bounded manifests and duplicate/unknown/invalid input refusals do not expose rejected values: `tests/workspace.test.mjs`.
- [ ] Canonical paths reject application overlap, Git-contained state, unsafe aliases, unowned state and mismatched markers without modifying existing data: `tests/workspace.test.mjs`.
- [ ] Preview is read-only, explicit initialization is private and retries are idempotent across processes: `tests/workspace-cli.test.mjs`.
- [ ] JSON, help, strict arguments and package-installed execution work without a source checkout: `tests/workspace-cli.test.mjs`.

## Real surfaces

- Published package: pack and extract the CLI, then inspect, preview, initialize and retry an external Acme workspace from a directory without a Keel source checkout.
- Owner's machine: run fresh-process CLI initialization and mismatch refusal against disposable external Acme paths; verify source status is unchanged.

## Proof

Named test paths are implementation targets until this phase is built, not
claims of existing checks or passing results.

- `node --import ./tests/helpers/hermetic.mjs --test tests/workspace.test.mjs tests/workspace-cli.test.mjs`
- `npm pack --ignore-scripts --pack-destination /tmp`, then the extracted CLI inspect/preview/init/retry/mismatch lifecycle with explicit disposable external Acme paths.
- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

Remote repository privacy, authentication and hosted deployment remain unverified until their own phases. No actual private repository or cloud resource is created by this phase.

## Next action

Implement the external workspace resolver and CLI, then prove the packed lifecycle.

## Trajectory

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.

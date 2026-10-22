# From Keel to Plates

Plates keeps projects moving with shared practices, bounded automation, and evidence-backed care. Each project is a **plate**. **All plates** is the view of projects the signed-in person can access; a workspace remains an access and storage boundary. Technical concepts such as projects, repositories, runs, changes, pull requests, and maintenance cycles retain their precise meanings. The existing conductor skill is now `/spin`, with `/conduct` retained as a compatibility alias. Its phase execution, proof, review, claims and permission rules are unchanged; there is no new CLI run type or spin instrumentation.

## Canonical names

| Before | Now |
| --- | --- |
| Keel | Plates |
| `keel` executable/package | `plates` |
| `.keel/keel.json` | `.plates/plates.json` |
| `.keel/` runtime directory | `.plates/` |
| `fleet.json` collection registry | `plates.json` |
| `scripts/keel/` | `scripts/plates/` |
| `.agents/skills/keel/` | `.agents/skills/plates/` |
| `keel-*.yml` managed workflows | `plates-*.yml` |
| `keel:begin` / `keel:end` managed blocks | `plates:begin` / `plates:end` |

The `fleet` CLI verb remains available for collection operations. The underlying project IDs, repository numeric IDs, and workspace memberships do not become new objects when their display names change.

## Migrate an existing checkout

Use the new CLI from outside or inside the old project; the migration does not require an already-renamed config:

```sh
plates migrate /path/to/project --json
plates migrate /path/to/project --yes --digest <digest-from-preview> --json
plates render --check
```

Review the preview's exact paths, changes, and refusals. The digest binds application to that inventory. The migration validates managed-file hashes before changing them, refuses conflicting destinations, and preserves opaque runtime journals byte for byte. Previously ignored runtime targets retain local Git-ignore protection before their bytes move. Its recovery receipt lives in Git metadata, outside the directory being renamed. An interrupted migration resumes the recorded operation; it does not invent a fresh plan over partial state. After migration, render the current practices through the normal reviewed update flow, run the project's own gate, and commit its complete file moves together.

Module references follow the inventoried file mapping. Unrelated package names and subpaths remain unchanged; a bare product dependency is renamed only when the owning package manifest identifies the supported product source. Ambiguous module expressions are preserved or refused, not guessed from their spelling.

Release rehearsal can apply this migration inside its disposable clone before testing the candidate practices. It keeps the original commit for a baseline comparison and pushes nothing. Ordinary project updates do not silently migrate a real checkout.

For a project collection, inventory each actual checkout and remote configuration first. Keep scheduled workflows and existing concurrency groups coordinated; changing a filename must not start a second independent schedule or allowance. Preserve the original deployment environment until the new revision and its consumers are verified. Git remotes and hosting project metadata are separate rollout steps from local file migration.

## Compatibility and deliberate old names

- `keel` remains an executable alias for the same `plates` entry point. New instructions use `plates`.
- Established `KEEL_*` environment bindings are accepted while canonical `PLATES_*` values take precedence. The web configuration supports the existing secret bindings without copying or rotating secrets. The Canvas tool-version pin has an explicit alias because its old variable included Keel twice.
- Remote project/config reads recognize `.keel/keel.json` only when `.plates/plates.json` is absent. Invalid new configuration is an error, not permission to silently use old settings.
- Existing Canvas ownership properties (`keel.project`, `keel.operation`, `keel.hash`, `keel.key`), journal artifact identities, verification recovery branch `keel-verify`, SQL schema/RPC names (including `public.keel_decision_rpc`), the `Keel-Operation` commit marker, encrypted-session namespaces, and session cookies remain durable protocol identifiers. Changing these would require a separate data migration.
- Existing queue branches, claim refs, labels, provenance fences, bounded PR-cache markers, and concurrency groups stay stable where readers or in-flight work rely on them. Historical `keel-measurements` fences remain readable alongside new `plates-measurements` fences.
- The existing `keel-night-plan` branch and its remote `.keel/night/plan.json` blob stay as one durable recovery identity. Local plans move to `.plates/night/plan.json`. Owner publication, automatic publication, ticks, and workflow readers use the same remote path; the rename does not create a competing nightly plan.
- Workflow-history readers must include the old and new exact workflow identities. Weekly robot usage survives the rename; unavailable history prevents admission rather than resetting the allowance. Recovery retains the selected original attempt's provenance.
- `lessonProject` optionally pins the stable lesson fingerprint identity across a repository rename. The Plates source retains `dalmaer/keel` for this field so previously sent lessons are not sent again; current source links use the current repository name.
- The source's `feedbackProject: "dalmaer/keel"` records this exact repository rename for private feedback replay. It preserves historical observation IDs, words and digest chains; current proposal destinations use `dalmaer/plates`. It is not a general alias for another project's store. Existing observations retain their original project when revised, while new observations can use the canonical repository.
- Private-inbox proposal readers recognize historical `keel learn: proposed` comments alongside canonical `plates learn: proposed` comments, using the newest matching proposal. Historical comments and issue identities are not rewritten.
- Dated evidence, old release notes, and recorded trajectories keep their original product terminology and claims. Working links may point at renamed files. A historical record is not a current usage example.

These exceptions preserve continuity; they do not retain a second product, scheduler, permission scope, or database. Remove compatibility only after its consumers and recovery horizon have been inventoried and tested.

## Release verification

The rename is ready only when canonical source and templates agree, managed-file rendering is clean, the full repository gate passes, and the consumer migration previews and gates succeed. Verify remote commits after repository renames, the exact deployed revision, sign-in/session continuity, All plates navigation, project reads, and applicable bounded actions. Record any remaining old-name exception with its owner and reason. A green local build alone is not deployment evidence.

Package entry paths follow the verified file and directory mapping, including nested manifests. Public export/import keys, command names and consumer package identities remain stable. Matching root lockfile command metadata follows the same move; mismatches and unsupported affected workspace/local-link graphs refuse before writes. Ambiguous packaging patterns also require an explicit migration. These path fields are described in the [npm package manifest reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).

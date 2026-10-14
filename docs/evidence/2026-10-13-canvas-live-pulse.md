# Evidence: phase 50 — the stable live pulse on isocan's conditional edit

- Date: 2026-10-13
- Phase: [50](../phases/50-project-life-on-isocan.md)
- Revision: base `80a65d4` plus the working tree, landed as
  `phase 50: the pulse stays one card, updated only when nobody changed it`.
- Source: isocan `7bb1f4e9f` on `main`, released on `release` as `800d6c7d3`;
  CLI `0.1.0 (7bb1f4e, 2026-10-13)`.
- Claim being checked: a binding moved to live mode keeps one pulse item and
  updates it only through isocan's conditional edit; a person's edit is never
  overwritten; an ambiguous outcome is retried as the same act.

**No real canvas was written.** Nothing here touched isocan.io, any real
identity, or the approved canvas. Every proof below ran on a fake transport or
on a throwaway isocan daemon bound to loopback with a made-up identity.

## isocan's contract, as inspected

Read through `gh api` at `7bb1f4e9f`: `packages/cli/src/conditional-edit.ts`,
the `edit` and `version prune` commands in `packages/cli/src/main.ts`,
`packages/cli/test/conditional-edit.test.ts`, and the agent guide section
"Keeping one card current". The `release` branch ships the built CLI and the
agent guide only, not `packages/cli/src`; its guide is byte-identical to main's
at that commit, and its `package.json` says it was built from `7bb1f4e`.

The CLI was installed into a scratch directory with
`npm i --ignore-scripts github:dglazkov/isocan#release` (not globally; the
installed `isocan` was not upgraded). `--version` printed
`0.1.0 (7bb1f4e, 2026-10-13)`. `edit --help` and `version prune --help` list
the flags the statement names.

The statement keel was given holds. What the source and the walk add to it:

| Observed | Consequence for keel |
| --- | --- |
| With `--op-id`, the CLI skips its own stale pre-check; the home decides. Blobs are uploaded before a refusal. | A refusal still writes no op. Keel always sends an op id. |
| With `--op-id`, the conflict `reason` is the same sentence whether the version or the metadata moved. | Keel classifies it: a different `currentVersionId` is `version`, otherwise `metadata`. |
| `title` and `properties` in an `applied` or `replayed` answer are a re-read after the home answered, not what the op wrote. | Keel records what it wrote as the next base, so a change made since then refuses the next edit. |
| The JSON has more fields than stated: `itemId`, `opId`, `seq` on success; `expectedVersionId`, `reason` on conflict; `itemId`, `reason` on unsupported. | Keel checks `itemId` and ignores the rest. |
| `add` tags a file-backed card with `sourcePath`, `file` and `visualFile` properties. | The expected metadata is read from the card, not rebuilt from what keel set. |
| `--visual` combines with `--if-version`: both faces land in the one version. Without `--visual` an existing visual face is carried forward. | Keel always sends the visual, and refuses to drop one from a live card. |
| `version prune` answers `{pruned, dropped, keep}`; nothing to prune is `dropped: 0`, exit 0. | A prune that drops nothing is a success. |
| A local canvas is born with an "anyone with the link" grant. | Keel's owner-only admission refused it until the walk turned the link off. |

`unsupported` (exit 5) was read in the source and not observed: it needs a home
older than September 2026.

## Automated checks

```sh
node --import ./tests/helpers/hermetic.mjs --test \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout \
  tests/canvas-snapshot.test.mjs tests/canvas-render.test.mjs tests/canvas-sync.test.mjs \
  tests/canvas-retro.test.mjs tests/canvas-night.test.mjs tests/canvas-cli.test.mjs \
  tests/canvas-package.test.mjs
```

Exit 0 at `6fec758`: 118 tests passed, zero failed; the test ledger reported
no flaky or slower test. After the two review fixes below the same seven
files hold 122 tests; they ran inside `npm run check`, not as a separate
focused run. The fake transport models the home's decision (conflict, replay
by op id, unsupported) and has no unconditional edit method. No test uses the
network.

Two guards were removed in turn, in the builder's worktree, to see their tests
fail: without the sticky refusal, "conflict by version" failed; without the
read-back check, "an applied edit a person changes before keel reads it back"
failed. Both were restored.

`npm run check` is the integrated gate; its result goes in the commit body.

### Review fixes, same day (PR #126)

Both were found by review, not by the tests above, and neither was walked
against the real CLI; the fake transport is their only proof.

1. `fab59cc`: a pulse a person changed after live was enabled and before its
   first live sync had no way out. `keel canvas rebase` now adopts it.
   `keel prove tests/canvas-sync.test.mjs --name "before its first live sync"
   --fix lib/canvas-sync.mjs`: VERIFIED, red at `6fec758`, green with the fix.
2. The following commit: adoption compared only keel's three properties, the
   title and the hashes, so a property a person added before the first live
   sync became the conditional base and the edit succeeded. Immutable
   publication now records the pulse's full metadata as read back, adoption
   compares all of it, and a receipt without it requires the explicit re-base.
   Three tests, each red at `fab59cc`: "a property a person adds before the
   first live sync refuses adoption…", "a receipt from before keel recorded
   full metadata is never assumed unchanged…", "a receipt with recorded,
   unchanged metadata adopts on the first live sync with no extra step…".

Keel's edit sends `--prop keel.hash` and `--prop keel.operation`, `--title`
only when keel's title differs, and never `--rm-prop`: it cannot remove or
overwrite a property it did not set. The first test asserts the person's
property is still on the card after keel's edit.

The local-daemon walk in the table below predates both fixes. Its pulse was
published by the build before recorded metadata, so on the current code that
same walk would stop at the first live sync and need one re-base.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Real `isocan` 7bb1f4e against a throwaway local daemon (`ISOCAN_HOME` in scratch, loopback port, identity `usr_acme`): `add`, then `edit --if-version --if-meta --op-id` four ways | applied; replayed; conflict by version; conflict by metadata | Exit 0 `applied`; same op id again: exit 0 `replayed`, same `versionId`; new op id on the stale version: exit 4 `conflict`; after `set --title`: exit 4 `conflict` with the new title and the unchanged version | The CLI's exit codes and JSON are as keel reads them. Not a deployed home. |
| Same daemon: `version prune <item> --keep 1 --force`, twice | drops one, then nothing | `dropped: 1`, then `dropped: 0`, both exit 0 | The retention call and its answer. |
| `keel canvas` (this worktree) driving that real CLI and daemon: connect, sync, `live --keep 3` preview then `--yes`, change a source, `sync --dry-run`, `sync --yes`, `sync --yes` | adopt the published pulse; edit in place; then unchanged | Preview exit 3 with `adopt-live-on-first-sync`; sync `published`, `live[0].status: applied`, pulse at 2 versions, same item id; next sync `unchanged` | Keel's real argument arrays, hash read-back of both faces and adoption work against the real CLI. |
| Same walk: rename the pulse as a person, change a source, `sync --yes` twice, `status` | refusal, nothing written, sticky | Exit 1 `conflict`, `reason: metadata`, `seen: read`, both times; `status` exit 1; the card still had 2 versions and the person's title | The pre-write refusal. The mid-edit race (exit 4 through keel) was not induced here; the fake transport covers it. |
| Same walk: `rebase` preview, `rebase --onto <id> --yes`, `sync --yes` | re-base, then publish on top | Preview exit 3; `rebased`; sync `published`, pulse at 3 versions, one pulse card on the canvas | The owner's explicit path. Found that `--version` cannot be the flag: it is keel's own. |
| Deployed concurrent-edit walk in a browser on the approved canvas | | Not run | Owed. |
| Night with a real GitHub writer, live mode, restart | | Not run | Owed. |
| Moving the approved binding to live | | Not run | The owner's decision. |

## Gaps and decision

Live mode is implemented and proven on synthetic and local transports. It is
not a deployed proof: no home on the network, no second person, no browser.
Atomic multi-card publication does not exist in isocan and is not simulated.
The approved binding is still immutable. Phase 50 stays `partial`.

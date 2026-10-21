# Feedback on the result you reviewed

`plates feedback` retains a private observation tied to an immutable result. It
can prepare a follow-up for review; it never creates an issue, starts an agent,
accepts a decision or marks a phase accepted. This is the local CLI workflow.
[Guided browser walks](web-walks.md) reuse its private observation model and issue
handoffs; their hosted migration and real-owner source-write proof remain pending.

## Capture an observation

Write a schema-1 JSON record outside tracked project content. For example:

```json
{
  "schema": 1,
  "project": "acme/studio",
  "source": { "id": "owner-note-1", "kind": "manual" },
  "author": { "kind": "manual", "name": "Acme Owner" },
  "observedAt": "2026-10-21T18:00:00.000Z",
  "words": "The second row disappears after refresh.",
  "revision": 1,
  "previousDigest": null,
  "result": {
    "sourceRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "artifactId": "preview",
    "version": "v1",
    "contentHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "file": "/absolute/path/to/reviewed-result.html"
  }
}
```

Replace the example revision and hash with the actual full source commit and
SHA-256 of the exact reviewed bytes. The repository must match `.plates/plates.json`.
Manual attribution records what you supplied; it is not provider authentication.
Optional `result.work` is `{ "kind": "phase", "ref": "92" }`, or an `issue`/`pr`
with a reference such as `acme/studio#12`. `result.anchor` identifies a location
within the result. Optional `conflicts` contains explicit `{ref, reason}` entries
for accepted canonical decisions; Plates does not infer disagreement from words.

```sh
plates feedback capture /private/acme-note.json --json
plates feedback capture /private/acme-note.json --yes --digest <preview-digest> --json
plates feedback list --json
```

Capture previews exit 3 and write nothing. Copy the returned `digest` into the
second command after reviewing it. The paired `--yes --digest` flags authorize
only those exact bytes; a stale digest refuses. Success exits 0, invalid or
refused input exits 2. All four subcommands accept `--json`.

Stored observations use `.plates/feedback/` with restricted permissions. Plates
checks that storage is untracked and ignored before persisting, adding a local
Git exclude when needed. Every actual private destination is checked, including
against negated Git ignore rules. A store-local `.npmignore` excludes retained
copies from ordinary npm package exports; a missing or conflicting exclusion
refuses access rather than overwriting project rules. The project-root
`.npmignore` stays untouched. Git identity must be available to verify this
boundary; missing Git coverage is unavailable, never an empty verified inbox.
Your authored input files are your responsibility:
keep private words and snapshots out of commits. Capture does not move, delete or
redact your input files, and does not ignore the original result file (which may
legitimately be application source). Capture/list output and the
board contain metadata, never the raw words or private paths.

The same source, artifact and result version deduplicate. Changed words require
the next `revision` and the current item's `digest` as `previousDigest`; earlier
words and resolutions remain. A new result version is a separate observation.
A verified retained result survives changes to its original file. Missing or
corrupt retained bytes remain a gap and prevent follow-up proposals; Plates never
substitutes the latest version. Unsupported provider references remain unavailable.

## Propose follow-up work

Create a publication JSON record with `schema: 1`, the current `feedbackDigest`,
an exact `excerpt` from the stored words, the configured repository as
`destination`, a `title`, and the existing version-1 robot `rubric` containing
`problem`, `reproduction`, `acceptance`, `change`, `prerequisites` and
`ownerBlockers`.

```sh
plates feedback propose <id> --record /private/acme-publication.json --json
```

This is an explicit publication preview: inspect its exact excerpt, outbound
body, destination, route, digest and issue handoff inputs. Open work proposes a
follow-up; closed work proposes linked repair/change. Unknown fresh GitHub state
blocks routing. A declared accepted-decision conflict proposes reopening, never
a replacement decision. A local phase is planning context, not closure evidence.

When a conflict requires reopening, include `shaping` in the publication record:
an explicitly authored version-1 [shaping record](../../practices/shaping/files/docs/shaping.md).
It must reference each conflicted decision and pass the existing validator. Plates
returns that draft with a `plates shape check` handoff; it invents no goal, proof
command or owner answer. Without the draft, the preview reports
`{"error":"shaping_draft_required"}`. Save it privately and review it through shaping before
approving any resulting plan. Supplied answers remain manual attribution.

Delivery is a separate, explicitly approved `plates issue new --agent` operation
using the preview's handoff inputs. It reuses the existing issue identity and
recovery journal. A feedback preview is not delivery approval. An uncertain issue
write must recover its original intent; never create a second issue to retry.

## Resolve an observation

A resolution JSON record contains `schema: 1`, current `feedbackDigest`,
`state`, manual `actor: {kind: "manual", name: "Acme Owner"}`, and UTC `at`.
For `linked`, supply `reference` to the resulting proposal or issue. For
`declined`, supply `reason`. For `superseded`, supply `supersededBy`, the ID of
another existing observation in this project.

```sh
plates feedback resolve <id> --record /private/acme-resolution.json --json
plates feedback resolve <id> --record /private/acme-resolution.json --yes --digest <preview-digest> --json
```

Resolution history remains intact. Editing resolved feedback creates a new
pending revision. An issue closing is not proof of satisfaction or acceptance.
The existing local board adds “Feedback to review” with bounded metadata and
resolution links; it is not another dashboard or a publication surface.

Storage is bounded to 1,000 observations and 50 MiB total, including retained
revisions and results; each record is at most 256 KiB and each result 2 MiB.
Capacity exhaustion refuses visibly and never deletes observations to make room.
Retention and exports require explicit owner work; no automatic deletion is enabled.

If an interrupted write returns `{"error":"writer_busy"}`, the lock alone does not block reads;
incomplete records or temporary files may still make coverage unavailable. Confirm
that all feedback writers have stopped before using `rmdir .plates/feedback/.lock` from the
project root. Remove only that empty lock directory; preserve observations,
snapshots and temporary files for inspection. Plates never assumes that a lock is
abandoned because it is old.

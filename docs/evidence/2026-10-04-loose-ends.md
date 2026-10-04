# Evidence: phase 24 — loose ends

- Date: 2026-10-04
- Phase: 24
- Revision: the phase 24 commit.

| Check | Result |
| --- | --- |
| `npm run check` (conductor) | exit 0. `ℹ tests 270` · `ℹ pass 270` · `ℹ fail 0` |
| `tests/loose-ends.test.mjs` (7) | Synthetic transcripts, built from the real *shapes* (keys and types only, never content), plus synthetic repos and a stub gh. Covers classification, committed work not listed, marks (park reappears after its date, drop never), and per-kind commands |
| Mutation: the committed-work skip removed | the test fails |
| Leak test: a marker in synthetic chat text, through list and `mark` | the marker is in no file. Making `mark` store the item's title fails it, naming `.keel/loose-ends.json` |
| Real run on the owner's Mac (`keel loose-ends`, reads only) | exit 0, 25 items. **keel:** 1 open session, 8 uncommitted files (the other session's keel/nerd research among them), 2 owner-waiting phases (11, 16), the health proposal, 4 recent repos not in `fleet.json` (including **keel-walk**). **ledger:** 5 uncommitted files, 1 unmerged branch (16 days old), 2 extra worktrees, the health proposal. duo and cajones: nothing loose. No open PRs. No marks file written |

Decisions taken while building, kept:
- **Recent repos not in `fleet.json`** are a loose-end kind. That's how keel-walk surfaces.
- **The person's message with no reply** counts as mid-work.
- **`--all`** shows parked and dropped items.

The two "ended on a question" rules are recorded in the `loose-ends` topic
as open, to be measured. On 9 real transcripts, 2 ended on a question, and
both had their work committed.

Supports **built**.

# Evidence: phase 25 — lessons don't wait

- Date: 2026-10-04
- Phase: 25
- Revision: the phase 25 commit.

| Check | Result |
| --- | --- |
| `npm run check` (conductor) | exit 0 (count in the commit body) |
| `lessons_unsent` | Shares `lessonFingerprint` and `parseLessons` with `keel lessons` (both now in the shipped lib.mjs). The shared-fingerprint test fails on two mutations (raw shape; name instead of repo). n/a on keel ("keel is home") and with no table; an unreadable `sent.json` is broken. The selftest has all 14 measures outside |
| loose-ends `lessons` item | Lists the count and the send command, and a mark persists across counts |
| Real send | `keel lessons --yes` from fresh clones: duo 4 and cajones 4 filed to `dalmaer/keel-inbox`; a second run of each: "Nothing new to send (4 already sent)". Their sent.json: https://github.com/dalmaer/duo/pull/51 and https://github.com/dalmaer/cajones/pull/27, green and merged |
| Triage | The agent proposed 6 links, 1 lesson and 1 decline. The owner accepted all as proposed (4 Oct). `keel learn`: 41 decided, 0 proposed. Lesson 29 ("A run that finishes is reported as succeeding") added in general wording |
| duo, measured from a copy of its GitHub files | `lessons_unsent` ok, 0 ("all 4 sent") |

Supports **built**.

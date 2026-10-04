# Evidence: phase 23 — no guessing

- Date: 2026-10-04
- Phase: 23
- Revision: `5f47de4` (the last fixes), plus this record.

Four fresh-agent walks. Each started in an empty directory with an empty
npm cache (a new machine), ran keel only as `npx -y github:dalmaer/keel`,
and conducted a new project's phase 0 using only that project's own files.

| Walk | Project | Result | Frictions |
| --- | --- | --- | --- |
| 1 (phase 3's) | acme-tally | built (local keel path given) | 11 |
| 2 | acme-shelf | **blocked**: `init` failed under npx because npm strips `.gitignore` (lesson 28); fixed in `b269dad`, then re-run | — |
| 2b | acme-shelf | built, 15 tests, doctor clean | 10 |
| 3 | acme-notes | built, 14 tests, doctor clean | 7, two of them steps impossible as written (record-before-gate circularity) |
| 4 | acme-timer | built, 11 tests, doctor clean, `keel next`: nothing left | **A: none, B: none**; 2 minor points (C) |

Walk 4 included the proof walked after the phase's commit, and the
follow-up commit that records it. These were the steps walk 3 found
circular.

`npm run check` on keel: exit 0, 261 tests.

Supports **built**.

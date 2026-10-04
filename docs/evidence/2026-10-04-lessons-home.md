# Evidence: phases 7 and 21 — lessons come home, privately

- Date: 2026-10-04
- Phases: 7 (lessons go home), 21 (privately)
- Revision: keel `a256982` (the private inbox), plus this commit (bold
  shapes, the waiting count, rows 19–27).

## The round trip

| Step | Observed |
| --- | --- |
| Dry run from a fresh ledger clone | 33 items (28 lesson rows, 5 practice commits). The full rows carry personal details, and keel is public, so the owner chose a private inbox |
| ⚑ `gh repo create dalmaer/keel-inbox --private` (owner's yes) | PRIVATE, with a `lesson` label |
| `keel lessons --yes` from the ledger clone | 33 filed to `dalmaer/keel-inbox` (#1–#33). A second run: `Nothing new to send … (33 already sent)` |
| ledger's record: https://github.com/dalmaer/ledger/pull/24 | `.keel/sent.json`, CI green, merged |
| Agent proposals (`keel learn propose <n> … --yes`, 33 times) | 10 lesson, 5 link, 18 decline in the agent's summary; its table had 9 lesson proposals, which the owner saw. Each read cites a path or sha. No instruction-shaped text |
| Owner's decision (4 Oct): accept all as proposed | `keel learn decide` 33 times: 9 accepted, 5 linked, 19 declined. `keel learn`: `33 decided` |
| keel's public lessons table | Rows 19–27 added, with exactly the shape, cost and guard wording the owner approved, credited `*(dalmaer/ledger)*` only |
| Leak scan of keel's docs and lib for the private details | No hits except the public audit page, which lists them as search patterns |
| Leak test (`tests/learn-private.test.mjs`) | A marker planted in private issues appears in no file after gather, propose and decide. Making gather write proposal files fails the test |

## Gaps and decision

- keel's nightly runs `keel learn` with a token that can't read the
  private inbox. That's by design: it notes the failure and keeps the last
  counts, and a person runs `keel learn` locally to triage.
- Supports **built** for both phases.

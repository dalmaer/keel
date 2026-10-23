---
status: built
since: 2026-10-04
goal: G3
depends: [7, 8]
note: "ledger's 33 lessons went to the private plates-inbox, were proposed on and decided there (9 accepted, 5 linked, 19 declined), and only the owner-approved general wording reached plates's lessons table (rows 19–27)."
evidence: ["evidence/2026-10-04-lessons-home.md"]
---

# A private project's lessons come home without being published

## Done when

`plates lessons` from ledger files into the private `dalmaer/plates-inbox`, `plates learn` proposes and records decisions there, and the only thing that reaches public plates is a lesson row the owner accepted, written in general terms.

## Scope

- **Config.** plates's own `.plates/plates.json` gains `inbox: "<owner/repo>"`.
  `plates lessons` files there by default (`--to` still overrides), and
  `plates learn` reads there. With no `inbox`, nothing changes: issues go to
  plates's repo, as today.
- **Triage stays private.** With a private inbox, `plates learn` keeps
  proposals and decisions on the inbox's issues:
  - a `proposed:<outcome>` label and a comment carrying the read;
  - a `decided:<outcome>` label plus closing with the note.

  It writes nothing quoting a claim into plates's public `docs/inbox/`.
  `docs/INBOX.md` shows counts only for a private inbox.
- **What reaches plates.** Accepting a `lesson` writes a row to plates's
  `docs/lessons.md` from text the person approves (`--shape`, `--cost`,
  `--guard`), never the issue body verbatim. Provenance names the project
  only.
- **The project's record.** `plates lessons` writes `.plates/sent.json` in the
  project, which then lands there as a data PR.

## Acceptance

- [x] With `inbox` set, `plates lessons --yes` files into it (stub), and `plates learn` reads from it.
- [x] A test proves no claim text from a private inbox appears in any file `plates learn` writes in plates's tree.
- [x] `plates learn decide … accepted` with `--shape/--cost/--guard` writes exactly those words to plates's lessons table; without them it refuses for a private inbox.
- [x] ⚑ `dalmaer/plates-inbox` exists, private, with a `lesson` label.
- [x] A real run: ledger's lessons filed into the inbox, one triaged to a decision, and the resulting public row (if accepted) reviewed by the owner.

## Proof

- Automated: `node --test` on the lessons and learn tests, plus a leak test.
- By hand: the real filing from a ledger clone; `plates learn` on plates; one
  decision; ledger's `.plates/sent.json` PR.
- ⚑ Creating the repo.

## Deliberately open

- **Whether projects other than ledger default to the private inbox.**
  Yes: `inbox` is plates's setting, not the project's.

## Next action

None.

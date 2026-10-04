---
status: planned
since: 2026-10-04
goal: G3
depends: [7, 8]
note: "keel is public and ledger is private; its 33 lessons carry personal details. The owner chose a private inbox (4 Oct)."
evidence: []
---

# A private project's lessons come home without being published

## Done when

`keel lessons` from ledger files into the private `dalmaer/keel-inbox`, `keel learn` proposes and records decisions there, and the only thing that reaches public keel is a lesson row the owner accepted, written in general terms.

## Scope

- **Config.** keel's own `.keel/keel.json` gains `inbox: "<owner/repo>"`.
  `keel lessons` files there by default (`--to` still overrides), and
  `keel learn` reads there. With no `inbox`, nothing changes: issues go to
  keel's repo, as today.
- **Triage stays private.** With a private inbox, `keel learn` keeps
  proposals and decisions on the inbox's issues:
  - a `proposed:<outcome>` label and a comment carrying the read;
  - a `decided:<outcome>` label plus closing with the note.

  It writes nothing quoting a claim into keel's public `docs/inbox/`.
  `docs/INBOX.md` shows counts only for a private inbox.
- **What reaches keel.** Accepting a `lesson` writes a row to keel's
  `docs/lessons.md` from text the person approves (`--shape`, `--cost`,
  `--guard`), never the issue body verbatim. Provenance names the project
  only.
- **The project's record.** `keel lessons` writes `.keel/sent.json` in the
  project, which then lands there as a data PR.

## Acceptance

- [ ] With `inbox` set, `keel lessons --yes` files into it (stub), and `keel learn` reads from it.
- [ ] A test proves no claim text from a private inbox appears in any file `keel learn` writes in keel's tree.
- [ ] `keel learn decide … accepted` with `--shape/--cost/--guard` writes exactly those words to keel's lessons table; without them it refuses for a private inbox.
- [ ] ⚑ `dalmaer/keel-inbox` exists, private, with a `lesson` label.
- [ ] A real run: ledger's lessons filed into the inbox, one triaged to a decision, and the resulting public row (if accepted) reviewed by the owner.

## Proof

- Automated: `node --test` on the lessons and learn tests, plus a leak test.
- By hand: the real filing from a ledger clone; `keel learn` on keel; one
  decision; ledger's `.keel/sent.json` PR.
- ⚑ Creating the repo.

## Deliberately open

- **Whether projects other than ledger default to the private inbox.**
  Yes: `inbox` is keel's setting, not the project's.

## Next action

Create `dalmaer/keel-inbox` (owner's yes, 4 Oct), then build `inbox` into
lessons and learn.

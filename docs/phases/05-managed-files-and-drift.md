---
status: planned
since: 2026-10-02
goal: G2
depends: [1]
note: "Motivated by lesson 1: isocan's untracked second copy of conduct was twelve days stale."
evidence: []
---

# Keel knows when a project has changed the practice, and treats it as signal

## Done when

`keel doctor` reports every managed file and block whose bytes differ from what keel wrote, and for each offers eject, restore, or send-as-lesson — never reverting on its own.

## Scope

`.keel/lock.json` (path → practice, version, sha256 at write). Managed files
carry a one-line header naming the practice and how to change it. `doctor` also
lints the practice's own rules (a phase without Done when, a second copy of a
skill outside `.agents/skills`, a CLAUDE.md that is more than a pointer).

## Acceptance

- [ ] Editing a managed file is reported, with a diff against keel's version.
- [ ] A copied skill outside `.agents/skills/` is reported (the lesson 1 shape).
- [ ] `--json` output is what `improve` and `lessons` consume.
- [ ] `doctor` changes nothing unless a fix is chosen.

## Proof

`node --test tests/doctor.test.mjs` with a temp project, edited and copied files.

## Deliberately open

- Whether block regions in AGENTS.md should be hashed per block or as one. Per block, probably — settle with phase 1's choice.

## Next action

Define lock.json's shape in design.md and write the drift test before the command.

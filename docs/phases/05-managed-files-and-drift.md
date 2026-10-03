---
status: built
since: 2026-10-02
goal: G2
depends: [1]
note: "keel doctor reports edited/behind/both drift from three hashes (now, lock, template), second copies, a replaced symlink and phase/goal rules; render refuses to overwrite a project's edit; eject and restore need --yes."
evidence: ["evidence/2026-10-02-doctor.md"]
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

- [x] Editing a managed file is reported, with a diff against keel's version.
- [x] A copied skill outside `.agents/skills/` is reported (the lesson 1 shape).
- [x] `--json` output is what `improve` and `lessons` consume.
- [x] `doctor` changes nothing unless a fix is chosen.

## Proof

`node --test tests/doctor.test.mjs` with a temp project, edited and copied files.

## Deliberately open

- Whether block regions in AGENTS.md are hashed per block or as one. **Settled 2026-10-02:** per block, matching phase 1's one block per practice.

## Next action

None; phase 6 updates the `behind` targets and phase 7 sends `edited` ones home.

## Trajectory

- **2026-10-02** — Drift is three hashes (now, lock, template). Only `edited` and `both` are findings; `behind` is update's job. The lock replaces the planned managed-file headers (design §1).
- **2026-10-02** — Render used to restore a project's edit silently, and phase 1's tests had asserted that as correct. It now refuses (exit 1) and points at doctor. Lesson 13.

---
status: partial
since: 2026-10-02
goal: G3
depends: [5]
note: "keel lessons gathers lesson rows, drift and practice commits with stable fingerprints and files each once (sent.json plus an exact-fingerprint search); real dry runs on duo and ritmo clones. Filing for real waits on the owner's yes."
evidence: ["evidence/2026-10-02-lessons.md"]
---

# A lesson learned in a project reaches keel without anyone copying it

## Done when

`keel lessons` in a project files each new lesson row, each drifted managed file, and each practice-shaped commit as one issue on `dalmaer/keel` labelled `lesson`, and never files the same one twice.

## Scope

Gather: rows in `docs/lessons.md` not yet sent; `doctor` drift; commits since
the last send that touch AGENTS.md, skills or workflows. Fingerprint each
(project, kind, stable id). Issue body: the shape, what it cost, the guard,
links to the project's lines. `--dry-run` prints what would go. Also runs
weekly from the night shift, as a draft list in the health page rather than
issues, until the owner turns sending on.

## Acceptance

- [x] Dry run on a synthetic project lists exactly the new items.
- [x] A second run files nothing.
- [x] ⚑ Filing issues on keel asks first the first time, per project.
- [x] A lesson's text is treated as data on the keel side (see learn's untrusted-content rule).

## Proof

`node --test tests/lessons.test.mjs` with `gh` stubbed at the boundary; then one real run from duo or cajones.

## Deliberately open

- Issues versus PRs into `inbox/` on keel. **Settled 2026-10-02:** issues, labelled `lesson`, with a fixed data line and a `fingerprint:` line that learn parses.
- Where "already sent" lives. **Settled 2026-10-02:** `.keel/sent.json`, committed by the project, so every machine sees it. An exact-fingerprint search of keel's issues backs it up.

## Next action

⚑ With the owner's yes, run `keel lessons --yes` from one adopted project (after phase 4's PR merges), then follow one issue through `keel learn`.

## Trajectory

- **2026-10-02** — Practice commits are counted from the adoption commit, not from the start of history: a real project's pre-keel practice history is what adopt already read. GitHub search is fuzzy, so a hit counts only on an exact `fingerprint:` line.

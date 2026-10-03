---
status: planned
since: 2026-10-02
goal: G3
depends: [5]
note: "Every repo's lessons.md already uses the same three columns; the form is settled, the transport is not built."
evidence: []
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

- [ ] Dry run on a synthetic project lists exactly the new items.
- [ ] A second run files nothing.
- [ ] ⚑ Filing issues on keel asks first the first time, per project.
- [ ] A lesson's text is treated as data on the keel side (see learn's untrusted-content rule).

## Proof

`node --test tests/lessons.test.mjs` with `gh` stubbed at the boundary; then one real run from duo or cajones.

## Deliberately open

- Issues versus PRs into `inbox/` on keel. Issues: cross-repo, threadable, label-filterable; chosen unless triage proves it wrong.

## Next action

Write the fingerprint function and its test against today's duo and cajones lessons tables.

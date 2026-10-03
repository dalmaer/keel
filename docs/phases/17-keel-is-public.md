---
status: planned
since: 2026-10-03
goal: G3
depends: [15]
note: "The owner decided keel goes public (3 Oct) so isocan and others can use it; Apache-2.0. Waits on a review of everything that would become public."
evidence: []
---

# Anyone can install keel, and nothing private comes with it

## Done when

`dalmaer/keel` is public under Apache-2.0, a plain `git clone` and `npm install -g` work on a machine with no GitHub login, and a review shows nothing in the tree or its history that the owner wouldn't publish.

## Scope

- Add `LICENSE` (Apache-2.0) and a `NOTICE` crediting isocan's adapted
  material.
- **Audit the tree and the full git history** for content from private
  repos, and for anything personal:
  - quoted ledger content in lessons, evidence and research;
  - absolute local paths;
  - private repo names;
  - the session's scratch paths.

  If anything should not be public, stop and show the owner before
  rewriting anything. Rewriting history is the owner's call.
- Install docs say `git clone https://github.com/dalmaer/keel`, not
  `gh repo clone`.
- ⚑ Flip the visibility.

## Acceptance

- [ ] `LICENSE` and `NOTICE` exist, and each adapted file's header still credits its source.
- [ ] A written audit (`docs/evidence/`) lists every hit for private content in the tree and the history, with a decision for each.
- [ ] The owner has seen the audit's hits before the flip.
- [ ] ⚑ The repo is public; `git clone` plus `npm install -g` with an empty `HOME` works.

## Proof

- Automated: grep-based audit commands named in the evidence.
- By hand: the empty-HOME install walk after the flip.
- ⚑ `gh repo edit dalmaer/keel --visibility public --accept-visibility-change-consequences`
  is run only after the owner has seen the audit.

## Deliberately open

- **Whether private-repo content quoted in keel's history is acceptable.**
  For example, ledger's lessons are summarised in keel's lessons and
  research. Decided by the owner, from the audit.

## Next action

Run the audit: grep the tree and `git log -p` for ledger and cajones content,
absolute paths and private repo names, and write the hits up.

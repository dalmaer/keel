---
status: planned
since: 2026-10-02
goal: G1
depends: [2]
note: "The walk is known from isocan's new-project.md and how duo and cajones were started by hand."
evidence: []
---

# A new project, from an empty directory, ready to conduct the same day

## Done when

`keel init <name>` in an empty directory produces a git repo with the practice installed, a goal and a phase 0 drafted from a one-paragraph description, and a passing `npm run check`; with `--github` it is also a private repo with CI green.

## Scope

Interview kept to what the project cannot be started without: name, one
paragraph of what it is, kind (static site, node CLI, web app, other). Seeds
`goals.json` with one goal and phase 0 ("the practice room": the thinnest
thing that runs), `docs/lessons.md` with the inherited shapes that apply, the
`.keel/keel.json`. `--github`: ⚑ `gh repo create --private`, push, labels,
optional project board, optional Pages. Prints the secrets each installed
workflow will need and whether they are set (`gh secret list`), never sets one.

## Acceptance

- [ ] Local init in a temp dir passes `npm run check` with no network.
- [ ] Re-running init on an initialised directory refuses, and says to use `adopt` or `update`.
- [ ] `--github` asks before creating anything, and names what it will create.
- [ ] The first commit's message says which keel version made it.
- [ ] A conducted session can run phase 0 of the new project with no further setup.

## Proof

`node --test tests/init.test.mjs` (temp dir, no network). ⚑ One real `--github` init of a throwaway repo, CI watched to green, then deleted by the owner.

## Deliberately open

- Whether init writes app scaffolding (vite, etc.) or only the practice. Lean: practice only, plus a one-line hint per kind; scaffolds age faster than practices.

## Next action

Write the init test against a temp directory first, asserting the tree and the passing check.

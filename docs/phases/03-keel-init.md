---
status: partial
since: 2026-10-02
goal: G1
depends: [2]
note: "Local init works end to end and passes the new project's own check; --github asks (exit 3) and acts only with --yes. The real GitHub walk waits on the owner's ⚑ yes."
evidence: ["evidence/2026-10-02-init.md"]
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

- [x] Local init in a temp dir passes `npm run check` with no network.
- [x] Re-running init on an initialised directory refuses, and says to use `adopt` or `update`.
- [x] `--github` asks before creating anything, and names what it will create.
- [x] The first commit's message says which keel version made it.
- [ ] A conducted session can run phase 0 of the new project with no further setup.

## Proof

`node --test tests/init.test.mjs` (temp dir, no network). ⚑ One real `--github` init of a throwaway repo, CI watched to green, then deleted by the owner.

## Deliberately open

- Whether init writes app scaffolding (vite, etc.) or only the practice. **Settled 2026-10-02:** practice only, plus a one-line hint per kind in AGENTS.md; scaffolds age faster than practices.
- Labels, project board, Pages on `--github`. Not built; add when a second project wants them.

## Next action

⚑ With the owner's yes: `keel init /tmp/keel-walk --description "A throwaway to prove keel init." --github --yes`, watch its check.yml go green, then the owner deletes `dalmaer/keel-walk`. Then conduct phase 0 of a fresh project once to close the last box.

## Trajectory

- **2026-10-02** — `--github` without `--yes` writes nothing locally either; exit 3 means "needs a yes". Otherwise the `--yes` rerun hits init's own already-a-project refusal. This is the pattern for every outward keel verb.

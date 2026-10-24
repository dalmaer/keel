---
status: planned
since: 2026-10-23
goal: G2
spec: 2
depends: [125, 126, 127]
note: "Specified 2026-10-23 (docs/specs/name-transition.md). The names plates can't change on its own: GitHub labels, repository variables and secrets, Vercel env, and the owner's machine. One command lists them per project, and moves each with the owner's yes."
evidence: []
issue: 244
---

# What the owner holds moves with the owner's yes

## Done when

`plates names` lists, for plates and each fleet project, every keel name still live outside the repository:
- labels;
- repository variables and secrets;
- Vercel env;
- open PRs and branches on keel prefixes;
- plan and verify branches;
- the owner's machine paths.

`plates names --yes` renames the labels and copies the variables that the owner approves. It never reads or prints a secret; it prints the exact command for the owner to run instead.

## Scope

The design is [Name transition](../specs/name-transition.md).

- **Labels:** rename each `keel:*` label on a repository to `plates:*` through the GitHub API (`PATCH /repos/{repo}/labels/{name}`). GitHub keeps a renamed label on its issues and PRs. Then record the rename, so phase 126's writers apply the plates name there. A repository that already has both names is refused, naming both.
- **Variables:** `vars.KEEL_X` is copied to `vars.PLATES_X` with the same value, and the old one is kept until phase 130. Workflows read `vars.PLATES_X || vars.KEEL_X`.
- **Secrets:** list each `KEEL_*` secret a workflow reads, with the command `gh secret set PLATES_X -R <repo>` for the owner to run. Plates can't read secrets, and never asks for a value. Workflows read the plates secret first.
- **Vercel env:** list `KEEL_WEB_*` per project, with the command to add `PLATES_WEB_*`.
- **Concurrency preflight:** before installing changed workflows, verify the owner-approved workflow disable barrier is active and list all relevant run states with complete pagination. Any queued, waiting, pending or running old-group run blocks the switch; missing access or incomplete coverage also blocks. Cancellation requested is not cancellation confirmed. No command here cancels a run without separate owner approval.
- **Live state:** open PRs and branches still on keel prefixes, and plan or verify branches. These are informational; phase 125 already reads them.
- **The owner's machine** (`plates names --machine`):
  - `~/.keel/night-card` → `~/.plates/night-card`, with `run.sh`'s paths and the launchd label `com.keel.night-card` → `com.plates.night-card`, unloaded and reloaded;
  - `~/.keel/tools` → `~/.plates/tools`;
  - git worktrees whose path is named `keel`: listed, never removed. A worktree of another session or provider is named, not touched.
- **Output:** the preview is the default, and `--yes` acts on one project at a time. `--json` gives agents the list.

## Acceptance

- [ ] The preview lists each live keel name per project, with its kind and the action or command. Nothing changes without `--yes`. `tests/names-cli.test.mjs` (stub `gh`): "the preview changes nothing"
- [ ] With `--yes`, labels are renamed in place, an issue keeps its label under the new name, and both names existing at once is refused. `tests/names-cli.test.mjs`: "labels are renamed, never recreated"
- [ ] Variables are copied, never deleted. Secrets are listed with a command and no value, and no `gh secret` read is ever made. `tests/names-cli.test.mjs`: "secrets are never read"
- [ ] `--machine` moves the night-card job and its launchd label in a scratch home, and the job then runs from `~/.plates`. `tests/names-machine.test.mjs`: "the night card moves and still runs"
- [ ] The owner runs `plates names --yes` on plates and sets the listed secrets. The next listing shows nothing left on plates. ⚑ by hand: the owner

## Your part

- **Ask:** Run `plates names` for plates, approve the label and variable moves, and set the listed secrets with the commands it prints.
- **Why:** Labels, secrets and settings live on GitHub and Vercel, and only you can change them.
- **Look at:** `plates names` for plates.
- **Choices:** All moved | Some can't move yet
- **Takes:** 15 minutes for plates, then about 5 per project in phase 129.
- **Then:** If some can't move yet, name which ones and why. Phase 130 waits for them.
- **Ready when:** phases 125–127 have shipped.

## Real surfaces

- GitHub API: label renames, variable copies and the secret listing, per repository.
- owner's machine: `~/.keel` to `~/.plates`, and the launchd job.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/names-cli.test.mjs tests/names-machine.test.mjs`; `npm run check`.
By hand: ⚑ the owner's run on plates. The listing before and after goes into the evidence.

## Deliberately open

- **Saved searches and notification filters** under `label:keel:…` are the owner's, and plates can't see them. The listing reminds the owner of them, once.

## Next action

Write `plates names` as a read-only listing first, then run it on plates and check every row against the phase-124 table.

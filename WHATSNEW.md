# What's new in keel

Each entry is for the person whose project `keel update` brings to that
practice version: what changes in your repo, and anything you need to do.
Newest first. `keel release` writes them; `keel update` puts the entries
between your version and the new one into its pull request.

## v0.1.0 — 2026-10-02

The first released practice. If your project was set up with `keel init` or
`keel adopt`, this is what it now runs on.

- **Seven practices, each switched on only where your project already fits
  it.** `base`, `agents-md` (one AGENTS.md; CLAUDE.md is a pointer to it),
  `phases` (each phase file owns its status; `docs/ROADMAP.md` is generated
  and checked), `evidence` (built needs an evidence file), `lessons`,
  `conduct` (the conductor skill, reached from Claude Code by a symlink) and
  `ci`. What your project does its own way stays a *local variant* in
  `.keel/keel.json`, with a proposal, and keel installs nothing over it.
- **Your gate is yours.** `check` in `.keel/keel.json` names the one command
  that must pass (default `npm run check`). Every instruction keel ships, and
  keel's CI workflow, runs that command.
- **`.keel/lock.json` records what keel wrote.** Each managed file and
  AGENTS.md block is locked by hash, so a change you make is told apart from
  keel moving on. `keel render` refuses to write over your change.
- **`keel doctor` shows what you changed, as a diff, and why it matters.**
  Your edit to a keel file is signal, not an error to revert: keep it
  (`keel doctor --fix <path> eject`), take keel's (`restore`), or send it home
  as a lesson. Doctor also flags a second copy of a skill, a CLAUDE.md that
  grew past a pointer, phase files the roadmap rejects and goals with no phase.
- **`keel update` brings later versions as one pull request.** It updates the
  CLI first, refuses if you changed a keel file, applies migrations, re-renders,
  runs your `check` and, if it fails, leaves your project exactly as it was.

If your phases still name milestones (`docs/milestones.json`), this update
runs migration `0001-milestone-to-goal`: milestones become `docs/goals.json`,
each phase says `goal: Gn`, sections keel's format needs are added and marked
as added, and keel's roadmap script, test and phase contract replace your own.
Read that diff in the PR; your evidence files are not touched.

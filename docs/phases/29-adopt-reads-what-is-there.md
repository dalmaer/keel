---
status: built
since: 2026-10-05
goal: G2
depends: [4, 5]
note: "From isocan: renovate.json disables a project's own workspace packages and takes its timezone; doctor names prose between rows, a second header and a stranded row; adopt calls a claude workflow local only when a mention starts it. isocan's rendered renovate.json keeps every rule of its own."
evidence: ["evidence/2026-10-05-adopt-reads-what-is-there.md"]
---

# keel takes what isocan learned about lanes, tables and workflows

## Done when

isocan can take keel's `renovate.json` without losing a rule, `keel doctor`
names every way a lessons table can split, and `keel adopt` calls a project's
claude workflow local only when it answers mentions.

## Scope

- **Renovate** (`practices/renovate/files/renovate.json` and its render):
  the project's own workspace packages (from `package.json` `workspaces` and
  `name`) are never updated as dependencies; Node moves in one PR across
  `.nvmrc`, a Dockerfile's `FROM node:` and `@types/node`, weekly, for a
  person; the timezone comes from `.keel/keel.json` (`timezone`) when set.
- **Lessons lint** (`lessons-table-split` in doctor): beyond a blank line,
  catch prose between numbered rows, a second header row, and a numbered row
  stranded after the table ends. isocan's lessons.md held all three on
  5 Oct 2026 and keel counted 63 of 108 lessons.
- **Adopt, claude**: a workflow running `anthropics/claude-code-action` makes
  `claude` local only when it is triggered by `issue_comment`,
  `pull_request_review_comment`, `issues` or similar mentions. A scheduled
  writer (isocan's changelog) is not a mention responder.

## Acceptance

- [x] A fixture with workspaces renders a disable rule naming them; one
  without renders none.
- [x] Each of the three split shapes is a doctor finding naming its line.
- [x] Adopt on a fixture with a schedule-only claude-code-action leaves
  `claude` off, not local.

## Proof

`npm run check`.

## Deliberately open

Nothing.

## Next action

Conductor: run `npm run check` on the integrated tree. Then isocan may take
keel's `renovate.json` (set `"timezone": "America/Denver"` in its
`.keel/keel.json` and drop the local variant) — its call, ⚑ for its owner.

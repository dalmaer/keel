---
status: planned
since: 2026-10-04
goal: G2
depends: [12]
note: "The owner fires off many tasks from chat and loses track of some (4 Oct). Everything needed to find them is already on the machine: Claude Code transcripts and git."
evidence: []
---

# Nothing the owner started is forgotten

## Done when

`keel loose-ends` on this Mac lists, for keel and every project in `fleet.json` that has a local checkout, each unfinished thing (a chat session, uncommitted files, an unmerged branch or worktree, an open PR, a phase waiting on a person), each with one suggested next move and the commands to take it. Marking an item resume, park or drop keeps it there across runs.

## Scope

Read fresh every run, never stored (keel's rule):

- **Chat sessions.** Claude Code transcripts under
  `~/.claude/projects/<project dir>/*.jsonl`. The first user message is the
  task's name; the last turn says whether it ended in a commit, a question
  to the person, or mid-work. A session is a loose end when it is newer
  than the project's last commit touching what it changed, or it ended on
  a question to the person. The resume command is
  `claude --resume <session id>`.
- **git.**
  - uncommitted and untracked files, with their age;
  - local branches not merged into the default branch;
  - extra worktrees.
- **GitHub** (only through `gh`, with a short timeout, so offline still
  works): open PRs authored by the owner or by keel's machinery.
- **The practice:**
  - phases `partial` whose next action names the owner (⚑ or "Owner:");
  - health-page proposals awaiting a decision;
  - inbox items proposed but not decided.

**Tie to phases.** A session, branch or commit that names a phase
(`phase 23`, `keel/phase-23`) is listed under that phase, and
`keel loose-ends --phase 23` filters to it.

**Marks** are the only thing stored, in `.keel/loose-ends.json` in each
project, which is committed so other machines see them. Each mark records
the item's fingerprint, `resume | park | drop`, a date, a reason, and for
park an until-date. `drop` hides an item for good, with its reason kept;
`park` hides it until its date; `resume` sorts it to the top.

Verbs:
- `keel loose-ends [--all] [--phase N] [--json]`;
- `keel loose-ends mark <id> resume|park|drop --reason "…" [--until YYYY-MM-DD]`.

Local only: transcripts never leave the machine, so this is not part of
the GitHub nightly. Nothing here deletes, commits or closes anything; it
lists, and prints the commands.

## Acceptance

- [ ] Synthetic transcripts and git repos produce the right items, and a session whose work is already committed is not listed.
- [ ] Each item's suggested move and command is right for its kind.
- [ ] Marks persist across runs; park reappears after its date; drop never reappears.
- [ ] Nothing from a transcript is written anywhere but the terminal (a leak test like phase 21's).
- [ ] The real run on this Mac lists the loose ends known on 4 Oct: the other session's uncommitted keel/nerd research file, ledger's local uncommitted files and unmerged branch, and keel-walk.

## Proof

- Automated: `node --test` on `tests/loose-ends.test.mjs` with synthetic
  transcripts, repos and a stub gh.
- By hand: `keel loose-ends` on this Mac, its output checked against what
  is known.

## Deliberately open

- **How to tell "ended on a question to the person"** from a transcript's
  last assistant turn. Start with a simple rule (a question mark, or an
  AskUserQuestion tool call) and measure it on real sessions.
- **A morning-brief section.** Later, if the owner wants one.

## Next action

Read three real transcripts' shapes (types, fields, how a session ends)
before writing the parser. Never copy their content into fixtures;
fixtures are synthetic.

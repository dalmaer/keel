# conduct

**The failure it prevents.** A builder's "the suite passed" taken on trust;
verification repeated at every level until it costs more than it catches
(keel lessons 4 and 5); a skill copied per harness until the copies age
apart (lesson 1).

**The rule.** The conductor briefs a builder per phase, verifies the named
proof itself, writes the record and commits the phase whole. The skill lives
once, at `.agents/skills/conduct/SKILL.md`; Claude Code reaches it through the
committed symlink `.claude/skills/conduct`.

**Reviews (phase 41).** Every PR the conductor opens or merges has its
reviews read (`keel review <repo>#<n>`): when a PR has reviews, validate each
comment against the code first, then answer it with one of the three replies
(fixed, naming the commit; tracked, naming where; not valid, saying why);
never leave one unanswered. Not a gate. A phase opts in to waiting for its
reviewers with `review: wait` in its front matter (or its issue's
`keel:wait-for-review` label): it lands through a PR that merges when
`keel review <repo>#<n> --gate` exits 0. The default is a push to `main`.

**Its files.** The skill (managed), the doorway symlink (managed), the
`conduct` block of the selected working guide.

**Lineage.** Adapted from dglazkov/isocan `.claude/skills/conduct/SKILL.md`
at `7227f325` (Apache-2.0), for one-file-per-phase projects. The pin is in
`practice.json`; `keel learn` (phase 8) polls it.

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **isocan**: *keel takes isocan's*. isocan's `.claude/skills/conduct/` is
  this practice's upstream source (pinned above). In isocan the practice stays
  local: adopt sees the source file is a real file there, seeds no copy, and
  never installs `.agents/skills/conduct` beside it (lesson 1 — a stale
  untracked `.agents/skills/conduct/` in one working copy was the shape).
- **ledger**: *on*. ledger had no conductor of its own.

# Adopting projects that already have a practice

The owner, 2026-10-09, after a report on bringing a prospective project under
keel: "Can you spec 'What keel should take from' it into keel?"

## What the dry run showed

The prospective project is a large TypeScript monorepo (pnpm, run on Bun, a
few hundred thousand lines, several hundred commits a month). It is private,
so it isn't named here. It already has a measured practice of its own:

- **The owner's sessions push straight to main.** Other contributors open
  PRs. An audit of its own sessions found finished work left waiting as
  draft PRs for days, the biggest time sink it measured.
- **CI is metered.** CI runs only on pushes to main, with no PR trigger, in
  one consolidated job of about 12 to 15 minutes. macOS jobs are
  path-filtered because they bill at ten times the Linux rate and round each
  job up to a whole minute.
- **The agent guide is CLAUDE.md**, with dev skills for shipping, proving a
  fix, planning and cutting a release.
- **Plans are GitHub milestones** named for their ambition, each with exit
  criteria checkable by a command.
- **Tests run on `bun test`.**

`keel adopt --dry-run` on a fresh clone, with its gate passed in, would turn
on only `base` and `renovate`:

- **lessons and night: local.** Both need an AGENTS.md, and the project's
  guide is CLAUDE.md.
- **ci and claude: local.** The project already has its own workflows.
- **phases: off.** There are no phase files; the project plans with
  milestones.

Even with all of that fixed, keel would still miss the project in two more
ways:

- **The night would rerun a 12 to 15 minute gate** every night on a repo
  that audits its bill.
- **The test ledger would see nothing**, because it is a `node --test`
  reporter and the project uses `bun test`.

None of this is particular to one project. Projects that grew up with Claude
Code keep CLAUDE.md. Bun and vitest are common. Shipping to main is a
deliberate choice, and so is metering CI. keel should fit such projects
rather than ask them to change.

## Nine changes, as phases 58 to 66

1. **The agent guide can be CLAUDE.md** (phase 58). keel renders its blocks
   into whichever guide the project already has (AGENTS.md, CLAUDE.md, or a
   named file) and never creates a second one. lessons and night stop
   depending on AGENTS.md by name.
2. **The test ledger reads `bun test` and vitest** (phase 59). Both can
   write JUnit XML. keel turns that into the same per-test record that
   `node --test` gives it, so `flaky_tests`, `slow_tests` and phases 55 to 57
   work on any of the three.
3. **Review after the push** (phase 60). For a project that ships to main,
   the other provider reviews each push to main as one batch. Findings are
   answered as usual and come back as `keel:agent` issues (phase 54) or as
   follow-up commits. Nothing waits on the review.
4. **CI cost is a measure, and adoption says what keel adds** (phase 61).
   Weighted minutes by workflow, with configurable dated runner weights and
   per-job round-up. Settled 2026-10-09: these are usage estimates, not invoices;
   free/public/self-hosted and unknown billing coverage are explicit. The night reuses the project's own CI result on main instead of
   rerunning the gate. `keel adopt --dry-run` states the minutes a month that
   keel's workflows would add.
5. **Prove a fix: the test is seen failing without it** (phase 62). Revert
   the fix, run the named test, see it fail, and record the failure text in
   the commit or the phase's evidence. Report VERIFIED, NOT WORKING or
   INCONCLUSIVE. keel did this informally on 2026-10-09, mutating each fix to
   confirm its test caught it; this makes it a rule with a record.
6. **Plans can stay as milestones** (phase 63). keel reads a GitHub
   milestone's description (exit criteria) as a phase's "Done when", and its
   issues as the work, so `keel next`, the board and the night work without
   phase files. Moving to phase files stays a migration the owner may accept.
7. **A rule says the failure that made it, and a number says when it was
   measured** (phase 64). The project's guide puts it this way: a rule
   without its cause gets "improved" away by the next session. A number in a
   doc is a dated observation, and the command that re-derives it is worth
   more than the number.
8. **Read this before touching that** (phase 65). A map from path patterns
   to the document an agent must read first (an as-built contract). keel's
   guide and doctor point to it, and so does a pre-edit hook where the agent
   supports hooks. With it comes a platform-guard lint: the gate runs on
   macOS while CI runs on Linux, so a test that calls a macOS-only tool must
   say so.
9. **Hygiene measures from real audits** (phase 66): stale worktrees and the
   disk they hold, draft PRs left waiting, and files too long for an agent to
   read whole. Each one names its fix, and the robot can take it.

## What it costs

- Phases 58, 62, 64 and 65 are small changes to rendering, lint and the
  guide.
- Phases 59 and 61 add readers: JUnit, and the Actions timing API at one
  REST call per run.
- Phase 60 spends model tokens per push, within the owner's budget.
- Phase 63 is the largest, and comes last.

## Order

58 and 59 first: together they unblock adoption for a project like this one.
61 next, because it makes the night affordable on a metered repo. Then 60 and
62, then 64 to 66. 63 waits until a project asks for it.

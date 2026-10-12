# Claims, and reviews that end

The owner, 2026-10-11, after reading a one-page "software factory" prompt
(plan as a graph of tasks, run agents in parallel, retry three times then
escalate): "Are there ideas in here that could help keel?" and then "Please
spec them."

Most of that page is already keel's, in a stricter form: a fix is proven by
its test failing without it, the other provider reviews, a release is
rehearsed on the fleet. Two of its ideas name things that went wrong in
keel's own work on 2026-10-10. This is the design for both.

## What went wrong

**Phase 54 was built twice.** One session opened PR #59 on
`claude/phase-54-robot`. Another worked on phase 54 from a local branch,
`claude/phase-54`, that it had not pushed. Neither saw the other. #74 merged
first. #59, after ten review rounds, was closed, and its guard hardening was
ported onto the other robot by hand (#82, #83, #85, #88).

keel already knows which phases depend on which (`depends:` in a phase's
front matter, which the board reads). It has no way to say a phase is taken.
`keel next` names one phase, and every session that asks gets the same one.

**Reviews did not end.** `keel review` makes sure every comment is answered.
On #59 each push drew new findings from the reviewer, each was fixed, and the
next push drew more: about ten rounds. #85, #95 and #98 went four or more the
same way. The owner settled it by hand with a merge rule:

- fix what is a security hole, overwrites the owner's files, or skips an
  approval;
- track the rest in an issue with its known limit;
- then merge.

That rule lives in one session's memory, not in keel.

## Phase 70: a phase being built is claimed

**The claim is one shared branch per phase.** `keel phase claim <n>` pushes
`claims/phase-<n>` before any work starts. A branch is the one thing every
session, provider and machine can see with git alone: no GitHub API, no
shared file, no server.

- The name is the same for every provider, so two claims of one phase meet
  on one ref. The push is create-only (`--force-with-lease=<ref>:`, which
  succeeds only if the ref does not exist), and the server lets exactly one
  through.
- The claim is a commit of its own, on the default branch's head, whose
  message names the provider, the machine and the time. Two sessions never
  make the same commit, so the loser's push is refused, not a no-op, and it
  reads the winner's commit to say who holds the phase.
- The work goes on `<provider>/phase-<n>`, as now. An open PR whose branch
  names the phase is a claim too, so work that began before this phase
  counts.
- `keel phase claim` refuses when the phase is claimed, naming who claimed
  it and when. `--release` deletes the claim when no work branch or PR for
  the phase exists.
- A claim ends when the phase is built on the default branch, or it is
  released.

**`keel next` offers the free set.** It fetches, then lists every phase that
is ready (its `depends:` are built) and unclaimed, the first as before and
the rest under it. A claimed phase is shown as claimed, with its branch. Two
sessions asking at once take different phases.

**The conduct skill claims first.** Its first step for a phase becomes
`keel phase claim`. A refusal means: take another free phase, or stop.

**Stale claims are the owner's.** A claim with no push for seven days shows
on the board as the owner's item: release it, or leave it. keel never
releases someone else's claim by itself.

**What this would have changed:** the second session's `keel next` would
have shown phase 54 as claimed, by the open PR #59 on
`claude/phase-54-robot`.

**Known limits:**

- A session that never runs `keel next` or the conduct skill is not stopped.
  The claim is advice with a visible record, not a lock.
- Offline, the fetch fails and `keel next` says the claims could not be read;
  it does not guess that everything is free.

## Phase 71: a review that keeps going is brought to the owner

**A round** is one push answered by a reviewer with at least one finding.
`keel review` already reads every review and the commit it was made on, so
the count needs no new GitHub call.

**The limit** is three rounds by default (`"review": {"rounds": 3}` in
`.keel/keel.json`).

**Past the limit**, `keel review <pr>` exits 3 (the owner's step) with the
choice laid out:

- **Merge with the rest tracked:** each open finding, sorted by the merge
  rule. Those that are a security hole, overwrite the owner's files or skip
  an approval are listed as "fix first". The rest are listed as "track",
  each needing an issue with its known limit.
- **Split:** land what is settled, and move what is still drawing findings
  to its own PR.
- **Close.**

**Who sorts the findings.** The session answering a finding says which kind
it is when it closes it: `--close <id> --tracked <issue> --class
security|overwrite|approval|other`. keel records that and shows it. keel
never infers the class from the text; a person or the answering session
decides, and the owner sees the decision.

**The board** shows a PR past its limit as the owner's item, with the round
count and the open findings.

**The conduct skill** stops pushing fixes at the limit and reports. It does
not merge; a person does, as now.

**What this would have changed:** #59 would have reached the owner at round
three with a sorted list, not at round ten.

**Known limits:**

- A reviewer that reviews every push (the Codex app) makes rounds pass
  quickly. The limit counts rounds, not time.
- The class is the answering session's word. A finding wrongly marked
  "other" is tracked instead of fixed; the owner reads the list before
  merging.

## Order and cost

70 first: it is small (a create-only push, a fetch and a filter) and it prevents the
most expensive failure, a whole phase built twice. 71 next; it needs phase 48
(the review gate), which is built.

Neither spends model tokens or adds a workflow.

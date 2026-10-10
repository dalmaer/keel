# The robot

The robot extends the optional `climb` practice. It is OFF until the owner
approves a project and weekly allowance and sets `robot.on: true` with a positive
`robot.budgetMinutes` in that project's `.keel/keel.json`. Building or previewing
an issue does not enable it. The allowance includes build and other-provider
review agent time; unknown or exhausted usage blocks work and appears on the board.

Prepare a synthetic example rubric as JSON:

```json
{
  "version": 1,
  "problem": "Acme sorting drops equal keys.",
  "reproduction": "Run node --test tests/sort.test.mjs with two equal keys.",
  "acceptance": "The equal-key test passes and preserves both input rows.",
  "change": "Correct the equality branch in the sorter and add its regression.",
  "prerequisites": [],
  "ownerBlockers": []
}
```

```sh
keel issue new --agent --title 'Preserve equal Acme keys' --rubric rubric.json --json
# Read the preview, then explicitly approve the issue write:
keel issue new --agent --title 'Preserve equal Acme keys' --rubric rubric.json --yes --json
```

Preview exits 3 and changes nothing remotely. With robot OFF, approved issues
have no queue label. Enabled target policy adds `keel:agent`; a label alone is
never permission to spend. Unknown or malformed target policy blocks creation.
The rubric has four bounded text fields and explicit prerequisite/blocker arrays.
Owner blockers stop work; prerequisites must be checked from trusted facts.
The structural rubric does not prove that the requested change is safe.

To track a freshly read review comment in a new issue:

```sh
keel review acme/app#3
keel review acme/app#3 --close PRRT_acme --tracked --file-agent-issue --title 'Preserve equal Acme keys' --rubric rubric.json
# Add --yes only after reading the preview.
```

Creation takes one comment, bare `--tracked`, title and rubric. Existing
`--tracked acme/app#12` remains a separate mode. Fresh receipt checks happen
before creation and again before the reply. A preview or ambiguous issue write
never claims the review was answered. A successful created/recovered issue link is posted as tracked;
the thread remains open until its fix lands.

With enabled target policy, read-back must confirm `keel:agent`. If GitHub
omits it, creation/recovery returns `unqueued` (exit 2): the verified issue
exists and its URL is shown, but queueing is not confirmed. Its durable identity
is retained. Retrying neither creates a duplicate nor automatically restores a
label someone removed. The owner decides whether to apply the label manually
or leave the issue unqueued. Review creation does not post a tracked reply for
this outcome.

Keep `.keel/robot-issues` durable operational intents when moving the checkout.
The same work retries with the same instance. Recovery checks exact markers and
issue identity, including closed issues. An uncertain write is not repeated when
no matching issue is found. Lookup is bounded to 500 issues; incomplete history
is unavailable. Another active intent for the subject blocks a new instance.
Prepared intents can resume after a complete lookup. An attempted POST can only
be recovered, never blindly retried. A crashed writer's lock is reclaimed only
when its recorded PID is confirmed dead on this host. Active, foreign-host and
unknown ownership remains locked; elapsed time proves nothing. Busy callers can
still recover an already-created issue read-only. For unverifiable orphan locks,
inspect with `recoverRobotIssue({repo,instanceId,stateDir,github})` and confirm
the writer has stopped before manually removing only the stale lock. Do not
discard intent records to force another POST. Phase proposal callers supply stable subjects and instances
to `ensureRobotIssue`; this journal is recovery state, not an acceptance record.

Public issue and comment events first enter a trusted router, which checks the
current default-branch policy and sender permission. It compares the event's
issue body with a fresh read, then records an exact-body authorization receipt in
a bot comment and verifies that comment before dispatching. The router's
`issues: write` permission is only for this receipt; it does not run models or
change issue labels. Unrelated public events do not enter the worker's serialized,
budget-counted run history.

The worker runs only on its schedule or dispatch. It requires both a current
writer's receipt for the exact current body and verified current write permission
for the active label actor. A receipt cannot authorize a later body edit or
override a writer removing the label followed by a triage user's relabel.
Routed requests also revalidate the identified receipt and comment association.
An old labelled issue with no matching receipt needs a fresh writer action
(a comment, reopening, or applying the label). Scheduled/manual scans record
issue-specific rejection reasons and continue to later candidates, including when
an earlier issue has a malformed rubric/state or human-changed PR head/base.
Explicit issue triggers remain blocked; global policy/provider/budget failures
stop the entire scan. Approved questions about missing rubric information, owner
blockers or unverified prerequisites remain publication work even when no build
is selected. The trusted publisher rechecks each question's current policy,
body approval, label authority and continuation identity before posting. It
preserves recorded heads, avoids duplicate questions, and posts at most 10 new
questions per run. JSON reports rejected questions and the omitted count;
already-posted questions do not consume that bound on later scans.

Admission, publication and review resolve the current default branch to a commit
and verify its configuration blob. Disabled or unavailable policy revokes queued
work even when its immutable checkout is still enabled. The fresh allowance and
provider choice govern admission. Allowance changes take effect immediately and
can resume an exhausted pending review; they do not invalidate its body approval.
A changed builder/reviewer pair blocks the pending candidate. To finish that
candidate, restore its original provider pair, then merge or close it before
changing providers for a new issue. Published metadata binds the judged candidate's
body/writer/provider authorization to its review, without changing acceptance.
The worker uses sandbox guards. Agents and
judges cannot publish. A trusted publisher opens a `keel/robot-<issue>` PR,
invokes review by the other provider and reports the actual PR on the issue.
Standalone cross-review refuses `keel/robot-` branches, even with a matching
prefix or `/review` comment: its separate allowance cannot bypass the robot
budget or choose the builder as reviewer. Continue through the issue conversation.
Only verified human write/maintain/admin permission can start comment follow-up.
Unknown permissions, unmet prerequisites and human-edited continuation heads
block work. A person reads and merges; the robot does not merge itself.

Runtime changes require owner verification. Both gates run under the runtime
selected from the trusted checkout, so the robot refuses changes to `.nvmrc`,
`.node-version` and `.tool-versions`, including nested files, deletion and rename.
Existing guards also protect workflows, keel configuration and package metadata
such as `engines`, `volta`, `devEngines` and `packageManager`. Unlike climb, the
robot may not change any package.json `"scripts"`: the judge runs the configured
gate, so a changed script needs owner verification. The judge also refuses a
candidate whose gate leaves more test-ledger records for its head than the base's
gate wrote, since an extra record could claim a dropped test passed.

The pushed bundle carries every commit, so each commit meets the same path rules
as the whole change; a later revert does not hide an off-limits path. A merge
answers only for what it introduced, so the robot's own merge of the default
branch into a follow-up stays clean. Commit messages are pushed verbatim: the
judge and the publisher refuse a closing keyword (`close`, `fix`, `resolve` and
their forms) aimed at anything but the robot's own issue.

Continuations preserve the PR description, including owner edits. Its initial
association anchors identity; a canonical bot comment binds each later judged
head and its authorization. Missing, conflicting or incompletely read metadata
blocks reuse. A saved publication intent permits recovery of that exact head
without duplicating its comment. Reviews resolve the association for their own
commit, so unanswered earlier reviews remain visible. Agent text has Markdown
controls escaped and closing verbs visibly interrupted (for example, `C·loses`);
only the trusted task reference emits an issue-closing directive. These display
changes do not alter filenames or identity checks. A follow-up that ends without
a new commit publishes nothing: the PR is left as it is and the reply is recorded
on the issue.

A failure before any model or judge time (an install, say) posts a notice
without recorded state, so the next scan retries the issue; once the agent or
judge has run, a failure is recorded and waits for a fresh writer action.

The owner walk is still required: choose a project and allowance, enable the
practice there, and read three small issues' PRs and reviews before deciding to
keep it on, reduce the budget or turn it off. Local tests prove buildable paths,
not that this real-project walk has happened.

Acceptance records remain owner work: the robot sandbox rejects phase, decision,
evidence, research, design and project-record changes. Its implementation PRs
use the shared body format and a checked no-record-impact declaration. Tasks
that require changing those records need owner reconciliation.


Time proposals use the same durable issue journal. Accept with
`keel walk decide --proposal <health-page> --instance <id> --accept`;
that explicit decision authorizes creation without another `--yes`. With robot
OFF the issue is unlabelled. If robot is enabled but its label is absent,
acceptance remains incomplete with the verified issue link; an owner must resolve
queueing, and retry will not restore a removed label or create a duplicate.

For a `critical_file` proposal, a split or execution-settings change needs an exhaustive owner-reviewed mapping:
`keel walk decide --proposal <health-page> --instance <id> --map <mapping.json>`.
It binds the original and successor test identities/settings to the verified PR
head. Mappings cannot change identity kind, project scope, runner or machine
class, and are not supported for other time measures. The original proposal
baseline remains frozen. The night compares only explicitly clean, matched-selection
observations whose revisions contain the verified merge; it reports
inside, outside or unavailable. A merge itself is not evidence of improvement.
Two real proposal-to-fix walks remain required before this loop is lived-in.

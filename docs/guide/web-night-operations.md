# Review a night plan or retry a failed night

Phase107 adds two distinct controls: publish a reviewed plan from **Daily**, or
request a retry from a retained failed night attempt. Both start disabled. Local
implementation and synthetic proof do not enable production writes or approve
Actions usage. The [operation contract](../specs/web-operation-experience.md#night-controls-bounded-first-adapters)
records the scope and the [phase](../phases/107-mobile-and-desktop-cover-plates-operations.md)
tracks remaining verification.

## Publish the plan you reviewed

Open a project's Daily view for the current plan date or upcoming canonical UTC
night. Edit the authored plan, then choose **Review publication**. Inspect the
complete old and new bytes, repository visibility, branch, source revision and
consequences. Public-repository publication requires its own explicit
acknowledgement. Saving a private editor draft never grants this approval.

The first adapter appends one conditional commit to an **existing**
`keel-night-plan` branch. Another owner edit or night tick requires a fresh review.
The commit preserves other files and history. It does not create robot issues,
force-push, start a night or grant a model budget. Missing branch/file setup remains
unsupported by this publication flow; an ordinary preview must not create it.

Same-date edits retain existing owner lines, item order, results and protected
build/review work. New or changed items are limited to planned measurement and
triage. Existing builds need current canonical policy validation, even when their
allocations are unchanged. Unknown policy is a refusal, not permission.

For the upcoming night, rollover can replace an older plan with reviewed
measurement/triage items. The review calls out that change. Yesterday's complete
plan remains in immutable parent history; new items start planned with no result
or build allowance. Old builds are never silently carried forward.

The receipt proves the exact source commit. It does not prove a runner consumed
the plan or that work passed. It also records the policy revision checked before
dispatch: the commit's atomic condition protects the plan branch, not a separate
default-branch policy ref. A concurrent policy change can race with publication.

If the response is lost, keep the original receipt URL and check it. Recovery
looks for that exact commit and never publishes another one. An uncertain
operation remains uncertain when the source cannot establish what happened.

## Review a failed-night retry

Open a retained attempt in Activity, then inspect its retry eligibility. The
initial adapter supports explicitly registered canonical **adopted-project**
night workflows. It is not arbitrary workflow execution and does not support the
Plates mothership's intake step, robot/climb/model work, secret-dependent setup,
optional production/canvas effects or undeclared downstream workflows.

A private profile binds the numeric repository/workflow identities, original
commit, complete source inventory, reviewed static commands/dependency boundary
and allowed effects. A changed source or incomplete read requires renewed review.
Hashes identify the reviewed bytes; they do not prove that arbitrary project
code has no network or model effects. Inspect the exact declared boundary before
activating a profile.

The retry review shows the original run/attempt, original actor privileges,
commands, effects and a maximum 60-minute Actions reservation. GitHub retains the
original SHA/ref but the canonical workflow reads the **current UTC date and
current night plan**. Its normal effects include measurement/report publication,
plan/data branches, data PR creation and eligible data PR merges. This is not an
immutable replay of yesterday's plan.

Approve only that reviewed request. A `201` response means GitHub accepted the
request; it does not mean the night passed. Later attempts are shown as observed
successors with unverified attribution, because GitHub's rerun API provides no
idempotency or correlation key. External and scheduled runs remain outside Plates's
web admission and cannot be described as controlled by its budget.

An acknowledged request may settle after a fresh read finds a completed successor.
That frees the active project lane while retaining the full 60-minute charge for
seven days. An uncertain or interrupted send keeps both its charge and lane; a
later attempt or elapsed time cannot prove the original request will never run.
There is no automatic redispatch or run-ID cancellation. A preparation known not
to have received a send grant can expire safely under its database fence.

## Activate only the selected capabilities

Plan publication reuses SQL004's encrypted conditional-operation store. Retry adds
SQL013 **after SQL010**, sharing atomic project lanes and allowance accounting with
existing workers. SQL012 editor drafts are independent; draft activation does not
enable either night action. Hosted role, concurrency, recovery and restore proof
remain required before enabling the applicable controls.

The optional nonsecret instance member has separate gates:

```json
{
  "nightOperations": {
    "retryEnabled": false,
    "planWrites": false,
    "verifiedAt": null,
    "restoreReconciledAt": null,
    "profiles": []
  }
}
```

Keep dates null until the corresponding real verification has happened. The
profile list contains selected project IDs; reviewed profile records live in
`night-retries/<project-id>.json` in the private workspace. The service's exact
[profile validator](../../lib/web/night-retry-source.mjs) defines their contract.
Do not invent a reviewed source hash or review attribution. Retry also needs the
existing verified jobs/shared workspace and project allowance, App Actions write
and current user write authority. Publication needs App Contents write and the
current canonical policy reads. Missing grants remain visible gaps.

Before activation, approve the exact project, effects and maximum allowance;
then verify an actual failed-night request and canonical plan consumption through
the selected provider. Record source revisions, request identities, observed
outcomes and actual or unknown usage. Repeat the flow on desktop and mobile,
including expired login and a lost response. A successful synthetic transport
is not that proof.

After SQL013 is installed, reapply SQL013 directly when needed. Replaying SQL009
or SQL010 refuses atomically, preserving the shared allowance and project lock.
Do not restore the older public job function: it cannot account for night retry
reservations. Verify both directions of admission and existing receipt retention
after database maintenance.

## Restore and reconnect trial

After a configured workspace restore, plan publication needs a current night
restore assertion; native retry needs both night and jobs assertions. Each must
be a canonical past instant at or after `recovery.startedAt`, with global
reconciliation complete. Other enablement, current access and allowance checks
still apply; unresolved retry charges and lanes remain held.
See the [fleet trial worksheet](web-fleet-trial.md) for real device and recovery
observations, including terminal detours and unavailable costs.

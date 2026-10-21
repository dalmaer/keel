# Review and record a decision

The web flow supports an undecided legacy health-page proposal and an unanswered
question in a validated shaping record. It records the owner's choice in that
project's repository. It does not generate a plan, launch work or mark acceptance.
The [phase record](../phases/97-decisions-change-the-reviewed-source.md)
distinguishes implemented behavior from the hosted write walk.

## Open the source question

Home links supported health proposals to their decision view. Other decisions
retain their source links. Structured timing and hygiene proposals keep their
existing policy-bound writers and are inspect-only here.

For shaping, select an exact project-relative file and unanswered question ID.
There is no reserved filename or automatic repository scan. For example:

```text
/projects/studio/decisions?kind=shaping&path=planning%2Fidea.json&question=storage
```

The project must enable `shaping`. Its source references and previews must be
readable within the service's bounds. Missing required sources or contradictory
decision context block submission. “Not configured” means no declared context,
not verified coverage.

## Preview before recording

Read the question, revision-pinned source and context. Accepted choices and
recommendations are separate. Nothing is selected for you. Choose accept or
decline for a health proposal; decline requires a reason. A shaping question takes
your own answer and leaves the author's recommendation unchanged.

**Preview exact source change** saves an encrypted preview in the private
database. It shows repository, branch, visibility, reviewed revision, exact
resulting file, full commit message and consequences. It expires after 15 minutes.
Editing your choice requires another preview. Public writes require an explicit
acknowledgement of the exact public file and message before submission.

Submission defaults to disabled. Enabling it requires owner approval, GitHub App
**Contents: read and write** on selected repositories, the signed-in user's write
permission and `decisionWrites: true` in server-side `KEEL_WEB_CONFIG`. No Issues,
Pull Requests, Actions, administration or workflow permission is requested.
Keep that setting absent or false for preview-only use. Prior read-only setup
approval does not authorize broader access.

## Follow the original receipt

The preview reserves a stable operation URL. On explicit submission the browser
changes to it before sending the request; bookmark it. The backend rechecks access,
source, visibility and context, then commits against the exact reviewed HEAD.
An intervening commit requires a fresh preview. A protected-branch refusal does
not create a PR or switch destinations.

The receipt distinguishes reservation, dispatch, uncertainty, refusal and a
confirmed source commit. A lost response is **uncertain**, not failed. Use
**Check original operation** to read its receipt and look for its exact commit
without submitting again. “Operation not visible yet” can mean the original
request is still running. Dispatched and uncertain operations keep the project
reserved after lease expiry. Do not bypass or delete that reservation to retry.

A committed receipt links to the exact source change and retains authenticated
actor and observation time. A shaping answer increments its revision, preserving
existing answers and proposed decisions. A health decision uses the same transform
as `keel walk decide`. Neither establishes implementation, tests, human acceptance
or lived-in use.

## Instance setup and proof

Apply migrations 001 through 004 in order; see the [service guide](web-auth-service.md).
Encrypted previews and receipts stay in the external database. The RPC is
backend-only; anonymous and client-authenticated roles cannot read its tables
or invoke it.

Before enabling writes, review one concrete preview with the owner. After an
explicit choice, submit once, follow the receipt and inspect the GitHub commit.
Verify only the intended record changed and reopen the same receipt on another
screen. Record observed results and serving/source revisions in the phase
evidence. Synthetic tests cannot replace this owner walk.

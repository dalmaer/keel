# Answering reviews: every comment validated, then answered

Design, 6 October 2026. Phase 41 builds it.

## Why

On 6 October the conductor merged keel's v0.8.0 update PRs in ledger, duo
and cajones when their CI went green. Codex reviewed each of them minutes
after it opened; nobody read the reviews. The 13 inline comments held 10
distinct findings and every one was valid, among them a P1: Loop's prove
pass ran a model with unrestricted Bash, the whole environment and a
finding's untrusted text in its prompt. They were fixed in v0.8.1 only
because the owner asked whether the comments had been seen. On v0.8.1's PRs
the reviews were read before merging, and found four more (fixed in v0.8.2).

The shape is lesson 49's family, *a failure nobody is told about in time*:
the reviewer spoke, and nobody was listening.

**Not a gate (the owner, 6 Oct):** "it doesn't have to be a gate… just if
you see reviews always answer them… validating first." Merges are not
blocked by open threads. What is required is that no review goes unread or
unanswered: each comment is validated against the code, then answered.

## What changes

**1. A deterministic review read.** `keel review <repo>#<n> [--wait]`:
every review thread on the PR (GitHub's GraphQL `reviewThreads`, with
`isResolved`), every review and its state, and every conversation comment
from a reviewer bot, as JSON and as a short table. Exit 0 when every thread
is resolved; 1 when any is open; 2 when GitHub can't be read (never read as
clean). Reviewers are named in `.keel/keel.json` (`"review": {"reviewers":
["chatgpt-codex-connector[bot]"], "wait": 10}`); a repo with none named reads
only threads that exist.

**2. Wait for the reviewer.** A reviewer posts after the PR opens, often a
few minutes after CI. `--wait` waits until each named reviewer has posted a
review on the PR's head commit, or the configured minutes pass; a timeout is
said, never read as "no comments".

**3. Every agent that opens or merges a PR answers its reviews.** The
conduct skill, the fleet update's report and the climb and tend briefs say:
after a PR's reviewer has posted, read every comment, validate it against the
code, then answer it. A merge is never refused for an open thread; a thread
is never left without an answer.

**4. Closing a thread has two honest forms.**
- *Valid*: fixed, and the reply names the commit or release; or tracked, and
  the reply names the issue or the version it will land in. The thread is
  resolved when the fix lands, not before.
- *Not valid*: the reply says why, citing the code. The thread is resolved
  with the reply.
`keel review --close <thread> --fixed <commit>|--tracked <issue|version>|--not-valid "<why>"`
posts the reply and resolves in the first and third cases; a tracked thread
stays open until its fix is recorded, then is resolved with the commit.

**5. Seen nightly.** The night gains `reviews_unanswered`: review comments
on the project's PRs (open, or merged in the last week) with no reply, older
than a day; `keel loose-ends` lists
them with the command to read them.

## Deliberately not

- No gate: nothing refuses a merge for an open thread.
- No model in the read: reading threads is deterministic; judging a comment
  valid or not is the conductor's (or a person's), recorded in the reply.
- No auto-resolve: a thread is never closed without a reply saying which of
  the two forms it is.

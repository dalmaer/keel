# The review gate: no merge with an unread review

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
the reviewer spoke, and the merge path was not listening. Green CI is one
gate; a reviewer's comment is another, and keel had only the first.

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

**3. Every keel merge path goes through it.** `keel fleet update`'s merge
step (when it merges), drain (the night's data PRs, climb and tend PRs are
merged by a person, so they only need the read), and the conductor skill's
merge step all run `keel review --wait` and refuse to merge while a thread
is open. The refusal names each open thread and its first line.

**4. Closing a thread has two honest forms.**
- *Valid*: fixed, and the reply names the commit or release; or tracked, and
  the reply names the issue or the version it will land in. The thread is
  resolved when the fix lands, not before.
- *Not valid*: the reply says why, citing the code. The thread is resolved
  with the reply.
`keel review --close <thread> --fixed <commit>|--tracked <issue|version>|--not-valid "<why>"`
posts the reply and resolves only in the first and third cases; a tracked
thread stays open until its fix is recorded, and blocks no merge of the PR
it was raised on only if the reply names where it is tracked (an explicit,
visible exception, never silence).

**5. What GitHub can enforce.** Branch protection's "Require conversation
resolution before merging" makes GitHub refuse the merge too, whoever
merges. It is a repository setting, so it is the owner's (⚑ per repo);
`keel doctor` notes when a fleet repo with a named reviewer lacks it.

**6. Seen nightly.** The night gains `review_threads_open`: open review
threads on the project's open PRs older than a day; `keel loose-ends` lists
them with the command to read them.

## Deliberately not

- No model in the gate: reading threads is deterministic; judging a comment
  valid or not is the conductor's (or a person's), recorded in the reply.
- No auto-resolve: a thread is never closed without a reply saying which of
  the two forms it is.

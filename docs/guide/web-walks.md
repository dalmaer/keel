# Test a result with a guided walk

Open **Guided walks** from a project on Home. An authored walk separates what
should happen from what you actually observe, and ties both to one exact result
version and one human acceptance item. This guide describes implemented local
behavior; deployment, the hosted database checks and a real owner's approved
source write need their own evidence in [phase 98](../phases/98-guided-walks-preserve-what-was-tested.md).

## Prepare a walk

Keep a versioned JSON definition at `docs/walks/<id>.json` in the project
repository. Its instructions are project source, not private owner feedback.
The file name must match the stable walk ID. For example:

```json
{
  "version": 1,
  "id": "acme-search",
  "title": "Try Acme search",
  "target": {
    "phase": "docs/phases/01-acme-search.md",
    "acceptanceHash": "<SHA-256 of the exact acceptance item text>"
  },
  "readiness": {
    "state": "ready",
    "reason": "The implementation is ready for an owner observation."
  },
  "result": {
    "sourceRevision": "<40-character immutable Git commit>",
    "artifactId": "acme-search",
    "version": "build-one",
    "contentHash": "<SHA-256 of the result file bytes>",
    "path": "artifacts/acme-result.txt",
    "environment": "Acme preview, desktop and mobile",
    "previewUrl": "https://preview.acme.test/search"
  },
  "steps": [
    {
      "id": "find",
      "instruction": "Search for the Acme anvil.",
      "expected": "Anvil appears in the results.",
      "requires": []
    },
    {
      "id": "open",
      "instruction": "Open the Acme anvil result.",
      "expected": "The Acme anvil detail opens.",
      "requires": ["find"]
    }
  ]
}
```

Replace the placeholders with actual hashes; this illustrative JSON cannot be
used unchanged. Hash the acceptance item's exact text after the checkbox marker,
including its ⚑ and punctuation, without the line ending. The service resolves
that hash against the current phase rather than trusting a remembered checkbox
number. Define one to twenty steps, with stable IDs and acyclic prerequisites.
Use a not-ready readiness state with a reason while the result is unavailable.
The optional preview URL is a link to try, never proof of what is currently
served. Keel verifies the repository result bytes at the named immutable commit;
you separately confirm the version and actual environment you tested.

Configure [private sign-in and the database](web-auth-service.md) first. Guided
walks require migrations 001 through 005 in order, including
[005-walk-drafts.sql](../../lib/web/migrations/005-walk-drafts.sql).
The existing `decisionWrites` setting remains disabled by default. Private
observations and exact previews do not require enabling source submission.

## Observe and resume

Enter the actual environment and confirm the displayed result. On each step,
read the authored instruction and expected result, then explicitly choose
**This works**, **Doesn't work** or **Can't test yet**. Nothing starts as passed.
Failures and blocked tests require details; successful observations may include
a note. Unfinished notes can be saved without choosing an outcome.

Choose **Save private progress** before changing steps or reloading. Saves are
explicit, not automatic. The encrypted private draft belongs to your numeric
GitHub identity, workspace, repository and walk; it never becomes public merely
because the project is public. Reload restores saved observations and history.
Unsaved text exists only in the open page, so preserve it before deliberately
replacing the form with **Reload saved draft and current source**.

Two tabs cannot silently overwrite one another. A conflicting or uncertain save
keeps your typed text visible and requires an explicit reload before further
saves. Changed result bytes, instructions, prerequisites or environment can make
observations stale. Earlier instructions, notes, time, result revision and
actual environment remain inspectable in history. Reordering unchanged stable
steps preserves their observations. Missing result bytes and source coverage
remain visible gaps, never a successful test. Capacity refusals preserve history
and require operator attention; there is no automatic deletion of old feedback.

## Review acceptance

After every current step passes, write a final observation and answer any choice
authored by the phase. A choice that keeps acceptance open cannot publish a
successful walk. **Review acceptance change** shows the exact phase, evidence
and, when changed, roadmap files, plus the commit message and destination.
The source change uses the same acceptance plan as `keel walk done`; the browser
never runs project scripts or marks unrelated acceptance items.

Private draft notes are not all published. Review the exact selected final
observation and every outbound file. Public repositories show an explicit public
visibility notice and require a fresh, unchecked acknowledgment bound to that
preview. Editing observations invalidates it. Submission also requires owner
approval, GitHub App Contents-write access and the instance's write setting;
previewing grants none of these.

A preview, button click or pending request is not acceptance. Only a verified
source commit receipt reports success, with its immutable commit link and
changed paths. If delivery becomes uncertain, keep the original operation URL
and use its read-only receipt check. Do not submit again: an early missing
receipt does not establish that the original request failed. Stale previews,
changed membership, source changes and private-draft conflicts require fresh
review rather than an automatic retry.

## Prepare a repair

A saved failed or blocked step can prepare a repair brief. Select an exact
excerpt of your actual note and author its title, problem, reproduction,
acceptance and change description. The preview shows the destination, exact
outbound body and original source/result links. Advanced handoff data is available
in a collapsed disclosure. **No issue is created and no work starts.** Delivery
uses the existing, separately approved [robot issue workflow](the-robot.md).

Hosted walks currently prepare new-change issue handoffs. They do not author
accepted-decision conflicts or provide a shaping/reopening editor. The broader
local [feedback workflow](feedback.md) retains those explicit conflict and shaping
contracts. A failed test never routes through successful acceptance just to reuse
a button.

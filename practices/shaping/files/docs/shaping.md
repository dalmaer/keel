# Review an idea before making it work

Read the named source records first. Ask only unresolved aims, taste, authority
or resources. Ordinary implementation choices are recommendations with reasons.
Record actual owner words and their source; actor fields are manual provenance,
not authentication. The tool never turns a recommendation into an answer.

Copy `docs/templates/shaping.json` to `idea.json`. The synthetic Acme fixture
uses the initial G0 and phase 0 from `keel init`; select a free explicit phase
number and a real goal in an existing project. Its proof command is a declaration,
not evidence that a test exists or passes. The conductor judges sufficiency.

```sh
keel shape check idea.json --json
keel shape render idea.json --output review-acme --json
keel shape plan idea.json --json
keel shape plan idea.json --yes --digest <digest-from-reviewed-preview> --json
```

All file and output paths are repository-relative, without symlinks. Render
requires a new directory. HTML contains escaped data and a restrictive CSP;
no user HTML executes. Optional question `preview` paths must point to local
PNG/JPEG/WebP/GIF/PDF files. They are hashed as sources and linked relative to the review directory,
never embedded. No remote URL is fetched.

Version 1 is bounded to 256 KiB, 12 questions and 20 items. Unknown fields,
duplicate IDs, invalid attribution, unknown references, missing proof, invalid
real surfaces and cycles fail. Every field in the fixture is required except
question `preview`; `answers`, `sources`, `questions`, `proposedDecisions`,
`depends`, `decisions`, `ownerPrerequisites` and `surfaces` may be empty arrays.
Each generated phase is capped at 256 KiB; the complete receipt at 4 MiB,
so every saved preview is readable during recovery. Each recommendation needs text, nonempty evidence and alternatives. Answers
name a question ID, actor, role `owner`, UTC time, source and text. Omit an
answer to leave it unanswered. Source paths identify bounded local files.

Items use `kind: phase` with an explicit integer `phase`, or `kind: robot`.
Dependencies name another item ID or `phase:N` for an existing local phase.
Phase items cannot depend on robot previews. All generated phases use spec 2,
planned status, unchecked acceptance, empty evidence and the supplied date.
Scope, titles and answers are escaped as prose; proof commands must be single
lines without backticks. Commands are never executed by shaping.

Decision references are anchored source references such as
`docs/decisions/storage.md#storage`. Phase 90 validates accepted records and
scoped supersession. A proposed decision is an object with `id`, `statement`,
nonempty `scope` and `supersedes` (anchored existing references or an empty
array). Items refer to it as `proposal:ID`. Proposals stay in the shaping record
and review; no accepted decision is written. To settle one, manually author
source records and reciprocal scoped replacement links, preserving history,
then review a new shaping revision. No answer implicitly accepts a proposal.

Preview and render retain immutable content-addressed receipts under
`.keel/shaping/reviews/`. `--yes` requires the exact reviewed `--digest` and
cannot substitute new content after an input change. Receipts include source
hashes, exact output bytes and stable item-to-path mappings. Git revision alone
and the receipt's own newly seeded files do not invalidate recovery; source
or decision changes do. Revisions and previous receipts retain old choices.

Writes journal all intended paths before the first draft, publish complete
files exclusively, and recover by hash. Retry the identical command after an
interruption. Existing files are never replaced; changed destinations stop
recovery. Resolve those conflicts manually, preserving concurrent work.
Do not delete recovery journals to force a retry. Receipt storage is local
project data; exclude `.keel/shaping/` from publication if it contains private
owner words. This practice does not automatically modify your ignore rules.

Milestone-backed projects get remote-work previews only, without reading or
writing archived local phases. External `phase:N` dependencies are unavailable
and rejected for milestone plans; use internal item IDs for their checked DAG. Robot previews use the existing rubric validator;
external creation must use the existing issue flow with its destination and
approval. Shaping grants no issue creation, model, merge or deployment permission.

---
status: built
since: 2026-10-04
goal: G3
depends: [11, 21, 24]
note: "The night counts unsent lessons (lessons_unsent), loose-ends lists them with the send command, and duo's and cajones' 8 went home, were triaged and decided (lesson 29)."
evidence: ["evidence/2026-10-04-lessons-dont-wait.md"]
---

# A project's new lessons are noticed without anyone remembering to send them

## Done when

The nightly health page counts a project's unsent lessons as a measure, `keel loose-ends` lists them with the command to send them, and duo's and cajones' lessons have gone to the private inbox and been triaged.

## Scope

- **The measure.** `lessons_unsent` in the night's improve (shipped
  `scripts/keel/improve.mjs`). It counts rows in the project's lessons
  table whose fingerprint isn't in `.keel/sent.json`, using the same parser
  and fingerprint as `keel lessons`, so there is one source. Its bound is 0,
  with no ratchet. Its proposal is "send them home:
  `npx -y github:dalmaer/keel lessons --yes`". The night can't send, because
  sending to the private inbox needs the owner's login, so it only counts.
- **loose-ends.** An `unsent-lessons` item per project with a count above
  0, and the command.
- **The real use.**
  - `keel lessons --yes` from duo and cajones into `dalmaer/keel-inbox`;
  - their `.keel/sent.json` as data PRs;
  - an agent's proposals;
  - the owner's decisions;
  - accepted rows, in general wording, in keel's lessons table.

## Acceptance

- [x] `lessons_unsent` counts exactly the unsent rows (a test with a synthetic project and a sent.json), shares the parser and fingerprint with `keel lessons`, and is n/a when there is no lessons table.
- [x] `keel loose-ends` lists unsent lessons per project, with the send command.
- [x] duo's and cajones' lessons are in the private inbox, proposed on, and decided by the owner; their sent.json PRs are merged.

## Proof

- Automated: `node --test` on the improve and loose-ends tests.
- By hand: the real send from duo and cajones, `keel fleet` showing 0
  unsent, and the decisions on the inbox.

## Deliberately open

- **Whether the night should send by itself one day**, with a token scoped
  to the inbox. Not now: the inbox is private, and filing is the owner's
  act.

## Next action

None.


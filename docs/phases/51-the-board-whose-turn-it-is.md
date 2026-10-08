---
status: planned
since: 2026-10-08
goal: G0
spec: 2
depends: [44]
note: "The owner keeps asking what's next. The roadmap answers the agent's question, not the person's: whose turn is it, and what is mine. keel board gathers it from what keel already knows, with two phase fields so nothing is guessed; the owner's answers are recorded through keel verbs. Design: research/2026-10-08-whose-turn-board.md."
evidence: []
issue: 37
---

# The board: whose turn it is, and what is mine

## Done when

`keel board` serves a localhost page that sorts every open item by what it waits on (yours, broken, the agent's, time), each "yours" item settles through a keel verb, phases say when they are not yet buildable and whose walk they owe, and the owner has settled a week of walks from the board instead of in chat.

## Scope

The design is [The board](../research/2026-10-08-whose-turn-board.md).

- **Phase fields**: `after: YYYY-MM-DD` (not buildable before it: nextPhase and `keel next` skip it; the board lists it under time); `waits: owner | time | external` on a phase that `owes: walk` (default `owner`). Validated by the roadmap check like `owes`.
- **`keel board --json`**: every open item, each `{ waits, title, why, read, link, source, actions }`, gathered from the phase files (roadmap.mjs), `keel loose-ends --json`, unanswered reviews on open PRs in the fleet, the newest health page's proposal, the inbox's undecided lessons, and `keel fleet --json`. A source that cannot be read is listed as n/a with why, never left out.
- **`keel walk done <phase> --note "<what you saw>"`**: checks the phase's open ⚑ box, appends the owner's judgment to its evidence, and moves the status to built when no box is left open (dropping `owes`), leaving a working-tree diff; refuses a box that is not a walk.
- **`keel board`**: a localhost page (no dependencies, Node's http), columns Yours, Broken, The agent's, Waiting on time, and a fleet strip; each "yours" item's actions call the verbs above through the server, which runs them as the CLI would and shows their output. Bound to 127.0.0.1 only, with a per-launch token in the URL so another local page cannot post to it.
- **Committing stays the conductor's**: a verb that changes the repo leaves a diff and says so.

## Acceptance

- [ ] `after:` and `waits:` parse and validate (a date that is not a date, `waits` without `owes: walk`, an unknown value: errors); nextPhase skips a phase before its `after:` date and names it on that date; mutation: ignoring `after` fails the test. `tests/roadmap.test.mjs`
- [ ] `keel board --json` on a synthetic Acme project and fleet puts each kind of item in its column (a ⚑ walk under yours, a buildable phase under the agent's, an `after:` phase and a `waits: time` walk under time, a red CI and an unanswered review under broken), and an unreadable source is n/a with why. `tests/board.test.mjs`
- [ ] `keel walk done` checks the walk's box, appends the note to the evidence, and moves a phase with nothing else open to built (dropping `owes`); a phase with a buildable box left stays partial; a non-walk box is refused, writing nothing. `tests/board.test.mjs`
- [ ] The server binds 127.0.0.1 only, refuses an action without the launch token, and runs actions through the same verbs; its page renders every column from `--json`. `tests/board.test.mjs`
- [ ] keel's own phases carry `after:` (13) and `waits:` where a walk waits on time or an external thing, and `keel next` no longer names phase 13 before 2026-11-01. `node scripts/roadmap.mjs --next`
- [ ] ⚑ by hand: the owner runs `keel board`, and settles a week of walks and decisions from it rather than in chat.

## Real surfaces

- Owner's machine: `keel board` in the owner's browser, with their `gh` login reading the fleet.

## Proof

- Automated: `node --test tests/roadmap.test.mjs tests/board.test.mjs`, with the mutation above; `npm run check`.
- On keel: `keel board --json` read against the roadmap, loose ends and the fleet by hand; `keel next` before and after the `after:` field.
- By hand: a week of the owner's walks settled from the board.

## Deliberately open

- **A hosted or canvas view**: phase 50's isocan canvas could show the same `keel board --json` as a live item. Its effect: until then the board is one machine's. Settled after the localhost board has a week of use.
- **Actions beyond walks, proposals and lessons** (merge a PR, answer a review): those stay where they are reviewed (GitHub, `keel review --close`), linked from the board. Settled after a week of use.

## Next action

Brief a builder on the two phase fields and `keel board --json` first, then `keel walk done`, then the localhost page.

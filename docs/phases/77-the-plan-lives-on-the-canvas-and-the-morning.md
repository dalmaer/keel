---
status: planned
since: 2026-10-14
goal: G4
spec: 2
depends: [73, 50]
note: "Specified 2026-10-14: the plan is a live canvas card ticked through the night, and the morning brief arrives as an email via an assigned GitHub issue."
evidence: []
issue: 135
---

# The plan lives on the canvas, and the morning sends a message

## Done when

With a canvas, tonight's plan is a live card updated in place as items tick; and every morning `keel morning` writes the brief in isocan's order (done, tried, failed, left alone) with links to the canvas, the health page and each PR, delivered as a GitHub issue assigned to the owner so that GitHub emails it.

## Scope

The design is [Nightwatch: a night with a plan you can shape](../research/2026-10-14-nightwatch.md), "The plan is a live card, and the morning sends a message".

- **The card**: `night-plan`, a live key (phase 50's `canvas.liveKeys`), rendered from the plan file; each tick republishes it through the conditional edit. A person's edit stops updates, as always.
- **The brief**: `keel morning` reads the plan as it ended, the health page and each item's PR, and renders markdown: what was done (with its number before and after), what was tried, what failed and why, what was left alone, and what is the owner's next.
- **Delivery**: by default a GitHub issue "Good morning, <date>" assigned to the owner (`morning.assignee` in `.keel/keel.json`, required to send), labelled `keel:morning`; the previous morning's issue is closed. GitHub's own notification is the email. No other mail is sent without an adapter the owner configures.
- **In the night**: the night's last step runs `keel morning --send`; a send that fails turns the night red, as a guard must fire into a room someone is in.

## Acceptance

- [ ] The plan renders as one card and each tick edits it in place, with a person's edit stopping updates. `tests/canvas-sync.test.mjs`, `tests/morning.test.mjs`
- [ ] `keel morning` renders the brief in order with every link, from a fixture plan and health page. `tests/morning.test.mjs`
- [ ] `--send` opens one assigned, labelled issue and closes the previous one, on a stubbed gh; with no assignee it refuses, naming the key. `tests/morning.test.mjs`
- [ ] The night's last step sends the brief, and a failed send fails the night. `tests/workflows.test.mjs`
- [ ] ⚑ by hand: the owner gets the email one morning and opens the canvas from it.

## Your part

- **Ask:** One morning, open the "Good morning" email from GitHub and follow its link to the canvas.
- **Why:** It is the whole point: waking up to one message that says what the night did and where to look.
- **Look at:** your email from GitHub, subject "Good morning, <date>".
- **Choices:** It told me what I needed | I had to go digging
- **Takes:** 5 minutes.
- **Then:** Digging: what was missing goes into the brief.
- **Ready when:** this phase and phase 73 have shipped, and the owner has set `morning.assignee`.

## Real surfaces

- GitHub API: the assigned issue and GitHub's email.
- Owner's machine: the live plan card on the owner's isocan canvas.
- Workflow shell: the night's last step.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/morning.test.mjs tests/canvas-sync.test.mjs tests/workflows.test.mjs`; `npm run check`.
By hand: one real morning's email.

## Deliberately open

- **Mail beyond GitHub**: an adapter for a mail provider needs a secret the owner holds; built only if asked.
- **Known limit**: GitHub sends the email only if the owner's notification settings allow it.

## Next action

Write `keel morning` (render and send) with `tests/morning.test.mjs`, then the plan card.

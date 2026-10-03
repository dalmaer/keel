---
status: planned
since: 2026-10-02
goal: G1
depends: [1]
note: "Verb list drafted in design.md; no bin yet."
evidence: []
---

# An agent can drive keel without reading its source

## Done when

`keel --agent-help` lists every verb in one screen, every verb accepts `--json`, and a test fails when a registered verb is missing from the agent guide.

## Scope

`bin/keel.mjs` with zero dependencies; `status`, `next` and `goal list` working
(they wrap what scripts/roadmap.mjs already does); `--agent-help [topic]` from
one file shipped with the CLI (isocan's agent-guide pattern, cold start with a
token budget); the surface test; settle how keel is installed.

## Acceptance

- [ ] `keel next --json` and `npm run next` agree.
- [ ] Adding a verb without an agent-guide line fails `npm test`.
- [ ] The cold start stays under a set size, asserted.
- [ ] Install works from `main` with no build step, on a machine that has never seen keel.
- [ ] `keel --version` reports both the CLI version and the practice version it carries.

## Proof

`npm test`; in a temp HOME, the chosen install command, then `keel --agent-help` and `keel next --json` inside keel.

## Deliberately open

- Install route: `npm i -g github:dalmaer/keel`, or a `~/.keel` clone that the CLI pulls. The second makes self-update one `git pull` and works offline against a known commit; the first is what people expect. Settle with phase 6's needs in view.

## Next action

Write the agent guide's cold start first — the verbs as one line each — and make the surface test read it.

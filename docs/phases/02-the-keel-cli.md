---
status: built
since: 2026-10-02
goal: G1
depends: [1]
note: "status, next, goal list, render, --agent-help, --version; every verb --json; the surface test reads the registry both ways. Installed from GitHub via gh repo clone + npm i -g with no build."
evidence: ["evidence/2026-10-02-cli.md"]
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

- [x] `keel next --json` and `npm run next` agree.
- [x] Adding a verb without an agent-guide line fails `npm test`.
- [x] The cold start stays under a set size, asserted.
- [x] Install works from `main` with no build step, on a machine that has never seen keel.
- [x] `keel --version` reports both the CLI version and the practice version it carries.

## Proof

`npm test`; in a temp HOME, the chosen install command, then `keel --agent-help` and `keel next --json` inside keel.

## Deliberately open

- Install route. **Settled 2026-10-02:** a checkout of keel (`gh repo clone dalmaer/keel`), then `npm install -g <checkout>` or `npm link`. The global bin is a symlink into the checkout, so self-update (phase 6) is `git -C <checkout> pull --ff-only`, and the CLI's version is a commit. Settled by the install walk in the evidence.

## Next action

None; phase 3 adds `init` as a registered verb with its guide line.

## Trajectory

- **2026-10-02** — While keel is private, install is `gh repo clone`, not `git clone`. A plain clone on a fresh HOME fails for want of credentials. `init` and `update` must reach keel through `gh` too. Found by the install walk.

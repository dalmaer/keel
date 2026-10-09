---
status: planned
since: 2026-10-09
goal: G0
spec: 2
depends: []
note: "Two guards an agent should meet before editing: some code has an as-built contract that must be read first (a project's own measured rule), and a test that calls a macOS-only tool passes on the Mac gate and fails on Linux CI. keel maps path patterns to the doc to read first, points agents to it, and lints tests that reach a platform-only tool without saying so. Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
evidence: []
issue: 52
---

# Read this before touching that

## Done when

`.keel/keel.json` `"contracts"` maps path patterns to the document to read first; keel's guide block lists them, doctor checks each doc exists, and a pre-edit hook (where the agent supports hooks) names the doc when a matching file is about to change; and a platform-guard lint fails a test that calls a macOS-only (or Windows-only) tool without a platform skip; both on keel and one adopted project.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 8.

- **Contracts**: `"contracts": [{ "paths": ["src/index/**"], "read": "docs/engine/indexing.md", "why": "..." }]`. Rendered into the guide's block as a table. Doctor notes a missing doc or a pattern matching nothing.
- **The hook**: for Claude Code, a `PreToolUse` hook on Edit and Write that prints the contract to read when the target matches (it never blocks). Other agents get the guide's table only.
- **Platform guard**: a lint (in `keel doctor`, run by the night) that scans test files for a list of platform-only tools (`ditto`, `hdiutil`, `launchctl`, `codesign`, `osascript`, `mdls`, `stat -f`…), and fails a test that calls one without a skip for that platform. A project can add tools to the list.

## Acceptance

- [ ] Contracts render into the guide, doctor notes a missing doc or an unmatched pattern, and the hook prints the doc for a matching path and stays silent otherwise. `tests/contracts.test.mjs`
- [ ] The platform-guard lint fails a test file calling `hdiutil` without a darwin skip, and passes one with it; a project's added tool is checked too. `tests/doctor.test.mjs`
- [ ] ⚑ by hand: one adopted project's contracts set, and an agent's edit near one shown the doc first.

## Your part

- **Ask:** Name the two or three places in one project where an agent should always read a document before editing, and watch an agent get pointed to it.
- **Why:** It is the cheapest way to stop an agent reasoning from a stale code comment.
- **Look at:** The project's code that has an as-built doc.
- **Choices:** Helped | Noise
- **Takes:** 10 minutes.
- **Then:** Helped: the phase is built. Noise: the hook becomes the guide's table only.
- **Ready when:** this is built.

## Real surfaces

- Owner's machine: the pre-edit hook in Claude Code.
- Adopted project: one with as-built docs.

## Proof

Automated: `node --test tests/contracts.test.mjs tests/doctor.test.mjs`; `npm run check`.
By hand: one agent edit pointed to its contract.

## Deliberately open

- **The tool list**: macOS first, since the case that prompted it was a Mac gate and Linux CI. Settled by the first false positive.

## Next action

Brief a builder on `contracts` and the platform-guard lint.

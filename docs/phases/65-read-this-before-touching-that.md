---
status: partial
owes: walk
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

- [x] Contracts render into the guide, doctor notes a missing doc or an unmatched pattern, and the hook prints the doc for a matching path and stays silent otherwise. `tests/contracts.test.mjs`
- [x] The platform-guard lint fails a test file calling `hdiutil` without a darwin skip, and passes one with it; a project's added tool is checked too. `tests/doctor.test.mjs`
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

Automated: `node --test tests/contracts.test.mjs tests/doctor.test.mjs` (both load the hermetic bootstrap themselves; `tests/hermetic.test.mjs` runs them alone under a hostile git config); `npm run check`.
By hand: one agent edit pointed to its contract.

## Deliberately open

- **The tool list**: macOS first, since the case that prompted it was a Mac gate and Linux CI. Settled by the first false positive.

## Next action

The ⚑ walk: set one adopted project's `contracts`, run `keel render`, and let an agent edit near one in Claude Code.

## Trajectory

- **2026-10-09** — Claude Code's docs (as read on 9 Oct) name `additionalContext` for UserPromptSubmit, and not plainly for PreToolUse, where plain stdout reaches only the transcript. The hook prints JSON with both `systemMessage` (shown to the person) and `hookSpecificOutput.additionalContext` (for the model), and never a `permissionDecision`. Whether the model sees it is the walk's question.
- **2026-10-09** — `.claude/settings.json` is seeded, not managed: a project's own settings are never written over. A project that has one gets a `contract-hook` note naming the entry to add. The hook script and the settings are conditional targets (practice.json `"when": "contracts"`), so no project gets them until it sets contracts.
- **2026-10-09** — The table lives in the `agents-md` block, not a block of its own: a new block would need markers in every project's AGENTS.md. Without contracts the block's bytes are the template's.
- **2026-10-09** — A skip counts only when it compares `process.platform` with the tool's own platform: `{ skip: process.platform !== 'win32' }` does not guard an `hdiutil` call. The lint also runs in the night's project-side reading (PROJECT_LINTS).
- **2026-10-09** — Review of PR 58 (two Codex reviewers) changed the guard. A skip now clears only the command it covers (its test, its `if` branch, or the rest of the block after an early return), and only in the right direction: `skip: process.platform === 'darwin'` runs the command on Linux, so it is a finding. A command counts only through a process runner the file imports (child_process, execa, zx), not a helper of its own named `run` or `sh`, and outside the shell's quotes. `stat -f` became `stat -f %` (BSD's format form): GNU's `stat -f .` runs on Linux. Doctor parses `.claude/settings.json` for a real PreToolUse hook instead of finding the path anywhere. A conditional target turned off keeps its lock row, so an edit made while it is dormant is refused, not overwritten, when it comes back.

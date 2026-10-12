# Robot pilot approval — 2026-10-12

The owner explicitly approved the prepared Keel pilot in this chat: 60 combined
build/review agent minutes per week, Claude builder and Codex reviewer. This is
not a dollar cap or a cap on all GitHub Actions execution. A person merges.

Read-only GitHub checks found the deployed robot router and worker active, both
CLAUDE_CODE_OAUTH_TOKEN and OPENAI_API_KEY secret names present, and permission
for workflow PR reviews enabled. No secret values were read. Presence is not
proof that authentication will succeed.

The configuration change adds only robot.on=true and robot.budgetMinutes=60 to
current main. Three versioned rubrics were prepared and round-tripped through
the shipped parser: existing issues #60 and #63, plus a scoped workflow-name
child of #94. They are queued one at a time; no issue or PR is accepted by this
record. The parent #94 retains its unrelated older-Node follow-up.

This is operational enablement, prepared by the conductor, not a new robot
implementation. The phase claim command refused because partial/owes:walk is
already implemented; there was no competing claim. Phase 54 remains partial
until the owner reads and merges three actual robot deliveries.

Verification before push: npm run check and npm run typecheck. Exact results
belong to the activation commit. Workflow run and PR links will be recorded
as they become available; no scheduled or real-provider success is claimed yet.

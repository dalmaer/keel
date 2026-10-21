---
status: partial
owes: walk
waits: owner
since: 2026-10-21
goal: G7
spec: 2
depends: [93]
note: "Private repository, Vercel project and Supabase Free production connection verified. Approved GitHub App waits on owner identity verification; no application deployed."
evidence: ["evidence/2026-10-21-vercel-workspace-connections.md"]
---

# The private instance has approved connections

## Done when

The owner has an approved deployment recipe and verified private workspace repository, host and selected-repository GitHub App binding, with credentials stored only in the deployment secret store.

## Scope

Prepare a provider-specific deployment/setup recipe and permission matrix after the owner selects existing or new resources. Record provider IDs and secret names privately; public evidence includes only sanitized coverage. This is the resource connection walk before implementing provider-bound login.

Contract: [Private workspace, public Keel application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [x] ⚑ By hand: owner approves exact repository, hosting target, price and GitHub App permission matrix: `docs/guide/web-workspace-setup.md`.
- [ ] ⚑ By hand: verify workspace repository privacy and selected installation repositories with fresh GitHub API facts: `docs/guide/web-workspace-setup.md`.
- [ ] ⚑ By hand: verify configured Node version, HTTPS callback origin, external durable storage, secret injection and backup destination on the selected host: `docs/guide/web-workspace-setup.md`.

## Real surfaces

- GitHub API: verify actual private repository identity and installation selection with sanitized evidence.
- Owner's machine: walk the approved setup recipe and store no credentials in Git.

## Proof

Named test paths are implementation targets until this phase is built, not
claims of existing checks or passing results.

- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

**Settled 2026-10-21:** owner selected Vercel and the private repository; repository creation and privacy were verified. The owner also selected an existing Pro team; the project and assigned domain are verified. The owner approved Supabase Free/iad1/production-only and the read-only selected-repository GitHub App. Database provisioning and connection are verified; App registration, backup and serving-runtime checks remain open. No synthetic connection can satisfy the live resource checks.

## Next action

Complete GitHub’s Confirm access identity check, then register/install the already-approved read-only App and verify its selected repositories. Verify the backup destination before closing the connection walk. The actual serving Node patch is verified during phase 95 deployment. Vercel login/team/project and repository privacy are verified; application login is not.

## Trajectory

- **2026-10-21** — Remaining resource work is an owner identity/connection walk, not application code. Marked walk owed so phase 95 implementation can proceed while App registration and backup selection remain unverified. Actual serving Node-patch proof moves to phase 95, where the service is first deployed; configured Node 24.x remains a phase 94 check.

- **2026-10-21** — Owner selected Vercel, superseding the unprovisioned Render candidate. Stateless concurrent functions require external transactions and bounded polling; phase 93 remains the local filesystem adapter. Private repository creation succeeded; Vercel login is required.

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.

## Your part

### 1. Connection and approval

- **Ask:** Owner approves exact repository, hosting target, price and GitHub App permission matrix.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** The owner has selected accounts and reviewed the concrete deployment recipe and price.

### 2. Connection and approval

- **Ask:** Verify workspace repository privacy and selected installation repositories with fresh GitHub API facts.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** The owner has selected accounts and reviewed the concrete deployment recipe and price.

### 3. Connection and approval

- **Ask:** Verify configured Node version, HTTPS callback origin, external durable storage, secret injection and backup destination on the selected host.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** The owner has selected accounts and reviewed the concrete deployment recipe and price.

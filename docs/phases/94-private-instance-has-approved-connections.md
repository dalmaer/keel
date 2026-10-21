---
status: partial
since: 2026-10-21
goal: G7
spec: 2
depends: [93]
note: "Private repository and owner-selected Vercel Pro project verified. Durable storage and GitHub App binding remain; no application deployed."
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

- [ ] ⚑ By hand: owner approves exact repository, hosting target, price and GitHub App permission matrix: `docs/guide/web-workspace-setup.md`.
- [ ] ⚑ By hand: verify workspace repository privacy and selected installation repositories with fresh GitHub API facts: `docs/guide/web-workspace-setup.md`.
- [ ] ⚑ By hand: verify Node version, HTTPS callback origin, external durable storage, secret injection and backup destination on the selected host: `docs/guide/web-workspace-setup.md`.

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

**Settled 2026-10-21:** owner selected Vercel and the private repository; repository creation and privacy were verified. The owner also selected an existing Pro team; the project and assigned domain are verified. Storage, installation and their price/permission approvals remain open. No synthetic connection can satisfy the live resource checks.

## Next action

Approve the prepared Supabase Free production-only resource and read-only selected-repository GitHub App proposal, then verify storage and installation bindings. Vercel login/team/project and repository privacy are verified; application login is not.

## Trajectory

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

- **Ask:** Verify Node version, HTTPS callback origin, external durable storage, secret injection and backup destination on the selected host.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** The owner has selected accounts and reviewed the concrete deployment recipe and price.

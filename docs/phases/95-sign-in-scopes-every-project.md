---
status: planned
since: 2026-10-21
goal: G7
spec: 2
depends: [94]
note: "Authorized web workspace sequence; acceptance remains unverified."
evidence: []
---

# Sign-in scopes every project

## Done when

The deployed service authenticates its owner and denies every project, artifact and operation outside the current user, workspace and installation intersection.

## Scope

Implement the GitHub App authorization flow, external session store, per-request access policy, logout/revocation, CSRF/origin controls and deployment entry point. Reuse phase 93 manifest validation; use explicit hosted storage bindings rather than filesystem paths on Vercel. Keep all tokens server-side.

Contract: [Private workspace, public Keel application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Login rejects replay, bad state, expired attempts and unsafe return paths; sessions rotate and expire: `tests/web-auth.test.mjs`.
- [ ] Denied membership, revoked access and unauthorized project/media/stream requests reveal no private records: `tests/web-access.test.mjs`.
- [ ] Independent function instances atomically consume authorization attempts, revoke sessions and preserve versioned writes; unavailable storage fails closed: `tests/web-store.test.mjs`.
- [ ] Mutation routes enforce origin and CSRF; public static/package output contains no secrets: `tests/web-server.test.mjs`.
- [ ] ⚑ By hand: actual login, logout and denied-project access work on the approved HTTPS origin: `docs/guide/web-workspace-setup.md`.

## Real surfaces

- Published package: start the extracted service with explicit external config.
- GitHub API: run real login/installation access reads without logging tokens.
- Owner's machine: verify login, logout and denial in a browser against the approved service.

## Proof

Named test paths are implementation targets until this phase is built, not
claims of existing checks or passing results.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-auth.test.mjs tests/web-access.test.mjs tests/web-server.test.mjs tests/web-store.test.mjs`
- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

Public signup, additional identity providers and multi-tenant hosting are outside this release.

## Next action

Implement the provider-bound login and request authorization after phase 94 connections are verified.

## Trajectory

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.

## Your part

### 1. Real use

- **Ask:** Actual login, logout and denied-project access work on the approved HTTPS origin.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.

# Evidence: 94 — Vercel selection and private repository boundary

- Date: 2026-10-21
- Phase: 94
- Revision: 689953422134262e3389b7a43693be659450db69 plus documentation working tree
- Claim being checked: owner-selected repository creation and privacy; provider
  choice changes the deployment contract, not the implemented login status.

## Automated checks

- `gh api user --jq .login`: exit 0; authenticated identity matched the selected
  repository owner. Identity omitted from public evidence.
- `gh repo view <selected-private-repo> --json nameWithOwner,isPrivate,url`:
  before creation, exit 1, repository could not be resolved.
- `gh repo create <selected-private-repo> --private --description <description> --add-readme`:
  exit 0; created the owner-selected repository. Exact target was supplied by
  the owner in the setup conversation; public evidence omits private identity.
- `gh repo view <selected-private-repo> --json nameWithOwner,isPrivate,id,url`:
  exit 0; returned `isPrivate: true` and a numeric-backed repository node ID.
- `vercel whoami --no-color`: exit 1; CLI 59.23.2 reported `loggedIn: false`,
  `login_required`, requiring a fresh interactive login. Account/team unavailable.
- `node bin/keel.mjs decision context --phase 94 --json`: exit 0,
  `not-configured`, digest
  `a338f83d5d8f130a5922c0806dfdaaad1a6c949927deefae65f92fc228300cfa`.
  This is legacy behavior, not verified decision-record coverage.
- Documentation checks: `npm run roadmap`, `node scripts/roadmap.mjs --check`
  and `git diff --check`; results retained in the change's commit body.
- Integration gate: `npm run check` (tests, roadmap, render and inbox guards),
  plus `npm run typecheck`. No runtime code changed in this adjustment.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Read owner's provider/repository response | Explicit destination selection | Vercel and private workspace repo selected | Provider choice; not paid storage or App permission approval |
| Read current official Vercel docs | Determine storage/runtime model | Stateless functions, external durable storage required | Design correction; not deployed runtime verification |
| Read back repository privacy | Private repository | API returned private | Privacy at observation time; not installation access or login |

## Gaps and decision

Phase remains partial. No Vercel project, database, Blob store, secret, GitHub App
or deployment was created. No actual callback, hosted Node patch, installation
scope, backup or access denial has been verified. Interactive Vercel login and
account/team selection are next; storage/API contract, price and GitHub App
permissions then need concrete resource approval. The repository contains only
its initial README; project selection and workspace records have not migrated.

The Vercel choice replaces an unprovisioned Render proposal. Phase 93's local
filesystem boundary remains built with its original evidence; it does not prove
serverless persistence. Updated phases require shared transactional state and
bounded polling before hosted access can be claimed.

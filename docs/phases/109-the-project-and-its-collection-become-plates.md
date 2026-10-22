---
status: partial
since: 2026-10-21
goal: G2
spec: 2
depends: [96]
review: wait
note: "Owner approved full product, repository, collection configuration and deployment rename; compatibility preserves journals and active consumers."
evidence: ["evidence/2026-10-21-plates-rename.md"]
---

# The project and its collection become Plates without losing continuity

## Done when

Plates runs under its new product, repository, executable and configuration names across the verified collection, with production serving the checked revision and existing data, permissions and unrelated work preserved.

## Scope

Rename the existing product and owned operational integration, including managed project files and connected private workspace references. Keep plate/project and All plates vocabulary. Rename the existing /conduct skill to /spin with unchanged behavior and a compatibility entry point. Do not implement spin instrumentation or unrelated planned features. Preserve immutable provenance and recovery identities. Use reviewed migration, explicit compatibility and exact source observations.

## Acceptance

- [ ] Canonical executable, package, config, workflows, scripts, skills and active documentation agree: `npm run check` and `npm run typecheck`.
- [ ] Legacy project migration preserves journal bytes, detects conflicts and leaves no duplicate schedules: `node --test tests/rename.test.mjs`.
- [ ] The verified collection can read its migrated config and execute its gates: `npm run check`, `npm run check:all`, and `npm run test:deep` in the relevant consumers, recorded in dated evidence.
- [ ] GitHub repository identity survives the rename and old references reach the same repository: `gh api repos/dalmaer/plates`, `gh api repos/dalmaer/plates-data`, and `gh api repos/dalmaer/plates-inbox`, compared with recorded numeric identities and old-name read-backs.
- [ ] Production serves the tested revision and sign-in/Home retain their existing access boundaries: `tests/web-home.test.mjs`, `tests/web-auth.test.mjs`, deployed revision read-back and browser walkthrough recorded in dated evidence.

## Real surfaces

- published package: install/link both executable spellings from the exact committed source and inspect version/help.
- workflow shell: validate the renamed installed workflow references and schedule inventory.
- adopted project: migrate isolated copies of each verified managed project and run relevant checks before rollout.
- GitHub API: preserve numeric repository IDs, verify renamed repositories, exact commits and PR results.
- owner's machine: preserve existing dirty work and durable local recovery records; verify the production serving revision, login/Home and selected-repository access without broadening permissions in the browser.

## Proof

Run the focused migration tests, full `npm run check`, `npm run typecheck`, per-consumer migration/gate checks, remote identity/commit read-backs, and the deployed read-only authentication/Home walkthrough. Record actual exit codes and remaining gaps in dated evidence. Existing resources and deployment are authorized; new credentials, broader access, paid resources or legal terms remain outside this authorization.

## Deliberately open

Legacy names used as durable operation identities remain recognized until recovery can safely retire them. Hosted origin/display-name changes depend on verified existing provider capabilities and availability. Ledger rollout waits for its concurrent task-action release; already-landed phase100 at main `431ec59` and reviewed Node/TypeScript updates are preserved. Unfinished parallel features are outside this release snapshot; repeated main changes require renewed integration checks.

## Next action

The owner approved continued PR216 fix-and-review cycles until migration checks are clean, retaining default limits and required gates. Published5cd3e3e passed2,750 local tests; hosted check39729339251 exposed missing source-only compiler tooling, now reproduced and corrected with a real clean installation and three passing compiler fixtures. Review5609745966 runtime-contract corrections pass101 focused tests with independent red-before/green-after proof. Run one frozen combined gate, then publish for exact-head checks and review. Ledger needs explicit metadata-path preparation before its consumer migration. Historical review-status markers await specific owner approval. Once gates pass, complete source release/deployment, all four consumers, authoritative Ledger card sync and final directory move. Browser verification awaits manual Mac unlock.

## Trajectory

- **2026-10-21** — The owner explicitly approved renaming the app, GitHub repository, READMEs and configuration files throughout the collection, followed by deployment. Inventory found five managed repositories plus private workspace and inbox references; shared source provenance remains historical.

## Your part

- **Ask:** GitHub verification is complete; the remaining production walkthrough follows the checked deployment.
- **Why:** Local tests cannot establish the production sign-in experience.
- **Look at:** The existing GitHub App settings page and the exact deployment URL recorded in the release evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One authentication and browser review session.
- **Then:** Record the observed result and keep any unverified acceptance open.
- **Ready when:** The tested revision is deployed; account verification already succeeded. A new provider challenge, if offered, must be completed through its official flow.

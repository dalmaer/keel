# Phase 127: hosted name compatibility with inactive cutover

Date: 2026-10-24. Source base: `4731cdbfda9961a87a4ec07be736e7b28b2f23e6`; design refinements `18808d8e` and `3db5a4bb`, plus this phase's working tree.
Phase: [127](../phases/127-the-web-home-and-its-database-move-to-plates.md).

## What is implemented

Cookie, environment, HTTP-header and durable operation-marker readers accept the exact table aliases and refuse conflicting values. Fresh session/login/OAuth issuance clears its alternate; completed flows clear both. A source candidate selecting the new cookie rows propagates authenticated session aliases through real server responses with the remaining absolute lifetime and no extra store renewal. In-flight flow cookies are consumed without inventing their unknown browser expiry. A bounded existing-store record prevents login-CSRF replay through another alias.

All 20 cookie, operation-marker and public RPC writer rows remain held in the shipped source. Candidate tests copy actual source into disposable directories and change only those exact rows; no production activation flag or new receipt authority exists. Ordinary current-name reads do not reissue cookies. Rollback-baseline readers recover operations written under either marker without a second write.

Migration `lib/web/migrations/014-plates-names.sql` copies 15 explicitly listed public function implementations and makes the old names forwarding functions in one transaction. Tests exercise real PostgreSQL through development-only PGlite, both aliases and service-role grants, bodies/defaults, retained rows, reruns and transaction rollback. Historical SQL, the private schema, internal tables and advisory-lock identity are unchanged. Production callers remain compatible before migration and never retry a failed or ambiguous mutation through another alias.

## Observed proof

- Independent conductor command: `PATH=/opt/homebrew/bin:$PATH npm_config_cache=/tmp/plates127-npm-cache node --import ./tests/helpers/hermetic.mjs --test tests/web-auth.test.mjs tests/web-config.test.mjs tests/web-migrations.test.mjs tests/web-operations.test.mjs tests/web-fleet-updates.test.mjs tests/web-operation-coverage.test.mjs tests/names.test.mjs`: exit 0, 90 passed, no failures or skips. Log: `/tmp/plates127-conductor-proof-corrected.log`.
- Builder's broader focused run: 266 passed, exit 0, retained in `/tmp/plates127-cutover-final-focused.log`. This is supporting builder evidence, distinct from the conductor run.
- Builder's disposable-copy mutation matrix: green baseline, then 57 assertion failures for 57 mutations, including both one-name directions, fresh-cookie alternate clearing, lifetime/epoch/idle guards, actual server propagation, replay protection, marker recovery and RPC pairs. The conductor inspected the runner and all result logs. [Retained commands, exits and log hashes](2026-10-24-hosted-name-mutations.json). Original runner: `/tmp/plates127-cutover-mutations.py`; logs `/tmp/plates127-cutover-mutation-logs-final/`.
- `node scripts/render.mjs --self --json`: exit 0; managed outputs matched source. `git diff --check` is required before commit.
- The full `npm run check` and `npm run typecheck` follow the final record; outcomes go in the commit, not predictions in this evidence.

## Audit and course corrections

The package adds PGlite as a pinned development dependency only. Runtime remains dependency-free, with no new CLI grammar or execution permission. The capability audit refreshes only the package fingerprint and canonical table fingerprint. The package uses the existing release-version-normalized digest. An initial conductor audit used raw package bytes and failed three source-coverage assertions; that failed log is retained at `/tmp/plates127-conductor-proof.log`, and the corrected calculation passed the independent run above.

Source review found that a fresh legacy cookie after rollback could leave a conflicting current alias. The fix applies to session, login and OAuth issuance; three cookie-jar regressions failed before it and passed afterward. The same rollback reasoning keeps durable operation-marker writers held as well.

## Not observed and owner boundary

No hosted migration, Vercel/environment change, actual browser upgrade/rollback, production acceptance, new writer activation or lived-in use is claimed. Local PostgreSQL does not measure hosted locks, dependencies or grants. The owner must verify and pin the deployed compatibility baseline, approve the hosted migration and prove both callers before a separately reviewed transition of the exact held writer rows. The remaining actual browser and rollout observations keep this phase partial and owing its walk.

The first integrated gate exited 1 (2949 passed, six failed, four skipped). Five failures traced to an unquoted evidence path in this new phase record, corrected to the repository's JSON front-matter format. The sixth was an older deployment fixture expecting conflicting current/legacy configuration values to be accepted; the new contract explicitly refuses that conflict. Retained log: `/tmp/plates127-check.log`. No passing retry is substituted for this result.

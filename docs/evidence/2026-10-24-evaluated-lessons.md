# Evidence: phase 121 — selected lessons and evaluation bindings

- Date: 24 October 2026, America/Denver.
- Phase: [121](../phases/121-evaluated-lessons.md).
- Revision: `d7e38c0eb5c8af3c9f58499f91622d3208b50602` plus implementation working tree.
- Scope: local record mechanics and verified selected provenance; no measured candidate benefit, promotion or paid execution.

## Historical source verification

After the existing explicit review read:

```sh
plates review dalmaer/plates#216 --reviewer 'github-actions[bot]' --json
PATH=/opt/homebrew/bin:$PATH node docs/evidence/2026-10-24-evaluated-learning-source.mjs
```

Both exited 0. The read-only adapter verified the selected original
[inline finding](https://github.com/dalmaer/plates/pull/216#discussion_r4344271993):
review 5608933935, thread `PRRT_kwDOU5nJK86vCWGO`, comment 4344271993.
Its reviewed revision is `edfc56476dd4b7880d8bba83a13436b5a3887a5a`;
the observed current PR head is `60680a2128012170d5f9e25e5b03acd11114c147`.
The result correctly says `reviewCoversCurrentHead: false`, classification
`reviewer-statement`, and `incidentKey: null`. This proves source existence
and identity, not a present defect, root cause, recurrence or acceptance.

The exact UTF-8 body digest is
`2937fdd40c340bab9b66ca0da37d5932fe85e1dcad09e748e6c4cdb30a1d999f`.
Raw review text is not reproduced here. Sanitized source observation:
`/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/plates-learning-source-bkFZQc/source-observation.json`.
Log: `/tmp/plates-phase121-source-retained-walk.log`. The earlier direct-module
observation remains in `/tmp/plates-phase121-real-source-result.json`.

## Existing protection inspection

At the named revision, `tests/rename.test.mjs` already exercises migrated
exports, imports, bin behavior, nested modules and npm package contents.
`docs/guide/plates-rename.md` already describes preserving entry paths and
public keys. The inspected package-path test does not install that migrated
fixture into a separate consumer. Any proposed installed-consumer check must
therefore demonstrate value beyond existing protections; redundancy and added
overhead are credible alternatives. Source inspection alone is not efficacy.

## Initial implementation checkpoint

At this initial checkpoint the integrated controller walk, full gate, typecheck
and PR review had not yet been verified by the conductor. Later observations
below settle the local checks; review remains separate. Builder-focused checks are
diagnostic until the integrated tree and named proof are checked. Phase 119's
review-limit owner decision remains pending; no dependent merge bypasses it.

## Public CLI lifecycle — 24 October 2026

```sh
PATH=/opt/homebrew/bin:$PATH TZ=UTC node --import ./tests/helpers/hermetic.mjs docs/evidence/2026-10-24-evaluated-learning-cli.mjs
```

Exit 0, with 28 retained command observations: capture, propose, plan binding,
revision and rejection; repeat previews, wrong-digest refusals, duplicate original
operations, legacy acceptance refusal and inspection. Five history generations
remain, with both proposal versions preserved. The experiment's execution
projection remains null: no trial was dispatched. This uses a private synthetic
Acme workspace and simulates only GitHub transport; production record, source,
Git, ledger and CLI code handle the workflow. It does not prove real efficacy.

Workspace: `/private/var/folders/63/4k_ydj554mz6_56j2hpg7jcr0000gn/T/acme-learning-Vbtm2Q`.
Log: `/tmp/plates-phase121-conductor-cli.log`. Typecheck exited 0, retained in
`/tmp/plates-phase121-typecheck.log`. Builder focused checks passed 178 with no
skips; initial convention failures remain in `/tmp/plates-phase121-focused-first.log`,
with the corrected run in `/tmp/plates-phase121-focused-second.log`.

## Final integrated proof — 24 October 2026

`PATH=/opt/homebrew/bin:$PATH TZ=UTC npm run check:focused -- tests/evaluated-lessons.test.mjs`
exited 0: 122 passed, zero failed, zero skipped. The CLI walk above separately
verified the public surface. `PATH=/opt/homebrew/bin:$PATH TZ=UTC npm run check`
exited 0: 3,025 passed, zero failed, 11 opt-in skips; all nine stall-injection
suites passed. Roadmap, render and inbox checks passed. The ledger reported no
flaky or slower test (29 retained runs, 14 busy runs omitted). Logs:
`/tmp/plates-phase121-conductor-focused.log` and `/tmp/plates-phase121-check.log`.
Typecheck also exited 0 as recorded above. The checked tree was
`d7e38c0eb5c8af3c9f58499f91622d3208b50602` plus the implementation retained in
this commit; subsequent record-only changes reconcile these results.

Locally built record mechanics do not establish measured improvement. The
provider/spend gaps remain in phase 119, and phase 122's actual screening is
still pending. Phase 121's PR review and the dependent merge hold remain open.

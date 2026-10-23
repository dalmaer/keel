# White Elephant: adoption did not complete fleet enrollment

Observed 23 October 2026. This record distinguishes current source facts from
what the earlier task did not record; it does not invent an intentional opt-out.

## Evidence

- White Elephant PR 1 merged at 03:39:47 UTC as
  `16ace521559dcec711ff1fc86b4131e298584ecd`. Current default-branch
  `.plates/plates.json` identifies `dalmaer/white-elephant`, practice 0.8.33,
  setup `npm ci`, gate `npm ci && npm run check`, stack node/web/github-actions,
  and base/agents-md/lessons/ci/night/renovate practices.
- Its `docs/plates-integration.md` explicitly says the local admission manifest
  “is not a registration in Plates' shared fleet manifest.” The temporary
  admission manifest was only an allowlisted local validation target.
- Plates remote main `5fc2f03118195fa85a0b0511cf495a86d8945a6e` still contained
  five root `plates.json` rows: Plates, duo, cajones, ledger and isocan. None was
  White Elephant. The latest manifest commit was the product rename,
  `a9e6600bb222040ac71f55c4873f8de9e3e3d7d3`, before consumer adoption.
- `lib/adopt.mjs` writes only the consumer’s selected practices, configuration,
  guide blocks and adoption report. It never reads or writes the source fleet
  registry. Before this correction, its successful text/JSON/report did not
  state the outstanding registration check.
- `lib/fleet.mjs` reads Plates root `plates.json`; the guide names that contract.
  Therefore a healthy consumer config is insufficient to create a fleet row.
- A separate read of the actual private hosted workspace manifest also found
  White Elephant absent. That manifest is not the CLI fleet registry. Its
  exact private diff and access prerequisites are retained as a separate owner
  proposal outside this public source tree. No private workspace content,
  server allowlist or App grant was changed or exported into this correction.
- White Elephant modernization PR 2 remains open/draft at
  `6dda8582e36147f79e53c22441c2c81967d9fc05` and is outside this correction.

## Why the handoff failed

The consumer integration completed, but the cross-repository enrollment handoff
was left open. The earlier evidence even preserved that boundary; no subsequent
central registration change or owner decision to exclude the project is
recorded. The orchestration treated the completed consumer PR as the end of the
requested adoption without tracking central enrollment as a separate completion
condition. The command reinforced that gap by reporting adoption success
without an explicit unverified enrollment state or completion check.

This is supported by the recorded outputs and missing registry row. It is not
evidence of a GitHub synchronization failure, an intentional exclusion, a
credential problem, or an automatic registration attempt that failed.

## Correction and completion contract

Add only `dalmaer/white-elephant` as `kind: web`, `role: managed` to the source
manifest, preserving every existing row/policy. Adoption output (including
practice additions) now reports `fleetRegistration.status: not-checked` and the
written report names the separate completion step. The read-only source checker
requires the root manifest beside a Plates self configuration, refuses admission
or consumer manifests, fails on absent/source-only entries and unavailable
evidence, and succeeds only
on a managed row in the actual supplied central manifest. Tests cover real
consumer adoption output, missing and malformed registry evidence, and the
approved production manifest entry. Removing the row must fail the latter test.

The applicable lesson is the existing catalogue’s boundary/target family: a
write or success at one owner’s target does not prove another owner’s state.
Completion evidence must name both consumer revision and central manifest
revision; hosted access, routines and budgets remain separately attributed.

## Scope that remains separate

The CLI enrollment adds White Elephant to existing fleet observations, update
planning and release rehearsal; it does not run them now. Hosted workspace
manifest selection, server `projectRepoIds`, App repository permissions,
update-worker activation, explicit collector/audit target lists and user
scheduled automations are not silently extended. If White Elephant must appear
in the hosted workspace or an existing fixed audit target list, inspect those
current policies and review the exact scope change separately. No credentials,
secrets, deployment settings, security grants or schedules changed here.

## Validation state

Five focused registration tests and two adoption-handoff tests pass. Supported
`plates prove` named proofs verified red/green for the actual manifest row and
the original missing adoption status. Independent review found two P2 gaps in
the initial correction: arbitrary admission-shaped manifests could be accepted,
and malformed existing repo text could enter a copyable shell command. Both
were corrected with negative tests: require a Plates self-root manifest and
validate string repository identities before emitting a command or accepting
registry evidence. Two intermediate assertion
failures after those contract changes are retained in the local test ledger;
the expectations were corrected for the new explicit unavailable-identity and
missing-root behaviors, not retried unchanged. No flake was suppressed.
Roadmap, render, inbox and whitespace guards pass. The broader source convention
preflight and full gate remain pending the parent’s shared validation slot. The full integrated gate
is not claimed: another task owns the exclusive heavy slot until the parent
coordinates this correction’s checkpoint. A proposed manifest is not merged
central membership; no merge or deployment is performed by this step.


## First convention preflight — 23 October 2026, 17:09 UTC

The first frozen candidate passed 111 of 115 source-convention tests and failed
four. The guide guard correctly refused to present a source-only script as a
shipped consumer command; its executable example moved into the development
procedure, with a link retained in the consumer guide. The capability guard
correctly detected the changed `lib/adopt.mjs` source pin; the adoption diff was
reviewed as output-only (no new CLI forms, options or capability treatment), and
only that source hash was refreshed. A negative test changes the new status
into a false registration claim and verifies that coverage still fails closed.
No allowlist, hash comparison or consumer-command check was disabled. The
33.9-second failed attempt remains retained; typecheck and full gate did not
start after that failure. The corrected candidate needs fresh independent
review and validation before publication.

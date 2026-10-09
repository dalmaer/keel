# A fleet update never dead-ends

The owner, 2026-10-09, after a day of fleet rounds: "ledger and isocan should
be fixed... how can we make sure these issues are never blockers?"

## What blocked, on 2026-10-09

Four releases in one day (v0.8.23 to v0.8.26). Each fleet round hit at least
one of three things:

1. **A project's main was already red.** isocan's own check failed on main
   (239 undocumented exports against its agreed 238, from a web change that
   moved a comment). `keel fleet update` saw it ("main fails the same check
   without the update: not this update") and still opened nothing. The update
   waited on a problem it did not cause and could not make worse.
2. **The update broke one of the project's own rules.** ledger tests that
   every environment variable its code reads is named in
   docs/configuration.md. The new practice files read nine it did not name.
   The update restored ledger as it was and left nothing to fix. The fix
   took a separate PR (ledger#113), its merge, and a second fleet round.
3. **Each round drew new review findings on keel's code.** Codex reviewed
   every fleet PR and found real defects in canvas recovery code written that
   day. Each finding meant a fix in keel, a release and another round. Phase 48
   moves that review to keel, before the release.

The first two are the subject here. Both end the same way today: the fleet
round reports FAILED and the work is thrown away.

## The shape

### Phase 52: a fleet update always leaves a PR

When the project's check fails after the update, `keel fleet update` keeps
the update on its branch and opens the PR anyway. It never restores and walks
away. What the PR says depends on main:

- **main fails the same check without the update**: an ordinary PR whose
  description opens with "main was already red: `<check>` fails without this
  update (exit N); this update did not cause it", and the tail of main's
  failure. The update can be merged on its own merits, while main's red is
  fixed elsewhere.
- **main passes without the update**: a draft PR, opening with "this update
  fails the project's check", the command, and the tail of the failure. The
  fix is one commit on that branch (by the agent, tend or the owner), not a
  separate PR and a second round. A draft cannot be merged by accident.
- **main's check did not finish**: a draft, saying so.

`keel update` in one checkout keeps today's behaviour (restore, exit 1): a
person is there to read it. Only the fleet, where nobody is watching, keeps
the work. `update()` gains an option that returns the failed check instead
of restoring. The fleet's own run of main's check (`mainCheckOf`) already
exists; its line moves from the terminal into the PR.

The board lists a draft update PR under **Broken** ("ledger: keel update
v0.8.26 fails ledger's check"), linking the PR. A ready PR on an already-red
main is listed as the agent's, as other update PRs are, with main's red
already under Broken from the fleet strip.

### Phase 53: a release is rehearsed on the fleet before it is tagged

`keel release` already runs keel's own check before it commits and tags. It
also rehearses the update on every managed fleet project: clone, install,
update to the candidate practice, run the project's check. It pushes nothing
and opens no PR. This is `keel fleet update --rehearse`, the same per-project
path as phase 52 without the push.

- A project whose check passes on main and fails with the candidate makes
  `keel release` refuse, naming the project and the failure's tail. The fix
  goes in keel (or the project) before the tag, so the fleet never sees it.
- A project whose main is already red is reported, never a refusal.
- An owner's `--despite <repo> "<why>"` releases anyway and records the
  reason in the release commit and WHATSNEW. Then phase 52 opens that
  project's PR as a draft.
- Projects are rehearsed in parallel, bounded, with the fleet update's
  timeout. A project that cannot be cloned or installed is reported, not a
  refusal: the rehearsal is evidence, not a second CI.

With phase 48 (reviewed before release) it moves both kinds of fleet-round
surprise into keel, before the tag.

## What it costs

- **Release time**: the slowest project's install and check, roughly 5 to 10
  minutes today (isocan's check, with its build). Releases get slower and
  rarer. On 2026-10-09 that trade would have saved three of the four
  releases.
- **No new spend**: the projects' checks run on the conductor's machine, as
  `keel fleet update` already does.

## Measured

- **Fleet rounds that ended FAILED**, per release, before (v0.8.12 to
  v0.8.26, from the session's fleet logs and PR history) and after.
- **Releases per day while a fleet round is open**: 2026-10-09 had four.

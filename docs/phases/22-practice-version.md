---
status: built
since: 2026-10-04
goal: G2
depends: [6]
note: "practices/VERSION is the practice version; package.json is the CLI's. A plates-only release leaves every project current and update makes no change; a practice change still bumps both."
evidence: ["evidence/2026-10-04-practice-version.md"]
---

# A project hears about a new practice only when the practice changed

## Done when

`plates release` moves the practice version only when `practices/` or `migrations/` changed since the last practice release. A plates-side-only release leaves every project current, and `plates fleet update` opens nothing for it.

## Scope

Two versions, stated separately:

- **The CLI's own version**: `package.json` `version` and the release tag.
- **The practice version**: what projects record in `.plates/plates.json`,
  and what update, fleet and init compare.

`plates release`:

- computes whether `practices/**` or `migrations/**` differ from the commit
  of the last practice release;
- if they do, bumps both versions;
- if not, bumps only the CLI version, and says "practice unchanged at X".

The practice version lives in one place (for example
`practices/VERSION`, or a field read by `practiceVersion()`). Projects on
the current practice stay current across CLI-only releases.
`plates --version` prints both. WHATSNEW notes say which kind of release each
one was.

## Acceptance

- [x] A release with no change under `practices/` or `migrations/` leaves the practice version, and every project's "current", unchanged (test with a temp plates-shaped repo).
- [x] A release that changes a practice file bumps the practice version, and fleet then marks projects behind (test).
- [x] `plates update` on a project whose practice is current, after a CLI-only release, makes no change and opens nothing.
- [x] The design's open item on this is settled in place.

## Proof

`node --test` on the release, update, fleet and cli tests; then
`node bin/plates.mjs release --dry-run` on plates now (a CLI-only release
since 0.5.2) reports that the practice is unchanged.

## Deliberately open

- **The CLI version number scheme after the split.** It stays semver,
  starting from 0.5.2.

## Next action

None.

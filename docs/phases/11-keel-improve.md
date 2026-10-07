---
status: partial
owes: walk
since: 2026-10-02
goal: G4
depends: [5, 9]
note: "keel improve measures 12 things with ratcheting bounds, broken is never zero, and the selftest fails on an unhealthy fixture. First real page on keel: one measure outside (9 phases without an issue); its proposal awaits the owner's decision."
evidence: ["evidence/2026-10-02-improve.md"]
---

# A project can say, with numbers, whether its practice is working, and proposes one fix

## Done when

`keel improve` writes `docs/health/<date>.md` with deterministic measures and one proposal, changes nothing else, and its self-test fails on a fixture built to be unhealthy.

## Scope

Measures, each a number with a bound and the command that produces it: CI red
streak; roadmap stale; unfinished phases without an issue; phases stuck in one
status past a bound; lessons without a named guard; open machine PRs; oldest
dependency behind; managed drift (`doctor`); deploy verified at the last push;
conducting cost from a session's subagent transcripts. A ratchet: a measure
that improves sets a new bound. The proposal names the worst measure and the
smallest change that would move it.

## Acceptance

- [x] `--selftest`: a deliberately unhealthy fixture fails every measure (isocan's lesson: a grader that reports zeros when broken is believed).
- [x] An instrument that cannot run exits non-zero rather than reporting zero.
- [ ] ⚑ by hand: run on keel itself, the page is committed, and the owner turns its proposal into a phase or declines it.

## Proof

`node --test tests/improve.test.mjs`; `keel improve --selftest`; one real page on keel.

## Deliberately open

- Which measures are fleet-wide and which are per-kind (a static site has no API to verify). Per-kind switches in `.keel/keel.json`, settled when the second kind is adopted.

## Next action

Owner: decide `docs/health/2026-10-02.md`'s proposal — open issues for the nine unfinished phases and set `issue:` (accept), or decline it with a reason.

## Trajectory

- **2026-10-02** — Conducted before phase 10, because the nightly workflow runs `keel improve --report`.
- **2026-10-02** — `machine_prs` is exempt from the ratchet. Its bound of 1 is the night shift's rule, and tightening it to 0 would flag the nightly's own PR every morning.
- **2026-10-02** — Measured on this session's own builders: 0 whole-check runs across 10 transcripts. The cost rule carried from isocan `7227f325` held.

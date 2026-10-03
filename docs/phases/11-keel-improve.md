---
status: planned
since: 2026-10-02
goal: G4
depends: [5, 9]
note: "Measures listed in design.md §6; the conduct-cost measure exists upstream as isocan's scripts/subagent-time.mjs."
evidence: []
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

- [ ] `--selftest`: a deliberately unhealthy fixture fails every measure (isocan's lesson: a grader that reports zeros when broken is believed).
- [ ] An instrument that cannot run exits non-zero rather than reporting zero.
- [ ] Run on keel itself, the page is committed and its proposal becomes, or is declined as, a phase.

## Proof

`node --test tests/improve.test.mjs`; `keel improve --selftest`; one real page on keel.

## Deliberately open

- Which measures are fleet-wide and which are per-kind (a static site has no API to verify). Per-kind switches in `.keel/keel.json`, settled when the second kind is adopted.

## Next action

Port isocan's subagent-time measure's idea into a keel measure and test it against one transcript directory from a conducted keel session.

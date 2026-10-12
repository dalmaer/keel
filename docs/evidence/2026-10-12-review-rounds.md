# Phase 71: review rounds, as built (2026-10-12)

What was checked on 2026-10-12, on `claude/phase-71` from main at bfdd560.

## Automated

- `node --import ./tests/helpers/hermetic.mjs --test tests/review-rounds.test.mjs tests/board.test.mjs tests/skill.test.mjs` passes. `tests/review-rounds.test.mjs` covers round counting, exit 3 at the limit, `"review": {"rounds": N}` and a bad value, `--class` alone and with `--close`, and the sorted list for a finding that arrives in the round that reaches the limit.
- `npm run check` exits 0.
- A deliberate break: with the filter that keeps a class-only reply from counting as an answer removed, five of the new tests fail. It was restored.

## On a real PR

- `keel review 95` on dalmaer/keel, read on 2026-10-12: 16 review comments, 0 unanswered, and `--json` reports `rounds: {count: 4, limit: 3, reached: true}`. #95 is merged, so the exit code stays 0 and no choice is printed, as designed. Re-derive: `keel review 95 --json`.

## Not checked

- No open PR has reached the limit since this was built, so exit 3 and the printed choice are proven only on a stubbed gh. That is the owner's walk in the phase file.
- `--class` has not been posted to a real PR.

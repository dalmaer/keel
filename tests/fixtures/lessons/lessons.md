# Lessons

Failure modes that have actually happened at Acme, and the guard that now
catches each one.

| # | The shape of it | What it cost | Guard |
| --- | --- | --- | --- |
| 1 | **A cache that outlives its key serves yesterday's answer.** *(acme 2)* | Acme Notes showed a deleted note for a day after it was removed. | The cache key includes the note's revision. `tests/cache.test.mjs` asserts a stale read misses. |
| 2 | **A pipe in a guard: `a \| b` reports b's exit code.** *(acme 3)* | A red check read as green twice. | Gates read exit codes, never a tail. *Planned:* phase 4. |

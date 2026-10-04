# Evidence: phase 22 — the practice version moves only when the practice does

- Date: 2026-10-04
- Phase: 22
- Revision: the phase 22 commit.

| Check | Result |
| --- | --- |
| `npm run check` (conductor, integrated tree) | exit 0. `ℹ tests 256` · `ℹ pass 256` · `ℹ fail 0` |
| `git diff --quiet v0.5.2 -- practices migrations` | exit 0: no practice change since v0.5.2 |
| `node bin/keel.mjs release 0.5.3 --notes - --dry-run` on the real tree | `keel release v0.5.3 (from 0.5.2) is keel only; practice unchanged at 0.5.2 … projects stay current.` |
| `keel --version` | `keel 0.5.2 (…) practice 0.5.2`, each value read from its own source (`package.json`, `practices/VERSION`) |
| Release tests (temp repos) | A keel-only release bumps the CLI only. A practice change bumps both. `--practice` is refused when nothing changed. Mutation: forcing "changed" fails 3 tests |
| Box 3 (`tests/update.test.mjs`) | In a keel copy, a keel-only release takes the CLI to 0.5.3 while practice stays 0.5.2. A project at 0.5.2 updated by it: `Already on practice 0.5.2`, exit 0, tree hash, HEAD and branches unchanged; fleet's plan is null. Mutation: practice read from the package version fails the test |
| Design | The open item "The practice version is the package version" is settled in place, dated |

Supports **built**.

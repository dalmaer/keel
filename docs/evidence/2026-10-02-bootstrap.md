# Evidence: phase 0 — keel runs on its own practice

- Date: 2026-10-02
- Phase: 0
- Revision: the first commit (working tree before it described here).
- Claim being checked: the practice is installed on keel by hand and its
  guards run locally. Not checked: anything on GitHub.

## Automated checks

| Command | Exit | The line that says so |
| --- | --- | --- |
| `npm test` | 0 | `ℹ tests 5` · `ℹ pass 5` · `ℹ fail 0` |
| `npm run roadmap` | 0 | `Generated roadmap: 14 phases, 6 goals` |
| `npm run roadmap:check` | 0 | `Checked roadmap: 14 phases, 6 goals` |
| `npm run next` | 0 | `0. Keel is run the way it will tell others to run [partial]` |

The tests cover:

- the generator rejecting a bad filename, an unknown status, an impossible
  date, built without evidence, built with an unchecked box, an unknown field,
  acceptance without checkboxes, and a missing section;
- graph cycles, unknown goals, goals with no phases, and unknown dependencies;
- next focus skipping a phase whose dependency isn't built;
- the stale check failing and then passing in a temp project.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Generated the roadmap before this file existed | Refused | `00-keel-runs-on-itself.md: missing or empty evidence evidence/2026-10-02-bootstrap.md` | The evidence link is enforced on the real repo, not just in a fixture |
| Changed phase 9's status without regenerating, then ran `node scripts/roadmap.mjs --check` | Exit 1, stale | `docs/ROADMAP.md is stale — run npm run roadmap`, exit 1. Restored, exit 0 | The CI guard fires on the real tree |
| `ls -la .claude/skills` | A symlink to `.agents/skills/conduct` | `conduct -> ../../.agents/skills/conduct` | One file, many doorways. Doesn't prove Claude Code loads it; that is seen the first time `/conduct` runs |
| Read isocan's `7227f325` diff against the adapted skill | Every change carried | Present: builders test by file; one full check; point-don't-paste; 600-word caps; `pull --ff-only` then `add -N`; explicit staging; `git show --stat HEAD` | The adaptation is faithful by reading, not by running a conducted phase |

## Gaps and decision

- ⚑ No GitHub repo exists. `check.yml` has never run, so the phase stays **partial**.
- The conduct skill hasn't conducted a phase yet. Its first real run is phase 1.

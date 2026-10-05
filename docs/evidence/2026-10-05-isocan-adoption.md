# Evidence: isocan's adoption PR, prepared for Dimitri (5 Oct 2026)

Phase 16's last box. Dimitri agreed to adoption (the owner, 5 Oct).

| Did | Observed |
| --- | --- |
| Conductor: fresh clone of dglazkov/isocan at `2aecc264` (push URL disabled until the PR), `keel adopt --check "npm test && npm run typecheck" --dry-run`, then the write run | Gate from `--check`; lessons found at `docs/reviews/lessons.md`; phases read-only in the projects shape (37 projects); on: base, agents-md, lessons; local with reasons: phases, evidence, conduct (isocan is its source, nothing installed beside it), ci, night, claude, renovate, loop. `.claude/skills/conduct` reported, left untouched |
| `git show --stat HEAD` on branch `keel/adopt` | 7 files, **+191/−0**: `CLAUDE.md`, `.agents/skills/keel/SKILL.md`, `.claude/skills/keel`, `.keel/keel.json`, `.keel/lock.json`, `AGENTS.md` (+19, two keel blocks), `docs/keel-adoption.md` |
| `npm ci`, then the gate `npm test && npm run typecheck` on that tree | exit 0: **7,679 tests passed**, 109 skipped; typecheck clean; `git status` after: only the adoption's files |
| `keel status` and `keel doctor` in the clone | status reads 37 projects; doctor: 48 findings in isocan's own files: 29 `phase-status`, 19 `lessons-table-split` (from row 29, `docs/reviews/lessons.md` renders as text; ledger had the same) |
| ⚑ The PR | [dglazkov/isocan#392](https://github.com/dglazkov/isocan/pull/392), for Dimitri to merge or close. The findings are listed in it, not changed |

## Decision

The done-when is met: ledger's adoption landed (phase 20) and isocan's PR
is prepared for Dimitri. Supports **built**. Merging is Dimitri's; when he
does, fleet.json's isocan entry moves from `source` to `managed`.

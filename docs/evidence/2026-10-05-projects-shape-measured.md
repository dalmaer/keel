# Evidence: phase 27 — a project that keeps phases per project is measured, not skipped

- Date: 2026-10-05
- Phase: 27
- Revision: base `69e4cfc` (phases 27–29: what isocan does better comes home), working tree
- Claim being checked: `keel improve` on a projects-shaped repo (isocan) reports `phases_stuck`, `phases_without_issue` and the new record measures with values, and every new measure is `n/a` with a reason, never a zero, where the repo has nothing for it to read.

## Automated checks

| Command | Exit | The line that says so |
| --- | --- | --- |
| `node --import ./tests/helpers/hermetic.mjs --test tests/improve-records.test.mjs` | 0 | `ℹ tests 7` `ℹ pass 7`: a synthetic Acme repo in the projects shape (four projects, a git history dated March 2026, a gh stub) reads `records_disagree` 2, `status_unknown` 2, `changelog_gaps` 2, `research_unindexed` 2, `verify_owed` 3 (oldest 30 days), `issues_unnamed` 2, `issues_done_open` 1, `prs_stale` 2; `phases_stuck` names anvils/2 and traps/2 at 58 days; every new measure is `n/a` with its reason in a bare repo; `changelog_gaps` outside a git repository is `broken` |
| `node --import ./tests/helpers/hermetic.mjs --test tests/improve.test.mjs tests/night.test.mjs tests/ancestors.test.mjs tests/helpers.test.mjs` (with the file above) | 0 | `ℹ tests 60` `ℹ pass 60`, including the selftest's mutation test: each of the 23 measures made neutral, `n/a`, or to throw is the one the selftest misses |
| `node bin/keel.mjs improve --selftest` | 0 | `selftest ok: all 23 measures report outside on the unhealthy fixture.` The fixture grew `docs/projects` (anvils built with a phase open and issue #7 open; rockets partial with every phase closed and a `DONE`; skates with no Status line), `docs/changelog`, `docs/research`, `docs/verify`, and a stub git (`KEEL_GIT`) |
| `node bin/keel.mjs improve --json` in a fresh local clone of isocan at `7f7c5553f` | 1 | `phases_without_issue` 23 (8 projects with no `issue:`), `phases_stuck` 22 (phases.md untouched 22 days), `records_disagree` 2 (standing-agents partial with every phase closed; ui-refresh built with two PART-DONE), `status_unknown` 0, `changelog_gaps` 0, `research_unindexed` 25, `verify_owed` 14 (oldest 15 days), `issues_unnamed` 4 of 60, `issues_done_open` 4 (#355, #373, #147, #364), `prs_stale` 3 (24 days). `roadmap_stale` and `evidence_placeholders` `n/a`: "phases are in the projects shape" |

The whole gate, `npm run check`, runs after this file is written, by the
conductor; its result line goes in the commit body. Not run here.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Compared the isocan run with isocan's own practice page, `docs/practice/2026-10-05.md` | the same counts where the rules are the same | `research_unindexed` 25 = 25, `verify_owed` 14 (oldest 15) = 14 (15), `issues_done_open` 4 = 4, `prs_stale` 3 = 3. Different by design: `phases_stuck` 22 against 28 (21 days, not 14). Different by date: the page predates `7f7c5553f` and `a1fa5ac`, which filled the changelog (5 → 0) and gave four projects Status lines (3 → 0) | the port reads what isocan's script reads; does not prove the page and the measure agree on every future tree |
| `records_disagree` on ui-refresh, which isocan's page did not flag | a real disagreement | its phases.md front matter says `built`; phases 5 and 6 say `PART-DONE` | the measure catches what the page missed today |
| `issues_unnamed` 4 against isocan's 9 | — | keel skips only the health pages; isocan's practice pages under `docs/practice/` name the issues they list as unnamed, so five read as named here | a known undercount on a repo that writes its own issue-naming pages; not fixed |
| keel's own repo, the measures without the gate | the new record measures `n/a` | `records_disagree`, `status_unknown`, `changelog_gaps`, `verify_owed`, `issues_done_open` n/a; `research_unindexed` n/a (no `docs/research/README.md`); `issues_unnamed` 0, `prs_stale` 0 | keel's night does not go red from this phase |

## Gaps and decision

The isocan clone had no `node_modules`, so its `gate` was outside (exit 127);
the gate is not this phase's claim. `ci_red_streak` there is `n/a` because the
shipped improve does not read `.keel/keel.json` `gateWorkflow` (fleet does);
that is a gap outside this phase. Supports **built**. Lived-in waits for a
projects-shaped repo's own night to run these measures; isocan runs its own.

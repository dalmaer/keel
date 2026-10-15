# Evidence: phase 73 — a night has a plan, written before it runs and ticked as it goes

- Date: 2026-10-14 (local `date`; the night it describes runs 2026-10-15 UTC)
- Phase: [73](../phases/73-a-night-has-a-plan-written-before-it-runs-and.md)
- Revision: base `9a099e0` (the nightwatch spec, PR #136, not yet merged)
  plus the phase 73 commit on `claude/phase-73`, working tree when this was
  written.
- Claim being checked: the plan file and its validator, `keel night plan`
  (deterministic, exit 2 naming an unreadable input), the night reading the
  plan branch or making the default plan and saying which, `keel night tick`,
  and the record (`docs/night/<date>.json` in the data-only PR, "Tonight's
  plan" on the health page).

**No real night ran.** Nothing here pushed to GitHub, read the live
`keel-night-plan` branch, or ran keel's own `keel-night` workflow. Every
GitHub read is a stub gh; the workflow's steps are run as bash in synthetic
Acme repos with a bare local origin.

## Automated checks

`node --import ./tests/helpers/hermetic.mjs --test tests/night-plan.test.mjs tests/improve.test.mjs tests/workflows.test.mjs`:
exit 0, `ℹ tests 64`, `ℹ pass 64`, `ℹ fail 0`.

| Acceptance box | Test |
| --- | --- |
| Validator: accepts the design's schema; refuses an unknown field, a build item with no number, a sixth build item, each by name | `tests/night-plan.test.mjs`: "the validator accepts the design's schema and refuses an unknown field, a build item with no number, and a sixth build item, each naming the problem" |
| `keel night plan`: same plan from same inputs, with the measures, the climb job pick chooses, the robot's next issue, untriaged Loop findings | `tests/night-plan.test.mjs`: "keel night plan makes the same default plan from the same inputs: …" (byte-identical twice through keel's verb and once through the project's own `scripts/keel/night-plan.mjs`) |
| … writes nothing when an input is unreadable, exit 2 naming it | `tests/night-plan.test.mjs`: "keel night plan writes nothing when an input cannot be read, and says which (exit 2)" (gh down for climb's pick and for the robot's PRs; an unreadable health page; an unreadable Loop finding; a pre-existing plan left byte-identical) |
| Tonight's plan from the branch, else the default, saying which | `tests/night-plan.test.mjs`: "the night's step uses tonight's plan from the plan branch, else the default plan, and says which"; `tests/workflows.test.mjs`: "the night plans before anything runs: tonight's plan from keel-night-plan, else the default plan, saying which; a plan it cannot make is red at the verdict" (the real step against a bare origin with and without the branch, a plan dated for another night, an unreadable origin, a mutation that never reads the branch) |
| `keel night tick`: one item, note and link; refuses an unknown id or a move back from done | `tests/night-plan.test.mjs`: "keel night tick changes one item's status with a note and a link, and refuses an unknown id or a move back from done" |
| The PR carries `docs/night/<date>.json`; the page shows each item and its outcome | `tests/night-plan.test.mjs`: "the record is the night's data: …"; `tests/improve.test.mjs`: "--report with tonight's plan: the measure item is ticked, the plan as it ended is docs/night/<date>.json, and the page shows each item and its outcome"; `tests/workflows.test.mjs`: "the night's PR carries the plan as it ended, docs/night/<date>.json, and nothing else there; a symlinked record is refused" |

The tests were written with the feature, so none was run red against code
without it, except the two workflow mutations named above (a blind plan step,
staging the whole `docs/night/` directory), which the tests apply and show
failing the claim.

Also run: `tests/cli.test.mjs` (both verbs parse under `--json`; the cold
start announces them, 3192 of 3200 characters), `tests/night.test.mjs` (the
drain's data rule), and `npm run check` on the integrated tree; its result is
in the commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| `keel night plan --date 2026-10-15` on keel's own checkout, gh stubbed to print `[]` | a default plan from keel's real health page of 2026-10-14 | measure item (39 measures; five outside or broken named), a review of the `issues_unnamed` proposal with its number, and `climb-test-time` by rotation; exit 0 | The builder reads keel's real health page and climb config. Not the real gh: the robot's issues and PRs were empty. |
| The owner reads one real night's "Tonight's plan" | says what the night did | Not run | The ⚑ box. Needs this merged and one real night. |

## Gaps and decision

- No real `keel-night` run has read the plan branch or committed a record.
  The workflow's steps were run as bash against a local bare origin, not in
  Actions (where `actions/checkout`'s credentials make `git ls-remote origin`
  work).
- The robot's next issue is chosen by its rubric and policy, not its weekly
  allowance, which the robot checks when it runs; and it names no number, so
  the default plan carries it as triage, not build, until an issue can name
  one.
- The climb item's number is the health page's bound for the job's measure
  (`slow_tests` for test-time), not climb's own wall-time number.

Supports **partial, owes: walk**: every automated box is ticked; the owner's
reading of a real night remains.

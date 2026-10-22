---
status: partial
since: 2026-10-14
goal: G4
spec: 2
depends: [11]
note: "Built 2026-10-14: the parser, plates persona run, planCandidates and the optional personas practice. Gap: the default plan (phase 73) does not list the candidates yet, and the night does not run personas; the owner's read of a real review page is open."
evidence: ["evidence/2026-10-14-personas.md"]
issue: 133
---

# Personas measure a project against goals it sets itself

## Done when

A project can declare personas in `.agents/personas/<name>.md`, each with goals that are numbers it measures with its own command, and `plates persona run` measures every goal, writes a dated review page, and turns each missed goal into a candidate item for the next night's default plan.

## Scope

The design is [Nightwatch: a night with a plan you can shape](../research/2026-10-14-nightwatch.md), "Personas measure; they do not build". isocan's file format carries over.

- **The file**: front matter `goal:` entries, each `name`, `at most` or `at least`, `measured by:` (a command printing one number), `baseline`; the body is the persona's lens in prose. Unknown keys are refused, naming them.
- **The run**: `plates persona run [<name>|--all]` runs each command with a timeout, reads one number, compares it to its bound, and writes `docs/reviews/<date>-<persona>.md`. A command that fails or prints no number is `broken`, never zero.
- **Into the night**: each persona goal is a measure the night reads (`persona:<name>:<goal>`) and the default plan lists each missed goal as a candidate item with that number.
- **Safety**: running a persona never changes files outside `docs/reviews/`, and refuses if the persona file itself changed in the same run.
- **The practice**: an optional `personas` practice installs the runner and an example persona (performance: a bundle-size and a latency goal, both commands the project fills in).

Not in scope: a persona that calls a model (isocan's small tier) — a later decision with an owner's budget.

## Acceptance

- [x] A persona file parses into goals, and an unknown key, a goal with no command, or a bound that is not a number is refused, naming it. `tests/persona.test.mjs`
- [x] `plates persona run` measures each goal, marks met, missed or broken, writes the review page, and writes nothing else. `tests/persona.test.mjs`
- [ ] A missed goal appears in the next default plan as a candidate item naming its number; a broken one as a review item. `tests/persona.test.mjs`, `tests/night-plan.test.mjs`
- [x] The optional practice installs the runner and an example persona and renders clean. `tests/practices.test.mjs`
- [ ] ⚑ by hand: the owner reads one persona's review page from a real project and says whether its goals are the right ones.

## Your part

- **Ask:** Read one persona's review page from a real project and say whether the goals it checks are the ones you care about.
- **Why:** Personas only help if their numbers are the right ones; this settles whether to keep or change the example goals.
- **Look at:** `docs/reviews/` in the project after its next night.
- **Choices:** The right goals | Wrong or missing goals
- **Takes:** 10 minutes.
- **Then:** Wrong goals: they are rewritten before the next night.
- **Ready when:** this phase has shipped to one project.

## Real surfaces

- Adopted project: one project's personas run in its night.
- Workflow shell: the night runs `plates persona run --all` before the plan is made.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/persona.test.mjs tests/night-plan.test.mjs tests/practices.test.mjs`; `npm run check`.
By hand: the owner's read of one review page.

## Deliberately open

- **Personas that spend tokens**: not in this phase.
- **Known limit**: a goal is only as good as its command; plates checks it prints one number, not that it measures the right thing.
- **Settled 2026-10-14, how a goal's command runs** (settled by the build): as plates already runs a project's own commands (`"climb".build`, `"climb".perf.command`): `sh -c` (spawnSync with `shell`) in the project root, with the gate's environment (`gateEnv`: `NODE_TEST_*` stripped, `.plates/plates.json` `env` merged) and a 10-minute timeout. The command is the project's own committed text, run verbatim; nothing is interpolated into it. It must print exactly one number on stdout and nothing else (stricter than perf's last line), or the goal is broken.
- **Settled 2026-10-14, the example is never met by accident** (settled by the build): the seeded `.agents/personas/performance.md` has a bundle-size and a latency goal whose commands print a message to stderr and exit 1, so a fresh install reads `broken` until the project fills them in. It has no baseline: a baseline nobody measured is fiction.
- **Settled 2026-10-14, persona goals are not yet in the night's MEASURES** (settled by the build): `personaMeasures(root)` gives each goal as a `persona:<name>:<goal>` measure that `improve.mjs`'s `measure()` takes (tested), bounded by the persona file (a rule measure). Adding them to `MEASURES` is left to the integration after phase 73: `tighten` would copy each bound into `.plates/bounds.json` (two homes for one bound), `--selftest` holds every measure to reading outside on plates's fixture, and phase 73 is changing `improve.mjs` in parallel.
- **Known limit**: the run refuses a changed persona file and writes only its page, but a goal's command can itself write files; plates does not police the project's own command.
- **Known limit**: on timeout the shell is killed; a grandchild it started may outlive it.

## Next action

After phase 73 merges: list `planCandidates` items in `plates night plan`'s default plan (`tests/night-plan.test.mjs`), and have the night run `plates persona run --all` before the plan is made.

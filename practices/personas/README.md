# personas

**The failure it prevents.** A project's own standards with nothing watching
them: "the bundle stays small", "interactions stay under 100 ms", said once and
never measured again, until a person notices the app got slow.

**The rule.** A persona is `.agents/personas/<name>.md`: a lens in prose, and
goals in its front matter. Each goal is a number, a bound (`at most` or
`at least`) and the command that prints it. `scripts/plates/persona.mjs run
--all` (or `plates persona run --all`) runs each command in the project root
under a timeout, reads exactly one number, and marks the goal met, missed or
broken. A command that fails or prints anything else is broken, never zero.
It writes `docs/reviews/<date>-<persona>.md` and nothing else, and refuses,
writing nothing, when a persona file changed during the run.

**Into the night.** A missed goal becomes a candidate item for the night's
default plan (`planCandidates`: kind `build`, naming its number
`persona:<name>:<goal>`); a broken one a `review` item. Personas measure; they
never build. The pass that builds is chosen by the plan.

**What gets installed.** `scripts/plates/persona.mjs` (managed) and an example
`.agents/personas/performance.md` (seeded: yours from the day it is written)
with a bundle-size and a latency goal. Both commands are placeholders that exit
1 with a message, so the example reads broken until you fill them in.

Opt in with `plates adopt --with personas`. It requires the night practice: the
runner uses the night's `lib.mjs`, and the night is what reads it.

Origin: isocan's personas (github.com/dglazkov/isocan,
`scripts/persona-run.mjs` and `packages/core/src/persona.ts` at `7bde1a85`,
Apache-2.0): the file format and the run's rules. Not carried: isocan's model
tier (budget, escalation, schedule). plates's personas only run commands.

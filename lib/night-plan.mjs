// plates night plan and plates night tick: the night's plan (phase 73). The logic
// ships into each project as the night practice's managed
// scripts/plates/night-plan.mjs, so a project's night makes and ticks its plan
// from its own checkout (design §6, "Projects run on their own"); the CLI's
// verbs are that same module, never a copy.
export * from '../practices/night/files/scripts/plates/night-plan.mjs';

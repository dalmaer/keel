# Walks owed, and lived-in by choice

The owner, 2026-10-07: in a fast-paced project, "lived-in" feels like it
slows the work down instead of just getting the phases done. Should it be
more optional?

## What the records show

- **Lived-in blocks nothing.** `built` and `lived-in` are both done
  (roadmap.mjs `DONE`): a phase's `depends:` is satisfied by `built`, and
  `keel next` moves on at `built`. Of keel's 45 phases, 33 are built, 11
  partial, none lived-in. Its cost is noise: next actions that say
  "Lived-in after a few weeks of real use", and a roadmap headline counting
  "0 of 44 lived in", which reads as debt.
- **Partial is what slows the work.** Since phase 32, a phase is built only
  when its ⚑ by-hand boxes and its Real surfaces are walked: a run on
  GitHub, an adopted project, the owner's read. Most of keel's eleven
  partial phases have nothing left to build: they wait on a tend Monday, on
  four tend runs, on a week of nights. And a partial phase blocks every
  phase that depends on it, so the conductor has been working past
  `depends:` by hand.
- **The walks earn their keep.** This week's real runs found a climb agent
  that never started, budget runs that never started, and a token escape
  in the tend agent (Claude's first cross-review). Built must keep meaning
  proven.

## What changes

1. **Lived-in is a project's choice.** `"phases": { "livedIn": true }` in
   `.keel/keel.json` turns it on; the default is off. Off: the roadmap's
   headline and goal lines count built only; the phases README and template
   don't ask for it; a phase file may still say `lived-in` (it stays a valid,
   done status, so nothing breaks), but keel never prompts for it. On: as
   today.
2. **A walk owed does not block.** A partial phase whose building is done and
   whose rest is a walk or time says so in its front matter: `owes: walk`.
   It is still partial (built still means proven), but:
   - its dependents may proceed: `depends:` is satisfied by built,
     lived-in, or partial with `owes: walk`;
   - `keel next` skips it (nothing in it is left to build) and names the
     next buildable phase;
   - the roadmap shows it as "partial, walk owed", and its Next action names
     the walk;
   - the night's `phases_stuck` does not count it while its note says what
     is owed: a walk waits on the world, not on the work.
   The roadmap check refuses `owes:` on any status but partial, and an
   `owes: walk` phase with an unchecked box that is neither "⚑ by hand" nor
   a command naming a real surface (a box that is still buildable).

## What it is not

- Not a lower bar for built. The walk is still owed and still tracked; the
  phase still waits for it to be built.
- Not a way to skip proof. `owes: walk` is refused while any buildable box is
  unchecked.

## Judged by

The conductor stops working past `depends:` by hand: `keel next` names the
next buildable phase while walks are owed, and the owner says the roadmap
reads as progress rather than debt.

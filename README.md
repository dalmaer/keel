# Keel

The mothership for projects run the way isocan, ledger, duo and cajones are run:

- phases that own their status;
- a roadmap that is generated and checked;
- lessons kept as shapes, each with its guard;
- a conductor that walks the plan and verifies the proof itself;
- a night shift that keeps everything honest.

Today each project carries a hand-copied version of that practice. Keel makes
it one versioned thing. You can install it, update it and migrate it, and the
lessons each project learns flow back home.

## Install

Keel is a git checkout plus a link: no registry, no build step, Node ≥ 24.

```bash
git clone https://github.com/dalmaer/keel ~/code/keel   # any path
npm install -g ~/code/keel                              # or, in the checkout: npm link
keel --version        # keel <version> (<commit>) practice <version>
keel --agent-help     # where an agent starts
```

The global install is a symlink to the checkout, so the CLI you run is exactly
that checkout's commit. Updating is `git pull --ff-only` in the checkout.

## The verbs (planned — see [the roadmap](docs/ROADMAP.md))

| Verb | Where | What |
| --- | --- | --- |
| `keel init` | new dir | A repo with the practice installed, a first goal and phase, and CI. `--github` creates the repo too. |
| `keel adopt` | existing repo | Brings a hand-ported project under keel without overwriting what is its own. |
| `keel next` / `status` | project | Where it stands; the next phase and its next action. |
| `keel goal` | project | Add, list, show and retire goals. Progress is derived from phases. |
| `keel doctor` | project | Practice conformance, and drift in managed files (drift is signal, not error). |
| `keel improve` | project | Measures whether the practice is working, writes a dated health page, proposes one fix. |
| `keel update` | project | Updates the CLI first, then migrates the project to the new practice, as one PR. |
| `keel lessons` | project | Sends new lessons, drift and practice-shaped commits home, as issues on keel. |
| `keel learn` | keel | Turns lessons and upstream source changes into proposals; a person decides. |
| `keel release` | keel | Cuts a practice version, with migrations and a what's-new for the receiving end. |
| `keel fleet` | keel | Every managed project: version, health, CI, unsent lessons. |

## Working on keel

Read [AGENTS.md](AGENTS.md). Then:

```bash
npm run next     # what to do
npm run check    # before pushing
```

In Claude Code, `/conduct` walks the phases.

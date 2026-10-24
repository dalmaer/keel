// Reviewed phase107 CLI forms and argument inventory. Changes require an argument/capability audit.
export default [
  {
    "id": "cli.migrate",
    "command": "migrate",
    "usage": "plates migrate [root] [--yes --digest <sha256>] [--json]",
    "summary": "preview the Keel-to-Plates file migration; --yes applies the reviewed digest",
    "source": {
      "file": "lib/cli.mjs",
      "line": 153,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "project-root:0..1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "dispatcher presentation flag",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "once",
            "treatment": "limited"
          },
          {
            "token": "--digest",
            "arity": 1,
            "repeat": "once",
            "treatment": "limited"
          }
        ],
        "constraints": "Default root is the current directory. --yes and --digest must be supplied together; digest is the exact lowercase 64-character SHA-256 preview digest. Duplicate approval flags, unknown flags and extra roots are refused before reading the root. Preview does not apply the migration.",
        "parserSource": "lib/rename.mjs"
      }
    ],
    "limitation": "Local checkout migration only; the web service cannot rename files, remotes or repositories through this catalogue.",
    "followUp": "Run plates migrate in the intended checkout, review its exact file plan, then approve that plan with paired --yes and --digest; retain the recovery journal after uncertainty."
  },
  {
    "id": "cli.evidence-rederive",
    "command": "evidence rederive",
    "usage": "plates evidence rederive <phase> [--yes] [--json]",
    "summary": "preview dated measurement records; --yes reruns their argument arrays",
    "source": {
      "file": "lib/cli.mjs",
      "line": 161,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "phase:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add immutable named measurement preview and bounded worker for its argv, followed by reviewed evidence update."
  },
  {
    "id": "cli.status",
    "command": "status",
    "usage": "plates status [--project <p>] [--json]",
    "summary": "goals with built and lived-in counts, and the next phase",
    "source": {
      "file": "lib/cli.mjs",
      "line": 170,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--project",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Bounded source-derived project summary; local checkout state and CLI project-name selector are not identical.",
    "followUp": "Expose goal/phase coverage and unavailable local-only sources."
  },
  {
    "id": "cli.next",
    "command": "next",
    "usage": "plates next [--project <p>] [--json]",
    "summary": "the next phase to conduct, its done-when and next action; every ready phase, free or claimed (it fetches)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 199,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--project",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Board next actions; no local worktree claim/fetch parity.",
    "followUp": "Add dedicated ready-phase detail and claim capability before claiming full parity."
  },
  {
    "id": "cli.goal-list",
    "command": "goal list",
    "usage": "plates goal list [--json]",
    "summary": "every goal, with progress derived from its phases",
    "source": {
      "file": "lib/cli.mjs",
      "line": 226,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Home progress is not a full goals catalogue.",
    "followUp": "Add source-bound goals list/detail."
  },
  {
    "id": "cli.goal-show",
    "command": "goal show",
    "usage": "plates goal show <id> [--json]",
    "summary": "one goal: its phases, built and lived-in counts, and its next phase",
    "source": {
      "file": "lib/cli.mjs",
      "line": 235,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "id:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Project summary is not goal detail.",
    "followUp": "Add goal route with phases and source gaps."
  },
  {
    "id": "cli.goal-add",
    "command": "goal add",
    "usage": "plates goal add \"<title>\" --outcome \"<one sentence>\" [--json]",
    "summary": "add a goal (the next free G<n>) to docs/goals.json; regenerate the roadmap",
    "source": {
      "file": "lib/cli.mjs",
      "line": 244,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "title:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--outcome",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add source-bound preview and conditional Git writer for goals plus generated roadmap."
  },
  {
    "id": "cli.goal-retire",
    "command": "goal retire",
    "usage": "plates goal retire <id> --reason \"<why>\" [--phases supersede|move:<Gm>] [--yes] [--json]",
    "summary": "retire a goal with a reason; its unbuilt phases are superseded or moved (--yes)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 254,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "id:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--reason",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--phases",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add reviewed retirement/move/supersede writer with exact affected phases."
  },
  {
    "id": "cli.phase-new",
    "command": "phase new",
    "usage": "plates phase new \"<title>\" --goal <id> [--depends 1,2] [--json]",
    "summary": "scaffold the next free phase number from the template, under a goal",
    "source": {
      "file": "lib/cli.mjs",
      "line": 264,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "title:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--goal",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--depends",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add conditional phase scaffold and generated roadmap writer."
  },
  {
    "id": "cli.phase-claim",
    "command": "phase claim",
    "usage": "plates phase claim <n> [--provider <name>] [--token <t>] [--release] [--json]",
    "summary": "claim a phase before building it: one shared create-only branch, claims/phase-<n>; --release gives it back",
    "source": {
      "file": "lib/cli.mjs",
      "line": 274,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "phase:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--release",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--provider",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--token",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Implement durable claim/release with exact shared branch ownership and token checks."
  },
  {
    "id": "cli.ready",
    "command": "ready",
    "usage": "plates ready [--branch <name>] [--check \"<cmd>\"]... [--json]",
    "summary": "hand a committed change off: run only its fast checks, push its branch and ready/<branch>; never the full gate",
    "source": {
      "file": "lib/cli.mjs",
      "line": 284,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--branch",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--check",
            "arity": 1,
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          }
        ],
        "constraints": "--check repeated; command strings are local execution, never a web shell request.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Requires an enrolled checkout and bounded approved check adapter; never accept arbitrary shell through browser."
  },
  {
    "id": "cli.integrate",
    "command": "integrate",
    "usage": "plates integrate [--json]",
    "summary": "one integrator (lock claims/integrate): merge every ready change, run the full gate once, push; a failing change is found and sent back",
    "source": {
      "file": "lib/cli.mjs",
      "line": 300,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Requires single-integrator authority, isolated merge/check execution and durable publication receipts."
  },
  {
    "id": "cli.phase-list",
    "command": "phase list",
    "usage": "plates phase list [--json]",
    "summary": "every phase, as the roadmap reads it",
    "source": {
      "file": "lib/cli.mjs",
      "line": 308,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add complete bounded phase catalogue and coverage, beyond Home summary."
  },
  {
    "id": "cli.render",
    "command": "render",
    "usage": "plates render [--check] [--into <dir>] [--json]",
    "summary": "render the project's practices onto it; --check writes nothing",
    "source": {
      "file": "lib/cli.mjs",
      "line": 319,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--check",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--into",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add source-bound render preview and approved conditional patch writer; local --into remains local."
  },
  {
    "id": "cli.init",
    "command": "init",
    "usage": "plates init [dir] --description \"<paragraph>\" [--name <n>] [--tagline <t>] [--kind static|node|web|other] [--repo owner/name] [--guide <path>] [--with <practice>]... [--github [--yes]] [--json]",
    "summary": "a new project in an empty directory: practice, goal G0, phase 0, one commit",
    "source": {
      "file": "lib/cli.mjs",
      "line": 343,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "directory:0..1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--github",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--description",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--name",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--tagline",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--kind",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--repo",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--guide",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--with",
            "arity": 1,
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Design explicit project creation/adoption workflow with resource approvals; local directory not remotely available."
  },
  {
    "id": "cli.adopt",
    "command": "adopt",
    "usage": "plates adopt [dir] [--dry-run] [--guide <path>] [--check \"<command>\"] [--setup \"<command>\"] [--env KEY=VALUE]... [--with <practice>]... [--json]",
    "summary": "bring an existing project under plates; on only what it already satisfies, the rest local",
    "source": {
      "file": "lib/cli.mjs",
      "line": 359,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "directory:0..1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--dry-run",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--guide",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--check",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--setup",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--env",
            "arity": 1,
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          },
          {
            "token": "--with",
            "arity": 1,
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Design exact adoption proposal from source and explicit setup/check approval; local directories remain unsupported."
  },
  {
    "id": "cli.doctor",
    "command": "doctor",
    "usage": "plates doctor [--github] [--fix <path> restore|eject [--yes]] [--json]",
    "summary": "what the project changed of the practice, and practice rules broken; changes nothing without --fix",
    "source": {
      "file": "lib/cli.mjs",
      "line": 379,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--github",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--fix",
            "arity": "2",
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "--fix consumes path then restore|eject; --yes authorizes that repair.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add bounded diagnosis and exact restore/eject preview; do not overwrite user drift."
  },
  {
    "id": "cli.update",
    "command": "update",
    "usage": "plates update [dir] [--local] [--yes] [--no-self-update] [--json]",
    "summary": "the CLI first, then migrations, re-render, check; one branch for a PR (--local: a diff)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 394,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "directory:0..1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--local",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--no-self-update",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "--local and --yes conflict.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Supported adopter update preparation and separately reviewed PR publication only; no --local/self CLI replacement.",
    "followUp": "Expose precise eligibility and unsupported local/self-update modes."
  },
  {
    "id": "cli.lessons",
    "command": "lessons",
    "usage": "plates lessons [--dry-run] [--yes] [--to owner/repo] [--since <ref>] [--json]",
    "summary": "send new lessons, drift and practice commits home to plates as issues, once each",
    "source": {
      "file": "lib/cli.mjs",
      "line": 410,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--dry-run",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--to",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--since",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Shared catalogue is not issue-based lesson submission to upstream.",
    "followUp": "Design exact reviewed outbound lesson publication and original-receipt recovery."
  },
  {
    "id": "cli.learn",
    "command": "learn",
    "usage": "plates learn [propose <slug|issue#> --outcome lesson|practice|decline|link --note \"<line>\" --read \"<read>\" [--link <n>] [--yes] | decide <slug|issue#> accepted|declined [--note \"<why>\"] [--shape \"\u2026\" --cost \"\u2026\" --guard \"\u2026\"] [--yes] | render [--check] | distill [propose --kind family|reword|tag|standardise \u2026 --read \"<read>\"]] [--json]",
    "summary": "plates only: gather lesson issues and moved sources into docs/inbox/; propose (agent), decide (person), render, distill (lessons into patterns)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 420,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "propose",
        "positionals": "slug-or-issue:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--outcome",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--note",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--read",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--link",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "decide",
        "positionals": "slug-or-issue:1 decision:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--note",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--shape",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--cost",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--guard",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "render",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--check",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "distill",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "distill propose",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--migration",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--kind",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--name",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--rule",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--guard",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--rows",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--row",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--shape",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--cost",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--where",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--evidence",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--family",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--check",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--practice",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--note",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--read",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Private shared catalogue/migration/export differs from mothership inbox gathering/proposal/decision/distillation.",
    "followUp": "Add separate source-owned inbox workflow; do not label catalogue as CLI learn."
  },
  {
    "id": "cli.improve",
    "command": "improve",
    "usage": "plates improve [--sessions | --report] [--transcripts <dir>] [--selftest] [--json]",
    "summary": "is the practice working here: measures against bounds, one proposal; --report writes <health>/<date>.md (.plates/plates.json health, default docs/health)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 467,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--sessions",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--report",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--selftest",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--transcripts",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "sessions exclusive of report/transcripts/selftest; selftest exclusive of report/transcripts.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Existing health source observation only; no measure execution/report/session/selftest.",
    "followUp": "Expose source report; require a separately bounded measurement worker for execution."
  },
  {
    "id": "cli.persona-run",
    "command": "persona run",
    "usage": "plates persona run [<name> | --all] [--json]",
    "summary": "measure the goals in .agents/personas/<name>.md: met, missed or broken; writes docs/reviews/<date>-<persona>.md and nothing else (exit 1 missed, 2 broken)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 486,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "name:0..1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--all",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "CLI strips --json; forwarded parseArgs accepts name together with --all; do not infer exclusive syntax from usage.",
        "parserSource": "practices/personas/files/scripts/plates/persona.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Create a bounded registered persona measurement worker before exposing Run."
  },
  {
    "id": "cli.time",
    "command": "time",
    "usage": "plates time [--weeks N] [--json]",
    "summary": "gate and test weekly medians, load coverage, failure memory and local worked-around counts",
    "source": {
      "file": "lib/cli.mjs",
      "line": 495,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--weeks",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add dated timing/coverage reader; no fabricated checkout measurements."
  },
  {
    "id": "cli.test",
    "command": "test",
    "usage": "plates test <file>... --stalls [--name <pattern>] [--seed N] [--json]",
    "summary": "run test files paused at seeded random moments (--stalls) and without; name each test that passed without and failed with: it judges the wall clock",
    "source": {
      "file": "lib/cli.mjs",
      "line": 503,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "files:1..n",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--stalls",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--name",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--seed",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "A separate bounded stalls worker is needed; typecheck-v1 does not implement arbitrary test files."
  },
  {
    "id": "cli.drain",
    "command": "drain",
    "usage": "plates drain <prefix> [--gate-passed] [--yes] [--json]",
    "summary": "one open PR per machine queue: merge older data-only PRs, close the rest as superseded; the newest only after a gate",
    "source": {
      "file": "lib/cli.mjs",
      "line": 514,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "prefix:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--gate-passed",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Needs exact queue/PR snapshot, gate proof and explicit merge/close effects; human permission remains distinct."
  },
  {
    "id": "cli.night-plan",
    "command": "night plan",
    "usage": "plates night plan [--date <YYYY-MM-DD>] [--json]",
    "summary": "tonight's default plan, written before the night runs (.plates/night/plan.json): measures, the health proposal, the climb job, the robot's next issue, untriaged Loop findings; no model",
    "source": {
      "file": "lib/cli.mjs",
      "line": 523,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--date",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add canonical plan generation/edit preview; private evening draft is not the shared branch."
  },
  {
    "id": "cli.night-tick",
    "command": "night tick",
    "usage": "plates night tick <id> --status <planned|running|done|failed|skipped|left-alone> [--note \"<text>\"] [--link <url>] [--json]",
    "summary": "tick one item of tonight's plan: its status, with a note and a link; an unknown id or a move back from done is refused (exit 2)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 531,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "id:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--status",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--note",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--link",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add conditional monotonic tick writer with source revision and actor attribution."
  },
  {
    "id": "cli.morning",
    "command": "morning",
    "usage": "plates morning [--date <YYYY-MM-DD>] [--send | --card [--dry-run | --yes]] [--json]",
    "summary": "the night's brief from its plan as it finished: done, tried, failed and why, left alone or not finished by, your next; --send opens the assigned \"Good morning\" issue once a night; --card publishes the plan as the live canvas card night-plan",
    "source": {
      "file": "lib/cli.mjs",
      "line": 543,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--send",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--card",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--dry-run",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--date",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "send/card conflict; yes/dry-run require card.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Bounded source brief only; no --send issue or --card canvas publication.",
    "followUp": "Add exact source-date coverage; retain outbound actions unavailable until their durable adapter exists."
  },
  {
    "id": "cli.goodnight",
    "command": "goodnight",
    "usage": "plates goodnight [add <suggestion-id> | add --title \"<words>\" [--kind <k>] [--measure <m> --bound <n> --better <lower|higher>] [--lane <l>] [--budget <minutes>] [--id <x>] | drop <id> | edit <id> [--title \"<words>\"] [--kind <k>] [--lane <l>] [--measure <m>] [--bound <n>] [--better <b>] [--budget <minutes>] | budget <id> <minutes> | skip <path-or-id> | --yes] [--json]",
    "summary": "the owner shapes tonight's plan: settled today, left open, the default plan, things to try; add|drop|edit|budget|skip change a draft; --yes writes it and pushes it to keel-night-plan",
    "source": {
      "file": "lib/cli.mjs",
      "line": 555,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "--yes only without subcommand; edit requires a valued change; duplicate values last-wins.",
        "parserSource": "lib/goodnight.mjs"
      },
      {
        "subcommand": "add",
        "positionals": "suggestion-id:0..1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--title",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--kind",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--measure",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--bound",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--better",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--lane",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--budget",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--id",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "--yes only without subcommand; edit requires a valued change; duplicate values last-wins.",
        "parserSource": "lib/goodnight.mjs"
      },
      {
        "subcommand": "edit",
        "positionals": "id:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--title",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--kind",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--measure",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--bound",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--better",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--lane",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--budget",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--id",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "--yes only without subcommand; edit requires a valued change; duplicate values last-wins.",
        "parserSource": "lib/goodnight.mjs"
      },
      {
        "subcommand": "drop",
        "positionals": "id:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "--yes only without subcommand; edit requires a valued change; duplicate values last-wins.",
        "parserSource": "lib/goodnight.mjs"
      },
      {
        "subcommand": "budget",
        "positionals": "id:1 minutes:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "--yes only without subcommand; edit requires a valued change; duplicate values last-wins.",
        "parserSource": "lib/goodnight.mjs"
      },
      {
        "subcommand": "skip",
        "positionals": "path-or-id:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "--yes only without subcommand; edit requires a valued change; duplicate values last-wins.",
        "parserSource": "lib/goodnight.mjs"
      }
    ],
    "limitation": "Private evening draft supported; no canonical keel-night-plan publication, CLI budget or arbitrary item parity.",
    "followUp": "Show local/private draft boundary; design reviewed branch publication separately."
  },
  {
    "id": "cli.fleet",
    "command": "fleet",
    "usage": "plates fleet [--json]",
    "summary": "plates only: every project in plates.json \u2014 adopted, practice behind, health, CI, unsent lessons, machine PRs; read-only",
    "source": {
      "file": "lib/cli.mjs",
      "line": 563,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Private manifest fleet lens, not mothership plates.json/local checkout census.",
    "followUp": "Name manifest membership and missing local sources."
  },
  {
    "id": "cli.fleet-update",
    "command": "fleet update",
    "usage": "plates fleet update [--yes | --rehearse] [--json]",
    "summary": "plates only: open the update PR in each fleet project behind or with pending migrations, with your gh login (--yes); --rehearse runs the update and check in clones, pushing nothing",
    "source": {
      "file": "lib/cli.mjs",
      "line": 571,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--rehearse",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "yes/rehearse conflict.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Reviewed serial canary rollout of supported update preparation/publication; not blind all-fleet --yes.",
    "followUp": "Expose remaining unsupported repositories and rehearsal mode differences."
  },
  {
    "id": "cli.loose-ends",
    "command": "loose-ends",
    "usage": "plates loose-ends [--all] [--phase N] [--root <dir>] [--fresh] [--json] | mark <id> resume|park|drop --reason \"<why>\" [--until YYYY-MM-DD]",
    "summary": "what you started and did not finish, in plates and each fleet checkout: chats, files, branches, PRs, owner steps; read-only but mark",
    "source": {
      "file": "lib/cli.mjs",
      "line": 588,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--all",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--fresh",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--phase",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--root",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "mark",
        "positionals": "id:1 move:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--reason",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--until",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--root",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add bounded source-owned loose-end list/mark adapter; local chats/checkouts need enrolled local bridge."
  },
  {
    "id": "cli.feedback",
    "command": "feedback",
    "usage": "plates feedback capture <file> [--yes --digest <sha256>] | list | propose <id> --record <file> | resolve <id> --record <file> [--yes --digest <sha256>] [--json]",
    "summary": "capture private feedback on an exact result; preview follow-up or resolution without starting work",
    "source": {
      "file": "lib/cli.mjs",
      "line": 608,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": "capture",
        "positionals": "file:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--digest",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "yes and digest supplied together; lowercase64hex; duplicate options rejected.",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "list",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "propose",
        "positionals": "id:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "resolve",
        "positionals": "id:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--digest",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "yes/digest pair; record required.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Guided-walk feedback/repair subset does not expose general private CLI feedback store.",
    "followUp": "Add authenticated exact-result capture/list/propose/resolve handoff; preserve original observations."
  },
  {
    "id": "cli.issue",
    "command": "issue",
    "usage": "plates issue new --agent --title <title> --rubric <file> [--yes] [--json]",
    "summary": "preview or create a rubric-shaped agent issue; OFF stays unlabelled, --yes approves creation",
    "source": {
      "file": "lib/cli.mjs",
      "line": 630,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": "new",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--agent",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--title",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--rubric",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "agent/title/rubric required; unique.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Walk repair preview is not unrestricted issue new --agent dispatch.",
    "followUp": "Implement explicit reviewed robot issue adapter with preserved durable intent."
  },
  {
    "id": "cli.review",
    "command": "review",
    "usage": "plates review <owner/repo>#<n> [--wait] [--gate] [--reviewer <login>]... [--json] | <owner/repo>@<sha> [--json] | --close <id>[,<id>\u2026] --fixed <commit>|--tracked <issue|version>|--not-valid \"<why>\" [--class <kind>] | --class security|overwrite|approval|other <id>[,<id>\u2026] | --close <id> --tracked --file-agent-issue --title <title> --rubric <file> [--yes]",
    "summary": "a PR's review comments, or a push's review after it landed (<repo>@<sha>), which are answered; --wait for its reviewers; --close answers one it read (never in bulk): fixed, tracked or not valid; --class sorts one by the merge rule without answering it. Not a gate; at its round limit (exit 3) the owner chooses",
    "source": {
      "file": "lib/cli.mjs",
      "line": 649,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": "read",
        "positionals": "repository#PR-or-repository@SHA:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--wait",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--gate",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--reviewer",
            "arity": 1,
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "answer",
        "positionals": "target:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--close",
            "arity": 1,
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          },
          {
            "token": "--fixed",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--tracked",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--not-valid",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--class",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "--close selects this mode, not literal answer; one response kind; no wait/gate/reviewer.",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "classify",
        "positionals": "target:1 findingIds:1..n",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--class",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "--class without --close selects mode, not literal classify.",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "file-agent-issue",
        "positionals": "repository#PR:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--tracked",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--file-agent-issue",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--close",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--title",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--rubric",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--class",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "--file-agent-issue selects mode; --tracked BOOLEAN here; exactly one close/title/rubric; no fixed/not-valid.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add exact comment/commit review reader and immutable answer/classification adapter; no blind bulk response."
  },
  {
    "id": "cli.board",
    "command": "board",
    "usage": "plates board [--open] [--port <n>] [--fresh] [--json]",
    "summary": "whose turn it is: every open item as yours, broken, the agent's or waiting on time, from the roadmap, loose ends, reviews, health, the inbox and the fleet; a page on 127.0.0.1 without --json",
    "source": {
      "file": "lib/cli.mjs",
      "line": 682,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--open",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--fresh",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--port",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "--json without open/port returns board JSON; otherwise starts local server.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Dynamic bounded project/fleet Home with explicit missing sources; not full local board input parity.",
    "followUp": "Preserve each unsupported board source and refresh coverage."
  },
  {
    "id": "cli.promote",
    "command": "promote",
    "usage": "plates promote [<commit>] [--yes] [--within <s>] [--every <s>] [--json] | --back <commit> [--yes] [--within <s>] [--every <s>] [--json]",
    "summary": "move production (\"delivery\".promote) to a commit on the tested ref whose gate passed: a preview (exit 3), then --yes moves it and verifies production serves it; --back <commit> rolls back and needs exactly that commit served; a person's command, never a workflow's",
    "source": {
      "file": "lib/cli.mjs",
      "line": 700,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "commit:0..1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--back",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--within",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--every",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "CLI delegates unvalidated argv to installed scripts/plates/promote.mjs. This canonical grammar is only applicable after installed source identity/drift validation. --back supplies commit; at most one commit.",
        "parserSource": "practices/delivery/files/scripts/plates/promote.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Design reviewed deployment/rollback adapter with gate and serving-revision proofs, separate from update PR."
  },
  {
    "id": "cli.walk",
    "command": "walk",
    "usage": "plates walk done <phase> (--note \"<what you saw>\" | --choice \"<one of its Your part's Choices>\" [--note \"\u2026\"]) [--box <n>] [--json] | decide --proposal <health page> [--instance <id>] (--accept [\"<why>\"] | --decline \"<why>\" | --map <file>) [--json]",
    "summary": "settle the owner's turn: done checks a phase's \u2691 walk box and writes the read (or the choice from its Your part) into its evidence (built when nothing is left); decide accepts or declines a health proposal; leaves a diff",
    "source": {
      "file": "lib/cli.mjs",
      "line": 716,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": "done",
        "positionals": "phase:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--note",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--box",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--choice",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "decide",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--proposal",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--instance",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--map",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--accept",
            "arity": "0..1",
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--decline",
            "arity": "1",
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "accept optional explanation; decline requires explanation; map alternative. No --yes.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Authored guided walks; exact all-pass acceptance preview. Legacy health proposal decision separately supported; arbitrary CLI box/choice/map forms not universal.",
    "followUp": "Declare each supported authored target and mark unsupported legacy forms."
  },
  {
    "id": "cli.canvas",
    "command": "canvas",
    "usage": "plates canvas snapshot [--output <file>] [--github] [--artifact <repo-relative-json>]... [--history <repo-relative-json>]... [--window-days <N>] [--json]\nplates canvas render --snapshot <file> --output <dir> [--json]\nplates canvas connect --create --title <title> --space <id> --home <origin> --audience owner-only [--yes] [--json]\nplates canvas connect --canvas <address> --audience owner-only [--home <origin>] [--yes] [--json]\nplates canvas sync [--snapshot <file> | --github] [--dry-run | --yes] [--json]\nplates canvas status [--json]\nplates canvas live [--card <key>]... [--keep <N> | --no-keep] [--off] [--yes] [--json]\nplates canvas rebase [--card <key>] [--onto <version-id>] [--yes] [--json]\nplates canvas disconnect [--yes] [--json]\nplates canvas night --report <file> [--yes] [--json]",
    "summary": "project canvas: local snapshot/render; connect, sync, status, live, rebase, disconnect, night",
    "source": {
      "file": "lib/cli.mjs",
      "line": 742,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": "snapshot",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--github",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--output",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--artifact",
            "arity": 1,
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          },
          {
            "token": "--history",
            "arity": 1,
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          },
          {
            "token": "--window-days",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Strict form parser; canvas capture explicitly refused. Connect create XOR canvas + owner-only audience; render snapshot/output; sync snapshot/github and yes/dry-run exclusive; live keep/no-keep conflict; rebase yes requires onto.",
        "parserSource": "lib/canvas.mjs"
      },
      {
        "subcommand": "render",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--snapshot",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--output",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Strict form parser; canvas capture explicitly refused. Connect create XOR canvas + owner-only audience; render snapshot/output; sync snapshot/github and yes/dry-run exclusive; live keep/no-keep conflict; rebase yes requires onto.",
        "parserSource": "lib/canvas.mjs"
      },
      {
        "subcommand": "connect",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--create",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--canvas",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--title",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--space",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--home",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--audience",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Strict form parser; canvas capture explicitly refused. Connect create XOR canvas + owner-only audience; render snapshot/output; sync snapshot/github and yes/dry-run exclusive; live keep/no-keep conflict; rebase yes requires onto.",
        "parserSource": "lib/canvas.mjs"
      },
      {
        "subcommand": "sync",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--github",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--dry-run",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--snapshot",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Strict form parser; canvas capture explicitly refused. Connect create XOR canvas + owner-only audience; render snapshot/output; sync snapshot/github and yes/dry-run exclusive; live keep/no-keep conflict; rebase yes requires onto.",
        "parserSource": "lib/canvas.mjs"
      },
      {
        "subcommand": "status",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "Strict form parser; canvas capture explicitly refused. Connect create XOR canvas + owner-only audience; render snapshot/output; sync snapshot/github and yes/dry-run exclusive; live keep/no-keep conflict; rebase yes requires onto.",
        "parserSource": "lib/canvas.mjs"
      },
      {
        "subcommand": "live",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--off",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--no-keep",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--keep",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--card",
            "arity": 1,
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          }
        ],
        "constraints": "Strict form parser; canvas capture explicitly refused. Connect create XOR canvas + owner-only audience; render snapshot/output; sync snapshot/github and yes/dry-run exclusive; live keep/no-keep conflict; rebase yes requires onto.",
        "parserSource": "lib/canvas.mjs"
      },
      {
        "subcommand": "rebase",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--onto",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--card",
            "arity": 1,
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          }
        ],
        "constraints": "Strict form parser; canvas capture explicitly refused. Connect create XOR canvas + owner-only audience; render snapshot/output; sync snapshot/github and yes/dry-run exclusive; live keep/no-keep conflict; rebase yes requires onto.",
        "parserSource": "lib/canvas.mjs"
      },
      {
        "subcommand": "disconnect",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Strict form parser; canvas capture explicitly refused. Connect create XOR canvas + owner-only audience; render snapshot/output; sync snapshot/github and yes/dry-run exclusive; live keep/no-keep conflict; rebase yes requires onto.",
        "parserSource": "lib/canvas.mjs"
      },
      {
        "subcommand": "night",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--report",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Strict form parser; canvas capture explicitly refused. Connect create XOR canvas + owner-only audience; render snapshot/output; sync snapshot/github and yes/dry-run exclusive; live keep/no-keep conflict; rebase yes requires onto.",
        "parserSource": "lib/canvas.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add authenticated canvas source/destination adapter with conditional remote version writes and recovery."
  },
  {
    "id": "cli.retro",
    "command": "retro",
    "usage": "plates retro [--worksheet] [--since <commit>] [--session <id>] [--json] | capture --record <file> [--since <commit>] [--session <id>] [--yes] [--json] | evaluations <plan|freeze|inspect|run|resume|reconcile|cancel|compare> --manifest <file> --state <dir> [--bundle <file>] [--experiment <id>] [--execution <file>] [--yes --digest <sha>] [--json] | sessions <status|start|begin|finish|handoff|audit|apply|rollback> [--experiment <id>] [--record <file>] [--yes] [--json]",
    "summary": "retro worksheet, reviewed capture, and bounded session trials; mutations require --yes",
    "source": {
      "file": "lib/cli.mjs",
      "line": 760,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--worksheet",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--since",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--session",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      },
      {
        "subcommand": "capture",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--since",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--session",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/canvas.mjs"
      },
      {
        "subcommand": "sessions status",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "All options parse on each form; start/begin/finish/handoff require authored record. Status may configure from record; audit/apply/rollback refuse record. Domain controls --yes requirements.",
        "parserSource": "lib/session-trials.mjs"
      },
      {
        "subcommand": "sessions start",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "All options parse on each form; start/begin/finish/handoff require authored record. Status may configure from record; audit/apply/rollback refuse record. Domain controls --yes requirements.",
        "parserSource": "lib/session-trials.mjs"
      },
      {
        "subcommand": "sessions begin",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "All options parse on each form; start/begin/finish/handoff require authored record. Status may configure from record; audit/apply/rollback refuse record. Domain controls --yes requirements.",
        "parserSource": "lib/session-trials.mjs"
      },
      {
        "subcommand": "sessions finish",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "All options parse on each form; start/begin/finish/handoff require authored record. Status may configure from record; audit/apply/rollback refuse record. Domain controls --yes requirements.",
        "parserSource": "lib/session-trials.mjs"
      },
      {
        "subcommand": "sessions handoff",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "All options parse on each form; start/begin/finish/handoff require authored record. Status may configure from record; audit/apply/rollback refuse record. Domain controls --yes requirements.",
        "parserSource": "lib/session-trials.mjs"
      },
      {
        "subcommand": "sessions audit",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "All options parse on each form; start/begin/finish/handoff require authored record. Status may configure from record; audit/apply/rollback refuse record. Domain controls --yes requirements.",
        "parserSource": "lib/session-trials.mjs"
      },
      {
        "subcommand": "sessions apply",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "All options parse on each form; start/begin/finish/handoff require authored record. Status may configure from record; audit/apply/rollback refuse record. Domain controls --yes requirements.",
        "parserSource": "lib/session-trials.mjs"
      },
      {
        "subcommand": "sessions rollback",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--record",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "All options parse on each form; start/begin/finish/handoff require authored record. Status may configure from record; audit/apply/rollback refuse record. Domain controls --yes requirements.",
        "parserSource": "lib/session-trials.mjs"
      },
      {
        "subcommand": "evaluations plan",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "presentation-only"
          },
          {
            "token": "--manifest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--state",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--bundle",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          }
        ],
        "constraints": "Explicit initialized external workspace and authorized comparison repository required. Plan and inspect read only. Freeze previews; --yes requires exact --digest. No execution, reservation or acceptance. Other operations refuse.",
        "parserSource": "lib/evaluation-ledger.mjs"
      },
      {
        "subcommand": "evaluations freeze",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "presentation-only"
          },
          {
            "token": "--manifest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--state",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--bundle",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--digest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          }
        ],
        "constraints": "Explicit initialized external workspace and authorized comparison repository required. Plan and inspect read only. Freeze previews; --yes requires exact --digest. No execution, reservation or acceptance. Other operations refuse.",
        "parserSource": "lib/evaluation-ledger.mjs"
      },
      {
        "subcommand": "evaluations inspect",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "presentation-only"
          },
          {
            "token": "--manifest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--state",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          }
        ],
        "constraints": "Explicit initialized external workspace and authorized comparison repository required. Plan and inspect read only. Freeze previews; --yes requires exact --digest. No execution, reservation or acceptance. Other operations refuse.",
        "parserSource": "lib/evaluation-ledger.mjs"
      },
      {
        "subcommand": "evaluations run",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "presentation-only"
          },
          {
            "token": "--manifest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--state",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--execution",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--digest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          }
        ],
        "constraints": "Explicit offline descriptor and initialized private workspace. Preview exits 3; exact digest approves one slot. Shared host admission; no network, paid provider or hosted execution. Immutable retry never redispatches; uncertainty retains reservations.",
        "parserSource": "lib/evaluation-ledger.mjs"
      },
      {
        "subcommand": "evaluations resume",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "presentation-only"
          },
          {
            "token": "--manifest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--state",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--execution",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--digest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          }
        ],
        "constraints": "Read-only comparison; resume/reconcile/cancel preview and require exact approval. Frozen allowance, durable original identities, bounded recovery; offline only, no hosted or live-provider activation.",
        "parserSource": "lib/evaluation-comparison.mjs"
      },
      {
        "subcommand": "evaluations reconcile",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "presentation-only"
          },
          {
            "token": "--manifest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--state",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--digest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          }
        ],
        "constraints": "Read-only comparison; resume/reconcile/cancel preview and require exact approval. Frozen allowance, durable original identities, bounded recovery; offline only, no hosted or live-provider activation.",
        "parserSource": "lib/evaluation-comparison.mjs"
      },
      {
        "subcommand": "evaluations cancel",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "presentation-only"
          },
          {
            "token": "--manifest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--state",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--digest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          }
        ],
        "constraints": "Read-only comparison; resume/reconcile/cancel preview and require exact approval. Frozen allowance, durable original identities, bounded recovery; offline only, no hosted or live-provider activation.",
        "parserSource": "lib/evaluation-comparison.mjs"
      },
      {
        "subcommand": "evaluations compare",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "forbidden",
            "treatment": "presentation-only"
          },
          {
            "token": "--manifest",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--state",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          },
          {
            "token": "--experiment",
            "arity": 1,
            "repeat": "forbidden",
            "treatment": "limited"
          }
        ],
        "constraints": "Read-only comparison; resume/reconcile/cancel preview and require exact approval. Frozen allowance, durable original identities, bounded recovery; offline only, no hosted or live-provider activation.",
        "parserSource": "lib/evaluation-comparison.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Use local retro evaluations for frozen offline comparison and explicitly approved recovery; no hosted or paid provider activation."
  },
  {
    "id": "cli.workspace",
    "command": "workspace",
    "usage": "plates workspace inspect|init --manifest <absolute-file> --state <absolute-dir> [--yes] [--json]",
    "summary": "inspect or initialize explicitly external private workspace state",
    "source": {
      "file": "lib/cli.mjs",
      "line": 770,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": "inspect",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--manifest",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--state",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/web/workspace.mjs"
      },
      {
        "subcommand": "init",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--manifest",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--state",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Explicit absolute external paths; duplicate flags refused.",
        "parserSource": "lib/web/workspace.mjs"
      }
    ],
    "limitation": "Hosted setup diagnostics do not create local external state or remote accounts.",
    "followUp": "Provide exact bootstrap instructions or enrolled local agent; retain terminal boundary."
  },
  {
    "id": "cli.shape",
    "command": "shape",
    "usage": "plates shape check|render|plan <file> [--output <new-directory>] [--yes --digest <reviewed-digest>] [--json]",
    "summary": "validate and review local shaping records; digest-approved draft writes",
    "source": {
      "file": "lib/cli.mjs",
      "line": 775,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": "check",
        "positionals": "file:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "",
        "parserSource": "lib/shaping.mjs"
      },
      {
        "subcommand": "render",
        "positionals": "file:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--output",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "",
        "parserSource": "lib/shaping.mjs"
      },
      {
        "subcommand": "plan",
        "positionals": "file:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--digest",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "yes requires reviewed digest in writeShape; digest without yes refused.",
        "parserSource": "lib/shaping.mjs"
      }
    ],
    "limitation": "Answering supported shaping question is not check/render/plan of arbitrary draft.",
    "followUp": "Add bounded source-record validation/preview; separate plan commit approval."
  },
  {
    "id": "cli.decision",
    "command": "decision",
    "usage": "plates decision context --phase <id> | --issue <owner/repo#n> [--json]",
    "summary": "read-only scoped decision context for a builder",
    "source": {
      "file": "lib/cli.mjs",
      "line": 780,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": "context",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--phase",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--issue",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Exactly one phase or issue required by resolver.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "Canonical context consumed inside decisions/walks/model tasks; no general issue/phase context explorer route.",
    "followUp": "Add read-only context explorer with complete/not-configured/gaps distinction."
  },
  {
    "id": "cli.production",
    "command": "production",
    "usage": "plates production status|collect|spec|verify [--source <id>] [--start <UTC>] [--end <UTC>] [--incident <id>] [--revision <sha>] [--probe <path>] [--rubric <file>] [--recover] [--yes] [--json]",
    "summary": "bounded production errors, recurring repair specs and evidence-conscious verification",
    "source": {
      "file": "lib/cli.mjs",
      "line": 789,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": "status",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--recover",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--source",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--start",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--end",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--incident",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--revision",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--probe",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Shared parser accepts listed options across forms; domain chooses meaningful options. Default status; recover only affects status.",
        "parserSource": "practices/night/files/scripts/plates/production.mjs"
      },
      {
        "subcommand": "collect",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--recover",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--source",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--start",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--end",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--incident",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--revision",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--probe",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Shared parser accepts listed options across forms; domain chooses meaningful options. Default status; recover only affects status.",
        "parserSource": "practices/night/files/scripts/plates/production.mjs"
      },
      {
        "subcommand": "spec",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--recover",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--source",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--start",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--end",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--incident",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--revision",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--probe",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Shared parser accepts listed options across forms; domain chooses meaningful options. Default status; recover only affects status.",
        "parserSource": "practices/night/files/scripts/plates/production.mjs"
      },
      {
        "subcommand": "verify",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--recover",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--source",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--start",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--end",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--incident",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--revision",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--probe",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "Shared parser accepts listed options across forms; domain chooses meaningful options. Default status; recover only affects status.",
        "parserSource": "practices/night/files/scripts/plates/production.mjs"
      },
      {
        "subcommand": "spec-rubric",
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--yes",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--incident",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--rubric",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "spec --rubric selects this special mode; only incident/rubric/yes/json allowed, not generic source/time flags.",
        "parserSource": "lib/production.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add bounded collector and exact incident repair/verification adapters; absence is not healthy."
  },
  {
    "id": "cli.prove",
    "command": "prove",
    "usage": "plates prove <test file> [--name <pattern>] --fix <path>... [--base <ref>] [--mutate] [--trailer] [--evidence <phase>] [--json]",
    "summary": "a fix is proven by its test failing without it: VERIFIED, NOT WORKING or INCONCLUSIVE; never touches the working tree",
    "source": {
      "file": "lib/cli.mjs",
      "line": 794,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "test-file:1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--mutate",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--trailer",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--name",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--fix",
            "arity": "1..n",
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          },
          {
            "token": "--base",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--evidence",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          }
        ],
        "constraints": "--fix consumes paths until next flag, repeatable; local isolated runner.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Create separately approved isolated red/green runner and evidence preview; typecheck worker is insufficient."
  },
  {
    "id": "cli.release",
    "command": "release",
    "usage": "plates release [<x.y.z> --notes <file|-> [--practice <x.y.z>] [--unreviewed \"<why>\"] [--despite <repo> \"<why>\"]\u2026] [--dry-run] [--json]",
    "summary": "plates only: cut a CLI version, and the practice version only if practices/, migrations/ or docs/lessons.md changed \u2014 review gate, WHATSNEW entry, gate, fleet rehearsal, commit, local tag",
    "source": {
      "file": "lib/cli.mjs",
      "line": 816,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "version:0..1",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          },
          {
            "token": "--dry-run",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--notes",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--practice",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--unreviewed",
            "arity": 1,
            "repeat": "parser-specific",
            "treatment": "limited"
          },
          {
            "token": "--despite",
            "arity": "2",
            "repeat": "explicitly repeatable",
            "treatment": "limited"
          }
        ],
        "constraints": "--despite repeated repository + reason pair; --yes explicitly rejected. --notes - reads stdin. No version is release inspection.",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Create separately approved mothership release workflow with exact notes, rehearsal, gate, tag effects."
  },
  {
    "id": "cli.help",
    "command": "help",
    "usage": "plates help [--json]",
    "summary": "the verbs, one line each",
    "source": {
      "file": "lib/cli.mjs",
      "line": 850,
      "sha256": "33bfb4c97178dfd9286f4228b7d77bda34648b1bccbc237efd8a18975779eec8"
    },
    "forms": [
      {
        "subcommand": null,
        "positionals": "",
        "arguments": [
          {
            "token": "--json",
            "arity": 0,
            "repeat": "parser-specific",
            "treatment": "presentation-only"
          }
        ],
        "constraints": "",
        "parserSource": "lib/cli.mjs"
      }
    ],
    "limitation": "CLI text help is presentation, but web capability help is not yet complete.",
    "followUp": "Generate searchable capability help from shared registry."
  }
];

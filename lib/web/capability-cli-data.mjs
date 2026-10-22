// Reviewed phase107 CLI forms and argument inventory. Changes require an argument/capability audit.
export default [
  {
    "id": "cli.evidence-rederive",
    "command": "evidence rederive",
    "usage": "keel evidence rederive <phase> [--yes] [--json]",
    "summary": "preview dated measurement records; --yes reruns their argument arrays",
    "source": {
      "file": "lib/cli.mjs",
      "line": 153,
      "sha256": "11dd7619e9dfddd3a8a35a75a2e28582d5439af85e333230245d6bd71b903674"
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
    "usage": "keel status [--project <p>] [--json]",
    "summary": "goals with built and lived-in counts, and the next phase",
    "source": {
      "file": "lib/cli.mjs",
      "line": 162,
      "sha256": "06732d50dc237634790066700272dd966937b6204f3a08f960cf54ecd5493e19"
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
    "usage": "keel next [--project <p>] [--json]",
    "summary": "the next phase to conduct, its done-when and next action; every ready phase, free or claimed (it fetches)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 191,
      "sha256": "88faaedff0344b169af3842cab3b5ed7634ecbc0fca14bdbe40b80bdd273fef2"
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
    "usage": "keel goal list [--json]",
    "summary": "every goal, with progress derived from its phases",
    "source": {
      "file": "lib/cli.mjs",
      "line": 218,
      "sha256": "97a811318b90dd002e56ed90d765563e34b1271cf787b2180dec7aeef7e02bd7"
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
    "usage": "keel goal show <id> [--json]",
    "summary": "one goal: its phases, built and lived-in counts, and its next phase",
    "source": {
      "file": "lib/cli.mjs",
      "line": 227,
      "sha256": "3171a65400ae6c73c5a2b5435b484e6fb6da9643cdc5cbbc6baf557ac6916d67"
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
    "usage": "keel goal add \"<title>\" --outcome \"<one sentence>\" [--json]",
    "summary": "add a goal (the next free G<n>) to docs/goals.json; regenerate the roadmap",
    "source": {
      "file": "lib/cli.mjs",
      "line": 236,
      "sha256": "5d85d3f6cdd2b8690fb2a884659b5889efe8c545c47e0092dce740faaa5576c3"
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
    "usage": "keel goal retire <id> --reason \"<why>\" [--phases supersede|move:<Gm>] [--yes] [--json]",
    "summary": "retire a goal with a reason; its unbuilt phases are superseded or moved (--yes)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 246,
      "sha256": "b9ed395c78a0c3fa4168fc7120af74ef388db92e85cd93e7fa8531226e02f987"
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
    "usage": "keel phase new \"<title>\" --goal <id> [--depends 1,2] [--json]",
    "summary": "scaffold the next free phase number from the template, under a goal",
    "source": {
      "file": "lib/cli.mjs",
      "line": 256,
      "sha256": "47211c892244d1dbf61b85c399c0d631179e3f6a4baa7601813d19f2c7ca0440"
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
    "usage": "keel phase claim <n> [--provider <name>] [--token <t>] [--release] [--json]",
    "summary": "claim a phase before building it: one shared create-only branch, claims/phase-<n>; --release gives it back",
    "source": {
      "file": "lib/cli.mjs",
      "line": 266,
      "sha256": "18931cd6a0858edb0f298cccfe876d03c5c90d2842276d70c37a15610e1fd22a"
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
    "usage": "keel ready [--branch <name>] [--check \"<cmd>\"]... [--json]",
    "summary": "hand a committed change off: run only its fast checks, push its branch and ready/<branch>; never the full gate",
    "source": {
      "file": "lib/cli.mjs",
      "line": 276,
      "sha256": "ac7a73420238d17293ce3855d99ad2b6e6ede66d2bc54e4d774bd545aa776ab3"
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
    "usage": "keel integrate [--json]",
    "summary": "one integrator (lock claims/integrate): merge every ready change, run the full gate once, push; a failing change is found and sent back",
    "source": {
      "file": "lib/cli.mjs",
      "line": 292,
      "sha256": "8bbc4a4d8f7c0d7105540aa308fbe08d07c89b009f9ffed748de0f44d0f8660d"
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
    "usage": "keel phase list [--json]",
    "summary": "every phase, as the roadmap reads it",
    "source": {
      "file": "lib/cli.mjs",
      "line": 300,
      "sha256": "21ac694e8f432015ee2aa2a45a32366a79e689aadf4bc767aae08518d5827096"
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
    "usage": "keel render [--check] [--into <dir>] [--json]",
    "summary": "render the project's practices onto it; --check writes nothing",
    "source": {
      "file": "lib/cli.mjs",
      "line": 311,
      "sha256": "5c292c4a50bfd46adc361272e5231e25c6ecdc4f8ac6d498a2aadee8d641694e"
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
    "usage": "keel init [dir] --description \"<paragraph>\" [--name <n>] [--tagline <t>] [--kind static|node|web|other] [--repo owner/name] [--guide <path>] [--with <practice>]... [--github [--yes]] [--json]",
    "summary": "a new project in an empty directory: practice, goal G0, phase 0, one commit",
    "source": {
      "file": "lib/cli.mjs",
      "line": 335,
      "sha256": "7efed79c224d63ccd9040a95fbb82a34f5180ecfe23135feca4cf1e437d188cf"
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
    "usage": "keel adopt [dir] [--dry-run] [--guide <path>] [--check \"<command>\"] [--setup \"<command>\"] [--env KEY=VALUE]... [--with <practice>]... [--json]",
    "summary": "bring an existing project under keel; on only what it already satisfies, the rest local",
    "source": {
      "file": "lib/cli.mjs",
      "line": 351,
      "sha256": "e11f0550d25f7220018236ef37fc16f7c4d744ae7a026b14b4cfd7664eba88a4"
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
    "usage": "keel doctor [--github] [--fix <path> restore|eject [--yes]] [--json]",
    "summary": "what the project changed of the practice, and practice rules broken; changes nothing without --fix",
    "source": {
      "file": "lib/cli.mjs",
      "line": 371,
      "sha256": "7264e9e36af216717d01da86f57e85d4d153bd25c6243897e5a2ac7b6aa2d5db"
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
    "usage": "keel update [dir] [--local] [--yes] [--no-self-update] [--json]",
    "summary": "the CLI first, then migrations, re-render, check; one branch for a PR (--local: a diff)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 386,
      "sha256": "ca9d9a0f7d964bb386ddc2df798869b4c37c45754f85e42e7b1ae41a58b4f226"
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
    "usage": "keel lessons [--dry-run] [--yes] [--to owner/repo] [--since <ref>] [--json]",
    "summary": "send new lessons, drift and practice commits home to keel as issues, once each",
    "source": {
      "file": "lib/cli.mjs",
      "line": 402,
      "sha256": "b1c938234fd93a12938804f8b1e9e687cec6150c0405174e7d0a6d586ab2edd9"
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
    "usage": "keel learn [propose <slug|issue#> --outcome lesson|practice|decline|link --note \"<line>\" --read \"<read>\" [--link <n>] [--yes] | decide <slug|issue#> accepted|declined [--note \"<why>\"] [--shape \"\u2026\" --cost \"\u2026\" --guard \"\u2026\"] [--yes] | render [--check] | distill [propose --kind family|reword|tag|standardise \u2026 --read \"<read>\"]] [--json]",
    "summary": "keel only: gather lesson issues and moved sources into docs/inbox/; propose (agent), decide (person), render, distill (lessons into patterns)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 412,
      "sha256": "80e68f732206dbd1b4b7dc3542a56b883829a5a07c9c753935cb842d997be1b8"
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
    "usage": "keel improve [--sessions | --report] [--transcripts <dir>] [--selftest] [--json]",
    "summary": "is the practice working here: measures against bounds, one proposal; --report writes <health>/<date>.md (.keel/keel.json health, default docs/health)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 459,
      "sha256": "a53e54cef6d70259ae945ace9f1d1ddef62ac69399a7ba2a671de193b62974ce"
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
    "usage": "keel persona run [<name> | --all] [--json]",
    "summary": "measure the goals in .agents/personas/<name>.md: met, missed or broken; writes docs/reviews/<date>-<persona>.md and nothing else (exit 1 missed, 2 broken)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 478,
      "sha256": "8bd101d848f177d7066d5fa6cfffdfbada5b59f66544b9a0b97862102d9dc241"
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
        "parserSource": "practices/personas/files/scripts/keel/persona.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Create a bounded registered persona measurement worker before exposing Run."
  },
  {
    "id": "cli.time",
    "command": "time",
    "usage": "keel time [--weeks N] [--json]",
    "summary": "gate and test weekly medians, load coverage, failure memory and local worked-around counts",
    "source": {
      "file": "lib/cli.mjs",
      "line": 487,
      "sha256": "5d57ed0a0628f21287fb7b1c0f71f77b285b2fecd6dff2dafb69265ff0f1415c"
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
    "usage": "keel test <file>... --stalls [--name <pattern>] [--seed N] [--json]",
    "summary": "run test files paused at seeded random moments (--stalls) and without; name each test that passed without and failed with: it judges the wall clock",
    "source": {
      "file": "lib/cli.mjs",
      "line": 495,
      "sha256": "ad71b833f5ce7428e3add04b429d53dea9b793a1345eec40d2f04ff086ce9999"
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
    "usage": "keel drain <prefix> [--gate-passed] [--yes] [--json]",
    "summary": "one open PR per machine queue: merge older data-only PRs, close the rest as superseded; the newest only after a gate",
    "source": {
      "file": "lib/cli.mjs",
      "line": 506,
      "sha256": "b8847628b8c13bf62d9c915e4abc521e91704a02db6c710ed8bff561a5049065"
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
    "usage": "keel night plan [--date <YYYY-MM-DD>] [--json]",
    "summary": "tonight's default plan, written before the night runs (.keel/night/plan.json): measures, the health proposal, the climb job, the robot's next issue, untriaged Loop findings; no model",
    "source": {
      "file": "lib/cli.mjs",
      "line": 515,
      "sha256": "4a9138feaed307ef8618742e6ceea58dbc61cb03a78252651f08b3c5d543a54f"
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
    "usage": "keel night tick <id> --status <planned|running|done|failed|skipped|left-alone> [--note \"<text>\"] [--link <url>] [--json]",
    "summary": "tick one item of tonight's plan: its status, with a note and a link; an unknown id or a move back from done is refused (exit 2)",
    "source": {
      "file": "lib/cli.mjs",
      "line": 523,
      "sha256": "af7d5010c1dc12b05eea80d9c0fab6fe8f0a10500f20c3b717c6e08545e5918c"
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
    "usage": "keel morning [--date <YYYY-MM-DD>] [--send | --card [--dry-run | --yes]] [--json]",
    "summary": "the night's brief from its plan as it finished: done, tried, failed and why, left alone or not finished by, your next; --send opens the assigned \"Good morning\" issue once a night; --card publishes the plan as the live canvas card night-plan",
    "source": {
      "file": "lib/cli.mjs",
      "line": 535,
      "sha256": "5370dbe5a5699538cefdc722142aad9f3333ff87c46577fe58ad269dd52859ad"
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
    "usage": "keel goodnight [add <suggestion-id> | add --title \"<words>\" [--kind <k>] [--measure <m> --bound <n> --better <lower|higher>] [--lane <l>] [--budget <minutes>] [--id <x>] | drop <id> | edit <id> [--title \"<words>\"] [--kind <k>] [--lane <l>] [--measure <m>] [--bound <n>] [--better <b>] [--budget <minutes>] | budget <id> <minutes> | skip <path-or-id> | --yes] [--json]",
    "summary": "the owner shapes tonight's plan: settled today, left open, the default plan, things to try; add|drop|edit|budget|skip change a draft; --yes writes it and pushes it to keel-night-plan",
    "source": {
      "file": "lib/cli.mjs",
      "line": 547,
      "sha256": "a3adccf0b50bac13271e26c4c5bbdd55e1a7a7a38f0846ddcfb11506e38b0fba"
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
    "usage": "keel fleet [--json]",
    "summary": "keel only: every project in fleet.json \u2014 adopted, practice behind, health, CI, unsent lessons, machine PRs; read-only",
    "source": {
      "file": "lib/cli.mjs",
      "line": 555,
      "sha256": "31919169231eca21d13b6252e58e74103436736cf3af4d51d52c74c460745a2c"
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
    "limitation": "Private manifest fleet lens, not mothership fleet.json/local checkout census.",
    "followUp": "Name manifest membership and missing local sources."
  },
  {
    "id": "cli.fleet-update",
    "command": "fleet update",
    "usage": "keel fleet update [--yes | --rehearse] [--json]",
    "summary": "keel only: open the update PR in each fleet project behind or with pending migrations, with your gh login (--yes); --rehearse runs the update and check in clones, pushing nothing",
    "source": {
      "file": "lib/cli.mjs",
      "line": 563,
      "sha256": "ecedfe5543c5720dd8639bee923aa2949cb1c67c86b1acdb5539aba70b22f6b4"
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
    "usage": "keel loose-ends [--all] [--phase N] [--root <dir>] [--fresh] [--json] | mark <id> resume|park|drop --reason \"<why>\" [--until YYYY-MM-DD]",
    "summary": "what you started and did not finish, in keel and each fleet checkout: chats, files, branches, PRs, owner steps; read-only but mark",
    "source": {
      "file": "lib/cli.mjs",
      "line": 580,
      "sha256": "251d3530a8ee2b2a29f21b08eb3ae771a862351cbcf20da6849147ffa951fcea"
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
    "usage": "keel feedback capture <file> [--yes --digest <sha256>] | list | propose <id> --record <file> | resolve <id> --record <file> [--yes --digest <sha256>] [--json]",
    "summary": "capture private feedback on an exact result; preview follow-up or resolution without starting work",
    "source": {
      "file": "lib/cli.mjs",
      "line": 600,
      "sha256": "e1cbd648175201fd303c2c1f02f3274d405a0ac0f30d66459014468da39c4cef"
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
    "usage": "keel issue new --agent --title <title> --rubric <file> [--yes] [--json]",
    "summary": "preview or create a rubric-shaped agent issue; OFF stays unlabelled, --yes approves creation",
    "source": {
      "file": "lib/cli.mjs",
      "line": 622,
      "sha256": "03fff34ef9c755575e3b4d28c7d9de50eb7cfdcc51cbd464396780fc89b1ec04"
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
    "usage": "keel review <owner/repo>#<n> [--wait] [--gate] [--reviewer <login>]... [--json] | <owner/repo>@<sha> [--json] | --close <id>[,<id>\u2026] --fixed <commit>|--tracked <issue|version>|--not-valid \"<why>\" [--class <kind>] | --class security|overwrite|approval|other <id>[,<id>\u2026] | --close <id> --tracked --file-agent-issue --title <title> --rubric <file> [--yes]",
    "summary": "a PR's review comments, or a push's review after it landed (<repo>@<sha>), which are answered; --wait for its reviewers; --close answers one it read (never in bulk): fixed, tracked or not valid; --class sorts one by the merge rule without answering it. Not a gate; at its round limit (exit 3) the owner chooses",
    "source": {
      "file": "lib/cli.mjs",
      "line": 641,
      "sha256": "a25bfbee902e6d096bbb901ac1e0ffa24f99ac824b4cfad4b918a9b17a848f88"
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
    "usage": "keel board [--open] [--port <n>] [--fresh] [--json]",
    "summary": "whose turn it is: every open item as yours, broken, the agent's or waiting on time, from the roadmap, loose ends, reviews, health, the inbox and the fleet; a page on 127.0.0.1 without --json",
    "source": {
      "file": "lib/cli.mjs",
      "line": 674,
      "sha256": "a28d157c1997a93435f9d3dddcb521965b3d4115c30dc055454668bdb9d94cf8"
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
    "usage": "keel promote [<commit>] [--yes] [--within <s>] [--every <s>] [--json] | --back <commit> [--yes] [--within <s>] [--every <s>] [--json]",
    "summary": "move production (\"delivery\".promote) to a commit on the tested ref whose gate passed: a preview (exit 3), then --yes moves it and verifies production serves it; --back <commit> rolls back and needs exactly that commit served; a person's command, never a workflow's",
    "source": {
      "file": "lib/cli.mjs",
      "line": 692,
      "sha256": "7deab3b0553e939924cc30ac2ae1cf28f165d0a977eab6241519e2b1c30b687e"
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
        "constraints": "CLI delegates unvalidated argv to installed scripts/keel/promote.mjs. This canonical grammar is only applicable after installed source identity/drift validation. --back supplies commit; at most one commit.",
        "parserSource": "practices/delivery/files/scripts/keel/promote.mjs"
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Design reviewed deployment/rollback adapter with gate and serving-revision proofs, separate from update PR."
  },
  {
    "id": "cli.walk",
    "command": "walk",
    "usage": "keel walk done <phase> (--note \"<what you saw>\" | --choice \"<one of its Your part's Choices>\" [--note \"\u2026\"]) [--box <n>] [--json] | decide --proposal <health page> [--instance <id>] (--accept [\"<why>\"] | --decline \"<why>\" | --map <file>) [--json]",
    "summary": "settle the owner's turn: done checks a phase's \u2691 walk box and writes the read (or the choice from its Your part) into its evidence (built when nothing is left); decide accepts or declines a health proposal; leaves a diff",
    "source": {
      "file": "lib/cli.mjs",
      "line": 708,
      "sha256": "7bdb3091d2319a612ee7242a95c0740ed13141a12bba54693ab68ead901dc043"
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
    "usage": "keel canvas snapshot [--output <file>] [--github] [--artifact <repo-relative-json>]... [--history <repo-relative-json>]... [--window-days <N>] [--json]\nkeel canvas render --snapshot <file> --output <dir> [--json]\nkeel canvas connect --create --title <title> --space <id> --home <origin> --audience owner-only [--yes] [--json]\nkeel canvas connect --canvas <address> --audience owner-only [--home <origin>] [--yes] [--json]\nkeel canvas sync [--snapshot <file> | --github] [--dry-run | --yes] [--json]\nkeel canvas status [--json]\nkeel canvas live [--card <key>]... [--keep <N> | --no-keep] [--off] [--yes] [--json]\nkeel canvas rebase [--card <key>] [--onto <version-id>] [--yes] [--json]\nkeel canvas disconnect [--yes] [--json]\nkeel canvas night --report <file> [--yes] [--json]",
    "summary": "project canvas: local snapshot/render; connect, sync, status, live, rebase, disconnect, night",
    "source": {
      "file": "lib/cli.mjs",
      "line": 734,
      "sha256": "0505719150e56b43d8a76cf156598d85090c94594942127dc564fb636ac0d963"
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
    "usage": "keel retro [--worksheet] [--since <commit>] [--session <id>] [--json] | capture --record <file> [--since <commit>] [--session <id>] [--yes] [--json] | sessions <status|start|begin|finish|handoff|audit|apply|rollback> [--experiment <id>] [--record <file>] [--yes] [--json]",
    "summary": "retro worksheet, reviewed capture, and bounded session trials; mutations require --yes",
    "source": {
      "file": "lib/cli.mjs",
      "line": 752,
      "sha256": "1108b2bdec5526caa4b7d13098ac94ea328d23a6a522d4a1f5c76b39a4d677ee"
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
      }
    ],
    "limitation": "No equivalent web execution currently implemented.",
    "followUp": "Add authored reviewed capture/session trial workflows; no implicit experiment or budget activation."
  },
  {
    "id": "cli.workspace",
    "command": "workspace",
    "usage": "keel workspace inspect|init --manifest <absolute-file> --state <absolute-dir> [--yes] [--json]",
    "summary": "inspect or initialize explicitly external private workspace state",
    "source": {
      "file": "lib/cli.mjs",
      "line": 762,
      "sha256": "b771f80180ab23659c93ad9d3e8a708e7821c578fa858c34aa591e1ca2bb39ed"
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
    "usage": "keel shape check|render|plan <file> [--output <new-directory>] [--yes --digest <reviewed-digest>] [--json]",
    "summary": "validate and review local shaping records; digest-approved draft writes",
    "source": {
      "file": "lib/cli.mjs",
      "line": 767,
      "sha256": "3ae925f593ae717ffc847999d8f6a3c9537544df15b6f6b399fe55ce2cf2d074"
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
    "usage": "keel decision context --phase <id> | --issue <owner/repo#n> [--json]",
    "summary": "read-only scoped decision context for a builder",
    "source": {
      "file": "lib/cli.mjs",
      "line": 772,
      "sha256": "ec180f2383f107fae6b10efdb66ec0ca3bd68110443a1ff5950c48ef87d7450b"
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
    "usage": "keel production status|collect|spec|verify [--source <id>] [--start <UTC>] [--end <UTC>] [--incident <id>] [--revision <sha>] [--probe <path>] [--rubric <file>] [--recover] [--yes] [--json]",
    "summary": "bounded production errors, recurring repair specs and evidence-conscious verification",
    "source": {
      "file": "lib/cli.mjs",
      "line": 781,
      "sha256": "6f3824612b1f0d7bde847c14abd2a0f3e59ef7960527b1ff2ed9a62e39d40789"
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
        "parserSource": "practices/night/files/scripts/keel/production.mjs"
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
        "parserSource": "practices/night/files/scripts/keel/production.mjs"
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
        "parserSource": "practices/night/files/scripts/keel/production.mjs"
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
        "parserSource": "practices/night/files/scripts/keel/production.mjs"
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
    "usage": "keel prove <test file> [--name <pattern>] --fix <path>... [--base <ref>] [--mutate] [--trailer] [--evidence <phase>] [--json]",
    "summary": "a fix is proven by its test failing without it: VERIFIED, NOT WORKING or INCONCLUSIVE; never touches the working tree",
    "source": {
      "file": "lib/cli.mjs",
      "line": 786,
      "sha256": "1f3d97e20bb70b1180b57ec7b057839c16782649aca3fdaac22bb5df07dff572"
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
    "usage": "keel release [<x.y.z> --notes <file|-> [--practice <x.y.z>] [--unreviewed \"<why>\"] [--despite <repo> \"<why>\"]\u2026] [--dry-run] [--json]",
    "summary": "keel only: cut a CLI version, and the practice version only if practices/, migrations/ or docs/lessons.md changed \u2014 review gate, WHATSNEW entry, gate, fleet rehearsal, commit, local tag",
    "source": {
      "file": "lib/cli.mjs",
      "line": 808,
      "sha256": "817c107b25ff978677c389cd66337e9bbdc9920579486a71f820a4556ae1f328"
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
    "usage": "keel help [--json]",
    "summary": "the verbs, one line each",
    "source": {
      "file": "lib/cli.mjs",
      "line": 842,
      "sha256": "7e7c4f6ba6ed671868ff12323d641c04bf0a6f93276c6e011a8c30f9ae1e42e2"
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

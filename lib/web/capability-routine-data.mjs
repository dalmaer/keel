// Reviewed phase107 canonical installed entrypoints. Changes require an argument/capability audit.
export default [
  {
    "id": "routine.contract-hook",
    "title": "contract-hook",
    "source": "practices/agents-md/files/scripts/plates/contract-hook.mjs",
    "forms": [
      "(stdin hook)"
    ],
    "arguments": [],
    "positionals": "none; stdin JSON",
    "notes": "No flag parser; argv unused. Agent-local hook, not an owner-invoked web task.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.climb",
    "title": "climb",
    "source": "practices/climb/files/scripts/plates/climb.mjs",
    "forms": [
      "config",
      "agent-ran",
      "tend-pick",
      "tend-input",
      "tend-note",
      "tend-page",
      "tend-report",
      "pick",
      "measure",
      "distill",
      "distill propose",
      "loop-pull",
      "compare",
      "prove-steady",
      "harmless",
      "revert",
      "settle",
      "guard",
      "sandbox",
      "held",
      "report"
    ],
    "arguments": [
      "--date",
      "--runs",
      "--rounds",
      "--base",
      "--head",
      "--candidate",
      "--what",
      "--why",
      "--input",
      "--body",
      "--test",
      "--path",
      "--job",
      "--issue",
      "--outcome",
      "--file",
      "--minutes",
      "--started",
      "--agent",
      "--finding",
      "--propose",
      "--tried",
      "--last-night",
      "--since",
      "--plan",
      "--kind",
      "--name",
      "--rule",
      "--guard",
      "--rows",
      "--row",
      "--shape",
      "--cost",
      "--check",
      "--family",
      "--note",
      "--read",
      "--force",
      "--baseline",
      "--decide",
      "--final",
      "--state",
      "--record",
      "--json"
    ],
    "positionals": "measure <job>; distill [propose]; parser permits extra positional tokens, semantic branches use selected ones",
    "notes": "Every listed flag parses globally; values except force/baseline/decide/final/state/record. Shared lib main removes --json. Exact per-form consumption lives in cli switch; accepting a flag is not proof it changes that form.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.robot",
    "title": "robot",
    "source": "practices/climb/files/scripts/plates/robot.mjs",
    "forms": [
      "fetch",
      "sandbox",
      "context",
      "prepare",
      "judge",
      "publish",
      "review-prepare",
      "review-post",
      "message"
    ],
    "arguments": [],
    "positionals": "first token command; remaining argv ignored",
    "notes": "Workflow-controlled environment supplies identity, paths, minutes and authorization. No generic flags. Web typecheck/update/model task is not robot execution.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.cross-review",
    "title": "cross-review",
    "source": "practices/cross-review/files/scripts/plates/cross-review.mjs",
    "forms": [
      "config",
      "which",
      "brief",
      "agent-ran",
      "summary",
      "which-push",
      "push-review",
      "push-post"
    ],
    "arguments": [
      "--pr",
      "--event",
      "--out",
      "--outcome",
      "--file",
      "--minutes",
      "--started",
      "--repo",
      "--agent",
      "--diff",
      "--plain",
      "--author",
      "--reason",
      "--push",
      "--head-diff",
      "--before",
      "--issues",
      "--review",
      "--json"
    ],
    "positionals": "",
    "notes": "All listed flags valued except shared --json; globally accepted, branch requirements differ. No positional after verb.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.promote",
    "title": "promote",
    "source": "practices/delivery/files/scripts/plates/promote.mjs",
    "forms": [
      "promote",
      "back"
    ],
    "arguments": [
      "--yes",
      "--back",
      "--within",
      "--every",
      "--json"
    ],
    "positionals": "commit:0..1; --back consumes same commit slot",
    "notes": "Canonical source only; installed changed implementation cannot inherit eligibility.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.publish",
    "title": "publish",
    "source": "practices/delivery/files/scripts/plates/publish.mjs",
    "forms": [
      "publish",
      "plan",
      "advance"
    ],
    "arguments": [
      "--plan",
      "--advance",
      "--from",
      "--to",
      "--trigger",
      "--json"
    ],
    "positionals": "",
    "notes": "No verb positional; mode flags. --advance requires from/to, refuses plan. --from/to parsed even on modes that do not consume them.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.verify",
    "title": "verify",
    "source": "practices/delivery/files/scripts/plates/verify.mjs",
    "forms": [
      "verify",
      "live"
    ],
    "arguments": [
      "--site",
      "--within",
      "--every",
      "--exact",
      "--record",
      "--json"
    ],
    "positionals": "sha:1",
    "notes": "live accepts site/json only. within/every seconds up to3600, every>0.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.loop",
    "title": "loop",
    "source": "practices/loop/files/scripts/loop.mjs",
    "forms": [
      "list(default)",
      "pull",
      "propose",
      "decide",
      "push",
      "mine",
      "prove",
      "render"
    ],
    "arguments": [
      "--rank",
      "--phase",
      "--project",
      "--lesson",
      "--note",
      "--read",
      "--decision",
      "-d",
      "--json",
      "--check",
      "--dry-run",
      "--no-push",
      "--no-render",
      "--no-prove",
      "--yes"
    ],
    "positionals": "propose slug; decide slug decision; mine priority*; prove slug?",
    "notes": "node:util.parseArgs strict but all options globally accepted; extra positionals generally ignored except mine. Global string options support --name=value and -d, -- terminator; others boolean. Local config adds arbitrary context commands, afterRender and prove commands; not browser executable.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.canvas-recovery",
    "title": "canvas-recovery",
    "source": "practices/night/files/scripts/plates/canvas-recovery.mjs",
    "forms": [
      "select"
    ],
    "arguments": [
      "--workflow"
    ],
    "positionals": "none; other argv ignored",
    "notes": "Reads recovery workflow context; not a conditional canvas mutation itself.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.drain",
    "title": "drain",
    "source": "practices/night/files/scripts/plates/drain.mjs",
    "forms": [
      "drain"
    ],
    "arguments": [
      "--gate-passed",
      "--yes",
      "--json"
    ],
    "positionals": "prefix:1",
    "notes": "",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.gate",
    "title": "gate",
    "source": "practices/night/files/scripts/plates/gate.mjs",
    "forms": [
      "gate"
    ],
    "arguments": [
      "--ci",
      "--json"
    ],
    "positionals": "",
    "notes": "Configured project check shell executes; observed Actions history is not invocation capability.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.improve",
    "title": "improve",
    "source": "practices/night/files/scripts/plates/improve.mjs",
    "forms": [
      "measure"
    ],
    "arguments": [
      "--report",
      "--transcripts",
      "--pr-input",
      "--json"
    ],
    "positionals": "",
    "notes": "Installed differs from CLI improve: pr-input accepted; sessions/selftest not accepted here.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.morning",
    "title": "morning",
    "source": "practices/night/files/scripts/plates/morning.mjs",
    "forms": [
      "brief",
      "send",
      "decide",
      "finalize"
    ],
    "arguments": [
      "--date",
      "--github-output",
      "--pr-input",
      "--json"
    ],
    "positionals": "",
    "notes": "brief/send:date; decide:github-output; finalize:date(required),pr-input.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.night-plan",
    "title": "night-plan",
    "source": "practices/night/files/scripts/plates/night-plan.mjs",
    "forms": [
      "plan",
      "tonight",
      "tick",
      "record",
      "publish",
      "check"
    ],
    "arguments": [
      "--date",
      "--branch-plan",
      "--branch-unread",
      "--status",
      "--note",
      "--link",
      "--ticks",
      "--remote",
      "--file",
      "--json"
    ],
    "positionals": "tick id:1; other forms no positionals",
    "notes": "plan date; tonight required date + mutually exclusive branch-plan/branch-unread; tick status required/note/link; record date/ticks required remote optional; publish date required remote optional; check file optional.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.pr-body",
    "title": "pr-body",
    "source": "practices/night/files/scripts/plates/pr-body.mjs",
    "forms": [
      "render"
    ],
    "arguments": [
      "--input",
      "--files",
      "--json"
    ],
    "positionals": "",
    "notes": "input required; files optional; renders reviewed JSON into text, no PR publication.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.production-night",
    "title": "production-night",
    "source": "practices/night/files/scripts/plates/production-night.mjs",
    "forms": [
      "collect",
      "restore-only"
    ],
    "arguments": [
      "--restore-only"
    ],
    "positionals": "",
    "notes": "argv.includes switch, other argv ignored; JSON always emitted. Relies on workflow environment and production policy.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.production",
    "title": "production",
    "source": "practices/night/files/scripts/plates/production.mjs",
    "forms": [
      "status(default)",
      "collect",
      "spec",
      "verify"
    ],
    "arguments": [
      "--source",
      "--start",
      "--end",
      "--incident",
      "--revision",
      "--probe",
      "--recover",
      "--yes",
      "--json"
    ],
    "positionals": "",
    "notes": "Installed parser lacks CLI spec --rubric wrapper; options parse globally; semantic scope per operation.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.test-history",
    "title": "test-history",
    "source": "practices/night/files/scripts/plates/test-history.mjs",
    "forms": [
      "recover"
    ],
    "arguments": [
      "--repo",
      "--branch",
      "--json"
    ],
    "positionals": "",
    "notes": "Strict unique valued repo/branch. Source collection only, not test execution.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.test-ledger",
    "title": "test-ledger",
    "source": "practices/night/files/scripts/plates/test-ledger.mjs",
    "forms": [
      "junit",
      "sample",
      "gate",
      "run"
    ],
    "arguments": [
      "--junit",
      "--runner",
      "--status",
      "--start",
      "--sample",
      "--gate",
      "--run"
    ],
    "positionals": "run shell-command:1",
    "notes": "sample/gate exact argv; run exact single shell string; junit parser supports --flag=value as well as separate value; no --json argument. Node reporter import is a separate non-CLI lifecycle.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.persona",
    "title": "persona",
    "source": "practices/personas/files/scripts/plates/persona.mjs",
    "forms": [
      "run"
    ],
    "arguments": [
      "--all",
      "--json"
    ],
    "positionals": "name:0..1",
    "notes": "Canonical pure parser; project instruments may execute local commands, require distinct bounded worker design.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.roadmap",
    "title": "roadmap",
    "source": "practices/phases/files/scripts/roadmap.mjs",
    "forms": [
      "write(default)",
      "check",
      "next",
      "json"
    ],
    "arguments": [
      "--check",
      "--next",
      "--json"
    ],
    "positionals": "",
    "notes": "Finds first recognized mode by priority check,next,json; unrelated args ignored. --json here selects a mode, unlike ordinary formatting flag.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  },
  {
    "id": "routine.reconcile",
    "title": "reconcile",
    "source": "practices/reconciliation/files/scripts/plates/reconcile.mjs",
    "forms": [
      "reconcile",
      "impact"
    ],
    "arguments": [
      "--github",
      "--impact",
      "--event",
      "--base",
      "--head",
      "--root",
      "--json"
    ],
    "positionals": "",
    "notes": "impact/event switch source; all others valued except github/json; no positional; local paths explicit.",
    "followUp": "Define a fixed source-pinned adapter with bounded input, fresh authority, budget where needed and original-receipt recovery, or retain explicit unsupported operation."
  }
];

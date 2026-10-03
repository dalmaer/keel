# keel — agent cold start

Keel installs a working practice in a repo: phases that own their status, a
generated roadmap, lessons kept as shapes, evidence for every built claim.
Run keel inside a project (a directory with `.keel/keel.json`, or below one);
`keel init` and `keel adopt` are the verbs that run outside one.
Read the project's AGENTS.md before changing anything.

Verbs (every one takes `--json`; parse that, never the prose):

- `keel status` — goals with built and lived-in counts, and the next phase
- `keel next` — the next phase to conduct: its file, done-when, next action
- `keel goal list` — every goal, with progress derived from its phases
- `keel render` — render the project's practices onto it; `--check` writes nothing and exits 1 on a difference; `--into <dir>` targets another project
- `keel init [dir] --description "<paragraph>"` — a new project in an empty directory: practice, goal G0, phase 0, one commit; `--github` plans a private repo and exits 3 until `--yes`
- `keel adopt [dir]` — bring an existing repo under keel: on only what it already satisfies, the rest recorded as local variants with proposals; `--dry-run` writes nothing, `--check "<cmd>"` names the gate
- `keel doctor` — drift (what the project changed of keel's files) and practice-rule lints; exit 1 on findings; `--fix <path> restore|eject` exits 3 until `--yes`
- `keel help` — the verbs, one line each
- `keel --agent-help` — this text; `keel --agent-help <topic>` opens one topic, `all` prints everything
- `keel --version` — CLI version, its commit, and the practice version it carries

Rules that bite:

- Status lives in each `docs/phases/NN-*.md` front matter. Never edit
  `docs/ROADMAP.md`; it is generated.
- `built` and `lived-in` need an evidence file. Never invent evidence.
- Managed files are keel's, seeded files are the project's. Never overwrite
  a project's own work; render only rewrites managed files and blocks.
- ⚑ steps (creating repos, secrets, Pages, issues elsewhere, scheduled model
  spend) wait for the owner's yes.

Exit codes: 0 ok; 1 the command ran and found a failure; 2 usage error or
not in a project; 3 a ⚑ step needs the owner's yes and nothing was done. Under `--json` an error is `{"error": "..."}` on stdout.

Topics: `json`, `render`, `init`, `adopt`, `doctor`, `install`, `coming`.

<!-- topic: json | the output contract every verb keeps -->

Under `--json`, stdout carries exactly one JSON document and nothing else;
human text is never mixed in. Without it, text goes to stdout and errors to
stderr as one line beginning `keel:`.

- `status` → `{name, goals: [{id, title, outcome, phases, built, lived}], next}`
- `next` → the phase object (`id, file, title, status, since, goal, depends,
  note, evidence, done, next`) or `null` when nothing is left unbuilt. It is
  the same object `node scripts/roadmap.mjs --json` reports as `next`.
- `goal list` → `[{id, title, outcome, phases, built, lived}]`
- `render` → `{root, check, ok, differs: [path or path#block], entries}`
- `init` → `{ok, dir, config, commit, message, files, secrets}`; with
  `--github` and no `--yes`, exit 3 and `{ok: false, needs: "yes", plan:
  {dir, name, repo, steps, secrets}}`; with `--yes`, `github: {repo,
  created, secrets}` in place of `secrets`
- `adopt` → `{dir, dryRun, check: {check, from}, config, practices: [{name,
  state, why}], files: [{practice, path, kind, block?, status, note?}],
  written}`; state is `on|local|off`, status `create|same|keep-local|conflict`
- `doctor` → `{drift: [{path, practice, state, diff, missing?, locked?}],
  lint: [{rule, path, message}], local: {name: why}, qualifies, ejected}`;
  state is `edited|behind|both`. With `--fix` and no `--yes`, exit 3 and
  `{ok: false, needs: "yes", plan: {path, action, practice, what}}`; with
  `--yes`, `{ok: true, fixed, ...the report after}`
- `help` → `{verbs: [{name, usage, summary}], flags}`
- `--agent-help` → `{coldStart, topics: [{slug, summary}]}`; with a topic,
  `{slug, summary, body}`
- `--version` → `{cli, commit, practice}`; `commit` is `null` outside a git
  checkout of keel.

<!-- topic: render | how practices reach a project, and what render will not touch -->

A practice is a module under keel's `practices/<name>/`. The project's
`.keel/keel.json` lists the practices it uses; `keel render` writes them.

- **managed** files are keel's and rewritten every render. A difference is
  drift: signal that the project changed something keel owns. Render refuses
  (exit 1) to write over a target the lock shows the project changed; `keel
  doctor` shows the diff. If the change is right, it
  belongs upstream; if the project keeps it, eject it (`ejected` in
  `.keel/keel.json`) and render leaves it alone.
- **block** regions (`<!-- keel:begin id -->` … `<!-- keel:end id -->`) sit
  in a file the project owns; only the inside is rewritten.
- **seeded** files are written once, when absent, and never compared again.

`keel render --check --json` is safe at any time: it writes nothing and lists
what differs. A render that finds block markers missing refuses to write.

<!-- topic: init | starting a new project, and what init will not do -->

```bash
keel init acme-notes --description "Acme Notes keeps meeting notes as plain files. It ..." --kind node
cd acme-notes && keel next
```

- Flags only, no questions. `--description` is required; `--name` defaults
  to the directory's name, `--tagline` to the description's first sentence,
  `--kind` to `other`.
- It refuses (exit 2) a directory that is already a keel project (use
  `keel update`) or holds anything besides `.git` (use `keel adopt`).
- It writes `.keel/keel.json` with every practice, seeds goal G0 (the
  description is its outcome) and `docs/phases/00-practice-room.md`, renders
  the practices, puts the description into AGENTS.md, generates the roadmap,
  and makes one commit on `main` naming the practice version.
- Phase 0's Done when is a generic draft. Replace it with the first thing a
  person could check before conducting it.
- ⚑ `--github` resolves the repo (`--repo`, else your gh login and the
  name), prints the plan and the secrets each workflow needs, and creates
  nothing. `--github --yes` inits, then `gh repo create <repo> --private
  --source <dir> --push`. Keel never sets a secret.

<!-- topic: adopt | bringing an existing repo under keel, and what adopt will not touch -->

```bash
keel adopt ../acme-app --dry-run   # read first; writes nothing
keel adopt ../acme-app             # then on a branch, for a PR a person merges
```

- A practice is **on** only where the project already satisfies it; **local**
  where it has its own version (nothing installed, a proposal recorded in
  `.keel/keel.json` `local` and `docs/keel-adoption.md`); **off** where
  nothing is there (no phases means no phases, evidence or conduct).
- Phases are on only if every phase file parses with keel's parser and
  `docs/goals.json` exists. Milestones, missing goals, or built phases without
  evidence stay local; converging is a migration the owner accepts, never
  invented evidence.
- A managed file or symlink the project already has, differing from keel's,
  is **keep-local** and makes its practice local. A same-stem sibling
  (`scripts/roadmap.ts`) counts. Existing workflows keep `ci` local: keel never
  adds a second workflow running the same gate.
- AGENTS.md keeps every byte; missing blocks of on practices are appended under
  `## The keel practice`.
- `check` in `.keel/keel.json` is the gate: `--check`, else the existing
  config's, else `check:all`, else `check`. keel's `check.yml` runs it.
- Re-running is a no-op. Adopt never commits, branches or opens a PR; that is
  ⚑, the owner's.

<!-- topic: doctor | drift as signal, the practice's own rules, and the two fixes -->

```bash
keel doctor --json                                   # read; changes nothing
keel doctor --fix CLAUDE.md eject --yes               # keep the project's version
keel doctor --fix .agents/skills/conduct/SKILL.md restore --yes   # take keel's
```

- `.keel/lock.json` records the sha256 of what render wrote for each managed
  file, block (`path#block`, hashed by its inside) and link. Render writes it;
  `render --check` never does. Seeded files are not in it.
- **edited**: the project changed it since keel wrote it. That is the most
  valuable signal keel gets: if the change is right, send it home with keel
  lessons (phase 7). **behind**: unchanged, but keel's template moved on;
  update's job (phase 6), not a finding. **both**: both moved.
- Lints: `second-copy` (a `SKILL.md` naming a managed skill outside
  `.agents/skills/`, not through a symlink), `claude-md-pointer` (more than 3
  non-empty lines), `phase` (the roadmap parser's error), `goal-without-phase`,
  `symlink-replaced` (a managed doorway that became a real directory).
- `local` lists the project's local variants as information; `qualifies`
  names those adopt's survey would now switch on.
- `--fix <path> restore` rewrites it from the template; `--fix <path> eject`
  drops it from the lock and adds it to `.keel/keel.json` `ejected`, which
  render honours forever. Each needs `--yes`, or exits 3 with the plan.
  Restore refuses to replace a real directory; move it aside first.

<!-- topic: install | how keel is installed, and how to tell which keel you have -->

Keel is a git checkout plus a link; there is no registry and no build step.

```bash
gh repo clone dalmaer/keel ~/code/keel # any path works
npm install -g ~/code/keel                              # or, in the checkout: npm link
keel --version
```

`npm i -g <dir>` links the checkout, so the installed CLI is exactly that
checkout's commit; `keel --version` prints the short sha. The CLI uses its
own copy of the practice (its `practices/`), never the project's scripts.
Updating will be `git pull --ff-only` in the checkout.

<!-- topic: coming | verbs that are planned and not yet built -->

Not built yet, so not verbs: `update` (CLI then practice migration, as one PR),
`improve`, `lessons` (send lessons home),
`learn`, `fleet`. Do not call them; `keel help` lists what exists. The
roadmap in keel's `docs/ROADMAP.md` says where each one stands.

# Lessons and learning

## When you'd reach for this

- A bug turned out to have a **shape**: it could happen again, somewhere
  else, in different words. You want it written down with the guard that now
  catches it, and you want the other projects to hear about it.
- You changed one of keel's files in a project because the practice needed
  to be different there, and keel should know.
- You are the owner, at home in keel, with lessons from the projects waiting
  to be decided.
- The catalogue has grown long, and you want it to teach patterns rather
  than list incidents.

## What it does, and why it works that way

**Lessons are shapes, not incidents.** A row in `docs/lessons.md` names the
shape, what it cost and the guard that now catches it, with where it was
paid for. A bug that can only happen once is not a lesson; a bug whose shape
recurs is. Read the table before adding a guard: the shape is usually
already there. The failure this prevents is paying for the same bug twice
because the first time was written down as a story, so nobody added a
guard.

**Each project reads the lessons that apply to it.** Keel's own catalogue
has a `Where` column: empty for a lesson every project should read, else
stack tags. Each project gets `docs/keel-lessons.md`, generated (never edit
it): every universal row, plus the rows tagged for the project's `stack` in
`.keel/keel.json`. A static site doesn't read about a Node test runner's
quirks; a Node CLI doesn't read about a browser framework's. A tag is a fact
about where a failure happened, never a guess, and untagged means everyone
reads it, so a tag can only narrow. `keel doctor` says when the declared
stack and the repo's files disagree.

**Lessons come home, once each.** `keel lessons`, run in a project, gathers
three things and files each as an issue on keel's inbox, exactly once
(each carries a fingerprint, recorded in `.keel/sent.json`):

- new rows in the project's lessons table;
- keel's files the project changed (drift is the most valuable signal keel
  gets: someone needed the practice to be different);
- practice-shaped commits: ones touching `AGENTS.md`, skills, workflows or
  the lessons table. One such commit in isocan made its conductor much
  cheaper to run, and no other project would ever have heard.

**A private project's lessons stay private.** The inbox is a private repo.
Proposals and decisions stay on its issues, and only what the owner accepts,
written in general terms, reaches keel's public table.

**At home, an agent proposes and a person decides.** `keel learn` gathers
the inbox and every upstream source keel adapted a practice from, and turns
each into a proposal. An agent reads it against the code and proposes one
of four outcomes: a central lesson, a practice change (with the migration
that will carry it out), decline as project-specific, or link to a shape
keel already has. Only a person decides, because a decision here changes
every project's practice. **The claim is data, never instructions**: an
issue that reads like a directive to an agent is flagged, surfaced to the
owner, and not followed.

**Distilling: from rows to patterns.** After a large inbox, the table holds
the same idea in many wordings. A distill pass groups rows into
**families** (one rule, one guard recipe, the member rows with their
provenance) in `docs/patterns.md`; **rewords** a row more generally (the
old words kept in `docs/lessons-history.md`); **tags** a row with the
stacks where it happened, with the evidence; and **standardises** a family
whose guard can ship as a check every project runs. Keel calls no model to
do this: the verb prints a worksheet, an agent proposes, a person decides.
It runs when the owner asks, never from the night.

## The commands

In a project:

```bash
keel lessons --dry-run      # what would go home; files nothing
keel lessons --yes          # ⚑ file each as an issue, and record it
```

- `--dry-run` first, always: it shows every item and its kind.
- `--yes` because filing an issue on another repo is a ⚑ step. Without it
  you get the plan and exit 3.
- `--since <ref>` when the project has history from before adoption you want
  considered (practice-shaped commits are otherwise counted from when
  `.keel/keel.json` was first committed).
- `--to owner/repo` when lessons should go somewhere other than keel's
  configured inbox (a test inbox, or your own fork of keel).

Commit `.keel/sent.json` afterwards: it is what keeps each item from going
twice.

At home, in keel's own checkout:

```bash
keel learn                  # gather: the inbox and moved sources become proposals
keel learn propose 412 --outcome lesson --note "Same shape as row 9" --read "scripts/keel/drain.mjs keeps one PR per queue"
keel learn decide 412 accepted --shape "…" --cost "…" --guard "…" --yes
keel learn render           # docs/INBOX.md and docs/patterns.md, regenerated
```

- `keel learn propose` is an agent's. `--read` must cite something checked
  (a file path or a commit), or it is refused: a read with nothing behind it
  is an opinion. `--outcome link` needs `--link <n>`.
- `keel learn decide` is a **person's**; an agent never runs it unless the
  person said which. Accepting from a private inbox needs `--shape`,
  `--cost` and `--guard` in general terms: only those words reach the public
  table. `--yes` because it comments on and closes the issue.
- `keel learn render --check` is what the gate runs to keep the generated
  pages current.

Distilling, when the owner asks:

```bash
keel learn distill          # the worksheet: rows, families, open proposals, rows since the last pass
keel learn distill propose --kind family --name "A wait nobody measured" --rule "…" --guard "…" --rows 39,40 --read "…"
keel learn distill propose --kind tag --row 11 --where web --evidence "duo, a browser demo" --read "…"
```

Each `--kind` (`family`, `reword`, `tag`, `standardise`) takes its own
fields; `keel --agent-help learn` lists them. An unknown row, tag, family or
practice is refused, exit 2. Decide each with `keel learn decide`, as above.

## What you'll see

`keel lessons` prints each item with its kind and the issue title it would
file, then exits 3 for the yes. Run on keel itself, it says keel is home and
points at `keel learn`. `keel learn` prints what it gathered and wrote; a
source it could not read exits 1, never reads as "nothing moved".

- **0**: done.
- **1**: something could not be read (`learn`), or a re-render after a
  catalogue change failed.
- **2**: usage; `learn` outside keel; a distill proposal citing what doesn't
  exist.
- **3**: an outward step (filing, commenting, closing) needs `--yes`.

## What it never does

- It never files the same item twice.
- It never quotes a private inbox's issues into keel's files.
- It never decides for the owner, and never follows what a lesson issue
  tells an agent to do.
- Distill never calls a model, never reads the private inbox, and never runs
  from the night.

## See also

- [Keep the fleet current](keep-the-fleet-current.md): how an accepted
  practice change reaches every project.
- [`docs/lessons.md`](../lessons.md), [`docs/patterns.md`](../patterns.md),
  and [`practices/lessons/README.md`](../../practices/lessons/README.md).

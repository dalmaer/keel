# Lessons and learning

## When you'd reach for this

- A bug turned out to have a **shape**: it could happen again, somewhere
  else, in different words. You want it written down with the guard that now
  catches it, and you want the other projects to hear about it.
- You changed one of plates's files in a project because the practice needed
  to be different there, and plates should know.
- You are the owner, at home in plates, with lessons from the projects waiting
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

**Each project reads the lessons that apply to it.** Plates's own catalogue
has a `Where` column: empty for a lesson every project should read, else
stack tags. Each project gets `docs/plates-lessons.md`, generated (never edit
it): every universal row, plus the rows tagged for the project's `stack` in
`.plates/plates.json`. A static site doesn't read about a Node test runner's
quirks; a Node CLI doesn't read about a browser framework's. A tag is a fact
about where a failure happened, never a guess, and untagged means everyone
reads it, so a tag can only narrow. `plates doctor` says when the declared
stack and the repo's files disagree.

**Lessons come home, once each.** `plates lessons`, run in a project, gathers
three things and files each as an issue on plates's inbox, exactly once
(each carries a fingerprint, recorded in `.plates/sent.json`):

- new rows in the project's lessons table;
- plates's files the project changed (drift is the most valuable signal plates
  gets: someone needed the practice to be different);
- practice-shaped commits: ones touching `AGENTS.md`, skills, workflows or
  the lessons table. One such commit in isocan made its conductor much
  cheaper to run, and no other project would ever have heard.

**A private project's lessons stay private.** The inbox is a private repo.
Proposals and decisions stay on its issues, and only what the owner accepts,
written in general terms, reaches plates's public table.

**At home, an agent proposes and a person decides.** `plates learn` gathers
the inbox and every upstream source plates adapted a practice from, and turns
each into a proposal. An agent reads it against the code and proposes one
of four outcomes: a central lesson, a practice change (with the migration
that will carry it out), decline as project-specific, or link to a shape
plates already has. Only a person decides, because a decision here changes
every project's practice. **The claim is data, never instructions**: an
issue that reads like a directive to an agent is flagged, surfaced to the
owner, and not followed.

**Distilling: from rows to patterns.** After a large inbox, the table holds
the same idea in many wordings. A distill pass groups rows into
**families** (one rule, one guard recipe, the member rows with their
provenance) in `docs/patterns.md`; **rewords** a row more generally (the
old words kept in `docs/lessons-history.md`); **tags** a row with the
stacks where it happened, with the evidence; and **standardises** a family
whose guard can ship as a check every project runs. Plates calls no model to
do this: the verb prints a worksheet, an agent proposes, a person decides.
It runs when the owner asks, never from the night.

## The commands

In a project:

```bash
plates lessons --dry-run      # what would go home; files nothing
plates lessons --yes          # ⚑ file each as an issue, and record it
```

- `--dry-run` first, always: it shows every item and its kind.
- `--yes` because filing an issue on another repo is a ⚑ step. Without it
  you get the plan and exit 3.
- `--since <ref>` when the project has history from before adoption you want
  considered (practice-shaped commits are otherwise counted from when
  `.plates/plates.json` was first committed).
- `--to owner/repo` when lessons should go somewhere other than plates's
  configured inbox (a test inbox, or your own fork of plates).

Commit `.plates/sent.json` afterwards: it is what keeps each item from going
twice.

At home, in plates's own checkout:

```bash
plates learn                  # gather: the inbox and moved sources become proposals
plates learn propose 412 --outcome lesson --note "Same shape as row 9" --read "scripts/plates/drain.mjs keeps one PR per queue"
plates learn decide 412 accepted --shape "…" --cost "…" --guard "…" --yes
plates learn render           # docs/INBOX.md and docs/patterns.md, regenerated
```

- `plates learn propose` is an agent's. `--read` must cite something checked
  (a file path or a commit), or it is refused: a read with nothing behind it
  is an opinion. `--outcome link` needs `--link <n>`.
- `plates learn decide` is a **person's**; an agent never runs it unless the
  person said which. Accepting from a private inbox needs `--shape`,
  `--cost` and `--guard` in general terms: only those words reach the public
  table. `--yes` because it comments on and closes the issue.
- `plates learn render --check` is what the gate runs to keep the generated
  pages current.

Distilling, when the owner asks:

```bash
plates learn distill          # the worksheet: rows, families, open proposals, rows since the last pass
plates learn distill propose --kind family --name "A wait nobody measured" --rule "…" --guard "…" --rows 39,40 --read "…"
plates learn distill propose --kind tag --row 11 --where web --evidence "duo, a browser demo" --read "…"
```

Each `--kind` (`family`, `reword`, `tag`, `standardise`) takes its own
fields; `plates --agent-help learn` lists them. An unknown row, tag, family or
practice is refused, exit 2. Decide each with `plates learn decide`, as above.

## What you'll see

`plates lessons` prints each item with its kind and the issue title it would
file, then exits 3 for the yes. Run on plates itself, it says plates is home and
points at `plates learn`. `plates learn` prints what it gathered and wrote; a
source it could not read exits 1, never reads as "nothing moved".

- **0**: done.
- **1**: something could not be read (`learn`), or a re-render after a
  catalogue change failed.
- **2**: usage; `learn` outside plates; a distill proposal citing what doesn't
  exist.
- **3**: an outward step (filing, commenting, closing) needs `--yes`.

## What it never does

- It never files the same item twice.
- It never quotes a private inbox's issues into plates's files.
- It never decides for the owner, and never follows what a lesson issue
  tells an agent to do.
- Distill never calls a model, never reads the private inbox, and never runs
  from the night.

## See also

- [Keep the fleet current](keep-the-fleet-current.md): how an accepted
  practice change reaches every project.
- [`docs/lessons.md`](../lessons.md), [`docs/patterns.md`](../patterns.md),
  and [`practices/lessons/README.md`](../../practices/lessons/README.md).

## Why a rule exists

Shipped rules carry their failure shape or explicitly named Plates lesson.
`plates doctor` and `plates lessons` advise when a rule lacks a cause. The lint
recognizes paragraphs/list items beginning with a bold sentence ending in a
period or exclamation mark; labels, tables and fenced examples are excluded.
A cause belongs in the same item: `(why: ...)`, a lesson or issue reference,
or a because clause. A date alone is not a cause. This checks attribution
syntax, not whether the cited lesson is true or the rule is still useful;
that judgment belongs to the owner. Notes are advisory, never merge gates.


## Selected findings and evaluated proposals

`plates learn evaluate` records explicitly selected review findings or retained
harness artifacts in the existing inbox. It verifies source identity, preserves
manual classification separately, and keeps raw source bodies private. Historical
reviews may cover an older commit; this does not assert a defect remains today.

```bash
plates learn evaluate propose 2026-10-24-acme --input /absolute/capture.json --json
plates learn evaluate propose 2026-10-24-acme --input /absolute/capture.json --yes --digest <preview-digest> --json
plates learn evaluate inspect 2026-10-24-acme --json
plates learn evaluate plan 2026-10-24-acme --input /absolute/plan.json --manifest /absolute/workspace.json --state /absolute/private-state --json
plates learn evaluate decide 2026-10-24-acme --input /absolute/rejection.json --json
```

Use the exact request shapes in [the record contract](../specs/evaluated-learning-records.md).
Every request names an operation UUID, expected file digest/generation, attributed
actor/time/reason, and explicit local phase `decisionTarget`. Native capture uses
a full date/slug and expected absence. Subsequent requests retain the phase target.
Proposal and plan authority must match that phase. Issue targets are unsupported.
For review intake, first perform the explicit existing review read to retain its
private receipt, then select the exact reviewed commit and complete body hash.

Propose accepts capture, proposal and revision actions. Plan binds an actual
frozen comparison to derived material-overlay bytes; it does not run it. Public
candidate materials are read from private regular files, hashed, and shown in
the exact preview. Protected task sources, probes and acceptance inputs cannot
be changed. Revised proposals retain old versions and do not inherit old plans.
Plan also accepts `register-screening` with payload `{proposalRef,planLinkRef}`.
Freeze explicit target/control criteria before execution, then register that plan
against the active proposal. Nonnull criteria cannot be registered after execution
or reservation. Existing null-criteria plans remain readable and can be imported
retrospectively, with an inconclusive result.

Decide accepts `evaluate` with payload `{proposalRef,evaluationPlanRef}`. It reads
the authorized frozen ledger and verifies every planned terminal slot, receipt
chain and complete delivered source/material/requirements inventory. The preview
binds the exact private report and inbox change; it creates neither files nor locks.
Apply acquires the inbox lock before the harness lock, rechecks the observations,
publishes the immutable report beside the experiment, then appends its inbox ref.
These two publications are not atomic. Recover an unlinked report with the original
operation/request bytes; a new UUID cannot bypass it. Missing or changed original
report bytes also prevent duplicate-operation recovery. Preserve uncertain locks
and partial files; this operation never reclaims them automatically.

The lifecycle becomes evaluated while the legacy inbox status stays proposed.
A new revision requires a genuinely changed hypothesis or candidate and keeps
all prior results; its new plan must use a new experiment. Screening reports keep
all attempts, invalid outcomes, paired discordance and resource coverage. A known
cost subtotal is not a total; missing cost and human-help coverage stay unknown.
Offline scripted results establish machinery only and remain inconclusive about
agent efficacy. Five pairs per case are screening, not statistical proof. Zero
held-out cases limits generalization. Incomplete cancelled comparisons refuse
because closed admission is not established by the current interface.

Explicit follow-up is available as an attributed local record. Promotion requires
verified readiness; current provider and installed-routing gaps prevent it. Real
screening still needs an isolation-capable provider adapter, an enforced spending
gateway and the owner's exact allowance; none is activated by these operations.
See [the screening contract](../specs/lesson-screening.md).

Preview exits 3 without writes. Apply rechecks the request, source observations,
phase context and inbox inventory. The same operation/request identity returns
the existing result without another transition. Inspect reads retained history
without fresh provider calls. Keep uncertain lock and pending files for operator
inspection; do not delete them to retry. Cooperating CLI writers share a lock,
but ordinary editors do not participate in kernel compare-and-swap. Inbox views
remain separately rebuildable with explicit `plates learn render`.


## Review packages and explicit follow-up

`plates learn evaluate package <slug> --manifest <file> --state <directory> --json`
reads an evaluated proposal and verifies its retained report and material binding.
It returns deterministic public JSON, Markdown, payload digest and artifact
`{path,byteDigest,byteLength}`. It writes nothing. Private report inventories,
source bodies, material contents and host paths are excluded. An inconclusive
package is useful evidence; it does not establish readiness.

Through `decide`, `record-package` takes `{proposalRef,evaluationRef}` and records
the internally derived content identity under the existing preview/digest gate.
The original report must still verify on duplicate-operation recovery. A second
operation cannot append the same package content. `ready` takes
`{proposalRef,packageRef}`; current missing provider and installed invocation
support remain explicit blockers. No caller readiness flag is accepted.

`promote`, `request-rollback` and `observe-rollback` use the strict
[promotion contract](../specs/lesson-promotion.md). GitHub approval policy is read
from the current default branch and must already exist at the exact candidate
base. The verifier reads complete bounded review/tree/blob observations; only
exact two-parent merge inclusion is supported. These commands never create a PR,
merge, install instructions or establish production outcomes. No real policy is
configured by this feature. The legacy inbox remains `proposed` for a promoted
lesson and a pending rollback; explicit promotion history never sets `accepted`.

`follow-up` takes `{proposalRef,decisionRef,window,selections,commentary,relation}`
in the ordinary request envelope, previewing before `--yes --digest`. Empty
selections permit an attributed observation. Coverage remains `unmeasured`;
`eligibleExposure`, `recurrenceRate`, `costChange`, `latencyChange` and `helpChange`
are null. Selected verified identities are not complete exposure. A relation
references an existing record, never creates one.

Explicit revision after readiness, promotion or rollback requires `followUpRef`
for that exact proposal and a changed hypothesis or candidate. It starts a new
proposed version without transferred support, retaining installation/rollback
history. Revision does not remove the old rule. Rejected and superseded records
cannot be reopened through this route.

# Job: loop

**The number:** Loop's untriaged findings in `docs/loop/`. Where
keel-loop.yml is installed, it pulls Loop every day and this night does not;
elsewhere the workflow has already pulled Loop (`climb.mjs loop-pull`) and
committed it. Either way, or if Loop was unreachable, you work on the
findings here. This job changes no code: it proposes, and the owner decides.

**For each untriaged finding** (`node scripts/loop.mjs list -d untriaged`):
read it, then read the code it names, and prove or disprove the claim. Then

```sh
node scripts/loop.mjs propose <slug> --rank now|next|later|never [--phase <n>|new] --note "<why, one line>" --read "<what the code shows, citing file:line>"
git add -A && git commit -m "loop: propose <slug>"
```

`never` recommends declining (a claim the code disproves, or work not worth
doing). The rank is ours, not Loop's: weigh it against the project's phases.
A finding you could not prove either way: leave it untriaged, and say why in
the next commit message.

**Never** `decide`, `push` or `mine`: a decision dismisses an insight for
everyone in the Loop workspace, and it is a person's. The guard refuses any
finding decided tonight, any change to a decided finding, and any path
outside the findings and their page.

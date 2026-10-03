# Evidence: phase 17 — what going public would expose

- Date: 2026-10-03
- Phase: 17
- Revision: `d3c0fea` (tree and full history, all refs).
- Claim being checked: nothing in keel's tree or history should be private.

## Commands

```bash
git grep -c -I -e '<pattern>'                 # the tree
git log --all -S'<pattern>' --format=%h       # every commit that added or removed it
```

Patterns: the owner's home path, `/var/folders`, `/private/tmp`, the owner's
username, email, and family and personal names that appear in ledger's own
docs. Also: Telegram, Gmail, TripIt, Asana, ledger's Loop workspace id, the
Jules workspace URL, private repo names, the cajones hosting project id,
token prefixes (`sk-ant`, `ghp_`, `github_pat_`, `BEGIN PRIVATE`), "password",
and ledger finding titles.

## Hits, and the decision for each

| Hit | Where | Decision |
| --- | --- | --- |
| No home path, `/var/folders`, email, token or personal name | tree **and** history: 0 | Clean |
| `/private/tmp` | `docs/evidence/2026-10-02-cli.md`, in a quoted error message from running `keel` in `/tmp` | Generic; keep |
| `jules.google.com/jitro` | `practices/loop/` (README and script default) | The generic base URL, no workspace id; keep |
| ledger's Loop workspace id, finding titles | 0 in tree and history | Clean |
| `dalmaer/ledger`, `dalmaer/cajones` (both **private** repos) | `fleet.json`, `docs/evidence/2026-10-02-fleet.md`, and ledger in `practices/loop/` provenance | **The owner decides.** Going public reveals that these repos exist |
| ledger described at a high level ("personal task ledger"; Telegram and Vercel specifics; `due` is sacred) | `docs/research/2026-10-02-the-fleet.md` | **The owner decides** |
| Engineering summaries of ledger's lessons (e.g. "Google revoked the brief's Gmail app password", Vercel deployment limits, OAuth callback hosts) | `docs/lessons.md` rows 2–4, 7–10 | **The owner decides.** They describe failures and guards, not data |

## Decision

No content needs rewriting from history. Everything that would become public
is a description of the owner's own private projects, and the owner saw the
list before the flip (recorded in phase 17 when they answer).

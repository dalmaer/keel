# Evidence: phase 16 — keel learns its ancestors

- Date: 2026-10-03
- Phase: 16
- Revision: the phase 16 commit.
- Claim being checked: adopt reads ledger's and isocan's real gate, lessons
  and phases; it installs nothing that duplicates theirs; each clone's own
  gate passes after adoption.

## Automated checks (conductor, integrated tree)

| Command | Exit | The line that says so |
| --- | --- | --- |
| `npm run check` | 0 | `ℹ tests 195` · `ℹ pass 195` · `ℹ fail 0` |

`tests/ancestors.test.mjs` (13) uses an isocan-shaped synthetic fixture,
`acme-canvas`. It covers:

- no gate → a dry run says so, and a write run exits 2;
- `--check` recorded;
- a lessons table elsewhere found, with nothing seeded beside it;
- the `docs/projects/<p>/phases.md` reader: the status mapping,
  off-vocabulary statuses, heading statuses read as unknown, and next from
  where-we-are;
- conduct local where it is the upstream source;
- 0003 not applying while built phases owe evidence.

## By hand (fresh clones; originals never written)

| Did | Observed |
| --- | --- |
| Conductor: isocan clone, `keel adopt --dry-run` | `Gate: none found — pass --check "<command>"`; phases `local` (36 projects, read-only); conduct `local`, as "this repo is conduct's upstream source", with no copy seeded; lessons `on` |
| Conductor: the same clone, `keel adopt` with no `--check` | exit 2, `git status` empty |
| Builder: isocan clone, `keel adopt --check "npm test && npm run typecheck"` | exit 0; 5 files, +130/−0; `npm ci` then the gate: exit 0, **7,593 tests passed**; `keel next --project keys` names phase 3; `keel doctor` reports 39 findings (29 heading-status, 10 off-vocabulary `DONE`). That is real signal in isocan's own files |
| Builder: ledger clone, `keel adopt`, then `keel update --local` | adopt exit 0, 12 files, +1,647/−0. Update: "nothing to change"; 0003 doesn't apply. The proposal lists the **17 built phases owing evidence** (0–5, 10–16, 20, 21, 23, 26). `npm run check:all` exit 0 (with `LEDGER_AUTOSYNC=0`, as ledger's own CI sets it) |
| Conductor: the originals afterwards | ledger HEAD `77509a96`, unchanged, no new reflog entries; isocan unchanged |

## Gaps and decision

- ⚑ ledger's adoption PR (owner) and isocan's (Dimitri) aren't opened.
- ledger's phases converge only once its 17 built phases carry evidence or
  step back. Keel won't write placeholder evidence (a facade).
- Supports **partial**.

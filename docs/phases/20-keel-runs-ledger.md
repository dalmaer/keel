---
status: planned
since: 2026-10-03
goal: G2
depends: [15, 16]
note: "The owner wants keel going and tested on ledger first (3 Oct), then the others."
evidence: []
---

# ledger runs on keel for real, and nothing it had stops working

## Done when

ledger's adoption PR is merged; ledger's own CI is green on it; one real keel-night on ledger has measured it, opened its health PR and drained it; `keel fleet` shows ledger adopted and current; and ledger's CLI never synced or pushed from a keel run.

## Scope

**Stage A: adopt ledger.** keel needs two things it lacks:

- **`setup` in `.keel/keel.json`**, the install command keel-night runs
  before measuring. The default is `npm ci` when a lockfile exists. For
  ledger it is `npm ci && npm ci --prefix web`, because its gate builds
  `web/`.
- **`env` in `.keel/keel.json`**, variables applied wherever keel runs the
  project's gate: improve, locally and in CI, and update. For ledger,
  `LEDGER_AUTOSYNC=0`. Without it, ledger's CLI syncs git in the background,
  and a run with write permission could push to `main`.

Then:

1. Adopt a fresh clone with `--check "npm run check:all"`.
2. Read the AGENTS.md diff for guidance that duplicates ledger's own "How
   the work is run".
3. Walk the night locally: setup, `improve --report`, and a drain dry run.
4. ⚑ Open the PR.

**Stage B: Loop through keel.** keel's port lacks two things ledger's
`loop.ts` has: the telemetry context it sends to Loop, and the Loop counts
ledger's roadmap shows. Port both, retire `loop.ts`, and run one real cycle
with the `STITCH_API_KEY` the owner set. That is a separate PR.

## Acceptance

- [ ] `setup` and `env` exist, are honoured by keel-night, improve and update, are shown by `keel doctor`, and are tested (a gate that needs an env var fails without it and passes with it).
- [ ] A fresh ledger clone, adopted, passes `check:all` and `keel improve`, and `git log` and `git status` in the clone show nothing the gate wrote or synced.
- [ ] The adoption PR shows additions only, apart from intended keel files. Its AGENTS.md section doesn't restate ledger's own rules.
- [ ] ⚑ The ledger PR is merged, by the owner or with their yes, and ledger's own CI is green on it.
- [ ] ⚑ The owner turns on "Allow GitHub Actions to create and approve pull requests" for ledger. One real keel-night on ledger then opens and drains its health PR.
- [ ] `keel fleet` shows ledger `adopted: yes`, current.
- [ ] Stage B: Loop's real pull, propose and render cycle runs through keel's practice on ledger, and ledger's `docs/LOOP.md` keeps its bytes (except line 1).

## Proof

- Automated: `node --test` on the improve, night, update, adopt and doctor
  tests.
- Walks: a fresh clone of ledger (the original is never written); the PR's
  CI run; the first real night's run URL; `keel fleet`.
- ⚑ The PR, the repo setting, and the Loop cycle.

## Deliberately open

- **Whether ledger's own CI should be keel's `ci` practice.** No: it stays
  local; ledger's `test.yml` already runs the gate.
- **Which of ledger's 17 evidence-owed phases to settle first.** The owner's
  call, from `keel doctor`'s list.

## Next action

Build `setup` and `env`, then walk Stage A on a fresh clone.

# Evidence: phase 15 — projects run on their own

- Date: 2026-10-03
- Phase: 15
- Revision: `d001829`.
- Claim being checked: a project's workflows never reach back to keel, and
  update PRs go out from keel.

## Automated checks

| Command | Exit | The line that says so |
| --- | --- | --- |
| `npm run check` (conductor, integrated tree) | 0 | `ℹ tests 181` · `ℹ pass 181` · `ℹ fail 0` |
| `check` on GitHub for `d001829` | 0 | `gh run watch --exit-status` |
| `grep -rnE "dalmaer/keel\|KEEL_TOKEN\|repo clone\|git clone"` over every shipped and rendered workflow | 1 (no match) | `none` |

The tests cover:

- the workflow test failing, under mutation, on keel's repo name,
  `KEEL_TOKEN`, `gh repo clone`, `git clone`, or `keel.mjs` outside keel's
  own guarded `learn` step;
- migration 0002 deleting an unedited `keel-update.yml` and keeping an
  edited one;
- `keel fleet update` exiting 3 with the plan without `--yes`; with `--yes`
  against the gh stub, opening exactly 2 PRs for the 2 behind projects,
  skipping one whose PR is already open, and reporting a failed clone;
- `lib/night.mjs`'s `drain` being the same function object as the shipped
  one;
- an edited `scripts/keel/drain.mjs` failing `render --check`.

## By hand

| Did | Observed | Proves |
| --- | --- | --- |
| `keel init` a temp project, copy it to a path with no keel in it, `PATH` stripped to system dirs plus node, then `node scripts/keel/improve.mjs --report` | exit 0. `6 ok, 0 outside, 6 n/a, 0 broken`; each n/a says why (no repo, no lockfile, keel only, no transcripts); `docs/health/2026-10-03.md` written | The night measure runs with no keel anywhere |
| Dispatched keel's own nightly: https://github.com/dalmaer/keel/actions/runs/37129845290 | exit 0. It ran `node scripts/keel/improve.mjs` and `node scripts/keel/drain.mjs`; no keel checkout or token step exists; the PR-setting notice as before | The real workflow runs from its own repo |

## Gaps and decision

- ⚑ The Proof's real `keel fleet update --yes` needs an adopted, behind
  project. None exists until the adoptions merge.
- Supports **partial**.

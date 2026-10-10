---
status: built
since: 2026-10-10
goal: G0
spec: 2
depends: [56, 57]
note: "Local and real GitHub cost measured; two production contracts checked without compiling runtime source."
evidence: ["evidence/2026-10-10-cli-contracts.md"]
---

# CLI cost is measured and evidence contracts are checked

## Done when

Repeatable CLI measurements distinguish startup, local residual work, subprocesses and observed network boundaries, and a no-emit type check rejects invalid evidence states in selected production modules.

## Scope

Opt-in development profiling, with unchanged normal CLI output and exit codes.
Report elapsed wall time, overlap and gaps honestly: local residual is not CPU
time, child tools' network latency is opaque, and concurrent spans are not
summed as wall time. Do not record arguments, URLs, tokens, bodies or output.
Use actual commands for local measurements and a read-only GitHub surface.

Checked JSDoc on a bounded set of existing state/receipt producers or readers,
with discriminated states, explicit unavailable values and unknown external
input. Development-only tooling may be installed; runtime dependencies remain
zero, source remains executable, and adopted projects need no type checker.
Runtime validation remains necessary. No language port or speculative speedup.

## Acceptance

- [x] Profiling preserves command output and failure status, handles overlapping and failed operations, and records no sensitive payloads: `tests/profile.test.mjs`.
- [x] Selected production state/receipt modules pass no-emit checking, and negative contract cases prove invalid states are rejected: `npm run typecheck`.
- [x] Startup, local work, subprocesses and a real read-only network operation are measured with context and limits in the research record: `node scripts/profile-benchmark.mjs --output /tmp/keel-phase67-bench/final-github.json --samples 3 --github --json`.
- [x] The integrated runtime tests and documentation guards pass: `npm run check`.

## Real surfaces

- Owner's machine: repeated local CLI measurements, with Node/OS/sample count and raw timing records.
- GitHub API: read-only API measurement; no remote writes are needed for the benchmark.
- Published package: unpacked CLI remains directly executable without development dependencies.

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/profile.test.mjs`
`npm run typecheck`
`node --import ./tests/helpers/hermetic.mjs --test tests/package.test.mjs`
`npm run check`

The research record names the final profiling commands and results.

## Deliberately open

- Broad type coverage is deferred: this phase checks an explicit production
  slice, not every JavaScript module. Expand when concrete boundary bugs or
  maintenance work justify it.
- Language migration remains undecided; these measurements inform it, and
  do not establish performance of an unbuilt Go or Rust port.
- Subprocess internals are opaque. Report network-capable child tools as
  such; never call their whole duration pure network time.

## Next action

None. Repeated use may justify wider type coverage or targeted profiling;
these measurements do not justify a language port by themselves.

## Trajectory

- **2026-10-10** — Checked JSDoc's object braces collided with practice
  interpolation before a real GitHub call. Spaced braces preserve both
  contracts; the actual renderer now verifies byte-for-byte compatibility.
- **2026-10-10** — Most remote doctor time was in opaque `gh` subprocesses;
  local timing queries had no such waits. Keep the categories and workload
  context separate before proposing a runtime rewrite.
- **2026-10-10** — Contributor tools have different distribution boundaries
  from adopter practices. Their documentation lives outside adopter guides,
  and the self-only typecheck workflow still runs the existing workflow rules.
- **2026-10-10** — Independent review caught nested `exec`/`execFile`
  instrumentation counting one child twice. The delegated boundary is wrapped
  once; a red-before/green-after test covers callback, promise and sync forms.

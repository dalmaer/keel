---
status: designed
since: 2026-10-10
goal: G0
spec: 2
depends: [56, 57]
note: "Measure CLI cost and check evidence contracts without compiling runtime source."
evidence: []
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

- [ ] Profiling preserves command output and failure status, handles overlapping and failed operations, and records no sensitive payloads: `tests/profile.test.mjs`.
- [ ] Selected production state/receipt modules pass no-emit checking, and negative contract cases prove invalid states are rejected: `npm run typecheck`.
- [ ] Startup, local work, subprocesses and a real read-only network operation are measured with context and limits: `docs/research/2026-10-10-cli-cost.md`.
- [ ] The integrated runtime tests and documentation guards pass: `npm run check`.

## Real surfaces

- Owner's machine: repeated local CLI measurements, with Node/OS/sample count and raw timing records.
- GitHub: read-only API measurement; no remote writes are needed for the benchmark.
- Installed package: unpacked CLI remains directly executable without development dependencies.

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

Build opt-in measurements and checked contracts, then run the named proof.

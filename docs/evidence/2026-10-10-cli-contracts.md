# Evidence: phase 67 — measured CLI cost and checked contracts

- Date: 2026-10-10
- Phase: [67](../phases/67-cli-cost-and-checked-contracts.md)
- Revision: `9a233a9` plus phase 67 working tree
- Claim: opt-in boundary measurements preserve CLI behavior; two production
  evidence/policy modules have strictly checked no-emit contracts, with no
  runtime dependency or build requirement.

## Automated checks

- `node --import ./tests/helpers/hermetic.mjs --test tests/profile.test.mjs`:
  exit 0, 8 passed. Actual CLI stdout/stderr/status, failed and overlapping
  child/network operations, private bounded records, signals, inert default
  behavior, sample statistics and help. Local socket tests need permission
  to bind localhost; the sandbox's EPERM is not an application failure.
- `npm run typecheck`: exit 0. Strict checking of the two production modules
  listed in `tsconfig.json` and eight negative examples importing their types.
- Independent negative verification in a temporary copy, removing only the
  eight `@ts-expect-error` lines: TypeScript exit 2, exactly eight expected
  type errors. No mutation was made in the shared source tree.
- Receipt/proposal focused tests: 11 passed, exit 0; runtime JSON validation,
  producer round trips, unavailable measurements, malformed nesting and
  byte-preserving practice interpolation. The initial invocation also named
  a nonexistent `tests/robot.test.mjs`, which Node did not run; robot coverage
  was separately verified with the actual file below.
- `node --import ./tests/helpers/hermetic.mjs --test tests/robot-policy.test.mjs tests/timing-hygiene.test.mjs`:
  exit 0, 4 passed. OFF/default/invalid/enabled policy behavior and existing
  timing guards.
- `node --import ./tests/helpers/hermetic.mjs --test tests/package.test.mjs`:
  exit 0, 1 passed. Packs the current source, runs the unpacked CLI without
  installing dev dependencies, initializes an Acme project and passes its gate.
- `npm run render`, `npm run roadmap`: exit 0. Both changed managed sources
  are rendered with their lock hashes; the phase has one status owner.
- Final gate: `npm run check`, covering the complete runtime suite, roadmap,
  rendered practice and inbox checks. Its result belongs in the commit body.
  The separate `npm run typecheck` also runs in the self-only CI workflow.

The first integrated gate exited 1: 1,211 passed, three deterministic guard
failures, and no hygiene findings. It exposed checkout-only profiling commands
in adopter guides, test launches bypassing the standard helper, and a self-only
workflow absent from the workflow coverage registry. Developer documentation
moved to `docs/development.md`; profiler tests use the existing helper and
standalone synthetic fixture programs; the self-only workflow is explicitly
covered by the existing workflow rules rather than exempted. The final gate
runs after those corrections; the failed run is not counted as proof.

After corrections, the conductor ran
`node --import ./tests/helpers/hermetic.mjs --test tests/profile.test.mjs tests/helpers.test.mjs tests/guides.test.mjs tests/workflows.test.mjs`:
exit 0, 48 passed. The local workflow has the same rule and shell checks,
including failing mutations, as shipped workflows. The CI template's comment
now distinguishes the dependency-free runtime gate from contributor tooling;
its execution is unchanged.

## Real surfaces

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Ten interleaved normal/profiled invocations per local command on owner's machine | All 100 invocations exited 0; individual observations retained | Actual startup/local/child boundaries, not unloaded performance or CPU attribution |
| Three real profiled `doctor --github` invocations | All exited 0, two `gh` calls each; median 1,727 ms elapsed | Read-only remote CLI path; child network internals stay opaque |
| Three independent public GitHub HTTPS probes | HTTP 200, median 244 ms request through response end | Real direct-network instrumentation, not equivalent to doctor or pure wire latency |
| Packed distribution execution | Unpacked CLI initialized a project whose gate passed | No runtime compiler/dev dependency requirement; not a newly published release |

See the [measurement report](../research/2026-10-10-cli-cost.md) and
[individual observations](2026-10-10-cli-cost.json).

## Gaps and decision

Built is supported by these local and real read-only surfaces, contingent on
the final gate. Lived-in is not claimed. Type coverage is deliberately two
production modules; merge facts and acceptance remain outside that slice.
Runtime validators remain necessary. The benchmark does not observe worker
threads, descendant internals, raw sockets or fetch response-body work.
High machine load prevents a confident migration speedup estimate.

The first GitHub sample failed before network because JSDoc's double braces
collided with template interpolation. The fixed comments and renderer test
are recorded, and failed samples are preserved. No language port, production
optimization, robot activation, new scheduled model spend or release was done.

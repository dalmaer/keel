# Evidence: phase 49 — faster practice reads, current guidance

- Date: 2026-10-07
- Phase: 49
- Revision: a31ae552db200c882136013f4e539a440463842a plus working tree
- Claim: concurrent independent practice reads reduce loading cost without caching or changing deterministic validation; current guidance reflects shipped behavior.

## Automated checks

Conductor ran from the repository root (exit 0):

```sh
node --import ./tests/helpers/hermetic.mjs --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout tests/practices.test.mjs tests/cli.test.mjs tests/docs.test.mjs tests/guides.test.mjs
```

34 passed, 0 failed, 4938 ms. Ledger: no flaky or slower test (98 runs).
The new Acme test verifies sorted practice order, declared template order,
project selection order, changed manifests/templates/directories on subsequent
calls, snapshot independence and deterministic first failure across practices.

Final gate: `npm run check`, with `npm_config_cache` pointing at a temporary
directory. It includes all tests, the packed-package initialization smoke test,
and roadmap/render/inbox guards. Its result belongs in the commit body.

## Owner's machine measurements

Node v24.21.0, same machine, no competing test runs, warm filesystem caches.
Base is an archive of a31ae55. Both versions inspect the same working project;
14 practices and 63 templates. Run base/final/final/base. Each process warms
10 calls, then measures seven batches of 30 calls; report each run's median
batch mean in milliseconds. All four processes exited 0.

| Operation | Base 1 | Final 1 | Final 2 | Base 2 |
| --- | ---: | ---: | ---: | ---: |
| load | 4.329 | 1.684 | 1.816 | 4.344 |
| render check, supplied practices (control) | 3.361 | 3.313 | 3.354 | 3.295 |
| render check, including load | 7.942 | 5.002 | 5.119 | 7.791 |

Averaging each pair of run medians gives 4.34 → 1.75 ms for loading
(60% less time) and 7.87 → 5.06 ms for render including load (36% less).
The unchanged render control is essentially flat. These are local warm-read
measurements, not fleet or cold-disk guarantees.

For reproduction, save the following as a temporary `.mjs` file and pass an
archived base checkout or the final checkout as its first argument, and the
same project root as its second; invoke in ABBA order outside other workloads:

```js
import { performance } from 'node:perf_hooks';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Usage: node benchmark.mjs <code-repo> [project-root]
// Both versions can inspect the same real project, without writing to it.
const code = resolve(process.argv[2] ?? process.cwd());
const root = resolve(process.argv[3] ?? code);
const { load, render } = await import(pathToFileURL(join(code, 'lib/practices.mjs')));
const practices = await load();
console.log(JSON.stringify({ code, root, node: process.version, practices: practices.size, files: [...practices.values()].reduce((n, p) => n + p.files.length, 0) }));
for (const [name, run] of [
  ['load', () => load()],
  ['render(check, supplied practices)', () => render(root, { check: true, practices })],
  ['render(check)', () => render(root, { check: true })],
]) {
  for (let i = 0; i < 10; i++) await run();
  const batches = [];
  for (let b = 0; b < 7; b++) {
    const start = performance.now();
    for (let i = 0; i < 30; i++) await run();
    batches.push((performance.now() - start) / 30);
  }
  console.log(JSON.stringify({ name, batchMeansMs: batches.map(n => +n.toFixed(3)), medianMs: +[...batches].sort((a,b) => a-b)[3].toFixed(3) }));
}

```

Fresh-process CLI checks used identical baseline docs and project inputs, with
only the retained loader patch in the final copy. Three warmup ABBA blocks,
20 measured blocks, 40 samples per command/version, Node compile cache disabled.
All processes exited 0, stderr empty, outputs stable and equal between versions.
Median help: 37.66 → 37.56 ms; agent help: 37.66 → 37.57 ms;
status JSON: 54.34 → 54.48 ms. No meaningful CLI startup change is claimed.
Additional lazy-import experiments were discarded: their small gains overlapped
noise and mixed-module loading made the dispatcher harder to understand.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Review loader diff | bounded concurrency, fresh data, stable errors | independent practices settle together; results consumed in sorted order; template validation remains sequential | preserves existing ordering; no persistent cache |
| Compare current docs with implementations | describe shipped workflows | corrected Node floor, independent CLI/practice versions, update ordering/rollback, local updates, optional provider review, goal reads and owed walks | source agreement, not a production walk |
| Review history and managed blocks | preserve ownership and dated evidence | historical design decisions and managed AGENTS blocks unchanged | no template drift introduced |
| Review agent cold start | shorter without losing command topics | tightened verb descriptions and removed unsupported install timing estimates | reduced reading, no startup speed claim |

## Gaps and decision

Supports built after the integrated gate, not production-verified or lived-in.
The package surface is covered by the actual pack/unpack/init test in that gate;
no registry release or fleet deployment is claimed. Real adoption over time and
cold-disk/other-machine performance remain unverified. Three builders handled
practice reads, CLI experiments and documentation; the conductor independently
reviewed changes, repeated benchmarks and ran focused verification.

// A synthetic Acme test for tests/stalls.test.mjs: the first time it runs it
// kills its own runner (node --test dies with no test failed, as a crash or a
// time limit would); after that it passes. keel test runs it without stalls
// first, so only that run dies. ACME_ONCE is the marker file.
import { test } from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';

if (!existsSync(process.env.ACME_ONCE)) {
  writeFileSync(process.env.ACME_ONCE, 'ran\n');
  process.kill(process.ppid, 'SIGKILL');
}

test('an anvil is ordered', () => {});

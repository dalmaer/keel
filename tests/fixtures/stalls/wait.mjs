// A synthetic Acme test for tests/fixtures/stalls/interrupt.mjs: it waits
// half a minute, so it is still running when its runner is interrupted.
import { test } from 'node:test';

test('an anvil takes its time', () => new Promise(r => setTimeout(r, 30_000)));

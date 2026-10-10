// A synthetic Acme test for tests/stalls.test.mjs, run only by it, through
// stalls.mjs's runFiles. It is not named .test.mjs, so neither the suite's
// tests/*.test.mjs nor node's own discovery runs it. Its child ticks every
// 5 ms for 800 ms of the wall clock and writes, to ACME_TICKS, when each tick
// ran. A stall of the whole process group stops the child too, so no tick
// lands inside one.
import { test } from 'node:test';
import { spawn } from 'node:child_process';

const TICKER = "const fs = require('fs'); const at = []; const end = Date.now() + 800; const i = setInterval(() => { at.push(Date.now()); if (Date.now() > end) { clearInterval(i); if (process.env.ACME_TICKS) fs.writeFileSync(process.env.ACME_TICKS, JSON.stringify(at)); } }, 5);";

test('a child ticks', async () => {
  const child = spawn(process.execPath, ['-e', TICKER], { stdio: 'inherit' });
  await new Promise((done, fail) => child.on('exit', code => (code === 0 ? done() : fail(new Error(`exit ${code}`)))));
});

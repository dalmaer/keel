// The performance persona's interaction number: the slowest of seven cold
// starts of `plates --version`, in whole milliseconds. The worst run, not the
// median: an interaction is felt at its tail. Prints one number, or fails.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const plates = fileURLToPath(new URL('../../bin/plates.mjs', import.meta.url));
const runs = [];
for (let i = 0; i < 7; i++) {
  const start = process.hrtime.bigint();
  const out = execFileSync(process.execPath, [plates, '--version'], { encoding: 'utf8' });
  runs.push(Number(process.hrtime.bigint() - start) / 1e6);
  if (!/\d+\.\d+\.\d+/.test(out)) throw new Error(`plates --version printed no version: ${out.trim()}`);
}
console.log(Math.round(Math.max(...runs)));

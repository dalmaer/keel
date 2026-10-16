// The performance persona's interaction number: the slowest of seven cold
// starts of `keel --version`, in whole milliseconds. The worst run, not the
// median: an interaction is felt at its tail. Prints one number, or fails.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const keel = fileURLToPath(new URL('../../bin/keel.mjs', import.meta.url));
const runs = [];
for (let i = 0; i < 7; i++) {
  const start = process.hrtime.bigint();
  const out = execFileSync(process.execPath, [keel, '--version'], { encoding: 'utf8' });
  runs.push(Number(process.hrtime.bigint() - start) / 1e6);
  if (!/\d+\.\d+\.\d+/.test(out)) throw new Error(`keel --version printed no version: ${out.trim()}`);
}
console.log(Math.round(Math.max(...runs)));

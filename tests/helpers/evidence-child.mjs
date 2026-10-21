// Synthetic Acme process tree: the descendant keeps inherited pipes open.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, renameSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
// Safety bounds also cover a deliberately broken executor in mutation probes.
setTimeout(() => process.exit(9), 20_000).unref();
await delay(Number(process.argv[5] ?? 0));
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 1, 2] });
child.on('error', error => { throw error; });
const cleanup = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', cleanup);
writeFileSync(`${process.argv[2]}.tmp`, JSON.stringify({ parent: process.pid, child: child.pid }));
renameSync(`${process.argv[2]}.tmp`, process.argv[2]);
console.log(12);
if (process.argv[3] === 'wait') setInterval(() => {}, 1000);
else {
  while (!existsSync(process.argv[4])) await delay(20);
  // The ordinary exiting parent intentionally leaves the descendant alive:
  // production process-group cleanup, not fixture teardown, must stop it.
  process.off('exit', cleanup);
  process.exit(0);
}

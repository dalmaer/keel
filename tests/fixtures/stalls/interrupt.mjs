// A driver for tests/stalls.test.mjs: it runs ./wait.mjs under stalls, one
// 200 ms in that lasts a minute, and once its runner is stopped, prints the
// runner's pid (its process group's id) and sends itself ACME_SIGNAL, as a
// person's ^C or a CI cancel would. A runner left stopped is the bug.
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFiles } from '../../../practices/night/files/scripts/keel/stalls.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shape = { firstMs: [200, 200], gapMs: [60_000, 60_000], stallMs: [60_000, 60_000] };
runFiles({ files: ['wait.mjs'], cwd: here, seed: 1, shape });

/** The runner: this process's child, and the state ps gives it. */
const runner = () => {
  const ps = spawnSync('ps', ['-o', 'pid=,ppid=,stat=', '-ax'], { encoding: 'utf8' }).stdout ?? '';
  const line = ps.split('\n').map(l => l.trim().split(/\s+/)).find(([, ppid]) => Number(ppid) === process.pid);
  return line ? { pid: Number(line[0]), stat: line[2] } : null;
};

const started = Date.now();
const poll = setInterval(() => {
  const r = runner();
  if (r?.stat.includes('T')) {
    clearInterval(poll);
    console.log(r.pid);
    process.kill(process.pid, process.env.ACME_SIGNAL);
  } else if (Date.now() - started > 20_000) {
    clearInterval(poll);
    console.log('never stopped');
    process.exit(3);
  }
}, 20);

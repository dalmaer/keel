import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { cleanEnv, run } from './run.mjs';

export async function waitFor(predicate, message, milliseconds = 10_000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await sleep(20);
  }
  throw new Error(message);
}

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Synthetic npm executable exercises the production fixed argv/process-group path.
export async function workerFixture(t, behavior = 'success') {
  const cwd = await mkdtemp(join(tmpdir(), 'acme-web-worker-'));
  const events = join(cwd, 'events.jsonl');
  const pids = join(cwd, 'pids.json');
  const child = join(cwd, 'descendant.mjs');
  await writeFile(child, `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(pids)}, JSON.stringify({parent: process.ppid, child:process.pid}));
setInterval(() => {}, 60000);
`);
  await writeFile(join(cwd, 'npm'), `#!${process.execPath}
import { appendFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
appendFileSync(${JSON.stringify(events)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (${JSON.stringify(behavior)} === 'success') process.exit(0);
if (${JSON.stringify(behavior)} === 'failure') process.exit(7);
const descendant = spawn(process.execPath, [${JSON.stringify(child)}], {stdio:'inherit'});
if (${JSON.stringify(behavior)} === 'parent-exit') {
  const timer = setInterval(() => { if (existsSync(${JSON.stringify(pids)})) { clearInterval(timer); process.exit(0); } }, 10);
} else setInterval(() => {}, 60000);
`);
  await writeFile(join(cwd, 'package.json'), '{"type":"module"}\n');
  await chmod(join(cwd, 'npm'), 0o700);
  for (const args of [['init', '-q'], ['add', '.'], ['commit', '-qm', 'Acme worker fixture']]) {
    const result = run('git', args, { cwd });
    if (result.status !== 0) throw new Error(`Acme fixture git failed: ${result.stderr}`);
  }
  const revision = run('git', ['rev-parse', 'HEAD'], { cwd }).stdout.trim();
  t.after(async () => {
    try {
      const value = JSON.parse(await readFile(pids, 'utf8'));
      for (const pid of [value.parent, value.child]) try { process.kill(pid, 'SIGKILL'); } catch {}
    } catch {}
    await rm(cwd, { recursive: true, force: true });
  });
  return {
    cwd, revision, env: cleanEnv({ ...process.env, PATH: `${cwd}:${process.env.PATH}` }),
    events: async () => {
      try { return (await readFile(events, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
      catch { return []; }
    },
    ready: () => waitFor(async () => {
      try { return JSON.parse(await readFile(pids, 'utf8')); } catch { return null; }
    }, 'Acme worker descendant did not become ready'),
  };
}

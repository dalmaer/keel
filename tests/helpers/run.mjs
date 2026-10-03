// The one way a test runs node or npm: with the test runner's own context
// stripped. node --test sets NODE_TEST_CONTEXT for its children; a project's
// `node --test` that inherits it skips every file and exits 0, so a spawned
// gate would pass measuring nothing (lessons 4 and 6). tests/helpers.test.mjs
// fails when a test spawns node or npm any other way.
import { spawnSync } from 'node:child_process';

/** process.env (or `env`) without any NODE_TEST_* variable. */
export function cleanEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('NODE_TEST_')));
}

/** Spawn `cmd` (use process.execPath for node) and return { status, stdout, stderr }. */
export function run(cmd, args = [], { cwd, env, input, timeout } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, timeout, encoding: 'utf8', env: cleanEnv(env ?? process.env), maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** How many tests a node --test run reported, from its summary line (0 if none). */
export const testsRan = output => Number(/^(?:ℹ|#) tests (\d+)$/m.exec(output)?.[1] ?? 0);

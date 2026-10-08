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

/** keel's verbs that read GitHub through gh: a test runs them only with KEEL_GH set (a stub, or a path that fails). */
export const GH_VERBS = ['fleet', 'lessons', 'learn', 'loose-ends', 'review', 'board'];

/** Spawn `cmd` (use process.execPath for node) and return { status, stdout, stderr }. */
export function run(cmd, args = [], { cwd, env, input, timeout } = {}) {
  // No keel test reads the live world: a test that does goes red when the world changes (lesson 17).
  if (/(^|[/\\])bin[/\\]keel\.mjs$/.test(String(args[0] ?? '')) && GH_VERBS.includes(args[1]) && !(env ?? process.env).KEEL_GH) {
    throw new Error(`keel ${args[1]} reads GitHub: run it with KEEL_GH set (a stub gh), never the real gh`);
  }
  if (/(^|[/\\])bin[/\\]keel\.mjs$/.test(String(args[0] ?? '')) && args[1] === 'canvas') {
    if (args.includes('--github') && !(env ?? process.env).KEEL_GH) {
      throw new Error('keel canvas --github reads GitHub: run it with KEEL_GH set (a stub gh), never the real gh');
    }
    if (['connect', 'sync', 'status', 'disconnect', 'night'].includes(args[2]) && !(env ?? process.env).KEEL_ISOCAN) {
      throw new Error('keel canvas remote verbs require KEEL_ISOCAN set (a fake executable), never live isocan');
    }
  }
  // keel review records what it read (a receipt) in keel's cache: a test points it at a temp dir, never the developer's.
  if (/(^|[/\\])bin[/\\]keel\.mjs$/.test(String(args[0] ?? '')) && args[1] === 'review' && !(env ?? process.env).KEEL_CACHE) {
    throw new Error('keel review writes a read receipt: run it with KEEL_CACHE set (a temp dir), never the real cache');
  }
  if (args.includes('--github') && (/(^|[/\\])reconcile\.mjs$/.test(String(args[0] ?? '')) || args[1] === 'doctor') && !(env ?? process.env).KEEL_GH) {
    throw new Error('remote reconciliation reads GitHub: run it with KEEL_GH set (a stub gh), never the real gh');
  }
  // loose-ends and retro read the developer's own Claude Code transcripts unless told where else to look.
  if (/(^|[/\\])bin[/\\]keel\.mjs$/.test(String(args[0] ?? '')) && ['loose-ends', 'retro'].includes(args[1]) && !(env ?? process.env).KEEL_CLAUDE_DIR) {
    throw new Error(`keel ${args[1]} reads transcripts: run it with KEEL_CLAUDE_DIR set (synthetic ones), never ~/.claude`);
  }
  const r = spawnSync(cmd, args, { cwd, input, timeout, encoding: 'utf8', env: cleanEnv(env ?? process.env), maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** How many tests a node --test run reported, from its summary line (0 if none). */
export const testsRan = output => Number(/^(?:ℹ|#) tests (\d+)$/m.exec(output)?.[1] ?? 0);

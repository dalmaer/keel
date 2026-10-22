// Source-only feedback preflight. This never substitutes for the required full gate.
import { spawnSync } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REQUIRED_CONVENTIONS = Object.freeze([
  'tests/helpers.test.mjs',
  'tests/docs.test.mjs',
  'tests/guides.test.mjs',
  'tests/cli.test.mjs',
  'tests/adopt.test.mjs',
  'tests/skill.test.mjs',
  'tests/guide-consumers.test.mjs',
  'tests/web-operation-coverage.test.mjs',
  'tests/check-focused.test.mjs',
]);
const PATH = /^tests\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.test\.mjs$/;
const usage = 'Usage: node scripts/check-focused.mjs [--plan] [--json] [tests/name.test.mjs ...]\nRuns required source conventions plus explicit focused tests, then roadmap, render, inbox and whitespace checks.\nThis is early feedback only; the mandatory integrated gate remains unchanged.';

/** Explicit argv only: no glob expansion, shell, inferred dependency map or gate eligibility. */
export async function focusedPlan(paths, root = ROOT) {
  if (!Array.isArray(paths) || paths.length > 64 || paths.some(p => typeof p !== 'string' || p.length > 240 || !PATH.test(p))) throw new Error('pass at most 64 explicit tests/*.test.mjs paths; flags, globs and traversal are not tests');
  const cwd = await realpath(root);
  const tests = [...new Set([...REQUIRED_CONVENTIONS, ...paths])];
  for (const path of tests) {
    const absolute = resolve(cwd, path);
    let actual;
    try { actual = await realpath(absolute); }
    catch { throw new Error(`test file is unavailable: ${path}`); }
    if (actual !== absolute || !(await stat(actual)).isFile()) throw new Error(`test path must be a regular file without symlinks: ${path}`);
  }
  return {
    schema: 1, authority: 'feedback-only', cwd, tests,
    stages: [
      { id: 'focused-and-conventions', command: process.execPath, args: ['--import', './tests/helpers/hermetic.mjs', '--test', '--test-concurrency=2', ...tests], timeout: 900000 },
      { id: 'roadmap', command: 'npm', args: ['run', 'roadmap:check'], timeout: 120000 },
      { id: 'render', command: 'npm', args: ['run', 'render:check'], timeout: 120000 },
      { id: 'inbox', command: 'npm', args: ['run', 'inbox:check'], timeout: 120000 },
      { id: 'whitespace', command: 'git', args: ['-c', 'core.fsmonitor=false', 'diff', '--check'], timeout: 120000 },
    ],
  };
}

/** Run in order and stop on failure. Tests can inject an executor to inspect argv. */
export function runFocusedPlan(plan, { execute = spawnSync, json = false } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST_')));
  const results = [];
  for (const stage of plan.stages) {
    if (!json) console.log(`Focused preflight: ${stage.id}`);
    const start = performance.now();
    const result = execute(stage.command, stage.args, { cwd: plan.cwd, env, shell: false, timeout: stage.timeout, stdio: json ? 'pipe' : 'inherit', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const status = !result.error && Number.isInteger(result.status) && result.status >= 0 ? result.status : 1;
    results.push({ id: stage.id, status, signal: result.signal ?? null, executionError: result.error?.code ?? null, wallMs: performance.now() - start, ...(json ? { stdout: result.stdout ?? '', stderr: result.stderr ?? '' } : {}) });
    if (status !== 0) return { schema: 1, authority: 'feedback-only', status, stages: results };
  }
  return { schema: 1, authority: 'feedback-only', status: 0, stages: results };
}

async function main(args) {
  const json = args.includes('--json');
  try {
    if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
    const flags = new Set(), paths = [];
    for (const arg of args) {
      if (arg.startsWith('--')) {
        if (!['--plan', '--json'].includes(arg) || flags.has(arg)) throw new Error('invalid arguments; use --help');
        flags.add(arg);
      } else paths.push(arg);
    }
    const plan = await focusedPlan(paths);
    if (flags.has('--plan')) {
      console.log(json ? JSON.stringify(plan, null, 2) : [usage, ...plan.stages.map(s => `${s.id}: ${JSON.stringify([s.command, ...s.args])}`)].join('\n'));
      return;
    }
    const report = runFocusedPlan(plan, { json });
    if (json) console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status;
  } catch (error) {
    const message = error.code ? 'cannot inspect the source checkout' : error.message;
    console.error(json ? JSON.stringify({ schema: 1, error: message }) : `check-focused: ${message}`);
    process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

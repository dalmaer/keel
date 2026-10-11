import { milestoneSource } from '../roadmap.mjs';
// keel's generated-file check (keel practice `phases`; managed: keel render
// rewrites it). keel's lesson 52: a file declared generated is only a view
// while its generator rewrites it whole. A generator that appends, or keeps
// lines it did not write, leaves a hand edit standing in a file everybody is
// told never to edit. tests/keel-generated.test.mjs copies the project to a
// temporary directory, appends a marker line to each generated file, runs that
// file's generator, and fails if the marker survives.
//
// GENERATORS is the one list: each generated file, the practice that makes
// it, and the command that writes it, run with node from the project's root.
// keel-only entries (`self`) are files keel itself generates with code a
// project does not have. docs/keel-lessons.md is a managed file keel renders
// into a project, so a project has no generator of its own for it; on keel,
// its renderer is probed, and a managed file is the one case where the marker
// stays: keel never overwrites a project's edit (drift is signal), so the
// renderer must refuse, exit non-zero and name the file (`refuses`). A
// renderer that kept the edit silently, or overwrote it, fails the same.
//
// Zero dependencies. Generators run with the test runner's NODE_TEST_*
// variables stripped, so a generator that runs tests runs them.
import { readFile, appendFile, mkdtemp, cp, rm, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';

export const GENERATORS = Object.freeze([
  { path: 'docs/ROADMAP.md', practice: 'phases', args: ['scripts/roadmap.mjs'] },
  { path: 'docs/LOOP.md', practice: 'loop', args: ['scripts/loop.mjs', 'render'] },
  { path: 'docs/keel-lessons.md', practice: 'lessons', self: true, refuses: true, args: ['scripts/render.mjs', '--self'] },
  { path: 'docs/patterns.md', self: true, args: ['--input-type=module', '-e', "await (await import('./lib/distill.mjs')).renderLocal('.')"] },
  { path: 'docs/INBOX.md', self: true, args: ['--input-type=module', '-e', "await (await import('./lib/distill.mjs')).renderLocal('.')"] },
].map(Object.freeze));

/** The generated files this project declares, from its .keel/keel.json: GENERATORS filtered. */
export function generatedFiles(config, list = GENERATORS) {
  const milestones = milestoneSource(config);
  const on = new Set(config?.practices ?? []);
  const self = config?.keel === 'self';
  // The local roadmap and Loop triage page are inactive archives when GitHub owns the plan.
  return list.filter(g => (!g.self || self) && (!g.practice || on.has(g.practice))
    && !(['docs/ROADMAP.md', 'docs/LOOP.md'].includes(g.path) && milestones));
}

/** Never copied: git's own directory, installed packages, and the test ledger's runs. */
const SKIP = new Set(['.git', 'node_modules']);
function copySource(root, src) {
  const path = relative(root, src).split(sep).join('/');
  // Nested fixture projects have their own rotating ledgers too. Exclude the
  // directory before cp enumerates it, not individual files after rotation.
  return !SKIP.has(path) && path !== '.keel/test-runs' && !path.endsWith('/.keel/test-runs');
}

const env = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST_')));

/**
 * One generator probed: copy root, append a marker line to g.path, run the
 * generator in the copy. Returns null when the marker is gone (for a
 * `refuses` entry: when the generator refused, naming the file, and kept the
 * edit), else the problem.
 */
export async function probe(root, g) {
  const tmp = await mkdtemp(join(tmpdir(), 'keel-generated-'));
  const dir = join(tmp, 'project');
  try {
    await cp(root, dir, { recursive: true, verbatimSymlinks: true, filter: src => copySource(root, src) });
    const file = join(dir, g.path);
    const marker = `<!-- keel generated-file probe ${Date.now().toString(36)}${Math.random().toString(36).slice(2)}: a hand edit, which the generator must not keep -->`;
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `\n${marker}\n`);
    const r = spawnSync(process.execPath, g.args, { cwd: dir, env: env(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60_000 });
    const command = `node ${g.args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
    const said = `${r.stderr ?? ''}${r.stdout ?? ''}`;
    if (g.refuses) {
      const kept = (await readFile(file, 'utf8').catch(() => '')).includes(marker);
      if (r.error) return `${g.path}: its renderer \`${command}\` did not run (${r.error.message})`;
      if (!kept) return `${g.path}: \`${command}\` overwrote a line appended to it; a managed file's edit is refused and named, never overwritten`;
      if (r.status === 0 || !said.includes(g.path)) return `${g.path}: \`${command}\` kept a line appended to it without refusing and naming the file (exit ${r.status})`;
      return null;
    }
    if (r.error || r.status !== 0) return `${g.path}: its generator \`${command}\` failed (${r.error?.message ?? `exit ${r.status}`}): ${said.trim().split('\n').slice(-3).join(' | ')}`;
    const after = await readFile(file, 'utf8').catch(() => '');
    return after.includes(marker) ? `${g.path}: a line appended to it survived \`${command}\`; its generator must rewrite it whole` : null;
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

/** Every generated file under root probed: [problem]. */
export async function survivors(root, list) {
  const out = [];
  for (const g of list) { const p = await probe(root, g); if (p) out.push(p); }
  return out;
}

/** The project's .keel/keel.json, or {} when it has none. */
export async function projectConfig(root) {
  try { return JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8')); } catch { return {}; }
}

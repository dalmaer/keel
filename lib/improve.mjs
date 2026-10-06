// keel improve: is the practice working here? (design §6, "The night shift").
//
// The measures ship into each project as the night practice's managed
// scripts/keel/improve.mjs, so a project's night runs from its own checkout
// (design §6, "Projects run on their own"). This verb is that same module,
// handed keel's instruments: its roadmap parser, its doctor (three hashes:
// now, lock, template, and every lint) and the inbox. A project's own copy
// reads what its files can say and calls the rest keel-side; render --check
// fails when keel's rendered copy drifts from the source.
//
// --selftest runs every measure on tests/fixtures/improve/unhealthy, a project
// built to be outside every bound (with a projects-shaped part, docs/projects,
// for the record measures), and fails unless every measure is outside.
// It is keel-side: the fixture lives here. The fixture is keel's home; a
// measure marked projectOnly reads it without `"keel": "self"`.
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shipped from '../practices/night/files/scripts/keel/improve.mjs';
import { collect, run, DONE, parsePhase, specProblems } from '../practices/phases/files/scripts/roadmap.mjs';
import { diagnose } from './doctor.mjs';
import { proposals } from './learn.mjs';

export {
  BOUNDS, HEALTH, STUCK_DAYS, SEND_LESSONS, MACHINE_PREFIXES, MACHINE_BOUNDS, PROJECT_LINTS, ImproveError, MEASURES,
  segmentKind, commandKind, conductCost, proposalText, propose, readBounds, tighten, page, exitCode, table, strip,
} from '../practices/night/files/scripts/keel/improve.mjs';

const { table, strip } = shipped;
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE = join(CLI_ROOT, 'tests', 'fixtures', 'improve');

/** What keel can read that a project alone cannot. */
export const instruments = Object.freeze({
  roadmap: { collect, run, DONE, parsePhase, specProblems },
  diagnose: root => diagnose(root),
  proposals,
  reconcile: async opts => (await import('../practices/reconciliation/files/scripts/keel/reconcile.mjs')).reconcile(opts),
});

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const measure = opts => shipped.measure({ keel: instruments, ...opts });
export const improve = (opts, deps = {}) => shipped.improve(opts, { keel: instruments, by: 'keel improve', ...deps });

/** --selftest: every measure, run on a project built to fail them all, must report outside. */
export async function selftest({ env = process.env, measures = shipped.MEASURES, fixture = FIXTURE } = {}) {
  const root = join(fixture, 'unhealthy');
  const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  // git too: the fixture sits inside keel's repo, whose history is not the fixture's.
  const stub = { ...env, KEEL_GH: join(fixture, 'bin', 'gh'), KEEL_NPM: join(fixture, 'bin', 'npm'), KEEL_GIT: join(fixture, 'bin', 'git') };
  const opts = { root, env: stub, transcripts: join(fixture, 'transcripts'), date: today() };
  // The fixture is keel's home (inbox_waiting is keel only); a project-only
  // measure (lessons_unsent: keel is home) reads it as the project it would be.
  const { keel: _home, ...asProject } = config;
  const home = await measure({ ...opts, config, measures: measures.filter(m => !m.projectOnly) });
  const away = await measure({ ...opts, config: asProject, measures: measures.filter(m => m.projectOnly) });
  const results = measures.map(m => (m.projectOnly ? away : home).find(r => r.id === m.id));
  const missed = results.filter(r => r.state !== 'outside');
  return {
    data: { ok: !missed.length, fixture: root, measures: strip(results), missed: missed.map(r => ({ id: r.id, state: r.state, detail: r.detail })) },
    text: [table(results), '', missed.length
      ? `selftest FAILED: ${missed.map(r => `${r.id} is ${r.state}`).join(', ')} on a project built to be outside every bound. The grader cannot be believed (lesson 6).`
      : `selftest ok: all ${results.length} measures report outside on the unhealthy fixture.`].join('\n'),
    exitCode: missed.length ? 1 : 0,
  };
}

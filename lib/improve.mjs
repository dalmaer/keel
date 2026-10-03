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
// built to be outside every bound, and fails unless every measure is outside.
// It is keel-side: the fixture lives here.
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shipped from '../practices/night/files/scripts/keel/improve.mjs';
import { collect, run, DONE, parsePhase } from '../practices/phases/files/scripts/roadmap.mjs';
import { diagnose } from './doctor.mjs';
import { proposals } from './learn.mjs';

export {
  BOUNDS, HEALTH, STUCK_DAYS, MACHINE_PREFIXES, MACHINE_BOUNDS, PROJECT_LINTS, ImproveError, MEASURES,
  segmentKind, commandKind, conductCost, proposalText, propose, readBounds, tighten, page, exitCode, table, strip,
} from '../practices/night/files/scripts/keel/improve.mjs';

const { table, strip } = shipped;
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE = join(CLI_ROOT, 'tests', 'fixtures', 'improve');

/** What keel can read that a project alone cannot. */
export const instruments = Object.freeze({
  roadmap: { collect, run, DONE, parsePhase },
  diagnose: root => diagnose(root),
  proposals,
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
  const stub = { ...env, KEEL_GH: join(fixture, 'bin', 'gh'), KEEL_NPM: join(fixture, 'bin', 'npm') };
  const results = await measure({ root, config, env: stub, transcripts: join(fixture, 'transcripts'), date: today(), measures });
  const missed = results.filter(r => r.state !== 'outside');
  return {
    data: { ok: !missed.length, fixture: root, measures: strip(results), missed: missed.map(r => ({ id: r.id, state: r.state, detail: r.detail })) },
    text: [table(results), '', missed.length
      ? `selftest FAILED: ${missed.map(r => `${r.id} is ${r.state}`).join(', ')} on a project built to be outside every bound. The grader cannot be believed (lesson 6).`
      : `selftest ok: all ${results.length} measures report outside on the unhealthy fixture.`].join('\n'),
    exitCode: missed.length ? 1 : 0,
  };
}

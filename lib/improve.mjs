// plates improve: is the practice working here? (design §6, "The night shift").
//
// The measures ship into each project as the night practice's managed
// scripts/plates/improve.mjs, so a project's night runs from its own checkout
// (design §6, "Projects run on their own"). This verb is that same module,
// handed plates's instruments: its roadmap parser, its doctor (three hashes:
// now, lock, template, and every lint) and the inbox. A project's own copy
// reads what its files can say and calls the rest plates-side; render --check
// fails when plates's rendered copy drifts from the source.
//
// --selftest runs every measure on tests/fixtures/improve/unhealthy, a project
// built to be outside every bound (with a projects-shaped part, docs/projects,
// for the record measures), and fails unless every measure is outside.
// It is plates-side: the fixture lives here. The fixture is plates's home; a
// measure marked projectOnly reads it without `"plates": "self"`.
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shipped from '../practices/night/files/scripts/plates/improve.mjs';
import { collect, run, DONE, parsePhase, specProblems } from '../practices/phases/files/scripts/roadmap.mjs';
import { diagnose } from './doctor.mjs';
import { proposals } from './learn.mjs';

export {
  BOUNDS, HEALTH, STUCK_DAYS, SEND_LESSONS, MACHINE_PREFIXES, MACHINE_BOUNDS, PROJECT_LINTS, ImproveError, MEASURES,
  segmentKind, commandKind, conductCost, proposalText, propose, readBounds, tighten, page, exitCode, table, strip,
} from '../practices/night/files/scripts/plates/improve.mjs';

const { table, strip } = shipped;
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE = join(CLI_ROOT, 'tests', 'fixtures', 'improve');

/** What plates can read that a project alone cannot. */
export const instruments = Object.freeze({
  roadmap: { collect, run, DONE, parsePhase, specProblems },
  diagnose: root => diagnose(root),
  proposals,
  staleWorktrees: async opts => (await import('./worktree-hygiene.mjs')).staleWorktrees(opts),
  localWorkarounds: async opts => (await import('./time.mjs')).workedAround(opts),
  reconcile: async opts => (await import('../practices/reconciliation/files/scripts/plates/reconcile.mjs')).reconcile(opts),
});

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const measure = opts => shipped.measure({ plates: instruments, ...opts });
export const improve = (opts, deps = {}) => shipped.improve(opts, { plates: instruments, by: 'plates improve', ...deps });

/** --selftest: every measure, run on a project built to fail them all, must report outside. */
export async function selftest({ env = process.env, measures = shipped.MEASURES, fixture = FIXTURE } = {}) {
  const root = join(fixture, 'unhealthy');
  const config = JSON.parse(await readFile(join(root, '.plates', 'plates.json'), 'utf8'));
  // git too: the fixture sits inside plates's repo, whose history is not the fixture's.
  const stub = { ...env, PLATES_GH: join(fixture, 'bin', 'gh'), PLATES_NPM: join(fixture, 'bin', 'npm'), PLATES_GIT: join(fixture, 'bin', 'git') };
  const now=Date.now();
  const {timeEvidence}=await import('../tests/fixtures/improve/time-evidence.mjs');
  const {hygieneFixture} = await import('../tests/fixtures/improve/hygiene-evidence.mjs');
  const hygiene = await hygieneFixture({env:stub,now});
  try {
    const opts = { root, plates: {...instruments,...hygiene.instruments}, env: {...hygiene.env,CI:''}, transcripts: join(fixture, 'transcripts'), date: today(), now, timeEvidence:timeEvidence(now) };
    // The fixture is plates's home (inbox_waiting is plates only); a project-only
    // measure (lessons_unsent: plates is home) reads it as the project it would be.
    const { plates: _home, ...asProject } = config;
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
  } finally { await hygiene.close(); }
}

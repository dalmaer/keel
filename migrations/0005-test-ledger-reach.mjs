// 0005: the test ledger reaches every test the project runs, and every test
// keel ships is run (a review of the 0.8.0 update PRs). Three things, each
// only while it is owed, in the project's update PR where a person reviews it:
//
//   - A workspace's or app folder's own `scripts.test` (the folders
//     lib/stacks.mjs packageDirs reads: web/, app/, client/, frontend/, and
//     the root package.json's workspaces) gains the ledger's reporters when it
//     is node's runner, exactly as 0004 wired the root's. The reporter path is
//     relative to that folder (`../scripts/keel/test-ledger.mjs`); the
//     reporter finds the repo's root with git, so the runs land in the root's
//     .keel/test-runs. Any other runner is never touched.
//   - The root's `scripts.test`, when it is node's runner and names paths that
//     do not match a test keel ships (tests/keel-generated.test.mjs with
//     phases, tests/keel-workflows.test.mjs with ci, tests/roadmap.test.mjs
//     with phases), gains those paths at its end. A script that names no path
//     runs node's default, which matches them: untouched.
//   - With the night on and ci off, the project's own CI keeps no test runs,
//     and keel never edits a project's own workflows: notes() prints the step
//     to add, in the update's commit and PR. Once a workflow of the project's
//     uploads keel-test-runs, it is not owed.
//
// Idempotent: once every edit is made and the step is there, applies() is false.
import { withLedger } from './0004-test-ledger.mjs';
import { packageDirs } from '../lib/stacks.mjs';
import { expandGate, runsTest } from '../lib/doctor.mjs';

export const id = '0005-test-ledger-reach';
export const to = '0.8.0';
export const summary = 'workspace and app folders\' node test scripts gain the test ledger reporter (their runs land in the root\'s .keel/test-runs); a node test script that misses a test keel ships gains its path; with ci off, the update says how to keep CI\'s test runs';

/** The tests each practice ships for the project's gate to run. */
export const SHIPPED = Object.freeze({ phases: ['tests/roadmap.test.mjs', 'tests/keel-generated.test.mjs'], ci: ['tests/keel-workflows.test.mjs'] });

/** The step a project's own CI adds after its tests, so the night reads CI's runs (the ci practice's check.yml carries it). */
export const UPLOAD_STEP = [
  '- if: always()',
  '  uses: actions/upload-artifact@v7',
  '  with: { name: keel-test-runs, path: .keel/test-runs/, include-hidden-files: true, if-no-files-found: ignore, retention-days: 30 }',
].join('\n');

const on = (config, name) => (config?.practices ?? []).includes(name)
  && !(name === 'phases' && config.phases?.source === 'milestones');

async function json(project, path) {
  const raw = await project.read(path);
  if (raw === null) return null;
  try { return { raw, pkg: JSON.parse(raw) }; } catch { return null; } // not ours to repair
}

/** `raw` with scripts.test set to `next`, the file's layout kept where the old string is found (as 0004). */
function setTest(raw, pkg, next) {
  const old = JSON.stringify(pkg.scripts.test);
  for (const m of raw.matchAll(/("test"\s*:\s*)/g)) {
    const from = m.index + m[0].length;
    if (raw.startsWith(old, from)) {
      const content = raw.slice(0, from) + JSON.stringify(next) + raw.slice(from + old.length);
      if (JSON.parse(content).scripts?.test === next) return content;
    }
  }
  return `${JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, test: next } }, null, 2)}\n`;
}

/** The workspace and app folders' package.json edits: [{ path, content }]. */
async function workspaceEdits(project) {
  const root = await json(project, 'package.json');
  const dirs = await packageDirs(root?.pkg, dir => project.list(dir));
  const out = [];
  for (const dir of dirs) {
    const path = `${dir}/package.json`;
    const p = await json(project, path);
    if (!p) continue;
    const ledger = `${'../'.repeat(dir.split('/').length)}scripts/keel/test-ledger.mjs`;
    const next = withLedger(p.pkg?.scripts?.test, ledger);
    if (next) out.push({ path, content: setTest(p.raw, p.pkg, next) });
  }
  return out;
}

/** The shipped tests the root's node test script misses, and its edit; null when none is owed. */
async function shippedEdit(project) {
  const config = project.config;
  const want = [];
  for (const [practice, paths] of Object.entries(SHIPPED)) {
    if (!on(config, practice)) continue;
    // Whether on disk yet or not: update renders a practice's managed files after the migrations.
    for (const path of paths) if (!(config.ejected ?? []).includes(path)) want.push(path);
  }
  if (!want.length) return null;
  const p = await json(project, 'package.json');
  const script = p?.pkg?.scripts?.test;
  if (typeof script !== 'string' || !/^node\s/.test(script.trim()) || /[&|;]/.test(script)) return null; // node's runner alone, nothing chained
  const gate = expandGate(config.check ?? 'npm run check', p.pkg.scripts ?? {});
  const missing = want.filter(path => runsTest(script, path) === false && runsTest(gate, path) !== true);
  if (!missing.length) return null;
  return { path: 'package.json', content: setTest(p.raw, p.pkg, `${script.trimEnd()} ${missing.join(' ')}`), missing };
}

/** Whether a workflow of the project's own (not keel's nights) keeps keel-test-runs. */
async function ciKeepsRuns(project) {
  for (const name of await project.list('.github/workflows')) {
    if (!/\.ya?ml$/.test(name) || /^keel-/.test(name)) continue;
    if ((await project.read(`.github/workflows/${name}`))?.includes('keel-test-runs')) return true;
  }
  return false;
}

const stepOwed = async project => on(project.config, 'night') && !on(project.config, 'ci') && !(await ciKeepsRuns(project));

export async function applies(project) {
  if (!on(project.config, 'night') && !on(project.config, 'phases') && !on(project.config, 'ci')) return false;
  if (on(project.config, 'night') && (await workspaceEdits(project)).length) return true;
  if (await shippedEdit(project)) return true;
  return stepOwed(project);
}

export async function notes(project) {
  if (!(await stepOwed(project))) return [];
  return [[
    "your CI does not keep the test ledger's runs, so the night reads its own alone (its flaky and slower measures say \"nightly runs only\"). keel never edits your workflows: add this step to the job that runs your tests, after them:",
    '```yaml',
    UPLOAD_STEP,
    '```',
  ].join('\n')];
}

export async function up(project) {
  const edits = on(project.config, 'night') ? await workspaceEdits(project) : [];
  const shipped = await shippedEdit(project);
  if (shipped) edits.push({ path: shipped.path, content: shipped.content });
  return edits;
}

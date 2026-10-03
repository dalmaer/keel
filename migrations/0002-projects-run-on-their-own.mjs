// 0002: projects run on their own (design §6; phase 15). A project's
// workflows never reach back to keel at runtime, so the weekly
// keel-update.yml, which cloned keel with a KEEL_TOKEN to open the update PR,
// is retired: `keel fleet update`, run from keel with the owner's gh login,
// opens that PR instead.
//
// It applies while .github/workflows/keel-update.yml is still recorded in
// .keel/lock.json (keel wrote it). Then:
//   - the file's bytes are what keel wrote → it is deleted;
//   - the project edited it → it is left, as the project's own, and keel no
//     longer manages it;
//   - either way its lock entry goes.
// The rest of the night practice (keel-night.yml and scripts/keel/) is
// rendered by update as usual, after this runs. A migration cannot touch a
// repo's secrets: the owner may delete a KEEL_TOKEN secret by hand.
import { formatLock, sha256 } from '../lib/lock.mjs';

export const id = '0002-projects-run-on-their-own';
export const to = '0.3.0';
export const summary = 'keel-update.yml is retired (keel fleet update opens update PRs from keel now): deleted where keel\'s bytes stand, left as the project\'s own where it was edited; a KEEL_TOKEN secret is no longer used and the owner may delete it';

export const WORKFLOW = '.github/workflows/keel-update.yml';
const LOCK = '.keel/lock.json';

async function lockOf(project) {
  const text = await project.read(LOCK);
  if (text === null) return null;
  const lock = JSON.parse(text);
  return lock && typeof lock.files === 'object' ? lock : null;
}

export async function applies(project) {
  return Boolean((await lockOf(project))?.files?.[WORKFLOW]);
}

/** What 0002 does here: 'delete' (keel's bytes) or 'keep' (the project edited it, or it is gone). */
export async function decision(project) {
  const lock = await lockOf(project);
  const text = await project.read(WORKFLOW);
  return text !== null && sha256(text) === lock?.files?.[WORKFLOW]?.sha256 ? 'delete' : 'keep';
}

export async function up(project) {
  const lock = await lockOf(project);
  const edits = [];
  if (await decision(project) === 'delete') edits.push({ path: WORKFLOW, content: null });
  const files = { ...lock.files };
  delete files[WORKFLOW];
  edits.push({ path: LOCK, content: formatLock({ ...lock, files }) });
  return edits;
}

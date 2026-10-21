// 0002: projects run on their own (design §6; phase 15). A project's
// workflows never reach back to plates at runtime, so the weekly
// plates-update.yml, which cloned plates with a PLATES_TOKEN to open the update PR,
// is retired: `plates fleet update`, run from plates with the owner's gh login,
// opens that PR instead.
//
// It applies while .github/workflows/plates-update.yml is still recorded in
// .plates/lock.json (plates wrote it). Then:
//   - the file's bytes are what plates wrote → it is deleted;
//   - the project edited it → it is left, as the project's own, and plates no
//     longer manages it;
//   - either way its lock entry goes.
// The rest of the night practice (plates-night.yml and scripts/plates/) is
// rendered by update as usual, after this runs. A migration cannot touch a
// repo's secrets: the owner may delete a PLATES_TOKEN secret by hand.
import { formatLock, sha256 } from '../lib/lock.mjs';

export const id = '0002-projects-run-on-their-own';
export const to = '0.3.0';
export const summary = 'plates-update.yml is retired (plates fleet update opens update PRs from plates now): deleted where plates\'s bytes stand, left as the project\'s own where it was edited; a PLATES_TOKEN secret is no longer used and the owner may delete it';

export const WORKFLOW = '.github/workflows/plates-update.yml';
const LOCK = '.plates/lock.json';

async function lockOf(project) {
  const text = await project.read(LOCK);
  if (text === null) return null;
  const lock = JSON.parse(text);
  return lock && typeof lock.files === 'object' ? lock : null;
}

export async function applies(project) {
  return Boolean((await lockOf(project))?.files?.[WORKFLOW]);
}

/** What 0002 does here: 'delete' (plates's bytes) or 'keep' (the project edited it, or it is gone). */
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

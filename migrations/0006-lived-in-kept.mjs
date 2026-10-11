// 0006: a project that had lived-in keeps it (phase 44; Codex on cajones#53).
//
// Practice 0.8.15 made lived-in a project's choice, off unless
// .keel/keel.json says "phases": { "livedIn": true }. An update must not
// change a project's policy silently: a project whose docs require the
// planned → … → built → lived-in progression would lose it in a version bump.
// So a project updating from before 0.8.15, with keel's phases practice on
// and no livedIn of its own, gets "livedIn": true written, and the update's
// PR says so and how to drop it. A project started at 0.8.15 or later starts
// with lived-in off. A project keeping its own phases (phases local, or the
// projects shape) runs its own roadmap: untouched.
//
// Idempotent: once phases.livedIn is set either way, applies() is false.
import { compareVersions } from '../lib/migrations.mjs';

export const id = '0006-lived-in-kept';
export const to = '0.8.15';
export const summary = 'a project updating from before 0.8.15 with keel\'s phases keeps lived-in on ("phases": {"livedIn": true}); delete it to count built only';

export async function applies(project) {
  const config = project.config ?? {};
  if (config.phases?.source === 'milestones' || !(config.practices ?? []).includes('phases')) return false;
  if (config.phases !== undefined && (typeof config.phases !== 'object' || config.phases === null || Array.isArray(config.phases))) return false; // not ours to repair
  if (config.phases?.livedIn !== undefined) return false;
  const from = String(config.practice ?? '0.0.0').replace(/^v/, '');
  return compareVersions(from, '0.8.15') < 0;
}

export async function notes() {
  return ['lived-in stays on for this project ("phases": {"livedIn": true} in .keel/keel.json), as it was. Since keel 0.8.15 it is a project\'s choice: delete that line to count built only, and to stop next actions asking for lived-in.'];
}

export async function up(project) {
  const raw = await project.read('.keel/keel.json');
  const config = JSON.parse(raw);
  config.phases = { ...(config.phases ?? {}), livedIn: true };
  return [{ path: '.keel/keel.json', content: `${JSON.stringify(config, null, 2)}\n` }];
}

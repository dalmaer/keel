// plates morning: the night's brief, its send, and the plan's live canvas card
// (phase 77). The brief and the send ship into each project as the night
// practice's managed scripts/plates/morning.mjs, so a project's plates-morning
// workflow sends from its own checkout (design §6, "Projects run on their
// own"); the CLI's verb is that same module, never a copy. The card is
// plates's alone: it publishes through lib/canvas-sync.mjs, which a project's
// checkout does not carry, so plates-morning.yml's card job runs the
// owner-pinned plates CLI that `plates canvas night` already needs (phase 78),
// with the same isocan home, pins and journal recovery.
export * from '../practices/night/files/scripts/plates/morning.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { finalPlan, lastNight, linksOf, MorningError, readyByOf } from '../practices/night/files/scripts/plates/morning.mjs';
import { planSection, readPlan } from '../practices/night/files/scripts/plates/night-plan.mjs';

/** The plan's live card key (phase 50's canvas.liveKeys). */
export const PLAN_CARD = 'night-plan';

/**
 * The plan as one card, pure: { key: night-plan, title, region, source }.
 * Its bytes are the plan's alone (no clock), so an unticked plan republishes
 * as unchanged and each tick is one conditional edit.
 */
export function planCard(plan) {
  const [, , ...section] = planSection(plan);
  return {
    key: PLAN_CARD,
    title: `Tonight's plan · ${plan.date}`,
    region: 'health',
    source: [`# Tonight's plan · ${plan.date}`, '', `Ready by ${readyByOf(plan)}.`, '', ...section].join('\n').replace(/\n+$/, '\n'),
  };
}

/**
 * plates morning --card: tonight's plan (finalPlan: every place it lives, each
 * item at its furthest tick) published as the live card night-plan through
 * canvasSync. Refused unless the binding is live and lists night-plan:
 * otherwise each tick would add a new run card. A person's edit to the card
 * stops updates, as for every live card (canvas-sync records the refusal).
 * Without --yes, a preview (exit 3); --dry-run plans and writes nothing.
 */
export async function publishPlanCard({ root, date, env = process.env, now = new Date(), yes = false, dryRun = false }, deps = {}) {
  let config;
  try { config = JSON.parse(await readFile(join(root, '.plates', 'plates.json'), 'utf8')); } catch (e) { throw new MorningError(`cannot read .plates/plates.json: ${e.code ?? e.message}`); }
  const c = config?.canvas;
  if (!c || c.provider !== 'isocan') throw new MorningError('No canvas is bound: plates canvas connect first. Nothing was written.');
  if (c.mode !== 'live' || !(c.liveKeys ?? ['pulse']).includes(PLAN_CARD)) {
    throw new MorningError(`The plan card needs a live binding that lists ${PLAN_CARD}: plates canvas live --card pulse --card ${PLAN_CARD} --yes (canvas.liveKeys). Nothing was written.`);
  }
  // The night the working plan is for, when there is one; else the night that last started.
  const working = date ? null : await readPlan(root).catch(() => null);
  const night = date ?? working?.date ?? lastNight(now);
  const found = await finalPlan({ root, date: night });
  if (!found.plan) throw new MorningError(`no plan for the night of ${night}: ${found.sources.map(s => `${s.from} ${s.state}`).join('; ')}`);
  const { sync } = await import('./canvas-sync.mjs');
  const publish = () => sync({ root, cards: [planCard(found.plan)], yes, dryRun, env }, deps);
  const r = env.PLATES_CANVAS_PERSISTENCE === 'artifact-v1' ? await persisted({ root, config, env, yes, now }, publish) : await publish();
  return { ...r, data: { ...r.data, card: PLAN_CARD, date: night, from: found.from, canvas: linksOf(config).canvas } };
}

/**
 * The card's publication on a fresh CI checkout (plates-morning.yml, phase 78),
 * with the night's own persistence: the canvas journal restored from the
 * newest canvas-writing attempt (PLATES_CANVAS_RECOVERY, the night's or a
 * card's: scripts/plates/canvas-recovery.mjs chose it) before the card is
 * written, and saved after, written or not, as PLATES_CANVAS_OUTPUT/recovery.json
 * for the next writer, so the night and the card keep one journal. A state it
 * cannot establish publishes nothing (exit 1).
 */
async function persisted({ root, config, env, yes, now }, publish) {
  const { restoreJournal, saveRecovery, CARD_WORKFLOW } = await import('./canvas-night.mjs');
  const { realpath, mkdir } = await import('node:fs/promises');
  if (!env.PLATES_CANVAS_OUTPUT) throw new MorningError('PLATES_CANVAS_PERSISTENCE needs PLATES_CANVAS_OUTPUT, where the card\'s recovery is saved. Nothing was written.');
  await mkdir(env.PLATES_CANVAS_OUTPUT, { recursive: true });
  const directory = await realpath(env.PLATES_CANVAS_OUTPUT), at = await realpath(root);
  let journal;
  try { journal = await restoreJournal({ root: at, config, env, yes, now }); }
  catch { throw new MorningError('The canvas journal could not be restored (missing, unsafe or mismatched recovery state). Nothing was written to the canvas.', 1); }
  let r, failure = null;
  try { r = await publish(); } catch (e) { failure = e; }
  try { await saveRecovery(directory, at, journal.binding, journal.history, null, journal.at, env, CARD_WORKFLOW); }
  catch { throw new MorningError('The card\'s canvas recovery could not be saved; keep the local manifest for manual recovery.', 1); }
  if (failure) throw failure;
  return r;
}

/** The CLI's verb: the brief, or --send, or --card. */
export async function morning({ root, date, send, card, yes, dryRun, env = process.env, now }) {
  const m = await import('../practices/night/files/scripts/plates/morning.mjs');
  if (card) return publishPlanCard({ root, date, env, now, yes, dryRun });
  if (send) return m.send({ root, date, env, now });
  return m.brief({ root, date, env, now });
}

// keel morning: the night's brief, its send, and the plan's live canvas card
// (phase 77). The brief and the send ship into each project as the night
// practice's managed scripts/keel/morning.mjs, so a project's keel-morning
// workflow sends from its own checkout (design §6, "Projects run on their
// own"); the CLI's verb is that same module, never a copy. The card is
// keel's alone: it publishes through lib/canvas-sync.mjs, which a project's
// workflow does not carry.
export * from '../practices/night/files/scripts/keel/morning.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { finalPlan, lastNight, linksOf, MorningError, readyByOf } from '../practices/night/files/scripts/keel/morning.mjs';
import { planSection, readPlan } from '../practices/night/files/scripts/keel/night-plan.mjs';

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
 * keel morning --card: tonight's plan (finalPlan: every place it lives, each
 * item at its furthest tick) published as the live card night-plan through
 * canvasSync. Refused unless the binding is live and lists night-plan:
 * otherwise each tick would add a new run card. A person's edit to the card
 * stops updates, as for every live card (canvas-sync records the refusal).
 * Without --yes, a preview (exit 3); --dry-run plans and writes nothing.
 */
export async function publishPlanCard({ root, date, env = process.env, now = new Date(), yes = false, dryRun = false }, deps = {}) {
  let config;
  try { config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8')); } catch (e) { throw new MorningError(`cannot read .keel/keel.json: ${e.code ?? e.message}`); }
  const c = config?.canvas;
  if (!c || c.provider !== 'isocan') throw new MorningError('No canvas is bound: keel canvas connect first. Nothing was written.');
  if (c.mode !== 'live' || !(c.liveKeys ?? ['pulse']).includes(PLAN_CARD)) {
    throw new MorningError(`The plan card needs a live binding that lists ${PLAN_CARD}: keel canvas live --card pulse --card ${PLAN_CARD} --yes (canvas.liveKeys). Nothing was written.`);
  }
  // The night the working plan is for, when there is one; else the night that last started.
  const working = date ? null : await readPlan(root).catch(() => null);
  const night = date ?? working?.date ?? lastNight(now);
  const found = await finalPlan({ root, date: night });
  if (!found.plan) throw new MorningError(`no plan for the night of ${night}: ${found.sources.map(s => `${s.from} ${s.state}`).join('; ')}`);
  const { sync } = await import('./canvas-sync.mjs');
  const r = await sync({ root, cards: [planCard(found.plan)], yes, dryRun, env }, deps);
  return { ...r, data: { ...r.data, card: PLAN_CARD, date: night, from: found.from, canvas: linksOf(config).canvas } };
}

/** The CLI's verb: the brief, or --send, or --card. */
export async function morning({ root, date, send, card, yes, dryRun, env = process.env, now }) {
  const m = await import('../practices/night/files/scripts/keel/morning.mjs');
  if (card) return publishPlanCard({ root, date, env, now, yes, dryRun });
  if (send) return m.send({ root, date, env, now });
  return m.brief({ root, date, env, now });
}

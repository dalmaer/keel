// Properties over the code that holds keel's state (phase 85): the night
// plan's validator, tick merging, claims and phase front matter. Each is a
// claim over every input its generator makes (tests/helpers/property.mjs);
// a failure reports its smallest case and the seed that reproduces it
// (KEEL_PROPERTY_SEED). Each property is written over its subject, so the
// same property also runs against a planted bug of its kind and must catch
// it: a property that passes on the bug guards nothing (lesson 38).
//
// The gate runs a small count; KEEL_PROPERTY_RUNS=<n> runs more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { int, string, element, array, record, tuple, oneOf, optional, constant, date, impossibleDate, permutation, check, property, report, seedOf } from './helpers/property.mjs';
import { validatePlan, applyTick, writePlan, writeRecord, readPlan, recordOf, NightPlanError, KINDS, STATUSES, PLAN_FIELDS, ITEM_FIELDS, MAX_BUILD } from '../lib/night-plan.mjs';
import { furthestItems, TERMINAL } from '../lib/morning.mjs';
import { claim } from '../lib/claim.mjs';
import { parsePhase, STATUSES as PHASE_STATUSES, DONE, REVIEW_VALUES, OWES_VALUES, WAITS_VALUES, SPEC } from '../practices/phases/files/scripts/roadmap.mjs';
import { setField } from '../lib/board.mjs';

// ---- generators: the night's plan -------------------------------------------

/** Text the plan accepts: never blank, no control character but tab and newlines; quotes, backslashes and non-ASCII on purpose. */
const TEXT = 'ab Z09-_:"\\\n\té…→';
const text = (max = 12) => string(TEXT, { max }).map(s => `t${s}`);
const LINKS = ['https://github.com/acme/anvils/pull/9', 'docs/health/2026-10-15.md', 'https://canvas.acme.test/p/x'];
const omit = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const zeroSafe = n => (n === 0 ? 0 : n / 100);

const numberGen = record({ measure: element(['slow_tests', 'bundle_bytes', 'persona:perf:speed']), bound: int(-1_000_000, 1_000_000).map(zeroSafe), better: element(['lower', 'higher']) });
const itemGen = record({
  id: string('abc09-', { max: 10 }).map(s => `i${s}`),
  title: text(),
  kind: element(KINDS),
  source: element(['default', 'owner', 'persona:perf', 'loop:slow-search', 'health:slow_tests', 'robot:#12']),
  number: optional(numberGen),
  lane: element(['climb:perf', 'climb:bundle', 'robot:#12', 'robot:#7', 'loop', 'persona:perf', 'night']),
  budget: optional(record({ minutes: int(1, 600) })),
  status: element(STATUSES),
  result: optional(record({ note: optional(text(), { absent: undefined }), link: optional(element(LINKS), { absent: undefined }) }).map(omit)),
});

/** A build item the validator takes: its number named, in a lane a pass builds. */
const buildable = it => it.kind === 'build' && it.number !== null && /^(?:climb:|robot:#)/.test(it.lane);

/**
 * Items the validator accepts, made from any generated ones: ids made unique
 * by position, and a build it would refuse (no number, a lane no pass builds,
 * past the fifth) made triage. The refusals are generated apart, on purpose.
 */
const accepted = items => {
  let builds = 0;
  return items.map((it, i) => {
    const id = `${it.id}-${i}`;
    if (it.kind !== 'build') return { ...it, id };
    if (buildable(it) && builds < MAX_BUILD) { builds++; return { ...it, id }; }
    return { ...it, id, kind: 'triage' };
  });
};

const readyByGen = optional(tuple(date(), int(0, 23), int(0, 59), element(['Z', ':00Z', '+02:00', '-07:00'])).map(([d, h, m, z]) => `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${z}`));
const planGen = record({
  schema: constant(1),
  date: date(),
  shapedBy: element(['default', 'owner']),
  readyBy: readyByGen,
  willNotTouch: array(text(), { max: 3 }),
  settledToday: array(text(), { max: 3 }),
  leftOpen: array(text(), { max: 3 }),
  items: array(itemGen, { max: 8 }).map(accepted),
});

const json = v => JSON.parse(JSON.stringify(v));
const problemsOf = (validate, plan) => {
  const v = validate(plan);
  assert.equal(typeof v.ok, 'boolean');
  assert.ok(Array.isArray(v.problems) && v.problems.every(p => typeof p === 'string'), 'problems are lines of text');
  return v;
};

// ---- the plan validator -----------------------------------------------------

/** Anything the validator accepts round-trips through write and read: the working plan and the night's record. */
const roundTrips = (validate, root) => async plan => {
  const v = problemsOf(validate, plan);
  assert.deepEqual(v.problems, [], 'the generator makes plans the validator accepts');
  await writePlan(root, plan);
  assert.deepEqual(await readPlan(root), plan);
  await writeRecord(root, plan);
  assert.deepEqual(await readPlan(root, join(root, recordOf(plan.date)), recordOf(plan.date)), plan);
};

const withKey = (o, k, v) => { const c = { ...o }; Object.defineProperty(c, k, { value: v, enumerable: true, writable: true, configurable: true }); return c; };
const planItem = (plan, i) => plan.items.length ? i % plan.items.length : -1;
const blankItem = n => ({ id: `extra-${n}`, title: 'Extra', kind: 'triage', source: 'owner', number: null, lane: 'climb:perf', budget: null, status: 'planned', result: null });
const setItem = (plan, at, f) => {
  const items = at < 0 ? [...plan.items, f(blankItem(plan.items.length))] : plan.items.map((it, i) => (i === at ? f(it) : it));
  return { ...plan, items };
};

/**
 * One fault a plan must never get past: [fault, the problem it names]. The
 * plan is read back through JSON, as readPlan reads it, so a __proto__ key is
 * the own field a file holds.
 */
const faultGen = tuple(planGen, oneOf(
  // A sixth build (or later), counted from what the plan already has.
  tuple(constant('sixth build'), int(0, 3)),
  tuple(constant('build with no number'), int(0, 63), element(['null', 'absent'])),
  tuple(constant('impossible date'), impossibleDate(), element(['date', 'readyBy'])),
  tuple(constant('unknown field'), int(0, 63), element(['plan', 'item', 'number', 'budget', 'result']), int(0, 99)),
)).map(([plan, [kind, a, b, c]]) => {
  if (kind === 'sixth build') {
    const have = plan.items.filter(buildable).length;
    const more = Array.from({ length: MAX_BUILD + 1 - have + a }, (_, n) => ({ ...blankItem(n), kind: 'build', number: { measure: 'slow_tests', bound: n, better: 'lower' }, lane: `climb:job-${n}` }));
    return { kind, plan: { ...plan, items: [...plan.items, ...more] }, names: /a (sixth|seventh|\d+th) build item; at most 5 a night/ };
  }
  if (kind === 'build with no number') {
    const fault = it => { const o = { ...it, kind: 'build', lane: 'climb:perf' }; if (b === 'null') o.number = null; else delete o.number; return o; };
    return { kind, plan: setItem(plan, planItem(plan, a), fault), names: /a build item names its number first; it has no "number"/ };
  }
  if (kind === 'impossible date') {
    return b === 'date'
      ? { kind, plan: { ...plan, date: a }, names: /plan: "date" is the night's UTC date/ }
      : { kind, plan: { ...plan, readyBy: `${a}T07:00:00Z` }, names: /plan: "readyBy" is null or a time with its zone/ };
  }
  const where = b;
  const key = unknownKeyOf(where, c);
  if (where === 'plan') return { kind, plan: withKey(plan, key, 'x'), names: new RegExp(`plan: unknown field "${esc(key)}"`) };
  if (where === 'item') return { kind, plan: setItem(plan, planItem(plan, a), it => withKey(it, key, 'x')), names: new RegExp(`unknown field "${esc(key)}"`) };
  if (where === 'number') return { kind, plan: setItem(plan, planItem(plan, a), it => ({ ...it, number: withKey(it.number ?? { measure: 'slow_tests', bound: 1, better: 'lower' }, key, 1) })), names: new RegExp(`unknown field "number\\.${esc(key)}"`) };
  if (where === 'budget') return { kind, plan: setItem(plan, planItem(plan, a), it => ({ ...it, budget: withKey({ minutes: 5 }, key, 1) })), names: /"budget" is \{ minutes \}/ };
  return { kind, plan: setItem(plan, planItem(plan, a), it => ({ ...it, result: withKey({}, key, 'x') })), names: new RegExp(`unknown field "result\\.${esc(key)}"`) };
}).map(f => ({ ...f, plan: json(f.plan) }));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYS_AT = { plan: PLAN_FIELDS, item: ITEM_FIELDS, number: Object.keys({ measure: 0, bound: 0, better: 0 }), budget: ['minutes'], result: ['note', 'link'] };
const UNKNOWN = ['__proto__', 'constructor', 'toString', 'Status', 'items ', 'hasOwnProperty', 'mood', 'owner', 'x', 'date_', 'Minutes'];
const unknownKeyOf = (where, i) => { const k = UNKNOWN[i % UNKNOWN.length]; return KEYS_AT[where].includes(k) ? `${k}_x` : k; };

/** Every fault is refused, by name, and never thrown on. */
const refusesFaults = validate => ({ kind, plan, names }) => {
  let v;
  assert.doesNotThrow(() => { v = problemsOf(validate, plan); }, `${kind}: refused, never thrown on`);
  assert.equal(v.ok, false, `${kind}: the plan is refused`);
  assert.match(v.problems.join('\n'), names, `${kind}: the problem is named`);
};

/** Any JSON value in any one field, at the plan or an item: a verdict, never a throw. */
const anyJson = oneOf(constant(null), constant(true), int(-5, 5), string('ab:#-1', { max: 6 }), array(oneOf(int(0, 3), string('ab', { max: 2 }), constant(null)), { max: 3 }), record({ minutes: int(-1, 3), measure: string('ab', { max: 2 }) }));
const garbleGen = tuple(planGen, element(['plan', 'item']), int(0, 63), int(0, 99), anyJson).map(([plan, where, at, f, value]) => {
  if (where === 'plan' || !plan.items.length) return json({ ...plan, [PLAN_FIELDS[f % PLAN_FIELDS.length]]: value });
  const i = at % plan.items.length;
  return json({ ...plan, items: plan.items.map((it, j) => (j === i ? { ...it, [ITEM_FIELDS[f % ITEM_FIELDS.length]]: value } : it)) });
});
const neverThrows = validate => plan => { problemsOf(validate, plan); };

/** Planted bugs of the validator's kind: the property must catch each. */
const PLANTED_VALIDATORS = {
  // An impossible date accepted: the date is checked by its shape alone.
  'an impossible date accepted': p => validatePlan(p?.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? { ...p, date: '2026-01-01' } : p),
  // An unknown field accepted: only the known fields are looked at.
  'an unknown field accepted': p => validatePlan(p && typeof p === 'object' ? Object.fromEntries(PLAN_FIELDS.filter(k => Object.hasOwn(p, k)).map(k => [k, p[k]])) : p),
  // The sixth build let through: the count is off by one.
  'a sixth build accepted': p => { const v = validatePlan(p); const problems = v.problems.filter(m => !/a sixth build item/.test(m)); return { ok: !problems.length, problems }; },
};

test('the plan validator: every plan it accepts round-trips through write and read, as the working plan and as the record', async t => {
  const root = await mkdtemp(join(tmpdir(), 'keel-prop-plan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await property('accepted plans round-trip', planGen, roundTrips(validatePlan, root), { runs: 60 });
});

test('the plan validator: a sixth build, a build with no number, an impossible date or an unknown field is always refused by name, never thrown on; nor is any JSON value in any field', async () => {
  await property('every fault is refused', faultGen, refusesFaults(validatePlan), { runs: 200 });
  await property('no field value throws', garbleGen, neverThrows(validatePlan), { runs: 200 });
});

test('the plan validator properties catch planted bugs of their kind, each with a small shrunk case', async () => {
  for (const [bug, validate] of Object.entries(PLANTED_VALIDATORS)) {
    const r = await check(faultGen, refusesFaults(validate), { seed: seedOf(), runs: 400 });
    assert.equal(r.ok, false, `the property passes on the planted bug: ${bug}`);
    assert.ok(r.value.plan.items.length <= MAX_BUILD + 1, `${bug}: shrunk to a small plan (${report(bug, r)})`);
  }
});

// ---- ticks ------------------------------------------------------------------

/** A tick on a plan: an item of it by position (or, rarely, an id it does not hold), a status (or, rarely, none of the six), a note, a link. */
const tickGen = record({
  at: int(0, 63),
  stray: element([false, false, false, false, false, false, false, false, false, true]),
  status: oneOf(element(STATUSES), element(STATUSES), element(STATUSES), element(['finished', ''])),
  note: optional(text(), { absent: undefined, rate: 0.5 }),
  link: optional(element(LINKS), { absent: undefined, rate: 0.6 }),
});
const tickOn = (plan, t) => omit({ id: t.stray || !plan.items.length ? 'not-an-item' : plan.items[t.at % plan.items.length].id, status: t.status, note: t.note, link: t.link });

/** A tick that is refused throws NightPlanError and nothing else. Returns the tick's result, or null when refused. */
const tryTick = (apply, plan, tick) => {
  try { return apply(plan, tick); }
  catch (e) { if (!(e instanceof NightPlanError)) throw new Error(`a tick threw ${e?.constructor?.name}, not a refusal: ${e?.message}`); return null; }
};

/** Applying a tick twice equals applying it once; a refusal is a refusal both times. */
const idempotent = apply => ([plan, t]) => {
  const tick = tickOn(plan, t);
  const once = tryTick(apply, plan, tick);
  const twice = once && tryTick(apply, once.plan, tick);
  if (!once) { assert.equal(tryTick(apply, plan, tick), null, 'refused again'); return; }
  assert.ok(twice, 'the same tick again is not refused');
  assert.deepEqual(twice.plan, once.plan);
};

/** Over any run of ticks: a done item never moves back, every refusal is a NightPlanError, and the plan stays one the validator accepts. */
const doneStays = apply => ([plan, ts]) => {
  let at = plan;
  for (const t of ts) {
    const tick = tickOn(at, t);
    const r = tryTick(apply, at, tick);
    if (!r) continue;
    for (const was of at.items) {
      const now = r.plan.items.find(i => i.id === was.id);
      if (was.status === 'done') assert.equal(now.status, 'done', `${was.id} was done and moved to ${now.status}`);
    }
    assert.deepEqual(validatePlan(r.plan).problems, []);
    at = r.plan;
  }
};

const rank = s => (TERMINAL.includes(s) ? 2 : s === 'running' ? 1 : 0);
/**
 * The places finalPlan reads, each the base's items at a status of its own
 * (some places missing some items), and an order to read them in.
 */
const placesGen = tuple(
  // Each item carries its own tick in each of five places (so a shrink that drops an item leaves the others' ticks as they were).
  array(record({ id: string('abc', { max: 4 }), kind: element(KINDS), ticks: array(tuple(oneOf(element(STATUSES), constant('done')), element([true, true, true, false]), optional(text(), { absent: undefined, rate: 0.6 })), { min: 5, max: 5 }) }), { min: 1, max: 6 }),
  int(1, 5),
  array(int(0, 4), { min: 5, max: 5 }),
).map(([bases, n, code]) => {
  const items = bases.map((b, i) => ({ id: `${b.id}-${i}`, title: 'An item', kind: b.kind, source: 'owner', number: null, lane: 'climb:perf', budget: null, status: 'planned', result: null }));
  // Place 0 holds every item (finalPlan's base is one of the places); the others may miss some.
  const places = Array.from({ length: n }, (_, p) => ({ items: items.flatMap((it, i) => {
    const [status, here, note] = bases[i].ticks[p];
    return here || p === 0 ? [{ ...it, status, result: note ? { note } : null }] : [];
  }) }));
  // A Lehmer code over the places: any order of them.
  const pool = places.map((_, i) => i), order = code.slice(0, n).map((k, i) => pool.splice(k % (n - i), 1)[0]);
  return { items, places, order };
});

/**
 * The furthest tick wins, whatever order the places are read in: each item's
 * status is the furthest any place holds; that is so in every order; and an
 * item whose furthest tick only one value holds is that tick in every order.
 */
const furthestWins = merge => ({ items, places, order }) => {
  const merged = merge(items, places), reordered = merge(items, order.map(i => places[i]));
  items.forEach((it, i) => {
    const ticks = places.map(p => p.items.find(o => o.id === it.id && o.kind === it.kind)).filter(Boolean);
    const top = Math.max(...ticks.map(o => rank(o.status)));
    assert.equal(rank(merged[i].status), top, `${it.id}: the furthest tick (${ticks.map(o => o.status).join(', ')}) is ${merged[i].status}`);
    assert.equal(rank(reordered[i].status), top, `${it.id}: read in another order, ${reordered[i].status}`);
    const atTop = new Set(ticks.filter(o => rank(o.status) === top).map(o => JSON.stringify(o)));
    if (atTop.size === 1) assert.deepEqual(reordered[i], merged[i], `${it.id}: one furthest tick, the same in every order`);
    if (ticks.some(o => o.status === 'done')) assert.ok(TERMINAL.includes(merged[i].status), `${it.id}: done somewhere, so never back to ${merged[i].status}`);
  });
};

const ticksPlanGen = planGen.map(p => (p.items.length ? p : { ...p, items: [blankItem(0)] }));
const PLANTED_TICKS = {
  // A done item moved back: the refusal is caught and the tick applied anyway.
  'done moves back': (plan, tick) => {
    try { return applyTick(plan, tick); }
    catch (e) {
      if (!/never moves back/.test(e.message)) throw e;
      return applyTick({ ...plan, items: plan.items.map(i => (i.id === tick.id ? { ...i, status: 'planned' } : i)) }, tick);
    }
  },
  // A tick that is not idempotent: its note is appended to the one there.
  'a note appended': (plan, tick) => applyTick(plan, tick.note === undefined ? tick : { ...tick, note: `${plan.items.find(i => i.id === tick.id)?.result?.note ?? ''}${tick.note}`.slice(0, 1000) }),
};
const PLANTED_MERGES = {
  // Order-dependent: the last place read wins.
  'the last place wins': (items, plans) => items.map(it => [...plans].reverse().map(p => p.items.find(o => o.id === it.id && o.kind === it.kind)).find(Boolean) ?? it),
  // Furthest by the wrong rank: running outranks a terminal status.
  'running outranks done': (items, plans) => items.map(it => {
    const ticks = plans.map(p => p.items.find(o => o.id === it.id && o.kind === it.kind)).filter(Boolean);
    const r = s => (s === 'running' ? 3 : rank(s));
    return ticks.reduce((a, b) => (r(b.status) > r(a.status) ? b : a), ticks[0] ?? it);
  }),
};

test('ticks: applying one twice equals once; over any run of ticks a done item never moves back and every refusal is a NightPlanError', async () => {
  await property('a tick twice is a tick once', tuple(ticksPlanGen, tickGen), idempotent(applyTick), { runs: 200 });
  await property('done never moves back', tuple(ticksPlanGen, array(tickGen, { max: 12 })), doneStays(applyTick), { runs: 150 });
});

test('ticks: the morning\'s merge takes each item\'s furthest tick, whatever order its places are read in', async () => {
  await property('the furthest tick wins in any order', placesGen, furthestWins(furthestItems), { runs: 300 });
});

test('the tick properties catch planted bugs of their kind: a done item moved back, a tick that is not idempotent, an order-dependent merge, a wrong rank', async () => {
  const back = await check(tuple(ticksPlanGen, array(tickGen, { max: 12 })), doneStays(PLANTED_TICKS['done moves back']), { seed: seedOf(), runs: 400 });
  assert.equal(back.ok, false, 'done moving back is caught');
  assert.ok(back.value[1].length <= 3, `shrunk to a short run of ticks: ${report('done moves back', back)}`);
  const twice = await check(tuple(ticksPlanGen, tickGen), idempotent(PLANTED_TICKS['a note appended']), { seed: seedOf(), runs: 400 });
  assert.equal(twice.ok, false, 'a tick that is not idempotent is caught');
  for (const [bug, merge] of Object.entries(PLANTED_MERGES)) {
    const r = await check(placesGen, furthestWins(merge), { seed: seedOf(), runs: 600 });
    assert.equal(r.ok, false, `the merge property passes on the planted bug: ${bug}`);
    // The places are read by position, so a shrink cannot move a late place earlier: the case shrinks to its items, not always to two places.
    assert.ok(r.value.items.length <= 2, `${bug}: shrunk to one or two items (${report(bug, r)})`);
  }
});

// ---- claims -----------------------------------------------------------------

const phaseFile = ({ status = 'planned', depends = '[]', evidence = '[]', title }) => `---
status: ${status}
since: 2026-10-01
goal: G0
depends: ${depends}
note: "Acme."
evidence: ${evidence}
---

# ${title}

## Done when

The anvil lands.

## Scope

Small.

## Acceptance

- [${status === 'built' ? 'x' : ' '}] Lands. \`tests/anvil.test.mjs\`

## Proof

A command.

## Deliberately open

Nothing yet.

## Next action

Build the anvil.
`;
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** One bare Acme origin and `n` clones of it; phase 1 is ready. gh is a stub listing no PRs. */
async function origin(n) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-prop-claim-'));
  const seed = join(dir, 'seed'), bare = join(dir, 'origin.git');
  const w = async (p, body) => { await mkdir(dirname(join(seed, p)), { recursive: true }); await writeFile(join(seed, p), body); };
  await w('.keel/keel.json', JSON.stringify({ name: 'Acme', repo: 'acme/app', practices: ['phases'] }));
  await w('docs/goals.json', JSON.stringify([{ id: 'G0', title: 'Anvils', outcome: 'They land.' }]));
  await w('docs/evidence/acme-0.md', '# Evidence: phase 0\n');
  await w('docs/phases/00-start.md', phaseFile({ status: 'built', evidence: '["evidence/acme-0.md"]', title: 'Start' }));
  await w('docs/phases/01-anvil.md', phaseFile({ depends: '[0]', title: 'Build the anvil' }));
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'acme');
  execFileSync('git', ['clone', '-q', '--bare', seed, bare]);
  const clones = Array.from({ length: n }, (_, i) => join(dir, `c${i}`));
  for (const c of clones) execFileSync('git', ['clone', '-q', bare, c]);
  const gh = join(dir, 'gh');
  await writeFile(gh, `#!${process.execPath}\nprocess.stdout.write('[]');\n`, { mode: 0o755 });
  return { dir, bare, clones, gh };
}

/** The racers: 2 to 4, each a provider, a machine, a delay before its push, and whether its clock is frozen. */
const racersGen = array(record({ provider: element(['claude', 'codex', 'gemini']), machine: element(['acme-laptop', 'acme-desktop']), delay: int(0, 120), frozen: element([false, true]) }), { min: 2, max: 4 });
const NOW = '2026-10-12T10:00:00.000Z';

/** Of N racers in one bare origin, exactly one holds the claim; the origin's branch is its commit; every other is refused, naming it. */
const oneHolds = claimFn => async racers => {
  const x = await origin(racers.length);
  try {
    const results = await Promise.all(racers.map((r, i) => {
      const env = { ...process.env, KEEL_GH: x.gh, KEEL_MACHINE: r.machine, KEEL_PROVIDER: r.provider, KEEL_SESSION: '' };
      for (const k of Object.keys(env)) if (/^(CLAUDE|CODEX_)/.test(k)) delete env[k];
      return claimFn({ root: x.clones[i], phase: '1', provider: r.provider }, { env, ...(r.frozen ? { now: NOW } : {}), beforePush: () => new Promise(res => setTimeout(res, r.delay)) });
    }));
    const holders = results.filter(r => r.data.ok && r.data.held && r.data.claimed);
    assert.equal(holders.length, 1, `exactly one of ${racers.length} holds: ${JSON.stringify(results.map(r => r.data.ok))}`);
    const [won] = holders;
    assert.equal(git(x.bare, 'rev-parse', 'refs/heads/claims/phase-1'), won.data.sha, 'the origin holds the winner\'s commit');
    for (const r of results.filter(o => o !== won)) {
      assert.deepEqual([r.data.ok, r.data.refused], [false, true]);
      assert.deepEqual([r.data.holder.provider, r.data.holder.machine], [won.data.holder.provider, won.data.holder.machine], 'the loser names the holder');
    }
  } finally { await rm(x.dir, { recursive: true, force: true }); }
};

test('claims: of N racers in one bare origin, exactly one holds and every other is told who', async () => {
  await property('exactly one racer holds', racersGen, oneHolds(claim), { runs: 3, cost: 25 });
});

test('the claim property catches a planted bug of its kind: a claim that believes any claim on the branch is its own', async () => {
  // Every racer that finds a claim at all reports holding it: the token check dropped.
  const believer = async (args, deps) => {
    const r = await claim(args, deps);
    return r.data.refused && r.data.holder ? { ...r, data: { ...r.data, ok: true, held: true, claimed: true, refused: undefined } } : r;
  };
  // One input and one shrink: each try is a fresh origin, so the shrink that matters (a racer fewer) is the one taken.
  const few = array(record({ provider: element(['claude', 'codex']), machine: constant('acme-laptop'), delay: int(0, 10), frozen: constant(false) }), { min: 2, max: 3 });
  const r = await check(few, oneHolds(believer), { seed: seedOf(), runs: 1, maxShrinks: 1 });
  assert.equal(r.ok, false, 'the property passes on the planted bug');
  assert.equal(r.value.length, 2, `shrunk to two racers: ${report('believer', r)}`);
});

// ---- front matter -----------------------------------------------------------

/** Text a front-matter value may hold: quotes, a colon, a hash, backslashes, newlines, leading and trailing spaces, non-ASCII. */
const VALUE = 'aG0 :#"\\\n\t-é→[]{}';
/**
 * Phase metadata the roadmap accepts, every field it knows: owes only on a
 * partial phase, waits only with owes, a done phase with its evidence.
 */
const metaGen = record({
  status: element(PHASE_STATUSES),
  since: date(),
  goal: string(VALUE, { max: 8 }).map(s => `G${s}`),
  spec: optional(int(1, SPEC), { absent: undefined }),
  depends: array(int(0, 300), { max: 5 }).map(ds => [...new Set(ds)]),
  note: string(VALUE, { max: 20 }).map(s => `n${s}`),
  evidence: array(string('abc09._-', { max: 6 }).map(s => `evidence/e${s}.md`), { max: 3 }),
  issue: optional(int(1, 1_000_000), { absent: undefined }),
  review: optional(element(REVIEW_VALUES), { absent: undefined }),
  owes: optional(element(OWES_VALUES), { absent: undefined }),
  after: optional(date(), { absent: undefined }),
  waits: optional(element(WAITS_VALUES), { absent: undefined }),
}).map(m => {
  const o = { ...m };
  if (o.owes && o.status !== 'partial') delete o.owes;
  if (!o.owes) delete o.waits;
  if (DONE.includes(o.status) && !o.evidence.length) o.evidence = ['evidence/e.md'];
  return omit(o);
});
const JSON_KEYS = ['depends', 'evidence', 'issue', 'spec'];
/** A value as a writer puts it on its line: JSON for the JSON fields, else bare when that reads back the same, else quoted JSON. */
const scalar = (key, v, quote) => JSON_KEYS.includes(key) ? JSON.stringify(v)
  : (!quote && /^[^\s"](?:.*\S)?$/.test(v) && !/[\r\n]/.test(v)) ? v : JSON.stringify(v);
const bodyFor = m => {
  const boxes = DONE.includes(m.status) ? ['- [x] Built. `tests/anvil.test.mjs`']
    : m.owes === 'walk' ? ['- [x] Built. `tests/anvil.test.mjs`', '- [ ] ⚑ by hand: walk the anvil.'] : ['- [ ] Build it. `tests/anvil.test.mjs`'];
  return ['', '# The anvil lands', '', '## Done when', '', 'It lands.', '', '## Scope', '', 'Small.', '', '## Acceptance', '', ...boxes, '', '## Proof', '', 'A command.', '', '## Deliberately open', '', 'Nothing.', '', '## Next action', '', 'Build it.', ''].join('\n');
};
/** The phase file a writer makes: each field set by keel's own setField (keel walk's), in the order given. */
const renderPhase = (meta, order, quote) => order.filter(k => Object.hasOwn(meta, k))
  .reduce((raw, k, i) => setField(raw, k, scalar(k, meta[k], quote[i % quote.length])), `---\nstatus: planned\n---\n${bodyFor(meta)}`);

const FM_FIELDS = ['status', 'since', 'goal', 'spec', 'depends', 'note', 'evidence', 'issue', 'review', 'owes', 'after', 'waits'];
const frontGen = tuple(metaGen, permutation(FM_FIELDS), array(element([false, true]), { min: 1, max: 4 }));

/** Parse after render is identity, field by field, for every field the roadmap accepts. */
const identity = parse => ([meta, order, quote]) => {
  const raw = renderPhase(meta, order, quote);
  const p = parse('07-anvil.md', raw);
  for (const k of FM_FIELDS) {
    const want = Object.hasOwn(meta, k) ? meta[k] : ['depends', 'evidence'].includes(k) ? [] : undefined;
    assert.deepEqual(p[k], want, `${k}: rendered as ${JSON.stringify(raw.split('\n').find(l => l.startsWith(`${k}:`)))}`);
  }
};

/** An impossible since or after is refused naming the file, never a bare RangeError. */
const impossibleRefused = parse => ([meta, key, bad]) => {
  const raw = setField(renderPhase(meta, FM_FIELDS, [true]), key, bad);
  let thrown = null;
  try { parse('07-anvil.md', raw); } catch (e) { thrown = e; }
  assert.ok(thrown, `${key}: ${bad} is accepted`);
  assert.ok(thrown.constructor === Error && /^07-anvil\.md: /.test(thrown.message), `${key}: ${bad} threw ${thrown.constructor.name} "${thrown.message}", not a refusal naming the file`);
};

const PLANTED_PARSERS = {
  // A parser that trims what it reads: a quoted value's spaces are lost.
  'values trimmed': (file, raw) => { const p = parsePhase(file, raw); for (const k of ['goal', 'note']) if (typeof p[k] === 'string') p[k] = p[k].trim(); return p; },
  // A parser that reads every value as text: a JSON-quoted note keeps its quotes.
  'quotes kept': (file, raw) => { const p = parsePhase(file, raw); const line = /^note: (.*)$/m.exec(raw)?.[1]; if (line) p.note = line; return p; },
};

test('front matter: parse after render is identity for every field the roadmap accepts, in any order, bare or quoted', async () => {
  await property('parse after render is identity', frontGen, identity(parsePhase), { runs: 300 });
});

test('front matter: an impossible since or after date is refused, naming the file', async () => {
  await property('an impossible date is refused by name', tuple(metaGen, element(['since', 'after']), impossibleDate()), impossibleRefused(parsePhase), { runs: 100 });
});

test('the front matter property catches planted bugs of its kind: a parser that trims, one that keeps the quotes', async () => {
  for (const [bug, parse] of Object.entries(PLANTED_PARSERS)) {
    const r = await check(frontGen, identity(parse), { seed: seedOf(), runs: 600 });
    assert.equal(r.ok, false, `the identity property passes on the planted bug: ${bug}`);
  }
});

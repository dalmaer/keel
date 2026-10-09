import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePhase, validateGraph, nextPhase, focus, render, run, specProblems, specNotes, nothingNext, uncheckedBoxes, sectionsOf, isWalk, livedInOf, PLACEHOLDERS, PLACEHOLDER_TITLE, SURFACES, yourPartOf, yourPartReady, thenFor } from '../scripts/roadmap.mjs';

const phase = ({ status = 'planned', since = '2026-10-02', goal = 'G0', depends = '[]', evidence = '[]', acceptance = '- [ ] Something observable.', extra = '' } = {}) => `---
status: ${status}
since: ${since}
goal: ${goal}
depends: ${depends}
note: "Why it stands here."
evidence: ${evidence}
${extra}---

# A phase

## Done when

One checkable sentence.

## Scope

Small.

## Acceptance

${acceptance}

## Proof

A command.

## Deliberately open

Nothing yet.

## Next action

Do the thing.
`;

test('a well-formed phase parses', () => {
  const p = parsePhase('03-a-phase.md', phase());
  assert.equal(p.id, 3);
  assert.equal(p.title, 'A phase');
  assert.equal(p.next, 'Do the thing.');
});

test('an optional Trajectory after Next action parses, and stays out of the next action', async () => {
  const p = parsePhase('03-a-phase.md', `${phase()}\n## Trajectory\n\n- **2026-10-03** — A claim. Its evidence.\n`);
  assert.equal(p.next, 'Do the thing.');
  const { readFile } = await import('node:fs/promises');
  const template = await readFile(new URL('../docs/templates/phase.md', import.meta.url), 'utf8');
  assert.match(template, /## Next action[\s\S]*## Trajectory\n\n<!-- Optional\./, 'the template carries Trajectory after Next action, marked optional');
  const filled = template.replace('since: YYYY-MM-DD', 'since: 2026-10-03');
  assert.equal(parsePhase('04-template.md', filled).next, 'One concrete action that advances this phase.');
});

// Phase 32: a spec says how it will be proven.
const template = async () => (await import('node:fs/promises')).readFile(new URL('../docs/templates/phase.md', import.meta.url), 'utf8');
const lines = text => text.split('\n').map(l => l.trim().replace(/^- \[[ x]\]\s*/, '').replace(/^-\s+/, '').trim()).filter(l => l && !l.startsWith('<!--'));

test('every placeholder line in the template is one the check knows (one source)', async () => {
  const t = await template();
  const body = t.replace(/^---\n[\s\S]*?\n---\n/, '');
  assert.equal(/^# (.+)$/m.exec(body)[1], PLACEHOLDER_TITLE);
  const placeholders = Object.values(sectionsOf(body)).flatMap(lines);
  assert.ok(placeholders.length >= 8, 'the template has its placeholder lines');
  for (const line of placeholders) assert.ok(PLACEHOLDERS.includes(line), `template line not in PLACEHOLDERS: ${line}`);
  assert.match(t, /^spec: 2$/m, 'a phase drafted from the template is held to spec 2');
});

test('a known limitation goes under Deliberately open: the template and the contract say so', async () => {
  const open = sectionsOf((await template()).replace(/^---\n[\s\S]*?\n---\n/, ''))['Deliberately open'];
  assert.match(open, /known limitation that could make this phase's output wrong[^\n]*its effect, and when it is settled[^\n]*never only in a design's prose/);
  const readme = await (await import('node:fs/promises')).readFile(new URL('../docs/phases/README.md', import.meta.url), 'utf8');
  assert.match(readme.replace(/\s+/g, ' '), /\*\*Deliberately open\*\* \([^)]*known limitation that could make the phase's output wrong[^)]*never only in the design's prose\)/);
});

test('a phase still holding the template text fails --check at any status, naming the file and section', async () => {
  const t = (await template()).replace('since: YYYY-MM-DD', 'since: 2026-10-03');
  for (const status of ['planned', 'designed', 'partial']) {
    const raw = t.replace('status: planned', `status: ${status}`).replace(/^# .+$/m, '# Acme ships');
    assert.ok(parsePhase('04-acme.md', raw), 'it still parses, so the roadmap lists it');
    const problems = specProblems('04-acme.md', raw);
    for (const section of ['Done when', 'Scope', 'Acceptance', 'Real surfaces', 'Proof', 'Deliberately open', 'Next action']) {
      assert.ok(problems.some(p => p.startsWith(`docs/phases/04-acme.md: ## ${section} still holds the template's text`)), `${status}: ${section}`);
    }
  }
  // One placeholder line left among the project's own words is still template text.
  const built = phase({ status: 'built', evidence: '["evidence/x.md"]', acceptance: '- [x] Did it.' }).replace('A command.', 'A command.\nBy hand: who does what, and what would change the design.');
  assert.match(specProblems('04-acme.md', built).join('\n'), /## Proof still holds the template's text/);
  assert.match(specProblems('04-acme.md', t).join('\n'), /the title is the template's/);
  // Retired with its goal, a draft owes nothing.
  assert.deepEqual(specProblems('04-acme.md', t.replace('status: planned', 'status: superseded')), []);

  const root = await mkdtemp(join(tmpdir(), 'keel-roadmap-'));
  try {
    await mkdir(join(root, '.keel'));
    await mkdir(join(root, 'docs/phases'), { recursive: true });
    await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme' }));
    await writeFile(join(root, 'docs/goals.json'), JSON.stringify([{ id: 'G0', title: 'Start', outcome: 'It starts.' }]));
    await writeFile(join(root, 'docs/phases/00-start.md'), phase());
    await writeFile(join(root, 'docs/phases/01-drafted.md'), t.replace(/^# .+$/m, '# Drafted'));
    await run({ root }); // writing the roadmap lists a draft
    await assert.rejects(run({ root, mode: 'check' }), /docs\/phases\/01-drafted\.md: ## Done when still holds the template's text/);
    await writeFile(join(root, 'docs/phases/01-drafted.md'), phase({ extra: 'spec: 2\n', acceptance: '- [ ] It runs. `npm run check`' }).replace('## Proof', '## Real surfaces\n\nnone\n\n## Proof'));
    await run({ root });
    assert.match(await run({ root, mode: 'check' }), /2 phases/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an empty Done when, Acceptance or Proof fails, naming the section', () => {
  for (const [section, text] of [['Done when', 'One checkable sentence.'], ['Acceptance', '- [ ] Something observable.'], ['Proof', 'A command.']]) {
    assert.throws(() => parsePhase('01-x.md', phase().replace(`## ${section}\n\n${text}\n`, `## ${section}\n\n`)), new RegExp(`01-x\\.md: missing or empty ## ${section}`));
  }
});

const spec2 = ({ acceptance = '- [ ] It runs. `npm run check`', surfaces = 'none' } = {}) => {
  const raw = phase({ extra: 'spec: 2\n', acceptance });
  return surfaces === null ? raw : raw.replace('## Proof', `## Real surfaces\n\n${surfaces}\n\n## Proof`);
};

test('spec 2: every acceptance box names its check', () => {
  const ok = [
    '- [ ] It runs. `tests/acme.test.mjs`',
    '- [ ] It runs. tests/acme.test.mjs: "orders an anvil"',
    '- [ ] It runs. `node scripts/acme.mjs --check`',
    '- [ ] ⚑ by hand: the owner orders an anvil.',
    '- [ ] It runs, and keeps running\n  when wrapped. `npm test`',
  ];
  for (const acceptance of ok) assert.deepEqual(specProblems('05-x.md', spec2({ acceptance })), [], acceptance);
  const bad = [
    '- [ ] It runs.',
    '- [ ] `acme_hold` flags it.', // a name in backticks is not a command
    '- [ ] It runs. practices/x/tests/acme.test.mjs', // a path that only ends in tests/ is not a cited test
    '- [ ] It runs. `npm test`\n- [ ] And this one names nothing.',
  ];
  for (const acceptance of bad) assert.match(specProblems('05-x.md', spec2({ acceptance })).join('\n'), /docs\/phases\/05-x\.md: ## Acceptance: ".*" names no check/, acceptance);
  // A phase without spec is not held to it; doctor counts its boxes instead.
  assert.deepEqual(specProblems('05-x.md', phase({ acceptance: '- [x] It runs.' })), []);
  assert.deepEqual(uncheckedBoxes(phase({ acceptance: '- [x] It runs.\n- [x] `npm test` passes.' })), { boxes: 2, unchecked: 1 });
  assert.equal(uncheckedBoxes(spec2()), null);
});

test('spec 2: Real surfaces from the closed list, each with its proof, or none', () => {
  assert.deepEqual(specProblems('05-x.md', spec2({ surfaces: 'none' })), []);
  assert.deepEqual(specProblems('05-x.md', spec2({ surfaces: 'None.' })), []);
  assert.deepEqual(specProblems('05-x.md', spec2({ surfaces: SURFACES.map(s => `- ${s.toUpperCase()}: one run there.`).join('\n') })), []);
  assert.deepEqual(specProblems('05-x.md', spec2({ surfaces: "- Owner’s machine: a fresh clone\n  on the owner's laptop." })), []);
  const cases = [
    [null, /## Real surfaces is missing or empty/],
    ['- Adopted project:', /Adopted project names no proof/],
    ['- Adopted project:   ', /Adopted project names no proof/],
    ['- The cloud: it runs there.', /"The cloud" is not a surface/],
    ['Adopted project, somewhere.', /is not "- <surface>: <its proof>"/],
  ];
  for (const [surfaces, re] of cases) assert.match(specProblems('05-x.md', spec2({ surfaces })).join('\n'), re, String(surfaces));
  assert.throws(() => parsePhase('05-x.md', phase({ extra: 'spec: 3\n' })), /spec 3 is not one this script knows/);
  assert.throws(() => parsePhase('05-x.md', phase({ extra: 'spec: two\n' })), /invalid JSON value for spec/);
  assert.equal(parsePhase('05-x.md', spec2()).spec, 2);
});

test('spec 2: a measure asked for with no bound is a note (never a failure), unless the phase faced the selftest', () => {
  const unbounded = /## Scope: ".*" asks for a measure with no bound.*optional bound the selftest fixture sets.*a line on the health page instead/;
  const scoped = (scope, rest = '') => spec2().replace('## Scope\n\nSmall.\n', `## Scope\n\n${scope}\n`) + rest;
  for (const scope of [
    '- **Measured**: `acme_share` on the night: the share of anvils dropped, recorded, no bound.',
    '- A night measure `acme_share`, recorded only.',
    '- The night measures `acme_share` without a bound.',
  ]) assert.match(specNotes('05-x.md', scoped(scope)).join('\n'), unbounded, scope);
  // A bound, or a line on the health page, is fine; so is a bound with no measure in the sentence.
  for (const scope of [
    '- **Measured**: `acme_share` on the night, bound 0.8; the selftest fixture sets it.',
    '- A line on the health page: the share of anvils dropped. No bound needed.',
  ]) assert.deepEqual(specNotes('05-x.md', scoped(scope)), [], scope);
  // In Acceptance too.
  assert.match(specNotes('05-x.md', spec2({ acceptance: '- [ ] The night measures `acme_share`, no bound. `npm test`' })).join('\n'), /## Acceptance: ".*" asks for a measure with no bound/);
  // Faced: Deliberately open or Trajectory names the measure with the selftest.
  const scope = '- **Measured**: `acme_share` on the night, recorded, no bound.';
  assert.deepEqual(specNotes('05-x.md', scoped(scope, '\n## Trajectory\n\n- **2026-10-06** — `acme_share` is not in MEASURES: the selftest refuses an unbounded measure.\n')), []);
  assert.match(specNotes('05-x.md', scoped(scope, '\n## Trajectory\n\n- **2026-10-06** — `acme_other` is not in MEASURES: the selftest refuses it.\n')).join('\n'), unbounded, 'another measure faced is not this one');
  // Codex on cajones#47: the night's measures only; a wrapped bullet is one item; only the measure's own name is faced.
  assert.deepEqual(specNotes('05-x.md', scoped('- Measure which anvil buyers prefer, recorded only, for the study.')), [], 'not a night measure');
  assert.match(specNotes('05-x.md', scoped('- A night measure `acme_share` is\n  recorded only, with no bound.')).join('\n'), unbounded, 'wrapped');
  const grouped = '- The night measures `acme_share` grouped by `branch`, recorded only.';
  assert.deepEqual(specNotes('05-x.md', scoped(grouped, '\n## Trajectory\n\n- **2026-10-06** — `acme_share` is not in MEASURES: the selftest refuses it.\n')), [], 'a field beside the measure is not a measure');
  // Codex on cajones#48: every measure an item names is faced, not only the first; a denied night is not the night.
  const two = '- The night measures `acme_share` and measures `acme_drop`, both recorded only.';
  const facedShare = '\n## Trajectory\n\n- **2026-10-06** — `acme_share` is not in MEASURES: the selftest refuses it.\n';
  assert.match(specNotes('05-x.md', scoped(two, facedShare)).join('\n'), unbounded, 'acme_drop is not faced');
  assert.deepEqual(specNotes('05-x.md', scoped(two, facedShare.replace('`acme_share`', '`acme_share` and `acme_drop`'))), []);
  assert.deepEqual(specNotes('05-x.md', scoped('- Measure buyer preference, recorded only: not a night measure.')), [], 'not a night measure');
  // Codex on cajones#49: "no night measure … has a bound" is still the night's; a bounded measure in another clause is not governed.
  assert.match(specNotes('05-x.md', scoped('- No night measure `acme_share` has a bound; it is recorded only.')).join('\n'), unbounded, 'a "no" that does not deny the night');
  const mixed = '- The night measures `acme_share`, recorded only; a canary measures `acme_drop` against a bound of 3.';
  assert.deepEqual(specNotes('05-x.md', scoped(mixed, facedShare)), [], 'the bounded acme_drop needs no selftest line');
  assert.match(specNotes('05-x.md', scoped(mixed)).join('\n'), unbounded, 'acme_share still does');
  // Codex on cajones#50: "never a night measure" denies the night; a later clause inherits a name only as a continuation.
  assert.deepEqual(specNotes('05-x.md', scoped('- Measure `buyer_pref`, recorded only; never a night measure.')), []);
  assert.deepEqual(specNotes('05-x.md', scoped('- The night measure `latency` has a bound of 3. Diagnostics are recorded only.')), [], 'diagnostics are another subject');
  // A note, never a problem: --check passes (the old failure is advice now).
  assert.deepEqual(specProblems('05-x.md', scoped('- A night measure `acme_share`, recorded only.')), []);
  // A phase without spec 2 is not held to it.
  assert.deepEqual(specNotes('05-x.md', phase().replace('Small.', scope)), []);
});

test('a phase lists the tests its Acceptance cites', () => {
  const p = parsePhase('05-x.md', phase({ acceptance: '- [ ] A. `tests/a.test.mjs`, tests/b.test.mjs: "b"\n- [ ] C. `tests/a.test.mjs` and `tests/*.test.mjs`' }));
  assert.deepEqual(p.tests, ['tests/a.test.mjs', 'tests/b.test.mjs']);
});

test('rejects what would let the roadmap lie', () => {
  const cases = [
    ['bad name', 'phase.md', phase()],
    ['unknown status', '01-x.md', phase({ status: 'done' })],
    ['impossible date', '01-x.md', phase({ since: '2026-02-30' })],
    ['built without evidence', '01-x.md', phase({ status: 'built', acceptance: '- [x] Did it.' })],
    ['built with unchecked acceptance', '01-x.md', phase({ status: 'built', evidence: '["evidence/x.md"]' })],
    ['unknown field', '01-x.md', phase({ extra: 'owner: me\n' })],
    ['unknown review value', '01-x.md', phase({ extra: 'review: later\n' })],
    ['no checkboxes', '01-x.md', phase({ acceptance: 'It works.' })],
    ['missing section', '01-x.md', phase().replace('## Proof\n\nA command.\n', '')],
  ];
  for (const [why, file, raw] of cases) assert.throws(() => parsePhase(file, raw), undefined, why);
});

test('review: wait opts a phase in to waiting for review; absent is the default', () => {
  assert.equal(parsePhase('03-a-phase.md', phase({ extra: 'review: wait\n' })).review, 'wait');
  assert.equal(parsePhase('03-a-phase.md', phase()).review, undefined);
  assert.throws(() => parsePhase('03-a-phase.md', phase({ extra: 'review: always\n' })), /review "always" is not one this script knows \(wait; absent is the default: no wait\)/);
});

test('a phase with every box checked and evidence named must not stay unbuilt', () => {
  for (const status of ['planned', 'designed', 'partial']) {
    assert.throws(() => parsePhase('07-x.md', phase({ status, evidence: '["evidence/x.md"]', acceptance: '- [x] Did it.' })),
      new RegExp(`^Error: phase 7: every box checked and evidence named, but status is ${status} — set status: built`));
  }
  // Any one of the three missing is a phase still in progress, and fine.
  assert.ok(parsePhase('07-x.md', phase({ status: 'partial', evidence: '["evidence/x.md"]', acceptance: '- [x] Did it.\n- [ ] Not yet.' })));
  assert.ok(parsePhase('07-x.md', phase({ status: 'partial', acceptance: '- [x] Did it.' })));
  assert.ok(parsePhase('07-x.md', phase({ status: 'built', evidence: '["evidence/x.md"]', acceptance: '- [x] Did it.' })));
});

test('the graph rejects cycles, unknown goals and duplicate numbers', () => {
  const goals = [{ id: 'G0', title: 't', outcome: 'o' }];
  const p = (id, depends, goal = 'G0', file = `${id}.md`) => ({ id, file, depends, goal });
  assert.throws(() => validateGraph([p(0, [1]), p(1, [0])], goals), /cycle/);
  assert.throws(() => validateGraph([p(0, [], 'G9')], goals), /unknown goal/);
  assert.throws(() => validateGraph([p(0, [7])], goals), /unknown dependency/);
  // Two branches each added phase 7: the message names both files.
  assert.throws(() => validateGraph([p(7, [], 'G0', '07-a.md'), p(7, [], 'G0', '07-b.md')], goals), /duplicate phase number 7: 07-a\.md and 07-b\.md/);
  assert.throws(() => validateGraph([p(0, [])], [{ ...goals[0], retired: 'someday' }]), /retired/);
});

test('a goal with no phase yet is allowed, and says how to start one', () => {
  const goals = [{ id: 'G0', title: 't', outcome: 'o' }, { id: 'G1', title: 'Later', outcome: 'It will.' }];
  const phases = [{ id: 0, file: '00-x.md', title: 'X', status: 'planned', since: '2026-10-02', goal: 'G0', depends: [], note: 'n', done: 'd', next: 'n' }];
  validateGraph(phases, goals);
  assert.match(render({ config: { name: 'Acme' }, phases, goals }), /## G1 — Later\n\nIt will\.\n\nNo phases yet — `keel phase new --goal G1`\./);
});

test('a retired goal renders last, still counted, never next focus', () => {
  const goals = [{ id: 'G0', title: 'Gone', outcome: 'o', retired: '2026-10-02: no longer wanted' }, { id: 'G1', title: 'Kept', outcome: 'o' }];
  const ph = (id, goal) => ({ id, file: `0${id}-x.md`, title: `P${id}`, status: 'planned', since: '2026-10-02', goal, depends: [], note: 'n', done: 'd', next: 'n' });
  const phases = [ph(0, 'G0'), ph(1, 'G1')];
  validateGraph(phases, goals);
  assert.equal(focus({ phases, goals }).id, 1);
  const md = render({ config: { name: 'Acme' }, phases, goals });
  assert.match(md, /0 of 2 phases built\./);
  assert.ok(md.indexOf('## G1 — Kept') < md.indexOf('## Retired'));
  assert.match(md, /## Retired[\s\S]*### G0 — Gone\n\nRetired 2026-10-02: no longer wanted/);
});

test('next focus skips a phase whose dependencies are not built', () => {
  const phases = [
    { id: 0, status: 'built', depends: [] },
    { id: 1, status: 'planned', depends: [2] },
    { id: 2, status: 'partial', depends: [0] },
    { id: 3, status: 'superseded', depends: [] },
  ];
  assert.equal(nextPhase(phases).id, 2);
  assert.equal(nextPhase(phases.map(p => ({ ...p, status: 'built' }))), null);
  // Narrowed to phase 1's goal, deps are still read from every phase.
  assert.equal(nextPhase(phases, p => p.id === 1), null);
  assert.equal(nextPhase(phases.map(p => p.id === 2 ? { ...p, status: 'built' } : p), p => p.id === 1).id, 1);
});

test('check fails on a stale roadmap and passes once regenerated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'keel-roadmap-'));
  try {
    await mkdir(join(root, '.keel'));
    await mkdir(join(root, 'docs/phases'), { recursive: true });
    await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme' }));
    await writeFile(join(root, 'docs/goals.json'), JSON.stringify([{ id: 'G0', title: 'Start', outcome: 'It starts.' }]));
    await writeFile(join(root, 'docs/phases/00-start.md'), phase());
    await assert.rejects(run({ root, mode: 'check' }), /stale/);
    await run({ root });
    assert.match(await run({ root, mode: 'check' }), /1 phases, 1 goals/);
    assert.match(await run({ root, mode: 'next' }), /^0\. A phase/);
    await writeFile(join(root, 'docs/phases/00-start.md'), phase({ status: 'partial' }));
    await assert.rejects(run({ root, mode: 'check' }), /stale/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Phase 44: a walk owed does not block the next phase, and lived-in is a project's choice.
const walkBoxes = '- [x] Built. `tests/anvil.test.mjs`\n- [ ] ⚑ by hand: the owner drops one on a coyote.\n- [ ] The release runs: `gh run list --workflow release`';

test('owes: walk parses on a partial phase whose unchecked boxes are all walks', () => {
  const p = parsePhase('04-x.md', phase({ status: 'partial', acceptance: walkBoxes, extra: 'owes: walk\n' }));
  assert.equal(p.owes, 'walk');
  assert.equal(parsePhase('04-x.md', phase({ status: 'partial', acceptance: walkBoxes })).owes, undefined, 'absent is the default');
});

test('the check refuses owes on any status but partial, an unknown value, and a partial phase with a buildable box', () => {
  for (const status of ['planned', 'designed']) {
    assert.throws(() => parsePhase('04-x.md', phase({ status, acceptance: walkBoxes, extra: 'owes: walk\n' })), /owes: walk is only for a partial phase \(this one is (planned|designed)\)/);
  }
  assert.throws(() => parsePhase('04-x.md', phase({ status: 'built', evidence: '["evidence/x.md"]', acceptance: '- [x] Did it.', extra: 'owes: walk\n' })), /owes: walk is only for a partial phase \(this one is built\)/);
  assert.throws(() => parsePhase('04-x.md', phase({ status: 'partial', acceptance: walkBoxes, extra: 'owes: time\n' })), /owes "time" is not one this script knows \(walk:/);
  // A box citing a tests/ file is still buildable; so is one naming no walk (the safe side).
  for (const box of ['- [ ] The anvil lands. `tests/anvil.test.mjs`', '- [ ] Seven nights on Acme.', '- [ ] ⚑ by hand, then `tests/anvil.test.mjs`', '- [ ] Runs: `node scripts/anvil.mjs --drop`']) {
    assert.throws(() => parsePhase('04-x.md', phase({ status: 'partial', acceptance: `${walkBoxes}\n${box}`, extra: 'owes: walk\n' })), /owes: walk, but an unchecked box is still buildable/, box);
  }
  assert.equal(isWalk('⚑ by hand: the owner.'), true);
  assert.equal(isWalk('Runs: `gh pr checks 7`'), true);
  assert.equal(isWalk('Passes: `tests/a.test.mjs`'), false);
});

test('nextPhase treats a partial owes: walk dependency as satisfied and skips the phase itself; a plain partial dependency still blocks', () => {
  const phases = [
    { id: 0, status: 'built', depends: [] },
    { id: 1, status: 'partial', owes: 'walk', depends: [0] },
    { id: 2, status: 'planned', depends: [1] },
    { id: 3, status: 'partial', depends: [0] },
    { id: 4, status: 'planned', depends: [3] },
  ];
  assert.equal(nextPhase(phases).id, 2, 'the walk owed is skipped and its dependent proceeds');
  assert.equal(nextPhase(phases, p => p.id === 1), null, 'a walk owed is never next');
  assert.equal(nextPhase(phases, p => p.id === 4), null, 'a plain partial dependency still blocks');
  assert.equal(nextPhase(phases.map(p => p.id === 1 ? { ...p, owes: undefined } : p)).id, 1, 'without owes it is next, and blocks 2');
  // owes on anything but partial satisfies nothing (the parse refuses it anyway).
  assert.equal(nextPhase(phases.map(p => p.id === 1 ? { ...p, status: 'planned' } : p), p => p.id === 2), null);
});

const roadmapOf = (config, statuses) => {
  const goals = [{ id: 'G0', title: 'Anvils', outcome: 'o' }];
  const phases = statuses.map(([status, owes], id) => ({ id, file: `0${id}-x.md`, title: `P${id}`, status, owes, since: '2026-10-02', goal: 'G0', depends: [], note: 'n', done: 'd', next: 'n' }));
  return render({ config, phases, goals });
};

test('with livedIn off the headline counts built only and names no lived-in count; with it on, as before', () => {
  const statuses = [['lived-in'], ['built'], ['partial', 'walk'], ['planned']];
  const off = roadmapOf({ name: 'Acme' }, statuses);
  assert.match(off, /^\*\*2 of 4 phases built; 1 owes a walk\.\*\* Built means implemented and checked; planned is not available\.$/m);
  assert.match(off, /^2\/4 built; 1 owes a walk\.$/m);
  assert.match(off, /\| partial, walk owed \|/);
  assert.doesNotMatch(off.replace(/^\|.*$/gm, ''), /lived[- ]in/i, 'off names no lived-in count (a phase may still say lived-in, a done status)');
  assert.equal(roadmapOf({ name: 'Acme', phases: { livedIn: false } }, statuses), off);
  assert.match(roadmapOf({ name: 'Acme' }, [['built']]), /^\*\*1 of 1 phases built\.\*\* Built means/m);
  assert.match(roadmapOf({ name: 'Acme' }, [['built']]), /^\*\*Next focus:\*\* every phase is built\.$/m);
  assert.match(roadmapOf({ name: 'Acme' }, [['built'], ['partial', 'walk']]), /^\*\*Next focus:\*\* Nothing left to build; phase 1 owes a walk\.$/m);
  const on = roadmapOf({ name: 'Acme', phases: { livedIn: true } }, statuses);
  assert.match(on, /^\*\*1 of 4 phases lived in; 2 built\.\*\* Built means implemented and checked; lived-in means repeated real use held\. Planned is not available\.$/m);
  assert.match(on, /^2\/4 built or lived-in; 1\/4 lived-in\.$/m);
  assert.match(roadmapOf({ name: 'Acme', phases: { livedIn: true } }, [['built']]), /every phase is built; go and live in them\./);
});

test('.keel/keel.json phases.livedIn: an object with a boolean, off when absent', async () => {
  assert.equal(livedInOf({}), false);
  assert.equal(livedInOf({ phases: {} }), false);
  assert.equal(livedInOf({ phases: { livedIn: true } }), true);
  assert.throws(() => livedInOf({ phases: true }), /"phases" must be an object/);
  assert.throws(() => livedInOf({ phases: { livedIn: 'yes' } }), /"phases.livedIn" must be true or false/);
  const root = await mkdtemp(join(tmpdir(), 'keel-roadmap-'));
  try {
    await mkdir(join(root, '.keel'));
    await mkdir(join(root, 'docs/phases'), { recursive: true });
    await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', phases: { livedIn: 1 } }));
    await writeFile(join(root, 'docs/goals.json'), JSON.stringify([{ id: 'G0', title: 'Start', outcome: 'It starts.' }]));
    await writeFile(join(root, 'docs/phases/00-start.md'), phase());
    await assert.rejects(run({ root, mode: 'check' }), /"phases.livedIn" must be true or false/);
    await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme' }));
    await writeFile(join(root, 'docs/phases/00-start.md'), phase({ status: 'partial', acceptance: walkBoxes, extra: 'owes: walk\n' }));
    assert.equal(await run({ root, mode: 'next' }), 'Nothing left to build; phase 0 owes a walk.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Codex on cajones#53: a walk owed under a retired goal is not outstanding.
test('nothingNext names only walks owed under live goals', () => {
  const walkBoxes = '- [x] Built.\n- [ ] ⚑ by hand: the owner reads it.';
  const live = parsePhase('04-x.md', phase({ status: 'partial', goal: 'G0', acceptance: walkBoxes, extra: 'owes: walk\n' }));
  const gone = parsePhase('05-y.md', phase({ status: 'partial', goal: 'G1', acceptance: walkBoxes, extra: 'owes: walk\n' }));
  const goals = [{ id: 'G0', title: 'Acme', outcome: 'x' }, { id: 'G1', title: 'Old Acme', outcome: 'y', retired: true }];
  assert.equal(nothingNext([live, gone], goals), 'Nothing left to build; phase 4 owes a walk.');
  assert.equal(nothingNext([gone], goals), 'Nothing left unbuilt.');
});

// Codex on cajones#54: owes: walk names a walk; a build command beside a hand step is work; the headline counts live walks only.
test('owes: walk needs an unchecked walk, a build command is never a walk, and retired walks are not counted', () => {
  assert.throws(() => parsePhase('04-x.md', phase({ status: 'partial', acceptance: '- [x] Built.', extra: 'owes: walk\n' })), /owes: walk, but no unchecked box is a walk/);
  assert.equal(isWalk('Build with `npm run build`, then ⚑ by hand: the owner reads it.'), false);
  assert.equal(isWalk('⚑ by hand: the next `codex/` PR is reviewed and read by the owner.'), true, 'a name in backticks is not a command');
  const walkBoxes = '- [x] Built.\n- [ ] ⚑ by hand: the owner reads it.';
  const gone = parsePhase('05-y.md', phase({ status: 'partial', goal: 'G1', acceptance: walkBoxes, extra: 'owes: walk\n' }));
  const done = parsePhase('04-x.md', phase({ status: 'built', goal: 'G0', evidence: '["evidence/x.md"]', acceptance: '- [x] Built.' }));
  const goals = [{ id: 'G0', title: 'Acme', outcome: 'x' }, { id: 'G1', title: 'Old Acme', outcome: 'y', retired: true }];
  const out = render({ config: { name: 'Acme' }, phases: [done, gone], goals });
  assert.match(out, /\*\*1 of 2 phases built\.\*\*/, 'no walk owed under a live goal');
});

// Codex on cajones#55: any command beside a hand step is work; a retired goal's section counts no walk.
test('any command but a gh check makes a box buildable; names and JSON do not; a retired goal owes no walk', () => {
  for (const box of ['Run `git diff --check`, then ⚑ by hand: read it.', '⚑ by hand after `pytest -q`.', '⚑ by hand once `./scripts/build.sh` ran.']) assert.equal(isWalk(box), false, box);
  for (const box of ['⚑ by hand: the owner reads `gh pr view 7 --json body`.', '⚑ by hand: `machine_prs` stays at 1 on `keel-night/`.', '⚑ by hand: the owner sets `"tend": {"schedule": "weekly"}`.']) assert.equal(isWalk(box), true, box);
  const walkBoxes = '- [x] Built.\n- [ ] ⚑ by hand: the owner reads it.';
  const gone = parsePhase('05-y.md', phase({ status: 'partial', goal: 'G1', acceptance: walkBoxes, extra: 'owes: walk\n' }));
  const goals = [{ id: 'G0', title: 'Acme', outcome: 'x' }, { id: 'G1', title: 'Old Acme', outcome: 'y', retired: '2026-10-01' }];
  const out = render({ config: { name: 'Acme' }, phases: [gone], goals });
  assert.doesNotMatch(out, /owes a walk/, 'neither the headline nor the retired section');
});

// Codex on cajones#56: a multiword label is not a command; a retired goal's row says partial, not walk owed.
test('a label of several words is a walk\'s text, not a command; a retired goal\'s phase row owes nothing', () => {
  assert.equal(isWalk('⚑ by hand: verify the `Start practice` button on a phone.'), true);
  assert.equal(isWalk('⚑ by hand after `make release`.'), false);
  // duo#84: an unlisted command is a command: two lowercase words or more. A capitalised label and a single name stay names.
  for (const box of ['⚑ by hand after `keel doctor`.', '⚑ by hand: run `acme-cli sync now`, then read it.', '⚑ by hand once `keel update --yes` ran.']) assert.equal(isWalk(box), false, box);
  for (const box of ['⚑ by hand: verify the `Start practice` button on a phone.', '⚑ by hand: `machine_prs` stays at 1.', '⚑ by hand: the next `codex/` PR is read.', '⚑ by hand: the owner sets `"tend": {"schedule": "weekly"}`.', '⚑ by hand: the `Run checks` page reads green.']) assert.equal(isWalk(box), true, box);
  const walkBoxes = '- [x] Built.\n- [ ] ⚑ by hand: the owner reads it.';
  const gone = parsePhase('05-y.md', phase({ status: 'partial', goal: 'G1', acceptance: walkBoxes, extra: 'owes: walk\n' }));
  const goals = [{ id: 'G0', title: 'Acme', outcome: 'x' }, { id: 'G1', title: 'Old Acme', outcome: 'y', retired: '2026-10-01' }];
  assert.doesNotMatch(render({ config: { name: 'Acme' }, phases: [gone], goals }), /walk owed/);
});

// Phase 51: after: (not buildable before a date) and waits: (whose walk is owed).
test('after: and waits: parse and validate', () => {
  const walk = { status: 'partial', acceptance: walkBoxes };
  assert.equal(parsePhase('04-x.md', phase({ extra: 'after: 2026-11-01\n' })).after, '2026-11-01');
  assert.equal(parsePhase('04-x.md', phase({ ...walk, extra: 'owes: walk\nwaits: time\n' })).waits, 'time');
  assert.equal(parsePhase('04-x.md', phase({ ...walk, extra: 'owes: walk\n' })).waits, undefined, 'absent: the owner\'s (waitsOf)');
  for (const bad of ['2026-13-01', '2026-02-30', 'soon', '2026-11-1', '20261101']) {
    assert.throws(() => parsePhase('04-x.md', phase({ extra: `after: ${bad}\n` })), /after .* is not a date \(YYYY-MM-DD\)/, bad);
  }
  assert.throws(() => parsePhase('04-x.md', phase({ ...walk, extra: 'owes: walk\nwaits: someone\n' })), /waits "someone" is not one this script knows \(owner, time, external/);
  assert.throws(() => parsePhase('04-x.md', phase({ ...walk, extra: 'waits: time\n' })), /waits: time says whose walk is owed, so it goes with owes: walk/);
  assert.throws(() => parsePhase('04-x.md', phase({ extra: 'waits: owner\n' })), /goes with owes: walk/);
});

test('nextPhase skips a phase before its after: date and names it on that date', () => {
  const phases = [
    { id: 0, status: 'built', depends: [] },
    { id: 1, status: 'planned', after: '2026-11-01', depends: [0] },
    { id: 2, status: 'planned', depends: [0] },
  ];
  assert.equal(nextPhase(phases, undefined, '2026-10-31').id, 2, 'the day before: skipped');
  assert.equal(nextPhase(phases, undefined, '2026-11-01').id, 1, 'on the date: next');
  assert.equal(nextPhase(phases, undefined, '2026-11-02').id, 1, 'after it: next');
  assert.equal(nextPhase(phases, undefined, null).id, 2, 'null (the generated roadmap): any dated phase waits');
  assert.equal(nextPhase(phases.slice(0, 2), undefined, '2026-10-31'), null);
  const goals = [{ id: 'G0', title: 'Acme', outcome: 'o' }];
  const full = phases.slice(0, 2).map(p => ({ ...p, goal: 'G0' }));
  assert.equal(nothingNext(full, goals, '2026-10-31'), 'Nothing left to build yet; phase 1 is on or after 2026-11-01.');
  assert.equal(focus({ phases: full, goals }, '2026-11-01').id, 1);
});

test('the generated roadmap never reads the clock: a dated phase is named "on or after", whatever the day', async () => {
  const goals = [{ id: 'G0', title: 'Anvils', outcome: 'o' }];
  const ph = (id, extra = {}) => ({ id, file: `0${id}-x.md`, title: `P${id}`, status: 'planned', since: '2026-10-02', goal: 'G0', depends: [], note: 'n', done: 'd', next: `Do ${id}.`, ...extra });
  const md = render({ config: { name: 'Acme' }, phases: [ph(0, { after: '2026-11-01' }), ph(1), ph(2, { status: 'partial', owes: 'walk', waits: 'time' })], goals });
  assert.match(md, /^\*\*Next focus:\*\* \[1\. P1\]\(phases\/01-x\.md\)\. Do 1\. \(Dated: phase 0 is on or after 2026-11-01\.\)$/m);
  assert.match(md, /\| planned, on or after 2026-11-01 \|/);
  assert.match(md, /\| partial, walk owed \(time\) \|/);
  const root = await mkdtemp(join(tmpdir(), 'keel-roadmap-'));
  try {
    await mkdir(join(root, '.keel'));
    await mkdir(join(root, 'docs/phases'), { recursive: true });
    await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme' }));
    await writeFile(join(root, 'docs/goals.json'), JSON.stringify([{ id: 'G0', title: 'Start', outcome: 'It starts.' }]));
    await writeFile(join(root, 'docs/phases/00-start.md'), phase({ extra: 'after: 2026-11-01\n' }));
    await run({ root, today: '2026-10-31' });
    assert.match(await run({ root, mode: 'check', today: '2026-11-02' }), /1 phases/, 'a day passing does not make it stale');
    assert.equal(await run({ root, mode: 'next', today: '2026-10-31' }), 'Nothing left to build yet; phase 0 is on or after 2026-11-01.');
    assert.match(await run({ root, mode: 'next', today: '2026-11-01' }), /^0\. A phase/);
    assert.equal(JSON.parse(await run({ root, mode: 'json', today: '2026-10-31' })).next, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// A phase with a ⚑ walk says what the owner is asked, in plain words (## Your part).
const asked = (part, acceptance = '- [x] Built. `npm test`\n- [ ] ⚑ by hand: the owner reads the anvil.') => phase({ status: 'partial', extra: 'owes: walk\n', acceptance })
  .replace('## Proof', `## Your part\n\n${part}\n\n## Proof`);
const plain = `- **Ask:** Decide whether Acme keeps the anvil rule.
- **Why:** It settles whether the rule
  pays for itself.
- **Look at:** [the record](../evidence/acme.md)
- **Choices:** Keep it | Drop it | Not enough data yet
- **Keeps it open:** Not enough data yet
- **Takes:** 5 minutes
- **Then:** Keep it: nothing changes. Drop it: the conductor drafts a phase. Not enough data yet: read again in November.
- **Ready:** yes

| | Before | After |
| --- | --- | --- |
| Anvils | 3 | 5 \\| 6 |`;

test('## Your part parses: each field, the choices, ready or ready when, a table, a part per box', () => {
  const p = parsePhase('05-acme.md', asked(plain));
  assert.deepEqual(p.yourPart, {
    heading: null, ask: 'Decide whether Acme keeps the anvil rule.', why: 'It settles whether the rule pays for itself.', look: '[the record](../evidence/acme.md)',
    choices: ['Keep it', 'Drop it', 'Not enough data yet'], keepsOpen: ['Not enough data yet'], takes: '5 minutes',
    then: 'Keep it: nothing changes. Drop it: the conductor drafts a phase. Not enough data yet: read again in November.',
    ready: true, table: { head: ['', 'Before', 'After'], rows: [['Anvils', '3', '5 | 6']] },
  });
  assert.equal(yourPartReady(p.yourPart), true);
  assert.deepEqual(['Keep it', 'Drop it', 'Not enough data yet'].map(c => thenFor(p.yourPart.then, p.yourPart.choices, c)), ['nothing changes.', 'the conductor drafts a phase.', 'read again in November.']);
  assert.equal(thenFor('Recorded either way.', ['A', 'B'], 'A'), 'Recorded either way.', 'a Then not split by choice is the whole Then');
  const later = yourPartOf(plain.replace('- **Ready:** yes', '- **Ready when:** the first weekly pass has run (Monday).'));
  assert.deepEqual(later.ready, { when: 'the first weekly pass has run (Monday).' });
  assert.equal(yourPartReady(later), false);
  assert.equal(parsePhase('05-acme.md', phase()).yourPart, null, 'absent: null');
  const two = yourPartOf('### Box 2\n\n- **Ask:** Read one.\n- **Choices:** Fine | Not fine\n- **Ready:** yes\n\n### Box 3\n\n- **Ask:** Read two.\n- **Choices:** Fine | Not fine\n- **Ready when:** Monday.\n');
  assert.equal(two.ask, 'Read one.', 'the first part, on the phase');
  assert.deepEqual(two.parts.map(x => [x.heading, x.ask, x.ready]), [['Box 2', 'Read one.', true], ['Box 3', 'Read two.', { when: 'Monday.' }]]);
  assert.equal(yourPartReady(two), false, 'ready only when every part is');
  // The template's comment (or a line of preamble) before the headings is not a part (cajones#62).
  const kept = yourPartOf('<!-- One part per walk box. -->\nA line of preamble.\n\n### Box 2\n\n- **Ask:** Read one.\n- **Choices:** Fine | Not fine\n- **Ready:** yes\n\n### Box 3\n\n- **Ask:** Read two.\n- **Ready:** yes\n');
  assert.equal(kept.ask, 'Read one.');
  assert.deepEqual(kept.parts.map(x => x.heading), ['Box 2', 'Box 3']);
});

test('a walk with no Your part is a note from --check, never a failure; a filled-in Your part is not template text', async () => {
  const bare = phase({ status: 'partial', extra: 'owes: walk\n', acceptance: '- [x] Built. `npm test`\n- [ ] ⚑ by hand: the owner reads the anvil.' });
  assert.deepEqual(specNotes('05-acme.md', bare), ['docs/phases/05-acme.md: phase 5 has a walk but no Your part: say in plain words what the owner should do']);
  assert.deepEqual(specProblems('05-acme.md', bare), []);
  const twoWalks = phase({ status: 'partial', extra: 'owes: walk\n', acceptance: '- [x] Built. `npm test`\n- [ ] ⚑ by hand: the owner reads the anvil.\n- [ ] ⚑ by hand: the owner drops the anvil.' })
    .replace('## Acceptance', '## Your part\n\n- **Ask:** Read the anvil.\n- **Choices:** Fine | Not fine\n- **Ready:** yes\n\n## Acceptance');
  assert.ok(specNotes('05-acme.md', twoWalks).some(n => /has 2 walks but one Your part/.test(n)), 'one part for two walk boxes is noted (cajones#63)');

  assert.deepEqual(specNotes('05-acme.md', asked(plain)), []);
  assert.deepEqual(specProblems('05-acme.md', asked(plain)), [], 'Ready: yes and the rest are the phase\'s own words');
  assert.deepEqual(specNotes('05-acme.md', phase()), [], 'no walk, no note');
  assert.deepEqual(specNotes('05-acme.md', bare.replace('status: partial', 'status: built').replace('owes: walk\n', '').replace('- [ ] ⚑', '- [x] ⚑').replace('evidence: []', 'evidence: ["evidence/x.md"]')), [], 'a built phase owes nothing');
  assert.deepEqual(specNotes('05-acme.md', asked('- **Why:** Because.')), [
    'docs/phases/05-acme.md: ## Your part has no **Ask:**; say in one plain sentence what the owner does',
    'docs/phases/05-acme.md: ## Your part has no **Choices:**; list what the owner can answer, A | B',
    'docs/phases/05-acme.md: ## Your part says neither **Ready:** yes nor **Ready when:** <what first>']);
  assert.deepEqual(specNotes('05-acme.md', asked(plain.replace('- **Keeps it open:** Not enough data yet', '- **Keeps it open:** Later'))), ['docs/phases/05-acme.md: ## Your part: **Keeps it open:** names "Later", which is not one of its Choices']);
  // The template's own Your part, left as it is, is template text.
  const t = (await template()).replace('since: YYYY-MM-DD', 'since: 2026-10-03').replace(/^# .+$/m, '# Acme ships');
  assert.ok(specProblems('04-acme.md', t).some(p => p.startsWith("docs/phases/04-acme.md: ## Your part still holds the template's text") && /delete the section when the phase has no ⚑ walk/.test(p)));
  const root = await mkdtemp(join(tmpdir(), 'keel-roadmap-'));
  try {
    await mkdir(join(root, '.keel'));
    await mkdir(join(root, 'docs/phases'), { recursive: true });
    await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme' }));
    await writeFile(join(root, 'docs/goals.json'), JSON.stringify([{ id: 'G0', title: 'Start', outcome: 'It starts.' }]));
    await writeFile(join(root, 'docs/phases/05-acme.md'), bare);
    await run({ root });
    assert.match(await run({ root, mode: 'check' }), /1 note \(advice, not a failure\):\n {2}docs\/phases\/05-acme\.md: phase 5 has a walk but no Your part/);
    assert.equal(JSON.parse(await run({ root, mode: 'json' })).phases[0].yourPart, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePhase, validateGraph, nextPhase, focus, render, run, specProblems, uncheckedBoxes, sectionsOf, PLACEHOLDERS, PLACEHOLDER_TITLE, SURFACES } from '../scripts/roadmap.mjs';

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
  assert.match(md, /0 of 2 phases lived in/);
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

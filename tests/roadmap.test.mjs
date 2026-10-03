import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePhase, validateGraph, nextPhase, focus, render, run } from '../scripts/roadmap.mjs';

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

test('rejects what would let the roadmap lie', () => {
  const cases = [
    ['bad name', 'phase.md', phase()],
    ['unknown status', '01-x.md', phase({ status: 'done' })],
    ['impossible date', '01-x.md', phase({ since: '2026-02-30' })],
    ['built without evidence', '01-x.md', phase({ status: 'built', acceptance: '- [x] Did it.' })],
    ['built with unchecked acceptance', '01-x.md', phase({ status: 'built', evidence: '["evidence/x.md"]' })],
    ['unknown field', '01-x.md', phase({ extra: 'owner: me\n' })],
    ['no checkboxes', '01-x.md', phase({ acceptance: 'It works.' })],
    ['missing section', '01-x.md', phase().replace('## Proof\n\nA command.\n', '')],
  ];
  for (const [why, file, raw] of cases) assert.throws(() => parsePhase(file, raw), undefined, why);
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

// keel board and keel walk (phase 51): a synthetic Acme project and fleet,
// every source injected (no network: the reviews and the fleet are stubs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { board, boardText, reviewItems, walkDone, walkDecide, serve, pageHtml, boardView } from '../lib/board.mjs';
import vm from 'node:vm';
import { formatProposal } from '../lib/learn.mjs';
import { run as roadmap } from '../practices/phases/files/scripts/roadmap.mjs';
import { run } from './helpers/run.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-08';

const phase = ({ status = 'planned', depends = '[]', evidence = '[]', acceptance, extra = '', title = 'An Acme phase', next = 'Build the anvil.' }) => `---
status: ${status}
since: 2026-10-01
goal: G0
depends: ${depends}
note: "Acme."
evidence: ${evidence}
${extra}---

# ${title}

## Done when

The anvil lands.

## Scope

Small.

## Acceptance

${acceptance}

## Proof

A command.

## Deliberately open

Nothing yet.

## Next action

${next}

## Trajectory

- **2026-10-01** — Acme started.
`;

const built = '- [x] Built. `tests/anvil.test.mjs`';
const walkBox = '- [ ] ⚑ by hand: the owner drops one on a coyote.';

/** An Acme project: a walk owed (owner, time, external), a dated phase, a buildable one, a health proposal and a lesson. */
async function acme({ git = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'keel-board-'));
  const w = async (p, text) => { await mkdir(dirname(join(root, p)), { recursive: true }); await writeFile(join(root, p), text); };
  await w('.keel/keel.json', JSON.stringify({ name: 'Acme', repo: 'acme/app', keel: 'self', inbox: 'acme/inbox' }));
  await w('docs/goals.json', JSON.stringify([{ id: 'G0', title: 'Anvils', outcome: 'They land.' }]));
  await w('docs/evidence/acme-0.md', '# Evidence: phase 0\n');
  await w('docs/evidence/acme-1.md', '# Evidence: phase 1\n\n## Automated checks\n\n- ok\n');
  await w('docs/phases/00-start.md', phase({ status: 'built', evidence: '["evidence/acme-0.md"]', acceptance: '- [x] Started. `tests/a.test.mjs`', next: 'None.' }));
  await w('docs/phases/01-walk.md', phase({ status: 'partial', evidence: '["evidence/acme-1.md"]', acceptance: `${built}\n${walkBox}`, extra: 'owes: walk\n', title: 'The owner walks it', next: '⚑ The owner drops one.' }));
  await w('docs/phases/02-nights.md', phase({ status: 'partial', acceptance: `${built}\n- [ ] ⚑ by hand: seven nights pass green.`, extra: 'owes: walk\nwaits: time\n', title: 'Seven nights' }));
  await w('docs/phases/03-later.md', phase({ acceptance: '- [ ] Lands. `tests/later.test.mjs`', extra: 'after: 2026-11-01\n', title: 'Not before November' }));
  await w('docs/phases/04-build.md', phase({ depends: '[0]', acceptance: '- [ ] Lands. `tests/build.test.mjs`', title: 'Build the anvil' }));
  await w('docs/phases/05-secret.md', phase({ status: 'partial', acceptance: `${built}\n- [ ] ⚑ by hand: Acme Corp sets the secret.`, extra: 'owes: walk\nwaits: external\n', title: 'A secret set elsewhere' }));
  await w('docs/phases/06-two.md', phase({ status: 'partial', acceptance: `${built}\n- [ ] ⚑ by hand: the owner reads one.\n- [ ] ⚑ by hand: the owner reads two.`, extra: 'owes: walk\n', title: 'Two walks' }));
  await w('docs/phases/07-mixed.md', phase({ status: 'partial', acceptance: `${walkBox}\n- [ ] Still to build. \`tests/mixed.test.mjs\``, title: 'Mixed' }));
  await w('docs/phases/08-bare.md', phase({ status: 'partial', acceptance: `${built}\n${walkBox}`, extra: 'owes: walk\n', title: 'No evidence yet' }));
  await w('docs/phases/09-name.md', phase({ depends: '[0]', acceptance: '- [ ] Named. `tests/name.test.mjs`', title: 'Name the anvil', next: '⚑ The owner picks a name.' }));
  await w('docs/health/2026-10-06.md', '# Acme health\n\n## Proposal\n\n**`old_measure`** (outside) — an older one.\n');
  await w('docs/health/2026-10-07.md', '# Acme health\n\n## Measures\n\nfine\n\n## Proposal\n\n**`escapes`** (outside) — Make phase 4 the next hygiene target.\n\nA person decides whether this becomes a phase, or declines it.\n\n## Notes\n\nAcme.\n');
  await w('docs/inbox/2026-10-07-acme-lesson.md', formatProposal({ meta: { kind: 'lesson', from: 'acme/app', status: 'proposed', outcome: 'lesson', note: 'Acme anvils drop twice' }, title: 'Anvils drop twice', claim: 'They drop twice.', read: 'A real shape.' }));
  await w('fleet.json', JSON.stringify([{ repo: 'acme/app', kind: 'node', role: 'managed' }, { repo: 'acme/site', kind: 'web', role: 'managed' }]));
  await roadmap({ root, today: TODAY });
  if (git) {
    execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
    execFileSync('git', ['-C', root, 'add', '-A']);
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'acme']);
  }
  return root;
}

const looseData = root => ({ projects: [
  { repo: 'acme/app', dir: root, items: [
    { kind: 'repo', title: 'acme/stray', move: 'add it to fleet.json, or delete it (⚑ yours)', commands: ['gh repo view acme/stray'] },
    { kind: 'branch', title: 'acme-wip', move: 'open a PR for it', commands: ['git log'] },
    { kind: 'file', title: 'notes.md', move: 'commit it', commands: [] },
    { kind: 'file', title: 'anvil.mjs', move: 'commit it', commands: [] },
    { kind: 'health', title: 'health proposal: escapes', move: 'decide it', commands: [] },
    { kind: 'review', title: 'reviews', move: 'answer', commands: [] },
    { kind: 'phase', phase: 1, title: 'phase 1', move: 'the owner\'s step', commands: [] },
    { kind: 'session', ending: 'question', title: 'Which anvil?', move: 'answer it', commands: ['claude --resume x'] },
  ] },
] });
const prs = [{ number: 7, title: 'Acme anvils', state: 'open', url: 'https://github.com/acme/app/pull/7', unanswered: 2, oldest: '2026-10-01' },
  { number: 6, title: 'Merged', state: 'merged', url: 'https://github.com/acme/app/pull/6', unanswered: 1, oldest: '2026-10-02' }];
const fleetData = { rows: [
  { repo: 'acme/app', role: 'managed', branch: 'main', adopted: true, practice: { version: '0.8.21', behind: 'current' }, health: { state: 'fresh', last: '2026-10-07' }, ci: { state: 'green' } },
  { repo: 'acme/site', role: 'managed', branch: 'main', adopted: true, practice: { version: '0.8.20', behind: '0.8.20 → 0.8.21' }, health: { state: 'fresh', last: '2026-10-07' }, ci: { state: 'red', workflow: 'check', conclusion: 'failure', at: '2026-10-07T03:00:00Z' } },
] };
const deps = root => ({ today: TODAY, looseEnds: async () => looseData(root),
  reviews: list => reviewItems(list, { today: TODAY, read: async ({ repo }) => repo === 'acme/app' ? prs : [] }), fleet: async () => fleetData });
const titles = (data, waits) => data.items.filter(i => i.waits === waits).map(i => i.title);

test('keel board --json puts each kind of item in its column, from every source', async () => {
  const root = await acme();
  try {
    const data = await board({ root }, deps(root));
    const owner = titles(data, 'owner');
    assert.ok(owner.includes('phase 1: The owner walks it'), 'a ⚑ walk is yours');
    assert.ok(owner.includes('phase 6: Two walks'));
    assert.ok(owner.includes('health proposal (2026-10-07): escapes'), 'the newest page\'s proposal, not an older one');
    assert.ok(owner.some(t => t.startsWith('lesson to decide: Anvils drop twice')));
    assert.ok(owner.includes('acme/app: acme/stray'), 'a loose end marked ⚑ yours');
    assert.ok(owner.includes('acme/app: "Which anvil?"'), 'a question a session asked');
    assert.ok(owner.includes('phase 9: Name the anvil'), 'a buildable phase whose next action is ⚑ is the owner\'s step');
    assert.ok(!owner.some(t => /old_measure/.test(t)));
    // Home's health and phase-1 items and every review come from their own sources: never twice.
    assert.equal(data.items.filter(i => /escapes/.test(i.title)).length, 1);
    assert.equal(data.items.filter(i => /phase 1\b/.test(i.title)).length, 1);
    assert.deepEqual(titles(data, 'agent'), ['phase 4: Build the anvil', 'phase 7: Mixed', 'acme/app: 2 uncommitted files', 'acme/app: acme-wip'], 'buildable phases in order, then the agent\'s loose ends, files as one');
    assert.deepEqual(titles(data, 'time'), ['phase 2: Seven nights', 'phase 3: Not before November'], 'a waits: time walk and an after: phase');
    assert.match(data.items.find(i => i.phase === 3).why, /not buildable before 2026-11-01/);
    assert.deepEqual(titles(data, 'external'), ['phase 5: A secret set elsewhere']);
    assert.deepEqual(titles(data, 'broken').sort(), ['acme/app#7: 2 review comments unanswered', 'acme/site: CI red on main'], 'an open PR\'s unanswered review and a red CI; a merged PR is not listed');
    // Actions settle a "yours" item through a verb.
    const walk = data.items.find(i => i.phase === 1);
    assert.deepEqual(walk.actions.map(a => [a.verb, a.args]), [['walk done', ['1', '--note', 'Looks good.']], ['walk done', ['1']]]);
    assert.equal(walk.actions[1].note, 'required');
    assert.deepEqual(data.items.find(i => i.phase === 6).actions.map(a => a.args.join(' ')), ['6 --box 2 --note Looks good.', '6 --box 2', '6 --box 3 --note Looks good.', '6 --box 3']);
    assert.deepEqual(data.items.find(i => i.kind === 'proposal').actions.map(a => [a.verb, ...a.args].join(' ')), ['walk decide --proposal docs/health/2026-10-07.md --accept', 'walk decide --proposal docs/health/2026-10-07.md --decline']);
    assert.deepEqual(data.items.find(i => i.kind === 'lesson').actions.map(a => [a.verb, ...a.args].join(' ')), ['learn decide acme-lesson accepted', 'learn decide acme-lesson declined']);
    assert.deepEqual(data.fleet.map(r => [r.repo, r.ci]), [['acme/app', 'green'], ['acme/site', 'red']]);
    assert.deepEqual(data.sources.map(s => [s.source, s.state]), [['roadmap', 'ok'], ['loose-ends', 'ok'], ['reviews', 'ok'], ['health', 'ok'], ['inbox', 'ok'], ['fleet', 'ok']]);
    assert.deepEqual(data.counts, { owner: 8, broken: 2, agent: 4, time: 2, external: 1 });
    // A fleet row that could not be read: the strip says so, and the source is partial.
    const some = await board({ root }, { ...deps(root), fleet: async () => ({ rows: [...fleetData.rows, { repo: 'acme/lost', role: 'managed', unreadable: 'HTTP 404' }] }) });
    assert.deepEqual(some.fleet.at(-1), { repo: 'acme/lost', unreadable: 'HTTP 404' });
    assert.deepEqual(['partial', 'unreadable: acme/lost: HTTP 404'], [some.sources.at(-1).state, some.sources.at(-1).why]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a source that cannot be read is n/a with why, never missing', async () => {
  const root = await acme();
  try {
    const data = await board({ root }, { ...deps(root),
      reviews: list => reviewItems(list, { today: TODAY, read: async () => { throw new Error('gh: could not resolve host'); } }),
      fleet: async () => { throw new Error('gh: HTTP 401'); },
      looseEnds: async () => { throw new Error('fleet.json: Unexpected token'); } });
    const by = Object.fromEntries(data.sources.map(s => [s.source, s]));
    assert.equal(by.reviews.state, 'n/a');
    assert.match(by.reviews.why, /GitHub could not be read: acme\/app: gh: could not resolve host/);
    assert.deepEqual([by.fleet.state, by.fleet.why], ['n/a', 'gh: HTTP 401']);
    assert.deepEqual([by['loose-ends'].state, by['loose-ends'].why], ['n/a', 'fleet.json: Unexpected token']);
    assert.equal(by.roadmap.state, 'ok', 'the others are still read');
    assert.ok(titles(data, 'owner').includes('phase 1: The owner walks it'));
    // One repo of two failing is partial, and says which.
    const half = await board({ root }, { ...deps(root), reviews: list => reviewItems(list, { today: TODAY, read: async ({ repo }) => { if (repo === 'acme/site') throw new Error('HTTP 404'); return prs; } }) });
    const reviews = half.sources.find(s => s.source === 'reviews');
    assert.equal(reviews.state, 'partial');
    assert.match(reviews.why, /not read: acme\/site: HTTP 404/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const snapshot = async root => Object.fromEntries(await Promise.all(['docs/phases/01-walk.md', 'docs/phases/07-mixed.md', 'docs/evidence/acme-1.md', 'docs/ROADMAP.md'].map(async p => [p, await readFile(join(root, p), 'utf8')])));

test('keel walk done checks the walk, appends the owner\'s read, and moves a phase with nothing else open to built', async () => {
  const root = await acme({ git: true });
  try {
    const r = await walkDone({ root, phase: '1', note: 'Dropped one; it | landed.', today: TODAY });
    assert.equal(r.data.status, 'built');
    const text = await readFile(join(root, 'docs/phases/01-walk.md'), 'utf8');
    assert.match(text, /^status: built$/m);
    assert.match(text, /^since: 2026-10-08$/m);
    assert.doesNotMatch(text, /^owes:/m);
    assert.match(text, /- \[x\] ⚑ by hand: the owner drops one on a coyote\./);
    assert.match(text, /## Next action\n\nNone\.\n\n## Trajectory\n/, 'Next action None, the Trajectory kept');
    const ev = await readFile(join(root, 'docs/evidence/acme-1.md'), 'utf8');
    assert.match(ev, /## Automated checks\n\n- ok\n\n## The owner's read \(2026-10-08\)\n\n\| Walked \| The owner's note \|\n\| --- \| --- \|\n\| ⚑ by hand: the owner drops one on a coyote\. \| Dropped one; it \\\| landed\. \|\n$/);
    assert.match(r.text, /left as a diff: commit it when the gate passes/i);
    assert.match(r.data.diff, /^-- \[ \] ⚑ by hand/m, 'the working-tree diff is printed');
    assert.match(r.data.diff, /^\+status: built$/m);
    // The roadmap was regenerated: its check passes on the result.
    assert.match(await roadmap({ root, mode: 'check', today: TODAY }), /Checked roadmap/);
    assert.equal(execFileSync('git', ['-C', root, 'log', '--oneline'], { encoding: 'utf8' }).trim().split('\n').length, 1, 'nothing committed');
    // waits: dropped too.
    await walkDone({ root, phase: '2', note: 'Seven green nights.', today: TODAY });
    assert.doesNotMatch(await readFile(join(root, 'docs/phases/02-nights.md'), 'utf8'), /^(owes|waits):/m);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a phase with a buildable box left stays partial; several walks need --box; no evidence yet makes a file', async () => {
  const root = await acme({ git: true });
  try {
    const mixed = await walkDone({ root, phase: '7', note: 'Read it.', today: TODAY });
    assert.equal(mixed.data.status, 'partial');
    const text = await readFile(join(root, 'docs/phases/07-mixed.md'), 'utf8');
    assert.match(text, /^status: partial$/m);
    assert.match(text, /- \[x\] ⚑ by hand/);
    assert.match(text, /- \[ \] Still to build/);
    assert.match(text, /## Next action\n\nBuild the anvil\./, 'untouched');
    assert.equal(mixed.data.evidence, 'docs/evidence/2026-10-08-phase-7-walk.md', 'a phase with no evidence gets a file for the owner\'s read');
    assert.match(text, /^evidence: \["evidence\/2026-10-08-phase-7-walk\.md"\]$/m);
    await assert.rejects(walkDone({ root, phase: '6', note: 'x', today: TODAY }), /2 open walk boxes: name one with --box 2\|3/);
    const one = await walkDone({ root, phase: '6', box: '3', note: 'Two read.', today: TODAY });
    assert.equal(one.data.status, 'partial');
    assert.match(await readFile(join(root, 'docs/phases/06-two.md'), 'utf8'), /^owes: walk$/m, 'a walk still owed');
    assert.equal((await walkDone({ root, phase: '6', note: 'One read.', today: TODAY })).data.status, 'built');
    const bare = await walkDone({ root, phase: '8', note: 'Done.', today: TODAY });
    assert.equal(bare.data.status, 'built');
    assert.deepEqual(bare.data.created, ['docs/evidence/2026-10-08-phase-8-walk.md']);
    assert.match(await roadmap({ root, mode: 'check', today: TODAY }), /Checked roadmap/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a box that is not a walk is refused, writing nothing', async () => {
  const root = await acme();
  try {
    const before = await snapshot(root);
    await assert.rejects(walkDone({ root, phase: '7', box: '2', note: 'Looks good.', today: TODAY }), e => e.exitCode === 2 && /box 2 of phase 7 is not a walk .*Nothing written/.test(e.message));
    await assert.rejects(walkDone({ root, phase: '1', box: '1', note: 'x', today: TODAY }), /box 1 of phase 1 is not an open Acceptance box/);
    await assert.rejects(walkDone({ root, phase: '4', note: 'x', today: TODAY }), /phase 4 has no open walk box/);
    await assert.rejects(walkDone({ root, phase: '0', note: 'x', today: TODAY }), /phase 0 is built: no walk is open/);
    await assert.rejects(walkDone({ root, phase: '1', note: ' ', today: TODAY }), /--note .* is required/);
    assert.deepEqual(await snapshot(root), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// An accepted proposal's record is the person's decision and reason only: advice like
// "make it a phase" goes to the output, never into the page (the 2026-10-08 escapes
// proposal was accepted as handled, and the record must not contradict that).
test('keel walk decide --accept writes only the decision and reason; the next step is printed, not recorded', async () => {
  const root = await acme();
  try {
    const r = await walkDecide({ root, proposal: 'docs/health/2026-10-07.md', accept: 'Handled by a guard; no phase needed.', today: TODAY });
    const page = await readFile(join(root, 'docs/health/2026-10-07.md'), 'utf8');
    assert.match(page, /\*\*Decided 2026-10-08: accepted\*\* — Handled by a guard; no phase needed\.\n/);
    assert.doesNotMatch(page, /keel phase new|Next:/);
    assert.match(r.text, /keel phase new/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('keel walk decide records the decision in the proposal; the board stops listing it', async () => {
  const root = await acme();
  try {
    await assert.rejects(walkDecide({ root, proposal: 'docs/health/2026-10-07.md', decline: '', today: TODAY }), /--decline needs/);
    const r = await walkDecide({ root, proposal: 'docs/health/2026-10-07.md', decline: 'Phase 4 is next anyway.', today: TODAY });
    assert.equal(r.data.decision, 'declined');
    const page = await readFile(join(root, 'docs/health/2026-10-07.md'), 'utf8');
    assert.match(page, /declines it\.\n\n\*\*Decided 2026-10-08: declined\*\* — Phase 4 is next anyway\.\n\n## Notes\n\nAcme\.\n$/);
    await assert.rejects(walkDecide({ root, proposal: 'docs/health/2026-10-07.md', accept: '', today: TODAY }), /already declined \(2026-10-08\)/);
    const data = await board({ root }, deps(root));
    assert.ok(!data.items.some(i => i.kind === 'proposal'));
    assert.match(data.sources.find(s => s.source === 'health').why, /declined/);
    await assert.rejects(walkDecide({ root, proposal: '../elsewhere.md', accept: '', today: TODAY }), /outside the project/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---- the server ----------------------------------------------------------------

const http = (port, { method = 'GET', path = '/', headers = {}, body } = {}) => new Promise((done, fail) => {
  const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
    let text = '';
    res.on('data', c => { text += c; });
    res.on('end', () => done({ status: res.statusCode, text, headers: res.headers }));
  });
  req.on('error', fail);
  req.end(body);
});

const synthetic = {
  ok: true, name: 'Acme', today: TODAY, counts: { owner: 2, broken: 1, agent: 2, time: 2, external: 0 },
  items: [
    { waits: 'owner', kind: 'walk', title: 'phase 1: The <owner> walks it', why: 'walk owed', read: 'docs/phases/01-walk.md', link: 'https://github.com/acme/app/blob/main/docs/phases/01-walk.md', source: 'roadmap', phase: 1,
      actions: [{ id: '0.0', label: 'Done — looks good', verb: 'walk done', args: ['1', '--note', 'Looks good.'] }, { id: '0.1', label: 'Done, with a note', verb: 'walk done', args: ['1'], note: 'required' }] },
    { waits: 'owner', kind: 'proposal', title: 'health proposal', why: 'w', read: 'docs/health/x.md', link: 'javascript:alert(1)', source: 'health',
      actions: [{ id: '1.0', label: 'Decline', verb: 'walk decide', args: ['--proposal', 'docs/health/x.md', '--decline'], note: 'required' }] },
    { waits: 'broken', kind: 'ci', title: 'acme/site: CI red', why: 'w', read: null, link: 'https://github.com/acme/site/actions', source: 'fleet', actions: [] },
    { waits: 'agent', kind: 'phase', title: 'phase 4: Build the anvil', why: 'w', read: null, link: null, source: 'roadmap', phase: 4, next: 'Build it.', actions: [] },
    { waits: 'agent', kind: 'branch', title: 'acme/app: acme-wip', why: 'w', read: 'git log', link: null, source: 'loose-ends', actions: [] },
    { waits: 'time', kind: 'dated', title: 'phase 3: Not before November', why: 'not buildable before 2026-11-01', after: '2026-11-01', read: null, link: null, source: 'roadmap', phase: 3, actions: [] },
    { waits: 'time', kind: 'walk', title: 'phase 2: Seven nights', why: 'walk owed (waits on time): Monday 10:18 UTC', read: null, link: null, source: 'roadmap', phase: 2, actions: [] },
  ],
  sources: [{ source: 'reviews', state: 'n/a', why: 'gh: offline' }],
  fleet: [{ repo: 'acme/site', practice: '0.8.21 current', health: '2026-10-07', ci: 'red' }],
  phases: { 1: { id: 1, title: 'The owner walks it', file: 'docs/phases/01-walk.md', link: null, goal: 'G0', status: 'partial', since: '2026-10-01', owes: 'walk', waits: 'owner', after: null, done: 'The anvil lands.', next: '⚑ The owner drops one.',
    boxes: [{ n: 1, text: 'Built. `tests/anvil.test.mjs`', checked: true, walk: false }, { n: 2, text: '⚑ by hand: the owner drops one.', checked: false, walk: true }], trajectory: ['**2026-10-01** — Acme started.'], evidence: [] } },
  roadmap: { built: 1, total: 4, owed: 1, headline: '1 of 4 built; 1 owes a walk', goals: [{ id: 'G0', title: 'Anvils', built: 1, total: 4, owed: 1 }] },
};
const sectionAny = (html, waits) => new RegExp(`<section class="col[^"]*" data-waits="${waits}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? '';
const tiles = html => Object.fromEntries([...html.matchAll(/data-filter="(\w+)"[^>]*><span class="tile-n">(\d+)<\/span>/g)].map(m => [m[1], Number(m[2])]));

test('the page renders every column from the board\'s JSON, escaped', () => {
  const html = pageHtml(synthetic, 'tok', 'n0nce');
  for (const [w, t] of [['owner', 'Yours'], ['broken', 'Broken'], ['agent', 'The agent&#39;s'], ['waiting', 'Waiting']]) assert.match(sectionAny(html, w), new RegExp(`<h2 id="h-${w}">${t} <span class="n">`), t);
  assert.match(sectionAny(html, 'owner'), /<h3>Walks to do <span class="n">1<\/span><\/h3>/, 'yours, grouped by kind');
  assert.match(sectionAny(html, 'owner'), /<h3>Decisions <span class="n">1<\/span><\/h3>/);
  assert.match(sectionAny(html, 'owner'), /phase 1: The &lt;owner&gt; walks it/);
  assert.match(sectionAny(html, 'owner'), /<button type="button" class="btn primary" data-action="0\.0"/, 'the primary action is a real button');
  assert.match(sectionAny(html, 'owner'), /data-note-for="0\.1" data-required="1"/, 'a note opens an inline textarea, not a prompt()');
  assert.match(html, /<textarea/);
  assert.doesNotMatch(html, /prompt\(/);
  assert.match(sectionAny(html, 'broken'), /class="card bad"[\s\S]*acme\/site: CI red[\s\S]*>Open the runs</, 'broken, red, with its link');
  const agent = sectionAny(html, 'agent');
  assert.match(agent, /<li class="row is-next"[^>]*data-phase="4"[\s\S]*Build the anvil[\s\S]*<span class="pill accent">next<\/span>[\s\S]*Build it\./, 'the first phase is next, with its next action');
  assert.match(agent, /Loose ends[\s\S]*acme\/app: acme-wip/);
  const waiting = sectionAny(html, 'waiting');
  assert.match(waiting, /<h3>On a date<\/h3>[\s\S]*2026-11-01[\s\S]*Not before November[\s\S]*<h3>On something else<\/h3>[\s\S]*Seven nights[\s\S]*Monday 10:18 UTC/);
  assert.match(html, /1 of 4 built; 1 owes a walk/, 'roadmap headline');
  assert.match(html, /<rect class="fill" width="25"/, 'built/total as a bar');
  assert.match(html, /<li class="fleet-card"><a href="https:\/\/github\.com\/acme\/site"[\s\S]*?<span class="dot ci-red"/, 'the fleet strip: a card per project, CI as a dot');
  assert.match(html, /<b>reviews<\/b>: n\/a — gh: offline/, 'an n/a source is shown');
  assert.doesNotMatch(html, /href="javascript:/, 'only https links');
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /width=device-width/);
  assert.doesNotMatch(html, /<script src=|<link [^>]*href="http|@import/, 'self-contained: no CDN');
  assert.match(html, /<main id="board">/, 'landmarks');
  assert.match(html, /aria-live="polite"/, 'action results are announced');
  assert.match(html, /<input id="q" type="search"/, 'a search box');
  for (const k of ["e.key === '/'", "e.key === 'j'", "e.key === 'k'", "e.key === 'Enter'", "e.key === 'r'", "e.key === '?'"]) assert.ok(html.includes(k), `key ${k}`);
});

test('the stat tiles\' counts equal the JSON\'s', async () => {
  const root = await acme();
  try {
    const data = await board({ root }, deps(root));
    const html = pageHtml(data, 'tok', 'n0nce');
    assert.deepEqual(tiles(html), { owner: data.counts.owner, broken: data.counts.broken, agent: data.counts.agent, waiting: data.counts.time + data.counts.external });
    // The page's data is the JSON itself, for the drill-down and the refresh.
    const inline = JSON.parse(/<script type="application\/json" id="board-data" nonce="n0nce">([\s\S]*?)<\/script>/.exec(html)[1]);
    assert.deepEqual(inline.counts, data.counts);
    // The embedded script compiles (the renderer is the same function the server used).
    const script = /<script nonce="n0nce">([\s\S]*?)<\/script>/.exec(html)[1];
    assert.doesNotThrow(() => new vm.Script(script));
    assert.match(script, /function boardView\(\)/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the drill-down: each phase\'s boxes with walk flags, its next action, trajectory and evidence; progress per goal', async () => {
  const root = await acme();
  try {
    const data = await board({ root }, deps(root));
    for (const f of ['ok', 'root', 'name', 'today', 'counts', 'items', 'sources', 'fleet']) assert.ok(f in data, `${f} kept`);
    const six = data.phases[6];
    assert.deepEqual(six.boxes, [
      { n: 1, text: 'Built. `tests/anvil.test.mjs`', checked: true, walk: false },
      { n: 2, text: '⚑ by hand: the owner reads one.', checked: false, walk: true },
      { n: 3, text: '⚑ by hand: the owner reads two.', checked: false, walk: true }]);
    assert.equal(six.status, 'partial');
    assert.equal(six.owes, 'walk');
    assert.equal(six.waits, 'owner');
    assert.equal(six.done, 'The anvil lands.');
    assert.equal(six.goal, 'G0');
    assert.deepEqual(six.trajectory, ['**2026-10-01** — Acme started.']);
    assert.deepEqual(data.phases[1].evidence, [{ path: 'docs/evidence/acme-1.md', link: 'https://github.com/acme/app/blob/main/docs/evidence/acme-1.md' }]);
    assert.equal(data.phases[2].waits, 'time');
    assert.equal(data.phases[3].after, '2026-11-01');
    assert.equal(data.items.find(i => i.phase === 3).after, '2026-11-01', 'a dated item carries its date');
    assert.equal(data.phases[0].status, 'built', 'every phase, built ones too');
    assert.deepEqual(data.roadmap, { built: 1, total: 10, owed: 5, headline: '1 of 10 built; 5 owe a walk', goals: [{ id: 'G0', title: 'Anvils', built: 1, total: 10, owed: 5 }] });
    const drill = boardView().drill(six);
    assert.match(drill, /<h2 id="drill-title">Two walks<\/h2>/);
    assert.equal((drill.match(/<li class="open walk">/g) ?? []).length, 2, 'the walk boxes marked');
    assert.match(drill, /<li class="checked"><span class="box" role="img" aria-label="checked">/);
    assert.match(drill, /<code>tests\/anvil\.test\.mjs<\/code>/);
    assert.match(drill, /Acceptance <span class="n">1\/3<\/span>/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the server binds 127.0.0.1 only, refuses a request without the launch token, and runs actions through the verbs', async () => {
  const calls = [];
  const s = await serve({ root: '/acme' }, { board: async () => structuredClone(synthetic), run: async argv => { calls.push(argv); return { code: 0, out: 'ok\n', err: '' }; } });
  try {
    assert.equal(s.address, '127.0.0.1');
    assert.match(s.url, new RegExp(`^http://127\\.0\\.0\\.1:${s.port}/\\?token=[0-9a-f]{48}$`));
    assert.equal((await http(s.port)).status, 403, 'the page needs the token');
    assert.equal((await http(s.port, { path: '/?token=nope' })).status, 403);
    const page = await http(s.port, { path: `/?token=${s.token}` });
    assert.equal(page.status, 200);
    for (const c of ['Yours', 'Broken', 'The agent&#39;s', 'Waiting']) assert.match(page.text, new RegExp(`<h2 id="h-[a-z]+">${c} `));
    const post = (id, extra = {}, headers = { 'x-keel-token': s.token }) => http(s.port, { method: 'POST', path: '/action', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ id, ...extra }) });
    assert.equal((await post('0.0', {}, {})).status, 403, 'no token: refused');
    assert.equal((await post('0.0', {}, { 'x-keel-token': 'x'.repeat(48) })).status, 403, 'a wrong token: refused');
    assert.equal((await post('0.0', {}, { 'x-keel-token': s.token, origin: 'http://evil.test' })).status, 403, 'another origin: refused');
    assert.equal((await http(s.port, { path: `/?token=${s.token}`, headers: { host: `evil.test:${s.port}` } })).status, 403, 'another host (DNS rebinding): refused');
    assert.deepEqual(calls, [], 'nothing ran');
    const ok = await post('0.0');
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.text), { code: 0, out: 'ok\n', err: '', argv: ['keel', 'walk', 'done', '1', '--note', 'Looks good.'], note: 'left as a diff: commit it when the gate passes' });
    assert.equal((await post('0.1')).status, 400, 'a note required, none given');
    await post('0.1', { note: 'Saw it land.' });
    await post('1.0', { note: 'Not now.' });
    assert.equal((await post('9.9')).status, 404, 'only an action the board offered');
    assert.deepEqual(calls, [['walk', 'done', '1', '--note', 'Looks good.'], ['walk', 'done', '1', '--note', 'Saw it land.'], ['walk', 'decide', '--proposal', 'docs/health/x.md', '--decline', 'Not now.']]);
  } finally { await s.close(); }
});

test('the page carries a strict CSP, and every inline script and style carries its nonce', async () => {
  const s = await serve({ root: '/acme' }, { board: async () => structuredClone(synthetic), run: async () => ({ code: 0, out: '', err: '' }) });
  try {
    const page = await http(s.port, { path: `/?token=${s.token}` });
    const policy = page.headers['content-security-policy'];
    const nonce = /script-src 'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
    assert.ok(nonce, `a script nonce in ${policy}`);
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, new RegExp(`style-src 'nonce-${nonce.replace(/[+/=]/g, '\\$&')}'`));
    assert.match(policy, /connect-src 'self'/);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|https?:/, 'nothing loosened, nothing from elsewhere');
    const tags = [...page.text.matchAll(/<(script|style)\b([^>]*)>/g)];
    assert.ok(tags.length >= 3, 'the style, the data and the script');
    for (const [tag, , attrs] of tags) assert.ok(attrs.includes(`nonce="${nonce}"`), `${tag} carries the nonce`);
    assert.doesNotMatch(page.text, /\son[a-z]+="/, 'no inline event handlers (the CSP would block them)');
    assert.doesNotMatch(page.text, /\sstyle="/, 'no style attributes (the CSP would block them)');
    const again = await http(s.port, { path: `/?token=${s.token}` });
    assert.notEqual(/nonce-([^']+)'/.exec(again.headers['content-security-policy'])[1], nonce, 'a fresh nonce on every load');
    assert.match((await http(s.port, { path: `/board.json?token=${s.token}` })).headers['content-security-policy'], /default-src 'none'/);
  } finally { await s.close(); }
});

test('the page refreshes from /board.json with the token as a header, and an action meant for a moved id is refused', async () => {
  const calls = [];
  const s = await serve({ root: '/acme' }, { board: async () => structuredClone(synthetic), run: async argv => { calls.push(argv); return { code: 0, out: 'phase 1: box 2 checked.\n\ndiff --git a/x b/x\n', err: '' }; } });
  try {
    assert.equal((await http(s.port, { path: '/board.json' })).status, 403, 'no token');
    assert.equal((await http(s.port, { path: '/board.json', headers: { 'x-keel-token': 'x'.repeat(48) } })).status, 403, 'a wrong token');
    assert.equal((await http(s.port, { path: '/', headers: { 'x-keel-token': s.token } })).status, 403, 'the page itself needs the URL\'s token');
    const fresh = await http(s.port, { path: '/board.json', headers: { 'x-keel-token': s.token } });
    assert.equal(fresh.status, 200);
    assert.deepEqual(JSON.parse(fresh.text).counts, synthetic.counts);
    const post = body => http(s.port, { method: 'POST', path: '/action', headers: { 'content-type': 'application/json', 'x-keel-token': s.token }, body: JSON.stringify(body) });
    const moved = await post({ id: '0.0', expect: 'walk decide --proposal docs/health/x.md --decline' });
    assert.equal(moved.status, 409);
    assert.match(JSON.parse(moved.text).error, /board changed/);
    assert.deepEqual(calls, [], 'nothing ran');
    // The verb's output comes back for the card to show: the result, then the diff.
    const ok = await post({ id: '0.0', expect: 'walk done 1 --note Looks good.' });
    assert.equal(ok.status, 200);
    const j = JSON.parse(ok.text);
    assert.equal(j.code, 0);
    assert.match(j.out, /box 2 checked[\s\S]*diff --git/);
    assert.equal(j.note, 'left as a diff: commit it when the gate passes');
    assert.deepEqual(calls, [['walk', 'done', '1', '--note', 'Looks good.']]);
  } finally { await s.close(); }
});

test('keel board --json and keel walk run from the CLI'
, async () => {
  const root = await acme();
  try {
    const gh = join(root, 'no-gh');
    const env = { ...process.env, KEEL_GH: gh, KEEL_CLAUDE_DIR: join(root, 'no-claude'), KEEL_FLEET_PRACTICE: '0.8.21' };
    const r = run(process.execPath, [join(KEEL, 'bin', 'keel.mjs'), 'board', '--json'], { cwd: root, env });
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.ok(titles(data, 'owner').includes('phase 1: The owner walks it'));
    assert.equal(data.sources.find(s => s.source === 'reviews').state, 'n/a', 'gh missing: n/a, with why');
    const bad = run(process.execPath, [join(KEEL, 'bin', 'keel.mjs'), 'walk', 'done', '7', '--box', '2', '--note', 'x', '--json'], { cwd: root, env });
    assert.equal(bad.status, 2);
    assert.match(JSON.parse(bad.stdout).error, /not a walk/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---- Your part: the owner's ask in plain words ------------------------------------------

const yourPart = ({ ready = '- **Ready:** yes', table = '' } = {}) => `## Your part

- **Ask:** Decide whether to keep the anvil rule.
- **Why:** It settles whether Acme keeps paying for it.
- **Look at:** [the record](../evidence/acme-1.md).
- **Choices:** Keep it | Drop it | Not enough data yet
- **Keeps it open:** Not enough data yet
- **Takes:** 5 minutes
- **Then:** Keep it: nothing changes. Drop it: the conductor drafts a phase that retires it. Not enough data yet: it is read again in November.
${ready}
${table}`;

/** The Acme project, plus a walk with a ready Your part (10) and one that is not ready yet (11). */
async function acmeAsks(opts) {
  const root = await acme(opts);
  const ready = phase({ status: 'partial', evidence: '["evidence/acme-1.md"]', acceptance: `${built}\n${walkBox}`, extra: 'owes: walk\n', title: 'The anvil rule' })
    .replace('## Proof', `${yourPart({ table: '\n| | Before | After |\n| --- | --- | --- |\n| Anvils dropped | 3 | 5 |\n' })}\n## Proof`);
  const later = phase({ status: 'partial', acceptance: `${built}\n- [ ] ⚑ by hand: the owner reads the cooled anvil.`, extra: 'owes: walk\n', title: 'The cooled anvil' })
    .replace('## Proof', `${yourPart({ ready: '- **Ready when:** the anvil has cooled (Monday).' })}\n## Proof`);
  await writeFile(join(root, 'docs/phases/10-rule.md'), ready);
  await writeFile(join(root, 'docs/phases/11-cooled.md'), later);
  await roadmap({ root, today: TODAY });
  if (opts?.git) { execFileSync('git', ['-C', root, 'add', '-A']); execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'asks']); }
  return root;
}

test('a ready walk with a Your part leads with its Ask and offers one button per choice; a walk without one is marked', async () => {
  const root = await acmeAsks();
  try {
    const data = await board({ root }, deps(root));
    const walk = data.items.find(i => i.phase === 10);
    assert.equal(walk.waits, 'owner');
    assert.equal(walk.ask, 'Decide whether to keep the anvil rule.');
    assert.equal(walk.yourPart.takes, '5 minutes');
    assert.deepEqual(walk.yourPart.table, { head: ['', 'Before', 'After'], rows: [['Anvils dropped', '3', '5']] });
    assert.equal(walk.yourPart.look, '[the record](https://github.com/acme/app/blob/main/docs/evidence/acme-1.md).', 'a relative link points at the repo');
    assert.deepEqual(walk.actions.map(a => [a.label, a.args.join(' '), a.note]), [
      ['Keep it', '10 --choice Keep it', 'optional'], ['Drop it', '10 --choice Drop it', 'optional'], ['Not enough data yet', '10 --choice Not enough data yet', 'optional']]);
    assert.equal(walk.actions[1].then, 'the conductor drafts a phase that retires it.', 'each choice carries its own Then');
    const html = pageHtml(data, 'tok', 'n0nce');
    const card = new RegExp(`<article class="card yp"[^>]*data-phase="10"[\\s\\S]*?</article>`).exec(html)?.[0] ?? '';
    assert.match(card, /<p class="yp-label"><button type="button" class="title-btn" data-drill="10"[^>]*>Phase 10 · The anvil rule<\/button><\/p>\s*<h4 class="card-title ask">Decide whether to keep the anvil rule\.<\/h4>/, 'the Ask is the headline; the phase a small label that opens the drill-down');
    assert.match(card, /<p class="why">It settles whether Acme keeps paying for it\.<\/p>/);
    assert.match(card, /<table class="yp-table">[\s\S]*<th scope="row">Anvils dropped<\/th><td>3<\/td><td>5<\/td>/, 'the table is drawn');
    assert.match(card, /<a href="https:\/\/github\.com\/acme\/app\/blob\/main\/docs\/evidence\/acme-1\.md"/);
    assert.match(card, /<p class="takes">Takes 5 minutes<\/p>/);
    const buttons = [...card.matchAll(/<button type="button" class="(btn[^"]*)" data-action="[^"]+" data-expect="([^"]+)" data-choice="([^"]+)"/g)].map(m => [m[1], m[2], m[3]]);
    assert.deepEqual(buttons, [['btn primary', 'walk done 10 --choice Keep it', 'Keep it'], ['btn', 'walk done 10 --choice Drop it', 'Drop it'], ['btn', 'walk done 10 --choice Not enough data yet', 'Not enough data yet']], 'one button per choice, the first primary');
    assert.match(card, /data-choice="Not enough data yet" data-keeps-open="1"/, 'a choice that keeps the walk open says so');
    assert.equal(walk.actions[2].keepsOpen, true);
    assert.match(card, /data-then="the conductor drafts a phase that retires it\."/, 'what happens after a choice, shown once it is made');
    assert.match(card, /data-choice-note[^>]*>with a note<\/button>/);
    assert.doesNotMatch(card, /needs plain words/);
    // A walk with no Your part: today's card, with the marker.
    const plain = new RegExp(`<article class="card"[^>]*data-phase="1"[\\s\\S]*?</article>`).exec(html)?.[0] ?? '';
    assert.match(plain, /phase 1: The owner walks it<\/button> <span class="pill warn"[^>]*>needs plain words<\/span>/);
    assert.equal(data.items.find(i => i.phase === 1).yourPart, null);
    assert.match(boardText(data), /Decide whether to keep the anvil rule\.\n {6}phase 10: The anvil rule — It settles[\s\S]*?\$ keel walk done 10 --choice "Keep it" \[--note "…"\]/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a walk whose Your part says Ready when waits, with that reason, and is never yours', async () => {
  const root = await acmeAsks();
  try {
    const data = await board({ root }, deps(root));
    const later = data.items.find(i => i.phase === 11);
    assert.equal(later.waits, 'time', 'not ready: waiting, though its waits: is the owner\'s');
    assert.equal(later.why, 'Ready when: the anvil has cooled (Monday).');
    assert.deepEqual(later.actions, []);
    assert.ok(!titles(data, 'owner').includes('phase 11: The cooled anvil'));
    const waiting = sectionAny(pageHtml(data, 'tok', 'n0nce'), 'waiting');
    assert.match(waiting, /The cooled anvil[\s\S]*?Decide whether to keep the anvil rule\.[\s\S]*?Ready when: the anvil has cooled \(Monday\)\./, 'listed under Waiting with its ask and its reason');
    assert.doesNotMatch(sectionAny(pageHtml(data, 'tok', 'n0nce'), 'owner'), /The cooled anvil/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('keel walk done --choice records the choice and its note, and refuses a choice not in the list, writing nothing', async () => {
  const root = await acmeAsks({ git: true });
  try {
    const before = await readFile(join(root, 'docs/phases/10-rule.md'), 'utf8');
    const evBefore = await readFile(join(root, 'docs/evidence/acme-1.md'), 'utf8');
    await assert.rejects(walkDone({ root, phase: '10', choice: 'Drop the anvil', today: TODAY }),
      e => e.exitCode === 2 && /"Drop the anvil" is not one of phase 10's choices: Keep it \| Drop it \| Not enough data yet\. Nothing written/.test(e.message));
    await assert.rejects(walkDone({ root, phase: '1', choice: 'Keep it', today: TODAY }), e => e.exitCode === 2 && /phase 1 has no Choices/.test(e.message), 'a walk without a Your part takes --note');
    assert.equal(await readFile(join(root, 'docs/phases/10-rule.md'), 'utf8'), before);
    assert.equal(await readFile(join(root, 'docs/evidence/acme-1.md'), 'utf8'), evBefore);
    // A choice that keeps the walk open: the row is written, nothing is ticked, the status stays.
    const r = await walkDone({ root, phase: '10', choice: 'not enough data yet', note: 'Read it again in November.', today: TODAY });
    assert.equal(r.data.choice, 'Not enough data yet', 'matched aside from case, recorded as written');
    assert.equal(r.data.then, 'it is read again in November.');
    assert.equal(r.data.keepsOpen, true);
    assert.equal(r.data.status, 'partial');
    const still = await readFile(join(root, 'docs/phases/10-rule.md'), 'utf8');
    assert.equal(still, before, 'the phase file is untouched: box open, status and owes as they were');
    assert.match(still, /^- \[ \] ⚑ by hand: the owner drops one on a coyote\.$/m);
    assert.match(await readFile(join(root, 'docs/evidence/acme-1.md'), 'utf8'), /## The owner's read \(2026-10-08\)[\s\S]*\| ⚑ by hand: the owner drops one on a coyote\. \| Chose: Not enough data yet\. Read it again in November\. \|\n$/);
    assert.match(r.text, /the walk stays open[\s\S]*Recorded; the walk stays open\.\nThen: it is read again in November\./);
    assert.equal((await board({ root }, deps(root))).items.find(i => i.phase === 10).waits, 'owner', 'still ready: the owner can choose again');
    // A closing choice still ticks the box and settles the walk.
    const closed = await walkDone({ root, phase: '10', choice: 'Drop it', today: TODAY });
    assert.equal(closed.data.keepsOpen, false);
    assert.equal(closed.data.status, 'built', 'a closing choice settles the walk like any read');
    assert.match(await readFile(join(root, 'docs/phases/10-rule.md'), 'utf8'), /^- \[x\] ⚑ by hand: the owner drops one on a coyote\.$/m);
    assert.match(await readFile(join(root, 'docs/evidence/acme-1.md'), 'utf8'), /\| Chose: Drop it\. \|\n$/);
    assert.match(await roadmap({ root, mode: 'check', today: TODAY }), /Checked roadmap/);
    // From the CLI: an unknown choice exits 2.
    const env = { ...process.env, KEEL_GH: join(root, 'no-gh') };
    const bad = run(process.execPath, [join(KEEL, 'bin', 'keel.mjs'), 'walk', 'done', '11', '--choice', 'Melt it', '--json'], { cwd: root, env });
    assert.equal(bad.status, 2);
    assert.match(JSON.parse(bad.stdout).error, /not one of phase 11's choices/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the board runs a choice through walk done, with the note written beside it', async () => {
  const calls = [];
  const root = await acmeAsks();
  try {
    const data = await board({ root }, deps(root));
    const s = await serve({ root }, { board: async () => structuredClone(data), run: async argv => { calls.push(argv); return { code: 0, out: 'ok\n', err: '' }; } });
    try {
      await http(s.port, { path: `/?token=${s.token}` });
      const a = data.items.find(i => i.phase === 10).actions[1];
      const post = body => http(s.port, { method: 'POST', path: '/action', headers: { 'content-type': 'application/json', 'x-keel-token': s.token }, body: JSON.stringify(body) });
      assert.equal((await post({ id: a.id, expect: 'walk done 10 --choice Keep it' })).status, 409, 'a button meant for another choice');
      assert.equal((await post({ id: a.id, expect: 'walk done 10 --choice Drop it' })).status, 200);
      assert.equal((await post({ id: a.id, expect: 'walk done 10 --choice Drop it', note: 'Too slow.' })).status, 200);
      assert.deepEqual(calls, [['walk', 'done', '10', '--choice', 'Drop it'], ['walk', 'done', '10', '--choice', 'Drop it', '--note', 'Too slow.']]);
    } finally { await s.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---- GitHub reads: kept 10 minutes, and never under the quota floor ---------------------

/**
 * A gh for the board's live review read: GraphQL's rateLimit probe, and the
 * repo-wide read (lib.mjs windowFragment) answering one open PR with an
 * unanswered thread and costing 3 points. Every call is logged.
 */
async function quotaGh(dir, { remaining = 4000, resetAt = '2026-10-08T22:00:00Z' } = {}) {
  const path = join(dir, 'gh'), log = join(dir, 'gh.log');
  const pr = { keelWindow: 'PullRequest', number: 7, title: 'Acme anvils', url: 'https://github.com/acme/app/pull/7', state: 'OPEN', mergedAt: null, updatedAt: '2026-10-07T00:00:00Z', author: { login: 'acme-owner' },
    reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'T1', isResolved: false, tail: { totalCount: 1, nodes: [{ databaseId: 1, author: { login: 'acme-reviewer' }, body: 'Brakes.', createdAt: '2026-10-01T09:00:00Z', url: 'https://github.com/acme/app/pull/7#c1' }] } }] },
    comments: { pageInfo: { hasPreviousPage: false }, nodes: [] }, reviews: { pageInfo: { hasPreviousPage: false }, nodes: [] } };
  await writeFile(path, `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const q = (argv.find(a => a.startsWith('query=')) ?? '').slice(6);
const rate = ${JSON.stringify({ remaining, resetAt })};
if (argv[0] === 'api' && argv[1] === 'graphql' && q.includes('KeelReviewWindow'))
  console.log(JSON.stringify({ data: { rateLimit: { cost: 3, ...rate }, repository: { open: { pageInfo: { hasNextPage: false }, nodes: [${JSON.stringify(pr)}] }, merged: { pageInfo: { hasNextPage: false }, nodes: [] } } } }));
else if (argv[0] === 'api' && argv[1] === 'graphql' && q.includes('rateLimit')) console.log(JSON.stringify({ data: { rateLimit: rate } }));
else { console.error('stub gh: unknown ' + argv.join(' ')); process.exit(1); }
`);
  await (await import('node:fs/promises')).chmod(path, 0o755);
  const calls = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { path, reads: async () => (await calls()).filter(c => c.some(a => a.includes('KeelReviewWindow'))).length, probes: async () => (await calls()).filter(c => c.some(a => a.startsWith('query=query { rateLimit'))).length };
}

test('the board keeps its GitHub reads 10 minutes: the 60 s refresh asks GitHub nothing, the Refresh button and --fresh read again, and it says what the reads cost', async () => {
  const root = await acme();
  try {
    const gh = await quotaGh(root);
    const env = { ...process.env, KEEL_GH: gh.path, KEEL_CACHE: join(root, '.cache') };
    const live = { env, today: TODAY, looseEnds: async () => looseData(root), fleet: async () => fleetData };
    const first = await board({ root }, live);
    assert.equal(first.sources.find(s => s.source === 'reviews').state, 'ok');
    assert.ok(titles(first, 'broken').includes('acme/app#7: 1 review comment unanswered'));
    const reads = await gh.reads(), probes = await gh.probes();
    assert.equal(reads, 2, 'one page for each of acme/app and acme/site');
    assert.equal(probes, 1, 'the floor asked once, for both');
    assert.deepEqual([first.github.cost, first.github.queries, first.github.remaining], [6, 2, 4000]);
    assert.ok(first.github.readAt);
    // The page's 60 s refresh: nothing asked of GitHub, the same items, the kept read's age.
    const again = await board({ root }, live);
    assert.equal(await gh.reads(), reads, 'no read inside the 10 minutes');
    assert.equal(await gh.probes(), probes, 'nor a quota probe');
    assert.deepEqual(titles(again, 'broken'), titles(first, 'broken'));
    assert.equal(again.github.readAt, first.github.readAt);
    assert.equal(again.github.cost, 0);
    assert.equal(again.github.remaining, 4000, 'the last remembered');
    // --fresh (the Refresh button): read again.
    await board({ root }, { ...live, fresh: true });
    assert.equal(await gh.reads(), reads * 2);
    // Through the page's server: /board.json (the auto refresh) keeps, ?fresh=1 (the button) reads.
    const s = await serve({ root }, live);
    try {
      const auto = await http(s.port, { path: '/board.json', headers: { 'x-keel-token': s.token } });
      assert.equal(auto.status, 200);
      assert.equal(await gh.reads(), reads * 2);
      const html = await http(s.port, { path: `/?token=${s.token}` });
      assert.match(html.text, /<p class="github-read">GitHub read (just now|\d+ min ago) · 0 points this refresh · 4000 left until \d\d:\d\d<\/p>/);
      await http(s.port, { path: '/board.json?fresh=1', headers: { 'x-keel-token': s.token } });
      assert.equal(await gh.reads(), reads * 3);
    } finally { await s.close(); }
    assert.match(pageHtml(first, 'tok', 'n'), /GitHub read just now · 6 points this refresh · 4000 left until/);
    // The page's script: the button asks fresh, the timer does not.
    assert.match(pageHtml(first, 'tok', 'n'), /fetch\(auto \? '\/board\.json' : '\/board\.json\?fresh=1'/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a kept read lasts 10 minutes, and a failed read is never kept', async () => {
  const { cachedRead } = await import('../lib/quota.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'keel-cache-'));
  try {
    const env = { KEEL_CACHE: dir };
    let n = 0;
    const read = () => cachedRead(env, 'acme', async () => ++n, { now: t0 + at });
    const t0 = Date.parse('2026-10-08T12:00:00Z');
    let at = 0;
    assert.deepEqual((await read()).value, 1);
    at = 9 * 60_000;
    assert.deepEqual([(await read()).value, (await read()).cached], [1, true]);
    at = 10 * 60_000 + 1;
    assert.deepEqual((await read()).value, 2, 'past 10 minutes: read again');
    await assert.rejects(cachedRead(env, 'down', async () => { throw new Error('gh: offline'); }, { now: t0 }));
    assert.deepEqual((await cachedRead(env, 'down', async () => 'up', { now: t0 + 1 })).value, 'up', 'the failure was not kept');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('under the quota floor the board\'s reviews are n/a, saving the quota, and GitHub is asked nothing but what is left', async () => {
  const root = await acme();
  try {
    const gh = await quotaGh(root, { remaining: 500 });
    const env = { ...process.env, KEEL_GH: gh.path, KEEL_CACHE: join(root, '.cache') };
    delete env.KEEL_QUOTA_FLOOR;
    const data = await board({ root }, { env, today: TODAY, looseEnds: async () => looseData(root), fleet: async () => fleetData });
    const reviews = data.sources.find(s => s.source === 'reviews');
    assert.equal(reviews.state, 'n/a');
    assert.match(reviews.why, /^saving your GitHub quota \(500 left until \d\d:\d\d\)$/);
    assert.equal(await gh.reads(), 0, 'no review read under the floor');
    assert.equal(await gh.probes(), 1, 'one probe for both repos');
    // A second refresh: the remembered number settles it, with no probe.
    await board({ root }, { env, today: TODAY, looseEnds: async () => looseData(root), fleet: async () => fleetData });
    assert.deepEqual([await gh.reads(), await gh.probes()], [0, 1]);
    // KEEL_QUOTA_FLOOR lowers it: the read goes ahead.
    const low = await board({ root }, { env: { ...env, KEEL_QUOTA_FLOOR: '100' }, today: TODAY, looseEnds: async () => looseData(root), fleet: async () => fleetData });
    assert.equal(low.sources.find(s => s.source === 'reviews').state, 'ok');
    assert.equal(await gh.reads(), 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

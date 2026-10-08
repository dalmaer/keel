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
import { board, reviewItems, walkDone, walkDecide, serve, pageHtml, COLUMNS } from '../lib/board.mjs';
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
    res.on('end', () => done({ status: res.statusCode, text }));
  });
  req.on('error', fail);
  req.end(body);
});

const synthetic = {
  ok: true, name: 'Acme', today: TODAY, counts: {},
  items: [
    { waits: 'owner', kind: 'walk', title: 'phase 1: The <owner> walks it', why: 'walk owed', read: 'docs/phases/01-walk.md', link: 'https://github.com/acme/app/blob/main/docs/phases/01-walk.md', source: 'roadmap',
      actions: [{ id: '0.0', label: 'Done — looks good', verb: 'walk done', args: ['1', '--note', 'Looks good.'] }, { id: '0.1', label: 'Done, with a note', verb: 'walk done', args: ['1'], note: 'required' }] },
    { waits: 'owner', kind: 'proposal', title: 'health proposal', why: 'w', read: 'docs/health/x.md', link: 'javascript:alert(1)', source: 'health',
      actions: [{ id: '1.0', label: 'Decline', verb: 'walk decide', args: ['--proposal', 'docs/health/x.md', '--decline'], note: 'required' }] },
    { waits: 'broken', kind: 'ci', title: 'acme/site: CI red', why: 'w', read: null, link: null, source: 'fleet', actions: [] },
    { waits: 'agent', kind: 'phase', title: 'phase 4: Build the anvil', why: 'w', read: null, link: null, source: 'roadmap', actions: [] },
    { waits: 'time', kind: 'dated', title: 'phase 3: Not before November', why: 'w', read: null, link: null, source: 'roadmap', actions: [] },
  ],
  sources: [{ source: 'reviews', state: 'n/a', why: 'gh: offline' }],
  fleet: [{ repo: 'acme/site', practice: '0.8.21 current', health: '2026-10-07', ci: 'red' }],
};

test('the page renders every column from the board\'s JSON, escaped', () => {
  const html = pageHtml(synthetic, 'tok');
  for (const c of ['Yours', 'Broken', 'The agent&#39;s', 'Waiting on time']) assert.match(html, new RegExp(`<h2>${c} <span class="n">`), c);
  assert.doesNotMatch(html, /Waiting on something outside/, 'the external column only when something waits outside');
  const col = waits => html.split(`<section class="col" data-waits="${waits}"`)[1].split('</section>')[0];
  assert.match(col('owner'), /phase 1: The &lt;owner&gt; walks it/);
  assert.match(col('broken'), /acme\/site: CI red/);
  assert.match(col('agent'), /phase 4: Build the anvil/);
  assert.match(col('time'), /phase 3: Not before November/);
  assert.match(html, /<td class="ci-red">red<\/td>/, 'the fleet strip');
  assert.match(html, /<b>reviews<\/b>: n\/a — gh: offline/, 'an n/a source is shown');
  assert.doesNotMatch(html, /href="javascript:/, 'only https links');
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /width=device-width/);
  assert.doesNotMatch(html, /<script src=|<link [^>]*href="http/, 'self-contained: no CDN');
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
    for (const c of COLUMNS.slice(0, 4)) assert.match(page.text, new RegExp(c.title.replace("'", '&#39;')));
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

test('keel board --json and keel walk run from the CLI', async () => {
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

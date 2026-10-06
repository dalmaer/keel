// keel learn distill (phase 31): the catalogue distilled into families, rows
// reworded and tagged, a family's guard promoted — an agent proposes, a person
// decides. Deterministic: no model, and no gh at all — every CLI run here has a
// KEEL_GH that logs and fails, and the tests assert it was never called. The
// catalogue is synthetic (Acme), tests/fixtures/distill/home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run as runCmd, cleanEnv } from './helpers/run.mjs';
import { mkdtemp, readFile, rm, writeFile, realpath, chmod, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, inboxText, proposals, parseProposal } from '../lib/learn.mjs';
import { parseLessons, lessonFingerprint } from '../lib/lessons.mjs';
import { distill, patternsText, provenanceOf, parseClaim, PATTERNS, HISTORY } from '../lib/distill.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const FIXTURE = join(KEEL, 'tests', 'fixtures', 'distill', 'home');

async function scratch(t, prefix) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A synthetic keel home, and a gh that records any call and fails it. */
async function home(t) {
  const base = await scratch(t, 'keel-distill-');
  const dir = join(base, 'home');
  await cp(FIXTURE, dir, { recursive: true });
  const log = join(base, 'gh.log'), gh = join(base, 'gh');
  await writeFile(gh, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.error('stub gh: distill must not call gh');\nprocess.exit(1);\n`);
  await chmod(gh, 0o755);
  const env = { ...cleanEnv(), KEEL_GH: gh };
  const keel = (...args) => {
    const r = runCmd(process.execPath, [BIN, ...args], { cwd: dir, env });
    return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
  };
  const ghCalls = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const text = path => readFile(join(dir, path), 'utf8').catch(() => null);
  return { dir, keel, ghCalls, text };
}

const READ = '--read';
const CITE = 'docs/lessons.md rows checked';

function ok(r, what = '') {
  assert.equal(r.code, 0, `${what}\n${r.err}${r.out}`);
  return r;
}

const familyArgs = (rows = '2,3', name = 'Exit codes hidden') =>
  ['learn', 'distill', 'propose', '--kind', 'family', '--name', name, '--rule', 'A gate reads the exit code of the whole run.', '--guard', 'pipefail in every gate; a test that a failing file goes red.', '--rows', rows, READ, CITE, '--json'];

test('the worksheet: every row with its number, cells, where and provenance; no family yet; no gh', async t => {
  const h = await home(t);
  const r = ok(h.keel('learn', 'distill', '--json'));
  const w = r.json();
  assert.deepEqual(w.summary, { rows: 5, families: 0, inFamilies: 0, untagged: 4, open: 0, since: 5 });
  assert.deepEqual(w.rows.map(x => x.n), [1, 2, 3, 4, 5]);
  assert.deepEqual(w.rows.map(x => x.provenance), ['acme/notes 3', 'acme/notes', 'acme/billing 7', 'acme/site', 'acme/notes 9']);
  assert.deepEqual(w.rows[3].where, ['vercel']);
  assert.match(w.rows[1].shape, /a \\\| b/);
  assert.equal(w.since.pass, null);
  assert.ok(w.tags.includes('vercel'));
  const text = ok(h.keel('learn', 'distill'));
  assert.match(text.out, /^rows: 5; families: 0 \(0 rows in one\); untagged: 4; open proposals: 0$/m);
  assert.match(text.out, /^where: \(untagged\); family: —; provenance: acme\/billing 7$/m);
  assert.deepEqual(await h.ghCalls(), []);
});

test('each proposal kind is recorded as a public distill proposal, citing its rows', async t => {
  const h = await home(t);
  const fam = ok(h.keel(...familyArgs())).json();
  assert.match(fam.file, /^docs\/inbox\/\d{4}-\d{2}-\d{2}-distill-family-exit-codes-hidden\.md$/);
  const p = parseProposal(await h.text(fam.file));
  assert.equal(p.meta.kind, 'distill');
  assert.equal(p.meta.status, 'proposed');
  assert.equal(p.meta.outcome, 'family');
  assert.equal(p.read, CITE);
  assert.deepEqual(parseClaim(p.claim), { kind: 'family', name: 'Exit codes hidden', rule: 'A gate reads the exit code of the whole run.',
    guard: 'pipefail in every gate; a test that a failing file goes red.', rows: '2, 3' });

  const rew = ok(h.keel('learn', 'distill', 'propose', '--kind', 'reword', '--row', '5', '--guard', 'A fixture draws from a seed it prints.', READ, CITE, '--json')).json();
  assert.deepEqual(rew.fields, { kind: 'reword', row: 5, cell: 'guard', old: 'Fixtures are seeded.', text: 'A fixture draws from a seed it prints.' });
  const tag = ok(h.keel('learn', 'distill', 'propose', '--kind', 'tag', '--row', '1', '--where', 'node, web', '--evidence', 'acme/notes is a Node web app', READ, CITE, '--json')).json();
  assert.deepEqual(tag.fields, { kind: 'tag', row: 1, old: '', where: 'node, web', evidence: 'acme/notes is a Node web app' });

  // promote needs a decided family
  const early = h.keel('learn', 'distill', 'propose', '--kind', 'promote', '--family', 'Exit codes hidden', '--check', 'x', '--practice', 'conduct', READ, CITE, '--json');
  assert.equal(early.code, 2);
  assert.match(early.json().error, /no family "Exit codes hidden"/);
  ok(h.keel('learn', 'decide', fam.slug, 'accepted', '--json'));
  const pro = ok(h.keel('learn', 'distill', 'propose', '--kind', 'promote', '--family', 'exit codes hidden', '--check', 'a lint fails a gate written without pipefail', '--practice', 'conduct', READ, 'docs/patterns.md', '--json')).json();
  assert.deepEqual(pro.fields, { kind: 'promote', family: 'Exit codes hidden', rows: '2, 3', check: 'a lint fails a gate written without pipefail', practice: 'conduct', migration: 'no' });

  // INBOX.md lists them, waiting for a decision
  assert.match(await h.text('docs/INBOX.md'), /\| distill \| reword \|/);
  ok(h.keel('learn', 'render', '--check'));
  assert.deepEqual(await h.ghCalls(), []);
});

test('refused, exit 2, writing nothing: no row, an unknown row, an unknown tag, one row, a row in a family, an uncited read', async t => {
  const h = await home(t);
  ok(h.keel('learn', 'decide', ok(h.keel(...familyArgs())).json().slug, 'accepted'));
  const before = (await readdir(join(h.dir, 'docs/inbox'))).sort();
  const cases = [
    [familyArgs(''), /cites no row/],
    [familyArgs('2,3').filter((a, i, all) => a !== '--rows' && all[i - 1] !== '--rows'), /cites no row/],
    [familyArgs('1,9', 'Other'), /no lesson 9/],
    [familyArgs('1', 'Other'), /two rows or more/],
    [familyArgs('1,3', 'Other'), /lesson 3 is already in family "Exit codes hidden"/],
    [['learn', 'distill', 'propose', '--kind', 'tag', '--row', '1', '--where', 'node,mainframe', '--evidence', 'e', READ, CITE, '--json'], /mainframe, not in practices\/lessons\/stacks.json/],
    [['learn', 'distill', 'propose', '--kind', 'tag', '--row', '7', '--where', 'node', '--evidence', 'e', READ, CITE, '--json'], /no lesson 7/],
    [['learn', 'distill', 'propose', '--kind', 'tag', '--where', 'node', '--evidence', 'e', READ, CITE, '--json'], /cites no row/],
    [['learn', 'distill', 'propose', '--kind', 'reword', '--row', '1', '--cost', 'More general.', READ, 'I looked at it', '--json'], /--read must cite/],
    [['learn', 'distill', 'propose', '--kind', 'reword', '--row', '1', '--cost', 'a', '--guard', 'b', READ, CITE, '--json'], /one cell per proposal/],
    [['learn', 'distill', 'propose', '--kind', 'promote', '--family', 'Exit codes hidden', '--check', 'x', '--practice', 'nope', READ, CITE, '--json'], /no practices\/nope\/practice.json/],
    [['learn', 'distill', 'propose', '--kind', 'merge', READ, CITE, '--json'], /--kind must be one of/],
  ];
  for (const [args, why] of cases) {
    const r = h.keel(...args);
    assert.equal(r.code, 2, `${args.join(' ')}\n${r.out}${r.err}`);
    assert.match(r.json().error, why, args.join(' '));
  }
  assert.deepEqual((await readdir(join(h.dir, 'docs/inbox'))).sort(), before);
  assert.deepEqual(await h.ghCalls(), []);
});

test('accepting a family writes docs/patterns.md: its rule, guard and every member with its number and provenance', async t => {
  const h = await home(t);
  const catalogue = await h.text('docs/lessons.md');
  const fam = ok(h.keel(...familyArgs('2,3,5'))).json();
  assert.equal(await h.text(PATTERNS), null, 'nothing reaches patterns.md before a decision');
  const d = ok(h.keel('learn', 'decide', fam.slug, 'accepted', '--json')).json();
  assert.equal(d.status, 'accepted');
  assert.equal(d.patterns, 1);
  const page = await h.text(PATTERNS);
  assert.match(page, /^## Exit codes hidden$/m);
  assert.match(page, /^\*\*Rule\.\*\* A gate reads the exit code of the whole run\.$/m);
  assert.match(page, /^\*\*Guard recipe\.\*\* pipefail in every gate/m);
  assert.match(page, /^Last pass: no commit recorded, through lesson 5\.$/m);
  for (const [n, prov] of [[2, 'acme/notes'], [3, 'acme/billing 7'], [5, 'acme/notes 9']]) {
    assert.match(page, new RegExp(`^\\| ${n} \\| [^|]+.*\\| ${prov} \\| — \\|$`, 'm'), `member ${n} keeps its number and provenance (${prov})`);
  }
  assert.doesNotMatch(page, /^\| [14] \|/m);
  assert.equal(await h.text('docs/lessons.md'), catalogue, 'a family leaves the catalogue as it was');
  // generated and checked: a hand edit (provenance dropped) is stale
  ok(h.keel('learn', 'render', '--check'));
  await writeFile(join(h.dir, PATTERNS), page.replace('acme/billing 7', ''));
  const stale = h.keel('learn', 'render', '--check', '--json');
  assert.equal(stale.code, 1);
  assert.equal(stale.json().patterns.ok, false);
  ok(h.keel('learn', 'render'));
  assert.equal(await h.text(PATTERNS), page);
  // the worksheet knows it
  const w = ok(h.keel('learn', 'distill', '--json')).json();
  assert.deepEqual(w.rows.map(r => r.family), [null, 'Exit codes hidden', 'Exit codes hidden', null, 'Exit codes hidden']);
  assert.deepEqual(w.since.rows, []);
  assert.deepEqual(await h.ghCalls(), []);
});

test('the patterns page renders each member\'s provenance from its row (a renderer that drops it fails here)', () => {
  const rows = parseLessons('| # | The shape of it | What it cost | Guard | Where |\n| --- | --- | --- | --- | --- |\n| 7 | **A thing.** *(acme/one 2)* *(acme/two)* | c | g | node |\n').rows;
  assert.equal(provenanceOf(rows[0].shape), 'acme/one 2; acme/two');
  const page = patternsText([{ name: 'F', rule: 'r', guard: 'g', rows: [7], file: 'docs/inbox/2026-10-06-distill-family-f.md', promoted: [] }], rows, { pass: 'abcdef1234567890', through: 7 });
  assert.match(page, /^\| 7 \| A thing\. \| acme\/one 2; acme\/two \| node \|$/m);
  assert.match(page, /^Last pass: `abcdef123456`, through lesson 7\.$/m);
});

test('accepting a reword replaces only that cell; the old words and the old fingerprint go to the history; provenance is carried', async t => {
  const h = await home(t);
  const before = await h.text('docs/lessons.md');
  const old = parseLessons(before).rows.find(r => r.n === 1);
  // the new shape leaves the provenance out: it is carried
  const rew = ok(h.keel('learn', 'distill', 'propose', '--kind', 'reword', '--row', '1', '--shape', 'A cached answer outlives what it was computed from.', READ, CITE, '--json')).json();
  assert.equal(rew.fields.text, '**A cached answer outlives what it was computed from.** *(acme/notes 3)*');
  const d = ok(h.keel('learn', 'decide', rew.slug, 'accepted', '--json')).json();
  assert.equal(d.lesson, 1);
  const after = await h.text('docs/lessons.md');
  const lines = [before.split('\n'), after.split('\n')];
  const changed = lines[0].map((l, i) => l === lines[1][i] ? null : i).filter(i => i !== null);
  assert.deepEqual(changed, [old.line - 1], 'only row 1 changed');
  assert.equal(lines[1][old.line - 1], '| 1 | **A cached answer outlives what it was computed from.** *(acme/notes 3)* | A deleted note showed for a day. | The cache key includes the revision. | |');
  const history = await h.text(HISTORY);
  assert.ok(history.includes(`lesson 1, shape (${rew.file}; old fingerprint ${lessonFingerprint('acme/keel', old)}): ${old.shape}`), history);
  // a second reword appends; the first stays
  const cost = ok(h.keel('learn', 'distill', 'propose', '--kind', 'reword', '--row', '1', '--cost', 'Readers saw stale data for a day.', READ, CITE, '--json')).json();
  ok(h.keel('learn', 'decide', cost.slug, 'accepted'));
  const again = await h.text(HISTORY);
  assert.ok(again.startsWith(history), 'history is appended, never rewritten');
  assert.match(again, /lesson 1, cost \([^)]*\): A deleted note showed for a day\.$/m);
  assert.doesNotMatch(again.slice(history.length), /old fingerprint/, 'a cost reword keeps the fingerprint');
  assert.deepEqual(await h.ghCalls(), []);
});

test('a reword of a row that changed since it was proposed is refused, and nothing is written', async t => {
  const h = await home(t);
  const rew = ok(h.keel('learn', 'distill', 'propose', '--kind', 'reword', '--row', '3', '--cost', 'Shipped red.', READ, CITE, '--json')).json();
  const edited = (await h.text('docs/lessons.md')).replace('A failing file shipped.', 'A failing file shipped twice.');
  await writeFile(join(h.dir, 'docs/lessons.md'), edited);
  const r = h.keel('learn', 'decide', rew.slug, 'accepted', '--json');
  assert.equal(r.code, 2);
  assert.match(r.json().error, /lesson 3's cost changed since/);
  assert.equal(await h.text('docs/lessons.md'), edited);
  assert.equal(await h.text(HISTORY), null);
  assert.equal((await proposals(h.dir)).find(p => p.slug === rew.slug).meta.status, 'proposed');
});

test('accepting a tag fills the Where cell; "universal" keeps it empty, deliberately; the untagged count falls', async t => {
  const h = await home(t);
  const tag = ok(h.keel('learn', 'distill', 'propose', '--kind', 'tag', '--row', '1', '--where', 'node,web', '--evidence', 'acme/notes 3 was in its Node web app', READ, CITE, '--json')).json();
  const uni = ok(h.keel('learn', 'distill', 'propose', '--kind', 'tag', '--row', '3', '--where', 'universal', '--evidence', 'any gate can be a subset', READ, CITE, '--json')).json();
  ok(h.keel('learn', 'decide', tag.slug, 'accepted'));
  ok(h.keel('learn', 'decide', uni.slug, 'accepted'));
  const rows = parseLessons(await h.text('docs/lessons.md')).rows;
  assert.equal(rows.find(r => r.n === 1).where, 'node, web');
  assert.equal(rows.find(r => r.n === 3).where, '');
  assert.equal(await h.text(HISTORY), null, 'filling an empty Where loses no words');
  const w = ok(h.keel('learn', 'distill', '--json')).json();
  assert.equal(w.summary.untagged, 2);
  assert.equal(w.rows.find(r => r.n === 3).universal, true);
  // re-tagging a tagged row keeps the old tags in the history
  const re = ok(h.keel('learn', 'distill', 'propose', '--kind', 'tag', '--row', '4', '--where', 'vercel,web', '--evidence', 'acme/site is a web app on Vercel', READ, CITE, '--json')).json();
  ok(h.keel('learn', 'decide', re.slug, 'accepted'));
  assert.match(await h.text(HISTORY), /lesson 4, where \([^)]*\): vercel$/m);
  assert.deepEqual(await h.ghCalls(), []);
});

test('accepting a promote opens the practice checklist; a stub only when a migration is needed; declining needs a reason', async t => {
  const h = await home(t);
  ok(h.keel('learn', 'decide', ok(h.keel(...familyArgs())).json().slug, 'accepted'));
  const promote = (...extra) => ok(h.keel('learn', 'distill', 'propose', '--kind', 'promote', '--family', 'Exit codes hidden', '--check', 'a lint fails a gate without pipefail', '--practice', 'conduct', ...extra, READ, CITE, '--json')).json();
  const a = promote();
  const no = h.keel('learn', 'decide', a.slug, 'declined', '--json');
  assert.equal(no.code, 2);
  assert.match(no.json().error, /declining needs --note/);
  const d = ok(h.keel('learn', 'decide', a.slug, 'accepted', '--json')).json();
  assert.equal(d.migration, null);
  assert.match(d.checklist[0], /^edit practices\/conduct\/ to add the check: a lint fails a gate without pipefail \(family "Exit codes hidden", lessons 2, 3\)$/);
  assert.match(await h.text(PATTERNS), /^\*\*Promoted\.\*\* a lint fails a gate without pipefail — practice `conduct`/m);
  assert.deepEqual(await readdir(join(h.dir, 'migrations')).catch(() => []), []);

  const b = promote('--migration');
  const m = ok(h.keel('learn', 'decide', b.slug, 'accepted', '--json')).json();
  assert.equal(m.migration, 'migrations/0001-conduct-exit-codes-hidden.mjs');
  const stub = await import(join(h.dir, m.migration));
  assert.equal(stub.applies(), false);
  const c = promote();
  const declined = ok(h.keel('learn', 'decide', c.slug, 'declined', '--note', 'the gate already runs every file', '--json')).json();
  assert.equal(declined.status, 'declined');
  assert.deepEqual(await h.ghCalls(), []);
});

test('nothing in a pass reads the private inbox: worksheet, proposals and decisions with no gh at all; the private counts stay', async t => {
  const h = await home(t);
  const cfg = JSON.parse(await h.text('.keel/keel.json'));
  await writeFile(join(h.dir, '.keel/keel.json'), JSON.stringify({ ...cfg, inbox: 'acme/keel-inbox' }));
  // keel's INBOX.md as a private inbox left it: counts only.
  const page = inboxText([], { repo: 'acme/keel-inbox', counts: { untriaged: 3, proposed: 1, decided: 4 } }).text;
  await writeFile(join(h.dir, 'docs/INBOX.md'), page);
  ok(h.keel('learn', 'distill'));
  const fam = ok(h.keel(...familyArgs())).json();
  const tag = ok(h.keel('learn', 'distill', 'propose', '--kind', 'tag', '--row', '5', '--where', 'universal', '--evidence', 'any test suite', READ, CITE, '--json')).json();
  ok(h.keel('learn', 'decide', fam.slug, 'accepted'));
  ok(h.keel('learn', 'decide', tag.slug, 'declined', '--note', 'not decided yet'));
  ok(h.keel('learn', 'distill', '--json'));
  assert.deepEqual(await h.ghCalls(), [], 'gh was never called');
  const after = await h.text('docs/INBOX.md');
  assert.match(after, /^## The private inbox$/m);
  assert.match(after, /^\| untriaged \| 3 \|$/m);
  assert.match(after, /^\| decided \| 4 \|$/m);
});

test('the rows since the last pass: the pass is the HEAD and last row at the latest accepted decision', async t => {
  const h = await home(t);
  ok(h.keel('learn', 'decide', ok(h.keel(...familyArgs())).json().slug, 'accepted'));
  const text = await h.text('docs/lessons.md');
  await writeFile(join(h.dir, 'docs/lessons.md'), text.replace('\n\nRows above', '\n| 6 | **A new shape.** *(acme/notes 11)* | c | g | |\n\nRows above'));
  const w = ok(h.keel('learn', 'distill', '--json')).json();
  assert.equal(w.since.through, 5);
  assert.deepEqual(w.since.rows, [6]);
  assert.equal(w.summary.since, 1);
  // the page's members are read from the catalogue, so a new row leaves it current
  ok(h.keel('learn', 'render', '--check'));
});

test('a decision that changes the catalogue re-renders the practices (docs/keel-lessons.md); one that does not, does not', async t => {
  const h = await home(t);
  const cfg = JSON.parse(await h.text('.keel/keel.json'));
  await writeFile(join(h.dir, '.keel/keel.json'), JSON.stringify({ ...cfg, practices: ['conduct', 'lessons'] }));
  const fam = ok(h.keel(...familyArgs())).json();
  const tag = ok(h.keel('learn', 'distill', 'propose', '--kind', 'tag', '--row', '2', '--where', 'node', '--evidence', 'acme/notes runs on Node', READ, CITE, '--json')).json();
  const calls = [];
  const render = async root => { calls.push(root); };
  const env = { ...cleanEnv(), KEEL_GH: '/nonexistent/gh' };
  const f = await decide({ dir: h.dir, slug: fam.slug, decision: 'accepted' }, { env, render });
  assert.equal(f.exitCode, 0);
  assert.deepEqual(calls, []);
  const d = await decide({ dir: h.dir, slug: tag.slug, decision: 'accepted' }, { env, render });
  assert.equal(d.exitCode, 0, d.text);
  assert.deepEqual(calls, [h.dir]);
  assert.equal(d.data.rendered, true);
  // a render that fails is said, and the exit is 1: keel's check would be red
  const tag2 = ok(h.keel('learn', 'distill', 'propose', '--kind', 'tag', '--row', '3', '--where', 'node', '--evidence', 'acme/billing runs on Node', READ, CITE, '--json')).json();
  const bad = await decide({ dir: h.dir, slug: tag2.slug, decision: 'accepted' }, { env, render: async () => { throw new Error('refusing'); } });
  assert.equal(bad.exitCode, 1);
  assert.match(bad.text, /run npm run render/);
});

test('distill runs at home only', async t => {
  const h = await home(t);
  const cfg = JSON.parse(await h.text('.keel/keel.json'));
  delete cfg.keel;
  await writeFile(join(h.dir, '.keel/keel.json'), JSON.stringify(cfg));
  const r = h.keel('learn', 'distill', '--json');
  assert.equal(r.code, 2);
  assert.match(r.json().error, /learn runs at home/);
});

test('the worksheet in-process equals the CLI\'s', async t => {
  const h = await home(t);
  const r = await distill({ dir: h.dir });
  assert.deepEqual(JSON.parse(JSON.stringify(r.data)), ok(h.keel('learn', 'distill', '--json')).json());
});

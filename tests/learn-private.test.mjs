// keel learn with an inbox (phase 21): lesson issues arrive on the repo keel's
// config names as `inbox`. A private inbox keeps proposals and decisions on its
// issues, and nothing quoting a claim is written in keel's tree. gh is stubbed
// at the boundary the way real gh behaves (lesson 8): `api repos/<r> -q .private`
// prints true/false and an unknown repo fails like a 404; `issue list/view
// --json` print the asked fields, labels as {name, …} objects and state
// OPEN/CLOSED; `label list` prints tab-separated rows; `issue edit
// --add-label` refuses a label the repo lacks; `issue comment` prints the
// comment URL; `issue close --comment` closes and comments. Fixtures are
// synthetic (Acme).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run as runCmd, cleanEnv } from './helpers/run.mjs';
import { mkdtemp, readFile, readdir, rm, writeFile, realpath, chmod, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueBody, parseLessons } from '../lib/lessons.mjs';
import { gather, propose, decide, render, proposals, INBOX_MD } from '../lib/learn.mjs';
import { load as loadMigrations, view } from '../lib/migrations.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const FIXTURES = join(KEEL, 'tests', 'fixtures', 'learn');
const NOW = '2026-10-04T00:00:00.000Z';
const PIN_FULL = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const UPSTREAM = 'acme/upstream', UPATH = 'skills/conduct/SKILL.md';
const INBOX = 'acme/keel-inbox';
// The thing that must never land in keel's public tree.
const MARKER = 'ACME-PRIVATE-7f3a9c-Dr-Quill-at-Larkspur-Clinic';

async function scratch(t, prefix) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A synthetic keel home (repo acme/keel) whose config names an inbox. */
async function home(t, inbox = INBOX) {
  const dir = join(await scratch(t, 'keel-inbox-'), 'home');
  await cp(join(FIXTURES, 'home'), dir, { recursive: true });
  const path = join(dir, '.keel/keel.json');
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...cfg, ...(inbox ? { inbox } : {}) }, null, 2));
  return dir;
}

/** A lesson issue the way keel lessons files one, from a private project. */
const lessonIssue = (number, n, shape, extra = {}) => {
  const fingerprint = `acme/ledger/lesson/${n}/0badc0de`;
  const payload = [`**The shape of it**\n\n${shape}`, `**What it cost**\n\nAn afternoon with ${MARKER}.`, '**Guard**\n\nA test names it.', `Source: acme/ledger docs/lessons.md, row ${n}`].join('\n\n');
  return { number, title: `lesson(acme/ledger): ${shape}`, body: issueBody('acme/ledger', { kind: 'lesson', fingerprint, payload }),
    url: `https://github.com/${INBOX}/issues/${number}`, state: 'OPEN', labels: ['lesson'], comments: [], ...extra };
};

/** A gh that behaves like gh over a JSON state file. */
async function stubGh(t, seed) {
  const dir = await scratch(t, 'keel-gh-');
  const log = join(dir, 'gh.log'), state = join(dir, 'state.json'), gh = join(dir, 'gh');
  await writeFile(state, JSON.stringify(seed));
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const has = f => argv.includes(f);
const opt = f => argv[argv.indexOf(f) + 1];
const all = f => argv.flatMap((a, i) => a === f ? [argv[i + 1]] : []);
const save = () => fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(s));
const die = m => { console.error(m); process.exit(1); };
const [a, b] = argv;
const repo = () => { const r = s.repos[opt('-R')]; if (!r) die('GraphQL: Could not resolve to a Repository with the name \\'' + opt('-R') + '\\'. (repository)'); return r; };
const label = name => { const l = repo().labels.find(l => l.name === name); return { id: 'LA_' + name, name, description: l?.description ?? '', color: 'ededed' }; };
const shape = (i, fields) => Object.fromEntries(fields.map(f => [f,
  f === 'labels' ? i.labels.map(label) : f === 'comments' ? i.comments.map(body => ({ author: { login: 'acme-owner' }, authorAssociation: 'OWNER', body })) : i[f]]));
const issue = () => { const i = repo().issues.find(i => String(i.number) === argv[2]); if (!i) die('GraphQL: Could not resolve to an issue or pull request with the number of ' + argv[2] + '.'); return i; };
if (a === 'api') {
  const m = /^repos\\/([^/]+\\/[^/]+)$/.exec(argv[1]);
  if (!m || !s.repos[m[1]]) {
    if (m) die('gh: Not Found (HTTP 404)');
    const u = new URL(argv[1], 'https://api.github.com/');
    const c = /^\\/repos\\/([^/]+\\/[^/]+)\\/commits$/.exec(u.pathname);
    if (!c) die('gh: Not Found (HTTP 404)');
    const shas = s.commits[c[1] + ':' + u.searchParams.get('path')] ?? [];
    console.log(JSON.stringify(shas.slice(0, Number(u.searchParams.get('per_page') ?? 30)).map(sha => ({ sha }))));
  } else {
    const r = { full_name: m[1], private: s.repos[m[1]].private };
    console.log(opt('-q') === '.private' ? String(r.private) : JSON.stringify(r));
  }
} else if (a === 'issue' && b === 'list') {
  const want = { open: 'OPEN', closed: 'CLOSED' }[opt('--state') ?? 'open'];
  const hits = repo().issues.filter(i => i.labels.includes(opt('--label')) && (!want || i.state === want));
  console.log(JSON.stringify(hits.map(i => shape(i, opt('--json').split(',')))));
} else if (a === 'issue' && b === 'view') {
  console.log(JSON.stringify(shape(issue(), opt('--json').split(','))));
} else if (a === 'label' && b === 'list') {
  for (const l of repo().labels) console.log(l.name + '\\t' + (l.description ?? '') + '\\t#ededed');
} else if (a === 'label' && b === 'create') {
  const r = repo();
  if (r.labels.some(l => l.name === argv[2])) die('label with name "' + argv[2] + '" already exists; use \`--force\` to update its color and description');
  r.labels.push({ name: argv[2], description: opt('--description') }); save();
} else if (a === 'issue' && b === 'edit') {
  const i = issue(), r = repo();
  for (const l of all('--add-label')) { if (!r.labels.some(x => x.name === l)) die("'" + l + "' not found"); if (!i.labels.includes(l)) i.labels.push(l); }
  for (const l of all('--remove-label')) i.labels = i.labels.filter(x => x !== l);
  save(); console.log(i.url);
} else if (a === 'issue' && b === 'comment') {
  const i = issue(); i.comments.push(opt('--body')); save();
  console.log(i.url + '#issuecomment-' + i.comments.length);
} else if (a === 'issue' && b === 'close') {
  const i = issue();
  if (i.state === 'CLOSED') { console.error('! Issue #' + i.number + ' is already closed'); process.exit(0); }
  i.state = 'CLOSED'; if (has('--comment')) i.comments.push(opt('--comment')); save();
  console.error('✓ Closed issue ' + opt('-R') + '#' + i.number);
} else die('stub gh: unknown ' + argv.join(' '));
`);
  await chmod(gh, 0o755);
  return {
    env: { ...cleanEnv(), KEEL_GH: gh },
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)),
    state: async () => JSON.parse(await readFile(state, 'utf8')),
  };
}

const seed = ({ priv = true, issues = [], labels = ['lesson'] } = {}) => ({
  repos: { [INBOX]: { private: priv, labels: labels.map(name => ({ name })), issues } },
  commits: { [`${UPSTREAM}:${UPATH}`]: [PIN_FULL] },
});

const keel = (args, cwd, env) => {
  const r = runCmd(process.execPath, [BIN, ...args], { cwd, env });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const writes = calls => calls.filter(c => !(c[0] === 'api' || (c[0] === 'issue' && ['list', 'view'].includes(c[1])) || (c[0] === 'label' && c[1] === 'list')));

/** Every file under dir (recursively), as [{ path, text }]. */
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const path = join(e.parentPath ?? e.path, e.name);
    out.push({ path, text: await readFile(path, 'utf8') });
  }
  return out;
}
const leaks = async (dir, marker = MARKER) => (await walk(dir)).filter(f => f.text.includes(marker)).map(f => f.path.slice(dir.length + 1));

const READ = 'Not in docs/lessons.md (rows 1–2 checked).';
const ROW = { shape: '**A gate that trusts its own summary line.**', cost: 'A green run that measured nothing.', guard: 'Gates read exit codes.' };

test('a public inbox: gather reads it, proposals are files as before, decide closes on the inbox', async t => {
  const dir = await home(t);
  const gh = await stubGh(t, seed({ priv: false, issues: [lessonIssue(3, 4, '**Shape four.** *(acme 4)*')] }));
  const r = await gather({ dir }, { env: gh.env, now: NOW });
  assert.equal(r.exitCode, 0, r.text);
  assert.match(r.text, new RegExp(`^issues: 1 open lesson issue on ${INBOX}$`, 'm'));
  const [p] = await proposals(dir);
  assert.equal(p.meta.issue, 3);
  assert.match(p.claim, new RegExp(MARKER), 'public: the claim is quoted, as before');
  const list = (await gh.calls()).find(c => c[0] === 'issue' && c[1] === 'list');
  assert.equal(list[list.indexOf('-R') + 1], INBOX);
  assert.ok(!(await readFile(join(dir, INBOX_MD), 'utf8')).includes('private inbox'));
  await propose({ dir, slug: p.slug, outcome: 'decline', note: 'project-specific', read: READ }, { env: gh.env });
  const d = await decide({ dir, slug: p.slug, decision: 'declined', yes: true }, { env: gh.env, now: NOW });
  assert.equal(d.data.plan.repo, INBOX);
  assert.equal((await gh.state()).repos[INBOX].issues[0].state, 'CLOSED');
});

test('no inbox: learn reads keel\'s own repo and asks nothing about privacy', async t => {
  const dir = await home(t, null);
  const gh = await stubGh(t, { ...seed(), repos: { 'acme/keel': { private: false, labels: [{ name: 'lesson' }], issues: [lessonIssue(2, 1, '**One.**')] } } });
  const r = await gather({ dir }, { env: gh.env, now: NOW });
  assert.match(r.text, /^issues: 1 open lesson issue on acme\/keel$/m);
  assert.ok(!(await gh.calls()).some(c => c[0] === 'api' && /^repos\/[^/]+\/[^/]+$/.test(c[1])));
  assert.equal((await proposals(dir)).length, 1);
});

test('a private inbox: gather lists and counts its issues, writes no proposal, and INBOX.md shows counts only', async t => {
  const dir = await home(t);
  const gh = await stubGh(t, seed({ issues: [
    lessonIssue(1, 1, `**${MARKER} shape one.**`),
    lessonIssue(2, 2, '**Shape two.**', { labels: ['lesson', 'proposed:lesson'] }),
    lessonIssue(3, 3, '**Shape three.**', { labels: ['lesson', 'decided:decline'], state: 'CLOSED' }),
  ] }));
  const r = keel(['learn', '--json'], dir, gh.env);
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.private, true);
  assert.equal(out.repo, INBOX);
  assert.deepEqual(out.counts, { untriaged: 1, proposed: 1, decided: 1 });
  assert.deepEqual(out.open.map(o => [o.issue, o.status]), [[1, 'untriaged'], [2, 'proposed']]);
  const text = keel(['learn'], dir, gh.env).out;
  assert.match(text, /^  #1 untriaged$/m);
  assert.ok(!text.includes(MARKER) && !/Shape/.test(text) && !r.out.includes(MARKER), 'the night shift prints this in public CI logs: no titles');
  assert.deepEqual(out.written, []);
  assert.deepEqual(await proposals(dir), []);
  const inbox = await readFile(join(dir, INBOX_MD), 'utf8');
  assert.match(inbox, /## The private inbox/);
  assert.ok(inbox.includes(`\`${INBOX}\``), 'the inbox is named');
  for (const [s, n] of [['untriaged', 1], ['proposed', 1], ['decided', 1]]) assert.match(inbox, new RegExp(`^\\| ${s} \\| ${n} \\|$`, 'm'));
  assert.ok(!/Shape (one|two|three)|acme\/ledger|#[123]\b/.test(inbox), 'no titles, no projects, no issue numbers');
  assert.deepEqual(await leaks(dir), []);
  // Privacy is asked once per run; the run only read.
  const calls = await gh.calls();
  assert.equal(calls.filter(c => c[0] === 'api' && c[1] === `repos/${INBOX}`).length, 2, 'once per run, two runs');
  assert.deepEqual(writes(calls), []);
  // render --check needs no access to the inbox's issues: the recorded counts are compared.
  const before = (await gh.calls()).length;
  assert.equal(keel(['learn', 'render', '--check'], dir, gh.env).code, 0);
  assert.ok(!(await gh.calls()).slice(before).some(c => c[0] === 'issue'));
  await writeFile(join(dir, INBOX_MD), inbox.replace('| proposed | 1 |', '| proposed | 7 |'));
  assert.equal((await render({ dir, check: true }, { env: gh.env })).data.private.counts.proposed, 7, 'check reads the recorded counts');
});

test('privacy unknown is private: an inbox gh cannot see is treated as private, noted, and nothing is published', async t => {
  const dir = await home(t, 'acme/unseen');
  const gh = await stubGh(t, seed());
  const r = await gather({ dir }, { env: gh.env, now: NOW });
  assert.equal(r.exitCode, 1, 'an unread inbox is a note, and the run says so');
  assert.match(r.text, /^note: inbox acme\/unseen: could not read its issues; its counts stay as recorded/m);
  assert.match(r.text, /^sources: 1 checked/m, 'the rest of the gather still runs');
  assert.deepEqual(await proposals(dir), []);
  assert.match(await readFile(join(dir, INBOX_MD), 'utf8'), /## The private inbox/);
  const calls = await gh.calls();
  assert.equal(calls[0][1], 'repos/acme/unseen');
  assert.equal(calls[1][calls[1].indexOf('--state') + 1], 'all', 'the private path');
});

test('propose on a private inbox: by issue number, a plan and exit 3 without --yes; with it, a label and a comment', async t => {
  const dir = await home(t);
  const gh = await stubGh(t, seed({ issues: [lessonIssue(12, 4, '**Shape four.**')] }));
  await gather({ dir }, { env: gh.env, now: NOW });
  const before = await walk(dir);
  const asked = keel(['learn', 'propose', '12', '--outcome', 'lesson', '--note', 'a real shape', '--read', READ, '--json'], dir, gh.env);
  assert.equal(asked.code, 3, asked.err);
  const plan = JSON.parse(asked.out);
  assert.equal(plan.needs, 'yes');
  assert.match(plan.plan.map(p => p.what).join('\n'), /gh issue edit 12 -R acme\/keel-inbox --add-label proposed:lesson/);
  assert.deepEqual(writes(await gh.calls()), [], 'nothing outward without a yes');
  assert.deepEqual(await walk(dir), before, 'nothing written');

  // The read must still cite something checked.
  assert.equal(keel(['learn', 'propose', '12', '--outcome', 'lesson', '--note', 'n', '--read', 'fine', '--yes'], dir, gh.env).code, 2);

  const yes = keel(['learn', 'propose', '12', '--outcome', 'lesson', '--note', 'a real shape', '--read', READ, '--yes', '--json'], dir, gh.env);
  assert.equal(yes.code, 0, yes.out + yes.err);
  let issue = (await gh.state()).repos[INBOX].issues[0];
  assert.deepEqual(issue.labels, ['lesson', 'proposed:lesson']);
  assert.equal(issue.comments.length, 1);
  assert.match(issue.comments[0], /^keel learn: proposed lesson\nnote: a real shape\n\nNot in docs\/lessons\.md/);
  assert.match(await readFile(join(dir, INBOX_MD), 'utf8'), /^\| proposed \| 1 \|$/m);

  // Re-proposing replaces the old proposed: label.
  await propose({ dir, slug: '12', outcome: 'link', link: '1', note: 'already ours', read: READ, yes: true }, { env: gh.env });
  issue = (await gh.state()).repos[INBOX].issues[0];
  assert.deepEqual(issue.labels, ['lesson', 'proposed:link']);
  assert.match(issue.comments[1], /^link: 1$/m);
  assert.deepEqual(await proposals(dir), []);
});

test('decide accepted on a private inbox refuses without --shape, --cost and --guard: private text is never copied', async t => {
  const dir = await home(t);
  const gh = await stubGh(t, seed({ issues: [lessonIssue(12, 4, '**Shape four.**', { labels: ['lesson', 'proposed:lesson'] })] }));
  const lessons = await readFile(join(dir, 'docs/lessons.md'), 'utf8');
  for (const extra of [[], ['--shape', 'only a shape']]) {
    const r = keel(['learn', 'decide', '12', 'accepted', '--yes', ...extra, '--json'], dir, gh.env);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(JSON.parse(r.out).error, extra.length ? /go together/ : /private.*never copied.*--shape "…" --cost "…" --guard "…"/);
  }
  assert.equal(await readFile(join(dir, 'docs/lessons.md'), 'utf8'), lessons);
  assert.deepEqual(writes(await gh.calls()), []);
  assert.equal((await gh.state()).repos[INBOX].issues[0].state, 'OPEN');
});

test('decide accepted with --shape/--cost/--guard: exactly those words become the row, provenance the project; the issue is labelled and closed', async t => {
  const dir = await home(t);
  const gh = await stubGh(t, seed({ issues: [lessonIssue(12, 4, '**Shape four.**', { labels: ['lesson', 'proposed:lesson'], comments: ['keel learn: proposed lesson\nnote: a real shape\n\nread'] })] }));
  const before = await readFile(join(dir, 'docs/lessons.md'), 'utf8');
  const asked = await decide({ dir, slug: '12', decision: 'accepted', ...ROW }, { env: gh.env, now: NOW });
  assert.equal(asked.exitCode, 3);
  assert.equal(await readFile(join(dir, 'docs/lessons.md'), 'utf8'), before, 'without --yes nothing is written');
  assert.deepEqual(writes(await gh.calls()), []);

  const r = await decide({ dir, slug: '12', decision: 'accepted', yes: true, ...ROW }, { env: gh.env, now: NOW });
  assert.equal(r.exitCode, 0, r.text);
  assert.equal(r.data.lesson, 3);
  const after = await readFile(join(dir, 'docs/lessons.md'), 'utf8');
  const row = parseLessons(after).rows.at(-1);
  assert.deepEqual([row.n, row.shape, row.cost, row.guard], [3, `${ROW.shape} *(acme/ledger)*`, ROW.cost, ROW.guard]);
  assert.equal(after.split('\n').length, before.split('\n').length + 1);
  const issue = (await gh.state()).repos[INBOX].issues[0];
  assert.equal(issue.state, 'CLOSED');
  assert.ok(issue.labels.includes('decided:lesson'));
  assert.match(issue.comments.at(-1), /^keel learn: accepted \(lesson\): keel lesson 3\. a real shape$/);
  assert.match(await readFile(join(dir, INBOX_MD), 'utf8'), /^\| decided \| 1 \|$/m);
  await assert.rejects(decide({ dir, slug: '12', decision: 'accepted', yes: true, ...ROW }, { env: gh.env }), /already decided/);
});

test('decide practice on a private inbox: the row and an inert stub written from the approved words', async t => {
  const dir = await home(t);
  const gh = await stubGh(t, seed({ issues: [lessonIssue(5, 2, '**Shape two.**', { labels: ['lesson', 'proposed:practice'] })] }));
  const r = await decide({ dir, slug: '5', decision: 'accepted', yes: true, note: 'builders test by file', ...ROW }, { env: gh.env, now: NOW });
  assert.equal(r.exitCode, 0, r.text);
  assert.equal(r.data.migration, 'migrations/0002-a-gate-that-trusts-its-own-summary-line.mjs');
  const ms = await loadMigrations(join(dir, 'migrations'));
  const m = ms.find(x => x.id === '0002-a-gate-that-trusts-its-own-summary-line');
  assert.equal(await m.applies(await view(dir)), false, 'inert until written');
  assert.ok((await gh.state()).repos[INBOX].issues[0].labels.includes('decided:practice'));
});

test('the leak test: a private claim reaches no file in keel\'s tree through gather, propose and decide', async t => {
  const dir = await home(t);
  const body = n => lessonIssue(n, n, `**${MARKER} shape ${n}.**`).body;
  const gh = await stubGh(t, seed({ labels: [], issues: [
    lessonIssue(1, 1, `**${MARKER} one.**`), lessonIssue(2, 2, `**${MARKER} two.**`), lessonIssue(3, 3, `**${MARKER} three.**`),
  ] }));
  for (const i of (await gh.state()).repos[INBOX].issues) assert.ok(i.body.includes(MARKER) && body(1).includes(MARKER));
  const step = async (args, code = 0) => {
    const r = keel(args, dir, gh.env);
    assert.equal(r.code, code, `${args.join(' ')}\n${r.out}${r.err}`);
    return r;
  };
  await step(['learn']);
  await step(['learn', 'propose', '1', '--outcome', 'lesson', '--note', 'general', '--read', READ, '--yes']);
  await step(['learn', 'propose', '2', '--outcome', 'practice', '--note', 'general', '--read', READ, '--yes']);
  await step(['learn', 'propose', '3', '--outcome', 'decline', '--note', 'specific', '--read', READ, '--yes']);
  await step(['learn', 'decide', '1', 'accepted', '--shape', ROW.shape, '--cost', ROW.cost, '--guard', ROW.guard, '--yes']);
  await step(['learn', 'decide', '2', 'accepted', '--shape', 'Another general shape.', '--cost', 'Some cost.', '--guard', 'A guard.', '--yes']);
  await step(['learn', 'decide', '3', 'declined', '--yes']);
  await step(['learn']);
  await step(['learn', 'render']);

  const state = (await gh.state()).repos[INBOX];
  assert.ok(state.issues.every(i => i.state === 'CLOSED'), 'every issue was decided on the inbox');
  assert.deepEqual(state.labels.map(l => l.name).sort(), ['decided:decline', 'decided:lesson', 'decided:practice', 'proposed:decline', 'proposed:lesson', 'proposed:practice']);
  assert.ok((await readFile(join(dir, 'docs/lessons.md'), 'utf8')).includes(ROW.shape), 'the approved row did land');
  assert.deepEqual(await leaks(dir), [], 'no file under keel\'s tree holds the private marker');
  // The walk can see a leak: plant one and it is found.
  await writeFile(join(dir, 'docs', 'planted.md'), MARKER);
  assert.deepEqual(await leaks(dir), ['docs/planted.md']);
});

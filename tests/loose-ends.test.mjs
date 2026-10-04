// keel loose-ends (phase 24): synthetic Claude Code transcripts, built from
// the real format's shapes (entry types and field names, never a real
// session's words), synthetic git repos laid out the way a person's code
// directory is, and a stub gh. Fixtures are Acme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { run as runCmd, cleanEnv } from './helpers/run.mjs';
import { looseEnds, encodeDir, parseSession, MARKS } from '../lib/looseends.mjs';
import { formatProposal } from '../lib/learn.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const MARKER = 'ACME-CHAT-PRIVATE-4e1d-Wren-at-Gullhaven';
const DAY = 86_400_000;

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function repo(dir, remote, files = { 'README.md': '# Acme\n' }) {
  await mkdir(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', `https://github.com/${remote}.git`);
  for (const [p, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'acme: start');
}

// ---- transcripts, in the shapes Claude Code writes -------------------------------

function transcript(sid, cwd, t0 = Date.now()) {
  const lines = [];
  let t = t0, parent = null;
  const base = () => {
    const uuid = randomUUID();
    const b = { parentUuid: parent, isSidechain: false, userType: 'external', entrypoint: 'cli', cwd, sessionId: sid, version: '2.1.0', gitBranch: 'main', uuid, timestamp: new Date(t += 1000).toISOString() };
    parent = uuid;
    return b;
  };
  const assistant = (content, stop) => ({ ...base(), type: 'assistant', requestId: 'req_acme',
    message: { model: 'acme-model', id: 'msg_acme', type: 'message', role: 'assistant', content, stop_reason: stop, stop_sequence: null, usage: {} } });
  const s = {
    lines,
    noise() {
      lines.push({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date(t).toISOString(), sessionId: sid, content: 'queued' });
      lines.push({ ...base(), type: 'attachment', attachment: { type: 'skill_listing', content: 'x', skillCount: 1, isInitial: true, names: ['acme'] }, rendered: [{ content: 'x' }] });
      return s;
    },
    user(text) {
      lines.push({ ...base(), type: 'user', promptId: 'p1', permissionMode: 'default', origin: { kind: 'user' }, message: { role: 'user', content: text } });
      lines.push({ type: 'last-prompt', lastPrompt: text, leafUuid: parent, sessionId: sid });
      return s;
    },
    meta(text) { lines.push({ ...base(), type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text }] } }); return s; },
    think() { lines.push(assistant([{ type: 'thinking', thinking: 'hmm', signature: 'sig' }], null)); return s; },
    say(text) { lines.push(assistant([{ type: 'text', text }], 'end_turn')); return s; },
    tool(name, input, { result = true } = {}) {
      const id = `toolu_${randomUUID().slice(0, 8)}`;
      lines.push(assistant([{ type: 'tool_use', id, name, input, caller: { type: 'direct' } }], 'tool_use'));
      if (result) lines.push({ ...base(), type: 'user', promptId: 'p1', toolUseResult: {}, sourceToolAssistantUUID: parent, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: 'ok', is_error: false }] } });
      return s;
    },
    side(text) { lines.push({ ...assistant([{ type: 'text', text }], 'end_turn'), isSidechain: true }); return s; },
    snapshot(paths) {
      lines.push({ type: 'file-history-snapshot', messageId: 'msg_acme', snapshot: { messageId: 'msg_acme', trackedFileBackups: Object.fromEntries(paths.map(p => [p, { backupFileName: null, version: 1 }])), timestamp: new Date(t).toISOString() }, isSnapshotUpdate: false });
      return s;
    },
    tail() {
      lines.push({ type: 'custom-title', customTitle: 'acme title', sessionId: sid }, { type: 'cost-state', sessionId: sid });
      return s;
    },
    text: () => `${lines.map(l => JSON.stringify(l)).join('\n')}\n`,
  };
  return s;
}

// ---- a stub gh ----------------------------------------------------------------

async function stubGh(dir, state) {
  const path = join(dir, 'gh'), statePath = join(dir, 'gh-state.json'), log = join(dir, 'gh.log');
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(path, `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'));
const opt = f => argv[argv.indexOf(f) + 1];
if (argv[0] === 'api' && argv[1] === 'user') console.log(opt('-q') === '.login' ? s.login : JSON.stringify({ login: s.login }));
else if (argv[0] === 'pr' && argv[1] === 'list') {
  if (opt('--state') !== 'open') { console.error('stub: only open'); process.exit(1); }
  const fields = opt('--json').split(',');
  console.log(JSON.stringify((s.prs[opt('-R')] ?? []).map(p => Object.fromEntries(fields.map(f => [f, p[f]])))));
} else if (argv[0] === 'repo' && argv[1] === 'list') {
  const fields = opt('--json').split(',');
  console.log(JSON.stringify(s.repos.filter(r => r.nameWithOwner.startsWith(argv[2] + '/')).map(r => Object.fromEntries(fields.map(f => [f, r[f]])))));
} else { console.error('stub gh: unknown ' + argv.join(' ')); process.exit(1); }
`);
  await chmod(path, 0o755);
  const off = join(dir, 'gh-offline');
  await writeFile(off, `#!/bin/sh\necho "error connecting to api.github.com" >&2\nexit 1\n`);
  await chmod(off, 0o755);
  return { path, offline: off, calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) };
}

// ---- the world ----------------------------------------------------------------

const PHASE = (id, status, next) => `---
status: ${status}
since: 2026-09-20
goal: G1
note: "Acme."
---

# Acme phase ${id}

## Done when

It works.

## Scope

Acme.

## Acceptance

- [ ] It works.

## Proof

\`npm test\`

## Deliberately open

Nothing.

## Next action

${next}
`;

async function world(t, { marker = 'Acme' } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'keel-loose-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const code = join(base, 'code'), claude = join(base, 'claude'), bin = join(base, 'bin');
  await mkdir(bin, { recursive: true });
  const home = join(code, 'keel'), app = join(code, 'app'), nested = join(code, 'group', 'nested');
  await repo(home, 'acme/keel', {
    '.keel/keel.json': JSON.stringify({ name: 'Acme keel', repo: 'acme/keel', inbox: 'acme/keel-inbox', practice: '0.6.0', practices: ['phases'] }),
    'fleet.json': JSON.stringify([
      { repo: 'acme/keel', kind: 'node', role: 'managed', note: 'home' },
      { repo: 'acme/app', kind: 'web', role: 'managed', note: 'an app' },
      { repo: 'acme/nested', kind: 'static', role: 'managed', note: 'one level down' },
      { repo: 'acme/gone', kind: 'web', role: 'managed', note: 'not on this machine' },
      { repo: 'acme/source', kind: 'node', role: 'source', note: 'never managed' },
    ]),
    'docs/goals.json': JSON.stringify([{ id: 'G1', title: 'Acme', outcome: 'Acme works.' }]),
    'docs/phases/05-owner-step.md': PHASE(5, 'partial', '⚑ Owner: decide whether Acme ships.'),
    'docs/phases/06-agent-step.md': PHASE(6, 'partial', 'Write the Acme parser.'),
    'docs/phases/08-owner-but-planned.md': PHASE(8, 'planned', 'Owner: later.'),
    'docs/health/2026-09-30.md': '# Health\n\n## Proposal\n\n**`gate`** (outside) — an older page.\n',
    'docs/health/2026-10-01.md': '# Health\n\n## Proposal\n\n**`phases_without_issue`** (outside) — open issues for phases 5 and 6.\n\nA person decides.\n',
    'docs/inbox/2026-10-01-acme-shape.md': formatProposal({ meta: { kind: 'lesson', from: 'acme/app/lesson/1/abc', status: 'proposed', outcome: 'lesson', note: 'general' }, title: 'Acme shape', claim: 'a claim', read: 'read' }),
    'docs/inbox/2026-10-01-acme-done.md': formatProposal({ meta: { kind: 'lesson', from: 'acme/app/lesson/2/abc', status: 'declined' }, title: 'Acme done', claim: 'a claim' }),
  });
  await repo(app, 'acme/app', { 'README.md': '# Acme app\n', 'src/done.js': 'export const done = 0;\n' });
  await repo(nested, 'acme/nested');
  await repo(join(code, 'stranger'), 'someone/else');
  // app: a branch not merged, one merged, an extra worktree, and uncommitted work.
  git(app, 'checkout', '-q', '-b', 'acme/phase-7-widget');
  await writeFile(join(app, 'widget.js'), 'export const widget = 1;\n');
  git(app, 'add', '-A'); git(app, 'commit', '-q', '-m', 'acme: widget');
  git(app, 'checkout', '-q', 'main');
  git(app, 'branch', 'acme/merged');
  git(app, 'worktree', 'add', '-q', '-b', 'acme/wt', join(code, 'app-wt'));
  await writeFile(join(code, 'app-wt', 'wt.txt'), 'acme\n');
  git(join(code, 'app-wt'), 'add', '-A'); git(join(code, 'app-wt'), 'commit', '-q', '-m', 'acme: in the worktree');
  await writeFile(join(app, 'src/done.js'), 'export const done = 1;\n');
  git(app, 'commit', '-q', '-am', 'acme: the committed session\'s work');
  await writeFile(join(app, 'README.md'), '# Acme app, edited\n');
  await writeFile(join(app, 'notes.txt'), 'acme notes\n');
  await mkdir(join(app, 'src'), { recursive: true });
  await writeFile(join(app, 'src/feature.js'), 'export const feature = 1;\n');

  // Sessions, in app's transcript directory.
  const tdir = join(claude, 'projects', encodeDir(app));
  await mkdir(tdir, { recursive: true });
  const ids = { dirty: randomUUID(), question: randomUUID(), ask: randomUUID(), midwork: randomUUID(), committed: randomUUID(), done: randomUUID(), waiting: randomUUID() };
  const later = Date.now() + 60_000, earlier = Date.now() - 3_600_000;
  const sessions = {
    dirty: transcript(ids.dirty, app, later).noise().user(`Acme phase 7: build the widget ${marker}`).meta('skill text').think()
      .tool('Write', { file_path: join(app, 'src/feature.js'), content: marker }).tool('Bash', { command: `echo ${marker}` }).say(`Wrote it. ${marker}`).tail(),
    question: transcript(ids.question, app, later).user(`Which colour for Acme? ${marker}`).think().say('Should the Acme button be blue or green?').tail(),
    ask: transcript(ids.ask, app, later).user('Plan the Acme release').tool('AskUserQuestion', { questions: [{ question: `Ship on Monday? ${marker}` }] }, { result: false }).tail(),
    midwork: transcript(ids.midwork, app, later).user('Run the Acme migration').tool('Read', { file_path: join(app, 'README.md') }).tool('Bash', { command: 'npm test' }, { result: false }),
    committed: transcript(ids.committed, app, earlier).user(`Fix Acme done ${marker}`).snapshot([join(app, 'src/done.js')])
      .tool('Edit', { file_path: 'src/done.js', old_string: '0', new_string: '1' }).tool('Bash', { command: 'git commit -am done' }).say('Committed. Shall I push?').tail(),
    done: transcript(ids.done, app, later).user('Explain Acme').say('Acme is a test company.').side('Is this a sidechain question?').tail(),
    waiting: transcript(ids.waiting, app, later).user('First ask').say('Done.').user('And one more thing for Acme'),
  };
  for (const [k, s] of Object.entries(sessions)) await writeFile(join(tdir, `${ids[k]}.jsonl`), s.text());
  // A subagent's transcript lives in a directory and is not a session of its own.
  await mkdir(join(tdir, ids.dirty, 'subagents'), { recursive: true });
  await writeFile(join(tdir, ids.dirty, 'subagents', 'agent-1.jsonl'), transcript('sub', app, later).user('sub?').say('sub?').text());

  const gh = await stubGh(bin, {
    login: 'acme-owner',
    prs: {
      'acme/app': [
        { url: 'https://github.com/acme/app/pull/1', title: 'Acme phase 7: the widget', headRefName: 'acme/phase-7-widget', author: { login: 'acme-owner' }, createdAt: '2026-10-01T00:00:00Z', isDraft: false },
        { url: 'https://github.com/acme/app/pull/2', title: 'night', headRefName: 'keel-night/2026-10-01', author: { login: 'github-actions' }, createdAt: '2026-10-02T00:00:00Z', isDraft: false },
        { url: 'https://github.com/acme/app/pull/3', title: 'a stranger\'s fix', headRefName: 'fix-typo', author: { login: 'stranger' }, createdAt: '2026-10-02T00:00:00Z', isDraft: false },
      ],
    },
    repos: [
      { nameWithOwner: 'acme-owner/walk', createdAt: new Date(Date.now() - DAY).toISOString(), isArchived: false },
      { nameWithOwner: 'acme-owner/ancient', createdAt: new Date(Date.now() - 100 * DAY).toISOString(), isArchived: false },
      { nameWithOwner: 'acme-owner/shelved', createdAt: new Date(Date.now() - DAY).toISOString(), isArchived: true },
    ],
  });
  const env = { ...cleanEnv(), KEEL_GH: gh.path, KEEL_CLAUDE_DIR: claude };
  return { base, code, claude, home, app, nested, ids, gh, env };
}

const keel = (w, args, env = w.env) => {
  const r = runCmd(process.execPath, [BIN, 'loose-ends', ...args], { cwd: w.home, env });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const json = (w, args = [], env) => {
  const r = keel(w, [...args, '--json'], env);
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out);
};
const project = (d, repo) => d.projects.find(p => p.repo === repo);
const item = (d, repo, fp) => project(d, repo)?.items.find(i => i.fingerprint === fp);

test('the transcript parser reads the real shapes: name, files written, and how it ended', () => {
  const s = transcript('s1', '/acme', 0).noise().user('<command-name>/conduct</command-name> <command-args>phase 3</command-args>').meta('skill')
    .tool('Write', { file_path: 'a.js' }).snapshot(['/acme/b.js']).say('All done?');
  const p = parseSession(s.text(), 'x');
  assert.equal(p.id, 's1');
  assert.equal(p.name, '/conduct phase 3', 'tags stripped; the person\'s words kept');
  assert.deepEqual(p.touched.sort(), ['/acme/a.js', '/acme/b.js']);
  assert.deepEqual(parseSession(transcript('s2', '/acme', 0).user('x').tool('Edit', { file_path: 'a.js' }).snapshot(['/acme/a.js']).text(), 'y').touched, ['/acme/a.js'], 'one file, however it was named');
  assert.equal(p.ending, 'question');
  assert.equal(parseSession('', 'x'), null, 'no conversation, no session');
  assert.equal(parseSession(`${s.text()}{"torn`, 'x').ending, 'question', 'a torn last line is skipped');
});

test('synthetic transcripts and repos give the right items; committed work and finished chats are not listed', async t => {
  const w = await world(t);
  const d = json(w);
  const app = project(d, 'acme/app');
  const sessions = Object.fromEntries(app.items.filter(i => i.kind === 'session').map(i => [i.session, i]));
  const { ids } = w;
  assert.deepEqual(Object.keys(sessions).sort(), [ids.dirty, ids.question, ids.ask, ids.midwork, ids.waiting].sort());
  assert.ok(!sessions[ids.committed], 'a session whose files are all committed is done, even ending on a question');
  assert.ok(!sessions[ids.done], 'a finished chat that wrote nothing is not a loose end; a sidechain\'s question is not the session\'s');
  assert.equal(sessions[ids.dirty].ending, 'done');
  assert.match(sessions[ids.dirty].detail, /^1 file it wrote still uncommitted$/);
  assert.deepEqual(sessions[ids.dirty].files, ['src/feature.js']);
  assert.equal(sessions[ids.dirty].phase, 7, 'a session naming a phase is tied to it');
  assert.equal(sessions[ids.question].ending, 'question');
  assert.equal(sessions[ids.ask].ending, 'question', 'an AskUserQuestion call is a question');
  assert.equal(sessions[ids.midwork].ending, 'mid-work');
  assert.equal(sessions[ids.waiting].ending, 'mid-work', 'the person spoke last and nothing answered');
  assert.equal(sessions[ids.question].title, 'Which colour for Acme? Acme');

  // git: files with age, the unmerged branch (not the merged one), the worktree.
  const files = app.items.filter(i => i.kind === 'file').map(i => `${i.title} ${i.detail}`).sort();
  assert.deepEqual(files, ['README.md modified', 'notes.txt untracked', `src/feature.js untracked, from session ${ids.dirty}`]);
  assert.ok(app.items.filter(i => i.kind === 'file').every(i => i.age !== ''), 'each file has an age');
  assert.deepEqual(app.items.filter(i => i.kind === 'branch').map(i => i.title).sort(), ['acme/phase-7-widget', 'acme/wt']);
  assert.equal(item(d, 'acme/app', 'branch:acme/phase-7-widget').phase, 7);
  assert.deepEqual(app.items.filter(i => i.kind === 'worktree').map(i => i.title), [join(w.code, 'app-wt')]);
  // GitHub: the owner's PR and the machine's, not a stranger's.
  assert.deepEqual(app.items.filter(i => i.kind === 'pr').map(i => i.url).sort(), ['https://github.com/acme/app/pull/1', 'https://github.com/acme/app/pull/2']);
  assert.equal(app.github, 'checked');

  // keel's row: the practice, and a new repo the fleet does not know.
  const home = project(d, 'acme/keel');
  assert.equal(home.dir, w.home);
  assert.deepEqual(home.items.filter(i => i.kind === 'phase').map(i => i.phase), [5], 'partial and the owner\'s; not an agent\'s step, not a planned phase');
  assert.match(item(d, 'acme/keel', 'health:phases_without_issue').title, /2026-10-01/, 'the newest page\'s proposal only');
  assert.ok(!item(d, 'acme/keel', 'health:gate'));
  assert.equal(item(d, 'acme/keel', 'inbox:proposed').title, '1 inbox proposal waiting for a decision');
  assert.deepEqual(home.items.filter(i => i.kind === 'repo').map(i => i.title), ['acme-owner/walk'], 'new, unknown, not archived');
  assert.ok(!home.items.some(i => i.kind === 'session'), 'no transcripts for keel here');

  // Checkouts: one level down is found; one not on the machine says so; a source is never scanned.
  assert.equal(project(d, 'acme/nested').dir, w.nested);
  assert.deepEqual(project(d, 'acme/nested').items, []);
  assert.deepEqual([project(d, 'acme/gone').checkout, project(d, 'acme/gone').dir], [false, null]);
  assert.ok(!project(d, 'acme/source'));
  const text = keel(w, []).out;
  assert.match(text, /^acme\/gone — no local checkout$/m);
  assert.match(text, /^acme\/nested — .*\n  nothing loose$/m);
  assert.match(text, /^ phase 7:$/m, 'listed under its phase');

  // --phase filters to one phase; --root moves where checkouts are looked for.
  const seven = json(w, ['--phase', '7']);
  assert.deepEqual(seven.projects.flatMap(p => p.items.map(i => i.kind)).sort(), ['branch', 'pr', 'session']);
  const elsewhere = json(w, ['--root', join(w.base, 'bin')]);
  assert.equal(project(elsewhere, 'acme/app').checkout, false);
  assert.equal(project(elsewhere, 'acme/keel').checkout, true, 'keel itself is always scanned');
});

test('each item\'s move and commands fit its kind, and nothing is run', async t => {
  const w = await world(t);
  const before = git(w.app, 'status', '--porcelain');
  const d = json(w);
  const { app, ids } = { app: w.app, ids: w.ids };
  const at = fp => item(d, 'acme/app', fp) ?? item(d, 'acme/keel', fp);
  assert.deepEqual(at(`session:${ids.question}`).commands, [`cd ${app} && claude --resume ${ids.question}`]);
  assert.equal(at(`session:${ids.question}`).move, 'answer it');
  assert.equal(at(`session:${ids.midwork}`).move, 'resume it where it stopped');
  assert.equal(at(`session:${ids.dirty}`).move, 'resume it to finish and commit');
  assert.deepEqual(at('file:notes.txt:untracked').commands, [`git -C ${app} status`, `git -C ${app} add notes.txt`]);
  assert.deepEqual(at('file:README.md:modified').commands, [`git -C ${app} status`, `git -C ${app} diff -- README.md`]);
  assert.equal(at('file:src/feature.js:untracked').move, 'finish it in its session, then commit');
  assert.equal(at('branch:acme/phase-7-widget').commands[0], `git -C ${app} log --oneline main..acme/phase-7-widget`);
  assert.deepEqual(at(`worktree:${join(w.code, 'app-wt')}`).commands, [`git -C ${join(w.code, 'app-wt')} status`, `git -C ${app} worktree remove ${join(w.code, 'app-wt')}   # when done`]);
  assert.deepEqual(at('pr:https://github.com/acme/app/pull/1').commands, ['gh pr view https://github.com/acme/app/pull/1', 'gh pr checks https://github.com/acme/app/pull/1']);
  assert.deepEqual(at('phase:5').commands, [`less ${join(w.home, 'docs/phases/05-owner-step.md')}`]);
  assert.deepEqual(at('health:phases_without_issue').commands, [`less ${join(w.home, 'docs/health/2026-10-01.md')}`]);
  assert.deepEqual(at('inbox:proposed').commands, [`cd ${w.home} && keel learn`]);
  assert.match(at('repo:acme-owner/walk').move, /⚑ yours/);
  // Only reads: gh was asked, never told; the repos are as they were.
  assert.deepEqual((await w.gh.calls()).map(c => c.slice(0, 2).join(' ')).filter(c => !['api user', 'pr list', 'repo list'].includes(c)), []);
  assert.equal(git(w.app, 'status', '--porcelain'), before);
  assert.equal(git(w.app, 'worktree', 'list').split('\n').length, 2);
});

test('offline: GitHub not checked, and the rest still listed', async t => {
  const w = await world(t);
  const d = json(w, [], { ...w.env, KEEL_GH: w.gh.offline });
  assert.match(project(d, 'acme/app').github, /^GitHub not checked: error connecting/);
  assert.ok(!project(d, 'acme/app').items.some(i => i.kind === 'pr' || i.kind === 'repo'));
  assert.ok(item(d, 'acme/app', `session:${w.ids.question}`));
  assert.match(keel(w, [], { ...w.env, KEEL_GH: w.gh.offline }).out, /^acme\/app — .*\(GitHub not checked: /m);
});

test('marks persist across runs: drop never comes back, park comes back after its date, resume goes first', async t => {
  const w = await world(t);
  const d = json(w);
  const q = item(d, 'acme/app', `session:${w.ids.question}`), b = item(d, 'acme/app', 'branch:acme/wt'), f = item(d, 'acme/app', 'file:notes.txt:untracked');
  const pr = item(d, 'acme/app', 'pr:https://github.com/acme/app/pull/2');

  for (const [args, why] of [[[q.id, 'drop'], /--reason/], [[q.id, 'park', '--reason', 'later'], /park needs --until/], [[q.id, 'park', '--reason', 'x', '--until', 'soon'], /YYYY-MM-DD/],
    [[q.id, 'resume', '--reason', 'x', '--until', '2026-12-01'], /--until goes with park/], [['ffffff', 'drop', '--reason', 'x'], /no loose end ffffff/], [[q.id, 'finish', '--reason', 'x'], /one of resume, park, drop/]]) {
    const r = keel(w, ['mark', ...args, '--json']);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}`);
    assert.match(JSON.parse(r.out).error, why);
  }
  await assert.rejects(readFile(join(w.app, MARKS)), { code: 'ENOENT' }, 'a refused mark writes nothing');

  const marked = JSON.parse(keel(w, ['mark', q.id, 'drop', '--reason', 'answered on the phone', '--json']).out);
  assert.equal(marked.file, join(w.app, MARKS));
  assert.equal(keel(w, ['mark', b.id.slice(0, 4), 'park', '--reason', 'after the trip', '--until', '2999-01-01']).code, 0, 'an id prefix of four will do');
  assert.equal(keel(w, ['mark', f.id, 'park', '--reason', 'already due', '--until', '2020-01-01']).code, 0);
  assert.equal(keel(w, ['mark', pr.id, 'resume', '--reason', 'first thing']).code, 0);
  const saved = JSON.parse(await readFile(join(w.app, MARKS), 'utf8'));
  assert.deepEqual(saved.marks.map(m => [m.fingerprint, m.move, m.until ?? null]), [
    [`session:${w.ids.question}`, 'drop', null], ['branch:acme/wt', 'park', '2999-01-01'], ['file:notes.txt:untracked', 'park', '2020-01-01'], [pr.fingerprint, 'resume', null]]);
  assert.ok(saved.marks.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.date) && m.reason));

  const again = json(w);
  const app = project(again, 'acme/app');
  assert.ok(!item(again, 'acme/app', q.fingerprint), 'dropped');
  assert.ok(!item(again, 'acme/app', b.fingerprint), 'parked until 2999');
  assert.ok(item(again, 'acme/app', f.fingerprint), 'a park whose date has passed is back');
  assert.equal(app.items[0].fingerprint, pr.fingerprint, 'resume sorts first');
  assert.equal(again.hidden, 2);
  assert.match(keel(w, []).out, /^ resume first:\n  [0-9a-f]{6}  pr /m);
  assert.match(keel(w, []).out, /2 parked or dropped \(--all shows them\)/);

  // --all shows the hidden, with their marks; time passing brings the park back, never the drop.
  const all = json(w, ['--all']);
  assert.equal(item(all, 'acme/app', q.fingerprint).mark.reason, 'answered on the phone');
  assert.equal(item(all, 'acme/app', b.fingerprint).state, 'hidden');
  const future = await looseEnds({ home: w.home, env: w.env, now: Date.parse('2999-01-02T00:00:00Z') });
  assert.ok(item(future.data, 'acme/app', b.fingerprint), 'the park is over');
  assert.ok(!item(future.data, 'acme/app', q.fingerprint), 'a drop is for good');
  // A re-mark replaces the old one.
  keel(w, ['mark', q.id, 'resume', '--reason', 'it came back']);
  assert.equal(JSON.parse(await readFile(join(w.app, MARKS), 'utf8')).marks.filter(m => m.fingerprint === q.fingerprint).length, 1);
  assert.ok(item(json(w), 'acme/app', q.fingerprint));
});

test('the leak test: a chat\'s words reach the terminal and no file, through listing and marking', async t => {
  const w = await world(t, { marker: MARKER });
  const out = keel(w, []);
  assert.equal(out.code, 0, out.err);
  assert.ok(out.out.includes(MARKER), 'the name is the person\'s own words, on their own terminal');
  const d = json(w);
  assert.ok(JSON.stringify(d).includes(MARKER));
  for (const s of project(d, 'acme/app').items.filter(i => i.kind === 'session')) {
    assert.equal(keel(w, ['mark', s.id, 'park', '--reason', 'tomorrow', '--until', '2999-01-01']).code, 0);
  }
  assert.equal(keel(w, ['mark', item(d, 'acme/app', 'file:notes.txt:untracked').id, 'drop', '--reason', 'scratch']).code, 0);
  assert.equal(keel(w, ['--all']).code, 0);
  // Every file under the temp tree, except the transcripts themselves.
  const walk = async dir => (await readdir(dir, { withFileTypes: true, recursive: true })).filter(e => e.isFile()).map(e => join(e.parentPath ?? e.path, e.name));
  const leaks = async () => {
    const hits = [];
    for (const f of await walk(w.base)) {
      if (f.startsWith(`${w.claude}/`)) continue;
      if ((await readFile(f)).includes(MARKER)) hits.push(f.slice(w.base.length + 1));
    }
    return hits;
  };
  assert.ok((await readFile(join(w.app, MARKS), 'utf8')).length > 0, 'the marks were written');
  assert.deepEqual(await leaks(), [], 'no file outside the transcripts holds the chat\'s words');
  assert.ok((await walk(w.claude)).length > 0);
  // The walk can see a leak: plant one and it is found.
  await writeFile(join(w.app, '.keel', 'planted.json'), MARKER);
  assert.deepEqual(await leaks(), ['code/app/.keel/planted.json']);
});

test('usage: unknown flags exit 2; the help and the guide name the verb', async t => {
  const w = await world(t);
  assert.equal(keel(w, ['--phase', 'seven']).code, 2);
  assert.equal(keel(w, ['--bogus']).code, 2);
  assert.equal(keel(w, ['mark']).code, 2);
  const guide = await readFile(join(KEEL, 'lib', 'agent-guide.md'), 'utf8');
  assert.match(guide, /^- `keel loose-ends` — /m);
  assert.match(guide, /^<!-- topic: loose-ends \| /m);
});

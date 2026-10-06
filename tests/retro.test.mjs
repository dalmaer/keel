// keel retro (phase 40): the worksheet from a synthetic transcript, in the
// shapes Claude Code writes (entry types and field names, never a real
// session's words). Every message, result and quoted string carries a marker;
// the worksheet must never carry one, and must write no file. Fixtures are Acme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { run } from './helpers/run.mjs';
import { encodeDir } from '../lib/looseends.mjs';
import { retro, commandHead } from '../lib/retro.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const MARKER = 'ACME-RETRO-PRIVATE-Wren-at-Gullhaven';
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function commit(dir, files, message) {
  for (const [p, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', '--short', 'HEAD');
}

/** A transcript builder: tool calls with results, at chosen times. */
function transcript(sid, cwd, t0) {
  const lines = [];
  let t = t0, n = 0;
  const base = () => ({ parentUuid: null, isSidechain: false, userType: 'external', cwd, sessionId: sid, version: '2.1.0', gitBranch: 'main', uuid: randomUUID(), timestamp: new Date(t += 1000).toISOString() });
  const s = {
    user(text) { lines.push({ ...base(), type: 'user', message: { role: 'user', content: text } }); return s; },
    say(text) { lines.push({ ...base(), type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }); return s; },
    tool(name, input, { error = false, denied = false, ms = 1000 } = {}) {
      const id = `toolu_acme${n++}`;
      lines.push({ ...base(), type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
      t += ms;
      const content = denied ? `Permission for this action was denied by the classifier. ${MARKER}` : error ? `Exit code 1\n${MARKER} failed` : `${MARKER} output`;
      lines.push({ ...base(), type: 'user', ...(denied ? { toolDenialKind: 'automode-blocked' } : {}), toolUseResult: {},
        message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, is_error: error || denied }] } });
      return s;
    },
    text: () => `${lines.map(l => JSON.stringify(l)).join('\n')}\n`,
  };
  return s;
}

/** An Acme repo with a base commit, a claude dir, and the session written there. */
async function world(t) {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'keel-retro-')));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const root = join(tmp, 'acme-notes'), claude = join(tmp, 'claude');
  await mkdir(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  const base = await commit(root, { '.keel/keel.json': '{"name":"acme-notes"}\n', 'README.md': '# Acme Notes\n' }, 'acme: start');
  const sid = randomUUID();
  const dir = join(claude, 'projects', encodeDir(root));
  await mkdir(join(dir, sid, 'subagents'), { recursive: true });
  return { tmp, root, claude, dir, sid, base, env: { ...process.env, KEEL_CLAUDE_DIR: claude } };
}

/** Every file under a directory, for "wrote nothing". */
async function tree(dir) {
  return (await readdir(dir, { recursive: true })).filter(p => !p.startsWith('.git/') && p !== '.git').sort();
}

async function session(w) {
  const t0 = Date.now() + 60_000; // after the base commit
  const m = transcript(w.sid, w.root, t0)
    .user(`Acme: do the thing ${MARKER}`)
    .say(`Sure ${MARKER}`)
    // A failed command retried within 5 calls: one retried, two errors.
    .tool('Bash', { command: `cd ${w.root} && npm test -- --grep "${MARKER}"` }, { error: true })
    .tool('Read', { file_path: join(w.root, 'lib', 'notes.mjs') })
    .tool('Bash', { command: `cd ${w.root} && npm test -- --grep "${MARKER}"` })
    // A failure never retried: an error, not retried.
    .tool('Bash', { command: `cat /Users/acme/secret/${MARKER}.txt` }, { error: true })
    // A denial.
    .tool('Bash', { command: `rm -rf '${MARKER}'` }, { denied: true })
    // One file read three times (one above), another twice.
    .tool('Read', { file_path: join(w.root, 'lib', 'notes.mjs') })
    .tool('Read', { file_path: join(w.root, 'lib', 'notes.mjs') })
    .tool('Read', { file_path: join(w.root, 'README.md') })
    .tool('Read', { file_path: join(w.root, 'README.md') })
    // A slow call, and an Agent call that is slow by design.
    .tool('Bash', { command: 'npm run check' }, { ms: 90_000 })
    .tool('Agent', { prompt: MARKER }, { ms: 600_000 })
    // An edit, then its undo.
    .tool('Edit', { file_path: join(w.root, 'lib', 'notes.mjs'), old_string: `a ${MARKER}`, new_string: `b ${MARKER}` })
    .tool('Edit', { file_path: join(w.root, 'lib', 'notes.mjs'), old_string: `b ${MARKER}`, new_string: `a ${MARKER}` })
    .say(`Done ${MARKER}`);
  await writeFile(join(w.dir, `${w.sid}.jsonl`), m.text());
  // A builder's transcript: one Write, a second, then the first content again.
  const sub = transcript(w.sid, w.root, t0 + 5_000)
    .user(`Build it ${MARKER}`)
    .tool('Write', { file_path: join(w.root, 'lib', 'acme.mjs'), content: `one ${MARKER}` })
    .tool('Write', { file_path: join(w.root, 'lib', 'acme.mjs'), content: `two ${MARKER}` })
    .tool('Write', { file_path: join(w.root, 'lib', 'acme.mjs'), content: `one ${MARKER}` });
  await writeFile(join(w.dir, w.sid, 'subagents', 'agent-acme1.jsonl'), sub.text());
  // An older session in the same directory: not the newest, so not read.
  const old = transcript('acme-old', w.root, t0).tool('Bash', { command: 'false' }, { error: true });
  await writeFile(join(w.dir, 'acme-old.jsonl'), old.text());
  const { utimes } = await import('node:fs/promises');
  await utimes(join(w.dir, 'acme-old.jsonl'), new Date(t0 - 86_400_000), new Date(t0 - 86_400_000));
}

const COUNTS = { retried: 1, errors: 2, denials: 1, rereads: 1, slow: 1, reverted: 2 };

test('the worksheet counts each signal from a synthetic transcript, and points without quoting', async t => {
  const w = await world(t);
  await commit(w.root, { 'lib/notes.mjs': 'export {};\n' }, 'acme: code');
  await session(w);
  const before = [...await tree(w.root), ...await tree(w.claude)];
  const r = await retro({ root: w.root, since: w.base, env: w.env });
  assert.equal(r.exitCode, 0);
  assert.equal(r.data.realWork, true);
  assert.equal(r.data.session, w.sid);
  assert.equal(r.data.subagents, 1);
  assert.deepEqual(r.data.counts, COUNTS);
  assert.equal(r.data.signals.rereads[0].file, 'lib/notes.mjs');
  assert.equal(r.data.signals.rereads[0].times, 3);
  assert.equal(r.data.signals.retried[0].head, "npm test -- --grep ''");
  assert.equal(r.data.signals.slow[0].seconds, 91); // 90 s of work and the one-second tick between entries
  assert.deepEqual(r.data.signals.reverted.map(p => p.source).sort(), ['agent-acme1', 'main']);
  assert.equal(r.data.areas.length, 7);
  assert.deepEqual(r.data.areas.map(a => a.key), ['navigation', 'checks', 'standards', 'agents', 'economy', 'noop', 'gaps']);
  // Never transcript text, never a path beyond the repo, and no file written.
  for (const out of [r.text, JSON.stringify(r.data)]) {
    assert.ok(!out.includes(MARKER), 'transcript text reached the worksheet');
    assert.ok(!out.includes('/Users/acme'), 'a path beyond the repo reached the worksheet');
  }
  assert.match(r.text, /Seven areas/);
  for (const a of ['Navigation', 'Automatable checks', 'Missing standards', 'AGENTS.md health', 'Tool economy', 'No-op instructions', 'Information gaps']) assert.match(r.text, new RegExp(`## ${a}`));
  assert.deepEqual([...await tree(w.root), ...await tree(w.claude)], before);
});

test('--since drops what came before the phase started', async t => {
  const w = await world(t);
  await session(w);
  // A base committed after the whole session (its entries are a minute ahead): set the clock past them.
  const later = new Date(Date.now() + 3_600_000).toISOString();
  await writeFile(join(w.root, 'lib.mjs'), 'export {};\n');
  git(w.root, 'add', '-A');
  execFileSync('git', ['-C', w.root, 'commit', '-q', '-m', 'acme: later'], { env: { ...process.env, GIT_COMMITTER_DATE: later, GIT_AUTHOR_DATE: later } });
  const late = git(w.root, 'rev-parse', '--short', 'HEAD');
  await commit(w.root, { 'src/x.mjs': 'export {};\n' }, 'acme: code');
  const r = await retro({ root: w.root, since: late, env: w.env });
  assert.deepEqual(r.data.counts, { retried: 0, errors: 0, denials: 0, rereads: 0, slow: 0, reverted: 0 });
  assert.equal(r.data.subagents, 0);
});

test('a docs-only range is not real work; one touching lib/ or practices/ is', async t => {
  const w = await world(t);
  await session(w);
  await commit(w.root, { 'docs/phases/01-acme.md': '# Acme\n' }, 'acme: docs');
  const docs = await retro({ root: w.root, since: w.base, env: w.env });
  assert.equal(docs.exitCode, 0);
  assert.equal(docs.data.realWork, false);
  assert.match(docs.text, /^docs only: no retro/);
  assert.equal(docs.text.split('\n').length, 1);
  assert.equal(docs.data.counts, undefined, 'a docs-only range reads no transcript');
  // HEAD alone (no --since) is the same question about the last commit.
  assert.equal((await retro({ root: w.root, env: w.env })).data.realWork, false);
  for (const p of ['lib/acme.mjs', 'practices/acme/files/x.md']) {
    await commit(w.root, { [p]: `${p}\n` }, `acme: ${p}`);
    const r = await retro({ root: w.root, env: w.env });
    assert.equal(r.data.realWork, true, p);
    assert.deepEqual(r.data.counts, COUNTS);
  }
});

test('keel retro on the CLI: --json, --worksheet, --session, and usage errors', async t => {
  const w = await world(t);
  await commit(w.root, { 'lib/notes.mjs': 'export {};\n' }, 'acme: code');
  await session(w);
  const keel = args => run(process.execPath, [BIN, ...args], { cwd: w.root, env: w.env });
  const j = keel(['retro', '--since', w.base, '--json']);
  assert.equal(j.status, 0, j.stderr);
  assert.deepEqual(JSON.parse(j.stdout).counts, COUNTS);
  assert.ok(!j.stdout.includes(MARKER));
  const text = keel(['retro', '--worksheet']);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^retro worksheet: session /);
  assert.ok(!text.stdout.includes(MARKER));
  const old = JSON.parse(keel(['retro', '--session', 'acme-old', '--json']).stdout);
  assert.deepEqual(old.counts, { retried: 0, errors: 1, denials: 0, rereads: 0, slow: 0, reverted: 0 });
  assert.equal(keel(['retro', '--session', 'acme-missing']).status, 2);
  assert.equal(keel(['retro', '--since', 'acme-no-such-commit']).status, 2);
  assert.equal(keel(['retro', '--frobnicate']).status, 2);
});

test('no transcript for the repo is said, not an error', async t => {
  const w = await world(t);
  await commit(w.root, { 'lib/notes.mjs': 'export {};\n' }, 'acme: code');
  const r = await retro({ root: w.root, env: w.env });
  assert.equal(r.exitCode, 0);
  assert.equal(r.data.session, null);
  assert.match(r.text, /^no session transcript for this repo/);
});

test('a command head keeps the shape and drops the words', () => {
  const root = '/acme/notes';
  assert.equal(commandHead(`cd ${root} && node --test tests/a.test.mjs`, root), 'node --test tests/a.test.mjs');
  assert.equal(commandHead(`git commit -m "${MARKER}"`, root), "git commit -m ''");
  assert.equal(commandHead(`grep -rn '${MARKER}' ${root}/lib /home/acme/x`, root), "grep -rn '' lib <path>");
  assert.equal(commandHead(`TOKEN=${MARKER} gh api user`, root), 'TOKEN=… gh api user');
  assert.equal(commandHead(`python3 - <<'EOF'\nprint("${MARKER}")\nEOF`, root), 'python3 -');
  assert.equal(commandHead(`echo "${MARKER}`, root), 'echo');
  assert.equal(commandHead('a b c d e f g h', root), 'a b c d e f');
  assert.equal(commandHead(`cat ~/${MARKER}`, root), 'cat <path>');
});

test('a repo with no commit yet has no real work, and says so', async t => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'keel-retro-empty-')));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  git(tmp, 'init', '-q', '-b', 'main');
  const r = await retro({ root: tmp, env: { ...process.env, KEEL_CLAUDE_DIR: join(tmp, 'claude') } });
  assert.equal(r.exitCode, 0);
  assert.equal(r.data.realWork, false);
  assert.equal(r.text, 'no commit yet: no retro');
});

// The keel skill (phase 19): the door, not the room. It says what keel is,
// how to install it, and "run keel --agent-help" — and nothing about the CLI
// that could age, because a skill sits in a directory for months while the
// CLI moves on (lessons 1 and 16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { run } from './helpers/run.mjs';
import { mkdtemp, mkdir, readFile, rm, lstat, realpath, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const SKILL = join(KEEL, 'practices', 'agents-md', 'files', '.agents', 'skills', 'keel', 'SKILL.md');
const BUDGET = 180;
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1',
};
const keel = (args, cwd) => {
  const r = run(process.execPath, [BIN, ...args], { cwd, env: ENV });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

/** { front: {key: value}, body } of a SKILL.md, or throws. */
function parseSkill(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error('no front matter');
  const front = Object.fromEntries(m[1].split('\n').map(l => /^([\w-]+):\s*(.*)$/.exec(l)).filter(Boolean).map(([, k, v]) => [k, v.trim()]));
  return { front, body: m[2] };
}

/** The words of the body, as wc -w counts them. */
const words = body => body.split(/\s+/).filter(Boolean).length;

/**
 * Every `keel <word>` in the body that isn't `keel --agent-help`. A verb named
 * here is a copy of the CLI that ages; the verbs live in --agent-help. `keel`
 * alone, or as part of a path or URL (dalmaer/keel), is fine.
 */
const verbMentions = body =>
  [...body.matchAll(/(?<![\w/.-])keel[ \t]+([^\s`]+)/g)].map(m => m[1]).filter(w => w !== '--agent-help');

test('the keel skill has valid front matter: name keel and a one-sentence description', async () => {
  const { front } = parseSkill(await readFile(SKILL, 'utf8'));
  assert.equal(front.name, 'keel');
  assert.ok(front.description, 'a description');
  assert.ok(front.description.length <= 1024, 'description within the Agent Skills limit');
  assert.match(front.description, /\.keel\/keel\.json/, 'it triggers in a keel project');
  for (const w of ['phases', 'roadmap', 'lessons', 'night shift']) assert.ok(front.description.includes(w), `it triggers on ${w}`);
});

test(`the keel skill stays short (≤ ${BUDGET} words) and names no verb but --agent-help`, async () => {
  const { body } = parseSkill(await readFile(SKILL, 'utf8'));
  assert.ok(words(body) <= BUDGET, `${words(body)} words; the budget is ${BUDGET}`);
  assert.match(body, /keel --agent-help/);
  assert.match(body, /git clone https:\/\/github\.com\/dalmaer\/keel/);
  assert.match(body, /npm install -g/);
  assert.match(body, /npx -y github:dalmaer\/keel --agent-help/, 'a way in with nothing installed (phase 23)');
  assert.match(body, /AGENTS\.md/);
  assert.match(body, /docs\/ROADMAP\.md/);
  assert.deepEqual(verbMentions(body), []);
});

test('the guard bites: a copied verb or a longer skill fails', async () => {
  const { body } = parseSkill(await readFile(SKILL, 'utf8'));
  assert.deepEqual(verbMentions(body + '\nThen run `keel adopt`.\n'), ['adopt']);
  assert.deepEqual(verbMentions(body + '\nkeel status --json\n'), ['status']);
  assert.ok(words(body + ' word'.repeat(BUDGET)) > BUDGET);
});

/** One keel init'd project, made once and copied per test. */
let template;
async function project(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-skill-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (!template) {
    template = await realpath(await mkdtemp(join(tmpdir(), 'keel-skill-template-')));
    process.on('exit', () => rmSync(template, { recursive: true, force: true }));
    const r = keel(['init', join(template, 'acme-notes'), '--description', 'Acme Notes keeps meeting notes as plain files.', '--kind', 'node'], template);
    assert.equal(r.code, 0, r.err);
  }
  await cp(join(template, 'acme-notes'), join(dir, 'acme-notes'), { recursive: true, verbatimSymlinks: true });
  return join(dir, 'acme-notes');
}

test('a fresh keel init project carries the skill, filled, and the .claude/skills/keel link resolves to it', async t => {
  const dir = await project(t);
  const text = await readFile(join(dir, '.agents', 'skills', 'keel', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(text, /\{\{/, 'every placeholder filled');
  assert.match(text, /acme-notes is run with keel/);
  assert.match(text, /`npm run check` is the gate/);
  assert.ok((await lstat(join(dir, '.claude', 'skills', 'keel'))).isSymbolicLink());
  assert.equal(await readFile(join(dir, '.claude', 'skills', 'keel', 'SKILL.md'), 'utf8'), text);
  const doctor = JSON.parse(keel(['doctor', '--json'], dir).out);
  assert.deepEqual(doctor.lint.filter(l => l.path.includes('skills/keel')), []);
});

test('doctor lints a second copy of the keel skill', async t => {
  const dir = await project(t);
  await mkdir(join(dir, '.codex', 'skills', 'keel'), { recursive: true });
  await cp(join(dir, '.agents', 'skills', 'keel', 'SKILL.md'), join(dir, '.codex', 'skills', 'keel', 'SKILL.md'));
  const r = keel(['doctor', '--json'], dir);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.out).lint.map(l => `${l.rule} ${l.path}`), ['second-copy .codex/skills/keel/SKILL.md']);
});

test('keel carries its own copy (render --self)', async () => {
  const mine = await readFile(join(KEEL, '.agents', 'skills', 'keel', 'SKILL.md'), 'utf8');
  assert.equal(parseSkill(mine).front.name, 'keel');
  assert.ok((await lstat(join(KEEL, '.claude', 'skills', 'keel'))).isSymbolicLink());
});

// The conduct skill (phase 23): what a fresh agent had to guess, said.
test('the conduct skill covers no remote, missing docs, small phases, and records before the one gate run', async () => {
  const text = await readFile(join(KEEL, 'practices', 'conduct', 'files', '.agents', 'skills', 'conduct', 'SKILL.md'), 'utf8');
  const section = n => text.slice(text.indexOf(`\n## ${n}.`), text.indexOf('\n## ', text.indexOf(`\n## ${n}.`) + 1));
  assert.match(text, /If `git remote` prints nothing, skip every pull, push and CI/);
  assert.match(text, /the walk ends at the local commit/);
  assert.match(section(2), /`git pull --ff-only` \*\*first\*\*, if there is a remote/);
  assert.match(section(4), /With no remote, stop at the local commit/);
  assert.match(text, /if\s+the project has one, is the argument/);
  assert.match(text, /the README \(if the project has one\)/);
  assert.match(text, /\*\*Small phases\.\*\*[\s\S]*built by the conductor/);
  // Status first; the whole check after the record, not in Verify.
  assert.match(section(3), /^[\s\S]*?\n- \*\*Set the phase's `status:`\*\*/);
  assert.equal(section(3).match(/\n- /).index, section(3).indexOf("\n- **Set the phase's `status:`**"), 'status is the first bullet');
  assert.doesNotMatch(section(2), /\*\*The whole check, once\*\*/);
  assert.ok(section(3).indexOf('**the whole check, once**') > section(3).indexOf('npm run roadmap'), 'the gate runs after the record');
  assert.match(section(3), /\{\{check\}\}/);
  assert.match(section(4), /Commit the\s+tree the gate just checked/);
  // Third walk: the record can't hold what only exists after it.
  assert.match(section(3), /names the gate \*\*command\*\*\s+\(`\{\{check\}\}`\) and what it covers/);
  assert.match(section(3), /gate's result line\s+\(exit code, test count\) goes in the commit body/);
  assert.match(section(4), /carries the gate's result line/);
  assert.match(section(3), /\*\*Proofs that need the commit\*\*[\s\S]*?status `partial`[\s\S]*?Walk them right after the commit[\s\S]*?in the next\s+commit/);
  assert.match(section(4), /\*\*Proofs that need the commit\*\*[\s\S]*?record them in the next commit/);
  assert.match(section(3), /once it\s+is built, `None\.` \(or what lived-in needs\)/);
  assert.match(section(4), /`phase <N>: <heading>`, where the heading is the phase file's\s+`# ` heading, word for word: it is the source/);
});

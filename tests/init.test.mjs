// keel init: from an empty directory to a project that passes its own check
// and can be conducted, with GitHub reached only through a modelled gh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { run, testsRan } from './helpers/run.mjs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, chmod, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fill } from '../lib/practices.mjs';
import { firstSentence, goalTitle, npmName, phaseZero, PHASE0_TITLE } from '../lib/init.mjs';
import { parsePhase } from '../practices/phases/files/scripts/roadmap.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const DESCRIPTION = 'Acme Notes keeps meeting notes as plain files. It files each note under the meeting it came from and finds them again by who was there.';
const SECRETS = [
  ['CLAUDE_CODE_OAUTH_TOKEN', '.github/workflows/claude.yml', 'claude'],
  ['ANTHROPIC_API_KEY', '.github/workflows/claude.yml', 'claude'],
];

// A git identity for the commit, and nothing reaching the network.
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1',
};

const keel = (args, cwd, env = ENV) => {
  const r = run(process.execPath, [BIN, ...args], { cwd, env });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

async function scratch(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-init-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A gh that answers like the real one for the calls init makes, and records
 * each argv as a JSON line. `api user -q .login` prints a login; `secret list`
 * prints nothing when no secret is set; `repo create` prints the repo URL.
 * Anything else fails, as an unknown call to real gh would.
 */
async function stubGh(dir) {
  const log = join(dir, 'gh.log'), bin = join(dir, 'gh');
  await writeFile(bin, `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const is = (...want) => want.every((w, i) => args[i] === w);
if (is('api', 'user') && args.includes('.login')) console.log('acme');
else if (is('secret', 'list')) {}
else if (is('repo', 'create')) console.log('https://github.com/' + args[2]);
else { console.error('unknown command ' + args.join(' ')); process.exit(1); }
`);
  await chmod(bin, 0o755);
  const calls = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { bin, calls };
}

test('init into an empty directory passes the new project\'s own npm run check', async t => {
  const root = await scratch(t);
  const r = keel(['init', 'acme-notes', '--description', DESCRIPTION, '--kind', 'node', '--json'], root);
  assert.equal(r.code, 0, r.err || r.out);
  const result = JSON.parse(r.out);
  const dir = join(root, 'acme-notes');
  assert.equal(result.dir, dir);

  const config = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  assert.equal(config.name, 'acme-notes');
  assert.equal(config.tagline, 'Acme Notes keeps meeting notes as plain files.');
  assert.equal(config.kind, 'node');
  assert.equal(config.repo, undefined, 'no repo without --repo or --github');
  // claude and loop are optional: off unless named with --with.
  assert.deepEqual(config.practices, ['base', 'agents-md', 'phases', 'evidence', 'lessons', 'conduct', 'ci', 'night', 'renovate']);
  assert.deepEqual(result.secrets, [], 'no secret is listed for a practice that is off');

  const goals = JSON.parse(await readFile(join(dir, 'docs', 'goals.json'), 'utf8'));
  assert.equal(goals.length, 1);
  assert.equal(goals[0].id, 'G0');
  assert.equal(goals[0].outcome, DESCRIPTION);
  assert.equal(goals[0].title, 'Acme Notes keeps meeting notes as plain files', 'G0 is titled by the first sentence');
  assert.deepEqual((await readdir(join(dir, 'docs', 'phases'))).sort(), ['00-first-thing-that-runs.md', 'README.md']);

  // docs/evidence/ exists, and its README names the template and the path rule.
  const evidence = await readFile(join(dir, 'docs', 'evidence', 'README.md'), 'utf8');
  assert.match(evidence, /docs\/templates\/evidence\.md/);
  assert.match(evidence, /relative to\s+`docs\/`/);
  assert.match(evidence, /evidence: \["evidence\/[^"]+\.md"\]/);

  // A README with the name, the description and a section to fill.
  const readme = await readFile(join(dir, 'README.md'), 'utf8');
  assert.match(readme, /^# acme-notes\n/);
  assert.ok(readme.includes(DESCRIPTION));
  assert.match(readme, /^## How to run it$/m);

  // --kind node: package.json has an npm-safe name.
  assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).name, 'acme-notes');

  const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /## What acme-notes is/);
  assert.ok(agents.includes(DESCRIPTION));
  assert.equal(agents.split('Acme Notes keeps meeting notes as plain files.').length - 1, 1, 'the description is printed once');
  assert.match(agents, /How to run it: see \[README\.md\]\(README\.md#how-to-run-it\)/);
  assert.match(agents, /Kind: Node CLI/);
  assert.match(agents, /<!-- keel:begin phases -->\n\*\*Status lives/);
  for (const f of ['CLAUDE.md', '.nvmrc', '.gitignore', 'docs/lessons.md', 'docs/ROADMAP.md',
    '.github/workflows/check.yml', '.github/workflows/keel-night.yml', 'scripts/keel/improve.mjs', 'scripts/keel/drain.mjs',
    'renovate.json', '.agents/skills/conduct/SKILL.md', '.claude/skills/conduct/SKILL.md']) {
    await readFile(join(dir, f), 'utf8');
  }

  assert.equal(await readFile(join(dir, '.github/workflows/claude.yml'), 'utf8').catch(() => null), null, 'claude is opt-in');

  // The facade check: the new project's own gate, run as a person would.
  const check = run('npm', ['run', 'check'], { cwd: dir, env: ENV });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.ok(testsRan(check.stdout + check.stderr) > 0, `the gate ran no tests:\n${check.stdout}${check.stderr}`);
  assert.match(check.stdout + check.stderr, /a well-formed phase parses/);

  // keel's render agrees nothing has drifted.
  const drift = keel(['render', '--check', '--json'], dir);
  assert.equal(drift.code, 0, drift.out);

  // One commit, clean tree, on main.
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: ENV }).trim();
  assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(git('rev-list', '--count', 'HEAD'), '1');
  assert.equal(git('status', '--porcelain'), '');
});

test('the first commit names the practice version and the keel that made it', async t => {
  const dir = await scratch(t);
  const r = keel(['init', '--name', 'Acme', '--description', DESCRIPTION], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /No keel on PATH\? Run it as npx -y github:dalmaer\/keel <verb>/, 'says how to run keel with nothing installed');
  assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).name, undefined, 'only --kind node names package.json');
  const version = JSON.parse(keel(['--version', '--json'], dir).out);
  const subject = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
  assert.equal(subject, `keel init: Acme on practice ${version.practice} (keel ${version.commit ?? 'no git'})`);
});

test('keel next inside the new project names phase 0', async t => {
  const dir = await scratch(t);
  assert.equal(keel(['init', '--description', DESCRIPTION], dir).code, 0);
  const r = keel(['next', '--json'], join(dir));
  assert.equal(r.code, 0, r.err);
  const next = JSON.parse(r.out);
  assert.equal(next.id, 0);
  assert.equal(next.title, PHASE0_TITLE);
  assert.equal(next.status, 'planned');
  assert.equal(next.title, 'The first thing that runs');
  assert.match(next.next, /Done when, Acceptance and Proof .* commit that edit on its own; then \/conduct\./);
  // A subdirectory finds it too.
  await mkdir(join(dir, 'src'));
  assert.equal(JSON.parse(keel(['next', '--json'], join(dir, 'src')).out).id, 0);
});

test('init refuses a directory that is already a keel project, and says update', async t => {
  const dir = await scratch(t);
  assert.equal(keel(['init', '--description', DESCRIPTION], dir).code, 0);
  const r = keel(['init', '--description', DESCRIPTION], dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /already a keel project — use keel update/);
  const j = keel(['init', '--description', DESCRIPTION, '--json'], dir);
  assert.equal(j.code, 2);
  assert.match(JSON.parse(j.out).error, /keel update/);
});

test('init refuses a non-empty directory, says adopt, and writes nothing', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'README.md'), '# Acme\n');
  const r = keel(['init', '--description', DESCRIPTION], dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /not empty .* use keel adopt/);
  assert.deepEqual(await readdir(dir), ['README.md']);
});

test('init accepts a directory holding only .git, and keeps that repo', async t => {
  const dir = await scratch(t);
  execFileSync('git', ['init', '-q', '-b', 'trunk', dir]);
  const r = keel(['init', '--description', DESCRIPTION], dir);
  assert.equal(r.code, 0, r.err);
  assert.equal(execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim(), 'trunk');
});

test('init without --description is a usage error', async t => {
  const dir = await scratch(t);
  const r = keel(['init'], dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /--description/);
  assert.equal(keel(['init', '--description', DESCRIPTION, '--kind', 'spaceship'], dir).code, 2);
  assert.deepEqual(await readdir(dir), []);
});

test('--github without --yes plans, creates nothing, and exits 3', async t => {
  const root = await scratch(t);
  const gh = await stubGh(root);
  const dir = join(root, 'Acme Notes');
  const r = keel(['init', dir, '--description', DESCRIPTION, '--github', '--json'], root, { ...ENV, KEEL_GH: gh.bin });
  assert.equal(r.code, 3, r.err || r.out);
  const out = JSON.parse(r.out);
  assert.equal(out.needs, 'yes');
  assert.equal(out.plan.repo, 'acme/acme-notes');
  assert.ok(out.plan.steps.some(s => s.what === `gh repo create acme/acme-notes --private --source ${dir} --push`));
  // Without --with claude no practice needs a secret: the night runs from the project.
  assert.deepEqual(out.plan.secrets, []);
  const calls = await gh.calls();
  assert.ok(!calls.some(c => c[0] === 'repo' || c[0] === 'secret'), `gh saw: ${JSON.stringify(calls)}`);
  assert.deepEqual(await readdir(root).then(n => n.sort()), ['gh', 'gh.log'], 'not even the directory');
  const plain = keel(['init', dir, '--description', DESCRIPTION, '--github'], root, { ...ENV, KEEL_GH: gh.bin });
  assert.match(plain.out, /Secrets needed:\n {2}none/);

  // --with claude: claude's secrets, each named with its workflow; none is set.
  const withClaude = JSON.parse(keel(['init', dir, '--description', DESCRIPTION, '--github', '--with', 'claude', '--json'], root, { ...ENV, KEEL_GH: gh.bin }).out);
  assert.deepEqual(withClaude.plan.secrets.map(s => [s.name, s.workflow, s.practice, s.set]), SECRETS.map(s => [...s, false]));
  assert.ok(withClaude.plan.secrets.every(s => s.why), 'each says why');
  const text = keel(['init', dir, '--description', DESCRIPTION, '--github', '--with', 'claude'], root, { ...ENV, KEEL_GH: gh.bin });
  assert.equal(text.code, 3);
  assert.match(text.out, /needs a yes/);
  assert.match(text.out, /Secrets needed:\n {2}CLAUDE_CODE_OAUTH_TOKEN \(\.github\/workflows\/claude\.yml\): .* — not set; keel never sets one/);
  assert.doesNotMatch(text.out, /KEEL_TOKEN/);
});

test('--github --yes inits, then creates the private repo from the directory and pushes', async t => {
  const root = await scratch(t);
  const gh = await stubGh(root);
  const dir = join(root, 'acme-notes');
  const r = keel(['init', dir, '--description', DESCRIPTION, '--github', '--yes', '--with', 'claude', '--json'], root, { ...ENV, KEEL_GH: gh.bin });
  assert.equal(r.code, 0, r.err || r.out);
  const out = JSON.parse(r.out);
  assert.equal(out.github.repo, 'acme/acme-notes');
  assert.deepEqual(out.github.secrets.map(s => s.name), SECRETS.map(s => s[0]));
  const calls = await gh.calls();
  assert.deepEqual(calls.find(c => c[0] === 'repo'), ['repo', 'create', 'acme/acme-notes', '--private', '--source', dir, '--push']);
  assert.ok(!calls.some(c => c[0] === 'secret' && c[1] === 'set'), 'never sets a secret');
  const config = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  assert.equal(config.repo, 'acme/acme-notes');
  assert.ok(config.practices.includes('claude'), '--with claude switches it on');
  await readFile(join(dir, '.github/workflows/claude.yml'), 'utf8');
  // The commit exists before the push.
  assert.equal(execFileSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), '1');
});

test('--repo names the repo without asking gh who you are', async t => {
  const root = await scratch(t);
  const gh = await stubGh(root);
  const r = keel(['init', 'x', '--description', DESCRIPTION, '--repo', 'acme/elsewhere', '--github', '--with', 'claude', '--json'], root, { ...ENV, KEEL_GH: gh.bin });
  assert.equal(r.code, 3);
  assert.equal(JSON.parse(r.out).plan.repo, 'acme/elsewhere');
  assert.ok(!(await gh.calls()).some(c => c[0] === 'api'), 'never asks gh who you are');
  assert.deepEqual((await gh.calls()).map(c => c.slice(0, 2)), [['secret', 'list']], 'only reads which secrets are set');
});

test('--with takes only optional practices, and switches each on', async t => {
  const root = await scratch(t);
  for (const name of ['ci', 'nope']) {
    const r = keel(['init', 'x', '--description', DESCRIPTION, '--with', name], root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.err, /--with takes loop, claude|--with takes claude, loop/);
  }
  assert.deepEqual(await readdir(root), [], 'nothing written');
  const r = keel(['init', 'y', '--description', DESCRIPTION, '--with', 'claude,loop', '--json'], root);
  assert.equal(r.code, 0, r.err || r.out);
  const out = JSON.parse(r.out);
  assert.deepEqual(out.config.practices.slice(-3), ['claude', 'renovate', 'loop']);
  assert.deepEqual([...new Set(out.secrets.map(s => s.practice))], ['claude', 'loop']);
});

test('a missing placeholder is an error only where a template uses it', () => {
  assert.equal(fill('# {{name}}', { name: 'Acme' }, 'x.md'), '# Acme');
  assert.throws(() => fill('{{repo}}', { name: 'Acme' }, 'x.md'), /\{\{repo\}\} has no value/);
});

test('phase 0 comes from the phase template and parses', async () => {
  const template = await readFile(join(KEEL, 'practices/phases/files/docs/templates/phase.md'), 'utf8');
  const p = parsePhase('00-first-thing-that-runs.md', phaseZero(template, { name: 'Acme', kind: 'web', since: '2026-10-02' }));
  assert.equal(p.title, PHASE0_TITLE);
  assert.equal(p.goal, 'G0');
  assert.equal(p.since, '2026-10-02');
  assert.equal(firstSentence('One. Two.'), 'One.');
  assert.equal(firstSentence('No full stop'), 'No full stop');
  assert.equal(goalTitle('Short. Then more.'), 'Short');
  const long = goalTitle('Acme Ledger reconciles every invoice against every payment it can find in the shared drive folders. More.');
  assert.ok(long.length <= 80, long);
  assert.equal(long, 'Acme Ledger reconciles every invoice against every payment it can find in the…');
  assert.equal(npmName('Acme Notes!'), 'acme-notes');
  assert.equal(npmName('_Acme'), 'acme');
});

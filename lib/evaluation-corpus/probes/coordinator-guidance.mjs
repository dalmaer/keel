// Independent first-use acceptance for dalmaer/plates
// docs/development/validation-preflight.md at 35f392620e8e06f0038e1e88370be9b0958b3f19
// (Apache-2.0). Executes actual pinned scripts/validation-budget.mjs and runtime.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../', import.meta.url));
const docs = await readFile(join(source, 'docs/development/validation-preflight.md'), 'utf8');
// Bounded procedure language, not a natural-language semantic grader. Each
// supported sentence has a declared obligation. Whole sentences must match;
// mixed wording/order is allowed, unknown sentences (including contradictions)
// refuse. This covers the first-use block in the named coordinator section,
// not arbitrary advice elsewhere in this document.
const sectionParts = docs.split('## Coordinate cooperative heavy runs explicitly');
assert.equal(sectionParts.length, 2, 'one coordinator guidance section required');
const section = sectionParts[1].split(/\n## /)[0];
const boundary = 'Conflicting capacity settings refuse admission instead of expanding the budget.';
const blocks = section.split(boundary);
assert.equal(blocks.length, 2, 'supported coordinator policy boundary required');
const procedureParts = blocks[1].split('Preview a source gate with capacity one; this neither creates state nor runs it:');
assert.equal(procedureParts.length, 2, 'supported preview boundary required');
const procedure = procedureParts[0].trim().replace(/\s+/g, ' ');
// The evaluator supplies its private, digest-bound accepted forms through stdin.
// Never deliver this oracle in the builder file inventory.
const inputChunks = []; let inputBytes = 0;
for await (const chunk of process.stdin) {
  inputBytes += chunk.length;
  assert.ok(inputBytes <= 16384, 'private acceptance input exceeds bound');
  inputChunks.push(chunk);
}
const statements = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(inputChunks)));
const obligations = ['absent-path-and-parent', 'no-precreation', 'ambiguous-state-refusal', 'concurrent-initialization', 'inspect-without-reset'];
assert.ok(statements && typeof statements === 'object' && !Array.isArray(statements), 'private acceptance map required');
assert.deepEqual(Object.keys(statements).sort(), [...obligations].sort(), 'exact private acceptance obligations required');
for (const forms of Object.values(statements)) {
  assert.ok(Array.isArray(forms) && forms.length === 2 && forms.every(form => typeof form === 'string' && form.length > 0 && form.length <= 1024 && form === form.trim() && !/[\r\n]/.test(form)), 'two bounded sentence forms required');
}
const forms = Object.values(statements).flat().map(form => form.toLowerCase());
assert.equal(new Set(forms).size, forms.length, 'private acceptance forms must be unique');
const covered = new Set();
for (const sentence of procedure ? procedure.split(/(?<=\.)\s+/) : []) {
  const entry = Object.entries(statements).find(([, forms]) => forms.some(form => form.toLowerCase() === sentence.toLowerCase()));
  assert.ok(entry, 'unsupported or contradictory first-use statement; bounded procedure language only');
  assert.ok(!covered.has(entry[0]), 'duplicate first-use obligation');
  covered.add(entry[0]);
}
for (const requirement of ['absent-path-and-parent', 'no-precreation', 'ambiguous-state-refusal', 'inspect-without-reset']) {
  assert.ok(covered.has(requirement), `missing first-use obligation: ${requirement}`);
}
// Validate the complete coordinator command blocks, not just a matching line
// hidden beside additional instructions. Never shell-evaluate documentation.
const fences = [...section.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)];
assert.equal(fences.length, 2, 'one plan and one status command block required');
const allowedPlan = /^node scripts\/validation-budget\.mjs plan --manifest "\$\(pwd -P\)\/plates\.json" --repo [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+ --root "\$\(pwd -P\)" --state-dir (\/absolute\/[A-Za-z0-9_/-]+) --capacity 1 --weight 1 --foreground-contract --json -- npm run check$/;
const allowedStatus = /^node scripts\/validation-budget\.mjs status --state-dir (\/absolute\/[A-Za-z0-9_/-]+) --json$/;
assert.equal(fences[0][1], 'sh'); assert.equal(fences[1][1], 'sh');
assert.match(fences[0][2].trim(), allowedPlan, 'unsupported documented command form; never execute arbitrary docs');
assert.match(fences[1][2].trim(), allowedStatus, 'unsupported documented status command');
assert.equal(fences[0][2].trim().match(allowedPlan)[1], fences[1][2].trim().match(allowedStatus)[1], 'plan and status must use the same coordinator');
assert.match(section.replace(/\s+/g, ' '), /Use `run` in place of `plan`/);
const root = await realpath(await mkdtemp(join(tmpdir(), 'acme-coordinator-')));
const repository = join(root, 'repository'), manifest = join(root, 'plates.json'), state = join(root, 'coordinator');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST_') && !key.startsWith('GIT_') && !key.startsWith('npm_config_')));
Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Acme', GIT_AUTHOR_EMAIL: 'acme@example.test', GIT_COMMITTER_NAME: 'Acme', GIT_COMMITTER_EMAIL: 'acme@example.test',
  GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false', GIT_CONFIG_KEY_2: 'core.hooksPath', GIT_CONFIG_VALUE_2: '/dev/null', npm_config_cache: join(root, 'npm-cache') });
function run(command, args, cwd = repository) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 20000, maxBuffer: 65536, shell: false });
  assert.ifError(result.error); return result;
}
try {
  await mkdir(join(repository, '.plates'), { recursive: true });
  await writeFile(join(repository, '.plates/plates.json'), JSON.stringify({ repo: 'Acme/widget' }));
  await writeFile(manifest, JSON.stringify([{ repo: 'Acme/widget', role: 'managed' }]));
  await writeFile(join(repository, 'package.json'), JSON.stringify({ name: 'acme-fixture', private: true, scripts: { check: 'node check.mjs' } }));
  await writeFile(join(repository, 'check.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('acme-ran','Acme ran\\n',{flag:'wx'});\n");
  for (const args of [['init', '-q'], ['add', '.'], ['commit', '-qm', 'Acme fixture'], ['remote', 'add', 'origin', 'https://github.com/Acme/widget.git']]) {
    const r = run('git', args); assert.equal(r.status, 0, r.stderr);
  }
  const args = mode => [join(source, 'scripts/validation-budget.mjs'), mode, '--manifest', manifest, '--repo', 'Acme/widget', '--root', repository, '--state-dir', state, '--capacity', '1', '--weight', '1', '--foreground-contract', '--json', '--', 'npm', 'run', 'check'];
  const preview = run(process.execPath, args('plan')); assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).executes, false);
  await assert.rejects(lstat(state), { code: 'ENOENT' });
  await assert.rejects(lstat(join(repository, 'acme-ran')), { code: 'ENOENT' });
  const first = run(process.execPath, args('run')); assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).released, true);
  assert.equal(await readFile(join(repository, 'acme-ran'), 'utf8'), 'Acme ran\n');
  const retained = await readFile(join(state, 'state.json'));
  const empty = join(root, 'empty'); await mkdir(empty, { mode: 0o700 });
  const before = await lstat(empty), emptyArgs = args('run'); emptyArgs[emptyArgs.indexOf('--state-dir') + 1] = empty;
  const refused = run(process.execPath, emptyArgs); assert.equal(refused.status, 2, refused.stderr);
  assert.equal(JSON.parse(refused.stderr).error, 'state_missing_or_initializing_inspect');
  assert.deepEqual(await readdir(empty), []); const after = await lstat(empty);
  assert.equal(after.ino, before.ino); assert.equal(after.mode, before.mode);
  assert.deepEqual(await readFile(join(state, 'state.json')), retained, 'existing coordinator bytes preserved');
  assert.equal(await readFile(join(repository, 'acme-ran'), 'utf8'), 'Acme ran\n', 'refusal never reruns the command');
  process.stdout.write('Acme coordinator guidance accepted\n');
} finally { await rm(root, { recursive: true, force: true }); }

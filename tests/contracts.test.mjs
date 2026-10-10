// Read this before touching that (phase 65): .keel/keel.json "contracts" maps
// path patterns to the document to read first. Render writes them into the
// agents-md block as a table (and leaves the block's bytes alone without
// them), seeds the Claude Code hook that names the document before an edit,
// and doctor notes a document that is missing or a pattern matching nothing.
// Git the same on every machine, also when this file is run alone without npm test's --import (the phase's Proof).
import './helpers/hermetic.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';
import { load, fill, contractsTable, blockBody } from '../lib/practices.mjs';
import { contractsFor, contractProblems, hookLines } from '../practices/agents-md/files/scripts/keel/contract-hook.mjs';
import { hookGap } from '../lib/doctor.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const HOOK = join(KEEL, 'practices', 'agents-md', 'files', 'scripts', 'keel', 'contract-hook.mjs');
const keel = (args, cwd) => run(process.execPath, [BIN, ...args], { cwd });
const git = (cwd, ...args) => run('git', args, { cwd });

const CONTRACTS = [
  { paths: ['src/index/**'], read: 'docs/engine/indexing.md', why: 'the index format is measured, not guessed' },
  { paths: ['src/store/*.mjs', 'src/store/schema.json'], read: 'docs/engine/store.md', why: 'every field has a reader elsewhere' },
];

/** One keel init'd project, made once and copied per test. */
let template;
async function project(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-contracts-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (!template) {
    template = await realpath(await mkdtemp(join(tmpdir(), 'keel-contracts-template-')));
    process.on('exit', () => rmSync(template, { recursive: true, force: true }));
    const r = keel(['init', join(template, 'acme-index'), '--description', 'Acme Index finds notes by their words.', '--kind', 'node'], template);
    assert.equal(r.status, 0, r.stderr);
  }
  await cp(join(template, 'acme-index'), join(dir, 'acme-index'), { recursive: true, verbatimSymlinks: true });
  return join(dir, 'acme-index');
}

async function setConfig(root, change) {
  const path = join(root, '.keel', 'keel.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  change(config);
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

/** The project's own files the contracts point at, committed so git ls-files sees them. */
async function contractFiles(root) {
  for (const [path, text] of [['src/index/build.mjs', 'export const build = () => [];\n'], ['src/store/save.mjs', 'export const save = () => {};\n'],
    ['src/store/schema.json', '{}\n'], ['docs/engine/indexing.md', '# Indexing\n'], ['docs/engine/store.md', '# Store\n']]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  assert.equal(git(root, 'add', '-A').status, 0);
  assert.equal(git(root, 'commit', '-q', '-m', 'acme: the index and the store').status, 0);
}

const exists = path => stat(path).then(() => true, () => false);
const doctorJson = root => { const r = keel(['doctor', '--json'], root); return { code: r.status, data: JSON.parse(r.stdout), err: r.stderr }; };

/** Run the hook as Claude Code does: the PreToolUse JSON on stdin. */
const hook = (input, env = {}) => run(process.execPath, [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), env: { ...process.env, ...env } });

test('a contract matches by whole-path glob, and a bad one is named', () => {
  assert.deepEqual(contractsFor(CONTRACTS, 'src/index/deep/a.mjs').map(c => c.read), ['docs/engine/indexing.md']);
  assert.deepEqual(contractsFor(CONTRACTS, 'src/store/save.mjs').map(c => c.read), ['docs/engine/store.md']);
  assert.deepEqual(contractsFor(CONTRACTS, 'src/store/nested/save.mjs'), [], '* stays within one directory');
  assert.deepEqual(contractsFor(CONTRACTS, 'src/indexer.mjs'), []);
  assert.deepEqual(contractProblems(undefined), []);
  assert.equal(contractProblems({}).length, 1);
  assert.match(contractProblems([{ paths: [], read: 'a.md', why: 'x' }])[0], /"paths"/);
  assert.match(contractProblems([{ paths: ['a'], read: '../a.md', why: 'x' }])[0], /"read"/);
  assert.match(contractProblems([{ paths: ['a'], read: 'a.md' }])[0], /"why"/);
});

test('contracts render into the guide as a table; without them the block is the template, byte for byte', async t => {
  const practices = await load();
  const block = practices.get('agents-md').files.find(f => f.kind === 'block');
  const config = { name: 'Acme', tagline: 'x', repo: 'acme/index', practices: ['agents-md'] };
  assert.equal(fill(block.template, config, block.path, block.block), block.template, 'no contracts: the block is the template\'s bytes');
  assert.equal(fill(block.template, { ...config, contracts: [] }, block.path, block.block), block.template);
  assert.equal(contractsTable([]), '');

  const root = await project(t);
  const before = await readFile(join(root, 'AGENTS.md'), 'utf8');
  assert.equal(blockBody(before, 'agents-md'), block.template, 'an init\'d project without contracts has the template\'s block');
  assert.equal(await exists(join(root, 'scripts/keel/contract-hook.mjs')), false, 'no contracts: no hook script');
  assert.equal(await exists(join(root, '.claude/settings.json')), false, 'no contracts: no settings');

  await contractFiles(root);
  await setConfig(root, c => { c.contracts = CONTRACTS; });
  const r = keel(['render', '--json'], root);
  assert.equal(r.status, 0, r.stderr);
  const body = blockBody(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'agents-md');
  assert.ok(body.startsWith(block.template), 'the table follows the block\'s own text');
  assert.match(body, /\| Paths \| Read first \| Why \|/);
  assert.match(body, /\| `src\/index\/\*\*` \| `docs\/engine\/indexing\.md` \| the index format is measured, not guessed \|/);
  assert.match(body, /\| `src\/store\/\*\.mjs`, `src\/store\/schema\.json` \| `docs\/engine\/store\.md` \|/);
  assert.equal(await readFile(join(root, 'scripts/keel/contract-hook.mjs'), 'utf8'), await readFile(HOOK, 'utf8'), 'the hook script is keel\'s');
  const settings = JSON.parse(await readFile(join(root, '.claude/settings.json'), 'utf8'));
  const entry = settings.hooks.PreToolUse[0];
  assert.equal(entry.matcher, 'Edit|Write|MultiEdit');
  assert.match(entry.hooks[0].command, /scripts\/keel\/contract-hook\.mjs/);
  assert.equal(keel(['render', '--check'], root).status, 0, 'rendered: render --check is clean');
  const lock = JSON.parse(await readFile(join(root, '.keel/lock.json'), 'utf8'));
  assert.ok(lock.files['scripts/keel/contract-hook.mjs'], 'the lock knows the hook script');
});

test('render leaves a project\'s own .claude/settings.json alone, and doctor says the hook is not in it', async t => {
  const root = await project(t);
  await contractFiles(root);
  await mkdir(join(root, '.claude'), { recursive: true });
  const own = `${JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }, null, 2)}\n`;
  await writeFile(join(root, '.claude/settings.json'), own);
  await setConfig(root, c => { c.contracts = CONTRACTS; });
  assert.equal(keel(['render'], root).status, 0);
  assert.equal(await readFile(join(root, '.claude/settings.json'), 'utf8'), own, 'seeded: never written over');
  const { data } = doctorJson(root);
  assert.deepEqual(data.notes.filter(n => n.rule.startsWith('contract-')).map(n => n.rule), ['contract-hook']);
});

test('doctor notes a missing document and a pattern no tracked file matches, and nothing when both hold', async t => {
  const root = await project(t);
  await contractFiles(root);
  await setConfig(root, c => { c.contracts = CONTRACTS; });
  assert.equal(keel(['render'], root).status, 0);
  let { data } = doctorJson(root);
  assert.deepEqual(data.notes.filter(n => n.rule.startsWith('contract-')), [], 'docs exist, patterns match: no note');

  await setConfig(root, c => { c.contracts = [...CONTRACTS, { paths: ['src/search/**'], read: 'docs/engine/search.md', why: 'ranking is tuned' }]; });
  assert.equal(keel(['render'], root).status, 0);
  ({ data } = doctorJson(root));
  const notes = data.notes.filter(n => n.rule.startsWith('contract-'));
  assert.deepEqual(notes.map(n => n.rule).sort(), ['contract-doc-missing', 'contract-unmatched']);
  assert.match(notes.find(n => n.rule === 'contract-doc-missing').message, /docs\/engine\/search\.md/);
  assert.match(notes.find(n => n.rule === 'contract-unmatched').message, /src\/search\/\*\*/);
  assert.equal(data.lint.filter(l => l.rule.startsWith('contract')).length, 0, 'notes, never findings');
});

test('contracts keel cannot read: doctor finds them, and render refuses with the reason', async t => {
  const root = await project(t);
  await setConfig(root, c => { c.contracts = [{ paths: 'src/**', read: 'docs/a.md', why: 'x' }]; });
  const { code, data } = doctorJson(root);
  assert.equal(code, 1);
  assert.deepEqual(data.lint.filter(l => l.rule === 'contracts-config').map(l => l.path), ['.keel/keel.json']);
  const r = keel(['render'], root);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /"contracts"\[0\]: "paths"/);
});

test('the hook prints the document for a matching path, and stays silent otherwise; it never blocks', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'keel-contract-hook-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', contracts: CONTRACTS }));
  const env = { CLAUDE_PROJECT_DIR: root };

  const hit = hook({ hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Edit', tool_input: { file_path: join(root, 'src/index/build.mjs') } }, env);
  assert.equal(hit.status, 0);
  const out = JSON.parse(hit.stdout);
  const line = 'Before editing src/index/build.mjs, read docs/engine/indexing.md: the index format is measured, not guessed';
  assert.equal(out.hookSpecificOutput.additionalContext, line);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.systemMessage, line);
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, 'it never decides the edit');

  // A relative path from the input's cwd, without CLAUDE_PROJECT_DIR.
  const rel = hook({ cwd: root, tool_name: 'Write', tool_input: { file_path: 'src/store/schema.json' } }, { CLAUDE_PROJECT_DIR: '' });
  assert.equal(rel.status, 0);
  assert.match(JSON.parse(rel.stdout).hookSpecificOutput.additionalContext, /^Before editing src\/store\/schema\.json, read docs\/engine\/store\.md: /);

  for (const input of [
    { cwd: root, tool_name: 'Edit', tool_input: { file_path: join(root, 'src/indexer.mjs') } },
    { cwd: root, tool_name: 'Edit', tool_input: { file_path: join(tmpdir(), 'elsewhere', 'src/index/a.mjs') } },
    { cwd: root, tool_name: 'Edit', tool_input: {} },
    'not json',
  ]) {
    const r = hook(input, env);
    assert.equal(r.status, 0, `never blocks: ${JSON.stringify(input)}`);
    assert.equal(r.stdout, '', `silent: ${JSON.stringify(input)}`);
  }

  // A config it cannot read: silent, exit 0.
  await writeFile(join(root, '.keel/keel.json'), '{ broken');
  const broken = hook({ cwd: root, tool_name: 'Edit', tool_input: { file_path: join(root, 'src/index/build.mjs') } }, env);
  assert.equal(broken.status, 0);
  assert.equal(broken.stdout, '');
  assert.deepEqual(hookLines({ tool_input: { file_path: join(root, 'src/index/a.mjs') } }, { contracts: [{ paths: 'x' }] }, root), [], 'bad contracts: silent');
});

test('doctor counts the hook only when settings run it as a PreToolUse hook on Edit, Write and MultiEdit (review of PR 58)', async () => {
  const seeded = await readFile(join(KEEL, 'practices', 'agents-md', 'files', '.claude', 'settings.json'), 'utf8');
  assert.equal(hookGap(seeded), null, 'what keel seeds runs it');
  const hook = (matcher, command = 'node "$CLAUDE_PROJECT_DIR"/scripts/keel/contract-hook.mjs', extra = {}) =>
    JSON.stringify({ ...extra, hooks: { PreToolUse: [{ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: 'command', command }] }] } });
  assert.equal(hookGap(hook('Edit|Write|MultiEdit')), null);
  assert.equal(hookGap(hook(undefined)), null, 'no matcher: every tool');
  assert.equal(hookGap(hook('Edit|MultiEdit|Write|NotebookEdit')), null);
  assert.equal(hookGap(hook('Edit|Write|MultiEdit', 'cd "$CLAUDE_PROJECT_DIR" && NODE_NO_WARNINGS=1 node --no-deprecation scripts/keel/contract-hook.mjs')), null);
  assert.equal(hookGap(hook('Edit|Write|MultiEdit', 'node ./scripts/keel/contract-hook.mjs # contracts')), null);
  for (const [why, text] of [
    ['named only in a permission', JSON.stringify({ permissions: { allow: ['Bash(node scripts/keel/contract-hook.mjs)'] } })],
    ['on another event', JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'node scripts/keel/contract-hook.mjs' }] }] } })],
    ['a matcher that misses Write', hook('Edit|MultiEdit')],
    ['a matcher for Bash', hook('Bash')],
    ['another script', hook('Edit|Write|MultiEdit', 'node scripts/keel/contract-hook.mjs.bak')],
    ['every hook off', hook('Edit|Write|MultiEdit', undefined, { disableAllHooks: true })],
    ['not JSON', '{ hooks'],
    // Review of PR 58, round 6: a command that only mentions the path does not run it.
    ['an echo of the path', hook('Edit|Write|MultiEdit', 'echo scripts/keel/contract-hook.mjs')],
    ['the path in a comment', hook('Edit|Write|MultiEdit', 'true # node scripts/keel/contract-hook.mjs')],
    ['node running another script that names it', hook('Edit|Write|MultiEdit', 'node scripts/other.mjs scripts/keel/contract-hook.mjs')],
  ]) assert.ok(hookGap(text), why);
});

test('a conditional target turned off keeps its lock row, so an edit made while dormant is never overwritten (review of PR 58)', async t => {
  const root = await project(t);
  await contractFiles(root);
  await setConfig(root, c => { c.contracts = CONTRACTS; });
  assert.equal(keel(['render'], root).status, 0);
  const lockOf = async () => JSON.parse(await readFile(join(root, '.keel/lock.json'), 'utf8')).files;
  const row = (await lockOf())['scripts/keel/contract-hook.mjs'];
  assert.ok(row);

  // Contracts off: the file stays where it is, and so does its row.
  await setConfig(root, c => { delete c.contracts; });
  const off = keel(['render'], root);
  assert.equal(off.status, 0, off.stderr);
  assert.deepEqual((await lockOf())['scripts/keel/contract-hook.mjs'], row, 'the dormant target keeps its row');
  assert.equal(await exists(join(root, 'scripts/keel/contract-hook.mjs')), true);

  // The project edits it while it is dormant, then turns contracts back on: render refuses, naming it.
  const edited = `${await readFile(HOOK, 'utf8')}// Acme's own line\n`;
  await writeFile(join(root, 'scripts/keel/contract-hook.mjs'), edited);
  await setConfig(root, c => { c.contracts = CONTRACTS; });
  const on = keel(['render'], root);
  assert.equal(on.status, 1, on.stdout + on.stderr);
  assert.match(on.stderr, /refusing to overwrite what the project changed \(scripts\/keel\/contract-hook\.mjs edited\)/);
  assert.equal(await readFile(join(root, 'scripts/keel/contract-hook.mjs'), 'utf8'), edited, 'the edit is kept');
});

test('a brace alternative is a glob of its own, so src/{*.js,*.ts} matches and never crashes doctor or silences the hook (review of PR 58)', async t => {
  const list = [{ paths: ['src/{*.js,*.ts}', 'lib/{a,{b,c}}/**'], read: 'docs/engine/src.md', why: 'the source is measured' }];
  assert.deepEqual(contractProblems(list), []);
  assert.equal(contractsFor(list, 'src/a.js').length, 1);
  assert.equal(contractsFor(list, 'src/a.ts').length, 1);
  assert.equal(contractsFor(list, 'src/a.md').length, 0);
  assert.equal(contractsFor(list, 'src/deep/a.js').length, 0, '* inside braces stays within one directory');
  assert.equal(contractsFor(list, 'lib/c/x/y.mjs').length, 1, 'nested braces');
  assert.equal(contractsFor(list, 'lib/d/y.mjs').length, 0);

  const root = await project(t);
  await contractFiles(root);
  await setConfig(root, c => { c.contracts = [{ paths: ['src/{index/*.mjs,store/*.json}'], read: 'docs/engine/indexing.md', why: 'the index format is measured' }]; });
  assert.equal(keel(['render'], root).status, 0);
  const { code, data, err } = doctorJson(root);
  assert.equal(code, 0, err);
  assert.deepEqual(data.notes.filter(n => n.rule.startsWith('contract-')), [], 'both alternatives match tracked files');
  const hit = hook({ cwd: root, tool_name: 'Edit', tool_input: { file_path: join(root, 'src/store/schema.json') } }, { CLAUDE_PROJECT_DIR: root });
  assert.equal(hit.status, 0);
  assert.match(JSON.parse(hit.stdout).hookSpecificOutput.additionalContext, /^Before editing src\/store\/schema\.json, read docs\/engine\/indexing\.md/);
});

test('where adopt skipped the agents-md block, doctor names the contract rows AGENTS.md lacks, word for word, and render never writes them (review of PR 58)', async t => {
  const root = await project(t);
  await contractFiles(root);
  // The project's AGENTS.md states the agents-md rule in its own words: adopt skipped the block.
  const agents = await readFile(join(root, 'AGENTS.md'), 'utf8');
  const own = agents.replace(/<!-- keel:begin agents-md -->[\s\S]*?<!-- keel:end agents-md -->\n?/, 'Acme asks before spending money.\n');
  await writeFile(join(root, 'AGENTS.md'), own);
  await setConfig(root, c => { c.blocksSkipped = ['agents-md']; c.contracts = CONTRACTS; });
  assert.equal(keel(['render'], root).status, 0);
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), own, 'the project\'s prose is untouched');
  let { data } = doctorJson(root);
  const note = data.notes.find(n => n.rule === 'contract-guide');
  assert.ok(note, JSON.stringify(data.notes));
  assert.equal(note.text, contractsTable(CONTRACTS).trim());
  assert.match(note.message, /\| `src\/index\/\*\*` \| `docs\/engine\/indexing\.md` \|/);

  // Once the guide names one, only the other is asked for; once it names both, nothing.
  await writeFile(join(root, 'AGENTS.md'), `${own}\nBefore touching the index, read docs/engine/indexing.md.\n`);
  ({ data } = doctorJson(root));
  assert.equal(data.notes.find(n => n.rule === 'contract-guide').text, contractsTable([CONTRACTS[1]]).trim());
  await writeFile(join(root, 'AGENTS.md'), `${own}\nRead docs/engine/indexing.md and docs/engine/store.md first.\n`);
  ({ data } = doctorJson(root));
  assert.equal(data.notes.find(n => n.rule === 'contract-guide'), undefined);

  // With the block rendered, the table is there and no note is raised.
  const plain = await project(t);
  await contractFiles(plain);
  await setConfig(plain, c => { c.contracts = CONTRACTS; });
  assert.equal(keel(['render'], plain).status, 0);
  assert.equal(doctorJson(plain).data.notes.find(n => n.rule === 'contract-guide'), undefined);
});

test('a project\'s own scripts/keel/contract-hook.mjs survives the first contract: render refuses it as edited, doctor names it (review of PR 58)', async t => {
  const root = await project(t);
  await contractFiles(root);
  const own = '// Acme\'s own pre-edit hook.\nconsole.log("acme");\n';
  await mkdir(join(root, 'scripts', 'keel'), { recursive: true });
  await writeFile(join(root, 'scripts/keel/contract-hook.mjs'), own);
  await setConfig(root, c => { c.contracts = CONTRACTS; });
  const r = keel(['render'], root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /refusing to overwrite what the project changed \(scripts\/keel\/contract-hook\.mjs edited\)/);
  assert.equal(await readFile(join(root, 'scripts/keel/contract-hook.mjs'), 'utf8'), own, 'byte-identical');
  const { data } = doctorJson(root);
  assert.deepEqual(data.drift.filter(d => d.path === 'scripts/keel/contract-hook.mjs').map(d => d.state), ['edited']);
});

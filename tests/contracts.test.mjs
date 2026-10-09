// Read this before touching that (phase 65): .keel/keel.json "contracts" maps
// path patterns to the document to read first. Render writes them into the
// agents-md block as a table (and leaves the block's bytes alone without
// them), seeds the Claude Code hook that names the document before an edit,
// and doctor notes a document that is missing or a pattern matching nothing.
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

// Migration 0004 (phase 33): a node test script gains the test ledger's two
// reporter pairs, in the update PR; any other test script is never touched;
// AGENTS.md gains the night block's markers. Idempotent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { view, collect } from '../lib/migrations.mjs';
import * as m0004 from '../migrations/0004-test-ledger.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTERS = '--test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout';

async function acme(t, { script = 'node --test tests/*.test.mjs', practices = ['base', 'agents-md', 'night'], agents = '# Working on Acme\n\nAcme\'s own rules.\n', extra = {}, pkg } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-0004-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', practices, ...extra }, null, 2));
  if (pkg !== null) await writeFile(join(dir, 'package.json'), pkg ?? `{\n  "name": "acme",\n  "scripts": {\n    "check": "npm test",\n    "test": ${JSON.stringify(script)}\n  }\n}\n`);
  if (agents !== null) await writeFile(join(dir, 'AGENTS.md'), agents);
  return dir;
}

/** What the migration does: its edits as { path: content }, or null when it does not apply. */
async function edits(dir, m = m0004) {
  const project = await view(dir);
  if (!(await m.applies(project))) return null;
  return Object.fromEntries((await m.up(project)).map(e => [e.path, e.content]));
}

/** The rule: node's runner gains the reporters after --test; nothing else is touched. */
async function assertOnlyNode(t, m = m0004) {
  for (const [script, want] of [
    ['node --test tests/*.test.mjs', `node --test ${REPORTERS} tests/*.test.mjs`],
    ['node --test', `node --test ${REPORTERS}`],
    ['node --import ./tests/helpers/acme.mjs --test --test-concurrency=4 tests/*.test.mjs', `node --import ./tests/helpers/acme.mjs --test ${REPORTERS} --test-concurrency=4 tests/*.test.mjs`],
  ]) {
    const dir = await acme(t, { script, agents: null });
    const e = await edits(dir, m);
    assert.ok(e, script);
    assert.deepEqual(Object.keys(e), ['package.json'], script);
    assert.equal(JSON.parse(e['package.json']).scripts.test, want, script);
    assert.equal(e['package.json'], (await readFile(join(dir, 'package.json'), 'utf8')).replace(JSON.stringify(script), JSON.stringify(want)), 'only the script\'s own string changes');
  }
  for (const script of ['vitest run', 'jest', 'npm run unit', 'node scripts/test.mjs --test', 'tsx --test tests/a.ts', 'node --test-only tests/a.mjs', 'node --test --test-reporter=dot tests/*.mjs', `node --test ${REPORTERS} tests/*.test.mjs`]) {
    assert.equal(await edits(await acme(t, { script, agents: null }), m), null, `never touched: ${script}`);
  }
}

test('0004: a node --test script gains the two reporter pairs, after --test; any other test script is never touched', async t => {
  await assertOnlyNode(t);
});

test('mutation: a 0004 that touches a script that is not node\'s runner fails the test above', async t => {
  const text = await readFile(join(KEEL, 'migrations', '0004-test-ledger.mjs'), 'utf8');
  const rule = 'const NODE_TEST = /^node(?:\\s+--(?:import|require)(?:=|\\s+)\\S+)*\\s+--test(?=\\s|$)/;';
  assert.ok(text.includes(rule));
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-0004-mutant-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'm.mjs'), text.replace(rule, 'const NODE_TEST = /^\\S+(?:\\s+--test)?/;'));
  const mutant = await import(pathToFileURL(join(dir, 'm.mjs')).href);
  await assert.rejects(assertOnlyNode(t, mutant), assert.AssertionError);
});

test('0004: AGENTS.md gains the night block\'s empty markers, every byte kept; not when skipped or ejected', async t => {
  const agents = '# Working on Acme\n\nAcme\'s own rules.';
  const dir = await acme(t, { agents, script: 'vitest run' });
  const e = await edits(dir);
  assert.deepEqual(Object.keys(e), ['AGENTS.md'], 'a vitest project gets the markers, and its script stays');
  assert.ok(e['AGENTS.md'].startsWith(agents));
  assert.match(e['AGENTS.md'], /\n<!-- keel:begin night -->\n<!-- keel:end night -->\n$/);
  assert.equal(await edits(await acme(t, { agents, script: 'vitest run', extra: { blocksSkipped: ['night'] } })), null);
  assert.equal(await edits(await acme(t, { agents, script: 'vitest run', extra: { ejected: ['AGENTS.md#night'] } })), null);
});

test('0004 applies only with the night practice on, is idempotent over its own edits, and leaves no package.json alone', async t => {
  assert.equal(await edits(await acme(t, { practices: ['base', 'agents-md'] })), null, 'no night: no reporter file to point at');
  assert.equal(await edits(await acme(t, { pkg: null, agents: '<!-- keel:begin night -->\n<!-- keel:end night -->\n' })), null, 'no package.json');
  assert.equal(await edits(await acme(t, { pkg: '{ not json', agents: '<!-- keel:begin night -->\n<!-- keel:end night -->\n' })), null, 'a package.json that does not parse is not ours to repair');
  const dir = await acme(t);
  const { applied, edits: overlay } = await collect(dir, [m0004]);
  assert.deepEqual(applied.map(m => m.id), ['0004-test-ledger']);
  assert.deepEqual([...overlay.keys()].sort(), ['AGENTS.md', 'package.json']);
  // Over its own edits it no longer applies.
  for (const [path, content] of overlay) await writeFile(join(dir, path), content);
  assert.equal(await m0004.applies(await view(dir)), false);
});

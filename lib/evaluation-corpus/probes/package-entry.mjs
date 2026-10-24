// Behavioral package consumer, not a source-text oracle. Apache-2.0 provenance in rename-support.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { applyRename } from '../lib/rename.mjs';
import { fixture, put, get, command, commit, cleanup } from './rename-support.mjs';
const root = await fixture();
try {
  await put(root, 'package.json', JSON.stringify({ name: '@acme/consumer', version: '1.0.0', type: 'module', main: './src/keel-entry.mjs', exports: { '.': './src/keel-entry.mjs' }, bin: { 'acme-old': './bin/keel-command.cjs', 'acme-new': './bin/keel-command.cjs' }, files: ['src', 'bin'] }));
  await put(root, 'src/keel-entry.mjs', 'export default 47;\n');
  await put(root, 'bin/keel-command.cjs', '#!/usr/bin/env node\nconsole.log(47);\n');
  commit(root); await applyRename(root);
  const manifest = JSON.parse(await get(root, 'package.json'));
  const packed = JSON.parse(command(root, 'npm', ['pack', '--offline', '--ignore-scripts', '--json']));
  assert.ok(packed[0].files.some(f => f.path === manifest.main.replace(/^\.\//, '')));
  const consumer = join(root, 'consumer'); await mkdir(consumer);
  await put(consumer, 'package.json', JSON.stringify({ name: 'acme-installed-consumer', version: '1.0.0', private: true }));
  command(consumer, 'npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(root, packed[0].filename)]);
  assert.equal(command(consumer, process.execPath, ['--input-type=module', '-e', 'import value from "@acme/consumer";console.log(value)']).trim(), '47');
  for (const key of ['acme-old', 'acme-new']) assert.equal(command(consumer, process.execPath, [join(consumer, 'node_modules/.bin', key)]).trim(), '47');
  console.log('Acme package entry accepted');
} finally { await cleanup(root); }

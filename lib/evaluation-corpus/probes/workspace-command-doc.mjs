// Structural command-table acceptance; registry evidence is derived from the pinned CLI.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const before = await read('./workspace-original.txt'), after = await read('../README.md');
const cliSource = await read('../lib/cli.mjs');
const verbs = [...cliSource.matchAll(/^  \['([^']+)', \{/gm)].map(m => m[1]);
assert.ok(verbs.includes('workspace'), 'pinned CLI must register workspace');
const additions = after.split('\n').filter(line => !before.split('\n').includes(line));
assert.equal(additions.length, 1, 'only one command-table row may be added');
assert.match(additions[0], /^\| `keel workspace inspect\\\|init` \| [^|]+ \|$/);
assert.equal(after.replace(additions[0] + '\n', ''), before, 'unrelated documentation must remain exact');
assert.ok(after.indexOf(additions[0]) > after.indexOf('| Verb | What it does |'));
console.log('Acme workspace documentation accepted');

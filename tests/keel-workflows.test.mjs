// keel's workflow syntax check (keel practice `ci`; managed: keel render
// rewrites it). Every `run:` block in this project's .github/workflows parses
// as bash, and every inline `node -e '…'` parses as JS, before GitHub runs
// it (keel's lesson 30: what you test is not what runs). The check itself is
// scripts/keel/workflows.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflowProblems, shellProblems } from '../scripts/keel/workflows.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('every run: block in .github/workflows parses as bash, and every inline node -e \'…\' as JS', async () => {
  const r = await workflowProblems(ROOT);
  assert.ok(r.files.length, `no workflow under ${join(ROOT, '.github/workflows')}: the ci practice ships check.yml`);
  assert.ok(r.blocks > 0, `read ${r.files.length} workflow(s) and found no run: block: the reader is broken`);
  assert.deepEqual(r.problems, []);
});

test('the check can fail: broken bash and broken inline JS are named, with the file, step and line', async () => {
  const text = [
    'jobs:',
    '  check:',
    '    steps:',
    '      - name: Branch',
    '        run: |',
    '          if [ -f package.json ]',
    '            echo yes',
    '          fi',
    '      - name: Read the config',
    '        run: node -e \'const c = ;\'',
    '      - name: Fine',
    '        run: node -e \'process.exit(0)\'',
    '',
  ].join('\n');
  const problems = await shellProblems('acme.yml', text);
  assert.equal(problems.length, 2, JSON.stringify(problems));
  assert.match(problems[0], /^acme\.yml: step "Branch" \(line 5\): bash -n: /);
  assert.match(problems[1], /^acme\.yml: step "Read the config" \(line 10\): node -e: .*SyntaxError/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = async () => JSON.parse(await readFile(join(KEEL, 'practices/renovate/files/renovate.json'), 'utf8'));

test('vendored git submodules are watched, and wait for a person in the weekly lane', async () => {
  const c = await config();
  assert.equal(c['git-submodules']?.enabled, true, 'Renovate leaves submodules alone unless enabled');
  // Rules apply in order; the last match wins, so the submodule rule must beat the daily automerge lane.
  const rules = c.packageRules;
  const sub = rules.findIndex(r => r.matchManagers?.includes('git-submodules'));
  const daily = rules.findIndex(r => r.automerge === true && r.matchUpdateTypes?.includes('digest'));
  assert.ok(sub > daily, 'the submodule rule comes after the daily lane');
  assert.equal(rules[sub].automerge, false);
  assert.equal(rules[sub].groupSlug, 'weekly');
  const later = rules.slice(sub + 1).filter(r => r.automerge === true);
  assert.deepEqual(later, [], 'nothing after it merges by itself');
});

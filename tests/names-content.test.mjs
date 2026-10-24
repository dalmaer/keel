import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NAMES, selectArtifacts, historicalFence, normalizeFences } from '../lib/names.mjs';
import { markdown } from '../practices/reconciliation/files/scripts/plates/reconcile.mjs';
const fence = name => '```' + name + '\n{}\n```\n';
for (const row of NAMES.filter(row => row.phase === 126 && row.surface === 'fence')) {
  test(`historical fence ${row.id} reads both aliases permanently and refuses double declarations`, () => {
    for (const name of [row.plates, row.keel]) {
      assert.equal(markdown(fence(name)).fences[0].type, row.keel);
      assert.equal(historicalFence(name, [{ ...row, state: 'retired' }]).id, row.id);
    }
    assert.throws(() => markdown(fence(row.plates) + fence(row.keel)), /Both .* refused/);
    assert.throws(() => markdown(fence(row.keel) + fence(row.plates)), /Both .* refused/);
    assert.throws(() => markdown('# Earlier\n' + fence(row.keel) + '# Later\n' + fence(row.plates)), /Both .* refused/);
    assert.throws(() => markdown('# Earlier\n' + fence(row.plates) + '# Later\n' + fence(row.keel)), /Both .* refused/);
    for (const name of [row.plates, row.keel]) assert.equal(markdown('# Earlier\n' + fence(name) + '# Later\n' + fence(name)).fences.length, 2);
  });
}
for (const row of NAMES.filter(row => row.phase === 126 && row.surface === 'artifact' && row.state === 'dual')) {
  test(`artifact ${row.id} chooses current first and preserves invalid current evidence for validation`, () => {
    const current = {name: row.plates, expired: true}, legacy = {name: row.keel, expired: false};
    assert.deepEqual(selectArtifacts([legacy], row.id).matches, [legacy]);
    assert.deepEqual(selectArtifacts([current], row.id).matches, [current]);
    assert.deepEqual(selectArtifacts([legacy, current], row.id).matches, [current]);
    assert.deepEqual(selectArtifacts([current, current, legacy], row.id).matches, [current, current]);
  });
}
test('both single-name mutations are detected for every canonical artifact and historical fence fallback', async () => {
  const source = await readFile(new URL('../practices/night/files/scripts/plates/names.mjs', import.meta.url), 'utf8');
  for (const removed of ['plates', 'keel']) {
    const before = '[row.plates, row.keel]';
    assert.ok(source.includes(before));
    const mutant = source.replaceAll(before, removed === 'plates' ? '[row.keel]' : '[row.plates]');
    const module = await import('data:text/javascript;base64,' + Buffer.from(mutant).toString('base64'));
    for (const row of NAMES.filter(row => row.phase === 126 && row.state === 'dual' && ['artifact', 'fence'].includes(row.surface))) {
      if (row.surface === 'artifact') {
        assert.equal(selectArtifacts([{name: row[removed]}], row.id).matches.length, 1);
        assert.equal(module.selectArtifacts([{name: row[removed]}], row.id).matches.length, 0, row.id);
      } else {
        assert.equal(normalizeFences([{type: row[removed]}])[0].sourceType, row[removed]);
        assert.equal(module.normalizeFences([{type: row[removed]}])[0].sourceType, undefined, row.id);
      }
    }
  }
});

test('distinct fence families may use independent historical spellings in one body', () => {
  assert.deepEqual(markdown(fence('plates-decision') + '# Proof\n' + fence('keel-proof')).fences.map(f => f.type), ['keel-decision', 'keel-proof']);
});

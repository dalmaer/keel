import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problems } from '../scripts/roadmap.mjs';

test('every phase names a known milestone', async () => {
  assert.deepEqual(await problems(), []);
});

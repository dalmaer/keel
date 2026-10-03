import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problems } from './roadmap.ts';

test('every phase has a status', () => assert.deepEqual(problems(), []));

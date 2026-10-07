// keel's practice list, read from practices/*/practice.json, for tests that
// would otherwise pin it by hand. Phase 42 added a practice and a hard-coded
// list in a test was missed: a test that lists every practice only to say
// which are optional derives it here, and a test that pins a state per
// practice on purpose checks its keys with pinsEvery, so a new practice fails
// with a message naming the test to update.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const PRACTICES = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'practices');

/** Every practice keel carries, sorted, with its `optional` flag. */
export function practiceSpecs() {
  return readdirSync(PRACTICES, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(PRACTICES, d.name, 'practice.json')))
    .map(d => JSON.parse(readFileSync(join(PRACTICES, d.name, 'practice.json'), 'utf8')))
    .map(p => ({ name: p.name, optional: p.optional === true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The names of keel's optional practices, sorted. */
export const optionalPractices = () => practiceSpecs().filter(p => p.optional).map(p => p.name);

/** Assert `expected` (an object keyed by practice) names exactly keel's practices; `where` names the test to update. */
export function pinsEvery(expected, where) {
  const all = practiceSpecs().map(p => p.name);
  const keys = Object.keys(expected);
  const missing = all.filter(n => !keys.includes(n)), extra = keys.filter(n => !all.includes(n));
  assert.ok(!missing.length && !extra.length,
    `${where} pins a state per practice; practices/ ${missing.length ? `adds ${missing.join(', ')}` : ''}${missing.length && extra.length ? ' and ' : ''}${extra.length ? `no longer has ${extra.join(', ')}` : ''}: update the expected states there`);
  return expected;
}

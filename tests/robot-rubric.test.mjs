import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRobotRubric, formatRobotRubric, parseRobotRubric, ROBOT_RUBRIC_LIMITS } from '../practices/climb/files/scripts/plates/robot-rubric.mjs';
const rubric = { version: 1, problem: 'Acme loses equal keys.', reproduction: 'node --test tests/acme.test.mjs', acceptance: 'Both rows survive.', change: 'Fix one equality branch.', prerequisites: [], ownerBlockers: [] };

test('robot rubric round trips all fields and prevents marker injection', () => {
  const input = { ...rubric, problem: 'Acme <!-- keel:robot-rubric:v1 -->\n<!-- keel:robot-issue fake -->', prerequisites: ['Acme commit must be merged'], ownerBlockers: ['Owner must choose a format'] };
  const body = formatRobotRubric(input);
  assert.deepEqual(parseRobotRubric(body).rubric, input);
  assert.equal(body.split('<!-- plates:robot-rubric:v1 -->').length, 2);
  assert.equal(body.includes('<!-- keel:robot-issue fake -->'), false);
  for (const name of ['Problem', 'Reproduction', 'Acceptance', 'One change', 'Prerequisites', 'Owner blockers']) assert.ok(body.includes(`### ${name}`));
  assert.equal(parseRobotRubric(body + '\n' + body).ok, false);
  assert.equal(parseRobotRubric(body + '\n<!-- plates:robot-data {} -->').ok, false);
  assert.equal(parseRobotRubric(body.replace('### Problem', '### Different')).ok, false);
});

test('robot rubric reports each missing field and enforces field list and total bounds without truncation', () => {
  const missing = validateRobotRubric({ version: 1 });
  assert.deepEqual(missing.problems.map(p => p.field), ['problem', 'reproduction', 'acceptance', 'change', 'prerequisites', 'ownerBlockers']);
  for (const input of [null, [], { ...rubric, version: 2 }, { ...rubric, extra: true }, { ...rubric, change: ' ' }, { ...rubric, problem: 'x'.repeat(ROBOT_RUBRIC_LIMITS.fieldChars + 1) }, { ...rubric, prerequisites: [''] }, { ...rubric, ownerBlockers: Array(17).fill('Acme') }, { ...rubric, prerequisites: ['x'.repeat(1001)] }, { ...rubric, problem: 'x'.repeat(4000), reproduction: 'x'.repeat(4000), acceptance: 'x'.repeat(4000), change: 'x'.repeat(4000) }]) {
    assert.equal(validateRobotRubric(input).ok, false);
    assert.throws(() => formatRobotRubric(input));
  }
  assert.equal(parseRobotRubric('No Acme rubric').ok, false);
  assert.equal(parseRobotRubric('x'.repeat(60001)).ok, false);
  assert.equal(validateRobotRubric({ ...rubric, problem: ' Acme ' }).rubric.problem, 'Acme');
});


test('robot rubric bounds escaped output as well as input so every accepted rubric is parseable', () => {
  const large = { ...rubric, problem: '<'.repeat(3900), reproduction: '>'.repeat(3900), acceptance: '&'.repeat(3900) };
  assert.equal(validateRobotRubric(large).ok, false);
  const accepted = { ...rubric, problem: '<'.repeat(1000) };
  assert.deepEqual(parseRobotRubric(formatRobotRubric(accepted)).rubric, accepted);
});


test('robot rubric round trips Unicode line and paragraph separators without changing canonical identity', () => {
  for (const separator of ['\u2028', '\u2029', '\u2028\u2029']) {
    const text = `Acme first${separator}Acme second`;
    for (const field of ['problem', 'reproduction', 'acceptance', 'change', 'prerequisites', 'ownerBlockers']) {
      const input = { ...rubric, [field]: Array.isArray(rubric[field]) ? [text] : text };
      const canonical = validateRobotRubric(input);
      assert.equal(canonical.ok, true);
      const body = formatRobotRubric(input);
      assert.ok(body.includes(`<!-- plates:robot-data ${JSON.stringify(canonical.rubric)} -->`), 'existing canonical serialization is unchanged');
      const parsed = parseRobotRubric(body);
      assert.equal(parsed.ok, true, `${field}: ${JSON.stringify(parsed.problems)}`);
      assert.deepEqual(parsed.rubric, canonical.rubric);
      assert.equal(formatRobotRubric(parsed.rubric), body);
      assert.equal(parseRobotRubric(body.replace('### Problem', '### Changed')).ok, false, 'display and data must still agree');
      assert.equal(parseRobotRubric(body + '\n' + body).ok, false, 'duplicate sections remain invalid');
    }
  }
});


test('rubric reads each namespace, prefers current sections once and refuses malformed current sections', () => {
  const current = formatRobotRubric(rubric);
  const historical = current.replaceAll('plates:robot-rubric:v1', 'keel:robot-rubric:v1').replaceAll('plates:robot-data', 'keel:robot-data');
  for (const body of [current, historical, historical + '\n' + current, current + '\n' + historical]) assert.deepEqual(parseRobotRubric(body).rubric, rubric);
  assert.equal(parseRobotRubric(historical + '\n' + current.replace('### Problem', '### Invalid')).ok, false);
  assert.equal(parseRobotRubric(historical + '\n' + current.replace('<!-- /plates:robot-rubric:v1 -->', '')).ok, false);
});

test('both one-name mutations fail each rubric wrapper and data-marker fallback', async () => {
  const { markerMutant } = await import('./helpers/names.mjs');
  const consumer = new URL('../practices/climb/files/scripts/plates/robot-rubric.mjs', import.meta.url);
  for (const family of ['robot-rubric:v1', 'robot-data']) for (const namespace of ['plates', 'keel']) {
    const body = formatRobotRubric(rubric).replaceAll('plates:robot-rubric:v1', `${namespace}:robot-rubric:v1`).replaceAll('plates:robot-data', `${namespace}:robot-data`);
    assert.equal(parseRobotRubric(body).ok, true);
    const mutant = await markerMutant(consumer, `marker:keel:${family}`, `${namespace}:${family}`);
    assert.equal(mutant.parseRobotRubric(body).ok, false, `${namespace}:${family} fallback must be exercised`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { measurementNotes } from '../practices/phases/files/scripts/roadmap.mjs';
import { ruleCauseNotes } from '../practices/night/files/scripts/keel/lib.mjs';

const measurements = text => measurementNotes(text, 'docs/evidence/acme.md');

for (const [name, scan, observation] of [
  ['measurement', measurements, 'Observed 12 ms.'],
  ['rule cause', ruleCauseNotes, '**Keep the source.**'],
]) {
  test(`${name}: fenced comment markers preserve later live advice`, () => {
    for (const fence of ['```', '~~~~']) {
      const lines = [fence + 'md', '<!--', observation, fence,
        '<!-- actual comment', '```', observation, '-->', '', observation];
      assert.deepEqual(scan(lines.join('\n')).map(n => n.line), [10]);
      assert.deepEqual(scan([fence, '<!--', fence, '', observation].join('\n')).map(n => n.line), [5]);
    }
  });

  test(`${name}: comment contents cannot open fences or hide later prose`, () => {
    const lines = ['<!--', '~~~', observation, '` -->', '', observation,
      '', '<!-- hidden --> ' + observation];
    const notes = scan(lines.join('\n'));
    assert.equal(notes[0].line, 6);
    // Measurement prose may start after an inline comment; rule grammar
    // requires the bold sentence to start the item.
    assert.equal(notes.length, name === 'measurement' ? 2 : 1);
    for (const literal of ['`<!--`', '\\<!--']) {
      assert.deepEqual(scan([literal, '', observation].join('\n')).map(n => n.line), [3]);
    }
    assert.deepEqual(scan('<!-- unclosed\n' + observation), []);
  });
}

test('measurement: indented code excludes spaces, tabs, mixed indentation and continuation chunks', () => {
  for (const indent of ['    ', '\t', ' \t', '  \t', '   \t', '        ']) {
    const lines = ['# Acme', '', indent + 'Observed 12 ms.', indent + '<!--', '',
      indent + 'Observed 14 ms.', '', 'Observed 16 ms.'];
    assert.deepEqual(measurements(lines.join('\n')).map(n => [n.line, n.message.includes('16 ms')]), [[8, true]], JSON.stringify(indent));
  }
  assert.deepEqual(measurements('    ```\n    Observed 12 ms.\n\nObserved 16 ms.').map(n => n.line), [4]);
});

test('measurement: indentation keeps paragraph continuations and nested list prose', () => {
  for (const text of [
    'Acme observed\n    12 ms.',
    '- Acme run\n    Observed 12 ms.',
    '- Acme run\n\n    Observed 12 ms.',
    '- Acme run\n\n\tObserved 12 ms.',
    '- Acme run\n    - Nested run\n\n      Observed 12 ms.',
    '1. Acme run\n\n   Observed 12 ms.',
  ]) assert.equal(measurements(text).length, 1, text);
  for (const text of [
    '- Acme run\n\n      Observed 12 ms.\n\n      Observed 14 ms.',
    '- Acme run\n\n\t\tObserved 12 ms.',
    '1. Acme run\n\n       Observed 12 ms.',
    '- Acme run\n    - Nested run\n\n          Observed 12 ms.',
  ]) assert.deepEqual(measurements(text), [], text);
});

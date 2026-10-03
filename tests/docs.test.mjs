// What keel tells people can't fall behind what keel does (phase 18, lesson 16).
// The README's verb tables are read against the live verb registry, and its
// practices table against practices/, both ways — the same shape as the
// agent guide's surface test in tests/cli.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { verbs, announced, CLI_ROOT } from '../lib/cli.mjs';

const README = join(CLI_ROOT, 'README.md');
const registered = () => [...verbs.keys()].filter(v => v !== 'help');

/** The practices keel ships: every practices/<dir> with a practice.json, by its name. */
async function practices() {
  const out = [];
  for (const d of await readdir(join(CLI_ROOT, 'practices'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const raw = await readFile(join(CLI_ROOT, 'practices', d.name, 'practice.json'), 'utf8').catch(() => null);
    if (raw) out.push(JSON.parse(raw).name);
  }
  return out.sort();
}

/** Markdown tables: each a { header, rows } with rows as arrays of raw cells. */
function tables(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].startsWith('|') || !/^\|(\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1])) continue;
    const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
    const t = { header: cells(lines[i]), rows: [] };
    for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) t.rows.push(cells(lines[i]));
    out.push(t);
  }
  return out;
}

/** The verbs README's "Verb" tables name, expanded the way the agent guide's are. */
export function readmeVerbs(text) {
  const firsts = tables(text).filter(t => t.header[0] === 'Verb').flatMap(t => t.rows.map(r => r[0]));
  const spans = firsts.flatMap(c => [...c.matchAll(/`keel ([^`]+)`/g)].map(m => m[1].replace(/\\\|/g, '|')));
  return announced(spans.map(s => `- \`keel ${s}\``).join('\n'));
}

/** The practices README's "Practice" table names (the first backticked word of each row). */
export function readmePractices(text) {
  return tables(text).filter(t => t.header[0] === 'Practice')
    .flatMap(t => t.rows.map(r => /`([^`]+)`/.exec(r[0])?.[1]).filter(Boolean)).sort();
}

const covers = (line, name) => line === name || line.startsWith(`${name} `);

/** Every disagreement between the README and what keel registers and ships. */
export function docGaps(text, names, shipped) {
  const said = readmeVerbs(text), told = readmePractices(text);
  const gaps = [];
  for (const n of names) if (!said.some(l => covers(l, n))) gaps.push(`verb missing from README: keel ${n}`);
  for (const l of said) if (!names.some(n => covers(l, n))) gaps.push(`README names an unregistered verb: keel ${l}`);
  for (const p of shipped) if (!told.includes(p)) gaps.push(`practice missing from README: ${p}`);
  for (const p of told) if (!shipped.includes(p)) gaps.push(`README names a practice that does not exist: ${p}`);
  for (const line of text.split('\n')) {
    const verbsHere = [...line.matchAll(/`keel ([^`]+)`/g)].flatMap(m => announced(`- \`keel ${m[1].replace(/\\\|/g, '|')}\``));
    const hit = verbsHere.find(l => names.some(n => covers(l, n)));
    if (hit && /\bplanned\b|\bcoming\b|not yet built/i.test(line)) gaps.push(`README calls a registered verb unbuilt: keel ${hit}: ${line.trim()}`);
  }
  return gaps;
}

test('the README names every registered verb and practice, and nothing else', async () => {
  assert.deepEqual(docGaps(await readFile(README, 'utf8'), registered(), await practices()), []);
});

test('the README tables are read: verbs expanded, practices named', async () => {
  const text = await readFile(README, 'utf8');
  const said = readmeVerbs(text);
  for (const v of ['goal list', 'goal retire', 'phase new', 'fleet update', 'next']) assert.ok(said.includes(v), `${v} not read from README`);
  assert.ok(readmePractices(text).includes('loop'));
  assert.ok(readmePractices(text).length >= 9);
});

test('each kind of drift fails the check (mutations of the README text, in memory)', async () => {
  const text = await readFile(README, 'utf8');
  const names = registered(), shipped = await practices();
  const gaps = t => docGaps(t, names, shipped);
  const base = gaps(text);
  const added = t => gaps(t).filter(g => !base.includes(g));

  // A verb row removed.
  const releaseRow = text.split('\n').find(l => l.startsWith('| `keel release`'));
  assert.ok(releaseRow);
  assert.deepEqual(added(text.replace(`${releaseRow}\n`, '')), ['verb missing from README: keel release']);
  // One word dropped from a word list.
  assert.deepEqual(added(text.replace('`keel goal list\\|show\\|add\\|retire`', '`keel goal list\\|show\\|add`')), ['verb missing from README: keel goal retire']);
  // A fake verb row added.
  assert.deepEqual(added(text.replace(releaseRow, `${releaseRow}\n| \`keel frobnicate\` | Acme does a thing |`)), ['README names an unregistered verb: keel frobnicate']);
  // A registered verb written as planned, coming, or not yet built.
  for (const word of ['planned', 'coming', 'not yet built']) {
    const g = added(text.replace(releaseRow, `${releaseRow.replace(/ \|$/, '')} (${word}) |`));
    assert.equal(g.length, 1, word);
    assert.match(g[0], /^README calls a registered verb unbuilt: keel release/);
  }
  // A practice row removed.
  const nightRow = text.split('\n').find(l => l.startsWith('| `night`'));
  assert.ok(nightRow);
  assert.deepEqual(added(text.replace(`${nightRow}\n`, '')), ['practice missing from README: night']);
  // A fake practice row added.
  assert.deepEqual(added(text.replace(nightRow, `${nightRow}\n| \`acme\` | Acme things | Acme failures |`)), ['README names a practice that does not exist: acme']);
  // A newly registered verb with no row.
  assert.deepEqual(docGaps(text, [...names, 'frobnicate'], shipped).filter(g => !base.includes(g)), ['verb missing from README: keel frobnicate']);
});

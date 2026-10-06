// Every PR keel opens can be judged in a minute (phase 39): scripts/keel/pr-body.mjs
// writes Summary (a picture), Evidence (before and after) and Merge danger (a
// door and its blast radius), in that order, from structured input. Each rule
// is mutation-checked: a copy of the module with the rule edited out must
// fail bodyProblems, the reader's check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, realpath, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import * as pr from '../practices/night/files/scripts/keel/pr-body.mjs';
import { SURFACES as ROADMAP_SURFACES } from '../practices/phases/files/scripts/roadmap.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(KEEL, 'practices', 'night', 'files', 'scripts', 'keel');
const SECTIONS = ['## Summary', '## Evidence', '## Merge danger'];

async function scratch(t, prefix = 'keel-pr-body-') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** The module with one rule edited out, imported fresh. */
async function mutant(t, from, to) {
  const text = await readFile(join(DIR, 'pr-body.mjs'), 'utf8');
  assert.ok(text.includes(from), `the mutation's target is still in the source: ${from}`);
  const dir = await scratch(t, 'keel-pr-body-mutant-');
  await copyFile(join(DIR, 'lib.mjs'), join(dir, 'lib.mjs'));
  await writeFile(join(dir, 'pr-body.mjs'), text.replace(from, to));
  return import(pathToFileURL(join(dir, 'pr-body.mjs')).href);
}

/** What a reader would miss: [string]. The three sections, in order, each with something in it. */
function bodyProblems(body) {
  const out = [];
  const at = SECTIONS.map(h => body.indexOf(`\n${h}\n`) >= 0 ? body.indexOf(`\n${h}\n`) : body.startsWith(`${h}\n`) ? 0 : -1);
  SECTIONS.forEach((h, i) => { if (at[i] < 0) out.push(`no ${h}`); });
  if (at.every(a => a >= 0) && !(at[0] < at[1] && at[1] < at[2])) out.push('the sections are out of order');
  const section = h => { const m = new RegExp(`(?:^|\\n)${h}\\n\\n([\\s\\S]*?)(?=\\n## |$)`).exec(body); return m ? m[1].trim() : ''; };
  if (at[0] >= 0 && !/```text\n|^\| /m.test(section('## Summary')) && !/No files changed\./.test(section('## Summary'))) out.push('the Summary is not a picture');
  if (at[1] >= 0 && !section('## Evidence')) out.push('the Evidence section is empty');
  if (at[2] >= 0 && !/^(Two|One)-way door: \S/m.test(section('## Merge danger'))) out.push('no door');
  if (at[2] >= 0 && !/^Blast radius: \S/m.test(section('## Merge danger'))) out.push('no blast radius');
  const impact = body.indexOf('```keel-impact');
  if (impact >= 0 && body.slice(impact).includes('\n## ')) out.push('the keel-impact block is not last');
  return out;
}

const INPUT = () => ({
  summary: { lead: 'Acme from keel practice 0.6.0 to 0.7.0.', files: ['scripts/keel/pr-body.mjs', '.github/workflows/keel-night.yml', 'AGENTS.md', { path: 'docs/goals.json', note: 'migration 0001-milestone-to-goal' }, 'scripts/keel/improve.mjs'] },
  evidence: { gate: '`npm run check` exit 0', rows: [{ what: 'keel practice', before: '0.6.0', after: '0.7.0' }] },
  danger: { door: 'one-way', why: 'migration 0001-milestone-to-goal rewrote docs/goals.json.', surfaces: ['adopted project'] },
  notes: 'Acme gets the current conductor.',
  impact: { declaration: { version: 1, reconciliation: 'none' } },
});

test('three sections in order from structured input; notes after; the keel-impact block last', () => {
  const body = pr.prBody(INPUT());
  assert.deepEqual(bodyProblems(body), [], body);
  assert.match(body, /```text\n├── \.github\/workflows\/\n│   └── keel-night\.yml\n├── docs\/\n│   └── goals\.json {2}\(migration 0001-milestone-to-goal\)\n├── scripts\/keel\/\n│   ├── improve\.mjs\n│   └── pr-body\.mjs\n└── AGENTS\.md\n```/);
  assert.match(body, /^Gate: `npm run check` exit 0$/m);
  assert.match(body, /^\| keel practice \| 0\.6\.0 \| 0\.7\.0 \|$/m);
  assert.match(body, /^One-way door: migration 0001/m);
  assert.match(body, /^Blast radius: adopted project\.$/m);
  assert.ok(body.indexOf('## Notes') > body.indexOf('## Merge danger'));
  assert.ok(body.trimEnd().endsWith('{"version":1,"reconciliation":"none"}\n```'));
  assert.equal(pr.prBody(INPUT()), body, 'deterministic');
  // A table is a picture too.
  const table = pr.prBody({ ...INPUT(), summary: { table: { head: ['Measure', 'Before', 'After'], rows: [['tests', 10, 12]] } } });
  assert.deepEqual(bodyProblems(table), []);
  assert.match(table, /^\| Measure \| Before \| After \|$/m);
});

test('no evidence is written as "Evidence: none recorded.", never dropped; data only says so', () => {
  for (const evidence of [undefined, {}, [], { rows: [] }]) {
    const body = pr.prBody({ ...INPUT(), evidence });
    assert.deepEqual(bodyProblems(body), [], body);
    assert.match(body, /## Evidence\n\nEvidence: none recorded\.\n/);
  }
  const data = pr.prBody({ summary: { files: [] }, danger: { door: 'two-way', why: 'data only.', surfaces: [], within: 'data files' } });
  assert.match(data, /^Two-way door: data only\.$/m);
  assert.match(data, /^Blast radius: this repo's data files only\.$/m);
});

test('bad input is refused, naming what is wrong: an unknown door or surface, prose for a summary', () => {
  const bad = [
    [{ danger: { door: 'revolving', why: 'x' } }, /danger\.door is "revolving"/],
    [{ danger: { door: 'two-way', why: 'x', surfaces: ['the moon'] } }, /"the moon" is not a surface/],
    [{ danger: undefined }, /danger is required/],
    [{ danger: { door: 'two-way', why: ' ' } }, /danger\.why must be non-empty/],
    [{ summary: 'I changed some things.' }, /summary is required/],
    [{ summary: { text: 'I changed some things.' } }, /never prose/],
    [{ evidence: { rows: [{ before: 1 }] } }, /evidence\.rows\[0\]\.what/],
  ];
  for (const [over, message] of bad) assert.throws(() => pr.prBody({ ...INPUT(), ...over }), e => e instanceof pr.PrBodyError && e.exitCode === 2 && message.test(e.message), String(message));
  assert.match(pr.prBody({ ...INPUT(), danger: { door: 'two-way', why: 'x', surfaces: ['github api', 'FLEET OVER TIME'] } }), /^Blast radius: GitHub API, fleet over time\.$/m, 'terms are matched case-blind and written as named');
});

test("the surfaces are phase 32's, the same list the phases practice's roadmap checks", () => {
  assert.deepEqual([...pr.SURFACES], [...ROADMAP_SURFACES]);
});

test('the CLI prints the body from --input, with --files as the summary; bad input is exit 2', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'in.json'), JSON.stringify({ ...INPUT(), summary: { lead: 'The night of 2026-10-05.', files: [] } }));
  await writeFile(join(dir, 'files.txt'), 'docs/health/2026-10-05.md\n.keel/bounds.json\n\n');
  const r = run(process.execPath, [join(DIR, 'pr-body.mjs'), '--input', join(dir, 'in.json'), '--files', join(dir, 'files.txt')]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(bodyProblems(r.stdout), []);
  assert.match(r.stdout, /The night of 2026-10-05\.\n\n```text\n├── \.keel\/\n│   └── bounds\.json\n└── docs\/health\/\n    └── 2026-10-05\.md\n```/);
  await writeFile(join(dir, 'bad.json'), JSON.stringify({ ...INPUT(), danger: { door: 'trap', why: 'x' } }));
  const b = run(process.execPath, [join(DIR, 'pr-body.mjs'), '--input', join(dir, 'bad.json')]);
  assert.equal(b.status, 2);
  assert.match(b.stderr, /danger\.door is "trap"/);
  assert.equal(run(process.execPath, [join(DIR, 'pr-body.mjs')]).status, 2, '--input is required');
});

test('mutations: dropping Merge danger, or the none-recorded line, or reordering, is caught', async t => {
  const noDanger = await mutant(t, "'## Merge danger', '', ...danger(d),", '');
  assert.ok(bodyProblems(noDanger.prBody(INPUT())).includes('no ## Merge danger'));
  const dropped = await mutant(t, 'if (!gate && !rows.length) return [NO_EVIDENCE];', 'if (!gate && !rows.length) return [];');
  const empty = dropped.prBody({ ...INPUT(), evidence: undefined });
  assert.ok(bodyProblems(empty).includes('the Evidence section is empty'), empty);
  const reordered = await mutant(t, "'## Summary', '', ...summary(s), '',\n    '## Evidence', '', ...evidence(e), '',", "'## Evidence', '', ...evidence(e), '',\n    '## Summary', '', ...summary(s), '',");
  assert.ok(bodyProblems(reordered.prBody(INPUT())).includes('the sections are out of order'));
  const noRadius = await mutant(t, "'', `Blast radius: ${radius}.`]", ']');
  assert.ok(bodyProblems(noRadius.prBody(INPUT())).includes('no blast radius'));
});

test("improve's --pr-input names the file the night's body input goes to", async () => {
  const { parseArgs } = await import('../practices/night/files/scripts/keel/improve.mjs');
  assert.deepEqual(parseArgs(['--report', '--pr-input', 'acme/pr.json', '--transcripts', 'acme/t']), { report: true, prInput: resolve('acme/pr.json'), transcripts: resolve('acme/t') });
  assert.throws(() => parseArgs(['--pr-input']), /--pr-input needs a value/);
});

// escapes (phase 34): defects found after a phase was built, read from what is
// already written since the newest release tag: fix: commits, lessons rows
// with the project's own provenance, and Trajectory `— Escape:` entries. Each
// points at the phase its text names; one naming none, or several, is
// counted, never guessed. Unreadable history is n/a, never a zero (lesson 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './helpers/run.mjs';
import {
  MEASURES, measure, proposalText, propose, tighten, isFixSubject, phaseOf, phasesNamed, selfProvenance, escapeEntries,
} from '../practices/night/files/scripts/keel/improve.mjs';

const ESCAPES = MEASURES.filter(m => m.id === 'escapes');
const CONFIG = { name: 'Acme', repo: 'acme/storefront', practices: ['base', 'phases', 'lessons'] };

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-escapes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** git in dir, on a given day (author and committer), failing the test on a non-zero exit. */
function git(dir, args, day = '2026-01-01') {
  const when = `${day}T12:00:00Z`;
  const r = run('git', args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const commit = (dir, subject, day, body = '') => git(dir, ['commit', '--allow-empty', '-q', '-m', subject, ...(body ? ['-m', body] : [])], day);
const commitAll = (dir, subject, day) => { git(dir, ['add', '-A'], day); commit(dir, subject, day); };

const LESSONS = row => `# Lessons\n\n| # | The shape of it | What it cost | Guard |\n| --- | --- | --- | --- |\n${row}`;
const phase = (status, since, trajectory = '') => `---\nstatus: ${status}\nsince: ${since}\n---\n\n# Acme anvils\n\nThe anvil counter.\n${trajectory}`;

/**
 * Acme: before v0.1.0 one fix commit and lesson 1 (the release before: 2); since it, two
 * fix commits (phases 2 and 3), one own-provenance lesson (phase 2), one
 * Trajectory escape (phase 3's file), and the near misses that must not count.
 */
async function acme(t, { tag = true } = {}) {
  const dir = await scratch(t);
  git(dir, ['init', '-q', '-b', 'main']);
  await mkdir(join(dir, 'docs', 'phases'), { recursive: true });
  await writeFile(join(dir, 'docs', 'lessons.md'), LESSONS('| 1 | **Anvils fall.** *(Acme, 1 Jan)* | A dent. | `tests/anvil.test.mjs` |\n'));
  await writeFile(join(dir, 'docs', 'phases', '03-anvils.md'), phase('planned', '2026-01-01'));
  commitAll(dir, 'acme: the first anvil', '2026-01-01');
  commit(dir, 'fix: the first anvil was upside down', '2026-01-02');
  if (tag) git(dir, ['tag', 'v0.1.0']);
  commit(dir, 'fix: phase 2 counted each anvil twice', '2026-01-03');
  commit(dir, 'fix(anvils): the drop test', '2026-01-04', 'Escaped from docs/phases/3-anvils (phases/3-anvils.md); lesson 99 is someone else\'s.');
  // Near misses: "fix" mid-subject, a prefix, a word that starts with fix.
  commit(dir, 'anvils: a fix in the counter', '2026-01-04');
  commit(dir, 'prefix: the shortest unique one', '2026-01-04');
  commit(dir, 'fixtures: Acme anvils', '2026-01-04');
  commit(dir, 'loose-ends: fix: the prefix test', '2026-01-04');
  await appendFile(join(dir, 'docs', 'lessons.md'), [
    '| 2 | **A counter counts twice.** *(Acme, phase 2)* | Double anvils. | `tests/count.test.mjs` (phase 9) |',
    '| 3 | **A rocket misfires.** *(wile/rockets 4)* | Smoke. | habit |',
    ''].join('\n'));
  await writeFile(join(dir, 'docs', 'phases', '03-anvils.md'), phase('built', '2026-01-05', [
    '', '## Trajectory', '',
    '- **2026-01-05** — Escape: the drop test passed on a fixture, not a real anvil.',
    '- **2026-01-05** — The counter moved to its own file. Not an escape.', ''].join('\n')));
  commitAll(dir, 'phase 3: built', '2026-01-05');
  return dir;
}

const read = async (dir, config = CONFIG) => (await measure({ root: dir, config, measures: ESCAPES }))[0];

test('escapes: two fix commits, one own lesson and one Escape entry since the tag are counted, each attributed to the phase it names', async t => {
  const dir = await acme(t);
  const m = await read(dir);
  assert.equal(m.state, 'outside', m.detail);
  // Two fix commits, lesson 2 (lesson 1 predates the tag; 3 is another project's), one Escape entry.
  assert.equal(m.value, 4, m.detail);
  assert.deepEqual(m.facts.escapes.map(e => [e.kind, e.phase]), [['commit', 2], ['commit', 3], ['lesson', 2], ['trajectory', 3]]);
  assert.deepEqual(m.facts.byPhase, { 2: 2, 3: 2 });
  assert.equal(m.facts.unattributed, 0);
  assert.equal(m.facts.since, 'v0.1.0');
  assert.deepEqual(m.facts.previous, { from: null, to: 'v0.1.0', value: 2 });
  assert.equal(m.bound, 2, 'no rise over the release before: its fix commit and lesson 1');
  assert.match(m.detail, /^4 since v0\.1\.0 \(2 fix commits, 1 own lesson, 1 Escape entry\); by phase: 2 ×2, 3 ×2; the release before \(up to v0\.1\.0\) had 2/);
  // Ceremony beside it: phase 3, planned 1 Jan, built 5 Jan.
  assert.deepEqual(m.facts.ceremony.map(({ phase, planned, built, days }) => ({ phase, planned, built, days })), [{ phase: 3, planned: '2026-01-01', built: '2026-01-05', days: 4 }]);
  assert.ok(m.facts.ceremony[0].words > 20);
  assert.match(m.detail, /ceremony, 1 phase built since v0\.1\.0: 3 4d\/\d+w/);
  // The proposal names the phase with the most escapes (a tie goes to the lower number).
  const proposal = propose([m], CONFIG);
  assert.equal(proposal.id, 'escapes');
  assert.match(proposal.text, /^Make phase 2 the next hygiene target: it has the most escapes \(2: /);
  assert.match(proposal.text, /4 escapes since v0\.1\.0 against 2 in the release before/);
});

test('escapes: with no release tag it counts from the first commit, and has no bound to rise over', async t => {
  const dir = await acme(t, { tag: false });
  const m = await read(dir);
  assert.equal(m.state, 'ok', 'no release before: recorded, never outside');
  assert.equal(m.bound, null);
  // The first fix commit and lesson 1 (own, from the first commit) now count too.
  assert.equal(m.value, 6, m.detail);
  assert.equal(m.facts.since, null);
  assert.match(m.detail, /since the first commit \(no release tag\)/);
  assert.match(m.detail, /no release before to compare/);
});

test('escapes: "fix" mid-subject, a prefix, or a word starting with fix is not a fix commit', () => {
  for (const s of ['fix: the counter', 'fix(cli): the counter', 'Fix: capitalised']) assert.equal(isFixSubject(s), true, s);
  for (const s of ['anvils: a fix in the counter', 'prefix: the shortest unique one', 'fixtures: Acme anvils', 'fixes: plural', 'loose-ends: fix: the prefix test', ' fix: leading space', 'fix the counter']) {
    assert.equal(isFixSubject(s), false, s);
  }
});

test('escapes: attribution is the one phase a text names; none or several is unattributed, never the first guessed', () => {
  assert.equal(phaseOf('fix: phase 33 forgot the tag'), 33);
  assert.equal(phaseOf('see docs/phases/33-every-test-run.md'), 33);
  assert.equal(phaseOf('phase 33, and phase 33 again'), 33);
  assert.equal(phaseOf('phase 38 shipped; an escape from phase 35'), null);
  assert.deepEqual(phasesNamed('phase 38 shipped; an escape from phase 35'), [38, 35]);
  assert.equal(phaseOf('the counter double-counts'), null);
  assert.equal(phaseOf('phasers 3'), null);
  // A Trajectory escape naming no other phase is its own file's; naming one, that one's.
  const diff = ['+++ b/docs/phases/35-climb.md', '+- **2026-10-06** — Escape: green while the agent never ran.', '+- **2026-10-06** — Escape: phase 33\'s ledger read nothing.', '+- **2026-10-06** — A course change, not an escape.', '+++ b/docs/other.md', '+- **2026-10-06** — Escape: not a phase file.'].join('\n');
  assert.deepEqual(escapeEntries(diff).map(e => e.phase), [35, 33]);
  // Own provenance: the name or the repo as a word in the italics, never another owner's repo of that name.
  assert.equal(selfProvenance('**x** *(acme, 4 Oct)*', CONFIG), true);
  assert.equal(selfProvenance('**x** *(acme/storefront)*', CONFIG), true);
  assert.equal(selfProvenance('**x** *(wile/acme)*', CONFIG), false);
  assert.equal(selfProvenance('**x** *(acmeville)*', CONFIG), false);
  assert.equal(selfProvenance('**x** Acme, no italics', CONFIG), false);
});

test('escapes: unreadable history is n/a with why, never a zero', async t => {
  const plain = await scratch(t);
  let m = await read(plain);
  assert.equal(m.state, 'n/a');
  assert.equal(m.value, null);
  assert.match(m.detail, /not a git repository/);

  const empty = await scratch(t);
  git(empty, ['init', '-q', '-b', 'main']);
  m = await read(empty);
  assert.equal(m.state, 'n/a');
  assert.match(m.detail, /no commits yet/);

  const dir = await acme(t);
  const shallow = join(await scratch(t), 'shallow');
  git(dir, ['config', 'uploadpack.allowFilter', 'true']);
  git(tmpdir(), ['clone', '-q', '--depth', '1', `file://${dir}`, shallow]);
  m = await read(shallow);
  assert.equal(m.state, 'n/a');
  assert.match(m.detail, /shallow clone/);
});

test('escapes: --report records the release before\'s value as the bound and never ratchets it mid-release', () => {
  const r = { id: 'escapes', state: 'ok', value: 0, bound: 3, better: 'lower' };
  const { bounds, tightened } = tighten([r], { escapes: 7 }, ESCAPES);
  assert.equal(bounds.escapes, 3, 'the release before\'s value, not the stored one, and not tonight\'s 0');
  assert.deepEqual(tightened, []);
  assert.equal(tighten([{ ...r, bound: null }], {}, ESCAPES).bounds.escapes, null, 'no release before: no bound');
  assert.match(proposalText({ id: 'escapes', state: 'outside', value: 2, bound: 0, facts: { since: 'v1.0.0', escapes: [{ kind: 'commit', ref: 'abc1234', phase: null, text: 'fix: x' }] } }), /none names its phase/);
});

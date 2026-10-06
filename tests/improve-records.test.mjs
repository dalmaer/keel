// keel improve on a repo that keeps its phases per project (phase 27): the
// phase measures read docs/projects/<p>/phases.md, and the record measures
// (records_disagree, status_unknown, changelog_gaps, research_unindexed,
// verify_owed, issues_unnamed, issues_done_open, prs_stale) read the right
// count, or say n/a with a reason when their source is absent; never a zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { run } from './helpers/run.mjs';
import { measure, MEASURES } from '../lib/improve.mjs';
import { phaseSections, recordsDisagree, statusUnknown, changelogGaps, issuesNamed, frontMatter } from '../practices/night/files/scripts/keel/lib.mjs';

const DATE = '2026-03-31';
const NEW = ['records_disagree', 'status_unknown', 'changelog_gaps', 'research_unindexed', 'verify_owed', 'issues_unnamed', 'issues_done_open', 'prs_stale'];
const PHASES = ['phases_without_issue', 'phases_stuck', 'roadmap_stale', 'evidence_placeholders'];

async function scratch(t, prefix = 'keel-records-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

const git = (dir, args, env = {}) => {
  const r = run('git', ['-C', dir, ...args], { env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
/** Commit everything staged so far as of `day` (committer and author date). */
const commitOn = (dir, day, message) => {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', message], { GIT_AUTHOR_DATE: `${day}T12:00:00Z`, GIT_COMMITTER_DATE: `${day}T12:00:00Z` });
};

/** A gh stub answering the issue and PR lists. */
async function ghStub(t, { issues = [], prs = [] } = {}) {
  const dir = await scratch(t, 'keel-records-gh-');
  const gh = join(dir, 'gh');
  await writeFile(gh, `#!${process.execPath}
const a = process.argv.slice(2);
if (a.includes('--version')) console.log('gh version 2.0.0 (stub)');
else if (a[0] === 'auth') process.exit(0);
else if (a[0] === 'issue') console.log(${JSON.stringify(JSON.stringify(issues))});
else if (a[0] === 'pr') console.log(${JSON.stringify(JSON.stringify(prs))});
else process.exit(1);
`);
  await chmod(gh, 0o755);
  return gh;
}

const PROJECTS = {
  // built, a phase open, its issue (7) open: records_disagree and issues_done_open
  'docs/projects/anvils/journey.md': '---\nstatus: built\nsince: 2026-01-01\nissue: 7\n---\n# Anvils\n',
  'docs/projects/anvils/phases.md': '# Anvils\n\n## Phase 1 — Order\n\n**Status: CLOSED.** 2026-01-02 — ordered.\n\n## Phase 2 — Return\n\n**Status: NOT STARTED.**\n',
  // partial, every phase closed or retired, one word off the vocabulary: records_disagree, status_unknown
  'docs/projects/rockets/design.md': '---\nstatus: partial\nissue: "#8"\n---\n# Rockets\n',
  'docs/projects/rockets/phases.md': '# Rockets\n\n## Phase 1 — Light\n\n**Status: CLOSED.**\n\n## Phase 2 — Steer\n\n**Status: RETIRED.**\n\n## Phase 3 — Land\n\n**Status: DONE.**\n\n```\n## Phase 9 — in a fence, not a phase\n```\n',
  // phase headings, no Status line at all: status_unknown (one, for the file); no issue: phases_without_issue
  'docs/projects/skates/phases.md': '# Skates\n\n## 1. Roll\n\nRolled.\n\n## 2. Stop\n\nNot yet.\n',
  // healthy: agrees, has an issue, every phase known
  'docs/projects/traps/plan.md': '---\nstatus: partial\nissue: 9\n---\n# Traps\n',
  'docs/projects/traps/phases.md': '# Traps\n\n## Phase 1 — Set\n\n**Status: CLOSED.**\n\n## Phase 2 — Spring\n\n**Status: PART-DONE.** half sprung\n',
  // a project directory without a primary doc is not a project
  'docs/projects/notes/scratch.md': 'nothing\n',
};

/** A projects-shaped Acme repo: phases per project, a changelog, research, verify walks; git history in March 2026. */
async function acme(t, { extra = {}, shape = 'projects' } = {}) {
  const root = join(await scratch(t), 'acme');
  await mkdir(root);
  git(root, ['init', '-q', '-b', 'main']);
  await put(root, {
    '.keel/keel.json': `${JSON.stringify({ name: 'Acme', repo: 'acme/storefront', practices: ['base'], ...(shape === 'projects' ? { phases: { shape: 'projects' }, local: { phases: 'Acme keeps phases per project' } } : {}) }, null, 2)}\n`,
    'docs/projects/README.md': '# Projects\n',
    ...PROJECTS,
  });
  commitOn(root, '2026-02-01', 'the projects'); // phases.md files untouched since 1 Feb: 58 days before DATE
  await put(root, {
    // the 28th: commits, no page. The 29th: a page still a draft. The 30th: written. The 31st is today, not owed.
    'docs/changelog/README.md': '# Changelog\n',
    'docs/changelog/2026-03-29.md': '<!-- draft -->\n# 29 March\n',
    'docs/changelog/2026-03-30.md': '# 30 March\n\nWritten.\n',
    'docs/research/README.md': '# Research\n\n- [2026-01-01-alloys.md](2026-01-01-alloys.md)\n',
    'docs/research/2026-01-01-alloys.md': '# Alloys\n',
    'docs/research/2026-01-02-fuels.md': '# Fuels\n',
    'docs/research/2026-01-03-springs.md': '# Springs\n',
    'docs/verify/README.md': '# Verify\n',
    'docs/verify/2026-03-01-catch.md': '---\nstatus: unverified\nsince: 2026-03-01\n---\n# Catch\n',
    'docs/verify/2026-03-20-chase.md': '# Chase (no front matter: owed)\n',
    'docs/verify/2026-03-21-run.md': '---\nstatus: works\nsince: 2026-03-22\n---\n# Run\n',
    'docs/verify/2026-03-22-fall.md': '---\nstatus: brokn\nsince: 2026-03-25\n---\n# Fall (a typo stays owed)\n',
    'docs/notes.md': 'We follow #40 here, and https://github.com/acme/storefront/issues/41 there.\n',
    'docs/health/2026-03-30.md': 'The night names #43 itself; that does not count.\n',
    ...extra,
  });
  commitOn(root, '2026-03-28', 'the 28th');
  commitOn(root, '2026-03-28', 'the 28th, again');
  commitOn(root, '2026-03-29', 'the 29th');
  commitOn(root, '2026-03-31', 'today');
  return root;
}

const read = async (root, ids, env = process.env) => {
  const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  const results = await measure({ root, config, env, date: DATE, measures: MEASURES.filter(m => ids.includes(m.id)) });
  return Object.fromEntries(results.map(r => [r.id, r]));
};

test('the parsers: phase sections, front matter, the disagreements, the gaps, the issues named', () => {
  const rockets = phaseSections(PROJECTS['docs/projects/rockets/phases.md']);
  assert.deepEqual(rockets.map(p => [p.id, p.word, p.status]), [['1', 'CLOSED', 'built'], ['2', 'RETIRED', 'superseded'], ['3', 'DONE', 'unknown']], 'a fenced heading is not a phase');
  assert.deepEqual(phaseSections('## Phase 4 — x\n\n**Status: NOT STARTED.**\n').map(p => p.status), ['planned']);
  assert.deepEqual(phaseSections('## 1. Roll\n\n**Status: PART-DONE** — half\n').map(p => [p.id, p.status]), [['1', 'partial']]);
  assert.equal(frontMatter('no front matter'), null);
  assert.equal(frontMatter('---\nstatus: "built"\n---\n').get('status'), 'built');
  const p = (name, status, text) => ({ name, status, primary: `docs/projects/${name}/x.md`, phasesPath: `docs/projects/${name}/phases.md`, phases: phaseSections(text) });
  assert.deepEqual(recordsDisagree([
    p('a', 'built', '## Phase 1\n**Status: PART-DONE.**\n'),
    p('b', 'designed', '## Phase 1\n**Status: CLOSED.**\n'),
    p('c', 'built', '## Phase 1\n**Status: CLOSED.**\n## Phase 2\n**Status: DONE.**\n'),
    p('d', 'partial', '## Phase 1\nnothing\n'),
  ]).map(f => f.project), ['a', 'b'], 'only vocabulary words are judged');
  assert.deepEqual(statusUnknown([p('e', null, '## Phase 1\nx\n## Phase 2\ny\n'), p('f', null, '## Phase 1\n**Status: CLOSED.**\n## Phase 2\nnone\n')]).map(f => f.path), ['docs/projects/e/phases.md'],
    'a file with some Status lines is read; one with none at all is one finding');
  const gaps = changelogGaps({ commits: new Map([['2026-03-28', 2], ['2026-03-31', 1], ['2026-02-01', 9]]), pages: new Map([['2026-03-29', '<!-- draft -->']]), day: DATE });
  assert.deepEqual(gaps.map(g => g.day), ['2026-03-28', '2026-03-29'], 'outside the window and today are not owed');
  assert.deepEqual([...issuesNamed('see #3, a&#4; x#5\nissue: 6\n[it](https://github.com/a/b/issues/7)')].sort((a, b) => a - b), [3, 6, 7]);
});

test('on a projects-shaped repo each record measure reads the right count', async t => {
  const root = await acme(t);
  const gh = await ghStub(t, {
    issues: [{ number: 7, title: 'anvils' }, { number: 8, title: 'rockets' }, { number: 9, title: 'traps' }, { number: 40, title: 'named' }, { number: 41, title: 'linked' }, { number: 43, title: 'only the health page names it' }, { number: 44, title: 'nobody' }],
    prs: [{ number: 1, title: 'old', createdAt: '2026-03-01T00:00:00Z' }, { number: 2, title: 'fresh', createdAt: '2026-03-25T00:00:00Z' }, { number: 3, title: 'older', createdAt: '2026-02-01T00:00:00Z' }],
  });
  const r = await read(root, NEW, { ...process.env, KEEL_GH: gh });
  const values = Object.fromEntries(NEW.map(id => [id, [r[id].state, r[id].value]]));
  assert.deepEqual(values, {
    records_disagree: ['outside', 2],
    status_unknown: ['outside', 2],
    changelog_gaps: ['outside', 2],
    research_unindexed: ['outside', 2],
    verify_owed: ['outside', 3],
    issues_unnamed: ['outside', 2],
    issues_done_open: ['outside', 1],
    prs_stale: ['outside', 2],
  });
  assert.match(r.records_disagree.detail, /anvils: 1 phase open; front matter says built/);
  assert.match(r.records_disagree.detail, /rockets: every phase closed or retired; front matter says partial/);
  assert.match(r.status_unknown.detail, /rockets phase 3 says DONE/);
  assert.match(r.status_unknown.detail, /skates\/phases\.md: 2 phases, no Status line/);
  assert.deepEqual(r.changelog_gaps.facts.days, ['2026-03-28', '2026-03-29']);
  assert.match(r.changelog_gaps.detail, /2026-03-28 missing \(2 commits\), 2026-03-29 still a draft/);
  assert.deepEqual(r.research_unindexed.facts.missing, ['2026-01-02-fuels.md', '2026-01-03-springs.md']);
  assert.deepEqual(r.verify_owed.facts.oldest, { path: 'docs/verify/2026-03-01-catch.md', since: '2026-03-01', days: 30 });
  assert.equal(r.verify_owed.facts.owed.length, 3, 'unverified, no front matter, and a typo are owed; works is not');
  assert.deepEqual(r.issues_unnamed.facts.ids, [43, 44], 'the health pages name issues themselves and are not read');
  assert.deepEqual(r.issues_done_open.facts.found, [{ project: 'anvils', issue: 7, status: 'built' }]);
  assert.deepEqual(r.prs_stale.facts.stale, [{ number: 3, age: 58 }, { number: 1, age: 30 }]);
});

test('the projects shape: phases_stuck and phases_without_issue have values; the roadmap and evidence measures say why not', async t => {
  const root = await acme(t);
  const r = await read(root, PHASES);
  // Every project with an open phase names its issue; skates has none, but no Status line either: unknown, not open.
  assert.equal(r.phases_without_issue.state, 'ok');
  assert.equal(r.phases_without_issue.value, 0);
  assert.deepEqual(r.phases_without_issue.facts.ids, []);
  // anvils/2 (NOT STARTED) and traps/2 (PART-DONE) are open, in files last committed 1 Feb: 58 days.
  assert.equal(r.phases_stuck.state, 'outside');
  assert.deepEqual(r.phases_stuck.facts.stuck.map(s => [s.id, s.status, s.since, s.days]), [['anvils/2', 'planned', '2026-02-01', 58], ['traps/2', 'partial', '2026-02-01', 58]]);
  for (const id of ['roadmap_stale', 'evidence_placeholders']) {
    assert.equal(r[id].state, 'n/a', id);
    assert.match(r[id].detail, /projects shape/, id);
  }
});

test('phases_without_issue counts open phases in a project with no issue:', async t => {
  const root = await acme(t, { extra: { 'docs/projects/skates/phases.md': '# Skates\n\n## Phase 1\n\n**Status: CLOSED.**\n\n## Phase 2\n\n**Status: PART-DONE.**\n\n## Phase 3\n\n**Status: NOT STARTED.**\n' } });
  const r = await read(root, ['phases_without_issue', 'phases_stuck']);
  assert.equal(r.phases_without_issue.state, 'outside');
  assert.deepEqual(r.phases_without_issue.facts.ids, ['skates/2', 'skates/3']);
  assert.deepEqual(r.phases_without_issue.facts.projects, ['skates']);
  // skates' phases.md was committed again on the 28th: 3 days, not stuck.
  assert.ok(!r.phases_stuck.facts.stuck.some(s => s.id.startsWith('skates/')));
});

test('every new measure is n/a with its reason where the repo has nothing for it to read, never a zero', async t => {
  const root = join(await scratch(t), 'bare');
  await mkdir(root);
  git(root, ['init', '-q', '-b', 'main']);
  await put(root, { '.keel/keel.json': '{"name":"Acme","practices":["base"]}\n', 'docs/research/2026-01-01-x.md': '# x\n' });
  let r = await read(root, NEW);
  const why = {
    records_disagree: /no docs\/projects/, status_unknown: /no docs\/projects/, changelog_gaps: /no docs\/changelog/,
    research_unindexed: /no docs\/research\/README\.md/, verify_owed: /no docs\/verify/,
    issues_unnamed: /no repo/, issues_done_open: /no repo/, prs_stale: /no repo/,
  };
  for (const [id, re] of Object.entries(why)) {
    assert.equal(r[id].state, 'n/a', id);
    assert.equal(r[id].value, null, id);
    assert.match(r[id].detail, re, id);
  }
  // With a repo and gh, issues_done_open still needs docs/projects to read.
  await put(root, { '.keel/keel.json': '{"name":"Acme","repo":"acme/storefront","practices":["base"]}\n' });
  r = await read(root, ['issues_done_open', 'issues_unnamed'], { ...process.env, KEEL_GH: await ghStub(t) });
  assert.equal(r.issues_done_open.state, 'n/a');
  assert.match(r.issues_done_open.detail, /no docs\/projects/);
  assert.equal(r.issues_unnamed.state, 'ok', 'no open issues is a real zero: gh answered');
});

test('an instrument that cannot read is broken, not a zero: changelog_gaps outside a git repository', async t => {
  const root = join(await scratch(t), 'nogit');
  await put(root, { '.keel/keel.json': '{"name":"Acme","practices":["base"]}\n', 'docs/changelog/README.md': '# Changelog\n' });
  const r = await read(root, ['changelog_gaps'], { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) });
  assert.equal(r.changelog_gaps.state, 'broken');
  assert.equal(r.changelog_gaps.value, null);
  // A repository with no commits yet has no days owed: a real zero.
  git(root, ['init', '-q', '-b', 'main']);
  const fresh = await read(root, ['changelog_gaps']);
  assert.equal(fresh.changelog_gaps.state, 'ok');
  assert.equal(fresh.changelog_gaps.value, 0);
});

test('the files shape is unchanged: the projects reader is not used for the phase measures', async t => {
  const root = await acme(t, { shape: 'files' });
  const r = await read(root, ['phases_stuck', 'records_disagree']);
  assert.equal(r.phases_stuck.state, 'n/a');
  assert.match(r.phases_stuck.detail, /phases practice is not on/);
  assert.equal(r.records_disagree.value, 2, 'the record measures read docs/projects wherever it is');
});

test('ci_red_streak reads the gate workflow the project names (gateWorkflow), as fleet does', async t => {
  const root = join(await scratch(t), 'gated');
  await put(root, { '.github/workflows/release.yml': 'name: release\non: push\njobs: {}\n' });
  const dir = await scratch(t, 'keel-records-gh-');
  const gh = join(dir, 'gh');
  // Runs only for --workflow release: any other workflow is a 404, as GitHub answers.
  await writeFile(gh, `#!${process.execPath}
const a = process.argv.slice(2);
if (a.includes('--version')) console.log('gh version 2.0.0 (stub)');
else if (a[0] === 'auth') process.exit(0);
else if (a[0] === 'run' && a[a.indexOf('--workflow') + 1] === 'release') console.log('[{"conclusion":"failure"},{"conclusion":"failure"},{"conclusion":"success"}]');
else { console.error('HTTP 404: Not Found'); process.exit(1); }
`);
  await chmod(gh, 0o755);
  const env = { ...process.env, KEEL_GH: gh };
  const ci = MEASURES.filter(m => m.id === 'ci_red_streak');
  const base = { name: 'Acme', repo: 'acme/storefront', check: 'npm test && npm run typecheck' };
  let [r] = await measure({ root, config: base, env, date: DATE, measures: ci });
  assert.equal(r.state, 'n/a', 'no rule finds release.yml');
  assert.match(r.detail, /names no gateWorkflow/);
  [r] = await measure({ root, config: { ...base, gateWorkflow: 'release' }, env, date: DATE, measures: ci });
  assert.equal(r.state, 'outside', JSON.stringify(r));
  assert.equal(r.value, 2);
  assert.match(r.detail, /^release: 2 failed runs in a row/);
  [r] = await measure({ root, config: { ...base, gateWorkflow: '  ' }, env, date: DATE, measures: ci });
  assert.equal(r.state, 'broken', 'a gateWorkflow that is not a name is said, never ignored');
  assert.match(r.detail, /must be a workflow's name/);
});

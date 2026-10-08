// keel fleet: one look at every project in fleet.json. gh is stubbed at the
// boundary the way real gh behaves (lesson 8): `api repos/<r>` prints the repo
// object; `api repos/<r>/contents/<path>` prints {type: file, encoding: base64,
// content} with GitHub's line breaks for a file and an array of entries for a
// directory; a missing path prints GitHub's 404 body on stdout and
// "gh: Not Found (HTTP 404)" on stderr, exit 1 (a path in failPaths fails
// with its stderr line instead, as a 5xx or 403 does); `run list --json` and
// `pr list --json` print arrays of the asked fields; `api .../commits?path=`
// prints commit objects newest first. Fixtures are synthetic (Acme).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run as runCmd, cleanEnv } from './helpers/run.mjs';
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleet, fleetUpdate, healthOf, gateName, gateOf, runCommands, onPush, parseFleet } from '../lib/fleet.mjs';
import { execFileSync } from 'node:child_process';
import { init } from '../lib/init.mjs';
import { load as loadMigrations } from '../lib/migrations.mjs';
import { practiceVersion } from '../lib/practices.mjs';
import { lessonFingerprint, parseLessons } from '../lib/lessons.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const NOW = '2026-10-02T12:00:00.000Z';
const PIN_FULL = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const HEAD = 'f00dfeed0123456789abcdef0123456789abcdef';
// Synthetic migrations: each applies while its marker file is on the default branch.
const MIGRATIONS = [
  { id: '0001-acme-one', applies: async p => p.exists('acme-one.todo') },
  { id: '0002-acme-two', applies: async p => (await p.read('acme-two.todo')) !== null },
];

async function scratch(t, prefix) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A synthetic keel home with a fleet.json and one practice pinned to acme/upstream. */
async function home(t, fleetList) {
  const dir = await scratch(t, 'keel-fleet-');
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme Keel', repo: 'acme/keel', keel: 'self', practice: '0.2.0', practices: [] }));
  await writeFile(join(dir, 'fleet.json'), JSON.stringify(fleetList));
  await mkdir(join(dir, 'practices/conduct'), { recursive: true });
  await writeFile(join(dir, 'practices/conduct/practice.json'), JSON.stringify({
    name: 'conduct', source: { repo: 'acme/upstream', path: 'skills/conduct/SKILL.md', commit: 'a1b2c3d4', license: 'Apache-2.0' }, files: [],
  }));
  return dir;
}

/**
 * A gh over a JSON state: repos[r] = { default_branch, files: { path: text },
 * runs: [...], prs: [...], fail?: "stderr line" }, commits["repo:path"] = [sha…].
 */
async function stubGh(t, state) {
  const dir = await scratch(t, 'keel-fleet-gh-');
  const log = join(dir, 'gh.log'), file = join(dir, 'state.json'), gh = join(dir, 'gh');
  await writeFile(file, JSON.stringify(state));
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(file)}, 'utf8'));
const opt = f => argv[argv.indexOf(f) + 1];
const notFound = () => {
  console.log(JSON.stringify({ message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' }));
  console.error('gh: Not Found (HTTP 404)'); process.exit(1);
};
const repoOf = r => { const x = s.repos[r]; if (x && x.fail) { console.error('gh: ' + x.fail); process.exit(1); } return x; };
const pick = (rows, fields) => rows.map(x => Object.fromEntries(fields.map(f => [f, x[f] ?? ''])));
const [a, b] = argv;
if (a === 'api' && b === 'graphql' && s.rate) console.log(JSON.stringify({ data: { rateLimit: s.rate } }));
else if (a === 'api') {
  const u = new URL(argv[1], 'https://api.github.com/');
  let m;
  if ((m = /^\\/repos\\/([^/]+\\/[^/]+)$/.exec(u.pathname))) {
    const r = repoOf(m[1]); if (!r) notFound();
    console.log(JSON.stringify({ full_name: m[1], private: true, default_branch: r.default_branch }));
  } else if ((m = /^\\/repos\\/([^/]+\\/[^/]+)\\/commits$/.exec(u.pathname))) {
    const shas = s.commits[m[1] + ':' + u.searchParams.get('path')];
    if (!shas) { console.log('[]'); process.exit(0); }
    console.log(JSON.stringify(shas.slice(0, Number(u.searchParams.get('per_page') ?? 30)).map(sha => ({ sha }))));
  } else if ((m = /^\\/repos\\/([^/]+\\/[^/]+)\\/contents\\/(.+)$/.exec(u.pathname))) {
    const r = repoOf(m[1]); if (!r) notFound();
    const path = decodeURIComponent(m[2]);
    if ((r.failPaths ?? {})[path]) { console.error('gh: ' + r.failPaths[path]); process.exit(1); }
    const files = r.files ?? {};
    if (path in files) {
      const content = Buffer.from(files[path]).toString('base64').replace(/(.{60})/g, '$1\\n');
      console.log(JSON.stringify({ type: 'file', name: path.split('/').pop(), path, encoding: 'base64', content }));
    } else {
      const kids = new Map();
      for (const f of Object.keys(files).filter(f => f.startsWith(path + '/'))) {
        const rest = f.slice(path.length + 1).split('/');
        kids.set(rest[0], rest.length > 1 ? 'dir' : 'file');
      }
      if (!kids.size) notFound();
      console.log(JSON.stringify([...kids].map(([name, type]) => ({ name, path: path + '/' + name, type }))));
    }
  } else notFound();
} else if (a === 'run' && b === 'list') {
  const r = repoOf(opt('-R')); if (!r) { console.error('GraphQL: Could not resolve to a Repository'); process.exit(1); }
  const w = argv.includes('--workflow') ? opt('--workflow') : null, br = argv.includes('--branch') ? opt('--branch') : null;
  const rows = (r.runs ?? []).filter(x => (!w || x.workflowName === w) && (!br || x.headBranch === br));
  console.log(JSON.stringify(pick(rows.slice(0, Number(opt('--limit'))), opt('--json').split(','))));
} else if (a === 'pr' && b === 'list') {
  const r = repoOf(opt('-R')); if (!r) { console.error('GraphQL: Could not resolve to a Repository'); process.exit(1); }
  console.log(JSON.stringify(pick(r.prs ?? [], opt('--json').split(','))));
} else if (a === 'repo' && b === 'clone') {
  // A clone is a copy of the prepared checkout (its origin a local bare repo), links kept as git keeps them.
  const from = (s.prepared ?? {})[argv[2]];
  if (!from) { console.error('GraphQL: Could not resolve to a Repository with the name ' + argv[2] + '.'); process.exit(1); }
  fs.cpSync(from, argv[3], { recursive: true, verbatimSymlinks: true });
} else if (a === 'pr' && b === 'create') {
  console.log('https://github.com/acme/pulls/' + opt('--head'));
} else { console.error('stub gh: unknown ' + argv.join(' ')); process.exit(1); }
`);
  await chmod(gh, 0o755);
  return {
    env: { ...cleanEnv(), KEEL_GH: gh },
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)),
  };
}

const LESSONS = `# Lessons

| # | shape | cost | guard |
| --- | --- | --- | --- |
| 1 | **A cache lies.** | Acme lost a day. | A test. |
| 2 | **A flag is forgotten.** | Acme lost an hour. | A lint. |
| 3 | **A stub agrees.** | Acme lost a week. | Record real responses. |
`;
const cfg = (over = {}) => JSON.stringify({ name: 'Acme', repo: 'acme/behind', practice: '0.1.0', practices: ['base'], migrations: ['0001-acme-one'], ...over });
const run = (workflowName, conclusion, createdAt, extra = {}) => ({ workflowName, conclusion, createdAt, headBranch: 'main', status: 'completed', ...extra });

/** The fleet the tests read: one of each case. */
function state() {
  const sentOne = JSON.stringify({ [lessonFingerprint('acme/behind', parseLessons(LESSONS).rows[0])]: { issue: 'u', at: NOW } });
  return {
    repos: {
      'acme/behind': {
        default_branch: 'main',
        files: { '.keel/keel.json': cfg(), 'docs/health/2026-09-25.md': '#', 'docs/health/2026-09-28.md': '#', 'docs/lessons.md': LESSONS, '.keel/sent.json': sentOne, 'acme-two.todo': 'x' },
        runs: [run('check', '', '2026-10-02T03:00:00Z', { status: 'in_progress' }), run('check', 'failure', '2026-10-01T03:00:00Z'),
          run('deploy', 'success', '2026-10-01T04:00:00Z'), run('check', 'success', '2026-10-01T05:00:00Z', { headBranch: 'feature' })],
        prs: [{ number: 1, headRefName: 'keel-night/2026-10-01' }, { number: 2, headRefName: 'keel-night/2026-10-02' }, { number: 3, headRefName: 'person/fix' }],
      },
      'acme/fresh': {
        default_branch: 'trunk',
        files: { '.keel/keel.json': cfg({ repo: 'acme/fresh', practice: '0.2.0', migrations: ['0001-acme-one', '0002-acme-two'] }), 'docs/health/2026-10-01.md': '#' },
        runs: [run('Tests', 'success', '2026-10-01T03:00:00Z', { headBranch: 'trunk' })],
      },
      'acme/quiet': { default_branch: 'main', files: { '.keel/keel.json': cfg({ repo: 'acme/quiet', practice: '0.2.0', migrations: ['0001-acme-one', '0002-acme-two'] }) }, runs: [] },
      'acme/plain': { default_branch: 'main', files: { 'README.md': '# plain' }, runs: [run('CI', 'success', '2026-10-01T00:00:00Z')] },
      'acme/limited': { fail: 'API rate limit exceeded for user ID 1. (HTTP 403)' },
    },
    commits: { 'acme/upstream:skills/conduct/SKILL.md': [PIN_FULL] },
  };
}
const LIST = [
  { repo: 'acme/behind', kind: 'node', role: 'managed' },
  { repo: 'acme/fresh', kind: 'web', role: 'managed' },
  { repo: 'acme/quiet', kind: 'static', role: 'managed' },
  { repo: 'acme/plain', kind: 'other', role: 'managed' },
  { repo: 'acme/limited', kind: 'node', role: 'managed' },
  { repo: 'acme/upstream', kind: 'node', role: 'source', note: 'learned from, never managed' },
];
const go = (dir, gh) => fleet({ dir }, { env: gh.env, now: NOW, cli: '0.2.0', migrations: MIGRATIONS });
const rowOf = (r, repo) => r.data.rows.find(x => x.repo === repo);
const needsOf = (r, repo) => r.data.needs.filter(n => n.repo === repo).map(n => n.why);

test('a project behind: how far, which migrations it has not recorded (fleet update asks them), red CI from the gate on the default branch', async t => {
  const r = await go(await home(t, LIST), await stubGh(t, state()));
  const row = rowOf(r, 'acme/behind');
  assert.equal(row.adopted, true);
  assert.equal(row.practice.behind, '0.1.0 → 0.2.0');
  assert.deepEqual(row.practice, { version: '0.1.0', behind: '0.1.0 → 0.2.0', unrecorded: ['0002-acme-two'] }, 'plain fleet never asks applies()');
  assert.equal(row.ci.workflow, 'check');
  assert.equal(row.ci.rule, 'named check');
  assert.equal(row.ci.state, 'red', 'the newest completed check on main failed; the running one and the feature branch do not count');
  assert.equal(row.machinePrs.total, 2);
  assert.ok(needsOf(r, 'acme/behind').includes('behind: 0.1.0 → 0.2.0; 1 unrecorded (0002-acme-two); keel fleet update checks them (keel update)'));
  assert.ok(needsOf(r, 'acme/behind').some(w => w.startsWith('red: check failure')));
  assert.ok(needsOf(r, 'acme/behind').includes('2 open keel-night/ PRs (keel drain keel-night/)'));
  assert.match(r.text, /acme\/behind\s+yes\s+0\.1\.0 → 0\.2\.0/);
});

test('under the quota floor the machine PRs are not read: the cell says it is saving the quota', async t => {
  const gh = await stubGh(t, { ...state(), rate: { remaining: 500, resetAt: '2026-10-08T22:00:00Z' } });
  const env = { ...gh.env, KEEL_CACHE: await scratch(t, 'keel-fleet-cache-') };
  delete env.KEEL_QUOTA_FLOOR;
  const r = await fleet({ dir: await home(t, LIST) }, { env, now: NOW, cli: '0.2.0', migrations: MIGRATIONS });
  assert.match(rowOf(r, 'acme/behind').machinePrs.unreadable, /^saving your GitHub quota \(500 left until \d\d:\d\d\)$/);
  assert.equal((await gh.calls()).filter(c => c[0] === 'pr').length, 0, 'no PR read under the floor');
});

test('a gate workflow named in config (.keel/keel.json gateWorkflow) is the gate, read on its own past a busy repo\'s newest 50 runs', async t => {
  const st = state();
  const fresh = st.repos['acme/fresh'];
  // isocan's shape: a gate called release, which no rule guesses, behind sixty newer runs of a bot's workflow.
  fresh.files['.keel/keel.json'] = cfg({ repo: 'acme/fresh', practice: '0.2.0', migrations: ['0001-acme-one', '0002-acme-two'], check: 'npm test && npm run typecheck', gateWorkflow: 'release' });
  fresh.runs = [...Array.from({ length: 60 }, (_, i) => run('grade', 'success', `2026-10-01T${String(10 + Math.floor(i / 6)).padStart(2, '0')}:${String(i % 6 * 10).padStart(2, '0')}:00Z`, { headBranch: 'trunk' })),
    run('release', 'failure', '2026-10-01T05:00:00Z', { headBranch: 'feature' }), run('release', 'success', '2026-10-01T04:00:00Z', { headBranch: 'trunk' })];
  const gh = await stubGh(t, st);
  const r = await go(await home(t, LIST), gh);
  const ci = rowOf(r, 'acme/fresh').ci;
  assert.deepEqual([ci.workflow, ci.rule, ci.state], ['release', 'named in config', 'green'], 'the default branch\'s release, not the feature branch\'s');
  assert.ok((await gh.calls()).some(c => c[0] === 'run' && c.includes('--workflow') && c[c.indexOf('--workflow') + 1] === 'release' && c[c.indexOf('--branch') + 1] === 'trunk'));
  assert.equal(rowOf(r, 'acme/behind').ci.rule, 'named check', 'no setting: the rules as before');
  // Without the setting, the same runs give no gate: nothing guesses release.
  fresh.files['.keel/keel.json'] = cfg({ repo: 'acme/fresh', practice: '0.2.0', check: 'npm test && npm run typecheck' });
  assert.equal(rowOf(await go(await home(t, LIST), await stubGh(t, st)), 'acme/fresh').ci.state, 'no gate run');
  // A setting that is not a name is said, never ignored.
  fresh.files['.keel/keel.json'] = cfg({ repo: 'acme/fresh', practice: '0.2.0', gateWorkflow: '' });
  assert.match(rowOf(await go(await home(t, LIST), await stubGh(t, st)), 'acme/fresh').ci.unreadable, /"gateWorkflow" must be/);
});

test('health is read from the project\'s configured dir (.keel/keel.json `health`), not docs/health', async t => {
  const st = state();
  const fresh = st.repos['acme/fresh'];
  // ledger's shape: an old page left in docs/health, the live ones in .keel/health.
  fresh.files = { ...fresh.files, '.keel/keel.json': cfg({ repo: 'acme/fresh', practice: '0.2.0', migrations: ['0001-acme-one', '0002-acme-two'], health: '.keel/health' }),
    'docs/health/2026-09-01.md': '#', '.keel/health/2026-10-01.md': '#' };
  delete fresh.files['docs/health/2026-10-01.md'];
  const gh = await stubGh(t, st);
  const r = await go(await home(t, LIST), gh);
  assert.deepEqual(rowOf(r, 'acme/fresh').health, { last: '2026-10-01', age: 1, state: 'fresh', dir: '.keel/health' });
  assert.ok((await gh.calls()).some(c => c[0] === 'api' && c[1] === 'repos/acme/fresh/contents/.keel/health'), 'listed the configured dir');
  assert.deepEqual(rowOf(r, 'acme/behind').health, { last: '2026-09-28', age: 4, state: 'silent' }, 'no setting: the default');
  // A health dir outside the repo is unreadable, never the default's reading.
  fresh.files['.keel/keel.json'] = cfg({ repo: 'acme/fresh', practice: '0.2.0', health: '../elsewhere' });
  const bad = await go(await home(t, LIST), await stubGh(t, st));
  assert.match(rowOf(bad, 'acme/fresh').health.unreadable, /"health" cannot leave the repo/);
});

test('a health page older than two days is silent, not healthy; none says so', async t => {
  const r = await go(await home(t, LIST), await stubGh(t, state()));
  assert.deepEqual(rowOf(r, 'acme/behind').health, { last: '2026-09-28', age: 4, state: 'silent' });
  assert.ok(needsOf(r, 'acme/behind').includes('silent: last health page 2026-09-28, 4 days ago'));
  assert.equal(rowOf(r, 'acme/fresh').health.state, 'fresh');
  assert.deepEqual(needsOf(r, 'acme/fresh'), [], 'current, green on its own default branch (trunk), fresh: nothing needed');
  assert.equal(rowOf(r, 'acme/fresh').ci.state, 'green');
  assert.equal(rowOf(r, 'acme/quiet').health.state, 'none');
  assert.ok(needsOf(r, 'acme/quiet').includes('no health page'));
  assert.match(r.text, /acme\/quiet .*no health page/);
  assert.match(r.text, /acme\/behind .*2026-09-28 silent/);
  // The boundary: two days is fresh, three is silent.
  assert.equal(healthOf(['2026-09-30.md'], NOW).state, 'fresh');
  assert.equal(healthOf(['2026-09-29.md', 'README.md'], NOW).state, 'silent');
});

test('unsent lessons: rows whose fingerprint is not in .keel/sent.json', async t => {
  const r = await go(await home(t, LIST), await stubGh(t, state()));
  assert.deepEqual(rowOf(r, 'acme/behind').lessons, { project: 'acme/behind', rows: 3, unsent: 2 });
  assert.ok(needsOf(r, 'acme/behind').includes('2 unsent lessons (keel lessons, there)'));
  assert.equal(rowOf(r, 'acme/quiet').lessons.unsent, 0, 'no lessons.md is nothing to send');
});

test('a configured lessons path is where fleet counts unsent lessons (phase 16)', async t => {
  const s = state();
  s.repos['acme/quiet'].files['.keel/keel.json'] = cfg({ repo: 'acme/quiet', practice: '0.2.0', migrations: ['0001-acme-one', '0002-acme-two'], lessons: 'docs/reviews/lessons.md' });
  s.repos['acme/quiet'].files['docs/reviews/lessons.md'] = LESSONS;
  const gh = await stubGh(t, s);
  const r = await go(await home(t, LIST), gh);
  assert.deepEqual(rowOf(r, 'acme/quiet').lessons, { project: 'acme/quiet', path: 'docs/reviews/lessons.md', rows: 3, unsent: 3 });
  assert.ok((await gh.calls()).some(c => c[1] === 'repos/acme/quiet/contents/docs/reviews/lessons.md'));
});

test('unadopted (404 on .keel/keel.json): shown as not adopted, its CI still read', async t => {
  const r = await go(await home(t, LIST), await stubGh(t, state()));
  const row = rowOf(r, 'acme/plain');
  assert.equal(row.adopted, false);
  assert.equal(row.ci.workflow, 'CI');
  assert.deepEqual(needsOf(r, 'acme/plain'), ['not adopted']);
  assert.match(r.text, /acme\/plain\s+no\s+—/);
});

test('an unreadable repo says why in its row; the others still render', async t => {
  const r = await go(await home(t, LIST), await stubGh(t, state()));
  const row = rowOf(r, 'acme/limited');
  assert.match(row.unreadable, /rate limit/);
  assert.equal(row.adopted, undefined, 'never shown as anything it could not read');
  assert.match(r.text, /acme\/limited\s+unreadable: API rate limit exceeded/);
  assert.ok(needsOf(r, 'acme/limited')[0].startsWith('unreadable:'));
  assert.equal(r.data.rows.length, LIST.length);
  assert.equal(r.exitCode, 0);
});

test('a source repo: unmoved, then moved', async t => {
  const dir = await home(t, LIST);
  let r = await go(dir, await stubGh(t, state()));
  assert.deepEqual(rowOf(r, 'acme/upstream').pins, [{ practice: 'conduct', path: 'skills/conduct/SKILL.md', pinned: 'a1b2c3d4', head: PIN_FULL, moved: false }]);
  assert.deepEqual(needsOf(r, 'acme/upstream'), []);
  assert.match(r.text, /acme\/upstream: conduct pins skills\/conduct\/SKILL\.md@a1b2c3d4 — unmoved/);
  const s = state();
  s.commits['acme/upstream:skills/conduct/SKILL.md'] = [HEAD, PIN_FULL];
  r = await go(dir, await stubGh(t, s));
  assert.equal(rowOf(r, 'acme/upstream').pins[0].moved, true);
  assert.deepEqual(needsOf(r, 'acme/upstream'), ['conduct: upstream skills/conduct/SKILL.md moved a1b2c3d4 → f00dfeed (keel learn)']);
});

test('the reads are read-only gh calls, seven per managed repo and one per pin, then the default branch where a question needs it', async t => {
  const gh = await stubGh(t, state());
  await go(await home(t, LIST), gh);
  const calls = await gh.calls();
  // 8 per managed repo (the workflows listing among them), 1 per pinned source, and one quota probe
  // (GraphQL's rateLimit) before the PR reads; nothing writes.
  assert.equal(calls.length, 5 * 8 + 1 + 1);
  assert.equal(calls.filter(c => c[1] === 'graphql' && c.some(a => a.includes('rateLimit'))).length, 1, 'the floor asks once a run, not once a repo');
  assert.equal(calls.filter(c => /contents\/\.github\/workflows$/.test(c[1])).length, 5);
  // Plain fleet never asks a migration: no read at a ref, none of the migration's marker.
  assert.deepEqual(calls.filter(c => /\?ref=|acme-(one|two)\.todo/.test(String(c[1]))), []);
  assert.ok(calls.every(c => ['api', 'run', 'pr'].includes(c[0]) && !c.includes('-X') && !c.includes('--method')));
});

test('the gate workflow: one named check; else one with default-branch runs whose YAML runs the check or npm test; else a name match — and the cell says which', async t => {
  // Shaped like a project whose Tests run on pull requests only and whose Deploy runs the check on main.
  const TEST_YML = 'name: Tests\non:\n  pull_request:\njobs:\n  check:\n    steps:\n      - run: npm ci\n      - run: npm test\n';
  const DEPLOY_YML = 'name: Deploy\n# Every push to main is checked, then built.\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - name: The gate\n        run: |\n          npm run check\n      - run: npm run build\n';
  const NIGHT_YML = 'name: keel-night\n# the gate (npm run check) runs inside improve.mjs\non:\n  schedule:\n    - cron: "23 7 * * *"\njobs:\n  night:\n    steps:\n      - run: node scripts/keel/improve.mjs --report\n';
  const st = {
    repos: {
      'acme/duet': {
        default_branch: 'main',
        files: { '.keel/keel.json': cfg({ repo: 'acme/duet', practice: '0.2.0', migrations: ['0001-acme-one', '0002-acme-two'] }), 'docs/health/2026-10-01.md': '#',
          '.github/workflows/test.yml': TEST_YML, '.github/workflows/deploy.yml': DEPLOY_YML, '.github/workflows/keel-night.yml': NIGHT_YML },
        runs: [run('Tests', 'failure', '2026-10-02T01:00:00Z', { headBranch: 'acme/feature' }), run('keel-night', 'success', '2026-10-02T07:23:00Z'),
          run('Deploy', 'success', '2026-10-01T05:00:00Z'), run('Deploy', 'failure', '2026-09-30T05:00:00Z')],
      },
    },
    commits: {},
  };
  const r = await go(await home(t, [{ repo: 'acme/duet', kind: 'web', role: 'managed' }]), await stubGh(t, st));
  const row = rowOf(r, 'acme/duet');
  assert.deepEqual([row.ci.state, row.ci.workflow, row.ci.rule], ['green', 'Deploy', 'runs npm run check']);
  assert.match(r.text, /acme\/duet .*green \(Deploy · runs npm run check\)/);
  assert.deepEqual(needsOf(r, 'acme/duet'), []);

  // The rules, in order.
  assert.deepEqual(runCommands(DEPLOY_YML), ['npm ci', 'npm run check', 'npm run build']);
  assert.deepEqual(runCommands(NIGHT_YML), ['node scripts/keel/improve.mjs --report'], 'a comment naming the check is not a step');
  assert.deepEqual([TEST_YML, DEPLOY_YML, NIGHT_YML, 'on: [push, pull_request]\n', 'on:\n  workflow_dispatch: {}\n# push\nenv:\n  push: 1\n'].map(onPush), [false, true, false, true, false]);
  const workflows = [{ name: 'Lint', push: true, commands: ['npm test'] }, { name: 'Deploy', push: true, commands: ['npm ci && npm run verify -- --ci'] },
    { name: 'loop', push: false, commands: ['npm run verify'] }];
  assert.deepEqual(gateOf(['loop', 'Lint'], { workflows, check: 'npm run verify' }), { workflow: 'Lint', rule: 'runs npm test' }, 'a loop not run by push is not the gate');
  assert.deepEqual(gateOf(['Lint', 'Deploy', 'Check'], { workflows }), { workflow: 'Check', rule: 'named check' });
  assert.deepEqual(gateOf(['Lint', 'Deploy', 'Check'], { workflows, gateWorkflow: 'release' }), { workflow: 'release', rule: 'named in config' }, 'the config\'s word beats every rule');
  assert.deepEqual(gateOf(['Lint', 'Deploy'], { workflows, check: 'npm run verify' }), { workflow: 'Deploy', rule: 'runs npm run verify' }, 'the configured check beats npm test');
  assert.deepEqual(gateOf(['Lint', 'Deploy'], { workflows }), { workflow: 'Lint', rule: 'runs npm test' });
  assert.deepEqual(gateOf(['Deploy', 'CI'], { workflows: null }), { workflow: 'CI', rule: 'name matches' });
  assert.deepEqual(gateOf(['Deploy'], { workflows: [{ name: 'Tests', push: true, commands: ['npm test'] }] }), { workflow: null, rule: null }, 'a workflow with no run on the default branch is never the gate');
});

test('CI is the newest verdict: cancelled, skipped and running gate runs are counted, never read as the state', async t => {
  // Shaped like a busy repo with cancel-in-progress: one running, three cancelled, then the verdict.
  const busy = (verdict, extra = []) => [run('Tests', '', '2026-10-02T22:00:00Z', { status: 'in_progress' }),
    run('Tests', 'cancelled', '2026-10-02T21:50:00Z'), run('Tests', 'cancelled', '2026-10-02T21:40:00Z'), run('Tests', 'cancelled', '2026-10-02T21:30:00Z'),
    run('Tests', verdict, '2026-10-02T21:29:00Z'), ...extra];
  const repo = (name, runs) => ({ default_branch: 'main', runs,
    files: { '.keel/keel.json': cfg({ repo: name, practice: '0.2.0', migrations: ['0001-acme-one', '0002-acme-two'] }), 'docs/health/2026-10-01.md': '#' } });
  const st = { repos: {
    'acme/green': repo('acme/green', busy('success', [run('Tests', 'failure', '2026-10-02T20:00:00Z')])),
    'acme/red': repo('acme/red', busy('failure', [run('Tests', 'skipped', '2026-10-02T21:00:00Z'), run('Tests', 'success', '2026-10-02T20:00:00Z')])),
    'acme/none': repo('acme/none', [run('Tests', 'cancelled', '2026-10-02T21:50:00Z'), run('Tests', 'neutral', '2026-10-02T21:40:00Z')]),
  }, commits: {} };
  const list = ['acme/green', 'acme/red', 'acme/none'].map(repo => ({ repo, kind: 'node', role: 'managed' }));
  const r = await go(await home(t, list), await stubGh(t, st));
  const g = rowOf(r, 'acme/green').ci;
  assert.deepEqual([g.state, g.conclusion, g.at, g.running, g.skipped], ['green', 'success', '2026-10-02T21:29:00Z', 1, { cancelled: 3 }]);
  assert.match(r.text, /acme\/green .*green \(Tests · name matches · last verdict 21:29; 3 newer cancelled, 1 running\)/);
  assert.deepEqual(needsOf(r, 'acme/green'), []);
  const red = rowOf(r, 'acme/red').ci;
  assert.deepEqual([red.state, red.conclusion], ['red', 'failure'], 'a failure behind cancelled runs is still red');
  assert.ok(needsOf(r, 'acme/red').includes('red: Tests failure at 2026-10-02T21:29:00Z'));
  assert.equal(rowOf(r, 'acme/none').ci.state, 'no verdict');
  assert.match(r.text, /acme\/none .*no verdict \(Tests · name matches · no verdict; 1 newer cancelled, 1 newer neutral\)/);
});

test('fleet.json is checked; keel fleet runs at home only (exit 2 elsewhere)', async t => {
  assert.throws(() => parseFleet('[{"repo":"acme","role":"managed"}]'), /owner\/name/);
  assert.throws(() => parseFleet('[{"repo":"acme/a","role":"boss"}]'), /role/);
  assert.throws(() => parseFleet('[{"repo":"acme/a","role":"source"},{"repo":"acme/a","role":"source"}]'), /twice/);
  assert.equal(gateName(['Deploy', 'CI alert', 'check']), 'check');
  assert.equal(gateName(['Deploy', 'Test and deploy']), 'Test and deploy');
  assert.equal(gateName(['Deploy', 'Claude']), null);

  const dir = await home(t, LIST);
  const away = await scratch(t, 'keel-fleet-away-');
  await mkdir(join(away, '.keel'));
  await writeFile(join(away, '.keel/keel.json'), cfg());
  const gh = await stubGh(t, state());
  const r = runCmd(process.execPath, [BIN, 'fleet', '--json'], { cwd: away, env: gh.env });
  assert.equal(r.status, 2);
  assert.match(JSON.parse(r.stdout).error, /fleet runs at home/);
  const ok = runCmd(process.execPath, [BIN, 'fleet', '--json'], { cwd: dir, env: gh.env });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stderr, '');
  const data = JSON.parse(ok.stdout);
  assert.equal(data.rows.length, LIST.length);
  const text = runCmd(process.execPath, [BIN, 'fleet'], { cwd: dir, env: gh.env });
  assert.match(text.stdout, /^repo\s+adopted\s+practice\s+health\s+CI\s+unsent lessons\s+machine PRs$/m);
  assert.match(text.stdout, /^Needs you:$/m);
});

// ---- fleet update -------------------------------------------------------------

const GIT_ENV = { GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test', GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test', GIT_CONFIG_NOSYSTEM: '1', KEEL_SELF_UPDATED: '' };
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...cleanEnv(), ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// The practice version these tests inject as the CLI's. Every fixture version
// below derives from it, and the spawned CLI gets it through KEEL_FLEET_PRACTICE,
// so keel's live package version never enters a count.
const CLI = '0.3.0';
const BEHIND = (([major, minor]) => `${major}.${minor - 1}.0`)(CLI.split('.').map(Number));
const UPDATE_BRANCH = `keel/update-v${CLI}`;
const re = s => new RegExp(s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));

/** A keel init project on practice BEHIND, its origin a local bare repo, and a checkout the stub's clone copies. */
async function remoteProject(t, name, version = BEHIND, over = null) {
  const root = await scratch(t, `keel-fleet-${name}-`);
  const src = join(root, name);
  await init({ dir: src, name: `Acme ${name}`, description: `Acme ${name} keeps its notes as plain files.`, kind: 'node' }, { version: { cli: version, commit: null, practice: version }, env: { ...cleanEnv(), ...GIT_ENV } });
  if (over) { // fields over .keel/keel.json (setup, env), committed on main
    const path = join(src, '.keel/keel.json');
    await writeFile(path, `${JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), ...over }, null, 2)}\n`);
    git(src, 'commit', '-qam', 'Acme: its own install');
  }
  const origin = join(root, 'origin.git');
  execFileSync('git', ['clone', '-q', '--bare', src, origin], { env: { ...cleanEnv(), ...GIT_ENV } });
  const prepared = join(root, 'prepared');
  execFileSync('git', ['clone', '-q', origin, prepared], { env: { ...cleanEnv(), ...GIT_ENV } });
  return { origin, prepared, config: await readFile(join(src, '.keel/keel.json'), 'utf8') };
}

async function fleetOfUpdates(t) {
  const notes = await remoteProject(t, 'notes'), ledger = await remoteProject(t, 'ledger');
  const all = (await loadMigrations()).map(m => m.id);
  const current = JSON.stringify({ name: 'Acme Current', repo: 'acme/current', practice: CLI, practices: ['base'], migrations: all });
  const st = {
    repos: {
      'acme/notes': { default_branch: 'main', files: { '.keel/keel.json': notes.config } },
      'acme/ledger': { default_branch: 'main', files: { '.keel/keel.json': ledger.config } },
      'acme/current': { default_branch: 'main', files: { '.keel/keel.json': current } },
      'acme/waiting': { default_branch: 'main', files: { '.keel/keel.json': notes.config }, prs: [{ number: 9, headRefName: UPDATE_BRANCH }] },
      'acme/gone': { default_branch: 'main', files: { '.keel/keel.json': notes.config } },
    },
    commits: {},
    prepared: { 'acme/notes': notes.prepared, 'acme/ledger': ledger.prepared },
  };
  const list = ['notes', 'ledger', 'current', 'waiting', 'gone'].map(n => ({ repo: `acme/${n}`, kind: 'node', role: 'managed' }));
  const dir = await home(t, list);
  const gh = await stubGh(t, st);
  gh.env = { ...gh.env, ...GIT_ENV };
  return { dir, gh, notes, ledger };
}
const updateDeps = (gh, cli = CLI) => ({ env: gh.env, now: NOW, cli, cliRoot: KEEL, whatsnew: join(KEEL, 'WHATSNEW.md') });

test('fleet update without --yes: each project behind or with pending migrations, and the PR it would open; exit 3; nothing cloned', async t => {
  const { dir, gh } = await fleetOfUpdates(t);
  const r = await fleetUpdate({ dir }, updateDeps(gh));
  assert.equal(r.exitCode, 3, r.text);
  assert.equal(r.data.needs, 'yes');
  assert.deepEqual(r.data.plans.map(p => [p.repo, p.from, p.to, p.branch, p.open]), [
    ['acme/notes', BEHIND, CLI, UPDATE_BRANCH, false],
    ['acme/ledger', BEHIND, CLI, UPDATE_BRANCH, false],
    ['acme/waiting', BEHIND, CLI, UPDATE_BRANCH, true],
    ['acme/gone', BEHIND, CLI, UPDATE_BRANCH, false],
  ], 'acme/current is current with every migration recorded; keel itself is never one');
  assert.match(r.text, re(`acme/notes: "keel update: practice ${BEHIND} → ${CLI}" from ${UPDATE_BRANCH}`));
  assert.match(r.text, re(`acme/waiting: ${UPDATE_BRANCH} is already open; it waits for a person`));
  assert.match(r.text, /⚑ Opening pull requests on these repos needs a yes/);
  assert.ok((await gh.calls()).every(c => ['api', 'run', 'pr'].includes(c[0]) && !(c[0] === 'pr' && c[1] === 'create')), 'reads only');
  // The CLI: the same plan, exit 3; at home only.
  const cli = runCmd(process.execPath, [BIN, 'fleet', 'update', '--json'], { cwd: dir, env: { ...gh.env, KEEL_FLEET_PRACTICE: CLI } });
  assert.equal(cli.status, 3, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).plans.length, 4);
});

test('fleet update counts follow the injected version, far above and far below the live one, in-process and through the CLI', async t => {
  const { dir, gh } = await fleetOfUpdates(t);
  const live = practiceVersion();
  const [major] = live.split('.').map(Number);
  const above = `${major + 100}.0.0`, below = '0.0.1';
  // Far above: every adopted project but home is behind, and none has this branch open yet.
  let r = await fleetUpdate({ dir }, updateDeps(gh, above));
  assert.equal(r.exitCode, 3, r.text);
  assert.deepEqual(r.data.plans.map(p => [p.repo, p.from, p.to, p.open]), [
    ['acme/notes', BEHIND, above, false], ['acme/ledger', BEHIND, above, false], ['acme/current', CLI, above, false],
    ['acme/waiting', BEHIND, above, false], ['acme/gone', BEHIND, above, false],
  ]);
  let cli = runCmd(process.execPath, [BIN, 'fleet', 'update', '--json'], { cwd: dir, env: { ...gh.env, KEEL_FLEET_PRACTICE: above } });
  assert.equal(cli.status, 3, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout).plans.map(p => p.to), Array(5).fill(above));
  // Far below: no project is behind it, and no migration's release is at or below it, so nothing is planned: each says why.
  r = await fleetUpdate({ dir }, updateDeps(gh, below));
  assert.equal(r.exitCode, 0, r.text);
  assert.deepEqual(r.data.plans, []);
  assert.deepEqual(r.data.resting.map(x => x.repo), ['acme/notes', 'acme/ledger', 'acme/current', 'acme/waiting', 'acme/gone']);
  // Below every migration's release, none is this update's to take (keel update takes only those it carries).
  assert.match(r.text, re(`acme/notes: ahead (${BEHIND}); no migration pending`));
  assert.match(r.text, re(`acme/current: ahead (${CLI}); no migration pending`));
  assert.doesNotMatch(r.text, /→/, 'nothing is behind a version below every project');
  cli = runCmd(process.execPath, [BIN, 'fleet', 'update', '--json'], { cwd: dir, env: { ...gh.env, KEEL_FLEET_PRACTICE: below } });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout).plans, []);
  // A seam that is not a version is a usage error, never a silent fallback to the live one.
  cli = runCmd(process.execPath, [BIN, 'fleet', 'update', '--json'], { cwd: dir, env: { ...gh.env, KEEL_FLEET_PRACTICE: 'banana' } });
  assert.equal(cli.status, 2);
  assert.match(JSON.parse(cli.stdout).error, /KEEL_FLEET_PRACTICE=banana is not a version/);
});

test('fleet update --yes, against the gh stub: one PR per project behind, pushed from a clone; a failure is said and the others go on', async t => {
  const { dir, gh, notes, ledger } = await fleetOfUpdates(t);
  const r = await fleetUpdate({ dir, yes: true }, updateDeps(gh));
  assert.equal(r.exitCode, 1, r.text);
  const by = repo => r.data.results.find(x => x.repo === repo);
  assert.equal(by('acme/notes').pr, `https://github.com/acme/pulls/${UPDATE_BRANCH}`);
  assert.equal(by('acme/ledger').pr, `https://github.com/acme/pulls/${UPDATE_BRANCH}`);
  assert.equal(by('acme/gone').ok, false);
  assert.equal(by('acme/gone').step, 'clone');
  assert.match(by('acme/gone').error, /Could not resolve to a Repository/);
  assert.equal(by('acme/waiting'), undefined, 'an open update PR is not opened twice');
  const calls = await gh.calls();
  const creates = calls.filter(c => c[0] === 'pr' && c[1] === 'create');
  assert.equal(creates.length, 2, 'exactly one PR per project behind');
  assert.deepEqual(calls.filter(c => c[0] === 'repo').map(c => [c[2], c[4], c[5]]), [['acme/notes', '--', '--quiet'], ['acme/ledger', '--', '--quiet'], ['acme/gone', '--', '--quiet']]);
  for (const { origin } of [notes, ledger]) {
    assert.match(git(origin, 'branch', '--list', UPDATE_BRANCH), re(UPDATE_BRANCH), 'the update branch is pushed');
    const config = JSON.parse(git(origin, 'show', `${UPDATE_BRANCH}:.keel/keel.json`));
    assert.equal(config.practice, CLI);
    assert.equal(JSON.parse(git(origin, 'show', 'main:.keel/keel.json')).practice, BEHIND, 'main is untouched: a person merges');
  }
  assert.match(r.text, /acme\/gone: FAILED at clone/);
  assert.match(r.text, re(`acme/waiting: ${UPDATE_BRANCH} is already open`));
});

test('fleet update: a current project whose unrecorded migrations do not apply is not planned, and --yes clones nothing', async t => {
  const live = practiceVersion();
  const quiet = await remoteProject(t, 'quiet', live);
  assert.ok(!JSON.parse(quiet.config).migrations?.length, 'init records no migration');
  const st = { repos: { 'acme/quiet': { default_branch: 'main', files: { '.keel/keel.json': quiet.config } } }, commits: {}, prepared: { 'acme/quiet': quiet.prepared } };
  const dir = await home(t, [{ repo: 'acme/quiet', kind: 'node', role: 'managed' }]);
  const gh = await stubGh(t, st);
  gh.env = { ...gh.env, ...GIT_ENV };
  for (const yes of [false, true]) {
    const r = await fleetUpdate({ dir, yes }, updateDeps(gh, live));
    assert.equal(r.exitCode, 0, r.text);
    assert.deepEqual(r.data.plans, []);
    assert.match(r.text, /Every adopted project is current, with nothing pending\./);
    assert.match(r.text, /acme\/quiet: current; nothing applies \(asked 0001-milestone-to-goal, 0002-projects-run-on-their-own, 0003-phases-gain-goals, 0004-test-ledger, 0005-test-ledger-reach, 0006-lived-in-kept\)/);
  }
  assert.equal((await gh.calls()).filter(c => c[0] === 'repo' || (c[0] === 'pr' && c[1] === 'create')).length, 0, 'nothing cloned, no PR');
});

test('fleet update plans only real work: applies() is asked over the default branch through the contents API', async t => {
  const live = practiceVersion();
  const config = repo => JSON.stringify({ name: 'Acme', repo, practice: live, practices: ['base'] });
  const st = {
    repos: {
      // A ritmo-shaped project: milestones.json, and a phase naming a milestone. 0001 applies.
      'acme/goals': { default_branch: 'main', files: {
        '.keel/keel.json': config('acme/goals'),
        'docs/milestones.json': JSON.stringify([{ id: 'M1', title: 'Start', outcome: 'Acme starts.' }]),
        'docs/phases/1-start.md': '---\nstatus: planned\nmilestone: M1\n---\n# Start\n',
      } },
      // Records nothing, and nothing applies: not planned.
      'acme/still': { default_branch: 'main', files: { '.keel/keel.json': config('acme/still'), 'README.md': '# still' } },
      // .keel/lock.json cannot be read (not a 404): 0002 cannot be asked, so it is possibly pending, with why.
      'acme/broken': { default_branch: 'main', files: { '.keel/keel.json': config('acme/broken') }, failPaths: { '.keel/lock.json': 'HTTP 502: Server Error (https://api.github.com/repos/acme/broken/contents/.keel/lock.json?ref=main)' } },
    },
    commits: {},
  };
  const dir = await home(t, ['goals', 'still', 'broken'].map(n => ({ repo: `acme/${n}`, kind: 'node', role: 'managed' })));
  const gh = await stubGh(t, st);
  const r = await fleetUpdate({ dir }, updateDeps(gh, live));
  assert.equal(r.exitCode, 3, r.text);
  assert.deepEqual(r.data.plans.map(p => [p.repo, p.behind, p.pending, p.possiblyPending.map(x => x.id)]), [
    ['acme/goals', false, ['0001-milestone-to-goal'], []],
    ['acme/broken', false, [], ['0002-projects-run-on-their-own']],
  ]);
  assert.match(r.data.plans[1].possiblyPending[0].why, /\.keel\/lock\.json: HTTP 502/);
  assert.match(r.text, /acme\/goals: "keel update: practice [^"]+, pending migrations" from keel\/update-v[^ ]+ \(pending: 0001-milestone-to-goal\)/);
  assert.match(r.text, /acme\/broken: .*\(possibly pending: 0002-projects-run-on-their-own \(\.keel\/lock\.json: HTTP 502/);
  assert.match(r.text, /Not planned:\n {2}acme\/still: current; nothing applies \(asked 0001-milestone-to-goal, 0002-projects-run-on-their-own, 0003-phases-gain-goals, 0004-test-ledger, 0005-test-ledger-reach, 0006-lived-in-kept\)/);
  const reads = (await gh.calls()).filter(c => String(c[1]).includes('?ref=main'));
  assert.ok(reads.some(c => c[1] === 'repos/acme/goals/contents/docs/phases/1-start.md?ref=main'), 'the phase file is read at the default branch');
  assert.equal(new Set(reads.map(c => c[1])).size, reads.length, 'each path is asked once per run (cached)');
  // Plain fleet stays fast: it lists what is unrecorded and asks nothing at the migrations' paths.
  const before = (await gh.calls()).length;
  const f = await fleet({ dir }, { env: gh.env, now: NOW, cli: live });
  const plain = (await gh.calls()).slice(before);
  assert.deepEqual(plain.filter(c => /\?ref=|contents\/(docs\/milestones\.json|docs\/goals\.json|docs\/phases|\.keel\/lock\.json)/.test(String(c[1]))), []);
  assert.ok(f.data.needs.some(n => n.repo === 'acme/goals' && n.why === '6 unrecorded (0001-milestone-to-goal, 0002-projects-run-on-their-own, 0003-phases-gain-goals, 0004-test-ledger, 0005-test-ledger-reach, 0006-lived-in-kept); keel fleet update checks them'));
});

test('fleet update --yes installs the way the project says: its setup in the gate env; a failing setup is reported and opens nothing', async t => {
  const marks = await scratch(t, 'keel-fleet-marks-');
  const mark = join(marks, 'setup.txt');
  const setup = await remoteProject(t, 'setup', BEHIND, {
    setup: 'pwd > "$ACME_MARK"; echo "ctx=${NODE_TEST_CONTEXT:-none}" >> "$ACME_MARK"', env: { ACME_MARK: mark },
  });
  const failing = await remoteProject(t, 'failing', BEHIND, { setup: 'echo acme-setup-detail; echo acme-setup-err >&2; (exit 7); echo never' });
  const st = {
    repos: {
      'acme/setup': { default_branch: 'main', files: { '.keel/keel.json': setup.config } },
      'acme/failing': { default_branch: 'main', files: { '.keel/keel.json': failing.config } },
    },
    commits: {},
    prepared: { 'acme/setup': setup.prepared, 'acme/failing': failing.prepared },
  };
  const dir = await home(t, [{ repo: 'acme/failing', kind: 'node', role: 'managed' }, { repo: 'acme/setup', kind: 'node', role: 'managed' }]);
  const gh = await stubGh(t, st);
  gh.env = { ...gh.env, ...GIT_ENV, NODE_TEST_CONTEXT: 'child-v8' };
  const r = await fleetUpdate({ dir, yes: true }, updateDeps(gh));
  assert.equal(r.exitCode, 1, r.text);
  const by = repo => r.data.results.find(x => x.repo === repo);
  assert.deepEqual([by('acme/failing').ok, by('acme/failing').step], [false, 'setup']);
  assert.match(by('acme/failing').error, /exit 7/);
  assert.match(by('acme/failing').error, /acme-setup-detail\nacme-setup-err/);
  assert.doesNotMatch(by('acme/failing').error.split(':\n')[1], /never/, 'bash -e: nothing after the failure ran');
  assert.equal(by('acme/setup').pr, `https://github.com/acme/pulls/${UPDATE_BRANCH}`, 'the failing one never stops the next');
  const [cwd, ctx] = (await readFile(mark, 'utf8')).trim().split('\n');
  assert.match(cwd, /keel-fleet-update-[^/]+\/setup$/, 'setup ran in the clone');
  assert.equal(ctx, 'ctx=none', 'the test runner\'s context is stripped');
  assert.equal((await gh.calls()).filter(c => c[0] === 'pr' && c[1] === 'create').length, 1);
  assert.equal(git(failing.origin, 'branch', '--list', UPDATE_BRANCH), '', 'nothing pushed for the failed setup');
  assert.match(r.text, /acme\/failing: FAILED at setup: setup `[^`]+` failed \(exit 7\):\n {6}acme-setup-detail/);
});

test('fleet update --yes: a failed check runs once more on main without the update, and the row says which failed', async t => {
  // Fails on main too: not this update.
  const red = await remoteProject(t, 'red', BEHIND, { check: 'echo acme-red-main; exit 4' });
  // Fails only with the update's files present (its practice bumped to the CLI's): main passes.
  const picky = await remoteProject(t, 'picky', BEHIND, { check: `if grep -q '"practice": "${CLI}"' .keel/keel.json; then echo acme-picky; exit 5; fi` });
  const st = {
    repos: {
      'acme/red': { default_branch: 'main', files: { '.keel/keel.json': red.config } },
      'acme/picky': { default_branch: 'main', files: { '.keel/keel.json': picky.config } },
    },
    commits: {},
    prepared: { 'acme/red': red.prepared, 'acme/picky': picky.prepared },
  };
  const dir = await home(t, [{ repo: 'acme/red', kind: 'node', role: 'managed' }, { repo: 'acme/picky', kind: 'node', role: 'managed' }]);
  const gh = await stubGh(t, st);
  gh.env = { ...gh.env, ...GIT_ENV };
  const r = await fleetUpdate({ dir, yes: true }, updateDeps(gh));
  assert.equal(r.exitCode, 1, r.text);
  const by = repo => r.data.results.find(x => x.repo === repo);
  for (const repo of ['acme/red', 'acme/picky']) {
    assert.deepEqual([by(repo).ok, by(repo).step], [false, 'update']);
    assert.match(by(repo).error, /the project's check failed after the update/);
  }
  assert.deepEqual(by('acme/red').mainCheck.exit, 4);
  assert.match(by('acme/red').error, /\nmain fails the same check without the update \(exit 4\): not this update$/);
  assert.deepEqual(by('acme/picky').mainCheck.exit, 0);
  assert.match(by('acme/picky').error, /\nmain passes without the update: the update, or a test that fails only sometimes$/);
  assert.match(r.text, /acme\/red: FAILED at update: [^]*\n {6}main fails the same check without the update \(exit 4\): not this update/);
  assert.equal((await gh.calls()).filter(c => c[0] === 'pr' && c[1] === 'create').length, 0, 'nothing opened');
});

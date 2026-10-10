import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewRobotIssue, ensureRobotIssue, recoverRobotIssue, robotTargetPolicy } from '../lib/robot-issue.mjs';
import { run } from './helpers/run.mjs';
import { robotPolicy } from '../practices/climb/files/scripts/keel/robot-policy.mjs';
const rubric = { version: 1, problem: 'Acme drops rows.', reproduction: 'Run the Acme regression.', acceptance: 'Both rows survive.', change: 'Fix equality.', prerequisites: [], ownerBlockers: [] };
const work = { repo: 'acme/app', rubric, title: 'Preserve Acme rows', policy: robotPolicy({}), subjectKey: 'acme-sort', instanceId: 'acme-sort-1' };
async function temp(t) { const dir = await mkdtemp(join(tmpdir(), 'keel-robot-issue-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
function remote() {
  const rows = [], calls = [];
  const row = (n, body, extra = {}) => ({ number: n, html_url: `https://github.com/acme/app/issues/${n}`, url: `https://api.github.com/repos/acme/app/issues/${n}`, state: 'open', body, ...extra });
  const github = async req => {
    calls.push(req);
    if (req.method === 'POST') { const item = row(rows.length + 1, req.body.body); rows.push(item); return { status: 201, data: item }; }
    const n = /\/issues\/(\d+)$/.exec(req.path);
    return n ? { status: 200, data: rows.find(r => r.number === Number(n[1])) } : { status: 200, data: rows };
  };
  return { rows, calls, row, github, posts: () => calls.filter(c => c.method === 'POST') };
}

test('robot issue OFF preview is inert; approved creation persists intent before POST and retries recover', async t => {
  const stateDir = await temp(t), api = remote();
  const preview = await ensureRobotIssue({ ...work, stateDir, github: api.github });
  assert.equal(preview.state, 'preview'); assert.deepEqual(preview.preview.labels, []);
  assert.deepEqual(await readdir(stateDir), []); assert.equal(api.calls.length, 0);
  const github = async req => {
    if (req.method === 'POST') {
      const [dir] = await readdir(stateDir);
      const intents = (await readdir(join(stateDir, dir))).filter(f => f.endsWith('.json') && !f.startsWith('subject-'));
      assert.equal(intents.length, 1);
      assert.equal(JSON.parse(await readFile(join(stateDir, dir, intents[0]), 'utf8')).state, 'attempted');
    }
    return api.github(req);
  };
  const created = await ensureRobotIssue({ ...work, stateDir, github, yes: true });
  assert.equal(created.state, 'created'); assert.equal(created.issue.number, 1);
  assert.deepEqual(api.posts()[0].body.labels, []);
  const recovered = await ensureRobotIssue({ ...work, stateDir, github, yes: true });
  assert.equal(recovered.state, 'recovered'); assert.deepEqual(recovered.issue, created.issue); assert.equal(api.posts().length, 1);
  api.rows[0].state = 'closed';
  assert.equal((await recoverRobotIssue({ ...work, stateDir, github })).state, 'recovered');
  const changed = await ensureRobotIssue({ ...work, title: 'Different Acme work', stateDir, github, yes: true });
  assert.equal(changed.state, 'blocked'); assert.equal(api.posts().length, 1);
});

test('robot issue ambiguous POST recovers only by exact marker and never duplicates absent or multiple results', async t => {
  for (const mode of ['landed', 'absent', 'multiple', 'wrong-repo', 'wrong-marker']) {
    const stateDir = join(await temp(t), mode), api = remote();
    const github = async req => {
      if (req.method === 'POST') {
        if (mode !== 'absent') await api.github(req); else api.calls.push(req);
        if (mode === 'multiple') api.rows.push(api.row(2, api.rows[0].body));
        if (mode === 'wrong-repo') api.rows[0].html_url = 'https://github.com/acme/other/issues/1';
        if (mode === 'wrong-marker') api.rows[0].body = 'Acme unrelated';
        throw new Error('Acme transport lost');
      }
      return api.github(req);
    };
    const first = await ensureRobotIssue({ ...work, stateDir, github, yes: true });
    assert.equal(first.state, mode === 'landed' ? 'recovered' : ['absent', 'wrong-marker'].includes(mode) ? 'pending' : 'ambiguous', mode);
    const again = await ensureRobotIssue({ ...work, stateDir, github, yes: true });
    assert.equal(again.state, first.state, mode); assert.equal(api.posts().length, 1, mode);
    assert.equal(!!again.issue, mode === 'landed');
  }
});

test('robot issue concurrent creators serialize and uncertain subjects cannot switch instances', async t => {
  const stateDir = await temp(t), api = remote();
  let resume, reached;
  const ready = new Promise(r => { reached = r; }), wait = new Promise(r => { resume = r; });
  const github = async req => { if (req.method === 'POST') { reached(); await wait; throw new Error('Acme lost response'); } return api.github(req); };
  const first = ensureRobotIssue({ ...work, stateDir, github, yes: true });
  await Promise.race([ready, first.then(value => { throw new Error(`Acme writer exited before POST: ${value.state}`); })]);
  const concurrent = await ensureRobotIssue({ ...work, stateDir, github, yes: true });
  assert.equal(concurrent.state, 'pending'); resume(); assert.equal((await first).state, 'pending');
  const other = await ensureRobotIssue({ ...work, instanceId: 'acme-sort-2', stateDir, github: api.github, yes: true });
  assert.equal(other.state, 'pending'); assert.equal(api.posts().length, 0);
});

test('robot issue active remote subject conflicts, bounded coverage and invalid storage block before writes', async t => {
  const api = remote(), p = previewRobotIssue(work);
  api.rows.push(api.row(1, p.body));
  assert.equal((await ensureRobotIssue({ ...work, instanceId: 'acme-second', yes: true, stateDir: await temp(t), github: api.github })).state, 'blocked');
  const full = async req => ({ status: 200, data: Array.from({ length: 100 }, (_, i) => api.row(i + 1, 'Acme unrelated')) });
  assert.equal((await ensureRobotIssue({ ...work, yes: true, stateDir: await temp(t), github: full })).state, 'blocked');
  const file = join(await temp(t), 'not-a-directory'); await writeFile(file, 'Acme');
  assert.equal((await ensureRobotIssue({ ...work, yes: true, stateDir: file, github: api.github })).state, 'blocked');
  assert.equal(api.posts().length, 0);
});

test('robot issue policy rejects unknown foreign target and never borrows local enabled policy', async t => {
  const root = await temp(t); await mkdir(join(root, '.keel')); await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ repo: 'acme/home', robot: { on: true, budgetMinutes: 10 } }));
  let reads = 0;
  const unknown = await robotTargetPolicy({ root, repo: 'acme/foreign', github: async () => { reads++; return { status: 404 }; } });
  assert.equal(unknown.valid, false); assert.equal(reads, 1);
  assert.equal(previewRobotIssue({ ...work, policy: unknown }).ok, false);
  const off = await robotTargetPolicy({ root, repo: 'acme/foreign', github: async () => ({ status: 200, data: { path: '.keel/keel.json', encoding: 'base64', content: Buffer.from('{}').toString('base64') } }) });
  assert.deepEqual(previewRobotIssue({ ...work, policy: off }).labels, []);
  assert.deepEqual(previewRobotIssue({ ...work, policy: robotPolicy({ robot: { on: true, budgetMinutes: 10 } }) }).labels, ['keel:agent']);
  for (const edit of [{ repo: '../app' }, { instanceId: '../acme' }, { subjectKey: '' }, { title: '<!-- forged -->' }, { policy: { valid: true } }]) assert.equal(previewRobotIssue({ ...work, ...edit }).ok, false);
});

test('robot issue read-back mismatch and malformed durable intent never claim creation', async t => {
  const stateDir = await temp(t), api = remote();
  const github = async req => { const res = await api.github(req); if (/\/issues\/1$/.test(req.path)) return { status: 200, data: { ...res.data, number: 2 } }; return res; };
  const got = await ensureRobotIssue({ ...work, stateDir, github, yes: true });
  assert.equal(got.state, 'ambiguous'); assert.equal(got.issue, null);
  const [dir] = await readdir(stateDir), file = (await readdir(join(stateDir, dir))).find(f => f.endsWith('.json') && !f.startsWith('subject-'));
  await writeFile(join(stateDir, dir, file), '{');
  assert.equal((await recoverRobotIssue({ ...work, stateDir, github })).state, 'blocked');
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github, yes: true })).state, 'blocked');
  assert.equal(api.posts().length, 1);
});

test('robot issue positively closed prior subject permits a new instance but original still recovers', async t => {
  const stateDir = await temp(t), api = remote();
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'created');
  api.rows[0].state = 'closed';
  const next = await ensureRobotIssue({ ...work, instanceId: 'acme-sort-2', rubric: { ...rubric, change: 'Fix a newly found Acme boundary.' }, stateDir, github: api.github, yes: true });
  assert.equal(next.state, 'created'); assert.equal(next.issue.number, 2);
  assert.equal((await recoverRobotIssue({ ...work, stateDir, github: api.github })).issue.number, 1);
});

test('robot issue failed final journal persistence returns verified remote recovery and never blind retry', async t => {
  const stateDir = await temp(t), api = remote();
  const github = async req => {
    const response = await api.github(req);
    if (req.method === 'POST') {
      const [dir] = await readdir(stateDir), file = (await readdir(join(stateDir, dir))).find(f => f.endsWith('.json') && !f.startsWith('subject-'));
      // Deterministic rename failure, even under privileged hosts. No permission assumption.
      await rm(join(stateDir, dir, file)); await mkdir(join(stateDir, dir, file));
    }
    return response;
  };
  const got = await ensureRobotIssue({ ...work, stateDir, github, yes: true });
  assert.equal(got.state, 'recovered'); assert.equal(got.issue.number, 1);
  const again = await ensureRobotIssue({ ...work, stateDir, github, yes: true });
  assert.equal(again.state, 'blocked'); assert.equal(api.posts().length, 1);
});

test('robot issue recovery reads exact instance while a stale writer lock remains', async t => {
  const stateDir = await temp(t), api = remote();
  const got = await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true });
  const [dir] = await readdir(stateDir); await mkdir(join(stateDir, dir, 'writer.lock'));
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'recovered');
  assert.deepEqual((await recoverRobotIssue({ ...work, stateDir, github: api.github })).issue, got.issue);
  assert.equal(api.posts().length, 1);
});

// Fail actual atomic persistence before rename, without depending on host permissions.
async function failSave(t, wanted, afterRename = false) {
  const fs = (await import('node:fs/promises')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const original = fs.rename;
  let hits = 0;
  const mocked = t.mock.method(fs, 'rename', async (from, to) => {
    const value = JSON.parse(await readFile(from, 'utf8'));
    if (wanted(value, to)) { hits++; if (afterRename) await original(from, to); throw Object.assign(new Error('Acme storage fault'), { code: 'EIO' }); }
    return original(from, to);
  });
  syncBuiltinESMExports();
  const restore = () => { mocked.mock.restore(); syncBuiltinESMExports(); };
  t.after(restore);
  return { hits: () => hits, restore };
}

test('robot issue initial intent persistence failure leaves no orphan reservation and safely retries', async t => {
  const stateDir = await temp(t), api = remote();
  const fault = await failSave(t, value => value.state === 'prepared');
  const first = await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true });
  assert.equal(first.state, 'blocked'); assert.equal(fault.hits(), 1); assert.equal(api.posts().length, 0);
  const [dir] = await readdir(stateDir);
  assert.deepEqual(await readdir(join(stateDir, dir)), ['.gitignore'], 'failed first intent leaves no reservation');
  fault.restore();
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'created');
  assert.equal(api.posts().length, 1);
});

test('robot issue prepared to attempted persistence failure resumes only matching work after complete lookup', async t => {
  const stateDir = await temp(t), api = remote();
  const fault = await failSave(t, value => value.state === 'attempted');
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'blocked');
  assert.equal(fault.hits(), 1); assert.equal(api.posts().length, 0); fault.restore();
  const [dir] = await readdir(stateDir), file = (await readdir(join(stateDir, dir))).find(f => f.endsWith('.json') && !f.startsWith('subject-'));
  assert.equal(JSON.parse(await readFile(join(stateDir, dir, file), 'utf8')).state, 'prepared');
  assert.equal((await ensureRobotIssue({ ...work, title: 'Different Acme task', stateDir, github: api.github, yes: true })).state, 'blocked');
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github: async () => ({ status: 503 }), yes: true })).state, 'blocked');
  assert.equal(api.posts().length, 0);
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'created');
  assert.equal(api.posts().length, 1);
});

test('robot issue process restart reclaims a proven-dead writer lock and resumes prepared intent once', async t => {
  const stateDir = await temp(t);
  const moduleUrl = new URL('../lib/robot-issue.mjs', import.meta.url).href;
  // Exit the actual writer at the durable prepared boundary: no finally cleanup,
  // and no test deletes its lock. A second process must reclaim the orphan itself.
  const stoppedWriter = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    import {ensureRobotIssue} from ${JSON.stringify(moduleUrl)};
    const rename = fs.rename;
    fs.rename = async (from,to) => {
      const data = JSON.parse(await fs.readFile(from,'utf8'));
      if (data.state === 'attempted') process.exit(0);
      return rename(from,to);
    };
    syncBuiltinESMExports();
    const github = async ({method}) => { if (method === 'POST') process.exit(91); return {status:200,data:[]}; };
    await ensureRobotIssue({...${JSON.stringify({ ...work, stateDir, yes: true })},github});
    process.exit(92);
  `;
  const stopped = run(process.execPath, ['--input-type=module', '-e', stoppedWriter], { timeout: 10000 });
  assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
  const [dir] = await readdir(stateDir);
  const owner = JSON.parse(await readFile(join(stateDir, dir, 'writer.lock/owner.json'), 'utf8'));
  assert.throws(() => process.kill(owner.pid, 0), { code: 'ESRCH' });
  const intent = (await readdir(join(stateDir, dir))).find(f => f.endsWith('.json') && !f.startsWith('subject-'));
  assert.equal(JSON.parse(await readFile(join(stateDir, dir, intent), 'utf8')).state, 'prepared');
  const script = `
    import {ensureRobotIssue} from ${JSON.stringify(moduleUrl)};
    const rows = []; let posts = 0;
    const github = async ({method,path,body}) => {
      if (method === 'POST') { posts++; rows.push({number:1,state:'open',body:body.body,html_url:'https://github.com/acme/app/issues/1',url:'https://api.github.com/repos/acme/app/issues/1'}); return {status:201,data:rows[0]}; }
      return {status:200,data:path.endsWith('/issues/1') ? rows[0] : rows};
    };
    const args = ${JSON.stringify({ ...work, stateDir, yes: true })};
    const created = await ensureRobotIssue({...args,github});
    const retried = await ensureRobotIssue({...args,github});
    console.log(JSON.stringify({created,retried,posts}));
  `;
  const restarted = run(process.execPath, ['--input-type=module', '-e', script], { timeout: 10000 });
  assert.equal(restarted.status, 0, restarted.stdout + restarted.stderr);
  const got = JSON.parse(restarted.stdout);
  assert.equal(got.created.state, 'created'); assert.equal(got.retried.state, 'recovered'); assert.equal(got.posts, 1);
});


test('robot issue failed persistence after attempted rename remains uncertain and never retries POST', async t => {
  const stateDir = await temp(t), api = remote();
  const fault = await failSave(t, value => value.state === 'attempted', true);
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'blocked');
  assert.equal(fault.hits(), 1); fault.restore();
  const [dir] = await readdir(stateDir), file = (await readdir(join(stateDir, dir))).find(f => f.endsWith('.json') && !f.startsWith('subject-'));
  assert.equal(JSON.parse(await readFile(join(stateDir, dir, file), 'utf8')).state, 'attempted');
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'pending');
  assert.equal(api.posts().length, 0);
});


test('robot issue prepared intent never steals active foreign or unknown writer locks', async t => {
  const { hostname } = await import('node:os');
  const { randomUUID } = await import('node:crypto');
  for (const owner of [{ version: 1, host: hostname(), pid: process.pid, token: randomUUID() }, { version: 1, host: 'acme-other-host', pid: process.pid, token: randomUUID() }, null]) {
    const stateDir = await temp(t), api = remote();
    const fault = await failSave(t, value => value.state === 'attempted');
    assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'blocked');
    assert.equal(fault.hits(), 1); fault.restore();
    const [dir] = await readdir(stateDir), lock = join(stateDir, dir, 'writer.lock');
    await mkdir(lock);
    if (owner) await writeFile(join(lock, 'owner.json'), JSON.stringify(owner));
    const before = await readdir(lock);
    assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'pending');
    assert.deepEqual(await readdir(lock), before);
    if (owner) assert.deepEqual(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')), owner);
    assert.equal(api.posts().length, 0);
  }
});

test('robot issue concurrent orphan lock reclaimers permit at most one POST', async t => {
  const stateDir = await temp(t), api = remote();
  const fault = await failSave(t, value => value.state === 'attempted');
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'blocked');
  fault.restore();
  const { hostname } = await import('node:os');
  const { randomUUID } = await import('node:crypto');
  const child = run(process.execPath, ['-e', 'console.log(process.pid)'], { timeout: 10000 });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const pid = Number(child.stdout);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  const [dir] = await readdir(stateDir), lock = join(stateDir, dir, 'writer.lock');
  await mkdir(lock); await writeFile(join(lock, 'owner.json'), JSON.stringify({ version: 1, host: hostname(), pid, token: randomUUID() }));
  const results = await Promise.all(Array.from({ length: 4 }, () => ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })));
  assert.equal(results.filter(r => r.state === 'created').length, 1);
  assert.equal(api.posts().length, 1);
  assert.ok(results.every(r => ['created', 'recovered', 'pending'].includes(r.state)), JSON.stringify(results.map(r => r.state)));
});


test('robot issue private intents self-ignore in default and custom state directories without changing human files', async t => {
  const { execFileSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const repoDir = createHash('sha256').update(JSON.stringify(work.repo)).digest('hex');
  for (const relativeDir of ['.keel/robot-issues', 'acme-notes/private-intents']) {
    const root = await temp(t), stateDir = join(root, relativeDir), owned = join(stateDir, repoDir), api = remote();
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    git(['init', '-q']);
    const parentIgnore = '# Acme human rules\n*.log\n';
    await writeFile(join(root, '.gitignore'), parentIgnore);
    await mkdir(owned, { recursive: true });
    await writeFile(join(stateDir, 'human.md'), 'Acme private notes stay unchanged.');
    await writeFile(join(owned, 'human.txt'), 'Acme existing file stays unchanged.');
    const result = await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true });
    assert.equal(result.state, 'created');
    assert.equal(await readFile(join(owned, '.gitignore'), 'utf8'), '*\n');
    assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), parentIgnore);
    assert.equal(await readFile(join(owned, 'human.txt'), 'utf8'), 'Acme existing file stays unchanged.');
    assert.equal(await readFile(join(stateDir, 'human.md'), 'utf8'), 'Acme private notes stay unchanged.');
    const files = await readdir(owned);
    assert.ok(files.some(f => f.startsWith('subject-')));
    for (const file of files) {
      const path = `${relativeDir}/${repoDir}/${file}`;
      assert.match(git(['check-ignore', '-v', '--', path]), /\.gitignore:1:\*/);
    }
    const status = git(['status', '--porcelain', '--untracked-files=all']);
    assert.equal(status.includes(repoDir), false, status);
    assert.ok(status.includes(`${relativeDir}/human.md`), 'parent human files remain visible');
    assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'recovered');
  }
});

test('robot issue preserves existing ignore files and blocks writes when they expose private intents', async t => {
  const { createHash } = await import('node:crypto');
  const repoDir = createHash('sha256').update(JSON.stringify(work.repo)).digest('hex');
  for (const ignore of ['# Acme comment\n*\n', '# Acme human exception\n*\n!*.json\n']) {
    const stateDir = await temp(t), api = remote(), owned = join(stateDir, repoDir);
    await mkdir(owned); await writeFile(join(owned, '.gitignore'), ignore);
    const result = await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true });
    assert.equal(result.state, ignore.includes('!') ? 'blocked' : 'created');
    assert.equal(await readFile(join(owned, '.gitignore'), 'utf8'), ignore);
    assert.equal(api.posts().length, ignore.includes('!') ? 0 : 1);
    if (ignore.includes('!')) assert.deepEqual(await readdir(owned), ['.gitignore']);
  }
});

test('robot issue nullable bodies allow unrelated issues but never replace exact marker read-back', async t => {
  const stateDir = await temp(t), api = remote();
  api.rows.push(api.row(1, null), api.row(2, null, { state: 'closed' }));
  const created = await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true });
  assert.equal(created.state, 'created', 'unrelated null bodies must not block creation');
  assert.equal(created.issue.number, 3);
  const recovered = await recoverRobotIssue({ ...work, stateDir, github: api.github });
  assert.equal(recovered.state, 'recovered'); assert.deepEqual(recovered.issue, created.issue);
  assert.equal((await ensureRobotIssue({ ...work, stateDir, github: api.github, yes: true })).state, 'recovered');
  assert.equal(api.posts().length, 1);
  // A list match cannot stand in for exact identity on the issue GET.
  for (const body of [null, '', undefined, 42, {}]) {
    const github = async req => {
      const response = await api.github(req);
      return req.path.endsWith('/issues/3') ? { ...response, data: { ...response.data, body } } : response;
    };
    const unverified = await recoverRobotIssue({ ...work, stateDir, github });
    assert.equal(unverified.state, 'ambiguous'); assert.equal(unverified.issue, null);
  }
  // Only null extends the API shape; malformed unrelated rows still fail closed.
  for (const body of [undefined, 42, {}]) {
    const malformed = remote(); malformed.rows.push(malformed.row(1, body));
    const refused = await ensureRobotIssue({ ...work, stateDir: await temp(t), github: malformed.github, yes: true });
    assert.equal(refused.state, 'blocked'); assert.equal(malformed.posts().length, 0);
  }
});

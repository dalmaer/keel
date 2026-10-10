// Agent issue authoring, never agent execution. A durable intent precedes POST.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { validateRobotRubric, formatRobotRubric } from '../practices/climb/files/scripts/keel/robot-rubric.mjs';
import { robotPolicy, robotIssueLabels } from '../practices/climb/files/scripts/keel/robot-policy.mjs';
import { robotGithub, robotRepo } from '../practices/climb/files/scripts/keel/robot-delivery.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const instanceOK = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const canonical = repo => robotRepo(repo) ? repo.toLowerCase() : null;
const result = (state, preview = null, reasons = [], issue = null) => ({ state, issue, preview, reasons });
const markOf = ({ repo, instanceId, subjectKey }) => `<!-- keel:robot-issue ${JSON.stringify({ version: 1, repo, instanceId, subject: hash(subjectKey) })} -->`;
const markerIn = body => {
  const marks = [...String(body ?? '').matchAll(/^<!-- keel:robot-issue (.+) -->$/gm)];
  if (marks.length !== 1) return null;
  try {
    const m = JSON.parse(marks[0][1]);
    if (m.version !== 1 || canonical(m.repo) !== m.repo || !instanceOK(m.instanceId) || !/^[a-f0-9]{64}$/.test(m.subject)) return null;
    return { ...m, marker: marks[0][0] };
  } catch { return null; }
};
export function previewRobotIssue({ repo, rubric, policy, subjectKey, instanceId, title = 'Agent task' }) {
  repo = canonical(repo);
  const checked = validateRobotRubric(rubric), problems = [...checked.problems];
  const bad = (field, message) => problems.push({ field, code: 'invalid', message });
  if (!repo) bad('repo', 'target repository must be owner/name');
  if (!instanceOK(instanceId)) bad('instanceId', 'instanceId needs 1–128 letters, digits, underscores or hyphens');
  if (typeof subjectKey !== 'string' || !subjectKey.trim() || subjectKey.length > 500 || /[\x00-\x1f]/.test(subjectKey)) bad('subjectKey', 'a bounded stable subjectKey is required');
  if (typeof title !== 'string' || !title.trim() || title.length > 240 || /[\x00-\x1f<>]/.test(title)) bad('title', 'title needs 1–240 characters without controls or markup');
  if (policy?.valid !== true || typeof policy.enabled !== 'boolean' || (policy.enabled && !(Number.isFinite(policy.weeklyMinutes) && policy.weeklyMinutes > 0))) bad('policy', 'trusted target robot policy is unavailable or invalid');
  if (problems.length) return { ok: false, title: null, body: null, labels: [], marker: null, problems };
  const marker = markOf({ repo, instanceId, subjectKey });
  return { ok: true, title: title.trim(), body: `${formatRobotRubric(checked.rubric)}\n\n${marker}\n`, labels: robotIssueLabels(policy), marker, problems: [] };
}
const previewOnly = p => ({ title: p.title, body: p.body, labels: p.labels, marker: p.marker });
const location = (stateDir, repo) => join(resolve(stateDir), hash(repo));
const fileOf = (dir, instanceId) => join(dir, `${hash(instanceId)}.json`);
async function readIntent(file) {
  try {
    const raw = await readFile(file, 'utf8');
    if (raw.length > 100000) throw new Error();
    const intent = JSON.parse(raw);
    if (intent.version !== 1 || !['prepared', 'attempted', 'verified'].includes(intent.state) || canonical(intent.repo) !== intent.repo || !instanceOK(intent.instanceId)) throw new Error();
    const p = previewRobotIssue(intent);
    if (!p.ok || JSON.stringify(previewOnly(p)) !== JSON.stringify(intent.preview)) throw new Error();
    return intent;
  } catch (e) { if (e.code === 'ENOENT') return null; throw new Error('durable issue intent is unreadable or invalid'); }
}
async function saveIntent(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
    await handle.close(); handle = null;
    await rename(temp, file);
    // The renamed intent must survive a crash before a remote write starts.
    // Node cannot open directories for fsync on Windows; the file itself is synced above.
    if (process.platform !== 'win32') {
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await handle?.close(); await rm(temp, { force: true }); }
}
// Only a same-host ESRCH proves an owner dead. EPERM, PID reuse (alive),
// missing metadata and another host all remain unknown; never use a timeout.
const ownerFile = lock => join(lock, 'owner.json');
async function lockOwner(lock) {
  try {
    const owner = JSON.parse(await readFile(ownerFile(lock), 'utf8'));
    return owner.version === 1 && typeof owner.host === 'string' && Number.isSafeInteger(owner.pid) && owner.pid > 0 && /^[a-f0-9-]{36}$/.test(owner.token) ? owner : null;
  } catch { return null; }
}
function dead(owner) {
  if (!owner || owner.host !== hostname() || owner.pid === process.pid) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (e) { return e.code === 'ESRCH'; }
}
async function takeLock(lock) {
  try { await mkdir(lock); return true; }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  const owner = await lockOwner(lock);
  if (!dead(owner)) return false;
  // One reaper owns this dead lock. A second reaper cannot race our rename
  // and remove a new writer's lock after checking the old writer's PID.
  const reaper = join(lock, `reaper-${owner.token}.lock`);
  try { await mkdir(reaper); } catch { return false; }
  let moved = false;
  try {
    const current = await lockOwner(lock);
    if (current?.token !== owner.token || !dead(current)) return false;
    const orphan = `${lock}.orphan-${owner.token}`;
    await rename(lock, orphan); moved = true;
    await rm(orphan, { recursive: true, force: true });
    try { await mkdir(lock); return true; }
    catch (e) { if (e.code === 'EEXIST') return false; throw e; }
  } finally {
    if (!moved && (await lockOwner(lock))?.token === owner.token) await rm(reaper, { recursive: true, force: true });
  }
}
const sameWork = (prior, { repo, instanceId, subjectKey, preview, rubric }) => prior.repo === repo && prior.instanceId === instanceId && prior.subjectKey === subjectKey && prior.preview.title === preview.title && JSON.stringify(prior.rubric) === JSON.stringify(validateRobotRubric(rubric).rubric);
// Only this repo-hash directory is ours. Never change a parent's ignore rules
// or overwrite an existing file. Refuse private writes if existing rules could
// expose them; comments and the blanket rule are the only accepted contents.
async function ignoreIntents(dir) {
  const file = join(dir, '.gitignore');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (!(await lstat(file)).isFile()) throw new Error('intent ignore is not a regular file');
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    if (!lines.includes('*') || lines.some(line => line !== '*' && line.trim() && !line.startsWith('#'))) throw new Error('existing intent ignore does not protect all private records');
    return;
  }
  try { await handle.writeFile('*\n'); await handle.sync(); }
  finally { await handle.close(); }
}
function identity(row, repo, number) {
  if (!row || row.pull_request || !Number.isSafeInteger(row.number) || row.number < 1 || (number && row.number !== number) || row.html_url?.toLowerCase() !== `https://github.com/${repo}/issues/${row.number}` || row.url?.toLowerCase() !== `https://api.github.com/repos/${repo}/issues/${row.number}` || !['open', 'closed'].includes(row.state) || (row.body !== null && typeof row.body !== 'string')) throw new Error('issue read-back identity unavailable');
  return { repo, number: row.number, url: row.html_url };
}
async function readBack(github, repo, number, marker) {
  const r = await github({ method: 'GET', path: `/repos/${repo}/issues/${number}` });
  if (r?.status !== 200) throw new Error('issue read-back unavailable');
  const issue = identity(r.data, repo, number);
  if (markerIn(r.data.body)?.marker !== marker) throw new Error('issue read-back marker differs');
  return issue;
}
// All states, bounded and complete: a loose search hit never proves identity.
async function lookup(github, intent) {
  const matches = [], conflicts = [];
  for (let page = 1; page <= 5; page++) {
    const r = await github({ method: 'GET', path: `/repos/${intent.repo}/issues?state=all&per_page=100&page=${page}` });
    if (r?.status !== 200 || !Array.isArray(r.data) || r.data.length > 100) throw new Error('issue lookup unavailable');
    for (const row of r.data) {
      if (row.pull_request) continue;
      identity(row, intent.repo);
      const marker = markerIn(row.body);
      if (marker?.repo !== intent.repo) continue;
      if (marker.instanceId === intent.instanceId) {
        if (marker.marker !== intent.preview.marker) throw new Error('instance is already associated with different work');
        matches.push(row.number);
      } else if (marker.subject === hash(intent.subjectKey) && row.state === 'open') conflicts.push(row.number);
    }
    if (r.data.length < 100 && !/rel="next"/.test(r.headers?.link ?? '')) return { matches: [...new Set(matches)], conflicts: [...new Set(conflicts)] };
  }
  throw new Error('issue lookup coverage incomplete (500 issues maximum)');
}
async function recover(intent, github) {
  const p = intent.preview;
  try {
    const found = await lookup(github, intent);
    if (found.matches.length > 1) return result('ambiguous', p, ['multiple issues carry this exact instance']);
    if (found.matches.length === 1) return result('recovered', p, [], await readBack(github, intent.repo, found.matches[0], p.marker));
    if (found.conflicts.length) return result('blocked', p, ['another open issue already owns this subject']);
    return result('pending', p, ['no verified issue found; an uncertain write must not be repeated']);
  } catch { return result('ambiguous', p, ['issue lookup/read-back unavailable or identity inconsistent; no write retried']); }
}
export async function recoverRobotIssue({ repo, instanceId, stateDir, github = robotGithub }) {
  repo = canonical(repo);
  if (!repo || !instanceOK(instanceId) || typeof stateDir !== 'string' || !stateDir) return result('blocked', null, ['repo, instanceId and explicit stateDir are required']);
  try {
    const intent = await readIntent(fileOf(location(stateDir, repo), instanceId));
    if (!intent || intent.repo !== repo || intent.instanceId !== instanceId) return result('blocked', null, ['matching durable intent is unavailable']);
    // Recovery reads only, even when a crashed writer left a serialization lock.
    return await recover(intent, github);
  } catch { return result('blocked', null, ['durable issue intent is unreadable or invalid']); }
}
export async function ensureRobotIssue({ repo, rubric, policy, subjectKey, instanceId, title = 'Agent task', yes = false, stateDir, github = robotGithub }) {
  repo = canonical(repo);
  const made = previewRobotIssue({ repo, rubric, policy, subjectKey, instanceId, title });
  if (!made.ok) return result('blocked', null, made.problems.map(p => `${p.field}: ${p.message}`));
  const preview = previewOnly(made);
  if (!yes) return result('preview', preview);
  if (typeof stateDir !== 'string' || !stateDir) return result('blocked', preview, ['explicit durable stateDir is required']);
  const dir = location(stateDir, repo), lock = join(dir, 'writer.lock'), file = fileOf(dir, instanceId);
  let locked = false;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    locked = await takeLock(lock);
    if (!locked) {
      const busyIntent = await readIntent(file);
      if (busyIntent && sameWork(busyIntent, { repo, instanceId, subjectKey, preview, rubric })) return await recover(busyIntent, github);
      return result(busyIntent ? 'blocked' : 'pending', preview, ['issue writer busy or ownership unknown; no lock stolen and no POST attempted']);
    }
    await ignoreIntents(dir);
    await saveIntent(ownerFile(lock), { version: 1, host: hostname(), pid: process.pid, token: randomUUID() });
    const prior = await readIntent(file);
    if (prior) {
      if (!sameWork(prior, { repo, instanceId, subjectKey, preview, rubric })) return result('blocked', preview, ['instance already belongs to different work']);
      // Only prepared proves POST has not been attempted. All later states are read-only recovery.
      if (prior.state !== 'prepared') return await recover(prior, github);
    }
    let intent = { version: 1, repo, instanceId, subjectKey, title: made.title, rubric: validateRobotRubric(rubric).rubric, policy, preview, state: 'prepared' };
    const found = await lookup(github, intent);
    if (found.matches.length) return prior ? await recover(prior, github) : result('ambiguous', preview, ['remote instance exists without its matching local intent; restore the intent before recovery']);
    if (found.conflicts.length) return result('blocked', preview, ['another open issue already owns this subject']);
    // Persist prepared FIRST: failure cannot leave a reservation without its intent.
    // Current trusted policy may refresh an unattempted intent; nothing is relabelled.
    await saveIntent(file, intent);
    const subjectFile = join(dir, `subject-${hash(subjectKey)}.json`);
    let reserved = null;
    try { reserved = JSON.parse(await readFile(subjectFile, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (reserved) {
      if (reserved.repo !== repo || reserved.subjectKey !== subjectKey || !instanceOK(reserved.instanceId)) throw new Error('invalid subject reservation');
      if (reserved.instanceId !== instanceId) {
        // A completed, positively closed issue frees its subject, never an unknown write.
        const old = await readIntent(fileOf(dir, reserved.instanceId));
        if (!old || old.repo !== repo || old.subjectKey !== subjectKey || old.instanceId !== reserved.instanceId) throw new Error('subject intent unavailable');
        const previous = await recover(old, github);
        if (!previous.issue) return result('pending', preview, ['subject has an uncertain durable intent; recover it before creating another']);
        const read = await github({ method: 'GET', path: `/repos/${repo}/issues/${previous.issue.number}` });
        if (read?.status !== 200) throw new Error('previous subject issue unavailable');
        identity(read.data, repo, previous.issue.number);
        if (markerIn(read.data.body)?.marker !== old.preview.marker || read.data.state !== 'closed') return result('blocked', preview, ['another issue still owns this subject']);
      }
    }
    // The repository lock serializes reservations. Atomic replacement also makes a
    // failed reservation write resumable from the prepared intent, without partial JSON.
    await saveIntent(subjectFile, { repo, subjectKey, instanceId });
    intent = { ...intent, state: 'attempted' };
    await saveIntent(file, intent);
    try {
      const posted = await github({ method: 'POST', path: `/repos/${repo}/issues`, body: { title: preview.title, body: preview.body, labels: preview.labels } });
      if (posted?.status !== 201) return await recover(intent, github);
      const candidate = identity(posted.data, repo);
      const issue = await readBack(github, repo, candidate.number, preview.marker);
      await saveIntent(file, { ...intent, state: 'verified', issue });
      return result('created', preview, [], issue);
    } catch { return await recover(intent, github); }
  } catch { return result('blocked', preview, ['durable intent storage or complete issue lookup unavailable; no new issue confirmed']); }
  finally { if (locked) await rm(lock, { recursive: true, force: true }); }
}

// Public callers establish target policy here. A foreign repo never borrows local opt-in.
export async function robotTargetPolicy({ root, repo, github = robotGithub }) {
  repo = canonical(repo);
  if (!repo) return robotPolicy(null);
  try {
    if (root) {
      const local = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
      if (canonical(local?.repo) === repo) return robotPolicy(local);
    }
    const r = await github({ method: 'GET', path: `/repos/${repo}/contents/.keel/keel.json` });
    if (r?.status !== 200 || r.data?.encoding !== 'base64' || r.data?.path !== '.keel/keel.json' || typeof r.data?.content !== 'string' || r.data.content.length > 1000000) return robotPolicy(null);
    return robotPolicy(JSON.parse(Buffer.from(r.data.content, 'base64').toString('utf8')));
  } catch { return robotPolicy(null); }
}
export async function robotRubricFile(file) {
  try {
    const raw = await readFile(file, 'utf8');
    if (raw.length > 60000) throw new Error();
    return JSON.parse(raw);
  } catch { const error = new Error('rubric must be a readable bounded JSON file'); error.exitCode = 2; throw error; }
}
export const robotIssueInstance = (...parts) => hash(parts);
export function robotIssueOutput(data) {
  return { data, exitCode: data.state === 'preview' ? 3 : ['created', 'recovered'].includes(data.state) ? 0 : 2,
    text: data.issue ? `${data.state}: ${data.issue.url}` : data.preview ? `${data.state}: ${data.preview.title}\nLabels: ${data.preview.labels.join(', ') || 'none (robot OFF)'}\n\n${data.preview.body}\n${data.reasons.join('; ')}` : data.reasons.join('; ') };
}

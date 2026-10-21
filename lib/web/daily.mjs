import { requestJson, record, WebError } from './common.mjs';
import { createDecisionGitHub, gitBlob, sourcePath } from './decision-github.mjs';
import { healthDirOf } from '../../practices/night/files/scripts/plates/lib.mjs';
import { DAILY_LIMITS, dailyDate, dailyModel, draftProblems, dailyBudget, dailyCapabilities, planRecord, sourceUrl, measurement, validateDraftInput } from './daily-model.mjs';
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const utf8 = value => new TextDecoder('utf-8', { fatal: true }).decode(value);
const denied = error => [401, 404].includes(error.status);
const authorize = (access, project) => {
  if (!access?.projects?.some(p => p.id === project.id && p.repoId === project.repoId && p.repo === project.repo)) throw new WebError('access_denied', 404);
};

export function createDaily(config, { fetcher = fetch, now = Date.now } = {}) {
  async function current(access, token, project, date) {
    authorize(access, project);
    date ??= new Date(now()).toISOString().slice(0, 10);
    if (!dailyDate(date)) throw new WebError('invalid_daily_date', 400);
    const signal = AbortSignal.timeout(25000), cache = new Map();
    let requests = 0, files = 0, bytes = 0;
    const transport = async (url, options = {}) => {
      if (++requests > DAILY_LIMITS.requests || signal.aborted) throw new WebError('source_limit');
      const response = await fetcher(url, { ...options, signal: AbortSignal.any([signal, ...(options.signal ? [options.signal] : [])]) });
      if ([401, 403, 404].includes(response.status)) { await response.body?.cancel(); throw new WebError('access_denied', 404); }
      return response;
    };
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    const get = (path, limit) => requestJson(transport, `https://api.github.com${path}`, { headers, signal }, limit);
    const query = async (query, variables) => {
      const result = await requestJson(transport, 'https://api.github.com/graphql', { method: 'POST', headers, signal, body: JSON.stringify({ query, variables }) }, 65536);
      if (result.errors?.some(e => ['FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED'].includes(e.type))) throw new WebError('access_denied', 404);
      if (result.errors?.length) throw new WebError('source_unavailable');
      return result.data;
    };
    const snapshot = await createDecisionGitHub(token, { fetcher: transport }).snapshot(project), source = snapshot.source;
    const base = `/repos/${project.repo.split('/').map(encodeURIComponent).join('/')}`;
    const read = async (snap, path) => {
      const entry = snap.entries.get(path);
      if (!entry) return null;
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw new WebError('source_invalid');
      if (cache.has(entry.sha)) return cache.get(entry.sha);
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > DAILY_LIMITS.fileBytes || ++files > DAILY_LIMITS.files || (bytes += entry.size) > DAILY_LIMITS.bytes) throw new WebError('source_limit');
      const blob = await get(`${base}/git/blobs/${entry.sha}`, DAILY_LIMITS.fileBytes * 2);
      if (blob.sha !== entry.sha || blob.encoding !== 'base64' || typeof blob.content !== 'string' || blob.size !== entry.size) throw new WebError('source_invalid');
      const buffer = Buffer.from(blob.content, 'base64');
      if (buffer.length !== entry.size || gitBlob(buffer) !== entry.sha) throw new WebError('source_invalid');
      let text; try { text = utf8(buffer); } catch { throw new WebError('source_invalid'); }
      cache.set(entry.sha, text);
      return text;
    };
    const branchCache = new Map([[source.branch, snapshot]]);
    async function branch(name) {
      if (branchCache.has(name)) return branchCache.get(name);
      const data = await query('query DailyBranch($id:ID!,$name:String!){node(id:$id){... on Repository{id databaseId nameWithOwner isPrivate ref(qualifiedName:$name){id name repository{id databaseId} target{... on Commit{oid tree{oid}}}}}}}', { id: source.repositoryNodeId, name: `refs/heads/${name}` });
      const repo = data?.node, ref = repo?.ref;
      if (!repo || repo.id !== source.repositoryNodeId || repo.databaseId !== project.repoId || repo.nameWithOwner !== project.repo || (repo.isPrivate ? 'private' : 'public') !== source.visibility) throw new WebError('access_denied', 404);
      if (ref === null) { branchCache.set(name, null); return null; }
      if (typeof ref?.id !== 'string' || ref.name !== name || ref.repository?.id !== source.repositoryNodeId || ref.repository.databaseId !== project.repoId || !sha(ref.target?.oid) || !sha(ref.target?.tree?.oid)) throw new WebError('source_unavailable');
      const tree = await get(`${base}/git/trees/${ref.target.tree.oid}?recursive=1`, 5 * 1024 * 1024);
      if (tree.sha !== ref.target.tree.oid || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 20000) throw new WebError('source_limit');
      const entries = new Map();
      for (const entry of tree.tree) {
        if (!sourcePath(entry.path) || !sha(entry.sha) || entries.has(entry.path)) throw new WebError('source_invalid');
        entries.set(entry.path, entry);
      }
      const result = { entries, source: { ...source, branch: name, branchNodeId: ref.id, head: ref.target.oid } };
      branchCache.set(name, result);
      return result;
    }
    let projectConfig;
    try { projectConfig = JSON.parse(await read(snapshot, snapshot.entries.has('.plates/plates.json') ? '.plates/plates.json' : '.keel/keel.json')); if (!record(projectConfig)) throw Error(); }
    catch (error) { if (denied(error)) throw error; throw new WebError('configuration_unavailable'); }
    const sources = [], gaps = [], snaps = new Map();
    const places = [['keel-night-plan', '.keel/night/plan.json'], [`keel-night/${date}-final`, `docs/night/${date}.json`], [`keel-night/${date}`, `docs/night/${date}.json`], [source.branch, `docs/night/${date}.json`], [source.branch, '.keel/night/plan.json']];
    for (const [name, path] of places) {
      const coordinates = { from: `${name}:${path}`, branch: name, path, revision: null, blob: null, url: null };
      try {
        const snap = await branch(name);
        if (!snap) { sources.push({ ...coordinates, state: 'absent', reason: 'Named branch is absent.', plan: null }); continue; }
        snaps.set(name, snap);
        coordinates.revision = snap.source.head;
        coordinates.blob = snap.entries.get(path)?.sha ?? null;
        coordinates.url = coordinates.blob ? sourceUrl(project, coordinates.revision, path) : null;
        const text = await read(snap, path);
        sources.push(text === null ? { ...coordinates, state: 'absent', reason: 'Named file is absent at this revision.', plan: null } : planRecord(text, coordinates, date));
      } catch (error) {
        if (denied(error)) throw error;
        sources.push({ ...coordinates, state: error.code === 'source_invalid' ? 'invalid' : 'unavailable', reason: error.code === 'source_limit' ? 'Source read exceeded its bound.' : 'Named source could not be read safely.', plan: null });
      }
    }
    const availableDates = [...snapshot.entries.keys()].filter(p => /^docs\/night\/\d{4}-\d{2}-\d{2}\.json$/.test(p)).map(p => p.slice(11, 21)).filter(dailyDate).sort().reverse();
    if (availableDates.length > DAILY_LIMITS.dates) gaps.push({ source: 'dates', reason: 'Date selector shows the latest thirty default-branch records; another explicit date can be inspected.' });
    const measurements = { before: null, after: null };
    try {
      const dir = healthDirOf(projectConfig), baseRecord = sources.find(s => s.state === 'read' && s.path === `docs/night/${date}.json`);
      const recordSnap = baseRecord ? snaps.get(baseRecord.branch) : null;
      const eligible = new Map();
      for (const snap of [snapshot, ...(recordSnap && recordSnap !== snapshot ? [recordSnap] : [])]) {
        for (const path of snap.entries.keys()) if (path.startsWith(`${dir}/`) && /^\d{4}-\d{2}-\d{2}\.md$/.test(path.slice(dir.length + 1)) && dailyDate(path.slice(-13, -3))) eligible.set(path, snap);
      }
      const names = [...eligible.keys()].sort(), target = `${dir}/${date}.md`;
      for (const [key, path] of [['before', names.filter(p => p <= target).at(-1)], ['after', names.find(p => p > target)]]) {
        if (!path) continue;
        const snap = eligible.get(path), text = await read(snap, path);
        measurements[key] = measurement(text, project, snap.source.head, path);
      }
      if (!measurements.before || !measurements.after) gaps.push({ source: 'measurements', reason: 'Before or after health measurements are absent; missing values remain unknown.' });
    } catch (error) {
      if (denied(error)) throw error;
      gaps.push({ source: 'measurements', reason: 'Health measurements could not be read within the source bounds.' });
    }
    return { model: dailyModel({ project, date, source, config: projectConfig, sources, dates: availableDates.slice(0, DAILY_LIMITS.dates), measurements, gaps, now: now() }), config: projectConfig };
  }
  return {
    async inspect(access, token, project, date) { return (await current(access, token, project, date)).model; },
    async preview(access, token, project, input) {
      validateDraftInput(input);
      const { model, config: projectConfig } = await current(access, token, project, input.date);
      if (model.sourceDigest !== input.sourceDigest) throw new WebError('daily_source_changed', 409);
      const problems = draftProblems(projectConfig, input.plan);
      if (input.plan.date !== input.date) problems.push('Draft date must match the inspected UTC date.');
      return { schema: 1, project, date: input.date, sourceDigest: model.sourceDigest, unsaved: true, valid: problems.length === 0, problems, plan: input.plan, budget: problems.length ? null : dailyBudget(projectConfig, input.plan.items), capabilities: dailyCapabilities };
    },
  };
}

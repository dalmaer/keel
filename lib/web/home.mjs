import { hash, random, WebError } from './common.mjs';
import { createHomeStore, GH_TTL } from './home-store.mjs';
import { createProjectReader, unavailableProject } from './projects.mjs';

const boundedGap = value => ['source_limit', 'quota_saving'].includes(value) ? value : 'source_unavailable';
const reasons = { source_limit: 'Source read reached its time, size or request bound.', quota_saving: 'Saving GitHub quota; optional source reads are paused.', source_unavailable: 'Source refresh is unavailable; the previous observation is retained.' };
// Increment when parsing semantics or collected capabilities change, even at an unchanged source HEAD.
export const HOME_MODEL_VERSION = 4;
async function parallel(items, limit, run) {
  let index = 0;
  const results = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) await run(items[index++]);
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}
function validProject(value, project) {
  const string = item => typeof item === 'string', nullable = item => item === null || string(item);
  const array = (items, check) => Array.isArray(items) && items.every(check);
  const action = item => item && string(item.id) && item.projectId === project.id && string(item.title) && string(item.link) && nullable(item.expectedSourceVersion);
  const plan = value?.planning;
  return !!(value && value.id === project.id && value.repoId === project.repoId && value.repo === project.repo
    && string(value.name) && nullable(value.tagline) && nullable(value.version) && nullable(value.revision) && nullable(value.readAt)
    && typeof value.sourceComplete === 'boolean' && ['complete','partial'].includes(value.state)
    && array(value.stack, string) && array(value.gaps, gap => gap && string(gap.source) && string(gap.reason))
    && plan && string(plan.source) && string(plan.headline) && nullable(plan.next)
    && ['built','total','livedIn'].every(key => plan[key] === null || Number.isSafeInteger(plan[key]) && plan[key] >= 0)
    && array(plan.goals, goal => goal && nullable(goal.id) && nullable(goal.title) && nullable(goal.outcome))
    && ['decisions','walks','waiting','changes'].every(key => array(value[key], action)));
}
const digestProject = ({ readAt, refreshing, ...value }) => value;
export function createHomeReader(config, { fetcher = fetch, now = Date.now, enrichChanges = null } = {}) {
  const store = createHomeStore(config, fetcher);
  return async (access, token, { projectId = null, fresh = false, since = null, cacheOnly = false } = {}) => {
    if (since !== null && !/^[a-f0-9]{64}$/.test(since)) throw new WebError('invalid_cursor', 400);
    const selected = projectId === null ? access.projects : access.projects.filter(item => item.id === projectId);
    if (projectId !== null && !selected.length) throw new WebError('access_denied', 404);
    const scope = hash(JSON.stringify({ model: HOME_MODEL_VERSION, source: access.sourceRevision, projects: access.projects }));
    if (access.quota) await store.observe(access.userId, access.quota);
    const budget = { requests: 0 }, signal = AbortSignal.timeout(25000);
    const readProject = createProjectReader({ fetcher, store, userId: access.userId, token, now, budget, signal });
    const rows = selected.map(project => ({ project, key: store.keyFor(access.userId, project.repoId, scope), cached: null }));
    // Parallel bounded cache reads keep a large fleet's HTML shell responsive.
    await parallel(rows, 8, async row => { row.cached = await store.read(row.key); });
    const usable = row => validProject(row.cached?.value, row.project) ? row.cached.value : null;
    const due = row => fresh || !usable(row)?.sourceComplete || row.cached.value.classifiedOn !== new Date(now()).toISOString().slice(0, 10) || !row.cached?.readAt || now() - Date.parse(row.cached.readAt) >= GH_TTL;
    // nextAttempt records a claimed attempt even when no successful value exists.
    // Unattempted and oldest-attempt projects precede repeatedly failing projects.
    const candidates = rows.filter(due).sort((a, b) => (Date.parse(a.cached?.nextAttempt) || 0) - (Date.parse(b.cached?.nextAttempt) || 0));
    let refreshes = 0;
    if (!cacheOnly) await parallel(candidates, 1, async row => {
      if (refreshes >= 4 || budget.requests >= 200 || signal.aborted) return;
      refreshes++;
      const lease = hash(random()), claimed = await store.claim(row.key, lease);
      row.cached = claimed ?? row.cached;
      if (!claimed?.leaseAcquired) { refreshes--; return; }
      const value = usable(row);
      try {
        const updated = await readProject(row.project, value);
        if (value && updated.sourceComplete === false) throw new WebError('source_unavailable');
        row.cached = await store.finish(row.key, lease, updated) ?? await store.read(row.key);
      } catch (error) {
        row.cached = await store.fail(row.key, lease, boundedGap(error.code)) ?? row.cached;
        if (error.status === 401) throw error;
      }
    });
    const projects = [];
    for (const row of rows) {
      const { project, cached } = row;
      let value = usable(row);
      if (!value) {
        value = unavailableProject(project, cached?.lastError ? reasons[cached.lastError] : cached?.refreshing
          ? 'A source refresh is already in progress. This view will update when it finishes.' : 'Project sources are loading within the bounded fleet refresh.');
        if (!cached?.lastError) { value.state = 'loading'; value.planning.headline = 'Loading source plan'; }
      }
      else {
        value = structuredClone(value);
        if (cached?.lastError) { value.state = 'stale'; value.gaps.push({ source: 'refresh', reason: reasons[cached.lastError] }); }
        else if (cached?.readAt && now() - Date.parse(cached.readAt) >= GH_TTL) { value.state = 'stale'; value.gaps.push({ source: 'refresh', reason: 'Last observed source is older than the ten-minute cache window.' }); }
      }
      projects.push(value);
    }
    // Private attachment observations are fresh independently of GitHub HEAD/cache age.
    // Bound to the same twenty recent items shown on Home; enrichment reads no image bytes.
    if(enrichChanges){
      const recent=projects.flatMap(project=>project.changes).sort((a,b)=>(b.date??'').localeCompare(a.date??'')||a.id.localeCompare(b.id)).slice(0,20);
      await parallel(projects,4,async value=>{
        const selected=recent.filter(change=>change.projectId===value.id&&change.kind==='change');if(!selected.length)return;
        const project=access.projects.find(p=>p.id===value.id);
        try{const enriched=await enrichChanges(access,project,selected);const byId=new Map(enriched.map(item=>[item.id,item]));value.changes=value.changes.map(item=>byId.get(item.id)||item);}
        catch{value.changes=value.changes.map(item=>selected.includes(item)?{...item,captures:(item.captures??[]).map(slot=>({...slot,capture:null,attachmentState:'unavailable'}))}:item);value.gaps.push({source:'private media',reason:'Private attachment observations are unavailable; source records remain visible.'});}
      });
    }
    const quota = await store.quota(access.userId);
    const gaps = projects.flatMap(project => project.gaps.map(gap => ({ projectId: project.id, ...gap })));
    const content = { projects: projects.map(digestProject), quotaState: quota.state };
    const cursor = hash(JSON.stringify(content));
    const remembered = await store.cursor(store.keyFor(access.userId, `cursor:${projectId ?? 'fleet'}`, scope), cursor, since);
    if (!['initial','current','changed','gap'].includes(remembered?.state)) throw new WebError('invalid_cursor_response');
    return { schema: 1, cursor, cursorState: remembered.state, generatedAt: new Date(now()).toISOString(),
      coverage: { state: projects.length && projects.every(project => project.state === 'unavailable') ? 'unavailable' : gaps.length ? 'partial' : 'complete', gaps }, projects,
      decisions: projects.flatMap(p => p.decisions).sort((a,b) => a.id.localeCompare(b.id)), walks: projects.flatMap(p => p.walks).sort((a,b) => a.id.localeCompare(b.id)),
      waiting: projects.flatMap(p => p.waiting).sort((a,b) => a.id.localeCompare(b.id)),
      changes: projects.flatMap(p => p.changes).sort((a,b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id)).slice(0, 20), quota,
    };
  };
}

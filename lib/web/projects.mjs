import { parsePhase, validateGraph, DONE } from '../../practices/phases/files/scripts/roadmap.mjs';
import { planningConfig } from '../../practices/night/files/scripts/plates/planning-config.mjs';
import { healthDirOf } from '../../practices/night/files/scripts/plates/lib.mjs';
import { parseProject, nextOf } from '../phases-projects.mjs';
import { roadmapItems, proposalOf } from '../board.mjs';
import { requestJson, record, WebError } from './common.mjs';
import { quotaObservation } from './home-store.mjs';

export const PROJECT_LIMITS = Object.freeze({ files: 180, bytes: 5 * 1024 * 1024, fileBytes: 128 * 1024, treeEntries: 20000, requests: 200, concurrent: 8 });
const sha = value => /^[a-f0-9]{40}$/.test(value ?? '');
const safePath = value => typeof value === 'string' && value.length <= 500 && value.split('/').every(part => part && !['.', '..'].includes(part) && !/[\x00-\x1f\\]/.test(part));
const text = (value, limit = 700) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, limit) : null;
const link = (repo, revision, path) => `https://github.com/${repo}/blob/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
const blankPlan = source => ({ source, built: null, total: null, livedIn: null, headline: 'Planning source unavailable', goals: [], next: null });
const action = (project, key, value) => ({ id: `${project.id}:${key}`, projectId: project.id, projectName: project.name, expectedSourceVersion: project.revision, ...value });
export function unavailableProject(project, reason = 'Project source has not been read yet') {
  return { ...project, name: project.id, tagline: null, stack: [], version: null, revision: null, readAt: null, state: 'unavailable',
    gaps: [{ source: 'project', reason }], planning: blankPlan('unknown'), decisions: [], walks: [], waiting: [], changes: [] };
}
export function createProjectReader({ fetcher = fetch, store, userId, token, now = Date.now, budget = { requests: 0 }, signal = AbortSignal.timeout(25000) }) {
  async function get(path, limit = 2 * 1024 * 1024) {
    if (budget.blockedUntil > now()) throw new WebError('quota_saving');
    if (++budget.requests > PROJECT_LIMITS.requests || signal.aborted) throw new WebError('source_limit');
    const reservation = await store.reserve(userId);
    if (!reservation.allowed) { budget.blockedUntil = Date.parse(reservation.blockedUntil) || 0; throw new WebError('quota_saving'); }
    return requestJson(async (url, options) => {
      const response = await fetcher(url, options), observation = quotaObservation(response.headers);
      const retry = response.headers.get('retry-after'), retrySeconds = /^\d{1,8}$/.test(retry ?? '') ? Number(retry) : null;
      // Access was freshly validated before source reading. An ambiguous 403 may
      // be a secondary limit without Retry-After; preserve the view and pause.
      const limited = response.status === 429 || response.status === 403;
      if (limited) {
        const requested = retrySeconds !== null ? now() + retrySeconds * 1000 : Date.parse(retry);
        const until = Math.max(now() + 60000, Number.isFinite(requested) ? requested : observation?.remaining === 0 ? observation.reset * 1000 : 0);
        budget.blockedUntil = Math.min(now() + 7 * 86400000, until);
        await response.body?.cancel();
        if (observation) await store.observe(userId, observation);
        await store.defer(userId, Math.ceil(budget.blockedUntil / 1000));
        throw new WebError('quota_saving');
      }
      if ([401, 404].includes(response.status)) { await response.body?.cancel(); throw new WebError('sign_in_required', 401); }
      if (observation) await store.observe(userId, observation);
      return response;
    }, `https://api.github.com${path}`, { signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } }, limit);
  }
  return async function readProject(project, previous) {
    const metadata = await get(`/repositories/${project.repoId}`, 65536);
    if (metadata.id !== project.repoId || metadata.full_name !== project.repo || typeof metadata.default_branch !== 'string' || metadata.default_branch.length > 200) throw new WebError('source_unavailable');
    const base = `/repos/${project.repo.split('/').map(encodeURIComponent).join('/')}`;
    const commits = await get(`${base}/commits?sha=${encodeURIComponent(metadata.default_branch)}&per_page=1`, 65536);
    const head = commits?.[0];
    if (!Array.isArray(commits) || commits.length !== 1 || !sha(head?.sha) || !sha(head?.commit?.tree?.sha)) throw new WebError('source_unavailable');
    // A fresh request revalidates the serving source revision before reusing parsed records.
    if (previous?.sourceComplete === true && previous.revision === head.sha && previous.classifiedOn === new Date(now()).toISOString().slice(0, 10)) return { ...previous, state: previous.gaps.length ? 'partial' : 'complete', readAt: new Date(now()).toISOString() };
    const tree = await get(`${base}/git/trees/${head.commit.tree.sha}?recursive=1`, 5 * 1024 * 1024);
    if (!record(tree) || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > PROJECT_LIMITS.treeEntries) throw new WebError('source_limit');
    const entries = new Map();
    for (const entry of tree.tree) {
      if (!safePath(entry.path) || !sha(entry.sha) || entries.has(entry.path)) throw new WebError('source_unavailable');
      entries.set(entry.path, entry);
    }
    let bytes = 0, files = 0;
    const loaded = new Map();
    async function read(path) {
      if (loaded.has(path)) return loaded.get(path);
      const entry = entries.get(path);
      if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw new WebError('source_unavailable');
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > PROJECT_LIMITS.fileBytes || ++files > PROJECT_LIMITS.files) throw new WebError('source_limit');
      bytes += entry.size; if (bytes > PROJECT_LIMITS.bytes) throw new WebError('source_limit');
      const blob = await get(`${base}/git/blobs/${entry.sha}`, PROJECT_LIMITS.fileBytes * 2);
      if (blob.sha !== entry.sha || blob.encoding !== 'base64' || blob.size !== entry.size || typeof blob.content !== 'string') throw new WebError('source_unavailable');
      const buffer = Buffer.from(blob.content, 'base64');
      if (buffer.length !== entry.size) throw new WebError('source_unavailable');
      const value = new TextDecoder('utf-8', { fatal: true }).decode(buffer); loaded.set(path, value); return value;
    }
    let config;
    try { config = JSON.parse(await read(entries.has('.plates/plates.json') ? '.plates/plates.json' : '.keel/keel.json')); if (!record(config)) throw Error(); planningConfig(config); }
    catch (error) { if (error.status === 401) throw error; if (error.code === 'quota_saving' || error.code === 'source_limit') throw error; throw new WebError('source_unavailable'); }
    config = { ...config, repo: project.repo };
    const result = { ...unavailableProject(project), name: text(config.name, 120) || project.id, tagline: text(config.tagline),
      stack: Array.isArray(config.stack) ? config.stack.filter(x => typeof x === 'string').slice(0, 20).map(x => text(x, 40)) : [],
      version: text(config.practice, 40), revision: head.sha, readAt: new Date(now()).toISOString(), state: 'complete', gaps: [], sourceComplete: true, classifiedOn: new Date(now()).toISOString().slice(0, 10) };
    const gap = (source, reason) => { result.gaps.push({ source, reason }); result.state = 'partial';
      if (!['GitHub operations', 'decision records', 'human actions', 'milestones'].includes(source)) result.sourceComplete = false; };
    const source = planningConfig(config).source;
    if (source === 'milestones') {
      result.planning = blankPlan('milestones');
      gap('milestones', 'GitHub milestones own this plan. The approved App has no Issues permission; archived local phases are not substituted.');
    } else if (config.phases?.shape === 'projects') {
      const names = [...entries.keys()].filter(path => /^docs\/projects\/[^/]+\/phases\.md$/.test(path)).sort();
      if (!names.length) gap('planning', 'No projects-shaped phase records were found.');
      let all = [], next = [];
      for (const path of names.slice(0, 40)) {
        try {
          const parsed = parseProject(path.split('/')[2], await read(path)), chosen = nextOf(parsed);
          all.push(...parsed.phases); if (chosen.next) next.push(`${parsed.project}: ${chosen.next.title}`);
          if (parsed.lint.length) gap('planning', `${parsed.project}: ${parsed.lint.length} phase status declarations need review.`);
        } catch (error) { if (error.status === 401) throw error; gap('planning', `${path}: source could not be read completely.`); }
      }
      if (names.length > 40) gap('planning', 'Projects-shaped plan exceeds the 40-document read bound.');
      result.planning = { source: 'projects', built: all.filter(p => p.status === 'built').length, total: all.length, livedIn: all.filter(p => p.status === 'lived-in').length,
        headline: `${all.filter(p => p.status === 'built').length} of ${all.length} source phases built`, goals: [], next: next[0] ?? null };
      gap('human actions', 'Projects-shaped plans supply status and next work; they do not supply the local phase walk/decision contract.');
    } else {
      const paths = [...entries.keys()].filter(path => /^docs\/phases\/[^/]+\.md$/.test(path) && !path.endsWith('/README.md')).sort();
      const phases = [], raws = new Map(); let goals = [];
      if (paths.length > 160) gap('planning', 'Phase inventory exceeds the 160-file read bound; totals and actions are incomplete.');
      let index = 0;
      const reads = await Promise.allSettled(Array.from({ length: PROJECT_LIMITS.concurrent }, async () => {
        while (index < Math.min(paths.length, 160)) {
          const path = paths[index++];
          try { const raw = await read(path), phase = parsePhase(path.split('/').at(-1), raw); phases.push(phase); raws.set(phase.file, raw); }
          catch (error) { if (error.status === 401) throw error; gap('planning', `${path}: source could not be read or validated.`); }
        }
      }));
      const denied = reads.find(result => result.status === 'rejected');
      if (denied) throw denied.reason;
      phases.sort((a, b) => a.id - b.id);
      let valid = !result.gaps.length;
      try { goals = JSON.parse(await read('docs/goals.json')); validateGraph(phases, goals); }
      catch (error) { if (error.status === 401) throw error; valid = false; gap('planning', 'Goals or phase dependencies could not be validated; next-action classification is unavailable.'); }
      for (const phase of phases) for (const evidence of phase.evidence) {
        if (!entries.has(`docs/${evidence}`)) { valid = false; gap('evidence', `Phase ${phase.id} names evidence absent from this revision.`); }
      }
      result.planning = { source: 'files', built: phases.filter(p => DONE.includes(p.status)).length, total: phases.length,
        livedIn: phases.filter(p => p.status === 'lived-in').length, headline: `${phases.filter(p => DONE.includes(p.status)).length} of ${phases.length} source phases built`,
        goals: Array.isArray(goals) ? goals.filter(g => !g.retired).slice(0, 30).map(g => ({ id: text(g.id, 40), title: text(g.title, 120), outcome: text(g.outcome) })) : [], next: null };
      if (valid) {
        const board = await roadmapItems(null, { today: new Date(now()).toISOString().slice(0, 10), read: async () => ({ config, goals, phases }), readPhase: async file => raws.get(file) });
        const rank = item => item.waits === 'owner' ? item.kind === 'walk' ? 2 : 1 : item.waits === 'broken' ? 0 : item.waits === 'agent' ? 3 : 4;
        const ordered = board.items.slice().sort((a,b) => rank(a) - rank(b) || a.phase - b.phase);
        const activeGoal = phases.find(p => p.id === ordered[0]?.phase)?.goal;
        result.planning.goals.sort((a,b) => Number(b.id === activeGoal) - Number(a.id === activeGoal));
        for (const item of ordered) {
          const kind = item.waits === 'owner' ? item.kind === 'walk' ? 'walk' : 'decision' : ['time', 'external'].includes(item.waits) ? 'waiting' : 'work';
          const sourcePath = `docs/phases/${phases.find(p => p.id === item.phase).file}`;
          const value = action(result, `phase:${item.phase}:${kind}`, { kind, title: text(item.ask || item.title, 180), why: text(item.why), next: text(item.next),
            link: link(project.repo, head.sha, sourcePath), phase: String(item.phase), ready: kind === 'walk' && item.ready !== false,
            details: item.yourPart ? Object.fromEntries(['ask','why','look','then','takes'].map(key => [key, text(item.yourPart[key])]).concat([['choices', (item.yourPart.choices ?? []).slice(0, 10).map(x => text(x, 120))]])) : null });
          if (kind === 'decision') result.decisions.push(value); else if (kind === 'walk') result.walks.push(value); else if (kind === 'waiting') result.waiting.push(value);
          if (!result.planning.next) result.planning.next = text(item.ask || item.next || item.title);
        }
      }
      result.changes = phases.filter(p => DONE.includes(p.status)).sort((a, b) => b.since.localeCompare(a.since) || b.id - a.id).slice(0, 8).map(p => action(result, `phase-change:${p.id}`, {
        title: text(p.title, 180), date: p.since, revision: head.sha, link: link(project.repo, head.sha, `docs/phases/${p.file}`), kind: 'phase', media: null, previewUrl: null, acceptance: 'source claim',
      }));
    }
    try {
      const healthDir = healthDirOf(config), paths = [...entries.keys()].filter(path => path.startsWith(`${healthDir}/`) && /^\d{4}-\d{2}-\d{2}\.md$/.test(path.slice(healthDir.length + 1))).sort();
      if (paths.length) {
        const path = paths.at(-1), proposal = proposalOf(await read(path));
        if (proposal && !proposal.decided) result.decisions.push(action(result, `health:${path}`, { kind: 'decision', title: `Review ${proposal.measure || 'health'} proposal`,
          why: text(proposal.text), next: 'Inspect the source proposal before deciding.', decisionTarget: {kind:'health',path}, link: link(project.repo, head.sha, path), phase: null, ready: true, details: null }));
      }
    } catch (error) { if (error.status === 401) throw error; gap('health proposals', 'Latest recorded health proposal could not be read or validated.'); }
    gap('GitHub operations', 'Reviews, issues, checks and live routine/production outcomes are not covered by this read-only source view.');
    gap('decision records', 'Architecture decision context and private lesson proposals are not collected in this first Home reader.');
    if (!result.changes.length) result.changes.push(action(result, `commit:${head.sha}`, { title: text(head.commit?.message?.split('\n')[0], 180) || 'Latest source commit',
      date: text(head.commit?.committer?.date, 40), revision: head.sha, link: `https://github.com/${project.repo}/commit/${head.sha}`, kind: 'commit', media: null, previewUrl: null, acceptance: 'not established' }));
    result.gaps.sort((a,b) => a.source.localeCompare(b.source) || a.reason.localeCompare(b.reason));
    return result;
  };
}

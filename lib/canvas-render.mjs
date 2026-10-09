import { SELECT_CSS } from './canvas-controls.mjs';
// A canvas is a read-only projection. This module never collects evidence or
// derives delivery claims from status/merge labels. Shared view functions run
// unchanged in Node and the self-contained browser artifact.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateSnapshot } from './canvas-snapshot.mjs';

export const GROUPS = Object.freeze([
  { key: 'delivery', title: 'Goals & delivery', kinds: ['goal', 'phase', 'decision', 'pr'] },
  { key: 'loop', title: 'Loop → work', kinds: ['loop'] },
  { key: 'lessons', title: 'Lessons → shared practice', kinds: ['lesson', 'release', 'update'] },
  { key: 'health', title: 'Health & upkeep', kinds: ['health', 'test', 'review', 'loose-end'] },
  { key: 'retros', title: 'Retros → changes', kinds: ['retro'] },
  { key: 'activity', title: 'Evidence & activity', kinds: [] },
]);
export const PAGE_SIZE = 24;
export const SELECTED_PER_GROUP = 3;
const FACTS = [['implemented', 'Implemented'], ['merged', 'Merged'], ['productionVerified', 'Production verified'], ['livedIn', 'Lived in']];
const error = message => Object.assign(new Error(`canvas render: ${message}`), { exitCode: 2 });
const compare = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const list = value => Array.isArray(value) ? value : [];
const text = value => value === null || value === undefined ? 'Unknown' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const esc = value => text(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const md = value => esc(value).replace(/[\\`*_[\]{}()#!|]/g, c => `\\${c}`).replace(/\r?\n/g, ' ');
const json = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const digest = value => createHash('sha256').update(value).digest('hex');
const groupOf = entity => GROUPS.find(g => g.kinds.includes(entity.kind))?.key ?? 'activity';
const isProposal = entity => entity.kind === 'lesson' && Boolean(entity.proposalKind || entity.key.startsWith('lesson:inbox:') || /^docs\/inbox\//.test(entity.source?.path ?? ''));
const sourceOf = entity => entity.source?.name ?? entity.source?.type ?? (isProposal(entity) ? 'lesson proposal' : entity.kind);
const deliveryKind = entity => ['phase', 'pr', 'loop', 'update'].includes(entity.kind);

/** Only explicit web references or known repository revisions become links.
 * Local paths remain references when no reliable browser URL is available. */
export function sourceHref(source, snapshot) {
  if (!source || typeof source !== 'object') return null;
  if (typeof source.url === 'string') {
    try {
      const u = new URL(source.url);
      if (u.protocol === 'https:' && !u.username && !u.password && !u.search) return u.href;
    } catch { /* show the reference as text */ }
    return null;
  }
  const path = source.path, repo = snapshot.project?.repo;
  const revision = source.revision ?? snapshot.revision?.commit;
  if (source.tracked === false || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[a-f\d]{7,64}$/i.test(revision ?? '')
      || typeof path !== 'string' || /[\\\x00-\x1f:]/.test(path)) return null;
  const [file, ...anchor] = path.split('#');
  if (file.split('/').some(p => !p || p === '.' || p === '..')) return null;
  if (/^\.keel\/(?:test-runs|canvas|climb|tend)(?:\/|$)/.test(file)) return null;
  return `https://github.com/${repo}/blob/${revision}/${file.split('/').map(encodeURIComponent).join('/')}${anchor.length ? '#' + encodeURIComponent(anchor.join('#')) : ''}`;
}
function sourceHTML(source, snapshot) {
  const label = source?.path ?? source?.url ?? 'Source unavailable', href = sourceHref(source, snapshot);
  if (source?.url && !href) return '<span>Source URL withheld</span>';
  return href ? `<a href="${esc(href)}" rel="noreferrer">${esc(label)}</a>${source?.path && snapshot.revision?.dirty !== false ? '<small> · committed reference; local contents may differ</small>' : ''}` : `<span>${esc(label)} (reference only)</span>`;
}
function sourceMD(source, snapshot) {
  const label = source?.path ?? source?.url ?? 'Source unavailable', href = sourceHref(source, snapshot);
  if (source?.url && !href) return 'Source URL withheld';
  return href ? `[${md(label)}](<${href.replace(/[<>\s]/g, c => encodeURIComponent(c))}>)` : `${md(label)} (reference only)`;
}
function timestamp(value) {
  const n = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
function entityTime(entity, observations) {
  const own = timestamp(entity.occurredAt ?? entity.date ?? entity.since ?? entity.decidedAt);
  const times = observations.map(o => timestamp(o.occurredAt ?? o.observedAt)).filter(t => t !== null);
  return own ?? (times.length ? Math.max(...times) : null);
}

/** Pure, shared reducer: a selection changes presentation only. */
export function reduceFilters(state, action) {
  const initial = { window: '30', goal: '', project: '', source: '', group: '', metric: '', entity: '', exploreMetric: '', page: 0 };
  if (action.type === 'reset') return initial;
  if (action.type === 'page') return { ...initial, ...state, page: Math.max(0, Math.trunc(Number(action.value) || 0)) };
  if (!['window', 'goal', 'project', 'source', 'group', 'metric', 'entity', 'exploreMetric'].includes(action.type)) return { ...initial, ...state };
  const value = String(action.value ?? '');
  return { ...initial, ...state, [action.type]: action.type === 'window' && !['7', '30', 'all'].includes(value) ? '30' : value, page: 0 };
}

/** Select records, retaining unknown dates visibly. Metrics are explicitly
 * snapshot-wide measurements: filtering never silently changes their scope. */
export function selectView(snapshot, filters = {}) {
  const state = { ...reduceFilters({}, { type: 'reset' }), ...filters };
  const observations = new Map();
  for (const o of list(snapshot.observations)) {
    if (!observations.has(o.entity)) observations.set(o.entity, []);
    observations.get(o.entity).push(o);
  }
  const end = timestamp(snapshot.generatedAt);
  // UTC calendar days, including the snapshot day, independent of the viewer's clock.
  const start = state.window === 'all' || end === null ? null : Math.floor(end / 86400000) * 86400000 - (Number(state.window) - 1) * 86400000;
  const metric = list(snapshot.metrics).find(m => m.id === state.metric);
  const keys = metric ? new Set(list(metric.entityKeys)) : null;
  const dated = list(snapshot.entities).map(entity => ({ entity, at: entityTime(entity, observations.get(entity.key) ?? []) }));
  const cohort = dated.filter(({ entity: e }) => (!state.goal || e.goal === state.goal || e.key === `goal:${state.goal}`)
    && (!state.project || e.project === state.project) && (!state.source || sourceOf(e) === state.source)
    && (!keys || keys.has(e.key)) && (!state.entity || state.entity === e.key));
  const inWindow = ({ at }) => start === null || at === null || (at >= start && at <= end);
  const matching = cohort.filter(inWindow).sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || compare(a.entity.key, b.entity.key));
  const selected = matching.filter(({ entity }) => !state.group || state.group === 'activity' || groupOf(entity) === state.group);
  const pageCount = Math.max(1, Math.ceil(selected.length / PAGE_SIZE));
  const page = Math.min(pageCount - 1, Math.max(0, Math.trunc(Number(state.page) || 0)));
  const visibleKeys = new Set(matching.map(({ entity }) => entity.key));
  return {
    state: { ...state, page }, pageCount, total: selected.length,
    undated: selected.filter(({ at }) => at === null).length,
    entities: selected.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(x => x.entity),
    entityKeys: selected.map(x => x.entity.key),
    groups: GROUPS.map(g => ({ ...g, count: matching.filter(({ entity }) => g.key === 'activity' || groupOf(entity) === g.key).length })),
    metrics: list(snapshot.metrics).map(m => ({ ...m,
      displayValue: m.coverage === 'ok' && Number.isFinite(m.value) ? m.value : null,
      displayReason: m.coverage !== 'ok' ? `Source coverage: ${m.coverage ?? 'unknown'}` : m.value === null || m.value === undefined ? 'No measured value.' : 'Current snapshot measurement · not a filtered transition count',
      contributing: list(m.entityKeys).filter(k => visibleKeys.has(k)),
    })),
    observations: list(snapshot.observations).filter(o => visibleKeys.has(o.entity) && inWindow({ at: timestamp(o.occurredAt ?? o.observedAt) })),
    coverage: list(snapshot.coverage),
  };
}
function factText(fact) {
  const value = fact?.value;
  return value === true ? 'Yes' : value === false ? 'No' : 'Unknown';
}
function factDetail(fact) {
  if (!fact) return 'No explicit observation';
  return [fact.reason, fact.quality ? `Quality: ${fact.quality}` : '', fact.observedAt ? `Observed: ${fact.observedAt}` : '', fact.occurredAt ? `Occurred: ${fact.occurredAt}` : '', fact.source ? `Source: ${text(fact.source)}` : ''].filter(Boolean).join(' · ');
}
function factsHTML(entity) {
  return `<dl class="facts">${FACTS.map(([key, label]) => `<div><dt>${label}</dt><dd>${factText(entity.facts?.[key])}</dd><small>${esc(factDetail(entity.facts?.[key]))}</small></div>`).join('')}</dl>`;
}
function evidenceSources(entity) {
  const refs = [...list(entity.evidence), ...FACTS.flatMap(([key]) => list(entity.facts?.[key]?.evidence))];
  const unique = new Map();
  for (const ref of refs) {
    const source = typeof ref === 'string' ? (/^https:\/\//.test(ref) ? { url: ref } : { path: ref }) : ref?.source ?? (ref?.path || ref?.url ? ref : null);
    if (source) unique.set(JSON.stringify(source), source);
  }
  return [...unique.values()];
}
function recordBodyHTML(entity) {
  if (deliveryKind(entity)) return factsHTML(entity);
  if (entity.kind === 'test') return `<dl class="facts">${['pass', 'fail', 'skip', 'todo'].map(key => `<div><dt>${key}</dt><dd>${esc(entity.counts?.[key])}</dd></div>`).join('')}</dl><p>Workflow: ${esc(entity.workflow)} · run worktree: ${entity.dirty === true ? 'dirty' : entity.dirty === false ? 'clean' : 'unknown'}</p>`;
  if (entity.kind === 'health') return `<table><caption>Saved health measures (first 20)</caption><thead><tr><th>Measure</th><th>Value</th><th>State / bound</th></tr></thead><tbody>${list(entity.measures).slice(0, 20).map(m => `<tr><th scope="row">${esc(m.id)}</th><td>${esc(m.value)}</td><td>${esc(m.state)} · ${esc(m.bound)}</td></tr>`).join('')}</tbody></table>`;
  if (entity.kind === 'lesson') return isProposal(entity) ? `<p>Inbox proposal · ${esc(entity.proposalKind ?? 'Type unknown')} · decision: ${esc(entity.status)}</p><p>Outcome: ${esc(entity.outcome)}</p>` : `<p>Lesson record · guard: ${esc(entity.guard)}</p><p>Provenance: ${esc(entity.provenance || 'Not recorded')}</p>`;
  if (entity.kind === 'retro') return `<p>${list(entity.candidates).length} recorded candidates; choices remain the owner's.</p>${list(entity.candidates).slice(0, 5).map(c => `<p>${esc(c.proposedAction ?? c.action ?? c.title)} · decision: ${esc(c.decision)}</p>`).join('')}`;
  return '';
}
function recordHTML(entity, snapshot, interactive = true) {
  const evidence = evidenceSources(entity), related = list(snapshot.relations).filter(r => r.from === entity.key || r.to === entity.key);
  const dated = entityTime(entity, list(snapshot.observations).filter(o => o.entity === entity.key));
  return `<article class="record"><p class="eyebrow">${esc(sourceOf(entity))} · ${esc(entity.status ?? 'Status unknown')}</p><h3>${esc(entity.title)}</h3>
<p class="source">${sourceHTML(entity.source, snapshot)}</p><p class="muted">${dated === null ? 'Undated record · retained in every date window' : `Recorded / observed ${new Date(dated).toISOString().slice(0, 10)}`}${entity.goal ? ` · Goal ${esc(entity.goal)}` : ''}${entity.project ? ` · ${esc(entity.project)}` : ''}</p>
${entity.outcome || entity.next ? `<p>${esc(entity.outcome ?? entity.next)}</p>` : ''}${recordBodyHTML(entity)}
${entity.evidenceMissing ? '<p class="notice">Evidence is missing at this revision.</p>' : ''}
<details><summary>Evidence & provenance</summary><p>Source revision: ${esc(entity.source?.revision ?? snapshot.revision?.commit ?? 'Unknown')}</p>
${evidence.length ? `<ul>${evidence.slice(0, 12).map(s => `<li>${sourceHTML(s, snapshot)}</li>`).join('')}</ul><p>${evidence.length} references; showing at most 12.</p>` : '<p>No explicit evidence references.</p>'}
${related.slice(0, 12).map(r => `<p>${esc(r.kind)}: ${esc(r.from === entity.key ? r.to : r.from)} ${interactive ? `<button type="button" data-entity="${esc(r.from === entity.key ? r.to : r.from)}">Inspect related record</button>` : ''}${r.source ? ` · ${sourceHTML(r.source, snapshot)}` : ''}</p>`).join('')}
${deliveryKind(entity) ? '<p>Acceptance stays in the source record. Merged does not imply production verified or lived in.</p>' : ''}</details></article>`;
}
function summaryHTML(snapshot) {
  const metrics = new Map(snapshot.metrics.map(m => [m.id, m]));
  const summaries = ['phases-reported-built', 'phases-accepted-with-evidence', 'saved-test-runs'].map(id => metrics.get(id)).filter(m => m?.coverage === 'ok' && Number.isFinite(m.value));
  const lessons = snapshot.entities.filter(e => e.kind === 'lesson' && !isProposal(e));
  const proposals = snapshot.entities.filter(isProposal);
  return `<section id="summaries" aria-label="Current snapshot counts" class="headlines">${summaries.map(m => `<button type="button" data-summary-metric="${esc(m.id)}"><strong>${esc(m.value)}</strong><span>${esc(m.label)}</span><small>Current snapshot · ${list(m.entityKeys).length} contributing records</small></button>`).join('')}${lessons.length || proposals.length ? `<button type="button" data-summary-group="lessons"><strong>${lessons.length}</strong><span>Lesson records</span><small>${proposals.length} inbox proposals separately · current snapshot</small></button>` : ''}</section>`;
}
/** Normalize the collector's series timestamps, keeping explicit gaps and
 * categorical samples. Link matching narrows series under record filters. */
export function metricPoints(metric, view, snapshot) {
  if (!Array.isArray(metric.series)) return view.observations.filter(o => o.field === metric.id)
    .map(o => ({ ...o, at: o.occurredAt ?? o.observedAt, dateKind: o.occurredAt ? 'occurred' : 'observed' }))
    .sort((a, b) => compare(a.at, b.at) || compare(a.id, b.id)).slice(-30);
  const state = view.state, selected = new Set(view.entityKeys);
  const end = timestamp(snapshot.generatedAt), start = state.window === 'all' ? null : Math.floor(end / 86400000) * 86400000 - (Number(state.window) - 1) * 86400000;
  const narrowed = Boolean(state.goal || state.project || state.source || state.group || state.metric || state.entity);
  return metric.series.filter(p => {
    const at = timestamp(p.at);
    if (at === null || (start !== null && (at < start || at > end))) return false;
    if (!narrowed) return true;
    return snapshot.entities.some(e => selected.has(e.key) && (p.entity === e.key ||
      (p.source?.path && e.source?.path === p.source.path) || (p.source?.url && e.source?.url === p.source.url)));
  }).map(p => ({ ...p, dateKind: 'recorded', quality: p.quality ?? (p.value === null ? 'unknown' : 'reported') }))
    .sort((a, b) => compare(a.at, b.at)).slice(-30);
}
function metricHTML(metric, view, snapshot) {
  // Null/instrument errors break segments. No implicit zero or invented baseline.
  const points = metricPoints(metric, view, snapshot);
  const values = points.filter(p => Number.isFinite(p.value) && p.quality !== 'unknown').map(p => p.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  let segment = [], segments = [];
  points.forEach((p, i) => {
    if (!Number.isFinite(p.value) || p.quality === 'unknown') { if (segment.length) segments.push(segment); segment = []; return; }
    segment.push(`${12 + i * 276 / Math.max(1, points.length - 1)},${70 - (p.value - lo) / (hi - lo || 1) * 52}`);
  });
  if (segment.length) segments.push(segment);
  const trend = points.length ? `<svg viewBox="0 0 300 86" role="img" aria-label="${esc(metric.label)} observations; gaps mean unknown, not zero">${segments.map(s => `<polyline points="${s.join(' ')}" fill="none" stroke="currentColor" stroke-width="2"/>${s.map(p => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3" fill="currentColor"/>`).join('')}`).join('')}</svg><details><summary>Observation values (${points.length}, most recent 30)</summary><table><caption>Recorded observations, not inferred transitions</caption><thead><tr><th>Date</th><th>Value</th><th>Quality / source</th></tr></thead><tbody>${points.map(p => `<tr><td>${esc(p.at)} (${esc(p.dateKind)})</td><td>${p.value !== null && p.value !== undefined && p.quality !== 'unknown' ? esc(p.value) : 'Unknown'}</td><td>${esc(p.quality)} · ${sourceHTML(p.source, snapshot)}</td></tr>`).join('')}</tbody></table></details>` : '<p>No time series recorded. Baseline and trend unknown.</p>';
  return `<article class="metric"><h3>${esc(metric.label)}</h3><p class="value">${metric.displayValue === null ? 'Unknown' : esc(metric.displayValue)} <small>${esc(metric.unit)}</small></p><p>${esc(metric.displayReason || `Coverage: ${metric.coverage}`)}</p>${metric.detail ? `<p>${esc(metric.detail)}</p>` : ''}<p>Numerator: ${esc(metric.numerator)} · denominator: ${esc(metric.denominator)} · samples: ${esc(metric.samples)} · baseline: ${esc(metric.baseline)}</p><button type="button" data-metric="${esc(metric.id)}">Contributing records (${list(metric.entityKeys).length})</button>${trend}</article>`;
}
function viewHTML(snapshot, filters) {
  const view = selectView(snapshot, filters);
  const focused = view.metrics.find(m => m.id === view.state.exploreMetric)
    ?? view.metrics.find(m => list(m.series).length || view.observations.some(o => o.field === m.id))
    ?? view.metrics.find(m => m.displayValue !== null) ?? view.metrics[0];
  return `<p id="result-count" role="status" aria-live="polite">${view.total} source records match. Page ${view.state.page + 1} of ${view.pageCount}. Includes ${view.undated} undated records, kept visible.</p>
<nav class="groups" aria-label="Lifecycle groups">${view.groups.map(g => `<button type="button" data-group="${g.key}" aria-pressed="${view.state.group === g.key}"><strong>${esc(g.title)}</strong><span>${g.count} records</span></button>`).join('')}</nav>
<details class="measure-details" ${view.state.exploreMetric ? 'open' : ''}><summary>Explore all ${view.metrics.length} measurements & trends (${view.metrics.filter(m => m.displayValue === null).length} unknown)</summary><p>Values describe the current snapshot, independent of browsing filters. They are not counts of transitions in the selected dates. Series follow the record filters; missing samples break the line.</p>${focused ? `<label for="metric-picker">Measurement<select id="metric-picker" name="exploreMetric">${view.metrics.map(m => `<option value="${esc(m.id)}" ${m.id === focused.id ? 'selected' : ''}>${esc(m.label)}${m.displayValue === null ? ' — Unknown' : ''}</option>`).join('')}</select></label><div class="metrics">${metricHTML(focused, view, snapshot)}</div>` : '<p>No measurements supplied.</p>'}</details>
<section aria-labelledby="records-heading"><h2 id="records-heading">Source records</h2><p>${view.state.group ? `Group: ${esc(view.state.group)}. ` : ''}${view.state.metric ? `Contributors to ${esc(view.state.metric)}. ` : ''}Showing at most ${PAGE_SIZE} at a time.</p><div class="records">${view.entities.map(e => recordHTML(e, snapshot)).join('') || '<p>No records in this selection. This does not establish zero outcomes.</p>'}</div><div class="pages"><button type="button" data-page="${view.state.page - 1}" ${view.state.page === 0 ? 'disabled' : ''}>Previous records</button><button type="button" data-page="${view.state.page + 1}" ${view.state.page + 1 >= view.pageCount ? 'disabled' : ''}>Next records</button><button type="button" data-reset>Reset filters</button></div></section>`;
}
const CSS = `:root{color-scheme:light;--ink:#18322e;--muted:#546761;--line:#d4dfd9;--paper:#f5f7f3;--accent:#14654e}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,sans-serif}main{max-width:1320px;margin:auto;padding:24px 28px 48px}header{border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:16px}h1{font-size:clamp(1.8rem,4vw,2.8rem);line-height:1.1;letter-spacing:-.045em;margin:12px 0}h2{font-size:1.55rem;margin-top:32px}h3{font-size:1.1rem;margin:8px 0}p{margin:10px 0}a{color:#075a83;text-underline-offset:3px;overflow-wrap:anywhere}.eyebrow{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);font-weight:750}.muted,small{color:var(--muted)}small{font-size:.8rem}.notice{border-left:4px solid #9a6300;padding:10px 16px;background:#fff4d9}fieldset{display:flex;gap:16px;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;padding:18px}.headlines{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.headlines button{text-align:left;padding:16px}.headlines strong{display:block;font-size:2rem;line-height:1.2}.headlines span,.headlines small{display:block}.headlines small{margin-top:8px}.measure-details{margin:16px 0}legend{font-weight:700}label{display:grid;gap:5px;font-size:.85rem;font-weight:650}select,button{font:inherit;color:var(--ink);background:#fff;border:1px solid #9aafa4;border-radius:7px;padding:9px 12px;min-height:44px}button{cursor:pointer}button:hover{background:#e8f1eb}button[aria-pressed=true]{border:2px solid var(--accent);background:#e8f1eb}button:disabled{opacity:.55;cursor:default}:focus-visible{outline:3px solid #17698e;outline-offset:3px}.groups{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.groups button{text-align:left}.groups span{display:block;color:var(--muted);font-size:.85rem}.metrics,.records{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.metric,.record{background:white;padding:22px;border:1px solid var(--line);border-radius:12px;min-width:0;overflow-wrap:anywhere}.value{font-size:2rem;font-weight:700}.value small{font-size:.85rem;font-weight:400}.source{font-size:.85rem}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.facts div{border-top:1px solid var(--line);padding-top:8px}.facts dt{font-size:.8rem;color:var(--muted)}.facts dd{margin:0;font-weight:700}.facts small{display:block}details{margin-top:16px}summary{cursor:pointer;font-weight:650;min-height:32px}table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:10px 8px;overflow-wrap:anywhere}caption{text-align:left;color:var(--muted);padding:10px 0}svg{width:100%;max-height:120px;color:var(--accent)}.pages{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px}.skip{position:absolute;left:-9999px}.skip:focus{left:20px;top:8px;background:white;padding:10px}footer{margin-top:40px;color:var(--muted);font-size:.85rem}@media(max-width:720px){main{padding:28px 16px}.metrics,.records{grid-template-columns:1fr}.groups{grid-template-columns:repeat(2,1fr)}.headlines{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.headlines button{padding:12px}.headlines strong{font-size:1.65rem}fieldset{gap:8px;padding:10px}fieldset label{width:calc(50% - 4px)}select{width:100%;min-width:0}header .muted{font-size:.75rem;overflow-wrap:anywhere}table{font-size:.8rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}`;
function documentHTML(title, body, script = '') {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>${CSS}${SELECT_CSS}</style></head><body><a class="skip" href="#main">Skip to project pulse</a><main id="main">${body}<footer>Read-only projection · Source records own decisions and acceptance · No tracking or external assets</footer></main>${script}</body></html>\n`;
}
function options(values, initial = '') {
  return `<option value="">All ${esc(initial)}</option>${[...new Set(values.filter(v => typeof v === 'string' && v))].sort(compare).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;
}
function browserMain(snapshot) {
  let state = reduceFilters({}, { type: 'reset' });
  const controls = document.getElementById('filters'), content = document.getElementById('view');
  function paint() {
    content.innerHTML = viewHTML(snapshot, state);
    for (const name of ['window', 'goal', 'project', 'source']) controls.elements.namedItem(name).value = state[name];
  }
  controls.addEventListener('change', event => {
    state = reduceFilters(state, { type: event.target.name, value: event.target.value }); paint();
  });
  document.getElementById('summaries').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    state = { ...reduceFilters({}, { type: 'reset' }), window: 'all', metric: button.dataset.summaryMetric ?? '', group: button.dataset.summaryGroup ?? '' };
    paint(); document.getElementById('records-heading').scrollIntoView({ block: 'start' });
  });
  content.addEventListener('change', event => {
    if (event.target.name !== 'exploreMetric') return;
    state = reduceFilters(state, { type: 'exploreMetric', value: event.target.value });
    paint(); document.getElementById('metric-picker').focus();
  });
  content.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-page')) state = reduceFilters(state, { type: 'page', value: button.dataset.page });
    else if (button.hasAttribute('data-group')) state = reduceFilters(state, { type: 'group', value: state.group === button.dataset.group ? '' : button.dataset.group });
    else if (button.hasAttribute('data-metric')) state = reduceFilters(state, { type: 'metric', value: button.dataset.metric });
    else if (button.hasAttribute('data-entity')) state = { ...reduceFilters({}, { type: 'reset' }), window: 'all', entity: button.dataset.entity };
    else if (button.hasAttribute('data-reset')) state = reduceFilters(state, { type: 'reset' });
    else return;
    paint();
    const heading = document.getElementById('records-heading');
    heading.setAttribute('tabindex', '-1'); heading.focus();
  });
  paint();
}
function pulseHTML(snapshot) {
  const functions = [compare, list, text, esc, groupOf, isProposal, sourceOf, deliveryKind, sourceHref, sourceHTML, timestamp, entityTime, reduceFilters, selectView, factText, factDetail, factsHTML, evidenceSources, recordBodyHTML, recordHTML, metricPoints, metricHTML, viewHTML, browserMain];
  const js = functions.map(fn => `const ${fn.name} = ${fn.toString()};`).join('\n');
  const body = `<header><p class="eyebrow">Keel / Project pulse</p><h1>${esc(snapshot.project.name)}</h1><p>What changed. What held. What still needs evidence.</p><p class="muted">Snapshot ${esc(snapshot.generatedAt)} · revision ${esc(snapshot.revision?.commit ?? 'Unknown')} · ${snapshot.revision?.dirty === true ? 'Local / uncommitted' : snapshot.revision?.dirty === false ? 'Committed sources' : 'Worktree state unknown'}</p></header>${summaryHTML(snapshot)}
<form id="filters" onsubmit="return false"><fieldset><legend>Explore recorded evidence</legend><label>UTC date window<select name="window"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="all">All history</option></select></label><label>Goal<select name="goal">${options(snapshot.entities.map(e => e.goal ?? (e.kind === 'goal' ? e.key.replace(/^goal:/, '') : '')), 'goals')}</select></label><label>Subproject<select name="project">${options(snapshot.entities.map(e => e.project), 'subprojects')}</select></label><label>Source<select name="source">${options(snapshot.entities.map(sourceOf), 'sources')}</select></label></fieldset></form>
<p class="muted">Browse dated records plus undated records. Current snapshot counts stay visible; browsing does not change acceptance.</p><noscript><p class="notice">Enable JavaScript for filters and paging. This page includes the first 24 records from the last 30 UTC days; pulse.md contains a source-linked summary.</p></noscript><div id="view">${viewHTML(snapshot, {})}</div>
<section aria-labelledby="coverage-heading"><h2 id="coverage-heading">Coverage & gaps</h2><p>Freshness is reported by each collector. Unavailable, disabled and unsupported are not zero.</p><table><caption>All snapshot sources (coverage remains visible under every filter)</caption><thead><tr><th>Source</th><th>Coverage</th><th>Observed</th><th>Reason / cadence</th></tr></thead><tbody>${snapshot.coverage.map(c => `<tr><th scope="row">${esc(c.source)}</th><td>${esc(c.status)}</td><td>${esc(c.observedAt)}</td><td>${esc(c.reason ?? 'No gap reported')}${c.expectedCadence ? ` · ${esc(c.expectedCadence)}` : ''}</td></tr>`).join('')}</tbody></table>${!snapshot.coverage.length ? '<p class="notice">No source coverage recorded.</p>' : ''}${snapshot.warnings.length ? `<ul class="notice">${snapshot.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</section>`;
  return documentHTML(`${snapshot.project.name} — Project pulse`, body, `<script id="snapshot" type="application/json">${json(snapshot)}</script><script>\n'use strict';\nconst GROUPS=${json(GROUPS)}, FACTS=${json(FACTS)}, PAGE_SIZE=${PAGE_SIZE};\n${js}\nbrowserMain(JSON.parse(document.getElementById('snapshot').textContent));\n</script>`);
}
function recordMD(entity, snapshot) {
  const body = deliveryKind(entity)
    ? `| Delivery fact | Value | Provenance |\n| --- | --- | --- |\n${FACTS.map(([key, label]) => `| ${label} | ${factText(entity.facts?.[key])} | ${md(factDetail(entity.facts?.[key]))} |`).join('\n')}`
    : entity.kind === 'test' ? ['pass', 'fail', 'skip', 'todo'].map(k => `- ${k}: ${md(entity.counts?.[k])}`).join('\n')
    : entity.kind === 'health' ? list(entity.measures).slice(0, 20).map(m => `- ${md(m.id)}: ${md(m.value)} · ${md(m.state)} · bound ${md(m.bound)}`).join('\n')
    : entity.kind === 'lesson' ? isProposal(entity) ? `Inbox proposal: ${md(entity.proposalKind)} · decision: ${md(entity.status)}` : `Lesson guard: ${md(entity.guard)}` : '';
  const relations = snapshot.relations.filter(r => r.from === entity.key || r.to === entity.key).slice(0, 12).map(r => `- ${md(r.kind)}: ${md(r.from === entity.key ? r.to : r.from)}${r.source ? ` · ${sourceMD(r.source, snapshot)}` : ''}`).join('\n');
  return `# ${md(entity.title)}\n\n${md(sourceOf(entity))} · ${md(entity.status ?? 'Status unknown')}\n\nSource: ${sourceMD(entity.source, snapshot)}\n\nSource revision: ${md(entity.source?.revision ?? snapshot.revision?.commit)}\n\n${entity.outcome || entity.next ? md(entity.outcome ?? entity.next) + '\n\n' : ''}${body}\n\n## Evidence & relations\n\n${evidenceSources(entity).slice(0, 12).map(s => `- ${sourceMD(s, snapshot)}`).join('\n') || 'No explicit evidence references.'}\n\n${relations}\n\n${deliveryKind(entity) ? 'Acceptance remains in the source. Merged does not imply production verified or lived in.' : 'Source records remain authoritative.'}\n`;
}
function indexMD(group, entities, snapshot) {
  const rows = entities.slice(0, 12);
  return `# ${group.title}\n\n${entities.length} source records. Showing ${rows.length}; browse the pulse for all records and filters.\n\n${rows.map(e => `- **${md(e.title)}** — ${md(e.status ?? 'Status unknown')} · ${sourceMD(e.source, snapshot)}`).join('\n') || 'No collected records. Check source coverage before interpreting this as zero.'}\n`;
}

/** Pure and deterministic: no clock, filesystem, collection or network reads.
 * Cards include pulse, six indexes, then <=3 selected entities per group. */
export function renderSnapshot(snapshot) {
  validateSnapshot(snapshot);
  // The shared validator checks primary sources. Also reject secret-bearing
  // URLs in nested evidence, fact provenance, warnings and extension fields:
  // this snapshot is embedded verbatim for offline browsing. Never echo it.
  function checkURLs(value) {
    if (typeof value === 'string') {
      for (const candidate of value.match(/https?:\/\/[^\s<>"']+/g) ?? []) {
        let url; try { url = new URL(candidate); } catch { continue; }
        if (url.username || url.password || url.search) throw error('credential- or query-bearing URL cannot be published');
      }
    } else if (value && typeof value === 'object') for (const child of Object.values(value)) checkURLs(child);
  }
  checkURLs(snapshot);
  const ordered = [...snapshot.entities].sort((a, b) => compare(a.key, b.key));
  const groups = GROUPS.map(g => ({ ...g, entities: ordered.filter(e => g.key === 'activity' || groupOf(e) === g.key) }));
  const indexes = groups.map(g => ({ key: `index:${g.key}`, title: g.title, group: g.key, markdown: indexMD(g, g.entities, snapshot) }));
  const view = selectView(snapshot, { window: 'all' });
  const markdown = `# ${md(snapshot.project.name)} — Project pulse\n\nSnapshot: ${md(snapshot.generatedAt)} · revision ${md(snapshot.revision.commit)} · ${snapshot.revision.dirty === true ? 'Local / uncommitted' : snapshot.revision.dirty === false ? 'Committed sources' : 'Worktree state unknown'}\n\nThis is a read-only projection. Implementation, merge, production verification and lived-in evidence are independent.\n\n## Measures\n\n| Measure | Value | Coverage | Detail |\n| --- | --- | --- | --- |\n${view.metrics.map(m => `| ${md(m.label)} | ${m.displayValue === null ? 'Unknown' : md(m.displayValue)} ${md(m.unit)} | ${md(m.coverage)} | ${md(m.detail ?? m.displayReason)} |`).join('\n') || '| No measured values | Unknown | Unknown | No metrics recorded |'}\n\n## Coverage & gaps\n\n${snapshot.coverage.map(c => `- **${md(c.source)}: ${md(c.status)}** — ${md(c.reason ?? 'No gap reported')}; observed ${md(c.observedAt)}`).join('\n') || 'No source coverage recorded.'}\n\n${snapshot.warnings.map(w => `- ${md(w)}`).join('\n')}\n\n${indexes.map(c => c.markdown.replace(/^# /, '## ')).join('\n')}\n`;
  const html = pulseHTML(snapshot);
  const cards = [{ key: 'pulse', title: 'Project pulse', group: null, markdown, html }, ...indexes];
  // The activity index spans all sources; avoid publishing duplicate detail cards.
  const selected = new Set();
  for (const group of groups) {
    for (const entity of group.entities.filter(e => !selected.has(e.key)).slice(0, SELECTED_PER_GROUP)) {
      selected.add(entity.key);
      cards.push({ key: `entity:${entity.key}`, title: entity.title, group: group.key, markdown: recordMD(entity, snapshot), html: documentHTML(entity.title, recordHTML(entity, snapshot, false)) });
    }
  }
  const manifest = {
    schema: 1, projectKey: snapshot.project.key, generatedAt: snapshot.generatedAt, revision: snapshot.revision,
    complete: snapshot.coverage.length > 0 && snapshot.coverage.every(c => c.status === 'ok') && !snapshot.warnings.length,
    groups: GROUPS.map(({ key, title }) => ({ key, title })),
    cards: cards.map(c => {
      const base = c.key === 'pulse' ? 'pulse' : `cards/${digest(c.key)}`;
      return { key: c.key, title: c.title, group: c.group, markdown: `${base}.md`, ...(c.html ? { html: `${base}.html` } : {}), hash: digest(JSON.stringify([c.markdown, c.html ?? null])) };
    }),
  };
  return { markdown, html, cards, manifest };
}

/** Write into a new artifact directory; never overwrite an existing bundle or
 * delete stale/human files. The manifest maps opaque keys to safe filenames. */
export async function render({ snapshot, output }) {
  if (typeof snapshot === 'string') {
    try { snapshot = JSON.parse(await readFile(snapshot, 'utf8')); }
    catch (e) { throw error(`cannot read snapshot: ${e.message}`); }
  }
  const result = renderSnapshot(snapshot);
  if (typeof output !== 'string' || !output || output.includes('\0')) throw error('output directory is required');
  const target = resolve(output);
  // Refuse symlink parents before any write; the CLI independently checks paths.
  let parent = target;
  for (;;) {
    try { if ((await lstat(parent)).isSymbolicLink()) throw error('output path contains a symlink'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const next = resolve(parent, '..'); if (next === parent) break; parent = next;
  }
  try { await mkdir(target); }
  catch (e) { if (e.code === 'EEXIST') throw error('output already exists; choose a new artifact directory'); throw e; }
  await mkdir(join(target, 'cards'));
  for (let i = 0; i < result.cards.length; i++) {
    const card = result.cards[i], file = result.manifest.cards[i];
    await writeFile(join(target, file.markdown), card.markdown, { flag: 'wx' });
    if (file.html) await writeFile(join(target, file.html), card.html, { flag: 'wx' });
  }
  await writeFile(join(target, 'manifest.json'), `${JSON.stringify(result.manifest, null, 2)}\n`, { flag: 'wx' });
  return { ...result, output: target };
}

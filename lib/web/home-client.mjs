import {clearPrivateView} from './safety-client.mjs';
import {startJournalPreference} from './change-client.mjs';
// Browser polling and pure state transitions. No private snapshots enter persistent storage.
export const POLL_INTERVAL = 60_000;
export const MAX_BACKOFF = 300_000;
// Leave the server's 55-second bounded read time to return before the client aborts.
export const REQUEST_TIMEOUT = 58_000;
const validCursor = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function createPollState(cursor, { loadingOnly = false } = {}) {
  return { cursor: validCursor(cursor) ? cursor : null, loadingOnly: loadingOnly === true, visible: true, inFlight: false, denied: false,
    pending: null, updates: 0, failures: 0, delay: POLL_INTERVAL, needsFresh: false, status: 'idle', notice: '' };
}
export function transitionPoll(state, event) {
  if (state.denied) return state;
  if (event.type === 'visibility') return { ...state, visible: event.visible, inFlight: event.visible ? state.inFlight : false };
  if (event.type === 'start') return state.inFlight || !state.visible ? state : { ...state, inFlight: true };
  if (event.type === 'apply') return !state.pending ? state : { ...state, loadingOnly: state.loadingOnly && !canHydrateInitial(state), pending: null, updates: 0, notice: event.automatic ? 'Project sources loaded. Future changes will wait for your review.' : 'Updated view applied. Recheck any open source details.' };
  if (event.type !== 'response') return state;
  if ([401,403,404].includes(event.status)) return { ...createPollState(null), denied: true, visible: state.visible, status: 'denied', notice: 'Access changed. Sign in again to continue.' };
  if (event.status === 304) return { ...state, inFlight: false, failures: 0, delay: POLL_INTERVAL, status: 'current', needsFresh: false, notice: state.pending ? 'New source information is ready. Your current view is unchanged.' : 'Sources checked; this view is current.' };
  if (event.status !== 200 || !validCursor(event.snapshot?.cursor) || event.snapshot?.schema !== 1 || !Array.isArray(event.snapshot.projects)) {
    const failures = state.failures + 1;
    return { ...state, inFlight: false, failures, delay: Math.min(MAX_BACKOFF, POLL_INTERVAL * 2 ** Math.min(failures, 3)), status: 'stale', needsFresh: false, notice: 'Refresh unavailable. The previous view may be stale; its source times are preserved.' };
  }
  const snapshot = event.snapshot, gap = snapshot.cursorState === 'gap', changed = snapshot.cursor !== state.cursor;
  return { ...state, inFlight: false, failures: 0, delay: POLL_INTERVAL, status: 'current', cursor: snapshot.cursor,
    pending: changed || gap ? snapshot : state.pending, updates: changed || gap ? state.updates + 1 : state.updates,
    needsFresh: gap && !event.fresh,
    notice: gap ? 'Update history has a gap. A fresh bounded view is being requested.' : event.fresh && state.needsFresh ? 'Fresh view received after a history gap. Review and apply the update.' : changed ? `New source information is ready${snapshot.coverage?.state !== 'complete' ? ', with incomplete source coverage' : ''}. Your current view is unchanged.` : state.pending ? state.notice : 'Sources checked; this view is current.' };
}
export function canHydrateInitial(state) {
  if (!state.loadingOnly || state.denied || !state.pending) return false;
  const snapshot = state.pending;
  return snapshot.projects.length === 0 || snapshot.projects.some(project => project.state !== 'loading')
    || ['decisions','walks','waiting','changes'].some(key => Array.isArray(snapshot[key]) && snapshot[key].length > 0);
}
export function matchesHomeFilter({ search = '', groups = '' }, query = '', filter = 'all') {
  return String(search).toLowerCase().includes(query.trim().toLowerCase()) && (filter === 'all' || String(groups).split(/\s+/).includes(filter));
}
/** A native fetch has a deadline even when the server never responds. */
export async function fetchHomeResponse({ fetch, url, headers, controller = new AbortController(), timeout = REQUEST_TIMEOUT }) {
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url,{ method:'GET',credentials:'same-origin',cache:'no-store',headers,signal:controller.signal });
    return { status:response.status,snapshot:response.status === 200 ? await response.json() : null };
  } catch { return { status:503,snapshot:null }; }
  finally { clearTimeout(timer); }
}
/** Native DOM integration; browser walkthrough, not model tests, verifies focus/layout. */
export function startHomeClient({ document, window, fetch, renderHomeSnapshot }) {
  const root = document.querySelector('[data-home-root]');
  if (!root) return null;
  const endpoint = root.dataset.endpoint;
  if (!/^\/api\/(?:home|projects\/[a-z][a-z0-9-]{0,63}\/home)$/.test(endpoint)) return null;
  const projectId = root.dataset.projectId || null;
  const refresh = document.querySelector('[data-refresh]'), apply = document.querySelector('[data-apply-updates]');
  const message = document.querySelector('[data-refresh-status]'), search = document.querySelector('[data-home-search]');
  const filter = document.querySelector('[data-home-filter]'), filterStatus = document.querySelector('[data-filter-status]');
  let journal=null;
  let state = createPollState(root.dataset.cursor,{loadingOnly:root.dataset.initialLoading === 'true'}), timer = null, controller = null, generation = 0;
  state = transitionPoll(state,{ type:'visibility',visible:!document.hidden });
  function announce() {
    if (message) message.textContent = state.notice || 'Updates are checked while this page is visible.';
    if (apply) { apply.hidden = !state.pending; apply.textContent = `${state.updates} new ${state.updates === 1 ? 'update' : 'updates'} · Show changes`; }
    if (refresh) { refresh.disabled = state.inFlight || state.denied; refresh.textContent = state.inFlight ? 'Checking sources…' : 'Refresh sources'; }
    message?.closest('.refresh-notice')?.setAttribute('data-stale', String(state.status === 'stale'));
  }
  function schedule(delay = state.delay) {
    if (timer) window.clearTimeout(timer);
    timer = !state.visible || state.denied ? null : window.setTimeout(() => poll(state.needsFresh), delay);
  }
  function filterView() {
    let shown = 0, total = 0;
    for (const card of root.querySelectorAll('[data-filterable]')) {
      const match = matchesHomeFilter(card.dataset, search?.value ?? '', filter?.value ?? 'all') && (!card.dataset.changeTime || !journal || journal.matches(card.dataset.changeTime));
      card.hidden = !match; total++; if (match) shown++;
    }
    const active = Boolean(search?.value.trim()) || filter?.value !== 'all';
    if (filterStatus) { filterStatus.hidden = !active; filterStatus.textContent = `${shown} of ${total} items match. Source coverage stays visible above the results.`; }
  }
  async function poll(fresh = false) {
    if (state.inFlight || !state.visible || state.denied) return;
    if (timer) window.clearTimeout(timer);
    const requestGeneration = ++generation;
    state = transitionPoll(state,{type:'start'});
    const requestController = new AbortController(); controller = requestController;
    announce();
    const url = new URL(endpoint,window.location.origin);
    if (state.cursor && !(fresh && state.needsFresh)) url.searchParams.set('cursor',state.cursor);
    if (fresh) url.searchParams.set('fresh','1');
    try {
      const headers = { Accept:'application/json' };
      if (state.cursor && !fresh) headers['If-None-Match'] = `"${state.cursor}"`;
      const {status,snapshot} = await fetchHomeResponse({fetch,url:url.href,headers,controller:requestController});
      if (requestGeneration !== generation) return;
      state = transitionPoll(state,{type:'response',status,snapshot,fresh});
      if (canHydrateInitial(state)) applyUpdates({automatic:true});
    } catch (error) {
      if (requestGeneration !== generation) return;
      state = transitionPoll(state,{type:'response',status:503});
    } finally {
      if (requestGeneration === generation) {
        controller = null;
        if (state.denied) {
          root.replaceChildren();
          const main = document.querySelector('main');
          if (main) clearPrivateView({root:main,document,window});
          document.querySelector('nav[aria-label="Account"]')?.remove();
        } else { announce(); schedule(state.needsFresh ? 0 : state.delay); }
      }
    }
  }
  function applyUpdates(options = {}) {
    if (!state.pending || state.denied) return;
    const open = [...root.querySelectorAll('details[open][data-detail]')].map(element => element.dataset.detail);
    const active = document.activeElement, focusKey = active?.dataset?.focus, focusWasInside = root.contains(active);
    const scroll = { left:window.scrollX,top:window.scrollY };
    root.innerHTML = renderHomeSnapshot(state.pending,{projectId}); root.dataset.cursor = state.pending.cursor;
    for (const detail of root.querySelectorAll('details[data-detail]')) if (open.includes(detail.dataset.detail)) detail.open = true;
    state = transitionPoll(state,{type:'apply',automatic:options?.automatic === true}); root.dataset.initialLoading = String(state.loadingOnly); announce(); filterView();
    const restore = focusKey ? [...root.querySelectorAll('[data-focus]')].find(element => element.dataset.focus === focusKey && !element.closest('[hidden]')) : null;
    if (restore) restore.focus({preventScroll:true});
    else if (active === apply || focusWasInside) refresh?.focus({preventScroll:true});
    window.scrollTo(scroll);
  }
  function visibility() {
    state = transitionPoll(state,{type:'visibility',visible:!document.hidden});
    if (document.hidden) { generation++; controller?.abort(); controller = null; if (timer) window.clearTimeout(timer); }
    else schedule(0);
    announce();
  }
  journal=startJournalPreference({document,window,onChange:filterView});
  filterView();
  const refreshClick = () => poll(true);
  refresh?.addEventListener('click',refreshClick); apply?.addEventListener('click',applyUpdates);
  search?.addEventListener('input',filterView); filter?.addEventListener('change',filterView);
  document.addEventListener('visibilitychange',visibility); schedule(0);
  return { poll, stop() { journal?.stop(); generation++; controller?.abort(); if (timer) window.clearTimeout(timer); document.removeEventListener('visibilitychange',visibility); refresh?.removeEventListener('click',refreshClick); apply?.removeEventListener('click',applyUpdates); search?.removeEventListener('input',filterView); filter?.removeEventListener('change',filterView); } };
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  import('/assets/home-views.mjs').then(({renderHomeSnapshot}) => startHomeClient({document,window,fetch:window.fetch.bind(window),renderHomeSnapshot})).catch(() => {
    const message = document.querySelector('[data-refresh-status]');
    if (message) message.textContent = 'Live updates could not start. Reload this page to refresh its sources.';
  });
}

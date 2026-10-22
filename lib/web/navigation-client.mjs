import {describeRoute,lensRoute} from './navigation-routes.mjs';
export function startNavigation({document,window}) {
  const root=document.querySelector('[data-navigation]');
  if(!root)return null;
  function refresh() {
    const path=window.location.pathname+(window.location.search||'');
    const current=describeRoute(path);
    if(!current)return;
    for(const anchor of root.querySelectorAll('[data-project-lens]')) {
      const target=lensRoute(path,anchor.dataset.projectLens||null);
      anchor.href=target.path;
      const explanation=anchor.querySelector?.('[data-lens-explanation]');
      if(explanation)explanation.textContent=target.notice||'';
    }
    for(const anchor of root.querySelectorAll('[data-nav-destination]')) {
      if(anchor.dataset.navDestination===current.destination)anchor.setAttribute('aria-current','page');
      else anchor.removeAttribute('aria-current');
    }
    const notice=root.querySelector('[data-lens-notice]');
    if(notice)notice.textContent=current.detail?'This record stays with its original project. Switching opens the selected view index.':'Switch projects while keeping the current kind of view.';
  }
  refresh();
  root.addEventListener('toggle',refresh,true);
  window.addEventListener('popstate',refresh);
  return {refresh,stop(){root.removeEventListener('toggle',refresh,true);window.removeEventListener('popstate',refresh);}};
}
if(typeof window!=='undefined'&&typeof document!=='undefined')startNavigation({document,window});

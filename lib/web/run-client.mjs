import {runLocation} from './run-views.mjs';

export function scopeLocation(url, destination, project) {
  const current=new URL(url),query={};
  for(const key of ['days','status'])if(current.searchParams.has(key))query[key]=current.searchParams.get(key);
  const existing=current.pathname.match(/^\/projects\/([a-z][a-z0-9-]{0,63})\//)?.[1]||'';
  if(existing===project&&current.searchParams.has('routine'))query.routine=current.searchParams.get('routine');
  // Page and receipt cursors belong to the old scope. A routine path may not exist in another project.
  return runLocation(destination,project,query);
}
export function startRunClient({document,window}) {
  const form=document.querySelector('[data-run-scope]');
  if(!form)return null;
  const submit=event=>{
    event.preventDefault();
    const project=form.querySelector('[name="project"]').value;
    if(project&&!/^[a-z][a-z0-9-]{0,63}$/.test(project))return;
    const destination=form.dataset.destination==='routines'?'routines':'activity';
    window.location.assign(scopeLocation(window.location.href,destination,project));
  };
  form.addEventListener('submit',submit);
  return {stop(){form.removeEventListener('submit',submit);}};
}
if(typeof document!=='undefined'&&typeof window!=='undefined')startRunClient({document,window});

import {signInPath} from './navigation-routes.mjs';
// Each document owns its guards; access loss invalidates every private editor on that page.
const accessGuards=new WeakMap();
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function clearPrivateView({root,document=globalThis.document,window=globalThis.window,message='Access changed. Unsaved text was not saved. Sign in to inspect current access.'}) {
  for(const revoke of [...(accessGuards.get(document)||[])])revoke();
  const path=(window?.location?.pathname||'/')+(window?.location?.search||'');
  const target=root.closest?.('main')||root;
  target.innerHTML=`<section><h1 tabindex="-1">Sign in again</h1><p>${esc(message)}</p><a class="button" href="${esc(signInPath(path))}">Sign in and return</a></section>`;
  document?.querySelector?.('[data-navigation]')?.remove?.();
  document?.querySelector?.('nav[aria-label="Account"]')?.remove?.();
  if(document)document.title='Sign in again · Keel';target.querySelector?.('h1')?.focus?.();
}
export function startSafety({root,document=globalThis.document,window=globalThis.window,readDirty=()=>false,save=null,discard=()=>{},onAccessLost=()=>{}}) {
  if(!root||!document||!window)return null;
  let dialog=null,stopped=false,observed=Date.now();
  let status=root.querySelector?.('[data-safety-status]')||document.querySelector?.('[data-safety-status]');
  if(!status&&document.createElement){status=document.createElement('p');status.setAttribute('data-safety-status','');status.setAttribute('role','status');root.prepend?.(status);}
  const notice=text=>{if(status)status.textContent=text;};
  const online=()=>{if(stopped)return;notice(window.navigator?.onLine===false?`Offline. Last displayed observation ${new Date(observed).toISOString()}. Unsaved text exists only in this open page. No actions are queued.`:'Connection available. Inspect current saved state before another action. No save or submission was replayed.');};
  function navigate(path) {
    if(stopped)return;
    if(!readDirty()){window.location.assign(path);return;}
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Unsaved private edits');
    dialog.innerHTML='<h2>Unsaved private edits</h2><p>Save privately before leaving, discard these edits, or stay here. Offline text can be lost if this tab closes.</p><button type="button" data-safety-save>Save and leave</button><button type="button" data-safety-discard>Discard and leave</button><button type="button" data-safety-cancel>Stay here</button><p role="status"></p>';
    root.append(dialog);const opener=document.activeElement;
    const close=()=>{dialog?.close?.();dialog?.remove?.();dialog=null;opener?.focus?.();};
    dialog.querySelector('[data-safety-save]').disabled=typeof save!=='function'||window.navigator?.onLine===false;
    dialog.querySelector('[data-safety-cancel]').onclick=close;
    dialog.querySelector('[data-safety-discard]').onclick=()=>{discard();close();window.location.assign(path);};
    dialog.querySelector('[data-safety-save]').onclick=async()=>{const button=dialog.querySelector('[data-safety-save]');button.disabled=true;let saved=false;try{saved=await save();}catch{}if(stopped)return;if(saved&&!readDirty()){close();window.location.assign(path);}else if(dialog){dialog.querySelector('[role="status"]').textContent='Save was not confirmed. Stay here and inspect saved state.';button.disabled=false;}};
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();dialog.querySelector('[data-safety-cancel]').focus();
  }
  const click=event=>{if(stopped)return;const link=event.target.closest?.('a[href]');if(!link||event.defaultPrevented||event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target==='_blank'||link.hasAttribute('download')||!readDirty())return;
    const href=link.getAttribute('href');if(!href||href.startsWith('#'))return;event.preventDefault();event.stopImmediatePropagation?.();navigate(href);};
  const unload=event=>{if(!stopped&&readDirty()){event.preventDefault();event.returnValue='';}};
  document.addEventListener?.('click',click,true);window.addEventListener?.('beforeunload',unload);window.addEventListener?.('online',online);window.addEventListener?.('offline',online);
  if(window.navigator?.onLine===false)online();
  function stop() {
    stopped=true;dialog?.remove?.();dialog=null;
    document.removeEventListener?.('click',click,true);window.removeEventListener?.('beforeunload',unload);
    window.removeEventListener?.('online',online);window.removeEventListener?.('offline',online);
    accessGuards.get(document)?.delete(revoke);
  }
  const revoke=()=>{stop();onAccessLost();};
  if(!accessGuards.has(document))accessGuards.set(document,new Set());
  accessGuards.get(document).add(revoke);
  return {notice,navigate,observed(){observed=Date.now();},stop};
}
if(typeof document!=='undefined'&&typeof window!=='undefined')startSafety({root:document.querySelector('main'),document,window});

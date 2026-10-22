import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigation,editorDraftControls} from '../lib/web/navigation.mjs';
import {startNavigation} from '../lib/web/navigation-client.mjs';
import {dailyShell,renderPlanEditor} from '../lib/web/daily-views.mjs';
import {modelTaskForm,modelPolicyEditor} from '../lib/web/model-views.mjs';
import {capabilityView} from '../lib/web/capability-views.mjs';
import {harness} from './helpers/web-http.mjs';
const projects=[{id:'studio',name:'Acme studio',repo:'acme/studio'},{id:'lab',name:'Acme lab',repo:'acme/lab'}];
const access={workspace:{name:'Acme'},csrf:'Acme-csrf',projects};

test('shared navigation exposes selected scope, current destination and protected sign out without a wide flat menu',()=>{
  const html=navigation(access,{path:'/projects/studio/activity?days=7&status=failed&page=3',project:projects[0]});
  assert.match(html,/<summary class="nav-project">Acme studio<\/summary>/);
  assert.match(html,/href="\/projects\/studio\/activity" aria-current="page"/);
  assert.match(html,/data-project-lens="lab" href="\/projects\/lab\/activity\?days=7&amp;status=failed"/);
  assert.match(html,/<summary>More<\/summary>/);
  assert.match(html,/action="\/api\/auth\/logout"/);assert.match(html,/name="csrf" value="Acme-csrf"/);
  assert.match(html,/href="\/setup"/);assert.match(html,/href="\/projects\/studio\/capabilities"/);
  assert.doesNotMatch(html,/href="[^"]*page=3/);
});
test('project switching refreshes real anchor destinations after a client receipt replaces the URL',()=>{
  const anchors=[{dataset:{projectLens:'lab'}},{dataset:{projectLens:''}}],notice={textContent:''},listeners={};
  const root={querySelectorAll:selector=>selector==='[data-project-lens]'?anchors:[],querySelector:()=>notice,addEventListener(name,fn){listeners[name]=fn;},removeEventListener(){}};
  const window={location:{pathname:'/projects/studio/activity',search:'?days=14&status=failed&routine=night&page=4'},addEventListener(){},removeEventListener(){}};
  const client=startNavigation({document:{querySelector:()=>root},window});
  assert.equal(anchors[0].href,'/projects/lab/activity?days=14&status=failed');
  window.location={pathname:`/projects/studio/jobs/${'a'.repeat(64)}`,search:''};listeners.toggle();
  assert.equal(anchors[0].href,'/projects/lab/jobs');assert.equal(anchors[1].href,'/jobs');assert.match(notice.textContent,/record stays/);
  assert.doesNotMatch(anchors.map(a=>a.href).join(' '),/a{64}/);
  const scoped=navigation(access,{path:'/projects/studio/walks',project:projects[0]});assert.match(scoped,/There is no fleet index for this project view/);assert.match(scoped,/data-project-lens="" href="\/"/);client.stop();
});
test('real authenticated shell routes retain navigation and security boundaries; sign-in has no private project menu',async()=>{
  const h=harness(),login=await h.login();
  for(const path of ['/','/projects/studio','/daily','/setup','/capabilities','/projects/studio/capabilities?q=walk']) {
    const response=await h.service(h.request(path,{cookie:login.cookie}));assert.equal(response.status,200,path);
    const html=await response.text();assert.equal((html.match(/data-navigation/g)||[]).length,1,path);
    assert.match(html,/data-safety-status/);assert.match(html,/\/assets\/navigation-client.mjs/);assert.match(html,/\/assets\/safety-client.mjs/);
    assert.match(html,/Sign out/);assert.match(html,/Skip to content/);
  }
  const signin=await h.service(h.request('/signin'));assert.doesNotMatch(await signin.text(),/data-project-lens/);
  h.state.members=[];
  const revoked=await h.service(h.request('/projects/studio',{cookie:login.cookie}));assert.notEqual(revoked.status,200);assert.doesNotMatch(await revoked.text(),/data-project-lens/);
});
test('supported editors expose private draft controls without persisting approvals or promising unsaved recovery',()=>{
  const forms=[renderPlanEditor({date:'2026-10-21',items:[]}),modelTaskForm({phases:[],files:[]}),modelPolicyEditor(null)];
  for(const html of forms){assert.match(html,/data-draft-save/);assert.match(html,/data-draft-load/);assert.match(html,/data-draft-delete/);assert.match(html,/never approval/);assert.match(html,/Unsaved offline text exists only in this page/);}
  assert.doesNotMatch(editorDraftControls(),/checked|localStorage|sessionStorage/);
  assert.match(dailyShell('Daily work',access,'<h1>Acme</h1>'),/data-safety-status/);
});
test('task catalogue keeps unsupported work explicit, safe links bounded, CLI details secondary, and owner search useful',()=>{
  const rows=[{id:'cli.night',title:'Retry failed night work',group:'Daily work',treatment:'limited',effect:'local',scope:'project',readiness:{state:'unsupported',reason:'General failed-night execution is not implemented.'},followUp:'Use the configured local night workflow.',limitations:['No generic terminal is exposed.'],route:'/projects/studio/daily',cli:[{command:'plates night',usage:'plates night <command>',forms:[{subcommand:'retry',positionals:'<id>',arguments:[{token:'--yes',arity:0,repeat:'Once; approval follows preview',treatment:'Explicit local approval'}]}]}]},{id:'web.daily',title:'Inspect Daily work',group:'Planning',treatment:'native',readiness:{state:'available',reason:'Canonical night plan inspection.'},limitations:['Canonical night plan inspection.'],route:'/projects/studio/daily'},{id:'bad',title:'Untrusted <task>',group:'Other',route:'https://acme.test',readiness:{state:'unverified'},cli:[]}];
  const html=capabilityView({project:projects[0],rows,query:'night',coverage:{gaps:['Dynamic local execution remains unsupported.']}},access);
  assert.match(html,/Retry failed night work/);assert.ok(html.indexOf('Inspect Daily work')<html.indexOf('Retry failed night work'));assert.equal((html.match(/Canonical night plan inspection\./g)||[]).length,1);assert.match(html,/matching tasks and CLI forms/);assert.match(html,/Not supported here/);assert.match(html,/Limited support/);assert.match(html,/Once; approval follows preview/);assert.match(html,/Use the configured local night workflow/);assert.match(html,/<summary>CLI forms and argument coverage/);assert.match(html,/plates night &lt;command&gt;/);assert.doesNotMatch(html,/Untrusted|https:\/\/acme.test/);
  assert.match(html,/Coverage is not completion/);assert.doesNotMatch(html,/data-start|data-submit|action="\/api\/(?!auth\/logout)/);
});

test('actual catalogue routes return the reviewed model, reject private query injection, and serve browser module dependencies',async()=>{
  const h=harness(),login=await h.login();
  const response=await h.service(h.request('/api/projects/studio/capabilities',{cookie:login.cookie}));
  assert.equal(response.status,200);const model=await response.json();assert.equal(model.project.id,'studio');assert.ok(model.rows.length>0);
  assert.ok(model.rows.some(row=>row.readiness.state==='unsupported'));
  const response2=await h.service(h.request('/capabilities?q=night',{cookie:login.cookie}));const html=await response2.text();
  assert.match(html,/Coverage is not completion/);assert.match(html,/name="q"[^>]*value="night"/);
  for(const path of ['/projects/other/capabilities','/capabilities?q=walk&q=secret','/capabilities?private=Acme']) {
    const invalid=await h.service(h.request(path,{cookie:login.cookie}));assert.ok(invalid.status>=400,path);
  }
  for(const path of ['navigation.mjs','navigation-client.mjs','navigation-routes.mjs','safety-client.mjs']){
    const asset=await h.service(h.request('/assets/'+path));assert.equal(asset.status,200,path);assert.match(asset.headers.get('content-type'),/javascript/);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeView, projectView, renderHomeSnapshot, safeSourceLink, isLoadingOnly, signinView, errorView, styles } from '../lib/web/views.mjs';
const access = { workspace:{name:'Acme workspace'},projects:[{id:'studio',repo:'acme/studio'}],sourceRevision:'a'.repeat(40),csrf:'fake-csrf-acme' };
const action = (id,kind,projectId='studio') => ({id,projectId,projectName:projectId === 'studio' ? 'Acme Studio' : 'Acme API',kind,title:`Acme ${kind} ${id}`,why:'Source asks for an owner observation.',next:'Read the current source.',link:'https://github.com/acme/studio/blob/main/docs/phases/1.md',phase:'1',ready:true,details:{ask:'Does publishing work?',why:'A human uses the real surface.',look:'Open the preview.',then:'Record what happened.',takes:'About five minutes',choices:['Verified','Needs changes','Cannot check yet']} });
function snapshot() {
  const decision=action('decision-one','decision'), walk=action('walk-one','walk'), waiting=action('wait-one','waiting');
  return {schema:1,cursor:'a'.repeat(64),cursorState:'initial',generatedAt:'2026-10-21T16:00:00.000Z',coverage:{state:'complete',gaps:[]},projects:[{id:'studio',repoId:100,repo:'acme/studio',name:'Acme Studio',tagline:'Publishing, made reliable.',stack:['node','web'],version:'0.8.32',revision:'b'.repeat(40),readAt:'2026-10-21T15:59:00.000Z',state:'complete',gaps:[],planning:{source:'files',built:8,total:12,livedIn:3,headline:'Make publishing reliable on every screen',goals:[],next:'Review publishing on a phone'},decisions:[decision],walks:[walk],waiting:[waiting],changes:[]}],decisions:[decision],walks:[walk],waiting:[waiting],changes:[{id:'change-one',projectId:'studio',projectName:'Acme Studio',title:'Publish from a phone',date:'2026-10-21',revision:'b'.repeat(40),link:'https://github.com/acme/studio/commit/abc',kind:'commit',media:null,previewUrl:null,acceptance:'not established'}],quota:{remaining:150,resetAt:'2026-10-21T17:00:00.000Z',state:'known'}};
}
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
test('Home prioritizes decisions, ready walks, changes, projects and waiting without mutating its snapshot', () => {
  const data=freeze(snapshot()), before=JSON.stringify(data), html=homeView(access,data);
  const positions=['Decisions that need you','Ready to test','Recently added','Your projects','In progress / waiting'].map(title => html.indexOf(`>${title}</h2>`));
  assert.ok(positions.every(p=>p>0)); assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
  assert.match(html,/Does publishing work\?/); assert.match(html,/Open walk instructions ↗/);
  assert.match(html,/8 \/ 12 built · 3 lived-in/); assert.match(html,/Review publishing on a phone/);
  assert.equal(JSON.stringify(data),before); assert.match(html,/data-record="action-decision-one"/);
  assert.match(html,/data-cursor="a{64}"/); assert.match(html,/data-endpoint="\/api\/home"/);
  assert.match(html,/<script type="module" src="\/assets\/home-client.mjs"><\/script>/);
  assert.doesNotMatch(html,/<script(?![^>]*src=)|\sonclick=|\soninput=/);
});
test('missing coverage stays prominent outside filterable cards and never means no work', () => {
  const data=snapshot(); data.coverage={state:'partial',gaps:[{projectId:'studio',source:'GitHub milestones',reason:'Read unavailable'}]};
  data.decisions=[]; data.walks=[]; data.projects[0].state='unavailable'; data.projects[0].planning={source:'unknown',built:null,total:null,livedIn:null};
  const html=renderHomeSnapshot(data);
  assert.match(html,/Some sources need attention/); assert.match(html,/Acme Studio<\/strong> · GitHub milestones: Read unavailable/);
  assert.match(html,/No known items\. Incomplete sources may contain more/); assert.match(html,/Progress unavailable/);
  assert.match(html,/At least 0 known/); assert.doesNotMatch(html,/No decisions need you|0 \/ 0 built/);
  const coverage=html.match(/<section class="coverage[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(coverage,/data-filterable|hidden/); assert.ok(html.indexOf('Source coverage') < html.indexOf('Decisions that need you'));
});
test('all source text is escaped and only explicit HTTPS GitHub links become anchors', () => {
  const data=snapshot(), attack='<img src=x onerror="alert(1)">';
  data.decisions[0].title=attack; data.decisions[0].id='bad" onclick="alert(1)'; data.decisions[0].details.ask=attack;
  data.decisions[0].link='javascript:alert(1)'; data.changes[0].link='https://github.com.evil.test/acme';
  data.projects[0].name=attack; data.projects[0].repo='evil.test/repo';
  data.coverage={state:'partial',gaps:[{projectId:'studio',source:attack,reason:attack}]};
  const html=homeView({...access,workspace:{name:attack}},data);
  assert.doesNotMatch(html,/<img|href="javascript:|href="https:\/\/github\.com\.evil| onclick="/);
  assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html,/Source link unavailable/);
  for(const value of ['javascript:alert(1)','http://github.com/acme','https://github.com.evil.test/acme','https://fake:secret@github.com/acme','https://github.com:123/acme','//github.com/acme']) assert.equal(safeSourceLink(value),null);
  assert.equal(safeSourceLink('https://github.com/acme/studio/blob/main/README.md'),'https://github.com/acme/studio/blob/main/README.md');
});
test('changes disclose missing captures and acceptance instead of inventing product media', () => {
  const data=snapshot(), html=renderHomeSnapshot(data);
  assert.match(html,/No capture yet/); assert.match(html,/Human acceptance not established/);
  assert.doesNotMatch(html,/<img|<svg|<iframe|Try it|Start guided test|This works/);
  data.changes[0].acceptance='source claim'; assert.match(renderHomeSnapshot(data),/Source status claim; acceptance evidence stays with the project/);
});
test('waiting walks are never promoted to ready and project lens filters unrelated actions', () => {
  const data=snapshot(); data.walks.push({...action('not-ready','walk'),ready:false}); data.decisions.push(action('api-decision','decision','api'));
  const html=projectView({id:'studio',repo:'acme/studio'},access,data);
  assert.match(html,/data-endpoint="\/api\/projects\/studio\/home"/); assert.match(html,/Project context/);
  assert.doesNotMatch(html,/Acme walk not-ready|Acme decision api-decision/); assert.match(html,/Acme decision decision-one/);
});
test('empty/fallback pages, account controls, keyboard affordances and reduced-motion styles remain usable', () => {
  assert.match(homeView(access),/Projects you can access/); assert.match(projectView(access.projects[0],access),/Project connected/);
  assert.match(signinView('fake-csrf-acme'),/Continue with GitHub/); assert.match(errorView(401,'acme'),/Please sign in/);
  const html=homeView(access,snapshot()); assert.match(html,/aria-live="polite"/); assert.match(html,/Skip to content/);
  assert.match(html,/<label>Search this view<input type="search"/); assert.match(html,/<summary data-focus=/);
  assert.equal((html.match(/fake-csrf-acme/g)||[]).length,1); assert.match(html,/method="post" action="\/api\/auth\/logout"/);
  assert.match(styles,/@media\(max-width:400px\)/); assert.match(styles,/prefers-reduced-motion:reduce/);
});

test('system light and dark palettes keep normal text, muted context and source links legible', () => {
  assert.match(styles,/@media\(prefers-color-scheme:dark\)/);
  const roots=[...styles.matchAll(/:root\{([^}]+)\}/g)].map(match=>Object.fromEntries([...match[1].matchAll(/--([a-z-]+):([^;}]+)/g)].map(([,key,value])=>[key,value])));
  assert.equal(roots.length,2);
  const luminance=hex=>{ if(hex.length===4) hex='#'+[...hex.slice(1)].map(c=>c+c).join(''); const rgb=hex.slice(1).match(/../g).map(byte=>parseInt(byte,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4); return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722; };
  for(const palette of roots) for(const foreground of ['ink','muted','green']) {
    for(const background of ['paper','card']) {
      const a=luminance(palette[foreground]),b=luminance(palette[background]);
      assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${foreground} on ${background} meets normal text contrast`);
    }
  }
});

test('uncached projects show loading, never unavailable or empty action counts', () => {
  const data=snapshot();
  data.coverage={state:'partial',gaps:[]}; data.decisions=[]; data.walks=[]; data.waiting=[]; data.changes=[];
  Object.assign(data.projects[0],{state:'loading',planning:{source:'unknown',built:null,total:null,livedIn:null},readAt:null,revision:null,decisions:[],walks:[],waiting:[],changes:[]});
  const html=homeView(access,data);
  assert.match(html,/Loading project sources/); assert.match(html,/Loading sources/); assert.match(html,/Progress loading/);
  assert.match(html,/Decisions, walks and waiting items are loading/); assert.match(html,/Loading recent additions/);
  assert.match(html,/Awaiting the first project source read/);
  assert.doesNotMatch(html,/No known items|No recent additions|No decisions need you|0 decisions|0 ready walks|At least 0|Progress unavailable|Source coverage unavailable|No gaps reported/);
  const coverage=html.match(/<section class="coverage[\s\S]*?<\/section>/)[0]; assert.doesNotMatch(coverage,/data-filterable/);
});
test('a mixed cached and loading view keeps known human work and identifies pending reads separately', () => {
  const data=snapshot(); data.coverage={state:'partial',gaps:[]};
  data.projects.push({id:'api',repo:'acme/api',name:'Acme API',state:'loading',planning:{},decisions:[],walks:[],waiting:[],gaps:[]});
  const html=renderHomeSnapshot(data);
  assert.match(html,/Some project sources are loading/); assert.match(html,/Acme decision decision-one/);
  assert.match(html,/At least 1 known · more loading/); assert.match(html,/1 project is loading/);
});

test('automatic first-render eligibility excludes partial data and any real card in a loading view', () => {
  const data=snapshot();
  assert.equal(isLoadingOnly(data),false); assert.match(homeView(access,data),/data-initial-loading="false"/);
  data.decisions=[]; data.walks=[]; data.waiting=[]; data.changes=[];
  Object.assign(data.projects[0],{state:'loading',decisions:[],walks:[],waiting:[],changes:[]});
  assert.equal(isLoadingOnly(data),true); assert.match(homeView(access,data),/data-initial-loading="true"/);
  data.projects[0].state='partial'; assert.equal(isLoadingOnly(data),false);
  data.projects[0].state='loading'; data.decisions=[action('first','decision')]; assert.equal(isLoadingOnly(data),false);
  data.decisions=[]; data.projects[0].walks=[action('first-walk','walk')]; assert.equal(isLoadingOnly(data),false);
  data.projects=[]; assert.equal(isLoadingOnly(data),false);
});

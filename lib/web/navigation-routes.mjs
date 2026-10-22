// Browser-safe HTML destinations. No private form data or arbitrary redirects.
const slug = '[a-z][a-z0-9-]{0,63}', hex = '[a-f0-9]{64}';
const isSlug = s => new RegExp(`^${slug}$`).test(s);
const isHex = s => new RegExp(`^${hex}$`).test(s);
const cursor = s => /^[A-Za-z0-9_-]{1,4096}$/.test(s);
const page = s => /^[1-9][0-9]{0,4}$/.test(s) && Number(s) <= 10000;
const date = s => /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
const routine = s => /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(s) && s.length<=240;
const states = ['queued','requested','waiting','running','succeeded','failed','cancelled','skipped','unknown'];
const sourcePath = s => s.length<=500 && !/[\x00-\x1f\\:%#]/.test(s) && s.split('/').every(p=>p&&!['.','..'].includes(p));
export function describeRoute(value) {
  if(typeof value!=='string'||value.length>8192||!value.startsWith('/')||value.startsWith('//')||/[\x00-\x20\\#]/.test(value))return null;
  let url,decoded;try {url=new URL(value,'https://keel.invalid');decoded=decodeURIComponent(value.split('?')[0]);}catch{return null;}
  if(url.origin!=='https://keel.invalid'||url.pathname!==value.split('?')[0]||decoded.split('/').some(p=>['.','..'].includes(p))||/[\x00-\x1f\\]/.test(decoded))return null;
  const match=url.pathname.match(new RegExp(`^/projects/(${slug})(/.*)?$`));
  const projectId=match?.[1]??null,tail=match?(match[2]||'/'):url.pathname;
  let destination=null,detail=false,allowed={};
  if(tail==='/') {destination='home';allowed={cursor,fresh:s=>s==='1'};}
  else if(['/daily','/learning','/connections','/routines','/activity','/jobs','/versions','/model-policy','/capabilities'].includes(tail)) {
    destination=tail.slice(1);
    if(destination==='daily'&&projectId)allowed={date};
    if(['routines','activity'].includes(destination))allowed={days:s=>/^\d{1,2}$/.test(s)&&Number(s)>=1&&Number(s)<=90,status:s=>states.includes(s),routine:s=>routine(s)||['night','cli-stalls','web-decision','web-walk','web-migration','web-media'].includes(s),page,project:isSlug,...(projectId?{receiptsAfter:cursor}:{projectPage:page,migrationAfter:cursor})};
    if(destination==='jobs')allowed=projectId?{after:cursor}:{projectPage:page};
    if(destination==='versions'&&!projectId)allowed={projectPage:page};
    if(destination==='capabilities')allowed={q:s=>s.length<=120&&!/[\x00-\x1f]/.test(s)};
  } else if(tail==='/recovery'&&!projectId)destination='recovery';
  else if(tail==='/setup'&&!projectId)destination='setup';
  else if(projectId&&new RegExp(`^/night-plan/operations/${hex}$`).test(tail)){destination='daily';detail=true;}
  else if(projectId&&new RegExp(`^/night-retries/${hex}$`).test(tail)){destination='activity';detail=true;}
  else if(projectId&&tail==='/night-retries'){destination='activity';detail=true;allowed={run:s=>/^[1-9][0-9]{0,15}$/.test(s)&&Number.isSafeInteger(Number(s)),attempt:s=>/^[1-9][0-9]{0,8}$/.test(s)&&Number.isSafeInteger(Number(s))};}
  else if(projectId&&tail==='/model-tasks'){destination='model-tasks';allowed={phase:s=>/^docs\/phases\/\d+-[a-z0-9-]+\.md$/.test(s),after:isHex};}
  else if(projectId&&/^\/(walks|changes)(?:\/[a-z][a-z0-9-]{0,63})?$/.test(tail)){destination=tail.split('/')[1];detail=tail.split('/').length===3;}
  else if(projectId&&tail==='/media'){destination='media';allowed={after:isHex,request:isHex,change:isSlug};detail=url.searchParams.has('request')||url.searchParams.has('change');}
  else if(projectId&&new RegExp(`^/media/(?:receipts/)?${hex}$`).test(tail)){destination='media';detail=true;}
  else if(projectId&&tail==='/decisions'){destination='home';detail=true;allowed={kind:s=>['health','shaping'].includes(s),path:sourcePath,question:isSlug};}
  else if(projectId&&new RegExp(`^/(operations|jobs|model-tasks)/${hex}$`).test(tail)){destination=tail.split('/')[1]==='operations'?'home':tail.split('/')[1];detail=true;}
  else if(projectId&&/^\/activity\/actions\/[1-9][0-9]{0,15}\/attempts\/[1-9][0-9]{0,15}$/.test(tail)) {destination='activity';detail=true;allowed={jobsPage:page,artifactsPage:page,days:s=>/^\d{1,2}$/.test(s)&&Number(s)>=1&&Number(s)<=90,status:s=>states.includes(s),routine:s=>routine(s)||['night','cli-stalls','web-decision','web-walk','web-migration','web-media'].includes(s),project:isSlug,page};if(!tail.split('/').filter(s=>/^\d+$/.test(s)).every(s=>Number.isSafeInteger(Number(s))))return null;}
  else if(projectId&&tail.startsWith('/routines/')){let r;try{r=decodeURIComponent(tail.slice(10));}catch{return null;}if(!routine(r))return null;destination='routines';detail=true;}
  else if(new RegExp(`^/connections/${slug}$`).test(tail)){destination='connections';detail=true;}
  else if(!projectId&&new RegExp(`^/(connections|learning|model-policy)/operations/${hex}$`).test(tail)){destination=tail.split('/')[1];detail=true;}
  else if(!projectId&&new RegExp(`^/connections/${slug}/requests/${hex}/(0|[1-9][0-9]{0,15})/${hex}/(set|remove)$`).test(tail)){destination='connections';detail=true;if(!Number.isSafeInteger(Number(tail.split('/')[5])))return null;}
  else if(!projectId&&new RegExp(`^/updates/(?:rollouts/)?${hex}$`).test(tail)){destination='versions';detail=true;}
  else if(!projectId&&/^\/learning\/trace\/lesson-[a-f0-9]{40}$/.test(tail)){destination='learning';detail=true;}
  if(!destination)return null;
  for(const [key,v] of url.searchParams)if(!Object.hasOwn(allowed,key)||url.searchParams.getAll(key).length!==1||!allowed[key](v))return null;
  if(destination==='media'&&tail==='/media'&&[...url.searchParams].length>1)return null;
  if(tail==='/night-retries'&&(!url.searchParams.has('run')||!url.searchParams.has('attempt')))return null;
  if(tail==='/decisions'&&(!url.searchParams.has('kind')||!url.searchParams.has('path')||(url.searchParams.get('kind')==='shaping'?!url.searchParams.has('question'):url.searchParams.has('question'))))return null;
  return {path:url.pathname+url.search,destination,projectId,detail,query:Object.fromEntries(url.searchParams)};
}
export function signInPath(value) {const route=describeRoute(value);return `/signin?returnTo=${encodeURIComponent(route?.path??'/')}`;}
export function lensRoute(value,projectId=null) {
  if(projectId!==null&&!isSlug(projectId))throw Error('invalid project lens');
  const route=describeRoute(value);let destination=route?.destination??'home';
  if(['setup','recovery'].includes(destination))projectId=null;
  const noFleetIndex=['walks','changes','media','model-tasks'].includes(destination)&&projectId===null;
  if(noFleetIndex)destination='home';
  let path=(projectId?`/projects/${projectId}`:'')+(destination==='home'?'':`/${destination}`);if(!path)path='/';
  const query=new URLSearchParams();
  for(const key of ['days','status'])if(['activity','routines'].includes(destination)&&route?.query[key])query.set(key,route.query[key]);
  if(destination==='daily'&&projectId&&route?.query.date)query.set('date',route.query.date);
  if(['activity','routines'].includes(destination)&&route?.projectId===projectId&&route?.query.routine)query.set('routine',route.query.routine);
  if(destination==='capabilities'&&route?.query.q)query.set('q',route.query.q);
  return {path:path+(query.size?`?${query}`:''),notice:noFleetIndex?'There is no fleet index for this project view. Opening all-project Home.':route?.detail?'This record stays in its original scope. Opening the selected view index.':null};
}

// Synthetic Acme immutable GitHub source responses; no remote operations.
import { walkHarness, walkDefinition } from './web-walks.mjs';
import { createChanges } from '../../lib/web/changes.mjs';
import { gitBlob } from '../../lib/web/decision-github.mjs';
export {token} from './web-decisions.mjs';
export const changeDefinition=()=>({version:1,id:'acme-search',title:'Find Acme things',outcome:'Search and open an Acme item.',kind:'ui',publishedAt:'2026-10-21',revision:'b'.repeat(40),paths:['artifacts/acme-result.txt'],pr:12,availability:{state:'preview',environment:walkDefinition().result.environment,observedAt:'2026-10-21T12:00:00Z',observedRevision:'b'.repeat(40),reason:'Acme author observed the preview.'},preview:{url:'https://preview.acme.test/search',reason:null},explore:['Search for Acme.','Open the result.'],walk:{id:'acme-search',reason:null},captures:[{id:'desktop-after',role:'after',revision:'b'.repeat(40),viewport:'desktop',scenario:'Acme search results',reason:'No desktop capture attached.'},{id:'mobile-after',role:'after',revision:'b'.repeat(40),viewport:'mobile',scenario:'Acme search results',reason:'No mobile capture attached.'}],nonvisual:null});
export function changesHarness(){
 const h=walkHarness();h.source.files['docs/changes/acme-search.json']=JSON.stringify(changeDefinition());h.source.changeRequests=[];
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path==='/graphql'){
   const body=JSON.parse(options.body),v=body.variables;
   if(body.query.startsWith('query Change')){
    h.source.changeRequests.push(body);if(h.source.changeDenied)return Response.json({}, {status:401});if(h.source.changeFail)return Response.json({errors:[{message:'Acme unavailable'}]});
    const repo={id:h.source.wrongChangeRepo?'R_wrong':h.source.repositoryNodeId,databaseId:h.source.repoId,nameWithOwner:h.source.repoName,isPrivate:h.source.private};
    if(body.query.startsWith('query ChangeSource'))return Response.json({data:{node:{...repo,defaultBranchRef:{id:h.source.branchNodeId,name:'main',repository:repo,target:{oid:h.source.head}}}}});
    const files=v.oid===h.source.head?h.source.files:h.source.revisions[v.oid],entries={};
    for(const [key,path] of Object.entries(v).filter(([key])=>/^p\d+$/.test(key))){const content=files?.[path];entries[key]=content===undefined?null:{oid:gitBlob(content),type:'blob',mode:33188};}
    return Response.json({data:{node:{...repo,commit:files?{oid:v.oid,repository:repo,...entries}:null}}});
   }
  }
  if(path==='/repos/acme/studio/commits')return Response.json([{sha:h.source.head,commit:{tree:{sha:'c'.repeat(40)},message:'Acme search',committer:{date:'2026-10-21T12:00:00Z'}}}]);
  return h.fetcher(url,options);
 };
 return {...h,fetcher,changes:createChanges(h.config,{fetcher,now:()=>h.state.now})};
}

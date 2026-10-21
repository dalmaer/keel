import { harness } from './web-http.mjs';
import { decisionDatabase } from './web-decision-store.mjs';
import { gitBlob } from '../../lib/web/decision-github.mjs';
import { createWebService } from '../../lib/web/server.mjs';
export const shapeRecord=()=>({version:1,id:'acme-shape',revision:1,date:'2026-10-21',goal:'G1',sources:[],questions:[{id:'choice',question:'What should Acme show?',whyOwner:'Owner preference changes the experience.',recommendation:{text:'Show exact matches.',evidence:['Synthetic Acme brief'],alternatives:['Show prefix matches.']}}],answers:[],proposedDecisions:[{id:'option',statement:'Exact matches first',scope:['phase:1'],supersedes:[]}],items:[{id:'search',kind:'phase',phase:1,title:'Acme search',problem:'Ordering unclear',scope:'Choose ordering',doneWhen:'Ordering matches choice',proof:['node --test tests/search.test.mjs'],depends:[],decisions:[],ownerPrerequisites:['choice'],surfaces:[]}]});
export function decisionHarness() {
 const h=harness(),db=decisionDatabase(()=>h.state.now),config={...h.config,decisionWrites:true};
 const state={repoId:102,repositoryNodeId:'R_acme_102',branchNodeId:'REF_acme_102_main',repoName:'acme/studio',refMissing:false,graphRequests:[],oldNameReads:0,head:'b'.repeat(40),private:false,push:true,mode:'success',writes:[],commits:[],hold:null,
  files:{'.keel/keel.json':JSON.stringify({name:'Acme Studio',repo:'acme/studio',practices:['shaping']}),'docs/health/2026-10-21.md':'# Acme health\n\n## Proposal\n\nImprove the Acme search order.\n\n## Notes\n\nKeep the original context.\n','design/acme-shape.json':JSON.stringify(shapeRecord())}};
 h.state.contentsPermission='write';
 const access={userId:1,contentsPermission:'write',workspace:{id:'acme',name:'Acme'},sourceRevision:'a'.repeat(40),projects:[{id:'studio',repoId:102,repo:'acme/studio'}]},project=access.projects[0];
 const fetcher=async(url,options)=>{
  const stored=db.handle(url,options);if(stored)return stored;
  const u=new URL(url),path=u.pathname;
  if(path==='/graphql'){
   const body=JSON.parse(options.body),vars=body.variables;state.graphRequests.push(body);
   const repo=()=>({id:state.repositoryNodeId,databaseId:state.repoId,nameWithOwner:state.repoName,isPrivate:state.private,viewerPermission:state.push?'ADMIN':'READ'});
   const commit=c=>c?{oid:c.sha,message:c.commit.message,parents:{totalCount:c.parents.length,nodes:c.parents.map(p=>({oid:p.sha}))},changedFilesIfAvailable:state.unknownChangedFiles?null:c.files.length,repository:state.wrongProofRepository?{id:'R_wrong',databaseId:999}:repo()}:null;
   if(body.query.startsWith('query DecisionRepository'))return Response.json({data:{node:vars.id===state.repositoryNodeId?{...repo(),defaultBranchRef:state.refMissing?null:{id:state.branchNodeId,name:'main',repository:repo(),target:{oid:state.head,tree:{oid:'c'.repeat(40)}}}}:null}});
   if(body.query.startsWith('query DecisionHistory'))return Response.json({data:{node:vars.id===state.branchNodeId&&!state.refMissing?{id:state.branchNodeId,name:'main',repository:state.wrongRefRepository?{id:'R_wrong',databaseId:999}:repo(),target:{history:{nodes:state.commits.map(commit)}}}:null}});
   if(body.query.startsWith('query DecisionCommitProof')){
    const c=state.commits.find(c=>c.sha===vars.oid),correctPath=vars.expression===`${vars.oid}:${c?.path}`;
    return Response.json({data:{node:vars.id===state.repositoryNodeId?{...repo(),commit:commit(c),blob:c&&correctPath?{oid:gitBlob(c.content),text:c.content,byteSize:Buffer.byteLength(c.content),isTruncated:false}:null}:null}});
   }
   const input=vars.input;state.writes.push(input);state.onDispatch?.();if(state.hold)await state.hold;
   if(state.mode==='refused'||input.branch.id!==state.branchNodeId||state.refMissing||input.expectedHeadOid!==state.head)return Response.json({data:{createCommitOnBranch:null},errors:[{type:'STALE_DATA'}]});
   if(state.mode==='never')throw Error('Synthetic uncertain transport');
   const file=input.fileChanges.additions[0],content=Buffer.from(file.contents,'base64').toString(),sha='d'.repeat(40);
   state.commits.unshift({sha,parents:[{sha:state.head}],commit:{message:`${input.message.headline}\n\n${input.message.body}`},files:[{filename:file.path,sha:gitBlob(content),status:'modified'}],path:file.path,content});state.head=sha;state.files[file.path]=content;
   if(state.mode==='lost')throw Error('Synthetic lost response after commit');
   return Response.json({data:{createCommitOnBranch:{commit:{oid:sha,url:`https://github.com/acme/studio/commit/${sha}`}}}});
  }
  if(path==='/repositories/102')return Response.json({id:state.repoId,node_id:state.repositoryNodeId,full_name:state.repoName,private:state.private,default_branch:'main',permissions:{push:state.push}});
  if(path.startsWith('/repos/acme/studio/')){
   if(state.repoName!=='acme/studio'){state.oldNameReads++;if(state.recycledCommits){
    if(path==='/repos/acme/studio/commits')return Response.json(state.recycledCommits);
    const c=state.recycledCommits.find(c=>c.sha===(u.searchParams.get('ref')??path.split('/').at(-1)));
    if(path.includes('/commits/'))return Response.json(c??{}, {status:c?200:404});
    if(path.includes('/contents/')&&c)return Response.json({type:'file',sha:gitBlob(c.content),encoding:'base64',content:Buffer.from(c.content).toString('base64')});
   }}
   if(path==='/repos/acme/studio/commits')return Response.json(state.commits);
   if(path==='/repos/acme/studio/commits/main')return Response.json({sha:state.head,commit:{tree:{sha:'c'.repeat(40)}}});
   if(path.startsWith('/repos/acme/studio/commits/'))return Response.json(state.commits.find(c=>c.sha===path.split('/').at(-1))??{}, {status:state.commits.length?200:404});
   if(path.includes('/git/trees/'))return Response.json({sha:'c'.repeat(40),truncated:false,tree:Object.entries(state.files).map(([path,content])=>({path,type:'blob',mode:'100644',sha:gitBlob(content),size:Buffer.byteLength(content)}))});
   if(path.includes('/git/blobs/')){const sha=path.split('/').at(-1),content=Object.values(state.files).find(v=>gitBlob(v)===sha);return Response.json({sha,encoding:'base64',size:Buffer.byteLength(content),content:Buffer.from(content).toString('base64')});}
   if(path.includes('/contents/')){const file=decodeURIComponent(path.split('/contents/')[1]),commit=state.commits.find(c=>c.sha===u.searchParams.get('ref'));if(!commit||file!==commit.path)return Response.json({}, {status:404});return Response.json({type:'file',sha:gitBlob(commit.content),encoding:'base64',content:Buffer.from(commit.content).toString('base64')});}
   throw Error(`Unexpected synthetic decision endpoint ${path}`);
  }
  return h.fetcher(url,options);
 };
 return {...h,config,fetcher,db,source:state,access,project,service:createWebService(config,{fetcher,now:()=>h.state.now})};
}
export const token='fake-user-access-token-for-tests';
export const healthTarget={kind:'health',path:'docs/health/2026-10-21.md'};
export const shapingTarget={kind:'shaping',path:'design/acme-shape.json',question:'choice'};

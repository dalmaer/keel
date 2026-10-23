import {dailyHarness} from './web-daily.mjs';
import {createNightPlan} from '../../lib/web/night-plan.mjs';
import {createDaily} from '../../lib/web/daily.mjs';
import {gitBlob} from '../../lib/web/decision-github.mjs';
export {token} from './web-decisions.mjs';
export const plan=()=>({schema:1,date:'2026-10-21',shapedBy:'owner',readyBy:null,willNotTouch:['Acme private data'],settledToday:['Acme owner choice'],leftOpen:[],items:[{id:'measures',title:'Measure Acme health',kind:'measure',source:'owner',number:null,lane:'night',budget:null,status:'planned',result:null}]});
export function nightPlanHarness() {
  const h=dailyHarness();h.source.files['docs/night/2026-10-21.json']=JSON.stringify(plan());
  const branch={head:'e'.repeat(40),files:{'.keel/night/plan.json':JSON.stringify(plan(),null,2)+'\n','keep.txt':'Acme unrelated branch file'}};
  h.source.branches['keel-night-plan']=branch;
  const state={ref:'REF_acme_keel-night-plan',writes:[],commits:[],open:[],incomplete:false,mode:'success',onRecheck:null,onDispatch:null};
  const repo=()=>({id:h.source.repositoryNodeId,databaseId:h.source.repoId,nameWithOwner:h.source.repoName,isPrivate:h.source.private,viewerPermission:h.source.push?'WRITE':'READ'});
  const ref=(id,name,head)=>({id,name,repository:repo(),target:{oid:head,tree:{oid:gitBlob(`Acme tree ${name}`)}}});
  const fetcher=async(url,options={})=>{
    if(new URL(url).pathname==='/graphql') {
      const {query,variables:v}=JSON.parse(options.body);
      if(query.startsWith('query DailyBranch')&&v.name==='refs/heads/keel-night-plan')return Response.json({data:{node:{...repo(),ref:h.source.branches['keel-night-plan']?ref(state.ref,'keel-night-plan',branch.head):null}}});
      if(query.startsWith('query NightPlanOpenPulls'))return Response.json({data:{node:{...repo(),pullRequests:{totalCount:state.open.length,nodes:state.open,pageInfo:{hasNextPage:state.incomplete,endCursor:state.incomplete?'Acme-more':null}}}}});
      if(query.startsWith('query NightPlanRecheck')) {
        state.onRecheck?.();
        return Response.json({data:{node:{...repo(),defaultBranchRef:ref(h.source.branchNodeId,'main',h.source.head),ref:h.source.branches['keel-night-plan']?ref(state.ref,'keel-night-plan',branch.head):null}}});
      }
      if(query.startsWith('query DecisionHistory')&&v.id!==h.source.branchNodeId)return Response.json({data:{node:v.id===state.ref&&h.source.branches['keel-night-plan']?{...ref(state.ref,'keel-night-plan',branch.head),target:{history:{nodes:state.commits}}}:null}});
      if(query.startsWith('query DecisionCommitProof')&&state.commits.some(c=>c.oid===v.oid)) {
        const commit=state.commits.find(c=>c.oid===v.oid),content=commit.content;
        return Response.json({data:{node:{...repo(),commit:{...commit,changedFilesIfAvailable:1,repository:repo()},blob:{oid:gitBlob(content),text:content,byteSize:Buffer.byteLength(content),isTruncated:false}}}});
      }
      if(query.startsWith('mutation')&&v.input?.fileChanges&&v.input.branch.id!==h.source.branchNodeId) {
        const input=v.input;state.writes.push(input);state.onDispatch?.();
        if(input.branch.id!==state.ref||input.expectedHeadOid!==branch.head||!h.source.branches['keel-night-plan'])return Response.json({data:{createCommitOnBranch:null},errors:[{type:'STALE_DATA'}]});
        if(state.mode==='unknown')throw Error('Acme lost dispatch');
        const file=input.fileChanges.additions[0],content=Buffer.from(file.contents,'base64').toString(),oid=gitBlob(`${input.expectedHeadOid}:${content}`);
        state.commits.unshift({oid,message:`${input.message.headline}\n\n${input.message.body}`,parents:{totalCount:1,nodes:[{oid:branch.head}]},content,before:{...branch.files}});
        branch.head=oid;branch.files[file.path]=content;
        if(state.mode==='lost')throw Error('Acme lost accepted response');
        return Response.json({data:{createCommitOnBranch:{commit:{oid}}}});
      }
    }
    return h.fetcher(url,options);
  };
  const config={...h.config,nightOperations:{planWrites:true,retryEnabled:false,verifiedAt:'2026-10-20T00:00:00.000Z',restoreReconciledAt:'2026-10-20T00:00:00.000Z',profiles:[]}};
  const options={fetcher,now:()=>h.state.now};
  return {...h,config,fetcher,branch,planState:state,daily:createDaily(config,options),nightPlan:createNightPlan(config,options)};
}
export async function previewPlan(h,date='2026-10-21') {
  const current=await h.daily.inspect(h.access,'Acme-token',h.project,date),value=date===plan().date?structuredClone(current.plan):structuredClone(current.capabilities.nightPlan.seed);
  value.leftOpen.push('Acme follow-up');
  return h.nightPlan.preview(h.access,'Acme-token',h.project,{date,sourceDigest:current.sourceDigest,plan:value});
}

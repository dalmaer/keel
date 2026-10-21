// Synthetic Acme provider transports composed beneath the actual authenticated routes.
import assert from 'node:assert/strict';
import {runReceiptsHarness,nightRecord,stallsRecord} from './web-run-receipts.mjs';
import {runsHarness,runFixture,jobFixture,artifactFixture} from './web-runs.mjs';
import {createWebService} from '../../lib/web/server.mjs';
export async function runsUiHarness({projectCount=4,receiptAt='2026-10-21T18:00:00Z'}={}) {
  const h=runReceiptsHarness();
  h.state.now=Date.parse('2026-10-21T19:00:00Z');
  const projects=Array.from({length:projectCount},(_,index)=>({id:index===0?'studio':`project-${index+1}`,repoId:102+index,repo:index===0?'acme/studio':`acme/project-${index+1}`}));
  const providers=projects.map((project,index)=>{
    const provider=runsHarness();provider.state.now=h.state.now;
    Object.assign(provider.source,{repoId:project.repoId,repoName:project.repo,repositoryNodeId:`R_acme_${project.repoId}`,branchNodeId:`REF_acme_${project.repoId}_main`});
    provider.source.files['docs/night/2026-10-21.json']=JSON.stringify(nightRecord());
    provider.source.files['.keel/test-runs/acme.json']=JSON.stringify(stallsRecord());
    provider.actions.runs=[runFixture({repository:{id:project.repoId},run_attempt:2,conclusion:index===0?'failure':'skipped'})];
    provider.actions.attempts.set('9001:1',runFixture({repository:{id:project.repoId},conclusion:'failure'}));
    provider.actions.jobs.set('9001:2',[jobFixture({run_attempt:2,conclusion:index===0?'failure':'skipped',steps:[{number:1,name:'Check Acme ordering',status:'completed',conclusion:'failure',started_at:'2026-10-21T10:00:00Z',completed_at:'2026-10-21T10:01:01Z'}]})]);
    provider.actions.artifacts.set(9001,[artifactFixture({expired:true,workflow_run:{id:9001,repository_id:project.repoId}})]);
    return provider;
  });
  const config={...h.config,decisionWrites:false,workspaceWrites:false,projectRepoIds:Object.fromEntries(projects.map(project=>[project.id,project.repoId]))};
  h.workspace.files['workspace.json']=JSON.stringify({version:1,id:'acme',name:'Acme workspace',repo:'acme/keel-private',projects:projects.map(({id,repo})=>({id,repo}))});
  const visited=[],capability={actionsPermission:'read'};
  const fetcher=async(url,options={})=>{
    const u=new URL(url),path=u.pathname;
    if(path==='/user/installations/21/repositories')return Response.json({total_count:projects.length+1,repositories:[{id:101,full_name:'acme/keel-private'},...projects.map(project=>({id:project.repoId,full_name:project.repo}))]});
    if(path==='/user/installations'){
      const response=await h.fetcher(url,options),value=await response.json();for(const installation of value.installations)installation.permissions.actions=capability.actionsPermission;return Response.json(value);
    }
    let index=projects.findIndex(project=>path===`/repositories/${project.repoId}`||path.startsWith(`/repositories/${project.repoId}/`)||path.startsWith(`/repos/${project.repo}/`));
    if(path==='/graphql'){
      const body=JSON.parse(options.body),id=body.variables.id??body.variables.input?.branch.id;
      index=providers.findIndex(provider=>[provider.source.repositoryNodeId,provider.source.branchNodeId].includes(id));
    }
    if(index>=0){
      const project=projects[index],provider=providers[index];visited.push(project.id);
      if(path===`/repositories/${project.repoId}`)u.pathname='/repositories/102';
      else if(path.startsWith(`/repositories/${project.repoId}/actions/`))u.pathname=path.replace(`/repositories/${project.repoId}/actions/`,'/repositories/102/actions/');
      else if(path.startsWith(`/repos/${project.repo}/`))u.pathname=path.replace(`/repos/${project.repo}/`,'/repos/acme/studio/');
      return provider.fetcher(u.href,options);
    }
    return h.fetcher(url,options);
  };
  const service=createWebService(config,{fetcher,now:()=>h.state.now});
  async function login(){
    const first=await service(h.request('/signin')),cookie=h.cookieHeader(first);
    const start=await service(h.request('/api/auth/start',{cookie,body:{csrf:cookie.split('=')[1],returnTo:'/activity'}}));assert.equal(start.status,303,await start.clone().text());
    const target=new URL(start.headers.get('location'));h.state.challenges.add(target.searchParams.get('code_challenge'));
    const done=await service(h.request(`/api/auth/callback?code=fake-code&state=${target.searchParams.get('state')}`,{cookie:h.cookieHeader(start)}));assert.equal(done.status,303,await done.clone().text());
    const sessionCookie=h.cookieHeader(done),session=await service(h.request('/api/session',{cookie:sessionCookie}));assert.equal(session.status,200,await session.clone().text());
    return {cookie:sessionCookie,session:await session.json()};
  }
  const receipt=await h.addOperation({state:'uncertain',at:receiptAt});
  h.state.now=Date.parse('2026-10-21T19:00:00Z');
  return {...h,config,projects,providers,visited,capability,fetcher,service,login,receipt};
}

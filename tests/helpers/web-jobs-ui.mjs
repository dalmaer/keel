// Actual hosted auth/jobs/OIDC routes; only external GitHub and SQL transports are synthetic.
import {generateKeyPairSync,sign} from 'node:crypto';
import {jobsHarness} from './web-jobs.mjs';
import {createWebService} from '../../lib/web/server.mjs';
export async function jobsUIHarness({schedule=false,enabled=true,afterRead=null}={}) {
  const h=await jobsHarness({schedule});
  const config=enabled?h.config:{...h.config,jobs:{...h.config.jobs,enabled:false}};
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'acme-worker-signing-key',use:'sig',alg:'RS256'};
  const fetcher=async(url,options={})=>{
    const u=new URL(url);
    if(u.href==='https://token.actions.githubusercontent.com/.well-known/jwks')return Response.json({keys:[jwk]});
    if(u.pathname==='/repositories/102/actions/workflows')return Response.json({total_count:1,workflows:[{id:501,name:'Acme typecheck',path:h.routineId,state:'active',html_url:`https://github.com/acme/studio/blob/${h.source.head}/${h.routineId}`}]});
    if(u.pathname==='/repositories/102/actions/runs')return Response.json({total_count:h.actions.runs.size,workflow_runs:[...h.actions.runs.values()].map(run=>({...run,path:h.routineId}))});
    const response=await h.fetcher(url,options);
    if(u.pathname==='/rest/v1/rpc/keel_job_rpc'&&['read','list','budget'].includes(JSON.parse(options.body).p_operation))await afterRead?.(h);
    return response;
  };
  const service=createWebService(config,{fetcher,now:()=>h.state.now});
  function jsonRequest(path,login,data={},headers={}) {
    return new Request(config.origin+path,{method:'POST',headers:{cookie:login.cookie,origin:config.origin,'content-type':'application/json',...headers},body:JSON.stringify({csrf:login.session.csrf,...data})});
  }
  function tokenFor(runId,overrides={}) {
    const identity=h.workerIdentity(runId),second=Math.floor(h.state.now/1000);
    const claims={iss:'https://token.actions.githubusercontent.com',aud:config.origin,iat:second,nbf:second,exp:second+300,sub:identity.subject,repository_id:String(identity.repositoryId),repository_owner_id:String(identity.repositoryOwnerId),actor_id:String(identity.actorId),repository:identity.repository,workflow_ref:identity.workflowRef,workflow_sha:identity.workflowSha,sha:identity.sha,ref:identity.ref,event_name:identity.eventName,run_id:String(runId),run_attempt:'1',...overrides};
    const input=[{alg:'RS256',kid:jwk.kid,typ:'JWT'},claims].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return `${input}.${sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url')}`;
  }
  function workerRequest(action,runId,input,claims={}) {
    return new Request(config.origin+`/api/workers/${action}`,{method:'POST',headers:{authorization:`Bearer ${tokenFor(runId,claims)}`,'content-type':'application/json'},body:JSON.stringify(input)});
  }
  async function previewRun(login) {
    const response=await service(jsonRequest(`/api/projects/studio/routines/${encodeURIComponent(h.routineId)}/preview`,login));
    if(response.status!==200)throw new Error(`Acme preview refused: ${await response.text()}`);
    return response.json();
  }
  return {...h,config,fetcher,service,jsonRequest,workerRequest,tokenFor,previewRun};
}

// Actual routes and signature verification; external GitHub/SQL transports are synthetic Acme.
import {generateKeyPairSync,sign} from 'node:crypto';
import {fleetUpdatesHarness} from './web-fleet-updates.mjs';
import {createWebService} from '../../lib/web/server.mjs';
export async function fleetUIHarness({afterRead=null}={}) {
  const h=await fleetUpdatesHarness(),{privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'acme-fleet',use:'sig',alg:'RS256'};
  const uiState={pullRequestsPermission:'write'};
  const fetcher=async(url,options={})=>{
    if(url==='https://token.actions.githubusercontent.com/.well-known/jwks')return Response.json({keys:[jwk]});
    const response=await h.fetcher(url,options);await afterRead?.({...h,uiState},url,options);
    if(new URL(url).pathname==='/user/installations'){const value=await response.json();for(const item of value.installations)item.permissions.pull_requests=uiState.pullRequestsPermission;return Response.json(value);}
    return response;
  };
  const service=createWebService(h.config,{fetcher,now:()=>h.state.now});
  const post=(path,login,data={},headers={})=>new Request(h.config.origin+path,{method:'POST',headers:{cookie:login.cookie,origin:h.config.origin,'content-type':'application/json',...headers},body:JSON.stringify({csrf:login.session.csrf,...data})});
  const worker=(action,runId,input)=>{
    const i=h.workerIdentity(runId),second=Math.floor(h.state.now/1000),claims={iss:'https://token.actions.githubusercontent.com',aud:h.config.origin,iat:second,nbf:second,exp:second+300,sub:i.subject,repository_id:String(i.repositoryId),repository_owner_id:String(i.repositoryOwnerId),actor_id:String(i.actorId),repository:i.repository,workflow_ref:i.workflowRef,workflow_sha:i.workflowSha,sha:i.sha,ref:i.ref,event_name:i.eventName,run_id:String(runId),run_attempt:'1'};
    const bytes=[{alg:'RS256',kid:jwk.kid,typ:'JWT'},claims].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
    const token=`${bytes}.${sign('RSA-SHA256',Buffer.from(bytes),privateKey).toString('base64url')}`;
    return new Request(h.config.origin+`/api/workers/${action}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(input)});
  };
  return {...h,uiState,fetcher,service,post,worker};
}

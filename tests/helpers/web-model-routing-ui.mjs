// Real authentication, source, routing and provider adapters with synthetic Acme transports.
import {modelHarness} from './web-model-tasks.mjs';
import {createWebService} from '../../lib/web/server.mjs';
export async function modelUIHarness({afterRead=null}={}) {
  const h=await modelHarness();
  const fetcher=async(url,options={})=>{const response=await h.fetcher(url,options);await afterRead?.(h,url,options);return response;};
  const service=createWebService(h.config,{fetcher,now:()=>h.state.now});
  const post=(path,login,data={},headers={})=>new Request(h.config.origin+path,{method:'POST',headers:{cookie:login.cookie,origin:h.config.origin,'content-type':'application/json',...headers},body:JSON.stringify({csrf:login.session.csrf,...data})});
  return {...h,fetcher,service,post};
}

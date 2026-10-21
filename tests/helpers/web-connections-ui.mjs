// Actual hosted service and authentication; only external transports are synthetic Acme fixtures.
import {connectionsHarness,policyInput,fakeKey} from './web-connections.mjs';
import {createWebService} from '../../lib/web/server.mjs';
export {policyInput,fakeKey};
export function connectionsUIHarness({enabled=true,afterMetadata=null}={}) {
  const h=connectionsHarness();
  const config=enabled?h.config:{...h.config,connections:null,connectionEncryptionKey:null};
  const fetcher=async(url,options={})=>{
    const response=await h.fetcher(url,options);
    if(new URL(url).pathname==='/rest/v1/rpc/keel_connection_rpc'&&JSON.parse(options.body).p_operation==='metadata')await afterMetadata?.(h);
    return response;
  };
  const service=createWebService(config,{fetcher,now:()=>h.state.now});
  function jsonRequest(path,login,data,{origin=config.origin}={}) {
    return new Request(new URL(path,config.origin),{method:'POST',headers:{cookie:login.cookie,origin,'content-type':'application/json'},body:JSON.stringify({csrf:login.session.csrf,...data})});
  }
  return {...h,config,fetcher,service,jsonRequest};
}

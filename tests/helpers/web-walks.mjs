// Synthetic Acme provider and encrypted draft RPC; SQL roles are proved separately.
import { decisionHarness, token } from './web-decisions.mjs';
import { createWalks } from '../../lib/web/walks.mjs';
import { createWebService } from '../../lib/web/server.mjs';
import { feedbackHash } from '../../lib/feedback.mjs';
import { parsePhase, render } from '../../practices/phases/files/scripts/roadmap.mjs';
export {token};
export const walkItem='⚑ by hand: the owner tries Acme search on desktop and mobile.';
export const phasePath='docs/phases/01-acme-search.md';
export const resultPath='artifacts/acme-result.txt';
export const resultBytes=Buffer.from('Acme search result, immutable build one.\n');
export const walkPhase=()=>`---
status: partial
since: 2026-10-21
goal: G0
depends: []
note: "Acme implementation is ready for the owner."
evidence: []
owes: walk
waits: owner
---

# Acme search

## Done when

The owner can find Acme matches.

## Scope

Search only.

## Acceptance

- [x] Search is covered by tests. \`tests/search.test.mjs\`
- [ ] ${walkItem}

## Proof

\`node --test tests/search.test.mjs\`

## Deliberately open

None.

## Next action

The owner tries search.

## Trajectory

*Nothing — the phase went as planned.*
`;
export const walkDefinition=()=>({version:1,id:'acme-search',title:'Try Acme search',target:{phase:phasePath,acceptanceHash:feedbackHash(walkItem)},readiness:{state:'ready',reason:'The Acme implementation is ready for an owner observation.'},result:{sourceRevision:'b'.repeat(40),artifactId:'acme-search',version:'build-one',contentHash:feedbackHash(resultBytes),path:resultPath,environment:'Acme preview, desktop and mobile',previewUrl:'https://preview.acme.test/search'},steps:[{id:'find',instruction:'Search for the Acme anvil.',expected:'Anvil appears in the results.',requires:[]},{id:'open',instruction:'Open the Acme anvil result.',expected:'The Acme anvil detail opens.',requires:['find']}]});
export function walkHarness(){
 const h=decisionHarness(),rows=new Map();h.state.now=Date.parse('2026-10-21T12:00:00Z');
 const cfg={name:'Acme Studio',repo:'acme/studio',practices:['phases','shaping']},goals=[{id:'G0',title:'Useful search',outcome:'The owner finds Acme things.'}];
 Object.assign(h.source.files,{'.plates/plates.json':JSON.stringify(cfg),'docs/goals.json':JSON.stringify(goals),[phasePath]:walkPhase(),[resultPath]:resultBytes,'docs/walks/acme-search.json':JSON.stringify(walkDefinition()),'docs/ROADMAP.md':render({config:cfg,phases:[parsePhase(phasePath.split('/').at(-1),walkPhase())],goals})});
 const fetcher=async(url,options)=>{
  if(new URL(url).pathname.endsWith('/rpc/keel_walk_rpc')){
   if(h.state.unavailable)throw Error('Synthetic private storage unavailable');
   const p=JSON.parse(options.body),row=rows.get(p.p_id),out=row=>row?{id:row.id,revision:row.revision,digest:row.digest,value:row.value}:null;
   if(p.p_operation==='read')return Response.json(row&&row.scope===p.p_scope&&row.project===p.p_project?out(row):null);
   if([...h.db.operations.values()].some(r=>r.project===p.p_project&&(['dispatched','uncertain'].includes(r.state)||r.state==='prepared'&&r.leaseUntil>h.state.now)))return Response.json({blocked:true});
   if(row?(row.scope!==p.p_scope||row.project!==p.p_project||row.revision!==p.p_expected):p.p_expected!==0)return Response.json({conflict:true});
   if(!row&&rows.size>=1000||[...rows.values()].reduce((n,r)=>n+Buffer.byteLength(r.value),0)-Buffer.byteLength(row?.value??'')+Buffer.byteLength(p.p_value)>52428800)return Response.json({capacity:true});
   const saved={id:p.p_id,scope:p.p_scope,project:p.p_project,revision:p.p_expected+1,digest:p.p_digest,value:p.p_value};rows.set(saved.id,saved);return Response.json(out(saved));
  }
  return h.fetcher(url,options);
 };
 return {...h,rows,fetcher,walks:createWalks(h.config,{fetcher,now:()=>h.state.now}),service:createWebService(h.config,{fetcher,now:()=>h.state.now})};
}

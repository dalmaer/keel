import { operationMarker } from './name-transition.mjs';
import { decideLegacyProposal, proposalOf } from '../board.mjs';
import { validateShape } from '../shaping.mjs';
import { healthDirOf } from '../../practices/night/files/scripts/plates/lib.mjs';
import { parseTimeProposal } from '../../practices/night/files/scripts/plates/time-proposals.mjs';
import { parseHygieneProposal } from '../../practices/night/files/scripts/plates/hygiene-proposals.mjs';
import { decisionContext } from '../../practices/reconciliation/files/scripts/plates/decision-context.mjs';
import { hash, random, WebError, record } from './common.mjs';
import { createDecisionGitHub, sourcePath } from './decision-github.mjs';
import { createOperationStore } from './operation-store.mjs';
const utf8 = data => new TextDecoder('utf-8',{fatal:true}).decode(data);
const inputText = (value,max=4000) => typeof value==='string' && value.trim() && value.length<=max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
export function decisionTarget(value) {
 if(!record(value)||Object.keys(value).some(k=>!['kind','path','question'].includes(k))||!['health','shaping'].includes(value.kind)||!sourcePath(value.path)||value.path.startsWith('.github/workflows/')
 ||(value.kind==='shaping'?!/^[a-z][a-z0-9-]{0,63}$/.test(value.question??''):value.question!==undefined))throw new WebError('invalid_target',400);
 return {...value};
}
export function createDecisions(config,{fetcher=fetch,now=Date.now}={}) {
 const store=createOperationStore(config,fetcher);
 async function inspect(access,token,project,target) {
  target=decisionTarget(target);
  const provider=createDecisionGitHub(token,{fetcher}), snapshot=await provider.snapshot(project),{reader}=snapshot;
  let raw,cfg; try {raw=utf8(await reader.readFile(target.path));cfg=JSON.parse(utf8(await reader.readFile(snapshot.entries.has('.plates/plates.json') ? '.plates/plates.json' : '.keel/keel.json')));} catch(error){throw error instanceof WebError?error:new WebError('invalid_source',400);}
  let question,shape=null,supported=true,reason=null,refs=[];
  if(target.kind==='health') {
   const dir=healthDirOf(cfg);if(!target.path.startsWith(`${dir}/`)||!/^\d{4}-\d{2}-\d{2}\.md$/.test(target.path.slice(dir.length+1)))throw new WebError('invalid_target',400);
   const p=proposalOf(raw),timing=parseTimeProposal(raw),hygiene=parseHygieneProposal(raw);
   supported=!!p&&!p.decided&&!timing.proposal&&!hygiene.proposal&&!timing.problems.length&&!hygiene.problems.length;
   reason=supported?null:'This proposal is missing, already decided, or requires its existing policy-bound writer.';
   question={title:'Decide this health proposal',body:p?.text??raw,choices:[{id:'accept',label:'Accept'},{id:'decline',label:'Decline'}],recommendation:null};
  } else {
   try{shape=validateShape(JSON.parse(raw));}catch{throw new WebError('invalid_shaping_record',400);}
   if(!cfg.practices?.includes('shaping'))throw new WebError('shaping_not_enabled',400);
   const q=shape.questions.find(q=>q.id===target.question);if(!q)throw new WebError('question_not_found',404);
   supported=!shape.answers.some(a=>a.question===q.id);reason=supported?null:'This question already has an answer; revision requires its existing source workflow.';
   question={title:q.question,body:q.whyOwner,choices:[],recommendation:q.recommendation};
   for(const path of [...shape.sources,...shape.questions.filter(q=>q.preview).map(q=>q.preview)]) await reader.readFile(path);
   refs=[...new Set([...shape.items.flatMap(w=>w.decisions.filter(d=>!d.startsWith('proposal:'))),...shape.proposedDecisions.flatMap(d=>d.supersedes)])];
  }
  // Same explicit-reference adapter used by inspectShape; its synthetic issue is not presented as a real issue.
  const bundle=await decisionContext({reader,issue:`${project.repo}#1`,issueBody:'```keel-impact\n'+JSON.stringify({version:1,decisions:refs})+'\n```'});
  const context={state:bundle.state,digest:bundle.digest,decisions:bundle.decisions,proposals:bundle.proposals,gaps:bundle.gaps};
  if(bundle.gaps.length){supported=false;reason='Required decision context is unavailable; resolve its gaps before submitting.';}
  const source={...snapshot.source,path:target.path,blob:snapshot.entries.get(target.path).sha,link:`https://github.com/${project.repo}/blob/${reader.revision}/${target.path.split('/').map(encodeURIComponent).join('/')}`};
  const model={schema:1,project:{...project,name:typeof cfg.name==='string'?cfg.name:project.id},source,target,question,context,supported,submissionEnabled:config.decisionWrites===true,reason};
  return {model,raw,shape,canWrite:snapshot.canWrite&&access.contentsPermission==='write',provider};
 }
 async function preview(access,token,project,input) {
  if(!record(input)||Object.keys(input).some(k=>!['target','choice','reason','answer'].includes(k)))throw new WebError('invalid_preview',400);
  const detail=await inspect(access,token,project,input.target),{model}=detail;
  if(!model.supported)throw new WebError('unsupported_decision',409);
  let content,consequence,choice;
  if(model.target.kind==='health') {
   if(!['accept','decline'].includes(input.choice)||input.answer!==undefined||input.reason!==undefined&&(typeof input.reason!=='string'||input.reason.length>4000))throw new WebError('invalid_choice',400);
   try{content=decideLegacyProposal(detail.raw,{decision:input.choice,reason:input.reason??'',today:new Date(now()).toISOString().slice(0,10)}).content;}catch{throw new WebError('invalid_choice',400);}
   choice=input.choice;consequence=`Record this proposal as ${choice==='accept'?'accepted':'declined'} with your reason. No phase, issue, pull request or workflow is created.`;
  } else {
   if(!inputText(input.answer)||input.choice!==undefined||input.reason!==undefined)throw new WebError('invalid_answer',400);
   const value=structuredClone(detail.shape);value.revision++;
   value.answers.push({question:model.target.question,actor:`GitHub user ${access.userId}`,role:'owner',time:new Date(now()).toISOString(),source:'Authenticated Plates web owner submission',text:input.answer.trim()});
   try{validateShape(value);}catch{throw new WebError('invalid_answer',400);}
   content=JSON.stringify(value,null,2)+'\n';choice=input.answer.trim();consequence='Append your authenticated owner answer and increment the shaping revision. Recommendations and proposed decisions remain unaccepted; no plan is generated.';
  }
  if(Buffer.byteLength(content)>262144)throw new WebError('output_limit',413);
  const id=hash(random()),commitMessage=`Record Plates ${model.target.kind==='health'?'proposal decision':'shaping answer'}`;
  const operationId=hash(`decision-operation:${id}`), fullMessage=`${commitMessage}\n\n${operationMarker(operationId)}`;
  const result={schema:1,id,operationId,operationUrl:`/projects/${project.id}/operations/${operationId}`,expiresAt:new Date(now()+900000).toISOString(),project:model.project,source:model.source,target:model.target,contextDigest:model.context.digest,choice,consequence,content,commitMessage:fullMessage,visibility:model.source.visibility,canSubmit:config.decisionWrites===true&&detail.canWrite,refusal:config.decisionWrites!==true?'Submission is disabled until the owner enables decision writes.':!detail.canWrite?'Current App and user Contents write permission is unavailable.':null};
  const stored={...result,actorId:access.userId,sourceRevision:access.sourceRevision,originalHash:hash(detail.raw),contextState:model.context.state};
  if(!await store.createPreview(id,store.scopeFor(access.userId,project),stored))throw new WebError('preview_conflict',409);
  return result;
 }
 return {inspect,detail:async(...args)=>(await inspect(...args)).model,preview};
}

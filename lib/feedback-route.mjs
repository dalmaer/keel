import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decisionContext } from '../practices/reconciliation/files/scripts/plates/decision-context.mjs';
import { validateRobotRubric } from '../practices/climb/files/scripts/plates/robot-rubric.mjs';
import { manualRobotIssueIdentity, previewRobotIssue, robotTargetPolicy } from './robot-issue.mjs';
import { validateShape } from './shaping.mjs';
import { fields, hashOK, refuse, feedbackRoute, feedbackProjects, digestOf, FEEDBACK_LIMITS } from './feedback.mjs';
const exec=promisify(execFile);
export async function feedbackWorkFact(work,{env=process.env,github,now=()=>new Date()}={}){
 if(!work||work.kind==='phase')return null;
 const [repo,number]=work.ref.split('#'),path=`/repos/${repo}/${work.kind==='pr'?'pulls':'issues'}/${number}`;
 try{
  let row;
  if(github){const r=await github({method:'GET',path});if(r?.status!==200)return null;row=r.data;}
  else{const response=await exec(env.PLATES_GH||env.KEEL_GH||'gh',['api','--method','GET',path],{env,timeout:10000,maxBuffer:256*1024});row=JSON.parse(response.stdout);}
  if(row.number!==Number(number)||row.html_url!==`https://github.com/${repo}/${work.kind==='pr'?'pull':'issues'}/${number}`||row.url!==`https://api.github.com${path}`||!['open','closed'].includes(row.state)||(work.kind==='issue'&&row.pull_request))return null;
  return {kind:work.kind,ref:work.ref,state:row.state,url:row.html_url,observedAt:new Date(now()).toISOString()};
 }catch{return null;}
}
export async function proposeFeedback({root,current,project=current.capture.project,previousProject,publication,env=process.env,github,now,adapter}){
 fields(publication,['schema','feedbackDigest','excerpt','destination','title','rubric','shaping'],['schema','feedbackDigest','excerpt','destination','title','rubric']);
 if(publication.schema!==1||!hashOK(publication.feedbackDigest)||publication.feedbackDigest!==current.digest)refuse('stale_publication');
 const record=current.capture;
 if(!feedbackProjects(project,previousProject).includes(record.project))refuse('invalid_capture');
 if(publication.destination!==project)refuse('destination_mismatch');
 if(typeof publication.excerpt!=='string'||!publication.excerpt.trim()||Buffer.byteLength(publication.excerpt)>4000||!record.words.includes(publication.excerpt))refuse('invalid_excerpt');
 const checked=validateRobotRubric(publication.rubric);if(!checked.ok)refuse('invalid_rubric');
 let shaping=null,shapeRefs=[];
 if(record.conflicts.length){
  if(publication.shaping===undefined)refuse('shaping_draft_required');
  try{shaping=validateShape(structuredClone(publication.shaping));}catch{refuse('invalid_shaping_draft');}
  shapeRefs=[...new Set([...shaping.items.flatMap(w=>w.decisions.filter(r=>!r.startsWith('proposal:'))),...shaping.proposedDecisions.flatMap(d=>d.supersedes)])];
  if(record.conflicts.some(c=>!shapeRefs.includes(c.ref)))refuse('shaping_conflict_reference_missing');
 }else if(publication.shaping!==undefined)refuse('unexpected_shaping_draft');
 const refs=[...new Set([...record.conflicts.map(c=>c.ref),...(checked.rubric.decisions??[]),...shapeRefs])];
 const context=adapter?await adapter.context(refs):await decisionContext({root,issue:`${project}#1`,issueBody:'```keel-impact\n'+JSON.stringify({version:1,decisions:refs})+'\n```'});
 if(context.gaps.length)refuse('decision_context_unavailable');
 // Resolve renamed work at its current destination while retaining the authored reference.
 const work=record.result.work,currentWork=work&&work.kind!=='phase'&&previousProject&&work.ref.startsWith(`${previousProject}#`)?{...work,ref:project+work.ref.slice(previousProject.length)}:work;
 const observed=adapter?await adapter.workFact(work):await feedbackWorkFact(currentWork,{env,github,now});
 const fact=!adapter&&observed&&currentWork!==work&&observed.ref===currentWork.ref?{...observed,ref:work.ref}:observed,route=feedbackRoute({work:record.result.work,fact,conflicts:record.conflicts,context});
 if(route.gaps.length)return {status:'unavailable',route,coverage:[...route.gaps],context:{state:context.state,digest:context.digest}};
 const links={source:`https://github.com/${record.project}/commit/${record.result.sourceRevision}`,result:record.result.url??null,work:fact?.url??null};
 if(route.kind==='reopen-decision'){
  if(typeof publication.title!=='string'||!publication.title.trim()||publication.title.length>240||/[\x00-\x1f<>]/.test(publication.title))refuse('invalid_title');
  const output={schema:1,status:'preview',feedbackId:current.id,feedbackDigest:current.digest,destination:project,excerpt:publication.excerpt,route,links,context:{state:context.state,digest:context.digest,decisionRefs:refs},outbound:{title:publication.title.trim(),body:JSON.stringify(shaping,null,2)+'\n',labels:[]},handoff:{kind:'shaping',record:shaping,command:['plates','shape','check','<reviewed-shaping-file>'],authorization:'separate-shaping-review-required',attribution:'manual-not-authenticated'},reopening:{kind:'shaping',decisionRefs:record.conflicts.map(c=>c.ref),excerpt:publication.excerpt,status:'proposed'},coverage:[]};
  if(Buffer.byteLength(JSON.stringify(output))>4*FEEDBACK_LIMITS.record)refuse('outbound_limit');
  return {...output,digest:digestOf({...output,route:{...route,fact:fact?{...fact,observedAt:undefined}:null}})};
 }
 const appendix=`\n\nSelected owner feedback (manual attribution):\n${publication.excerpt}\n\nReviewed result: ${record.result.artifactId} / ${record.result.version}\nSHA-256: ${record.result.contentHash}\nSource revision (attributed, not generation proof): ${links.source}${links.result?`\nResult: ${links.result}`:''}${links.work?`\nOriginal work: ${links.work}`:''}\nRouting proposal: ${route.kind}`;
 const normalized=validateRobotRubric({...checked.rubric,problem:checked.rubric.problem+appendix});if(!normalized.ok)refuse('outbound_limit');
 // A concurrent config change must not turn this local-only preview into a
 // foreign policy lookup. Delivery independently rechecks its actual target.
 const rubric=normalized.rubric,policy=adapter?await adapter.policy():await robotTargetPolicy({root,repo:project,github:async()=>({status:404})});
 const identity=manualRobotIssueIdentity(project,publication.title,rubric),preview=previewRobotIssue({repo:project,title:publication.title,rubric,policy,...identity});
 if(!preview.ok)refuse('invalid_issue_preview');
 const output={schema:1,status:'preview',feedbackId:current.id,feedbackDigest:current.digest,destination:project,excerpt:publication.excerpt,route,links,context:{state:context.state,digest:context.digest,decisionRefs:refs},outbound:{title:preview.title,body:preview.body,labels:preview.labels},handoff:{kind:'issue',repo:project,title:preview.title,rubric,...identity,command:['plates','issue','new','--agent','--title',preview.title,'--rubric','<reviewed-rubric-file>'],authorization:'separate-issue-approval-required'},reopening:null,coverage:[]};
 if(Buffer.byteLength(JSON.stringify(output))>FEEDBACK_LIMITS.record)refuse('outbound_limit');
 // Observed time is evidence; otherwise identical fresh facts retain proposal identity.
 const stableRoute={...route,fact:fact?{...fact,observedAt:undefined}:null};
 return {...output,digest:digestOf({...output,route:stableRoute})};
}

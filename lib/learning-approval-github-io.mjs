// Fresh bounded GitHub GETs only. No cache, receipt writes, mutation or provider activation.
import { createHash } from 'node:crypto';
import { ghJson, readRawReviews } from './review.mjs';
import { fingerprint, byteDigest, canonical } from './evaluation-records.mjs';
import { check, sha, id, pathName, validateLearningApproval } from './learning-approval-github.mjs';
const LIMITATIONS=['default-branch governance designates approvers; physical human action is not verified','current provider observations are not an atomic transaction or historical review-body proof','merge establishes source inclusion only; not deployment or efficacy'];
const gitHash=(type,bytes)=>createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
export function reader({env=process.env,deadline=Date.now()+30000}={}){
  check(Number.isFinite(deadline)&&deadline>Date.now()&&deadline<=Date.now()+120000,'invalid_deadline');let count=0,total=0;
  const get=async endpoint=>{check(++count<=256&&deadline>Date.now(),'request_bound');
    const value=await ghJson(env,['api','--hostname','github.com',endpoint],'learning approval',{timeout:Math.max(1,Math.min(10000,deadline-Date.now())),maxBuffer:4*1048576});
    total+=Buffer.byteLength(JSON.stringify(value));check(total<=32*1048576&&Date.now()<deadline,'response_bound');return value;};
  return {get,reviews:(repo,number)=>readRawReviews(env,{repo,number},async(_env,args)=>{const page=await get(args[1]);check(Array.isArray(page)&&page.length<=100,'invalid_review_page');return page;})};
}
async function commit(repo,oid,io){check(sha(oid),'invalid_commit_oid');const c=await io.get(`repos/${repo}/git/commits/${oid}`);check(c.sha===oid&&sha(c.tree?.sha)&&Array.isArray(c.parents)&&c.parents.length<=8&&c.parents.every(p=>sha(p.sha)),'invalid_commit');return c;}
async function tree(repo,oid,io){
  const t=await io.get(`repos/${repo}/git/trees/${oid}?recursive=1`);check(t.sha===oid&&t.truncated===false&&Array.isArray(t.tree)&&t.tree.length<=6000,'incomplete_tree');const map=new Map();
  for(const e of t.tree){check(pathName(e.path)&&!map.has(e.path)&&sha(e.sha)&&(['100644','100755','120000'].includes(e.mode)&&e.type==='blob'||e.mode==='040000'&&e.type==='tree'||e.mode==='160000'&&e.type==='commit'),'invalid_tree_entry');map.set(e.path,e);}
  // Rebuild every directory's native Git tree bytes; truncation or an omitted entry cannot pass.
  const dirs=new Map([['',[]]]);for(const e of map.values())if(e.type==='tree')dirs.set(e.path,[]);
  for(const e of map.values()){const cut=e.path.lastIndexOf('/'),parent=cut<0?'':e.path.slice(0,cut),name=e.path.slice(cut+1);check(dirs.has(parent),'missing_tree_parent');dirs.get(parent).push({...e,name});}
  for(const [path,entries] of dirs){entries.sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.type==='tree'?'/':'')),Buffer.from(b.name+(b.type==='tree'?'/':''))));const raw=Buffer.concat(entries.map(e=>Buffer.concat([Buffer.from(`${e.mode==='040000'?'40000':e.mode} ${e.name}\0`),Buffer.from(e.sha,'hex')])));check(gitHash('tree',raw)===(path?map.get(path).sha:oid),'tree_digest_mismatch');}
  return map;
}
async function blob(repo,entry,io,max=262144){
  check(entry?.type==='blob'&&entry.mode==='100644','nonregular_blob');const b=await io.get(`repos/${repo}/git/blobs/${entry.sha}`);
  check(b.sha===entry.sha&&b.encoding==='base64'&&typeof b.content==='string'&&Number.isSafeInteger(b.size)&&b.size>=0&&b.size<=max,'invalid_blob');
  const encoded=b.content.replace(/\n/g,''),bytes=Buffer.from(encoded,'base64');check(bytes.toString('base64')===encoded&&bytes.length===b.size&&gitHash('blob',bytes)===entry.sha,'blob_digest_mismatch');return bytes;
}
async function policyAt(repo,sourceSha,entries,io){
  const e=entries.get('.plates/plates.json');if(!e)return null;const bytes=await blob(repo,e,io,65536);let config;try{config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{check(false,'invalid_config');}
  check(config&&typeof config==='object'&&!Array.isArray(config),'invalid_config');if(!Object.hasOwn(config,'learning'))return null;
  check(config.learning&&typeof config.learning==='object'&&!Array.isArray(config.learning),'invalid_learning_config');if(!Object.hasOwn(config.learning,'approval'))return null;
  const approval=validateLearningApproval(config.learning.approval);return {sourceSha,blobOid:e.sha,byteDigest:byteDigest(bytes),digest:fingerprint(approval),approval};
}
export async function policyObservation(repo,io){
  const r=await io.get(`repos/${repo}`);check(id(r.id)&&typeof r.full_name==='string'&&r.full_name.toLowerCase()===repo.toLowerCase()&&pathName(r.default_branch),'repository_mismatch');repo=r.full_name;
  const ref=await io.get(`repos/${repo}/git/ref/heads/${encodeURIComponent(r.default_branch)}`);check(ref.ref==='refs/heads/'+r.default_branch&&ref.object?.type==='commit'&&sha(ref.object.sha),'invalid_default_ref');
  const c=await commit(repo,ref.object.sha,io),entries=await tree(repo,c.tree.sha,io),policy=await policyAt(repo,c.sha,entries,io),repository={id:r.id,fullName:repo,defaultBranch:r.default_branch,defaultSha:c.sha};
  return {schemaVersion:1,state:policy?'configured':'not-configured',repository,policy,sourceDigest:fingerprint({repository,policy}),limitations:LIMITATIONS};
}
function reviewObservation(reviews,e,pr,policy){
  check(Array.isArray(reviews)&&reviews.length<=2000,'review_bound');const seen=new Set(),latest=new Map(),types=new Map(),facts=[];
  for(const r of reviews){check(id(r.id)&&!seen.has(r.id)&&id(r.user?.id)&&['User','Bot'].includes(r.user.type)&&['APPROVED','CHANGES_REQUESTED','COMMENTED','DISMISSED','PENDING'].includes(r.state)&&sha(r.commit_id)&&r.pull_request_url===`https://api.github.com/repos/${pr.base.repo.full_name}/pulls/${e.prNumber}`,'invalid_review_membership');seen.add(r.id);check(!types.has(r.user.id)||types.get(r.user.id)===r.user.type,'ambiguous_reviewer_type');types.set(r.user.id,r.user.type);
    check(typeof r.body==='string'&&Buffer.byteLength(r.body)<=65536,'review_body_bound');
    if(r.state==='PENDING'){check(r.id!==e.reviewId,'pending_approval');continue;}
    check(typeof r.submitted_at==='string'&&Number.isFinite(Date.parse(r.submitted_at)),'invalid_review_time');
    if(!['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state))continue;
    const fact={id:r.id,userId:r.user.id,type:r.user.type,state:r.state,commit:r.commit_id,submittedAt:r.submitted_at,bodySha256:byteDigest(r.body)};facts.push(fact);
    if(r.state==='DISMISSED')continue;
    const prev=latest.get(r.user.id);if(!prev||Date.parse(r.submitted_at)>Date.parse(prev.submitted_at)||Date.parse(r.submitted_at)===Date.parse(prev.submitted_at)&&r.id>prev.id)latest.set(r.user.id,r);
  }
  check(![...latest.values()].some(r=>r.state==='CHANGES_REQUESTED'),'outstanding_changes_requested');
  const selected=reviews.find(r=>r.id===e.reviewId),marker=`plates-learning-approval-v1 ${e.action} sha256:${e.payloadDigest}`;
  check(selected&&selected.state==='APPROVED'&&latest.get(selected.user.id)?.id===selected.id&&selected.user.type==='User'&&policy.approval.ownerApproverIds.includes(selected.user.id)&&selected.user.id!==pr.user.id&&!facts.some(r=>r.userId===selected.user.id&&r.state==='DISMISSED'&&(Date.parse(r.submittedAt)>Date.parse(selected.submitted_at)||Date.parse(r.submittedAt)===Date.parse(selected.submitted_at)&&r.id>selected.id))&&selected.commit_id===pr.head.sha&&[marker,marker+'\n'].includes(selected.body)&&Date.parse(selected.submitted_at)<=Date.parse(pr.merged_at),'approval_unavailable');
  return {review:{id:selected.id,reviewerId:selected.user.id,reviewerType:'User',authorId:pr.user.id,state:'APPROVED',head:selected.commit_id,submittedAt:selected.submitted_at,bodySha256:byteDigest(selected.body)},decisiveDigest:fingerprint(facts.sort((a,b)=>a.id-b.id))};
}
export async function mergeObservation(e,io){
  const observed=await policyObservation(e.repo,io);check(observed.state==='configured','approval_not_configured');const {repository,policy}=observed,repo=repository.fullName;
  const pr=await io.get(`repos/${repo}/pulls/${e.prNumber}`);
  check(pr.number===e.prNumber&&pr.merged===true&&pr.state==='closed'&&typeof pr.merged_at==='string'&&Number.isFinite(Date.parse(pr.merged_at))&&id(pr.user?.id)&&pr.base?.repo?.id===repository.id&&pr.base.repo.full_name===repo&&pr.base.ref===repository.defaultBranch&&pr.base.sha===e.baseRevision&&sha(pr.head?.sha)&&sha(pr.merge_commit_sha),'merge_unavailable');
  const base=await commit(repo,e.baseRevision,io),head=await commit(repo,pr.head.sha,io),merged=await commit(repo,pr.merge_commit_sha,io);
  check(merged.parents.length===2&&merged.parents[0].sha===base.sha&&merged.parents[1].sha===head.sha&&merged.tree.sha===head.tree.sha,'unsupported_merge_topology');
  const before=await tree(repo,base.tree.sha,io),after=await tree(repo,head.tree.sha,io),basePolicy=await policyAt(repo,base.sha,before,io);
  check(basePolicy&&canonical(basePolicy.approval)===canonical(policy.approval),'base_policy_mismatch');
  const diff=[...new Set([...before.keys(),...after.keys()])].filter(p=>before.get(p)?.type!=='tree'||after.get(p)?.type!=='tree').filter(p=>{const a=before.get(p),b=after.get(p);return a?.sha!==b?.sha||a?.mode!==b?.mode||a?.type!==b?.type;}).sort();
  // New/removed directories are structural only; their child blobs remain in the complete diff.
  const leafDiff=diff.filter(p=>!(before.get(p)?.type==='tree'&&!after.has(p)||after.get(p)?.type==='tree'&&!before.has(p)));
  const changes=[...e.changes,{path:e.artifact.path,before:null,after:{mode:'100644',byteDigest:e.artifact.byteDigest,bytes:e.artifact.bytes}}];
  for(const p of diff.filter(p=>!leafDiff.includes(p)))check(changes.some(c=>c.path.startsWith(p+'/')),'unexpected_directory_delta');
  check(canonical(leafDiff)===canonical(changes.map(c=>c.path).sort()),'unexpected_tree_delta');
  const difference=[];
  for(const c of changes){for(const [entries,want] of [[before,c.before],[after,c.after]]){const entry=entries.get(c.path);if(want===null)check(!entry,'expected_absent_blob');else{const bytes=await blob(repo,entry,io,c.path===e.artifact.path?262144:65536);check(byteDigest(bytes)===want.byteDigest&&bytes.equals(Buffer.from(want.bytes)),'changed_blob_bytes');}}
    difference.push({path:c.path,before:before.get(c.path)?.sha??null,after:after.get(c.path)?.sha??null});}
  const {review,decisiveDigest}=reviewObservation(await io.reviews(repo,e.prNumber),e,pr,policy);
  const merge={prNumber:e.prNumber,baseRef:pr.base.ref,baseSha:base.sha,headSha:head.sha,mergeSha:merged.sha,parentShas:merged.parents.map(p=>p.sha),baseTree:base.tree.sha,headTree:head.tree.sha,mergeTree:merged.tree.sha,mergedAt:pr.merged_at,differenceDigest:fingerprint(difference.sort((a,b)=>a.path.localeCompare(b.path,'en')))};
  const body={schemaVersion:1,method:'github-learning-merge-v1',action:e.action,payloadDigest:e.payloadDigest,repository,policy,basePolicy,review,merge,artifact:{path:e.artifact.path,byteDigest:e.artifact.byteDigest,byteLength:Buffer.byteLength(e.artifact.bytes)},changesDigest:fingerprint(e.changes),limitations:LIMITATIONS};
  return {...body,observationDigest:fingerprint({body,decisiveDigest})};
}

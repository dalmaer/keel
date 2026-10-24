// Dormant provider verification: internal expected bytes are not a CLI authorization surface.
import { fingerprint, byteDigest, canonical } from './evaluation-records.mjs';
import { policyObservation, mergeObservation, reader } from './learning-approval-github-io.mjs';
export const check = (ok, code) => { if (!ok) throw Object.assign(new Error('learning approval: '+code), {code, exitCode:2}); };
export const exact = (v, keys) => check(v && Object.getPrototypeOf(v)===Object.prototype && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k)), 'invalid_fields');
export const sha = x => typeof x==='string' && /^[a-f0-9]{40}$/.test(x);
export const hash = x => typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
export const id = x => Number.isSafeInteger(x)&&x>0;
export const repoName = x => typeof x==='string' && /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9_.-]{0,99}$/i.test(x) && !x.endsWith('.git');
export const pathName = x => typeof x==='string'&&x.length>0&&x.length<=1024&&!/[\\:\x00-\x1f\x7f]/.test(x)&&x.split('/').every(p=>p&&p!=='.'&&p!=='..'&&p.toLowerCase()!=='.git');
const time = x => typeof x==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x)&&Number.isFinite(Date.parse(x));
const limits = v => check(Array.isArray(v)&&v.length<=8&&v.every(x=>typeof x==='string'&&x.length>0&&x.length<=512),'invalid_limitations');
export function validateLearningApproval(v) {
  exact(v,['schemaVersion','provider','ownerApproverIds']);check(v.schemaVersion===1&&v.provider==='github'&&Array.isArray(v.ownerApproverIds)&&v.ownerApproverIds.length>=1&&v.ownerApproverIds.length<=16&&v.ownerApproverIds.every(id)&&new Set(v.ownerApproverIds).size===v.ownerApproverIds.length,'invalid_approval_policy');return v;
}
function repository(v){exact(v,['id','fullName','defaultBranch','defaultSha']);check(id(v.id)&&repoName(v.fullName)&&pathName(v.defaultBranch)&&sha(v.defaultSha),'invalid_repository');}
function policy(v){exact(v,['sourceSha','blobOid','byteDigest','digest','approval']);check(sha(v.sourceSha)&&sha(v.blobOid)&&hash(v.byteDigest)&&hash(v.digest),'invalid_policy_binding');validateLearningApproval(v.approval);check(v.digest===fingerprint(v.approval),'policy_digest_mismatch');}
export function validateLearningPolicyObservation(v){
  exact(v,['schemaVersion','state','repository','policy','sourceDigest','limitations']);repository(v.repository);limits(v.limitations);
  check(v.schemaVersion===1&&['not-configured','configured'].includes(v.state)&&hash(v.sourceDigest),'invalid_policy_observation');
  if(v.state==='configured'){policy(v.policy);check(v.policy.sourceSha===v.repository.defaultSha,'policy_revision_mismatch');}else check(v.policy===null,'invalid_disabled_policy');
  check(v.sourceDigest===fingerprint({repository:v.repository,policy:v.policy}),'policy_source_digest_mismatch');return v;
}
function artifact(v){exact(v,['path','byteDigest','byteLength']);check(pathName(v.path)&&hash(v.byteDigest)&&Number.isSafeInteger(v.byteLength)&&v.byteLength>0&&v.byteLength<=262144,'invalid_artifact');}
export function validateLearningMergeObservation(v){
  exact(v,['schemaVersion','method','action','payloadDigest','repository','policy','basePolicy','review','merge','artifact','changesDigest','observationDigest','limitations']);
  check(v.schemaVersion===1&&v.method==='github-learning-merge-v1'&&['promote','rollback'].includes(v.action)&&[v.payloadDigest,v.changesDigest,v.observationDigest].every(hash),'invalid_merge_observation');repository(v.repository);policy(v.policy);policy(v.basePolicy);limits(v.limitations);artifact(v.artifact);
  check(v.policy.sourceSha===v.repository.defaultSha&&canonical(v.policy.approval)===canonical(v.basePolicy.approval),'approval_policy_changed');
  const r=v.review;exact(r,['id','reviewerId','reviewerType','authorId','state','head','submittedAt','bodySha256']);check([r.id,r.reviewerId,r.authorId].every(id)&&r.reviewerType==='User'&&r.state==='APPROVED'&&r.reviewerId!==r.authorId&&v.policy.approval.ownerApproverIds.includes(r.reviewerId)&&sha(r.head)&&time(r.submittedAt)&&hash(r.bodySha256),'invalid_review');
  const m=v.merge;exact(m,['prNumber','baseRef','baseSha','headSha','mergeSha','parentShas','baseTree','headTree','mergeTree','mergedAt','differenceDigest']);
  check(id(m.prNumber)&&m.baseRef===v.repository.defaultBranch&&[m.baseSha,m.headSha,m.mergeSha,m.baseTree,m.headTree,m.mergeTree].every(sha)&&Array.isArray(m.parentShas)&&m.parentShas.length===2&&m.parentShas[0]===m.baseSha&&m.parentShas[1]===m.headSha&&m.headTree===m.mergeTree&&m.headSha===r.head&&m.baseSha===v.basePolicy.sourceSha&&time(m.mergedAt)&&Date.parse(r.submittedAt)<=Date.parse(m.mergedAt)&&hash(m.differenceDigest),'invalid_merge_topology');
  check(v.artifact.path===`docs/evidence/learning-packages/${v.payloadDigest}.json`,'artifact_path_mismatch');
  const marker=`plates-learning-approval-v1 ${v.action} sha256:${v.payloadDigest}`;check([byteDigest(marker),byteDigest(marker+'\n')].includes(r.bodySha256),'approval_marker_mismatch');
  check(Buffer.byteLength(JSON.stringify(v))<=32768,'observation_bound');return v;
}
export function validateExpected(v){
  exact(v,['schemaVersion','repo','prNumber','reviewId','action','payloadDigest','baseRevision','artifact','changes']);check(v.schemaVersion===1&&repoName(v.repo)&&id(v.prNumber)&&id(v.reviewId)&&['promote','rollback'].includes(v.action)&&hash(v.payloadDigest)&&sha(v.baseRevision),'invalid_expected');
  exact(v.artifact,['path','byteDigest','bytes']);check(v.artifact.path===`docs/evidence/learning-packages/${v.payloadDigest}.json`&&typeof v.artifact.bytes==='string'&&Buffer.byteLength(v.artifact.bytes)<=262144&&byteDigest(v.artifact.bytes)===v.artifact.byteDigest,'invalid_expected_artifact');
  let payload;try{payload=JSON.parse(v.artifact.bytes);}catch{check(false,'invalid_package_json');}check(v.artifact.bytes===canonical(payload)+'\n'&&fingerprint(payload)===v.payloadDigest,'package_digest_mismatch');
  check(Array.isArray(v.changes)&&v.changes.length>0&&v.changes.length<=16,'change_bound');const paths=new Set([v.artifact.path,'.plates/plates.json']);let bytes=Buffer.byteLength(v.artifact.bytes);
  for(const c of v.changes){exact(c,['path','before','after']);check(pathName(c.path)&&!paths.has(c.path),'invalid_change_path');paths.add(c.path);check(c.before!==null||c.after!==null,'empty_change');check(c.after!==null||v.action==='rollback','deletion_not_allowed');
    for(const b of [c.before,c.after])if(b!==null){exact(b,['mode','byteDigest','bytes']);check(b.mode==='100644'&&typeof b.bytes==='string'&&Buffer.from(b.bytes).toString('utf8')===b.bytes&&Buffer.byteLength(b.bytes)<=65536&&byteDigest(b.bytes)===b.byteDigest,'invalid_expected_blob');bytes+=Buffer.byteLength(b.bytes);}
    check(c.before===null||c.after===null||c.before.byteDigest!==c.after.byteDigest,'unchanged_entry');
  }check(bytes<=1048576,'expected_bytes_bound');return v;
}
export async function inspectLearningApprovalPolicy(input,options={}){
  exact(input,['repo']);check(repoName(input.repo),'unsupported_repository');const io=reader(options),a=await policyObservation(input.repo,io),b=await policyObservation(input.repo,io);check(canonical(a)===canonical(b),'source_changed');return validateLearningPolicyObservation(a);
}
export async function verifyLearningMerge(expected,options={}){
  validateExpected(expected);const io=reader(options),a=await mergeObservation(expected,io),b=await mergeObservation(expected,io);check(canonical(a)===canonical(b),'source_changed');return validateLearningMergeObservation(a);
}

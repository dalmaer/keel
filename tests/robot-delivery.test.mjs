import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,chmod,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { robotGithub,robotAssociation,robotContinuation,robotContinuationOf,robotDeliveryMetadata,readRobotDelivery } from '../practices/night/files/scripts/keel/robot-delivery.mjs';
const repo='acme/anvils',headSha='a'.repeat(40),baseSha='b'.repeat(40);
const mark={repo,issueNumber:1,instanceId:'acme-1',author:'claude',headSha,cursor:0};
const pr={number:2,html_url:`https://github.com/${repo}/pull/2`,body:robotAssociation(mark),user:{type:'Bot',login:'github-actions[bot]'},state:'open',head:{sha:headSha,ref:'keel/robot-1',repo:{full_name:repo}},base:{sha:baseSha,repo:{full_name:repo}}};
test('robot delivery verifies repository issue instance and head, distinguishes ambiguous and unknown',async()=>{
 const read=(p=pr,rows=[{number:2}])=>readRobotDelivery({repo,issueNumber:1,instanceId:'acme-1',github:async({path})=>({status:200,data:path.includes('/pulls?')?rows:p})});
 assert.equal((await read()).state,'open');
 assert.equal((await read({...pr,merged_at:'2026-10-10T10:00:00Z',merge_commit_sha:'c'.repeat(40)})).state,'merged');
 assert.equal((await read({...pr,head:{...pr.head,sha:'c'.repeat(40)}})).state,'unknown');
 assert.equal((await read({...pr,body:'Closes #1'})).state,'missing');
 assert.equal((await read({...pr,user:{type:'User',login:'acme'}})).state,'unknown');
 assert.equal((await read(pr,[])).state,'missing');
 const ambiguous=await readRobotDelivery({repo,issueNumber:1,instanceId:'acme-1',github:async({path})=>({status:200,data:path.includes('/pulls?')?[{number:2},{number:3}]:{...pr,number:Number(path.split('/').at(-1)),html_url:`https://github.com/${repo}/pull/${path.split('/').at(-1)}`}})});
 assert.equal(ambiguous.state,'ambiguous');
});
test('robot gh transport uses actual HTTP include framing and bounded structured writes, never shell interpolation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'acme-robot-gh-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const gh=join(dir,'gh');await writeFile(gh,`#!${process.execPath}\nprocess.stdout.write('HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n'+JSON.stringify({permission:'admin',user:{login:'acme',type:'User'}}));\n`);await chmod(gh,0o755);
 const before=process.env.KEEL_GH;process.env.KEEL_GH=gh;t.after(()=>{if(before===undefined)delete process.env.KEEL_GH;else process.env.KEEL_GH=before;});
 const r=await robotGithub({method:'GET',path:`/repos/${repo}/collaborators/acme/permission`});assert.equal(r.status,200);assert.equal(r.data.permission,'admin');
 assert.equal((await robotGithub({path:`/repos/${repo}`})).status,200);
 await assert.rejects(robotGithub({method:'GET',path:'https://example.test/'}),/invalid/);
});

test('robot continuation delivery resolves canonical exact-head bot comments and retains public status shape',async()=>{
 const next='c'.repeat(40),authorization={receiptId:7,bodyHash:'d'.repeat(64),writer:'acme',policyHash:'e'.repeat(64)};
 const value={...mark,prNumber:2,headSha:next,cursor:12,authorization};
 const comment={id:8,user:pr.user,issue_url:`https://api.github.com/repos/${repo}/issues/2`,body:robotContinuation(value)+'Acme follow-up.'};
 const current={...pr,body:pr.body+'\nOwner description remains intact.',head:{...pr.head,sha:next}};
 const github=async({path})=>({status:200,data:path.includes('/pulls?')?[{number:2}]:path.includes('/comments?')?[comment]:current});
 assert.deepEqual(robotContinuationOf(comment.body),{version:1,repo,prNumber:2,issueNumber:1,instanceId:mark.instanceId,author:'claude',headSha:next,cursor:12,authorization});
 const metadata=await robotDeliveryMetadata({repo,pr:current,github});assert.equal(metadata.source,'comment');assert.deepEqual(metadata.authorization,authorization);assert.equal(metadata.association.headSha,next);
 const status=await readRobotDelivery({repo,issueNumber:1,instanceId:mark.instanceId,github});assert.equal(status.state,'open');assert.equal(status.pr.headSha,next);assert.deepEqual(Object.keys(status).sort(),['issue','pr','reasons','state']);
 assert.equal((await robotDeliveryMetadata({repo,pr:current,github,headSha})).source,'body');
 const invalid=[
  [],[{...comment,user:{type:'User',login:'github-actions[bot]'}}],
  [{...comment,issue_url:`https://api.github.com/repos/${repo}/issues/3`}],
  [{...comment,body:'Prefix\n'+comment.body}],
  [{...comment,body:comment.body+robotContinuation(value)}],
  [{...comment,body:robotContinuation({...value,prNumber:3})}],
  [{...comment,body:robotContinuation({...value,instanceId:'other'})}],
  [{...comment,body:robotContinuation({...value,author:'codex'})}],
  [{...comment,body:comment.body.replace('"version":1','"extra":true,"version":1')}],
  [comment,{...comment,id:9,body:robotContinuation({...value,cursor:13})}],
 ];
 for(const comments of invalid)await assert.rejects(robotDeliveryMetadata({repo,pr:current,github:async()=>({status:200,data:comments})}),/metadata/);
 await assert.rejects(robotDeliveryMetadata({repo,pr:current,github:async()=>({status:200,data:Array(100).fill(comment)})}),/coverage incomplete/);
 assert.equal((await robotDeliveryMetadata({repo,pr:current,github:async()=>({status:200,data:[comment,{...comment,id:9}]})})).association.headSha,next);
});

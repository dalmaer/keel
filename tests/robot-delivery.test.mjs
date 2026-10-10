import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,chmod,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { robotGithub,robotAssociation,readRobotDelivery } from '../practices/climb/files/scripts/keel/robot-delivery.mjs';
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

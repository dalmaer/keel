import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,rename,unlink} from 'node:fs/promises';
import {repairWorld} from './helpers/lesson-repair.mjs';
import * as promotion from '../lib/evaluated-learning-promotion.mjs';
import * as records from '../lib/evaluated-learning-promotion-records.mjs';
import {fingerprint} from '../lib/evaluation-records.mjs';
const {repairIdentity}=promotion;

test('Acme issue repair identity survives body edits, comment timestamps and closure',async t=>{
  const w=await repairWorld(t),repair={kind:'issue',ref:'Acme/widget#4'},original=await repairIdentity(w.options,repair);assert.equal(typeof original,'string');
  for(const change of [{body:'Acme clarified repair.'},{updated_at:'2026-10-24T01:00:00Z'},{state:'closed',updated_at:'2026-10-24T02:00:00Z'}]){
    await w.saveIssue({...w.issue,...change});assert.equal(await repairIdentity(w.options,repair),original,'ordinary repair issue progress must preserve the rollback work link');
  }
});
test('Acme phase repair identity survives source edits and completion',async t=>{
  const w=await repairWorld(t),repair={kind:'phase',ref:'1'},original=await repairIdentity(w.options,repair);assert.equal(typeof original,'string');
  for(const [state,note]of [['partial','Acme progress recorded'],['built','Acme checks recorded']]){
    await writeFile(w.phasePath,w.phase(state,note));assert.equal(await repairIdentity(w.options,repair),original,'ordinary phase progress must preserve the rollback work link');
  }
});


test('Acme repair observations retain current state separately and refuse replaced, missing or renamed identities',async t=>{
  const w=await repairWorld(t),r={kind:'issue',ref:'Acme/widget#4'},first=await promotion.readRepairObservation(w.options,r);
  assert.equal(first.state,'open');assert.equal(first.identity.issueId,73);
  for(const change of [{body:'Acme amended repair.'},{updated_at:'2026-10-24T01:00:00Z'},{state:'closed',updated_at:'2026-10-24T02:00:00Z'}]){
    await w.saveIssue({...w.issue,...change});const current=await promotion.readRepairObservation(w.options,r,first.identityDigest);
    assert.equal(current.identityDigest,first.identityDigest);assert.notEqual(current.sourceDigest,first.sourceDigest);assert.equal(current.state,change.state??'open');assert.equal(first.state,'open');
  }
  await w.saveIssue({...w.issue,id:74});await assert.rejects(promotion.readRepairObservation(w.options,r,first.identityDigest),/repair_identity_changed/);
  await w.saveIssue({...w.issue,html_url:'https://github.com/Acme/other/issues/4'});await assert.rejects(promotion.readRepairObservation(w.options,r,first.identityDigest),/repair_issue_unavailable/);
  await w.saveIssue(null);await assert.rejects(promotion.readRepairObservation(w.options,r,first.identityDigest),/could not be read/);
  const phase={kind:'phase',ref:'1'},original=await promotion.readRepairObservation(w.options,phase);assert.equal(original.state,'planned');
  for(const state of ['partial','built']){await writeFile(w.phasePath,w.phase(state,'Acme changed source'));const current=await promotion.readRepairObservation(w.options,phase,original.identityDigest);assert.equal(current.state,state);assert.notEqual(current.sourceDigest,original.sourceDigest);assert.equal(current.identityDigest,original.identityDigest);}
  const renamed=w.phasePath.replace('1-acme.md','1-renamed.md');await rename(w.phasePath,renamed);await assert.rejects(promotion.readRepairObservation(w.options,phase,original.identityDigest),/repair_identity_changed/);await unlink(renamed);await assert.rejects(promotion.readRepairObservation(w.options,phase,original.identityDigest),/repair_phase_missing_or_ambiguous/);
});
test('Acme repair observation schema refuses unknown fields, invalid identities and request mismatch',async t=>{
  const w=await repairWorld(t),original=await promotion.readRepairObservation(w.options,{kind:'phase',ref:'1'});records.validateRepairObservation(original);
  for(const mutate of [o=>o.accepted=true,o=>o.state='accepted',o=>o.identity.path='../escape',o=>o.identity.issueId=3,o=>o.identityDigest='0'.repeat(64),o=>o.sourceDigest=null,o=>o.ref='2']){const changed=structuredClone(original);mutate(changed);assert.throws(()=>records.validateRepairObservation(changed));}
  const sourceChanged={...original,state:'built',sourceDigest:'b'.repeat(64)};records.validateRepairObservation(sourceChanged);assert.equal(sourceChanged.identityDigest,fingerprint({kind:original.kind,repository:original.repository,ref:original.ref,identity:original.identity}));
});

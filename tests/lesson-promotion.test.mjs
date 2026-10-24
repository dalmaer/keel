import {parseProposal,inboxText} from '../lib/learn.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {promotionWorld} from './helpers/lesson-promotion.mjs';
import {ref,evaluationSection,seal,validateHistory,serializeEvaluation,replay} from '../lib/evaluated-lessons.mjs';
import {validatePromotionRecord,validateInverse} from '../lib/evaluated-learning-promotion-records.mjs';
import {fingerprint,byteDigest} from '../lib/evaluation-records.mjs';
import {artifactFor} from '../lib/evaluated-learning-package.mjs';
test('Acme original package operation recovers only while original report survives; duplicate content cannot replace it',async t=>{
  const w=await promotionWorld(t),operation=await w.call('record-package',{proposalRef:w.proposalRef,evaluationRef:ref(w.evaluation)},{previous:w.applied,apply:true});
  assert.equal((await w.learning.evaluatedLearning({...operation.opts,yes:true,digest:operation.preview.digest})).alreadyApplied,true);
  await assert.rejects(w.call('record-package',operation.request.payload,{previous:operation.result}),/package_already_recorded/);
  const reportPath=join(w.dir,'reports',w.evaluation.data.reportRef.digest+'.json');await unlink(reportPath);
  await assert.rejects(w.learning.evaluatedLearning({...operation.opts,yes:true,digest:operation.preview.digest}),/original_report_missing_or_changed/);
});
test('Acme follow-up selected source deduplicates and cannot invent exposure, cross-proposal decisions or unresolved relations',async t=>{
  const w=await promotionWorld(t),p={...w.followup,selections:w.capture.selections};
  const op=await w.call('follow-up',p,{previous:w.applied,apply:true}),history=evaluationSection(op.result.outputBytes).value,follow=history.records.at(-1);
  assert.equal(follow.data.sourceCoverage.selected,1);assert.equal(follow.data.sourceCoverage.distinctVerifiedIncidents,0);assert.equal(follow.data.sourceCoverage.unknownIncidentSources,1);assert.equal(history.records.filter(r=>r.kind==='learning-source').length,1);
  assert.equal((await w.learning.evaluatedLearning({...op.opts,yes:true,digest:op.preview.digest})).alreadyApplied,true);
  const forged=structuredClone(history),prior=forged.records.at(-1);forged.records[forged.records.length-1]=seal({...Object.fromEntries(Object.entries(prior).filter(([k])=>k!=='digest')),data:{...prior.data,eligibleExposure:0}});const e=forged.events.at(-1);forged.events[forged.events.length-1]=seal({...Object.fromEntries(Object.entries(e).filter(([k])=>k!=='digest')),recordRefs:[ref(forged.records.at(-1))]});assert.throws(()=>validateHistory(forged));
  await assert.rejects(w.call('follow-up',{...p,decisionRef:w.proposalRef},{previous:op.result}),/followup_wrong_decision/);
  await assert.rejects(w.call('follow-up',{...p,relation:{recordRef:{...w.proposalRef,digest:'e'.repeat(64)},relation:'related'}},{previous:op.result}),/unresolved_or_ambiguous/);
});
test('Acme stale package approval preserves inbox and report; rejected evidence remains packageable',async t=>{
  const w=await promotionWorld(t),p={proposalRef:w.proposalRef,evaluationRef:ref(w.evaluation)},preview=await w.call('record-package',p,{previous:w.applied});
  const before=await readFile(join(w.repo,'docs/inbox/2026-10-24-acme.md'));
  await assert.rejects(w.learning.evaluatedLearning({...preview.opts,yes:true,digest:'0'.repeat(64)}),/stale_learning_preview/);assert.deepEqual(await readFile(join(w.repo,'docs/inbox/2026-10-24-acme.md')),before);
  const rejected=(await w.call('reject',{evidenceRefs:[ref(w.evaluation)]},{previous:w.applied,apply:true})).result;assert.equal(rejected.status,'rejected');
  assert.equal((await w.learning.evaluatedLearning(w.packageOptions)).payload.disposition,'inconclusive');
  await assert.rejects(w.call('revise',{supersedesRef:w.proposalRef,proposal:w.proposal(w.lessonRef),scopeChangeReason:'Acme'},{previous:rejected}),/invalid_proposal_state/);
});
test('Acme inverse canonical identity and unique regular paths reject resealed tampering',()=>{
  const proposalRef={kind:'learning-proposal',id:'acme-proposal',version:1,digest:'a'.repeat(64)},promotionRef={kind:'learning-promotion',id:'acme-promotion',version:1,digest:'b'.repeat(64)},repairRef={kind:'phase',ref:'1'};
  const payload={schemaVersion:1,kind:'learning-inverse-package',originalPackageDigest:'c'.repeat(64),promotionRef,baseRevision:'d'.repeat(40),repairRef,changes:[{path:'acme-check.mjs',beforeDigest:'e'.repeat(64),afterDigest:null}]},a=artifactFor(payload),data={proposalRef,promotionRef,repairRef,repairDigest:'f'.repeat(64),payload,payloadDigest:a.payloadDigest,artifact:a.artifact};
  validatePromotionRecord('learning-rollback-request',data);
  for(const mutate of [d=>d.payloadDigest='0'.repeat(64),d=>d.artifact.byteLength++,d=>d.artifact.byteDigest='0'.repeat(64),d=>d.payload.changes[0].path='../escape',d=>d.payload.changes.push({...d.payload.changes[0]}),d=>d.payload.originalPackageDigest=null]){const d=structuredClone(data);mutate(d);assert.throws(()=>validatePromotionRecord('learning-rollback-request',d));}
  assert.throws(()=>validateInverse({...payload,approved:true}));
});

test('Acme PURE lifecycle supports reviewed inclusion, pending rollback, observed rollback and follow-up revision; not controller authorization',async t=>{
  const w=await promotionWorld(t),h=structuredClone(w.history);
  // Synthetic supported arithmetic for pure state validation ONLY. These bytes
  // are never stored, submitted to the controller, or called verified evidence.
  const prior=h.records.at(-1),data=structuredClone(prior.data);data.disposition='supported';data.reasons=[];
  for(const c of data.caseResults){for(const arm of ['baseline','candidate']){const a=c.arms[arm];a.currencyUsd={knownSubtotal:0,observed:a.attempts,denominator:a.attempts,complete:true,total:0,costPerAcceptedOutcome:a.accepted?0:null};}c.criteria.additionalCurrencyUsd={status:'passed',observed:0,threshold:0};if(c.role==='target'){c.arms.baseline.accepted--;c.arms.baseline.failed++;c.arms.baseline.failures={acceptance:1};c.discordant.baselineFailCandidatePass=1;c.criteria.targetNetGains={status:'passed',observed:1,threshold:1};}}
  const body=x=>Object.fromEntries(Object.entries(x).filter(([k])=>k!=='digest'));h.records[h.records.length-1]=seal({...body(prior),data});h.events[h.events.length-1]=seal({...body(h.events.at(-1)),recordRefs:[ref(h.records.at(-1))]});validateHistory(h);
  let active=w.proposalRef,state='evaluated';let serial=0;
  const append=(action,kind,d,to=state,{replacement=null,evidence=[]}={})=>{const n=++serial,id=String(n).padStart(12,'0'),r=seal({schemaVersion:1,kind,id:'acme-pure-'+n,version:1,data:d});h.records.push(r);h.events.push(seal({...body(h.events.at(-1)),id:'event-acme-'+n,operationId:'11111111-1111-4111-8111-'+id,sequence:h.events.length+1,previousDigest:h.events.at(-1).digest,action,from:state,to,recordRefs:[ref(r)],subjectRef:active,replacementRef:replacement==='new'?ref(r):replacement,evidenceRefs:evidence}));state=to;if(replacement==='new')active=ref(r);validateHistory(h);return r;};
  const artifact=artifactFor({schemaVersion:1,kind:'acme-pure-package'}),evaluationRef=ref(h.records.at(-1));
  const p=append('record-package','learning-review-package',{proposalRef:active,evaluationRef,payloadDigest:artifact.payloadDigest,artifact:artifact.artifact,readiness:{eligible:true,gaps:[]},verificationDigest:'a'.repeat(64)});
  const ready=append('ready','learning-readiness',{proposalRef:active,packageRef:ref(p),evaluationRef,verificationDigest:'b'.repeat(64)},'ready-for-review');
  const observation=(action,digest,artifact,base)=>{const head='1'.repeat(40),merge='2'.repeat(40),approval={schemaVersion:1,provider:'github',ownerApproverIds:[7]},policy={sourceSha:merge,blobOid:'3'.repeat(40),byteDigest:'4'.repeat(64),digest:fingerprint(approval),approval};return {schemaVersion:1,method:'github-learning-merge-v1',action,payloadDigest:digest,repository:{id:42,fullName:'Acme/widget',defaultBranch:'main',defaultSha:merge},policy,basePolicy:{...policy,sourceSha:base},review:{id:11,reviewerId:7,reviewerType:'User',authorId:8,state:'APPROVED',head,submittedAt:'2026-10-24T00:00:00Z',bodySha256:byteDigest(`plates-learning-approval-v1 ${action} sha256:${digest}`)},merge:{prNumber:1,baseRef:'main',baseSha:base,headSha:head,mergeSha:merge,parentShas:[base,head],baseTree:'5'.repeat(40),headTree:'6'.repeat(40),mergeTree:'6'.repeat(40),mergedAt:'2026-10-24T01:00:00Z',differenceDigest:'7'.repeat(64)},artifact,changesDigest:'8'.repeat(64),observationDigest:'9'.repeat(64),limitations:['Acme pure schema fixture; not source verification.']};};
  const assertLegacyProposed=()=>{
    // Pure synthetic history through the real serializer, legacy parser and
    // inbox renderer. No controller authorization or production acceptance.
    const prefix=evaluationSection(w.applied.outputBytes).prefix;
    const serialized=serializeEvaluation(prefix,h),parsed=parseProposal(serialized);
    assert.equal(parsed.meta.status,'proposed','source inclusion must not become legacy acceptance');
    assert.equal(replay(parsed.evaluation).state,'promoted');
    assert.deepEqual(parsed.evaluation,h,'explicit promotion and pending rollback history survives');
    const rendered=inboxText([{...parsed,slug:'acme-promoted',date:'2026-10-24'}]);
    assert.equal(rendered.counts.accepted,0);
    assert.equal(rendered.counts.proposed,1);
    assert.deepEqual(rendered.waiting.map(p=>p.slug),['acme-promoted']);
    assert.match(rendered.text,/\| accepted \| 0 \|/);
    assert.match(rendered.text,/\| proposed \| 1 \|/);
  };
  const promoted=append('promote','learning-promotion',{proposalRef:active,readinessRef:ref(ready),observation:observation('promote',artifact.payloadDigest,artifact.artifact,w.sha)},'promoted');
  assertLegacyProposed();
  const proposal=h.records.find(r=>r.kind==='learning-proposal'),repairRef={kind:'phase',ref:'1'},inverse={schemaVersion:1,kind:'learning-inverse-package',originalPackageDigest:p.data.payloadDigest,promotionRef:ref(promoted),baseRevision:promoted.data.observation.merge.mergeSha,repairRef,changes:proposal.data.candidate.patch.changes.map(c=>({path:c.path,beforeDigest:c.after.contentSha256,afterDigest:c.gitBase?.contentSha256??null}))},inverseArtifact=artifactFor(inverse);
  const pending=append('request-rollback','learning-rollback-request',{proposalRef:active,promotionRef:ref(promoted),repairRef,repairDigest:'a'.repeat(64),payload:inverse,payloadDigest:inverseArtifact.payloadDigest,artifact:inverseArtifact.artifact});assert.equal(state,'promoted');
  assertLegacyProposed();
  const bad=structuredClone(h),badRecord=bad.records.at(-1);badRecord.data.payload.originalPackageDigest='0'.repeat(64);const resealedArtifact=artifactFor(badRecord.data.payload);badRecord.data.payloadDigest=resealedArtifact.payloadDigest;badRecord.data.artifact=resealedArtifact.artifact;bad.records[bad.records.length-1]=seal(body(badRecord));bad.events[bad.events.length-1]=seal({...body(bad.events.at(-1)),recordRefs:[ref(bad.records.at(-1))]});assert.throws(()=>validateHistory(bad),/inverse_original_mapping_mismatch/);
  const rolled=append('observe-rollback','learning-rollback',{proposalRef:active,rollbackRequestRef:ref(pending),observation:observation('rollback',inverseArtifact.payloadDigest,inverseArtifact.artifact,inverse.baseRevision)},'rolled-back');
  const follow=append('follow-up','learning-follow-up',{proposalRef:active,decisionRef:ref(rolled),window:w.followup.window,sourceRefs:[],commentary:w.followup.commentary,relation:{recordRef:ref(promoted),relation:'related'},coverage:'unmeasured',eligibleExposure:null,recurrenceRate:null,costChange:null,latencyChange:null,helpChange:null,sourceCoverage:{selected:0,distinctVerifiedIncidents:0,unknownIncidentSources:0}});
  const n=++serial,r=seal({schemaVersion:1,kind:'learning-proposal',id:proposal.id,version:2,data:{...proposal.data,hypothesis:'Acme revised after follow-up.',supersedesRef:active}});h.records.push(r);h.events.push(seal({...body(h.events.at(-1)),id:'event-acme-'+n,operationId:'11111111-1111-4111-8111-'+String(n).padStart(12,'0'),sequence:h.events.length+1,previousDigest:h.events.at(-1).digest,action:'revise',from:'rolled-back',to:'proposed',recordRefs:[ref(r)],subjectRef:active,replacementRef:ref(r),evidenceRefs:[ref(follow)]}));validateHistory(h);
  const missing=structuredClone(h);missing.events[missing.events.length-1]=seal({...body(missing.events.at(-1)),evidenceRefs:[]});assert.throws(()=>validateHistory(missing),/revision_requires_followup/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {NAMES,labelWriter,labelNames,matchesLabel,readLabelReceipt,writeName} from '../lib/names.mjs';
const now=Date.parse('2026-10-24T12:00:00Z');
const context = row => ({id:row.id,repo:'acme/anvils',repositoryId:31,now,observation:{repo:'acme/anvils',repositoryId:31,complete:true,observedAt:new Date(now).toISOString(),labels:[{id:71,name:row.keel}]}});
const evidence = row => ({version:1,repositoryId:31,repo:'acme/anvils',renames:[{row:row.id,labelId:71,oldName:row.keel,newName:row.plates,operationId:'phase128:acme-1',verifiedAt:'2026-10-24T11:00:00Z',readback:{repositoryId:31,labelId:71,name:row.plates}}]});
for(const row of NAMES.filter(r=>r.surface==='label')) test(`label evidence ${row.id}: exact bindings and current facts`,()=>{
 const options=context(row);
 assert.equal(labelWriter(options),row.keel);
 assert.equal(writeName(row.id),row.keel,'generic writer cannot bypass repository evidence');
 assert.deepEqual(labelNames(row.id),[row.plates,row.keel]);
 for(const name of [row.plates,row.keel]) assert.equal(matchesLabel({name},row.id),true);
 options.observation.labels[0].name=row.plates;
 assert.throws(()=>labelWriter(options),/refused/);
 options.receipt=evidence(row);
 assert.equal(labelWriter(options),row.plates);
 const mutations=[
  o=>o.repo='acme/other', o=>o.repositoryId=32,
  o=>o.receipt.version=2, o=>o.receipt.repo='acme/other',o=>o.receipt.repositoryId=32,
  o=>o.receipt.renames[0].row='label:unknown', o=>o.receipt.renames[0].labelId=72,
  o=>o.receipt.renames[0].oldName='unknown', o=>o.receipt.renames[0].newName='unknown',
  o=>o.receipt.renames[0].operationId='', o=>o.receipt.renames[0].verifiedAt='unknown',
  o=>o.receipt.renames[0].verifiedAt='2026-10-25T12:00:00Z',
  o=>o.receipt.renames[0].readback.repositoryId=32,o=>o.receipt.renames[0].readback.labelId=72,o=>o.receipt.renames[0].readback.name=row.keel,
  o=>o.receipt.renames.push(structuredClone(o.receipt.renames[0])),
  o=>o.receipt.renames[0].state='uncertain',o=>o.observation.complete=false,
  o=>o.observation.observedAt='2026-10-24T11:58:59Z',o=>o.observation.observedAt='2026-10-25T12:00:00Z',
  o=>o.observation.repo='acme/other',o=>o.observation.repositoryId=32,
  o=>o.observation.labels[0].id=72, o=>o.observation.labels=[],
  o=>o.observation.labels.push({id:72,name:row.keel}),
  o=>o.observation.labels.push({...o.observation.labels[0]})
 ];
 for(const mutate of mutations){const bad=structuredClone(options);mutate(bad);assert.throws(()=>labelWriter(bad),/refused/,String(mutate));}
 assert.equal(labelWriter({...context(row),observation:{...options.observation,labels:[]}}),row.keel,'fresh adoption may select legacy without creating it');
 for(const labels of [[{id:71,name:row.keel},{id:72,name:row.plates}]]) assert.throws(()=>labelWriter({...context(row),observation:{...options.observation,labels}}),/refused/);
});
test('every label filter detects removal of either single name',async()=>{
 const source=await readFile(new URL('../practices/night/files/scripts/plates/names.mjs',import.meta.url),'utf8');
 for(const removed of ['plates','keel']) {
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(source.replace('return [row.plates, row.keel];',`return [row.${removed==='plates'?'keel':'plates'}];`)).toString('base64'));
  for(const row of NAMES.filter(r=>r.surface==='label')) {
   assert.equal(matchesLabel(row[removed],row.id),true);
   assert.equal(mutant.matchesLabel(row[removed],row.id),false);
  }
 }
});
test('fresh checkout reads committed receipt; local edits and untracked receipts refuse',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'acme-label-receipt-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const source=join(dir,'source'),clone=join(dir,'clone');await mkdir(source);
 const git=(cwd,args)=>execFileSync('git',args,{cwd,stdio:'pipe'});
 git(source,['init','-q']);git(source,['commit','-q','--allow-empty','-m','Acme initial']);
 assert.equal(await readLabelReceipt(source),null);
 const relative='.plates/name-transition/label-renames.json';await mkdir(join(source,'.plates/name-transition'),{recursive:true});
 const receipt=evidence(NAMES.find(r=>r.surface==='label')),text=JSON.stringify(receipt)+'\n';
 await writeFile(join(source,relative),text);
 await assert.rejects(readLabelReceipt(source),/committed evidence/);
 git(source,['add',relative]);git(source,['commit','-q','-m','Acme synthetic confirmed receipt']);
 git(dir,['clone','-q',source,clone]);assert.deepEqual(await readLabelReceipt(clone),receipt);
 await writeFile(join(clone,relative),text+' ');await assert.rejects(readLabelReceipt(clone),/committed evidence/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { decisionContext, refreshDecisionContext, decisionExitCode } from '../practices/reconciliation/files/scripts/keel/decision-context.mjs';
const ref = id => `docs/decisions/${id}.md#${id}`;
async function world(t, refs = [ref('old')]) {
  const root = await mkdtemp(join(tmpdir(), 'acme-decisions-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  for (const dir of ['docs/phases','docs/decisions','.keel']) await mkdir(join(root,dir),{recursive:true});
  await writeFile(join(root,'.keel/keel.json'),JSON.stringify({name:'Acme',repo:'acme/app'}));
  await writeFile(join(root,'docs/phases/00-acme.md'),`# Acme\n## Reconciliation\n\`\`\`keel-reconciliation\n${JSON.stringify({version:1,decisions:refs})}\n\`\`\`\n`);
  execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['commit','-qm','Acme'],{cwd:root});
  const put = async (id, extra = {}) => writeFile(join(root,`docs/decisions/${id}.md`),`<a id="${id}"></a>\n# ${id}\nAcme choice ${id}.\n\`\`\`keel-decision\n${JSON.stringify({version:1,id,status:'accepted',scope:['authored-data','cache'],decided_by:'Acme owner',decided_at:'2026-01-01',supersedes:[],superseded_by:[],...extra})}\n\`\`\`\n`);
  return {root,put,context:()=>decisionContext({root,phase:'0'})};
}
test('scoped replacement retains cache and a proposed successor displaces nothing',async t=>{
 const w=await world(t);await w.put('old',{superseded_by:[ref('new'),ref('proposal')]});
 await w.put('new',{scope:['authored-data'],supersedes:[ref('old')]});
 await w.put('proposal',{status:'proposed',scope:['cache'],supersedes:[ref('old')]});
 const b=await w.context();assert.equal(b.state,'complete',JSON.stringify(b.gaps));
 assert.deepEqual(b.decisions.map(d=>[d.ref,d.scope[0]]).sort(),[[ref('new'),'authored-data'],[ref('old'),'cache']]);
 assert.equal(b.proposals[0].ref,ref('proposal'));assert.deepEqual(b.decisions.find(d=>d.ref===ref('new')).chain,[ref('old'),ref('new')]);
});
test('unlinked successor in another file cannot hide missing reciprocal history',async t=>{
 const w=await world(t);await w.put('old');await w.put('new',{scope:['authored-data'],supersedes:[ref('old')]});
 const b=await w.context();assert.equal(decisionExitCode(b),1);assert.ok(b.gaps.some(g=>g.code==='missing-reciprocal'));
});
test('cycles and overlapping accepted successors refuse work',async t=>{
 const w=await world(t);await w.put('old',{superseded_by:[ref('new'),ref('other')]});
 for(const id of ['new','other'])await w.put(id,{supersedes:[ref('old')]});
 assert.ok((await w.context()).gaps.some(g=>g.code==='overlapping-successors'));
 await w.put('old',{supersedes:[ref('new')],superseded_by:[ref('new')]});await w.put('new',{supersedes:[ref('old')],superseded_by:[ref('old')]});
 assert.ok((await w.context()).gaps.some(g=>g.code==='decision-cycle'));
});
test('missing anchors, duplicate IDs, unsafe references and symlinks are explicit gaps',async t=>{
 const w=await world(t);await w.put('old');const path=join(w.root,'docs/decisions/old.md');
 const text=await readFile(path,'utf8');await writeFile(path,text.replace('<a id="old"></a>','# wrong').replace('# old','# other'));
 assert.equal((await w.context()).state,'unavailable');
 await writeFile(path,text+text);assert.ok((await w.context()).gaps.length);
 await rm(path);await symlink('/etc/passwd',path);assert.equal((await w.context()).state,'unavailable');
 const other=await world(t,['../outside.md#x']);assert.equal((await other.context()).state,'unavailable');
});
test('record, total-byte and supersession-hop bounds are incomplete coverage',async t=>{
 const w=await world(t);await w.put('old');
 await writeFile(join(w.root,'docs/decisions/huge.md'),'x'.repeat(2*1024*1024));assert.equal((await w.context()).state,'unavailable');await rm(join(w.root,'docs/decisions/huge.md'));
 for(let n=0;n<101;n++)await w.put(`r${n}`);
 assert.ok((await w.context()).gaps.some(g=>g.message.includes('100 records')));
 for(let n=0;n<101;n++)await rm(join(w.root,`docs/decisions/r${n}.md`));
 await w.put('old',{superseded_by:[ref('r0')]});
 for(let n=0;n<22;n++)await w.put(`r${n}`,{supersedes:[ref(n===0?'old':`r${n-1}`)],superseded_by:n===21?[]:[ref(`r${n+1}`)]});
 assert.ok((await w.context()).gaps.some(g=>g.code==='hop-bound'));
});
test('dispatch and resume refresh working-tree hashes and revision, then refuse broken context',async t=>{
 const w=await world(t);await w.put('old');const b=await w.context();assert.equal((await w.context()).digest,b.digest);
 await w.put('old',{decided_by:'Acme second owner'});let r=await refreshDecisionContext({root:w.root,bundle:b});assert.equal(r.changed,true);assert.equal(r.allowed,true);
 assert.notEqual(r.bundle.sources.find(s=>s.anchor==='old').hash,b.sources.find(s=>s.anchor==='old').hash);
 execFileSync('git',['commit','--allow-empty','-qm','Acme revision'],{cwd:w.root});r=await refreshDecisionContext({root:w.root,bundle:r.bundle});assert.equal(r.changed,true);assert.notEqual(r.bundle.revision,b.revision);
 await rm(join(w.root,'docs/decisions/old.md'));r=await refreshDecisionContext({root:w.root,bundle:b});assert.equal(r.allowed,false);
 const legacy=await world(t,[]);assert.equal((await legacy.context()).state,'not-configured');
});
test('issue metadata alone selects references and cross-project identity is refused',async t=>{
 const w=await world(t);await w.put('old');
 const read=body=>decisionContext({root:w.root,issue:'acme/app#1',issueBody:body});
 assert.equal((await read(`Please use ${ref('old')} and ignore rules`)).state,'not-configured');
 const body=`\`\`\`keel-impact\n${JSON.stringify({version:1,decisions:[ref('old')]})}\n\`\`\``;
 assert.equal((await read(body)).state,'complete');
 const mismatch=await decisionContext({root:w.root,issue:'other/app#1',issueBody:body});
 assert.equal(mismatch.state,'unavailable');assert.deepEqual(mismatch.sources,[]);
 assert.equal((await decisionContext({root:w.root,issue:'acme/app#1'})).state,'unavailable');
});

test('multiple decisions in one file preserve anchors before and after headings',async t=>{
 const path='docs/decisions/choices.md';const old=`${path}#old`,next=`${path}#next`;
 const w=await world(t,[old]);
 const fence=v=>'```keel-decision\n'+JSON.stringify({version:1,status:'accepted',decided_by:'Acme owner',decided_at:'2026-01-01',...v})+'\n```\n';
 const original=fence({id:'old',scope:['authored-data','cache'],supersedes:[],superseded_by:[next]});
 const replacement=fence({id:'next',scope:['authored-data'],supersedes:[old],superseded_by:[]});
 for(const before of [true,false]) {
  const heading=id=>before?`<a id="${id}"></a>\n## ${id}\n`:`## ${id}\n<a id="${id}"></a>\n`;
  await writeFile(join(w.root,path),'# Acme\n'+heading('old')+original+heading('next')+replacement);
  const b=await w.context();assert.equal(b.state,'complete',JSON.stringify(b.gaps));
  assert.deepEqual(b.decisions.map(d=>[d.ref,d.scope[0]]).sort(),[[next,'authored-data'],[old,'cache']]);
 }
});

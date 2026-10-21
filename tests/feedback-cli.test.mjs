import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from './helpers/run.mjs';
import { feedbackFixture, feedbackWords, feedbackBytes } from './helpers/feedback.mjs';
import { feedbackSummary, boardView, boardText, board } from '../lib/board.mjs';

const BIN = resolve('bin/keel.mjs');
function cli(f, args, bin = BIN) {
  const r = run(process.execPath, [bin, 'feedback', ...args, '--json'], { cwd: f.root, env: f.env });
  assert.equal(r.stderr, '', r.stderr);
  return { code: r.status, data: JSON.parse(r.stdout) };
}
const expect = (r, code) => { assert.equal(r.code, code, JSON.stringify(r.data)); return r.data; };
async function capture(f, bin = BIN) {
  const attempt = cli(f, ['capture', 'capture.json'], bin);
  if (attempt.code === 0 && attempt.data.status === 'unchanged') return attempt.data.item;
  const p = expect(attempt, 3);
  return expect(cli(f, ['capture', 'capture.json', '--yes', '--digest', p.digest], bin), 0).item;
}

test('feedback CLI grammar requires exact paired digests and rejects ignored or repeated flags', async t => {
  const f = await feedbackFixture(t);
  for (const args of [[], ['unknown'], ['capture'], ['capture','capture.json','--yes'], ['capture','capture.json','--digest','a'.repeat(64)], ['capture','capture.json','--yes','--digest','bad'], ['capture','capture.json','--digest','a'.repeat(64),'--digest','b'.repeat(64),'--yes'], ['list','extra'], ['list','--yes'], ['propose','a'.repeat(64)], ['propose','a'.repeat(64),'--record','publication.json','--yes'], ['resolve','a'.repeat(64),'--record'], ['capture','capture.json','--unknown']]) {
    expect(cli(f, args), 2);
  }
  await assert.rejects(readdir(join(f.root,'.keel/feedback')), {code:'ENOENT'});
});

test('fresh processes retain exact feedback, refuse stale capture and resolution, and report unavailable routing', async t => {
  const f = await feedbackFixture(t);
  const beforeExclude = await readFile(join(f.root,'.git/info/exclude'),'utf8');
  const p = expect(cli(f,['capture','capture.json']),3);
  assert.doesNotMatch(JSON.stringify(p), new RegExp(feedbackWords));
  assert.equal(await readFile(join(f.root,'.git/info/exclude'),'utf8'),beforeExclude);
  await assert.rejects(readdir(join(f.root,'.keel/feedback')), {code:'ENOENT'});
  f.record.words += ' Acme edited before approval.';await f.save('capture.json',f.record);
  expect(cli(f,['capture','capture.json','--yes','--digest',p.digest]),2);
  f.record.words = feedbackWords;await f.save('capture.json',f.record);
  const item = await capture(f);
  assert.equal(item.state,'pending');
  const listed = expect(cli(f,['list']),0);assert.equal(listed.items[0].id,item.id);
  assert.doesNotMatch(JSON.stringify(listed), /Acme private feedback|immutable preview with one row|preview\.txt/);
  const replay=await capture(f);assert.equal(replay.id,item.id);assert.equal(expect(cli(f,['list']),0).items.length,1);
  await rm(join(f.root,'preview.txt'));
  await f.save('publication.json',f.publication(item.digest));
  const proposal=expect(cli(f,['propose',item.id,'--record','publication.json']),3);
  assert.ok(JSON.stringify(proposal).includes('the second row is missing.'),'only explicit publication preview includes the chosen excerpt');
  await assert.rejects(readdir(join(f.root,'.keel/robot-issues')), {code:'ENOENT'});
  await f.save('resolution.json',f.resolution(item.digest));
  const resolution=expect(cli(f,['resolve',item.id,'--record','resolution.json']),3);
  const changed=f.resolution(item.digest);changed.reason='Acme changed the reason.';await f.save('resolution.json',changed);
  expect(cli(f,['resolve',item.id,'--record','resolution.json','--yes','--digest',resolution.digest]),2);
  await f.save('resolution.json',f.resolution(item.digest));
  const done=expect(cli(f,['resolve',item.id,'--record','resolution.json','--yes','--digest',resolution.digest]),0);
  assert.equal(done.item.state,'declined');assert.equal(expect(cli(f,['list']),0).items[0].state,'declined');
  // A different result with explicit remote work cannot use fabricated closure facts.
  f.record.result.version='v2';f.record.result.work={kind:'issue',ref:'acme/studio#12'};
  await writeFile(join(f.root,'preview.txt'),feedbackBytes);await f.save('capture.json',f.record);
  const remote=await capture(f);await f.save('publication.json',f.publication(remote.digest));
  const unavailable=expect(cli(f,['propose',remote.id,'--record','publication.json']),2);
  assert.match(JSON.stringify(unavailable), /unavailable|gap|unknown|route/i);
});

test('board projection is bounded metadata with safe resolution links and no private text or paths', async () => {
  const privateText='ACME_PRIVATE_SENTINEL', id='a'.repeat(64);
  const feedback=feedbackSummary({status:'ok',items:Array.from({length:35},(_,i)=>({id:i.toString(16).padStart(64,'0'),revision:1,state:i===34?'pending':'linked',words:privateText,result:{file:'/private/acme/path',anchor:privateText},gaps:[privateText],resolution:i!==34?{state:'linked',reference:'https://github.com/acme/studio/issues/12',reason:privateText}:null})),coverage:[privateText]});
  assert.equal(feedback.items.length,30);assert.equal(feedback.omitted,5);assert.equal(feedback.pending,1);assert.equal(feedback.items[0].state,'pending');
  const data={name:'Acme',today:'2026-10-21',items:[],sources:[],feedback};
  for(const text of [JSON.stringify(feedback),boardView().page(data),boardText(data)]) {
    assert.doesNotMatch(text,/ACME_PRIVATE_SENTINEL|\/private\/acme\/path/);
  }
  assert.match(boardView().page(data), /Feedback to review|Open resolution/);assert.match(boardText(data),/https:\/\/github.com\/acme\/studio\/issues\/12/);
  for(const reference of ['javascript:alert(1)','file:///private/acme','https://acme.test/path?secret=1','https://user:password@acme.test/path']) {
    assert.equal(feedbackSummary({status:'ok',items:[{id,state:'linked',resolution:{state:'linked',reference}}]}).items[0].resolution.reference,null);
  }
  assert.equal(feedbackSummary(null).state,'unavailable');
});

test('board reads persisted feedback metadata and keeps missing sources as coverage gaps', async t => {
  const f=await feedbackFixture(t);const item=await capture(f);
  const deps={env:f.env,roadmap:async()=>({phases:[],goals:[]}),looseEnds:async()=>({projects:[]}),reviews:async()=>({items:[],failed:[]}),robot:async()=>({})};
  const data=await board({root:f.root},deps);
  assert.equal(data.feedback.items[0].id,item.id);assert.equal(data.feedback.pending,1);
  assert.match(boardView().page(data),/Feedback to review/);assert.doesNotMatch(JSON.stringify(data),/Acme private feedback|preview\.txt/);
  const gap=await board({root:f.root},{...deps,feedback:async()=>{throw Error('/private/acme/secret');}});
  assert.equal(gap.feedback.state,'unavailable');assert.doesNotMatch(JSON.stringify(gap),/\/private\/acme\/secret/);
});

test('packed CLI in an adopted Acme repository preserves private capture and exposes shipped help without a checkout', async t => {
  const temp=await mkdtemp(join(tmpdir(),'acme-feedback-pack-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const packed=run('npm',['pack','--ignore-scripts','--json','--pack-destination',temp],{cwd:resolve('.')});assert.equal(packed.status,0,packed.stderr);
  const tar=run('tar',['-xzf',join(temp,JSON.parse(packed.stdout)[0].filename),'-C',temp]);assert.equal(tar.status,0,tar.stderr);
  const bin=join(temp,'package/bin/keel.mjs'), f=await feedbackFixture(t);
  await writeFile(join(f.root,'AGENTS.md'),'# Acme\n\nAcme owner guidance remains.\n');
  await writeFile(join(f.root,'acme.mjs'),'export const acme = true;\n');
  const adopted=run(process.execPath,[bin,'adopt','--check','node --check acme.mjs','--json'],{cwd:f.root,env:f.env});assert.equal(adopted.status,0,adopted.stdout+adopted.stderr);
  assert.match(await readFile(join(f.root,'AGENTS.md'),'utf8'),/Acme owner guidance remains/);
  const help=run(process.execPath,[bin,'--agent-help','feedback','--json'],{cwd:f.root,env:f.env});assert.equal(help.status,0);assert.match(JSON.parse(help.stdout).body ?? help.stdout,/feedback capture/);
  // Owner-authored input is ignored explicitly; only the store's ignore is Keel-owned.
  await writeFile(join(f.root,'.gitignore'),'capture.json\npublication.json\nresolution.json\npreview.txt\n');
  const item=await capture(f,bin);assert.equal(expect(cli(f,['list'],bin),0).items[0].id,item.id);
  await f.save('publication.json',f.publication(item.digest));expect(cli(f,['propose',item.id,'--record','publication.json'],bin),3);
  await f.save('resolution.json',f.resolution(item.digest,'linked'));
  const p=expect(cli(f,['resolve',item.id,'--record','resolution.json'],bin),3);
  expect(cli(f,['resolve',item.id,'--record','resolution.json','--yes','--digest',p.digest],bin),0);
  assert.equal(expect(cli(f,['list'],bin),0).items[0].state,'linked');
  f.git('add','.');const staged=f.git('diff','--cached','--name-only');assert.doesNotMatch(staged,/capture\.json|publication\.json|resolution\.json|preview\.txt|\.keel\/feedback/);
  const diff=f.git('diff','--cached');assert.doesNotMatch(diff,/Acme private feedback|immutable preview with one row/);
  f.record.words += ' Acme now sees another issue.';f.record.revision=2;f.record.previousDigest=expect(cli(f,['list'],bin),0).items[0].digest;
  await f.save('capture.json',f.record);
  expect(cli(f,['capture','capture.json','--yes','--digest','0'.repeat(64)],bin),2);
});

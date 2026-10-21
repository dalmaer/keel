import { renderShape } from './shaping-render.mjs';
// Local shaping: source records own choices; receipts own only reviewed output bytes.
import { readFile, readdir, lstat, realpath, mkdir, open, link, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { decisionContext, decisionExitCode } from '../practices/reconciliation/files/scripts/keel/decision-context.mjs';
import { validateRobotRubric, formatRobotRubric } from '../practices/climb/files/scripts/keel/robot-rubric.mjs';
import { parsePhase, specProblems, validateGraph, SURFACES } from '../practices/phases/files/scripts/roadmap.mjs';
const stable = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = x => createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : stable(x)).digest('hex');
const fail = message => { const error = new Error(message); error.exitCode = 2; throw error; };
const id = v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v);
const text = v => typeof v === 'string' && v.trim() && v.length <= 4000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const list = (v, max = 100) => Array.isArray(v) && v.length <= max;
const strings = (v, max = 100) => list(v, max) && v.every(text) && new Set(v).size === v.length;
const keys = (v, allowed) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !allowed.includes(k))) fail('unknown fields or invalid object'); };
// One physical line and no Markdown metacharacters: user data cannot become sections,
// front matter, links, fences, checkboxes, or active HTML. Encode raw characters
// once: processing an emitted entity again would corrupt the displayed words.
// Encode initial whitespace too, so standalone prose cannot be indented code.
const prose = s => String(s).replace(/[\r\n\u2028\u2029]/g, ' ').replace(/^[ \t]|[&<>"'\\`~*_{}\[\]()#+.!|:-]/g, c => `&#${c.charCodeAt(0)};`);
export const SHAPING_LIMITS = Object.freeze({ bytes: 262144, questions: 12, items: 20 });
export async function shapePath(root, path, createParents = false) {
  if (typeof path !== 'string' || path.length > 512 || !path || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f:]/.test(path)) fail('unsafe repository-relative path');
  let current = root;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    let stat;
    try { stat = await lstat(current); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (createParents && i < parts.length - 1) { await mkdir(current, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; }); stat = await lstat(current); }
      else continue;
    }
    if (stat && (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() && !stat.isDirectory()))) fail('symlink or unsafe path');
  }
  return current;
}
async function bounded(root, path, limit = SHAPING_LIMITS.bytes) {
  const file = await shapePath(root, path), stat = await lstat(file);
  if (!stat.isFile() || stat.size > limit) fail(`input exceeds bound or is not a file: ${path}`);
  const bytes = await readFile(file); if (bytes.length > limit) fail('input exceeds bound'); return bytes;
}
async function optional(root, path) { try { return await bounded(root, path, 4 * 1024 * 1024); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
// Publish complete bytes exclusively. A crash never leaves a partially written destination.
async function publish(root, path, bytes) {
  const file = await shapePath(root, path, true), temp = `${file}.${randomUUID()}.tmp`;
  const fd = await open(temp, 'wx', 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  try { await shapePath(root, path); await link(temp, file); }
  finally { await unlink(temp); }
  if (process.platform !== 'win32') { const dir = await open(dirname(file), 'r'); try { await dir.sync(); } finally { await dir.close(); } }
}
export function validateShape(r) {
  if (Buffer.byteLength(stable(r) ?? '') > SHAPING_LIMITS.bytes) fail('record exceeds 256 KiB');
  keys(r, ['version','id','revision','date','goal','sources','questions','answers','proposedDecisions','items']);
  if (r.version !== 1 || !id(r.id) || !Number.isSafeInteger(r.revision) || r.revision < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || new Date(r.date).toISOString().slice(0,10) !== r.date || !/^G\d+$/.test(r.goal)) fail('invalid version, ID, revision, date or goal');
  if (!strings(r.sources, 100) || !list(r.questions, 12) || !list(r.answers, 12) || !list(r.proposedDecisions, 100) || !list(r.items, 20) || !r.items.length) fail('invalid bounded lists');
  const unique = (rows, label) => { if (rows.some(q => !id(q.id)) || new Set(rows.map(q => q.id)).size !== rows.length) fail(`duplicate or invalid ${label} IDs`); };
  unique(r.questions,'question'); unique(r.items,'item'); unique(r.proposedDecisions,'proposal');
  for (const q of r.questions) {
    keys(q,['id','question','whyOwner','recommendation','preview']); keys(q.recommendation,['text','evidence','alternatives']);
    if (![q.question,q.whyOwner,q.recommendation.text].every(text) || !strings(q.recommendation.evidence,16) || !q.recommendation.evidence.length || !strings(q.recommendation.alternatives,16) || !q.recommendation.alternatives.length) fail('question needs owner reason, recommendation evidence and alternatives');
    if (q.preview !== undefined && (typeof q.preview !== 'string' || !/^[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp|gif|pdf)$/.test(q.preview))) fail('local preview must be a repository-relative image or PDF');
  }
  if (new Set(r.answers.map(a=>a.question)).size !== r.answers.length) fail('duplicate answer; revise record explicitly');
  for (const a of r.answers) {
    keys(a,['question','actor','role','time','source','text']);
    if (!r.questions.some(q=>q.id===a.question) || a.role !== 'owner' || ![a.actor,a.source,a.text].every(text) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(a.time) || !Number.isFinite(Date.parse(a.time))) fail('invalid manual owner attribution');
  }
  for (const d of r.proposedDecisions) {
    keys(d,['id','statement','scope','supersedes']);
    if (!text(d.statement) || !strings(d.scope,20) || !d.scope.length || !strings(d.supersedes,20)) fail('invalid proposed decision');
  }
  for (const w of r.items) {
    keys(w,['id','title','phase','kind','problem','scope','doneWhen','proof','depends','decisions','ownerPrerequisites','surfaces']);
    if (!['phase','robot'].includes(w.kind) || ![w.title,w.problem,w.scope,w.doneWhen].every(text) || !strings(w.proof,16) || !w.proof.length || w.proof.some(p=>/[`\r\n\u2028\u2029]/.test(p)) || !strings(w.depends,20) || !strings(w.decisions,100) || !strings(w.ownerPrerequisites,12) || !list(w.surfaces,10)) fail('item requires bounded text, named proof, dependencies and prerequisites');
    if (w.kind === 'phase' && (!Number.isSafeInteger(w.phase) || w.phase < 0)) fail('phase item needs an explicit nonnegative phase number');
    for (const s of w.surfaces) { keys(s,['name','proof']); if (!SURFACES.includes(s.name) || !text(s.proof)) fail('invalid real surface'); }
    if (w.ownerPrerequisites.some(q=>!r.questions.some(x=>x.id===q))) fail('unknown owner prerequisite');
    for (const d of w.decisions) if (d.startsWith('proposal:') && !r.proposedDecisions.some(x=>`proposal:${x.id}`===d)) fail('unknown proposed decision reference');
  }
  const active = new Set(), visited = new Set();
  function visit(w) { if(active.has(w.id)) fail('dependency cycle'); if(visited.has(w.id))return; active.add(w.id); for(const d of w.depends) { const next=r.items.find(i=>i.id===d); if(next)visit(next); else if(!/^phase:\d+$/.test(d))fail('unknown dependency'); } active.delete(w.id); visited.add(w.id); }
  r.items.forEach(visit);
  return r;
}
function draft(r, w, file) {
  if (w.depends.some(d => r.items.some(i => i.id === d && i.kind === 'robot'))) fail('phase cannot depend on a robot preview');
  const deps=w.depends.map(d=>d.startsWith('phase:')?Number(d.slice(6)):r.items.find(i=>i.id===d)?.phase);
  if (deps.some(d=>!Number.isSafeInteger(d))) fail('phase cannot depend on a robot preview');
  const refs=w.decisions.filter(d=>!d.startsWith('proposal:'));
  const unanswered = w.ownerPrerequisites.filter(q => !r.answers.some(a => a.question === q));
  const open = w.ownerPrerequisites.map(q => { const a=r.answers.find(a=>a.question===q); return a?`${q}: manual owner answer by ${a.actor} at ${a.time} (${a.source}): ${a.text}`:`${q}: unanswered; owner required`; });
  const raw=`---\nstatus: planned\nsince: ${r.date}\ngoal: ${r.goal}\nspec: 2\ndepends: ${JSON.stringify(deps)}\nnote: "Reviewed draft; proof named, never verified."\nevidence: []\n---\n\n# ${prose(w.title)}\n\n## Done when\n\n${prose(w.doneWhen)}\n\n## Scope\n\n${prose(w.problem)}\n\n${prose(w.scope)}\n\nShaping source: ${prose(file)}; item ${w.id}; revision ${r.revision}. Choices remain in their source records.\n\n## Acceptance\n\n${w.proof.map(p=>`- [ ] ${prose(w.doneWhen)} — check: \`${p}\``).join('\n')}\n\n## Real surfaces\n\n${w.surfaces.length?w.surfaces.map(s=>`- ${s.name}: ${prose(s.proof)}`).join('\n'):'none'}\n\n## Proof\n\nNamed commands; conductor must judge sufficiency and run them. Not verified.\n\n${w.proof.map(p=>`- \`${p}\``).join('\n')}\n\n## Deliberately open\n\nConductor review of proof sufficiency and all proposed choices remains required.\n\n${open.map(prose).join('\n\n')}\n\n${w.decisions.filter(d=>d.startsWith('proposal:')).map(d=>prose(`${d}: proposed only; see shaping source`)).join('\n\n')}\n\n## Next action\n\n${prose(unanswered.length ? `BLOCKED: unanswered owner prerequisites ${unanswered.join(', ')}. Obtain owner answers before conducting.` : 'Review this draft and proof sufficiency with its source records before conducting.')}\n${refs.length?`\n## Reconciliation\n\n\`\`\`keel-reconciliation\n${JSON.stringify({version:1,decisions:refs})}\n\`\`\`\n`:''}`;
  return raw;
}
export async function inspectShape(root, file, prior = null) {
  root=await realpath(root);
  const raw=await bounded(root,file), r=validateShape(JSON.parse(raw));
  const sources=[];
  const capture=async p=>{ const b=await bounded(root,p); sources.push({path:p,hash:hash(b)}); return b; };
  sources.push({path:file,hash:hash(raw)});
  const cfg=JSON.parse(await capture('.keel/keel.json'));
  if (!cfg.practices?.includes('shaping')) fail('shaping is not enabled; adopt --with shaping');
  for (const p of r.sources) await capture(p);
  for (const q of r.questions) if(q.preview) await capture(q.preview);
  const refs=[...new Set([...r.items.flatMap(w=>w.decisions.filter(d=>!d.startsWith('proposal:'))),...r.proposedDecisions.flatMap(d=>d.supersedes)])];
  if(refs.length && !/^[\w.-]+\/[\w.-]+$/.test(cfg.repo))fail('decision references require local repository identity');
  const bundle=await decisionContext({root,issue:`${cfg.repo ?? 'acme/local'}#1`,issueBody:'```keel-impact\n'+JSON.stringify({version:1,decisions:refs})+'\n```',generatedPhases:prior?.outputs.map(({path,hash})=>({path,hash})) ?? []});
  if(decisionExitCode(bundle))fail(`decision context ${bundle.state}: ${bundle.gaps.map(g=>g.message).join('; ')}`);
  // Resolution still reads the complete inventory. Only our exact outputs and Git
  // revision are excluded from the approval fingerprint, never new decision records.
  const own=new Set(prior?.outputs.map(o=>o.path) ?? []);
  const context={state:bundle.state,sources:bundle.sources.filter(s=>!own.has(s.path)),decisions:bundle.decisions,proposals:bundle.proposals,gaps:bundle.gaps};
  const milestone=cfg.phases?.source === 'milestones';
  if(milestone && r.items.some(w=>w.depends.some(d=>d.startsWith('phase:'))))fail('milestone external phase dependencies unavailable; use internal item IDs only');
  const outputs=[], previews=[];
  let goals, existing=[];
  if(!milestone && r.items.some(w=>w.kind==='phase')) {
    goals=JSON.parse(await capture('docs/goals.json'));
    const dir=await shapePath(root,'docs/phases');
    let names=[]; try { names=await readdir(dir); } catch(e) { if(e.code!=='ENOENT')throw e; }
    if(names.length>2000)fail('phase inventory exceeds bound');
    for(const name of names.sort().filter(n=>/^\d+-.*\.md$/.test(n))) {
      const p=`docs/phases/${name}`; if(own.has(p))continue;
      existing.push(parsePhase(name,(await capture(p)).toString()));
    }
  }
  for (const w of r.items) {
    if(w.kind==='phase' && !milestone) {
      const path=`docs/phases/${String(w.phase).padStart(2,'0')}-${r.id}-${w.id}.md`, content=draft(r,w,file);
      const problems=specProblems(basename(path),content); if(problems.length)fail(problems.join('; '));
      if(Buffer.byteLength(content)>SHAPING_LIMITS.bytes)fail('generated phase exceeds 256 KiB bound');
      existing.push(parsePhase(basename(path),content)); outputs.push({item:w.id,path,content,hash:hash(content)});
    } else {
      const value={version:1,problem:w.problem,reproduction:w.proof.join('\n'),acceptance:w.doneWhen,change:w.scope,prerequisites:w.depends,ownerBlockers:w.ownerPrerequisites.filter(q=>!r.answers.some(a=>a.question===q)),decisions:w.decisions.filter(d=>!d.startsWith('proposal:'))};
      const checked=validateRobotRubric(value); if(!checked.ok)fail(checked.problems.map(p=>p.message).join('; '));
      previews.push({item:w.id,kind:milestone?'milestone':'robot',rubric:checked.rubric,body:formatRobotRubric(checked.rubric),proposedDecisions:w.decisions.filter(d=>d.startsWith('proposal:'))});
    }
  }
  if(goals)validateGraph(existing,goals);
  // Explicit external dependency IDs must exist even in robot-only local plans.
  if(!goals && !milestone && r.items.some(w=>w.depends.some(d=>d.startsWith('phase:'))))fail('external phase dependencies require a local phase plan');
  const result={version:1,source:file,record:r,sourceHashes:sources.sort((a,b)=>a.path.localeCompare(b.path)),context,outputs,previews,proof:'named-not-verified',attribution:'manual-not-authenticated'};
  const plan={...result,digest:hash(result)};
  if(Buffer.byteLength(stable(plan))>4*1024*1024)fail('complete review exceeds 4 MiB receipt bound');
  return plan;
}
async function receipt(root,digest) {
  if(!/^[a-f0-9]{64}$/.test(digest ?? ''))fail('approval requires --digest <reviewed-digest>');
  const value=JSON.parse(await bounded(root,`.keel/shaping/reviews/${digest}.json`,4*1024*1024));
  const {digest:stored,...body}=value;
  if(stored!==digest || hash(body)!==digest)fail('review receipt is corrupt');
  return value;
}
async function remember(root, plan) {
  const path=`.keel/shaping/reviews/${plan.digest}.json`, bytes=stable(plan);
  try { await publish(root,path,bytes); } catch(e) { if(e.code!=='EEXIST')throw e; if((await bounded(root,path,4*1024*1024)).toString()!==bytes)fail('review receipt conflict'); }
}
export async function writeShape(root, file, digest) {
  root=await realpath(root);
  const prior=await receipt(root,digest);
  if(prior.source!==file)fail('reviewed source differs');
  const journalPath=`.keel/shaping/writes/${digest}.json`, journal=stable({version:1,digest,outputs:prior.outputs.map(({path,hash})=>({path,hash}))});
  const old=await optional(root,journalPath);
  if(old && old.toString()!==journal)fail('write journal conflict');
  for(const o of prior.outputs) { const b=await optional(root,o.path); if(b && (!old || hash(b)!==o.hash))fail(`destination changed or already exists: ${o.path}`); }
  const current=await inspectShape(root,file,prior);
  if(current.digest!==digest)fail('source changed; review a new preview before approval');
  if(!prior.outputs.length)return {...prior,state:'preview-only'};
  if(!old) { try { await publish(root,journalPath,journal); } catch(e) { if(e.code!=='EEXIST' || (await optional(root,journalPath))?.toString()!==journal)throw e; } }
  for(const o of prior.outputs) {
    const b=await optional(root,o.path); if(b) { if(hash(b)!==o.hash)fail(`destination changed: ${o.path}`); continue; }
    try { await publish(root,o.path,o.content); } catch(e) { if(e.code!=='EEXIST' || hash(await bounded(root,o.path))!==o.hash)throw e; }
  }
  return {...prior,state:'written'};
}
export async function shapeCommand({root,args}) {
  const [verb,file,...rest]=args.filter(a=>a!=='--json');
  if(!['check','render','plan'].includes(verb) || !file)fail('shape check|render|plan <repository-relative-file>');
  let output,digest,yes=false;
  for(let i=0;i<rest.length;i++) { const a=rest[i]; if(a==='--yes'&&!yes)yes=true; else if(a==='--output'&&output===undefined)output=rest[++i]; else if(a==='--digest'&&digest===undefined)digest=rest[++i]; else fail(`unknown or duplicate shape option: ${a}`); }
  if((yes||digest)&&verb!=='plan' || output!==undefined&&verb!=='render' || digest&&!yes)fail('incompatible shape options');
  root=await realpath(root);
  let data;
  if(yes)data=await writeShape(root,file,digest);
  else {
    data=await inspectShape(root,file);
    if(verb!=='check')await remember(root,data);
    if(verb==='render') {
      if(!output)fail('render requires --output <new-directory>');
      const directory=await shapePath(root,output,true); await mkdir(directory,{mode:0o700});
      const html=renderShape(data,output);
      await publish(root,`${output}/index.html`,html); await publish(root,`${output}/review.txt`,JSON.stringify(data,null,2)+'\n');
      data={...data,review:`${output}/index.html`};
    }
    data={...data,state:verb==='check'?'valid':'preview'};
  }
  return {data,text:JSON.stringify(data,null,2),exitCode:0};
}

// Frozen long-file observations in the existing health proposal, never policy.
import { createHash } from 'node:crypto';
const begin = '<!-- keel:hygiene-proposal:v1 -->', end = '<!-- /keel:hygiene-proposal:v1 -->';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
// Conservative proposal eligibility; the robot's own guards remain authoritative.
// Canonical practice sources also require rendering guarded managed copies.
export function hygieneRobotTargetReason(file) {
  if(typeof file!=='string')return 'source identity unavailable; manual review required';
  if(/^(?:\.github|scripts\/keel|\.keel|\.agents|\.claude|\.codex|practices)\//.test(file)||/^docs\/(?:phases|decisions|evidence|research|projects)\//.test(file)||/(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|\.nvmrc|\.node-version|\.tool-versions)$/.test(file))return 'robot-protected or managed-practice target; owner-led split required';
  return null;
}
export function makeHygieneProposal({repo,file,blob,lines,sections=[],at=new Date().toISOString()}) {
  if(typeof repo!=='string'||! /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo))throw new Error('hygiene repository identity unavailable');
  repo=repo.toLowerCase();
  // Conservative source identity also keeps issue titles and rubrics free of markup.
  if(typeof file!=='string'||file.length>180||! /^[a-z0-9_.\/-]+$/i.test(file)||file.startsWith('/')||file.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('unsafe hygiene source file');
  const targetReason=hygieneRobotTargetReason(file);if(targetReason)throw new Error(targetReason);
  if(typeof blob!=='string'||! /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(blob)||!Number.isSafeInteger(lines)||lines<1||lines>1000000)throw new Error('hygiene file observation unavailable');
  if(!Array.isArray(sections)||sections.length>12)throw new Error('hygiene sections exceed bound');
  sections=sections.map(s=>{
    if(typeof s?.name!=='string'||s.name.length>200||/[\x00-\x1f]/.test(s.name)||!Number.isSafeInteger(s.start)||!Number.isSafeInteger(s.end)||s.start<1||s.end<s.start||s.end>lines)throw new Error('invalid hygiene section');
    return {name:s.name,start:s.start,end:s.end};
  });
  if(!Number.isFinite(new Date(at).getTime()))throw new Error('invalid hygiene observation date');
  const subjectKey=`long_files:${repo}:${file}`,instanceId=hash([subjectKey,blob]);
  const title=`Split long source file ${file}`;
  const rubric={version:1,problem:`${file} has ${lines} lines at Git blob ${blob}.`,reproduction:`Inspect tracked source ${file} at blob ${blob}; count lines and review its top-level sections.`,acceptance:`Split ${file} into cohesive modules while preserving public behavior; run the project's relevant tests and configured check. Report the resulting file sizes.`,change:`Refactor only the responsibility split of ${file}. ${sections.length?'Review heuristic split ranges '+sections.map(s=>`${s.start}-${s.end}`).join(', ')+'.':'Identify cohesive top-level split points first.'} Section ranges are heuristic advice, not verified semantic boundaries.`,prerequisites:[],ownerBlockers:[]};
  return {version:1,measure:'long_files',repo,file,blob,lines,sections,observedAt:new Date(at).toISOString(),subjectKey,instanceId,candidate:{title,rubric},lifecycle:{state:'proposed',decidedAt:null,reason:null,issue:null}};
}
function checked(p) {
  const expected=makeHygieneProposal({...p,at:p.observedAt});
  const lifecycle=p.lifecycle;
  if(!lifecycle||!['proposed','accepting','accepted','declined'].includes(lifecycle.state)||!(lifecycle.decidedAt===null||typeof lifecycle.decidedAt==='string'&&Number.isFinite(Date.parse(lifecycle.decidedAt)))||!(lifecycle.reason===null||typeof lifecycle.reason==='string'&&lifecycle.reason.length<=2000))throw new Error('invalid hygiene lifecycle');
  const issue=lifecycle.issue;
  if(issue!==null&&(!issue||issue.repo!==p.repo||!Number.isSafeInteger(issue.number)||issue.number<1||issue.url!==`https://github.com/${p.repo}/issues/${issue.number}`))throw new Error('invalid hygiene issue identity');
  if(lifecycle.state==='accepted'&&!issue)throw new Error('accepted hygiene proposal requires verified issue');
  expected.lifecycle={state:lifecycle.state,decidedAt:lifecycle.decidedAt,reason:lifecycle.reason,issue};
  if(!same(p,expected))throw new Error('hygiene metadata differs from derived observation/rubric');
  return expected;
}
export function formatHygieneProposal(value) {
  const p=checked(value),json=JSON.stringify(p).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
  return `${begin}\n**\`long_files\`** — ${p.candidate.title}\n\nObserved ${p.lines} lines; blob \`${p.blob}\`. Split points are top-level heuristics.\n\nDecision: ${p.lifecycle.state}. Acceptance requires a fresh source and approved robot policy and budget.\n\n<!-- keel:hygiene-data ${json} -->\n${end}`;
}
export function parseHygieneProposal(text) {
  const fail=message=>({proposal:null,problems:[message]});
  if(typeof text!=='string'||text.length>4*1024*1024)return fail('health page exceeds read bound');
  if(!text.includes('keel:hygiene-'))return {proposal:null,problems:[]};
  if(text.split(begin).length!==2||text.split(end).length!==2||text.split('<!-- keel:hygiene-data ').length!==2)return fail('ambiguous hygiene proposal markers');
  const start=text.indexOf(begin),finish=text.indexOf(end)+end.length,section=text.slice(start,finish);
  const match=/<!-- keel:hygiene-data ([^\r\n]*) -->/.exec(section);
  if(!match||match[1].length>24000)return fail('hygiene metadata missing or exceeds bound');
  try {
    const proposal=checked(JSON.parse(match[1]));
    if(formatHygieneProposal(proposal)!==section)return fail('hygiene prose and metadata disagree');
    const headings=[...text.matchAll(/^## Proposal[ \t]*\r?\n/gm)];
    if(headings.length!==1||headings[0].index>start||/^## /m.test(text.slice(headings[0].index+headings[0][0].length,start)))return fail('hygiene metadata must belong to the Proposal section');
    return {proposal,problems:[],start,end:finish};
  }catch(e){return fail(e.message);}
}

// Existing dated health pages are the only history. Bounded, read-only, and
// conservative about gaps: callers must not treat an incomplete read as empty.
export async function readHygieneProposals({root,healthDir='docs/health'}) {
  const {realpath,lstat,readdir,readFile}=await import('node:fs/promises');
  const {resolve,relative,join,sep,isAbsolute}=await import('node:path');
  const proposals=[],gaps=[];
  try {
    const base=await realpath(root),directory=resolve(base,healthDir),rel=relative(base,directory);
    if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('unsafe hygiene health directory');
    let current=base;
    for(const part of rel.split(sep)){current=join(current,part);let st;try{st=await lstat(current);}catch(e){if(e.code==='ENOENT')return {proposals,gaps};throw e;}if(st.isSymbolicLink()||!st.isDirectory())throw new Error('unsafe hygiene health directory');}
    const names=(await readdir(directory)).filter(n=>/^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort().reverse();
    if(names.length>366)gaps.push('hygiene health history truncated at 366 pages');
    let total=0;
    for(const name of names.slice(0,366)){
      try {
        const file=join(directory,name),st=await lstat(file);
        if(!st.isFile()||st.isSymbolicLink()||st.size>1024*1024)throw new Error('unsafe or oversized hygiene health page');
        total+=st.size;if(total>8*1024*1024){gaps.push('hygiene history exceeds 8 MiB read bound');break;}
        const parsed=parseHygieneProposal(await readFile(file,'utf8'));
        gaps.push(...parsed.problems.map(p=>`${name}: ${p}`));
        if(parsed.proposal)proposals.push({...parsed.proposal,path:join(healthDir,name)});
      }catch(e){gaps.push(`${name}: ${e.message}`);}
    }
  }catch(e){gaps.push(e.message);}
  return {proposals,gaps};
}

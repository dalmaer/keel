import { timeProposalDelivery, checkedTimeTransition } from '../practices/night/files/scripts/keel/time-proposal-remeasurement.mjs';
// Explicit owner decisions; metadata is data, and commands are never executed.
import { readFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { withTimeProposal } from '../practices/night/files/scripts/keel/time-proposals.mjs';
import { healthDirOf } from '../practices/night/files/scripts/keel/lib.mjs';
import { ensureRobotIssue, robotTargetPolicy } from './robot-issue.mjs';
import { robotGithub, robotRepo } from '../practices/night/files/scripts/keel/robot-delivery.mjs';

const atTime=at=>new Date(at??Date.now()).toISOString();
async function local(root) {
  const config=JSON.parse(await readFile(join(root,'.keel/keel.json'),'utf8'));
  if(!robotRepo(config.repo))throw new Error('local repository identity unavailable');
  return {config,repo:config.repo.toLowerCase()};
}
export async function decideTimeProposal({root,path,expectedInstance,decision,reason=null,transition=null,at,github=robotGithub}) {
  const {config,repo}=await local(root),health=resolve(root,healthDirOf(config)),target=resolve(root,path),rel=relative(health,target);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!/^\d{4}-\d{2}-\d{2}\.md$/.test(rel))throw new Error('time proposal must be a dated page in the configured health directory');
  if(!['accept','decline','map'].includes(decision))throw new Error('choose accept, decline or map');
  if(decision==='decline'&&!(typeof reason==='string'&&reason.trim()))throw new Error('decline requires a reason');
  const now=atTime(at);
  return withTimeProposal({root,path,expectedInstance},async({proposal,saveLifecycle})=>{
    let lifecycle=proposal.lifecycle;
    if(lifecycle.issue&&lifecycle.issue.repo.toLowerCase()!==repo)throw new Error('recorded issue is foreign to the local repository');
    if(decision==='map'){
      if(!['accepted','accepting'].includes(lifecycle.state)||!lifecycle.issue)throw new Error('mapping requires a verified proposal issue');
      const {delivery}=await timeProposalDelivery(root,proposal,github);
      const reviewed=checkedTimeTransition(transition,proposal,repo,delivery,now);
      const saved=await saveLifecycle({...lifecycle,transition:reviewed});
      return {ok:true,decision:'transition-reviewed',proposal:saved,issue:lifecycle.issue};
    }
    if(decision==='decline'){
      if(lifecycle.state==='declined')return {ok:true,decision:'declined',proposal};
      if(lifecycle.state!=='proposed')throw new Error('an accepting or accepted issue cannot be declined as an unfiled proposal');
      const saved=await saveLifecycle({...lifecycle,state:'declined',decidedAt:now,reason:reason.trim()});return {ok:true,decision:'declined',proposal:saved};
    }
    if(lifecycle.state==='declined')throw new Error('proposal was declined; refresh for a new eligible instance');
    // This local intent must be durable before ensureRobotIssue can POST. A
    // transport or later page-write failure resumes the phase54 issue journal.
    if(lifecycle.state==='proposed'){
      proposal=await saveLifecycle({...lifecycle,state:'accepting',decidedAt:now,reason});lifecycle=proposal.lifecycle;
    }
    const policy=await robotTargetPolicy({root,repo,github});
    const result=await ensureRobotIssue({repo,title:proposal.candidate.title,rubric:proposal.candidate.rubric,policy,subjectKey:proposal.subjectKey,instanceId:proposal.instanceId,yes:true,stateDir:join(root,'.keel/robot-issues'),github});
    const complete=['created','recovered'].includes(result.state);
    const saved=await saveLifecycle({...lifecycle,state:complete?'accepted':'accepting',issue:result.issue??lifecycle.issue,reason:result.reasons.length?result.reasons.join('; '):lifecycle.reason});
    return {ok:complete,decision:complete?'accepted':'accepting',state:result.state,issue:result.issue??lifecycle.issue,reasons:result.reasons,proposal:saved};
  });
}

export { remeasureTimeProposal } from '../practices/night/files/scripts/keel/time-proposal-remeasurement.mjs';

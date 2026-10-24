import { join } from 'node:path';
import { run as runtime, spec } from '../practices/night/files/scripts/plates/production.mjs';
import { boundedJson, transaction, fail, readState } from '../practices/night/files/scripts/plates/production-store.mjs';
import { ensureRobotIssue, robotTargetPolicy, robotIssueInstance, robotRubricFile, robotIssueOutput } from './robot-issue.mjs';
import { robotRepositoryIdentity } from '../practices/night/files/scripts/plates/robot-delivery.mjs';
export * from '../practices/night/files/scripts/plates/production.mjs';
export async function prepareIssue({root,incident,rubric,yes=false},deps={}) {
  const config=await boundedJson(join(root,'.plates/plates.json'));
  const prepared=await spec({root,config,incident});
  const reviewed=typeof rubric==='string'?await robotRubricFile(rubric):rubric;
  if (!reviewed) fail('production issue requires reviewed rubric');
  const policy=await robotTargetPolicy({root,repo:config.repo,...deps});
  const result=await ensureRobotIssue({root,repo:config.repo,rubric:reviewed,policy,subjectKey:prepared.subjectKey,instanceId:robotIssueInstance(config.repo,prepared.subjectKey,reviewed),title:prepared.title,yes,stateDir:join(root,'.plates/robot-issues'),...deps});
  if(result.issue) {
    const identity = robotRepositoryIdentity(config.repo, deps.github);
    const known = (await readState(root)).incidents[incident]?.references ?? [];
    const verified = new Set([String(result.issue.repo).toLowerCase()]);
    for (const reference of known.filter(r => r.number === result.issue.number)) {
      if (!await identity.same(reference.repo)) fail('production issue reference repository identity changed; recovery required');
      verified.add(reference.repo.toLowerCase());
    }
    await transaction(root,async state=>{
    const i=state.incidents[incident];
    if(!i) fail('incident disappeared');
    const linked=i.references.some(r=>r.url===result.issue.url || (r.number===result.issue.number && verified.has(String(r.repo).toLowerCase())));
    if(!linked) i.references.push(result.issue);
    if(!linked && ['new','recurring'].includes(i.status)) i.status='awaiting-fix';
    return {state:'referenced',incident,issue:result.issue};
    });
  }
  return robotIssueOutput(result);
}
export async function productionRun(args,ctx) {
  if(args[0]==='spec' && args.includes('--rubric')) {
    const opts={root:ctx.root,yes:args.includes('--yes')};
    for(let n=1;n<args.length;n++) {
      if(['--json','--yes'].includes(args[n])) continue;
      const key={'--incident':'incident','--rubric':'rubric'}[args[n]];
      if(!key || !args[n+1] || args[n+1].startsWith('--')) fail('invalid production spec argument');
      opts[key]=args[++n];
    }
    return prepareIssue(opts);
  }
  return runtime(args,ctx);
}

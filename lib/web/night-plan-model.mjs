// Publication validates canonical policy without executing any runner entry point.
import {validatePlan,nightOf,PLAN,PLAN_BRANCH} from '../../practices/night/files/scripts/keel/night-plan.mjs';
import {climbConfigOf} from '../../scripts/keel/climb.mjs';
import {robotPolicy} from '../../practices/climb/files/scripts/keel/robot-policy.mjs';
import {hash,record,WebError} from './common.mjs';
export {PLAN,PLAN_BRANCH};
export function stable(value) {
  if(Array.isArray(value))return value.map(stable);
  if(record(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
export const planDigest=value=>hash(JSON.stringify(stable(value)));
const equal=(a,b)=>planDigest(a)===planDigest(b);
const typedPlan=plan=>record(plan)&&Array.isArray(plan.items)&&plan.items.every(item=>record(item)&&['id','title','kind','source','lane','status'].every(key=>typeof item[key]==='string')&&(item.number==null||record(item.number)&&typeof item.number.measure==='string'));
const editable=item=>['measure','triage'].includes(item.kind)&&['night','loop'].includes(item.lane)&&item.status==='planned'&&item.result===null&&item.budget===null;
export function planChanges(before,plan,config,{openRobotPrs=[],now=Date.now()}={}) {
  const prior=validatePlan(before),validation=validatePlan(plan,{draft:false,openRobotPrs});
  if(!prior.ok||!validation.ok||!typedPlan(before)||!typedPlan(plan))throw new WebError('invalid_night_plan',400);
  if(plan.shapedBy!=='owner')throw new WebError('owner_plan_required',400);
  const rollover=plan.date!==before.date;
  if(rollover&&(plan.date<=before.date||plan.date!==nightOf(new Date(now))))throw new WebError('unsupported_plan_date',409);
  if(rollover) {
    if(plan.items.some(item=>!editable(item)||item.source!=='owner'))throw new WebError('rollover_allocation_unsupported',409);
  } else {
    for(const key of ['willNotTouch','settledToday','leftOpen']) {
      // Retain every original line in order, including duplicate owner lines.
      let position=0;
      for(const line of plan[key])if(line===before[key][position])position++;
      if(position!==before[key].length)throw new WebError('owner_lines_removed',409);
    }
    const existingOrder=plan.items.filter(item=>before.items.some(old=>old.id===item.id)).map(item=>item.id);
    if(!equal(existingOrder,before.items.map(item=>item.id)))throw new WebError('plan_order_changed',409);
    if(before.items.some(item=>item.kind==='build')&&before.readyBy!==plan.readyBy)throw new WebError('build_deadline_changed',409);
    const after=new Map(plan.items.map(item=>[item.id,item]));
    for(const item of before.items) {
      const next=after.get(item.id);
      if(!next)throw new WebError('plan_progress_removed',409);
      if(equal(item,next))continue;
      if(!editable(item)||!editable(next)||next.source!==item.source)throw new WebError('protected_plan_item_changed',409);
    }
    const existing=new Set(before.items.map(item=>item.id));
    for(const item of plan.items)if(!existing.has(item.id)&&(!editable(item)||item.source!=='owner'))throw new WebError('new_allocation_unsupported',409);
  }
  const builds=rollover?[]:plan.items.filter(item=>item.kind==='build'&&['planned','running'].includes(item.status));
  let climb=null;const robot=robotPolicy(config);
  try {if(builds.some(item=>item.lane.startsWith('climb:')))climb=climbConfigOf(config);}catch{throw new WebError('night_policy_unavailable',409);}
  let robotMinutes=0;
  for(const item of builds) {
    if(!Number.isFinite(item.budget?.minutes)||item.budget.minutes<=0)throw new WebError('night_policy_unavailable',409);
    if(item.lane.startsWith('climb:')) {
      if(!climb?.jobs.includes(item.lane.slice(6))||item.budget.minutes>climb.minutes)throw new WebError('night_policy_unavailable',409);
    } else if(/^robot:#[1-9]\d*$/.test(item.lane)) {
      if(!robot.valid||!robot.enabled)throw new WebError('night_policy_unavailable',409);
      robotMinutes+=item.budget.minutes;
    } else throw new WebError('night_policy_unavailable',409);
  }
  if(robotMinutes>(robot.weeklyMinutes??0))throw new WebError('night_policy_unavailable',409);
  const content=JSON.stringify(plan,null,2)+'\n';
  if(Buffer.byteLength(content)>262144)throw new WebError('output_limit',413);
  return {content,rollover,policy:{buildAllocations:'unchanged',newBuildAllowance:0,openRobotPrs:[...openRobotPrs].sort((a,b)=>a-b),climb:climb?{jobs:climb.jobs,minutes:climb.minutes}:null,robot:robotMinutes?{weeklyMinutes:robot.weeklyMinutes,allocatedMinutes:robotMinutes}:null,execution:'not-started',usage:'unknown'}};
}
export function nightPlanCapability({canonical,canWrite,access,date,now=Date.now()}) {
  const upcoming=nightOf(new Date(now));
  const reason=!canonical?'The existing canonical plan branch and file are required; bootstrap is not supported.':!canWrite||access.contentsPermission!=='write'?'Current user and App Contents write permission is required.':(!validatePlan(canonical.plan).ok||!typedPlan(canonical.plan))?'The canonical plan is invalid.':date!==canonical.plan.date&&(date!==upcoming||date<=canonical.plan.date)?'Only the current plan date or rollover to the upcoming canonical night is supported.':null;
  const rollover=canonical?date!==canonical.plan?.date:false;
  return {review:reason===null,reason,branch:PLAN_BRANCH,date,rollover,...(!reason&&rollover?{seed:{schema:1,date,shapedBy:'owner',readyBy:null,willNotTouch:[],settledToday:[],leftOpen:[],items:[]}}:{})};
}

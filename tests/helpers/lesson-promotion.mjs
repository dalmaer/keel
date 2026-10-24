// Synthetic Acme terminal receipts for adversarial mechanics, never efficacy proof.
import {screeningWorld,syntheticTerminalReceipts} from './lesson-screening.mjs';
import {evaluationSection,ref} from '../../lib/evaluated-lessons.mjs';
export async function promotionWorld(t,options={}){
  const w=await screeningWorld(t,options);await syntheticTerminalReceipts(w);
  const applied=(await w.call('evaluate',{proposalRef:w.proposalRef,evaluationPlanRef:w.evaluationPlanRef},{previous:w.registered,apply:true})).result;
  const history=evaluationSection(applied.outputBytes).value,evaluation=history.records.find(r=>r.kind==='learning-evaluation');
  const packageOptions={...w.options,dir:w.repo,env:w.env,slug:'2026-10-24-acme',action:'package'};
  const followup={proposalRef:w.proposalRef,decisionRef:ref(evaluation),window:{start:'2026-10-24T00:00:00.000Z',end:'2026-10-24T01:00:00.000Z'},selections:[],commentary:{text:'Acme eligible exposure unknown.',actor:'Acme owner',attribution:'manual'},relation:null};
  return {...w,applied,history,evaluation,packageOptions,followup};
}

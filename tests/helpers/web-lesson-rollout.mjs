// Synthetic Acme source, private trace and historical provider transports.
import {learningHarness,token,lessonTable} from './web-learning.mjs';
import {createLessonRollout} from '../../lib/web/lesson-rollout.mjs';
import {gitBlob} from '../../lib/web/decision-github.mjs';
import {lessonId} from '../../lib/web/learning-model.mjs';
import {hash} from '../../lib/web/common.mjs';
import {parseLessons,lessonFingerprint} from '../../practices/night/files/scripts/plates/lib.mjs';
import {formatProposal} from '../../lib/learn.mjs';
export {token};
export function lessonRolloutHarness() {
  const h=learningHarness(),old='b'.repeat(40),guard='export const bound = 100;\n';
  const row=parseLessons(lessonTable).rows[0];
  const ref=path=>({repoId:102,repo:'acme/studio',path,revision:old,blob:gitBlob(h.source.files[path])});
  h.source.files['scripts/acme-bound.mjs']=guard;
  h.source.files['migrations/0001-acme-bound.mjs']="export const id = '0001-acme-bound';\nexport function applies() { return false; }\nexport function up() { return []; }\n";
  h.source.files['docs/proof.md']='# Acme proof reference\nNo execution result is asserted.\n';
  const source={...ref('docs/lessons.md'),row:1,fingerprint:lessonFingerprint('acme/studio',row)};
  h.source.files['docs/inbox/acme.md']=formatProposal({meta:{kind:'lesson',from:source.fingerprint,status:'accepted',outcome:'lesson'},title:'Acme bounded read',claim:'A bounded read needs a bound.',decision:'- 2026-10-21: accepted (lesson): lesson 1 in docs/lessons.md'});
  const id=lessonId(source);
  const manifest={version:1,id,source,decision:{kind:'proposal',source:ref('docs/inbox/acme.md')},catalogue:source,
    guards:[ref('scripts/acme-bound.mjs')],migrations:[{id:'0001-acme-bound',source:ref('migrations/0001-acme-bound.mjs')}],proofs:[ref('docs/proof.md')],
    release:{repoId:102,repo:'acme/studio',tag:'v1.0.0',revision:old},
    adoptions:[{projectId:'studio',cataloguePath:'docs/plates-lessons.md',guardPaths:[{sourcePath:'scripts/acme-bound.mjs',projectPath:'scripts/acme-bound.mjs'}],migrationIds:['0001-acme-bound']}]};
  h.source.revisions[old]={...h.source.files};h.source.head='c'.repeat(40);
  h.source.files['.plates/plates.json']=JSON.stringify({name:'Acme Studio',repo:'acme/studio',practice:'1.0.0',migrations:['0001-acme-bound'],lessons:'docs/lessons.md'});
  h.source.files['.plates/lock.json']=JSON.stringify({practice:'1.0.0',files:{'scripts/acme-bound.mjs':{practice:'acme',sha256:hash(guard)}}});
  h.source.files['docs/plates-lessons.md']=lessonTable;
  const trace={tag:old,tagRef:'refs/tags/v1.0.0',calls:[],issue:null};
  const save=()=>{h.workspace.files[`lesson-traces/${id}.json`]=JSON.stringify(manifest);};save();
  const fetcher=async(url,options)=>{
    trace.calls.push(url);const path=new URL(url).pathname;
    if(path==='/repos/acme/studio/git/ref/tags/v1.0.0')return Response.json({ref:trace.tagRef,object:{type:'commit',sha:trace.tag}});
    if(path==='/repos/acme/studio/issues/7')return Response.json(trace.issue);
    return h.fetcher(url,options);
  };
  return {...h,id,manifest,trace,save,fetcher,rollout:createLessonRollout(h.config,{fetcher,now:()=>h.state.now})};
}

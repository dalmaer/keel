import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loopRunStatus} from '../lib/loop-run-status.mjs';
const jobs = entries => [{steps:entries.map(([name,conclusion])=>({name,conclusion,status:'completed'}))}];
test('legacy gate exits zero on a failed build; its verdict owns validation',()=>{
 assert.deepEqual(loopRunStatus(jobs([["Pull Loop's insights",'success'],['Gate','success'],['Verdict','failure']])),{collection:'success',validation:'failure'});
 assert.deepEqual(loopRunStatus(jobs([["Pull Loop's insights",'success'],['Gate','success'],['Validation verdict','success']])),{collection:'success',validation:'success'});
});
test('collection failure and skipped/missing validation are never successful validation',()=>{
 assert.deepEqual(loopRunStatus(jobs([["Pull Loop's insights",'failure'],['Gate','skipped'],['Verdict','failure']])),{collection:'failure',validation:'not-run'});
 assert.deepEqual(loopRunStatus(jobs([["Pull Loop's insights",'success'],['Gate','success']])),{collection:'success',validation:'unknown'});
 assert.deepEqual(loopRunStatus([]),{collection:'unknown',validation:'not-run'});
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { robotPolicy, robotIssueLabels } from '../practices/climb/files/scripts/keel/robot-policy.mjs';
import { readRobotStatus } from '../lib/robot-status.mjs';

test('robot policy defaults OFF, rejects malformed opt-ins and uses only the settled target keys', async () => {
  for (const config of [{}, {robot:{on:false}}]) {
    const p=robotPolicy(config); assert.equal(p.valid,true); assert.equal(p.enabled,false); assert.deepEqual(robotIssueLabels(p),[]);
    const status=await readRobotStatus({repo:'acme/anvils',config,now:'2026-10-10T12:00:00Z',github:()=>{throw new Error('OFF must not read usage');}});
    assert.equal(status.budget.state,'off'); assert.equal(status.budget.usedSeconds,null);
  }
  for (const config of [null, [], {robot:null},{robot:true},{robot:{on:'true',budgetMinutes:10}},{robot:{on:true}},{robot:{on:true,budgetMinutes:0}},{robot:{on:true,budgetMinutes:Infinity}},{robot:{enabled:true,weeklyMinutes:10}}]) {
    const p=robotPolicy(config);assert.equal(p.valid,false,JSON.stringify(config)); assert.equal(p.enabled,false);assert.deepEqual(robotIssueLabels(p),[]);
  }
  assert.deepEqual(robotPolicy({robot:{on:true,budgetMinutes:12}}),{valid:true,enabled:true,weeklyMinutes:12,problems:[]});
  assert.deepEqual(robotIssueLabels(robotPolicy({robot:{on:true,budgetMinutes:12}})),['keel:agent']);
});

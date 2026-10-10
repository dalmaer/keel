import { robotPolicy } from '../practices/climb/files/scripts/keel/robot-policy.mjs';
import { readRobotBudget } from '../practices/climb/files/scripts/keel/robot-budget.mjs';
export { readRobotDelivery } from '../practices/climb/files/scripts/keel/robot-delivery.mjs';
export async function readRobotStatus({ repo, config, now = new Date(), github }) {
  const policy = robotPolicy(config);
  return { policy, budget: await readRobotBudget({ repo, policy, now, github }) };
}

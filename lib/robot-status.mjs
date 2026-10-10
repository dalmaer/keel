import { robotPolicy } from '../practices/climb/files/scripts/keel/robot-policy.mjs';
import { readRobotBudget } from '../practices/climb/files/scripts/keel/robot-budget.mjs';
export { readRobotDelivery } from '../practices/climb/files/scripts/keel/robot-delivery.mjs';
export async function readRobotStatus({ repo, config, now = new Date(), github }) {
  const policy = robotPolicy(config);
  return { policy, budget: await readRobotBudget({ repo, policy, now, github }) };
}

// Board display only: admission continues to use the uncached reader above.
// REST requests and remaining quota are separate from GraphQL points.
export async function boardRobotStatus({ repo, config, now = new Date(), github, env = process.env, fresh = false }) {
  const policy = robotPolicy(config);
  const rest = { requests: 0, remaining: null, resetAt: null };
  if (!policy.valid || !policy.enabled) return { status: await readRobotStatus({ repo, config, now, github }), at: null, rest };
  const { githubRead, quotaFloor } = await import('./quota.mjs');
  const { robotWeek } = await import('../practices/climb/files/scripts/keel/robot-budget.mjs');
  const { robotGithub } = await import('../practices/climb/files/scripts/keel/robot-delivery.mjs');
  const { createHash } = await import('node:crypto');
  const key = createHash('sha256').update(JSON.stringify([repo, policy, robotWeek(now).windowStart])).digest('hex');
  const got = await githubRead(env, `robot-status-${key}`, async () => {
    const read = async request => {
      if (rest.remaining !== null && rest.remaining < quotaFloor(env)) throw new Error('saving your GitHub REST quota');
      rest.requests++;
      const response = await (github ?? robotGithub)(request);
      const headers = response?.headers ?? {};
      const remaining = headers['x-ratelimit-remaining'], reset = headers['x-ratelimit-reset'];
      if (/^\d+$/.test(String(remaining))) rest.remaining = Number(remaining);
      if (/^\d+$/.test(String(reset)) && Number.isFinite(new Date(Number(reset) * 1000).getTime())) rest.resetAt = new Date(Number(reset) * 1000).toISOString();
      return response;
    };
    return { status: await readRobotStatus({ repo, config, now, github: read }), remaining: rest.remaining, resetAt: rest.resetAt };
  }, { fresh, now: new Date(now).getTime() });
  return { status: got.value.status, at: got.at, rest: { ...rest, remaining: got.value.remaining, resetAt: got.value.resetAt } };
}

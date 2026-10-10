// Robot policy is pure: callers supply the trusted TARGET repository's config.
// @ts-check
/**
 * Invalid configuration cannot enable spending; enabled policy always has a budget.
 * @typedef { {valid: false, enabled: false, weeklyMinutes: null, problems: string[]} | {valid: true, enabled: false, weeklyMinutes: number | null, problems: string[]} | {valid: true, enabled: true, weeklyMinutes: number, problems: string[]} } RobotPolicy
 */
/** @param {unknown} config @returns {RobotPolicy} */
export function robotPolicy(config) {
  /** @type {string[]} */
  const problems = [];
  /** @param {unknown} x @returns {x is Record<string, unknown>} */
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (!object(config)) return { valid: false, enabled: false, weeklyMinutes: null, problems: ['target configuration unavailable or malformed'] };
  if (!Object.hasOwn(config, 'robot')) return { valid: true, enabled: false, weeklyMinutes: null, problems };
  const r = config.robot;
  if (!object(r)) problems.push('robot must be {on: boolean, budgetMinutes: number}');
  else {
    for (const key of Object.keys(r)) if (!['on', 'budgetMinutes'].includes(key)) problems.push(`unknown robot key: ${key}`);
    if (typeof r.on !== 'boolean') problems.push('robot.on must be a boolean');
    if ((r.on || r.budgetMinutes !== undefined) && !(typeof r.budgetMinutes === 'number' && Number.isFinite(r.budgetMinutes) && r.budgetMinutes > 0)) problems.push('robot.budgetMinutes must be positive and finite');
  }
  if (problems.length || !object(r)) return { valid: false, enabled: false, weeklyMinutes: null, problems };
  if (r.on === true && typeof r.budgetMinutes === 'number') return { valid: true, enabled: true, weeklyMinutes: r.budgetMinutes, problems };
  return { valid: true, enabled: false, weeklyMinutes: typeof r.budgetMinutes === 'number' ? r.budgetMinutes : null, problems };
}
/** @param {RobotPolicy | null | undefined} policy */
export const robotIssueLabels = policy => policy?.valid === true && policy.enabled === true ? ['keel:agent'] : [];

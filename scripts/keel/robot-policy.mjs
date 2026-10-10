// Robot policy is pure: callers supply the trusted TARGET repository's config.
export function robotPolicy(config) {
  const problems = [];
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
  return { valid: !problems.length, enabled: !problems.length && r.on, weeklyMinutes: !problems.length ? r.budgetMinutes ?? null : null, problems };
}
export const robotIssueLabels = policy => policy?.valid === true && policy.enabled === true ? ['keel:agent'] : [];

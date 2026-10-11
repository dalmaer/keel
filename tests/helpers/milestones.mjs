export const milestoneConfig = { name: 'Acme', repo: 'acme/anvils', practices: ['base'], phases: { source: 'milestones' } };
export const connection = (nodes = [], more = false) => ({ nodes, pageInfo: { hasNextPage: more } });
export const issue = (number, state = 'OPEN', labels = []) => ({ number, state, title: `Acme issue ${number}`, url: `https://github.com/acme/anvils/issues/${number}`, labels: connection(labels.map(name => ({ name }))) });
export const milestone = (number = 1, state = 'OPEN', issues = []) => ({ number, state, title: 'Acme release', description: '## Exit criteria\n- Anvils land.\n## Notes\nLater.', url: `https://github.com/acme/anvils/milestone/${number}`, dueOn: '2026-12-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', closedAt: null, issues: connection(issues) });
export const response = (nodes = [], more = {}) => ({ data: { rateLimit: { cost: 1, remaining: 4000, resetAt: '2099-01-01T00:00:00Z' }, repository: {
  openMilestones: connection(nodes.filter(m => m.state === 'OPEN'), more.open ?? false),
  closedMilestones: connection(nodes.filter(m => m.state === 'CLOSED'), more.closed ?? false),
} } });

// Model GitHub's connection selection from the actual query, before projection.
export function queryResponse(query, milestones) {
  const result = response();
  result.data.repository = {};
  const connections = query.matchAll(/(?:(\w+):\s*)?milestones\(first:(\d+),states:\[([A-Z,]+)\],orderBy:\{field:(\w+),direction:(ASC|DESC)\}\)/g);
  for (const [, alias, limit, states, field, direction] of connections) {
    const selected = milestones.filter(m => states.split(',').includes(m.state));
    selected.sort((a, b) => (field === 'NUMBER' ? a.number - b.number : Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * (direction === 'ASC' ? 1 : -1));
    result.data.repository[alias ?? 'milestones'] = connection(selected.slice(0, Number(limit)), selected.length > Number(limit));
  }
  return result;
}

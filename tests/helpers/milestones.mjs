export const milestoneConfig = { name: 'Acme', repo: 'acme/anvils', practices: ['base'], phases: { source: 'milestones' } };
export const connection = (nodes = [], more = false) => ({ nodes, pageInfo: { hasNextPage: more } });
export const issue = (number, state = 'OPEN', labels = []) => ({ number, state, title: `Acme issue ${number}`, url: `https://github.com/acme/anvils/issues/${number}`, labels: connection(labels.map(name => ({ name }))) });
export const milestone = (number = 1, state = 'OPEN', issues = []) => ({ number, state, title: 'Acme release', description: '## Exit criteria\n- Anvils land.\n## Notes\nLater.', url: `https://github.com/acme/anvils/milestone/${number}`, dueOn: '2026-12-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', closedAt: null, issues: connection(issues) });
export const response = (nodes = [], more = false) => ({ data: { rateLimit: { cost: 1, remaining: 4000, resetAt: '2099-01-01T00:00:00Z' }, repository: { milestones: connection(nodes, more) } } });

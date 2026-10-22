// Synthetic Acme source records. This adapter never contacts GitHub.
import { decisionHarness } from './web-decisions.mjs';
import { createDaily } from '../../lib/web/daily.mjs';
import { gitBlob } from '../../lib/web/decision-github.mjs';
export { token } from './web-decisions.mjs';
export const dailyPlan = (date = '2026-10-21') => ({
  schema: 1, date, shapedBy: 'owner', readyBy: null, willNotTouch: ['Acme credentials'], settledToday: [], leftOpen: ['Acme runner receipt needs verification'],
  items: [{ id: 'acme-test', title: 'Measure Acme tests', kind: 'build', source: 'owner', number: { measure: 'slow_tests', bound: 20, better: 'lower' }, lane: 'climb:test-time', budget: { minutes: 10 }, status: 'planned', result: null }],
});
export function dailyHarness() {
  const h = decisionHarness();
  h.source.files['.plates/plates.json'] = JSON.stringify({ name: 'Acme Studio', climb: { jobs: ['test-time'], budget: { minutes: 45 } }, robot: { on: false, budgetMinutes: 60 } });
  h.source.files['docs/night/2026-10-21.json'] = JSON.stringify(dailyPlan());
  h.source.files['docs/health/2026-10-21.md'] = '| `slow_tests` — tests | 30 | ≤ 20 | outside | Acme observation |\n';
  h.source.files['docs/health/2026-10-22.md'] = '| `slow_tests` — tests | 18 | ≤ 20 | inside | Acme observation |\n';
  h.source.branches = {};
  h.source.dailyRequests = [];
  h.state.now = Date.parse('2026-10-21T19:00:00Z');
  const treeId = name => gitBlob(`Acme tree ${name}`);
  const fetcher = async (url, options = {}) => {
    const u = new URL(url), path = u.pathname;
    h.source.dailyRequests.push({ url, method: options.method ?? 'GET', body: options.body });
    if (h.source.dailyDenied && path.includes(h.source.dailyDenied)) return Response.json({}, { status: 403 });
    if (path === '/graphql') {
      const body = JSON.parse(options.body);
      if (body.query.startsWith('query DailyBranch')) {
        if (h.source.dailyGraphError) return Response.json({ errors: [{ type: h.source.dailyGraphError }] });
        const name = body.variables.name.replace('refs/heads/', ''), branch = h.source.branches[name];
        const repo = { id: h.source.repositoryNodeId, databaseId: h.source.wrongDailyRepo ? 999 : h.source.repoId, nameWithOwner: h.source.repoName, isPrivate: h.source.private };
        return Response.json({ data: { node: { ...repo, ref: branch ? { id: `REF_acme_${name}`, name, repository: repo, target: { oid: branch.head, tree: { oid: treeId(name) } } } : null } } });
      }
    }
    for (const [name, branch] of Object.entries(h.source.branches)) {
      if (path === `/repos/acme/studio/git/trees/${treeId(name)}`) return Response.json({ sha: treeId(name), truncated: false, tree: Object.entries(branch.files).map(([path, content]) => ({ path, type: 'blob', mode: '100644', sha: gitBlob(content), size: Buffer.byteLength(content) })) });
      if (path.startsWith('/repos/acme/studio/git/blobs/')) {
        const sha = path.split('/').at(-1), value = Object.values(branch.files).find(text => gitBlob(text) === sha);
        if (value !== undefined) return Response.json({ sha, size: Buffer.byteLength(value), encoding: 'base64', content: Buffer.from(value).toString('base64') });
      }
    }
    return h.fetcher(url, options);
  };
  return { ...h, fetcher, daily: createDaily(h.config, { fetcher, now: () => h.state.now }) };
}

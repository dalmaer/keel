// Synthetic Acme Actions network boundary; no provider operations.
import { decisionHarness, token } from './web-decisions.mjs';
import { createRuns } from '../../lib/web/runs.mjs';
export { token };
export const runFixture = (extra = {}) => ({ id: 9001, workflow_id: 501, run_attempt: 1, repository: { id: 102 }, head_sha: 'b'.repeat(40), path: '.github/workflows/check.yml', name: 'Acme check', display_title: 'Check Acme changes', status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', created_at: '2026-01-01T10:00:00Z', run_started_at: '2026-10-21T10:00:00Z', updated_at: '2026-10-21T10:02:00Z', actor: { id: 7, login: 'acme-person' }, ...extra });
export const jobFixture = (extra = {}) => ({ id: 8001, run_id: 9001, head_sha: 'b'.repeat(40), name: 'Acme tests', status: 'completed', conclusion: 'success', started_at: '2026-10-21T10:00:00Z', completed_at: '2026-10-21T10:01:01Z', labels: ['ubuntu-latest'], runner_name: 'Acme runner', steps: [{ number: 1, name: 'Acme test', status: 'completed', conclusion: 'success', started_at: '2026-10-21T10:00:01Z', completed_at: '2026-10-21T10:01:00Z' }], ...extra });
export const artifactFixture = (extra = {}) => ({ id: 7001, name: 'Acme evidence', size_in_bytes: 123, expired: false, created_at: '2026-10-21T10:02:00Z', expires_at: '2026-11-21T10:02:00Z', workflow_run: { id: 9001, repository_id: 102 }, archive_download_url: 'https://private.acme.test/signed-secret', ...extra });
export function runsHarness() {
  const h = decisionHarness();
  h.state.now = Date.parse('2026-10-21T19:00:00Z');
  h.source.files['.plates/plates.json'] = JSON.stringify({ name: 'Acme Studio', ci: { weeklyMinutes: 120 } });
  h.source.files['.github/workflows/check.yml'] = 'name: Acme check\non:\n  push:\n  schedule:\n    - cron: "23 7 * * *"\npermissions:\n  contents: read\nconcurrency: acme-check\njobs:\n  test:\n    runs-on: ubuntu-latest\n';
  const actions = { permission: 'read', denied: false, status: null, requests: [], workflows: [{ id: 501, path: '.github/workflows/check.yml', name: 'Acme check', state: 'active' }], runs: [runFixture()], attempts: new Map(), jobs: new Map([['9001:1', [jobFixture()]]]), artifacts: new Map([[9001, [artifactFixture()]]]), pages: {}, onRequest: null };
  const fetcher = async (url, options = {}) => {
    const u = new URL(url), path = u.pathname.replace('/repositories/102/actions/', '/repos/acme/studio/actions/');
    if (path === '/user/installations') {
      const response = await h.fetcher(url, options), value = await response.json();
      for (const installation of value.installations) if (actions.permission) installation.permissions.actions = actions.permission;
      return Response.json(value);
    }
    if (path.startsWith('/repos/acme/studio/actions/')) {
      actions.requests.push({ url, options }); actions.onRequest?.(url, options);
      if (actions.denied) return Response.json({}, { status: 403 });
      if (actions.status) return Response.json({}, { status: actions.status, headers: actions.headers ?? {} });
      if (actions.pages[path + u.search]) return Response.json(actions.pages[path + u.search]);
      const page = Number(u.searchParams.get('page') ?? 1), perPage = Number(u.searchParams.get('per_page') ?? 100);
      const list = (key, values) => Response.json({ total_count: values.length, [key]: values.slice((page - 1) * perPage, page * perPage) });
      if (path.endsWith('/actions/workflows')) return list('workflows', actions.workflows);
      if (path.endsWith('/actions/runs')) return list('workflow_runs', actions.runs);
      let match = path.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)$/);
      if (match) {
        const key = `${match[1]}:${match[2]}`, value = actions.attempts.get(key) ?? actions.runs.find(r => r.id === Number(match[1]) && r.run_attempt === Number(match[2]));
        return value ? Response.json(value) : Response.json({}, { status: 404 });
      }
      match = path.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/);
      if (match) return list('jobs', actions.jobs.get(`${match[1]}:${match[2]}`) ?? []);
      match = path.match(/\/actions\/runs\/(\d+)\/artifacts$/);
      if (match) return list('artifacts', actions.artifacts.get(Number(match[1])) ?? []);
      throw Error(`Unexpected Acme Actions path ${path}`);
    }
    return h.fetcher(url, options);
  };
  const access = { ...h.access, actionsPermission: 'read' };
  return { ...h, access, actions, fetcher, runs: createRuns(h.config, { fetcher, now: () => h.state.now }) };
}

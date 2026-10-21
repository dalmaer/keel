import { createHash } from 'node:crypto';
import { quotaObservation } from './home-store.mjs';
import { validateManifest, WORKSPACE_LIMITS } from './workspace.mjs';
import { requestJson, WebError, deny, numeric, exact, record } from './common.mjs';

const API = 'https://api.github.com';
const repoName = value => typeof value === 'string' && /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(value);
const pathParts = value => value.split('/').map(encodeURIComponent).join('/');
export function createGitHub(config, fetcher = fetch) {
  async function api(path, token, limit, signal, observations) {
    return requestJson(async (url, options) => {
      const response = await fetcher(url, options);
      const observation = quotaObservation(response.headers);
      if (observation && observations) observations.push(observation);
      if (response.status === 401) { await response.body?.cancel(); throw new WebError('sign_in_required', 401); }
      if (response.status === 404) { await response.body?.cancel(); deny(); }
      return response;
    }, `${API}${path}`, { signal, headers: { Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } }, limit);
  }
  async function pages(path, field, token, signal, observations) {
    const rows = [], ids = new Set(); let total;
    // Partial, duplicated, growing or unbounded lists are not authorization evidence.
    for (let page = 1; page <= 10; page++) {
      const data = await api(`${path}?per_page=100&page=${page}`, token, undefined, signal, observations);
      if (!record(data) || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || data.total_count > 1000
        || !Array.isArray(data[field]) || data[field].length > 100 || (total !== undefined && total !== data.total_count)) deny();
      total = data.total_count;
      const expected = Math.min(100, total - rows.length);
      if (data[field].length !== expected) deny();
      for (const row of data[field]) {
        if (!record(row) || !numeric(row.id) || ids.has(row.id)) deny();
        ids.add(row.id); rows.push(row);
      }
      if (rows.length === total) return rows;
    }
    deny();
  }
  async function source(repo, path, sha, token, signal, observations) {
    const data = await api(`/repos/${pathParts(repo)}/contents/${pathParts(path)}?ref=${sha}`, token, undefined, signal, observations);
    if (!record(data) || data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string'
      || !Number.isSafeInteger(data.size) || data.size > WORKSPACE_LIMITS.bytes || data.content.length > 1500000) deny();
    try {
      const bytes = Buffer.from(data.content, 'base64');
      if (bytes.length !== data.size || bytes.length > WORKSPACE_LIMITS.bytes) deny();
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { deny(); }
  }
  return {
    authorizeUrl(state, verifier) {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.origin}/api/auth/callback`, state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', allow_signup: 'false' }).toString();
      return url.href;
    },
    async exchange(code, verifier) {
      const data = await requestJson(fetcher, 'https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code,
          code_verifier: verifier, redirect_uri: `${config.origin}/api/auth/callback` }),
      }, 8192);
      if (!record(data) || data.token_type?.toLowerCase() !== 'bearer' || typeof data.access_token !== 'string'
        || data.access_token.length < 10 || data.access_token.length > 2048 || /[\s\x00-\x1f]/.test(data.access_token)
        || (data.expires_in !== undefined && (!Number.isSafeInteger(data.expires_in) || data.expires_in <= 0))) {
        throw new WebError('authorization_failed', 401);
      }
      // No refresh token is retained: a fresh owner sign-in is required after this bound.
      return { token: data.access_token, seconds: Math.min(data.expires_in ?? 28800, 28800) };
    },
    async access(token, expectedUserId) {
      const signal = AbortSignal.timeout(25000), observations = [];
      const user = await api('/user', token, 32768, signal, observations);
      if (!record(user) || !numeric(user.id) || !config.ownerIds.includes(user.id) || (expectedUserId !== undefined && user.id !== expectedUserId)) deny();
      const installations = await pages('/user/installations', 'installations', token, signal, observations);
      const installation = installations.find(item => item.id === config.installationId);
      if (!installation || installation.app_id !== config.appId || installation.suspended_at !== null
        || !['read', 'write'].includes(installation.permissions?.contents) || installation.repository_selection !== 'selected') deny();
      const repos = await pages(`/user/installations/${config.installationId}/repositories`, 'repositories', token, signal, observations);
      const workspaceEntry = repos.find(item => item.id === config.workspace.repoId);
      if (!workspaceEntry) deny();
      const workspaceRepo = await api(`/repositories/${config.workspace.repoId}`, token, 65536, signal, observations);
      if (workspaceRepo.id !== config.workspace.repoId || workspaceRepo.private !== true || !repoName(workspaceRepo.full_name)
        || typeof workspaceRepo.default_branch !== 'string' || workspaceRepo.default_branch.length > 200) deny();
      const commit = await api(`/repos/${pathParts(workspaceRepo.full_name)}/commits/${encodeURIComponent(workspaceRepo.default_branch)}`, token, 2 * 1024 * 1024, signal, observations);
      if (!/^[a-f0-9]{40}$/.test(commit?.sha)) deny();
      const [manifest, members] = await Promise.all([
        source(workspaceRepo.full_name, config.workspace.manifestPath, commit.sha, token, signal, observations),
        source(workspaceRepo.full_name, config.workspace.membersPath, commit.sha, token, signal, observations),
      ]);
      try { validateManifest(manifest); } catch { deny(); }
      if (manifest.id !== config.workspace.id || manifest.repo.toLowerCase() !== workspaceRepo.full_name.toLowerCase()
        || !exact(members, ['version', 'workspaceId', 'memberIds']) || members.version !== 1 || members.workspaceId !== manifest.id
        || !Array.isArray(members.memberIds) || members.memberIds.length > 100 || !members.memberIds.every(numeric)
        || new Set(members.memberIds).size !== members.memberIds.length || !members.memberIds.includes(user.id)) deny();
      const projects = [];
      for (const project of manifest.projects) {
        const boundId = config.projectRepoIds[project.id];
        const repo = repos.find(item => item.id === boundId);
        // Numeric pins defeat deleted/recreated names. Renames require manifest reconciliation.
        if (repo && repoName(repo.full_name) && repo.full_name.toLowerCase() === project.repo.toLowerCase()) {
          projects.push({ id: project.id, repoId: repo.id, repo: repo.full_name });
        }
      }
      const latestReset = Math.max(...observations.map(item => item.reset));
      const quota = observations.length ? { remaining: Math.min(...observations.filter(item => item.reset === latestReset).map(item => item.remaining)), reset: latestReset } : null;
      return { quota, actionsPermission: ['read', 'write'].includes(installation.permissions.actions) ? installation.permissions.actions : null, contentsPermission: installation.permissions.contents, userId: user.id, workspace: { id: manifest.id, name: manifest.name }, projects, sourceRevision: commit.sha };
    },
  };
}

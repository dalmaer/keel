import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/web-http.mjs';

const entrances = ['/', '/api/session', '/projects/studio', '/api/projects/studio', '/api/projects/studio/media/fake-capture', '/api/projects/studio/stream'];
test('all project, media, stream and aggregate entrances require authentication', async () => {
  const h = harness();
  for (const path of entrances) {
    const result = await h.service(h.request(path)); assert.equal(result.status, 401, path);
    assert.doesNotMatch(await result.text(), /acme\/studio|Acme workspace|repoId/);
  }
});

test('owner, membership, workspace privacy and current App identity are mandatory on every request', async () => {
  for (const change of [state => { state.userId = 2; }, state => { state.members = []; }, state => { state.private = false; },
    state => { state.appId = 12; }, state => { state.installationId = 22; }, state => { state.suspended = '2026-01-01'; },
    state => { state.selection = 'all'; }, state => { state.partial = true; }]) {
    const h = harness(), signed = await h.login(); change(h.state);
    const result = await h.service(h.request('/api/session', { cookie: signed.cookie }));
    assert.equal(result.status, 404); assert.deepEqual(await result.json(), { error: 'access_denied' });
    // A restored permission does not resurrect the old session.
    assert.equal((await h.service(h.request('/api/session', { cookie: signed.cookie }))).status, 401);
  }
});

test('numeric repository pins exclude replaced, renamed, unselected and unmanifested repositories', async () => {
  for (const change of [state => { state.repoId = 999; }, state => { state.repoName = 'acme/renamed'; }, state => { state.repoAccess = false; }]) {
    const h = harness(); change(h.state); const signed = await h.login();
    assert.deepEqual(signed.session.projects, []);
    for (const path of ['/projects/studio', '/api/projects/studio', '/api/projects/studio/media/fake', '/api/projects/studio/stream', '/api/projects/secret']) {
      const result = await h.service(h.request(path, { cookie: signed.cookie })); assert.equal(result.status, 404, path);
      assert.doesNotMatch(await result.text(), /acme\/studio|repoId/);
    }
  }
});

test('allowed media/stream remain explicit unavailable features; denied records cannot be enumerated', async () => {
  const h = harness(), signed = await h.login();
  assert.equal((await h.service(h.request('/api/projects/studio', { cookie: signed.cookie }))).status, 200);
  for (const path of ['/api/projects/studio/media/fake', '/api/projects/studio/stream']) assert.equal((await h.service(h.request(path, { cookie: signed.cookie }))).status, 501);
  for (const path of ['/api/projects/secret', '/api/media/fake', '/api/stream', '/projects/%73ecret', '/api/projects/studio%2fmedia/fake']) assert.equal((await h.service(h.request(path, { cookie: signed.cookie }))).status, 404);
});

test('provider-revoked credentials invalidate the server session without exposing provider errors', async () => {
  const h = harness(), signed = await h.login(); h.state.failGitHub = true;
  const response = await h.service(h.request('/api/session', { cookie: signed.cookie }));
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'sign_in_required' });
  h.state.failGitHub = false;
  assert.equal((await h.service(h.request('/api/session', { cookie: signed.cookie }))).status, 401);
});

test('installation pagination must finish with consistent totals and unique numeric identities', async () => {
  const { createGitHub } = await import('../lib/web/github.mjs');
  for (const mode of ['complete', 'changed-total', 'duplicate', 'missing-page']) {
    const h = harness();
    const fetcher = async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/user/installations') {
        const page = Number(parsed.searchParams.get('page'));
        const selected = { id: mode === 'duplicate' ? 1000 : 21, app_id: 11, suspended_at: null, repository_selection: 'selected', permissions: { contents: 'read' } };
        return new Response(JSON.stringify({ total_count: page === 2 && mode === 'changed-total' ? 102 : 101,
          installations: page === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i })) : mode === 'missing-page' ? [] : [selected] }));
      }
      return h.fetcher(url, options);
    };
    const github = createGitHub(h.config, fetcher);
    if (mode === 'complete') assert.equal((await github.access('fake-user-access-token-for-tests')).projects[0].repoId, 102);
    else await assert.rejects(github.access('fake-user-access-token-for-tests'), /access_denied/, mode);
  }
});

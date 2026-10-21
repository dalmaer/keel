import { createHash } from 'node:crypto';
import { harness } from './web-http.mjs';
import { createWebService } from '../../lib/web/server.mjs';
export function phaseFile(id, { status = 'planned', owes = false, ready = true, next = 'Build the source outcome.', goal = 'G1' } = {}) {
  const done = ['built','lived-in'].includes(status);
  return `---\nstatus: ${status}\nsince: 2026-10-20\ngoal: ${goal}\nnote: "Acme source"\ndepends: []\nevidence: ${done ? '["evidence/acme.md"]' : '[]'}\n${owes ? 'owes: walk\n' : ''}---\n# Acme phase ${id}\n\n## Done when\nA person can use the outcome.\n\n## Scope\nA bounded change.\n\n## Acceptance\n${done ? '- [x] Observed the outcome.' : owes ? '- [ ] ⚑ by hand: test the Acme preview.' : '- [ ] Check the source outcome.'}\n\n## Proof\nRun the named proof.\n\n## Deliberately open\nNo open architecture choice.\n\n## Next action\n${next}\n\n## Your part\n\n### 1. Browser walk\n\n- **Ask:** Try the Acme preview on your phone.\n- **Why:** The small screen needs a real read.\n- **Look at:** The source preview.\n- **Choices:** Works | Needs changes\n- **Keeps it open:** Needs changes\n- **Takes:** Five minutes.\n- **Then:** Record what happened.\n${ready ? '- **Ready:** yes' : '- **Ready when:** A preview is deployed.'}\n`;
}
export function projectHarness({ files, shape = 'files' } = {}) {
  const h = harness();
  const state = { revision: 'b'.repeat(40), treeTruncated: false, fail: false, denied: false, requests: [], hold: null,
    files: files ?? {
      '.keel/keel.json': JSON.stringify({ name: 'Acme Studio', tagline: 'Publish useful things.', practice: '0.8.32', stack: ['node'], phases: { shape } }),
      'docs/goals.json': JSON.stringify([{ id: 'G1', title: 'A dependable studio', outcome: 'People publish confidently.' }]),
      'docs/phases/01-first.md': phaseFile(1, { next: '⚑ Choose the publishing policy.' }),
      'docs/phases/02-walk.md': phaseFile(2, { status: 'partial', owes: true }),
      'docs/phases/03-wait.md': phaseFile(3, { status: 'partial', owes: true, ready: false }),
      'docs/phases/04-built.md': phaseFile(4, { status: 'built' }),
      'docs/evidence/acme.md': '# Acme evidence\nA dated observation.\n',
    },
  };
  const digest = value => createHash('sha1').update(value).digest('hex');
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json',
    'x-ratelimit-remaining': '5000', 'x-ratelimit-reset': String(Math.floor(h.state.now / 1000) + 3600) } });
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/repositories/102' || path.startsWith('/repos/acme/studio/')) {
      state.requests.push({ url, options });
      if (state.hold) await state.hold;
      if (state.denied) return json({ message: 'fake-private-provider-error' }, 401);
      if (state.fail) return json({ message: 'fake-private-provider-error' }, 500);
      if (path === '/repositories/102') return json({ id: 102, full_name: 'acme/studio', default_branch: 'main' });
      if (path.endsWith('/commits')) return json([{ sha: state.revision, commit: { tree: { sha: 'c'.repeat(40) }, message: 'Improve the Acme experience', committer: { date: '2026-10-20T12:00:00Z' } } }]);
      if (path.includes('/git/trees/')) return json({ truncated: state.treeTruncated, tree: Object.entries(state.files).map(([path, content]) => ({ path, type: 'blob', mode: '100644', sha: digest(content), size: Buffer.byteLength(content) })) });
      if (path.includes('/git/blobs/')) {
        const content = Object.values(state.files).find(content => digest(content) === path.split('/').at(-1));
        if (content === undefined) return json({}, 404);
        return json({ sha: digest(content), encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') });
      }
      throw Error(`Unexpected source fixture path ${path}`);
    }
    return h.fetcher(url, options);
  };
  return { ...h, source: state, fetcher, service: createWebService(h.config, { fetcher, now: () => h.state.now }),
    makeService: () => createWebService(h.config, { fetcher, now: () => h.state.now }),
    access: { userId: 1, workspace: { id: 'acme', name: 'Acme' }, sourceRevision: 'a'.repeat(40), projects: [{ id: 'studio', repoId: 102, repo: 'acme/studio' }], quota: null },
  };
}

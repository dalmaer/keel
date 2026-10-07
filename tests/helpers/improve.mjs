// What tests/improve.test.mjs and tests/improve-measures.test.mjs share: keel
// run from its bin, scratch projects, and a gh stub.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run.mjs';

export const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BIN = join(KEEL, 'bin', 'keel.mjs');
export const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Acme', GIT_AUTHOR_EMAIL: 'acme@acme.test', GIT_COMMITTER_NAME: 'Acme', GIT_COMMITTER_EMAIL: 'acme@acme.test' };
export const keel = (args, cwd, env = ENV) => {
  const r = run(process.execPath, [BIN, ...args], { cwd, env });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
};
export const byId = (data, id) => data.measures.find(m => m.id === id);

export async function scratch(t, prefix = 'keel-improve-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A fresh, healthy keel project (keel init), with no repo. */
export async function project(t) {
  const dir = join(await scratch(t), 'acme');
  const r = keel(['init', dir, '--description', 'Acme sells anvils.', '--name', 'Acme'], tmpdir());
  assert.equal(r.code, 0, r.err + r.out);
  return dir;
}

/** Every file under dir with its bytes, to prove nothing else was written. */
export async function snapshot(dir, skip = new Set(['.git'])) {
  const out = {};
  const walk = async d => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out[p.slice(dir.length + 1)] = await readFile(p, 'utf8');
    }
  };
  await walk(dir);
  return out;
}

/** No PRs to review: the GraphQL answer reviews_unanswered reads, empty. */
export const NO_REVIEWS = JSON.stringify({ data: { repository: { open: { pageInfo: { hasNextPage: false }, nodes: [] }, merged: { nodes: [] } } } });

/**
 * A gh stub: --version ok; auth as given; run/pr list answer or fail; api
 * graphql answers `reviews` (a list: one page each call, in order, the last
 * repeated; each call's arguments logged to <gh>.log). `api` answers REST
 * `gh api <path>`: a map from the path (with its query, else the path before
 * it) to the JSON it prints, or null for a 404; each path asked is logged to <gh>.api.log.
 */
export async function ghStub(t, { auth = true, runs = '[]', prs = '[]', issues = '[]', reviews = NO_REVIEWS, failRuns = false, api = {} } = {}) {
  const dir = await scratch(t, 'keel-gh-');
  const gh = join(dir, 'gh');
  await writeFile(gh, `#!${process.execPath}
const a = process.argv.slice(2);
if (a.includes('--version')) console.log('gh version 2.0.0 (stub)');
else if (a[0] === 'auth') process.exit(${auth ? 0 : 1});
else if (a[0] === 'run') {
  if (${failRuns}) { console.error('HTTP 404: Not Found'); process.exit(1); }
  // gh's --limit counts runs, as the real one does.
  const all = JSON.parse(${JSON.stringify(runs)}), at = a.indexOf('--limit');
  console.log(JSON.stringify(at >= 0 && Array.isArray(all) ? all.slice(0, Number(a[at + 1])) : all));
}
else if (a[0] === 'pr') console.log(${JSON.stringify(prs)});
else if (a[0] === 'issue') console.log(${JSON.stringify(issues)});
else if (a[0] === 'api' && a[1] === 'graphql' && !a.some(x => x.startsWith('query=mutation'))) {
  const fs = require('node:fs'), pages = [].concat(${JSON.stringify(reviews)}), log = ${JSON.stringify(gh + '.log')};
  const n = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).length : 0;
  fs.appendFileSync(log, JSON.stringify(a.filter(x => !x.startsWith('query='))) + '\\n');
  console.log(pages[Math.min(n, pages.length - 1)]);
}
else if (a[0] === 'api' && a[1] !== 'graphql') {
  const fs = require('node:fs'), answers = ${JSON.stringify(JSON.stringify(api))};
  fs.appendFileSync(${JSON.stringify(gh + '.api.log')}, a[1] + '\\n');
  const all = JSON.parse(answers), hit = Object.hasOwn(all, a[1]) ? all[a[1]] : all[a[1].split('?')[0]];
  if (hit === undefined || hit === null) { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
  console.log(JSON.stringify(hit));
}
else process.exit(1);
`);
  await chmod(gh, 0o755);
  return gh;
}

export const setConfig = async (dir, patch) => {
  const path = join(dir, '.keel', 'keel.json');
  const c = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, `${JSON.stringify({ ...c, ...patch }, null, 2)}\n`);
};

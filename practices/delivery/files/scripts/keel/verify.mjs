// The verifier: production is checked by the commit it serves (keel phase 81;
// keel practice `delivery`; managed: keel render rewrites it). The design is
// keel's docs/research/2026-10-16-delivery.md, items 3, 4 and 8, after
// ledger's scripts/verify-production.mjs, .github/workflows/verify-deploy.yml
// and its live-SHA deploy skip (dalmaer/ledger at c47b93b3, the owner's own;
// adapted, no code copied).
//
//   node scripts/keel/verify.mjs <sha> [--site <origin>] [--within <s>] [--every <s>] [--record] [--json]
//   node scripts/keel/verify.mjs live <sha> [--site <origin>] [--json]
//
// .keel/keel.json "delivery": { "site": "https://anvils.acme.example",
// "version": "/api/version", "smoke": ["/", { "path": "/login", "status": 307 }] }.
// --site overrides "site" (a preview).
//
// What the version path may answer (HTTP 2xx, at most 64 KiB), and nothing else:
//   - a JSON object with a "sha" or a "commit" field (both: they must agree);
//   - a JSON string;
//   - plain text that is the hash alone (whitespace around it is fine);
// each a full commit hash (40 hex, or 64 for SHA-256), any case. A short hash,
// a redirect, or any other body is "cannot read", never a guess.
//
// <sha>: production must serve that commit or a descendant of it (git
// merge-base --is-ancestor in this checkout; a commit it does not have is
// fetched from origin once, and one it still lacks is never "yes"). The
// version path is read every --every seconds (default 10) until that holds or
// --within seconds (default 600) pass; then each smoke path is read once
// (redirects are not followed) and its status compared. It passes only on
// what it saw: the version contained the commit and every smoke check matched.
// Otherwise it fails, naming each check that did not hold. --record adds the
// result to the branch keel-verify (verify.json, newest first, the last 30
// and every failure of the last 72 hours, and each site's latest always),
// where keel board and the morning brief read it.
//
// live <sha>: one read of the version path: does production already serve
// that commit or a descendant? A deploy step skips itself on yes:
//   if node scripts/keel/verify.mjs live "$SHA"; then echo "already live"; else <deploy>; fi
// Anything it cannot read is no, so the deploy runs.
//
// Exit codes: verify 0 passed, 1 failed (or its record could not be pushed);
// live 0 yes, 1 no; both 2 a bad configuration or usage.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isMain, main } from './lib.mjs';
import { deliveryOf, siteProblem, DeliveryError } from './delivery.mjs';
import { VERIFY_BRANCH, VERIFY_FILE, keptResults, verifyResults } from './morning.mjs';

/** How long a verify waits for production to report the commit, and how often it reads, in seconds. */
export const WITHIN = 600, EVERY = 10;
/** One request's bound, and how much of a body is read. */
export const REQUEST_MS = 10_000, BODY_MAX = 64 * 1024;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const short = s => (s ? s.slice(0, 7) : 'nothing');

export class VerifyError extends DeliveryError {}

/**
 * The commit a version body names: { sha } or { error } (why it is not one of
 * the accepted shapes). Pure.
 */
export function servingOf(body) {
  const text = String(body ?? '').trim();
  let value = text;
  if (/^[{"[]/.test(text)) {
    let data;
    try { data = JSON.parse(text); } catch { return { error: 'the body is not JSON, nor a commit hash alone' }; }
    if (typeof data === 'string') value = data.trim();
    else if (data && typeof data === 'object' && !Array.isArray(data)) {
      const named = ['sha', 'commit'].filter(k => data[k] !== undefined);
      if (!named.length) return { error: 'the JSON has no "sha" or "commit" field' };
      const values = named.map(k => (typeof data[k] === 'string' ? data[k].trim().toLowerCase() : null));
      if (values.some(v => v === null)) return { error: `"${named[values.findIndex(v => v === null)]}" is not a string` };
      if (values.length === 2 && values[0] !== values[1]) return { error: `"sha" (${short(values[0])}) and "commit" (${short(values[1])}) disagree` };
      value = values[0];
    } else return { error: 'the JSON is not an object with "sha" or "commit"' };
  }
  value = value.toLowerCase();
  if (!SHA.test(value)) return { error: /^[0-9a-f]{4,39}$/.test(value) ? `${JSON.stringify(value)} is a short hash: the version path must report the full commit` : `${JSON.stringify(value.slice(0, 80))} is not a commit hash` };
  return { sha: value };
}

/** One GET, never following a redirect: { status, text } or { error }. */
async function get(url, { fetch: f = globalThis.fetch, requestMs = REQUEST_MS, body = false } = {}) {
  try {
    const res = await f(url, { redirect: 'manual', signal: AbortSignal.timeout(requestMs), headers: { accept: 'application/json, text/plain;q=0.9', 'cache-control': 'no-cache' } });
    if (!body) { await res.body?.cancel?.().catch(() => {}); return { status: res.status }; }
    const reader = res.body?.getReader?.();
    let text = '', bytes = 0;
    if (reader) {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > BODY_MAX) { await reader.cancel().catch(() => {}); return { status: res.status, error: `the body is larger than ${BODY_MAX} bytes` }; }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
    return { status: res.status, text };
  } catch (e) {
    const why = e?.name === 'TimeoutError' ? `no answer within ${requestMs / 1000}s` : (e?.cause?.code ?? e?.message ?? String(e));
    return { error: `no answer (${why})` };
  }
}

/** What production reports at the version path: { sha } or { error }. */
export async function readServing(url, opts = {}) {
  const r = await get(url, { ...opts, body: true });
  if (r.error && r.status === undefined) return { error: r.error };
  if (r.status < 200 || r.status > 299) return { error: `answered HTTP ${r.status}${r.status >= 300 && r.status < 400 ? ' (a redirect; keel does not follow one)' : ''}` };
  if (r.error) return { error: r.error };
  return servingOf(r.text);
}

function git(root, env, args) {
  const r = spawnSync(env.KEEL_GIT || 'git', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
  if (r.error) throw new VerifyError(`could not run git: ${r.error.message}`, 1);
  return r;
}
const has = (root, env, sha) => git(root, env, ['cat-file', '-e', `${sha}^{commit}`]).status === 0;

/**
 * Ancestry, read in this checkout: does `serving` contain `expected`?
 * { yes } or { yes: false, why }. A commit the checkout lacks is fetched from
 * origin once a run (`state.fetched`); one it still lacks is never yes.
 */
export function contains({ root, env = process.env, expected, serving, state = {} }) {
  if (expected === serving) return { yes: true };
  if (!has(root, env, serving)) {
    if (!state.fetched) {
      state.fetched = true;
      const f = git(root, env, ['fetch', '--quiet', '--no-tags', 'origin']);
      state.fetchError = f.status === 0 ? null : (f.stderr || f.stdout).trim().split('\n')[0];
    }
    if (!has(root, env, serving)) return { yes: false, why: `production serves ${short(serving)}, a commit this repository does not have${state.fetchError ? ` (fetching origin failed: ${state.fetchError})` : ' (even after fetching origin)'}, so it cannot be shown to contain ${short(expected)}` };
  }
  const r = git(root, env, ['merge-base', '--is-ancestor', expected, serving]);
  if (r.status === 0) return { yes: true };
  if (r.status === 1) return { yes: false, why: `production serves ${short(serving)}, which does not contain ${short(expected)}` };
  return { yes: false, why: `cannot tell whether ${short(serving)} contains ${short(expected)}: ${(r.stderr || '').trim().split('\n')[0]}` };
}

/** The site, version and smoke checks a run reads, and the expected commit, checked: or a throw (exit 2). */
function plan({ root, config, sha, site, env }) {
  const d = deliveryOf(config);
  if (site !== undefined && site !== null) {
    const p = siteProblem(site);
    if (p) throw new VerifyError(`--site ${p}`);
  }
  const origin = site ? new URL(site).origin : d.site;
  if (!origin) throw new VerifyError('.keel/keel.json has no "delivery".site: the production origin to verify (or pass --site)');
  if (!d.version) throw new VerifyError('.keel/keel.json has no "delivery".version: the path that reports the commit production serves (like "/api/version")');
  const expected = String(sha ?? '').toLowerCase();
  if (!SHA.test(expected)) throw new VerifyError(`the commit to verify must be a full hash (got ${JSON.stringify(sha ?? null)})`);
  if (git(root, env, ['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true') throw new VerifyError('this checkout is shallow, so ancestry cannot be read: check out with full history (actions/checkout fetch-depth: 0)');
  if (!has(root, env, expected)) {
    git(root, env, ['fetch', '--quiet', '--no-tags', 'origin']);
    if (!has(root, env, expected)) throw new VerifyError(`${short(expected)} is not a commit in this repository (nor on origin)`);
  }
  return { origin, version: d.version, smoke: d.smoke, expected };
}

/** The Actions run a result came from, when it came from one. */
const runOf = env => (env.GITHUB_ACTIONS === 'true' && /^https:\/\//.test(env.GITHUB_SERVER_URL ?? '') && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') && /^\d+$/.test(env.GITHUB_RUN_ID ?? '') ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null);

/**
 * Verify production serves `sha` (or a descendant) and passes its smoke
 * checks. { ok, sha, site, serving, contained, attempts, waited, smoke: [{
 * path, expected, got }], failures, at, run }. ok is true only on what it saw.
 */
export async function verify({ root, config, sha, site, within = WITHIN, every = EVERY, env = process.env, fetch, requestMs = REQUEST_MS, now = () => Date.now(), sleep = ms => delay(ms) }) {
  const p = plan({ root, config, sha, site, env });
  const versionUrl = new URL(p.version, p.origin).href;
  const started = now(), deadline = started + within * 1000, state = {};
  let attempts = 0, serving = null, contained = false, last = null;
  for (;;) {
    attempts++;
    const r = await readServing(versionUrl, { fetch, requestMs });
    if (r.sha) {
      serving = r.sha;
      const c = contains({ root, env, expected: p.expected, serving: r.sha, state });
      if (c.yes) { contained = true; break; }
      last = c.why;
    } else last = `${p.version} ${r.error}`;
    if (now() + every * 1000 > deadline) break;
    await sleep(every * 1000);
  }
  const waited = Math.round((now() - started) / 1000);
  const failures = contained ? [] : [`${last}, after ${attempts} read${attempts === 1 ? '' : 's'} over ${waited}s`];
  const smoke = [];
  for (const c of p.smoke) {
    const r = await get(new URL(c.path, p.origin).href, { fetch, requestMs });
    const got = r.status ?? null, matched = got !== null && c.status.includes(got);
    smoke.push({ path: c.path, expected: c.status, got, matched });
    if (!matched) failures.push(`GET ${c.path}: expected ${c.status.join(' or ')}, got ${got ?? r.error}`);
  }
  const ok = contained === true && smoke.every(s => s.matched === true) && failures.length === 0;
  return { ok, sha: p.expected, site: p.origin, version: p.version, serving, contained, attempts, waited, smoke, failures, at: new Date(now()).toISOString(), run: runOf(env) };
}

/** Does production already serve `sha` or a descendant? One read: { live, sha, site, serving, why }. */
export async function live({ root, config, sha, site, env = process.env, fetch, requestMs = REQUEST_MS }) {
  const p = plan({ root, config, sha, site, env });
  const r = await readServing(new URL(p.version, p.origin).href, { fetch, requestMs });
  if (!r.sha) return { live: false, sha: p.expected, site: p.origin, serving: null, why: `${p.version} ${r.error}: not shown to be live, so deploy` };
  const c = contains({ root, env, expected: p.expected, serving: r.sha });
  return { live: c.yes, sha: p.expected, site: p.origin, serving: r.sha, why: c.yes ? `production serves ${short(r.sha)}, which contains ${short(p.expected)}` : c.why };
}

/**
 * Add a verify's result to keel-verify:verify.json on `remote` (newest first,
 * what morning.mjs keptResults keeps: the last 30, and every failure until
 * its brief has read it), with a lease on the tip it read; a lost race is read
 * again, at most `attempts` times. A file there that is not a verify record, or a
 * branch with none, is never replaced (exit 1); every other file on the branch
 * is kept. { recorded: true, commit, branch }.
 */
export function record({ root, result, remote = 'origin', env = process.env, attempts = 3, now = Date.now(), production = null }) {
  const entry = { sha: result.sha, ok: result.ok, at: result.at, site: result.site, serving: result.serving, failures: result.failures, ...(result.run ? { run: result.run } : {}) };
  const ref = `refs/heads/${VERIFY_BRANCH}`, local = 'refs/keel/verify/tip';
  const ok = (args, what, input) => {
    const r = spawnSync(env.KEEL_GIT || 'git', args, { cwd: root, env, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
    if (r.error || r.status !== 0) throw new VerifyError(`${what}: git ${args[0]} failed: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`, 1);
    return r.stdout.trim();
  };
  for (let n = 1; n <= attempts; n++) {
    const listed = git(root, env, ['ls-remote', '--exit-code', '--heads', remote, ref]);
    if (![0, 2].includes(listed.status)) throw new VerifyError(`cannot read ${VERIFY_BRANCH} on ${remote}: git ls-remote exited ${listed.status}`, 1);
    let tip = null, results = [];
    if (listed.status === 0) {
      ok(['fetch', '--quiet', '--no-tags', remote, `+${ref}:${local}`], `cannot fetch ${VERIFY_BRANCH}`);
      tip = ok(['rev-parse', '--verify', `${local}^{commit}`], `cannot read ${VERIFY_BRANCH}`);
      // An existing branch is keel's only when it holds a verify record: anything else is someone's, and never overwritten (PR #182 review).
      const shown = git(root, env, ['show', `${tip}:${VERIFY_FILE}`]);
      if (shown.status !== 0) throw new VerifyError(`${VERIFY_BRANCH} exists on ${remote} and holds no ${VERIFY_FILE}: it is not keel's verify record, so it is left alone, and this result is not recorded`, 1);
      try { results = verifyResults(shown.stdout); } catch (e) { throw new VerifyError(`${VERIFY_BRANCH}:${VERIFY_FILE} is not a verify record (${e.message}): it is left alone, and this result is not recorded`, 1); }
    }
    const text = `${JSON.stringify({ results: keptResults([entry, ...results], now, { production }) }, null, 2)}\n`;
    const blob = ok(['hash-object', '-w', '--stdin'], 'cannot write the record', text);
    // The tip's own tree with verify.json replaced: every other entry stays as it was.
    const others = tip ? ok(['ls-tree', '-z', tip], `cannot read ${VERIFY_BRANCH}'s tree`).split('\0').filter(e => e && e.split('\t').slice(1).join('\t') !== VERIFY_FILE) : [];
    const tree = ok(['mktree', '-z'], 'cannot write the record', [...others, `100644 blob ${blob}\t${VERIFY_FILE}`].map(e => `${e}\0`).join(''));
    const commit = ok(['-c', 'user.name=keel-verify', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit-tree', tree, ...(tip ? ['-p', tip] : []), '-m', `keel verify: ${entry.ok ? 'passed' : 'failed'} for ${short(entry.sha)} (${entry.at})`], 'cannot write the record');
    const pushed = git(root, env, ['push', '--quiet', '--no-verify', `--force-with-lease=${ref}:${tip ?? ''}`, remote, `${commit}:${ref}`]);
    if (pushed.status === 0) return { recorded: true, commit, branch: VERIFY_BRANCH };
  }
  throw new VerifyError(`the result could not be pushed to ${VERIFY_BRANCH}: it moved under every one of ${attempts} attempts`, 1);
}

/** What a verify says, one line, then one per failure. */
export function verifyText(r) {
  if (r.ok) return `keel verify: passed. ${r.site} serves ${short(r.serving)}, containing ${short(r.sha)}${r.smoke.length ? `; ${r.smoke.length} smoke check${r.smoke.length === 1 ? '' : 's'} matched` : ''}.`;
  return [`keel verify: FAILED for ${short(r.sha)} at ${r.site}:`, ...r.failures.map(f => `  - ${f}`)].join('\n');
}

const USAGE = 'usage: node scripts/keel/verify.mjs <sha> [--site <origin>] [--within <s>] [--every <s>] [--record] [--json] | live <sha> [--site <origin>] [--json]';

/** The script's arguments: { sub: 'verify' | 'live', sha, site?, within?, every?, record }; a throw (exit 2) on anything else. */
export function parseArgs(args) {
  const out = { sub: 'verify', record: false };
  const rest = [...args];
  if (rest[0] === 'live') { out.sub = 'live'; rest.shift(); }
  const valued = out.sub === 'live' ? ['--site'] : ['--site', '--within', '--every'];
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--record' && out.sub === 'verify') { out.record = true; continue; }
    if (valued.includes(a)) {
      if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw new VerifyError(`${a} needs a value; ${USAGE}`);
      out[a.slice(2)] = rest[++i];
      continue;
    }
    if (a.startsWith('-')) throw new VerifyError(`unknown argument ${a}; ${USAGE}`);
    positional.push(a);
  }
  if (positional.length !== 1) throw new VerifyError(USAGE);
  out.sha = positional[0];
  for (const k of ['within', 'every']) {
    if (out[k] === undefined) continue;
    const n = Number(out[k]);
    if (!Number.isFinite(n) || n < 0 || n > 3600 || (k === 'every' && n === 0)) throw new VerifyError(`--${k} is seconds, ${k === 'every' ? 'more than 0' : '0 or more'} and at most 3600 (got ${JSON.stringify(out[k])})`);
    out[k] = n;
  }
  return out;
}

export async function run(args, { root = process.cwd(), env = process.env, fetch } = {}) {
  const o = parseArgs(args);
  let config;
  try { config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8')); }
  catch (e) { throw new VerifyError(`cannot read .keel/keel.json (${e.code ?? 'invalid JSON'})`); }
  if (o.sub === 'live') {
    const r = await live({ root, config, sha: o.sha, site: o.site, env, fetch });
    return { data: r, text: `keel verify live: ${r.live ? 'yes' : 'no'}. ${r.why}.`, exitCode: r.live ? 0 : 1 };
  }
  const r = await verify({ root, config, sha: o.sha, site: o.site, within: o.within, every: o.every, env, fetch });
  let text = verifyText(r), exitCode = r.ok ? 0 : 1;
  if (o.record) {
    try { r.recorded = record({ root, result: r, env, production: deliveryOf(config).site }); text += `\nRecorded on ${VERIFY_BRANCH} (${short(r.recorded.commit)}).`; }
    catch (e) { r.recorded = { recorded: false, why: e.message }; text += `\nNot recorded: ${e.message}`; exitCode = 1; }
  }
  return { data: r, text, exitCode };
}

if (isMain(import.meta)) await main(args => run(args));

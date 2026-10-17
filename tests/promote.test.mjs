// keel promote (phase 82): scripts/keel/promote.mjs, the delivery practice's,
// and the `keel promote` verb that runs it. A bare Acme origin and a clone of
// it, a gh stub that answers the Actions API and the keel-test-runs artifact
// from fixtures, and production as a stub HTTP server on 127.0.0.1: no
// network, no real remote, nobody's git settings. The script runs from a
// scratch scripts/keel/ holding the night's scripts beside it, as a project
// has them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, mkdir, cp, chmod, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { deflateRawSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { scratch, ENV, BIN } from './helpers/improve.mjs';
import { run, runAsync } from './helpers/run.mjs';
import { deliveryProblems, promoteRefOf } from '../practices/delivery/files/scripts/keel/delivery.mjs';
import { sha12 } from '../practices/night/files/scripts/keel/test-ledger.mjs';

const repo = 'acme/anvils';
const CHECK = 'npm run check';
const NIGHT = resolve('practices/night/files/scripts/keel');
const DELIVERY = resolve('practices/delivery/files/scripts/keel');
const FAST = { within: 0, every: 0.01 };
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
// No test here runs as GitHub Actions, whatever runs the suite: promote refuses to.
const QUIET = { ...ENV, GITHUB_ACTIONS: '', CI: '' };

// ---- fixtures ---------------------------------------------------------------------------

/** A real ZIP of the ledger's records, deflated, as upload-artifact makes one. */
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const { name, body } of files) {
    const data = Buffer.from(body), packed = deflateRawSync(data), n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed); centrals.push(central, n); offset += local.length + n.length + packed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** The records CI's gate leaves on one commit: its own (kind gate) and the test run under it. */
function records({ sha, tree, status = 0, outcome = 'pass' }) {
  const id = `00000000-0000-4000-8000-${sha.slice(0, 12)}`, date = ago(5);
  return [
    { kind: 'gate', runner: 'gate', commit: sha, tree, dirty: false, invocationId: id, completed: true, provenance: { version: 1, source: 'outer-launcher', invocationId: id, outerCommandHash: sha12(CHECK), scope: '.' }, gateSource: 'configured-check', commandHash: sha12(CHECK), status, date, tests: [] },
    { commit: sha, tree, dirty: false, parentInvocationId: id, completed: true, dir: '.', date, tests: [{ file: 'tests/anvil.test.mjs', name: 'anvil', outcome, ms: 3 }] },
  ];
}

/**
 * The Actions API for `commits` ({ sha, tree, conclusion? }): each a push run of
 * check.yml on main, with one job and one keel-test-runs artifact. A commit not
 * listed has no run. The runs completed two days ago: promote reads a gate at any age.
 */
function actions(commits) {
  const routes = { [`repos/${repo}`]: { private: false, default_branch: 'main' }, [`repos/${repo}/actions/workflows`]: { workflows: [{ id: 7, name: 'check', path: '.github/workflows/check.yml' }], total_count: 1 } };
  const zips = {}, minutes = 2 * 24 * 60;
  commits.forEach((c, i) => {
    const id = 100 + i, conclusion = c.conclusion ?? 'success';
    routes[`repos/${repo}/actions/workflows/7/runs?head_sha=${c.sha}`] = { workflow_runs: [{ id, workflow_id: 7, run_attempt: 1, head_sha: c.sha, head_branch: 'main', event: 'push', head_repository: { full_name: repo }, status: 'completed', conclusion, created_at: ago(minutes + 10), updated_at: ago(minutes) }], total_count: 1 };
    routes[`repos/${repo}/actions/runs/${id}/attempts/1/jobs`] = { jobs: [{ id: id * 10, run_id: id, run_attempt: 1, name: 'check', head_sha: c.sha, status: 'completed', conclusion, started_at: ago(minutes + 3), completed_at: ago(minutes) }], total_count: 1 };
    const bytes = zip(records({ ...c, status: conclusion === 'success' ? 0 : 1, outcome: conclusion === 'success' ? 'pass' : 'fail' }).map((r, j) => ({ name: `2026-10-15T00-00-0${j}-acme.json`, body: JSON.stringify(r) })));
    routes[`repos/${repo}/actions/runs/${id}/artifacts`] = { artifacts: [{ id: id * 100, name: 'keel-test-runs', expired: false, size_in_bytes: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, workflow_run: { id, head_sha: c.sha } }], total_count: 1 };
    zips[id * 100] = bytes.toString('base64');
  });
  return { routes, zips };
}

/** A gh stub: `gh api <path>` answers from the fixture (a ZIP's bytes for an artifact). */
async function ghStub(t, fixture) {
  const dir = await scratch(t, 'keel-promote-gh-');
  const gh = join(dir, 'gh'), data = join(dir, 'fixture.json'), log = join(dir, 'log');
  await writeFile(data, JSON.stringify(fixture));
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs'), a = process.argv.slice(2);
if (a[0] !== 'api' || a.length !== 2) process.exit(1);
fs.appendFileSync(${JSON.stringify(log)}, a[1] + '\\n');
const { routes, zips } = JSON.parse(fs.readFileSync(${JSON.stringify(data)}, 'utf8'));
const z = /^repos\\/[^/]+\\/[^/]+\\/actions\\/artifacts\\/(\\d+)\\/zip$/.exec(a[1]);
if (z) { if (!zips[z[1]]) process.exit(1); process.stdout.write(Buffer.from(zips[z[1]], 'base64')); process.exit(0); }
const p = a[1].replace(/[?&]per_page=\\d+&page=1$/, '');
if (!Object.hasOwn(routes, p)) { if (/\\/runs\\?head_sha=/.test(p)) { console.log(JSON.stringify({ workflow_runs: [], total_count: 0 })); process.exit(0); } console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
console.log(JSON.stringify(routes[p]));
`);
  await chmod(gh, 0o755);
  return { env: { ...QUIET, KEEL_GH: gh }, asked: async () => (existsSync(log) ? await readFile(log, 'utf8') : '').split('\n').filter(Boolean) };
}

/**
 * Production, stubbed: /api/version answers { commit: serving }, and / is 200.
 * Every answer closes its connection (PR #191, a CI flake): with keep-alive,
 * fetch pools the socket of one promote's verify, the test then blocks the
 * event loop for seconds in synchronous git and gh spawns, the server's
 * keep-alive timer closes that socket in the same turn the next verify reuses
 * it, and the read is an ECONNRESET instead of production's answer. A fresh
 * connection per read leaves no pooled socket to race.
 */
async function production(t) {
  const state = { serving: null, reads: 0 };
  const server = createServer((req, res) => {
    const close = { connection: 'close' };
    if (req.url === '/api/version') { state.reads++; res.writeHead(200, { 'content-type': 'application/json', ...close }); return res.end(JSON.stringify({ commit: state.serving })); }
    if (req.url === '/') { res.writeHead(200, close); return res.end('ok'); }
    res.writeHead(404, close); res.end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }));
  return { site: `http://127.0.0.1:${server.address().port}`, state, serve: sha => { state.serving = sha; } };
}

const configOf = (site, delivery = {}) => ({ name: 'Acme', repo, practices: ['night', 'delivery'], ci: { gateWorkflow: 'check.yml' }, delivery: { promote: 'tag:prod', site, version: '/api/version', smoke: ['/'], ...delivery } });

/**
 * A bare origin and a clone. main is A → B → C → D; green (the tested ref) is
 * at C, so D is on main but not tested; F is a commit off main. Production
 * (the tag prod) is at A. The gates: A, C and D passed, B failed, F never ran.
 */
async function acme(t, { delivery } = {}) {
  const dir = await scratch(t, 'keel-promote-');
  const origin = join(dir, 'origin.git'), root = join(dir, 'acme');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'init', '-q', '-b', 'main', root);
  git(root, 'remote', 'add', 'origin', origin);
  const prod = await production(t);
  const config = configOf(prod.site, delivery);
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify(config));
  const commit = async name => { await writeFile(join(root, `${name}.mjs`), `export const ${name} = 1;\n`); git(root, 'add', '-A'); git(root, 'commit', '-qm', `Acme ${name}`); return { sha: git(root, 'rev-parse', 'HEAD'), tree: git(root, 'rev-parse', 'HEAD^{tree}') }; };
  const A = await commit('anvil'), B = await commit('bellows'), C = await commit('crucible'), D = await commit('drill');
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'push', '-q', 'origin', `${C.sha}:refs/heads/green`);
  git(root, 'push', '-q', 'origin', `${A.sha}:refs/tags/prod`);
  git(root, 'checkout', '-q', '-b', 'acme-side', A.sha);
  const F = await commit('forge');
  git(root, 'checkout', '-q', 'main');
  const stub = await ghStub(t, actions([A, { ...B, conclusion: 'failure' }, C, D]));
  const scripts = join(root, 'scripts', 'keel');
  await cp(NIGHT, scripts, { recursive: true });
  await cp(DELIVERY, scripts, { recursive: true });
  const p = await import(pathToFileURL(join(scripts, 'promote.mjs')).href);
  const remote = ref => { try { return git(root, 'rev-parse', `${git(root, 'ls-remote', '--exit-code', 'origin', ref).split('\t')[0]}^{commit}`); } catch { return null; } };
  const refs = () => ({ prod: remote('refs/tags/prod'), green: remote('refs/heads/green'), main: remote('refs/heads/main') });
  const promote = opts => p.promote({ root, config, env: stub.env, ...FAST, ...opts });
  return { root, origin, config, prod, stub, p, promote, refs, A: A.sha, B: B.sha, C: C.sha, D: D.sha, F: F.sha, git: (...a) => git(root, ...a) };
}

/** A refusal: exit 1, naming why, and nothing moved. */
async function refused(a, opts, why) {
  const before = a.refs();
  await assert.rejects(a.promote(opts), e => e.exitCode === 1 && why.test(e.message), `${JSON.stringify(opts)} should be refused, matching ${why}`);
  assert.deepEqual(a.refs(), before, `${JSON.stringify(opts)}: nothing moved`);
}

/** The script, as the owner's keel promote runs it: cwd the project, no network but the stub. */
const script = async (a, args) => {
  const r = await runAsync(process.execPath, [join(a.root, 'scripts/keel/promote.mjs'), ...args], { cwd: a.root, env: a.stub.env });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

// ---- the guard, the preview and --yes ---------------------------------------------------------

test('keel promote refuses a commit not on the tested ref or without a passing gate, and moves the ref for one that is, only with --yes', async t => {
  const a = await acme(t);
  // Not on green: D is on main past it, F is off main, deadbeef is no commit at all.
  await refused(a, { commit: a.D, yes: true }, new RegExp(`${a.D.slice(0, 7)} is not on green \\(its tip is ${a.C.slice(0, 7)}\\): only a commit on the tested ref is promoted`));
  await refused(a, { commit: a.F, yes: true }, /is not on green/);
  await refused(a, { commit: 'deadbeef', yes: true }, /"deadbeef" is not a commit in this repository/);
  // On green, but its gate failed (B), or it has no gate result at all.
  await refused(a, { commit: a.B, yes: true }, new RegExp(`${a.B.slice(0, 7)}'s gate has not passed, as far as keel can show \\(check\\.yml\\): .*nothing was moved`));
  const none = await ghStub(t, actions([]));
  await assert.rejects(a.p.promote({ root: a.root, config: a.config, env: none.env, commit: a.C, yes: true, ...FAST }), e => e.exitCode === 1 && /gate has not passed/.test(e.message));
  assert.equal(a.refs().prod, a.A);

  // No --yes: a preview of the default commit (green's tip, C), exit 3, and nothing moves.
  const before = a.refs();
  const preview = await a.promote({});
  assert.equal(preview.exitCode, 3);
  assert.equal(preview.preview, true);
  assert.equal(preview.to, a.C, 'the default commit is the tested ref\'s tip');
  assert.equal(preview.from, a.A);
  assert.deepEqual(preview.arriving.commits.map(c => c.sha), [a.C, a.B], 'what reaches production: C and B, newest first');
  assert.equal(preview.leaving.count, 0);
  assert.equal(preview.moved, null);
  assert.deepEqual(a.refs(), before, 'a preview moves nothing');
  // The gate is phase 79's result: C's keel-test-runs records were read, not only its run's conclusion.
  assert.ok((await a.stub.asked()).includes(`repos/${repo}/actions/artifacts/10200/zip`), 'the artifact is the evidence');
  const text = a.p.promoteText(preview);
  assert.match(text, /^keel promote: preview, nothing moved \(--yes to move it\)$/m);
  assert.match(text, new RegExp(`production \\(tag:prod\\): ${a.A.slice(0, 7)} → ${a.C.slice(0, 7)} Acme crucible`));
  assert.match(text, /is on green and its gate passed: \.github\/workflows\/check\.yml run \d+, 1 test passed/);
  assert.match(text, /2 commits reach production:\n {4}[0-9a-f]{7} Acme crucible\n {4}[0-9a-f]{7} Acme bellows/);
  assert.match(text, new RegExp(`Then: ${a.prod.site}/api/version must report ${a.C.slice(0, 7)} or a descendant within 0s, then 1 smoke check\\.`));

  // --yes: the tag moves to C, and production is verified serving it. Only the one ref moved.
  a.prod.serve(a.C);
  const r = await a.promote({ yes: true });
  assert.equal(r.exitCode, 0, JSON.stringify(r.verify));
  assert.deepEqual(r.moved, { moved: true, ref: 'tag:prod', from: a.A, to: a.C });
  assert.equal(r.verify.ok, true);
  assert.deepEqual(a.refs(), { ...before, prod: a.C }, 'the tag moved; green and main did not');
  assert.match(a.p.promoteText(r), new RegExp(`keel promote: tag:prod moved ${a.A.slice(0, 7)} → ${a.C.slice(0, 7)}[\\s\\S]*keel verify: passed`));
  // Again: the tag is already C: nothing is pushed, production is verified. Forward to an earlier commit is a rollback, refused without --back.
  const again = await a.promote({ yes: true });
  assert.deepEqual([again.action, again.exitCode, again.moved.moved, again.verify.ok], ['verify', 0, false, true]);
  await refused(a, { commit: a.A, yes: true }, new RegExp(`is earlier than production, tag:prod \\(${a.C.slice(0, 7)}\\): rolling back is keel promote --back ${a.A.slice(0, 7)}`));

  // It is a person's command: never in GitHub Actions.
  await assert.rejects(a.p.promote({ root: a.root, config: a.config, env: { ...a.stub.env, GITHUB_ACTIONS: 'true' } }), e => e.exitCode === 1 && /a person's command: it does not run in GitHub Actions/.test(e.message));
});

test('a branch can be production, created on first use; a project without "delivery".promote has none', async t => {
  const a = await acme(t, { delivery: { promote: 'branch:production' } });
  a.prod.serve(a.C);
  const r = await a.promote({ commit: a.C, yes: true });
  assert.equal(r.exitCode, 0, JSON.stringify(r.verify));
  assert.equal(r.from, null, 'there was no production branch');
  assert.equal(a.git('rev-parse', a.git('ls-remote', 'origin', 'refs/heads/production').split('\t')[0]), a.C);
  assert.equal(a.refs().prod, a.A, 'the tag is not production here');
  await assert.rejects(a.p.promote({ root: a.root, config: { ...a.config, delivery: { ...a.config.delivery, promote: 'none' } }, env: a.stub.env }), e => e.exitCode === 2 && /no "delivery"\.promote/.test(e.message));
});

test('the move has a lease on the value it read: production moved by someone since is refused, not overwritten; no tested ref, nothing to promote', async t => {
  const a = await acme(t);
  const read = await a.p.plan({ root: a.root, config: a.config, commit: a.C, env: a.stub.env });
  assert.equal(read.from, a.A);
  // Meanwhile someone moves the tag by hand.
  a.git('push', '-q', '--force', 'origin', `${a.B}:refs/tags/prod`);
  assert.throws(() => a.p.move({ root: a.root, plan: read, config: a.config, env: a.stub.env }), e => e.exitCode === 1 && /origin refused moving tag:prod to [0-9a-f]{7} \(it moved since it was read/.test(e.message));
  assert.equal(a.refs().prod, a.B, 'their move stands');
  a.git('push', '-q', 'origin', ':refs/heads/green');
  await refused(a, { yes: true }, /green, the tested ref, does not exist on origin: nothing has passed through the publisher yet/);
});

test('"delivery".promote is validated, naming its key: a ref name, never the default branch nor the tested ref, and only with a site and version to verify', () => {
  const site = { site: 'https://anvils.acme.example', version: '/api/version' };
  for (const promote of ['tag:prod', 'branch:production', 'tag:release/prod', 'none']) assert.deepEqual(deliveryProblems({ delivery: { promote, ...site } }), [], promote);
  for (const [promote, why] of [['prod', /must be "tag:<name>" or "branch:<name>"/], ['tag:', /must be "tag:<name>"/], ['tag:a..b', /must be "tag:<name>"/], ['tag:refs/tags/prod', /must be "tag:<name>"/], [7, /must be "tag:<name>"/],
    ['branch:main', /never writes the default branch/], ['branch:green', /the tested ref/]]) {
    assert.match(deliveryProblems({ delivery: { promote, ...site } }).join('\n'), new RegExp(`"delivery"\\.promote .*${why.source}`), JSON.stringify(promote));
  }
  assert.match(deliveryProblems({ delivery: { promote: 'tag:prod' } }).join('\n'), /"delivery"\.promote needs "delivery"\.site and "delivery"\.version/);
  assert.deepEqual(deliveryProblems({ delivery: { promote: 'none' } }), [], 'none needs nothing');
  assert.deepEqual(promoteRefOf('tag:prod'), { kind: 'tag', name: 'prod', ref: 'refs/tags/prod', spec: 'tag:prod' });
  assert.equal(promoteRefOf('none'), null);
});

// ---- after moving ---------------------------------------------------------------------------

test('after moving it verifies production and reports; a failure suggests --back and moves nothing else', async t => {
  const a = await acme(t);
  // Production keeps serving A after the tag moved to C: the deploy did not land.
  a.prod.serve(a.A);
  const r = await a.promote({ commit: a.C, yes: true });
  assert.equal(r.exitCode, 1);
  assert.equal(r.verify.ok, false);
  assert.match(r.verify.failures[0], new RegExp(`production serves ${a.A.slice(0, 7)}, which does not contain ${a.C.slice(0, 7)}`));
  assert.equal(r.next, `production does not serve ${a.C.slice(0, 7)}: to roll back, keel promote --back ${a.A}`);
  assert.deepEqual(a.refs(), { prod: a.C, green: a.C, main: a.D }, 'the tag moved once, to C; nothing else moved, and it was not moved back');
  assert.ok(a.prod.state.reads >= 1, 'production was read');
  const text = a.p.promoteText(r);
  assert.match(text, /keel verify: FAILED/);
  assert.match(text, new RegExp(`Next: production does not serve ${a.C.slice(0, 7)}: to roll back, keel promote --back ${a.A}\\. Nothing else was moved\\.`));
  // The script says the same, exit 1, and its JSON carries the suggestion.
  a.git('push', '-q', '--force', 'origin', `${a.A}:refs/tags/prod`);
  const s = await script(a, [a.C, '--yes', '--within', '0', '--json']);
  assert.equal(s.code, 1, s.err);
  const data = JSON.parse(s.out);
  assert.equal(data.verify.ok, false);
  assert.match(data.next, /keel promote --back/);
  assert.equal(data.exitCode, undefined, 'the exit code is the process\'s, not the data\'s');
});

test('PR #191 review: after a sideways promote fails its verify, --back is never suggested; the step by hand is named, with why', async t => {
  const a = await acme(t);
  // Someone moved the tag by hand to F, a commit off the tested line; promoting C forward is allowed and sideways.
  a.git('push', '-q', '--force', 'origin', `${a.F}:refs/tags/prod`);
  a.prod.serve(a.F);
  const r = await a.promote({ commit: a.C, yes: true });
  assert.equal(r.exitCode, 1);
  assert.equal(r.from, a.F);
  assert.deepEqual(r.leaving.commits.map(c => c.sha), [a.F], 'the preview named F as leaving production');
  assert.doesNotMatch(r.next, /to roll back, keel promote --back/, 'a --back to F would be refused: it is not earlier, nor on green');
  assert.equal(r.next, `production does not serve ${a.C.slice(0, 7)}. keel promote --back cannot put production back on ${a.F.slice(0, 7)}: it is not an ancestor of ${a.C.slice(0, 7)} (this move was sideways), and it is not on green. To restore it by hand, unguarded: git push --force-with-lease=refs/tags/prod:${a.C} origin ${a.F}:refs/tags/prod`);
  await assert.rejects(a.promote({ commit: a.F, back: true, yes: true }), e => e.exitCode === 1, 'what --back would have said');
  // The step named works: it restores F exactly, with a lease on C.
  a.git(...r.next.split('by hand, unguarded: git ')[1].split(' '));
  assert.equal(a.refs().prod, a.F);
});

// ---- rolling back -------------------------------------------------------------------------------

test('--back moves the ref to an earlier tested commit with the same checks, and passes only when production reports exactly that commit', async t => {
  const a = await acme(t);
  // Not earlier than production (A): --back only ever goes back.
  await refused(a, { commit: a.C, back: true, yes: true }, new RegExp(`${a.C.slice(0, 7)} is not earlier than production, tag:prod \\(${a.A.slice(0, 7)}\\): --back moves production to an ancestor`));
  a.prod.serve(a.C);
  assert.equal((await a.promote({ commit: a.C, yes: true })).exitCode, 0);
  // The same checks: an earlier commit whose gate failed, and commits off the tested ref.
  await refused(a, { commit: a.B, back: true, yes: true }, /gate has not passed/);
  await refused(a, { commit: a.F, back: true, yes: true }, /is not on green/);
  await refused(a, { commit: a.D, back: true, yes: true }, /is not on green/);
  // The preview: what leaves production, and the exact verify that follows.
  const preview = await a.promote({ commit: a.A, back: true });
  assert.equal(preview.exitCode, 3);
  assert.deepEqual(preview.leaving.commits.map(c => c.sha), [a.C, a.B]);
  assert.match(a.p.promoteText(preview), new RegExp(`2 commits leave production:[\\s\\S]*must report exactly ${a.A.slice(0, 7)} within`));
  assert.equal(a.refs().prod, a.C);

  // The ref moves to A, but production still serves C, A's descendant: a failure, never a success.
  const still = await a.promote({ commit: a.A, back: true, yes: true });
  assert.equal(still.exitCode, 1);
  assert.equal(still.verify.ok, false, 'a descendant still serving is the newer commit, not the rollback');
  assert.equal(still.verify.exact, true);
  assert.match(still.verify.failures[0], new RegExp(`production serves ${a.C.slice(0, 7)}, not exactly ${a.A.slice(0, 7)}`));
  assert.match(still.next, new RegExp(`production does not serve exactly ${a.A.slice(0, 7)}`));
  assert.equal(a.refs().prod, a.A, 'the ref did move, once');
  // PR #191 review: the same command again finds the ref already at A. Nothing is pushed, and the exact
  // verify still runs: production still serving C is still a failure, never a success it did not see.
  const retry = await a.promote({ commit: a.A, back: true, yes: true });
  assert.deepEqual([retry.action, retry.exitCode, retry.moved.moved, retry.verify.ok, retry.verify.exact], ['verify', 1, false, false, true]);
  assert.match(retry.verify.failures[0], new RegExp(`production serves ${a.C.slice(0, 7)}, not exactly ${a.A.slice(0, 7)}`));
  const retryPreview = await a.promote({ commit: a.A, back: true });
  assert.equal(retryPreview.exitCode, 3, 'without --yes it is still a preview');
  assert.match(a.p.promoteText(retryPreview), /nothing to move \(--yes verifies production\)/);
  a.prod.serve(a.A);
  const landed = await a.promote({ commit: a.A, back: true, yes: true });
  assert.deepEqual([landed.action, landed.exitCode, landed.moved.moved], ['verify', 0, false]);
  assert.match(a.p.promoteText(landed), new RegExp(`tag:prod is already at ${a.A.slice(0, 7)}: not pushed, verified[\\s\\S]*serves exactly ${a.A.slice(0, 7)}`));  // Within the bound: production turns to A on the third read, and the rollback passes.
  a.git('push', '-q', '--force', 'origin', `${a.C}:refs/tags/prod`);
  let n = 0;
  a.prod.state.serving = null;
  Object.defineProperty(a.prod.state, 'serving', { get: () => (++n >= 3 ? a.A : a.C), set: () => {}, configurable: true });
  const back = await a.promote({ commit: a.A, back: true, yes: true, within: 5, every: 0.01, sleep: async () => {} });
  assert.equal(back.exitCode, 0, JSON.stringify(back.verify));
  assert.equal(back.verify.serving, a.A);
  assert.equal(back.verify.attempts, 3);
  assert.match(a.p.promoteText(back), new RegExp(`keel verify: passed\\. ${a.prod.site.replace(/[.]/g, '\\.')} serves exactly ${a.A.slice(0, 7)}`));
  assert.deepEqual(a.refs(), { prod: a.A, green: a.C, main: a.D });
  // --back with no production at all, and --back with no commit.
  a.git('push', '-q', 'origin', ':refs/tags/prod');
  await refused(a, { commit: a.A, back: true, yes: true }, /does not exist on origin: there is nothing to roll back/);
  await assert.rejects(a.promote({ back: true }), e => e.exitCode === 2 && /--back needs the commit/.test(e.message));
});

test('the script exits 0 moved and verified, 1 refused, 2 usage, 3 for a preview; verify.mjs --exact refuses a descendant', async t => {
  const a = await acme(t);
  a.prod.serve(a.C);
  assert.equal((await script(a, [])).code, 3, 'a preview');
  assert.equal((await script(a, [a.D, '--yes'])).code, 1, 'refused');
  assert.equal((await script(a, ['--frobnicate'])).code, 2, 'usage');
  assert.equal((await script(a, ['--back'])).code, 2, '--back needs a commit');
  const moved = await script(a, ['--yes', '--within', '0']);
  assert.equal(moved.code, 0, moved.err);
  assert.match(moved.out, /keel verify: passed/);
  // verify.mjs on its own: C serving, A asked: a descendant passes, --exact fails.
  const v = args => runAsync(process.execPath, [join(a.root, 'scripts/keel/verify.mjs'), ...args], { cwd: a.root, env: a.stub.env });
  assert.equal((await v([a.A, '--within', '0'])).status, 0);
  const exact = await v([a.A, '--within', '0', '--exact']);
  assert.equal(exact.status, 1);
  assert.match(exact.stdout, /not exactly/);
  assert.equal((await v([a.C, '--within', '0', '--exact'])).status, 0);
});

// ---- the verb ---------------------------------------------------------------------------------

test('keel promote runs the project\'s scripts/keel/promote.mjs: a preview exits 3; without the delivery practice or the script it says what is missing', async t => {
  const a = await acme(t);
  const r = run(process.execPath, [BIN, 'promote', '--json'], { cwd: a.root, env: a.stub.env });
  assert.equal(r.status, 3, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.preview, true);
  assert.equal(data.to, a.C);
  assert.equal(a.refs().prod, a.A);
  const refusedRun = run(process.execPath, [BIN, 'promote', a.D, '--yes'], { cwd: a.root, env: a.stub.env });
  assert.equal(refusedRun.status, 1);
  assert.match(refusedRun.stderr, /is not on green/);
  // Without the script (a project that has not taken this practice version), and without the practice.
  const bare = await scratch(t, 'keel-promote-bare-');
  await mkdir(join(bare, '.keel'));
  await writeFile(join(bare, '.keel/keel.json'), JSON.stringify({ ...a.config, practices: ['night'] }));
  let x = run(process.execPath, [BIN, 'promote', '--json'], { cwd: bare, env: a.stub.env });
  assert.equal(x.status, 2);
  assert.match(JSON.parse(x.stdout).error, /needs the delivery practice/);
  await writeFile(join(bare, '.keel/keel.json'), JSON.stringify(a.config));
  x = run(process.execPath, [BIN, 'promote', '--json'], { cwd: bare, env: a.stub.env });
  assert.equal(x.status, 2);
  assert.match(JSON.parse(x.stdout).error, /no scripts\/keel\/promote\.mjs/);
});

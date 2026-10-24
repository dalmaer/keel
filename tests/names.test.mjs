import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NAMES, nameRow, writeName, readNames } from '../lib/names.mjs';
import * as managed from '../practices/night/files/scripts/plates/names.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ROOTS = ['lib', 'practices', 'bin', 'scripts', '.github', 'web'];
const hash = text => createHash('sha256').update(text).digest('hex');
// A lexical token scanner, not a JavaScript parser or a transformation allowlist.
// Slash escapes and regex fragments are intentionally NOT broadly normalized.
const TOKEN = /(?:__Host-|trusted-)?keel(?:[a-zA-Z0-9_:-]|\.(?=[a-zA-Z0-9_]))*(?:(?:\\?\/)[a-zA-Z0-9_-]+)?/gi;
const known = new Set(NAMES.flatMap(row => [...row.keel.matchAll(TOKEN)].map(match => match[0])));
// Standalone former branding, command and schema-key spellings are compatibility
// entry points. This closed list cannot swallow a longer token such as keel-foo.
const COMPATIBILITY_WORDS = new Set(['keel', 'Keel', 'KEEL', 'Keel-to-Plates']);
// Exact syntactic extensions of named identities: property/refspec, documented
// example suffix, shell default delimiter and an artifact member path. No wildcards.
const SPELLINGS = {
  "keel/update-v": "keel/update-",
  "keel/robot-N": "keel/robot-",
  "keel-verify:verify.json": "keel-verify",
  "keel-reconciliation.decisions": "keel-reconciliation",
  "keel-impact.decisions": "keel-impact",
  "keel-night-plan:refs/remotes": "keel-night-plan",
  "keel-night-plan:.keel/night": "keel-night-plan",
  "keel-canvas-night/never-ran": "keel-canvas-night",
  "keel-canvas-card/never-ran": "keel-canvas-card",
  "KEEL_CANVAS_KEEL_VERSION-": "KEEL_CANVAS_KEEL_VERSION",
  "KEEL_CANVAS_ISOCAN_VERSION-": "KEEL_CANVAS_ISOCAN_VERSION",
  "KEEL_CANVAS_ISOCAN_HOME-": "KEEL_CANVAS_ISOCAN_HOME",
  "keel-claims": "keel-claims/phase-",
  "trusted-keel/scripts": "trusted-keel"
};
const { exceptions: ALLOWED } = JSON.parse(await readFile(new URL('./fixtures/names-compatibility.json', import.meta.url), 'utf8'));
function inventoried(token) {
  if (known.has(token)) return true;
  const normalized = token.replace(/\\+\//g, '/').replace(/\/[gim]+$/, '').replace(/:$/, '');
  if (known.has(normalized)) return true;
  const identity = SPELLINGS[token];
  return identity !== undefined && NAMES.some(row => row.keel === identity);
}
const HISTORICAL_SQL = [
  [
    "lib/web/migrations/001-auth.sql",
    "d781518926df727d9d31ba713eb60b4a472316a64c6dd47ab9ce53c701641da0"
  ],
  [
    "lib/web/migrations/002-home-cache.sql",
    "e02604b4aa0352506d2fc86218bbeb844e9c7f0d10fb2f18d64ad1c0707110f9"
  ],
  [
    "lib/web/migrations/003-home-retry.sql",
    "f4a3e1dad76f0cb62cdf800602970e2bb07a79b2e9e2863964b3222e6f13a7df"
  ],
  [
    "lib/web/migrations/004-decision-operations.sql",
    "cfe712281521b2d5bdf1c74117a78d818ecada1aeda76449de6de67b19b00459"
  ],
  [
    "lib/web/migrations/005-walk-drafts.sql",
    "c09c6f345533bd3f62c7d8ca767587ff72dab4dc9d99481d5026b78bacf0d95e"
  ],
  [
    "lib/web/migrations/006-private-media.sql",
    "04edb90bf043d4f42caf285a21ebf17dd25581b8b1d3bf7a03bd484839fd9d2f"
  ],
  [
    "lib/web/migrations/007-run-history.sql",
    "0a55a4cf0898403acbdb6781e12ab43d9e69b62f4448d89ec45bd32d5d0ba616"
  ],
  [
    "lib/web/migrations/008-connections.sql",
    "844a175ed75799373fbfdd3fcb45dc657af056b859ff15986509c4f8fcf4f67e"
  ],
  [
    "lib/web/migrations/009-jobs.sql",
    "59c353153dad95d1515589b863e91dfc51a14b3f4e4d19cb9ec4395b909ac711"
  ],
  [
    "lib/web/migrations/010-fleet-updates.sql",
    "b8d310624b5fc0347ecc7a3f1c3503a09e772861128d047e23b981e7645ec68f"
  ],
  [
    "lib/web/migrations/011-model-routing.sql",
    "6ad30e4cdc728655b129681d3a24d96dcb54f59fc45b5ddac236444835f9c5f8"
  ],
  [
    "lib/web/migrations/012-editor-drafts.sql",
    "42d8e7528825fd1322c20b2c1f123bb85ff9be8b2b2f9ac819742fcb69b361bc"
  ],
  [
    "lib/web/migrations/013-night-retries.sql",
    "f0e9eac274f0f8d7deac9d17cd3e8df8c609c6badc6df1d17ff9c90eafb26856"
  ]
];
function scanText(path, text) {
  const problems = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const match of line.matchAll(TOKEN)) {
      const token = match[0];
      if (inventoried(token) || COMPATIBILITY_WORDS.has(token)) continue;
      if (ALLOWED.some(row => row.token === token && row.reason && row.occurrences.some(occurrence =>
        occurrence.path === path && (!occurrence.lineHash || occurrence.lineHash === hash(line))))) continue;
      problems.push(`${path}:${index + 1}: unlisted name ${token}`);
    }
  }
  return problems;
}
async function scan(root) {
  const problems = [];
  async function walk(path) {
    // web/ is a reserved source root; this revision hosts it under lib/web/.
    // Still traverse it if present (including the scratch-root guard probe).
    const entries = await readdir(join(root, path), { withFileTypes: true }).catch(error => {
      if (path === 'web' && error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      const file = `${path}/${entry.name}`;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) problems.push(...scanText(file, await readFile(join(root, file), 'utf8')));
      else problems.push(`${file}: source coverage unavailable for non-regular entry`);
    }
  }
  for (const path of ROOTS) await walk(path);
  return problems;
}

test('every keel token in shipped code is a table row or an allowed kind', async () => {
  assert.deepEqual(await scan(ROOT), []);
});

test('a keel name the table does not list fails, naming where', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'plates-names-acme-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  for (const root of ROOTS) {
    await mkdir(join(scratch, root), { recursive: true });
    await writeFile(join(scratch, root, 'acme.mjs'), '// synthetic Acme source\nexport const branch = "keel-foo/";\n');
  }
  assert.deepEqual(await scan(scratch), ROOTS.map(root => `${root}/acme.mjs:2: unlisted name keel-foo`));
  // Every exception remains closed to a new token on the very same line.
  for (const row of ALLOWED) for (const { path, lineHash } of row.occurrences) {
    const lines = (await readFile(join(ROOT, path), 'utf8')).split(/\r?\n/);
    const line = lines.find(line => line.includes(row.token) && (!lineHash || hash(line) === lineHash));
    assert.ok(line !== undefined, `stale exception: ${path} ${row.token}`);
    assert.ok(scanText(path, `${line} keel-foo/`).some(problem => problem.endsWith('unlisted name keel-foo')));
  }
  for (const token of ['KEEL_NEW_SECRET', 'keel_new_rpc', 'keel:unknown-label', 'keel_private.unknown_table', '__Host-keel-unknown', 'keel-night-unknown']) {
    assert.deepEqual(scanText('lib/acme.mjs', token), [`lib/acme.mjs:1: unlisted name ${token}`]);
  }
});

test('name lookups preserve phase125 branches and reviewed phase127 env compatibility', () => {
  assert.equal(new Set(NAMES.map(row => row.id)).size, NAMES.length);
  const surfaces = new Set(['git ref','local Git path','concurrency group','artifact','marker','label','fence','variable','web','database','machine']);
  const hostedEnv = new Set(['web:KEEL_WEB_ORIGIN', 'web:KEEL_WEB_OPERATION', 'web:KEEL_WEB_CONFIG', 'web:KEEL_CONNECTION_ENCRYPTION_KEY', 'web:KEEL_GITHUB_CLIENT_SECRET', 'web:KEEL_SESSION_ENCRYPTION_KEY']);
  for (const row of NAMES) {
    assert.ok(surfaces.has(row.surface));
    assert.ok([125,126,127,128].includes(row.phase));
    const dual = row.phase === 125 || hostedEnv.has(row.id);
    assert.equal(row.state, dual ? 'dual' : 'held', row.id);
    assert.equal(nameRow(row.id), row);
    assert.equal(writeName(row.id), dual ? row.plates : row.keel);
    assert.deepEqual(readNames(row.id), dual ? [row.plates, row.keel] : [row.keel]);
    for (const state of ['dual', 'retired']) {
      const rows = [{ ...row, state }];
      assert.equal(writeName(row.id, rows), row.plates);
      assert.deepEqual(readNames(row.id, rows), state === 'dual' ? [row.plates, row.keel] : [row.plates]);
    }
  }
  const token = nameRow('git ref:keel-claims/phase-');
  assert.deepEqual([token.surface, token.phase, token.state, token.keel, token.plates],
    ['local Git path', 128, 'held', 'keel-claims/phase-', 'plates-claims/phase-']);
  for (const lookup of [nameRow, writeName, readNames]) assert.throws(() => lookup('unknown'), /Unknown name identity/);
  assert.throws(() => writeName('acme', [{ id: 'acme', state: 'unexpected' }]), /Invalid name state/);
});

test('CLI and managed scripts use one canonical table and the rendered bytes cannot drift', async () => {
  assert.equal(NAMES, managed.NAMES);
  const source = await readFile(join(ROOT, 'practices/night/files/scripts/plates/names.mjs'), 'utf8');
  assert.equal(await readFile(join(ROOT, 'scripts/plates/names.mjs'), 'utf8'), source);
  const practice = JSON.parse(await readFile(join(ROOT, 'practices/night/practice.json'), 'utf8'));
  assert.deepEqual(practice.files.find(row => row.path === 'scripts/plates/names.mjs'), {
    path: 'scripts/plates/names.mjs', from: 'scripts/plates/names.mjs', kind: 'managed',
  });
});

test('historical database migrations retain their exact bytes', async () => {
  assert.ok(HISTORICAL_SQL.length > 0);
  for (const [path, digest] of HISTORICAL_SQL) assert.equal(hash(await readFile(join(ROOT, path))), digest, path);
});

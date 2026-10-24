// Historical dependency-size observation; reads Git blobs and writes no repository state.
import { execFileSync } from 'node:child_process';
import { resolve, posix } from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const repository = resolve(process.argv[2] ?? '.');
const { exportSource, ARTIFACT_BYTES, FILE_LIMIT } = await import(pathToFileURL(resolve(repository, 'lib/evaluation-artifacts.mjs')));
const git = (...args) => execFileSync('/usr/bin/git', ['--no-pager', '-c', 'core.fsmonitor=false', '-C', repository, ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 10000 });
const revision = 'd0e9b19fe2067db0a0a60e81e4315028fe5fbe92';
const paths = ['lib/canvas-sync.mjs', 'lib/canvas-snapshot.mjs', 'practices/night/files/scripts/keel/improve.mjs', 'lib/learn.mjs'];
const files = paths.map(path => ({ path, blob: git('rev-parse', `${revision}:${path}`).toString().trim(), bytes: git('show', `${revision}:${path}`).length }));
const sync = git('show', `${revision}:lib/canvas-sync.mjs`).toString();
const snapshot = git('show', `${revision}:lib/canvas-snapshot.mjs`).toString();
assert.match(sync, /const collector = await import\('\.\/canvas-snapshot\.mjs'\)/);
assert.match(snapshot, /import \{ MEASURES \} from '\.\.\/practices\/night\/files\/scripts\/keel\/improve\.mjs'/);
assert.match(snapshot, /import \{ parseProposal \} from '\.\/learn\.mjs'/);
const minimumBytes = files.reduce((n, f) => n + f.bytes, 0);
assert.ok(minimumBytes > ARTIFACT_BYTES);
assert.throws(() => exportSource(repository, revision, paths), /artifact byte limit exceeded/);
// Inventory recursively reachable literal ESM imports as evidence, not a claim
// of complete dynamic/resource closure. The four-file lower bound suffices.
const seen = new Map(), pending = ['lib/canvas-sync.mjs', 'lib/canvas-night.mjs'];
const unavailable = [];
while (pending.length) {
  assert.ok(seen.size <= 128 && pending.length <= 512, 'closure inventory bound exceeded');
  const path = pending.pop(); if (seen.has(path)) continue;
  let bytes;
  try { bytes = git('show', `${revision}:${path}`); } catch { unavailable.push(path); continue; }
  seen.set(path, { path, bytes: bytes.length });
  for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"\n]+)['"]/g)) {
    const dependency = posix.normalize(posix.join(posix.dirname(path), match[1]));
    if (!seen.has(dependency)) pending.push(dependency);
  }
}
console.log(JSON.stringify({ revision, surface: 'historical snapshot-based canvas sync and recovery export', limits: { bytes: ARTIFACT_BYTES, files: FILE_LIMIT }, minimumFiles: files, minimumBytes, excessBytes: minimumBytes - ARTIFACT_BYTES, exporter: 'refused: artifact byte limit exceeded', literalImportInventory: { fileCount: seen.size, bytes: [...seen.values()].reduce((n,f) => n+f.bytes,0), unavailable, files: [...seen.values()].sort((a,b)=>a.path.localeCompare(b.path)) }, conclusion: 'full source closure cannot fit; direct-card API scope is a separate design choice' }, null, 2));

// Refusal must preserve the complete synthetic owner tree. Apache-2.0 provenance in rename-support.
import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { applyRename } from '../lib/rename.mjs';
import { fixture, put, get, git, commit, cleanup } from './rename-support.mjs';
for (const [path, bytes] of [
  ['.github/workflows/acme.yml', 'name: Acme\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: acme/keel-lint@v1\n        with:\n          keel-config: strict\n'],
  ['src/acme.py', 'options = {"keel": "enabled"}\n'],
]) {
  const root = await fixture();
  try {
    await put(root, path, bytes); await put(root, '.keel/bounds.json', '{ "keel-owner": "opaque Keel budget" }\n'); commit(root);
    const before = git(root, 'diff', 'HEAD');
    await assert.rejects(applyRename(root), /unowned.*explicit migration/);
    assert.equal(git(root, 'diff', 'HEAD'), before); assert.equal(await get(root, path), bytes);
    assert.equal(await get(root, '.keel/bounds.json'), '{ "keel-owner": "opaque Keel budget" }\n');
    await assert.rejects(lstat(join(root, '.plates')), { code: 'ENOENT' });
  } finally { await cleanup(root); }
}
const root = await fixture();
try { commit(root); await applyRename(root); assert.equal(await get(root, 'managed.mjs'), '// Plates care\nexport const acme = true;\n'); }
finally { await cleanup(root); }
console.log('Acme rename ownership accepted');

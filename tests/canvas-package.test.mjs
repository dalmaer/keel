// Exercise canvas from npm's artifact, away from the checkout and without an
// SDK install. package.test.mjs already proves the new project's full gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readdir, readFile, readlink, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { run } from './helpers/run.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Compare bytes, modes, links and directory entries, including Git metadata.
// No status command (which can refresh Git's index) is needed to detect writes.
async function tree(root, excluded = []) {
  const found = {};
  async function walk(dir, prefix = '') {
    for (const name of (await readdir(dir)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (excluded.some(p => path === p || path.startsWith(`${p}/`))) continue;
      const full = join(dir, name), info = await lstat(full);
      found[path] = info.isSymbolicLink() ? { link: await readlink(full) }
        : info.isDirectory() ? { directory: true, mode: info.mode }
          : { hash: createHash('sha256').update(await readFile(full)).digest('hex'), mode: info.mode };
      if (info.isDirectory()) await walk(full, path);
    }
  }
  await walk(root);
  return found;
}

test('npm-packed canvas runs locally without an SDK and fails closed at the executable boundary', async t => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'keel-canvas-package-')));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const fake = join(tmp, 'acme-isocan'), calls = join(tmp, 'acme-calls');
  // Every executable contact is recorded outside the project. No real provider
  // or user session can be reached, even if a collector regresses.
  await writeFile(fake, `#!/bin/sh
printf '%s\\n' "$*" >> "$ACME_CALLS"
if [ "$#" -eq 1 ] && [ "$1" = '--version' ]; then
  printf '%s\\n' '999.0.0 (acme-unsupported)'
  exit 0
fi
exit 71
`, { mode: 0o755 });
  const env = {
    ...process.env,
    npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    npm_config_cache: join(tmp, 'npm-cache'),
    KEEL_ISOCAN: fake, ISOCAN: fake, KEEL_GH: fake, ACME_CALLS: calls,
    KEEL_CLAUDE_DIR: join(tmp, 'no-sessions'), KEEL_CACHE: join(tmp, 'keel-cache'),
    GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
    GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  };
  delete env.NODE_PATH;
  const pack = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp], { cwd: KEEL, env });
  assert.equal(pack.status, 0, `npm pack failed:\n${pack.stderr}`);
  const [{ filename }] = JSON.parse(pack.stdout);
  const unpack = run('tar', ['xzf', join(tmp, filename), '-C', tmp], { env });
  assert.equal(unpack.status, 0, unpack.stderr);
  const pkg = join(tmp, 'package'), bin = join(pkg, 'bin/keel.mjs'), root = join(tmp, 'acme');

  const manifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(Object.keys(manifest[field] ?? {}), [], `packed runtime unexpectedly requires ${field}`);
  }
  const packedTree = await tree(pkg);
  assert.ok(!Object.keys(packedTree).some(p => p.split('/').includes('node_modules')), 'no installed or vendored SDK is needed');
  // Let Node parse and resolve the real module graph. A source regex mistakes
  // strings such as 'derived-from' for imports and cannot prove runtime loading.
  // Also refuse accidental resolution through an ancestor's node_modules.
  const modules = ['canvas', 'canvas-snapshot', 'canvas-render', 'canvas-sync', 'canvas-retro', 'canvas-night'];
  const loaded = run(process.execPath, ['--input-type=module', '--eval', `
    import { registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const packageURL = pathToFileURL(process.argv[1] + '/').href;
    registerHooks({ resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (!resolved.url.startsWith('node:') && !resolved.url.startsWith(packageURL)) {
        throw new Error('Dependency resolves outside packed runtime: ' + specifier);
      }
      return resolved;
    } });
    const modules = JSON.parse(process.argv[2]);
    for (const name of modules) await import(new URL('lib/' + name + '.mjs', packageURL));
    process.stdout.write(JSON.stringify(modules));
  `, pkg, JSON.stringify(modules)], { cwd: tmp, env });
  assert.equal(loaded.status, 0, `packed modules failed to load without external dependencies:\n${loaded.stderr}`);
  assert.deepEqual(JSON.parse(loaded.stdout), modules, 'every canvas entry point actually loaded');

  const init = run(process.execPath, [bin, 'init', root, '--description', 'Acme. Packed canvas smoke.', '--kind', 'node', '--json'], { cwd: tmp, env });
  assert.equal(init.status, 0, `packed init failed:\n${init.stdout}${init.stderr}`);
  assert.doesNotThrow(() => JSON.parse(init.stdout), 'init keeps stdout machine readable');
  const before = await tree(root);
  const cli = (args, overrides = {}) => {
    const r = run(process.execPath, [bin, 'canvas', ...args, '--json'], { cwd: root, env: { ...env, ...overrides } });
    assert.equal(r.stderr, '', r.stderr);
    let data;
    assert.doesNotThrow(() => { data = JSON.parse(r.stdout); }, `expected one JSON response: ${r.stdout}`);
    assert.equal(data.exitCode, r.status, 'JSON and process exit codes agree');
    return { status: r.status, data };
  };

  await t.test('snapshot and browsable HTML ship and write only their explicit outputs', async () => {
    const snapshot = cli(['snapshot', '--output', 'canvas-snapshot.json']);
    assert.equal(snapshot.status, 0, JSON.stringify(snapshot.data));
    const saved = JSON.parse(await readFile(join(root, 'canvas-snapshot.json'), 'utf8'));
    assert.equal(saved.schema, 1);
    assert.match(saved.project.name, /acme/i);
    assert.ok(Array.isArray(saved.entities));
    assert.ok(saved.coverage.length > 0, 'an empty fixture cannot masquerade as a collected project');
    const rendered = cli(['render', '--snapshot', 'canvas-snapshot.json', '--output', 'canvas-preview']);
    assert.equal(rendered.status, 0, JSON.stringify(rendered.data));
    const files = Object.keys(await tree(join(root, 'canvas-preview')));
    const htmlFiles = files.filter(p => p.endsWith('.html'));
    assert.ok(htmlFiles.length > 0, 'render produced a browsable HTML artifact');
    assert.ok(files.some(p => p.endsWith('.md')), 'the visual keeps its readable source');
    assert.ok(files.some(p => p.endsWith('.json')), 'the rendered artifacts keep their structured manifest or snapshot');
    const renderedManifest = JSON.parse(await readFile(join(root, 'canvas-preview/manifest.json'), 'utf8'));
    assert.equal(renderedManifest.projectKey, saved.project.key);
    const pulse = renderedManifest.cards.find(card => card.key === 'pulse');
    assert.ok(pulse?.html, 'manifest exposes the browsable project pulse');
    assert.match(await readFile(join(root, 'canvas-preview', pulse.html), 'utf8'), /acme/i);
    for (const card of renderedManifest.cards) {
      for (const path of [card.markdown, card.html].filter(Boolean)) {
        assert.ok(files.includes(path), `manifest points at missing packed output ${path}`);
        assert.ok((await readFile(join(root, 'canvas-preview', path))).length > 0);
      }
    }
    for (const path of htmlFiles) {
      const full = join(root, 'canvas-preview', path), html = await readFile(full, 'utf8');
      assert.match(html, /<!doctype html>/i);
      assert.match(html, /<title>[^<]+<\/title>/i);
      assert.match(html, /<body[\s>]/i);
      // Every browser asset resolves from the unpacked output. No CDN or
      // checkout-only module can silently supply a missing package file.
      for (const [, asset] of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
        assert.ok(!/^(?:[a-z]+:|\/\/)/i.test(asset), `external browser asset: ${asset}`);
        const local = resolve(dirname(full), decodeURIComponent(asset.split(/[?#]/)[0]));
        assert.ok((await lstat(local)).isFile(), `missing browser asset: ${asset}`);
      }
      for (const [, attributes, script] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc\s*=|application\/json/i.test(attributes)) continue;
        assert.doesNotThrow(() => new Script(script, { filename: path }), 'packed inline browser code parses');
      }
    }
    assert.deepEqual(await tree(root, ['canvas-snapshot.json', 'canvas-preview']), before, 'local canvas commands mutated source or Git state');
    await assert.rejects(readFile(calls), { code: 'ENOENT' }, 'local snapshot/render must not invoke providers');
  });

  await t.test('missing CLI and unsupported build return JSON errors before contacting a home', async () => {
    const baseline = await tree(root);
    const args = ['connect', '--canvas', 'https://acme.invalid/p/acme-canvas', '--audience', 'owner-only'];
    const missing = cli(args, { KEEL_ISOCAN: join(tmp, 'missing-acme-executable') });
    assert.equal(missing.status, 1, JSON.stringify(missing.data));
    assert.match(missing.data.error, /missing-cli/i);
    assert.deepEqual(missing.data.changes, []);
    const unsupported = cli(args);
    assert.equal(unsupported.status, 2, JSON.stringify(unsupported.data));
    assert.match(unsupported.data.error, /unverified|unsupported/i);
    assert.deepEqual(unsupported.data.changes, []);
    assert.deepEqual((await readFile(calls, 'utf8')).trim().split('\n'), ['--version'], 'an unverified build must receive no identity, home or write calls');
    assert.deepEqual(await tree(root), baseline, 'failed connection changed project state');
  });
  assert.deepEqual(await tree(pkg), packedTree, 'runtime mutated the unpacked package');
});

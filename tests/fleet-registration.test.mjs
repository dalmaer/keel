import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';
import { checkRegistration } from '../scripts/check-fleet-registration.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'scripts/check-fleet-registration.mjs');
async function home(dir) {
  await mkdir(join(dir, '.plates'), { recursive: true });
  await writeFile(join(dir, '.plates/plates.json'), JSON.stringify({ plates: 'self', repo: 'acme/plates' }));
}


test('central membership check fails for absent or source-only repos and passes only a managed registration', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'plates-enrollment-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await home(dir);
  const manifest = join(dir, 'plates.json');
  const unrelated = { repo: 'acme/existing', role: 'managed', kind: 'web', note: 'Preserve policy' };
  for (const [entry, expected] of [[null, 1], [{ repo: 'acme/new', role: 'source' }, 1], [{ repo: 'acme/new', role: 'managed', kind: 'web' }, 0]]) {
    const bytes = JSON.stringify([unrelated, ...(entry ? [entry] : [])]);
    await writeFile(manifest, bytes);
    const result = run(process.execPath, [BIN, '--manifest', manifest, '--repo', 'acme/new', '--json'], { cwd: ROOT });
    assert.equal(result.status, expected, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.status, expected === 0 ? 'registered' : 'missing-managed-registration');
    assert.equal(data.scope, 'cli-fleet-only');
    assert.equal(await readFile(manifest, 'utf8'), bytes, 'completion checking never enrolls or changes policy');
  }
});

test('unavailable or invalid central evidence cannot become registration success', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'plates-enrollment-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await home(dir);
  const manifest = join(dir, 'plates.json');
  for (const bytes of ['{invalid', '{}', JSON.stringify([{ repo: 'acme/new', role: 'managed' }, { repo: 'acme/new', role: 'managed' }])]) {
    await writeFile(manifest, bytes);
    const result = run(process.execPath, [BIN, '--manifest', manifest, '--repo', 'acme/new', '--json'], { cwd: ROOT });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stderr).status, 'unavailable');
  }
  await assert.rejects(checkRegistration({ manifest: join(dir, 'missing', 'plates.json'), repo: 'acme/new' }), { code: 'ENOENT' });
  const usage = run(process.execPath, [BIN, '--manifest', manifest, '--repo', 'acme/new', '--repo', 'acme/other'], { cwd: ROOT });
  assert.equal(usage.status, 2);
});

test('the approved White Elephant enrollment is present in the actual central manifest', async () => {
  const result = await checkRegistration({ manifest: join(ROOT, 'plates.json'), repo: 'dalmaer/white-elephant' });
  assert.equal(result.status, 'registered');
  assert.equal(result.entry.kind, 'web');
  assert.equal(result.entry.role, 'managed');
});

test('an admission manifest or consumer registry cannot stand in for central membership', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'plates-enrollment-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = JSON.stringify([{ repo: 'acme/new', kind: 'web', role: 'managed' }]);
  const admission = join(dir, 'validation-manifest.json');
  await writeFile(admission, bytes);
  await assert.rejects(checkRegistration({ manifest: admission, repo: 'acme/new' }), /actual plates.json/);
  const manifest = join(dir, 'plates.json');
  await writeFile(manifest, bytes);
  await assert.rejects(checkRegistration({ manifest, repo: 'acme/new' }), { code: 'ENOENT' });
  await home(dir);
  await writeFile(join(dir, '.plates/plates.json'), JSON.stringify({ repo: 'acme/new', practices: ['base'] }));
  await assert.rejects(checkRegistration({ manifest, repo: 'acme/new' }), /Plates self checkout/);
  await home(dir);
  const result = await checkRegistration({ manifest, repo: 'acme/new' });
  assert.equal(result.registryRepo, 'acme/plates');
  assert.equal(result.status, 'registered');
});

test('registry and requested repo identities must be strings, never regex-coerced JSON values', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'plates-enrollment-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await home(dir);
  const manifest = join(dir, 'plates.json');
  await writeFile(manifest, JSON.stringify([{ repo: 'acme/new', role: 'managed' }]));
  for (const repo of [['acme/plates'], null, 1, {}, 'not-an-identity']) {
    await writeFile(join(dir, '.plates/plates.json'), JSON.stringify({ plates: 'self', repo }));
    await assert.rejects(checkRegistration({ manifest, repo: 'acme/new' }), /Plates self checkout/);
  }
  await home(dir);
  for (const repo of [['acme/new'], null, 1, {}, undefined]) {
    await assert.rejects(checkRegistration({ manifest, repo }), /Provide --manifest/);
  }
});

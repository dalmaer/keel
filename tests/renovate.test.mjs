import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = async () => JSON.parse(await readFile(join(KEEL, 'practices/renovate/files/renovate.json'), 'utf8'));

test('vendored git submodules are watched, and wait for a person in the weekly lane', async () => {
  const c = await config();
  assert.equal(c['git-submodules']?.enabled, true, 'Renovate leaves submodules alone unless enabled');
  // Rules apply in order; the last match wins, so the submodule rule must beat the daily automerge lane.
  const rules = c.packageRules;
  const sub = rules.findIndex(r => r.matchManagers?.includes('git-submodules'));
  const daily = rules.findIndex(r => r.automerge === true && r.matchUpdateTypes?.includes('digest'));
  assert.ok(sub > daily, 'the submodule rule comes after the daily lane');
  assert.equal(rules[sub].automerge, false);
  assert.equal(rules[sub].groupSlug, 'weekly');
  const later = rules.slice(sub + 1).filter(r => r.automerge === true);
  assert.deepEqual(later, [], 'nothing after it merges by itself');
});

// Phase 29: two rules isocan carried are facts about a project, so the file
// takes them from the project: its own workspace packages are disabled, and
// `timezone` in .keel/keel.json is Renovate's. Fixtures are synthetic (Acme).
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { load, plan, config as readConfig, fill, shapeRenovate, withProject, packagePatterns, PROJECT } from '../lib/practices.mjs';

async function acme(t, { pkg, keel = {}, packages = {} }) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-renovate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'acme', tagline: 'Acme.', practices: ['base', 'renovate'], ...keel }));
  if (pkg) await writeFile(join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [path, name] of Object.entries(packages)) {
    await mkdir(join(dir, path), { recursive: true });
    await writeFile(join(dir, path, 'package.json'), JSON.stringify({ name }));
  }
  return dir;
}
const rendered = async dir => {
  const entries = await plan(dir, await readConfig(dir), await load(), null);
  return entries.find(e => e.path === 'renovate.json').content;
};
const TEMPLATE = () => readFile(join(KEEL, 'practices/renovate/files/renovate.json'), 'utf8');

test('a project with workspaces renders a first rule disabling them; one without renders the template byte for byte', async t => {
  const ws = await acme(t, {
    pkg: { name: 'acme', private: true, workspaces: ['packages/*', 'tools/cli'] },
    packages: { 'packages/core': '@acme/core', 'packages/web': '@acme/web', 'tools/cli': 'acme-cli', 'packages/notes': undefined },
  });
  const c = JSON.parse(await rendered(ws));
  const [first, ...rest] = c.packageRules;
  assert.deepEqual(first.matchPackageNames, ['@acme/**', 'acme', 'acme-cli'], 'one scope as a pattern, so a new @acme package is covered; the unscoped names and the root exact');
  assert.equal(first.enabled, false);
  assert.deepEqual(rest, JSON.parse(await TEMPLATE()).packageRules, 'the four lanes follow, unchanged');
  assert.equal(c.timezone, undefined, 'no timezone unless the project names one');

  assert.deepEqual(packagePatterns(['@acme/core', '@globex/ui', 'acme']), ['@acme/core', '@globex/ui', 'acme'], 'two scopes: exact names');
  assert.deepEqual(packagePatterns(['acme', 'acme-cli']), ['acme', 'acme-cli'], 'unscoped: exact names');
  assert.deepEqual(packagePatterns(['@acme/app', '@acme/core']), ['@acme/**'], 'a scoped root joins its scope');

  const plain = await acme(t, { pkg: { name: 'acme', private: true } });
  assert.equal(await rendered(plain), await TEMPLATE(), 'no workspaces: no rule, and the template as shipped');
  const none = await acme(t, {});
  assert.equal(await rendered(none), await TEMPLATE(), 'no package.json at all: the same');
});

test('timezone in .keel/keel.json is Renovate\'s, beside the schedule; a bad one is refused', async t => {
  const dir = await acme(t, { pkg: { name: 'acme' }, keel: { timezone: 'America/Denver' } });
  const text = await rendered(dir);
  const c = JSON.parse(text);
  assert.equal(c.timezone, 'America/Denver');
  assert.deepEqual(Object.keys(c).slice(Object.keys(c).indexOf('timezone'), Object.keys(c).indexOf('timezone') + 2), ['timezone', 'schedule']);
  assert.ok(!c.packageRules.some(r => r.enabled === false), 'a timezone adds no workspace rule');
  assert.throws(() => shapeRenovate(text, { timezone: 'Denver time; rm -rf' }), /"timezone" must be an IANA timezone name/);
  // The facts never reach .keel/keel.json: they ride on a non-enumerable key.
  const cfg = await withProject(dir, { name: 'acme' });
  assert.deepEqual(cfg[PROJECT], { workspaces: [] });
  assert.equal(JSON.stringify(cfg), '{"name":"acme"}');
  assert.equal(fill(await TEMPLATE(), {}, 'renovate.json'), await TEMPLATE());
});

test('Node moves in one weekly PR for a person, across .nvmrc, a Dockerfile and @types/node', async () => {
  const node = (await config()).packageRules.at(-1);
  assert.equal(node.groupSlug, 'node');
  assert.deepEqual([...node.matchManagers].sort(), ['dockerfile', 'npm', 'nvm']);
  assert.deepEqual([...node.matchDepNames].sort(), ['@types/node', 'node']);
  assert.equal(node.automerge, false);
  assert.equal(node.separateMajorMinor, false, 'a major and a minor of Node never split into two PRs');
  assert.deepEqual(node.schedule, ['before 6am on monday']);
});

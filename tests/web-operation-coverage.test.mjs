import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseRenameArgs } from '../lib/rename.mjs';
import { verbs } from '../lib/cli.mjs';
import { capabilityCatalogue } from '../lib/web/capability-registry.mjs';
import { auditOperationCoverage, reviewedOperationSources } from '../lib/web/capability-source-inventory.mjs';
import { parseArgs } from '../lib/goodnight.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const keys = [...verbs.keys()];
const access = { userId: 1, workspace: { id: 'acme', name: 'Acme' }, projects: [{ id: 'studio', repoId: 2, repo: 'acme/studio' }], contentsPermission: 'write', actionsPermission: 'write', workflowsPermission: 'write', pullRequestsPermission: 'write' };
const config = { workspace: { id: 'acme', repoId: 3 }, ownerIds: [1], projectRepoIds: { studio: 2 } };
const enabled = { ...config, nightOperations: {retryEnabled:true,planWrites:true,profiles:['studio'],verifiedAt:'2026-10-21T00:00:00.000Z',restoreReconciledAt:'2026-10-21T00:00:00.000Z'}, decisionWrites: true, workspaceWrites: true, media: { bucket: 'acme' }, jobs: { enabled: true, verifiedAt: '2026-10-21T00:00:00.000Z', restoreReconciledAt: '2026-10-21T00:00:00.000Z', scheduleWrites: true }, fleetUpdates: { enabled: true, publishEnabled: true }, connections: { enabled: true, vaultVerifiedAt: '2026-10-21T00:00:00.000Z' }, modelRouting: { enabled: true, verifiedAt: '2026-10-21T00:00:00.000Z', restoreReconciledAt: '2026-10-21T00:00:00.000Z' } };
const catalogue = (c = config, a = access, projectId = 'studio') => capabilityCatalogue(a, c, { projectId });

async function copyBoundary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'plates-acme-coverage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const source of reviewedOperationSources().files) {
    await mkdir(dirname(join(directory, source.path)), { recursive: true });
    await writeFile(join(directory, source.path), await readFile(join(root, source.path)));
  }
  return directory;
}

test('coverage follows the actual dispatcher and every reviewed known parser source', async () => {
  const result = await auditOperationCoverage({ root, registeredKeys: keys });
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
  const view = catalogue();
  assert.equal(view.coverage.registeredEntries, verbs.size);
  assert.deepEqual(view.rows.filter(row => row.id.startsWith('cli.')).map(row => row.cli[0].command.slice(7)).sort(), keys.sort());
  assert.ok(result.reviewedSources > verbs.size);
  assert.ok(result.gaps.some(gap => gap.includes('Computed imports')));
});

test('newly accepted argument in a temporary real parser invalidates the audit', async t => {
  const argv = ['edit', 'acme', '--acme-audit', 'yes'];
  assert.throws(() => parseArgs(argv), /unexpected argument/);
  const directory = await copyBoundary(t);
  const path = join(directory, 'lib/goodnight.mjs');
  const before = await readFile(path, 'utf8');
  const after = before.replace("'--budget', '--id'];", "'--budget', '--id', '--acme-audit'];");
  assert.notEqual(after, before, 'mutation must change the parser declaration');
  await writeFile(path, after);
  const changed = await import(pathToFileURL(path).href);
  assert.equal(changed.parseArgs(argv)['acme-audit'], 'yes', 'the new syntax really parses without invoking a command');
  const result = await auditOperationCoverage({ root: directory, registeredKeys: keys });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(item => item.code === 'parser_source_changed' && item.path === 'lib/goodnight.mjs'));
});

test('new dispatch entry, installed entrypoint and changed forwarded closure fail independently', async t => {
  const directory = await copyBoundary(t);
  const initial = await auditOperationCoverage({ root: directory, registeredKeys: keys });
  assert.equal(initial.ok, true);
  const dispatch = await auditOperationCoverage({ root: directory, registeredKeys: [...keys, 'acme new'] });
  assert.ok(dispatch.findings.some(item => item.code === 'dispatcher_inventory_changed'));
  await writeFile(join(directory, 'practices/night/files/scripts/plates/acme-new.mjs'), 'export const operation = true;\n');
  const installed = await auditOperationCoverage({ root: directory, registeredKeys: keys });
  assert.ok(installed.findings.some(item => item.code === 'script_inventory_changed'));
  const path = join(directory, 'practices/night/files/scripts/plates/production.mjs');
  await writeFile(path, (await readFile(path, 'utf8')).replace("'--source':'source'", "'--acme-source':'source'"));
  const forwarded = await auditOperationCoverage({ root: directory, registeredKeys: keys });
  assert.ok(forwarded.findings.some(item => item.code === 'parser_source_changed' && item.path.endsWith('/production.mjs')));
});

test('every form and argument has a treatment and nonexecuting concrete follow-up', () => {
  const view = catalogue();
  assert.equal(new Set(view.rows.map(row => row.id)).size, view.rows.length);
  for (const row of view.rows) {
    assert.ok(row.title && row.followUp && row.readiness.reason);
    assert.ok(['native', 'worker', 'presentation-only', 'limited'].includes(row.treatment));
    assert.ok(row.route === null || row.route.startsWith('/') && !row.route.startsWith('/api/'));
    for (const cli of row.cli) for (const form of cli.forms) {
      assert.equal(typeof form.positionals, 'string');
      for (const argument of form.arguments) assert.ok(argument.token && argument.arity !== undefined && argument.treatment);
    }
  }
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 256 * 1024, 'bounded catalogue response');
});

test('overloaded arity, forwarded forms and rejected syntax retain distinct semantics', () => {
  const view = catalogue();
  const forms = command => view.rows.find(row => row.id === `cli.${command}`).cli[0].forms;
  const argument = (command, token) => forms(command).flatMap(form => form.arguments).find(item => item.token === token);
  assert.equal(argument('doctor', '--fix').arity, '2');
  assert.equal(argument('prove', '--fix').arity, '1..n');
  assert.equal(argument('release', '--despite').arity, '2');
  assert.equal(argument('release', '--yes'), undefined);
  assert.ok(forms('goodnight').find(form => form.subcommand === 'edit').arguments.some(item => item.token === '--id'));
  assert.ok(forms('loose-ends').find(form => form.subcommand === 'mark').arguments.some(item => item.token === '--root'));
  assert.ok(!forms('canvas').some(form => form.subcommand === 'capture'));
  assert.ok(forms('retro').some(form => form.subcommand === 'capture'));
  const review = forms('review');
  assert.equal(review.find(form => form.subcommand === 'file-agent-issue').arguments.find(item => item.token === '--tracked').arity, 0);
  assert.equal(review.find(form => form.subcommand === 'answer').arguments.find(item => item.token === '--tracked').arity, 1);
  assert.ok(reviewedOperationSources().rejectedSyntax.some(item => item.syntax === 'plates release --yes'));
});

test('instance enablement never makes a write executable or claims observed source coverage', () => {
  const disabled = catalogue();
  const active = catalogue(enabled);
  for (const key of ['acceptance', 'prepare-update', 'publish-update', 'typecheck', 'schedule', 'credentials', 'model-task', 'night-publication', 'night-retry']) {
    assert.equal(disabled.rows.find(row => row.id === `web.${key}`).readiness.state, 'disabled');
    assert.equal(active.rows.find(row => row.id === `web.${key}`).readiness.state, 'unverified');
  }
  for (const row of active.rows) if (row.readiness.state === 'available') assert.ok(['read', 'presentation'].includes(row.effect));
  assert.match(active.rows.find(row => row.id === 'web.home').readiness.reason, /no source or provider probe/);
  assert.match(active.rows.find(row => row.id === 'web.night-retry').limitations[0], /current UTC date and plan/);
  assert.match(active.rows.find(row => row.id === 'web.night-publication').limitations[0], /Publication does not start a night/);
  const withoutProfile = catalogue({...enabled,nightOperations:{...enabled.nightOperations,profiles:[]}});
  assert.equal(withoutProfile.rows.find(row=>row.id==='web.night-retry').readiness.state,'disabled');
  assert.match(withoutProfile.rows.find(row=>row.id==='web.night-retry').readiness.reason,/not approved/);
  assert.equal(active.rows.find(row=>row.id==='web.night-retry').route,'/projects/studio/activity');
  assert.equal(active.rows.find(row=>row.id==='web.night-publication').route,'/projects/studio/daily');
});

test('current permission and immutable project scope restrict projection without leaking config', () => {
  for (const permission of ['contentsPermission', 'actionsPermission', 'workflowsPermission', 'pullRequestsPermission']) {
    const view = catalogue(enabled, { ...access, [permission]: 'read' });
    const key = { contentsPermission: 'acceptance', actionsPermission: 'typecheck', workflowsPermission: 'schedule', pullRequestsPermission: 'publish-update' }[permission];
    assert.equal(view.rows.find(row => row.id === `web.${key}`).readiness.state, 'disabled');
  }
  for (const [a, c, id] of [[access, config, 'other'], [access, { ...config, projectRepoIds: { studio: 99 } }, 'studio'], [{ ...access, workspace: { id: 'other' } }, config, null], [access, config, '../studio']]) {
    assert.throws(() => catalogue(c, a, id), error => error.code === 'access_denied');
  }
  const privateConfig = { ...enabled, clientSecret: 'Acme private secret' };
  Object.defineProperty(privateConfig, 'encryptionKey', { get() { throw new Error('must not load keys'); } });
  assert.ok(!JSON.stringify(catalogue(privateConfig)).includes('Acme private secret'));
  assert.ok(!JSON.stringify(catalogue()).includes('acme/studio'));
});

test('fleet and project links preserve task scope and copied projections cannot mutate registry', () => {
  const fleet = catalogue(config, access, null), project = catalogue();
  assert.equal(fleet.rows.find(row => row.id === 'web.walks').route, null);
  assert.equal(project.rows.find(row => row.id === 'web.walks').route, '/projects/studio/walks');
  assert.equal(project.rows.find(row => row.id === 'web.setup').route, '/setup');
  const form = project.rows.find(row => row.id === 'cli.release').cli[0].forms[0];
  form.arguments.push({ token: '--acme-injected', arity: 0, treatment: 'native' });
  assert.ok(!JSON.stringify(catalogue()).includes('--acme-injected'));
  assert.ok(fleet.rows.some(row => row.id === 'global.agent-help'));
  assert.ok(project.rows.find(row => row.id === 'routine.promote').readiness.reason.includes('not been inspected'));
});


test('migration catalogue matches the shared approval parser without enabling web execution', () => {
  const row = catalogue(enabled).rows.find(row => row.id === 'cli.migrate');
  assert.equal(row.cli[0].command, 'plates migrate');
  assert.equal(row.readiness.state, 'unsupported');
  assert.equal(row.adapter, null);
  assert.equal(row.route, null);
  const form = row.cli[0].forms[0];
  assert.equal(form.positionals, 'project-root:0..1');
  assert.deepEqual(form.arguments.map(({token, arity}) => [token, arity]), [['--json', 0], ['--yes', 0], ['--digest', 1]]);
  assert.match(form.constraints, /supplied together/);
  const digest = 'a'.repeat(64);
  assert.deepEqual(parseRenameArgs(['acme', '--yes', '--digest', digest]), {root: 'acme', yes: true, digest});
  assert.equal(parseRenameArgs(['acme', '--json']).yes, false);
  for (const args of [['--yes'], ['--digest', digest], ['--yes', '--yes', '--digest', digest], ['--yes', '--digest', digest.toUpperCase()], ['acme', 'other']]) assert.throws(() => parseRenameArgs(args));
});

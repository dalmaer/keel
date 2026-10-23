// Build/test-time audit only. Never import this module into the hosted service.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import reviewed from './capability-source-data.mjs';
import cliData from './capability-cli-data.mjs';
import routineData from './capability-routine-data.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Release versions do not change CLI grammar. Bind every other package field
// (including bin, scripts and engines) while allowing the normal release bump.
function sourceDigest(path, bytes) {
  if (path !== 'package.json') return digest(bytes);
  const pkg = JSON.parse(bytes.toString());
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('invalid_release_version');
  return digest(JSON.stringify({ ...pkg, version: '<release-version>' }));
}
const sameSet = (left, right) => left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]);

async function inventory(root) {
  const manifests = [], scripts = [];
  let count = 0;
  async function visit(path) {
    for (const item of await readdir(join(root, path), { withFileTypes: true })) {
      if (++count > 10000) throw new Error('inventory_limit');
      const child = `${path}/${item.name}`;
      if (item.isSymbolicLink()) {
        // Guide aliases are outside the script parser boundary; script links are not.
        if (child.includes('/files/scripts/')) throw new Error('script_symlink');
        continue;
      }
      if (item.isDirectory()) await visit(child);
      else if (item.isFile()) {
        if (/^practices\/[^/]+\/practice\.json$/.test(child)) manifests.push(child);
        if (/^practices\/[^/]+\/files\/scripts\/.*\.mjs$/.test(child)) scripts.push(child);
      }
    }
  }
  await visit('practices');
  return { manifests, scripts };
}

/**
 * Compare an actual CLI registry and source tree with the reviewed parser closure.
 * Hashes intentionally cover complete modules, including rejected syntax and domain
 * validators. Package metadata binds every field except the release version.
 * No parser or command is invoked. Computed adopter imports remain gaps.
 */
export async function auditOperationCoverage({ root, registeredKeys }) {
  if (typeof root !== 'string' || !Array.isArray(registeredKeys) || !registeredKeys.every(key => typeof key === 'string')) throw new TypeError('root and actual registeredKeys are required');
  const findings = [];
  if (!sameSet(registeredKeys, reviewed.entryKeys) || !sameSet(registeredKeys, cliData.map(entry => entry.command))) findings.push({ code: 'dispatcher_inventory_changed', path: 'lib/cli.mjs' });
  for (const source of reviewed.files) {
    try {
      const path = join(root, source.path), stat = await lstat(path);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('unsupported_source');
      const actual = sourceDigest(source.path, await readFile(path));
      if (actual !== source.sha256) findings.push({ code: 'parser_source_changed', path: source.path });
    } catch { findings.push({ code: 'parser_source_unavailable', path: source.path }); }
  }
  try {
    const actual = await inventory(root);
    if (!sameSet(actual.manifests, reviewed.practiceManifests)) findings.push({ code: 'practice_inventory_changed', path: 'practices' });
    if (!sameSet(actual.scripts, reviewed.practiceScripts.map(item => item.path))) findings.push({ code: 'script_inventory_changed', path: 'practices' });
  } catch { findings.push({ code: 'source_inventory_unavailable', path: 'practices' }); }
  const entrypoints = reviewed.practiceScripts.filter(item => item.entrypoint).map(item => item.path);
  if (!sameSet(entrypoints, routineData.map(item => item.source))) findings.push({ code: 'routine_coverage_changed', path: 'lib/web/capability-routine-data.mjs' });
  for (const entry of cliData) {
    if (!entry.forms.length || !entry.followUp || !entry.limitation) findings.push({ code: 'missing_cli_treatment', path: entry.id });
    for (const form of entry.forms) {
      if (typeof form.positionals !== 'string' || !Array.isArray(form.arguments) || form.arguments.some(argument => !argument.token || argument.arity === undefined || !['limited', 'presentation-only', 'native', 'worker'].includes(argument.treatment))) findings.push({ code: 'missing_argument_treatment', path: entry.id });
    }
  }
  return {
    ok: findings.length === 0, findings,
    reviewedSources: reviewed.files.length, registeredEntries: registeredKeys.length, installedEntrypoints: entrypoints.length,
    grammar: 'reviewed-source-boundary',
    gaps: ['Computed imports, installed script drift and configured local commands remain outside canonical grammar proof.'],
  };
}

export function reviewedOperationSources() {
  return structuredClone(reviewed);
}

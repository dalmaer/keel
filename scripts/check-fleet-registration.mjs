// Source-only, read-only completion check. No GitHub calls, adoption or writes.
import { readFile, lstat } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFleet, FLEET } from '../lib/fleet.mjs';

export async function checkRegistration({ manifest, repo }) {
  if (typeof manifest !== 'string' || !manifest.trim() || typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) {
    throw new Error('Provide --manifest <central-plates.json> and --repo <owner/name>.');
  }
  const path = resolve(manifest);
  if (basename(path) !== FLEET || !(await lstat(path)).isFile()) throw new Error('Use the actual plates.json at a Plates self checkout root, not an admission manifest.');
  const home = JSON.parse(await readFile(join(dirname(path), '.plates', 'plates.json'), 'utf8'));
  if (home?.plates !== 'self' || typeof home.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(home.repo ?? '')) throw new Error('Central membership requires a Plates self checkout, not a consumer manifest.');
  const entries = parseFleet(await readFile(path, 'utf8'));
  const entry = entries.find(item => item.repo.toLowerCase() === repo.toLowerCase());
  return {
    scope: 'cli-fleet-only', manifest: path, registryRepo: home.repo, repo,
    status: entry?.role === 'managed' ? 'registered' : 'missing-managed-registration',
    entry: entry ?? null,
    // This local read cannot prove the reviewed branch was merged or deployed.
    limits: ['Manifest bytes inspected locally; remote merge state is not checked.', 'Consumer adoption, hosted workspace access, schedules, workers and budgets are not verified or changed.'],
  };
}

export async function main(args) {
  const values = {};
  let json = false;
  try {
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === '--json' && !json) { json = true; continue; }
      if (!['--manifest', '--repo'].includes(key) || values[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Use --manifest <central-plates.json> --repo <owner/name> [--json].');
      values[key] = args[++i];
    }
    const result = await checkRegistration({ manifest: values['--manifest'], repo: values['--repo'] });
    console.log(json ? JSON.stringify(result, null, 2) : `${result.repo}: ${result.status} in ${result.manifest} (CLI fleet only; hosted access is separate)`);
    return result.status === 'registered' ? 0 : 1;
  } catch (error) {
    const result = { scope: 'cli-fleet-only', status: 'unavailable', error: error.message };
    console.error(json ? JSON.stringify(result) : `Fleet registration unavailable: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));

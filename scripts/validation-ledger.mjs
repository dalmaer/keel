// Source-local read-only collector. The caller explicitly retains stdout.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLedger, LEDGER_LIMITS, LedgerInputError } from '../lib/validation-ledger.mjs';
import { parseEvidenceJson } from '../lib/validation-evidence.mjs';

const exec = promisify(execFile);
const usage = 'Usage: node scripts/validation-ledger.mjs --manifest <fleet.json> --run <positive-run-id> [--json]\nReads one explicit managed Ledger GitHub Actions run through existing gh access.\nExit 0: no collector gaps; 1: advisory gaps; 2: invalid input or unusable request.\nNever executes gates, dispatches jobs, changes policy, or writes files.';

async function readJson(path) {
  const absolute = resolve(path);
  if (await realpath(absolute) !== absolute) throw new LedgerInputError('input_symlink');
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > LEDGER_LIMITS.jsonBytes) throw new LedgerInputError('input_file');
    const chunks = []; let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
      size += chunk.length;
      if (size > LEDGER_LIMITS.jsonBytes) throw new LedgerInputError('input_bound');
      chunks.push(chunk);
    }
    return parseEvidenceJson(Buffer.concat(chunks));
  } finally { await file.close(); }
}

async function main(args) {
  const json = args.includes('--json');
  try {
    if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
    const options = {};
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === '--json') { if (options.json) throw new LedgerInputError('duplicate_flag'); options.json = true; continue; }
      if (!['--manifest', '--run'].includes(key) || options[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw new LedgerInputError('invalid_arguments');
      options[key] = args[++i];
    }
    if (!options['--manifest'] || !/^[1-9][0-9]{0,15}$/.test(options['--run'] ?? '') || !Number.isSafeInteger(Number(options['--run']))) throw new LedgerInputError('manifest_and_positive_run_required');
    const fleet = await readJson(options['--manifest']);
    const profile = await readJson(fileURLToPath(new URL('./validation-manifests/ledger.v1.json', import.meta.url)));
    // No input selects a repository or coverage profile. This source slice is Ledger only.
    if (profile.repo !== 'dalmaer/ledger') throw new LedgerInputError('profile_repository');
    const get = async (path, { timeoutMs, maxBytes, accept }) => {
      // All paths are constructed by the collector, and the host is pinned even
      // when GH_HOST or a personal default points elsewhere. No shell involved.
      const result = await exec(process.env.PLATES_GH || 'gh', ['api', '--hostname', 'github.com', '--method', 'GET', ...(accept ? ['--header', `Accept: ${accept}`] : []), path], { encoding: 'buffer', timeout: timeoutMs, maxBuffer: maxBytes, killSignal: 'SIGKILL' });
      return result.stdout;
    };
    const report = await collectLedger({ fleet, profile, runId: Number(options['--run']), request: get, download: get, transport: process.env.PLATES_GH ? 'override' : 'gh-read-only' });
    console.log(json ? JSON.stringify(report, null, 2) : [
      `Ledger retained evidence: ${report.gaps.length} advisory gaps; ${report.coverage.childRecords} child records.`,
      ...[...new Set(report.gaps.map(g => g.code))].map(code => `  ${code}`),
      'Configured gate complete: false. Reuse authorized: false.',
    ].join('\n'));
    process.exitCode = report.status;
  } catch (error) {
    // Never echo transport stderr, OS paths, provider bodies or parser snippets.
    const code = error instanceof LedgerInputError ? error.code : 'input_or_request_unusable';
    console.error(json ? JSON.stringify({ schema: 1, error: code, authority: 'advisory-only', reuseAuthorized: false }) : `validation-ledger: ${code}`);
    process.exitCode = 2;
  }
}
await main(process.argv.slice(2));

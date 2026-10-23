// Source-only shadow validation. Explicit read-only files; no execution or reuse.
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvidence, parseEvidenceJson, EVIDENCE_LIMITS, EvidenceInputError } from '../lib/validation-evidence.mjs';

const usage = 'Usage: node scripts/validation-evidence.mjs --expected /canonical/expected.json --source /canonical/source.json --artifact /canonical/artifact.json [--json]\nRead-only shadow validation. Exit 0: consistent coverage; 1: rejected evidence; 2: invalid/unreadable input. No exit authorizes reuse or replaces a required gate.';

async function bytes(path) {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) throw new EvidenceInputError('noncanonical_path');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size === 0 || before.size > EVIDENCE_LIMITS.bytes) throw new EvidenceInputError('input_file');
    const buffer = Buffer.alloc(EVIDENCE_LIMITS.bytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = await file.read(buffer, size, buffer.length - size, null);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    const after = await file.stat();
    if (size > EVIDENCE_LIMITS.bytes || size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || await realpath(path) !== path) throw new EvidenceInputError('input_changed_or_oversize');
    return buffer.subarray(0, size);
  } finally { await file.close(); }
}

export async function main(args) {
  const json = args.includes('--json');
  try {
    if (args.includes('--help') && args.every(a => ['--help', '--json'].includes(a)) && new Set(args).size === args.length) {
      console.log(json ? JSON.stringify({ schema: 1, authority: 'advisory-only', usage }) : usage); return 0;
    }
    const opts = {};
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === '--json') { if (opts.json) throw new EvidenceInputError('arguments'); opts.json = true; continue; }
      if (!['--expected', '--source', '--artifact'].includes(key) || opts[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw new EvidenceInputError('arguments');
      opts[key] = args[++i];
    }
    if (['--expected', '--source', '--artifact'].some(k => !opts[k])) throw new EvidenceInputError('arguments');
    const expected = parseEvidenceJson(await bytes(opts['--expected']));
    const source = parseEvidenceJson(await bytes(opts['--source']));
    const report = validateEvidence(expected, source, await bytes(opts['--artifact']));
    console.log(json ? JSON.stringify(report, null, 2) : `Validation evidence: ${report.coverageComplete ? 'consistent' : 'rejected'} (advisory only; reuse not authorized).\n${report.findings.map(f => f.code + (f.stage ? `: ${f.stage}` : '')).join('\n')}`);
    return report.status;
  } catch (error) {
    const code = error instanceof EvidenceInputError ? error.code : 'input_unavailable';
    console.error(json ? JSON.stringify({ schema: 1, authority: 'advisory-only', reuseAuthorized: false, error: code, status: 2 }) : `validation-evidence: ${code}`);
    return 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));

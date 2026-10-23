// Source-local, read-only phase 110 entrypoint; explicit files only, no discovery.
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { auditValidation, AUDIT_LIMITS } from '../lib/validation-audit.mjs';

const usage = 'Usage: node scripts/validation-audit.mjs --manifest <file> --input <file> [--json]\nReads retained JSON evidence only. Exit 0: no findings; 1: advisory findings/gaps; 2: invalid input.\nNever executes gates, fetches resources, changes policy, or writes files.';
async function readJson(path, label) {
  // Explicit CLI paths may be absolute. Evidence strings never become file reads.
  // Reject symlink components and read at most the byte cap from an opened file.
  const absolute = resolve(path);
  if (await realpath(absolute) !== absolute) throw new Error(`${label} must not traverse symlinks`);
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error(`${label} must be a regular file`);
    const chunks = []; let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
      size += chunk.length;
      if (size > AUDIT_LIMITS.bytes) throw new Error(`${label} exceeds the byte limit`);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error(`${label} is not valid JSON`); }
  } finally { await file.close(); }
}
async function main(args) {
  const json = args.includes('--json');
  try {
    if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
    const options = {};
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      if (flag === '--json') { if (options.json) throw new Error('duplicate flag'); options.json = true; continue; }
      if (!['--manifest', '--input'].includes(flag) || options[flag] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('invalid arguments; use --help');
      options[flag] = args[++i];
    }
    if (!options['--manifest'] || !options['--input']) throw new Error('manifest and input are required');
    const report = auditValidation(await readJson(options['--manifest'], 'manifest'), await readJson(options['--input'], 'input'));
    const groups = new Map();
    for (const f of report.findings) {
      const key = JSON.stringify([f.repo, f.rule]);
      const group = groups.get(key) ?? { ...f, count: 0 };
      group.count++; groups.set(key, group);
    }
    console.log(json ? JSON.stringify(report, null, 2) : [
      `Validation audit: ${report.findings.length} findings across ${report.coverage.length} managed repositories (advisory only).`,
      ...[...groups.values()].map(f => `${f.repo} [${f.severity}] ${f.rule} (${f.count}): ${f.reason}\n  Next: ${f.nextAction}`),
      ...report.limits,
    ].join('\n'));
    process.exitCode = report.findings.length ? 1 : 0;
  } catch (error) {
    // Do not echo OS errors (paths), arbitrary input text or JSON parser snippets.
    const message = error?.code ? 'unable to read explicit input files' : error.message;
    console.error(json ? JSON.stringify({ schema: 1, error: message }) : `validation-audit: ${message}`);
    process.exitCode = 2;
  }
}
await main(process.argv.slice(2));

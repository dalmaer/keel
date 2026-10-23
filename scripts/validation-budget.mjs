// Source-only opt-in cooperative admission; never installed into a consumer automatically.
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { inspectBudgetTarget, inspectBudget, runBudget } from '../lib/validation-budget.mjs';

const usage = `Usage: node scripts/validation-budget.mjs status --state-dir /canonical/shared/dir [--capacity N] --json
       node scripts/validation-budget.mjs plan|run --manifest /canonical/manifest.json --repo owner/repo --root /canonical/repo --state-dir /canonical/shared/dir --capacity N [--weight N] [--timeout-ms N] --foreground-contract --json -- command arg...
Opt-in admission only. All participating worktrees/consumers must use the SAME private host state directory.
Plan/status never execute commands. Run requires the cooperative foreground contract: the command must not daemonize or move descendants into another session.
No automatic stale-lease cleanup, retries, gate skipping, concurrency-default changes or consumer rollout.
Child output goes to stderr with --json; receipts retain only a command digest, never argv/environment/output.
Exit: actual child status on confirmed completion; 75 retained/uncertain process group; 124 timeout; 128+signal signal; 2 refusal. An old lease or stranded coordination directory needs operator inspection, never age-based deletion.`;

export async function main(args) {
  const json = args.slice(0, args.includes('--') ? args.indexOf('--') : args.length).includes('--json');
  try {
    if (args.includes('--help') && args.every(arg => ['--help', '--json'].includes(arg)) && new Set(args).size === args.length) { console.log(json ? JSON.stringify({ schema: 1, authority: 'admission-only', usage }) : usage); return; }
    const mode = args.shift();
    if (!['plan', 'status', 'run'].includes(mode)) throw new Error('invalid_mode');
    const values = {}, flags = new Set(); let argv = [];
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === '--') { argv = args.slice(i + 1); break; }
      if (['--json', '--foreground-contract'].includes(key)) { if (flags.has(key)) throw new Error('duplicate_flag'); flags.add(key); continue; }
      if (!['--manifest', '--repo', '--root', '--state-dir', '--capacity', '--weight', '--timeout-ms'].includes(key) || values[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('invalid_arguments');
      values[key] = args[++i];
    }
    const number = key => {
      if (values[key] === undefined) return undefined;
      if (!/^[1-9]\d*$/.test(values[key])) throw new Error('invalid_integer');
      return Number(values[key]);
    };
    const options = { stateDir: values['--state-dir'], capacity: number('--capacity') };
    let report;
    if (mode === 'status') {
      if (argv.length || flags.has('--foreground-contract') || Object.keys(values).some(key => !['--state-dir', '--capacity'].includes(key))) throw new Error('invalid_status_arguments');
      report = await inspectBudget(options);
    } else {
      const target = await inspectBudgetTarget({ manifest: values['--manifest'], root: values['--root'], repo: values['--repo'] });
      if (!argv.length || !argv[0] || argv.length > 128 || argv.some(a => a.length > 8192 || a.includes('\0')) || options.capacity === undefined || !flags.has('--foreground-contract')) throw new Error('explicit_command_capacity_and_foreground_required');
      const weight = number('--weight') ?? 1, timeoutMs = number('--timeout-ms') ?? 3600000;
      if (!Number.isSafeInteger(weight) || weight < 1 || weight > options.capacity || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 86400000) throw new Error('invalid_weight_or_timeout');
      if (mode === 'plan') report = { schema: 1, authority: 'admission-only', mode, target, budget: await inspectBudget({ ...options, targetRoot: target.root }), weight, timeoutMs, commandDigest: createHash('sha256').update(JSON.stringify(argv)).digest('hex'), argvCount: argv.length, foregroundContractRequired: true, executes: false, limits: ['Advisory snapshot; run revalidates and reserves atomically. No gate or reuse authority.'] };
      else report = await runBudget({ ...options, weight, timeoutMs, target, argv, foreground: true, json });
    }
    console.log(json ? JSON.stringify(report, null, 2) : JSON.stringify(report));
    process.exitCode = report.status ?? 0;
  } catch (error) {
    const code = /^[a-z_]+$/.test(error.code ?? error.message) ? (error.code ?? error.message) : 'admission_input_unavailable';
    console.error(json ? JSON.stringify({ schema: 1, authority: 'admission-only', error: code, status: 2 }) : `validation-budget: ${code}`);
    process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

// Source-only, read-only planning. Installed consumers are never modified.
import { inspectValidationPlan } from '../lib/validation-plan.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: node scripts/validation-plan.mjs --root <absolute-worktree> --manifest <absolute-file> --base <full-commit> [--review-input <absolute-directory>] [--json]\nInspect changed paths and local capabilities without running tests. Unknown/shared/config/consumer inputs request broad coverage; every plan retains the unchanged required gate. Review input availability is not approval. Exit 0: advisory plan ready; 1: capability or input-stability blocker; 2: invalid or unavailable input.';
export async function main(args) {
  const json = args.includes('--json');
  try {
    if (args.includes('--help') && args.every(arg => ['--help', '--json'].includes(arg)) && new Set(args).size === args.length) { console.log(json ? JSON.stringify({ schema: 1, help: usage }) : usage); return; }
    const options = {}, seen = new Set();
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (seen.has(arg) || !['--root', '--manifest', '--base', '--review-input', '--json'].includes(arg)) throw new Error('invalid arguments; use --help');
      seen.add(arg);
      if (arg === '--json') continue;
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('missing option value');
      options[arg === '--review-input' ? 'reviewInput' : arg.slice(2)] = value;
    }
    const plan = await inspectValidationPlan(options);
    console.log(json ? JSON.stringify(plan, null, 2) : [`${plan.repo}: ${plan.status}; ${plan.selection.mode}`, ...plan.selection.reasons, `Required gate (unchanged): ${plan.required.gate}`, `Review: ${plan.review.status}; approval: false`, ...plan.limitations].join('\n'));
    process.exitCode = plan.status === 'ready' ? 0 : 1;
  } catch (error) {
    const message = error.code ? 'cannot inspect required local input' : error.message;
    console.error(json ? JSON.stringify({ schema: 1, authority: 'feedback-only', error: message, broadValidationRequired: true, gateMayBeOmitted: false }) : `validation-plan: ${message}`);
    process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

#!/usr/bin/env node
// A stand-in for `claude -p` (CLAUDE_BIN) so no model ever runs in a test.
// It logs its arguments to CLAUDE_STUB_LOG and does what CLAUDE_STUB_MODE says:
// `propose` runs the propose command the prompt names with a cited read,
// `hedge` the same with a hedged read, `nothing` leaves the finding alone.
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (process.env.CLAUDE_STUB_LOG) appendFileSync(process.env.CLAUDE_STUB_LOG, `${JSON.stringify({ args, claudecode: process.env.CLAUDECODE })}\n`);
const prompt = args[args.indexOf('-p') + 1] ?? '';
const slug = /finding `([^`]+)`/.exec(prompt)?.[1];
const mode = process.env.CLAUDE_STUB_MODE ?? 'propose';
if (slug && mode !== 'nothing') {
  const home = prompt.includes('--project <project') ? ['--project', 'new'] : ['--phase', 'new'];
  const read = mode === 'hedge' ? 'lib/gear.mjs:7 looks like it drops the error; I did not check the callers.' : '**Holds.** lib/gear.mjs:7 catches and drops the error.';
  spawnSync(process.execPath, ['scripts/loop.mjs', 'propose', slug, '--rank', 'next', ...home, '--note', 'Holds: lib/gear.mjs:7.', '--read', read], { stdio: 'ignore' });
}
process.stdout.write('{"result":"ok"}\n');

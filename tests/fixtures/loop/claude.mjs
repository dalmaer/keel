#!/usr/bin/env node
// A stand-in for `claude -p` (CLAUDE_BIN) so no model ever runs in a test.
// The proof pass gets a reduced environment (loop.mjs PROVE_ENV), so the stub
// reads its settings from stub.json beside itself (a test copies it into a
// scratch directory): `log`, where it appends its arguments and the names of
// the environment it was given, and `mode`: `propose` answers with a proposal
// whose read cites code, `hedge` the same with a hedged read, `nothing` with
// no proposal at all. It never runs a command: the model only reads.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const cfg = existsSync(join(here, 'stub.json')) ? JSON.parse(readFileSync(join(here, 'stub.json'), 'utf8')) : {};
const args = process.argv.slice(2);
if (cfg.log) appendFileSync(cfg.log, `${JSON.stringify({ args, env: Object.keys(process.env).sort() })}\n`);
const prompt = args[args.indexOf('-p') + 1] ?? '';
const mode = cfg.mode ?? 'propose';
const home = prompt.includes('"project": "<project') ? 'project' : 'phase';
const read = mode === 'hedge' ? 'lib/gear.mjs:7 looks like it drops the error; I did not check the callers.' : '**Holds.** lib/gear.mjs:7 catches and drops the error.';
const proposal = { rank: 'next', [home]: 'new', note: 'Holds: lib/gear.mjs:7.', read };
const result = mode === 'nothing' ? 'I could not tell.' : `Proved.\n\n\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``;
process.stdout.write(`${JSON.stringify({ result })}\n`);

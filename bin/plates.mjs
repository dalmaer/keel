#!/usr/bin/env node
// plates: run projects the isocan/ledger way. Everything lives in lib/cli.mjs.
import { main } from '../lib/cli.mjs';

// The tool pin includes the old product name twice.
if (process.env.KEEL_CANVAS_KEEL_VERSION !== undefined) process.env.PLATES_CANVAS_PLATES_VERSION ??= process.env.KEEL_CANVAS_KEEL_VERSION;

// Accept established environment bindings during the Plates migration. Canonical names win.
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('KEEL_') && process.env[`PLATES_${name.slice(5)}`] === undefined) process.env[`PLATES_${name.slice(5)}`] = value;
}

process.exitCode = await main(process.argv.slice(2));

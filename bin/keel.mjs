#!/usr/bin/env node
// keel: run projects the isocan/ledger way. Everything lives in lib/cli.mjs.
import { main } from '../lib/cli.mjs';

process.exitCode = await main(process.argv.slice(2));

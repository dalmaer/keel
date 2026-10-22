#!/usr/bin/env node
import { migrateRename, parseRenameArgs } from '../lib/rename.mjs';

const args = process.argv.slice(2), json = args.includes('--json');
try {
  const result = await migrateRename(parseRenameArgs(args));
  console.log(json ? JSON.stringify(result.data, null, 2) : result.text);
  process.exitCode = result.exitCode;
} catch (error) {
  console.log(json ? JSON.stringify({ error: error.message }) : error.message);
  process.exitCode = error.exitCode ?? 2;
}

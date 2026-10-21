#!/usr/bin/env node
import { migrateRename } from '../lib/rename.mjs';

const args = process.argv.slice(2), options = { root: process.cwd(), yes: false, digest: undefined };
let json = false, seenRoot = false;
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--yes') options.yes = true;
    else if (args[i] === '--json') json = true;
    else if (args[i] === '--digest') {
      options.digest = args[++i];
      if (!/^[a-f0-9]{64}$/.test(options.digest ?? '')) throw new Error('--digest needs a SHA-256 preview digest');
    } else if (!args[i].startsWith('-') && !seenRoot) { options.root = args[i]; seenRoot = true; }
    else throw new Error('usage: node scripts/migrate-plates.mjs [project-root] [--yes] [--digest <preview-digest>] [--json]');
  }
  const result = await migrateRename(options);
  console.log(json ? JSON.stringify(result.data, null, 2) : result.text);
  process.exitCode = result.exitCode;
} catch (error) {
  console.log(json ? JSON.stringify({ error: error.message }) : error.message);
  process.exitCode = error.exitCode ?? 2;
}

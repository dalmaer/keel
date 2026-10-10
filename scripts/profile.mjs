#!/usr/bin/env node
// node scripts/profile.mjs --output /tmp/profile.json -- <keel arguments>
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function runProfile(args, { entry = fileURLToPath(new URL('./profile-entry.mjs', import.meta.url)), cwd, env = process.env, stdio = 'inherit' } = {}) {
  return new Promise((resolveResult, reject) => {
    const start = process.hrtime.bigint();
    const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./profile-preload.mjs', import.meta.url)), entry, ...args], {
      cwd, env: { ...env, KEEL_PROFILE_START_NS: String(start), KEEL_PROFILE_PID: String(process.pid) },
      stdio: [stdio, stdio, stdio, 'pipe'],
    });
    let data = ''; let overflow = false;
    child.stdio[3].on('data', chunk => {
      if (Buffer.byteLength(data) + chunk.length > 16384) { overflow = true; data = ''; }
      else if (!overflow) data += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      let profile = null;
      try { if (!overflow) profile = JSON.parse(data); } catch { /* abrupt termination */ }
      resolveResult({ code, signal, elapsedMs: Number(process.hrtime.bigint() - start) / 1e6, profile, profileUnavailable: profile == null });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/profile.mjs --output <new-json-file> -- <keel arguments>');
  } else if (args[0] !== '--output' || !args[1] || args[2] !== '--') {
    console.error('Usage: node scripts/profile.mjs --output <new-json-file> -- <keel arguments>');
    process.exitCode = 2;
  } else {
    // Reserve a private, new destination before executing any command.
    const { openSync, closeSync } = await import('node:fs');
    const fd = openSync(args[1], 'wx', 0o600);
    const result = await runProfile(args.slice(3));
    writeFileSync(fd, JSON.stringify(result, null, 2) + '\n'); closeSync(fd);
    if (result.signal) process.kill(process.pid, result.signal);
    else process.exitCode = result.code ?? 1;
  }
}

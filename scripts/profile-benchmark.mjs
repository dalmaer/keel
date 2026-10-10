#!/usr/bin/env node
// Fixed read-only surfaces; opt in to fresh GitHub reads separately.
// node scripts/profile-benchmark.mjs --output /tmp/bench.json --samples 5 [--github] [--json]
import { openSync, writeFileSync, closeSync } from 'node:fs';
import { platform, arch, release, cpus, loadavg } from 'node:os';
import { runProfile } from './profile.mjs';

const args = process.argv.slice(2);
let output; let samples = 5; let github = false; let valid = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output') output = args[++i];
  else if (args[i] === '--samples') samples = Number(args[++i]);
  else if (args[i] === '--github') github = true;
  else if (args[i] !== '--json') valid = false;
}
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/profile-benchmark.mjs --output <new-json-file> [--samples 1..100] [--github] [--json]');
} else if (!valid || !output || !Number.isInteger(samples) || samples < 1 || samples > 100) {
  console.error('Usage: node scripts/profile-benchmark.mjs --output <new-json-file> [--samples 1..100] [--github] [--json]');
  process.exitCode = 2;
} else {
  const fd = openSync(output, 'wx', 0o600);
  const cases = { help: ['--agent-help'], status: ['status', '--json'], next: ['next', '--json'] };
  if (github) cases.doctorGithub = ['doctor', '--github', '--json'];
  const stats = values => {
    const sorted = values.toSorted((a, b) => a - b);
    const n = sorted.length;
    return { min: sorted[0], median: (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2, p95: sorted[Math.ceil(n * 0.95) - 1], max: sorted[n - 1], mean: sorted.reduce((a, b) => a + b, 0) / n };
  };
  const results = {};
  const start = { timestamp: new Date().toISOString(), loadavg: loadavg() };
  for (const [name, argv] of Object.entries(cases)) {
    const raw = [];
    for (let i = 0; i < samples; i++) raw.push(await runProfile(argv, { stdio: 'ignore' }));
    const timings = { elapsedMs: stats(raw.map(r => r.elapsedMs)) };
    for (const key of Object.keys(raw[0].profile?.timingMs ?? {})) {
      const values = raw.map(r => r.profile?.timingMs[key]);
      if (values.every(v => typeof v === 'number')) timings[key] = stats(values);
    }
    results[name] = { raw, stats: timings };
  }
  const end = { timestamp: new Date().toISOString(), loadavg: loadavg() };
  writeFileSync(fd, JSON.stringify({ schemaVersion: 1, environment: { node: process.version, platform: platform(), arch: arch(), osRelease: release(), logicalCpus: cpus().length, start, end }, samples, policy: 'sequential fresh processes; no warmup discard; output suppressed; failures retained; cache and scheduler uncontrolled', results }, null, 2) + '\n');
  closeSync(fd);
  if (Object.values(results).some(r => r.raw.some(s => s.code !== 0 || s.profileUnavailable))) process.exitCode = 1;
}

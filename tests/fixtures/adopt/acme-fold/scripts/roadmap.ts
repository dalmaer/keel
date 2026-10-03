// Acme Fold's own roadmap: every phase has a status.
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../docs/phases/', import.meta.url);
export function problems(): string[] {
  return readdirSync(dir).filter(f => /^\d+-.+\.md$/.test(f))
    .filter(f => !/^status: \S+$/m.test(readFileSync(new URL(f, dir), 'utf8')))
    .map(f => `${f}: no status`);
}
if (process.argv.includes('--check') && problems().length) process.exitCode = 1;

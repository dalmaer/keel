// Acme Groove's own roadmap check: every phase names a milestone that exists.
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function problems(root = ROOT) {
  const milestones = new Set(JSON.parse(await readFile(resolve(root, 'docs/milestones.json'), 'utf8')).map(m => m.id));
  const out = [];
  for (const file of (await readdir(resolve(root, 'docs/phases'))).filter(f => /^\d+-.+\.md$/.test(f))) {
    const id = /^milestone: (\S+)$/m.exec(await readFile(resolve(root, 'docs/phases', file), 'utf8'))?.[1];
    if (!milestones.has(id)) out.push(`${file}: unknown milestone ${id}`);
  }
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = await problems();
  for (const p of found) console.error(p);
  if (found.length) process.exitCode = 1;
  else console.log('roadmap ok');
}

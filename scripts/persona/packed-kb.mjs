// The performance persona's bundle number: the size of keel's published
// package, as `npm pack` would build it, in whole kB. Prints one number, or fails.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
if (!Number.isFinite(pack?.size) || pack.size <= 0) throw new Error('npm pack reported no size');
console.log(Math.round(pack.size / 1024));

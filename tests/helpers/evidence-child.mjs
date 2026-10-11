// Synthetic Acme process tree: the descendant keeps inherited pipes open.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 1, 2] });
writeFileSync(process.argv[2], String(child.pid));
console.log(12);
if (process.argv[3] === 'wait') setInterval(() => {}, 1000);
else process.exit(0);

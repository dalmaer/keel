// Synthetic Acme program: direct APIs are the instrumentation subject.
import { spawnSync, spawn } from 'node:child_process';
for (let i=0;i<100;i++) spawnSync('Acme-missing', []);
spawn('Acme-missing', []);

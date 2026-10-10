// No opt-in environment: importing the preload must leave builtins untouched.
import cp from 'node:child_process';
const original = cp.spawn;
await import('../../../scripts/profile-preload.mjs');
if (cp.spawn !== original) process.exit(1);

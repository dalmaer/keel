// Synthetic Acme program: direct APIs are the instrumentation subject.
import { spawn, spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
spawnSync('Acme-missing-executable', []);
await new Promise(r => spawn('Acme-missing-executable', []).on('error', r));
try { await promisify(execFile)(process.execPath, ['-e', 'process.exit(3)']); } catch(e) { if (e.code !== 3 || e.stdout !== '') process.exit(8); }
try { spawn(null); } catch {}

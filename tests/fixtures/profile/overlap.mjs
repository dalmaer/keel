// Synthetic Acme program: direct APIs are the instrumentation subject.
import { spawn, execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
const server = createServer((req, res) => setTimeout(() => res.end('Acme-secret-body'), 40));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const child = () => new Promise(r => spawn(process.execPath, ['-e', 'setTimeout(()=>{},120)', 'Acme-secret-arg']).on('close', r));
await Promise.all([child(), child(), fetch('http://127.0.0.1:' + server.address().port + '/Acme-secret-url', { headers: { authorization: 'Acme-secret-token' } }).then(r => r.text())]);
try { execFileSync(process.execPath, ['-e', 'process.exit(7)'], {stdio:'ignore'}); } catch {}
await promisify(execFile)(process.execPath, ['-e', '']);
await new Promise(r => server.close(r));

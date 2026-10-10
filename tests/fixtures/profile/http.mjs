// Synthetic Acme program: direct APIs are the instrumentation subject.
import { createServer, get, request } from 'node:http';
const server = createServer((req, res) => { res.write('Acme'); setTimeout(() => res.end('secret'), 10); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port;
await new Promise((resolve, reject) => get(url, res => { res.resume(); res.on('end', resolve); }).on('error', reject));
await new Promise(r => server.close(r));
try { await fetch(url); } catch {}
await new Promise(r => request(url).on('error', r).end());
try { get('Acme-invalid-url'); } catch {}

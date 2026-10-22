import { createServer } from 'node:http';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { configFromEnv, requireRuntime } from './config.mjs';
import { createWebService } from './server.mjs';

// Run behind an HTTPS proxy for the exact configured origin. Loopback only.
export async function serve(args, env = process.env) {
  requireRuntime();
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--config', '--port', '--json'].includes(key) || Object.hasOwn(values, key)) throw new Error('invalid launch options');
    values[key] = key === '--json' ? true : args[++i];
  }
  if (!isAbsolute(values['--config'] ?? '') || !/^\d{1,5}$/.test(values['--port'] ?? '3000')) throw new Error('explicit external configuration required');
  const configPath = await realpath(values['--config']);
  const application = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const distance = relative(application, configPath);
  if (!distance || (!distance.startsWith(`..${sep}`) && distance !== '..' && !isAbsolute(distance))) throw new Error('configuration must be outside application');
  const stat = await lstat(resolve(values['--config']));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768 || (process.platform !== 'win32' && stat.mode & 0o077)) throw new Error('configuration must be a private regular file');
  const config = configFromEnv({ ...env, PLATES_WEB_CONFIG: await readFile(values['--config'], 'utf8') });
  const handler = createWebService(config), port = Number(values['--port'] ?? 3000);
  if (port < 0 || port > 65535) throw new Error('invalid port');
  const server = createServer({ requestTimeout: 30000, headersTimeout: 10000 }, async (incoming, outgoing) => {
    try {
      if (incoming.headers.host !== new URL(config.origin).host || !incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
        outgoing.writeHead(403); outgoing.end(); return;
      }
      const body = ['GET', 'HEAD'].includes(incoming.method) ? undefined : Readable.toWeb(incoming);
      const response = await handler(new Request(`${config.origin}${incoming.url}`, { method: incoming.method,
        headers: incoming.headers, ...(body ? { body, duplex: 'half' } : {}) }));
      const responseHeaders = Object.fromEntries(response.headers); delete responseHeaders['set-cookie'];
      outgoing.writeHead(response.status, { ...responseHeaders, 'set-cookie': response.headers.getSetCookie() });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(503); outgoing.end('{"error":"service_unavailable"}'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = await serve(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify({ state: 'listening', host: '127.0.0.1', port: server.address().port })}\n`);
  } catch { process.stderr.write('{"error":"service_start_failed"}\n'); process.exitCode = 1; }
}

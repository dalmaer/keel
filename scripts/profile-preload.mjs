// Opt-in only. No arguments, URLs, command output or error text enter the record.
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { errorMonitor } from 'node:events';
import { promisify } from 'node:util';
import { writeSync } from 'node:fs';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';

const origin = Number(process.env.KEEL_PROFILE_START_NS);
const owner = process.env.KEEL_PROFILE_PID;
// Inherited preloads must never emit a second record on the parent's descriptor.
if (Number.isFinite(origin) && owner === String(process.ppid)) {
  delete process.env.KEEL_PROFILE_START_NS;
  delete process.env.KEEL_PROFILE_PID;
  const now = () => Number(process.hrtime.bigint()) / 1e6;
  const start = origin / 1e6;
  const preload = now();
  const nodeProcessToPreload = performance.now();
  const active = [0, 0, 0]; // subprocess, direct network, opaque gh subset
  const busy = Array(8).fill(0);
  const counts = { subprocess: 0, directNetwork: 0, ghOpaque: 0, failures: 0 };
  let last = preload;
  let importStart = null;
  let importEnd = null;
  const tick = () => {
    const time = now();
    const mask = active.reduce((m, n, i) => m | (n > 0 ? 1 << i : 0), 0);
    busy[mask] += time - last;
    last = time;
  };
  const begin = (kind, gh = false) => {
    tick(); active[kind]++; if (gh) active[2]++;
    counts[kind === 0 ? 'subprocess' : 'directNetwork']++;
    if (gh) counts.ghOpaque++;
    let ended = false;
    return (failed = false) => {
      if (ended) return;
      ended = true; tick(); active[kind]--; if (gh) active[2]--;
      if (failed) counts.failures++;
    };
  };
  const isGh = value => typeof value === 'string' &&
    (basename(value).toLowerCase() === 'gh' || basename(value).toLowerCase() === 'gh.exe' || value === process.env.KEEL_GH);
  for (const name of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) {
    const original = cp[name];
    const wrapped = function (...args) {
      const end = begin(0, name !== 'exec' && name !== 'execSync' && isGh(args[0]));
      try {
        const child = Reflect.apply(original, this, args);
        if (name.endsWith('Sync')) end(child?.error != null || (child?.status != null && child.status !== 0) || child?.signal != null);
        else {
          child.once(errorMonitor, () => end(true));
          child.once('close', (code, signal) => end(code !== 0 || signal != null));
        }
        return child;
      } catch (error) { end(true); throw error; }
    };
    if (name === 'exec' || name === 'execFile') {
      wrapped[promisify.custom] = (...args) => {
        let child;
        const promise = new Promise((resolve, reject) => {
          child = wrapped(...args, (error, stdout, stderr) => {
            if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); }
            else resolve({ stdout, stderr });
          });
        });
        promise.child = child;
        return promise;
      };
    }
    cp[name] = wrapped;
  }
  // Fetch's promise ends at response headers, not body consumption.
  const fetch = globalThis.fetch;
  globalThis.fetch = async function (...args) {
    const end = begin(1);
    try { const response = await Reflect.apply(fetch, this, args); end(); return response; }
    catch (error) { end(true); throw error; }
  };
  for (const module of [http, https]) {
    const request = module.request;
    module.request = function (...args) {
      const end = begin(1);
      try {
        const req = Reflect.apply(request, this, args);
        req.once(errorMonitor, () => end(true));
        req.once('response', res => {
          res.once('end', () => end());
          res.once('close', () => end(!res.complete));
          res.once(errorMonitor, () => end(true));
        });
        req.once('close', () => end());
        return req;
      } catch (error) { end(true); throw error; }
    };
    module.get = function (...args) { const req = module.request(...args); req.end(); return req; };
  }
  syncBuiltinESMExports();
  globalThis[Symbol.for('keel.profile')] = {
    importStart() { importStart = now(); },
    importEnd() { importEnd = now(); },
  };
  process.once('exit', () => {
    tick();
    const sum = predicate => busy.reduce((n, value, mask) => n + (predicate(mask) ? value : 0), 0);
    const record = {
      schemaVersion: 1,
      timingMs: {
        childUntilExit: last - start,
        parentSpawnToPreload: preload - start,
        nodeProcessToPreload,
        cliImports: importEnd == null || importStart == null ? null : importEnd - importStart,
        subprocessBusy: sum(m => m & 1),
        directNetworkBusy: sum(m => m & 2),
        subprocessNetworkOverlap: sum(m => (m & 3) === 3),
        observedBusy: sum(m => m & 3),
        localResidual: sum(m => !(m & 3)),
        ghNetworkCapableOpaque: sum(m => m & 4),
      },
      nodeBootMilestonesMs: Object.fromEntries(['nodeStart', 'v8Start', 'environment', 'bootstrapComplete'].map(key => [key, performance.nodeTiming[key]])),
      counts,
      incomplete: { subprocess: active[0], directNetwork: active[1], cliImports: importStart != null && importEnd == null },
      boundaries: { localResidual: 'post-preload wall time outside observed operations; not CPU; includes imports', fetch: 'invocation through response headers', http: 'request through response end or close', subprocess: 'invocation through close; child internals opaque', gh: 'network-capable opaque subprocess; subset of subprocessBusy', startup: 'parentSpawnToPreload includes process boot and preload imports; nodeProcessToPreload and nodeBootMilestonesMs are nested process-relative diagnostics; cliImports is separately measured and included in post-preload accounting' },
    };
    try { writeSync(3, JSON.stringify(record) + '\n'); } catch { /* Profiling cannot change command status. */ }
  });
}

// Source-only observations, never deployed-function proof or permission to reuse a gate.
import { spawnSync } from 'node:child_process';
import { access, lstat, realpath } from 'node:fs/promises';
import { constants, accessSync, lstatSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import reviewed from './web/capability-source-data.mjs';

export const MINIMUM_NODE = '24.22.1';
const LOOPBACK_PROBE = `
import { createServer } from 'node:net';
const server = createServer(socket => socket.destroy());
const timer = setTimeout(() => finish('ETIMEDOUT'), 2000);
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  console.log(JSON.stringify({ status: code ? 'unavailable' : 'observed', address: '127.0.0.1', closed: !code, code: code || null }));
  process.exit(code ? 1 : 0);
}
server.once('error', error => finish(error.code || 'BIND_FAILED'));
server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => server.close(error => finish(error?.code)));
`;
/** Fixed ephemeral bind-and-close only: no requests, target imports or settings. */
export function probeLoopback(root, executable, { execute = spawnSync, env = process.env } = {}) {
  try {
    const result = execute(executable, ['--input-type=module', '-e', LOOPBACK_PROBE], { cwd: root, env: probeEnvironment(env), shell: false, encoding: 'utf8', timeout: 5000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error || result.signal) return { status: 'unavailable', address: '127.0.0.1', closed: false, code: result.error?.code === 'ETIMEDOUT' ? 'ETIMEDOUT' : 'PROBE_FAILED' };
    const value = JSON.parse(result.stdout);
    if (result.status === 0 && value.status === 'observed' && value.address === '127.0.0.1' && value.closed === true && value.code === null) return value;
    return { status: 'unavailable', address: '127.0.0.1', closed: false, code: typeof value.code === 'string' && /^[A-Z_]{1,32}$/.test(value.code) ? value.code : 'PROBE_FAILED' };
  } catch { return { status: 'unavailable', address: '127.0.0.1', closed: false, code: 'PROBE_FAILED' }; }
}
function version(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value ?? '');
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
const compare = (left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
/** Only deliberately supported engine forms; unknown syntax is not a match. */
export function nodeSatisfies(actual, range) {
  const found = version(actual);
  if (!found || typeof range !== 'string') return null;
  if (/^\d+\.x$/.test(range)) return found[0] === Number(range.slice(0, -2));
  if (/^>=\d+$/.test(range)) return found[0] >= Number(range.slice(2));
  if (range.startsWith('>=')) { const min = version(range.slice(2)); return min ? compare(found, min) >= 0 : null; }
  const exact = version(range);
  return exact ? compare(found, exact) === 0 : null;
}
export function assertSupportedNode(actual = process.versions.node) {
  if (nodeSatisfies(actual, `>=${MINIMUM_NODE}`) !== true) throw new Error(`unsupported Node runtime ${actual}; requires >=${MINIMUM_NODE} before focused execution`);
}
export function packageBinding(bytes) {
  try {
    const pkg = JSON.parse(bytes.toString());
    if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('invalid version');
    const actual = createHash('sha256').update(JSON.stringify({ ...pkg, version: '<release-version>' })).digest('hex');
    const expected = reviewed.files.find(file => file.path === 'package.json')?.sha256;
    return { status: actual === expected ? 'verified' : 'changed', actual, expected: expected ?? null, authority: 'existing-reviewed-package-boundary' };
  } catch { return { status: 'unavailable', actual: null, expected: null, authority: 'existing-reviewed-package-boundary' }; }
}
export function probeEnvironment(env = process.env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('NODE_TEST_') && !key.startsWith('GIT_') && !['NODE_OPTIONS', 'NODE_PATH'].includes(key)));
  return { ...clean, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' };
}
export async function resolveExecutable(name, env, root) {
  for (const entry of (env.PATH ?? '').split(delimiter)) {
    if (!entry || !isAbsolute(entry)) throw new Error('unsafe relative or empty PATH entry');
    const candidate = resolve(entry, name);
    let path;
    try {
      path = await realpath(candidate);
      if (!(await lstat(path)).isFile()) continue;
      await access(path, constants.X_OK);
    } catch { continue; }
    if (candidate === root || candidate.startsWith(root + sep) || path === root || path.startsWith(root + sep)) throw new Error('unsafe repository executable on PATH');
    return path;
  }
  return null;
}
function resolveExecutableSync(name, env, root) {
  for (const entry of (env.PATH ?? '').split(delimiter)) {
    if (!entry || !isAbsolute(entry)) throw new Error('unsafe relative or empty PATH entry');
    const candidate = resolve(entry, name);
    let path;
    try {
      path = realpathSync(candidate);
      if (!lstatSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
    } catch { continue; }
    if (candidate === root || candidate.startsWith(root + sep) || path === root || path.startsWith(root + sep)) throw new Error('unsafe repository executable on PATH');
    return path;
  }
  return null;
}
/** Synchronous pre-stage guard for the existing synchronous focused runner. */
export function assertFocusedRuntime(root, { env = process.env, execute = spawnSync, runtime = { version: process.version, executable: process.execPath, architecture: process.arch, platform: process.platform } } = {}) {
  assertSupportedNode(runtime.version);
  if (env.NODE_OPTIONS || env.NODE_PATH) throw new Error('runtime options require inspection before focused execution');
  // Resolve every later-stage tool before any shebang probe. Skipping an unsafe
  // first match would disagree with the PATH used by npm and /usr/bin/env.
  const paths = Object.fromEntries(['node', 'npm', 'git'].map(name => [name, resolveExecutableSync(name, env, root)]));
  if (Object.values(paths).some(path => !path)) throw new Error('required PATH runtime/tool is unavailable');
  const executable = paths.node;
  const result = execute(executable, ['-p', 'JSON.stringify({version:process.version,executable:process.execPath,architecture:process.arch,platform:process.platform})'], { cwd: root, env: probeEnvironment(env), shell: false, encoding: 'utf8', timeout: 5000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] });
  let child;
  try {
    if (result.error || result.status !== 0) throw new Error('failed');
    child = JSON.parse(result.stdout);
    assertSupportedNode(child.version);
    if (realpathSync(child.executable) !== realpathSync(runtime.executable) || child.version !== runtime.version || child.architecture !== runtime.architecture || child.platform !== runtime.platform) throw new Error('mismatch');
  } catch { throw new Error('PATH Node is unsupported, unavailable or differs from the process runtime; pin the runtime before focused execution'); }
  return { processRuntime: runtime, childRuntime: child, tools: paths };
}

/** Fixed version and source loopback probes; never target package scripts or imports. */
export async function inspectCapabilities({ root, engine, source = false, packageBytes }, { execute = spawnSync, env = process.env, runtime = { version: process.version, executable: process.execPath, architecture: process.arch, platform: process.platform } } = {}) {
  const issues = [], binaries = {}, clean = probeEnvironment(env);
  const processSupported = nodeSatisfies(runtime.version, `>=${MINIMUM_NODE}`);
  if (processSupported !== true) issues.push('unsupported-process-node');
  const engineSupported = nodeSatisfies(runtime.version, engine);
  if (engineSupported !== true) issues.push(engineSupported === null ? 'target-engine-unavailable' : 'target-engine-mismatch');
  if (env.NODE_OPTIONS || env.NODE_PATH) issues.push('runtime-options-require-inspection');
  let childRuntime = null;
  // Resolve the whole tool set first; npm's shebang must never reach a skipped
  // repository-local Node before a later safe candidate.
  for (const name of ['node', 'git', 'npm']) {
    let path = null;
    try { path = await resolveExecutable(name, clean, root); }
    catch { issues.push(`${name}-unsafe-path`); }
    binaries[name] = { path, status: 'unavailable', version: null };
    if (!path && !issues.includes(`${name}-unsafe-path`)) issues.push(`${name}-unavailable`);
  }
  const unsafePath = issues.some(issue => issue.endsWith('-unsafe-path'));
  for (const name of ['node', 'git', 'npm']) {
    const path = binaries[name].path;
    if (!path || unsafePath) continue;
    const args = name === 'node' ? ['-p', 'JSON.stringify({version:process.version,executable:process.execPath,architecture:process.arch,platform:process.platform})'] : ['--version'];
    let result;
    try { result = execute(path, args, { cwd: root, env: clean, shell: false, encoding: 'utf8', timeout: 5000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { issues.push(`${name}-probe-failed`); continue; }
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') { issues.push(`${name}-probe-failed`); continue; }
    try {
      if (name === 'node') {
        const value = JSON.parse(result.stdout);
        if (!version(value.version) || typeof value.executable !== 'string' || !isAbsolute(value.executable) || typeof value.architecture !== 'string' || typeof value.platform !== 'string') throw new Error('invalid runtime');
        childRuntime = value;
        if (nodeSatisfies(value.version, `>=${MINIMUM_NODE}`) !== true || nodeSatisfies(value.version, engine) !== true) issues.push('unsupported-path-node');
        if (await realpath(value.executable) !== await realpath(runtime.executable) || value.version !== runtime.version || value.architecture !== runtime.architecture || value.platform !== runtime.platform) issues.push('process-path-runtime-mismatch');
        binaries[name] = { path, status: 'observed', version: value.version };
      } else {
        const value = result.stdout.trim();
        if (!(name === 'git' ? /^git version \d+\.\d+(?:\.[\w.()-]+)?(?: .*)?$/ : /^\d+\.\d+\.\d+$/).test(value) || value.length > 256) throw new Error('invalid version');
        binaries[name] = { path, status: 'observed', version: value };
      }
    } catch { issues.push(`${name}-probe-invalid`); }
  }
  const binding = source ? packageBinding(packageBytes) : { status: 'not-applicable', authority: 'consumer-coverage-unmapped' };
  if (source && binding.status !== 'verified') issues.push('package-capability-binding-unverified');
  const loopback = source ? issues.length ? { status: 'unavailable', reason: 'Prerequisite capability checks failed.' } : probeLoopback(root, binaries.node.path, { execute, env }) : { status: 'not-applicable', reason: 'Consumer execution capabilities are unmapped.' };
  if (source && loopback.status !== 'observed') issues.push('source-loopback-unavailable');
  return { ready: issues.length === 0, issues: [...new Set(issues)], processRuntime: runtime, childRuntime, targetEngine: engine ?? null, binaries, packageBinding: binding, loopback, deployedFunctionRuntime: { status: 'unverified', reason: 'Local build runtime does not establish a fresh protected deployed-function probe.' } };
}

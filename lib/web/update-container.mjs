import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fail = message => { throw new Error(message); };
const forbidden = /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY|^ACTIONS_|^GITHUB_|^KEEL_|^DOCKER_|^NODE_OPTIONS$|^NODE_TEST_|^LD_|^DYLD_)/i;
export function validateContainerPolicy(policy, env = {}) {
  if (!policy || Object.keys(policy).sort().join(',') !== 'image,network,platform'
    || !/^node@sha256:[a-f0-9]{64}$/.test(policy.image)
    || !['linux/amd64', 'linux/arm64'].includes(policy.platform)
    || !['none', 'bridge'].includes(policy.network)) fail('unsupported_container_policy');
  if (!env || typeof env !== 'object' || Array.isArray(env) || Object.keys(env).length > 40) fail('unsupported_container_environment');
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || forbidden.test(key)
      || typeof value !== 'string' || Buffer.byteLength(value) > 4096 || value.includes('\0')) fail('unsupported_container_environment');
  }
  return policy;
}

/** All host commands are fixed plumbing, never project setup/check shell strings. */
export function updateCommand(command, args, { signal, inputFile, maxBytes = 65536, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('update_command_stopped')); return; }
    const child = spawn(command, args, { env, detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let bytes = 0, stdout = '', stderr = '', limited = false;
    const kill = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const data = (which, chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { limited = true; kill(); return; }
      if (which === 'out') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data', chunk => data('out', chunk));
    child.stderr.on('data', chunk => data('err', chunk));
    child.stdin.on('error', () => {});
    const input = inputFile ? createReadStream(inputFile) : null;
    if (input) { input.on('error', kill); input.pipe(child.stdin); } else child.stdin.end();
    signal?.addEventListener('abort', kill, { once: true });
    if (signal?.aborted) kill();
    child.once('error', () => { kill(); input?.destroy(); signal?.removeEventListener('abort', kill); reject(new Error('update_command_unavailable')); });
    child.once('exit', kill);
    child.once('close', (exit, exitSignal) => {
      kill(); input?.destroy(); signal?.removeEventListener('abort', kill);
      if (limited) reject(new Error('update_command_output_limit'));
      else resolve({ exit, signal: exitSignal, stdout, stderr });
    });
  });
}

/** One disposable container; termination is verified independently of the docker client. */
export async function runUpdateContainer({ source, destination, container, commands, env = {}, expected = null, signal }, {
  run = updateCommand, now = Date.now,
} = {}) {
  validateContainerPolicy(container, env);
  if (!Array.isArray(commands) || !commands.length || commands.length > 2
    || commands.some(c => !['setup', 'updated', 'base'].includes(c.key) || typeof c.command !== 'string'
      || !c.command.trim() || c.command.length > 8192)) fail('invalid_container_commands');
  const temp = await mkdtemp(join(tmpdir(), 'keel-update-container-'));
  const archive = join(temp, 'source.tar');
  const manifest = join(temp, 'tracked.json');
  const name = `keel-update-${randomBytes(20).toString('hex')}`;
  let id = null, created = false, terminated = false, removed = false, pauseAttempted = false;
  const checks = {};
  const call = async (args, options = {}) => {
    const r = await run('docker', args, { signal, ...options });
    if (r.exit !== 0) fail('container_unavailable');
    return r.stdout.trim();
  };
  let cleanupBudget;
  const cleanupSignal = () => cleanupBudget ??= AbortSignal.timeout(15000);
  async function stop() {
    if (!id) return;
    if (pauseAttempted) {
      // A lost pause/inspect response may still leave the freezer active.
      await run('docker', ['unpause', id], { signal: cleanupSignal() }).catch(() => {});
      pauseAttempted = false;
    }
    await run('docker', ['kill', id], { signal: cleanupSignal() });
    const stopped = await call(['inspect', '--format', '{{.State.Running}}', id], { signal: cleanupSignal() });
    if (stopped !== 'false') fail('container_cleanup_uncertain');
    terminated = true;
  }
  async function remove() {
    if (!id) return;
    await call(['rm', '-f', id], { signal: cleanupSignal() });
    const remaining = await call(['ps', '-a', '--no-trunc', '--filter', `id=${id}`, '--format', '{{.ID}}'], { signal: cleanupSignal() });
    if (remaining !== '') fail('container_cleanup_uncertain');
    removed = true;
  }
  try {
    const tar = await run('tar', ['-cf', archive, '-C', source, '.'], { signal });
    if (tar.exit !== 0) fail('container_source_unavailable');
    // No mounts: bounded tmpfs holds the project and dependencies, never host data.
    const args = ['create', '--name', name, '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--pids-limit', '512', '--cpus', '2', '--memory', '2g', '--memory-swap', '2g',
      '--platform', container.platform, '--network', container.network,
      '--tmpfs', '/work:rw,size=1g,uid=1000,gid=1000', '--tmpfs', '/tmp:rw,size=128m,uid=1000,gid=1000',
      '--tmpfs', '/home/node:rw,size=128m,uid=1000,gid=1000', '--workdir', '/work', '--env', 'HOME=/home/node',
      '--env', 'CI=true', ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
      container.image, 'bash', '-e', '-c', 'mkdir -p /work/project; exec sleep infinity'];
    created = true; // A lost create response is reconciled by the unique process-owned name.
    id = await call(args);
    if (!/^[a-f0-9]{64}$/.test(id)) { id = null; fail('container_identity_unavailable'); }
    await call(['start', id]);
    await call(['exec', id, 'bash', '-e', '-c', 'test "$(id -u)" = 1000; node --version; npm --version; git --version; command -v tar']);
    await call(['exec', '-i', id, 'tar', '-xf', '-', '--no-same-owner', '-C', '/work/project'], { inputFile: archive });
    if (expected) await writeFile(manifest, JSON.stringify([...expected].map(([path, entry]) => [path,
      entry === null ? null : { mode: entry.mode, blob: entry.blob }])));
    for (const { key, command } of commands) {
      const startedAt = new Date(now()).toISOString();
      const r = await run('docker', ['exec', '-w', '/work/project', id, 'bash', '-e', '-c', command], { signal, maxBytes: 8 * 1024 * 1024 });
      checks[key] = { command, exit: r.exit, signal: r.signal,
        startedAt, completedAt: new Date(now()).toISOString(), tail: `${r.stdout}${r.stderr}`.slice(-4096) };
      if (expected) {
        // Parent-supplied code/manifest are never writable project scripts.
        // This checks setup before the following base check can undo its edits.
        const verifier = `import {lstat,readFile,readlink} from 'node:fs/promises';import {createHash} from 'node:crypto';
let input='';for await(const c of process.stdin)input+=c;for(const[p,e]of JSON.parse(input)){
const s=await lstat(p).catch(x=>{if(x.code==='ENOENT')return null;throw x});
if(e===null){if(s&&!s.isDirectory())throw Error('tracked deletion changed');continue}if(!s)throw Error('tracked file missing');
const m=s.isSymbolicLink()?'120000':s.isFile()?(s.mode&73?'100755':'100644'):null;
if(m!==e.mode)throw Error('tracked mode changed');const b=m==='120000'?Buffer.from(await readlink(p)):await readFile(p);
const h=createHash('sha1').update('blob '+b.length+'\\0').update(b).digest('hex');if(h!==e.blob)throw Error('tracked bytes changed')}`;
        await call(['exec', '-i', '-w', '/work/project', id, '/usr/local/bin/node', '--input-type=module', '-e', verifier], { inputFile: manifest });
      }
      if (r.exit !== 0) break;
    }
    // Freeze every process while copying tmpfs. Stopping first unmounts tmpfs;
    // copying a running tree would race descendants left by a project command.
    if (destination) {
      pauseAttempted = true;
      await call(['pause', id]);
      if (await call(['inspect', '--format', '{{.State.Paused}}', id]) !== 'true') fail('container_snapshot_unavailable');
      try { await call(['cp', `${id}:/work/project/.`, destination]); }
      finally { await call(['unpause', id], { signal: cleanupSignal() }); pauseAttempted = false; }
    }
    await stop();
    await remove();
    return { checks, containerId: id, cleanup: 'verified' };
  } finally {
    let uncertain = false;
    if (created && !id) {
      try {
        const found = await call(['inspect', '--format', '{{.Id}}', name], { signal: cleanupSignal() });
        if (!/^[a-f0-9]{64}$/.test(found)) fail('container_identity_unavailable');
        id = found;
      } catch { uncertain = true; }
    }
    if (id && !removed) {
      try { if (!terminated) await stop(); await remove(); } catch { uncertain = true; }
    }
    await rm(temp, { recursive: true, force: true });
    if (uncertain) fail('container_cleanup_uncertain');
  }
}

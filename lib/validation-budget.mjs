// Source-only cooperative admission. This is not a process sandbox or gate attestation.
import { spawn, spawnSync } from 'node:child_process';
import { constants, accessSync, realpathSync, statSync } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { hostname, availableParallelism, freemem, devNull, constants as osConstants } from 'node:os';
import { dirname, delimiter, isAbsolute, join, resolve, sep } from 'node:path';

const LIMIT = 1024 * 1024;
const RECENT_RECEIPTS = 200;
const HOST = hostname();
const UID = process.getuid?.();
const FOREGROUND_CONTRACT = 'posix-cooperative-process-group';
const UNLINKED_INPUT = Symbol('unlinked input');
const inspectedTargets = new WeakSet();
const now = () => new Date().toISOString();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const cleanEnv = env => Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('NODE_TEST_')));
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;

async function canonical(path, { absent = false } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) fail('absolute_canonical_path_required');
  if (absent) {
    if (await realpath(dirname(path)) !== dirname(path)) fail('symlink_path_refused');
  } else if (await realpath(path) !== path) fail('symlink_path_refused');
  return path;
}

async function privateDirectory(path) {
  await canonical(path);
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== UID || (s.mode & 0o077)) fail('unsafe_state_directory');
  return s;
}

async function jsonFile(path, { privateFile = false, immutable = false, expectedBytes, durable = false } = {}) {
  await canonical(path);
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await f.stat();
    if (!s.isFile() || s.size > LIMIT || (privateFile && (s.uid !== UID || (s.mode & 0o077))) || (immutable && (s.mode & 0o222))) fail('unsafe_input_file');
    if (s.nlink !== 1) {
      // Ordinary state/archive reads still refuse. Only owner observation may
      // inspect this narrow diagnostic, after every other safety check passed.
      const error = new Error('unsafe_input_file'); error.code = 'unsafe_input_file';
      if (s.nlink === 0) error[UNLINKED_INPUT] = true;
      throw error;
    }
    const bytes = await f.readFile();
    if (bytes.length > LIMIT) fail('input_limit');
    if (expectedBytes && !bytes.equals(expectedBytes)) fail('receipt_archive_conflict');
    const value = JSON.parse(bytes.toString('utf8'));
    // An interrupted earlier writer may have published complete read-only
    // bytes without syncing them. Persist the same verified inode before a
    // caller relies on an existing receipt to remove active history.
    if (durable) await f.sync();
    return value;
  } finally { await f.close(); }
}

function externalGit(root) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory || !isAbsolute(directory)) fail('relative_path_entry_refused');
    const path = resolve(directory, 'git');
    try {
      accessSync(path, constants.X_OK);
      const actual = realpathSync(path);
      if (!statSync(actual).isFile()) continue;
      if (path === root || path.startsWith(root + sep) || actual === root || actual.startsWith(root + sep)) fail('target_git_executable_refused');
      return actual;
    } catch (error) { if (error.code === 'target_git_executable_refused') throw error; }
  }
  fail('git_unavailable');
}

function git(root, args, { allowMissing = false } = {}) {
  const env = Object.fromEntries(Object.entries(cleanEnv(process.env)).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_OPTIONAL_LOCKS: '0' });
  const result = spawnSync(externalGit(root), ['--no-pager', '-c', 'core.fsmonitor=false', '-C', root, ...args], { env, encoding: 'utf8', timeout: 10000, maxBuffer: LIMIT, shell: false });
  if (result.error || (result.status !== 0 && !(allowMissing && result.status === 1))) fail('repository_identity_unavailable');
  return result.stdout.trim();
}

function remoteRepo(remote) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote);
  return match?.[1] ?? null;
}

/** No checkout code, setup command, hook or gate is executed by target inspection. */
export async function inspectBudgetTarget({ manifest, root, repo }) {
  await canonical(root);
  const entries = await jsonFile(manifest);
  if (!Array.isArray(entries) || entries.length > 256 || entries.some(e => !e || typeof e.repo !== 'string') || new Set(entries.map(e => e.repo)).size !== entries.length) fail('invalid_manifest');
  if (!entries.some(e => e.repo === repo && e.role === 'managed')) fail('unmanaged_repository');
  const config = await jsonFile(join(root, '.plates', 'plates.json'));
  if (config.repo !== repo || await realpath(git(root, ['rev-parse', '--show-toplevel'])) !== root || remoteRepo(git(root, ['remote', 'get-url', 'origin'])) !== repo) fail('repository_identity_mismatch');
  const revision = git(root, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision)) fail('invalid_revision');
  if (git(root, ['config', '--includes', '--null', '--get-regexp', '^filter\\.'], { allowMissing: true })) fail('repository_filters_unsupported');
  const target = Object.freeze({ repo, root, revision, dirty: git(root, ['status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=all']) !== '' });
  inspectedTargets.add(target);
  return target;
}

function policy(capacity, weight) {
  if (!integer(capacity, 1, 128) || !integer(weight, 1, capacity)) fail('invalid_capacity_or_weight');
}

function validateState(state, capacity) {
  if (!state || state.schema !== 1 || state.host !== HOST || state.uid !== UID || !integer(state.capacity, 1, 128) || !Array.isArray(state.leases) || !Array.isArray(state.history) || state.leases.length > 128) fail('invalid_or_foreign_state');
  if (capacity !== undefined && state.capacity !== capacity) fail('capacity_policy_conflict');
  const ids = new Set();
  for (const lease of state.leases) {
    if (!lease || ![FOREGROUND_CONTRACT, 'external-container-v1'].includes(lease.foregroundContract) || typeof lease.id !== 'string' || ids.has(lease.id) || !integer(lease.weight, 1, state.capacity) || !integer(lease.pid, 1, 2 ** 31 - 1) || lease.host !== HOST || lease.uid !== UID || typeof lease.root !== 'string' || !isAbsolute(lease.root) || typeof lease.repo !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(lease.revision) || !/^[a-f0-9]{64}$/.test(lease.commandDigest) || !['reserved', 'running', 'uncertain'].includes(lease.state) || !(lease.childPid === null || integer(lease.childPid, 1, 2 ** 31 - 1))) fail('invalid_lease');
    if (lease.foregroundContract === 'external-container-v1') validateOperations(lease.operations);
    ids.add(lease.id);
  }
  if (state.leases.reduce((sum, lease) => sum + lease.weight, 0) > state.capacity) fail('invalid_capacity_total');
  return state;
}

async function readState(stateDir, capacity) {
  const path = join(stateDir, 'state.json');
  try { return validateState(await jsonFile(path, { privateFile: true }), capacity); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function syncDirectory(path) {
  const identity = await privateDirectory(path);
  const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!same(identity, await directory.stat())) fail('state_directory_replaced');
    await directory.sync();
  } finally { await directory.close(); }
}

async function archiveReceipts(stateDir, receipts) {
  const directory = join(stateDir, 'receipts');
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const identity = await privateDirectory(directory);
  for (const receipt of receipts) {
    const bytes = Buffer.from(JSON.stringify(receipt) + '\n');
    if (bytes.length > LIMIT) fail('receipt_archive_limit');
    const path = join(directory, `${createHash('sha256').update(bytes).digest('hex')}.json`);
    if (!same(identity, await privateDirectory(directory))) fail('receipt_archive_directory_replaced');
    let file;
    try { file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (file) {
      // Exclusive publication never replaces a prior receipt. A failed or
      // interrupted write remains a refusal; active history is still intact.
      try { await file.writeFile(bytes); await file.chmod(0o400); await file.sync(); }
      finally { await file.close(); }
    }
    await jsonFile(path, { privateFile: true, immutable: true, expectedBytes: bytes, durable: true });
  }
  if (!same(identity, await privateDirectory(directory))) fail('receipt_archive_directory_replaced');
  await syncDirectory(directory);
  await syncDirectory(stateDir);
}

async function storeState(stateDir, state, identity) {
  if (!same(identity, await privateDirectory(stateDir))) fail('state_directory_replaced');
  let remove = Math.max(0, state.history.length - RECENT_RECEIPTS);
  let recent = state.history.slice(remove);
  let bytes = JSON.stringify({ ...state, history: recent }, null, 2) + '\n';
  while (Buffer.byteLength(bytes) > LIMIT && remove < state.history.length) {
    recent = state.history.slice(++remove);
    bytes = JSON.stringify({ ...state, history: recent }, null, 2) + '\n';
  }
  if (Buffer.byteLength(bytes) > LIMIT) fail('state_capacity_full');
  // Commit complete immutable receipts before removing anything from active
  // history. Failed state writes may leave duplicate archives, never lost rows.
  if (remove) await archiveReceipts(stateDir, state.history.slice(0, remove));
  const destination = join(stateDir, 'state.json');
  try { await jsonFile(destination, { privateFile: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = join(stateDir, `.write-${randomUUID()}`);
  const f = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); }
  try {
    if (!same(identity, await privateDirectory(stateDir))) fail('state_directory_replaced');
    await rename(temp, destination);
  } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}

async function locked(stateDir, capacity, operation, { waitMs = 0 } = {}) {
  await canonical(stateDir, { absent: true });
  let created = false;
  try { await mkdir(stateDir, { mode: 0o700 }); created = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(stateDir);
  // Missing state in an existing directory may be lost active ownership. Never reset it.
  if (!created && !await readState(stateDir, capacity)) fail('state_missing_or_initializing_inspect');
  const identity = await privateDirectory(stateDir), guard = join(stateDir, 'coordination');
  const deadline = performance.now() + waitMs;
  for (;;) {
    try { await mkdir(guard, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (performance.now() >= deadline) fail('coordination_busy_inspect_do_not_steal');
      try { await privateDirectory(guard); }
      catch (inspectionError) { if (inspectionError.code === 'ENOENT') continue; throw inspectionError; }
      await new Promise(done => setTimeout(done, Math.min(25, Math.max(1, deadline - performance.now()))));
    }
  }
  const guardIdentity = await privateDirectory(guard), owner = { id: randomUUID(), pid: process.pid, host: HOST, uid: UID, createdAt: now() };
  const ownerPath = join(guard, 'owner.json'), ownerFile = await open(ownerPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await ownerFile.writeFile(JSON.stringify(owner)); await ownerFile.sync(); } finally { await ownerFile.close(); }
  try {
    const existing = await readState(stateDir, capacity);
    if (!existing && !created) fail('state_missing_inspect');
    const state = existing ?? { schema: 1, host: HOST, uid: UID, capacity, createdAt: now(), leases: [], history: [] };
    const result = await operation(state);
    await storeState(stateDir, state, identity);
    return result;
  } finally {
    // A crash can strand this directory. No caller removes another owner's guard.
    if (same(identity, await privateDirectory(stateDir)) && same(guardIdentity, await privateDirectory(guard)) && (await jsonFile(ownerPath, { privateFile: true })).id === owner.id) { await unlink(ownerPath); await rmdir(guard); }
  }
}

async function observeOwner(stateDir, stateIdentity, guard, guardIdentity) {
  const path = join(guard, 'owner.json');
  const directoriesRemain = async () => {
    if (!same(stateIdentity, await privateDirectory(stateDir))) fail('state_directory_replaced');
    try {
      if (!same(guardIdentity, await privateDirectory(guard))) fail('coordination_directory_replaced');
      return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!await directoriesRemain()) return null;
    try {
      const owner = await jsonFile(path, { privateFile: true });
      return await directoriesRemain() ? owner : null;
    } catch (error) {
      if (error[UNLINKED_INPUT]) {
        // An opened inode may outlive its owner's cleanup. Require positive
        // path absence; a replacement or any other unsafe input is a refusal.
        try { await lstat(path); }
        catch (absence) {
          if (absence.code !== 'ENOENT') throw absence;
          await directoriesRemain(); return null;
        }
        fail('coordination_owner_replaced');
      }
      if (error.code === 'ENOENT') { await directoriesRemain(); return null; }
      if (!(error instanceof SyntaxError) || attempt === 3) throw error;
      // Exclusive creation precedes the owner's write. Retry only this bounded
      // observation, never the command or an unsafe-file refusal. A stalled or
      // persistently malformed writer still fails closed after four reads.
      await new Promise(done => setTimeout(done, 5));
    }
  }
}

/** Read-only; missing state is not initialized and old leases are never reaped. */
export async function inspectBudget({ stateDir, capacity, targetRoot }) {
  if (targetRoot && (stateDir === targetRoot || stateDir?.startsWith(targetRoot + sep))) fail('state_inside_target_refused');
  if (capacity !== undefined) policy(capacity, 1);
  await canonical(stateDir, { absent: true });
  let stateIdentity;
  try { stateIdentity = await privateDirectory(stateDir); }
  catch (error) { if (error.code === 'ENOENT') return { schema: 1, authority: 'admission-only', initialized: false, stateDir, capacity: capacity ?? null }; throw error; }
  const state = await readState(stateDir, capacity);
  let coordinationBusy = false, coordinationOwner = null;
  const guard = join(stateDir, 'coordination');
  let guardIdentity;
  try { guardIdentity = await privateDirectory(guard); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (guardIdentity) {
    coordinationBusy = true;
    coordinationOwner = await observeOwner(stateDir, stateIdentity, guard, guardIdentity);
  }
  if (!state) return { schema: 1, authority: 'admission-only', initialized: false, stateDir, coordinationBusy, coordinationOwner, capacity: capacity ?? null };
  return { schema: 1, authority: 'admission-only', initialized: true, stateDir, capacity: state.capacity, used: state.leases.reduce((sum, lease) => sum + lease.weight, 0), coordinationBusy, coordinationOwner, leases: state.leases, history: state.history, limits: ['Foreground commands and externally controlled container leases share capacity only when all participants use this same host state directory.', 'Missing, old or apparently dead owners never release capacity automatically.'] };
}

function groupGone(pid) {
  if (!integer(pid, 1, 2 ** 31 - 1)) return false;
  try { process.kill(-pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

/** Execute an explicitly requested foreground command once, with admission only. */
export async function runBudget({ stateDir, capacity, weight = 1, target, argv, timeoutMs = 3600000, foreground = false, json = false }) {
  if (!['darwin', 'linux'].includes(process.platform) || UID === undefined) fail('unsupported_process_group_platform');
  policy(capacity, weight);
  if (foreground !== true) fail('foreground_command_contract_required');
  if (!inspectedTargets.has(target) || typeof target.repo !== 'string' || typeof target.root !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(target.revision)) fail('invalid_target');
  await canonical(target.root);
  if (stateDir === target.root || stateDir?.startsWith(target.root + sep)) fail('state_inside_target_refused');
  if (!Array.isArray(argv) || !argv.length || !argv[0] || argv.length > 128 || argv.some(a => typeof a !== 'string' || a.length > 8192 || a.includes('\0')) || !integer(timeoutMs, 10, 86400000)) fail('invalid_command_or_timeout');
  const id = randomUUID(), started = performance.now();
  const lease = { id, pid: process.pid, uid: UID, host: HOST, repo: target.repo, root: target.root, revision: target.revision, dirty: target.dirty, foregroundContract: FOREGROUND_CONTRACT, weight, createdAt: now(), commandDigest: digest(argv), childPid: null, state: 'reserved' };
  await locked(stateDir, capacity, state => {
    if (state.leases.reduce((sum, row) => sum + row.weight, 0) + weight > capacity) fail('capacity_busy_inspect_existing_leases');
    state.leases.push(lease);
  });
  const mutate = async operation => locked(stateDir, capacity, state => {
    const found = state.leases.find(row => row.id === id);
    if (!found || found.pid !== process.pid || found.host !== HOST || found.uid !== UID || found.root !== target.root || found.commandDigest !== lease.commandDigest) fail('lease_ownership_changed');
    return operation(state, found);
  }, { waitMs: 2000 });
  let child, timedOut = false, interrupted = null, spawnError = null, escalation, timer, deadline;
  const pause = ms => new Promise(done => setTimeout(done, ms));
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const handlers = new Map();
  const signalGroup = signal => { if (child?.pid) { try { process.kill(-child.pid, signal); } catch {} } };
  // Handlers exist before spawning; synchronous spawn bookkeeping cannot expose an unowned child.
  for (const signal of signals) {
    const handler = () => { interrupted ??= signal; signalGroup(signal); escalation ??= setTimeout(() => signalGroup('SIGKILL'), 1000); };
    handlers.set(signal, handler); process.on(signal, handler);
  }
  let result;
  try {
    child = spawn(argv[0], argv.slice(1), { cwd: target.root, env: cleanEnv(process.env), shell: false, detached: true, stdio: json ? ['inherit', 2, 2] : 'inherit' });
    const completed = new Promise(resolveResult => {
      child.once('error', error => { spawnError = error.code ?? 'spawn_error'; });
      child.once('close', (status, signal) => { clearTimeout(timer); resolveResult({ status, signal }); });
    });
    timer = setTimeout(() => { timedOut = true; signalGroup('SIGTERM'); escalation ??= setTimeout(() => signalGroup('SIGKILL'), 1000); }, timeoutMs);
    try { await mutate((_state, found) => { found.childPid = child.pid ?? null; found.state = 'running'; }); }
    catch (error) { signalGroup('SIGTERM'); signalGroup('SIGKILL'); throw error; }
    if (interrupted) signalGroup(interrupted);
    result = await Promise.race([completed, new Promise(done => { deadline = setTimeout(() => done({ status: null, signal: null }), timeoutMs + 3000); })]);
    clearTimeout(timer); clearTimeout(deadline);
    if ((timedOut || interrupted) && child.pid && !groupGone(child.pid)) {
      signalGroup('SIGKILL');
      const until = performance.now() + 1000;
      while (!groupGone(child.pid) && performance.now() < until) await pause(25);
    }
    clearTimeout(escalation);
    const safeToRelease = spawnError !== null && !child.pid || groupGone(child.pid);
    const outcome = { id, foregroundContract: FOREGROUND_CONTRACT, repo: target.repo, root: target.root, revision: target.revision, commandDigest: lease.commandDigest, createdAt: lease.createdAt, endedAt: now(), childStatus: result.status, signal: result.signal, timedOut, interrupted, spawnError, wallMs: performance.now() - started, cpuMs: null, released: safeToRelease };
    await mutate((state, found) => {
      if (safeToRelease) state.leases = state.leases.filter(row => row.id !== id);
      else { found.state = 'uncertain'; found.reason = 'process_group_still_present_or_unavailable'; }
      state.history.push(outcome);
    });
    return { schema: 1, authority: 'admission-only', ...outcome, status: !safeToRelease ? 75 : timedOut ? 124 : interrupted || result.signal ? 128 + (osConstants.signals[interrupted ?? result.signal] ?? 0) : Number.isInteger(result.status) && result.status >= 0 ? result.status : 1, resources: { availableParallelism: availableParallelism(), freeMemoryBytes: freemem() }, limits: ['No gate/reuse authority or changed worker defaults.', 'Foreground command contract excludes daemonizing/session-escaping descendants; no process sandbox is claimed.', 'CPU duration is unavailable; wall duration includes setup and nested waits.'] };
  } catch (error) {
    // Once a reservation exists, uncertain mutation or launch outcome is retained.
    signalGroup('SIGKILL');
    return { schema: 1, authority: 'admission-only', id, foregroundContract: FOREGROUND_CONTRACT, status: 75, released: false, childPid: child?.pid ?? null, reason: 'execution_or_lease_state_uncertain_inspect', wallMs: performance.now() - started, cpuMs: null };
  } finally {
    clearTimeout(timer); clearTimeout(deadline); clearTimeout(escalation); child?.unref();
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}

// External operations share the existing host coordinator and capacity. Their
// lifetime is not the lifetime of a local process group. These APIs are called
// only by trusted controllers; no CLI accepts a caller's assertion of termination.
function validateOperations(operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 9
    || new Set(operations).size !== operations.length
    || operations.some(id => typeof id !== 'string' || !/^plates-eval-[a-f0-9]{32}-(builder|check-[0-7])$/.test(id))) fail('invalid_external_operations');
}
export async function reserveExternalBudget({ stateDir, capacity, weight, target, id, commandDigest, operations }) {
  policy(capacity, weight); validateOperations(operations);
  if (!inspectedTargets.has(target) || !/^[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(commandDigest)) fail('invalid_external_admission');
  await canonical(target.root);
  if (stateDir === target.root || stateDir?.startsWith(target.root + sep)) fail('state_inside_target_refused');
  const lease = { id, pid: process.pid, uid: UID, host: HOST, repo: target.repo, root: target.root,
    revision: target.revision, dirty: target.dirty, foregroundContract: 'external-container-v1', weight,
    createdAt: now(), commandDigest, childPid: null, state: 'reserved', operations };
  return locked(stateDir, capacity, state => {
    if (state.leases.some(row => row.id === id) || state.history.some(row => row.id === id)) fail('external_operation_already_reserved');
    if (state.leases.reduce((sum, row) => sum + row.weight, 0) + weight > capacity) fail('capacity_busy_inspect_existing_leases');
    state.leases.push(lease); return lease;
  });
}
export async function settleExternalBudget({ stateDir, capacity, lease, observations }) {
  validateOperations(lease.operations);
  if (!Array.isArray(observations) || observations.length !== lease.operations.length
    || observations.some((o, i) => !o || o.operation !== lease.operations[i]
      || !['not-dispatched', 'terminated', 'unknown'].includes(o.state)
      || (o.state === 'terminated' && (!/^[a-f0-9]{64}$/.test(o.containerId) || o.running !== false)))) fail('invalid_external_settlement');
  return locked(stateDir, capacity, state => {
    const found = state.leases.find(row => row.id === lease.id);
    if (!found || found.foregroundContract !== 'external-container-v1' || digest(found) !== digest(lease)
      || found.pid !== process.pid) fail('lease_ownership_changed');
    const released = observations.every(o => o.state !== 'unknown');
    const receipt = { id: lease.id, foregroundContract: 'external-container-v1', commandDigest: lease.commandDigest,
      repo: lease.repo, root: lease.root, createdAt: lease.createdAt, endedAt: now(), observations, released };
    if (released) state.leases = state.leases.filter(row => row.id !== lease.id);
    else { found.state = 'uncertain'; found.reason = 'external_termination_unconfirmed'; }
    state.history.push(receipt); return receipt;
  }, { waitMs: 2000 });
}

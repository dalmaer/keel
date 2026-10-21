// Explicit Keel → Plates migration. No network, render, scheduling or execution.
// The private Git journal retains exact before/after bytes for crash recovery.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { lstat, readFile, readlink, readdir, mkdir, writeFile, rename, unlink, rmdir, symlink, chmod, realpath } from 'node:fs/promises';

const OLD = '.keel', NEW = '.plates', CONFIG = '.keel/keel.json', NEXT_CONFIG = '.plates/plates.json';
const MAX_FILE = 8 * 1024 * 1024, MAX_TOTAL = 128 * 1024 * 1024, MAX_FILES = 10000;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const exists = async path => !!await lstat(path).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
export class RenameError extends Error { constructor(message) { super(message); this.exitCode = 2; } }
const refuse = message => { throw new RenameError(message); };
const git = (root, ...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

// Operational identifiers are persisted remotely or in recovery receipts. A
// filename migration must not sever their identity or create a second queue.
const DURABLE = /(?:'keel\/'|"keel\/"|`keel\/`)|keel-goodnight-loop\b|keel%3[Aa][a-z-]+|keel:(?!(?:begin|end)\b)[a-z-]+|(?<=["'`])keel\.(?!(?:json|mjs|js|ts|md|yml|yaml|sh)\b)[a-z][a-zA-Z0-9_-]*(?=\\?["'`])|keel-(?:impact|decision|reconciliation|proof|measurements|verify)\b|keelWindow\b|keel-time-proposals?\b|keel-night-plan\b|keel-claims\b|keel\\?\/(?:robot-|update-)|keel-(?:climb|tend|night|loop)\\?\/|keel-canvas-(?:night|card)\b|__Host-keel-(?:session|login|oauth)\b|keel_private\b|keel_(?:web|home_cache|home_quota|home_cursor)_rpc\b|secrets\.KEEL_[A-Z_]+/g;
export function renameActiveText(text) {
  const held = [];
  text = text.replace(/(?:keel-night-plan:|contents\/|holds no )\.keel\/night\/plan\.json|export const REMOTE_PLAN = '\.keel\/night\/plan\.json';/g, match => `\u0000PLATES_HELD_${held.push(match) - 1}\u0000`);
  text = text.replace(DURABLE, match => `\u0000PLATES_HELD_${held.push(match) - 1}\u0000`);
  text = text.replace(/^(\s*group:\s*.*keel.*)$/gm, match => `\u0000PLATES_HELD_${held.push(match) - 1}\u0000`);
  text = text.replace(/KEEL/g, 'PLATES').replace(/Keel/g, 'Plates').replace(/keel/g, 'plates');
  text = text.replaceAll('fleet.json', 'plates.json');
  return text.replace(/\u0000PLATES_HELD_(\d+)\u0000/g, (_, index) => held[Number(index)])
    .replace(/^name: keel-impact$/gm, 'name: plates-impact');
}
export function renamePath(path) {
  if (path === 'fleet.json') return 'plates.json';
  return path.replaceAll('keel', 'plates').replaceAll('Keel', 'Plates').replaceAll('KEEL', 'PLATES');
}
// Configuration contains user-owned project, remote and receipt identities.
// Only known integration references and the product source key are renamed.
function integrationReference(text) {
  return text.replace(/\.keel(?=\/|$)/g, '.plates')
    .replace(/(?<=\.plates\/)keel\.json\b/g, 'plates.json')
    .replace(/scripts\/keel(?=\/|$)/g, 'scripts/plates')
    .replace(/skills\/keel(?=\/|$)/g, 'skills/plates')
    .replace(/(?<![\w-])keel-(night|loop|climb|tend|cross-review)\.ya?ml\b/g, match => match.replace('keel-', 'plates-'));
}
function migrateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) refuse('invalid project configuration');
  if (config.plates !== undefined && config.keel !== undefined) refuse('config has conflicting keel and plates keys');
  const converted = { ...config };
  if (Object.hasOwn(config, 'keel')) {
    converted.plates = config.keel === 'github:dalmaer/keel' ? 'github:dalmaer/plates' : config.keel;
    delete converted.keel;
  }
  // These fields are paths or commands, never remote identifiers. Local variant
  // explanations and nested provider/project/Canvas identifiers remain exact.
  for (const key of ['check', 'health', 'lessons', 'gateWorkflow']) {
    if (typeof converted[key] === 'string') converted[key] = integrationReference(converted[key]);
  }
  if (config.ci?.gateWorkflow) converted.ci = { ...config.ci, gateWorkflow: integrationReference(config.ci.gateWorkflow) };
  if (config.keel === 'self' && config.repo === 'dalmaer/keel') {
    converted.repo = 'dalmaer/plates';
    converted.lessonProject = config.lessonProject ?? config.repo;
    if (config.name === 'Keel') converted.name = 'Plates';
  }
  return converted;
}
function migratePackage(source) {
  const pkg = JSON.parse(source);
  // A consumer package's name/repository/version are its own identity. Script
  // invocations and installation references are the integration we own here.
  if (pkg.scripts) pkg.scripts = Object.fromEntries(Object.entries(pkg.scripts).map(([key, value]) => [key, renameActiveText(value)]));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (!pkg[field]) continue;
    for (const [key, value] of Object.entries(pkg[field])) {
      if (key !== 'keel' || !/^github:dalmaer\/keel(?:#|$)/.test(value)) continue;
      if (pkg[field].plates !== undefined) refuse('package has conflicting keel and plates dependencies');
      pkg[field].plates = value.replace('github:dalmaer/keel', 'github:dalmaer/plates');
      delete pkg[field].keel;
    }
  }
  return json(pkg);
}
function migrateNightPlanSource(text) {
  if (!text.includes("export const PLAN_BRANCH = 'keel-night-plan';") || text.includes('export const REMOTE_PLAN =')) return text;
  return text.replace("export const PLAN_BRANCH = 'keel-night-plan';", "export const PLAN_BRANCH = 'keel-night-plan';\n// The branch and blob path are durable remote identities shared with existing\n// Keel installations. Local working files use PLAN; remote readers/writers\n// retain one path so a rename cannot create or overwrite a competing plan.\nexport const REMOTE_PLAN = '.keel/night/plan.json';")
    .replaceAll('`${tip}:${PLAN}`', '`${tip}:${REMOTE_PLAN}`')
    .replaceAll('holds no ${PLAN}: nothing to tick', 'holds no ${REMOTE_PLAN}: nothing to tick')
    .replaceAll('held no ${PLAN}`', 'held no ${REMOTE_PLAN}`')
    .replaceAll('`100644,${blob},${PLAN}`', '`100644,${blob},${REMOTE_PLAN}`');
}
const historical = path => /^docs\/(?:evidence|research|reviews|health|night|tend|retros|lessons)(?:\/|\.)/.test(path) || ['NOTICE', 'WHATSNEW.md'].includes(path);
function workingLinks(text, mapping) {
  // Historical prose, commands, protocol blocks and fingerprints stay intact.
  // Only Markdown link destinations to renamed tracked paths change.
  return text.replace(/(\]\()([^\s)]+)([^)]*\))/g, (whole, start, target, end) => {
    if (/\/blob\/[a-f0-9]{7,40}\//.test(target)) return whole;
    let next = target;
    for (const [from, to] of mapping) {
      if (next === from || next.endsWith(`/${from}`) || next.startsWith(`${from}#`)) next = next.replace(from, to);
      else {
        const oldName = from.split('/').at(-1), newName = to.split('/').at(-1);
        const [pathname, anchor] = next.split('#');
        if (pathname === oldName || pathname.endsWith(`/${oldName}`)) next = pathname.slice(0, -oldName.length) + newName + (anchor === undefined ? '' : `#${anchor}`);
      }
    }
    return `${start}${next}${end}`;
  });
}
const inside = path => typeof path === 'string' && path && !isAbsolute(path) && !path.split('/').some(part => part === '..' || part === '.git') && !path.includes('\0');
async function safeParents(root, path) {
  if (!inside(path)) refuse(`unsafe migration path: ${path}`);
  let at = root;
  for (const part of path.split('/').slice(0, -1)) {
    at = join(at, part);
    const s = await lstat(at).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (s && (!s.isDirectory() || s.isSymbolicLink())) refuse(`migration parent is not a real directory: ${relative(root, at)}`);
  }
}
async function snapshot(root, path) {
  await safeParents(root, path);
  const full = join(root, path), s = await lstat(full).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!s) return null;
  if (s.isSymbolicLink()) {
    const target = await readlink(full), dest = relative(root, resolve(dirname(full), target));
    if (!inside(dest)) refuse(`migration link escapes project: ${path}`);
    return { kind: 'link', data: target, mode: s.mode & 0o777 };
  }
  if (!s.isFile() || s.size > MAX_FILE) refuse(`unsupported or oversized migration file: ${path}`);
  return { kind: 'file', data: (await readFile(full)).toString('base64'), mode: s.mode & 0o777 };
}
const bytes = state => state.kind === 'link' ? state.data : Buffer.from(state.data, 'base64');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const textState = (state, text) => ({ ...state, data: Buffer.from(text).toString('base64') });
function decoded(state) {
  if (state.kind === 'link') return state.data;
  const raw = bytes(state), value = raw.toString('utf8');
  return raw.includes(0) || !Buffer.from(value).equals(raw) ? null : value;
}
async function metadata(root) {
  const top = await realpath(git(root, 'rev-parse', '--show-toplevel').trim());
  if (top !== root) refuse('migration requires the repository root');
  return resolve(root, git(root, 'rev-parse', '--git-path', 'plates-rename').trim());
}
async function runtimeInventory(root, dir = OLD, result = [], directories = []) {
  const full = join(root, dir), s = await lstat(full).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!s) return { files: result, directories };
  if (!s.isDirectory() || s.isSymbolicLink()) refuse(`runtime root is not a real directory: ${dir}`);
  directories.push(dir);
  for (const item of await readdir(full, { withFileTypes: true })) {
    const path = `${dir}/${item.name}`;
    // Any writer lock, even stale, needs its owner's recovery procedure first.
    if (/\.lock$/.test(item.name)) refuse(`runtime writer lock must be resolved before migration: ${path}`);
    if (item.isDirectory()) await runtimeInventory(root, path, result, directories);
    else result.push(path);
    if (result.length > MAX_FILES) refuse('migration file limit reached');
  }
  return { files: result, directories };
}
function blockBody(text, id, brand) {
  const begin = `<!-- ${brand}:begin ${id} -->`, end = `<!-- ${brand}:end ${id} -->`;
  const b = text.indexOf(begin), e = text.indexOf(end), start = text.indexOf('\n', b) + 1;
  if (b < 0 || e < start || !start || text.indexOf(begin, b + 1) !== -1) return null;
  return text.slice(start, e);
}
async function buildPlan(root) {
  if (!await exists(join(root, CONFIG))) {
    if (await exists(join(root, NEXT_CONFIG)) && !await exists(join(root, OLD))) return { version: 1, root, state: 'already-migrated', operations: [], directories: [], digest: hash('already-migrated') };
    refuse('expected .keel/keel.json; refusing an ambiguous or unconfigured project');
  }
  if (await exists(join(root, NEW))) refuse('.plates already exists; inspect conflicting roots before migration');
  const tracked = git(root, 'ls-files', '-z').split('\0').filter(Boolean);
  const trackedSet = new Set(tracked);
  const runtime = await runtimeInventory(root);
  let matching;
  try { matching = git(root, 'grep', '-I', '-l', '-z', '-E', 'keel|Keel|KEEL|fleet\\.json', '--', '.').split('\0').filter(Boolean); }
  catch (error) { if (error.status !== 1) throw error; matching = []; }
  const oldLock = await readFile(join(root, '.keel/lock.json'), 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  const lockedPaths = oldLock ? Object.keys(JSON.parse(oldLock).files ?? {}).map(key => key.split('#')[0]) : [];
  const paths = [...new Set([...matching, ...tracked.filter(path => renamePath(path) !== path), ...lockedPaths, ...runtime.files])].sort();
  const mapping = new Map(paths.map(path => [path, path.startsWith(`${OLD}/`) ? `${NEW}/${path.slice(OLD.length + 1)}` : renamePath(path)]));
  mapping.set(CONFIG, NEXT_CONFIG);
  const original = new Map(), updated = new Map();
  let total = 0;
  for (const path of paths) {
    if (!inside(path)) refuse(`unsafe tracked path: ${path}`);
    const state = await snapshot(root, path);
    if (!state) continue; // Unrelated missing tracked files remain the owner's work.
    total += bytes(state).length;
    if (total > MAX_TOTAL) refuse('migration byte limit reached');
    original.set(path, state);
    let next = state;
    const runtimeData = path.startsWith(`${OLD}/`) && ![CONFIG, '.keel/lock.json', '.keel/bounds.json'].includes(path);
    const source = decoded(state);
    if (!runtimeData && source !== null) {
      if (state.kind === 'link') next = { ...state, data: renamePath(source) };
      else if (path === CONFIG) {
        next = textState(state, json(migrateConfig(JSON.parse(source))));
      } else if (path === 'package.json') {
        next = textState(state, migratePackage(source));
      } else if (path !== '.keel/lock.json') {
        let nextText;
        if (historical(path)) nextText = workingLinks(source, mapping);
        else if (path.startsWith('docs/phases/') && source.includes('\n## Trajectory')) {
          const at = source.indexOf('\n## Trajectory');
          nextText = renameActiveText(source.slice(0, at)) + workingLinks(source.slice(at), mapping);
        } else if (path.endsWith('scripts/keel/night-plan.mjs')) nextText = migrateNightPlanSource(renameActiveText(source));
        else if (path.endsWith('scripts/keel/morning.mjs')) nextText = renameActiveText(source).replace('import { PLAN, PLAN_BRANCH,', 'import { PLAN, PLAN_BRANCH, REMOTE_PLAN,').replace('await at(`${PLAN_BRANCH}:${PLAN}`, () => remoteFile(root, PLAN_BRANCH, PLAN), PLAN_BRANCH);', 'await at(`${PLAN_BRANCH}:${REMOTE_PLAN}`, () => remoteFile(root, PLAN_BRANCH, REMOTE_PLAN), PLAN_BRANCH);');
        else nextText = renameActiveText(source);
        next = textState(state, nextText);
      }
    }
    updated.set(path, next);
  }
  if (original.has('.keel/lock.json')) {
    const state = original.get('.keel/lock.json'), lock = JSON.parse(decoded(state));
    if (!lock || !lock.files || typeof lock.files !== 'object' || Array.isArray(lock.files)) refuse('invalid managed-file lock');
    const files = {};
    for (const [key, row] of Object.entries(lock.files)) {
      const [path, block] = key.split('#'), before = original.get(path), after = updated.get(path);
      const target = mapping.get(path) ?? renamePath(path), nextKey = block ? `${target}#${block}` : target;
      if (files[nextKey]) refuse(`managed lock collision: ${nextKey}`);
      if (!before) {
        if (target !== path) refuse(`managed migration source is missing: ${path}`);
        files[nextKey] = row; continue;
      }
      const oldBytes = block ? blockBody(decoded(before) ?? '', block, 'keel') : bytes(before);
      const newBytes = block ? blockBody(decoded(after) ?? '', block, 'plates') : bytes(after);
      const changed = target !== path || !equal(before, after);
      if (changed && (oldBytes === null || hash(oldBytes) !== row.sha256)) refuse(`managed file drift must be resolved before migration: ${key}`);
      if (changed && newBytes === null) refuse(`managed block did not survive migration: ${key}`);
      files[nextKey] = changed ? { ...row, sha256: hash(newBytes) } : row;
    }
    updated.set('.keel/lock.json', textState(state, json({ ...lock, files })));
  }
  const operations = [];
  for (const [from, before] of original) {
    const to = mapping.get(from), after = updated.get(from);
    if (from === to && equal(before, after)) continue;
    await safeParents(root, to);
    if (from !== to && await exists(join(root, to))) refuse(`migration destination exists: ${to}`);
    if (operations.some(op => op.to.toLowerCase() === to.toLowerCase())) refuse(`migration destination collision: ${to}`);
    operations.push({ from, to, before, after, tracked: trackedSet.has(from) });
  }
  // Publish the new config only after its dependencies; never run both schedules.
  operations.sort((a, b) => Number(a.from === CONFIG) - Number(b.from === CONFIG) || a.from.localeCompare(b.from));
  const directories = new Set(runtime.directories);
  for (const op of operations) {
    let dir = dirname(op.from);
    while (dir !== '.' && renamePath(dir) !== dir) { directories.add(dir); dir = dirname(dir); }
  }
  const plan = { version: 1, root, state: 'planned', operations, directories: [...directories] };
  return { ...plan, digest: hash(JSON.stringify(plan)) };
}
function publicPlan(plan, state = plan.state) {
  return { version: 1, root: plan.root, state, digest: plan.digest, files: plan.operations.map(op => ({ from: op.from, to: op.to, kind: op.before.kind, tracked: op.tracked, before: hash(bytes(op.before)), after: hash(bytes(op.after)) })), preservedRuntime: plan.operations.filter(op => op.from.startsWith(`${OLD}/`) && equal(op.before, op.after)).length };
}
async function receiptAt(dir) {
  try { return JSON.parse(await readFile(join(dir, 'receipt.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function validReceipt(receipt, root) {
  if (receipt.version !== 1 || receipt.root !== root || receipt.plan?.root !== root || !Array.isArray(receipt.finished)) refuse('migration receipt identity mismatch');
  const { digest, ...plan } = receipt.plan;
  if (hash(JSON.stringify(plan)) !== digest) refuse('migration receipt digest mismatch');
}
async function saveReceipt(dir, receipt) {
  const path = join(dir, `receipt-${randomUUID()}.tmp`);
  await writeFile(path, json(receipt), { mode: 0o600, flag: 'wx' });
  await rename(path, join(dir, 'receipt.json'));
}
export async function planRename(from) {
  const root = await realpath(resolve(from)), dir = await metadata(root), receipt = await receiptAt(dir);
  if (receipt && receipt.state !== 'completed') {
    validReceipt(receipt, root);
    return publicPlan(receipt.plan, 'recovery-required');
  }
  return publicPlan(await buildPlan(root));
}
async function lockMigration(dir) {
  const prior = await lstat(dir).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (prior && (!prior.isDirectory() || prior.isSymbolicLink())) refuse('migration journal directory is unsafe');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'writer.json');
  try { await writeFile(path, json({ pid: process.pid, host: hostname() }), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner; try { owner = JSON.parse(await readFile(path, 'utf8')); } catch { refuse('migration writer ownership unavailable'); }
    if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) refuse('migration writer ownership unavailable');
    try { process.kill(owner.pid, 0); refuse('migration is already active'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    await unlink(path);
    await writeFile(path, json({ pid: process.pid, host: hostname() }), { flag: 'wx', mode: 0o600 });
  }
  return () => unlink(path);
}
async function place(path, state) {
  if (state.kind === 'link') await symlink(state.data, path);
  else await writeFile(path, bytes(state), { flag: 'wx', mode: state.mode });
}
/** afterBackup/afterOperation are injectable process-crash boundaries for tests. */
export async function applyRename(from, { digest, afterBackup, afterOperation } = {}) {
  const root = await realpath(resolve(from)), dir = await metadata(root), release = await lockMigration(dir);
  try {
    let receipt = await receiptAt(dir);
    if (!receipt || receipt.state === 'completed') {
      const plan = await buildPlan(root);
      if (plan.state === 'already-migrated') return publicPlan(plan);
      if (digest && digest !== plan.digest) refuse('migration preview changed; inspect a fresh plan');
      receipt = { version: 1, root, state: 'applying', plan, finished: [] };
      await saveReceipt(dir, receipt);
    } else {
      validReceipt(receipt, root);
      if (digest && digest !== receipt.plan.digest) refuse('recovery must use the original migration preview');
    }
    for (const [index, op] of receipt.plan.operations.entries()) {
      await safeParents(root, op.from); await safeParents(root, op.to);
      const source = join(root, op.from), target = join(root, op.to), backup = join(dir, `before-${index}`), stage = join(dir, `after-${index}`);
      const current = await snapshot(root, op.to);
      if (equal(current, op.after) && (op.from === op.to || !await exists(source))) {
        if (!receipt.finished.includes(index)) { receipt.finished.push(index); await saveReceipt(dir, receipt); }
        continue;
      }
      if (receipt.finished.includes(index)) refuse(`migrated file changed before recovery: ${op.to}`);
      if (op.from !== op.to && current) refuse(`migration target changed: ${op.to}`);
      const original = await snapshot(root, op.from);
      if (!await exists(backup)) {
        if (!equal(original, op.before)) refuse(`migration source changed: ${op.from}`);
        if (await exists(stage)) await unlink(stage);
        await place(stage, op.after);
        await mkdir(dirname(target), { recursive: true });
        // Removing the old schedule before installing the new one prevents two
        // workflow filenames from being active in the same completed tree.
        await rename(source, backup);
        if (afterBackup) await afterBackup(index);
      } else {
        const saved = await lstat(backup);
        if (!saved.isFile() && !saved.isSymbolicLink()) refuse('invalid migration backup');
        if (original) refuse(`migration source reappeared: ${op.from}`);
        if (!await exists(stage)) await place(stage, op.after);
      }
      await rename(stage, target);
      if (op.after.kind === 'file') await chmod(target, op.after.mode);
      receipt.finished.push(index); await saveReceipt(dir, receipt);
      if (afterOperation) await afterOperation(index);
    }
    for (const path of [...receipt.plan.directories].sort((a, b) => b.length - a.length)) {
      try { await rmdir(join(root, path)); }
      catch (error) {
        if (error.code === 'ENOENT') continue;
        if (!path.startsWith(OLD) && error.code === 'ENOTEMPTY') continue; // Never remove unrelated untracked work.
        refuse(`runtime changed during migration; inspect ${path} before recovery`);
      }
    }
    receipt.state = 'completed'; await saveReceipt(dir, receipt);
    return publicPlan(receipt.plan, 'completed');
  } finally { await release(); }
}
export async function migrateRename({ root, yes = false, digest } = {}) {
  const result = yes ? await applyRename(root, { digest }) : await planRename(root);
  return { data: result, text: `${result.state}: ${result.files.length} file changes${yes ? '' : '; apply this reviewed plan with --yes --digest ' + result.digest}`, exitCode: !yes && result.state !== 'already-migrated' ? 3 : 0 };
}

// Explicit external workspace ownership; no ambient project or home-directory defaults.
import { constants } from 'node:fs';
import { lstat, realpath, open, readdir, mkdir } from 'node:fs/promises';
import { isAbsolute, dirname, basename, join, relative, sep, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const WORKSPACE_LIMITS = Object.freeze({ bytes: 1024 * 1024, projects: 100 });
const fail = message => { const error = new Error(message); error.exitCode = 2; throw error; };
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const repo = value => typeof value === 'string' && value.length <= 140
  && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]{1,100}$/.test(value)
  && !value.split('/')[0].includes('--') && !value.toLowerCase().endsWith('.git')
  && !['.', '..'].includes(value.split('/')[1]);
const inside = (parent, child) => { const path = relative(parent, child); return !path || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)); };
const overlap = (a, b) => inside(a, b) || inside(b, a);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateManifest(value) {
  if (!keys(value, ['version', 'id', 'name', 'repo', 'projects']) || value.version !== 1 || !id(value.id)
    || typeof value.name !== 'string' || !value.name.length || value.name !== value.name.trim()
    || value.name.length > 120 || /[\x00-\x1f\x7f-\x9f]/.test(value.name) || !repo(value.repo)
    || !Array.isArray(value.projects) || value.projects.length > WORKSPACE_LIMITS.projects) fail('invalid workspace manifest');
  const ids = new Set(), repos = new Set([value.repo.toLowerCase()]);
  for (const project of value.projects) {
    if (!keys(project, ['id', 'repo']) || !id(project.id) || !repo(project.repo)
      || ids.has(project.id) || repos.has(project.repo.toLowerCase())) fail('invalid or duplicate workspace project');
    ids.add(project.id); repos.add(project.repo.toLowerCase());
  }
  return value;
}
async function optionalStat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function privateMode(stat, kind) {
  if (process.platform !== 'win32' && (stat.mode & 0o077)) fail(`${kind} must have private permissions`);
}
async function readBounded(path, limit, marker = false) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) fail('workspace input must be a regular file');
  // O_NONBLOCK prevents a replacement FIFO from blocking before the descriptor check.
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit || (marker && stat.nlink !== 1)) fail('unsafe or oversized workspace file');
    if (marker) privateMode(stat, 'workspace marker');
    const bytes = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < bytes.length) { const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null); if (!bytesRead) break; offset += bytesRead; }
    if (offset > limit) fail('workspace file exceeds size bound');
    return bytes.subarray(0, offset);
  } finally { await file.close(); }
}
function decode(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('workspace file must contain valid UTF-8 JSON'); }
}
async function noGitTree(path) {
  for (let current = path;; current = dirname(current)) {
    if (await optionalStat(join(current, '.git'))) fail('workspace state must be outside Git working trees');
    if (dirname(current) === current) return;
  }
}
async function resolveWorkspace({ manifest, state, appRoot }) {
  if (![manifest, state, appRoot].every(path => typeof path === 'string' && isAbsolute(path) && !/[\x00-\x1f\x7f]/.test(path))) fail('workspace paths must be explicit absolute paths');
  // Normalize before checking the leaf so trailing slashes cannot conceal a symlink.
  state = resolve(state);
  const application = await realpath(appRoot), source = await realpath(manifest);
  if (inside(application, source)) fail('workspace manifest must be outside application code');
  const sourceBytes = await readBounded(source, WORKSPACE_LIMITS.bytes);
  const workspace = validateManifest(decode(sourceBytes));
  const leaf = await optionalStat(state);
  if (leaf && (!leaf.isDirectory() || leaf.isSymbolicLink())) fail('workspace state must be a real directory');
  const parent = await realpath(dirname(state));
  if (!(await lstat(parent)).isDirectory()) fail('workspace state parent must exist');
  const destination = leaf ? await realpath(state) : join(parent, basename(state));
  if (dirname(destination) === destination || overlap(application, destination) || overlap(dirname(source), destination)) fail('workspace state overlaps protected paths');
  await noGitTree(leaf ? destination : parent);
  let ready = false;
  if (leaf) {
    privateMode(leaf, 'workspace state directory');
    const markerPath = join(destination, 'workspace.json'), markerStat = await optionalStat(markerPath);
    if (markerStat) {
      if (!markerStat.isFile() || markerStat.isSymbolicLink()) fail('unsafe workspace marker');
      const marker = decode(await readBounded(markerPath, 4096, true));
      if (!keys(marker, ['version', 'id', 'repo']) || marker.version !== 1 || marker.id !== workspace.id || marker.repo !== workspace.repo) fail('workspace ownership marker does not match manifest');
      ready = true;
    } else if ((await readdir(destination)).length) fail('workspace state is nonempty and unowned');
  }
  return { sourceDigest: digest(sourceBytes), data: {
    paths: { manifest: source, state: destination }, workspace: { version: 1, id: workspace.id, name: workspace.name, repo: workspace.repo },
    projects: workspace.projects, state: ready ? 'ready' : 'uninitialized', privacy: { state: 'unverified' },
  } };
}
/** Reusable resolver. Call again at each later writer's mutation boundary. */
export async function inspectWorkspace(options) {
  try { return (await resolveWorkspace(options)).data; }
  catch (error) { if (error.exitCode === 2) throw error; fail('workspace paths or files could not be safely read'); }
}
export async function initializeWorkspace(options) {
  try {
    const before = await resolveWorkspace(options);
    if (before.data.state === 'ready') return before.data;
    // Keep the first checked content, then re-resolve paths/ownership immediately before mutation.
    const checked = await resolveWorkspace(options);
    if (checked.sourceDigest !== before.sourceDigest || JSON.stringify(checked.data.paths) !== JSON.stringify(before.data.paths)) fail('workspace configuration changed before initialization');
    if (checked.data.state === 'ready') return checked.data;
    const destination = checked.data.paths.state;
    await mkdir(destination, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const current = await resolveWorkspace(options);
    if (current.sourceDigest !== before.sourceDigest || JSON.stringify(current.data.paths) !== JSON.stringify(before.data.paths)) fail('workspace configuration changed before initialization');
    if (current.data.state === 'ready') return current.data;
    const { id, repo } = current.data.workspace;
    let marker;
    try { marker = await open(join(destination, 'workspace.json'), 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await inspectWorkspace(options);
      if (existing.state !== 'ready') fail('workspace ownership changed during initialization');
      return existing;
    }
    try { await marker.writeFile(`${JSON.stringify({ version: 1, id, repo }, null, 2)}\n`); await marker.sync(); }
    finally { await marker.close(); }
    return await inspectWorkspace(options);
  } catch (error) { if (error.exitCode === 2) throw error; fail('workspace initialization could not safely complete'); }
}
export async function workspaceCommand(args, appRoot) {
  const [operation, ...rest] = args;
  if (!['inspect', 'init'].includes(operation)) fail('workspace needs inspect or init');
  const values = {}, seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!['--manifest', '--state', '--json', '--yes'].includes(flag) || seen.has(flag)) fail('unexpected or repeated workspace argument');
    seen.add(flag);
    if (flag === '--manifest' || flag === '--state') {
      const value = rest[++i];
      if (!value || value.startsWith('--')) fail('workspace path option needs a value');
      values[flag.slice(2)] = value;
    } else if (flag === '--yes' && operation !== 'init') fail('--yes is valid only for workspace init');
  }
  const options = { ...values, appRoot };
  const apply = operation === 'init' && seen.has('--yes');
  const data = await (apply ? initializeWorkspace(options) : inspectWorkspace(options));
  return { data: { operation, mode: operation === 'inspect' ? 'read' : apply ? 'apply' : 'preview', ...data },
    text: `Workspace ${data.workspace.name}: ${data.state}. Remote privacy is unverified.${operation === 'init' && !apply ? ' Preview only; use --yes to initialize.' : ''}`,
    exitCode: operation === 'init' && !apply ? 3 : 0 };
}

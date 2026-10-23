// Advisory source planning. No gate is executed, omitted, or certified here.
import { spawnSync } from 'node:child_process';
import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { REQUIRED_CONVENTIONS } from '../scripts/check-focused.mjs';
import { inspectCapabilities, probeEnvironment, resolveExecutable } from './validation-capabilities.mjs';

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HASH = /^[a-f0-9]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_BYTES = 8 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const SOURCE_MAPPINGS = Object.freeze(Object.fromEntries([
  ['lib/validation-audit.mjs', ['tests/validation-audit.test.mjs']],
  ['scripts/validation-audit.mjs', ['tests/validation-audit.test.mjs']],
  ['tests/validation-audit.test.mjs', ['tests/validation-audit.test.mjs']],
  ['lib/validation-plan.mjs', ['tests/validation-plan.test.mjs']],
  ['lib/validation-capabilities.mjs', ['tests/validation-plan.test.mjs', 'tests/check-focused.test.mjs']],
  ['scripts/validation-plan.mjs', ['tests/validation-plan.test.mjs']],
  ['tests/validation-plan.test.mjs', ['tests/validation-plan.test.mjs']],
  ['scripts/check-focused.mjs', ['tests/check-focused.test.mjs', 'tests/validation-plan.test.mjs']],
  ['tests/check-focused.test.mjs', ['tests/check-focused.test.mjs']],
  ['lib/validation-budget.mjs', ['tests/validation-budget.test.mjs']],
  ['scripts/validation-budget.mjs', ['tests/validation-budget.test.mjs']],
  ['tests/validation-budget.test.mjs', ['tests/validation-budget.test.mjs']],
].map(([path, tests]) => [path, Object.freeze(tests)])));
function safePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 1024 && !path.startsWith('/') && !/[\\\0-\x1f\x7f]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
}
/** Unknown input always wins over a known family. The full gate is unconditional. */
export function selectValidation(changes, { source = false } = {}) {
  if (!Array.isArray(changes) || changes.length > 2048) throw new Error('invalid changed-path inventory');
  const reasons = [], selected = new Set(source ? REQUIRED_CONVENTIONS : []);
  if (!source) reasons.push('consumer-mapping-unavailable');
  if (changes.length === 0) reasons.push('no-changed-inputs-no-gate-exemption');
  for (const change of changes) {
    if (!change || !safePath(change.path) || typeof change.status !== 'string') throw new Error('invalid changed path');
    if (!/^(?:[AMDTUXB?]|R\d{1,3}|C\d{1,3})$/.test(change.status)) throw new Error('invalid change status');
    if (change.previous !== undefined && !safePath(change.previous)) throw new Error('invalid previous path');
    if (!['A', 'M', '?'].includes(change.status) || change.previous !== undefined) reasons.push(`rename-or-structural:${change.path}`);
    if (!Object.hasOwn(SOURCE_MAPPINGS, change.path)) reasons.push(`unmapped-or-shared:${change.path}`);
    else if (source) for (const file of SOURCE_MAPPINGS[change.path]) selected.add(file);
  }
  return { mode: reasons.length ? 'broad' : 'focused-first', reasons: [...new Set(reasons)], tests: [...selected], requiredGate: 'unchanged-complete-configured-gate', gateMayBeOmitted: false, authority: 'feedback-only' };
}
async function readBounded(path, limit = MAX_BYTES) {
  const absolute = resolve(path);
  if (await realpath(absolute) !== absolute) throw new Error('input path must be canonical and contain no symlink');
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > limit) throw new Error('input must be a bounded regular file');
    // A growing file cannot make the read allocate beyond the stated bound.
    const buffer = Buffer.alloc(Math.min(before.size + 1, limit + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const bytes = buffer.subarray(0, length);
    const after = await file.stat();
    const current = await lstat(absolute);
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || !current.isFile() || current.dev !== after.dev || current.ino !== after.ino || await realpath(absolute) !== absolute) throw new Error('input changed while reading');
    return bytes;
  } finally { await file.close(); }
}
function text(bytes) {
  const value = bytes.toString('utf8');
  if (!Buffer.from(value).equals(bytes)) throw new Error('input is not valid UTF-8');
  return value;
}
const parseJSON = bytes => JSON.parse(text(bytes));
function git(root, args, executable, statuses = [0]) {
  const result = spawnSync(executable, ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'color.ui=false', '-c', 'core.quotePath=true', ...args], { cwd: root, env: probeEnvironment(), shell: false, encoding: 'buffer', timeout: 10000, maxBuffer: MAX_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || !statuses.includes(result.status)) throw new Error('required read-only Git observation unavailable');
  return result.stdout;
}
function parseChanges(bytes, scope) {
  const parts = text(bytes).split('\0');
  if (parts.pop() !== '') throw new Error('incomplete Git changed-path output');
  const changes = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (/^[RC]\d+$/.test(status)) {
      const previous = parts[i++], path = parts[i++]; changes.push({ status, path, previous, scope });
    } else changes.push({ status, path: parts[i++], scope });
  }
  return changes;
}
function repositoryOf(remote) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote);
  return match?.[1]?.toLowerCase() ?? null;
}
async function snapshot(root, manifestPath, base, gitPath) {
  const observe = args => git(root, args, gitPath);
  // Git worktree inspection may invoke clean/process filters. Refuse every
  // effective filter declaration before diff/status instead of running it.
  if (git(root, ['config', '--includes', '--null', '--get-regexp', '^filter\\.'], gitPath, [0, 1]).length) throw new Error('repository Git filters require inspection; read-only planning refused');
  const manifestBytes = await readBounded(manifestPath, 1024 * 1024), configBytes = await readBounded(join(root, '.plates/plates.json'), 1024 * 1024), packageBytes = await readBounded(join(root, 'package.json'), 1024 * 1024);
  const manifest = parseJSON(manifestBytes), config = parseJSON(configBytes), pkg = parseJSON(packageBytes);
  if (!Array.isArray(manifest) || manifest.length > 256 || !config || typeof config !== 'object' || !pkg || typeof pkg !== 'object' || !REPO.test(config.repo ?? '')) throw new Error('invalid manifest or repository configuration');
  const identities = new Set();
  for (const item of manifest) {
    if (!item || typeof item !== 'object' || !REPO.test(item.repo ?? '') || identities.has(item.repo.toLowerCase())) throw new Error('invalid or duplicate manifest repository');
    identities.add(item.repo.toLowerCase());
  }
  if (!manifest.some(item => item.repo.toLowerCase() === config.repo.toLowerCase() && item.role === 'managed')) throw new Error('target is not an existing manifest-managed repository');
  if (repositoryOf(text(observe(['config', '--get', 'remote.origin.url'])).trim()) !== config.repo.toLowerCase()) throw new Error('configured repository does not match origin identity');
  if (text(observe(['rev-parse', '--show-toplevel'])).trim() !== root) throw new Error('root must be the exact repository worktree root');
  const head = text(observe(['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  if (!HASH.test(head) || text(observe(['rev-parse', '--verify', `${base}^{commit}`])).trim() !== base) throw new Error('base and head must be full local commit identities');
  const committed = observe(['diff', '--ignore-submodules=all', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', `${base}...${head}`, '--']);
  const staged = observe(['diff', '--ignore-submodules=all', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', '--cached', 'HEAD', '--']);
  const working = observe(['diff', '--ignore-submodules=all', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', '--']);
  const untracked = observe(['ls-files', '--others', '--exclude-standard', '-z']);
  const parts = text(untracked).split('\0');
  if (parts.pop() !== '') throw new Error('incomplete untracked path output');
  const changes = [...parseChanges(committed, 'committed'), ...parseChanges(staged, 'index'), ...parseChanges(working, 'working-tree'), ...parts.map(path => ({ path, status: '?', scope: 'untracked' }))];
  selectValidation(changes); // validates bounds and paths before any filesystem traversal
  const files = [];
  for (const path of [...new Set(changes.flatMap(change => change.previous ? [change.previous, change.path] : [change.path]))].sort()) {
    const absolute = join(root, path);
    try {
      const state = await lstat(absolute);
      if (!state.isFile() || state.isSymbolicLink()) files.push({ path, state: 'unsupported-file-kind' });
      else files.push({ path, state: 'file', sha256: digest(await readBounded(absolute)) });
    } catch (error) { if (error.code === 'ENOENT') files.push({ path, state: 'absent' }); else throw error; }
  }
  const index = observe(['ls-files', '--stage', '-z']);
  const status = text(observe(['status', '--ignore-submodules=all', '--porcelain=v1', '-z', '--untracked-files=all']));
  const gate = config.check === undefined ? 'npm run check' : config.check;
  if (typeof gate !== 'string' || !gate.trim() || gate.length > 4096 || /[\0\r\n]/.test(gate)) throw new Error('configured gate must be a bounded single-line command');
  const input = { head, base, repo: config.repo, manifest: digest(manifestBytes), config: digest(configBytes), package: digest(packageBytes), committed: digest(committed), staged: digest(staged), working: digest(working), untracked: digest(untracked), status: digest(status), index: digest(index), files };
  return { head, base, repo: config.repo, config, pkg, packageBytes, gate, changes, files, dirty: status.length > 0, submodules: /(^|\0)160000 /.test(text(index)), inputDigest: digest(JSON.stringify(input)), input };
}
async function reviewAvailability(root, before, directory, gitPath) {
  if (directory === undefined) return { status: 'unavailable', approval: false, reason: 'No explicit retained review input supplied.' };
  try {
    if (!isAbsolute(directory) || await realpath(directory) !== resolve(directory)) throw new Error('unsafe review directory');
    const metadata = parseJSON(await readBounded(join(directory, 'pr.json'), 1024 * 1024));
    const diff = await readBounded(join(directory, 'pr.diff'));
    const expected = git(root, ['diff', '--ignore-submodules=all', '--no-ext-diff', '--no-textconv', '--binary', `${before.base}...${before.head}`, '--'], gitPath);
    const paths = new Set(before.changes.filter(change => change.scope === 'committed').map(change => change.path));
    if (before.dirty || metadata.baseRefOid !== before.base || metadata.headRefOid !== before.head || metadata.changedFiles !== paths.size || !diff.equals(expected)) throw new Error('incomplete or stale review input');
    return { status: 'complete-input', approval: false, base: before.base, head: before.head, changedFiles: paths.size, diffSha256: digest(diff), reason: 'Byte-complete input availability only; independent workflow/event and review outcome are still required.' };
  } catch { return { status: 'unavailable', approval: false, reason: 'Retained input is unsafe, incomplete, stale, or unavailable for this exact clean base/head.' }; }
}
/** Re-read after probes so concurrent edits cannot produce a narrow stable-input claim. */
export async function inspectValidationPlan({ root, manifest, base, reviewInput }, { capabilities = inspectCapabilities, afterSnapshot = async () => {} } = {}) {
  if (!isAbsolute(root ?? '') || !isAbsolute(manifest ?? '') || !HASH.test(base ?? '')) throw new Error('absolute --root/--manifest and full 40-character --base commit are required');
  const canonical = await realpath(root);
  if (canonical !== resolve(root) || !(await lstat(canonical)).isDirectory()) throw new Error('root must be a canonical directory without symlinks');
  const gitPath = await resolveExecutable('git', probeEnvironment(), canonical);
  if (!gitPath) throw new Error('Git is unavailable outside the target repository');
  const before = await snapshot(canonical, manifest, base, gitPath);
  const sourceConfig = parseJSON(await readBounded(join(SOURCE_ROOT, '.plates/plates.json')));
  const source = before.repo === sourceConfig.repo && before.config.plates === 'self';
  const capability = await capabilities({ root: canonical, engine: before.pkg.engines?.node, source, packageBytes: before.packageBytes });
  const review = await reviewAvailability(canonical, before, reviewInput, gitPath);
  await afterSnapshot();
  const after = await snapshot(canonical, manifest, base, gitPath);
  const selection = selectValidation(before.changes, { source });
  const problems = [...capability.issues];
  if (before.inputDigest !== after.inputDigest) problems.push('inputs-changed-during-inspection');
  if (before.submodules) problems.push('submodule-worktree-inspection-unavailable');
  if (before.files.some(file => file.state === 'unsupported-file-kind')) problems.push('unsupported-changed-file-kind');
  if (problems.length) { selection.mode = 'broad'; selection.reasons.push(...problems); }
  return {
    schema: 1, authority: 'feedback-only', observedAt: new Date().toISOString(), status: problems.length ? 'blocked' : 'ready', root: canonical, repo: before.repo, base, head: before.head, dirty: before.dirty, inputDigest: before.inputDigest, stableInputs: before.inputDigest === after.inputDigest,
    changes: before.changes, selection, capabilities: capability, review,
    required: { gate: before.gate, typecheck: before.pkg.scripts?.typecheck ? 'npm run typecheck' : null, mayOmit: false },
    limitations: ['This read-only plan never executes commands from repository configuration or grants review/reuse authority.', 'Only explicit source families have focused mappings; consumer mapping is unavailable.', 'Ignored files and external environment changes are not a complete dependency graph; the full configured gate remains mandatory.', 'Re-inspect immediately after reconnect or any runtime, tool, source, configuration or review-input change.'],
  };
}

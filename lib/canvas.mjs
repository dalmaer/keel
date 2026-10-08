// CLI boundary for the optional project canvas. Modules load only after flags
// validate, so a typo cannot accidentally collect sources or contact a home.
import { createHash } from 'node:crypto';
import { lstat, readFile, open, realpath } from 'node:fs/promises';
import { resolve, parse, join } from 'node:path';

const usage = message => Object.assign(new Error(message), { exitCode: 2 });
const forms = {
  snapshot: { values: ['output', 'artifact', 'history', 'window-days'], repeat: ['artifact', 'history'], flags: ['github'] },
  render: { values: ['snapshot', 'output'], flags: [] },
  connect: { values: ['canvas', 'title', 'space', 'home', 'audience'], flags: ['create', 'yes'] },
  sync: { values: ['snapshot'], flags: ['github', 'dry-run', 'yes'] },
  night: { values: ['report'], flags: ['yes'] },
  status: { values: [], flags: [] },
  disconnect: { values: [], flags: ['yes'] },
  capture: { values: ['record', 'session', 'since'], flags: ['yes'] },
};

export function parseCanvasArgs(operation, args) {
  const form = forms[operation];
  if (!form) throw usage('canvas needs snapshot, render, connect, sync, status, disconnect or night');
  const options = {}, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], key = arg.slice(2);
    if (!arg.startsWith('--') || ![...form.values, ...form.flags, 'json'].includes(key)) throw usage(`unexpected argument: ${arg}`);
    if (seen.has(key) && !form.repeat?.includes(key)) throw usage(`duplicate flag: ${arg}`);
    seen.add(key);
    if (form.values.includes(key)) {
      const value = args[++i];
      if (!value || value.startsWith('-') || value.includes('\0')) throw usage(`${arg} needs a value`);
      if (form.repeat?.includes(key)) (options[key] ??= []).push(value);
      else options[key] = value;
    } else options[key] = true;
  }
  if (options['window-days'] !== undefined) {
    const days = Number(options['window-days']);
    if (!/^[1-9][0-9]*$/.test(options['window-days']) || !Number.isSafeInteger(days) || !Number.isFinite(new Date(Date.now() - days * 86400000).getTime())) throw usage('--window-days needs a positive integer within the supported date range');
    options.windowDays = days;
    delete options['window-days'];
  }
  if (operation === 'render' && (!options.snapshot || !options.output)) throw usage('canvas render needs --snapshot <file> and --output <dir>');
  if (operation === 'night' && !options.report) throw usage('canvas night needs --report <file>');
  if (operation === 'capture' && !options.record) throw usage('retro capture needs --record <file>');
  if (operation === 'connect') {
    if (Boolean(options.create) === Boolean(options.canvas)) throw usage('canvas connect needs exactly one of --create or --canvas <address>');
    if (!options.audience?.trim()) throw usage('canvas connect needs --audience <description>');
    if (options.create && (!options.space || !options.home)) throw usage('--create needs --space <id> and --home <origin>');
    if (options.create && !options.title) throw usage('--create needs --title <title>');
    if (options.canvas && (options.title || options.space)) throw usage('--title and --space require --create');
  }
  if (options.yes && options['dry-run']) throw usage('--yes and --dry-run cannot be combined');
  if (options.snapshot && options.github) throw usage('--snapshot and --github cannot be combined');
  delete options.json;
  if (options['dry-run']) { options.dryRun = true; delete options['dry-run']; }
  return options;
}

// Resolve explicit user paths, refusing symlinks at every existing component.
// Outputs never replace an existing file; callers choose a fresh artifact path.
export async function safeCanvasPath(cwd, value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw usage('invalid canvas path');
  const path = resolve(cwd, value), base = parse(path).root;
  let current = base;
  for (const part of path.slice(base.length).split('/').filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw usage(`canvas path contains a symlink: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return path;
}

async function sourceInputs(root, paths = []) {
  const inputs = [];
  for (const path of paths) {
    if (path.startsWith('/') || path.startsWith('~') || /[\\:#\x00-\x1f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw usage('artifact/history inputs must be repository-relative JSON paths without traversal');
    }
    const target = await safeCanvasPath(root, path);
    try {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw usage('artifact/history input must be a regular JSON file no larger than 4 MiB');
      inputs.push(JSON.parse(await readFile(target, 'utf8')));
    } catch (error) {
      if (error.exitCode === 2) throw error;
      throw usage(`cannot read artifact/history JSON: ${path}`);
    }
  }
  return inputs;
}

async function safeState(root) {
  root = await realpath(root);
  for (const path of ['.keel/keel.json', '.keel/canvas/manifest.json', '.keel/canvas/sync.lock']) await safeCanvasPath(root, path);
  return root;
}

function result(operation, data, exitCode = 0) {
  const payload = { schema: 1, operation, changes: [], coverage: [], warnings: [], ...data, exitCode };
  return { data: payload, text: `${operation}: ${payload.error ?? payload.output ?? (exitCode ? 'attention needed' : 'ok')}`, exitCode };
}

async function readSnapshot(path) {
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw usage(`cannot read snapshot: ${error.message}`); }
  if (value?.schema !== 1 || !Array.isArray(value.entities) || !Array.isArray(value.coverage)) throw usage('unsupported or invalid canvas snapshot (expected schema 1)');
  return value;
}

export async function canvas({ args, root, cwd = root, env = process.env, now }) {
  const operation = args[0];
  try {
    if (operation === 'capture') throw usage('use keel retro capture --record <file>');
    const options = parseCanvasArgs(operation, args.slice(1));
    // macOS /tmp is itself an OS symlink; canonicalize the working directory,
    // then still refuse symlinks in paths supplied by the caller.
    cwd = await realpath(cwd);
    root = await safeState(root);
    if (operation === 'snapshot') {
      const output = options.output && await safeCanvasPath(cwd, options.output);
      if (output) {
        try { await lstat(output); throw usage('snapshot output already exists; choose a new file'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const artifacts = await sourceInputs(root, options.artifact);
      const history = await sourceInputs(root, options.history);
      const { snapshot } = await import('./canvas-snapshot.mjs');
      const data = await snapshot({ root, github: Boolean(options.github), now, env, artifacts, history, windowDays: options.windowDays });
      if (output) {
        const handle = await open(output, 'wx');
        try { await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`); } finally { await handle.close(); }
      }
      return result(operation, { ...data, ...(output ? { output } : {}) });
    }
    if (operation === 'render') {
      const input = await safeCanvasPath(cwd, options.snapshot), output = await safeCanvasPath(cwd, options.output);
      const snapshot = await readSnapshot(input);
      const { render } = await import('./canvas-render.mjs');
      const rendered = await render({ snapshot, output });
      const hash = value => createHash('sha256').update(value).digest('hex');
      return result(operation, {
        coverage: snapshot.coverage, warnings: snapshot.warnings ?? [], complete: rendered.manifest.complete, output,
        files: { markdown: join(output, 'pulse.md'), html: join(output, 'pulse.html'), manifest: join(output, 'manifest.json') },
        hashes: { markdown: hash(rendered.markdown), html: hash(rendered.html), manifest: hash(`${JSON.stringify(rendered.manifest, null, 2)}\n`) },
        cardCount: rendered.cards.length, groupCount: rendered.manifest.groups.length,
      });
    }
    if (operation === 'night') {
      const report = await safeCanvasPath(cwd, options.report);
      return await (await import('./canvas-night.mjs')).night({ root, report, yes: Boolean(options.yes), env, sync });
    }
    if (options.snapshot) options.snapshot = await readSnapshot(await safeCanvasPath(cwd, options.snapshot));
    if (operation === 'sync') return await sync({ root, env, ...options });
    const adapter = await import('./canvas-sync.mjs');
    const transport = adapter.createIsocanTransport({ cwd: root, env, executable: env.KEEL_ISOCAN || 'isocan' });
    const method = { connect: 'canvasConnect', status: 'canvasStatus', disconnect: 'canvasDisconnect' }[operation];
    return await adapter[method]({ root, ...options, spaceId: options.space }, { transport });
  } catch (error) {
    return result(operation ?? 'canvas', { error: String(error.message ?? error) }, error.exitCode ?? 1);
  }
}

export async function capture({ args, root, cwd = root, env = process.env }) {
  try {
    const options = parseCanvasArgs('capture', args);
    root = await safeState(root);
    options.record = await safeCanvasPath(await realpath(cwd), options.record);
    return await (await import('./canvas-retro.mjs')).capture({ root, env, ...options });
  } catch (error) {
    return result('retro capture', { error: String(error.message ?? error) }, error.exitCode ?? 1);
  }
}


/** Shared by the CLI and night. The adapter owns history, stable publication
 * timestamps, rendering, planning and receipts; do not precollect around it. */
export async function sync({ root, snapshot, github = false, yes = false, dryRun = false, env = process.env }) {
  root = await safeState(root);
  return (await import('./canvas-sync.mjs')).sync({ root, snapshot, github, yes, dryRun, env });
}

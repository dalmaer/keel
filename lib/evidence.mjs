import { historicalFence, normalizeFences } from './names.mjs';
// Only explicit measurement fences are executable; Markdown is never a program.
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { planningConfig } from '../practices/night/files/scripts/plates/planning-config.mjs';
import { parsePhase } from '../practices/phases/files/scripts/roadmap.mjs';

export const LIMITS = Object.freeze({ timeoutMs: 10_000, outputBytes: 65_536 });
const fail = message => { throw Object.assign(new Error(message), { exitCode: 2 }); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const inside = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`); };

async function contained(root, ref, directory = false) {
  if (typeof ref !== 'string' || !ref || ref.includes('\0') || ref.includes('\\') || isAbsolute(ref)
      || ref.split('/').includes('..')) fail(`unsafe repository-relative path: ${ref}`);
  const path = await realpath(resolve(root, ref));
  if (!inside(root, path)) fail(`path escapes repository: ${ref}`);
  const info = await stat(path);
  if (directory ? !info.isDirectory() : !info.isFile()) fail(`expected ${directory ? 'directory' : 'file'}: ${ref}`);
  return path;
}

// Track other fences too: an example nested inside a larger Markdown fence
// must not accidentally become permission to run a program.
function fences(text, source) {
  const records = [], declarations = [];
  let open = null, body = [], comment = false;
  for (const line of text.split(/\r?\n/)) {
    if (!open) {
      const m = !comment && /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (m) { open = { char: m[1][0], size: m[1].length, type: m[2].trim(), measurement: historicalFence(m[2].trim())?.id === 'fence:keel-measurements' }; body = []; }
      else {
        // Comments hide fence delimiters, but comment markers inside any real
        // fence are literal content (including argv JSON), never parser state.
        let at = 0;
        while (at < line.length) {
          if (comment) {
            const end = line.indexOf('-->', at);
            if (end < 0) break;
            comment = false;
            at = end + 3;
          } else if (line[at] === '\\') {
            at += 2;
          } else if (line[at] === '`') {
            // Matched inline code spans protect literal comment markers too.
            // An unmatched backtick run is prose and cannot hide a comment.
            const ticks = /^`+/.exec(line.slice(at))[0].length;
            at += ticks;
            for (const close of line.slice(at).matchAll(/`+/g)) {
              if (close[0].length === ticks) { at += close.index + ticks; break; }
            }
          } else if (line.startsWith('<!--', at)) {
            comment = true;
            at += 4;
          } else at++;
        }
      }
    } else if (new RegExp(`^ {0,3}${open.char}{${open.size},}\\s*$`).test(line)) {
      if (open.measurement) {
        declarations.push({ type: open.type });
        normalizeFences(declarations);
        let values;
        try { values = JSON.parse(body.join('\n')); } catch { fail(`${source}: invalid plates-measurements JSON`); }
        if (!Array.isArray(values)) fail(`${source}: plates-measurements must be an array`);
        records.push(...values);
      }
      open = null;
    } else body.push(line);
  }
  if (open?.measurement) fail(`${source}: unclosed plates-measurements fence`);
  return records;
}

async function measurements(root, phase) {
  const config = JSON.parse(await readFile(await contained(root, '.plates/plates.json'), 'utf8'));
  const { source } = planningConfig(config);
  if (!Array.isArray(config.practices) || !config.practices.length
      || config.practices.some(name => typeof name !== 'string' || !name.trim())) {
    fail('.plates/plates.json: practices must be a nonempty array of practice names');
  }
  if (config.local !== undefined && (config.local === null || typeof config.local !== 'object' || Array.isArray(config.local))) {
    fail('.plates/plates.json: local must be an object');
  }
  if (source !== 'files' || (config.phases?.shape ?? 'files') !== 'files'
      || (Object.hasOwn(config.local ?? {}, 'phases') && !config.practices.includes('phases'))) {
    fail('evidence rederive supports file phases only; the selected planning source or shape is unsupported');
  }
  if (!/^\d+$/.test(String(phase)) || !Number.isSafeInteger(Number(phase))) fail('phase must be a nonnegative integer');
  const dir = await contained(root, 'docs/phases', true);
  // Match collect's candidates; the shared parser owns filename validity.
  const names = (await readdir(dir)).filter(n => n.endsWith('.md') && n !== 'README.md');
  const ids = new Set();
  for (const name of names) {
    const prefix = /^(\d+)-/.exec(name);
    if (!prefix) fail(`${name}: use NN-name.md`);
    const id = Number(prefix[1]);
    if (ids.has(id)) fail(`duplicate phase id: ${id}`);
    ids.add(id);
  }
  const name = names.find(n => Number(n.split('-')[0]) === Number(phase));
  if (!name) fail(`no phase ${phase}`);
  const phaseRef = `docs/phases/${name}`;
  const raw = await readFile(await contained(root, phaseRef), 'utf8');
  const parsed = parsePhase(name, raw);
  const refs = [phaseRef, ...parsed.evidence.map(ref => `docs/${ref}`)];
  const seen = new Set(), records = [];
  for (const ref of refs) {
    const text = ref === phaseRef ? raw : await readFile(await contained(root, ref), 'utf8');
    for (const record of fences(text, ref)) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`${ref}: invalid measurement record`);
      const { id, argv, cwd, value, unit, date: measured, jsonField } = record;
      if (Object.keys(record).some(k => !['id', 'argv', 'cwd', 'value', 'unit', 'date', 'jsonField'].includes(k))) fail(`${ref}: unknown measurement field`);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) fail(`${ref}: invalid measurement id`);
      if (seen.has(id)) fail(`duplicate measurement id: ${id}`);
      seen.add(id);
      if (!Array.isArray(argv) || !argv.length || argv.some(a => typeof a !== 'string' || a.includes('\0')) || !argv[0].trim()) fail(`${id}: argv must be a nonempty argument array`);
      if (!finite(value) || typeof unit !== 'string' || !unit.trim() || !date(measured)) fail(`${id}: requires finite value, unit and valid calendar date`);
      if (jsonField !== undefined && (typeof jsonField !== 'string' || !jsonField)) fail(`${id}: jsonField must name a top-level property`);
      const at = await contained(root, cwd, true);
      records.push({ id, source: ref, argv, cwd, old: { value, unit, date: measured }, ...(jsonField === undefined ? {} : { jsonField }), at });
    }
  }
  if (!records.length) fail(`phase ${phase}: no explicit plates-measurements records`);
  return records;
}

// The stalls runner only runs tests and does not cap output. This narrow runner
// caps both pipes and the time to completion, including inherited descendant pipes.
export function runMeasurement(argv, cwd, { timeoutMs = LIMITS.timeoutMs, outputBytes = LIMITS.outputBytes, env = process.env } = {}) {
  return new Promise(resolveRun => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let bytes = 0, error = null, done = false, exitCode = null, signal = null;
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ } } };
    const onSignal = sig => { kill(); finish(); if (!process.listenerCount(sig)) process.kill(process.pid, sig); };
    const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(sig => [sig, () => onSignal(sig)]);
    const finish = () => {
      if (done) return;
      done = true;
      kill(); clearTimeout(timer);
      process.off('exit', kill);
      for (const [sig, fn] of handlers) process.off(sig, fn);
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      resolveRun({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode, signal, error });
    };
    const timer = setTimeout(() => { error = 'timeout'; finish(); }, timeoutMs);
    process.on('exit', kill);
    for (const [sig, fn] of handlers) process.on(sig, fn);
    const collect = stream => chunk => {
      const remaining = Math.max(0, outputBytes - bytes);
      bytes += chunk.length;
      (stream === 'stdout' ? stdout : stderr).push(chunk.subarray(0, remaining));
      if (bytes > outputBytes) { error = 'output-limit'; finish(); }
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', e => { error = `spawn: ${e.message}`; finish(); });
    // A normally exiting parent may leave children holding the pipes forever.
    child.on('exit', (code, sig) => { exitCode = code; signal = sig; if (!done) kill(); });
    child.on('close', () => finish());
  });
}

function numeric(stdout, field) {
  if (field !== undefined) {
    try { const object = JSON.parse(stdout); return object && Object.hasOwn(object, field) && finite(object[field]) ? object[field] : null; } catch { return null; }
  }
  const text = stdout.trim();
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}

export async function rederive({ root, phase, yes = false }) {
  let records;
  try { root = await realpath(root); records = await measurements(root, phase); }
  catch (error) { fail(error.message); }
  if (yes && process.platform === 'win32') fail('evidence execution requires POSIX process groups');
  const receipts = [];
  for (const { at, ...record } of records) {
    let fresh = null;
    if (yes) {
      const result = await runMeasurement(record.argv, at);
      const error = result.error ?? (result.exitCode !== 0 ? `command failed (${result.exitCode ?? result.signal ?? 'unknown'})` : null);
      const value = error ? null : numeric(result.stdout, record.jsonField);
      fresh = { value, unit: record.old.unit, date: new Date().toISOString().slice(0, 10), exitCode: result.exitCode,
        signal: result.signal, error: error ?? (value === null ? 'output is not a finite numeric measurement' : null), stderr: result.stderr };
    }
    receipts.push({ ...record, new: fresh });
  }
  const ok = receipts.every(r => !r.new?.error);
  const data = { phase: Number(phase), mode: yes ? 'executed' : 'preview', limits: LIMITS, ok, records: receipts };
  const text = [yes ? `Phase ${phase}: rederived measurements` : `Phase ${phase}: preview; --yes runs these recorded programs`,
    ...receipts.map(r => `${r.id}: ${r.old.value} ${r.old.unit} (${r.old.date}) → ${r.new ? r.new.error ? `unavailable: ${r.new.error}` : `${r.new.value} ${r.new.unit} (${r.new.date})` : `${JSON.stringify(r.argv)} in ${r.cwd}`}`)].join('\n');
  return { data, text, exitCode: ok ? 0 : 1 };
}

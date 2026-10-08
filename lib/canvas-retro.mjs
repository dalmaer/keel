// Explicit authored retro capture. The existing worksheet remains read-only.
// Only this schema and the six aggregate signals may cross into a canvas.
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { AREAS, SIGNALS, retro } from './retro.mjs';

const exec = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{7,64}$/i;
const fail = message => { throw new Error(message); };
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  // Do not repeat unknown names or rejected values: they may themselves be private.
  if (Object.keys(value).some(k => !keys.includes(k))) fail(`${label} contains unsupported fields`);
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) fail(`${label} must be a bounded nonempty summary`);
  const withoutURLs = value.replace(/https:\/\/[^\s)\]]+/g, 'URL');
  for (const match of value.matchAll(/https:\/\/[^\s)\]]+/g)) {
    let url;
    try { url = new URL(match[0]); } catch { fail(`${label} contains an invalid URL`); }
    if (url.username || url.password || url.search) fail(`${label} must exclude credentials and query strings`);
  }
  if (/[\x00-\x1f\x7f`]|(?<![\w])(?:~?\/|[A-Za-z]:[\\/])|\$\(|&&|-----BEGIN|\b(?:Bearer\s+|(?:password|secret|token|api[_-]?key)\s*[:=])/i.test(withoutURLs)) {
    fail(`${label} must exclude paths, command text and credentials`);
  }
  return value;
}
function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)) fail(`${label} must be a valid UTC date`);
}
function localPath(value) {
  return typeof value === 'string' && value.length > 0 && !isAbsolute(value) && !/[\\:\x00-\x1f]/.test(value)
    && !value.startsWith('~') && value.split('/').every(p => p && p !== '.' && p !== '..');
}
function references(values, label) {
  if (!Array.isArray(values) || values.length > 20) fail(`${label} must be a bounded list of references`);
  for (const value of values) {
    text(value, label);
    if (value.startsWith('https://')) {
      let url;
      try { url = new URL(value); } catch { fail(`${label} has an invalid URL`); }
      if (url.username || url.password || url.search) fail(`${label} must exclude credentials and query strings`);
    } else if (!localPath(value)) fail(`${label} must use repository-relative paths or HTTPS URLs`);
  }
}

/** Input schema 1: {id,date,source:{revision,since?},provider,coverage,
 * summary:{navigation,checks,standards,agents,economy,noop,gaps},candidates:[] }.
 * A candidate is {id,type,action,decision:{status,actor?,date?,reason?},
 * links:[],evidence:[]}. Picked/declined require all decision attribution.
 * Coverage is manual, unknown or ok (ok requires explicit supported session).
 * Counts are derived, never accepted from an authored input file.
 */
function validate(record) {
  object(record, ['schema', 'id', 'date', 'source', 'provider', 'coverage', 'summary', 'candidates'], 'record');
  if (record.schema !== 1) fail('record schema must be 1');
  if (typeof record.id !== 'string' || !UUID.test(record.id)) fail('record id must be a UUID');
  date(record.date, 'record date');
  object(record.source, ['revision', 'since'], 'source');
  if (typeof record.source.revision !== 'string' || !SHA.test(record.source.revision)
    || (record.source.since !== undefined && (typeof record.source.since !== 'string' || !SHA.test(record.source.since)))) fail('source must name commit hashes');
  if (typeof record.provider !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(record.provider)) fail('provider must be a provider name');
  if (!['manual', 'unknown', 'ok'].includes(record.coverage)) fail('coverage must be manual, unknown or ok');
  object(record.summary, AREAS.map(a => a.key), 'summary');
  for (const { key } of AREAS) text(record.summary[key], 'seven-area summary');
  if (!Array.isArray(record.candidates) || record.candidates.length > 5) fail('at most five candidates are allowed');
  const ids = new Set();
  for (const candidate of record.candidates) {
    object(candidate, ['id', 'type', 'action', 'decision', 'links', 'evidence'], 'candidate');
    if (typeof candidate.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(candidate.id) || ids.has(candidate.id)) fail('candidate ids must be unique safe identifiers');
    ids.add(candidate.id);
    if (!['check', 'skill', 'lesson'].includes(candidate.type)) fail('candidate type must be check, skill or lesson');
    text(candidate.action, 'candidate action');
    object(candidate.decision, ['status', 'actor', 'date', 'reason'], 'decision');
    const d = candidate.decision;
    if (!['pending', 'picked', 'declined'].includes(d.status)) fail('decision must be pending, picked or declined');
    if (d.status !== 'pending' || ['actor', 'date', 'reason'].some(k => d[k] !== undefined)) {
      text(d.actor, 'decision actor'); date(d.date, 'decision date'); text(d.reason, 'decision reason');
    }
    references(candidate.links, 'candidate links');
    references(candidate.evidence, 'candidate evidence');
  }
}

// Reject symlink components even when they currently point inside the repo.
async function safeTarget(root, path) {
  if (!localPath(path) || path.split('/').some(p => ['.git', '.keel'].includes(p))) fail('retros directory must be a repository-relative authored directory');
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    const info = await lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (info?.isSymbolicLink()) fail('retros path must not contain symlinks');
  }
  return current;
}
async function commit(root, ref, env) {
  try {
    return (await exec('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { env, timeout: 10_000 })).stdout.trim();
  } catch { fail('source commit is unavailable'); }
}
function result(status, exitCode, extra = {}) {
  const data = { schema: 1, operation: 'retro.capture', status, changes: [], coverage: [], warnings: [], ...extra, exitCode };
  const text = `retro capture: ${status}${data.error ? ` — ${data.error}` : ''}\n${data.record ? JSON.stringify(data.record, null, 2) : ''}`.trimEnd();
  return { data, text, exitCode };
}

export async function capture({ root, record, session, since, yes = false, env = process.env }) {
  try {
    if (typeof yes !== 'boolean') fail('yes must be an explicit boolean');
    root = await realpath(root);
    if (typeof record !== 'string' || !record) fail('--record must name an authored JSON file');
    const raw = await readFile(resolve(root, record), 'utf8');
    if (raw.length > 64 * 1024) fail('record exceeds 64 KiB');
    let authored, config;
    try { authored = JSON.parse(raw); } catch { fail('record must be valid JSON'); }
    validate(authored);
    try { config = JSON.parse(await readFile(join(root, '.keel/keel.json'), 'utf8')); }
    catch { fail('root must contain a valid Keel project config'); }
    // Match the snapshot collector's configured authored-record directory.
    const dir = config.retros?.dir ?? (typeof config.retros === 'string' ? config.retros : 'docs/retros');
    const path = `${dir}/${authored.id}.json`;
    let target = await safeTarget(root, path);
    if (since !== undefined && (typeof since !== 'string' || !SHA.test(since))) fail('--since must be a commit hash');
    if (session !== undefined && (typeof session !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(session))) fail('--session must be a local session identifier');
    const source = { revision: await commit(root, authored.source.revision, env) };
    if (authored.source.since) source.since = await commit(root, authored.source.since, env);
    if (since !== undefined) {
      const requested = await commit(root, since, env);
      if (source.since && source.since !== requested) fail('--since disagrees with the authored source range');
      source.since = requested;
    }
    const saved = { ...authored, source, counts: null };
    const warnings = [];
    if (authored.coverage !== 'manual') {
      saved.coverage = 'unknown';
      if (!['claude', 'claude-code'].includes(authored.provider)) warnings.push('Transcript counts unsupported for this provider.');
      else if (!session) warnings.push('No explicit session supplied; transcript counts unknown.');
      else {
        if (source.revision !== await commit(root, 'HEAD', env)) fail('transcript counts require source revision to match HEAD');
        let worksheet;
        try { worksheet = await retro({ root, session, since: source.since, env }); }
        catch { warnings.push('Explicit session counts unavailable.'); }
        if (worksheet?.data.counts) {
          saved.counts = Object.fromEntries(Object.keys(SIGNALS).map(k => [k, worksheet.data.counts[k]]));
          saved.coverage = 'ok';
        } else if (worksheet) warnings.push('No transcript counts for this source range.');
      }
    }
    const extra = { record: saved, path, coverage: [{ source: 'retro-counts', status: saved.coverage }], warnings };
    const existing = await readFile(target, 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (existing !== null) {
      let same = false;
      try { same = isDeepStrictEqual(JSON.parse(existing), saved); } catch { /* A malformed record is still owned. */ }
      return result(same ? 'unchanged' : 'conflict', same ? 0 : 1, extra);
    }
    if (!yes) return result('preview', 3, { ...extra, changes: [{ action: 'create', path }] });
    await mkdir(resolve(root, dir), { recursive: true });
    target = await safeTarget(root, path);
    try { await writeFile(target, `${JSON.stringify(saved, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code === 'EEXIST') return result('conflict', 1, extra); throw e; }
    return result('captured', 0, { ...extra, changes: [{ action: 'create', path }] });
  } catch (error) {
    // Filesystem/parse diagnostics contain private paths or input bytes.
    return result('invalid', 2, { error: error.code ? 'Cannot read or persist the retro record.' : error.message });
  }
}

// Local timing summaries. Session records are read-only; never return transcript text.
import { readFile, readdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path, { join, resolve, isAbsolute } from 'node:path';
import { readRuns, readRetention, usualTimes, busyCoverage, busyState, failureMemory, laneOf, machineClass, shellWords } from '../practices/night/files/scripts/keel/test-ledger.mjs';

const WEEK = 7 * 86400_000;
const median = xs => { const s = xs.sort((a, b) => a - b), h = s.length >> 1; return s.length ? s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 : null; };
const monday = date => { const d = new Date(date); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.getTime(); };

/** Weekly medians never combine runner/config/machine lanes, or test runs with gates. */
export function timeSummary(runs, { weeks = 8, now = Date.now(), skipped = 0 } = {}) {
  const first = monday(now) - (weeks - 1) * WEEK;
  const windowRuns = runs.filter(r => Date.parse(r.date) >= first && Date.parse(r.date) <= now);
  const excludedGates = windowRuns.filter(r => r.kind === 'gate' && r.dir !== '.').map(r => ({ id: r.id ?? null, date: r.date, dir: r.dir ?? null, commandHash: r.commandHash ?? null, ms: r.ms ?? null, reason: 'not an identified root-project gate' }));
  const selected = windowRuns.filter(r => r.kind !== 'gate' || r.dir === '.').sort((a, b) => a.date.localeCompare(b.date));
  const weeksOut = Array.from({ length: weeks }, (_, i) => {
    const start = first + i * WEEK, end = start + WEEK;
    const inWeek = selected.filter(r => Date.parse(r.date) >= start && Date.parse(r.date) < end);
    const groups = new Map();
    for (const r of inWeek) {
      const k = JSON.stringify([r.kind === 'gate' ? 'gate' : 'tests', laneOf(r), machineClass(r.machine), r.commandHash ?? null]);
      const g = groups.get(k) ?? { kind: r.kind === 'gate' ? 'gate' : 'tests', lane: laneOf(r), machine: machineClass(r.machine), commandHash: r.commandHash ?? null, runs: [] };
      g.runs.push(r); groups.set(k, g);
    }
    return { week: new Date(start).toISOString().slice(0, 10), runs: inWeek.length, coverage: busyCoverage(inWeek), lanes: [...groups.values()].map(({ runs: rs, ...g }) => {
      const tests = new Map();
      for (const r of rs.filter(r => busyState(r) !== 'busy')) for (const t of r.tests ?? []) {
        if (t.outcome !== 'pass' || !Number.isFinite(t.ms) || t.ms < 0) continue;
        const k = JSON.stringify([t.file, t.name, t.describe === true]);
        const v = tests.get(k) ?? { file: t.file, name: t.name, describe: t.describe === true, ms: [] };
        v.ms.push(t.ms); tests.set(k, v);
      }
      return { ...g, runs: rs.length, ...(g.kind === 'gate' ? { gateSources: [...new Set(rs.map(r => r.gateSource).filter(s => typeof s === 'string' && s))], successful: rs.filter(r => r.status === 0).length, unsuccessful: rs.filter(r => r.status !== 0).length } : {}), coverage: busyCoverage(rs), gateMs: g.kind === 'gate' ? median(rs.filter(r => r.status === 0 && Number.isFinite(r.ms) && r.ms >= 0).map(r => r.ms)) : null,
        tests: [...tests.values()].map(({ ms, ...t }) => ({ ...t, median: median(ms), passes: ms.length })) };
    }) };
  });
  return { weeks: weeksOut, usual: usualTimes(runs.filter(r => r.kind !== 'gate' && Date.parse(r.date) <= now).sort((a, b) => a.date.localeCompare(b.date))), failures: selected.flatMap(r => (r.tests ?? []).filter(t => t.outcome === 'fail').map(t => ({ file: t.file, name: t.name, error: t.error ?? null, date: r.date, runner: r.runner ?? 'node', dir: r.dir ?? '.', config: r.config ?? null, machine: machineClass(r.machine), busy: r.busy ?? null }))),
    diagnosis: failureMemory(selected), coverage: { ...busyCoverage(selected), runs: selected.length, skipped, oldest: selected[0]?.date ?? null,
      gateScope: 'root project only (dir .); subproject and unidentified gate records excluded, preserved on disk', excludedGates, gateRuns: selected.filter(r => r.kind === 'gate').length, missingWeeks: weeksOut.filter(w => !w.runs).map(w => w.week),
      note: 'Root-project gates only; subproject or unidentified gate records are excluded and retained on disk. Retained observations only; retention can remove runs and weeks. Gate medians use successful runs only; weeks without a successful timed gate are unavailable, never inferred from test durations.' } };
}

/** Isolate one leading invocation without evaluating shell syntax or retaining its tail. */
function leadingInvocation(command) {
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") { if (c === "'") quote = null; continue; }
    if (c === '\\') { if (++i >= command.length) return null; continue; }
    if (c === '$' || c === '`') return null; // expansions could change arguments
    if (quote === '"') { if (c === '"') quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '<') return null; // input/process substitution is unsupported
    if (c === '>' || (c === '&' && command[i + 1] === '>')) {
      if (c === '&') return null; // keep the supported redirection forms small
      const before = command.slice(0, i), fd = /(?:^|\s)\d+$/.exec(before);
      const cut = fd ? fd.index : i;
      let tail = command.slice(cut).trimStart();
      // Only trailing output redirects, optionally followed by an ignored
      // pipeline/list. Arguments after a redirect might change project scope.
      for (;;) {
        const redirect = /^(?:\d*)?>{1,2}(?:&(?:\d+|-)|\s*(?:"[^"$`]*"|'[^']*'|[^\s|;&<>$`]+))/.exec(tail);
        if (!redirect) return null;
        tail = tail.slice(redirect[0].length).trimStart();
        if (!tail || /^[|;&\r\n]/.test(tail)) return { direct: command.slice(0, cut), ignoredTail: true };
      }
    }
    if ('|;&\r\n'.includes(c) || (c === '#' && (i === 0 || /\s/.test(command[i - 1])))) return { direct: command.slice(0, i), ignoredTail: true };
  }
  return quote ? null : { direct: command, ignoredTail: false };
}

/** Normalize native separators only; never turn a POSIX literal backslash into a path. */
function localTarget(word, paths) {
  const target = word.split(paths.sep).join('/').replace(/^\.\//, '');
  return !target || paths.isAbsolute(target) || /^[A-Za-z]:/.test(target) || target.includes('\\') || target.split('/').includes('..') ? null : target;
}

/** Bounded shell support: one direct test invocation in the recorded cwd. */
export function testInvocation(command, scripts, paths = path) {
  if (typeof command !== 'string') return { accepted: false, omitted: true };
  const leading = leadingInvocation(command);
  if (!leading) return { accepted: false, omitted: true };
  const { direct, ignoredTail } = leading;
  const words = shellWords(direct), [program, verb] = words;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(program ?? '')) return { accepted: false, omitted: true };
  // These can redirect a runner away from the recorded project even when
  // written after its test verb. Reject rather than infer another cwd.
  if (words.some(w => /^(?:--(?:prefix|cwd|dir|directory|root|project|workspace|workspaces)(?:=|$)|-[Cw])/.test(w))) return { accepted: false, omitted: true };
  if (words.some(w => ['--help', '-h', '--version', '-v', '--list'].includes(w))) return { accepted: false, omitted: false };
  let accepted = false;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
    const script = verb === 'run' ? words[2] : verb;
    accepted = /^(?:test|check)(?::[A-Za-z0-9_-]+)*$/.test(script ?? '') && scripts.has(script);
    if (accepted) {
      // Script arguments may forward runner targets. Unknown grammar is an
      // omission, never evidence that an outside target ran in this project.
      const switches = new Set(['--test-only', '--test-force-exit', '--experimental-test-coverage', '--test-update-snapshots', '--run', '--watch', '--coverage', '--silent', '--passWithNoTests']);
      const valued = new Set(['--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-reporter-destination', '--test-concurrency', '--test-timeout', '--test-shard', '--import', '--require', '-r', '--reporter', '--testNamePattern', '-t', '--config', '-c', '--pool', '--maxWorkers', '--minWorkers']);
      let separator = false;
      for (let i = verb === 'run' ? 3 : 2; i < words.length; i++) {
        const word = words[i], flag = word.split('=', 1)[0];
        if (word === '--') {
          if (separator) return { accepted: false, omitted: true };
          separator = true; continue;
        }
        if (switches.has(word)) continue;
        if (word.startsWith('-')) {
          if (!valued.has(flag)) return { accepted: false, omitted: true };
          const value = word.includes('=') ? word.slice(word.indexOf('=') + 1) : words[++i];
          if (value === undefined || (!word.includes('=') && value.startsWith('-'))) return { accepted: false, omitted: true };
          if (['--config', '-c'].includes(flag)) {
            const config = localTarget(value, paths);
            if (config === null || !/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/.test(config)) return { accepted: false, omitted: true };
          }
          continue;
        }
        const path = localTarget(word, paths);
        if (path === null) return { accepted: false, omitted: true };
        if (!/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.[cm]?[jt]sx?$/.test(path) || path.split('/').includes('..')) return { accepted: false, omitted: true };
      }
      // Forwarded inputs do not establish which tests the script executes.
      return { accepted: true, omitted: false, ignoredTail, identities: [{ kind: 'script', id: script }] };
    }
  } else if (program === 'node') {
    // Deliberately support only `node --test ...`: after a script name,
    // --test belongs to that script, not Node. Other flag orderings are omitted.
    if (verb !== '--test') return { accepted: false, omitted: words.includes('--test') };
    const switches = new Set(['--test-only', '--test-force-exit', '--experimental-test-coverage', '--test-update-snapshots']);
    const valued = new Set(['--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-reporter-destination', '--test-concurrency', '--test-timeout', '--test-shard', '--import', '--require', '-r']);
    const targets = [];
    let positional = false;
    for (let i = 2; i < words.length; i++) {
      const word = words[i], flag = word.split('=', 1)[0];
      if (!positional && word === '--') { positional = true; continue; }
      if (!positional && word.startsWith('-')) {
        if (switches.has(word)) continue;
        if (!valued.has(flag)) return { accepted: false, omitted: true };
        if (!word.includes('=') && (words[++i] === undefined || words[i].startsWith('-'))) return { accepted: false, omitted: true };
        continue;
      }
      const path = localTarget(word, paths);
      if (path === null) return { accepted: false, omitted: true };
      // Only literal, relative file targets. Absolute paths, parent traversal,
      // directories and globs cannot safely become project test identities.
      if (!/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.[cm]?[jt]sx?$/.test(path) || path.split('/').includes('..')) return { accepted: false, omitted: true };
      targets.push({ kind: 'file', id: path });
    }
    return { accepted: true, omitted: false, ignoredTail, identities: targets.length ? [...new Map(targets.map(t => [t.id, t])).values()] : [{ kind: 'unknown', id: null }] };
  } else if (program === 'vitest' || (program === 'npx' && verb === 'vitest')) {
    // Bounded Vitest grammar: discovery/setup verbs do not run tests. Skip
    // known option values so a test-name filter containing 'list' is not a verb.
    const switches = new Set(['--run', '--watch', '--coverage', '--silent', '--passWithNoTests']);
    const valued = new Set(['--reporter', '--testNamePattern', '-t', '--config', '-c', '--pool', '--maxWorkers', '--minWorkers']);
    const args = words.slice(program === 'npx' ? 2 : 1), targets = new Map();
    let positional = false;
    for (let i = 0; i < args.length; i++) {
      const word = args[i], flag = word.split('=', 1)[0];
      if (word.startsWith('-')) {
        if (switches.has(word)) continue;
        if (!valued.has(flag)) return { accepted: false, omitted: true };
        const value = word.includes('=') ? word.slice(word.indexOf('=') + 1) : args[++i];
        if (value === undefined || (!word.includes('=') && value.startsWith('-'))) return { accepted: false, omitted: true };
        if (['--config', '-c'].includes(flag)) {
          const config = localTarget(value, paths);
          if (config === null || !/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/.test(config)) return { accepted: false, omitted: true };
        }
        continue;
      }
      // Related and benchmark runs execute tests, but their selection semantics
      // are outside this bounded grammar; disclose omissions.
      if (!positional && ['related', 'bench'].includes(word)) return { accepted: false, omitted: true };
      if (!positional && ['list', 'init'].includes(word)) return { accepted: false, omitted: false };
      if (!positional && ['run', 'watch'].includes(word)) { positional = true; continue; }
      positional = true;
      const path = localTarget(word, paths);
      if (path === null) return { accepted: false, omitted: true };
      for (const identity of testIdentities(`vitest ${path}`, scripts)) if (identity.kind === 'file') targets.set(identity.id, identity);
    }
    return { accepted: true, omitted: false, ignoredTail, identities: targets.size ? [...targets.values()] : [{ kind: 'unknown', id: null }] };
  }
  return { accepted, ignoredTail, ...(accepted ? { identities: testIdentities(direct, scripts) } : {}), omitted: program === 'cd' || ['env', 'bash', 'sh', 'zsh'].includes(program) || (['npm', 'pnpm', 'yarn', 'bun', 'npx'].includes(program) && verb?.startsWith('-')) };
}
/** Only safe repo-relative test paths and script names survive command parsing. */
export function testIdentities(command, scripts = new Set(['test', 'check'])) {
  // Complex shell context cannot safely identify a project test. Only the first
  // direct invocation is inspected; following commands, comments and option values are not identities.
  const words = shellWords(command.split(/&&|\|\||[;|#]/, 1)[0]), identities = new Map();
  if (!['node', 'npm', 'pnpm', 'yarn', 'bun', 'vitest', 'npx'].includes(words[0])) return [{ kind: 'unknown', id: null }];
  const add = (kind, id) => identities.set(`${kind}:${id}`, { kind, id });
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if (word.startsWith('-') && !['--', '--test', '--test-only'].includes(word)) { if (!word.includes('=')) i++; continue; }
    const path = word.replace(/^\.\//, '');
    if (/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/.test(path) && !path.split('/').includes('..')
      && /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:tests?|__tests__)\/[^ ]+\.[cm]?[jt]sx?$)/.test(path)) add('file', path);
  }
  // A named test file is more useful than the generic script that launched it.
  if (!identities.size) for (let i = 0; i < words.length; i++) {
    if (!['npm', 'pnpm', 'yarn', 'bun'].includes(words[i])) continue;
    const script = words[i + 1] === 'run' ? words[i + 2] : words[i + 1];
    if (/^(?:test|check)(?::[A-Za-z0-9_-]+)*$/.test(script ?? '') && scripts.has(script)) add('script', script);
  }
  return identities.size ? [...identities.values()] : [{ kind: 'unknown', id: null }];
}
const emptyCounts = () => ({ longTimeout: 0, background: 0, interrupted: 0, workedAround: 0 });

export const TRANSCRIPT_LIMITS = Object.freeze({ maxBytes: 256 * 1024 * 1024, maxRows: 200000, maxRowBytes: 1024 * 1024 });

/** Fixed-size reads; oversized rows are discarded until their newline, never buffered whole. */
async function* transcriptRows(path, budget) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('not a transcript file');
    budget.readFiles++;
    let position = 0, parts = [], length = 0, oversized = false;
    const finish = () => {
      budget.rowsRead++;
      const row = oversized ? null : Buffer.concat(parts, length).toString('utf8');
      if (oversized) budget.oversizedRows++;
      parts = []; length = 0; oversized = false;
      return row;
    };
    while (position < info.size) {
      if (budget.bytesRead >= budget.maxBytes || budget.rowsRead >= budget.maxRows) {
        budget.truncated = true;
        if (length || oversized) budget.truncatedRows++;
        return;
      }
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, budget.maxBytes - budget.bytesRead, info.size - position));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      budget.bytesRead += bytesRead; position += bytesRead;
      let start = 0;
      while (start < bytesRead) {
        if (budget.rowsRead >= budget.maxRows) { budget.truncated = true; return; }
        const newline = buffer.indexOf(10, start);
        const end = newline >= 0 && newline < bytesRead ? newline : bytesRead;
        const size = end - start;
        if (!oversized) {
          if (length + size > budget.maxRowBytes) { oversized = true; parts = []; length = 0; }
          else { parts.push(buffer.subarray(start, end)); length += size; }
        }
        if (end < bytesRead) yield finish();
        start = end + 1;
      }
    }
    if (length || oversized) {
      if (budget.rowsRead >= budget.maxRows) { budget.truncated = true; budget.truncatedRows++; }
      else yield finish();
    }
  } finally { await file.close(); }
}

/** Structured tool status owns interruption; stdout is never searched for keywords. */
function interruptedResult(row, block) {
  if (row.toolUseResult && Object.hasOwn(row.toolUseResult, 'interrupted')) return row.toolUseResult.interrupted === true;
  if (block.is_error !== true) return false;
  const content = typeof block.content === 'string' ? block.content
    : Array.isArray(block.content) && block.content.length === 1 && block.content[0]?.type === 'text' ? block.content[0].text : null;
  if (typeof content !== 'string') return false;
  return /^(?:\[Request interrupted by user(?: for tool use)?\]|(?:Error: )?(?:(?:Request|Tool execution|Command) (?:was )?)?(?:interrupted|cancelled|canceled) by (?:the )?user)[.!]?$/i.test(content.trim());
}

/** Project-relative transcript cwd; injected path rules allow cross-platform checks. */
export function transcriptDir(root, cwd, paths = path) {
  const dir = paths.relative(paths.resolve(root), paths.resolve(cwd)).split(paths.sep).join('/');
  return paths.isAbsolute(dir) || dir.split('/').includes('..') || (dir && !/^[A-Za-z0-9_@./-]+$/.test(dir)) ? null : dir;
}

/** Claude Code JSONL: count tool uses, correlate interrupted results by tool_use_id. */
export async function workedAround({ root, env = process.env, home = homedir(), since = 0, now = Date.now(), limits = TRANSCRIPT_LIMITS } = {}) {
  if (env.CI || env.GITHUB_ACTIONS === 'true') return { available: false, reason: 'disabled in CI', counts: null };
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  let files;
  try { files = (await readdir(dir)).filter(f => f.endsWith('.jsonl')).sort(); }
  catch (e) { return { available: false, reason: e.code === 'ENOENT' ? 'no Claude Code records for this project' : 'Claude Code records unreadable', counts: null }; }
  const uses = new Map(), interrupts = new Set();
  const scripts = new Set(['test', 'check']);
  try { for (const name of Object.keys(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).scripts ?? {})) scripts.add(name); } catch { /* base scripts only */ }
  const budget = { ...TRANSCRIPT_LIMITS, ...limits, bytesRead: 0, rowsRead: 0, oversizedRows: 0, truncatedRows: 0, truncated: false, readFiles: 0, omittedFiles: 0 };
  for (const key of Object.keys(TRANSCRIPT_LIMITS)) if (!Number.isSafeInteger(budget[key]) || budget[key] < 1 || budget[key] > TRANSCRIPT_LIMITS[key]) throw new Error(`invalid transcript limit ${key}`);
  let skipped = 0, validRecords = 0, observedRecords = 0, outOfWindow = 0, commandOmissions = 0, ignoredTails = 0;
  for (const [index, f] of files.entries()) {
    if (budget.bytesRead >= budget.maxBytes || budget.rowsRead >= budget.maxRows) { budget.truncated = true; budget.omittedFiles = files.length - index; break; }
    const path = join(dir, f);
    try {
      for await (const line of transcriptRows(path, budget)) {
        if (line === null) { skipped++; continue; }
        if (!line.trim()) continue;
        let row; try { row = JSON.parse(line); } catch { skipped++; continue; }
        if (!row || !Number.isFinite(Date.parse(row.timestamp)) || !row.message || !(Array.isArray(row.message.content) || typeof row.message.content === 'string')) { skipped++; continue; }
        const cwdKnown = typeof row.cwd === 'string' && isAbsolute(row.cwd);
        if (row.cwd !== undefined && !cwdKnown) { skipped++; continue; }
        const dir = cwdKnown ? transcriptDir(root, row.cwd) : '';
        if (dir === null) { skipped++; continue; }
        validRecords++;
        if (Date.parse(row.timestamp) < since || Date.parse(row.timestamp) > now) { outOfWindow++; continue; }
        observedRecords++;
        for (const block of Array.isArray(row.message?.content) ? row.message.content : []) {
          if (block.type === 'tool_use' && block.name === 'Bash') {
            if (!cwdKnown) { commandOmissions++; skipped++; continue; }
            const invocation = testInvocation(block.input?.command, scripts);
            if (invocation.omitted) { commandOmissions++; skipped++; }
            if (!invocation.accepted) continue;
            if (invocation.ignoredTail) ignoredTails++;
            if (!((typeof block.id === 'string' && block.id) || Number.isSafeInteger(block.id))) { commandOmissions++; continue; }
            uses.set(`${f}:${block.id}`, { date: row.timestamp, longTimeout: Number(block.input?.timeout) >= 120000, background: block.input?.run_in_background === true, identities: (invocation.identities ?? testIdentities(block.input.command, scripts)).map(identity => identity.kind === 'file' ? { ...identity, id: dir ? `${dir}/${identity.id}` : identity.id } : identity.kind === 'script' && dir ? { ...identity, dir } : identity) });
          }
          if (block.type === 'tool_result' && interruptedResult(row, block)) interrupts.add(`${f}:${block.tool_use_id}`);
        }
      }
    } catch { skipped++; }
  }
  const coverage = { state: observedRecords === 0 ? 'unavailable' : skipped || budget.truncated || ignoredTails ? 'partial' : 'observed', ...budget, recognizedTestInvocations: uses.size, validRecords, observedRecords, outOfWindow, commandOmissions, ignoredTails,
    note: 'Project JSONL streamed in filename order; byte/row budgets cover all files, each file read to its opening size. Oversized rows, unreadable inputs, malformed or out-of-project records and unsupported shell commands omitted. Only the first validated invocation counts; output redirection and pipeline/list tails are ignored and counted separately. Identities and counts only.' };
  if (!observedRecords) return { available: false, reason: 'no valid project transcript records observed in the requested window', agent: 'Claude Code', counts: null, identities: null, files: files.length, skipped, coverage };
  const counts = emptyCounts(), identities = new Map(), observations = [];
  const count = (at, use, interrupted) => {
    if (use.longTimeout) at.longTimeout++;
    if (use.background) at.background++;
    if (interrupted) at.interrupted++;
    if (use.longTimeout || use.background || interrupted) at.workedAround++;
  };
  for (const [id, use] of uses) {
    const interrupted = interrupts.has(id);
    count(counts, use, interrupted);
    if (use.longTimeout || use.background || interrupted) for (const identity of use.identities) {
      observations.push({id:createHash('sha256').update(id).digest('hex'),date:use.date,validated:true,identity});
      const key = JSON.stringify(identity);
      const at = identities.get(key) ?? { ...identity, counts: emptyCounts() };
      count(at.counts, use, interrupted); identities.set(key, at);
    }
  }
  return { available: true, scope: '.', observations, agent: 'Claude Code', counts, identities: [...identities.values()], files: files.length, skipped, longTimeoutMs: 120000,
    coverage };
}

export async function keelTime({ root, weeks = 8, env = process.env, home, now = Date.now() }) {
  if (!/^\d+$/.test(String(weeks)) || Number(weeks) < 1 || Number(weeks) > 52) { const e = new Error('--weeks must be a whole number from 1 to 52'); e.exitCode = 2; throw e; }
  weeks = Number(weeks);
  const { runs, skipped } = await readRuns(root, undefined, { gates: true });
  const data = { ...timeSummary(runs, { weeks, now, skipped }), retention:await readRetention(root), workedAround: await workedAround({ root, env, home, since: monday(now) - (weeks - 1) * WEEK, now }) };
  // Bound both row counts and field lengths; JSON retains the complete observations.
  const short = value => { const s = String(value ?? 'unavailable').replace(/[\x00-\x1f\x7f]/g, ' '); return s.length > 240 ? `${s.slice(0, 240)}… [${s.length - 240} characters omitted]` : s; };
  const duration = ms => Number.isFinite(ms) && ms >= 0 ? `${Math.round(ms)} ms` : 'unavailable';
  const lane = r => {
    const [dir, config, runner = 'node'] = (r.lane ?? laneOf(r)).split('\0');
    return `runner=${short(runner)} dir=${short(dir)} config=${short(config)} machine=${short(r.machine)}${Object.hasOwn(r, 'commandHash') ? ` command=${short(r.commandHash)}` : ''}`;
  };
  const named = t => `${short(t.file)} — ${short(t.name)}${t.describe ? ' (suite)' : ''}`;
  const section = (title, rows, format) => [title, ...rows.slice(0, 10).map(format),
    ...(rows.length > 10 ? [`  ${rows.length - 10} entries omitted; see --json.`] : []),
    ...(!rows.length ? ['  unavailable (no retained observations)'] : [])];
  const wa = data.workedAround;
  const text = [`Timing over ${weeks} weeks (${data.weeks[0].week} through ${new Date(now).toISOString()}; root-project gate scope; ${data.coverage.excludedGates.length} non-root/unidentified gates excluded; ${data.coverage.runs} retained runs; ${data.coverage.omitted} busy; ${data.coverage.unknown} load context unavailable).`,
    ...section('Weekly gates:', data.weeks.flatMap(w => w.lanes.filter(l => l.kind === 'gate').map(l => ({ ...l, week: w.week }))), l => `  ${l.week} [${lane(l)}] gate ${duration(l.gateMs)} (${l.successful} successful, ${l.unsuccessful} unsuccessful)`),
    ...(!data.coverage.gateRuns ? ['  gate unavailable'] : []),
    ...section('Weekly test medians (slowest first):', data.weeks.flatMap(w => w.lanes.flatMap(l => l.tests.map(t => ({ ...t, ...{ lane: l.lane, machine: l.machine, commandHash: l.commandHash, week: w.week } })))).sort((a, b) => b.median - a.median), t => `  ${t.week} [${lane(t)}] ${named(t)}: median ${duration(t.median)} (${t.passes} passes)`),
    ...section('Usual times (last ten retained passes through report time; slowest first):', [...data.usual].sort((a, b) => b.median - a.median), t => `  [${lane(t)}] ${named(t)}: usual ${duration(t.median)} (${t.passes} passes)`),
    ...section('Recorded failures (newest first):', [...data.failures].reverse(), t => `  ${short(t.date)} [${lane(t)}] ${named(t)}: ${short(t.error)}`),
    ...section('Failure diagnosis:', data.diagnosis, t => `  [${lane(t)}] ${named(t)}: ${short(t.message)}`),
    data.coverage.note,
    `Retention: bounded weekly samples plus recent reserve; ${data.retention.cumulativeOmitted ?? 'unknown'} observations omitted, ${data.retention.cumulativePressureLosses ?? 'unknown'} lost to global pressure.`,
    `Worked around: ${wa.available ? JSON.stringify(wa.counts) : wa.reason}${wa.coverage ? `; ${wa.coverage.outOfWindow} records out of window; coverage ${wa.coverage.state}` : ''}`,
    ...(wa.available ? section('Worked-around identities:', wa.identities, t => `  ${short(t.kind)} ${short(t.id)}${t.dir ? ` dir=${short(t.dir)}` : ''}: ${JSON.stringify(t.counts)}`) : [])].join('\n');
  return { data, text };
}

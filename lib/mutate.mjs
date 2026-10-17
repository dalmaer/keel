// keel prove --mutate (phase 84): a fix's test is shown to catch plausible wrong versions of the fix.
//
// keel prove shows the test fails without the fix. It does not show the test fails for a fix that is
// nearly right. --mutate makes small mechanical changes to the lines the fix added or changed (the diff
// between the base and the tree), one at a time, and runs the named test against each:
//
//   comparison  flip a comparison: < and <=, > and >=, === and !== (spaced, as an operator is written);
//   condition   negate an if/while condition, or drop it (always true);
//   logical     swap && and ||;
//   return      return early, before the line's statement (inside a block, at a statement's start);
//   number      change a numeric constant by one.
//
// Strings, comments, template literals and regular expressions are never mutated. Each mutant runs in a
// fresh scratch copy of the tree built as keel prove builds one; the user's tree is never written. The
// unmutated fix runs first (the baseline) and must pass. Then each mutant is read as prove reads a run:
//
//   caught        a test that passed at the baseline failed;
//   survivor      the selected tests ran and passed: the test does not tell this wrong fix from the fix;
//   invalid       the mutant does not parse or import (the file failed before any test ran);
//   inconclusive  the run timed out, no selected test ran, or it went red without a baseline test failing.
//
// Invalid and inconclusive mutants are reported apart and never counted as caught. At most MAX_MUTANTS run,
// spread evenly over the changed lines, each under a time limit. Survivors never fail the proof: they are
// gaps in the test, shown to the conductor, who decides.
import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { safeWrite } from '../practices/night/files/scripts/keel/night-plan.mjs';
import { ProveError, git, zlist, scratchTree, removeScratch, runnerOf, readNodeRun, failureOf, runTestLimited, RUN_LIMIT_MS, OUTPUT_LIMIT_BYTES } from './prove.mjs';

export const MAX_MUTANTS = 40;
export const KINDS = ['comparison', 'condition', 'logical', 'return', 'number'];
/** The files keel mutates: JavaScript and TypeScript. */
export const MUTABLE = /\.(?:[mc]?[jt]sx?)$/;

// ---- reading the source -----------------------------------------------------

const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

/**
 * Which characters of a JavaScript source are code: a byte per character, 1 for code, 0 inside a string,
 * a template literal (its ${} too: never mutated), a comment or a regular expression literal.
 */
export function codeMask(src) {
  const mask = new Uint8Array(src.length);
  let last = -1;
  const regexMayStart = () => {
    if (last < 0) return true;
    const c = src[last];
    if (c === ')' || c === ']' || c === '}') return false;
    if (/[\w$]/.test(c)) {
      let s = last;
      while (s > 0 && /[\w$]/.test(src[s - 1])) s--;
      return KEYWORDS_BEFORE_REGEX.has(src.slice(s, last + 1));
    }
    return true;
  };
  for (let i = 0; i < src.length;) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < src.length && src[i] !== c && (c === '`' || src[i] !== '\n')) i += src[i] === '\\' ? 2 : 1;
      i++;
      last = i - 1;
      continue;
    }
    if (c === '/' && regexMayStart()) {
      let j = i + 1, inClass = false;
      for (; j < src.length && src[j] !== '\n'; j++) {
        if (src[j] === '\\') { j++; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
      }
      if (src[j] === '/') {
        j++;
        while (j < src.length && /[a-z]/i.test(src[j])) j++;
        i = j;
        last = j - 1;
        continue;
      }
    }
    mask[i] = 1;
    if (!/\s/.test(c)) last = i;
    i++;
  }
  return mask;
}

const COMPARISON = { '<': '<=', '<=': '<', '>': '>=', '>=': '>', '===': '!==', '!==': '===' };

/**
 * The mutants of a source on its given lines (1-based): [{ line, column, kind, from, to, mutation }], in
 * line and column order. `column` is 1-based; `from` is replaced by `to` there.
 */
export function mutantsOf(src, lines) {
  const mask = codeMask(src);
  const text = src.split('\n');
  const starts = [];
  for (let i = 0, at = 0; i < text.length; at += text[i].length + 1, i++) starts.push(at);
  // The brace depth at each line's start, counting code braces only: a statement at depth 0 is the module's.
  const depth = [];
  for (let i = 0, d = 0; i < text.length; i++) {
    depth.push(d);
    for (let k = 0; k < text[i].length; k++) if (mask[starts[i] + k]) { if (text[i][k] === '{') d++; else if (text[i][k] === '}') d--; }
  }
  const isCode = (line, col) => mask[starts[line] + col] === 1;
  /** The last code character before line `i`, skipping blank and comment-only lines: '' at the file's start. */
  const before = i => {
    for (let j = i - 1; j >= 0; j--) {
      for (let k = text[j].length - 1; k >= 0; k--) if (isCode(j, k) && !/\s/.test(text[j][k])) return text[j][k];
    }
    return '';
  };
  const out = [];
  for (const n of [...new Set(lines)].sort((a, b) => a - b)) {
    const i = n - 1, t = text[i];
    if (t === undefined) continue;
    const add = (column, kind, from, to, mutation) => out.push({ line: n, column: column + 1, kind, from, to, mutation });
    const found = [];
    // return: before the line's statement, inside a block, where a statement starts.
    const lead = t.length - t.trimStart().length;
    const first = t.trimStart();
    if (first && isCode(i, lead) && depth[i] > 0 && ['', ';', '{', '}'].includes(before(i))
      // Never before a continuation (`.then`, `) =>`, `|| b`), a clause of the statement before, or a bare
      // `return;`, before which an early return changes nothing.
      && !/^[}\]).,?:&|+\-*/%=<>]/.test(first) && !/^(?:else|case|default|catch|finally)\b/.test(first) && !/^return\s*;?\s*$/.test(first)) {
      found.push([lead, 'return', '', 'return; ', 'return early, before this line']);
    }
    // comparison: an operator with space on each side, as one is written (never a generic, an arrow or a shift).
    for (const m of t.matchAll(/(?<=\s)(===|!==|<=|>=|<|>)(?=\s)/g)) {
      if (isCode(i, m.index)) found.push([m.index, 'comparison', m[1], COMPARISON[m[1]], `\`${m[1]}\` → \`${COMPARISON[m[1]]}\``]);
    }
    // condition: an if or while whose parentheses close on this line.
    for (const m of t.matchAll(/\b(if|while)\s*\(/g)) {
      if (!isCode(i, m.index)) continue;
      const open = m.index + m[0].length - 1;
      let level = 0, close = -1;
      for (let k = open; k < t.length; k++) {
        if (!isCode(i, k)) continue;
        if (t[k] === '(') level++;
        else if (t[k] === ')' && --level === 0) { close = k; break; }
      }
      if (close < 0) continue;
      const cond = t.slice(open + 1, close);
      if (!cond.trim()) continue;
      found.push([open + 1, 'condition', cond, `!(${cond})`, `negate \`${cond.trim()}\``]);
      if (cond.trim() !== 'true') found.push([open + 1, 'condition', cond, 'true', `drop \`${cond.trim()}\` (always true)`]);
    }
    // logical: && and || (their assignments too).
    for (const m of t.matchAll(/&&|\|\|/g)) {
      if (!isCode(i, m.index) || t[m.index - 1] === m[0][0]) continue;
      const to = m[0] === '&&' ? '||' : '&&';
      found.push([m.index, 'logical', m[0], to, `\`${m[0]}\` → \`${to}\``]);
    }
    // number: a decimal constant, never part of a name, a property or a hex, exponent or bigint literal.
    for (const m of t.matchAll(/(?<![\w$.])(\d+)(?:\.(\d+))?(?![\w$.])/g)) {
      if (!isCode(i, m.index) || (m[1].length > 1 && m[1].startsWith('0'))) continue;
      const to = m[2] === undefined ? String(BigInt(m[1]) + 1n) : `${BigInt(m[1]) + 1n}.${m[2]}`;
      found.push([m.index, 'number', m[0], to, `\`${m[0]}\` → \`${to}\``]);
    }
    found.sort((a, b) => a[0] - b[0]);
    for (const f of found) add(...f);
  }
  return out;
}

/** The source with one mutant applied. */
export function applyMutant(src, m) {
  const text = src.split('\n');
  const t = text[m.line - 1], at = m.column - 1;
  if (t === undefined || t.slice(at, at + m.from.length) !== m.from) throw new Error(`mutant does not apply at ${m.line}:${m.column}`);
  text[m.line - 1] = `${t.slice(0, at)}${m.to}${t.slice(at + m.from.length)}`;
  return text.join('\n');
}

/**
 * At most `limit` of the candidates, spread evenly over the lines they are on: with fewer lines than the
 * limit, each line in turn gives its next mutant until the limit; with more, evenly spaced lines give one
 * each (a different kind as it goes). In the candidates' own order.
 */
export function chooseMutants(candidates, limit = MAX_MUTANTS) {
  if (candidates.length <= limit) return [...candidates];
  const groups = new Map();
  candidates.forEach((c, index) => {
    const key = `${c.file ?? ''}\0${c.line}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  const lines = [...groups.values()];
  const picked = [];
  if (lines.length >= limit) {
    for (let k = 0; k < limit; k++) { const g = lines[Math.floor(k * lines.length / limit)]; picked.push(g[k % g.length]); }
  } else {
    for (let round = 0; picked.length < limit; round++) {
      for (const g of lines) if (round < g.length && picked.length < limit) picked.push(g[round]);
    }
  }
  return picked.sort((a, b) => a - b).map(i => candidates[i]);
}

/** The lines of `file` the fix added or changed: every line of a file the base does not hold, else the diff's. */
export function changedLines(root, base, file) {
  const src = readFileSync(join(root, file), 'utf8');
  const count = src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
  if (!zlist(git(root, ['ls-tree', '-z', '--name-only', base, '--', file]).stdout).length) return Array.from({ length: count }, (_, i) => i + 1);
  const diff = git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', base, '--', file]).stdout;
  const lines = [];
  for (const m of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]), n = m[2] === undefined ? 1 : Number(m[2]);
    for (let k = 0; k < n; k++) lines.push(start + k);
  }
  return lines;
}

// ---- running ----------------------------------------------------------------

/**
 * Why `rel` under `top` is not a plain file keel may read a mutant from or write one to, or null: every
 * component is a real directory (never a link), the file is a regular file, and it resolves inside `top`.
 * A fix file that is a link to elsewhere would have its target rewritten by a mutant.
 */
export async function notPlain(top, rel) {
  const parts = rel.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) return 'is not a plain repository path';
  let at = top;
  for (const [i, part] of parts.entries()) {
    at = join(at, part);
    const s = await lstat(at).catch(() => null);
    const shown = parts.slice(0, i + 1).join('/');
    if (!s) return `${shown} does not exist`;
    if (s.isSymbolicLink()) return `${shown} is a symlink`;
    if (i < parts.length - 1 && !s.isDirectory()) return `${shown} is not a directory`;
    if (i === parts.length - 1 && !s.isFile()) return 'is not a regular file';
  }
  const real = await realpath(top), file = await realpath(at);
  return file.startsWith(`${real}${sep}`) ? null : 'resolves outside the repository';
}

/**
 * Run the test against each mutant of the fix's changed lines: { status, reason, total, caught, candidates,
 * changed, limitMs, baseline, mutants, survivors, invalid, inconclusive, line }. status is 'ran', or
 * 'baseline failed' / 'not run' when no mutant could be judged.
 */
export async function mutateFix({ root, file, name, files, base, ignored }) {
  const out = { status: 'ran', reason: null, total: 0, caught: 0, candidates: 0, changed: [], limitMs: null, baseline: null, mutants: [], survivors: [], invalid: [], inconclusive: [], line: null };
  const sources = new Map();
  const candidates = [];
  for (const f of files) {
    if (f === file || !MUTABLE.test(f) || /\.d\.[mc]?ts$/.test(f)) continue;
    // Never a mutant of a link: in the scratch copy it would still point at its target, and the write would change that.
    const why = await notPlain(root, f);
    if (why) return { ...out, status: 'not run', reason: `${f} is not mutated: ${why}, and a mutant written there could change a file outside the scratch copy` };
    const src = readFileSync(join(root, f), 'utf8');
    if (src.includes('\0')) continue;
    const lines = changedLines(root, base, f);
    if (!lines.length) continue;
    sources.set(f, src);
    out.changed.push({ file: f, lines });
    for (const m of mutantsOf(src, lines)) candidates.push({ file: f, ...m });
  }
  out.candidates = candidates.length;
  const chosen = chooseMutants(candidates);
  if (!chosen.length) {
    out.reason = out.changed.length ? 'no line the fix changed holds a mutation keel makes' : 'the fix changed no JavaScript or TypeScript line';
    out.line = 'Mutants: 0/0';
    return out;
  }

  /** One run in a fresh scratch tree, the mutant (if any) written there: { error } or { run, seen, clean }. */
  const runOnce = async (mutant, limitMs) => {
    let scratch;
    try { scratch = await scratchTree(root, ignored); } catch (e) { if (e instanceof ProveError) return { error: e.message }; throw e; }
    try {
      let here;
      try { here = runnerOf(scratch.tree); } catch (e) { return { error: e.message }; }
      if (here.refuse) return { error: here.refuse };
      if (here.kind !== 'node' && here.tap !== true) return { error: 'the runner is read by exit code alone, which cannot tell a caught mutant from one that never loaded: make the command print TAP and set "tap": true in .keel/keel.json "prove"' };
      if (mutant) {
        // The scratch copy's bytes are the tree's: the mutant is made from them, never from the user's file, and
        // written only to a plain file inside the copy, opened without following a link (safeWrite: O_NOFOLLOW).
        const why = await notPlain(scratch.tree, mutant.file);
        if (why) return { error: `${mutant.file} is not mutated: in the scratch copy, ${why}` };
        // A mutant that does not parse is invalid, whatever the tests say: a test that imports the module inside
        // its body reports the SyntaxError as its own failure, which would otherwise read as caught. Bare node is the
        // judge only where it parses the unmutated file: a loader or another runner may read what node alone cannot.
        const nodeCheck = () => spawnSync(process.execPath, ['--check', mutant.file], { cwd: scratch.tree, encoding: 'utf8', timeout: 30_000 });
        const judged = nodeCheck().status === 0;
        try { await safeWrite(scratch.tree, mutant.file, applyMutant(await readFile(join(scratch.tree, mutant.file), 'utf8'), mutant)); } catch (e) { return { error: e.message }; }
        const check = judged ? nodeCheck() : { status: 0 };
        if (check.status !== 0) return { invalid: (check.stderr || '').split('\n').find(l => /Error/.test(l)) ?? `node --check exited ${check.status ?? check.signal}` };
      }
      const run = await runTestLimited(scratch.tree, here, file, name, limitMs);
      const real = realpathSync(scratch.tree);
      const clean = s => String(s).split(real).join('.').split(scratch.tree).join('.');
      return { run, seen: readNodeRun(run, file), clean };
    } finally {
      await removeScratch(root, scratch);
    }
  };

  // The baseline: the unmutated fix must pass, under the same reading.
  const seam = Number(process.env.KEEL_PROVE_MUTANT_MS) || null;
  const b = await runOnce(null, RUN_LIMIT_MS);
  if (b.error) return { ...out, status: 'not run', reason: b.error };
  out.baseline = { red: b.seen.red, tests: b.seen.ran, ms: b.run.ms, timedOut: b.run.timedOut };
  const baselineFailed = b.run.timedOut ? `the baseline timed out after ${RUN_LIMIT_MS / 1000}s`
    : b.run.overflowed ? `the baseline wrote more than ${OUTPUT_LIMIT_BYTES / 1024 / 1024} MiB of output`
    : b.seen.red ? `the unmutated fix is red: ${b.seen.loadError ? `the test does not load (${b.clean(b.seen.reason)})` : b.clean(failureOf(b.seen.failures).first ?? `exit ${b.run.exit}`)}`
      : b.seen.ran === 0 ? (name ? `no test matched --name ${name}` : 'the file ran no test') : null;
  if (baselineFailed) return { ...out, status: 'baseline failed', reason: `${baselineFailed}: no mutant is judged against a fix that does not pass` };
  const passed = new Set(b.seen.passed);
  // Each mutant's limit: five times the baseline, at least ten seconds (KEEL_PROVE_MUTANT_MS is a test seam).
  out.limitMs = seam ?? Math.min(RUN_LIMIT_MS, Math.max(10_000, 5 * b.run.ms));

  for (const m of chosen) {
    const r = await runOnce(m, out.limitMs);
    let result, reason;
    if (r.error) [result, reason] = ['inconclusive', r.error];
    else if (r.invalid) [result, reason] = ['invalid', `does not parse: ${r.invalid}`];
    else if (r.run.timedOut) [result, reason] = ['inconclusive', `timed out after ${out.limitMs / 1000}s`];
    else if (r.run.overflowed) [result, reason] = ['inconclusive', `wrote more than ${OUTPUT_LIMIT_BYTES / 1024 / 1024} MiB of output`];
    else if (r.seen.loadError) [result, reason] = ['invalid', `does not parse or import: ${r.clean(r.seen.reason)}`];
    else if (r.seen.red) {
      const caught = r.seen.failures.filter(f => passed.has(f.id) && f.failureType !== 'testTimeoutFailure');
      // As prove does: a failed test whose path more than one test holds, at the baseline or here, is told apart
      // only by place, which can shift between runs, so it may not be the test that passed at the baseline.
      const shared = [...new Set(r.seen.failures.map(f => f.path).filter(p => (b.seen.counts[p] ?? 0) > 1 || (r.seen.counts[p] ?? 0) > 1))];
      if (shared.length) [result, reason] = ['inconclusive', `more than one test is named ${shared.map(p => JSON.parse(p).join(' > ')).join(', ')}: keel cannot tell which failed; give each its own name`];
      else if (caught.length) [result, reason] = ['caught', r.clean(failureOf(caught).first)];
      else if (r.seen.failures.some(f => f.failureType === 'testTimeoutFailure')) [result, reason] = ['inconclusive', 'a test timed out'];
      else [result, reason] = ['inconclusive', 'red, but no test that passed at the baseline failed'];
    } else if (r.seen.ran === 0) [result, reason] = ['inconclusive', 'no selected test ran'];
    else [result, reason] = ['survivor', `${r.seen.ran} test${r.seen.ran === 1 ? '' : 's'} passed`];
    const entry = { ...m, result, reason };
    out.mutants.push(entry);
    if (result === 'caught') out.caught++;
    else if (result === 'survivor') out.survivors.push(entry);
    else if (result === 'invalid') out.invalid.push(entry);
    else out.inconclusive.push(entry);
  }
  out.total = out.mutants.length;
  out.line = `Mutants: ${out.caught}/${out.total}`;
  return out;
}

/** The report's lines, under prove's. */
export function mutationText(m) {
  if (m.status !== 'ran') return [`  mutants: not run — ${m.reason}`];
  if (!m.total) return [`  mutants: 0/0 — ${m.reason}`];
  const lines = m.changed.reduce((n, c) => n + c.lines.length, 0);
  const apart = [m.survivors.length && `${m.survivors.length} survivor${m.survivors.length === 1 ? '' : 's'}`,
    m.invalid.length && `${m.invalid.length} invalid`, m.inconclusive.length && `${m.inconclusive.length} inconclusive`].filter(Boolean);
  const out = [`  mutants: ${m.caught}/${m.total} caught${apart.length ? ` (${apart.join(', ')})` : ''} on ${lines} changed line${lines === 1 ? '' : 's'}`
    + `${m.total < m.candidates ? `, ${m.total} of ${m.candidates} spread over them` : ''}; each run limited to ${m.limitMs / 1000}s`];
  for (const e of [...m.survivors, ...m.invalid, ...m.inconclusive]) {
    out.push(`    ${e.result.padEnd(12)} ${e.file}:${e.line} — ${e.kind} ${e.mutation}${e.result === 'survivor' ? '' : `: ${e.reason}`}`);
  }
  return out;
}

// Read this before touching that (keel practice `agents-md`; managed: keel
// render rewrites it, and writes it only while .keel/keel.json sets
// "contracts"). keel phase 65.
//
// A contract maps path patterns to the document an agent must read before it
// edits a file they match (an as-built contract):
//
//   "contracts": [{ "paths": ["src/index/**"], "read": "docs/engine/indexing.md",
//                   "why": "the index format is measured, not guessed" }]
//
// Claude Code runs this as a PreToolUse hook on Edit, Write and MultiEdit
// (.claude/settings.json). It reads the hook's JSON on stdin, takes the tool
// input's file path, and when a contract's pattern matches it says
// "Before editing <path>, read <doc>: <why>." It never blocks: it always
// exits 0, and a bad input or config says nothing. Other agents read the same
// contracts as the table in the selected working guide.
//
// A pattern is a whole path from the project's root: `*` within one
// directory, `**` across directories, `?` one character, `{a,b}` either.
//
// keel's doctor and render import globRegex and contractsFor from here, so a
// pattern means the same thing to all three.
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A glob's RegExp source. Each `{a,b}` alternative is a glob of its own
 * (`src/{*.js,lib/**}`), braces may nest, and an unclosed `{` is literal.
 */
function globSource(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*'; }
    else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') {
      // The matching close, and the commas at this depth.
      const commas = [];
      let depth = 0, end = -1;
      for (let k = i; k < glob.length; k++) {
        if (glob[k] === '{') depth++;
        else if (glob[k] === '}' && --depth === 0) { end = k; break; }
        else if (glob[k] === ',' && depth === 1) commas.push(k);
      }
      if (end < 0) { out += '\\{'; continue; }
      const alts = [];
      let from = i + 1;
      for (const k of [...commas, end]) { alts.push(glob.slice(from, k)); from = k + 1; }
      out += `(?:${alts.map(globSource).join('|')})`;
      i = end;
    }
    else out += c.replace(/[.+^$(){}|[\]\\]/g, '\\$&');
  }
  return out;
}

/** A simple glob (`*`, `**`, `?`, `{a,b}`) as a whole-path RegExp. */
export const globRegex = glob => new RegExp(`^${globSource(glob)}$`);

/** Why a glob cannot be read, or null when it compiles. */
export function globProblem(glob) {
  try { globRegex(glob); return null; } catch (e) { return e.message; }
}

/** What is wrong with a config's "contracts" (empty: nothing, or absent). */
export function contractProblems(list) {
  if (list === undefined) return [];
  const shape = '"contracts" must be a list of { "paths": ["<glob>", …], "read": "<doc path>", "why": "<one line>" }';
  if (!Array.isArray(list)) return [shape];
  const problems = [];
  list.forEach((c, i) => {
    const at = `"contracts"[${i}]`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) { problems.push(`${at}: ${shape}`); return; }
    if (!Array.isArray(c.paths) || !c.paths.length || c.paths.some(p => typeof p !== 'string' || !p.trim())) problems.push(`${at}: "paths" must be a non-empty list of path patterns`);
    else for (const p of c.paths) if (globProblem(p)) problems.push(`${at}: the pattern ${p} is not a glob keel can read (${globProblem(p)})`);
    if (typeof c.read !== 'string' || !c.read.trim() || isAbsolute(c.read) || c.read.split(/[\\/]/).includes('..')) problems.push(`${at}: "read" must be a document's path inside the project`);
    if (typeof c.why !== 'string' || !c.why.trim() || /\n/.test(c.why)) problems.push(`${at}: "why" must be one line`);
  });
  return problems;
}

/** The contracts whose patterns match `path` (relative to the root, `/`-separated). */
export function contractsFor(list, path) {
  if (!Array.isArray(list) || contractProblems(list).length) return [];
  const clean = path.split(sep).join('/').replace(/^\.\//, '');
  return list.filter(c => c.paths.some(p => globRegex(p.replace(/^\.\//, '')).test(clean)));
}

const real = path => { try { return realpathSync(path); } catch { return path; } };

/** The line an agent is shown for one contract. */
export const notice = (path, c) => `Before editing ${path}, read ${c.read}: ${c.why}`;

/**
 * The hook's answer for one PreToolUse input and the project's config: the
 * lines to show (none: say nothing). `root` is the project's root.
 */
export function hookLines(input, config, root) {
  const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path ?? input?.tool_input?.path;
  if (typeof target !== 'string' || !target) return [];
  const abs = isAbsolute(target) ? target : resolve(input?.cwd ?? root, target);
  let rel = relative(root, abs);
  // One side through a symlink (macOS /var is /private/var): compare real paths.
  if (rel.startsWith('..') || isAbsolute(rel)) rel = relative(real(root), join(real(dirname(abs)), basename(abs)));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return [];
  const path = rel.split(sep).join('/');
  return contractsFor(config?.contracts, path).map(c => notice(path, c));
}

/**
 * The hook's stdout for those lines: Claude Code's JSON, which shows the
 * user the notice (systemMessage) and hands it to the model
 * (additionalContext) without deciding the tool call. Nothing to say: ''.
 */
export function hookOutput(lines) {
  if (!lines.length) return '';
  const text = lines.join('\n');
  return `${JSON.stringify({ systemMessage: text, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } })}\n`;
}

async function run() {
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const input = JSON.parse(raw || '{}');
    const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
    process.stdout.write(hookOutput(hookLines(input, config, root)));
  } catch { /* never block an edit: a bad input or config says nothing */ }
  process.exitCode = 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();

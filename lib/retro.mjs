// keel retro (phase 40): the worksheet for a retro after real work. It reads
// the session's own Claude Code transcript the way keel loose-ends does
// (transcriptEntries, KEEL_CLAUDE_DIR in tests) and prints counts and
// pointers, never transcript text: a pointer is a tool name, a short command
// head (quoted text cut, paths beyond the repo cut), a repo-relative file and
// a transcript line. Nothing is written to any file. Exit 0 always: it is a
// worksheet for the conductor, not a gate.
//
// Real work: the commit range (--since <commit>..HEAD, or HEAD's own commit)
// changed a file outside docs/. A docs-only range prints one line and stops.
//
// Session: --session <id>, or the newest *.jsonl in this repo's transcript
// directory; its subagents (<id>/subagents/*.jsonl) are read with it, since
// the builders' friction is the session's friction. --since keeps entries
// at or after that commit's time.
//
// Signals:
//   retried   a failed Bash command whose head recurs within the next 5 tool calls
//   errors    tool results marked as errors (a failed command counts here too)
//   denials   permission denials (the classifier's, or the person's no)
//   rereads   a file Read 3 or more times
//   slow      a tool call that took over 60 s (Agent and AskUserQuestion wait by design)
//   reverted  an Edit undone by a later Edit, or a Write restoring an earlier content
import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, isAbsolute, resolve, sep } from 'node:path';
import { claudeDir, encodeDir, transcriptEntries } from './looseends.mjs';

export const RETRY_WINDOW = 5;
export const REREAD_AT = 3;
export const SLOW_MS = 60_000;
const SHOWN = 8; // pointers printed per signal; --json has them all
const NOT_SLOW = new Set(['Agent', 'Task', 'AskUserQuestion']);

export const SIGNALS = {
  retried: 'failed commands retried',
  errors: 'tool errors',
  denials: 'permission denials',
  rereads: `files read ${REREAD_AT}+ times`,
  slow: 'tool calls over 60 s',
  reverted: 'edits reverted',
};

/** The seven areas the conductor answers, each with the signals that bear on it. */
export const AREAS = [
  { key: 'navigation', title: 'Navigation', question: 'How easy was the code to find?', signals: ['rereads', 'errors'] },
  { key: 'checks', title: 'Automatable checks', question: 'What could a lint, test or guard have caught?', signals: ['retried', 'reverted'] },
  { key: 'standards', title: 'Missing standards', question: 'What standard was missing, so a choice was made twice?', signals: ['reverted', 'retried'] },
  { key: 'agents', title: 'AGENTS.md health', question: 'Was AGENTS.md current, short and enough?', signals: ['denials', 'rereads'] },
  { key: 'economy', title: 'Tool economy', question: 'What took too many calls, or too long?', signals: ['slow', 'rereads', 'retried'] },
  { key: 'noop', title: 'No-op instructions', question: 'Which instructions did nothing?', signals: [] },
  { key: 'gaps', title: 'Information gaps', question: 'What did the agent need and not have?', signals: ['denials', 'errors'] },
];

export class RetroError extends Error {
  constructor(message) { super(message); this.exitCode = 2; }
}

const git = (dir, args, env) => new Promise(done =>
  execFile('git', ['-C', dir, ...args], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (e, out) => done(e ? null : out.trim())));

// ---- pointers: what may leave the transcript ----------------------------------

/** A path as a pointer: repo-relative, or "<path>" when it is beyond the repo. */
function pathPointer(p, root) {
  const abs = p.startsWith('~') ? null : isAbsolute(p) ? p : resolve(root, p);
  if (!abs) return '<path>';
  if (abs === root) return '.';
  return abs.startsWith(root + sep) ? relative(root, abs) : '<path>';
}

/**
 * A command's head: its first line before any heredoc, with quoted text cut
 * to '' and a leading `cd <dir> &&` dropped, paths beyond the repo as <path>,
 * VAR=value as VAR=…, long tokens as …; six tokens, 60 characters at most.
 */
export function commandHead(command, root) {
  let s = String(command ?? '').split('\n')[0].split('<<')[0];
  s = s.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '\0').replace(/['"].*$/, '').replace(/\0/g, "''");
  s = s.replace(/^\s*cd\s+\S+\s*(&&|;)\s*/, '');
  const tokens = s.trim().split(/\s+/).filter(Boolean).slice(0, 6).map(t => {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) return `${t.split('=')[0]}=…`;
    t = t.replace(/(?<![\w.-])~?\/[^\s=:,;|&()]*/g, m => pathPointer(m, root));
    return t.length > 40 ? '…' : t;
  });
  const head = tokens.join(' ');
  return head.length > 60 ? `${head.slice(0, 59)}…` : head;
}

const DENIED = /permission (for this action )?(was |has been )?denied|denied by|doesn't want to proceed|automode-blocked/i;
const resultText = c => typeof c.content === 'string' ? c.content
  : Array.isArray(c.content) ? c.content.filter(x => x?.type === 'text').map(x => x.text ?? '').join('\n') : '';

/**
 * One transcript's tool calls: [{ id, name, input, line, at, result: { error,
 * denied, at } | null }], in order. Message and result text stay here: only
 * flags leave.
 */
function toolCalls(text, sinceMs) {
  const calls = [], byId = new Map();
  for (const { line, entry: e } of transcriptEntries(text)) {
    const at = Date.parse(e.timestamp ?? '');
    if (sinceMs !== null && !(at >= sinceMs)) continue;
    const content = Array.isArray(e.message?.content) ? e.message.content : [];
    for (const c of content) {
      if (e.type === 'assistant' && c?.type === 'tool_use') {
        const call = { id: c.id, name: c.name, input: c.input ?? {}, line, at, result: null };
        calls.push(call);
        byId.set(c.id, call);
      } else if (e.type === 'user' && c?.type === 'tool_result') {
        const call = byId.get(c.tool_use_id);
        if (!call) continue;
        const denied = Boolean(e.toolDenialKind) || (c.is_error === true && DENIED.test(resultText(c)));
        call.result = { error: c.is_error === true && !denied, denied, at };
      }
    }
  }
  return calls;
}

/** The signals of one source's calls; each pointer is { source, line, tool, head?, file?, seconds?, times? }. */
function signalsOf(calls, source, root, out) {
  const ptr = (c, extra = {}) => ({ source, line: c.line, tool: c.name, ...extra });
  const headOf = c => c.name === 'Bash' ? commandHead(c.input.command, root) : undefined;
  const reads = new Map(), edits = [], writes = new Map();
  calls.forEach((c, i) => {
    const r = c.result;
    if (r?.denied) out.denials.push(ptr(c, { head: headOf(c) }));
    if (r?.error) out.errors.push(ptr(c, { head: headOf(c) }));
    if (r?.error && c.name === 'Bash') {
      const head = headOf(c);
      const again = calls.slice(i + 1, i + 1 + RETRY_WINDOW).find(n => n.name === 'Bash' && headOf(n) === head);
      if (again) out.retried.push(ptr(c, { head, retriedAt: again.line }));
    }
    if (r && !r.denied && !NOT_SLOW.has(c.name) && r.at - c.at > SLOW_MS) out.slow.push(ptr(c, { head: headOf(c), seconds: Math.round((r.at - c.at) / 1000) }));
    const file = c.input.file_path;
    if (typeof file !== 'string') return;
    const abs = isAbsolute(file) ? file : resolve(root, file);
    if (c.name === 'Read') reads.set(abs, [...(reads.get(abs) ?? []), c]);
    if (c.name === 'Edit' && typeof c.input.old_string === 'string' && typeof c.input.new_string === 'string') {
      const undone = edits.find(p => p.abs === abs && !p.undone && p.c.input.new_string === c.input.old_string && p.c.input.old_string === c.input.new_string);
      if (undone) { undone.undone = true; out.reverted.push(ptr(c, { file: pathPointer(abs, root), undoes: undone.c.line })); }
      edits.push({ abs, c });
    }
    if (c.name === 'Write' && typeof c.input.content === 'string') {
      const before = writes.get(abs) ?? [];
      const k = before.findIndex(p => p.input.content === c.input.content);
      if (k >= 0 && k < before.length - 1) out.reverted.push(ptr(c, { file: pathPointer(abs, root), undoes: before.at(-1).line }));
      writes.set(abs, [...before, c]);
    }
  });
  for (const [abs, cs] of reads) {
    if (cs.length >= REREAD_AT) out.rereads.push({ source, line: cs[0].line, tool: 'Read', file: pathPointer(abs, root), times: cs.length, lines: cs.map(c => c.line) });
  }
}

// ---- the session and the range ---------------------------------------------------

async function newestSession(dir) {
  const files = (await readdir(dir).catch(() => [])).filter(n => n.endsWith('.jsonl'));
  let best = null;
  for (const f of files) {
    const m = (await stat(join(dir, f)).catch(() => null))?.mtimeMs ?? 0;
    if (!best || m > best.m) best = { f, m };
  }
  return best?.f.replace(/\.jsonl$/, '') ?? null;
}

/** The files a commit range changed, and whether any is outside docs/. */
async function range(root, since, env) {
  const files = since
    ? await git(root, ['diff', '--name-only', `${since}..HEAD`], env)
    : await git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD'], env);
  if (files === null && !since) return { range: 'HEAD', changed: 0, outsideDocs: 0, realWork: false, noCommit: true };
  if (files === null) throw new RetroError(`cannot diff ${since}..HEAD`);
  const changed = files.split('\n').filter(Boolean);
  const outside = changed.filter(p => !p.startsWith('docs/'));
  return { range: since ? `${since}..HEAD` : 'HEAD', changed: changed.length, outsideDocs: outside.length, realWork: outside.length > 0 };
}

export async function retro({ root, since, session, env = process.env }) {
  root = resolve(root);
  let sinceAt = null, sinceMs = null;
  if (since) {
    const t = await git(root, ['log', '-1', '--format=%cI', `${since}^{commit}`, '--'], env);
    if (!t) throw new RetroError(`--since: no commit ${since}`);
    sinceAt = t; sinceMs = Date.parse(t);
  }
  const work = await range(root, since, env);
  if (!work.realWork) {
    const text = work.noCommit ? 'no commit yet: no retro' : `docs only: no retro (${work.range} changed nothing outside docs/)`;
    return { data: { realWork: false, ...work, since: since ?? null }, text, exitCode: 0 };
  }

  const dir = join(claudeDir(env), 'projects', encodeDir(root));
  const id = session ?? await newestSession(dir);
  const main = id && await readFile(join(dir, `${id}.jsonl`), 'utf8').catch(() => null);
  if (session && main === null) throw new RetroError(`--session: no transcript ${session}.jsonl in this repo's transcript directory`);
  if (!main) {
    return { data: { realWork: true, ...work, since: since ?? null, session: null }, text: `no session transcript for this repo (${dir})`, exitCode: 0 };
  }

  const out = Object.fromEntries(Object.keys(SIGNALS).map(k => [k, []]));
  signalsOf(toolCalls(main, sinceMs), 'main', root, out);
  const subDir = join(dir, id, 'subagents');
  let subagents = 0;
  for (const f of (await readdir(subDir).catch(() => [])).filter(n => n.endsWith('.jsonl')).sort()) {
    const calls = toolCalls(await readFile(join(subDir, f), 'utf8').catch(() => ''), sinceMs);
    if (!calls.length) continue;
    subagents++;
    signalsOf(calls, f.replace(/\.jsonl$/, ''), root, out);
  }
  out.rereads.sort((a, b) => b.times - a.times);
  out.slow.sort((a, b) => b.seconds - a.seconds);
  const counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]));
  const areas = AREAS.map(a => ({ ...a, counts: Object.fromEntries(a.signals.map(s => [s, counts[s]])) }));
  const data = { realWork: true, ...work, since: since ?? null, sinceAt, session: id, subagents, counts, signals: out, areas };
  return { data, text: textOf(data), exitCode: 0 };
}

// ---- text ----------------------------------------------------------------------

function pointerText(k, p) {
  const where = `${p.source}:${p.line}`;
  const what = p.head !== undefined ? `${p.tool} \`${p.head}\`` : p.file !== undefined ? `${p.tool} ${p.file}` : p.tool;
  const extra = k === 'retried' ? `, again at ${p.retriedAt}` : k === 'slow' ? `, ${p.seconds} s`
    : k === 'rereads' ? `, ${p.times} times` : k === 'reverted' ? `, undoes ${p.undoes}` : '';
  return `    ${what} (${where}${extra})`;
}

function textOf(d) {
  const lines = [
    `retro worksheet: session ${d.session}${d.subagents ? ` and ${d.subagents} subagent${d.subagents === 1 ? '' : 's'}` : ''}${d.since ? `, since ${d.since} (${d.sinceAt})` : ''}`,
    `real work: ${d.outsideDocs} of ${d.changed} changed files outside docs/ (${d.range})`,
    '',
    'Counts (pointers are source:line in the transcript; no transcript text is shown):',
  ];
  const w = Math.max(...Object.values(SIGNALS).map(s => s.length));
  for (const [k, label] of Object.entries(SIGNALS)) {
    lines.push(`  ${label.padEnd(w)}  ${d.counts[k]}`);
    for (const p of d.signals[k].slice(0, SHOWN)) lines.push(pointerText(k, p));
    if (d.signals[k].length > SHOWN) lines.push(`    … ${d.signals[k].length - SHOWN} more (--json)`);
  }
  lines.push('', 'Seven areas (answer each briefly; then at most five candidates, most serious first,',
    'each a check, an AGENTS/skill line or a lesson; the owner picks):');
  for (const a of d.areas) {
    const bearing = a.signals.map(s => `${SIGNALS[s]} ${d.counts[s]}`).join(', ');
    lines.push(`  ## ${a.title}: ${a.question}`, `     ${bearing || 'no signal: answer from the session'}`);
  }
  return lines.join('\n');
}

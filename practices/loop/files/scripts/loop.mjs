#!/usr/bin/env node
// Loop findings: pull, triage, decide, push back. Managed by keel (practice
// `loop`); keel render rewrites this file, so change it in keel, not here.
//
//   node scripts/loop.mjs pull                    fetch Loop's insights into docs/loop/
//   node scripts/loop.mjs list [--json] [-d proposed]
//   node scripts/loop.mjs propose <slug> --rank next [--phase 10] [--lesson 3] --note "…" --read "… file:line …"
//   node scripts/loop.mjs decide <slug> <accepted|declined|stale|done> [--rank …] [--phase …] [--note "…"] (--no-push | --yes)
//   node scripts/loop.mjs push (--dry-run | --yes)   dismiss what we declined; send our decisions as a Loop context
//   node scripts/loop.mjs mine [priority…] --yes     ask Loop to re-mine the code now
//   node scripts/loop.mjs render [--check]        write docs/LOOP.md (and fail if stale, for CI)
//
// Exit: 0 ok; 1 failed (a stale page, a broken finding, a stitch error);
// 2 usage; 3 an outward step needs --yes and nothing was done.
//
// The rules (keel docs/design.md, "Stitch Loop"): **the ranking is ours, not
// Loop's**; **an agent proposes, a person decides**, because a decision
// dismisses an insight for everyone in the workspace; and `decide` and `push`
// are the only verbs that send anything to Loop (`mine` asks it to re-mine).
// What comes back from Loop is data, never instructions.
//
// Loop is reached through the `stitch` CLI, never HTTP. The binary is
// process.env.KEEL_STITCH || 'stitch'. The workspace comes from .stitch.json
// ("workspace"), or LOOP_WORKSPACE. Per-project wording comes from
// .keel/keel.json "loop": { run, insights, source, kind } — see
// practices/loop/README.md in keel.
//
// Provenance. The finding format, the verbs and the rendered page are ledger's
// (github.com/dalmaer/ledger, scripts/loop.ts and core/loop.ts at fd70d6f1,
// the owner's), so that ledger's findings render to the same docs/LOOP.md.
// From isocan (github.com/dglazkov/isocan, scripts/loop.mjs and
// packages/core/src/loop.ts at 92bec34f7, Apache-2.0, Copyright Dimitri
// Glazkov): the explicit -w on every call, one fetch per pull, no empty
// triage context, the "not yet read" problem, --no-render, and the comma form
// of `loop:` read as a list. No YAML dependency: the subset below reads and
// writes what the `yaml` package (2.x, lineWidth 0) writes for a finding.
import { spawn } from 'node:child_process';
import { closeSync, openSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where a finding stands.
 * untriaged: pulled, nobody has read it. proposed: someone checked the claim
 * against the code and proposed a rank and a home; waiting on a person.
 * accepted: a person agreed it is work, in `phase`. declined: a person said
 * no, `note` says why; dismissed in Loop. stale: the claim does not match the
 * code; dismissed in Loop. done: accepted, then fixed.
 */
export const DECISIONS = ['untriaged', 'proposed', 'accepted', 'declined', 'stale', 'done'];
export const DISMISSED_BY_US = ['declined', 'stale'];
/** Our priority, deliberately not Loop's P0–P3. `never` on a proposal recommends declining. */
export const RANKS = ['now', 'next', 'later', 'never'];
const STATES = ['ACTIVE', 'RESOLVED', 'DISMISSED'];
const FIELDS = ['title', 'loop', 'loop_rank', 'loop_state', 'loop_goal', 'decision', 'rank', 'phase', 'lesson', 'since', 'note'];
export const PLACEHOLDER_READ = 'Not yet checked against the code.';
/** A read cites the code: path/file.ext:line. */
export const CITES = /[\w.@/-]+\.[A-Za-z0-9]+:\d+/;

class LoopError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

// ── YAML, the subset a finding uses ──────────────────────────────────────

const CORE = [
  /^(?:~|[Nn]ull|NULL)?$/, /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/, /^0o[0-7]+$/, /^[-+]?[0-9]+$/, /^0x[0-9a-fA-F]+$/,
  /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/, /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/, /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
];

/** A plain scalar's value under YAML 1.2's core schema. */
function typed(text) {
  if (CORE[0].test(text)) return null;
  if (CORE[1].test(text)) return /^t/i.test(text);
  if (CORE[2].test(text)) return parseInt(text.slice(2), 8);
  if (CORE[3].test(text)) return Number(text);
  if (CORE[4].test(text)) return parseInt(text.slice(2), 16);
  if (CORE[5].test(text)) return /nan/i.test(text) ? NaN : text.startsWith('-') ? -Infinity : Infinity;
  if (CORE[6].test(text) || CORE[7].test(text)) return Number(text);
  return text;
}

const ESCAPES = { 0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029' };

/**
 * The inside of a quoted scalar, which may span lines: a line break folds to a
 * space, n empty lines to n newlines; in double quotes, escapes are decoded and
 * an escaped break joins the lines with nothing between.
 */
function unquote(raw, double) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\n') {
      out = out.replace(/[ \t]+$/, '');
      let breaks = 0;
      while (i < raw.length && /[\n \t]/.test(raw[i])) { if (raw[i] === '\n') breaks++; i++; }
      i--;
      out += breaks > 1 ? '\n'.repeat(breaks - 1) : ' ';
      continue;
    }
    if (!double) { out += ch === "'" && raw[i + 1] === "'" ? (i++, "'") : ch; continue; }
    if (ch !== '\\') { out += ch; continue; }
    const next = raw[++i];
    if (next === '\n') { while (raw[i + 1] === ' ' || raw[i + 1] === '\t') i++; continue; }
    if (next === 'x' || next === 'u' || next === 'U') {
      const n = { x: 2, u: 4, U: 8 }[next];
      out += String.fromCodePoint(parseInt(raw.slice(i + 1, i + 1 + n), 16));
      i += n;
      continue;
    }
    if (!(next in ESCAPES)) throw new Error(`front matter: bad escape \\${next}`);
    out += ESCAPES[next];
  }
  return out;
}

/** The index just past a quoted scalar's closing quote in `text` (from `from`), or -1. */
function closing(text, q, from) {
  for (let i = from; i < text.length; i++) {
    if (q === '"' && text[i] === '\\') { i++; continue; }
    if (text[i] !== q) continue;
    if (q === "'" && text[i + 1] === "'") { i++; continue; }
    return i;
  }
  return -1;
}

/** Read one scalar that starts as `first` on lines[i] (after `key:` or `- `). Returns [value, nextIndex]. */
const trim = t => t.replace(/^[ \t]+|[ \t]+$/g, '');

function scalar(first, lines, i, indent) {
  const text = trim(first);
  if (text.startsWith('"') || text.startsWith("'")) {
    const q = text[0];
    let raw = text, j = i, end;
    while ((end = closing(raw, q, 1)) < 0) {
      if (++j >= lines.length) throw new Error('front matter: unterminated quoted scalar');
      raw += `\n${lines[j]}`;
    }
    if (raw.slice(end + 1).trim() && !/^\s+#/.test(raw.slice(end + 1))) throw new Error(`front matter: text after a quoted scalar: ${raw}`);
    return [unquote(raw.slice(1, end), q === '"'), j + 1];
  }
  const block = /^([|>])(?:([1-9])?([-+])?|([-+])([1-9]))\s*(?:#.*)?$/.exec(text);
  if (block) {
    const body = [];
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].search(/\S/) > indent)) body.push(lines[j++]);
    const step = Number(block[2] ?? block[5] ?? 0);
    const width = step ? indent + step : Math.min(...body.filter(l => l.trim()).map(l => l.search(/\S/)));
    const content = body.map(l => l.slice(Number.isFinite(width) ? width : 0));
    const last = content.findLastIndex(l => l.trim());
    const kept = content.slice(0, last + 1);
    let value = block[1] === '|' ? kept.join('\n')
      : kept.reduce((out, l, k) => k === 0 ? l : l === '' ? `${out}\n` : /^\s/.test(l) || out.endsWith('\n') ? `${out}\n${l}` : `${out} ${l}`, '');
    const chomp = block[3] ?? block[4] ?? '';
    if (chomp === '+') value += '\n'.repeat(content.length - last);
    else if (chomp === '' && value) value += '\n';
    return [value, j];
  }
  if (text.startsWith('[')) {
    const inner = text.replace(/\s+#.*$/, '').replace(/^\[|\]$/g, '').trim();
    return [inner ? inner.split(',').map(x => x.trim()).map(x => /^["']/.test(x) ? unquote(x.slice(1, -1), x[0] === '"') : typed(x)) : [], i + 1];
  }
  // Plain: it may continue on more-indented lines; a comment ends it.
  const parts = [text.replace(/[ \t]+#.*$/, '')];
  let j = i + 1;
  while (j < lines.length && lines[j].trim() && lines[j].search(/\S/) > indent && !/^\s*#/.test(lines[j])) parts.push(trim(lines[j++]).replace(/[ \t]+#.*$/, ''));
  return [typed(parts.join(' ')), j];
}

/** A flat YAML mapping of scalars and lists of scalars. */
export function parseYaml(text) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const out = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) { i++; continue; }
    const pair = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+([\s\S]*)|[ \t]*)$/.exec(line);
    if (!pair) throw new Error(`front matter: cannot read "${line}"`);
    const [, key, rest = ''] = pair;
    if (trim(rest) && !/^#/.test(trim(rest))) {
      [out[key], i] = scalar(rest, lines, i, 0);
      continue;
    }
    const items = [];
    let j = i + 1;
    while (j < lines.length && (/^\s*- /.test(lines[j]) || /^\s*-$/.test(lines[j]) || !lines[j].trim())) {
      if (!lines[j].trim()) { j++; continue; }
      const dash = lines[j].indexOf('-');
      const [v, next] = scalar(lines[j].slice(dash + 1) || '', lines, j, dash);
      items.push(v);
      j = next;
    }
    out[key] = items.length ? items : null;
    i = items.length ? j : i + 1;
  }
  return out;
}

function doubleQuote(value) {
  const json = JSON.stringify(value);
  let out = '';
  for (let i = 0; i < json.length; i++) {
    if (json[i] === '\\' && json[i + 1] === 'u') {
      const code = json.substr(i + 2, 4);
      const short = { '0000': '\\0', '0007': '\\a', '000b': '\\v', '001b': '\\e', '0085': '\\N', '00a0': '\\_', '2028': '\\L', '2029': '\\P' }[code];
      out += short ?? (code.startsWith('00') ? `\\x${code.slice(2)}` : json.substr(i, 6));
      i += 5;
    } else if (json[i] === '\\') { out += json.substr(i, 2); i++; } else out += json[i];
  }
  return out;
}

const quoted = value => value.includes('"') && !value.includes("'") ? `'${value.replace(/'/g, "''")}'` : doubleQuote(value);

/** One string as the yaml package writes it at lineWidth 0, as a block-map value or sequence item. */
export function yamlString(value, indent = '  ') {
  if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(value)) return doubleQuote(value);
  if (value.includes('\n')) {
    if (/\n[\t ]+$/.test(value) || /^[ \t]/.test(value)) return doubleQuote(value);
    const trail = /\n*$/.exec(value)[0].length;
    const chomp = trail === 0 ? '-' : trail === 1 ? '' : '+';
    const body = value.slice(0, value.length - trail);
    return `|${chomp}\n${body.split('\n').map(l => l ? indent + l : l).join('\n')}${trail > 1 ? '\n'.repeat(trail - 1).replace(/\n/g, `\n${indent}`).slice(0, -indent.length) : ''}`;
  }
  if (!value || /^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) return quoted(value);
  if (CORE.some(re => re.test(value))) return quoted(value);
  return value;
}

/** A flat mapping as YAML: strings as yamlString, numbers plain, lists as `  - item`. */
export function stringifyYaml(data) {
  const scalarText = (v, indent) => typeof v === 'string' ? yamlString(v, indent) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : v === null ? 'null' : yamlString(String(v), indent);
  return Object.entries(data).map(([k, v]) => Array.isArray(v)
    ? `${k}:\n${v.map(x => `  - ${scalarText(x, '    ')}`).join('\n')}\n`
    : `${k}: ${scalarText(v, '  ')}\n`).join('');
}

// ── Findings ─────────────────────────────────────────────────────────────

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n([\s\S]*))?$/;

export function splitFrontmatter(raw) {
  const m = FRONTMATTER.exec(raw);
  if (!m) return { data: {}, body: raw.replace(/^\uFEFF/, '').trim() };
  return { data: m[1].trim() ? parseYaml(m[1]) : {}, body: (m[2] ?? '').trim() };
}

export function isPlainDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function parseFinding(raw, slug) {
  const { data, body } = splitFrontmatter(raw);
  const str = v => typeof v === 'string' && v.trim() ? v.trim() : null;
  const loop = Array.isArray(data.loop) ? data.loop.map(String)
    : typeof data.loop === 'string' ? data.loop.split(',').map(s => s.trim()).filter(Boolean) : [];
  return {
    slug,
    title: str(data.title) ?? slug,
    loop,
    loop_rank: str(data.loop_rank),
    loop_state: STATES.includes(data.loop_state) ? data.loop_state : null,
    loop_goal: str(data.loop_goal),
    decision: DECISIONS.includes(data.decision) ? data.decision : 'untriaged',
    rank: RANKS.includes(data.rank) ? data.rank : null,
    phase: data.phase === 'new' ? 'new' : typeof data.phase === 'number' ? data.phase : null,
    lesson: typeof data.lesson === 'number' ? data.lesson : null,
    since: isPlainDate(data.since) ? data.since : null,
    note: str(data.note),
    body,
  };
}

export function serializeFinding(f) {
  const data = {};
  for (const k of FIELDS) {
    const v = f[k];
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) continue;
    data[k] = v;
  }
  return `---\n${stringifyYaml(data)}---\n\n${f.body.trim()}\n`;
}

/** The finding's "## Our read" section, or null when it has none. */
export function ourRead(f) {
  const at = f.body.search(/^## Our read\s*$/m);
  return at < 0 ? null : f.body.slice(at).replace(/^## Our read\s*/, '').trim();
}

/** What is wrong with a finding, in words meant to be read. */
export function findingProblems(f) {
  const out = [];
  if (!f.loop.length) out.push('no loop ids — nothing links it back to Loop');
  if (f.decision === 'untriaged') return out;
  if (!f.since) out.push('no since — the date it entered this decision');
  if (!f.note) out.push(`no note — a ${f.decision} finding says why`);
  if ((f.decision === 'proposed' || f.decision === 'accepted') && !f.rank) out.push(`no rank — one of ${RANKS.join(', ')}`);
  if (f.decision === 'accepted' && f.rank === 'never') out.push('accepted with rank never — decline it instead');
  if (f.decision === 'accepted' && f.phase === null) out.push('accepted with no phase — say where the work lives, or phase: new');
  const read = ourRead(f);
  if (!read || read.includes(PLACEHOLDER_READ)) out.push('not yet read — prove the claim against the code before proposing or deciding');
  return out;
}

export function slugify(title) {
  const full = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (full.length <= 60) return full;
  const cut = full.slice(0, 61);
  return cut.slice(0, cut.lastIndexOf('-')) || full.slice(0, 60);
}

export function loadFindings(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => n.endsWith('.md') && n !== 'README.md').sort()
    .map(n => parseFinding(readFileSync(join(dir, n), 'utf8'), n.replace(/\.md$/, '')));
}

// ── From Loop's wire format ──────────────────────────────────────────────

const REPO_BLOB = /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\//;

/** One raw insight from `stitch find insights --format json`. */
export function normalizeInsight(raw) {
  const files = Object.values(raw.references ?? {}).map(r => r?.source?.uri).filter(u => typeof u === 'string').map(u => u.replace(REPO_BLOB, ''));
  const goal = raw.priorities?.[0] ?? raw.goals?.[0];
  return {
    id: String(raw.id),
    title: String(raw.title ?? '').trim(),
    description: String(raw.description ?? '').trim(),
    state: STATES.includes(raw.state) ? raw.state : 'ACTIVE',
    rank: [raw.priority, raw.severity].filter(x => typeof x === 'string' && x).join('/') || 'unranked',
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
    goal: typeof goal === 'string' ? goal.split('/').pop() : null,
    files: [...new Set(files)],
  };
}

/** "P1/S0" sorts before "P2/S1", and "P2/S1" before a bare "P2". Unknown sorts last. */
const loopSeverity = rank => `${rank?.match(/P(\d)/)?.[1] ?? '9'}${rank?.match(/S(\d)/)?.[1] ?? '9'}`;

/** Any id still ACTIVE keeps the finding active; else dismissed wins over resolved. */
export function aggregateState(states) {
  if (!states.length) return null;
  if (states.includes('ACTIVE')) return 'ACTIVE';
  if (states.includes('DISMISSED')) return 'DISMISSED';
  return 'RESOLVED';
}

function insightBody(i) {
  const files = i.files.map(f => `- \`${f}\``);
  const conf = i.confidence === null ? '' : `, confidence ${i.confidence}`;
  return [`# ${i.title}`, '', `> **Loop says** (${i.rank}${conf}): ${i.description}`, ...(files.length ? ['', ...files] : []), '', '## Our read', '', PLACEHOLDER_READ].join('\n');
}

/**
 * Fold a fresh pull into the findings on disk. An insight joins the finding
 * that holds its id, else the one with its title (Loop re-files under a new
 * id), else starts a new, untriaged finding. Our fields (decision, rank,
 * phase, lesson, since, note, body) are never touched.
 */
export function reconcile(existing, insights) {
  const findings = existing.map(f => ({ ...f, loop: [...f.loop] }));
  const byId = new Map(), byTitle = new Map(), slugs = new Set(findings.map(f => f.slug));
  for (const f of findings) {
    for (const id of f.loop) byId.set(id, f);
    byTitle.set(f.title.toLowerCase(), f);
  }
  const added = [], refiled = new Set(), seen = new Map();
  for (const i of insights) {
    let f = byId.get(i.id) ?? byTitle.get(i.title.toLowerCase());
    if (!f) {
      let slug = slugify(i.title) || i.id.slice(0, 8);
      if (slugs.has(slug)) slug = `${slug}-${i.id.slice(0, 6)}`;
      slugs.add(slug);
      f = { slug, title: i.title, loop: [], loop_rank: null, loop_state: null, loop_goal: i.goal, decision: 'untriaged', rank: null, phase: null, lesson: null, since: null, note: null, body: insightBody(i) };
      findings.push(f);
      byTitle.set(i.title.toLowerCase(), f);
      added.push(slug);
    }
    if (!f.loop.includes(i.id)) {
      if (!added.includes(f.slug)) refiled.add(f.slug);
      f.loop.push(i.id);
    }
    byId.set(i.id, f);
    seen.set(f, [...(seen.get(f) ?? []), i]);
  }
  const resolvedInLoop = [], dismissedInLoop = [];
  for (const [f, xs] of seen) {
    f.loop_state = aggregateState(xs.map(x => x.state));
    f.loop_rank = xs.map(x => x.rank).sort((a, b) => loopSeverity(a).localeCompare(loopSeverity(b)))[0] ?? f.loop_rank;
    f.loop_goal ??= xs[0].goal;
    if (f.loop_state === 'RESOLVED' && f.decision !== 'done' && f.decision !== 'stale') resolvedInLoop.push(f.slug);
    if (f.loop_state === 'DISMISSED' && (f.decision === 'untriaged' || f.decision === 'proposed')) dismissedInLoop.push(f.slug);
  }
  return { findings, added, refiled: [...refiled], resolvedInLoop, dismissedInLoop };
}

/** Ids still owed a dismissal: every id of a declined or stale finding Loop shows active. */
export function pendingDismissals(findings, insights) {
  const active = new Set(insights.filter(i => i.state === 'ACTIVE').map(i => i.id));
  return findings.filter(f => DISMISSED_BY_US.includes(f.decision)).flatMap(f => f.loop.filter(id => active.has(id)).map(id => ({ slug: f.slug, id })));
}

// ── Views ────────────────────────────────────────────────────────────────

const RANK_ORDER = { now: 0, next: 1, later: 2, never: 3 };
const byRank = (a, b) => (RANK_ORDER[a.rank ?? ''] ?? 4) - (RANK_ORDER[b.rank ?? ''] ?? 4)
  || loopSeverity(a.loop_rank).localeCompare(loopSeverity(b.loop_rank)) || a.title.localeCompare(b.title);

export const LOOP_DOC_HEADER = '<!-- Generated by scripts/loop.mjs. Do not edit — edit the finding in docs/loop/,\n     which is where its decision lives. -->';

/** docs/LOOP.md: every finding, by what it needs from a person. */
export function renderLoopDoc(findings, phases, { run = 'node scripts/loop.mjs', insights = 'https://jules.google.com/jitro' } = {}) {
  const phaseLink = p => {
    if (p === 'new') return 'new phase';
    const ref = phases.find(x => x.n === p);
    return ref ? `[${ref.n} · ${ref.title}](phases/${ref.file})` : p === null ? '—' : String(p);
  };
  const lessonLink = l => l === null ? '' : ` · [lesson ${l}](lessons.md)`;
  const row = f => `| ${f.rank ?? '—'} | [${f.title}](loop/${f.slug}.md) | ${f.loop_rank ?? '—'} | ${phaseLink(f.phase)}${lessonLink(f.lesson)} | ${(f.note ?? '—').replace(/\|/g, '\\|')} |`;
  const table = xs => ['| Ours | Finding | Loop | Where | Why |', '| --- | --- | --- | --- | --- |', ...xs.sort(byRank).map(row), ''];
  const of = d => findings.filter(f => f.decision === d);
  const count = d => of(d).length;
  const out = [
    LOOP_DOC_HEADER,
    '# Loop findings',
    '',
    `What [Stitch Loop](${insights}) found in this`,
    'codebase, **ranked by us, not by Loop**. Each finding is a file in',
    "[`loop/`](loop/) holding Loop's claim, our read of it against the code, and the",
    "decision. Loop's P/S rank is kept only for comparison. Declined and stale",
    'findings are dismissed in Loop, and every decision is sent back to it as a',
    `context so its next pass knows why. Run \`${run} pull\` to fetch,`,
    `\`${run} decide <slug> <decision>\` to decide.`,
    '',
    `**${count('proposed')} to decide · ${count('accepted')} accepted · ${count('declined')} declined · ${count('stale')} stale · ${count('done')} done · ${count('untriaged')} not yet read.**`,
    '',
  ];
  const proposed = of('proposed');
  if (proposed.length) out.push('## Needs your decision', '', 'Proposed rank and home; `never` is a recommendation to decline.', '', ...table(proposed));
  const accepted = of('accepted');
  if (accepted.length) {
    out.push('## Accepted, by phase', '');
    const groups = new Map();
    for (const f of accepted) groups.set(String(f.phase), [...(groups.get(String(f.phase)) ?? []), f]);
    const keys = [...groups.keys()].sort((a, b) => a === 'new' ? 1 : b === 'new' ? -1 : Number(a) - Number(b));
    for (const k of keys) out.push(`<a id="phase-${k}"></a>`, `### ${phaseLink(groups.get(k)[0].phase)}`, '', ...table(groups.get(k)));
  }
  for (const [d, heading, lede] of [
    ['declined', 'Declined', 'Real, and not doing it. Dismissed in Loop, with the reason sent back.'],
    ['stale', 'Stale', 'The claim does not match the code. Dismissed in Loop, with the evidence sent back.'],
    ['done', 'Done', ''],
  ]) {
    const xs = of(d);
    if (xs.length) out.push(`## ${heading}`, '', ...(lede ? [lede, ''] : []), ...table(xs));
  }
  const untriaged = of('untriaged');
  if (untriaged.length) out.push('## Not yet read', '', ...untriaged.sort(byRank).map(f => `- [${f.title}](loop/${f.slug}.md) — Loop ${f.loop_rank ?? '?'}`), '');
  const broken = findings.filter(f => findingProblems(f).length);
  if (broken.length) {
    out.push('## Needs fixing', '');
    for (const f of broken) out.push(`- [\`${f.slug}\`](loop/${f.slug}.md) — ${findingProblems(f).join('; ')}`);
    out.push('');
  }
  return out.join('\n');
}

/** The context sent back to Loop: decisions only, never a proposal. */
export function contextPayload(findings, phases, kind) {
  const phaseName = p => p === 'new' ? 'a new phase' : p === null ? null : phases.find(x => x.n === p)?.title ?? `phase ${p}`;
  const decided = findings.filter(f => f.decision !== 'untriaged' && f.decision !== 'proposed').sort((a, b) => a.decision.localeCompare(b.decision) || byRank(a, b));
  return {
    kind,
    guidance:
      'The developer triages every Loop insight in the repo under docs/loop/ and ranks it independently ' +
      '(now, next, later, never). Do not re-file an insight recorded here as declined or stale unless the ' +
      'code has changed in a way that answers the stated reason. Accepted insights are planned work, in the named phase.',
    decisions: decided.map(f => ({ title: f.title, decision: f.decision, rank: f.rank, phase: phaseName(f.phase), reason: f.note, decided: f.since, insights: f.loop })),
  };
}

// ── The project ──────────────────────────────────────────────────────────

const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Per-project wording and names, from .keel/keel.json "loop". */
export function settings(root = ROOT) {
  const keel = readJson(join(root, '.keel', 'keel.json'));
  const own = keel.loop && typeof keel.loop === 'object' ? keel.loop : {};
  const display = typeof keel.name === 'string' && keel.name ? keel.name : basename(root);
  const name = display.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  return {
    display,
    name,
    run: own.run ?? 'node scripts/loop.mjs',
    insights: own.insights ?? 'https://jules.google.com/jitro',
    source: own.source ?? `${name}:docs/loop`,
    kind: own.kind ?? `${name}-triage-decisions`,
  };
}

export function phases(root = ROOT) {
  const dir = join(root, 'docs', 'phases');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => n.endsWith('.md') && n !== 'README.md').map(file => {
    const raw = readFileSync(join(dir, file), 'utf8');
    return { n: Number(file.split('-')[0]), title: raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file, file };
  }).sort((a, b) => a.n - b.n);
}

/**
 * docs/LOOP.md against the findings. With check, writes nothing and returns
 * { ok, stale, problems }; a project with no findings and no docs/LOOP.md has
 * pulled nothing yet, and is current.
 */
export function render(root = ROOT, { check = false } = {}) {
  const dir = join(root, 'docs', 'loop'), out = join(root, 'docs', 'LOOP.md');
  const findings = loadFindings(dir);
  const s = settings(root);
  const page = `${renderLoopDoc(findings, phases(root), s)}\n`;
  if (!check) { writeFileSync(out, page); return { ok: true, stale: false, problems: [] }; }
  if (!findings.length && !existsSync(out)) return { ok: true, stale: false, problems: [] };
  const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
  const stale = current.trim() !== page.trim();
  const problems = findings.flatMap(f => findingProblems(f).map(p => `docs/loop/${f.slug}.md: ${p}`));
  return { ok: !stale && !problems.length, stale, problems };
}

// ── stitch ───────────────────────────────────────────────────────────────

function workspace(root, env) {
  const ws = env.LOOP_WORKSPACE || readJson(join(root, '.stitch.json')).workspace;
  if (!ws) throw new LoopError('No Loop workspace: put its id in .stitch.json ("workspace"), or set LOOP_WORKSPACE.');
  return ws;
}

/**
 * Run stitch and return `data` from its JSON envelope, or throw its error.
 * Its stdout goes to a file, not a pipe: stitch exits before a piped stdout
 * drains, so anything past the first 64KB — most of a list of insights — is
 * cut off mid-JSON. A file descriptor is written synchronously.
 */
async function stitch(args, { root, env, format = true }) {
  const bin = env.KEEL_STITCH || 'stitch';
  const dir = mkdtempSync(join(tmpdir(), 'keel-loop-'));
  const file = join(dir, 'out.json');
  const fd = openSync(file, 'w');
  let code;
  try {
    code = await new Promise((done, fail) => {
      const child = spawn(bin, [...args, ...(format ? ['--format', 'json'] : []), '-q'], { cwd: root, env: { ...env, LOOP_INCLUDE_DISMISSED: '1' }, stdio: ['ignore', fd, fd] });
      child.on('error', e => fail(e.code === 'ENOENT' ? new LoopError(`${bin} is not installed (set KEEL_STITCH, or put stitch on PATH)`) : e));
      child.on('close', done);
    });
  } finally { closeSync(fd); }
  const stdout = readFileSync(file, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  let out;
  try { out = JSON.parse(stdout); } catch { throw new LoopError(`stitch ${args.join(' ')} (exit ${code}): unreadable output\n${stdout.slice(0, 500)}`); }
  if (out.success === false || out.error) throw new LoopError(`stitch ${args.slice(0, 2).join(' ')}: ${out.error?.message ?? JSON.stringify(out.error ?? {})}`);
  return out.data ?? out;
}

// ── fields from flags ────────────────────────────────────────────────────

function applyFields(f, v) {
  if (typeof v.rank === 'string') {
    if (!RANKS.includes(v.rank)) throw new LoopError(`--rank must be one of ${RANKS.join(', ')}`, 2);
    f.rank = v.rank;
  }
  if (typeof v.phase === 'string') {
    f.phase = v.phase === 'new' ? 'new' : v.phase === 'none' ? null : Number(v.phase);
    if (typeof f.phase === 'number' && !Number.isInteger(f.phase)) throw new LoopError('--phase is a phase number, new, or none', 2);
  }
  if (typeof v.lesson === 'string') {
    f.lesson = v.lesson === 'none' ? null : Number(v.lesson);
    if (typeof f.lesson === 'number' && !Number.isInteger(f.lesson)) throw new LoopError('--lesson is a lesson number, or none', 2);
  }
  if (typeof v.note === 'string') f.note = v.note.trim();
  if (typeof v.read === 'string') {
    const [head] = f.body.split(/\n## Our read\n/);
    f.body = `${head.trimEnd()}\n\n## Our read\n\n${v.read.trim()}`;
  }
}

// ── the verbs ────────────────────────────────────────────────────────────

const USAGE = 'node scripts/loop.mjs pull | list [--json] [-d <decision>] | propose <slug> --rank … --note … --read … | decide <slug> <decision> (--no-push | --yes) | push (--dry-run | --yes) | mine [priority…] --yes | render [--check]';

/** Run one command. Returns its exit code; prints to `log` and `err`. */
export async function main(argv, { root = ROOT, env = process.env, log = console.log, err = console.error } = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        rank: { type: 'string' }, phase: { type: 'string' }, lesson: { type: 'string' }, note: { type: 'string' }, read: { type: 'string' },
        decision: { type: 'string', short: 'd' }, json: { type: 'boolean' }, check: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
        'no-push': { type: 'boolean' }, 'no-render': { type: 'boolean' }, yes: { type: 'boolean' },
      },
    });
  } catch (e) { err(`${e.message}\n${USAGE}`); return 2; }
  const { values: v, positionals } = parsed;
  const [cmd = 'list', ...rest] = positionals;
  const DIR = join(root, 'docs', 'loop');
  const s = settings(root);
  const call = (args, opts = {}) => stitch(args, { root, env, ...opts });
  const save = f => { mkdirSync(DIR, { recursive: true }); writeFileSync(join(DIR, `${f.slug}.md`), serializeFinding(f)); };
  const find = ref => {
    const hits = loadFindings(DIR).filter(f => f.slug === ref || (ref && f.loop.some(id => id.startsWith(ref))));
    if (hits.length !== 1) throw new LoopError(hits.length ? `"${ref}" matches ${hits.map(h => h.slug).join(', ')}` : `no finding "${ref}" in docs/loop/`);
    return hits[0];
  };
  const fetchInsights = async ws => ((await call(['find', 'insights', '-w', ws, '--limit', '1000'])).items ?? []).map(normalizeInsight);

  /** Put one derived context in Loop: replaced whole, never patched. */
  const upsertContext = async (ws, dryRun, c) => {
    const contexts = (await call(['find', 'contexts', '-w', ws])).items ?? [];
    const listed = contexts.find(x => x.dataSource === c.source);
    const contextId = listed ? (listed.id ?? String(listed.name).split('/').pop()) : null;
    const mine = contextId ? await call(['get', 'context', contextId, '-w', ws]) : null;
    if (mine && mine.data === c.data) { log(`Loop context "${c.source}" is already current.`); return false; }
    if (dryRun) { log(`would ${mine ? 'update' : 'create'} the Loop context "${c.source}" (${c.data.length} chars)`); return true; }
    if (contextId) await call(['delete', 'context', contextId, '-w', ws]);
    await call(['create', 'context', '-w', ws, '--json', JSON.stringify({ body: { data: c.data, dataSource: c.source, description: c.description, annotations: c.annotations } })]);
    log(`${mine ? 'updated' : 'created'} the Loop context "${c.source}".`);
    return true;
  };

  /** Dismiss what we declined or found stale; send every decision as one context. Returns whether anything is (or would be) sent. */
  const push = async dryRun => {
    const ws = workspace(root, env);
    const findings = loadFindings(DIR);
    const dismiss = pendingDismissals(findings, await fetchInsights(ws));
    if (dismiss.length) {
      log(`${dryRun ? 'would dismiss' : 'dismissing'} ${dismiss.length} Loop insight(s):`);
      for (const d of dismiss) log(`  ${d.id.slice(0, 8)}  ${d.slug}`);
      if (!dryRun) {
        // As a JSON payload, not positional ids: `stitch dismiss` (v0.10) reads
        // the value of `--format json` as one more id to dismiss.
        const payload = { resource: 'insights', ids: dismiss.map(d => d.id), workspace: ws, concurrency: 5 };
        const res = await call(['dismiss', '--json', JSON.stringify(payload)], { format: false });
        for (const f of res.failed ?? []) err(`  Loop refused ${JSON.stringify(f)}`);
      }
    }
    const payload = contextPayload(findings, phases(root), s.kind);
    let context = false;
    if (payload.decisions.length) {
      context = await upsertContext(ws, dryRun, {
        source: s.source,
        data: JSON.stringify(payload),
        description: `${s.display}'s triage decisions on Loop insights: what was declined or found stale and why, and how accepted work is ranked. Generated from docs/loop/ in the repo.`,
        annotations: { [s.name]: 'triage' },
      });
    } else log('No decisions yet — nothing to send as the triage context.');
    return dismiss.length > 0 || context;
  };

  const needsYes = (what, plan) => {
    err([...plan, '', `⚑ ${what} sends to the Loop workspace, which other people read; it needs --yes. Nothing was sent.`].join('\n'));
    return 3;
  };

  try {
    switch (cmd) {
      case 'pull': {
        const ws = workspace(root, env);
        const insights = await fetchInsights(ws);
        const r = reconcile(loadFindings(DIR), insights);
        for (const f of r.findings) save(f);
        render(root);
        const say = (label, xs) => xs.length && log(`${label} (${xs.length}): ${xs.join(', ')}`);
        log(`${r.findings.length} findings in docs/loop/.`);
        say('new', r.added);
        say('re-filed by Loop under a new id', r.refiled);
        say('Loop now reports resolved — worth checking and marking done', r.resolvedInLoop);
        say('dismissed in Loop with no decision here', r.dismissedInLoop);
        const owed = pendingDismissals(r.findings, insights);
        if (owed.length) log(`${owed.length} declined id(s) still active in Loop — a person runs: ${s.run} push --yes`);
        return 0;
      }
      case 'list': {
        const all = loadFindings(DIR);
        if (v.decision && !DECISIONS.includes(v.decision)) throw new LoopError(`-d is one of ${DECISIONS.join(', ')}`, 2);
        const xs = v.decision ? all.filter(f => f.decision === v.decision) : all;
        if (v.json) log(JSON.stringify(xs.map(({ body, ...f }) => f), null, 2));
        else for (const f of xs) log(`${f.decision.padEnd(10)} ${(f.rank ?? '-').padEnd(5)} ${(f.loop_rank ?? '').padEnd(6)} ${f.slug}`);
        return 0;
      }
      case 'propose': {
        const f = find(rest[0] ?? '');
        if (f.decision !== 'untriaged' && f.decision !== 'proposed') throw new LoopError(`${f.slug} is already ${f.decision} — that was a decision, and a proposal does not override it`);
        applyFields(f, v);
        f.decision = 'proposed';
        f.since = today();
        const read = ourRead(f);
        if (!read || read.includes(PLACEHOLDER_READ) || !CITES.test(read)) throw new LoopError(`${f.slug}: --read must say what the code shows, citing file:line (e.g. lib/acme.mjs:42)`);
        const problems = findingProblems(f);
        if (problems.length) throw new LoopError(`${f.slug}: ${problems.join('; ')}`);
        save(f);
        if (!v['no-render']) render(root);
        log(`proposed ${f.slug}: ${f.rank}${f.phase === null ? '' : `, phase ${f.phase}`}`);
        return 0;
      }
      case 'decide': {
        const [ref, decision] = rest;
        if (!DECISIONS.includes(decision)) throw new LoopError(`decision is one of ${DECISIONS.join(', ')}`, 2);
        const f = find(ref ?? '');
        applyFields(f, v);
        f.decision = decision;
        f.since = today();
        const problems = findingProblems(f);
        if (problems.length) throw new LoopError(`${f.slug}: ${problems.join('; ')}`);
        if (!v['no-push'] && !v.yes) {
          return needsYes('Deciding', [`would record ${f.slug} as ${decision}, then push every decision to Loop${DISMISSED_BY_US.includes(decision) ? ` (dismissing ${f.loop.length} id(s))` : ''}.`,
            `A person's call. Record it without sending: ${s.run} decide ${f.slug} ${decision} --no-push`]);
        }
        save(f);
        render(root);
        log(`${f.slug} is ${f.decision}.`);
        if (!v['no-push']) await push(false);
        return 0;
      }
      case 'push': {
        if (v['dry-run']) { await push(true); return 0; }
        if (!v.yes) return (await push(true)) ? needsYes('Pushing', ['The plan is above.']) : 0;
        await push(false);
        return 0;
      }
      case 'mine': {
        // One request per priority: the API refuses several goals in one call
        // (v0.10), and `generate` ignores .stitch.json, so -w is explicit. It
        // runs on Loop's side; pull in a while to see what changed.
        const ws = workspace(root, env);
        const ids = rest.length ? rest : ((await call(['find', 'priorities', '-w', ws])).items ?? []).map(p => p.id);
        if (!v.yes) return needsYes('Mining', [`would ask Loop to re-mine ${ids.length} priorit${ids.length === 1 ? 'y' : 'ies'}: ${ids.join(', ') || 'none'}`]);
        for (const id of ids) log(`${id}: ${(await call(['generate', 'insights', '-w', ws, '--priority', id])).state ?? 'requested'}`);
        log(`Loop is re-mining. Run \`${s.run} pull\` in 10–20 minutes to see what it found and resolved.`);
        return 0;
      }
      case 'render': {
        if (!v.check) { render(root); log('wrote docs/LOOP.md'); return 0; }
        const r = render(root, { check: true });
        if (r.stale) err(`docs/LOOP.md is out of date — run: ${s.run} render`);
        for (const p of r.problems) err(p);
        if (r.ok) log('docs/LOOP.md is current');
        return r.ok ? 0 : 1;
      }
      default:
        throw new LoopError(`unknown command "${cmd}" — pull, list, propose, decide, push, mine, render\n${USAGE}`, 2);
    }
  } catch (e) {
    err(e.message);
    return e.exitCode ?? 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

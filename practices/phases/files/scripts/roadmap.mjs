// The roadmap is a checked view; each phase file owns its status.
// Lineage: isocan → ledger (scripts/roadmap.ts) → cajones (scripts/roadmap.mjs) → here.
// No YAML dependency: the documented flat metadata format is intentionally small.
//
//   node scripts/roadmap.mjs            regenerate docs/ROADMAP.md
//   node scripts/roadmap.mjs --check    fail if invalid or stale (CI runs this)
//   node scripts/roadmap.mjs --next     the next phase to conduct, and its next action
//   node scripts/roadmap.mjs --json     everything, for an agent; never parse the markdown
//
// --check also reads each phase as a spec (specProblems): text left from the
// template fails at any status, and a phase with `spec: 2` must name the
// check behind every acceptance box and list its Real surfaces, and never ask
// for a night measure with no bound (the selftest refuses one). Writing the
// roadmap does not: a phase just drafted by `keel phase new` still lists.
// It notes, never refuses, a phase with an open ⚑ walk and no ## Your part
// (yourPartNotes): the owner's ask in plain words is advice to write.
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STATUSES = ['planned', 'designed', 'partial', 'built', 'lived-in', 'superseded'];
export const DONE = ['built', 'lived-in'];
const SECTIONS = ['Done when', 'Scope', 'Acceptance', 'Proof', 'Deliberately open', 'Next action'];
const FIELDS = ['status', 'since', 'goal', 'spec', 'depends', 'note', 'evidence', 'issue', 'review', 'owes', 'after', 'waits'];
/** `review: wait` opts a phase in to waiting for its PR's reviewers (keel phase 41); absent is the default: no wait. */
export const REVIEW_VALUES = Object.freeze(['wait']);
/**
 * `owes: walk` (keel phase 44), valid only on a partial phase: its building is
 * done and its rest is a walk or time. Its dependents may proceed and the next
 * phase skips it; it stays partial, because built still means proven.
 */
export const OWES_VALUES = Object.freeze(['walk']);
/**
 * `waits:` (keel phase 51), only beside `owes: walk`: whose the walk is. The
 * owner's read (the default: a ⚑ box is the owner's), a date or a number of
 * nights (time), or a thing outside (a secret set, another repo's release).
 */
export const WAITS_VALUES = Object.freeze(['owner', 'time', 'external']);
/** Whose walk a phase owes: its `waits:`, else the owner's. */
export const waitsOf = p => p.waits ?? 'owner';
/** A real calendar date, YYYY-MM-DD. */
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
/** Today as YYYY-MM-DD on this machine's calendar (the owner's day, not UTC's). */
export const localToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/**
 * `after: YYYY-MM-DD` (keel phase 51): not buildable before that date. With a
 * `today`, a phase is dated while today is before it; with `today` null (the
 * generated roadmap, which must not go stale when a day passes), any phase
 * still carrying `after:` is dated, and the roadmap says "on or after".
 */
export const dated = (p, today) => typeof p.after === 'string' && !DONE.includes(p.status) && p.status !== 'superseded' && (today == null || today < p.after);
/** A partial phase that owes only a walk: it satisfies `depends:` and is never next. */
export const owesWalk = p => p.status === 'partial' && p.owes === 'walk';
/** A dependency is satisfied by built, lived-in, or a partial phase that owes only a walk. */
export const satisfies = p => DONE.includes(p.status) || owesWalk(p);
/** The newest spec version this script knows. A phase with `spec: 2` names its checks and its Real surfaces. */
export const SPEC = 2;
/**
 * The phase template's placeholder text (docs/templates/phase.md), one entry
 * per line, list and checkbox markers stripped. A phase still holding one
 * fails --check at any status; tests/roadmap.test.mjs reads the template and
 * fails when a line in it is missing here, so the two cannot drift apart.
 */
export const PLACEHOLDER_TITLE = 'Outcome, as the person who uses it would say it';
export const PLACEHOLDERS = Object.freeze([
  'One independently checkable outcome.',
  'The smallest useful slice, and its boundaries.',
  'Observable behaviour, including the failure path, and the check that proves it: `tests/<file>: "<test name>"`, a command in backticks, or ⚑ by hand: <who>.',
  '<surface>: <its proof>, one line for each place this runs for real (published package, workflow shell, adopted project, owner\'s machine, GitHub API, fleet over time); or the single line none.',
  'Automated: exact commands and what each one proves.',
  'By hand: who does what, and what would change the design.',
  '⚑ Anything that creates a resource, spends money or needs a login — with the price.',
  'An unsettled decision, why it is open, and what will settle it.',
  'A known limitation that could make this phase\'s output wrong (a suggestion, a count, a verdict): its effect, and when it is settled. Here, never only in a design\'s prose.',
  'One concrete action that advances this phase.',
  '**YYYY-MM-DD** — Claim. Evidence.',
  '**Ask:** What the owner does, in one plain sentence, with no keel words.',
  '**Why:** What it settles or unblocks, in one sentence.',
  '**Look at:** The one thing to read or open first; a [link](url) is fine.',
  '**Choices:** First choice | Second choice',
  '**Takes:** About how long, e.g. 5 minutes.',
  '**Then:** What happens after each choice, where they differ.',
  '**Ready:** yes, or **Ready when:** what must happen first.',
]);
/** Where a change runs for real (a closed list; `none` is a full answer). */
export const SURFACES = Object.freeze(['published package', 'workflow shell', 'adopted project', "owner's machine", 'GitHub API', 'fleet over time']);
/** A cited test: tests/<path>, not a path that merely ends in tests/. */
const TEST_PATH = /(?<![\w./-])tests\/[\w./-]*\w/g;
const strip = line => line.trim().replace(/^- \[[ x]\]\s*/, '').replace(/^-\s+/, '').trim();

/**
 * A phase's `## Your part` (keel phase 51's follow-up): what the owner is
 * asked, in plain words, for a phase with a ⚑ walk. One bullet per field,
 * `- **Ask:** …`; Choices are split on " | ", and so is Keeps it open (the
 * choices, among Choices, that record an answer and leave the walk open);
 * `**Ready:** yes` is ready,
 * `**Ready when:** <what first>` is not ({ when }). A Markdown table may
 * follow the bullets. With `### ` sub-headings, one part per walk box: the
 * phase's yourPart is the first, with every part in `parts`. null when the
 * section is absent or empty.
 */
export const YOUR_PART_FIELDS = Object.freeze({ 'Ask': 'ask', 'Why': 'why', 'Look at': 'look', 'Choices': 'choices', 'Keeps it open': 'keepsOpen', 'Takes': 'takes', 'Then': 'then', 'Ready': 'ready', 'Ready when': 'readyWhen' });
export function yourPartOf(text) {
  if (!text || !String(text).trim()) return null;
  const blocks = [];
  let current = { heading: null, lines: [] };
  for (const line of String(text).split(/\r?\n/)) {
    const sub = /^### +(.+?)\s*$/.exec(line);
    if (sub) { if (current.heading !== null || current.lines.some(l => l.trim())) blocks.push(current); current = { heading: sub[1], lines: [] }; }
    else current.lines.push(line);
  }
  blocks.push(current);
  const headed = blocks.some(b => b.heading !== null);
  // With headed parts, text before the first heading (the template's comment, a line of preamble) is not a part unless it says something a part says.
  const parts = blocks.filter(b => b.heading !== null || b.lines.some(l => l.trim())).map(b => partOf(b.lines, b.heading))
    .filter(p => p.heading !== null || !headed || p.ask || p.choices.length || p.ready !== null || p.table);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : { ...parts[0], parts };
}

function partOf(lines, heading) {
  const part = { heading, ask: null, why: null, look: null, choices: [], keepsOpen: [], takes: null, then: null, ready: null, table: null };
  const rows = [];
  let field = null;
  for (const line of lines) {
    if (/^\s*\|/.test(line)) { rows.push(line.trim()); field = null; continue; }
    const bullet = /^[-*]\s+\*\*([^*]+?):\*\*\s*(.*)$/.exec(line);
    if (bullet) { field = YOUR_PART_FIELDS[bullet[1].trim()] ?? null; if (field) part[field] = bullet[2].trim(); continue; }
    if (field && /^\s+\S/.test(line)) { part[field] = `${part[field]} ${line.trim()}`.trim(); continue; }
    if (!line.trim()) field = null;
  }
  const list = v => typeof v === 'string' ? v.split(/\s+\|\s+/).map(c => c.trim()).filter(Boolean) : [];
  part.choices = list(part.choices);
  // The choices that defer: they record the owner's answer and leave the walk open.
  part.keepsOpen = list(part.keepsOpen);
  const when = part.readyWhen;
  delete part.readyWhen;
  part.ready = when ? { when } : typeof part.ready === 'string' ? (/^yes\b/i.test(part.ready) ? true : { when: part.ready }) : null;
  const cells = row => row.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replaceAll('\\|', '|'));
  const body = rows.filter(r => !/^\|?[\s:|-]+\|?$/.test(r) || !r.includes('-'));
  if (body.length) part.table = { head: cells(body[0]), rows: body.slice(1).map(cells) };
  return part;
}

/** Whether a Your part is ready for the owner: every part says Ready: yes (a part that says neither counts as ready; the check notes it). */
export const yourPartReady = yp => !!yp && (yp.parts ?? [yp]).every(p => p.ready === null || p.ready === true);

/** What a Your part's Then says for one choice: the text after "<choice>:" up to the next choice named so, else the whole Then. */
export function thenFor(then, choices = [], choice) {
  if (!then) return null;
  const at = c => { const m = new RegExp(`(^|[\\s.;(])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(:|→)`, 'i').exec(then); return m ? { start: m.index + m[1].length, end: m.index + m[0].length } : null; };
  const mine = at(choice);
  if (!mine) return then;
  const next = choices.filter(c => c !== choice).map(at).filter(m => m && m.start > mine.start).sort((a, b) => a.start - b.start)[0];
  return then.slice(mine.end, next ? next.start : undefined).trim().replace(/[;,]$/, '').trim() || then;
}

/**
 * What --check notes about a phase's Your part (advice, never a failure): a
 * phase with an open ⚑ walk and no Your part, and a Your part missing its
 * Ask, its Choices or its Ready.
 */
export function yourPartNotes(file, raw) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!block) return [];
  const status = /^status:\s*(\S+)\s*$/m.exec(block[1])?.[1];
  if (status === 'superseded' || DONE.includes(status)) return [];
  const sections = sectionsOf(block[2]);
  const walks = boxes(sections.Acceptance).filter(b => !b.checked && isWalk(b.text));
  const id = Number(/^(\d+)/.exec(file)?.[1]);
  const yp = yourPartOf(sections['Your part']);
  if (!yp) return walks.length ? [`docs/phases/${file}: phase ${id} has a walk but no Your part: say in plain words what the owner should do`] : [];
  const out = [];
  const parts = yp.parts ?? [yp];
  if (walks.length > 1 && parts.length < walks.length) out.push(`docs/phases/${file}: phase ${id} has ${walks.length} walks but ${parts.length === 1 ? 'one Your part' : `${parts.length} Your parts`}: give each walk box its own \`### \` part, in order`);
  for (const p of parts) {
    const where = `docs/phases/${file}: ## Your part${p.heading ? ` (${p.heading})` : ''}`;
    if (!p.ask) out.push(`${where} has no **Ask:**; say in one plain sentence what the owner does`);
    if (!p.choices.length) out.push(`${where} has no **Choices:**; list what the owner can answer, A | B`);
    for (const c of p.keepsOpen.filter(c => !p.choices.includes(c))) out.push(`${where}: **Keeps it open:** names "${c}", which is not one of its Choices`);
    if (p.ready === null) out.push(`${where} says neither **Ready:** yes nor **Ready when:** <what first>`);
  }
  return out;
}

/** A phase body's `## Name` sections: { name: text }. */
export function sectionsOf(body) {
  const out = {};
  for (const m of body.matchAll(/^## (.+?)[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) out[m[1]] ??= m[2].trim();
  return out;
}

/** Acceptance's boxes: [{ checked, text }], a box's wrapped lines joined to it. */
export function boxes(acceptance = '') {
  const out = [];
  for (const line of acceptance.split(/\r?\n/)) {
    const box = /^- \[([ x])\]\s*(.*)$/.exec(line);
    if (box) out.push({ checked: box[1] === 'x', text: box[2] });
    else if (out.length && /^\s+\S/.test(line)) out.at(-1).text += ` ${line.trim()}`;
  }
  return out;
}

/** Whether a box names its check: a tests/ path, a command in backticks (a program and its arguments), or ⚑ by hand. */
export function namesCheck(text) {
  if (text.match(TEST_PATH)) return true;
  if (/⚑\s*by hand/i.test(text)) return true;
  return [...text.matchAll(/`([^`]+)`/g)].some(m => /^[\w.\/-]+\s+\S/.test(m[1].trim()));
}

/**
 * Whether an unchecked box is a walk rather than something still to build: it
 * is "⚑ by hand", or its check is a command that runs on a real surface
 * (a backticked `gh …`), and it cites no tests/ path. When unsure it is
 * buildable, so `owes: walk` is refused rather than hiding work.
 */
export function isWalk(text) {
  if (text.match(TEST_PATH)) return false;
  const spans = [...text.matchAll(/`([^`]+)`/g)].map(m => m[1].trim());
  // A command beside a hand step is still work to build (Codex on cajones#54, #55): "`npm run build`, then ⚑ by hand".
  // Any command but the real-surface `gh …` check counts, recognised or not.
  if (spans.some(s => COMMAND.test(s) && !/^gh\s/.test(s))) return false;
  if (/⚑\s*by hand/i.test(text)) return true;
  return spans.some(s => /^gh\s+\S/.test(s));
}

/**
 * A command in backticks, read conservatively (when unsure, it is work to
 * build): a path to run (`./scripts/build.sh`), a known tool and its
 * arguments (`npm run build`), a word followed by a flag (`pytest -q`), or
 * any span of two words or more that starts lowercase, listed tool or not
 * (`keel doctor`, `make release`: Codex on duo#84). A label starting with a
 * capital (`Start practice`: cajones#56), a single bare name (`codex/`,
 * `machine_prs`) and a JSON setting are not.
 */
const RUNNERS = /^(?:npm|npx|node|pnpm|yarn|bun|deno|make|bash|sh|cargo|go|python3?|pip|uv|tsc|vitest|jest|pytest|git|docker)\s+\S/;
const WORDS = /^[a-z][\w.-]*\s+\S/;
const COMMAND = { test: s => /^\.{0,2}\/\S/.test(s) || RUNNERS.test(s) || /^[a-z][\w.-]*(?:\s+\S+)*?\s+--?[a-z]/.test(s) || WORDS.test(s) };

/** The tests/ paths a phase's Acceptance cites. */
export const citedTests = acceptance => [...new Set((acceptance.match(TEST_PATH) ?? []))];

/** A line asking for a measure that has no bound (the night's selftest refuses one: lesson 6). */
export const UNBOUNDED_MEASURE = /\bmeasure[^.\n]*\b(no bound|unbounded|recorded only|recorded-only|without (a )?bound)/i;

/** A section's items: a bullet with its wrapped lines, or a paragraph, as one line each. */
export function items(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) { out.push(''); continue; }
    const starts = /^\s*([-*+]|\d+[.)])\s/.test(line);
    if (!starts && out.length && out.at(-1) !== '') out[out.length - 1] += ` ${line.trim()}`;
    else out.push(line);
  }
  return out.filter(Boolean);
}

/** The measures an item names: the code span after each "measure"/"measured", and the one just before a "measure". */
const measureNames = item => [...new Set([...item.matchAll(/\bmeasure[sd]?\b[^`]*?`([a-z]\w*)`/gi), ...item.matchAll(/`([a-z]\w*)`\s+(?:night\s+)?measure/gi)].map(m => m[1]))];

/** The night is named, and not only to deny it: "not a night measure" / "isn't the night's" is a study's or a product's measure. */
const nightMeant = item => /\bnight/i.test(item.replace(/\b(?:not|never|isn't|is not)\s+(?:an?\s+|the\s+)?night(?:'s)?(?:\s+measure)?/gi, ''));

/** The phrase that says "no bound", on its own: a clause holding it is unbounded. */
const NO_BOUND = /\b(no bound|unbounded|recorded only|recorded-only|without (a )?bound)\b/i;

/**
 * The measures an item asks for with no bound, clause by clause (split on
 * "." and ";"): a clause with the no-bound phrase governs the measures it
 * names, or, naming none, those of the clause before it ("No night measure
 * `x` has a bound; it is recorded only"). A bounded measure in another clause
 * of the same item is not governed.
 */
function unboundedNames(item) {
  let before = [];
  const out = [];
  let found = false;
  for (const clause of item.split(/[.;](?:\s+|$)/)) {
    const names = measureNames(clause);
    // A clause naming no measure continues the one before only when its subject is a pronoun ("it is recorded only").
    const continues = /^\s*(?:and\s+)?(?:it|this|that|which)\b/i.test(clause);
    if (NO_BOUND.test(clause) && (/\bmeasure/i.test(clause) || (continues && before.length))) { found = true; out.push(...(names.length ? names : before)); }
    before = names.length ? names : before;
  }
  return found ? [...new Set(out)] : null;
}

/**
 * spec 2: a Scope or Acceptance item asking for a night measure with no bound.
 * The night's selftest refuses a measure the unhealthy fixture never puts
 * outside, so such a phase cannot be wired as written (keel phase 42). A
 * measure whose Deliberately open or Trajectory names it with the selftest
 * has been faced, and passes.
 */
function unboundedMeasures(sections, where) {
  const faced = ['Deliberately open', 'Trajectory'].flatMap(s => items(sections[s] ?? '')).filter(l => /selftest/i.test(l));
  const out = [];
  for (const section of ['Scope', 'Acceptance']) for (const item of items(sections[section] ?? '')) {
    // The night's measures only: a product's or a study's "recorded only" is not the selftest's business.
    if (!nightMeant(item)) continue;
    // Every measure the unbounded clauses govern must be faced; an unbounded clause naming none is not.
    const names = unboundedNames(item);
    if (!names) continue;
    if (names.length && names.every(n => faced.some(l => l.includes(`\`${n}\``)))) continue;
    const text = item.replace(/^\s*(- (\[[ x]\] )?)?/, '').trim();
    out.push(`${where(section)}: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}" asks for a measure with no bound, and the night's selftest refuses a measure its unhealthy fixture never puts outside; give it an optional bound the selftest fixture sets (as build_time has), or make it a line on the health page instead of a measure`);
  }
  return out;
}

/**
 * What --check notes but never refuses: for `spec: 2`, a night measure asked
 * for with no bound. The check reads prose, so it can misjudge a sentence; a
 * misjudgement must never fail a project's CI (five rounds of review found
 * wordings it got wrong), so it advises and the person decides.
 */
export function specNotes(file, raw) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!block || /^status:\s*superseded\s*$/m.test(block[1])) return [];
  const walk = yourPartNotes(file, raw);
  if (Number(/^spec:\s*(\d+)\s*$/m.exec(block[1])?.[1] ?? 0) < 2) return walk;
  return [...unboundedMeasures(sectionsOf(block[2]), section => `docs/phases/${file}: ## ${section}`), ...walk];
}

/**
 * What --check refuses in a phase that parses: template text left in a
 * section (any status but superseded), and for `spec: 2` a box naming no check, a Real
 * surfaces section off its vocabulary. [] when it reads as a spec. (A measure with no bound is a note: specNotes.)
 */
export function specProblems(file, raw) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!block) return [];
  // A superseded phase is retired, not proven: a draft retired with its goal
  // is never owed the words it was never given.
  if (/^status:\s*superseded\s*$/m.test(block[1])) return [];
  const spec = Number(/^spec:\s*(\d+)\s*$/m.exec(block[1])?.[1] ?? 0);
  const body = block[2];
  const where = section => `docs/phases/${file}: ## ${section}`;
  const problems = [];
  if (/^# (.+)$/m.exec(body)?.[1]?.trim() === PLACEHOLDER_TITLE) problems.push(`docs/phases/${file}: the title is the template's; name the outcome`);
  const sections = sectionsOf(body), templated = new Set();
  for (const [section, text] of Object.entries(sections)) {
    const left = text.split(/\r?\n/).map(strip).filter(line => PLACEHOLDERS.some(p => line.includes(p)));
    if (!left.length) continue;
    templated.add(section);
    problems.push(`${where(section)} still holds the template's text ("${left[0]}"); ${section === 'Trajectory' ? 'delete the section until something changes the course' : section === 'Your part' ? 'delete the section when the phase has no ⚑ walk; otherwise say in plain words what the owner should do' : 'write what this phase means'}`);
  }
  if (spec < 2) return problems;
  if (!templated.has('Acceptance')) for (const box of boxes(sections.Acceptance)) {
    if (!namesCheck(box.text)) problems.push(`${where('Acceptance')}: "${box.text.slice(0, 60)}${box.text.length > 60 ? '…' : ''}" names no check; end it with tests/<file>: "<test name>", a command in backticks, or ⚑ by hand: <who>`);
  }
  const surfaces = sections['Real surfaces'];
  if (surfaces === undefined || !surfaces) {
    problems.push(`${where('Real surfaces')} is missing or empty (spec: 2); list each place this runs for real as "- <surface>: <its proof>", or write none`);
    return problems;
  }
  if (templated.has('Real surfaces') || /^none\.?$/i.test(surfaces)) return problems;
  const known = SURFACES.map(s => s.toLowerCase());
  for (const line of surfaces.split(/\r?\n/)) {
    if (!line.trim() || /^\s+\S/.test(line)) continue; // a wrapped line belongs to the bullet above
    const bullet = /^- ([^:]+):(.*)$/.exec(line.trim());
    if (!bullet) { problems.push(`${where('Real surfaces')}: "${line.trim().slice(0, 60)}" is not "- <surface>: <its proof>"; or the section is the single line none`); continue; }
    const term = bullet[1].trim().replaceAll('\u2019', "'").toLowerCase();
    if (!known.includes(term)) problems.push(`${where('Real surfaces')}: "${bullet[1].trim()}" is not a surface; use one of ${SURFACES.join(', ')}, or none`);
    else if (!bullet[2].trim()) problems.push(`${where('Real surfaces')}: ${bullet[1].trim()} names no proof; say the one proof that runs there`);
  }
  return problems;
}

/** A phase without `spec` whose boxes name no check: the count, for doctor's acceptance-unchecked note. */
export function uncheckedBoxes(raw) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!block || /^spec:/m.test(block[1])) return null;
  const all = boxes(sectionsOf(block[2]).Acceptance);
  return { boxes: all.length, unchecked: all.filter(b => !namesCheck(b.text)).length };
}
const fail = message => { throw new Error(message); };
const cell = value => String(value).replaceAll('|', '&#124;').replaceAll('\n', ' ');

export function parsePhase(file, raw) {
  const number = /^(\d+)-[a-z0-9-]+\.md$/.exec(file);
  if (!number) fail(`${file}: use NN-name.md`);
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!block) fail(`${file}: missing front matter`);
  const meta = {};
  for (const line of block[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const pair = /^([a-z]+):\s*(.+)$/.exec(line);
    if (!pair || !FIELDS.includes(pair[1])) fail(`${file}: invalid metadata line: ${line}`);
    const [, key, value] = pair;
    if (Object.hasOwn(meta, key)) fail(`${file}: duplicate ${key}`);
    try {
      meta[key] = ['depends', 'evidence', 'issue', 'spec'].includes(key) || value.startsWith('"')
        ? JSON.parse(value) : value;
    } catch { fail(`${file}: invalid JSON value for ${key}`); }
  }
  if (!STATUSES.includes(meta.status)) fail(`${file}: invalid status ${meta.status}`);
  if (typeof meta.since !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(meta.since)
      || new Date(meta.since).toISOString().slice(0, 10) !== meta.since) fail(`${file}: invalid since date`);
  for (const key of ['note', 'goal']) {
    if (typeof meta[key] !== 'string' || !meta[key].trim()) fail(`${file}: missing ${key}`);
  }
  meta.depends ??= [];
  meta.evidence ??= [];
  if (!Array.isArray(meta.depends) || meta.depends.some(n => !Number.isSafeInteger(n) || n < 0)
      || new Set(meta.depends).size !== meta.depends.length) fail(`${file}: invalid depends array`);
  if (!Array.isArray(meta.evidence) || meta.evidence.some(p => typeof p !== 'string'
      || !/^evidence\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(p))) fail(`${file}: invalid evidence paths`);
  if (DONE.includes(meta.status) && !meta.evidence.length) fail(`${file}: ${meta.status} requires evidence`);
  if (meta.issue !== undefined && (!Number.isSafeInteger(meta.issue) || meta.issue <= 0)) fail(`${file}: invalid issue`);
  if (meta.review !== undefined && !REVIEW_VALUES.includes(meta.review)) fail(`${file}: review ${JSON.stringify(meta.review)} is not one this script knows (${REVIEW_VALUES.join(', ')}; absent is the default: no wait)`);
  if (meta.owes !== undefined) {
    if (!OWES_VALUES.includes(meta.owes)) fail(`${file}: owes ${JSON.stringify(meta.owes)} is not one this script knows (${OWES_VALUES.join(', ')}: the phase's building is done and its rest is a walk or time)`);
    if (meta.status !== 'partial') fail(`${file}: owes: ${meta.owes} is only for a partial phase (this one is ${meta.status}); a built phase owes nothing, an earlier one still has building to do`);
  }
  if (meta.after !== undefined && !isDate(meta.after)) fail(`${file}: after ${JSON.stringify(meta.after)} is not a date (YYYY-MM-DD): the first day the phase is buildable`);
  if (meta.waits !== undefined) {
    if (!WAITS_VALUES.includes(meta.waits)) fail(`${file}: waits ${JSON.stringify(meta.waits)} is not one this script knows (${WAITS_VALUES.join(', ')}; absent is owner)`);
    if (meta.owes !== 'walk') fail(`${file}: waits: ${meta.waits} says whose walk is owed, so it goes with owes: walk (this phase owes none)`);
  }
  if (meta.spec !== undefined && (!Number.isSafeInteger(meta.spec) || meta.spec < 1 || meta.spec > SPEC)) fail(`${file}: spec ${meta.spec} is not one this script knows (1–${SPEC}); keel update brings a newer one`);
  const body = block[2];
  const title = /^# (.+)$/m.exec(body)?.[1]?.trim();
  if (!title) fail(`${file}: missing title`);
  const sections = {};
  for (const section of SECTIONS) {
    const match = new RegExp(`^## ${section}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(body);
    if (!match?.[1]?.trim()) fail(`${file}: missing or empty ## ${section}`);
    sections[section] = match[1].trim();
  }
  if (!/^- \[[ x]\] /m.test(sections.Acceptance)) fail(`${file}: Acceptance needs checkboxes`);
  if (DONE.includes(meta.status) && /^- \[ \] /m.test(sections.Acceptance)) fail(`${file}: ${meta.status} with unchecked acceptance`);
  if (meta.owes === 'walk') {
    const open = boxes(sections.Acceptance).filter(b => !b.checked);
    // A walk owed names the walk: with no unchecked walk box, nothing is owed and the phase would vanish from the queue (Codex on cajones#54).
    if (!open.some(b => isWalk(b.text))) fail(`${file}: owes: walk, but no unchecked box is a walk; name the walk ("⚑ by hand: …" or a \`gh …\` check), or drop owes`);
    const buildable = open.filter(b => !isWalk(b.text));
    if (buildable.length) fail(`${file}: owes: walk, but an unchecked box is still buildable ("${buildable[0].text.slice(0, 60)}${buildable[0].text.length > 60 ? '…' : ''}"); a walk is "⚑ by hand" or a \`gh …\` command, and cites no tests/ path. Build it, or drop owes`);
  }
  // The record was written but the status wasn't moved: the roadmap would call proven work unbuilt.
  if (['planned', 'designed', 'partial'].includes(meta.status) && meta.evidence.length && !/^- \[ \] /m.test(sections.Acceptance)) {
    fail(`phase ${Number(number[1])}: every box checked and evidence named, but status is ${meta.status} — set status: built (or uncheck what isn't proven)`);
  }
  return {
    file, id: Number(number[1]), title, ...meta,
    tests: citedTests(sections.Acceptance),
    done: sections['Done when'].replace(/\s+/g, ' '),
    next: sections['Next action'].replace(/\s+/g, ' '),
    yourPart: yourPartOf(sectionsOf(body)['Your part']),
  };
}

export function validateGraph(phases, goals) {
  if (!Array.isArray(goals) || !goals.length) fail('goals must be a nonempty array');
  const goalIds = new Set();
  for (const g of goals) {
    if (!g || typeof g.id !== 'string' || !/^G\d+$/.test(g.id)
        || ![g.title, g.outcome].every(s => typeof s === 'string' && s.trim())) fail('invalid goal');
    if (g.retired !== undefined && (typeof g.retired !== 'string' || !/^\d{4}-\d{2}-\d{2}: \S/.test(g.retired))) fail(`${g.id}: retired must read "YYYY-MM-DD: <reason>"`);
    if (goalIds.has(g.id)) fail(`duplicate goal ${g.id}`);
    goalIds.add(g.id);
  }
  if (!phases.length) fail('no phase files found');
  const byId = new Map();
  for (const p of phases) {
    if (byId.has(p.id)) fail(`duplicate phase number ${p.id}: ${byId.get(p.id).file} and ${p.file}; renumber one`);
    if (!goalIds.has(p.goal)) fail(`${p.file}: unknown goal ${p.goal}`);
    byId.set(p.id, p);
  }
  // A goal with no phase yet is allowed (keel goal add); keel doctor reports it.
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (visiting.has(id)) fail(`dependency cycle at phase ${id}`);
    if (visited.has(id)) return;
    const p = byId.get(id);
    if (!p) fail(`unknown dependency ${id}`);
    visiting.add(id);
    p.depends.forEach(visit);
    visiting.delete(id); visited.add(id);
  };
  phases.forEach(p => visit(p.id));
}

/**
 * The first phase left to build, in number order, whose dependencies are all
 * satisfied (built, lived-in, or partial owing only a walk). A phase that owes
 * a walk is skipped: nothing in it is left to build. So is one dated `after:`
 * a day still to come (`today`, YYYY-MM-DD, this machine's day by default;
 * null skips every dated phase). `include` narrows the candidates (one goal's
 * phases, say); their dependencies are still checked against every phase.
 */
export function nextPhase(phases, include = () => true, today = localToday()) {
  const byId = new Map(phases.map(p => [p.id, p]));
  return phases.find(p => include(p) && !DONE.includes(p.status) && p.status !== 'superseded' && !owesWalk(p) && !dated(p, today)
    && p.depends.every(id => satisfies(byId.get(id)))) ?? null;
}

/**
 * Whether the project counts lived-in (`.keel/keel.json` `"phases": { "livedIn": true }`).
 * Off by default: the roadmap counts built only. A `lived-in` status stays valid and done either way.
 */
export function livedInOf(config = {}) {
  const phases = config?.phases;
  if (phases === undefined) return false;
  if (!phases || typeof phases !== 'object' || Array.isArray(phases)) fail(`.keel/keel.json: "phases" must be an object, like {"livedIn": true}`);
  if (phases.livedIn === undefined) return false;
  if (typeof phases.livedIn !== 'boolean') fail(`.keel/keel.json: "phases.livedIn" must be true or false (absent is false)`);
  return phases.livedIn;
}

/** "Nothing left to build" when no phase is next: what is still owed or dated, if anything. */
export function nothingNext(phases, goals = [], today = localToday()) {
  // Under a retired goal a phase is never next, and its walk is not outstanding either.
  const retired = new Set(goals.filter(g => g.retired).map(g => g.id));
  const owed = phases.filter(p => owesWalk(p) && !retired.has(p.goal)).map(p => p.id);
  const later = datedLine(phases, goals, today);
  if (!owed.length) return later ? `Nothing left to build yet; ${later}.` : 'Nothing left unbuilt.';
  return `Nothing left to build; ${owed.length === 1 ? 'phase' : 'phases'} ${owed.join(', ')} ${owed.length === 1 ? 'owes' : 'owe'} a walk${later ? `; ${later}` : ''}.`;
}

/** "phase 13 is on or after 2026-11-01": the dated phases under live goals, or ''. */
export function datedLine(phases, goals = [], today = localToday()) {
  const retired = new Set(goals.filter(g => g.retired).map(g => g.id));
  const later = phases.filter(p => dated(p, today) && !retired.has(p.goal));
  return later.map(p => `phase ${p.id} is on or after ${p.after}`).join(', ');
}

/** The next focus: the next phase outside retired goals, on `today` (null: any dated phase waits). */
export function focus({ phases, goals }, today = localToday()) {
  const retired = new Set(goals.filter(g => g.retired).map(g => g.id));
  return nextPhase(phases, p => !retired.has(p.goal), today);
}

export async function collect(root = ROOT) {
  const docs = resolve(root, 'docs');
  const config = JSON.parse(await readFile(resolve(root, '.keel/keel.json'), 'utf8'));
  if (config.phases?.source === 'milestones') fail('GitHub milestones are read-only; use keel next or keel status, not the local file roadmap');
  livedInOf(config);
  const names = (await readdir(resolve(docs, 'phases'))).filter(n => n.endsWith('.md') && n !== 'README.md');
  const raws = await Promise.all(names.map(async file => [file, await readFile(resolve(docs, 'phases', file), 'utf8')]));
  const phases = raws.map(([file, raw]) => parsePhase(file, raw));
  phases.sort((a, b) => a.id - b.id);
  // What --check refuses; listing and writing the roadmap go on without it.
  const problems = raws.sort(([a], [b]) => a.localeCompare(b)).flatMap(([file, raw]) => specProblems(file, raw));
  const notes = raws.flatMap(([file, raw]) => specNotes(file, raw));
  const goals = JSON.parse(await readFile(resolve(docs, 'goals.json'), 'utf8'));
  validateGraph(phases, goals);
  for (const p of phases) for (const evidence of p.evidence) {
    const path = resolve(docs, evidence);
    if (!path.startsWith(docs + sep)) fail(`${p.file}: evidence outside docs`);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || !info.size) fail(`${p.file}: missing or empty evidence ${evidence}`);
  }
  // Link the design and lessons only where the project has them.
  const links = [];
  for (const [label, file] of [['Design', 'design.md'], ['Lessons', 'lessons.md']]) {
    if ((await stat(resolve(docs, file)).catch(() => null))?.isFile()) links.push([label, file]);
  }
  return { config, phases, goals, links, problems, notes };
}

export function render({ config, phases, goals, links = [] }) {
  // The generated file never reads the clock: a day passing must not make it stale.
  // A dated phase is named "on or after" its date; keel next names it from that day.
  const next = focus({ phases, goals }, null);
  const later = datedLine(phases, goals, null);
  const lived = livedInOf(config);
  const built = phases.filter(p => DONE.includes(p.status)).length;
  // Walks owed under live goals only, as nothingNext counts them (Codex on cajones#54).
  const retiredGoals = new Set(goals.filter(g => g.retired).map(g => g.id));
  const owed = phases.filter(p => owesWalk(p) && !retiredGoals.has(p.goal)).length;
  const headline = lived
    ? `**${phases.filter(p => p.status === 'lived-in').length} of ${phases.length} phases lived in; ${built} built.** Built means implemented and checked; lived-in means repeated real use held. Planned is not available.`
    : `**${built} of ${phases.length} phases built${owed ? `; ${owed} owe${owed === 1 ? 's' : ''} a walk` : ''}.** Built means implemented and checked; planned is not available.`;
  const nextLine = next ? `**Next focus:** [${next.id}. ${next.title}](phases/${next.file}). ${next.next}${later ? ` (Dated: ${later}.)` : ''}`
    : owed || later ? `**Next focus:** ${nothingNext(phases, goals, null)}`
    : lived ? '**Next focus:** every phase is built; go and live in them.' : '**Next focus:** every phase is built.';
  const issueUrl = n => config.repo ? ` · [#${n}](https://github.com/${config.repo}/issues/${n})` : ` · #${n}`;
  const lines = [
    '<!-- Generated by scripts/roadmap.mjs. Edit the phase files and goals.json, then run npm run roadmap. -->',
    `# ${config.name} roadmap`, '',
    config.tagline ? `${config.tagline} ${[`[Working rules](../${(config.guide ?? 'AGENTS.md').split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')})`, ...links.map(([label, file]) => `[${label}](${file})`)].join(' · ')}` : '', '',
    headline, '',
    nextLine, '',
    'Goals are outcomes, not dates. Counts are derived; superseded work is retired, not delivered.', '',
  ];
  const goal = (g, level) => {
    const group = phases.filter(p => p.goal === g.id);
    lines.push(`${level} ${g.id} — ${g.title}`, '', ...(g.retired ? [`Retired ${g.retired}`, ''] : []), g.outcome, '');
    if (!group.length) {
      lines.push(g.retired ? 'No phases.' : `No phases yet — \`keel phase new --goal ${g.id}\`.`, '');
      return;
    }
    const built = group.filter(p => DONE.includes(p.status)).length;
    const owing = g.retired ? 0 : group.filter(owesWalk).length; // a retired goal owes nothing (Codex on cajones#55)
    lines.push(lived
      ? `${built}/${group.length} built or lived-in; ${group.filter(p => p.status === 'lived-in').length}/${group.length} lived-in.`
      : `${built}/${group.length} built${owing ? `; ${owing} owe${owing === 1 ? 's' : ''} a walk` : ''}.`, '',
      '| Phase | Status | Since | Depends on | Why it stands here |', '| --- | --- | --- | --- | --- |');
    for (const p of group) {
      const deps = p.depends.map(id => `[${id}](phases/${phases.find(x => x.id === id).file})`).join(', ') || '—';
      lines.push(`| [${p.id}. ${cell(p.title)}](phases/${p.file}) | ${owesWalk(p) && !g.retired ? `partial, walk owed${p.waits && p.waits !== 'owner' ? ` (${p.waits})` : ''}` : p.status}${dated(p, null) ? `, on or after ${p.after}` : ''} | ${p.since} | ${deps} | ${cell(p.note)}${p.issue ? issueUrl(p.issue) : ''} |`);
    }
    lines.push('');
    for (const p of group) lines.push(`- **${p.id} done when:** ${p.done}`);
    lines.push('');
  };
  for (const g of goals.filter(g => !g.retired)) goal(g, '##');
  const retired = goals.filter(g => g.retired);
  if (retired.length) {
    lines.push('## Retired', '', 'Goals given up, with the reason. Their phases still count in the totals; none is next focus.', '');
    for (const g of retired) goal(g, '###');
  }
  lines.push('## Updating this roadmap', '',
    'Edit the [phase](phases/README.md), its acceptance and evidence, then `npm run roadmap` and `npm run check`. CI checks metadata, the dependency graph, evidence links and that this file is current; it cannot check that a claim is true.', '');
  return lines.join('\n');
}

export async function run({ root = ROOT, mode = 'write', today = localToday() } = {}) {
  const data = await collect(root);
  if (mode === 'json') return JSON.stringify({ ...data, today, next: focus(data, today) }, null, 2);
  if (mode === 'next') {
    const p = focus(data, today);
    return p ? `${p.id}. ${p.title} [${p.status}] — docs/phases/${p.file}\nDone when: ${p.done}\nNext action: ${p.next}`
      : nothingNext(data.phases, data.goals, today);
  }
  const output = render(data), path = resolve(root, 'docs/ROADMAP.md');
  if (mode === 'check') {
    if (data.problems.length) fail(`${data.problems.length} phase spec problem${data.problems.length === 1 ? '' : 's'}:\n${data.problems.map(p => `  ${p}`).join('\n')}`);
    if (await readFile(path, 'utf8').catch(() => '') !== output) fail('docs/ROADMAP.md is stale — run npm run roadmap');
    const notes = data.notes?.length ? `\n${data.notes.length} note${data.notes.length === 1 ? '' : 's'} (advice, not a failure):\n${data.notes.map(n => `  ${n}`).join('\n')}` : '';
    return `Checked roadmap: ${data.phases.length} phases, ${data.goals.length} goals${notes}`;
  }
  await writeFile(path, output);
  return `Generated roadmap: ${data.phases.length} phases, ${data.goals.length} goals`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = ['--check', '--next', '--json'].find(f => process.argv.includes(f));
  try { console.log(await run({ mode: flag ? flag.slice(2) : 'write' })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

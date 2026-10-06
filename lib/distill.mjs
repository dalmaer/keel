// keel learn distill (phase 31; design research/2026-10-06-lessons-by-stack-and-pattern.md,
// part 2): from rows to patterns. keel only, like learn. Deterministic: no
// model, no gh, and never the private inbox — it reads keel's public catalogue
// (docs/lessons.md), docs/inbox/'s distill proposals and practices/.
//
//   distill            the worksheet, to stdout (or --json): every catalogue row
//                      (number, shape, cost, guard, where, provenance, family),
//                      the current families, the open distill proposals, and
//                      the rows added since the last pass.
//   distill propose    an agent records one proposal, a file in docs/inbox/
//                      (kind distill, status proposed, outcome its kind):
//     family   --name --rule --guard --rows 39,40   2+ rows, none in another family
//     reword   --row N --shape|--cost|--guard "…"   the old words are read now and
//                                                   kept; a shape keeps its provenance
//     tag      --row N --where "vercel,gcp" --evidence "<where each happened>"
//              (--where universal: deliberately every project's; Where stays empty)
//     promote  --family <name> --check "<what it does>" --practice <name> [--migration]
//     Every proposal cites rows (a promote, through its family); none, an unknown
//     row, tag, family or practice exits 2. --read must cite a path or a sha.
//   decide (learn's)   the person's. Accepting a family adds it to docs/patterns.md;
//                      a reword replaces the cell and appends the old words (and,
//                      for a shape, the old fingerprint) to docs/lessons-history.md;
//                      a tag fills the Where cell; a promote prints the practice
//                      checklist (an inert migration stub only with --migration).
//                      A row changed since the proposal read it is refused (lesson
//                      27: an editor writes back only what it read). After a change
//                      to docs/lessons.md, the enabled practices are re-rendered so
//                      docs/keel-lessons.md is never left stale.
//
// docs/patterns.md is generated from the accepted family and promote proposals
// and the catalogue's rows (members keep their numbers and provenance), with a
// header naming the last pass: the HEAD and last row at the latest accepted
// distill decision. `keel learn render [--check]` writes or checks it.
import { readFile, writeFile, readdir, mkdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseLessons, lessonFingerprint, short } from './lessons.mjs';
import { lessonProject } from '../practices/night/files/scripts/keel/lib.mjs';
import { tags as vocabTags, whereTags } from './stacks.mjs';
import {
  LearnError, home, find, proposals, save, formatProposal, renderInbox, concrete, oneLine, slugify, day,
  cell, bold, migrationStub, nextMigration, practiceChecklist, PRIVATE_HEAD, INBOX, INBOX_MD,
} from './learn.mjs';

export const PATTERNS = 'docs/patterns.md';
export const HISTORY = 'docs/lessons-history.md';
export const LESSONS = 'docs/lessons.md';
export const DISTILL_KINDS = ['family', 'reword', 'tag', 'promote'];
export const CELLS = ['shape', 'cost', 'guard'];
export const UNIVERSAL = 'universal';

const read = path => readFile(path, 'utf8').catch(e => ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(e.code) ? null : Promise.reject(e));

// ---- the catalogue ----------------------------------------------------------

/** A shape cell's provenance: each `*(…)*` in it, joined; '' when it names none. */
export const provenanceOf = shape => [...String(shape ?? '').matchAll(/\*\((.+?)\)\*/g)].map(m => m[1].trim()).join('; ');

async function catalogue(root) {
  const text = await read(join(root, LESSONS));
  if (text === null) throw new LearnError(`${LESSONS} is missing`, 1);
  const parsed = parseLessons(text);
  if (!parsed.numbered || !parsed.rows.length) throw new LearnError(`${LESSONS} has no numbered lesson table`, 1);
  return { text, ...parsed };
}

/** Rows as numbers: "39, 40,42" → [39, 40, 42]; anything else exits 2. */
function rowList(value) {
  const parts = String(value ?? '').split(/[\s,]+/).filter(Boolean);
  if (!parts.length) throw new LearnError('the proposal cites no row: a distill proposal names catalogue rows by number');
  if (parts.some(p => !/^\d+$/.test(p))) throw new LearnError(`--rows ${value}: row numbers, comma-separated`);
  return [...new Set(parts.map(Number))];
}

function rowOf(rows, n) {
  const row = rows.find(r => r.n === n);
  if (!row) throw new LearnError(`${LESSONS} has no lesson ${n}`);
  return row;
}

// ---- the record: distill proposals -----------------------------------------

/** A distill claim: `key: value` lines → an object. */
export function parseClaim(claim) {
  const out = {};
  for (const line of claim.split('\n')) {
    const kv = /^([a-z]+): ?(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}
const formatClaim = fields => Object.entries(fields).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}: ${oneLine(v)}`).join('\n');

/** The distill proposals in docs/inbox, each with its claim parsed. */
async function distills(root) {
  return (await proposals(root)).filter(p => p.meta.kind === 'distill').map(p => ({ ...p, fields: parseClaim(p.claim) }));
}

/** The families decided so far, in decision-file order: [{ name, rule, guard, rows, file, promoted: [...] }]. */
function familiesOf(all) {
  const families = all.filter(p => p.meta.status === 'accepted' && p.meta.outcome === 'family').map(p => ({
    name: p.fields.name, rule: p.fields.rule, guard: p.fields.guard, rows: rowList(p.fields.rows), file: p.file, promoted: [],
  }));
  for (const p of all.filter(p => p.meta.status === 'accepted' && p.meta.outcome === 'promote')) {
    families.find(f => f.name === p.fields.family)?.promoted.push({ check: p.fields.check, practice: p.fields.practice, file: p.file });
  }
  return families;
}

/** The last pass: the accepted distill decision with the highest `through`: { pass, through } or null. */
function lastPass(all) {
  let best = null;
  for (const p of all) {
    if (p.meta.status !== 'accepted' || typeof p.meta.through !== 'number') continue;
    if (!best || p.meta.through >= best.through) best = { pass: p.meta.pass ?? null, through: p.meta.through };
  }
  return best;
}

/** Rows universal by decision: an accepted tag proposal said so, and the row is still untagged. */
const decidedUniversal = (all, rows) => new Set(all
  .filter(p => p.meta.status === 'accepted' && p.meta.outcome === 'tag' && p.fields.where === UNIVERSAL)
  .map(p => Number(p.fields.row)).filter(n => !whereTags(rows.find(r => r.n === n)?.where).length));

function git(root, args) {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

/** The rows added since the last pass: those absent from the catalogue at its commit, else numbered past its last row. */
function since(root, rows, last) {
  if (!last) return { pass: null, through: null, rows: rows.map(r => r.n), by: 'no pass yet' };
  const then = last.pass ? git(root, ['show', `${last.pass}:${LESSONS}`]) : null;
  if (then !== null) {
    const had = new Set(parseLessons(then).rows.map(r => r.n));
    return { ...last, rows: rows.filter(r => !had.has(r.n)).map(r => r.n), by: 'commit' };
  }
  return { ...last, rows: rows.filter(r => r.n > last.through).map(r => r.n), by: 'row number' };
}

// ---- docs/patterns.md -------------------------------------------------------

const esc = s => oneLine(s).replace(/(?<!\\)\|/g, '\\|');

/** docs/patterns.md's text for these families over these rows. */
export function patternsText(families, rows, last) {
  const out = [
    '# Patterns', '',
    '<!-- Generated by `keel learn` from the accepted distill proposals in docs/inbox/ and the rows of docs/lessons.md. Do not edit; `keel learn render --check` fails when it is stale. -->', '',
    'Families of lessons: rows of [the catalogue](lessons.md) that share one shape,',
    'each with one rule and one guard recipe. The catalogue stays the record of what',
    'happened, and a row belongs to at most one family. An agent proposes (`keel',
    'learn distill propose`); a person decides (`keel learn decide`).', '',
    last ? `Last pass: ${last.pass ? `\`${last.pass.slice(0, 12)}\`` : 'no commit recorded'}, through lesson ${last.through}.` : 'No pass yet.', '',
  ];
  if (!families.length) out.push('No family has been decided yet.', '');
  for (const f of families) {
    out.push(`## ${f.name}`, '', `**Rule.** ${f.rule}`, '', `**Guard recipe.** ${f.guard}`, '');
    for (const p of f.promoted) out.push(`**Promoted.** ${p.check} — practice \`${p.practice}\` ([proposal](${p.file.replace(/^docs\//, '')})).`, '');
    out.push('| # | The shape of it | Provenance | Where |', '| --- | --- | --- | --- |');
    for (const n of f.rows) {
      const r = rows.find(r => r.n === n);
      out.push(r
        ? `| ${n} | ${esc(short(r.shape, 160))} | ${esc(provenanceOf(r.shape)) || '—'} | ${esc(r.where) || '—'} |`
        : `| ${n} | (not in the catalogue) | — | |`);
    }
    out.push('', `Decided in [${f.file.replace(/^docs\/inbox\//, '')}](${f.file.replace(/^docs\//, '')}).`, '');
  }
  return out.join('\n');
}

/**
 * Write (or check) docs/patterns.md. Absent and nothing decided is current.
 * Returns { ok, check, path, families, text }.
 */
export async function renderPatterns(root, { check = false } = {}) {
  const all = await distills(root);
  const families = familiesOf(all);
  const now = await read(join(root, PATTERNS));
  if (!families.length && now === null && !lastPass(all)) return { ok: true, check, path: PATTERNS, families: 0, text: '' };
  const { rows } = await catalogue(root);
  const text = patternsText(families, rows, lastPass(all));
  const ok = now === text;
  if (!check && !ok) await writeFile(join(root, PATTERNS), text);
  return {
    ok: check ? ok : true, check, path: PATTERNS, families: families.length,
    text: check ? (ok ? `${PATTERNS} is current.` : `${PATTERNS} is stale — run keel learn render.`) : `${ok ? 'Unchanged' : 'Wrote'} ${PATTERNS}: ${families.length} famil${families.length === 1 ? 'y' : 'ies'}.`,
  };
}

// ---- the inbox page, without gh ---------------------------------------------

/**
 * docs/INBOX.md re-rendered with no gh. Whether a configured inbox is private
 * is what the page last recorded (its private section), and private when there
 * is no page yet — the safe side, as learn's own unanswered question is. A
 * private inbox's recorded counts are kept.
 */
async function renderInboxLocal(root, cfg) {
  const page = await read(join(root, INBOX_MD));
  const priv = cfg.inbox && (page === null || page.includes(`${PRIVATE_HEAD}\n`)) ? { repo: cfg.inbox } : null;
  return renderInbox(root, { priv });
}

// ---- the worksheet ------------------------------------------------------------

/** opts: { dir }. The worksheet: { data, text, exitCode }. Reads files only. */
export async function distill(opts) {
  const { root } = await home(opts.dir);
  const { rows } = await catalogue(root);
  const all = await distills(root);
  const families = familiesOf(all);
  const familyOf = n => families.find(f => f.rows.includes(n))?.name ?? null;
  const universal = decidedUniversal(all, rows);
  const known = vocabTags();
  const last = lastPass(all);
  const fresh = since(root, rows, last);
  const open = all.filter(p => p.meta.status === 'proposed').map(p => ({ slug: p.slug, file: p.file, kind: p.meta.outcome, note: p.meta.note ?? null, ...p.fields }));
  const list = rows.map(r => ({
    n: r.n, shape: r.shape, cost: r.cost, guard: r.guard, where: whereTags(r.where),
    universal: universal.has(r.n), provenance: provenanceOf(r.shape), family: familyOf(r.n),
  }));
  const untagged = list.filter(r => !r.where.length && !r.universal).length;
  const summary = { rows: list.length, families: families.length, inFamilies: list.filter(r => r.family).length, untagged, open: open.length, since: fresh.rows.length };
  const data = { ok: true, root, summary, tags: known, families, open, since: fresh, rows: list };
  const text = [
    `# Distill worksheet — ${LESSONS}`, '',
    `rows: ${summary.rows}; families: ${summary.families} (${summary.inFamilies} rows in one); untagged: ${untagged}; open proposals: ${open.length}`,
    last ? `last pass: ${last.pass ? last.pass.slice(0, 12) : 'no commit'}, through lesson ${last.through}; since then (by ${fresh.by}): ${fresh.rows.length ? fresh.rows.join(', ') : 'none'}` : 'last pass: none yet; every row is new',
    `tags: ${known.join(', ')} (or "${UNIVERSAL}": every project's, deliberately)`, '',
    '## Families', '',
    ...(families.length ? families.map(f => `- ${f.name}: rows ${f.rows.join(', ')}${f.promoted.length ? ` (promoted: ${f.promoted.map(p => p.practice).join(', ')})` : ''}\n  rule: ${f.rule}\n  guard: ${f.guard}`) : ['None yet.']), '',
    '## Open proposals', '',
    ...(open.length ? open.map(o => `- ${o.slug} (${o.kind})${o.note ? `: ${o.note}` : ''}`) : ['None.']), '',
    '## Rows', '',
    ...list.flatMap(r => [
      `### ${r.n}${fresh.rows.includes(r.n) ? ' (new since the last pass)' : ''}`,
      `where: ${r.where.length ? r.where.join(', ') : r.universal ? `${UNIVERSAL} (decided)` : '(untagged)'}; family: ${r.family ?? '—'}; provenance: ${r.provenance || '—'}`,
      `shape: ${r.shape}`, `cost: ${r.cost}`, `guard: ${r.guard}`, '',
    ]),
    'Propose with keel learn distill propose --kind family|reword|tag|promote … --read "<a path or sha you checked>"; a person decides with keel learn decide.',
  ].join('\n');
  return { data, text, exitCode: 0 };
}

// ---- propose -----------------------------------------------------------------

/**
 * opts: { dir, kind, name, rule, guard, rows, row, shape, cost, where, evidence,
 * family, check, practice, migration, note, read }; deps: { now? }.
 * Writes one proposal file; reads no gh.
 */
export async function proposeDistill(opts, deps = {}) {
  const { root, cfg } = await home(opts.dir);
  if (!DISTILL_KINDS.includes(opts.kind)) throw new LearnError(`--kind must be one of ${DISTILL_KINDS.join(', ')}`);
  const ours = String(opts.read ?? '').trim();
  if (!ours) throw new LearnError('--read "<our read>" is required');
  if (!concrete(ours)) throw new LearnError('--read must cite something checked: a file path (docs/lessons.md) or a commit sha. An unverified read is not a read.');
  const { rows } = await catalogue(root);
  const all = await distills(root);
  const families = familiesOf(all);
  const need = (flag, value) => { if (!oneLine(value)) throw new LearnError(`--kind ${opts.kind} needs ${flag}`); return oneLine(value); };
  const allowed = { family: ['name', 'rule', 'guard', 'rows'], reword: ['row', 'shape', 'cost', 'guard'], tag: ['row', 'where', 'evidence'], promote: ['family', 'check', 'practice', 'migration'] }[opts.kind];
  const stray = ['name', 'rule', 'guard', 'rows', 'row', 'shape', 'cost', 'where', 'evidence', 'family', 'check', 'practice', 'migration'].filter(k => opts[k] !== undefined && opts[k] !== false && !allowed.includes(k));
  if (stray.length) throw new LearnError(`--${stray[0]} does not go with --kind ${opts.kind}`);

  let fields, from, slug, note;
  if (opts.kind === 'family') {
    const name = need('--name', opts.name);
    const n = rowList(opts.rows);
    if (n.length < 2) throw new LearnError('a family needs two rows or more: one row is a lesson, not a pattern');
    n.forEach(x => rowOf(rows, x));
    if (families.some(f => f.name.toLowerCase() === name.toLowerCase())) throw new LearnError(`family "${name}" is already decided in ${PATTERNS}`);
    for (const x of n) {
      const f = families.find(f => f.rows.includes(x));
      if (f) throw new LearnError(`lesson ${x} is already in family "${f.name}"; a row belongs to one family`);
    }
    fields = { kind: 'family', name, rule: need('--rule', opts.rule), guard: need('--guard', opts.guard), rows: n.join(', ') };
    from = `distill:family:${slugify(name)}`; slug = `distill-family-${slugify(name, 40)}`;
    note = `family "${name}": lessons ${n.join(', ')}`;
  } else if (opts.kind === 'reword') {
    const [n] = rowList(opts.row);
    const row = rowOf(rows, n);
    const which = CELLS.filter(c => oneLine(opts[c]));
    if (which.length !== 1) throw new LearnError('--kind reword takes one of --shape, --cost or --guard: one cell per proposal');
    const c = which[0];
    let text = cell(opts[c]);
    if (c === 'shape') {
      text = bold(text);
      // Provenance survives every reword: the row's own, carried when the new words leave it out.
      const prov = [...row.shape.matchAll(/\*\((.+?)\)\*/g)].map(m => m[0]);
      const missing = prov.filter(p => !text.includes(p));
      if (missing.length) text = `${text} ${missing.join(' ')}`;
    }
    if (text === row[c]) throw new LearnError(`lesson ${n}'s ${c} already reads that way`);
    fields = { kind: 'reword', row: n, cell: c, old: row[c], text };
    from = `distill:reword:${n}:${c}`; slug = `distill-reword-${n}-${c}`;
    note = `reword lesson ${n}'s ${c}`;
  } else if (opts.kind === 'tag') {
    const [n] = rowList(opts.row);
    const row = rowOf(rows, n);
    const given = whereTags(need('--where', opts.where));
    const known = vocabTags();
    if (given.includes(UNIVERSAL) && given.length > 1) throw new LearnError(`--where ${UNIVERSAL} stands alone: a row is every project's, or it has tags`);
    const unknown = given.filter(t => t !== UNIVERSAL && !known.includes(t));
    if (unknown.length) throw new LearnError(`--where names ${unknown.join(', ')}, not in practices/lessons/stacks.json (${known.join(', ')}); a new tag is a practice change`);
    fields = { kind: 'tag', row: n, old: row.where, where: given.join(', '), evidence: need('--evidence', opts.evidence) };
    from = `distill:tag:${n}`; slug = `distill-tag-${n}`;
    note = given[0] === UNIVERSAL ? `lesson ${n} is every project's` : `tag lesson ${n}: ${given.join(', ')}`;
  } else {
    const name = need('--family', opts.family);
    const f = families.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (!f) throw new LearnError(`no family "${name}" in ${PATTERNS}; a family is decided before its guard is promoted`);
    const practice = need('--practice', opts.practice);
    if (!/^[a-z][a-z0-9-]*$/.test(practice) || !(await lstat(join(root, 'practices', practice, 'practice.json')).catch(() => null))) {
      throw new LearnError(`--practice ${practice}: no practices/${practice}/practice.json`);
    }
    fields = { kind: 'promote', family: f.name, rows: f.rows.join(', '), check: need('--check', opts.check), practice, migration: opts.migration ? 'yes' : 'no' };
    from = `distill:promote:${slugify(f.name)}`; slug = `distill-promote-${slugify(f.name, 40)}`;
    note = `promote "${f.name}" to a ${practice} check`;
  }
  note = oneLine(opts.note) || note;
  const open = all.find(p => p.meta.from === from && p.meta.status === 'proposed');
  if (open) throw new LearnError(`${open.file} already proposes this; decide it, or edit nothing and wait`);

  const date = day(deps.now);
  const taken = new Set((await proposals(root)).map(p => `${p.date}-${p.slug}`));
  let s = slugify(slug), k = 2;
  while (taken.has(`${date}-${s}`)) s = `${slugify(slug)}-${k++}`;
  const file = `${INBOX}/${date}-${s}.md`;
  const title = `distill ${opts.kind}: ${note}`;
  await mkdir(join(root, INBOX), { recursive: true });
  await writeFile(join(root, file), formatProposal({ meta: { kind: 'distill', from, status: 'proposed', outcome: opts.kind, note }, title, claim: formatClaim(fields), read: ours }), { flag: 'wx' });
  await renderInboxLocal(root, cfg);
  return {
    data: { ok: true, slug: s, file, status: 'proposed', kind: opts.kind, note, fields },
    text: `${file}: proposed ${opts.kind} — ${note}\nA person decides: keel learn decide ${s} accepted|declined`,
    exitCode: 0,
  };
}

// ---- decide ------------------------------------------------------------------

/** The span of a numbered row's cell in its line, by column: [start, end) of the text between its pipes. */
function cellSpan(line, column, { where }) {
  const pipes = [];
  for (let i = 0; i < line.length; i++) if (line[i] === '|' && line[i - 1] !== '\\') pipes.push(i);
  const m = pipes.length - 1;
  const span = {
    shape: [pipes[1], pipes[2]], cost: [pipes[2], pipes[3]],
    guard: [pipes[3], where >= 0 ? pipes[m - 1] : pipes[m]],
    where: where >= 0 ? [pipes[m - 1], pipes[m]] : null,
  }[column];
  if (!span || span.some(x => x === undefined)) throw new LearnError(`${LESSONS}: lesson row has no ${column} cell to change`, 1);
  return span;
}

/** A line with one cell replaced, every other byte kept. */
const spliceCell = (line, [a, b], text) => `${line.slice(0, a + 1)} ${text}${text ? ' ' : ''}${line.slice(b)}`;

function historyText(now, entry) {
  const head = ['# Lessons history', '',
    '<!-- Appended by `keel learn decide` when a distill reword or tag is accepted: the words a row of docs/lessons.md had before. Never edited, never dropped. -->', '',
    'Each line: when, which lesson and cell, the proposal that changed it, and the old words verbatim.',
    'A reworded shape also records its old fingerprint, the identity keel lessons and fleet count it by.'].join('\n');
  return now === null ? `${head}\n\n${entry}\n` : `${now.replace(/\n*$/, '\n')}${entry}\n`;
}

/** opts: decide's; deps: { now?, render? }. A distill proposal decided: no gh. */
export async function decideDistill(root, cfg, p, opts, deps = {}) {
  const { now } = deps;
  if (['shape', 'cost', 'guard'].some(k => opts[k] !== undefined)) throw new LearnError('--shape, --cost and --guard go with a lesson or practice; a distill proposal carries its own words');
  if (p.meta.status !== 'proposed') throw new LearnError(`${p.file} is already ${p.meta.status}`);
  const note = oneLine(opts.note) || p.meta.note || '';
  if (opts.decision === 'declined' && !oneLine(opts.note)) throw new LearnError('declining needs --note "<why>", so the record says why');
  const kind = p.meta.outcome;
  const f = parseClaim(p.claim);
  const all = await distills(root);
  const writes = []; // [{ path, text }] — worked out before anything is written
  let checklist = [], migration = null, lesson = null;

  if (opts.decision === 'accepted') {
    const cat = await catalogue(root);
    const families = familiesOf(all.filter(x => x.file !== p.file));
    if (kind === 'family') {
      const n = rowList(f.rows);
      n.forEach(x => rowOf(cat.rows, x));
      if (!f.name || !f.rule || !f.guard) throw new LearnError(`${p.file}: a family needs a name, a rule and a guard`, 1);
      if (families.some(x => x.name.toLowerCase() === f.name.toLowerCase())) throw new LearnError(`family "${f.name}" is already decided`);
      for (const x of n) {
        const g = families.find(g => g.rows.includes(x));
        if (g) throw new LearnError(`lesson ${x} joined family "${g.name}" since this was proposed; a row belongs to one family`);
      }
    } else if (kind === 'reword' || kind === 'tag') {
      const n = Number(f.row);
      const row = rowOf(cat.rows, n);
      const column = kind === 'tag' ? 'where' : f.cell;
      if (!['shape', 'cost', 'guard', 'where'].includes(column)) throw new LearnError(`${p.file}: no cell named`, 1);
      if (oneLine(row[column]) !== oneLine(f.old)) throw new LearnError(`lesson ${n}'s ${column} changed since ${p.file} read it; propose again from what it says now`);
      if (kind === 'tag') {
        const unknown = whereTags(f.where).filter(t => t !== UNIVERSAL && !vocabTags().includes(t));
        if (unknown.length) throw new LearnError(`${p.file} names ${unknown.join(', ')}, no longer in practices/lessons/stacks.json`);
      }
      const text = kind === 'tag' ? (f.where === UNIVERSAL ? '' : f.where) : f.text;
      const lines = cat.text.split('\n');
      lines[row.line - 1] = spliceCell(lines[row.line - 1], cellSpan(lines[row.line - 1], column, cat), text);
      const after = parseLessons(lines.join('\n')).rows.find(r => r.n === n);
      if (!after || after[column] !== text) throw new LearnError(`${LESSONS}: lesson ${n} did not read back as written; nothing was changed`, 1);
      writes.push({ path: LESSONS, text: lines.join('\n') });
      if (kind === 'reword' || row.where) {
        const fp = column === 'shape' ? `; old fingerprint ${lessonFingerprint(lessonProject(cfg), row)}` : '';
        const entry = `- ${day(now)}, lesson ${n}, ${column} (${p.file}${fp}): ${row[column] || '(empty)'}`;
        writes.push({ path: HISTORY, text: historyText(await read(join(root, HISTORY)), entry) });
      }
      lesson = n;
    } else if (kind === 'promote') {
      if (!families.some(x => x.name === f.family)) throw new LearnError(`family "${f.family}" is not in ${PATTERNS}`);
      const what = `${f.check} (family "${f.family}", lessons ${f.rows})`;
      if (f.migration === 'yes') {
        const m = await nextMigration(root, `${f.practice}-${f.family}`);
        migration = m.migration;
        writes.push({ path: migration, text: migrationStub(m.id, what, cfg.practice ?? '0.1.0', p.file), exclusive: true });
        checklist = practiceChecklist(`${f.practice}: ${what}`, migration);
      } else {
        checklist = [`edit practices/${f.practice}/ to add the check: ${what}`,
          'a test that fails on the shape the family names, and passes once the check catches it',
          'add a WHATSNEW entry for it at release (keel release)'];
      }
    } else throw new LearnError(`${p.file}: unknown distill kind "${kind}"`, 1);
  }

  const head = git(root, ['rev-parse', 'HEAD']);
  const through = Math.max(...(await catalogue(root)).rows.map(r => r.n));
  const status = opts.decision === 'accepted' ? 'accepted' : 'declined';
  const what = status === 'accepted' ? `accepted (${kind})${lesson ? `: lesson ${lesson} in ${LESSONS}` : ''}${migration ? `, stub ${migration}` : ''}` : 'declined';
  p.meta = { ...p.meta, status, note, ...(status === 'accepted' ? { pass: head ?? undefined, through } : {}) };
  p.decision = [p.decision, `- ${day(now)}: ${what}${note ? ` — ${note}` : ''}`].filter(Boolean).join('\n');

  for (const w of writes) {
    await mkdir(join(root, w.path, '..'), { recursive: true });
    await writeFile(join(root, w.path), w.text, w.exclusive ? { flag: 'wx' } : undefined);
  }
  await save(root, p);
  await renderInboxLocal(root, cfg);
  const patterns = await renderPatterns(root);
  // The stale-view guard: a changed catalogue re-renders keel's own docs/keel-lessons.md.
  const notes = [];
  let rendered = false;
  if (writes.some(w => w.path === LESSONS) && (cfg.practices ?? []).includes('lessons')) {
    try {
      await (deps.render ?? (async r => (await import('./practices.mjs')).render(r)))(root);
      rendered = true;
    } catch (e) {
      notes.push(`docs/keel-lessons.md was not re-rendered (${e.message}); run npm run render`);
    }
  }
  const result = { slug: p.slug, file: p.file, status, kind, note, lesson, migration, checklist, patterns: patterns.families, rendered, notes };
  return {
    data: { ok: !notes.length, ...result },
    text: [`${p.file}: ${what}${note ? ` — ${note}` : ''}`,
      ...writes.map(w => `  wrote ${w.path}`), `  ${patterns.text || `${PATTERNS}: nothing decided yet`}`,
      ...(rendered ? ['  re-rendered the practices (docs/keel-lessons.md)'] : []),
      ...(checklist.length ? ['Still to do:', ...checklist.map(c => `  - ${c}`)] : []),
      ...notes.map(n => `note: ${n}`)].join('\n'),
    exitCode: notes.length ? 1 : 0,
  };
}

// keel adopt: bring an existing project under keel without losing what is its own.
//
// The rule is design §1a. A practice is switched on only where the project
// already satisfies it; where the project has its own version, the practice is
// a *local variant*: nothing is installed for it, and .keel/keel.json records
// why and how it could converge. The project's gate is config (`check`), not
// an assumption.
//
// Per practice: on (render it) | local (the project's own version; a proposal)
// | off (nothing there, not wanted by default).
// Per file: create | same | keep-local (the project's bytes stay) | conflict
// (a shape adopt cannot touch, e.g. a directory where keel wants a symlink).
// A keep-local or conflict on a managed file or block makes its practice local,
// so render never overwrites a project's bytes. AGENTS.md keeps every byte;
// missing practice blocks are appended under "## The keel practice".
//
// The dry run is the default output shape; without --dry-run the same plan is
// written: .keel/keel.json, the AGENTS.md markers, the on practices' render,
// and docs/keel-adoption.md for the person reading the PR. Re-running is a
// no-op: the existing config's name, tagline and check win over detection.
import { readFile, readdir, writeFile, mkdir, lstat, readlink } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { load, fill, render, DEFAULTS } from './practices.mjs';
import { firstSentence } from './init.mjs';
import { parsePhase, validateGraph, DONE } from '../practices/phases/files/scripts/roadmap.mjs';

export const ORDER = ['base', 'agents-md', 'phases', 'evidence', 'lessons', 'conduct', 'ci'];
export const HEADING = '## The keel practice';
export const REPORT = 'docs/keel-adoption.md';
const begin = id => `<!-- keel:begin ${id} -->`;
const end = id => `<!-- keel:end ${id} -->`;

class AdoptError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const read = path => readFile(path, 'utf8').catch(e => ['ENOENT', 'ENOTDIR'].includes(e.code) ? null : Promise.reject(e));
const info = path => lstat(path).catch(e => ['ENOENT', 'ENOTDIR'].includes(e.code) ? null : Promise.reject(e));
const list = dir => readdir(dir).catch(e => ['ENOENT', 'ENOTDIR'].includes(e.code) ? [] : Promise.reject(e));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The first prose line of a README, markdown stripped, cut to its first sentence. */
export function readmeTagline(text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^([#[!<|>`\-*+=]|\d+\.\s)/.test(line) && !/^\*\*/.test(line)) continue;
    const flat = line.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();
    if (flat) return firstSentence(flat);
  }
  return null;
}

/** The project's gate: check:all if present, else check. */
export function detectCheck(pkg) {
  const scripts = pkg?.scripts ?? {};
  if (scripts['check:all']) return { check: 'npm run check:all', from: 'package.json scripts.check:all' };
  if (scripts.check) return { check: 'npm run check', from: 'package.json scripts.check' };
  return { check: DEFAULTS.check, from: 'default (package.json has no check script)' };
}

/** Front matter as loose key/value pairs, for projects whose phases keel cannot parse. */
function looseFront(raw) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  const meta = {};
  for (const line of block?.[1].split(/\r?\n/) ?? []) {
    const pair = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (pair) meta[pair[1]] = pair[2].trim();
  }
  return meta;
}

/** What the project's phases look like to keel. */
async function readPhases(root) {
  const names = (await list(join(root, 'docs', 'phases'))).filter(n => n.endsWith('.md') && n !== 'README.md').sort();
  const phases = [], errors = [], loose = [];
  for (const file of names) {
    const raw = await read(join(root, 'docs', 'phases', file));
    loose.push({ file, ...looseFront(raw) });
    try { phases.push(parsePhase(file, raw)); } catch (e) { errors.push(e.message); }
  }
  const goalsText = await read(join(root, 'docs', 'goals.json'));
  if (!errors.length && names.length && goalsText !== null) {
    try { validateGraph(phases.sort((a, b) => a.id - b.id), JSON.parse(goalsText)); } catch (e) { errors.push(e.message); }
  }
  return { names, errors, loose, goals: goalsText !== null, milestones: (await read(join(root, 'docs', 'milestones.json'))) !== null };
}

function blockState(text, id, body) {
  const b = text.indexOf(begin(id)), e = text.indexOf(end(id));
  if (b < 0 && e < 0) return { status: 'create' };
  if (b < 0 || e < 0 || e < b || text.indexOf(begin(id), b + 1) >= 0 || text.indexOf(end(id), e + 1) >= 0) {
    return { status: 'conflict', note: 'its keel markers are unpaired or repeated' };
  }
  const from = text.indexOf('\n', b) + 1;
  if (!from || from > e) return { status: 'conflict', note: 'its begin marker does not end its line' };
  return text.slice(from, e) === body ? { status: 'same' } : { status: 'keep-local', note: 'the block holds the project\'s own text' };
}

/** One file entry of a practice, against the project. */
async function fileState(root, f, config, agents) {
  const target = join(root, f.path);
  const base = { practice: f.practice, path: f.path, kind: f.kind, ...(f.block ? { block: f.block } : {}) };
  if (f.kind === 'block') {
    if (agents === null) return { ...base, status: 'create' };
    if (agents === false) return { ...base, status: 'conflict', note: `${f.path} is not a file` };
    return { ...base, ...blockState(agents, f.block, fill(f.template, config, f.path)) };
  }
  const now = await info(target);
  if (f.link !== undefined) {
    if (!now) return { ...base, status: 'create' };
    if (!now.isSymbolicLink()) return { ...base, status: 'conflict', note: `exists and is not a symlink; keel's is a link to ${f.link}` };
    return (await readlink(target)) === f.link ? { ...base, status: 'same' } : { ...base, status: 'keep-local', note: `links to ${await readlink(target)}, keel's to ${f.link}` };
  }
  if (!now) return { ...base, status: 'create' };
  if (!now.isFile()) return { ...base, status: 'conflict', note: 'exists and is not a regular file' };
  const same = (await readFile(target, 'utf8')) === fill(f.template, config, f.path);
  return { ...base, status: same ? 'same' : 'keep-local', ...(same || f.kind === 'seeded' ? {} : { note: 'differs from keel\'s' }) };
}

/** Same-stem siblings of a managed file (scripts/roadmap.ts beside keel's scripts/roadmap.mjs). */
async function siblings(root, f) {
  if (f.kind !== 'managed' || f.link !== undefined) return [];
  const dir = dirname(f.path), own = basename(f.path);
  const stem = own.slice(0, own.length - extname(own).length);
  return (await list(join(root, dir))).filter(n => n !== own && n.startsWith(`${stem}.`) && n.slice(stem.length + 1).split('.').length === 1)
    .map(n => ({ practice: f.practice, path: dir === '.' ? n : `${dir}/${n}`, kind: 'managed', status: 'keep-local', note: `the project's own ${stem}; keel's ${f.path} is not installed beside it` }));
}

/**
 * Classify `root`. Returns { config, practices: [{name, state, why}], files,
 * check: {check, from} } and writes nothing.
 */
export async function survey(root, { check, version, practices }) {
  const existing = JSON.parse((await read(join(root, '.keel', 'keel.json'))) ?? '{}');
  const pkgText = await read(join(root, 'package.json'));
  let pkg = null;
  try { pkg = pkgText === null ? null : JSON.parse(pkgText); } catch { throw new AdoptError(`${root}/package.json is not JSON`, 1); }
  const readme = await read(join(root, 'README.md'));
  const detected = check ? { check, from: '--check' } : existing.check ? { check: existing.check, from: '.keel/keel.json' } : detectCheck(pkg);
  const name = existing.name ?? pkg?.name ?? basename(root);
  const tagline = existing.tagline ?? (readme && readmeTagline(readme)) ?? (pkg?.description && firstSentence(pkg.description)) ?? name;
  const values = { ...existing, name, tagline, check: detected.check };

  const agentsInfo = await info(join(root, 'AGENTS.md'));
  const agents = !agentsInfo ? null : agentsInfo.isFile() ? await readFile(join(root, 'AGENTS.md'), 'utf8') : false;
  const phases = await readPhases(root);
  const workflows = (await list(join(root, '.github', 'workflows'))).filter(n => /\.ya?ml$/.test(n)).sort();

  const names = [...practices.keys()].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const rows = new Map();
  for (const n of names) {
    const p = practices.get(n);
    const files = [];
    for (const f of p.files) {
      files.push(await fileState(root, f, values, agents));
      files.push(...await siblings(root, f));
    }
    rows.set(n, { name: n, state: 'on', why: [], files });
  }
  const local = (n, why) => { const r = rows.get(n); if (r.state !== 'off') r.state = 'local'; r.why.push(why); };
  const off = (n, why) => { const r = rows.get(n); r.state = 'off'; r.why = [why]; };

  // Project-specific detection, one rule per practice.
  if (rows.has('base') && !pkg) off('base', 'no package.json; keel\'s gate is an npm script');
  if (rows.has('phases')) {
    if (!phases.names.length) off('phases', 'no docs/phases/*.md');
    else if (phases.loose.some(p => 'milestone' in p) || phases.milestones) {
      local('phases', `phase files name a milestone${phases.milestones ? ' and docs/milestones.json holds them' : ''}; proposal: migrate milestone→goal (phase 6 migration)`);
    } else if (phases.errors.length || !phases.goals) {
      const missing = [...new Set(phases.errors.map(e => /missing (\w+)$/.exec(e)?.[1]).filter(Boolean))];
      local('phases', `${plural(phases.errors.length, 'phase file')} of ${phases.names.length} fail keel's parser (${missing.length ? `missing ${missing.join(', ')}` : phases.errors[0]})${phases.goals ? '' : '; no docs/goals.json'}; proposal: a migration that adds goals and the fields keel's format needs, shown as a diff — never by inventing evidence`);
    }
  }
  if (rows.has('evidence')) {
    if (!phases.names.length) off('evidence', 'no phases to carry evidence');
    else {
      const bare = phases.loose.filter(p => DONE.includes(p.status) && !/\S/.test((p.evidence ?? '').replace(/[[\]\s]/g, '')));
      if (bare.length) local('evidence', `${plural(bare.length, 'built phase')} name no evidence (${bare.slice(0, 3).map(p => p.file).join(', ')}${bare.length > 3 ? ', …' : ''}); proposal: write evidence when each is next checked, or step it back to partial — never invent it`);
    }
  }
  if (rows.has('ci') && workflows.length) {
    const ours = rows.get('ci').files.find(f => f.path === '.github/workflows/check.yml');
    if (ours?.status !== 'same') {
      let runs = null;
      for (const w of workflows) if ((await read(join(root, '.github', 'workflows', w)))?.includes(values.check)) { runs = w; break; }
      local('ci', `the project has workflows (${workflows.join(', ')})${runs ? ` and ${runs} already runs \`${values.check}\`` : ''}; keel's check.yml is not added beside them, since that would run the gate twice; proposal: ${runs ? 'keep it, or let keel manage it as check.yml' : `point the workflow that gates pushes at \`${values.check}\`, or replace it with keel's check.yml`}`);
    }
  }
  // A managed file or block the project has its own version of, or cannot take, keeps its practice local.
  for (const r of rows.values()) {
    if (r.state === 'off') continue;
    const own = r.files.filter(f => f.kind !== 'seeded' && (f.status === 'keep-local' || f.status === 'conflict'));
    if (own.length) local(r.name, `${own.map(f => f.block ? `${f.path}#${f.block}` : f.path).join(', ')} ${own.length === 1 ? 'is' : 'are'} the project's own (${own.map(f => f.note).filter(Boolean)[0]}); proposal: keep yours (eject), take keel's, or send yours upstream as a lesson`);
    if (r.state === 'on' && agents === null && r.files.some(f => f.kind === 'block') && rows.get('agents-md')?.state !== 'on' && r.name !== 'agents-md') {
      local(r.name, 'AGENTS.md is missing and agents-md is not switched on to seed it; proposal: write AGENTS.md, then adopt again');
    }
  }
  // Requirements: met by on or local; a practice whose requirement is off is off.
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rows.values()) {
      if (r.state === 'off') continue;
      const gone = practices.get(r.name).requires.find(q => rows.get(q)?.state === 'off');
      if (gone) { off(r.name, `needs ${gone}, which is off`); changed = true; }
    }
  }

  const config = {
    ...existing, name, tagline, check: detected.check,
    practice: version.practice,
    practices: names.filter(n => rows.get(n).state === 'on'),
  };
  const localMap = Object.fromEntries(names.filter(n => rows.get(n).state === 'local').map(n => [n, rows.get(n).why.join('; ')]));
  if (Object.keys(localMap).length) config.local = localMap; else delete config.local;

  const files = [];
  for (const r of rows.values()) {
    if (r.state === 'off') continue;
    for (const f of r.files) {
      if (r.state === 'local' && f.status === 'create') continue; // nothing installed for a local variant
      files.push(f);
    }
  }
  return {
    config, check: detected, files,
    practices: [...rows.values()].map(r => ({ name: r.name, state: r.state, why: r.why.join('; ') || (r.state === 'on' ? 'the project satisfies it' : '') })),
  };
}

/** AGENTS.md with the on practices' missing block markers appended; every existing byte kept. */
export function appendBlocks(text, ids) {
  if (!ids.length) return text;
  let out = text.length && !text.endsWith('\n') ? `${text}\n` : text;
  if (!out.includes(`\n${HEADING}\n`) && !out.startsWith(`${HEADING}\n`)) {
    out += `${out.length ? '\n' : ''}${HEADING}\n\nThe regions between keel markers are rendered by keel; the rest of this file is the project's own.\n`;
  }
  for (const id of ids) out += `\n${begin(id)}\n${end(id)}\n`;
  return out;
}

/** docs/keel-adoption.md: every local variant and its proposal, for the person reading the PR. */
export function adoptionReport({ config, practices, files }) {
  const label = f => `\`${f.block ? `${f.path}#${f.block}` : f.path}\``;
  const kept = files.filter(f => f.status === 'keep-local'), conflicts = files.filter(f => f.status === 'conflict');
  const locals = practices.filter(p => p.state === 'local');
  return [
    `# ${config.name} under keel: what stayed its own`, '',
    `Written by \`keel adopt\` on practice ${config.practice}. Keel switched on only the practices this project already satisfies; where it has its own version, nothing was installed and a proposal is recorded here and in \`.keel/keel.json\` (\`local\`). The project's gate is \`${config.check}\`.`, '',
    'Decide each proposal in review: keep yours (eject), take keel\'s, or send yours upstream as a lesson.', '',
    '## Practices', '',
    '| Practice | State | Why |', '| --- | --- | --- |',
    ...practices.map(p => `| ${p.name} | ${p.state} | ${(p.why || '—').replaceAll('|', '&#124;')} |`), '',
    '## Local variants and proposals', '',
    ...(locals.length ? locals.flatMap(p => [`### ${p.name}`, '', p.why, '']) : ['None.', '']),
    '## Files kept as the project\'s own', '',
    ...(kept.length ? kept.map(f => `- ${label(f)} (${f.practice})${f.note ? ` — ${f.note}` : ''}`) : ['None.']), '',
    '## Conflicts', '',
    ...(conflicts.length ? conflicts.map(f => `- ${label(f)} (${f.practice}) — ${f.note}`) : ['None.']), '',
  ].join('\n');
}

/**
 * Adopt `opts.dir`. opts: { dir, dryRun, check }. deps: { version }.
 * Returns { data, text }.
 */
export async function adopt(opts, { version, practices }) {
  const root = resolve(opts.dir);
  if (!(await info(root))?.isDirectory()) throw new AdoptError(`${root} is not a directory`);
  if (opts.check !== undefined && !opts.check.trim()) throw new AdoptError('--check needs a command');
  practices ??= await load();
  const result = await survey(root, { check: opts.check?.trim(), version, practices });
  const written = [];
  if (!opts.dryRun) {
    const put = async (path, content) => {
      const target = join(root, path);
      if ((await read(target)) === content) return;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      written.push(path);
    };
    await put('.keel/keel.json', `${JSON.stringify(result.config, null, 2)}\n`);
    const agentsPath = join(root, 'AGENTS.md');
    const agents = await read(agentsPath);
    if (agents !== null) {
      const ids = result.files.filter(f => f.kind === 'block' && f.status === 'create').map(f => f.block);
      const next = appendBlocks(agents, ids);
      if (!next.startsWith(agents)) throw new AdoptError('AGENTS.md would lose bytes; refusing', 1);
      await put('AGENTS.md', next);
    }
    // The stop rule, checked rather than trusted: render may only create files and fill blocks.
    const dry = await render(root, { check: true, practices });
    const over = dry.entries.filter(e => e.kind !== 'block' && e.status === 'update');
    if (over.length) throw new AdoptError(`render would overwrite the project's ${over.map(e => e.path).join(', ')}; refusing`, 1);
    const done = await render(root, { practices });
    for (const e of done.entries) if (e.status === 'create' || (e.status === 'update' && !written.includes(e.path))) written.push(e.path);
    await put(REPORT, adoptionReport(result));
  }
  const data = { dir: root, dryRun: !!opts.dryRun, check: result.check, config: result.config, practices: result.practices, files: result.files, written };
  const label = f => f.block ? `${f.path}#${f.block}` : f.path;
  const text = [
    `${opts.dryRun ? 'Dry run: nothing written.' : `Adopted ${result.config.name} on practice ${version.practice}: ${written.length ? `wrote ${written.join(', ')}` : 'nothing to change'}.`}`,
    `Gate: ${result.check.check} (${result.check.from})`, '', 'Practices:',
    ...result.practices.map(p => `  ${p.state.padEnd(5)} ${p.name}${p.state === 'on' ? '' : ` — ${p.why}`}`), '', 'Files:',
    ...result.files.map(f => `  ${f.status.padEnd(10)} ${label(f)} (${f.practice})${f.note ? ` — ${f.note}` : ''}`),
    ...(opts.dryRun ? [] : ['', `Local variants and proposals: ${REPORT}`]),
  ].join('\n');
  return { data, text };
}

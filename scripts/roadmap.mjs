// The roadmap is a checked view; each phase file owns its status.
// Lineage: isocan → ledger (scripts/roadmap.ts) → cajones (scripts/roadmap.mjs) → here.
// No YAML dependency: the documented flat metadata format is intentionally small.
//
//   node scripts/roadmap.mjs            regenerate docs/ROADMAP.md
//   node scripts/roadmap.mjs --check    fail if invalid or stale (CI runs this)
//   node scripts/roadmap.mjs --next     the next phase to conduct, and its next action
//   node scripts/roadmap.mjs --json     everything, for an agent; never parse the markdown
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STATUSES = ['planned', 'designed', 'partial', 'built', 'lived-in', 'superseded'];
export const DONE = ['built', 'lived-in'];
const SECTIONS = ['Done when', 'Scope', 'Acceptance', 'Proof', 'Deliberately open', 'Next action'];
const FIELDS = ['status', 'since', 'goal', 'depends', 'note', 'evidence', 'issue'];
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
      meta[key] = ['depends', 'evidence', 'issue'].includes(key) || value.startsWith('"')
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
  // The record was written but the status wasn't moved: the roadmap would call proven work unbuilt.
  if (['planned', 'designed', 'partial'].includes(meta.status) && meta.evidence.length && !/^- \[ \] /m.test(sections.Acceptance)) {
    fail(`phase ${Number(number[1])}: every box checked and evidence named, but status is ${meta.status} — set status: built (or uncheck what isn't proven)`);
  }
  return {
    file, id: Number(number[1]), title, ...meta,
    done: sections['Done when'].replace(/\s+/g, ' '),
    next: sections['Next action'].replace(/\s+/g, ' '),
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
 * The first unfinished phase, in number order, whose dependencies are all
 * built. `include` narrows the candidates (one goal's phases, say); their
 * dependencies are still checked against every phase.
 */
export function nextPhase(phases, include = () => true) {
  const byId = new Map(phases.map(p => [p.id, p]));
  return phases.find(p => include(p) && !DONE.includes(p.status) && p.status !== 'superseded'
    && p.depends.every(id => DONE.includes(byId.get(id).status))) ?? null;
}

/** The next focus: the next phase outside retired goals. */
export function focus({ phases, goals }) {
  const retired = new Set(goals.filter(g => g.retired).map(g => g.id));
  return nextPhase(phases, p => !retired.has(p.goal));
}

export async function collect(root = ROOT) {
  const docs = resolve(root, 'docs');
  const config = JSON.parse(await readFile(resolve(root, '.keel/keel.json'), 'utf8'));
  const names = (await readdir(resolve(docs, 'phases'))).filter(n => n.endsWith('.md') && n !== 'README.md');
  const phases = await Promise.all(names.map(async file => parsePhase(file, await readFile(resolve(docs, 'phases', file), 'utf8'))));
  phases.sort((a, b) => a.id - b.id);
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
  return { config, phases, goals, links };
}

export function render({ config, phases, goals, links = [] }) {
  const next = focus({ phases, goals });
  const issueUrl = n => config.repo ? ` · [#${n}](https://github.com/${config.repo}/issues/${n})` : ` · #${n}`;
  const lines = [
    '<!-- Generated by scripts/roadmap.mjs. Edit the phase files and goals.json, then run npm run roadmap. -->',
    `# ${config.name} roadmap`, '',
    config.tagline ? `${config.tagline} ${['[Working rules](../AGENTS.md)', ...links.map(([label, file]) => `[${label}](${file})`)].join(' · ')}` : '', '',
    `**${phases.filter(p => p.status === 'lived-in').length} of ${phases.length} phases lived in; ${phases.filter(p => DONE.includes(p.status)).length} built.** Built means implemented and checked; lived-in means repeated real use held. Planned is not available.`, '',
    next ? `**Next focus:** [${next.id}. ${next.title}](phases/${next.file}). ${next.next}` : '**Next focus:** every phase is built; go and live in them.', '',
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
    const lived = group.filter(p => p.status === 'lived-in').length;
    lines.push(`${built}/${group.length} built or lived-in; ${lived}/${group.length} lived-in.`, '',
      '| Phase | Status | Since | Depends on | Why it stands here |', '| --- | --- | --- | --- | --- |');
    for (const p of group) {
      const deps = p.depends.map(id => `[${id}](phases/${phases.find(x => x.id === id).file})`).join(', ') || '—';
      lines.push(`| [${p.id}. ${cell(p.title)}](phases/${p.file}) | ${p.status} | ${p.since} | ${deps} | ${cell(p.note)}${p.issue ? issueUrl(p.issue) : ''} |`);
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

export async function run({ root = ROOT, mode = 'write' } = {}) {
  const data = await collect(root);
  if (mode === 'json') return JSON.stringify({ ...data, next: focus(data) }, null, 2);
  if (mode === 'next') {
    const p = focus(data);
    return p ? `${p.id}. ${p.title} [${p.status}] — docs/phases/${p.file}\nDone when: ${p.done}\nNext action: ${p.next}`
      : 'Nothing left unbuilt.';
  }
  const output = render(data), path = resolve(root, 'docs/ROADMAP.md');
  if (mode === 'check') {
    if (await readFile(path, 'utf8').catch(() => '') !== output) fail('docs/ROADMAP.md is stale — run npm run roadmap');
    return `Checked roadmap: ${data.phases.length} phases, ${data.goals.length} goals`;
  }
  await writeFile(path, output);
  return `Generated roadmap: ${data.phases.length} phases, ${data.goals.length} goals`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = ['--check', '--next', '--json'].find(f => process.argv.includes(f));
  try { console.log(await run({ mode: flag ? flag.slice(2) : 'write' })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

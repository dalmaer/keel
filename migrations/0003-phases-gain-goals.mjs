// 0003: phases that never named a goal gain one (design §1a, §3; phase 16).
//
// A ledger-shaped project keeps one file per phase with status, since, note and
// an optional issue, but no `goal:`, no docs/goals.json, and only some of
// keel's six sections. Adopt leaves its phases `local`. This migration
// converts the structure:
//   - writes docs/goals.json: one goal per group in docs/phases/README.md (a
//     `## heading` whose lines link phase files, every phase in exactly one
//     group), else a single goal from the project's tagline;
//   - adds `goal: G<n>` to each phase's front matter, and each of keel's six
//     sections a phase lacks, marked as added here. A `**Done when.**` line
//     the phase already has is copied under the heading, not moved;
//   - then converges like 0001: if every phase parses, the project's own
//     roadmap gives way to keel's and phases moves from `local` to `practices`.
//
// It applies ONLY when every built or lived-in phase already names evidence.
// It never writes evidence, and never a placeholder page: an evidence file
// that proves nothing would pass the roadmap's check without being the thing
// (a facade). It never steps a phase back either. Where built phases owe
// evidence, it does not apply; phases stays local, and adopt's and doctor's
// proposal names each phase and the two honest moves: write the evidence when
// it is next checked, or step the phase back to partial.
import { parsePhase, validateGraph, DONE } from '../practices/phases/files/scripts/roadmap.mjs';
import { converge } from './0001-milestone-to-goal.mjs';

export const id = '0003-phases-gain-goals';
export const to = '0.3.0';
export const summary = 'phases without goals gain docs/goals.json, a goal each and keel\'s missing sections (marked as added), and keel\'s roadmap replaces the project\'s own — only once every built phase names evidence; it never writes evidence';

const PHASE = /^\d+-[a-z0-9-]+\.md$/;
const SECTIONS = ['Done when', 'Scope', 'Acceptance', 'Proof', 'Deliberately open', 'Next action'];
const ADDED = '(Added by keel migration 0003; this phase did not record it before keel.)';

const frontOf = raw => /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? '';
const field = (front, key) => new RegExp(`^${key}:\\s*"?([^"\\n]*?)"?\\s*$`, 'm').exec(front)?.[1];

async function phaseFiles(project) {
  return (await project.list('docs/phases')).filter(n => PHASE.test(n))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
}

function namesEvidence(front) {
  try { return JSON.parse(/^evidence:\s*(.+)$/m.exec(front)?.[1] ?? '[]').length > 0; } catch { return false; }
}

/** Built and lived-in phase files that name no evidence: what 0003 waits on. */
export async function owing(project) {
  const out = [];
  for (const f of await phaseFiles(project)) {
    const front = frontOf((await project.read(`docs/phases/${f}`)) ?? '');
    if (DONE.includes(field(front, 'status')) && !namesEvidence(front)) out.push(f);
  }
  return out;
}

export async function applies(project) {
  if (project.config?.phases?.source === 'milestones') return false;
  const config = project.config ?? {};
  if (config.phases?.shape === 'projects' || (config.practices ?? []).includes('phases')) return false;
  if (await project.exists('docs/milestones.json')) return false; // 0001's work
  if (await project.exists('docs/goals.json')) return false;
  const files = await phaseFiles(project);
  if (!files.length) return false;
  let lacking = false;
  for (const f of files) if (!/^goal:/m.test(frontOf((await project.read(`docs/phases/${f}`)) ?? ''))) lacking = true;
  return lacking && (await owing(project)).length === 0;
}

/** Groups in the phases README: `## heading` sections whose lines link phase files. */
export function groupsOf(readme, files) {
  const groups = [];
  let current = null;
  for (const line of (readme ?? '').split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { current = { title: h[1].replace(/[*_`]/g, '').trim(), files: [] }; groups.push(current); continue; }
    if (!current) continue;
    for (const m of line.matchAll(/\]\((?:\.\/)?(\d+-[a-z0-9-]+\.md)\)/g)) {
      if (files.includes(m[1]) && !current.files.includes(m[1])) current.files.push(m[1]);
    }
  }
  const used = groups.filter(g => g.files.length);
  const all = used.flatMap(g => g.files);
  // Groups count only when every phase is in exactly one.
  return used.length && all.length === files.length && new Set(all).size === files.length ? used : [];
}

const sentence = text => /[.!?]$/.test(text) ? text : `${text}.`;

/** The phase with `goal:` set and keel's missing sections appended, each marked. */
function convert(raw, goal) {
  const front = frontOf(raw);
  const head = raw.slice(0, raw.indexOf(front) + front.length);
  const lines = front.split('\n');
  const since = lines.findIndex(l => /^since:/.test(l));
  lines.splice(since >= 0 ? since + 1 : lines.length, 0, `goal: ${goal}`);
  let out = (raw.slice(0, raw.indexOf(front)) + lines.join('\n') + raw.slice(head.length)).replace(/\s*$/, '\n');
  const body = out.slice(out.indexOf('\n---', 3) + 4);
  const done = DONE.includes(field(front, 'status'));
  const proven = done && namesEvidence(front);
  const said = /^\*\*Done when\.?\*\*:?\s*(.+)$/m.exec(body)?.[1]?.trim();
  const text = {
    'Done when': said ? `${said} (Copied from this phase's **Done when.** line by keel migration 0003.)` : `${ADDED} Write the one sentence someone else could check.`,
    Scope: ADDED,
    Acceptance: proven
      ? `- [x] The Done when above held; the evidence this phase names is what was checked. ${ADDED}`
      : `- [ ] The Done when above. ${ADDED}`,
    Proof: proven ? `The evidence this phase names. ${ADDED}` : ADDED,
    'Deliberately open': ADDED,
    'Next action': done ? `None: built before keel. ${ADDED}` : `Write this phase's Scope, Acceptance and Proof, then conduct it. ${ADDED}`,
  };
  for (const s of SECTIONS) {
    if (new RegExp(`^## ${s}\\s*$`, 'm').test(body)) continue;
    out += `\n## ${s}\n\n${text[s]}\n`;
  }
  return out;
}

export async function up(project) {
  if ((await owing(project)).length) throw new Error('a built phase names no evidence; 0003 never writes it');
  const edits = [];
  const put = (path, content) => edits.push({ path, content });
  const files = await phaseFiles(project);
  const groups = groupsOf(await project.read('docs/phases/README.md'), files);
  const config = project.config ?? {};
  const goals = groups.length
    ? groups.map((g, i) => ({ id: `G${i + 1}`, title: g.title, outcome: sentence(g.title) }))
    : [{ id: 'G1', title: config.tagline || config.name || 'The project', outcome: sentence(config.tagline || config.name || 'The project does what it is for') }];
  const goalOf = f => groups.length ? `G${groups.findIndex(g => g.files.includes(f)) + 1}` : 'G1';
  put('docs/goals.json', `${JSON.stringify(goals, null, 2)}\n`);

  const parsed = [], errors = [];
  for (const f of files) {
    const path = `docs/phases/${f}`;
    const raw = await project.read(path);
    const next = /^goal:/m.test(frontOf(raw)) ? raw : convert(raw, goalOf(f));
    if (next !== raw) put(path, next);
    try { parsed.push(parsePhase(f, next)); } catch (e) { errors.push(e.message); }
  }
  if (!errors.length) {
    try { validateGraph(parsed.sort((a, b) => a.id - b.id), goals); } catch (e) { errors.push(e.message); }
  }
  await converge(project, { parsed, errors, put, label: 'phases gained goals (migration 0003)' });
  return edits;
}

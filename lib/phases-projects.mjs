import { planningConfig } from '../practices/night/files/scripts/keel/planning-config.mjs';
// The second phase shape keel reads: a directory per body of work.
//
//   docs/projects/README.md          the index (the project's own; keel never writes it)
//   docs/projects/<p>/phases.md      the walk: `## Phase N — title` headings, each
//                                    with a `**Status: WORD.** <date> — <sentence>`
//                                    line, and a `**Where we are…**` paragraph
//                                    naming what is next
//
// .keel/keel.json says `"phases": { "shape": "projects" }` (the default shape is
// "files": docs/phases/NN-*.md). This reader is READ-ONLY: keel never writes
// these files and never generates a roadmap from them (the project does).
//
// The project's vocabulary maps onto keel's statuses; nothing is guessed:
//   CLOSED → built, PART-DONE → partial, NOT STARTED → planned, RETIRED → superseded
//   DONE → built, with an `off-vocabulary` lint (CLOSED is the word)
//   any other word → unknown, with an `off-vocabulary` lint
//   status only in the heading (`## 1. Built — …`, a ✅), or no Status line at
//   all → unknown, with a `phase-status` lint: give it a Status line when it is
//   next conducted.
//
// The next phase of a project is the one its where-we-are paragraph names
// ("Next: keys phase 3", "phase 3 … is next") when that phase exists here, else
// the first phase known to be unfinished (planned, designed, partial). Unknown
// phases are never taken for unfinished or finished: when they are all that is
// left, next is null and they are listed.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
// The one reader of a phases.md's sections, shipped with the night practice so
// a project's own improve reads them the same way; this file interprets them.
import { phaseSections, PHASE_WORDS } from '../practices/night/files/scripts/keel/lib.mjs';

export const SHAPE = 'projects';
export const DIR = 'docs/projects';
export const VOCABULARY = PHASE_WORDS;
export const OFF_VOCABULARY = Object.freeze({ DONE: 'built' });
const FINISHED = ['built', 'lived-in', 'superseded'];
const UNFINISHED = ['planned', 'designed', 'partial'];

const read = path => readFile(path, 'utf8').catch(e => ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(e.code) ? null : Promise.reject(e));

/** The phases shape a config names: 'files' (default) or 'projects'. */
export const shapeOf = config => { planningConfig(config); return config?.phases?.shape === SHAPE ? SHAPE : 'files'; };

const HEADING_STATUS = /^(Built|Verified|Closed|Done|Shipped|Answered|Landed)\b/i;

/** The where-we-are paragraph's text, flattened, or null. */
function whereWeAre(lines) {
  const i = lines.findIndex(l => /^\*\*Where we are\b/.test(l));
  if (i < 0) return null;
  const out = [];
  for (let j = i; j < lines.length && lines[j].trim(); j++) out.push(lines[j].trim());
  return out.join(' ');
}

/** The phase id a where-we-are paragraph names as next, or null. */
export function namedNext(where) {
  if (!where) return null;
  const text = where.replace(/[*_`]/g, '');
  const patterns = [
    /\bNext:\s*(?:[\w-]+\s+)?phase\s+(\d+(?:\.\d+)?)/i,
    /\bphase\s+(\d+(?:\.\d+)?)\b[^.;:]*?\bis next\b/i,
    /\bnext(?:\s+is|:)?\s+phase\s+(\d+(?:\.\d+)?)/i,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[1];
  }
  return null;
}

/**
 * One project's phases.md. Returns { project, file, front, where, named,
 * phases: [{ id, title, status, word, line }], lint: [{rule, path, message}] }.
 */
export function parseProject(project, text) {
  const file = `${DIR}/${project}/phases.md`;
  const lines = text.split(/\r?\n/);
  const front = {};
  if (lines[0] === '---') {
    for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
      const m = /^([a-zA-Z_-]+):\s*(.*)$/.exec(lines[i]);
      if (m) front[m[1]] = m[2].trim();
    }
  }
  const phases = [], lint = [];
  for (const section of phaseSections(text)) {
    const { id, title, heading, word, line } = section;
    const phase = { id, title, status: 'unknown', word, line };
    const where = `${file}:${line}`;
    if (word !== null) {
      if (VOCABULARY[word]) phase.status = VOCABULARY[word];
      else if (OFF_VOCABULARY[word]) {
        phase.status = OFF_VOCABULARY[word];
        lint.push({ rule: 'off-vocabulary', path: where, message: `phase ${id} says Status: ${word}; the vocabulary is CLOSED, PART-DONE, NOT STARTED, RETIRED (read as ${phase.status})` });
      } else {
        lint.push({ rule: 'off-vocabulary', path: where, message: `phase ${id} says Status: ${word}, which is not CLOSED, PART-DONE, NOT STARTED or RETIRED; keel reads it as unknown` });
      }
    } else if (/✅/.test(heading) || HEADING_STATUS.test(title)) {
      lint.push({ rule: 'phase-status', path: where, message: `phase ${id} keeps its status in the heading, not a **Status:** line; keel reads it as unknown — give it a Status line when it is next conducted` });
    } else {
      lint.push({ rule: 'phase-status', path: where, message: `phase ${id} has no **Status:** line; keel reads it as unknown` });
    }
    phases.push(phase);
  }
  const where = whereWeAre(lines);
  return { project, file, front, where, named: namedNext(where), phases, lint };
}

/** What comes next in one parsed project: { next, from, unknown }. */
export function nextOf(parsed) {
  const unknown = parsed.phases.filter(p => p.status === 'unknown').map(p => p.id);
  if (parsed.named) {
    const named = parsed.phases.find(p => p.id === parsed.named && !FINISHED.includes(p.status));
    if (named) return { next: named, from: 'where we are', unknown };
  }
  const first = parsed.phases.find(p => UNFINISHED.includes(p.status));
  if (first) return { next: first, from: 'first unfinished phase', unknown };
  return { next: null, from: unknown.length ? 'only phases of unknown status remain' : 'every phase is finished', unknown };
}

/** The projects under docs/projects that have a phases.md, by name. */
export async function projectNames(root) {
  const dirs = await readdir(join(root, DIR), { withFileTypes: true }).catch(() => []);
  const names = [];
  for (const d of dirs) if (d.isDirectory() && (await read(join(root, DIR, d.name, 'phases.md'))) !== null) names.push(d.name);
  return names.sort();
}

/** Every project, parsed. Returns { projects: [parsed + nextOf], lint }. */
export async function readProjects(root) {
  const projects = [];
  for (const name of await projectNames(root)) {
    const parsed = parseProject(name, await read(join(root, DIR, name, 'phases.md')));
    projects.push({ ...parsed, ...nextOf(parsed) });
  }
  return { projects, lint: projects.flatMap(p => p.lint) };
}

/** Counts of one project's phases by keel status (unknown ones are listed by nextOf). */
export function countsOf(parsed) {
  const counts = { phases: parsed.phases.length, built: 0, partial: 0, planned: 0, superseded: 0 };
  for (const p of parsed.phases) if (Object.hasOwn(counts, p.status)) counts[p.status]++;
  return counts;
}

/** Whether `root` keeps its phases in the projects shape: an index and at least one phases.md. */
export async function detect(root) {
  if ((await read(join(root, DIR, 'README.md'))) === null) return null;
  const names = await projectNames(root);
  return names.length ? { shape: SHAPE, projects: names.length } : null;
}

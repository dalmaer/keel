// 0001: phases name goals, not milestones (design §3; phase 4's local variant
// "migrate milestone→goal").
//
// A ritmo-shaped project keeps its outcomes in docs/milestones.json (M<n>) and
// each phase file says `milestone: Mn`. Keel's phases name `goal: Gn` from
// docs/goals.json. This migration:
//   - writes docs/goals.json from milestones.json (M<n> → G<n>; title, outcome)
//     and deletes milestones.json;
//   - rewrites each phase's `milestone: Mn` to `goal: Gn`, and adds any of
//     keel's six sections a phase lacks, each marked as added here. A built
//     phase's added Acceptance is checked only when the phase already names
//     evidence; nothing is invented, and evidence files are never touched;
//   - if every phase then parses with keel's roadmap, converges the phases
//     practice: deletes the project's own roadmap script, its roadmap test and
//     its phase contract (docs/phases/README.md) and phase template so render installs keel's,
//     points package.json's roadmap scripts at keel's, appends the block
//     markers, and moves `phases` (and `evidence`, once no built phase lacks
//     it) from `local` to `practices` in .keel/keel.json.
// When the phases still do not parse, they stay local and the reason says why.
import { matchesGlob } from 'node:path';
import { appendBlocks, ORDER } from '../lib/adopt.mjs';
import { parsePhase, validateGraph, DONE } from '../practices/phases/files/scripts/roadmap.mjs';

export const id = '0001-milestone-to-goal';
export const to = '0.1.0';
export const summary = 'phases name goals, not milestones: docs/milestones.json becomes docs/goals.json, and keel\'s roadmap replaces the project\'s own';

const PHASE = /^\d+-[a-z0-9-]+\.md$/;
const MILESTONE = /^milestone:\s*"?([^"\s]+)"?\s*$/m;
const SECTIONS = ['Done when', 'Scope', 'Acceptance', 'Proof', 'Deliberately open', 'Next action'];
const ADDED = '(Added by keel migration 0001; this phase did not record it before keel.)';
const ROADMAP = ['scripts/roadmap.mjs', 'scripts/roadmap.js', 'scripts/roadmap.cjs', 'scripts/roadmap.ts'];
const ROADMAP_TESTS = ['tests', 'test', 'scripts'].flatMap(d => ['js', 'mjs', 'cjs', 'ts'].map(x => `${d}/roadmap.test.${x}`));
const KEEL_TEST = 'tests/roadmap.test.mjs';
const KEEL_SCRIPTS = { roadmap: 'node scripts/roadmap.mjs', 'roadmap:check': 'node scripts/roadmap.mjs --check' };

/**
 * The project's test script, made to run keel's roadmap test: { script } when
 * it already does or can be extended, { why } when it cannot be rewritten
 * safely. Only a plain `node --test [flags] [globs]` is rewritten: the path is
 * appended when no glob matches it. A gate that runs zero roadmap tests and
 * passes would be believed (lessons 4 and 6).
 */
export function testScript(command) {
  if (typeof command !== 'string') return { why: 'package.json has no test script to run keel\'s tests/roadmap.test.mjs' };
  const words = command.trim().split(/\s+/);
  if (words[0] !== 'node' || words[1] !== '--test' || words.some(w => /[;&|<>`$()]/.test(w))) {
    return { why: `package.json's test script (\`${command}\`) is not a plain node --test, so keel cannot add tests/roadmap.test.mjs to it safely` };
  }
  const globs = words.slice(2).filter(w => !w.startsWith('-'));
  if (words.slice(2).some(w => w.startsWith('-') && !w.includes('='))) {
    return { why: `package.json's test script (\`${command}\`) passes flags keel cannot read safely; add tests/roadmap.test.mjs to it by hand` };
  }
  // No globs: node --test's defaults find **/*.test.mjs.
  if (!globs.length || globs.some(g => g === KEEL_TEST || matchesGlob(KEEL_TEST, g))) return { script: command };
  return { script: `${command.trim()} ${KEEL_TEST}` };
}

async function phaseFiles(project) {
  return (await project.list('docs/phases')).filter(n => PHASE.test(n));
}

const frontOf = raw => /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? '';

export async function applies(project) {
  if (!(await project.exists('docs/milestones.json'))) return false;
  for (const f of await phaseFiles(project)) {
    if (MILESTONE.test(frontOf((await project.read(`docs/phases/${f}`)) ?? ''))) return true;
  }
  return false;
}

/** The phase with keel's missing sections appended, each marked. */
function addSections(raw) {
  const front = frontOf(raw);
  const status = /^status:\s*"?([a-z-]+)"?\s*$/m.exec(front)?.[1];
  const evidence = /^evidence:\s*(.+)$/m.exec(front)?.[1] ?? '[]';
  let named = false;
  try { named = JSON.parse(evidence).length > 0; } catch { named = false; }
  const done = DONE.includes(status), proven = done && named;
  const text = {
    Scope: ADDED,
    Acceptance: proven
      ? `- [x] The Done when above held; the evidence this phase names is what was checked. ${ADDED}`
      : `- [ ] The Done when above. ${ADDED}`,
    Proof: proven ? `The evidence this phase names. ${ADDED}` : ADDED,
    'Deliberately open': ADDED,
    'Next action': done ? `None: built before keel. ${ADDED}` : `Write this phase's Scope, Acceptance and Proof, then conduct it. ${ADDED}`,
  };
  const body = raw.slice(raw.indexOf('\n---', 3) + 4);
  let out = raw.replace(/\s*$/, '\n');
  for (const s of SECTIONS) {
    if (new RegExp(`^## ${s}\\s*$`, 'm').test(body) || !text[s]) continue;
    out += `\n## ${s}\n\n${text[s]}\n`;
  }
  return out;
}

export async function up(project) {
  const edits = [];
  const put = (path, content) => edits.push({ path, content });

  const milestones = JSON.parse(await project.read('docs/milestones.json'));
  if (!Array.isArray(milestones) || !milestones.length) throw new Error('docs/milestones.json must be a nonempty list');
  if (await project.exists('docs/goals.json')) throw new Error('docs/goals.json already exists beside docs/milestones.json; merge them by hand, then run keel update again');
  const ids = new Map();
  const goals = milestones.map(m => {
    const n = /^M(\d+)$/.exec(m?.id ?? '')?.[1];
    if (n === undefined) throw new Error(`docs/milestones.json: id ${JSON.stringify(m?.id)} is not M<n>`);
    if (![m.title, m.outcome].every(s => typeof s === 'string' && s.trim())) throw new Error(`docs/milestones.json: ${m.id} needs a title and an outcome`);
    ids.set(m.id, `G${n}`);
    return { id: `G${n}`, title: m.title, outcome: m.outcome };
  });
  put('docs/goals.json', `${JSON.stringify(goals, null, 2)}\n`);
  put('docs/milestones.json', null);

  const parsed = [], errors = [];
  for (const f of await phaseFiles(project)) {
    const path = `docs/phases/${f}`;
    const raw = await project.read(path);
    const front = frontOf(raw);
    let next = raw;
    const m = MILESTONE.exec(front);
    if (m) {
      const goal = ids.get(m[1]);
      if (!goal) throw new Error(`${path}: milestone ${m[1]} is not in docs/milestones.json`);
      const head = raw.slice(0, raw.indexOf(front) + front.length);
      next = head.replace(MILESTONE, `goal: ${goal}`) + raw.slice(head.length);
    }
    next = addSections(next);
    if (next !== raw) put(path, next);
    try { parsed.push(parsePhase(f, next)); } catch (e) { errors.push(e.message); }
  }
  if (!errors.length) {
    try { validateGraph(parsed.sort((a, b) => a.id - b.id), goals); } catch (e) { errors.push(e.message); }
  }

  await converge(project, { parsed, errors, put, label: 'milestones became goals (migration 0001)' });
  return edits;
}

/**
 * Once a project's phases parse with keel's roadmap, converge the phases
 * practice: the project's own roadmap, its test, phase contract and template
 * give way to keel's, package.json's roadmap scripts point at keel's, the
 * block markers are appended, and phases (and evidence, once no built phase
 * lacks it) move from `local` to `practices`. Otherwise phases stays local and
 * the reason says why. Shared with 0003. `put(path, content)` records an edit.
 */
export async function converge(project, { parsed, errors, put, label }) {
  const config = structuredClone(project.config);
  config.practices ??= [];
  const local = { ...(config.local ?? {}) };
  // The project's own roadmap test gives way to keel's only if its test command will run keel's.
  const pkgRaw = await project.read('package.json');
  const ownTests = [];
  for (const path of ROADMAP_TESTS) if (await project.exists(path)) ownTests.push(path);
  const tests = ownTests.length ? testScript(pkgRaw === null ? undefined : JSON.parse(pkgRaw).scripts?.test) : null;
  if (config.practices.includes('phases')) {
    // Keel's phases were already on; only the milestones needed converting.
  } else if (errors.length) {
    local.phases = `${label}; still local because ${errors[0]}; proposal: fix that phase file, then keel adopt again`;
  } else if (tests?.why) {
    local.phases = `${label}; still local because ${tests.why}, and deleting ${ownTests.join(', ')} would leave the gate running no roadmap test; proposal: make the test script run tests/roadmap.test.mjs, then keel adopt again`;
  } else {
    // The project's own roadmap, its test and its phase contract give way to keel's.
    const gone = [];
    // Its phase template is in the milestone format too (ritmo's says `milestone: M1`).
    for (const path of [...ROADMAP, ...ROADMAP_TESTS, 'docs/phases/README.md', 'docs/templates/phase.md']) {
      if (await project.exists(path)) { put(path, null); gone.push(path); }
    }
    const pkgText = await project.read('package.json');
    if (pkgText !== null) {
      const pkg = JSON.parse(pkgText);
      let changed = false;
      for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
        const calls = gone.filter(p => p !== 'scripts/roadmap.mjs' && command.includes(p));
        if (KEEL_SCRIPTS[name] && command !== KEEL_SCRIPTS[name] && (calls.length || /scripts\/roadmap\./.test(command))) {
          pkg.scripts[name] = KEEL_SCRIPTS[name]; changed = true;
        } else if (calls.length) {
          throw new Error(`package.json script "${name}" calls ${calls[0]}, which keel's roadmap replaces; point it at scripts/roadmap.mjs, then run keel update again`);
        }
      }
      if (tests?.script && pkg.scripts?.test !== tests.script) { pkg.scripts.test = tests.script; changed = true; }
      if (changed) put('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
    }
    const on = ['phases'];
    // Evidence converges only when nothing of the project's own stands in keel's way:
    // its own evidence template is its choice, not part of milestone→goal.
    if (Object.hasOwn(local, 'evidence') && parsed.every(p => !DONE.includes(p.status) || p.evidence.length)
        && !(await project.exists('docs/templates/evidence.md'))) on.push('evidence');
    for (const n of on) delete local[n];
    config.practices = [...new Set([...config.practices, ...on])]
      .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
    const agents = await project.read(project.guide ?? project.config.guide ?? 'AGENTS.md');
    if (agents !== null) {
      const missing = on.filter(n => !agents.includes(`<!-- keel:begin ${n} -->`));
      const next = appendBlocks(agents, missing);
      if (next !== agents) put(project.guide ?? project.config.guide ?? 'AGENTS.md', next);
    }
  }
  if (Object.keys(local).length) config.local = local; else delete config.local;
  const configText = `${JSON.stringify(config, null, 2)}\n`;
  if (configText !== await project.read('.keel/keel.json')) put('.keel/keel.json', configText);
}

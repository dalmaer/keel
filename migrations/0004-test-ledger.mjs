// 0004: every test run is remembered (phase 33). The night practice ships
// scripts/keel/test-ledger.mjs, a node test reporter that records each run in
// .keel/test-runs/ and ends it with a hygiene block (a flaky or slower test).
// This migration wires it in, in the project's update PR, where a person
// reviews it:
//
//   - package.json `scripts.test` gains the two reporter pairs, right after
//     `--test`, ONLY when it is node's runner: it starts with `node --test`
//     (or `node --import <x> … --test`), names no reporter of its own, and
//     does not have the ledger yet. Any other script (vitest, jest, a shell
//     line, `npm run …`) is never touched. Its other bytes stay as they are.
//   - AGENTS.md gains the night block's markers (empty; keel render fills
//     them: "a hygiene note is work"), unless the project skipped or
//     ejected that block.
//
// It applies while the night practice is on and either edit is owed;
// idempotent: once both are there, it does not apply.
export const id = '0004-test-ledger';
export const to = '0.7.0';
export const summary = 'node test scripts gain the test ledger reporter (scripts/keel/test-ledger.mjs: every run recorded in .keel/test-runs, a flaky or slower test named at the end of the run), and AGENTS.md the night block\'s markers; any other test script is left alone';

export const LEDGER = './scripts/keel/test-ledger.mjs';
/** The two reporter pairs, with the ledger at `ledger` (relative to where the script runs). */
export const reportersFor = (ledger = LEDGER) => `--test-reporter=spec --test-reporter-destination=stdout --test-reporter=${ledger} --test-reporter-destination=stdout`;
export const REPORTERS = reportersFor();
const BEGIN = '<!-- keel:begin night -->', END = '<!-- keel:end night -->';

/** node's runner, maybe after --import/--require preloads: the match up to and including --test. */
const NODE_TEST = /^node(?:\s+--(?:import|require)(?:=|\s+)\S+)*\s+--test(?=\s|$)/;

/** The script with the reporters (the ledger at `ledger`), or null when it is not node's runner or needs nothing. */
export function withLedger(script, ledger = LEDGER) {
  if (typeof script !== 'string') return null;
  const m = NODE_TEST.exec(script.trim());
  if (!m) return null;
  if (script.includes('test-ledger.mjs') || /--test-reporter(?:-destination)?(?:=|\s)/.test(script)) return null;
  const s = script.trim();
  return `${m[0]} ${reportersFor(ledger)}${s.slice(m[0].length)}`;
}

const night = config => (config?.practices ?? []).includes('night');
const guidePath = project => project.guide ?? project.config?.guide ?? 'AGENTS.md';
const blockOff = project => (project.config?.blocksSkipped ?? []).includes('night') || (project.config?.ejected ?? []).map(k => project.guideKey?.(k) ?? k).includes(`${guidePath(project)}#night`);

async function testScript(project) {
  const raw = await project.read('package.json');
  if (raw === null) return null;
  let pkg;
  try { pkg = JSON.parse(raw); } catch { return null; } // not ours to repair
  const next = withLedger(pkg?.scripts?.test);
  return next ? { raw, pkg, next } : null;
}

async function markersOwed(project) {
  if (blockOff(project)) return null;
  const text = await project.read(guidePath(project));
  if (text === null || text.includes(BEGIN)) return null;
  return text;
}

export async function applies(project) {
  if (!night(project.config)) return false;
  return !!(await testScript(project)) || (await markersOwed(project)) !== null;
}

export async function up(project) {
  const edits = [];
  const t = await testScript(project);
  if (t) {
    // Only the test script's own string changes, so the file keeps its layout.
    const old = JSON.stringify(t.pkg.scripts.test);
    const at = /("test"\s*:\s*)/g;
    let content = null;
    for (const m of t.raw.matchAll(at)) {
      const from = m.index + m[0].length;
      if (t.raw.startsWith(old, from)) { content = t.raw.slice(0, from) + JSON.stringify(t.next) + t.raw.slice(from + old.length); break; }
    }
    if (content === null || JSON.parse(content).scripts?.test !== t.next) {
      const pkg = { ...t.pkg, scripts: { ...t.pkg.scripts, test: t.next } };
      content = `${JSON.stringify(pkg, null, 2)}\n`;
    }
    edits.push({ path: 'package.json', content });
  }
  const agents = await markersOwed(project);
  if (agents !== null) edits.push({ path: guidePath(project), content: `${agents.replace(/\n*$/, '\n')}\n${BEGIN}\n${END}\n` });
  return edits;
}

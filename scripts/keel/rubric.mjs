// The robot's rubric (keel practice `climb`; managed: keel render rewrites
// it). An issue labelled keel:agent is work an agent can do alone when it
// holds every field below (keel phase 54; docs/research/
// 2026-10-09-robot-and-time.md). One home for the shape: `keel issue new
// --agent` writes it, scripts/keel/robot.mjs triages against it, and
// .github/ISSUE_TEMPLATE/keel-agent.md is it, unfilled. Pure, no imports,
// so the CLI and the project's scripts read the same file.

/** The label that puts an issue in the robot's queue. */
export const LABEL = 'keel:agent';

/**
 * The rubric. A section is a `## <heading>` with text under it; a check is a
 * ticked box (`- [x] <text>`) under `## For an agent`. `ask` is how the
 * triage names a missing one.
 */
export const RUBRIC = Object.freeze([
  Object.freeze({ id: 'wrong', heading: 'What is wrong', ask: 'what is wrong' }),
  Object.freeze({ id: 'see', heading: 'How to see it', ask: 'how to see it (a command, a test, or the steps)' }),
  Object.freeze({ id: 'mended', heading: 'How to tell it is mended', ask: 'how to tell when it is mended' }),
  Object.freeze({ id: 'owner', check: 'Needs nothing only the owner can give (no product choice, no secret, no exit-3 step)', ask: 'a ticked box saying it needs nothing only the owner can give' }),
  Object.freeze({ id: 'one', check: 'One change that fits in one run', ask: 'a ticked box saying it is one change that fits in one run' }),
  Object.freeze({ id: 'pushed', check: 'Waits on no work that is not on the default branch', ask: 'a ticked box saying it waits on no unpushed work' }),
]);
export const CHECKS_HEADING = 'For an agent';
/** The hidden line `keel issue new --agent` ends the body with. */
export const MARK = '<!-- keel:agent-issue -->';

const words = s => String(s ?? '').trim();
const norm = s => words(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** A check's words up to its parenthesis: what a ticked box must start with. */
const checkKey = c => norm(c.check.replace(/\s*\(.*$/, ''));

/**
 * The body of an issue in the rubric's shape: each section, then the three
 * boxes, ticked when `ticked` (the writer affirms them), empty for the
 * template. `fields`: { wrong, see, mended }.
 */
export function rubricBody(fields = {}, { ticked = true, placeholder = false } = {}) {
  const out = [];
  for (const r of RUBRIC.filter(r => r.heading)) {
    const v = words(fields[r.id]);
    out.push(`## ${r.heading}`, '', v || (placeholder ? `<!-- ${r.ask} -->` : ''), '');
  }
  out.push(`## ${CHECKS_HEADING}`, '');
  for (const r of RUBRIC.filter(r => r.check)) out.push(`- [${ticked ? 'x' : ' '}] ${r.check}`);
  out.push('', MARK, '');
  return out.join('\n');
}

/** The `## ` sections of a Markdown body: Map(normalised heading → text). */
export function sectionsOf(body) {
  const out = new Map();
  let at = null, lines = [];
  const flush = () => { if (at !== null && !out.has(at)) out.set(at, lines.join('\n')); };
  for (const line of String(body ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const h = /^#{2,3}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { flush(); at = norm(h[1]); lines = []; continue; }
    if (at !== null) lines.push(line);
  }
  flush();
  return out;
}

/** Text that says something: no HTML comments, no blank lines, no lone placeholder. */
const said = text => words(String(text ?? '').replace(/<!--[\s\S]*?-->/g, '')).replace(/^(_+|\.\.\.|…|tbd|todo|n\/a|none)$/i, '');

/**
 * Which rubric fields an issue body misses: [{ id, ask }], empty when it
 * holds them all. Pure: the body is the issue's, as the owner wrote it (a
 * comment never fills a field; editing the body does).
 */
export function triage(body) {
  const sections = sectionsOf(body);
  const missing = [];
  for (const r of RUBRIC.filter(r => r.heading)) if (!said(sections.get(norm(r.heading)))) missing.push({ id: r.id, ask: r.ask });
  const boxes = String(sections.get(norm(CHECKS_HEADING)) ?? '').split('\n')
    .map(l => /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(l)).filter(Boolean).map(m => ({ ticked: m[1] !== ' ', key: norm(m[2]) }));
  for (const r of RUBRIC.filter(r => r.check)) if (!boxes.some(b => b.ticked && b.key.startsWith(checkKey(r)))) missing.push({ id: r.id, ask: r.ask });
  return missing;
}

/** What the triage says on the issue: each missing field named, and how to put the issue back in the queue. */
export function missingText(missing) {
  return [
    `This issue is labelled \`${LABEL}\`, but it misses part of the rubric, so the robot will not work it yet:`,
    '',
    ...missing.map(m => `- ${m.ask}`),
    '',
    `Edit the issue's body to add ${missing.length === 1 ? 'it' : 'them'} (the shape is \`keel issue new --agent\`'s: a \`## What is wrong\`, \`## How to see it\` and \`## How to tell it is mended\` section, and the three boxes under \`## ${CHECKS_HEADING}\`, ticked). The robot reads the body again on its next run. A comment does not fill a field.`,
  ].join('\n');
}

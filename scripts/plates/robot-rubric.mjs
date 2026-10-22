// Pure, shared issue rubric. Structure is not evidence that the work is safe.
export const ROBOT_RUBRIC_LIMITS = Object.freeze({ fieldChars: 4000, itemChars: 1000, items: 16, totalChars: 16000, bodyChars: 60000 });
const fields = ['problem', 'reproduction', 'acceptance', 'change'];
const lists = ['prerequisites', 'ownerBlockers'];
const begin = '<!-- keel:robot-rubric:v1 -->';
const end = '<!-- /keel:robot-rubric:v1 -->';
const headings = { problem: 'Problem', reproduction: 'Reproduction', acceptance: 'Acceptance', change: 'One change', prerequisites: 'Prerequisites', ownerBlockers: 'Owner blockers' };
const text = value => typeof value === 'string' && value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function validateRobotRubric(value) {
  const problems = [];
  const bad = (field, code, message) => problems.push({ field, code, message });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, rubric: null, problems: [{ field: 'rubric', code: 'object', message: 'rubric must be an object' }] };
  if (value.version !== 1) bad('version', 'version', 'version must be 1');
  const rubric = { version: 1 };
  for (const field of fields) {
    if (!text(value[field]) || value[field].length > ROBOT_RUBRIC_LIMITS.fieldChars) bad(field, 'text', `${field} needs nonblank text, at most ${ROBOT_RUBRIC_LIMITS.fieldChars} characters`);
    else rubric[field] = value[field].trim();
  }
  for (const field of lists) {
    const list = value[field];
    if (!Array.isArray(list) || list.length > ROBOT_RUBRIC_LIMITS.items || list.some(v => !text(v) || v.length > ROBOT_RUBRIC_LIMITS.itemChars)) bad(field, 'list', `${field} needs an explicit array of at most ${ROBOT_RUBRIC_LIMITS.items} nonblank strings (${ROBOT_RUBRIC_LIMITS.itemChars} characters each); [] means none`);
    else rubric[field] = list.map(v => v.trim());
  }
  if (value.decisions !== undefined) {
    if (!Array.isArray(value.decisions) || value.decisions.length > 100 || value.decisions.some(v => !text(v) || v.length > 1024)) bad('decisions', 'list', 'decisions needs bounded explicit references');
    else rubric.decisions = [...value.decisions];
  }
  for (const field of Object.keys(value)) if (!['version', 'decisions', ...fields, ...lists].includes(field)) bad(field, 'unknown', 'unknown rubric field');
  if (JSON.stringify(rubric).length > ROBOT_RUBRIC_LIMITS.totalChars) bad('rubric', 'size', `rubric exceeds ${ROBOT_RUBRIC_LIMITS.totalChars} characters`);
  if (!problems.length && render(rubric).length > ROBOT_RUBRIC_LIMITS.bodyChars - 1000) bad('rubric', 'size', 'escaped rubric exceeds the issue body budget');
  return { ok: !problems.length, rubric: problems.length ? null : rubric, problems };
}
const escaped = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function formatRobotRubric(value) {
  const checked = validateRobotRubric(value);
  if (!checked.ok) throw new Error(checked.problems.map(p => p.message).join('; '));
  return render(checked.rubric);
}
function render(r) {
  const json = JSON.stringify(r).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  return [begin, ...[...fields, ...lists].map(f => `### ${headings[f]}\n\n${(Array.isArray(r[f]) ? r[f].length ? r[f].map(s => `- ${escaped(s)}`).join('\n') : 'None.' : escaped(r[f]))}`), `<!-- keel:robot-data ${json} -->`, end].join('\n\n');
}
export function parseRobotRubric(body) {
  const fail = message => ({ ok: false, rubric: null, problems: [{ field: 'rubric', code: 'section', message }] });
  if (typeof body !== 'string' || body.length > ROBOT_RUBRIC_LIMITS.bodyChars) return fail('issue body unavailable or too large');
  if (body.split(begin).length !== 2 || body.split(end).length !== 2 || body.split('<!-- keel:robot-data ').length !== 2) return fail('exactly one versioned robot rubric section is required');
  const start = body.indexOf(begin), finish = body.indexOf(end) + end.length;
  const section = body.slice(start, finish);
  // JSON.stringify preserves U+2028/U+2029 inside strings. Accept those
  // separators without changing canonical rendering or durable rubric identity.
  const match = /<!-- keel:robot-data ([^\r\n]*) -->/.exec(section);
  if (!match) return fail('rubric data is missing');
  try {
    const checked = validateRobotRubric(JSON.parse(match[1]));
    if (!checked.ok) return checked;
    if (formatRobotRubric(checked.rubric) !== section) return fail('rubric headings and data disagree; regenerate from the rubric file');
    return checked;
  } catch { return fail('rubric data is malformed'); }
}
/**
 * The robot's rubric check on an issue body, as its admission reads it: null
 * when the robot would take the issue, else why not. One section that parses
 * and round-trips; no owner blocker; no prerequisite (fail-closed until
 * verified: prose is not evidence). robot.mjs admits through this, and plates
 * goodnight checks a drafted rubric with it before an item may be a build
 * (plates phase 78), so a draft the robot would refuse is never planned.
 */
export function robotRubricRefusal(body) {
  const parsed = parseRobotRubric(body);
  if (!parsed.ok) return `rubric: ${parsed.problems.map(p => p.message).join('; ')}`;
  if (parsed.rubric.ownerBlockers.length) return 'owner-only blockers remain';
  if (parsed.rubric.prerequisites.length) return 'prerequisite verification unavailable; resolve prerequisites before labelling';
  return null;
}

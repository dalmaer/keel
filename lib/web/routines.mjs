import { workflowTriggers } from '../adopt.mjs';
import { workflowPath, text, issue } from './run-model.mjs';
import { numeric } from './common.mjs';
const immutableUrl = (project, revision, path) => `https://github.com/${project.repo}/blob/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
const scalar = value => {
  value = value.trim();
  if (!value || /[{}\[\]&*!>|`]|\$\{|\t/.test(value)) return null;
  if (/^(['"]).*\1$/.test(value)) return value.slice(1, -1);
  if (/['"#]/.test(value)) return null;
  return value;
};
function section(lines, key, indent = 0, start = 0) {
  const at = lines.findIndex((line, i) => i >= start && new RegExp(`^ {${indent}}(?:${key}|"${key}"|'${key}'):`).test(line));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s*#/.test(lines[end]) || lines[end].search(/\S/) > indent)) end++;
  return { at, end, lines: lines.slice(at, end) };
}
// Only flat literal maps are interpreted. Nested/flow/anchored YAML stays unknown.
function literalMap(lines, key) {
  const block = section(lines, key);
  if (!block) return null;
  const inline = block.lines[0].slice(block.lines[0].indexOf(':') + 1).trim();
  if (inline) return scalar(inline);
  const result = {};
  for (const line of block.lines.slice(1).filter(l => l.trim() && !/^\s*#/.test(l))) {
    const match = /^  ([A-Za-z_][A-Za-z0-9_-]*): (.+)$/.exec(line), value = match && scalar(match[2]);
    if (!match || value === null || Object.hasOwn(result, match[1])) return null;
    result[match[1]] = value;
  }
  return Object.keys(result).length ? result : null;
}
function inputsOf(lines) {
  const on = section(lines, 'on'), dispatch = on && section(lines, 'workflow_dispatch', 2, on.at + 1);
  if (!dispatch || dispatch.at >= on.end) return null;
  const input = section(lines, 'inputs', 4, dispatch.at + 1);
  if (!input || input.at >= dispatch.end) return null;
  const result = {}; let current;
  for (const line of input.lines.slice(1).filter(l => l.trim() && !/^\s*#/.test(l))) {
    const name = /^      ([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (name) { if (Object.hasOwn(result, name[1]) || Object.keys(result).length >= 20) return null; current = result[name[1]] = {}; continue; }
    const field = /^        (description|required|type|default): (.+)$/.exec(line), value = field && scalar(field[2]);
    if (!current || !field || value === null || Object.hasOwn(current, field[1])) return null;
    current[field[1]] = value;
  }
  return Object.keys(result).length ? result : null;
}
export function routineDefinition(project, source, path, content) {
  const lines = content.split('\n'), gaps = [];
  const rawTriggers = workflowTriggers(content), triggers = rawTriggers.filter(t => /^[a-z][a-z_]{0,79}$/.test(t));
  const unresolved = block => !!block && /\$\{\{|(?:^|\s)[&*][A-Za-z_]|\t/.test(block.lines.join('\n'));
  const on = section(lines, 'on'), unsafe = unresolved(on), schedule = on && section(lines, 'schedule', 2, on.at + 1);
  let schedules = [];
  if (schedule && schedule.at < on.end && !unsafe) {
    const useful = schedule.lines.slice(1).filter(l => l.trim() && !/^\s*#/.test(l));
    const parsed = useful.map(l => /^    - cron:\s*(['"])([^'"\r\n]{1,160})\1\s*$/.exec(l)?.[2] ?? null);
    if (parsed.length && parsed.length <= 20 && parsed.every(v => v && v.trim().split(/\s+/).length === 5 && /^[\d*?/,\-\s]+$/.test(v))) schedules = parsed;
    else gaps.push(issue(path, 'Schedule YAML is unsupported; no next execution time is inferred.'));
  }
  if (unsafe || !triggers.length || triggers.length !== rawTriggers.length) gaps.push(issue(path, 'Expressions, anchors or unresolved trigger syntax remain unknown.'));
  const permissions = unresolved(section(lines, 'permissions')) ? null : literalMap(lines, 'permissions'), concurrency = unresolved(section(lines, 'concurrency')) ? null : literalMap(lines, 'concurrency'), inputs = unsafe ? null : inputsOf(lines);
  gaps.push(issue(path, 'Restricted metadata extraction is not full YAML evaluation. Runner availability, implicit permissions, next run and actual budget usage remain unknown.', 'source-declaration'));
  const name = lines.find(l => /^name:/.test(l));
  return { id: path, providerId: null, name: name ? scalar(name.slice(5)) ?? path.split('/').at(-1) : path.split('/').at(-1), path, revision: source.head,
    url: immutableUrl(project, source.head, path), providerState: null, triggers: unsafe ? [] : triggers, schedules,
    timezone: schedules.length ? 'UTC' : null, worker: null, permissions, inputs, budget: null, concurrency,
    nextRun: null, declaration: 'immutable-source', gaps };
}
export async function readRoutineDefinitions(project, snapshot) {
  const paths = [...snapshot.entries.keys()].filter(workflowPath).sort(), routines = [], gaps = [];
  if (!paths.length) gaps.push(issue('workflows', 'No workflow files were found at the selected source revision.', 'absent'));
  if (paths.length > 30) gaps.push(issue('workflows', `${paths.length - 30} workflow files remain beyond the thirty-file source bound.`, 'limit'));
  for (const path of paths.slice(0, 30)) {
    try {
      const raw = await snapshot.reader.readFile(path);
      const definition = routineDefinition(project, snapshot.source, path, new TextDecoder('utf-8', { fatal: true }).decode(raw));
      routines.push(definition); gaps.push(...definition.gaps);
    } catch (error) {
      if ([401, 403, 404].includes(error.status)) throw error;
      gaps.push(issue(path, 'Workflow source is invalid, unavailable or exceeds its byte bound.', error.code ?? 'unavailable'));
    }
  }
  return { routines, gaps };
}
export function mergeWorkflowInventory(project, source, definitions, workflows) {
  const routines = new Map(definitions.map(d => [d.path, d])), gaps = [], seen = new Map(), conflicts = new Set();
  for (const value of workflows) {
    if (!numeric(value?.id) || !workflowPath(value.path) || typeof value.state !== 'string' || value.state.length > 80) { gaps.push(issue('workflows', 'Provider workflow has invalid identity, path or state.')); continue; }
    const fact = { id: value.id, path: value.path, state: value.state, name: text(value.name) };
    if (seen.has(value.id) && JSON.stringify(seen.get(value.id)) !== JSON.stringify(fact)) { conflicts.add(value.id); gaps.push(issue('workflows', `Conflicting provider workflow ${value.id}; its state is unavailable.`, 'conflict')); }
    else seen.set(value.id, fact);
  }
  const pathConflicts = new Set();
  for (const fact of seen.values()) {
    if (conflicts.has(fact.id)) continue;
    const original = routines.get(fact.path);
    if (pathConflicts.has(fact.path)) continue;
    if (original?.providerId && original.providerId !== fact.id) { pathConflicts.add(fact.path); original.providerId = null; original.providerState = null; gaps.push(issue(fact.path, 'Multiple provider workflow IDs use this path; state is ambiguous.', 'conflict')); continue; }
    routines.set(fact.path, original ? { ...original, providerId: fact.id, providerState: fact.state }
      : { id: fact.path, providerId: fact.id, name: fact.name || fact.path, path: fact.path, revision: null, url: null, providerState: fact.state, triggers: [], schedules: [], timezone: null, worker: null, permissions: null, inputs: null, budget: null, concurrency: null, nextRun: null, declaration: 'provider-only', gaps: [issue(fact.path, 'Provider workflow is not among the observed immutable source definitions.')] });
  }
  return { routines: [...routines.values()], gaps };
}

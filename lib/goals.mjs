// keel goal add|show|retire and keel phase new|list: what the project is for,
// and the phases lined up behind it (design §5 "Goals over phases").
//
// Goals live in docs/goals.json, phases in docs/phases/NN-*.md. Progress is
// derived from the phases, never stored. Every write regenerates the roadmap
// with keel's own copy of the phases practice's script, and a write the
// roadmap rejects is put back.
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { collect, nextPhase, run as roadmap, DONE, livedInOf } from '../practices/phases/files/scripts/roadmap.mjs';

const TEMPLATE = new URL('../practices/phases/files/docs/templates/phase.md', import.meta.url);

export class GoalError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const unbuilt = p => !DONE.includes(p.status) && p.status !== 'superseded';
const goalsPath = root => join(root, 'docs', 'goals.json');
const phaseRow = ({ id, file, title, status }) => ({ id, file, title, status });

/**
 * goals.json in the style it was written: keel's own one-goal-per-line style
 * when the file uses it, else JSON.stringify(goals, null, 2). Keys keep their order.
 */
export function formatGoals(goals, raw = '') {
  const lines = raw.trim().split('\n');
  const oneLine = lines.length > 2 && lines[0] === '[' && lines.at(-1) === ']' && lines.slice(1, -1).every(l => /^ {2}\{ .* \},?$/.test(l));
  const body = oneLine
    ? `[\n${goals.map(g => `  { ${Object.entries(g).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`).join(',\n')}\n]`
    : JSON.stringify(goals, null, 2);
  return `${body}\n`;
}

/** Write files, regenerate the roadmap; if the roadmap rejects the result, put every file back. */
async function commit(root, writes) {
  const before = [];
  for (const [path, content] of writes) {
    before.push([path, await readFile(path, 'utf8').catch(() => null)]);
    await writeFile(path, content);
  }
  try {
    await roadmap({ root, mode: 'write' });
  } catch (e) {
    for (const [path, content] of before) await (content === null ? unlink(path) : writeFile(path, content));
    throw new GoalError(`nothing written; the roadmap rejects the result: ${e.message}`, 1);
  }
}

function findGoal(goals, id) {
  if (!/^G\d+$/.test(id ?? '')) throw new GoalError(`a goal id looks like G1, not "${id ?? ''}"`);
  const g = goals.find(x => x.id === id);
  if (!g) throw new GoalError(`no goal ${id}; goals: ${goals.map(x => x.id).join(', ')}`);
  return g;
}

/** Progress and the next phase of one goal. Deps may sit in other goals. */
export function show(data, id) {
  const goal = findGoal(data.goals, id);
  const group = data.phases.filter(p => p.goal === id);
  return {
    goal,
    phases: group.map(({ id, title, status }) => ({ id, title, status })),
    built: group.filter(p => DONE.includes(p.status)).length,
    lived: group.filter(p => p.status === 'lived-in').length,
    next: nextPhase(data.phases, p => p.goal === id),
  };
}

export async function goalShow({ root, id }) {
  const all = await collect(root), data = show(all, id);
  const { goal, phases, built, lived, next } = data;
  return {
    data,
    text: [`${goal.id} — ${goal.title}${goal.retired ? ` (retired ${goal.retired})` : ''}`, goal.outcome,
      livedInOf(all.config) ? `${built}/${phases.length} built or lived-in, ${lived}/${phases.length} lived-in` : `${built}/${phases.length} built`,
      ...phases.map(p => `  ${p.id}. ${p.title} [${p.status}]`),
      phases.length ? '' : `No phases yet: keel phase new "<title>" --goal ${goal.id}`,
      next ? `Next: ${next.id}. ${next.title} — docs/phases/${next.file}` : 'Next: nothing ready in this goal.'].filter(l => l !== '').join('\n'),
  };
}

export async function goalAdd({ root, title, outcome }) {
  if (!title?.trim()) throw new GoalError('keel goal add "<title>" --outcome "<one sentence>"');
  if (!outcome?.trim()) throw new GoalError('--outcome is required: the outcome, in one sentence a person could check');
  const { goals } = await collect(root);
  const raw = await readFile(goalsPath(root), 'utf8');
  const id = `G${Math.max(-1, ...goals.map(g => Number(g.id.slice(1)))) + 1}`;
  const goal = { id, title: title.trim(), outcome: outcome.trim() };
  await commit(root, [[goalsPath(root), formatGoals([...goals, goal], raw)]]);
  return {
    data: { ok: true, goal, file: 'docs/goals.json' },
    text: `Added ${id} — ${goal.title}. It has no phase yet; keel doctor reports that until one names it:\n  keel phase new "<title>" --goal ${id}`,
  };
}

/** Set one front-matter field of a phase file, leaving every other byte. */
export function setMeta(raw, key, value) {
  const block = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw);
  const line = new RegExp(`^${key}:.*$`, 'm');
  if (!block || !line.test(block[0])) throw new GoalError(`no ${key} line in the front matter`, 1);
  return block[0].replace(line, `${key}: ${value}`) + raw.slice(block[0].length);
}

export async function goalRetire({ root, id, reason, phases: what, yes = false, date = today() }) {
  if (!reason?.trim()) throw new GoalError('--reason is required: retiring a goal says why');
  const data = await collect(root);
  const goal = findGoal(data.goals, id);
  if (goal.retired) throw new GoalError(`${id} is already retired: ${goal.retired}`);
  const open = data.phases.filter(p => p.goal === id && unbuilt(p));
  const retired = `${date}: ${reason.trim().replace(/\s+/g, ' ')}`;
  let move;
  if (what !== undefined) {
    const m = /^(supersede|move:(G\d+))$/.exec(what);
    if (!m) throw new GoalError('--phases takes supersede or move:<Gm>');
    if (m[2]) {
      const to = findGoal(data.goals, m[2]);
      if (to.id === id) throw new GoalError(`move:${id} would leave the phases under the goal being retired`);
      if (to.retired) throw new GoalError(`${to.id} is retired; move the phases to a live goal`);
      move = to.id;
    }
  }
  if (open.length && what === undefined) {
    return {
      data: { ok: false, needs: 'phases', goal: id, unbuilt: open.map(phaseRow), options: ['supersede', 'move:<Gm>'] },
      text: [`${id} has ${open.length} unbuilt phase${open.length > 1 ? 's' : ''}:`, ...open.map(p => `  ${p.id}. ${p.title} [${p.status}] — docs/phases/${p.file}`),
        'Say what happens to them:', `  --phases supersede   mark each superseded: "Goal ${id} retired: <reason>"`,
        '  --phases move:<Gm>   give them to another goal', 'Nothing was changed.'].join('\n'),
      exitCode: 2,
    };
  }
  const plan = {
    goal: id, retired,
    phases: open.map(p => move ? { ...phaseRow(p), action: 'move', to: move } : { ...phaseRow(p), action: 'supersede' }),
  };
  const planText = [`Retire ${id} — ${goal.title}: "${retired}"`,
    ...plan.phases.map(p => `  ${p.id}. ${p.title}: ${p.action === 'move' ? `goal ${id} → ${p.to}` : `${p.status} → superseded`} (docs/phases/${p.file})`)];
  if (open.length && !yes) {
    return {
      data: { ok: false, needs: 'yes', plan },
      text: [...planText, `This rewrites ${open.length} phase file${open.length > 1 ? 's' : ''}. Nothing was changed; re-run with --yes.`].join('\n'),
      exitCode: 3,
    };
  }
  const writes = [];
  for (const p of open) {
    const path = join(root, 'docs', 'phases', p.file);
    let raw = await readFile(path, 'utf8');
    if (move) raw = setMeta(raw, 'goal', move);
    else {
      raw = setMeta(raw, 'status', 'superseded');
      raw = setMeta(raw, 'since', date);
      raw = setMeta(raw, 'note', JSON.stringify(`Goal ${id} retired: ${reason.trim().replace(/\s+/g, ' ')}`));
    }
    writes.push([path, raw]);
  }
  const raw = await readFile(goalsPath(root), 'utf8');
  writes.push([goalsPath(root), formatGoals(data.goals.map(g => g.id === id ? { ...g, retired } : g), raw)]);
  await commit(root, writes);
  return { data: { ok: true, plan }, text: [...planText, 'Done; the roadmap is regenerated.'].join('\n') };
}

/** keel's own slug rule, cut at a word near 48 characters. */
const slugOf = title => {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.length <= 48 ? s : s.slice(0, 48).replace(/-[^-]*$/, '') || s.slice(0, 48);
};

/**
 * The next free phase number and its width: max over every NN-*.md in
 * docs/phases, plus one — even one the roadmap rejects, so a number is never
 * reused. Two digits unless the project names its phases with one (7-x.md).
 */
export function nextNumber(names) {
  const nums = names.map(n => /^(\d+)-/.exec(n)?.[1]).filter(Boolean);
  const id = nums.length ? Math.max(...nums.map(Number)) + 1 : 0;
  const width = nums.length ? Math.min(...nums.map(n => n.length)) : 2;
  return { id, name: String(id).padStart(width, '0') };
}

export async function phaseNew({ root, title, goal: goalId, depends, date = today() }) {
  if (!title?.trim()) throw new GoalError('keel phase new "<title>" --goal <id> [--depends 1,2]');
  if (!goalId) throw new GoalError('--goal is required: every phase serves a goal');
  const data = await collect(root);
  const goal = findGoal(data.goals, goalId);
  if (goal.retired) throw new GoalError(`${goal.id} is retired: ${goal.retired}`);
  const deps = depends === undefined ? [] : depends.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    if (!/^\d+$/.test(s)) throw new GoalError(`--depends takes phase numbers, like 1,2; not "${s}"`);
    const n = Number(s);
    if (!data.phases.some(p => p.id === n)) throw new GoalError(`--depends: no phase ${n}`);
    return n;
  });
  const slug = slugOf(title);
  if (!slug) throw new GoalError('the title needs a letter or a digit to name the file');
  const dir = join(root, 'docs', 'phases');
  const { id, name } = nextNumber((await readdir(dir)).filter(n => n.endsWith('.md') && n !== 'README.md'));
  const file = `${name}-${slug}.md`;
  const template = await readFile(join(root, 'docs', 'templates', 'phase.md'), 'utf8').catch(() => readFile(TEMPLATE, 'utf8'));
  const body = template.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/^# .+$/m, `# ${title.trim()}`);
  // The template's spec version comes with it: a phase drafted from it is held to it.
  const spec = /^spec:\s*(\d+)\s*$/m.exec(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(template)?.[1] ?? '')?.[1];
  const meta = ['---', 'status: planned', `since: ${date}`, `goal: ${goal.id}`, ...(spec ? [`spec: ${spec}`] : []), `depends: ${JSON.stringify([...new Set(deps)])}`,
    `note: ${JSON.stringify('Drafted by keel phase new.')}`, 'evidence: []', '---', ''].join('\n');
  await commit(root, [[join(dir, file), meta + body]]);
  return {
    data: { ok: true, id, file, path: `docs/phases/${file}`, goal: goal.id, depends: [...new Set(deps)] },
    text: `Drafted docs/phases/${file} (phase ${id}, ${goal.id}). The roadmap check refuses it until the template's text is replaced: write its Done when, Acceptance (each box naming its check), Real surfaces and Proof before conducting it.`,
  };
}

export async function phaseList({ root }) {
  const { phases } = await collect(root);
  return { data: phases, text: phases.map(p => `${p.id}. ${p.title} [${p.status}] ${p.goal} — docs/phases/${p.file}`).join('\n') };
}

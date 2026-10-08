// keel board: whose turn it is, and what is mine (keel phase 51;
// docs/research/2026-10-08-whose-turn-board.md).
//
//   keel board --json        every open item, each { waits, title, why, read,
//                            link, source, actions }, and each source's state
//   keel board [--open]      the same, as a page on 127.0.0.1 (a free port and
//                            a per-launch token, both printed with the URL)
//   keel walk done <phase> --note "<what you saw>" [--box <n>]
//   keel walk decide --proposal <health page> --accept ["<why>"] | --decline "<why>"
//
// The board derives nothing its sources do not already say. Sources:
//   roadmap      the phase files (roadmap.mjs): a walk owed → owner, time or
//                external by its `waits:`; buildable phases in nextPhase's
//                order → agent; a phase dated `after:` a day to come → time
//   loose-ends   keel loose-ends (every fleet checkout): a step marked
//                "⚑ yours", a question a session asked, a phase's ⚑ next
//                action → owner; the rest by kind (files, branches, PRs:
//                agent). Its review, and home's health and inbox items, come
//                from the sources below instead, so nothing is listed twice
//   reviews      unanswered review comments on open PRs, home and each managed
//                fleet repo (the night's repo-wide read; at most REVIEW_REPOS)
//                → broken
//   health       the newest health page's proposal, undecided → owner
//   inbox        lessons proposed and waiting for a person → owner, settled
//                by keel learn decide (not re-implemented here)
//   fleet        keel fleet (home only): the strip, and red CI → broken
// A source that cannot be read is listed in `sources` as n/a with why, never
// left out. gh is KEEL_GH or gh, as everywhere; tests inject the sources.
//
// Writes: walk done and walk decide only, each to the working tree, printing
// the diff. Committing stays the conductor's (the gate runs first).
import { readFile, readdir, writeFile, mkdir, unlink } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join, resolve, relative, isAbsolute } from 'node:path';
import {
  collect, parsePhase, sectionsOf, boxes, isWalk, owesWalk, waitsOf, dated, satisfies, DONE, localToday, run as roadmap,
} from '../practices/phases/files/scripts/roadmap.mjs';
import { healthDirOf, repoReviewArgs, readRepoReviews, unansweredPrs, reviewConfigOf } from '../practices/night/files/scripts/keel/lib.mjs';
import { proposals } from './learn.mjs';

export const COLUMNS = Object.freeze([
  { waits: 'owner', title: 'Yours' },
  { waits: 'broken', title: 'Broken' },
  { waits: 'agent', title: "The agent's" },
  { waits: 'time', title: 'Waiting on time' },
  { waits: 'external', title: 'Waiting on something outside' },
]);
export const WAITS = COLUMNS.map(c => c.waits);
/** The verbs an action may run: the board writes nothing its own way. */
export const ACTION_VERBS = Object.freeze(['walk done', 'walk decide', 'learn decide']);
export const REVIEW_REPOS = 12;
const GH_TIMEOUT = 15_000;
export const DIFF_NOTE = 'left as a diff: commit it when the gate passes';

export class BoardError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const exec = (cmd, args, { env, timeout = GH_TIMEOUT, cwd } = {}) => new Promise(done => {
  execFile(cmd, args, { env, cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    done(error ? { ok: false, why: String(stderr || error.message).trim().split('\n').filter(Boolean).pop() ?? 'failed', stdout: stdout ?? '' } : { ok: true, stdout });
  });
});
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n = 160) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const blob = (config, path) => /^[\w.-]+\/[\w.-]+$/.test(config?.repo ?? '') ? `https://github.com/${config.repo}/blob/main/${path}` : null;

// ---- the sources ---------------------------------------------------------------

const OWNER_STEP = /^\s*(⚑|owner\b)/i;

/** The open walk boxes of a phase file's Acceptance: [{ n (1-based among all boxes), text, walk }]. */
export function openBoxes(raw) {
  const block = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  return boxes(sectionsOf(block?.[1] ?? '').Acceptance ?? '').map((b, i) => ({ n: i + 1, ...b, walk: isWalk(b.text) })).filter(b => !b.checked);
}

/** The roadmap's items: walks owed, buildable phases, dated ones. */
export async function roadmapItems(root, { today = localToday(), read = collect } = {}) {
  const data = await read(root);
  const retired = new Set(data.goals.filter(g => g.retired).map(g => g.id));
  const byId = new Map(data.phases.map(p => [p.id, p]));
  const items = [];
  for (const p of data.phases) {
    if (retired.has(p.goal) || DONE.includes(p.status) || p.status === 'superseded') continue;
    const path = `docs/phases/${p.file}`;
    const base = { title: `phase ${p.id}: ${p.title}`, read: path, link: blob(data.config, path), source: 'roadmap', phase: p.id };
    if (owesWalk(p)) {
      const raw = await readFile(join(root, path), 'utf8');
      const walks = openBoxes(raw).filter(b => b.walk);
      const several = walks.length > 1;
      items.push({ ...base, waits: waitsOf(p), kind: 'walk',
        why: `walk owed${p.waits && p.waits !== 'owner' ? ` (waits on ${p.waits})` : ''}: ${walks.map(b => clip(b.text, 200)).join(' · ')}`,
        next: p.next,
        actions: walks.flatMap(b => [
          { label: several ? `Box ${b.n}: done — looks good` : 'Done — looks good', verb: 'walk done', args: [String(p.id), ...(several ? ['--box', String(b.n)] : []), '--note', 'Looks good.'] },
          { label: several ? `Box ${b.n}: done, with a note` : 'Done, with a note', verb: 'walk done', args: [String(p.id), ...(several ? ['--box', String(b.n)] : [])], note: 'required' },
        ]) });
      continue;
    }
    if (dated(p, today)) {
      items.push({ ...base, waits: 'time', kind: 'dated', why: `not buildable before ${p.after}`, next: p.next, actions: [] });
      continue;
    }
    if (p.depends.every(id => satisfies(byId.get(id)))) {
      // A buildable phase whose next action is the owner's (⚑, or "Owner …") is the owner's turn, as loose-ends reads it.
      const owners = OWNER_STEP.test(p.next ?? '');
      items.push({ ...base, waits: owners ? 'owner' : 'agent', kind: owners ? 'step' : 'phase', why: `${p.status}: ${clip(p.next, 200)}`, next: p.next, actions: [] });
    }
  }
  return { items, config: data.config };
}

/** loose-ends' items, mapped: "⚑ yours" and questions to the owner; reviews and home's health and inbox are other sources'. */
export function looseItems(data, { home } = {}) {
  const items = [];
  for (const r of data?.projects ?? []) {
    // Uncommitted files are one item per project, not one each.
    const files = (r.items ?? []).filter(it => it.kind === 'file' && it.state !== 'hidden');
    if (files.length) {
      items.push({ waits: 'agent', kind: 'files', title: `${r.repo}: ${files.length} uncommitted file${files.length === 1 ? '' : 's'}`,
        why: `${files.slice(0, 6).map(f => f.title).join(', ')}${files.length > 6 ? ', …' : ''} → commit them, or put them back`, read: `git -C ${r.dir} status`, link: null,
        source: 'loose-ends', commands: [`git -C ${r.dir} status`], actions: [] });
    }
    for (const it of r.items ?? []) {
      if (it.kind === 'file') continue;
      if (it.state === 'hidden' || it.kind === 'review') continue;
      const isHome = r.dir && home && resolve(r.dir) === resolve(home);
      if (isHome && ['health', 'inbox'].includes(it.kind)) continue;
      if (isHome && it.kind === 'phase') continue; // the roadmap source reads home's phases
      const yours = /⚑ yours/.test(it.move ?? '') || ['phase', 'health', 'inbox', 'lessons', 'repo'].includes(it.kind) || (it.kind === 'session' && it.ending === 'question');
      items.push({ waits: yours ? 'owner' : 'agent', kind: it.kind, title: `${r.repo}: ${it.kind === 'session' ? `"${it.title}"` : it.title}`,
        why: [it.detail, it.move && `→ ${it.move}`].filter(Boolean).join(' '), read: it.commands?.[0] ?? null, link: it.url ?? null,
        source: 'loose-ends', id: it.id, commands: it.commands ?? [], actions: [] });
    }
  }
  return items;
}

/** Unanswered review comments on open PRs, one item per PR: the night's repo-wide read, per repo. */
export async function reviewItems(repos, { env = process.env, today = localToday(), read } = {}) {
  const items = [], failed = [];
  const list = repos.slice(0, REVIEW_REPOS);
  const readRepo = read ?? (async ({ repo, reviewers }) => {
    const page = async vars => {
      const r = await exec(env.KEEL_GH || 'gh', repoReviewArgs(repo, vars), { env });
      if (!r.ok) throw new Error(r.why);
      let out;
      try { out = JSON.parse(r.stdout); } catch { throw new Error('gh gave no JSON'); }
      return out?.data?.repository;
    };
    return unansweredPrs(await readRepoReviews(page, today), reviewers, today).prs;
  });
  await Promise.all(list.map(async x => {
    try {
      for (const pr of (await readRepo(x)).filter(p => p.state === 'open')) {
        items.push({ waits: 'broken', kind: 'review', title: `${x.repo}#${pr.number}: ${pr.unanswered} review comment${pr.unanswered === 1 ? '' : 's'} unanswered`,
          why: `${clip(pr.title, 100)}; the oldest from ${pr.oldest}. Validate each against the code, then answer it: fixed, tracked or not valid.`,
          read: `keel review ${x.repo}#${pr.number}`, link: pr.url, source: 'reviews', actions: [] });
      }
    } catch (e) { failed.push(`${x.repo}: ${clip(e.message, 120)}`); }
  }));
  const skipped = repos.length - list.length;
  return { items, failed, skipped };
}

/** The newest health page's proposal under root, and whether it is decided: { page, path, measure, text, decided } or null. */
export async function healthProposal(root) {
  const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  const rel = healthDirOf(config);
  const pages = (await readdir(join(root, rel)).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e))).filter(n => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort();
  if (!pages.length) return null;
  const path = `${rel}/${pages.at(-1)}`;
  const p = proposalOf(await readFile(join(root, path), 'utf8'));
  return p && { page: pages.at(-1).slice(0, 10), path, ...p, config };
}

const DECIDED = /^\*\*Decided (\d{4}-\d{2}-\d{2}): (accepted|declined)\*\*/m;
/** A health page's ## Proposal section: { measure, text, decided, start, end } (offsets into the page), or null. */
export function proposalOf(text) {
  const head = /^## Proposal[ \t]*\r?\n/m.exec(text);
  if (!head) return null;
  const start = head.index + head[0].length;
  const rest = text.slice(start);
  const next = /^## /m.exec(rest);
  const end = next ? start + next.index : text.length;
  const body = text.slice(start, end).trim();
  const measure = /^\*\*`([a-z0-9_]+)`\*\*/.exec(body)?.[1] ?? null;
  if (!body || /^none\b/i.test(body)) return null;
  const d = DECIDED.exec(body);
  return { measure, text: body, decided: d ? { date: d[1], decision: d[2] } : null, start, end };
}

/** Lessons waiting for a person: one item each, settled by keel learn decide. */
export async function inboxItems(root) {
  const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  if (config.keel !== 'self') return { na: 'the inbox is keel\'s (home only)' };
  const items = [];
  for (const p of (await proposals(root)).filter(x => x.meta.status === 'proposed')) {
    items.push({ waits: 'owner', kind: 'lesson', title: `lesson to decide: ${clip(p.title, 100)}`,
      why: `proposed: ${p.meta.outcome ?? '?'}${p.meta.note ? ` — ${clip(p.meta.note, 160)}` : ''}`, read: p.file, link: blob(config, p.file), source: 'inbox',
      actions: [
        { label: 'Accept', verb: 'learn decide', args: [p.slug, 'accepted'], note: 'optional' },
        { label: 'Decline', verb: 'learn decide', args: [p.slug, 'declined'], note: 'required' },
      ] });
  }
  const inbox = await readFile(join(root, 'docs', 'INBOX.md'), 'utf8').catch(() => '');
  const priv = Number(/^\| proposed \| (\d+) \|$/m.exec(inbox)?.[1] ?? 0);
  if (priv) items.push({ waits: 'owner', kind: 'lesson', title: `${priv} private inbox proposal${priv === 1 ? '' : 's'} to decide`, why: 'in the private inbox; decide each with keel learn decide <issue#>', read: 'keel learn', link: null, source: 'inbox', actions: [] });
  return { items };
}

/** The fleet strip and its broken rows, from keel fleet --json's data. */
export function fleetOf(data) {
  const strip = [], items = [], failed = [];
  for (const r of (data?.rows ?? []).filter(x => x.role === 'managed')) {
    const bad = v => v && typeof v === 'object' && 'unreadable' in v;
    const row = { repo: r.repo };
    if (r.unreadable) { strip.push({ ...row, unreadable: r.unreadable }); failed.push(`${r.repo}: ${clip(r.unreadable, 100)}`); continue; }
    row.practice = r.adopted === true ? (r.practice?.behind === 'current' ? `${r.practice.version} current` : r.practice?.behind ?? '?') : r.adopted === false ? 'not adopted' : 'unreadable';
    row.health = bad(r.health) ? `unreadable: ${r.health.unreadable}` : r.health?.state === 'none' ? 'no health page' : `${r.health?.last ?? '?'}${r.health?.state === 'silent' ? ' (silent)' : ''}`;
    row.ci = bad(r.ci) ? `unreadable: ${r.ci.unreadable}` : r.ci?.state ?? '?';
    strip.push(row);
    if (!bad(r.ci) && r.ci?.state === 'red') {
      items.push({ waits: 'broken', kind: 'ci', title: `${r.repo}: CI red on ${r.branch ?? 'the default branch'}`, why: `${r.ci.workflow ?? 'the gate'} ${r.ci.conclusion ?? 'failed'} at ${r.ci.at ?? '?'}`,
        read: `gh run list -R ${r.repo} --branch ${r.branch ?? 'main'} --limit 5`, link: `https://github.com/${r.repo}/actions`, source: 'fleet', actions: [] });
    }
  }
  return { strip, items, failed, ...(failed.length ? { why: `unreadable: ${failed.join('; ')}` } : {}) };
}

// ---- the board -----------------------------------------------------------------

/**
 * Every open item. deps (each optional; tests inject them, the CLI uses the
 * real ones): roadmap(root), looseEnds(root) → loose-ends data, reviews(repos)
 * → { items, failed, skipped }, fleet(root) → keel fleet data, today.
 */
export async function board({ root }, deps = {}) {
  const env = deps.env ?? process.env;
  const today = deps.today ?? localToday();
  const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  const home = config.keel === 'self';
  const sources = [], items = [];
  const source = async (name, fn) => {
    try {
      const r = await fn();
      if (r?.na) { sources.push({ source: name, state: 'n/a', why: r.na }); return null; }
      sources.push({ source: name, state: r?.failed?.length ? 'partial' : 'ok', count: r?.items?.length ?? 0, ...(r?.why ? { why: r.why } : {}) });
      items.push(...(r?.items ?? []));
      return r;
    } catch (e) {
      sources.push({ source: name, state: 'n/a', why: clip(e?.message ?? e, 200) });
      return null;
    }
  };
  await source('roadmap', () => roadmapItems(root, { today, read: deps.roadmap }));

  let fleetJson = null;
  if (home) fleetJson = await readFile(join(root, 'fleet.json'), 'utf8').then(t => JSON.parse(t)).catch(() => null);
  const reposOf = () => {
    const out = [];
    const add = (repo, reviewers = []) => { if (/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') && !out.some(x => x.repo.toLowerCase() === repo.toLowerCase())) out.push({ repo, reviewers }); };
    const own = reviewConfigOf(config);
    add(config.repo, own.problem ? [] : own.reviewers);
    for (const r of Array.isArray(fleetJson) ? fleetJson : []) if (r?.role === 'managed') add(r.repo);
    return out;
  };

  const [, , , , fl] = await Promise.all([
    source('loose-ends', async () => {
      const data = deps.looseEnds ? await deps.looseEnds(root)
        : (await (await import('./looseends.mjs')).looseEnds({ home: root, env })).data;
      return { items: looseItems(data, { home: root }) };
    }),
    source('reviews', async () => {
      const repos = reposOf();
      if (!repos.length) return { na: '.keel/keel.json names no repo, and there is no fleet' };
      const r = await (deps.reviews ?? (list => reviewItems(list, { env, today })))(repos);
      if (r.failed?.length && r.failed.length === Math.min(repos.length, REVIEW_REPOS)) return { na: `GitHub could not be read: ${r.failed[0]}` };
      return { ...r, why: [r.failed?.length ? `not read: ${r.failed.join('; ')}` : '', r.skipped ? `${r.skipped} repos past the first ${REVIEW_REPOS} not read` : ''].filter(Boolean).join('; ') || undefined };
    }),
    source('health', async () => {
      const p = await healthProposal(root);
      if (!p) return { items: [] };
      if (p.decided) return { items: [], why: `the ${p.page} proposal is ${p.decided.decision} (${p.decided.date})` };
      return { items: [{ waits: 'owner', kind: 'proposal', title: `health proposal (${p.page})${p.measure ? `: ${p.measure}` : ''}`,
        why: clip(p.text.split('\n')[0].replace(/\*\*/g, ''), 240), read: p.path, link: blob(config, p.path), source: 'health',
        actions: [
          { label: 'Accept', verb: 'walk decide', args: ['--proposal', p.path, '--accept'], note: 'optional' },
          { label: 'Decline', verb: 'walk decide', args: ['--proposal', p.path, '--decline'], note: 'required' },
        ] }] };
    }),
    source('inbox', () => inboxItems(root)),
    source('fleet', async () => {
      if (!home) return { na: 'keel fleet runs at home, on keel' };
      if (!fleetJson && !deps.fleet) return { na: 'no readable fleet.json' };
      const data = deps.fleet ? await deps.fleet(root) : (await (await import('./fleet.mjs')).fleet({ dir: root }, { env, cli: deps.cli })).data;
      return fleetOf(data);
    }),
  ]);
  const named = ['roadmap', 'loose-ends', 'reviews', 'health', 'inbox', 'fleet'];
  sources.sort((a, b) => named.indexOf(a.source) - named.indexOf(b.source));
  const order = { walk: 0, step: 1, proposal: 2, lesson: 3 };
  items.sort((a, b) => WAITS.indexOf(a.waits) - WAITS.indexOf(b.waits) || (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  items.forEach((it, i) => { it.actions = (it.actions ?? []).map((a, j) => ({ id: `${i}.${j}`, ...a })); });
  const counts = Object.fromEntries(WAITS.map(w => [w, items.filter(i => i.waits === w).length]));
  return { ok: true, root, name: config.name ?? null, today, counts, items, sources, fleet: fl?.strip ?? null };
}

export function boardText(data) {
  const out = [`${data.name ?? 'keel'} — whose turn it is (${data.today})`, ''];
  for (const c of COLUMNS) {
    const mine = data.items.filter(i => i.waits === c.waits);
    if (!mine.length && c.waits === 'external') continue;
    out.push(`${c.title} (${mine.length})`);
    if (!mine.length) out.push('  nothing');
    for (const it of mine) {
      out.push(`  ${it.title}`, `      ${it.why}`);
      if (it.read) out.push(`      read: ${it.read}`);
      for (const a of it.actions) out.push(`      $ keel ${a.verb} ${a.args.map(q).join(' ')}${a.note === 'required' ? ' --note "…"' : ''}`);
    }
    out.push('');
  }
  if (data.fleet?.length) out.push('Fleet:', ...data.fleet.map(r => `  ${r.repo}  ${r.unreadable ? `unreadable: ${r.unreadable}` : `${r.practice}  health ${r.health}  CI ${r.ci}`}`), '');
  out.push('Sources:', ...data.sources.map(s => `  ${s.source}: ${s.state}${s.count !== undefined ? ` (${s.count})` : ''}${s.why ? ` — ${s.why}` : ''}`));
  return out.join('\n');
}
const q = s => /^[\w./:@#-]+$/.test(s) ? s : JSON.stringify(s);

// ---- writing: walk done, walk decide ----------------------------------------------

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/** Set (or, with value undefined, drop) one front-matter field, keeping the others in place. */
export function setField(raw, key, value) {
  const m = FRONT.exec(raw);
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex(l => l.startsWith(`${key}:`));
  if (value === undefined) { if (i >= 0) lines.splice(i, 1); }
  else if (i >= 0) lines[i] = `${key}: ${value}`;
  else lines.push(`${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n${raw.slice(m[0].length)}`;
}

/** Check the n-th Acceptance box (1-based among all boxes). */
function checkBox(raw, n) {
  const lines = raw.split('\n');
  let inAcceptance = false, seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^## /.test(lines[i])) inAcceptance = /^## Acceptance\s*$/.test(lines[i]);
    else if (inAcceptance && /^- \[[ x]\]/.test(lines[i]) && ++seen === n) {
      lines[i] = lines[i].replace(/^- \[ \]/, '- [x]');
      return lines.join('\n');
    }
  }
  throw new BoardError(`no Acceptance box ${n}`);
}

function setSection(raw, name, text) {
  const m = new RegExp(`^## ${name}[ \\t]*\\r?\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm').exec(raw);
  if (!m) throw new BoardError(`no ## ${name} section`);
  const tail = raw.slice(m.index + m[0].length);
  return `${raw.slice(0, m.index)}## ${name}\n\n${text}\n${tail ? '\n' : ''}${tail}`;
}

const cell = s => oneLine(s).replaceAll('|', '\\|');

/** The owner's read appended to an evidence file: a row under today's "## The owner's read (date)" table. */
export function appendRead(text, { date, walked, note }) {
  const head = `## The owner's read (${date})`;
  const row = `| ${cell(walked)} | ${cell(note)} |`;
  const body = text.replace(/\s*$/, '');
  const last = body.lastIndexOf('\n## ');
  if (last >= 0 && body.slice(last + 1).startsWith(head)) return `${body}\n${row}\n`;
  return `${body}\n\n${head}\n\n| Walked | The owner's note |\n| --- | --- |\n${row}\n`;
}

async function git(root, args) { return exec('git', ['-C', root, ...args], { timeout: 30_000 }); }

/** The working-tree diff of the given paths (repo-relative), new files shown whole. */
async function diffOf(root, paths, created = []) {
  const tracked = paths.filter(p => !created.includes(p));
  const d = tracked.length ? await git(root, ['diff', '--no-color', '--', ...tracked]) : { ok: true, stdout: '' };
  const parts = [d.ok ? d.stdout.trimEnd() : `(git diff could not run: ${d.why})`];
  for (const p of created) parts.push(`new file ${p}:\n${(await readFile(join(root, p), 'utf8')).split('\n').map(l => `+${l}`).join('\n')}`);
  return parts.filter(Boolean).join('\n');
}

/** Write files, regenerate the roadmap; put every file back if the roadmap rejects the result (as keel goal does). */
async function writeAll(root, writes, { today }) {
  const before = [];
  for (const [path, content] of writes) {
    before.push([path, await readFile(join(root, path), 'utf8').catch(() => null)]);
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  try { await roadmap({ root, mode: 'write', today }); } catch (e) {
    for (const [path, content] of before) await (content === null ? unlink(join(root, path)) : writeFile(join(root, path), content));
    throw new BoardError(`nothing written; the roadmap rejects the result: ${e.message}`, 1);
  }
}

/**
 * keel walk done <phase> --note "<text>" [--box <n>]: check the phase's open ⚑
 * box (the only one, or box n), append the owner's read to its first evidence
 * file (a new one when it has none), and when no box is left open set it
 * built, drop owes and waits, since today, Next action None. A box that is not
 * a walk is refused, writing nothing.
 */
export async function walkDone({ root, phase, note, box, today = localToday() }) {
  if (!/^\d+$/.test(String(phase ?? ''))) throw new BoardError('keel walk done <phase> --note "<what you saw>" [--box <n>]');
  if (!oneLine(note)) throw new BoardError('--note "<what you saw>" is required: the owner\'s read is the evidence');
  if (box !== undefined && !/^[1-9]\d*$/.test(String(box))) throw new BoardError('--box needs a box number (1 is the first Acceptance box)');
  const id = Number(phase);
  const names = (await readdir(join(root, 'docs', 'phases'))).filter(n => /^\d+-.*\.md$/.test(n) && Number(n.split('-')[0]) === id);
  if (names.length !== 1) throw new BoardError(names.length ? `phase ${id} is in ${names.length} files` : `no phase ${id} in docs/phases`);
  const file = names[0], path = `docs/phases/${file}`;
  const raw = await readFile(join(root, path), 'utf8');
  const p = parsePhase(file, raw);
  if (DONE.includes(p.status) || p.status === 'superseded') throw new BoardError(`phase ${id} is ${p.status}: no walk is open`);
  const open = openBoxes(raw);
  const walks = open.filter(b => b.walk);
  let chosen;
  if (box !== undefined) {
    chosen = open.find(b => b.n === Number(box));
    if (!chosen) throw new BoardError(`box ${box} of phase ${id} is not an open Acceptance box; open: ${open.map(b => `${b.n}${b.walk ? ' (walk)' : ''}`).join(', ') || 'none'}`);
    if (!chosen.walk) throw new BoardError(`box ${box} of phase ${id} is not a walk ("${clip(chosen.text, 80)}"): it names a test or a command, so it is built, not walked. Nothing written`);
  } else {
    if (!walks.length) throw new BoardError(`phase ${id} has no open walk box (⚑ by hand, or a \`gh …\` check). Nothing written`);
    if (walks.length > 1) throw new BoardError(`phase ${id} has ${walks.length} open walk boxes: name one with --box ${walks.map(b => b.n).join('|')} (${walks.map(b => `${b.n}: ${clip(b.text, 50)}`).join('; ')})`);
    chosen = walks[0];
  }
  let text = checkBox(raw, chosen.n);
  const left = open.filter(b => b.n !== chosen.n);
  const writes = [], created = [];
  let evidence = p.evidence[0];
  if (!evidence) {
    evidence = `evidence/${today}-phase-${id}-walk.md`;
    created.push(`docs/${evidence}`);
    text = setField(text, 'evidence', JSON.stringify([evidence]).replaceAll('","', '", "'));
  }
  const evPath = `docs/${evidence}`;
  const evText = created.length
    ? `# Evidence: phase ${id} — ${p.title}\n\n- Date: ${today}\n- Phase: ${id}\n- Claim being checked: the walk the phase owed, read by the owner.\n`
    : await readFile(join(root, evPath), 'utf8');
  writes.push([evPath, appendRead(evText, { date: today, walked: chosen.text, note })]);
  let moved = null;
  if (!left.length) {
    text = setField(setField(setField(setField(text, 'status', 'built'), 'owes', undefined), 'waits', undefined), 'since', today);
    text = setSection(text, 'Next action', 'None.');
    moved = 'built';
  }
  writes.unshift([path, text]);
  await writeAll(root, writes, { today });
  const files = [path, evPath, 'docs/ROADMAP.md'];
  const diff = await diffOf(root, files, created);
  const what = `phase ${id}: box ${chosen.n} checked ("${clip(chosen.text, 80)}"); the owner's read appended to ${evPath}${moved ? `; status built (owes dropped, since ${today}, Next action None.)` : `; ${left.length} box${left.length === 1 ? '' : 'es'} still open (${left.some(b => !b.walk) ? 'buildable work left' : 'walks'}), status stays ${p.status}`}`;
  return {
    data: { ok: true, phase: id, file: path, box: chosen.n, walked: chosen.text, evidence: evPath, created, status: moved ?? p.status, left: left.map(b => ({ n: b.n, walk: b.walk, text: b.text })), files, diff, note: DIFF_NOTE },
    text: `${what}.\n${DIFF_NOTE[0].toUpperCase()}${DIFF_NOTE.slice(1)}.\n\n${diff}`,
  };
}

/**
 * keel walk decide --proposal <health page> --accept ["<why>"] | --decline "<why>":
 * the decision is a record line at the end of the page's ## Proposal section,
 * "**Decided <date>: accepted|declined** — why". The board and loose-ends stop
 * listing a decided proposal; an accepted one becomes a phase by keel phase new.
 */
export async function walkDecide({ root, proposal, accept, decline, today = localToday() }) {
  if (!proposal) throw new BoardError('keel walk decide --proposal <health page> --accept ["<why>"] | --decline "<why>"');
  if ((accept !== undefined) === (decline !== undefined)) throw new BoardError('one of --accept ["<why>"] or --decline "<why>"');
  if (decline !== undefined && !oneLine(decline)) throw new BoardError('--decline needs "<why>": the night reads it');
  const abs = isAbsolute(proposal) ? proposal : resolve(root, proposal);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new BoardError(`${proposal} is outside the project`);
  const text = await readFile(abs, 'utf8').catch(() => { throw new BoardError(`cannot read ${rel}`); });
  const p = proposalOf(text);
  if (!p) throw new BoardError(`${rel} has no proposal (no ## Proposal section, or it is empty)`);
  if (p.decided) throw new BoardError(`${rel}'s proposal is already ${p.decided.decision} (${p.decided.date})`);
  const decision = accept !== undefined ? 'accepted' : 'declined';
  const why = oneLine(accept ?? decline);
  const record = `**Decided ${today}: ${decision}**${why ? ` — ${why}` : ''}${decision === 'accepted' ? ` Next: make it a phase (keel phase new "<title>" --goal <id>)${p.measure ? `, naming \`${p.measure}\`` : ''}.` : ''}`;
  const before = text.slice(0, p.end).replace(/\s*$/, '');
  const after = text.slice(p.end);
  await writeFile(abs, `${before}\n\n${record}\n${after ? `\n${after}` : ''}`);
  const diff = await diffOf(root, [rel]);
  return {
    data: { ok: true, proposal: rel, measure: p.measure, decision, why, record, diff, note: DIFF_NOTE },
    text: `${rel}: the proposal${p.measure ? ` (${p.measure})` : ''} is ${decision}.\n${DIFF_NOTE[0].toUpperCase()}${DIFF_NOTE.slice(1)}.\n\n${diff}`,
  };
}

// ---- the page ------------------------------------------------------------------------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeLink = u => /^https:\/\//.test(u ?? '') ? u : null;

/** The page: every column rendered from the board's data on the server; script only posts actions. */
export function pageHtml(data, token) {
  const item = it => `<li class="item" data-kind="${esc(it.kind)}">
  <div class="t">${safeLink(it.link) ? `<a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>` : esc(it.title)}</div>
  <div class="why">${esc(it.why)}</div>
  ${it.read ? `<div class="read"><code>${esc(it.read)}</code></div>` : ''}
  ${it.actions?.length ? `<div class="acts">${it.actions.map(a => `<button data-action="${esc(a.id)}" data-note="${esc(a.note ?? '')}" title="keel ${esc(a.verb)} ${esc(a.args.join(' '))}">${esc(a.label)}</button>`).join('')}</div><pre class="out" hidden></pre>` : ''}
</li>`;
  const columns = COLUMNS.filter(c => c.waits !== 'external' || data.items.some(i => i.waits === 'external')).map(c => {
    const mine = data.items.filter(i => i.waits === c.waits);
    return `<section class="col" data-waits="${c.waits}"><h2>${esc(c.title)} <span class="n">${mine.length}</span></h2><ul>${mine.length ? mine.map(item).join('') : '<li class="none">Nothing here.</li>'}</ul></section>`;
  }).join('\n');
  const strip = data.fleet?.length ? `<section class="fleet"><h2>Fleet</h2><table><thead><tr><th>repo</th><th>practice</th><th>health</th><th>CI</th></tr></thead><tbody>${data.fleet.map(r => r.unreadable
    ? `<tr><td>${esc(r.repo)}</td><td colspan="3">unreadable: ${esc(r.unreadable)}</td></tr>`
    : `<tr><td>${esc(r.repo)}</td><td>${esc(r.practice)}</td><td>${esc(r.health)}</td><td class="ci-${esc(r.ci)}">${esc(r.ci)}</td></tr>`).join('')}</tbody></table></section>` : '';
  const sources = `<footer><h2>Sources</h2><ul>${data.sources.map(s => `<li class="src-${esc(s.state.replace('/', ''))}"><b>${esc(s.source)}</b>: ${esc(s.state)}${s.count !== undefined ? ` (${s.count})` : ''}${s.why ? ` — ${esc(s.why)}` : ''}</li>`).join('')}</ul></footer>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Whose turn</title>
<style>
:root { --bg: #fafaf8; --fg: #1d1d1b; --muted: #6a6a64; --card: #ffffff; --line: #e2e2dc; --accent: #2457c5; --bad: #b3261e; --ok: #1e7a3a; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecece6; --muted: #a0a098; --card: #21211f; --line: #34342f; --accent: #8ab0ff; --bad: #ff8a80; --ok: #7bd88f; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, -apple-system, sans-serif; }
header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; margin-bottom: 12px; }
h1 { font-size: 20px; margin: 0; } h2 { font-size: 15px; margin: 0 0 8px; }
.muted, .why, .read { color: var(--muted); }
.cols { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.col { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-width: 0; }
.col[data-waits="broken"] h2 { color: var(--bad); }
.n { color: var(--muted); font-weight: normal; }
ul { list-style: none; margin: 0; padding: 0; }
.item { border-top: 1px solid var(--line); padding: 8px 0; overflow-wrap: anywhere; }
.item:first-child { border-top: 0; }
.t { font-weight: 600; } a { color: var(--accent); }
code { font-size: 13px; }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
button { font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); cursor: pointer; }
button:hover { border-color: var(--accent); }
pre.out { white-space: pre-wrap; font-size: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px; max-height: 320px; overflow: auto; }
.fleet, footer { margin-top: 16px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; } th, td { text-align: left; padding: 4px 8px; border-top: 1px solid var(--line); }
.ci-red { color: var(--bad); font-weight: 600; } .ci-green { color: var(--ok); }
footer li { font-size: 13px; color: var(--muted); } .src-na b, .src-partial b { color: var(--bad); }
</style></head><body>
<header><h1>${esc(data.name ?? 'keel')}: whose turn it is</h1><span class="muted">${esc(data.today)} · read fresh on every load</span><button id="reload">Reload</button></header>
<main class="cols">
${columns}
</main>
${strip}
${sources}
<script>
const token = ${JSON.stringify(token).replace(/</g, '\\u003c')};
document.getElementById('reload').onclick = () => location.reload();
for (const b of document.querySelectorAll('button[data-action]')) b.onclick = async () => {
  const need = b.dataset.note;
  let note;
  if (need) {
    note = prompt(need === 'required' ? 'Your note (required): what you saw, or why' : 'A note (optional)');
    if (note === null || (need === 'required' && !note.trim())) return;
  }
  const out = b.closest('.item').querySelector('pre.out');
  out.hidden = false; out.textContent = 'Running…';
  for (const x of b.parentNode.querySelectorAll('button')) x.disabled = true;
  try {
    const r = await fetch('/action', { method: 'POST', headers: { 'content-type': 'application/json', 'x-keel-token': token }, body: JSON.stringify({ id: b.dataset.action, note }) });
    const j = await r.json();
    out.textContent = (j.error ? 'Refused: ' + j.error : (j.out || '') + (j.err ? '\\n' + j.err : '') + '\\n\\nexit ' + j.code + (j.code === 0 ? ' — ${DIFF_NOTE}. Reload to see the board now.' : ''));
  } catch (e) { out.textContent = 'Failed: ' + e.message; }
};
</script>
</body></html>`;
}

// ---- the server ------------------------------------------------------------------------

const same = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && timingSafeEqual(x, y); };

/**
 * The board's server, on 127.0.0.1 only. Every request carries the launch's
 * token (the page's URL, then x-keel-token on each action), and a Host that is
 * this server's own (no DNS rebinding); an action runs only one the latest
 * board offered (by id), through `run(argv)` — the CLI's own main by default.
 */
export async function serve({ root, port = 0, token = randomBytes(24).toString('hex') }, deps = {}) {
  const build = deps.board ?? (() => board({ root }, deps));
  const runVerb = deps.run ?? (async argv => {
    const { main } = await import('./cli.mjs');
    let out = '', err = '';
    const code = await main(argv, { cwd: root, out: s => { out += s; }, err: s => { err += s; } });
    return { code, out, err };
  });
  let actions = new Map();
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const server = createServer(async (req, res) => {
    try {
      const { port: at } = server.address();
      const url = new URL(req.url, `http://127.0.0.1:${at}`);
      if (![`127.0.0.1:${at}`, `localhost:${at}`].includes(req.headers.host)) return send(res, 403, { error: 'wrong host' });
      if (req.headers.origin && ![`http://127.0.0.1:${at}`, `http://localhost:${at}`].includes(req.headers.origin)) return send(res, 403, { error: 'wrong origin' });
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/board.json')) {
        if (!same(url.searchParams.get('token'), token)) return send(res, 403, { error: 'no token: open the URL keel board printed' });
        const data = await build();
        actions = new Map(data.items.flatMap(it => it.actions.map(a => [a.id, a])));
        return url.pathname === '/' ? send(res, 200, pageHtml(data, token), 'text/html') : send(res, 200, data);
      }
      if (req.method === 'POST' && url.pathname === '/action') {
        if (!same(req.headers['x-keel-token'], token)) return send(res, 403, { error: 'no token' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 64 * 1024) return send(res, 413, { error: 'too large' }); }
        let ask;
        try { ask = JSON.parse(body); } catch { return send(res, 400, { error: 'not JSON' }); }
        const a = actions.get(ask?.id);
        if (!a || !ACTION_VERBS.includes(a.verb)) return send(res, 404, { error: 'no such action on the board: reload it' });
        const note = typeof ask.note === 'string' ? oneLine(ask.note) : '';
        if (a.note === 'required' && !note) return send(res, 400, { error: 'this action needs a note' });
        const args = [...a.args];
        if (note) {
          if (a.verb === 'walk decide') args.push(note); // the why after --accept/--decline
          else if (a.verb === 'walk done') { const i = args.indexOf('--note'); if (i >= 0) args[i + 1] = note; else args.push('--note', note); }
          else args.push('--note', note);
        } else if (a.verb === 'walk decide' && args.at(-1) === '--decline') return send(res, 400, { error: 'declining needs a why' });
        const r = await runVerb([...a.verb.split(' '), ...args]);
        return send(res, 200, { ...r, argv: ['keel', ...a.verb.split(' '), ...args], note: DIFF_NOTE });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: clip(e?.message ?? e, 300) });
    }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  const { address, port: bound } = server.address();
  const url = `http://127.0.0.1:${bound}/?token=${token}`;
  return { server, address, port: bound, token, url, close: () => new Promise(done => server.close(done)) };
}

/** Open a URL in the owner's browser; a failure is said, never thrown. */
export function openBrowser(url, platform = process.platform) {
  const [cmd, args] = platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); return true; } catch { return false; }
}

/** keel board (no --json): serve the page until stopped. */
export async function boardServe({ root, open = false, port }, deps = {}) {
  const s = await serve({ root, port }, deps);
  if (open) openBrowser(s.url);
  return { data: { ok: true, url: s.url, address: s.address, port: s.port },
    text: `keel board: ${s.url}\nServing on 127.0.0.1 only; the token in the URL is this launch's. Ctrl-C stops it.${open ? '' : ' (--open opens it.)'}` };
}


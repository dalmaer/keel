// keel board: whose turn it is, and what is mine (keel phase 51;
// docs/research/2026-10-08-whose-turn-board.md).
//
//   keel board --json        every open item, each { waits, title, why, read,
//                            link, source, actions }, and each source's state;
//                            phases (every phase's drill-down, by number) and
//                            roadmap (built/total per goal, the headline)
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

/** The last n Trajectory entries of a phase body, each one line, oldest first. */
export function trajectoryTail(trajectory = '', n = 4) {
  const out = [];
  for (const line of String(trajectory).split(/\r?\n/)) {
    if (/^- /.test(line)) out.push(line.slice(2).trim());
    else if (out.length && /^\s+\S/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out.slice(-n);
}

/**
 * One phase as the board's drill-down reads it: { id, title, file, link, goal,
 * status, since, owes, waits, after, done, next, boxes: [{ n, text, checked,
 * walk }], trajectory (the last few entries), evidence: [{ path, link }] }.
 * raw is the phase file; without it (unreadable) boxes and trajectory are empty.
 */
export function phaseDetail(p, raw, config) {
  const path = `docs/phases/${p.file}`;
  const block = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(raw ?? '');
  const sections = sectionsOf(block?.[1] ?? '');
  return {
    id: p.id, title: p.title, file: path, link: blob(config, path), goal: p.goal, status: p.status, since: p.since ?? null,
    owes: p.owes ?? null, waits: p.owes === 'walk' ? waitsOf(p) : null, after: p.after ?? null,
    done: p.done ?? null, next: p.next ?? null,
    boxes: boxes(sections.Acceptance ?? '').map((b, i) => ({ n: i + 1, text: b.text, checked: b.checked, walk: isWalk(b.text) })),
    trajectory: trajectoryTail(sections.Trajectory),
    evidence: (p.evidence ?? []).map(e => ({ path: `docs/${e}`, link: blob(config, `docs/${e}`) })),
  };
}

/** Per live goal, built of total and walks owed; and the headline the roadmap prints. */
export function progressOf({ phases, goals }) {
  const live = goals.filter(g => !g.retired);
  const liveIds = new Set(live.map(g => g.id));
  const built = phases.filter(p => DONE.includes(p.status)).length;
  const owed = phases.filter(p => owesWalk(p) && liveIds.has(p.goal)).length;
  return {
    built, total: phases.length, owed,
    headline: `${built} of ${phases.length} built${owed ? `; ${owed} owe${owed === 1 ? 's' : ''} a walk` : ''}`,
    goals: live.map(g => {
      const group = phases.filter(p => p.goal === g.id);
      return { id: g.id, title: g.title, built: group.filter(p => DONE.includes(p.status)).length, total: group.length, owed: group.filter(owesWalk).length };
    }),
  };
}

/** The roadmap's items: walks owed, buildable phases, dated ones; and every phase's detail, and progress per goal. */
export async function roadmapItems(root, { today = localToday(), read = collect } = {}) {
  const data = await read(root);
  const retired = new Set(data.goals.filter(g => g.retired).map(g => g.id));
  const byId = new Map(data.phases.map(p => [p.id, p]));
  const raws = new Map(await Promise.all(data.phases.map(async p => [p.id, await readFile(join(root, 'docs', 'phases', p.file), 'utf8').catch(() => null)])));
  const phases = Object.fromEntries(data.phases.map(p => [p.id, phaseDetail(p, raws.get(p.id), data.config)]));
  const items = [];
  for (const p of data.phases) {
    if (retired.has(p.goal) || DONE.includes(p.status) || p.status === 'superseded') continue;
    const path = `docs/phases/${p.file}`;
    const base = { title: `phase ${p.id}: ${p.title}`, read: path, link: blob(data.config, path), source: 'roadmap', phase: p.id };
    if (owesWalk(p)) {
      const raw = raws.get(p.id) ?? await readFile(join(root, path), 'utf8');
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
      items.push({ ...base, waits: 'time', kind: 'dated', why: `not buildable before ${p.after}`, after: p.after, next: p.next, actions: [] });
      continue;
    }
    if (p.depends.every(id => satisfies(byId.get(id)))) {
      // A buildable phase whose next action is the owner's (⚑, or "Owner …") is the owner's turn, as loose-ends reads it.
      const owners = OWNER_STEP.test(p.next ?? '');
      items.push({ ...base, waits: owners ? 'owner' : 'agent', kind: owners ? 'step' : 'phase', why: `${p.status}: ${clip(p.next, 200)}`, next: p.next, actions: [] });
    }
  }
  return { items, config: data.config, phases, progress: progressOf(data) };
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
  const rm = await source('roadmap', () => roadmapItems(root, { today, read: deps.roadmap }));

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
  return { ok: true, root, name: config.name ?? null, repo: /^[\w.-]+\/[\w.-]+$/.test(config.repo ?? '') ? config.repo : null, today, counts, items, sources, fleet: fl?.strip ?? null,
    phases: rm?.phases ?? {}, roadmap: rm?.progress ?? null };
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

/**
 * The board's view: one renderer, self-contained (it reads nothing outside
 * itself), so the server draws the first page with it and the page's script
 * (which embeds its source) redraws from /board.json on refresh. Returns
 * { page(data) → the board's HTML, drill(phase) → a phase's drill-down HTML }.
 * Everything from the data is escaped; only https links are links.
 */
export function boardView() {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safe = u => /^https:\/\//.test(u ?? '') ? u : null;
  // Escaped text with `code` and **bold** kept: the phase files' own markdown, read plainly.
  const fmt = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const ext = (href, label, cls = '') => safe(href) ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : '';
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const bare = t => String(t ?? '').replace(/^phase \d+: /, '');
  const textOf = it => esc([it.title, it.why, it.read, it.next, it.kind, it.source].filter(Boolean).join(' ').toLowerCase());
  const KINDS = [
    ['walk', 'Walks to do', ['walk']],
    ['decide', 'Decisions', ['proposal', 'lesson', 'health', 'inbox']],
    ['setup', 'Set up', null],
    ['question', 'Questions', ['session']],
    ['repo', 'Repos to tidy', ['repo']],
  ];
  const groupOf = kind => (KINDS.find(k => k[2]?.includes(kind)) ?? KINDS[2])[0];
  const drillBtn = (n, label) => `<button type="button" class="title-btn" data-drill="${esc(n)}" aria-haspopup="dialog">${label}</button>`;
  const titleOf = it => it.phase !== undefined && it.phase !== null ? drillBtn(it.phase, esc(it.title)) : esc(it.title);
  const readOf = it => safe(it.link) ? ext(it.link, it.kind === 'review' ? 'Open the PR' : it.kind === 'ci' ? 'Open the runs' : 'Read', 'read')
    : it.read ? `<code class="cmd">${esc(it.read)}</code>` : '';
  const cardAttrs = it => `data-card tabindex="0" data-key="${esc(it.title)}" data-text="${textOf(it)}"${it.phase !== undefined && it.phase !== null ? ` data-phase="${esc(it.phase)}"` : ''}`;

  const actionsOf = it => {
    if (!it.actions?.length) return '';
    return `<div class="acts">${it.actions.map((a, i) => {
      const cmd = `keel ${a.verb} ${a.args.join(' ')}`;
      const cls = i === 0 ? 'btn primary' : 'btn';
      const expect = esc([a.verb, ...a.args].join(' '));
      if (a.note === 'required') return `<button type="button" class="${cls}" data-note-for="${esc(a.id)}" data-required="1" data-label="${esc(a.label)}" data-expect="${expect}" title="${esc(cmd)} --note …" aria-expanded="false">${esc(a.label)}…</button>`;
      const run = `<button type="button" class="${cls}" data-action="${esc(a.id)}" data-expect="${expect}" title="${esc(cmd)}">${esc(a.label)}</button>`;
      return a.note === 'optional' ? `${run}<button type="button" class="btn-link" data-note-for="${esc(a.id)}" data-label="${esc(a.label)}" data-expect="${expect}" aria-expanded="false">with a note</button>` : run;
    }).join('')}</div>
    <div class="note-form" hidden><label>Note <span class="need"></span><textarea rows="3"></textarea></label><div class="acts"><button type="button" class="btn primary" data-submit>Submit</button><button type="button" class="btn-link" data-cancel>Cancel</button></div></div>`;
  };

  const card = (it, extra = '') => `<article class="card${extra}" ${cardAttrs(it)}>
  <h4 class="card-title">${titleOf(it)}</h4>
  ${it.why ? `<p class="why">${fmt(it.why)}</p>` : ''}
  <div class="foot">${readOf(it)}<span class="src">${esc(it.source)}</span></div>
  ${actionsOf(it)}
  <div class="result" role="status" aria-live="polite"></div>
</article>`;

  const section = (waits, title, n, body, cls = '') => `<section class="col${cls}" data-waits="${waits}" aria-labelledby="h-${waits}"><h2 id="h-${waits}">${esc(title)} <span class="n">${n}</span></h2>${body}</section>`;
  const none = t => `<p class="none">${t}</p>`;

  function yours(items) {
    if (!items.length) return none('Nothing is yours right now.');
    return KINDS.map(([key, label]) => {
      const mine = items.filter(it => groupOf(it.kind) === key);
      return mine.length ? `<div class="group" data-group="${key}"><h3>${label} <span class="n">${mine.length}</span></h3><div class="cards">${mine.map(it => card(it)).join('')}</div></div>` : '';
    }).join('');
  }

  function agents(items) {
    if (!items.length) return none('Nothing for the agent.');
    const phases = items.filter(it => it.phase !== undefined && it.phase !== null);
    const rest = items.filter(it => it.phase === undefined || it.phase === null);
    const row = (it, i) => `<li class="row${i === 0 ? ' is-next' : ''}" ${cardAttrs(it)}>
  <span class="num">${esc(it.phase)}</span>
  <div class="row-body"><div class="row-title">${drillBtn(it.phase, esc(bare(it.title)))}${i === 0 ? ' <span class="pill accent">next</span>' : ''}</div><p class="why">${fmt(it.next ?? it.why)}</p></div>
</li>`;
    const loose = it => `<li class="row" ${cardAttrs(it)}><div class="row-body"><div class="row-title">${esc(it.title)}</div><p class="why">${fmt(it.why)}</p><div class="foot">${readOf(it)}</div></div></li>`;
    return `${phases.length ? `<ol class="queue">${phases.map(row).join('')}</ol>` : ''}${rest.length ? `<h3>Loose ends <span class="n">${rest.length}</span></h3><ul class="queue">${rest.map(loose).join('')}</ul>` : ''}`;
  }

  function waiting(items) {
    if (!items.length) return none('Nothing waiting.');
    const dated = items.filter(it => it.after).sort((a, b) => a.after.localeCompare(b.after));
    const other = items.filter(it => !it.after);
    const row = (it, tag) => `<li class="row muted-row" ${cardAttrs(it)}><span class="when">${tag}</span><div class="row-body"><div class="row-title">${titleOf(it)}</div><p class="why">${fmt(it.why)}</p></div></li>`;
    return `${dated.length ? `<h3>On a date</h3><ul class="queue">${dated.map(it => row(it, `<time datetime="${esc(it.after)}">${esc(it.after)}</time>`)).join('')}</ul>` : ''}${other.length ? `<h3>On something else</h3><ul class="queue">${other.map(it => row(it, `<span class="pill">${it.waits === 'external' ? 'outside' : 'time'}</span>`)).join('')}</ul>` : ''}`;
  }

  const bar = (n, total) => `<svg class="bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="track" width="100" height="6" rx="3"/><rect class="fill" width="${total ? Math.round(100 * n / total) : 0}" height="6" rx="3"/></svg>`;

  function roadmap(r) {
    if (!r) return '';
    return `<section class="panel roadmap" aria-labelledby="h-roadmap"><h2 id="h-roadmap">Roadmap</h2><p class="headline">${esc(r.headline)}</p><ul class="goals">${r.goals.map(g => `<li><div class="goal-line"><span class="goal-id">${esc(g.id)}</span><span class="goal-title">${esc(g.title)}</span><span class="tnum">${g.built}/${g.total}</span></div>${bar(g.built, g.total)}${g.owed ? `<span class="owed">${plural(g.owed, 'owes a walk', 'owe a walk')}</span>` : ''}</li>`).join('')}</ul></section>`;
  }

  function fleet(rows) {
    if (!rows?.length) return '';
    return `<section class="panel fleet" aria-labelledby="h-fleet"><h2 id="h-fleet">Fleet</h2><ul class="fleet-grid">${rows.map(r => r.unreadable
      ? `<li class="fleet-card"><a href="https://github.com/${esc(r.repo)}" target="_blank" rel="noopener noreferrer">${esc(r.repo)}</a><span class="muted">unreadable: ${esc(r.unreadable)}</span></li>`
      : `<li class="fleet-card"><a href="https://github.com/${esc(r.repo)}" target="_blank" rel="noopener noreferrer">${esc(r.repo)}</a>
  <span class="pill ${/ current$/.test(r.practice ?? '') ? 'ok' : 'warn'}">${esc(r.practice)}</span>
  <span class="ci"><span class="dot ci-${esc(r.ci)}" aria-hidden="true"></span>CI ${esc(r.ci)}</span>
  <span class="muted">health ${esc(r.health)}</span></li>`).join('')}</ul></section>`;
  }

  const sources = list => `<footer class="sources" aria-label="Sources"><h2 class="sr">Sources</h2><ul>${list.map(s => `<li class="src-${esc(s.state.replace('/', ''))}"><span class="dot" aria-hidden="true"></span><b>${esc(s.source)}</b>: ${esc(s.state)}${s.count !== undefined ? ` (${s.count})` : ''}${s.why ? ` — ${esc(s.why)}` : ''}</li>`).join('')}</ul></footer>`;

  function page(data) {
    const by = w => data.items.filter(i => i.waits === w);
    const c = data.counts ?? {};
    const n = w => c[w] ?? by(w).length;
    const tile = (filter, label, count, sub = '') => `<button type="button" class="tile tile-${filter}" data-filter="${filter}" aria-pressed="false"><span class="tile-n">${count}</span><span class="tile-l">${esc(label)}</span>${sub ? `<span class="tile-s">${sub}</span>` : ''}</button>`;
    const waitingItems = [...by('time'), ...by('external')];
    return `<nav class="tiles" aria-label="Filter by whose turn">
${tile('owner', 'Yours', n('owner'))}${tile('broken', 'Broken', n('broken'))}${tile('agent', "The agent's", n('agent'))}${tile('waiting', 'Waiting', n('time') + n('external'), `${n('time')} on time · ${n('external')} outside`)}
</nav>
<div class="layout">
  <div class="primary">
    ${section('owner', 'Yours', by('owner').length, yours(by('owner')))}
    ${section('broken', 'Broken', by('broken').length, by('broken').length ? `<div class="cards">${by('broken').map(it => card(it, ' bad')).join('')}</div>` : none('Nothing broken.'), by('broken').length ? ' has-bad' : '')}
  </div>
  <div class="secondary">
    ${section('agent', "The agent's", by('agent').length, agents(by('agent')))}
    ${section('waiting', 'Waiting', waitingItems.length, waiting(waitingItems))}
    ${roadmap(data.roadmap)}
  </div>
</div>
${fleet(data.fleet)}
${sources(data.sources ?? [])}`;
  }

  function drill(p) {
    if (!p) return '<p>No detail for this phase.</p>';
    const facts = [
      ['Status', `<span class="pill status-${esc(p.status)}">${esc(p.status)}</span>${p.owes ? ` <span class="pill accent">owes a ${esc(p.owes)}${p.waits && p.waits !== 'owner' ? ` (${esc(p.waits)})` : ''}</span>` : ''}`],
      ['Goal', esc(p.goal)], ['Since', esc(p.since)], ...(p.after ? [['Not before', esc(p.after)]] : []),
    ];
    return `<header class="drill-head"><p class="eyebrow">Phase ${esc(p.id)}</p><h2 id="drill-title">${esc(p.title)}</h2>
<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></header>
<h3>Done when</h3><p>${fmt(p.done)}</p>
<h3>Acceptance <span class="n">${p.boxes.filter(b => b.checked).length}/${p.boxes.length}</span></h3>
<ul class="boxes">${p.boxes.map(b => `<li class="${b.checked ? 'checked' : 'open'}${b.walk ? ' walk' : ''}"><span class="box" role="img" aria-label="${b.checked ? 'checked' : 'open'}"></span><span>${b.walk ? '<span class="pill accent">walk</span> ' : ''}${fmt(b.text)}</span></li>`).join('')}</ul>
<h3>Next action</h3><p>${fmt(p.next)}</p>
${p.trajectory?.length ? `<h3>Trajectory, latest</h3><ul class="traj">${p.trajectory.map(t => `<li>${fmt(t)}</li>`).join('')}</ul>` : ''}
<p class="drill-links">${ext(p.link, 'The phase file')}${(p.evidence ?? []).map(e => ext(e.link, `Evidence: ${esc(e.path.replace(/^docs\/evidence\//, ''))}`)).join('')}</p>`;
  }

  return { page, drill };
}

const CSS = `
:root { color-scheme: light dark; --bg: #f7f7f5; --fg: #1b1b19; --muted: #6b6b65; --faint: #8f8f88; --card: #ffffff; --line: #e4e4de; --soft: #f0f0ec;
  --accent: #2357c6; --accent-soft: #e8eefb; --on-accent: #ffffff; --bad: #b3261e; --bad-soft: #fcebea; --ok: #1e7a3a; --warn: #9a6400; --focus: #2357c6; }
@media (prefers-color-scheme: dark) { :root { --bg: #141413; --fg: #ecece6; --muted: #a3a39b; --faint: #7d7d76; --card: #1e1e1c; --line: #33332f; --soft: #262624;
  --accent: #8cb1ff; --accent-soft: #1f2a44; --on-accent: #0f1a33; --bad: #ff8a80; --bad-soft: #3a1d1b; --ok: #7bd88f; --warn: #f0b85a; --focus: #8cb1ff; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.wrap { max-width: 1400px; margin: 0 auto; padding: 0 16px 32px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.skip { position: absolute; left: -999px; } .skip:focus { left: 16px; top: 8px; z-index: 10; background: var(--card); padding: 6px 10px; border-radius: 6px; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--soft); padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
.tnum, .n, .tile-n, .num, time { font-variant-numeric: tabular-nums; }
.top { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); }
.top .wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding-top: 10px; padding-bottom: 10px; }
.brand { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-right: auto; }
h1 { font-size: 17px; margin: 0; letter-spacing: -0.01em; }
.meta { color: var(--muted); font-size: 13px; }
.tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
input[type=search] { font: inherit; width: min(280px, 60vw); padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); }
.btn, .tools button { font: inherit; font-size: 13px; padding: 5px 12px; border-radius: 7px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
.btn:hover, .tools button:hover { border-color: var(--accent); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
.btn:disabled, .tools button:disabled { opacity: .55; cursor: default; }
.btn-link, .title-btn { font: inherit; background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; text-align: left; }
.btn-link { font-size: 13px; padding: 5px 4px; }
.title-btn { color: inherit; font-weight: 600; } .title-btn:hover { color: var(--accent); text-decoration: underline; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 16px 0 20px; }
.tile { font: inherit; text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
.tile:hover { border-color: var(--faint); }
.tile[aria-pressed=true] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.tile-n { font-size: 26px; font-weight: 650; line-height: 1.1; }
.tile-l { font-weight: 600; } .tile-s { color: var(--muted); font-size: 12px; }
.tile-owner .tile-n { color: var(--accent); } .tile-broken .tile-n { color: var(--bad); } .tile-waiting .tile-n { color: var(--muted); }
.layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 28px; align-items: start; }
.primary, .secondary { display: flex; flex-direction: column; gap: 28px; min-width: 0; }
h2 { font-size: 15px; margin: 0 0 10px; display: flex; align-items: baseline; gap: 8px; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 16px 0 8px; font-weight: 600; }
.group:first-of-type h3 { margin-top: 4px; }
.n { color: var(--muted); font-weight: 500; font-size: 12px; background: var(--soft); border-radius: 999px; padding: 0 7px; }
.col[data-waits=owner] > h2 { font-size: 18px; }
.col.has-bad > h2 { color: var(--bad); }
.cards { display: flex; flex-direction: column; gap: 8px; }
.card { background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px; padding: 10px 14px; overflow-wrap: anywhere; }
.card.bad { border-left-color: var(--bad); background: linear-gradient(var(--bad-soft), var(--bad-soft)) left / 3px 100% no-repeat, var(--card); }
.card.bad .card-title { color: var(--bad); }
.card.done { border-left-color: var(--ok); opacity: .9; }
.card-title { font-size: 14px; margin: 0 0 2px; font-weight: 600; }
.why { color: var(--muted); margin: 2px 0 0; }
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-top: 6px; font-size: 13px; }
.read { font-weight: 600; } .src { color: var(--faint); font-size: 12px; margin-left: auto; }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
.note-form { margin-top: 8px; } .note-form label { display: block; font-size: 13px; color: var(--muted); }
.note-form textarea { display: block; width: 100%; margin-top: 4px; font: inherit; padding: 8px; border-radius: 7px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); resize: vertical; }
.result:empty { display: none; } .result { margin-top: 8px; font-size: 13px; }
.result .ok { color: var(--ok); margin: 0; } .result .err { color: var(--bad); margin: 0; white-space: pre-wrap; }
.result pre, .drill pre { white-space: pre-wrap; font: 12px/1.45 ui-monospace, Menlo, monospace; background: var(--soft); border-radius: 6px; padding: 8px; max-height: 360px; overflow: auto; margin: 6px 0 0; }
summary { cursor: pointer; color: var(--muted); margin-top: 4px; }
.queue { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
.row { display: flex; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
.row:first-child { border-top: 0; }
.row.is-next { background: var(--accent-soft); border-radius: 8px 8px 0 0; }
.num { flex: none; min-width: 2.2em; height: 1.7em; display: inline-grid; place-items: center; font-size: 12px; font-weight: 600; color: var(--muted); background: var(--soft); border-radius: 6px; }
.is-next .num { background: var(--accent); color: var(--on-accent); }
.row-body { min-width: 0; flex: 1; } .row-title { font-weight: 600; }
.row .why { font-size: 13px; }
.muted-row .row-title, .muted-row .title-btn { font-weight: 500; color: var(--muted); }
.when { flex: none; min-width: 6.5em; color: var(--muted); font-size: 12px; padding-top: 2px; }
.pill { display: inline-block; font-size: 11.5px; font-weight: 600; padding: 0 7px; border-radius: 999px; background: var(--soft); color: var(--muted); vertical-align: 1px; white-space: nowrap; }
.pill.accent { background: var(--accent-soft); color: var(--accent); } .pill.ok { color: var(--ok); } .pill.warn { color: var(--warn); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--faint); margin-right: 6px; }
.ci-green { background: var(--ok); } .ci-red { background: var(--bad); }
.none { color: var(--muted); margin: 0; padding: 10px 14px; border: 1px dashed var(--line); border-radius: 8px; }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
.headline { margin: 0 0 10px; font-weight: 600; }
.goals { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.goal-line { display: flex; gap: 8px; font-size: 13px; } .goal-id { color: var(--muted); font-weight: 600; min-width: 2em; }
.goal-title { flex: 1; min-width: 0; } .bar { display: block; width: 100%; height: 6px; margin-top: 3px; }
.bar .track { fill: var(--soft); } .bar .fill { fill: var(--accent); }
.owed { font-size: 12px; color: var(--muted); }
.fleet { margin-top: 28px; }
.fleet-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
.fleet-card { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 13px; }
.fleet-card a { font-weight: 600; } .fleet-card > * { align-self: flex-start; } .muted { color: var(--muted); }
.ci { display: inline-flex; align-items: center; }
.sources { margin-top: 20px; color: var(--muted); font-size: 12px; }
.sources ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 18px; }
.sources .dot { width: 6px; height: 6px; background: var(--ok); }
.src-na .dot, .src-partial .dot { background: var(--bad); } .src-na b, .src-partial b { color: var(--bad); }
[hidden], .filtered-out { display: none !important; }
[data-card], .col { scroll-margin-top: 80px; } @media (max-width: 560px) { [data-card], .col { scroll-margin-top: 150px; } }
#session-done { margin-bottom: 20px; }
dialog { border: 1px solid var(--line); background: var(--card); color: var(--fg); padding: 0; border-radius: 12px; max-width: 100vw; }
dialog::backdrop { background: rgb(0 0 0 / .35); }
dialog#drill { margin: 0 0 0 auto; height: 100dvh; max-height: 100dvh; width: min(560px, 100vw); border-radius: 12px 0 0 12px; }
.dialog-inner { padding: 18px 20px 28px; }
.dialog-bar { display: flex; justify-content: flex-end; position: sticky; top: 0; background: var(--card); padding: 10px 12px 0; }
.drill h2 { font-size: 18px; margin: 0 0 8px; } .eyebrow { margin: 0; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
.facts { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; font-size: 13px; } .facts dt { color: var(--muted); font-size: 11.5px; } .facts dd { margin: 0; }
.boxes { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.boxes li { display: flex; gap: 8px; } .boxes li.checked { color: var(--muted); }
.box { flex: none; width: 14px; height: 14px; margin-top: 3px; border: 1.5px solid var(--faint); border-radius: 3px; }
.checked .box { background: var(--ok); border-color: var(--ok); } .open.walk .box { border-color: var(--accent); }
.traj { margin: 0; padding-left: 18px; color: var(--muted); font-size: 13px; display: grid; gap: 4px; }
.drill-links { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 18px; font-weight: 600; }
dialog#help { width: min(420px, 92vw); } .keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; } .keys dd { margin: 0; }
kbd { font: 12px ui-monospace, Menlo, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; background: var(--soft); }
@media (max-width: 900px) { .layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 560px) {
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  dialog#drill { margin: auto 0 0; width: 100vw; height: 92dvh; border-radius: 12px 12px 0 0; }
  .src { margin-left: 0; } input[type=search] { width: 100%; } .tools { width: 100%; } .tools label { flex: 1; }
  .row { flex-wrap: wrap; } .when { min-width: 0; }
}
`;

/** The page's script: actions, refresh, filters, search, keys and the drill-down. Runs under the CSP nonce; no inline handlers. */
const SCRIPT = String.raw`
const V = boardView();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let data = JSON.parse($('#board-data').textContent);
let updated = Date.now(), filter = null, busy = false;
const results = new Map();
const say = t => { $('#status').textContent = t; };

function ago() {
  const s = Math.round((Date.now() - updated) / 1000);
  $('#ago').textContent = 'updated ' + (s < 5 ? 'just now' : s < 90 ? s + ' s ago' : Math.round(s / 60) + ' min ago');
}
setInterval(ago, 5000);

function apply() {
  for (const t of document.querySelectorAll('.tile')) t.setAttribute('aria-pressed', String(t.dataset.filter === filter));
  for (const c of document.querySelectorAll('.col[data-waits]')) c.classList.toggle('filtered-out', !!filter && c.dataset.waits !== filter && c.id !== 'session-done');
  const q = $('#q').value.trim().toLowerCase();
  for (const c of document.querySelectorAll('#board [data-card]')) c.hidden = !!q && !c.dataset.text.includes(q);
  for (const g of document.querySelectorAll('#board .group, #board .queue')) g.hidden = !!q && !g.querySelector('[data-card]:not([hidden])');
}

function settle(card, html, done) {
  const res = card.querySelector('.result');
  res.innerHTML = html;
  if (done) { card.classList.add('done'); for (const x of card.querySelectorAll('.acts, .note-form')) x.remove(); }
}

function draw() {
  const focused = document.activeElement?.closest?.('[data-card]')?.dataset.key;
  $('#board').innerHTML = V.page(data);
  $('#today').textContent = data.today;
  const list = $('#session-done .cards'); list.innerHTML = '';
  for (const [key, r] of results) {
    const card = [...document.querySelectorAll('#board [data-card]')].find(c => c.dataset.key === key);
    if (card) settle(card, r.html, r.done);
    else if (r.done) list.insertAdjacentHTML('beforeend', '<article class="card done" data-card tabindex="0" data-key="' + esc(key) + '" data-text="' + esc(key.toLowerCase()) + '"><h4 class="card-title">' + esc(key) + '</h4><div class="result" role="status">' + r.html + '</div></article>');
  }
  $('#session-done').hidden = !list.children.length;
  apply();
  if (focused) [...document.querySelectorAll('[data-card]')].find(c => c.dataset.key === focused)?.focus();
}

const typing = () => [...document.querySelectorAll('.note-form:not([hidden]) textarea')].some(t => t.value.trim()) || document.activeElement?.matches?.('textarea');

async function refresh(auto = false) {
  if (busy || (auto && typing())) return;
  busy = true; $('#refresh').disabled = true; say('Refreshing the board…');
  try {
    const r = await fetch('/board.json', { headers: { 'x-keel-token': token }, cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    data = j; updated = Date.now(); draw(); ago(); say('Board refreshed.');
  } catch (e) { $('#ago').textContent = 'refresh failed: ' + e.message; say('Refresh failed: ' + e.message); }
  finally { busy = false; $('#refresh').disabled = false; }
}
setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - updated >= 60000) refresh(true); }, 5000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - updated >= 60000) refresh(true); });

async function act(card, id, expect, note) {
  const res = card.querySelector('.result');
  const buttons = [...card.querySelectorAll('.acts button')];
  buttons.forEach(b => { b.disabled = true; });
  res.innerHTML = '<p>Running…</p>';
  let html, done = false;
  try {
    const r = await fetch('/action', { method: 'POST', headers: { 'content-type': 'application/json', 'x-keel-token': token }, body: JSON.stringify({ id, note, expect }) });
    const j = await r.json();
    const cmd = (j.argv || []).join(' ');
    if (j.error) html = '<p class="err">Refused: ' + esc(j.error) + '</p>';
    else if (j.code !== 0) html = '<p class="err">' + esc(cmd) + ' exited ' + esc(j.code) + '</p><pre>' + esc((j.err || '') + (j.out || '')) + '</pre>';
    else { done = true; html = '<p class="ok"><b>Done</b> — uncommitted: commit when the gate passes.</p><details><summary>The diff, from <code>' + esc(cmd) + '</code></summary><pre>' + esc(j.out || '') + (j.err ? '\n' + esc(j.err) : '') + '</pre></details>'; }
  } catch (e) { html = '<p class="err">Failed: ' + esc(e.message) + '</p>'; }
  results.set(card.dataset.key, { html, done });
  if (done) { settle(card, html, true); card.focus(); }
  else { res.innerHTML = html; buttons.forEach(b => { b.disabled = false; }); }
  say(done ? 'Done: ' + card.dataset.key + '. Uncommitted.' : 'Not done: ' + res.textContent);
}

function openNote(btn) {
  const card = btn.closest('[data-card]');
  const form = card.querySelector('.note-form');
  const same = !form.hidden && form.dataset.for === btn.dataset.noteFor;
  for (const b of card.querySelectorAll('[data-note-for]')) b.setAttribute('aria-expanded', 'false');
  if (same) { form.hidden = true; return; }
  form.hidden = false; form.dataset.for = btn.dataset.noteFor; form.dataset.expect = btn.dataset.expect; form.dataset.required = btn.dataset.required || '';
  btn.setAttribute('aria-expanded', 'true');
  form.querySelector('.need').textContent = btn.dataset.required ? '(required: what you saw, or why)' : '(optional)';
  form.querySelector('[data-submit]').textContent = btn.dataset.label;
  form.querySelector('textarea').focus();
}

function openDrill(n) {
  const p = data.phases?.[n];
  if (!p) return;
  $('#drill .drill').innerHTML = V.drill(p);
  $('#drill').showModal();
}

document.addEventListener('click', e => {
  const t = e.target.closest('button, dialog');
  if (!t) return;
  if (t.matches('dialog')) { if (e.target === t) t.close(); return; }
  if (t.matches('.tile')) { filter = filter === t.dataset.filter ? null : t.dataset.filter; apply(); say(filter ? 'Showing ' + t.querySelector('.tile-l').textContent + ' only.' : 'Showing everything.'); return; }
  if (t.matches('[data-drill]')) return openDrill(t.dataset.drill);
  if (t.matches('[data-action]')) return act(t.closest('[data-card]'), t.dataset.action, t.dataset.expect);
  if (t.matches('[data-note-for]')) return openNote(t);
  if (t.matches('[data-cancel]')) { const f = t.closest('.note-form'); f.hidden = true; f.closest('[data-card]').querySelector('[aria-expanded=true]')?.focus(); return; }
  if (t.matches('[data-submit]')) {
    const f = t.closest('.note-form'), note = f.querySelector('textarea').value.trim();
    if (f.dataset.required && !note) { f.querySelector('.need').textContent = '(required: write what you saw, or why)'; f.querySelector('textarea').focus(); return; }
    return act(t.closest('[data-card]'), f.dataset.for, f.dataset.expect, note || undefined);
  }
  if (t.matches('[data-close]')) return t.closest('dialog').close();
  if (t.id === 'refresh') return refresh();
  if (t.id === 'keys') return $('#help').showModal();
});

$('#q').addEventListener('input', apply);

document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.matches?.('input, textarea, select')) { if (e.key === 'Escape' && t.id === 'q') { t.value = ''; apply(); t.blur(); } return; }
  if (document.querySelector('dialog[open]')) return;
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  else if (e.key === 'j' || e.key === 'k') {
    const cards = [...document.querySelectorAll('[data-card]')].filter(c => c.offsetParent !== null);
    if (!cards.length) return;
    const i = cards.indexOf(document.activeElement?.closest?.('[data-card]'));
    const next = cards[Math.max(0, Math.min(cards.length - 1, i < 0 ? 0 : i + (e.key === 'j' ? 1 : -1)))];
    next.focus(); next.scrollIntoView({ block: 'nearest' });
  }
  else if (e.key === 'Enter' && t.matches?.('[data-card]')) { if (t.dataset.phase) { e.preventDefault(); openDrill(t.dataset.phase); } }
  else if (e.key === 'r') refresh();
  else if (e.key === '?') $('#help').showModal();
});
`;

/**
 * The page: the board drawn on the server by boardView (so it reads without
 * script), its data inline for the drill-down and refresh, CSS and JS inline
 * under the CSP nonce. No CDN, no build.
 */
export function pageHtml(data, token, nonce = '') {
  const n = nonce ? ` nonce="${nonce}"` : '';
  const json = s => JSON.stringify(s).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16)}`);
  const name = esc(data.name ?? 'keel');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${name}: whose turn it is</title>
<style${n}>${CSS}</style></head><body>
<a class="skip" href="#h-owner">Skip to your turn</a>
<header class="top"><div class="wrap">
  <div class="brand"><h1>${name}: whose turn it is</h1><span class="meta"><time id="today">${esc(data.today)}</time> · <span id="ago">updated just now</span></span></div>
  <div class="tools"><label><span class="sr">Search the board</span><input id="q" type="search" placeholder="Search  ( / )" autocomplete="off"></label><button type="button" id="refresh" title="Refresh (r)">Refresh</button><button type="button" id="keys" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">?</button></div>
</div></header>
<div class="wrap">
<section id="session-done" class="col" aria-labelledby="h-done" hidden><h2 id="h-done">Done this session</h2><div class="cards"></div></section>
<main id="board">
${boardView().page(data)}
</main>
</div>
<dialog id="drill" aria-labelledby="drill-title"><div class="dialog-bar"><button type="button" class="btn" data-close>Close</button></div><div class="dialog-inner drill"></div></dialog>
<dialog id="help" aria-labelledby="help-title"><div class="dialog-inner"><h2 id="help-title">Keys</h2>
<dl class="keys"><dt><kbd>/</kbd></dt><dd>search</dd><dt><kbd>j</kbd> <kbd>k</kbd></dt><dd>next, previous card</dd><dt><kbd>Enter</kbd></dt><dd>open the focused phase</dd><dt><kbd>r</kbd></dt><dd>refresh</dd><dt><kbd>?</kbd></dt><dd>these keys</dd><dt><kbd>Esc</kbd></dt><dd>close, or clear the search</dd></dl>
<p><button type="button" class="btn" data-close>Close</button></p></div></dialog>
<div id="status" class="sr" role="status" aria-live="polite"></div>
<script type="application/json" id="board-data"${n}>${json(data)}</script>
<script${n}>
const token = ${json(token)};
${boardView.toString().replace(/<\/script/gi, '<\\/script')}
${SCRIPT}
</script>
</body></html>`;
}

// ---- the server ------------------------------------------------------------------------

/** The page's Content-Security-Policy: nothing loads from elsewhere; inline script and style only with this response's nonce. */
export const csp = nonce => [
  "default-src 'none'",
  nonce ? `script-src 'nonce-${nonce}'` : "script-src 'none'",
  nonce ? `style-src 'nonce-${nonce}'` : "style-src 'none'",
  "connect-src 'self'", "img-src 'self' data:", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

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
  const send = (res, status, body, type = 'application/json', nonce = null) => {
    res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
      'content-security-policy': csp(nonce), 'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const server = createServer(async (req, res) => {
    try {
      const { port: at } = server.address();
      const url = new URL(req.url, `http://127.0.0.1:${at}`);
      if (![`127.0.0.1:${at}`, `localhost:${at}`].includes(req.headers.host)) return send(res, 403, { error: 'wrong host' });
      if (req.headers.origin && ![`http://127.0.0.1:${at}`, `http://localhost:${at}`].includes(req.headers.origin)) return send(res, 403, { error: 'wrong origin' });
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/board.json')) {
        // The page's own refresh sends the token as a header, so it stays out of request lines and logs.
        if (!same(url.searchParams.get('token'), token) && !(url.pathname === '/board.json' && same(req.headers['x-keel-token'], token))) return send(res, 403, { error: 'no token: open the URL keel board printed' });
        const data = await build();
        actions = new Map(data.items.flatMap(it => it.actions.map(a => [a.id, a])));
        if (url.pathname !== '/') return send(res, 200, data);
        const nonce = randomBytes(16).toString('base64');
        return send(res, 200, pageHtml(data, token, nonce), 'text/html', nonce);
      }
      if (req.method === 'POST' && url.pathname === '/action') {
        if (!same(req.headers['x-keel-token'], token)) return send(res, 403, { error: 'no token' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 64 * 1024) return send(res, 413, { error: 'too large' }); }
        let ask;
        try { ask = JSON.parse(body); } catch { return send(res, 400, { error: 'not JSON' }); }
        const a = actions.get(ask?.id);
        if (!a || !ACTION_VERBS.includes(a.verb)) return send(res, 404, { error: 'no such action on the board: reload it' });
        // The page says which command it meant; a board rebuilt since (another tab, a refresh) may have moved the ids.
        if (ask.expect !== undefined && ask.expect !== [a.verb, ...a.args].join(' ')) return send(res, 409, { error: 'the board changed since this page drew it: refresh, then try again' });
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


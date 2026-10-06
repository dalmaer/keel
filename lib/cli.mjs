// The keel CLI: a registry of verbs, and the one dispatcher that runs them.
//
// A verb is { summary, usage, run(args, ctx) }. run returns { data, text }:
// data is printed as JSON under --json, text otherwise; the two never mix.
// A verb is announced in lib/agent-guide.md's cold start or it fails the
// surface test (tests/cli.test.mjs), which reads this registry, not a list.
//
// Exit codes: 0 ok, 1 the command ran and found a failure (render --check
// differs, doctor has findings, or an unexpected error), 2 usage or no project, 3 needs a yes (a ⚑
// step was planned and nothing was done). improve also exits 2 when an instrument is broken.
// drain exits 3 when it would merge or close a PR and has no --yes; fleet update
// exits 3 with the PRs it would open, and 1 when any repo failed.
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot } from './project.mjs';
import { render as renderPractices, practiceVersion } from './practices.mjs';
import { goalAdd, goalShow, goalRetire, phaseNew, phaseList } from './goals.mjs';
import { parseVersion } from './migrations.mjs';
// Roadmap logic has one home: the phases practice. The CLI uses its own copy,
// pointed at the project, never the project's scripts/.
import { collect, focus, DONE } from '../practices/phases/files/scripts/roadmap.mjs';
import { shapeOf, readProjects, countsOf } from './phases-projects.mjs';

export const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GUIDE = join(CLI_ROOT, 'lib', 'agent-guide.md');
// The cold start is one screen. 2,500 was set at seven verbs; at sixteen,
// with goal and phase each on one line, 3,200 is still one screen.
export const COLD_START_LIMIT = 3200;

// A verb's own module loads when that verb runs, not at start: keel status
// should not pay for fleet, learn and improve.
const lazy = path => { let m; return () => (m ??= import(path)); };
const mod = {
  init: lazy('./init.mjs'), adopt: lazy('./adopt.mjs'), doctor: lazy('./doctor.mjs'), update: lazy('./update.mjs'),
  release: lazy('./release.mjs'), lessons: lazy('./lessons.mjs'), learn: lazy('./learn.mjs'), improve: lazy('./improve.mjs'),
  night: lazy('./night.mjs'), fleet: lazy('./fleet.mjs'), looseends: lazy('./looseends.mjs'),
  retro: lazy('./retro.mjs'),
};

export class UsageError extends Error {
  constructor(message) { super(message); this.exitCode = 2; }
}

/** Value of `--flag <value>`, or undefined. Throws if the flag has no value. */
function option(args, flag) {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return value;
}

/** Every value of a repeatable `--with <practice>` (a comma list counts as several). */
function withs(args) {
  const names = [];
  args.forEach((a, i) => {
    if (a !== '--with') return;
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError('--with needs a practice (loop, claude)');
    names.push(...value.split(',').map(n => n.trim()).filter(Boolean));
  });
  return names;
}

function noExtra(args, flags = [], valued = []) {
  const known = new Set(['--json', ...flags, ...valued]);
  const extra = args.filter((a, i) => !known.has(a) && !valued.includes(args[i - 1]));
  if (extra.length) throw new UsageError(`unexpected argument: ${extra[0]}`);
}

/**
 * The project's roadmap, read with keel's parser — unless phases is a local
 * variant there, where keel's parser would only report the project's own
 * format as an error. Then say so, and point at the project's own roadmap.
 */
async function phasesRoot(ctx, { projects = false } = {}) {
  const root = await ctx.root();
  const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  const local = config.local ?? {};
  if (shapeOf(config) === 'projects') {
    if (projects) return { root, config, projects: true };
    throw new UsageError('phases are in the projects shape here (docs/projects/<p>/phases.md), which keel reads but never writes; keel next and keel status read it');
  }
  if (projects) return { root, config, projects: false };
  if (Object.hasOwn(local, 'phases') && !(config.practices ?? []).includes('phases')) {
    throw new UsageError(`phases is a local variant here: ${local.phases}; use the project's own roadmap (npm run roadmap)`);
  }
  return root;
}
const roadmapOf = async ctx => collect(await phasesRoot(ctx));

/** The one positional argument of a verb, with its valued flags set aside. */
function onePositional(args, valued, usage) {
  const positional = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
  if (positional.length !== 1) throw new UsageError(positional.length ? `unexpected argument: ${positional[1]}` : usage);
  return positional[0];
}

const phaseLine = p => `${p.id}. ${p.title} [${p.status}] — docs/phases/${p.file}`;

/** The projects shape (docs/projects/<p>/phases.md), read-only: every project, or the one --project names. */
async function projectsOf(ctx, args) {
  const at = await phasesRoot(ctx, { projects: true });
  const name = option(args, '--project');
  if (!at.projects) {
    if (name !== undefined) throw new UsageError('--project reads the projects shape (docs/projects/<p>/phases.md); this project keeps docs/phases/');
    return null;
  }
  const { projects } = await readProjects(at.root);
  if (name === undefined) return { config: at.config, projects };
  const one = projects.find(p => p.project === name);
  if (!one) throw new UsageError(`no project ${name}: docs/projects/${name}/phases.md does not exist (${projects.length} projects: ${projects.slice(0, 6).map(p => p.project).join(', ')}${projects.length > 6 ? ', …' : ''})`);
  return { config: at.config, projects: [one], one };
}
const projectPhase = (p, ph) => `${p.project}: phase ${ph.id}${ph.title ? ` — ${ph.title}` : ''} [${ph.status}${ph.word ? `: ${ph.word}` : ''}] — ${p.file}:${ph.line}`;
const projectNext = p => ({ project: p.project, file: p.file, next: p.next, from: p.from, unknown: p.unknown });
const projectNextText = p => p.next ? `${projectPhase(p, p.next)} (${p.from})` : `${p.project}: nothing next — ${p.from}${p.unknown.length ? ` (unknown: ${p.unknown.join(', ')})` : ''}`;

function goalRows({ goals, phases }) {
  return goals.map(g => {
    const group = phases.filter(p => p.goal === g.id);
    return {
      id: g.id, title: g.title, outcome: g.outcome, phases: group.length,
      built: group.filter(p => DONE.includes(p.status)).length,
      lived: group.filter(p => p.status === 'lived-in').length,
    };
  });
}
const goalText = g => `${g.id}  ${g.built}/${g.phases} built, ${g.lived}/${g.phases} lived-in  ${g.title}`;

export const verbs = new Map([
  ['status', {
    summary: 'goals with built and lived-in counts, and the next phase',
    usage: 'keel status [--project <p>] [--json]',
    async run(args, ctx) {
      noExtra(args, [], ['--project']);
      const shaped = await projectsOf(ctx, args);
      if (shaped) {
        const rows = shaped.projects.map(p => ({ ...countsOf(p), ...projectNext(p) }));
        return {
          data: { name: shaped.config.name, shape: 'projects', projects: rows },
          text: [`${shaped.config.name} (projects shape, read-only)`,
            ...rows.map(r => `${r.project.padEnd(22)} ${r.built}/${r.phases} built, ${r.partial} partial, ${r.planned} planned${r.unknown.length ? `, ${r.unknown.length} unknown` : ''}${r.next ? `  next: phase ${r.next.id}` : ''}`)].join('\n'),
        };
      }
      const data = await roadmapOf(ctx);
      const goals = goalRows(data), next = focus(data);
      return {
        data: { name: data.config.name, goals, next },
        text: [`${data.config.name}`, ...goals.map(goalText), '',
          next ? `Next: ${phaseLine(next)}\n${next.next}` : 'Next: nothing left unbuilt.'].join('\n'),
      };
    },
  }],
  ['next', {
    summary: 'the next phase to conduct, its done-when and next action',
    usage: 'keel next [--project <p>] [--json]',
    async run(args, ctx) {
      noExtra(args, [], ['--project']);
      const shaped = await projectsOf(ctx, args);
      if (shaped?.one) {
        const p = shaped.one;
        return { data: { shape: 'projects', ...projectNext(p), where: p.where }, text: [projectNextText(p), ...(p.where ? [p.where] : [])].join('\n') };
      }
      if (shaped) {
        const open = shaped.projects.filter(p => p.next || p.unknown.length);
        return {
          data: { shape: 'projects', projects: open.map(projectNext) },
          text: [...open.map(projectNextText), `${shaped.projects.length - open.length} of ${shaped.projects.length} projects have nothing left. keel next --project <p> for one.`].join('\n'),
        };
      }
      const p = focus(await roadmapOf(ctx));
      return {
        data: p,
        text: p ? `${phaseLine(p)}\nDone when: ${p.done}\nNext action: ${p.next}` : 'Nothing left unbuilt.',
      };
    },
  }],
  ['goal list', {
    summary: 'every goal, with progress derived from its phases',
    usage: 'keel goal list [--json]',
    async run(args, ctx) {
      noExtra(args);
      const goals = goalRows(await roadmapOf(ctx));
      return { data: goals, text: goals.map(goalText).join('\n') };
    },
  }],
  ['goal show', {
    summary: 'one goal: its phases, built and lived-in counts, and its next phase',
    usage: 'keel goal show <id> [--json]',
    async run(args, ctx) {
      const id = onePositional(args, [], 'keel goal show <id>');
      noExtra(args.filter(a => a !== id));
      return goalShow({ root: await phasesRoot(ctx), id });
    },
  }],
  ['goal add', {
    summary: 'add a goal (the next free G<n>) to docs/goals.json; regenerate the roadmap',
    usage: 'keel goal add "<title>" --outcome "<one sentence>" [--json]',
    async run(args, ctx) {
      const valued = ['--outcome'];
      const title = onePositional(args, valued, 'keel goal add "<title>" --outcome "<one sentence>"');
      noExtra(args.filter(a => a !== title), [], valued);
      return goalAdd({ root: await phasesRoot(ctx), title, outcome: option(args, '--outcome') });
    },
  }],
  ['goal retire', {
    summary: 'retire a goal with a reason; its unbuilt phases are superseded or moved (--yes)',
    usage: 'keel goal retire <id> --reason "<why>" [--phases supersede|move:<Gm>] [--yes] [--json]',
    async run(args, ctx) {
      const valued = ['--reason', '--phases'];
      const id = onePositional(args, valued, 'keel goal retire <id> --reason "<why>"');
      noExtra(args.filter(a => a !== id), ['--yes'], valued);
      return goalRetire({ root: await phasesRoot(ctx), id, reason: option(args, '--reason'), phases: option(args, '--phases'), yes: args.includes('--yes') });
    },
  }],
  ['phase new', {
    summary: 'scaffold the next free phase number from the template, under a goal',
    usage: 'keel phase new "<title>" --goal <id> [--depends 1,2] [--json]',
    async run(args, ctx) {
      const valued = ['--goal', '--depends'];
      const title = onePositional(args, valued, 'keel phase new "<title>" --goal <id> [--depends 1,2]');
      noExtra(args.filter(a => a !== title), [], valued);
      return phaseNew({ root: await phasesRoot(ctx), title, goal: option(args, '--goal'), depends: option(args, '--depends') });
    },
  }],
  ['phase list', {
    summary: 'every phase, as the roadmap reads it',
    usage: 'keel phase list [--json]',
    async run(args, ctx) {
      noExtra(args);
      return phaseList({ root: await phasesRoot(ctx) });
    },
  }],
  ['render', {
    summary: 'render the project\'s practices onto it; --check writes nothing',
    usage: 'keel render [--check] [--into <dir>] [--json]',
    async run(args, ctx) {
      noExtra(args, ['--check'], ['--into']);
      const check = args.includes('--check');
      const into = option(args, '--into');
      const root = into ? resolve(ctx.cwd, into) : await ctx.root();
      const result = await renderPractices(root, { check });
      const label = e => e.block ? `${e.path}#${e.block}` : e.path;
      const counts = {};
      for (const e of result.entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
      const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
      const text = check && !result.ok
        ? ['Practice files differ from the practices keel carries — run keel render:',
          ...result.differs.map(e => `  ${e.status.padEnd(7)} ${label(e)} (${e.practice})${e.state ? ` — ${e.state}${e.state === 'behind' ? '' : ': the project changed it; render will refuse, see keel doctor'}` : ''}`)].join('\n')
        : `${check ? 'Checked' : 'Rendered'} ${result.entries.length} practice targets: ${summary}`;
      return {
        data: { root, check, ok: result.ok, differs: result.differs.map(label), changed: (result.changed ?? []).map(label),
          entries: result.entries.map(({ content, ...e }) => e) },
        text, exitCode: result.ok ? 0 : 1,
      };
    },
  }],
  ['init', {
    summary: 'a new project in an empty directory: practice, goal G0, phase 0, one commit',
    usage: 'keel init [dir] --description "<paragraph>" [--name <n>] [--tagline <t>] [--kind static|node|web|other] [--repo owner/name] [--with <practice>]... [--github [--yes]] [--json]',
    async run(args, ctx) {
      const valued = ['--name', '--description', '--tagline', '--kind', '--repo', '--with'];
      const flags = ['--github', '--yes'];
      const positional = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
      if (positional.length > 1) throw new UsageError(`unexpected argument: ${positional[1]}`);
      noExtra(args.filter(a => a !== positional[0]), flags, valued);
      const [name, description, tagline, kind, repo] = valued.map(f => option(args, f));
      return (await mod.init()).init({
        dir: resolve(ctx.cwd, positional[0] ?? '.'), name, description, tagline, kind, repo,
        github: args.includes('--github'), yes: args.includes('--yes'), with: withs(args),
      }, { version: versionInfo(), env: process.env });
    },
  }],
  ['adopt', {
    summary: 'bring an existing project under keel; on only what it already satisfies, the rest local',
    usage: 'keel adopt [dir] [--dry-run] [--check "<command>"] [--setup "<command>"] [--env KEY=VALUE]... [--with <practice>]... [--json]',
    async run(args, ctx) {
      const valued = ['--check', '--setup', '--env', '--with'];
      const positional = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
      if (positional.length > 1) throw new UsageError(`unexpected argument: ${positional[1]}`);
      noExtra(args.filter(a => a !== positional[0]), ['--dry-run'], valued);
      let env;
      args.forEach((a, i) => {
        if (a !== '--env') return;
        const pair = args[i + 1];
        const eq = pair === undefined || pair.startsWith('--') ? -1 : pair.indexOf('=');
        if (eq < 1) throw new UsageError('--env needs KEY=VALUE');
        (env ??= {})[pair.slice(0, eq)] = pair.slice(eq + 1);
      });
      return (await mod.adopt()).adopt({ dir: resolve(ctx.cwd, positional[0] ?? '.'), dryRun: args.includes('--dry-run'), check: option(args, '--check'), setup: option(args, '--setup'), env, with: withs(args) },
        { version: versionInfo() });
    },
  }],
  ['doctor', {
    summary: 'what the project changed of the practice, and practice rules broken; changes nothing without --fix',
    usage: 'keel doctor [--github] [--fix <path> restore|eject [--yes]] [--json]',
    async run(args, ctx) {
      const i = args.indexOf('--fix');
      let fix;
      if (i >= 0) {
        fix = [args[i + 1], args[i + 2]];
        if (!fix[0] || fix[0].startsWith('--') || !['restore', 'eject'].includes(fix[1])) throw new UsageError('--fix needs <path> restore|eject');
        args = [...args.slice(0, i), ...args.slice(i + 3)];
      }
      noExtra(args, ['--yes', '--github']);
      return (await mod.doctor()).doctor({ root: await ctx.root(), fix, yes: args.includes('--yes'), github: args.includes('--github') });
    },
  }],
  ['update', {
    summary: 'the CLI first, then migrations, re-render, check; one branch for a PR (--local: a diff)',
    usage: 'keel update [dir] [--local] [--yes] [--no-self-update] [--json]',
    async run(args, ctx) {
      const flags = ['--local', '--yes', '--no-self-update'];
      const positional = args.filter(a => !a.startsWith('--'));
      if (positional.length > 1) throw new UsageError(`unexpected argument: ${positional[1]}`);
      noExtra(args.filter(a => a !== positional[0]), flags);
      if (args.includes('--local') && args.includes('--yes')) throw new UsageError('--yes answers the push and PR; --local makes neither');
      const { WHATSNEW } = await mod.release();
      return (await mod.update()).update({
        dir: resolve(ctx.cwd, positional[0] ?? '.'), local: args.includes('--local'), yes: args.includes('--yes'),
        selfUpdate: !args.includes('--no-self-update'), argv: ['update', ...args], cwd: ctx.cwd,
      }, { version: versionInfo().practice, cliRoot: CLI_ROOT, whatsnew: join(CLI_ROOT, WHATSNEW), env: process.env });
    },
  }],
  ['lessons', {
    summary: 'send new lessons, drift and practice commits home to keel as issues, once each',
    usage: 'keel lessons [--dry-run] [--yes] [--to owner/repo] [--since <ref>] [--json]',
    async run(args, ctx) {
      const valued = ['--to', '--since'];
      noExtra(args, ['--dry-run', '--yes'], valued);
      return (await mod.lessons()).lessons({ dir: ctx.cwd, dryRun: args.includes('--dry-run'), yes: args.includes('--yes'),
        to: option(args, '--to'), since: option(args, '--since') }, { cliRoot: CLI_ROOT, env: process.env });
    },
  }],
  ['learn', {
    summary: 'keel only: gather lesson issues and moved sources into docs/inbox/; propose (agent), decide (person), render',
    usage: 'keel learn [propose <slug|issue#> --outcome lesson|practice|decline|link --note "<line>" --read "<read>" [--link <n>] [--yes] | decide <slug|issue#> accepted|declined [--note "<why>"] [--shape "…" --cost "…" --guard "…"] [--yes] | render [--check]] [--json]',
    async run(args, ctx) {
      const [sub, ...rest] = args.filter(a => a !== '--json');
      const dir = ctx.cwd;
      if (sub === undefined || sub.startsWith('--')) {
        noExtra(args);
        return (await mod.learn()).gather({ dir }, { env: process.env });
      }
      const positional = (valued) => rest.filter((a, i) => !a.startsWith('--') && !valued.includes(rest[i - 1]));
      if (sub === 'propose') {
        const valued = ['--outcome', '--note', '--read', '--link'];
        const [slug, extra] = positional(valued);
        if (!slug) throw new UsageError('keel learn propose <slug|issue#> --outcome … --note … --read … [--yes]');
        if (extra) throw new UsageError(`unexpected argument: ${extra}`);
        noExtra(rest.filter(a => a !== slug), ['--yes'], valued);
        return (await mod.learn()).propose({ dir, slug, outcome: option(rest, '--outcome'), note: option(rest, '--note'), read: option(rest, '--read'), link: option(rest, '--link'), yes: rest.includes('--yes') }, { env: process.env });
      }
      if (sub === 'decide') {
        const valued = ['--note', '--shape', '--cost', '--guard'];
        const [slug, decision, extra] = positional(valued);
        if (!slug || !decision) throw new UsageError('keel learn decide <slug|issue#> accepted|declined [--note "<why>"] [--shape "…" --cost "…" --guard "…"] [--yes]');
        if (extra) throw new UsageError(`unexpected argument: ${extra}`);
        noExtra(rest.filter(a => a !== slug && a !== decision), ['--yes'], valued);
        return (await mod.learn()).decide({ dir, slug, decision, note: option(rest, '--note'), shape: option(rest, '--shape'), cost: option(rest, '--cost'),
          guard: option(rest, '--guard'), yes: rest.includes('--yes') }, { env: process.env });
      }
      if (sub === 'render') {
        noExtra(rest, ['--check']);
        return (await mod.learn()).render({ dir, check: rest.includes('--check') }, { env: process.env });
      }
      throw new UsageError(`keel learn: unknown "${sub}"; one of propose, decide, render, or nothing to gather`);
    },
  }],
  ['improve', {
    summary: 'is the practice working here: measures against bounds, one proposal; --report writes <health>/<date>.md (.keel/keel.json health, default docs/health)',
    usage: 'keel improve [--report] [--transcripts <dir>] [--selftest] [--json]',
    async run(args, ctx) {
      const valued = ['--transcripts'];
      noExtra(args, ['--report', '--selftest'], valued);
      if (args.includes('--selftest')) {
        if (args.includes('--report') || args.includes('--transcripts')) throw new UsageError('--selftest runs on its own fixture; it takes no --report or --transcripts');
        return (await mod.improve()).selftest();
      }
      const transcripts = option(args, '--transcripts');
      return (await mod.improve()).improve({ root: await ctx.root(), report: args.includes('--report'), transcripts: transcripts && resolve(ctx.cwd, transcripts) });
    },
  }],
  ['drain', {
    summary: 'one open PR per machine queue: merge older data-only PRs, close the rest as superseded; the newest only after a gate',
    usage: 'keel drain <prefix> [--gate-passed] [--yes] [--json]',
    async run(args, ctx) {
      const prefix = onePositional(args, [], 'keel drain <prefix> [--gate-passed] [--yes]');
      noExtra(args.filter(a => a !== prefix), ['--gate-passed', '--yes']);
      return (await mod.night()).drain({ root: await ctx.root(), prefix, yes: args.includes('--yes'), gatePassed: args.includes('--gate-passed') }, { env: process.env });
    },
  }],
  ['fleet', {
    summary: 'keel only: every project in fleet.json — adopted, practice behind, health, CI, unsent lessons, machine PRs; read-only',
    usage: 'keel fleet [--json]',
    async run(args, ctx) {
      noExtra(args);
      return (await mod.fleet()).fleet({ dir: ctx.cwd }, { env: process.env, cli: fleetPractice(process.env) });
    },
  }],
  ['fleet update', {
    summary: 'keel only: open the update PR in each fleet project behind or with pending migrations, with your gh login (--yes)',
    usage: 'keel fleet update [--yes] [--json]',
    async run(args, ctx) {
      noExtra(args, ['--yes']);
      const { WHATSNEW } = await mod.release();
      return (await mod.fleet()).fleetUpdate({ dir: ctx.cwd, yes: args.includes('--yes') },
        { env: process.env, cli: fleetPractice(process.env), cliRoot: CLI_ROOT, whatsnew: join(CLI_ROOT, WHATSNEW) });
    },
  }],
  ['loose-ends', {
    summary: 'what you started and did not finish, in keel and each fleet checkout: chats, files, branches, PRs, owner steps; read-only but mark',
    usage: 'keel loose-ends [--all] [--phase N] [--root <dir>] [--json] | mark <id> resume|park|drop --reason "<why>" [--until YYYY-MM-DD]',
    async run(args, ctx) {
      const home = await ctx.root();
      const root = option(args, '--root');
      if (args[0] === 'mark') {
        const rest = args.slice(1);
        const valued = ['--reason', '--until', '--root'];
        const positional = rest.filter((a, i) => !a.startsWith('--') && !valued.includes(rest[i - 1]));
        if (positional.length !== 2) throw new UsageError('keel loose-ends mark <id> resume|park|drop --reason "<why>" [--until YYYY-MM-DD]');
        noExtra(rest.filter(a => !positional.includes(a)), [], valued);
        return (await mod.looseends()).mark({ home, root, id: positional[0], move: positional[1], reason: option(rest, '--reason'), until: option(rest, '--until'), env: process.env });
      }
      noExtra(args, ['--all'], ['--phase', '--root']);
      const p = option(args, '--phase');
      if (p !== undefined && !/^\d+$/.test(p)) throw new UsageError('--phase needs a phase number');
      return (await mod.looseends()).looseEnds({ home, root, all: args.includes('--all'), phase: p === undefined ? undefined : Number(p), env: process.env });
    },
  }],
  ['retro', {
    summary: 'the retro worksheet after real work: counts and pointers from this session\'s transcript (never its text), and the seven areas; exit 0',
    usage: 'keel retro [--worksheet] [--since <commit>] [--session <id>] [--json]',
    async run(args, ctx) {
      noExtra(args, ['--worksheet'], ['--since', '--session']);
      return (await mod.retro()).retro({ root: await ctx.root(), since: option(args, '--since'), session: option(args, '--session'), env: process.env });
    },
  }],
  ['release', {
    summary: 'keel only: cut a CLI version, and the practice version only if practices/ or migrations/ changed — WHATSNEW entry, gate, commit, local tag',
    usage: 'keel release [<x.y.z> --notes <file|-> [--practice <x.y.z>]] [--dry-run] [--json]',
    async run(args, ctx) {
      const valued = ['--notes', '--practice'];
      const positional = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
      if (positional.length > 1) throw new UsageError(`unexpected argument: ${positional[1]}`);
      noExtra(args.filter(a => a !== positional[0]), ['--dry-run'], valued);
      let notes;
      const i = args.indexOf('--notes');
      if (i >= 0) {
        const from = args[i + 1];
        if (from === undefined || (from.startsWith('--') && from !== '-')) throw new UsageError('--notes needs a file, or - for stdin');
        notes = from === '-' ? readFileSync(0, 'utf8') : await readFile(resolve(ctx.cwd, from), 'utf8')
          .catch(() => { throw new UsageError(`--notes: cannot read ${from}`); });
      }
      const p = args.indexOf('--practice');
      if (p >= 0 && (args[p + 1] === undefined || args[p + 1].startsWith('--'))) throw new UsageError('--practice needs a version (x.y.z)');
      return (await mod.release()).release({ root: await ctx.root(), version: positional[0], notes, dryRun: args.includes('--dry-run'), practice: p >= 0 ? args[p + 1] : undefined }, { env: process.env });
    },
  }],
  ['help', {
    summary: 'the verbs, one line each',
    usage: 'keel help [--json]',
    async run(args) {
      noExtra(args);
      const rows = [...verbs].map(([name, v]) => ({ name, usage: v.usage, summary: v.summary }));
      return {
        data: { verbs: rows, flags: FLAGS },
        text: ['keel — run projects the isocan/ledger way', '',
          ...rows.map(r => `  ${r.usage.padEnd(46)} ${r.summary}`),
          ...FLAGS.map(f => `  ${f.usage.padEnd(46)} ${f.summary}`), '',
          'Agents: start with keel --agent-help.'].join('\n'),
      };
    },
  }],
]);

/** Top-level flags that act like verbs. The surface test covers them too. */
export const FLAGS = [
  { name: '--agent-help', usage: 'keel --agent-help [topic|all] [--json]', summary: 'the agent guide: cold start, or one topic' },
  { name: '--version', usage: 'keel --version [--json]', summary: 'CLI version, its commit, and the practice version it carries' },
];

// ---- the agent guide -------------------------------------------------------

const TOPIC = /^<!-- topic: ([a-z0-9-]+) \| (.+?) -->$/gm;

/** Split the guide into its cold start and its topics. */
export function parseGuide(text) {
  const marks = [...text.matchAll(TOPIC)];
  const coldStart = (marks.length ? text.slice(0, marks[0].index) : text).trim();
  const topics = marks.map((m, i) => ({
    slug: m[1], summary: m[2],
    body: text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).trim(),
  }));
  return { coldStart, topics };
}

/**
 * The commands a cold start announces: each line beginning "- `keel …`",
 * with a word list like `goal list|show` read as one command per word.
 */
export function announced(coldStart) {
  const out = [];
  for (const [, command] of coldStart.matchAll(/^- `keel ([^`]+?)`/gm)) {
    let forms = [''];
    for (const word of command.split(' ')) {
      const alts = /^[a-z][a-z-]*(\|[a-z][a-z-]*)+$/.test(word) ? word.split('|') : [word];
      forms = forms.flatMap(f => alts.map(a => f ? `${f} ${a}` : a));
    }
    out.push(...forms);
  }
  return out;
}

/**
 * What the guide's cold start fails to announce: every registered verb and
 * top-level flag needs a line beginning "- `keel <name>" (or naming it in a
 * `a|b` word list). Returns the misses.
 */
export function surfaceGaps(names, guideText) {
  const lines = announced(parseGuide(guideText).coldStart);
  return names.filter(name => !lines.some(l => l === name || l.startsWith(`${name} `)));
}

async function agentHelp(args) {
  const rest = args.filter(a => a !== '--json');
  if (rest.length > 1) throw new UsageError(`unexpected argument: ${rest[1]}`);
  const guide = parseGuide(await readFile(GUIDE, 'utf8'));
  const index = guide.topics.map(({ slug, summary }) => ({ slug, summary }));
  const [want] = rest;
  if (!want) return { data: { coldStart: guide.coldStart, topics: index }, text: guide.coldStart };
  if (want === 'all') {
    return {
      data: { coldStart: guide.coldStart, topics: guide.topics },
      text: [guide.coldStart, ...guide.topics.map(t => `## ${t.slug} — ${t.summary}\n\n${t.body}`)].join('\n\n'),
    };
  }
  const topic = guide.topics.find(t => t.slug === want);
  if (!topic) throw new UsageError(`no agent-help topic "${want}"; topics: ${index.map(t => t.slug).join(', ')}`);
  return { data: topic, text: topic.body };
}

// ---- version ---------------------------------------------------------------

// One rev-parse answers the checkout and its commit (it fails whole when HEAD has no commit).
const HEAD_ARGS = ['rev-parse', '--show-toplevel', '--short', 'HEAD'];
const TAG_ARGS = ['tag', '--points-at', 'HEAD', '--list', 'v*'];

/** The version from git's answers: head and tags() are each a git's trimmed output, or null when it failed. */
function versionFrom(head, tags) {
  const pkg = JSON.parse(readFileSync(join(CLI_ROOT, 'package.json'), 'utf8'));
  let commit = null, tag = null;
  const [top, short] = head?.split('\n') ?? [];
  // Only the CLI's own checkout counts, not a repo it happens to sit inside.
  if (head !== null && resolve(top) === resolve(CLI_ROOT)) {
    commit = short;
    tag = tags()?.split('\n').filter(Boolean).pop() ?? null;
  }
  // Two versions: the CLI's (package.json, tagged v<cli> by keel release) and
  // the practice's (practices/VERSION), which moves only when the practice does.
  return { cli: pkg.version, commit, practice: practiceVersion(), tag };
}

export function versionInfo() {
  const git = args => { try { return execFileSync('git', ['-C', CLI_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  return versionFrom(git(HEAD_ARGS), () => git(TAG_ARGS));
}

/** versionInfo, asking git both questions at once (the tag's answer is dropped outside keel's own checkout). */
async function versionInfoAsync() {
  const git = args => new Promise(done => execFile('git', ['-C', CLI_ROOT, ...args], { encoding: 'utf8' }, (e, out) => done(e ? null : out.trim())));
  const [head, tags] = await Promise.all([git(HEAD_ARGS), git(TAG_ARGS)]);
  return versionFrom(head, () => tags);
}

/**
 * The practice version fleet and fleet update compare against: this CLI's, or
 * KEEL_FLEET_PRACTICE when set. That variable is a test seam, like KEEL_GH: a
 * test that spawns the CLI injects the version, so the next release of keel
 * cannot change what the test counts as behind.
 */
function fleetPractice(env) {
  const v = env.KEEL_FLEET_PRACTICE;
  if (!v) return versionInfo().practice;
  if (!parseVersion(v)) throw new UsageError(`KEEL_FLEET_PRACTICE=${v} is not a version (x.y.z)`);
  return v;
}

async function version(args) {
  noExtra(args);
  const v = await versionInfoAsync();
  return { data: v, text: v.commit ? `keel ${v.cli} (${v.commit}) practice ${v.practice}` : `keel ${v.cli} practice ${v.practice}` };
}

// ---- dispatch --------------------------------------------------------------

/** Run keel with argv; write to out/err; return the exit code. */
export async function main(argv, { cwd = process.cwd(), out = s => process.stdout.write(s), err = s => process.stderr.write(s) } = {}) {
  const json = argv.includes('--json');
  let root;
  const ctx = { cwd, json, root: () => (root ??= findRoot(cwd)) };
  try {
    let result;
    const [first, second] = argv;
    if (argv.includes('--agent-help')) result = await agentHelp(argv.filter(a => a !== '--agent-help'));
    else if (argv.includes('--version')) result = await version(argv.filter(a => a !== '--version'));
    else if (first === undefined || first === '--json' || first === '--help' || first === '-h') result = await verbs.get('help').run(argv.filter(a => a !== '--help' && a !== '-h'), ctx);
    else if (verbs.has(`${first} ${second}`)) result = await verbs.get(`${first} ${second}`).run(argv.slice(2), ctx);
    else if (verbs.has(first)) result = await verbs.get(first).run(argv.slice(1), ctx);
    else {
      const subs = [...verbs.keys()].filter(k => k.startsWith(`${first} `));
      throw new UsageError(subs.length ? `keel ${first} needs one of: ${subs.map(s => s.split(' ')[1]).join(', ')}`
        : `unknown verb "${first}"; run keel help`);
    }
    if (result.passthrough) { // a re-run of an updated keel already printed its own answer
      if (result.passthrough.stdout) out(result.passthrough.stdout);
      if (result.passthrough.stderr) err(result.passthrough.stderr);
      return result.exitCode ?? 0;
    }
    out(json ? `${JSON.stringify(result.data, null, 2)}\n` : `${result.text}\n`);
    return result.exitCode ?? 0;
  } catch (error) {
    const message = String(error?.message ?? error).split('\n')[0];
    if (json) out(`${JSON.stringify({ error: message })}\n`);
    else err(`keel: ${message}\n`);
    return error?.exitCode ?? 1;
  }
}

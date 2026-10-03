// The keel CLI: a registry of verbs, and the one dispatcher that runs them.
//
// A verb is { summary, usage, run(args, ctx) }. run returns { data, text }:
// data is printed as JSON under --json, text otherwise; the two never mix.
// A verb is announced in lib/agent-guide.md's cold start or it fails the
// surface test (tests/cli.test.mjs), which reads this registry, not a list.
//
// Exit codes: 0 ok, 1 the command ran and found a failure (render --check
// differs, doctor has findings, or an unexpected error), 2 usage or no project, 3 needs a yes (a ⚑
// step was planned and nothing was done).
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot } from './project.mjs';
import { render as renderPractices } from './practices.mjs';
import { init } from './init.mjs';
import { adopt } from './adopt.mjs';
import { doctor } from './doctor.mjs';
import { update } from './update.mjs';
import { release, WHATSNEW } from './release.mjs';
import { lessons } from './lessons.mjs';
// Roadmap logic has one home: the phases practice. The CLI uses its own copy,
// pointed at the project, never the project's scripts/.
import { collect, nextPhase, DONE } from '../practices/phases/files/scripts/roadmap.mjs';

export const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GUIDE = join(CLI_ROOT, 'lib', 'agent-guide.md');
export const COLD_START_LIMIT = 2500;

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
async function roadmapOf(ctx) {
  const root = await ctx.root();
  const config = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  const local = config.local ?? {};
  if (Object.hasOwn(local, 'phases') && !(config.practices ?? []).includes('phases')) {
    throw new UsageError(`phases is a local variant here: ${local.phases}; use the project's own roadmap (npm run roadmap)`);
  }
  return collect(root);
}

const phaseLine = p => `${p.id}. ${p.title} [${p.status}] — docs/phases/${p.file}`;

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
    usage: 'keel status [--json]',
    async run(args, ctx) {
      noExtra(args);
      const data = await roadmapOf(ctx);
      const goals = goalRows(data), next = nextPhase(data.phases);
      return {
        data: { name: data.config.name, goals, next },
        text: [`${data.config.name}`, ...goals.map(goalText), '',
          next ? `Next: ${phaseLine(next)}\n${next.next}` : 'Next: nothing left unbuilt.'].join('\n'),
      };
    },
  }],
  ['next', {
    summary: 'the next phase to conduct, its done-when and next action',
    usage: 'keel next [--json]',
    async run(args, ctx) {
      noExtra(args);
      const p = nextPhase((await roadmapOf(ctx)).phases);
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
    usage: 'keel init [dir] --description "<paragraph>" [--name <n>] [--tagline <t>] [--kind static|node|web|other] [--repo owner/name] [--github [--yes]] [--json]',
    async run(args, ctx) {
      const valued = ['--name', '--description', '--tagline', '--kind', '--repo'];
      const flags = ['--github', '--yes'];
      const positional = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
      if (positional.length > 1) throw new UsageError(`unexpected argument: ${positional[1]}`);
      noExtra(args.filter(a => a !== positional[0]), flags, valued);
      const [name, description, tagline, kind, repo] = valued.map(f => option(args, f));
      return init({
        dir: resolve(ctx.cwd, positional[0] ?? '.'), name, description, tagline, kind, repo,
        github: args.includes('--github'), yes: args.includes('--yes'),
      }, { version: versionInfo(), env: process.env });
    },
  }],
  ['adopt', {
    summary: 'bring an existing project under keel; on only what it already satisfies, the rest local',
    usage: 'keel adopt [dir] [--dry-run] [--check "<command>"] [--json]',
    async run(args, ctx) {
      const valued = ['--check'];
      const positional = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
      if (positional.length > 1) throw new UsageError(`unexpected argument: ${positional[1]}`);
      noExtra(args.filter(a => a !== positional[0]), ['--dry-run'], valued);
      return adopt({ dir: resolve(ctx.cwd, positional[0] ?? '.'), dryRun: args.includes('--dry-run'), check: option(args, '--check') },
        { version: versionInfo() });
    },
  }],
  ['doctor', {
    summary: 'what the project changed of the practice, and practice rules broken; changes nothing without --fix',
    usage: 'keel doctor [--fix <path> restore|eject [--yes]] [--json]',
    async run(args, ctx) {
      const i = args.indexOf('--fix');
      let fix;
      if (i >= 0) {
        fix = [args[i + 1], args[i + 2]];
        if (!fix[0] || fix[0].startsWith('--') || !['restore', 'eject'].includes(fix[1])) throw new UsageError('--fix needs <path> restore|eject');
        args = [...args.slice(0, i), ...args.slice(i + 3)];
      }
      noExtra(args, ['--yes']);
      return doctor({ root: await ctx.root(), fix, yes: args.includes('--yes') });
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
      return update({
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
      return lessons({ dir: ctx.cwd, dryRun: args.includes('--dry-run'), yes: args.includes('--yes'),
        to: option(args, '--to'), since: option(args, '--since') }, { cliRoot: CLI_ROOT, env: process.env });
    },
  }],
  ['release', {
    summary: 'keel only: cut a practice version — WHATSNEW entry, version bump, commit, local tag',
    usage: 'keel release [<x.y.z> --notes <file|->] [--dry-run] [--json]',
    async run(args, ctx) {
      const valued = ['--notes'];
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
      return release({ root: await ctx.root(), version: positional[0], notes, dryRun: args.includes('--dry-run') }, { env: process.env });
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
 * What the guide's cold start fails to announce: every registered verb and
 * top-level flag needs a line beginning "- `keel <name>". Returns the misses.
 */
export function surfaceGaps(names, guideText) {
  const { coldStart } = parseGuide(guideText);
  const lines = coldStart.split('\n');
  return names.filter(name => !lines.some(l => l.startsWith(`- \`keel ${name}`)
    && (l.length === `- \`keel ${name}`.length || /[\s`]/.test(l[`- \`keel ${name}`.length]))));
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

export function versionInfo() {
  const pkg = JSON.parse(readFileSync(join(CLI_ROOT, 'package.json'), 'utf8'));
  let commit = null, tag = null;
  try {
    const git = (...a) => execFileSync('git', ['-C', CLI_ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // Only the CLI's own checkout counts, not a repo it happens to sit inside.
    if (resolve(git('rev-parse', '--show-toplevel')) === resolve(CLI_ROOT)) {
      commit = git('rev-parse', '--short', 'HEAD');
      try { tag = git('tag', '--points-at', 'HEAD', '--list', 'v*').split('\n').filter(Boolean).pop() ?? null; } catch { tag = null; }
    }
  } catch { /* not a git checkout */ }
  // The practice version is the package version; keel release tags it v<version>.
  return { cli: pkg.version, commit, practice: pkg.version, tag };
}

function version(args) {
  noExtra(args);
  const v = versionInfo();
  return { data: v, text: `keel ${v.cli} (${v.commit ?? 'no git'}) practice ${v.practice}` };
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
    else if (argv.includes('--version')) result = version(argv.filter(a => a !== '--version'));
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

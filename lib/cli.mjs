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
      const data = await collect(await ctx.root());
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
      const p = nextPhase((await collect(await ctx.root())).phases);
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
      const goals = goalRows(await collect(await ctx.root()));
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
  let commit = null;
  try {
    const git = (...a) => execFileSync('git', ['-C', CLI_ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // Only the CLI's own checkout counts, not a repo it happens to sit inside.
    if (resolve(git('rev-parse', '--show-toplevel')) === resolve(CLI_ROOT)) commit = git('rev-parse', '--short', 'HEAD');
  } catch { /* not a git checkout */ }
  // The practice version is the package version until phase 6 makes it tags.
  return { cli: pkg.version, commit, practice: pkg.version };
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
    out(json ? `${JSON.stringify(result.data, null, 2)}\n` : `${result.text}\n`);
    return result.exitCode ?? 0;
  } catch (error) {
    const message = String(error?.message ?? error).split('\n')[0];
    if (json) out(`${JSON.stringify({ error: message })}\n`);
    else err(`keel: ${message}\n`);
    return error?.exitCode ?? 1;
  }
}

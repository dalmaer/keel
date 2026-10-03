// keel init: a new project, from an empty directory, ready to conduct the same
// day. Non-interactive: agents drive it, so everything comes from flags.
//
// Order matters. Validation and the GitHub plan come first and write nothing,
// so `--github` without `--yes` leaves the directory exactly as it found it and
// the same command with `--yes` can follow. Then: .keel/keel.json (the
// renderer's input), the project's own seeds (goal G0, phase 0), the practices'
// render, the AGENTS.md project section, the roadmap, and one commit.
//
// GitHub is reached only through gh (keel is private; gh carries the auth).
// The binary is process.env.KEEL_GH || 'gh', so tests can model it.
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { load, render, PRACTICES } from './practices.mjs';
import { run as roadmap } from '../practices/phases/files/scripts/roadmap.mjs';

export const KIND_HINTS = {
  static: 'Kind: static site. Plain files served as they are; no build step until one earns its place.',
  node: 'Kind: Node CLI or library. Zero runtime dependencies where it can, `node --test` for tests.',
  web: 'Kind: web app. The framework is a decision for phase 0, recorded under Deliberately open, not a default.',
  other: 'Kind: other. Say here, in a line, what shape this project takes.',
};
export const KINDS = Object.keys(KIND_HINTS);
export const PHASE0_TITLE = 'The practice room: the thinnest version that runs';

class InitError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

export const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** The description's first sentence, used as the tagline when none is given. */
export const firstSentence = text => {
  const flat = text.trim().replace(/\s+/g, ' ');
  return /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function gh(args, env) {
  const bin = env.KEEL_GH || 'gh';
  try {
    return execFileSync(bin, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const why = String(error.stderr || error.message).trim().split('\n')[0];
    throw new InitError(`${bin} ${args.join(' ')} failed: ${why}`, 1);
  }
}

const git = (dir, args, env) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Phase 0, from the phase template: same sections, honest generic content. */
export function phaseZero(template, { name, kind, since }) {
  const sections = {
    'Done when': `A person other than the author can run the thinnest version of ${name} from a fresh clone and see it do the first thing the project's description promises. (Drafted by keel init; replace it with the first thing a person could check.)`,
    Scope: `The smallest slice of ${name} that runs, and nothing past it. ${KIND_HINTS[kind]}`,
    Acceptance: [
      `- [ ] Someone follows only AGENTS.md from a fresh clone and sees ${name} run.`,
      '- [ ] `npm run check` stays green with the first test of real behaviour in it.',
    ].join('\n'),
    Proof: 'Automated: `npm run check`, once the first real test is in it.\nBy hand: named when Done when is — who runs what, and what they should see.',
    'Deliberately open': ['- What "runs" means for this project. Open because keel init cannot know it; settled when Done when names a thing a person can check.',
      ...(kind === 'web' ? ['- Which framework, if any. Settled by what the first slice needs, not by habit.'] : [])].join('\n'),
    'Next action': 'Replace this phase\'s Done when with the first thing a person could check, then /conduct.',
  };
  const front = `---\nstatus: planned\nsince: ${since}\ngoal: G0\ndepends: []\nnote: "Drafted by keel init from the description; Done when is still generic."\nevidence: []\n---\n`;
  let body = template.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/^# .+$/m, `# ${PHASE0_TITLE}`);
  for (const [section, text] of Object.entries(sections)) {
    const re = new RegExp(`(^## ${section}\\r?\\n)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm');
    if (!re.test(body)) throw new InitError(`docs/templates/phase.md has no ## ${section}`, 1);
    body = body.replace(re, (_, head) => `${head}\n${text}\n\n`);
  }
  return front + body.replace(/\n+$/, '\n');
}

/** Insert the project section (description, kind hint) after AGENTS.md's tagline. */
export function projectSection(agents, { name, tagline, description, kind }) {
  const section = `## What ${name} is\n\n${description.trim()}\n\n${KIND_HINTS[kind]}\n\n`;
  const at = agents.indexOf('```bash');
  if (at < 0) return `${agents.replace(/\n*$/, '\n\n')}${section}`;
  return agents.slice(0, at) + section + agents.slice(at);
}

/** Secrets the enabled practices' workflows declare: [{name, why, workflow, practice}]. */
export function secretsNeeded(practices, enabled) {
  return enabled.flatMap(n => (practices.get(n).secrets ?? []).map(s => ({ ...s, practice: n })));
}

/**
 * Initialise `opts.dir`. Returns { data, text, exitCode }.
 * opts: { dir, name, description, tagline?, kind?, repo?, github?, yes? }
 * deps: { version: {cli, commit, practice}, env }
 */
export async function init(opts, { version, env = process.env }) {
  const dir = resolve(opts.dir);
  const name = opts.name ?? basename(dir);
  if (!opts.description?.trim()) throw new InitError('--description "<one paragraph of what it is>" is required');
  const description = opts.description.trim().replace(/\s+/g, ' ');
  const tagline = opts.tagline?.trim() || firstSentence(description);
  const kind = opts.kind ?? 'other';
  if (!KINDS.includes(kind)) throw new InitError(`--kind must be one of ${KINDS.join(', ')}`);
  if (opts.repo !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(opts.repo)) throw new InitError('--repo must be owner/name');
  if (opts.yes && !opts.github) throw new InitError('--yes only answers --github');

  const info = await stat(dir).catch(() => null);
  if (info && !info.isDirectory()) throw new InitError(`${dir} is not a directory`);
  if (info) {
    if (await stat(join(dir, '.keel', 'keel.json')).catch(() => null)) throw new InitError(`${dir} is already a keel project — use keel update`);
    const present = (await readdir(dir)).filter(n => n !== '.git');
    if (present.length) throw new InitError(`${dir} is not empty (${present.slice(0, 3).join(', ')}${present.length > 3 ? ', …' : ''}) — use keel adopt`);
  }

  const practices = await load();
  const enabled = [...practices.keys()].filter(n => !practices.get(n).optional); // optional ones are the project's to switch on
  // Order the practices so each comes after what it requires, as keel's own config does.
  const order = ['base', 'agents-md', 'phases', 'evidence', 'lessons', 'conduct', 'ci', 'night', 'claude', 'renovate'];
  enabled.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));

  let repo = opts.repo;
  if (!repo && opts.github) repo = `${gh(['api', 'user', '-q', '.login'], env)}/${slug(name)}`;
  const secrets = secretsNeeded(practices, enabled);

  if (opts.github) {
    let set = [];
    if (secrets.length) {
      // A repo that does not exist yet has no secrets; that is an answer, not an error.
      try { set = gh(['secret', 'list', '--repo', repo], env).split('\n').map(l => l.split(/\s/)[0]).filter(Boolean); } catch { set = []; }
    }
    const steps = [
      { action: 'init', what: `write the practice into ${dir} and commit it on main` },
      { action: 'repo create', what: `gh repo create ${repo} --private --source ${dir} --push`, command: ['repo', 'create', repo, '--private', '--source', dir, '--push'] },
    ];
    const secretRows = secrets.map(s => ({ ...s, set: set.includes(s.name) }));
    const plan = { dir, name, repo, steps, secrets: secretRows };
    const secretText = secretRows.length
      ? secretRows.map(s => `  ${s.name} (${s.workflow}): ${s.why} — ${s.set ? 'set' : 'not set; keel never sets one'}`).join('\n')
      : '  none';
    if (!opts.yes) {
      return {
        data: { ok: false, needs: 'yes', plan },
        text: [`keel init --github needs a yes. It will:`, ...steps.map(s => `  - ${s.what}`),
          `Secrets needed:\n${secretText}`, `Nothing was created. Re-run with --yes to go ahead.`].join('\n'),
        exitCode: 3,
      };
    }
    const local = await initLocal({ dir, name, tagline, description, kind, repo, enabled, version, env });
    const created = gh(steps[1].command, env);
    return {
      data: { ok: true, ...local, github: { repo, created, secrets: secretRows } },
      text: [local.text, `Created ${repo} (private) and pushed main. ${created}`.trim(), `Secrets needed:\n${secretText}`].join('\n'),
    };
  }

  const local = await initLocal({ dir, name, tagline, description, kind, repo, enabled, version, env });
  return {
    data: { ok: true, ...local, secrets },
    text: [local.text, `Secrets needed: ${secrets.length ? [...new Set(secrets.map(s => s.name))].join(', ') : 'none'}`].join('\n'),
  };
}

async function initLocal({ dir, name, tagline, description, kind, repo, enabled, version, env }) {
  await mkdir(join(dir, '.keel'), { recursive: true });
  const config = { name, tagline, ...(repo ? { repo } : {}), kind, practice: version.practice, practices: enabled };
  await writeFile(join(dir, '.keel', 'keel.json'), `${JSON.stringify(config, null, 2)}\n`);

  // The project's own seeds, written before the render so the practices' seeds keep them.
  await mkdir(join(dir, 'docs', 'phases'), { recursive: true });
  const goals = [{ id: 'G0', title: tagline.replace(/[.!?]$/, ''), outcome: description }];
  await writeFile(join(dir, 'docs', 'goals.json'), `${JSON.stringify(goals, null, 2)}\n`);
  const template = await readFile(join(PRACTICES, 'phases', 'files', 'docs', 'templates', 'phase.md'), 'utf8');
  await writeFile(join(dir, 'docs', 'phases', '00-practice-room.md'), phaseZero(template, { name, kind, since: today() }));

  const rendered = await render(dir);
  const agentsPath = join(dir, 'AGENTS.md');
  await writeFile(agentsPath, projectSection(await readFile(agentsPath, 'utf8'), { name, tagline, description, kind }));
  await roadmap({ root: dir, mode: 'write' });

  if (!(await stat(join(dir, '.git')).catch(() => null))) git(dir, ['init', '-q', '-b', 'main'], env);
  const message = `keel init: ${name} on practice ${version.practice} (keel ${version.commit ?? 'no git'})`;
  git(dir, ['add', '-A'], env);
  try {
    git(dir, ['commit', '-q', '-m', message], env);
  } catch (error) {
    throw new InitError(`git commit failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`, 1);
  }
  const commit = git(dir, ['rev-parse', '--short', 'HEAD'], env);
  return {
    dir, config, commit, message,
    files: rendered.entries.filter(e => e.status === 'create' || e.status === 'update').map(e => e.block ? `${e.path}#${e.block}` : e.path),
    text: `Initialised ${name} in ${dir} on practice ${version.practice}; committed ${commit} "${message}".\nNext: cd ${dir} && keel next`,
  };
}

import { validateGuideTargets } from './practices.mjs';
import { guideDestination, guidePath, validateGuideName } from './guide.mjs';
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
import { posix, basename, join, resolve, dirname } from 'node:path';
import { load, render, fill, PRACTICES } from './practices.mjs';
import { detect as detectStack } from './stacks.mjs';
import { withLedger } from '../migrations/0004-test-ledger.mjs';
import { run as roadmap } from '../practices/phases/files/scripts/roadmap.mjs';

export const KIND_HINTS = {
  static: 'Kind: static site. Plain files served as they are; no build step until one earns its place.',
  node: 'Kind: Node CLI or library. Zero runtime dependencies where it can, `node --test` for tests.',
  web: 'Kind: web app. The framework is a decision for phase 0, recorded under Deliberately open, not a default.',
  other: 'Kind: other. Say here, in a line, what shape this project takes.',
};
export const KINDS = Object.keys(KIND_HINTS);
export const PHASE0_TITLE = 'The first thing that runs';
export const PHASE0_FILE = '00-first-thing-that-runs.md';
/** The line that says phase 0 is init's draft, not a design. */
export const DRAFT = 'Drafted by keel init. Replace this draft wholesale before building.';
/** How to run keel where it isn't installed: keel is public, so npx fetches it from GitHub. */
export const NPX = 'npx -y github:dalmaer/keel';

class InitError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

export const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** The description's first sentence, used as the tagline when none is given. */
export const firstSentence = text => {
  const flat = text.trim().replace(/\s+/g, ' ');
  return /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
};
/** Goal G0's title: the description's first sentence, without its stop, at most 80 characters, trimmed at a word. */
export const goalTitle = (description, max = 80) => {
  const s = firstSentence(description).replace(/[.!?]$/, '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${(cut.lastIndexOf(' ') > 0 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
};
/** An npm-safe package name from the project's name: lowercase, url-safe, at most 214 characters. */
export const npmName = name => slug(name).replace(/^[._]+/, '').slice(0, 214) || 'project';
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
    'Done when': `Following README.md's "How to run it" from a clean checkout of the committed tree runs the thinnest version of ${name}, and it does the first thing the project's description promises.`,
    Scope: `The smallest slice of ${name} that runs, and nothing past it. ${KIND_HINTS[kind]}`,
    Acceptance: [
      `- [ ] README.md's "How to run it", followed from a clean checkout of the committed tree, runs ${name}.`,
      '- [ ] `npm run check` stays green with the first test of real behaviour in it.',
    ].join('\n'),
    Proof: 'Automated: `npm run check`, once the first real test is in it.\nBy hand: named when Done when is — the commands from README.md\'s "How to run it", and what they should show, walked from a clean checkout of the committed tree after the phase\'s commit; its result goes into the evidence in the next commit. A walk by a person other than the author is lived-in\'s proof, not this phase\'s.',
    'Deliberately open': (kind === 'web' ? ['- Which framework, if any. Settled by what the first slice needs, not by habit.'] : ['Nothing yet.']).join('\n'),
    'Next action': 'Replace this draft\'s Done when, Acceptance and Proof with the first thing that runs, and move status to `designed`, in one commit of its own titled `phase 0: name what runs` (documents only: run `npm run roadmap:check`, not the whole gate); then /conduct.',
  };
  const front = `---\nstatus: planned\nsince: ${since}\ngoal: G0\ndepends: []\nnote: "Drafted by keel init from the description; Done when is still generic."\nevidence: []\n---\n`;
  // The optional Trajectory is the conductor's to write; a draft has none.
  // Nor Real surfaces: phase 0's front matter carries no spec, so nothing
  // holds it to one, and template text left there would fail the check. Nor
  // Your part: phase 0 owes no walk.
  let body = template.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/^## (Trajectory|Real surfaces|Your part)\r?\n[\s\S]*?(?=^## |$(?![\s\S]))/gm, '')
    .replace(/^# .+$/m, `# ${PHASE0_TITLE}\n\n${DRAFT}`);
  for (const [section, text] of Object.entries(sections)) {
    const re = new RegExp(`(^## ${section}\\r?\\n)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm');
    if (!re.test(body)) throw new InitError(`docs/templates/phase.md has no ## ${section}`, 1);
    body = body.replace(re, (_, head) => `${head}\n${text}\n\n`);
  }
  return front + body.replace(/\n+$/, '\n');
}

/**
 * Insert the project section (description, kind hint, how to run it) after
 * AGENTS.md's tagline. A tagline the description already opens with is
 * dropped, so the description is printed once.
 */
export function projectSection(agents, { name, tagline, description, kind, guide = 'AGENTS.md' }) {
  const section = `## What ${name} is\n\n${description.trim()}\n\n${KIND_HINTS[kind]}\n\nHow to run it: see [README.md](${posix.relative(posix.dirname(guide), 'README.md')}#how-to-run-it).\n\n`;
  if (tagline && description.trim().startsWith(tagline.trim())) agents = agents.replace(`\n\n${tagline.trim()}\n\n`, '\n\n');
  const at = agents.indexOf('```bash');
  if (at < 0) return `${agents.replace(/\n*$/, '\n\n')}${section}`;
  return agents.slice(0, at) + section + agents.slice(at);
}

/** The project's README: seeded once by init, the project's own from then on. */
export const readme = ({ name, description, kind }) => `# ${name}

${description}

## How to run it

${kind === 'node' ? `\`\`\`bash
node bin/${npmName(name)}.mjs …
\`\`\`

The default shape for a Node CLI; edit it to the real command with phase 0.
` : ''}Fill this in with phase 0: the commands that take a fresh clone to ${name}
doing the first thing it promises. \`npm run check\` is the gate.
`;

/** docs/evidence/README.md: where evidence goes, and how a phase names it. */
export const EVIDENCE_README = `# Evidence

What was actually checked, one file per claim. Start each from
[\`docs/templates/evidence.md\`](../templates/evidence.md) and name it
\`YYYY-MM-DD-<slug>.md\`.

A phase names its evidence in front matter by a path **relative to
\`docs/\`**: \`evidence: ["evidence/2026-01-31-first-run.md"]\`, not
\`docs/evidence/…\`. Built and lived-in need one. Never invent evidence.
`;

/** package.json with \`name\` first, keeping the seed's own formatting. */
export const withPackageName = (text, name) => text.includes('"name"') ? text : text.replace(/^\{\n/, `{\n  "name": ${JSON.stringify(name)},\n`);

/** Secrets the enabled practices' workflows declare: [{name, why, workflow, practice}]. */
export function secretsNeeded(practices, enabled) {
  return enabled.flatMap(n => (practices.get(n).secrets ?? []).map(s => ({ ...s, practice: n })));
}

/** The optional practices named with --with, validated: each must be a practice keel carries and optional. */
export function withOptional(practices, names = []) {
  const optional = [...practices.values()].filter(p => p.optional).map(p => p.name);
  for (const n of names) {
    if (!optional.includes(n)) throw new InitError(`--with ${n}: ${practices.has(n) ? `${n} is on by default` : `no practice named ${n}`}; --with takes ${optional.join(', ')}`);
  }
  return [...new Set(names)];
}

/**
 * Initialise `opts.dir`. Returns { data, text, exitCode }.
 * opts: { dir, name, description, tagline?, kind?, repo?, github?, yes?, with? ([optional practice names]) }
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

  if (opts.guide !== undefined) {
    validateGuideName(opts.guide);
    if (info) guideDestination(dir, opts.guide);
  }
  const practices = await load();
  validateGuideTargets({ guide: opts.guide }, practices);
  const asked = withOptional(practices, opts.with);
  // Optional ones (loop, claude) are the project's to switch on: only those named with --with.
  const enabled = [...practices.keys()].filter(n => !practices.get(n).optional || asked.includes(n));
  // Order the practices so each comes after what it requires, as keel's own config does.
  const order = ['base', 'agents-md', 'phases', 'evidence', 'lessons', 'conduct', 'ci', 'night', 'claude', 'renovate', 'loop'];
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
    const local = await initLocal({ dir, name, tagline, description, kind, repo, enabled, practices, version, env, guide: opts.guide });
    const created = gh(steps[1].command, env);
    return {
      data: { ok: true, ...local, github: { repo, created, secrets: secretRows } },
      text: [local.text, `Created ${repo} (private) and pushed main. ${created}`.trim(), `Secrets needed:\n${secretText}`].join('\n'),
    };
  }

  const local = await initLocal({ dir, name, tagline, description, kind, repo, enabled, practices, version, env, guide: opts.guide });
  return {
    data: { ok: true, ...local, secrets },
    text: [local.text, `Secrets needed: ${secrets.length ? [...new Set(secrets.map(s => s.name))].join(', ') : 'none'}`].join('\n'),
  };
}

/** The seeded AGENTS.md with markers for each enabled practice's block the seed lacks (loop's, under --with loop); null when it lacks none. */
export function seedAgents(practices, enabled, config) {
  const seed = practices.get('agents-md').files.find(f => f.kind === 'seeded' && f.path === 'AGENTS.md');
  const text = fill(seed.template, config, seed.path);
  const extra = enabled.flatMap(n => practices.get(n).files)
    .filter(f => f.kind === 'block' && f.path === 'AGENTS.md' && !text.includes(`<!-- keel:begin ${f.block} -->`))
    .map(f => `\n<!-- keel:begin ${f.block} -->\n<!-- keel:end ${f.block} -->\n`).join('');
  const after = '<!-- keel:end agents-md -->\n';
  if (!extra) return null;
  return text.includes(after) ? text.replace(after, after + extra) : text + extra;
}

async function initLocal({ dir, name, tagline, description, kind, repo, enabled, practices, version, env, guide }) {
  await mkdir(join(dir, '.keel'), { recursive: true });
  if (guide !== undefined) guideDestination(dir, guide);
  const config = { name, tagline, ...(guide !== undefined ? { guide } : {}), ...(repo ? { repo } : {}), kind, practice: version.practice, practices: enabled };
  validateGuideTargets(config, practices);
  await writeFile(join(dir, '.keel', 'keel.json'), `${JSON.stringify(config, null, 2)}\n`);

  // The project's own seeds, written before the render so the practices' seeds keep them.
  await mkdir(join(dir, 'docs', 'phases'), { recursive: true });
  const goals = [{ id: 'G0', title: goalTitle(description), outcome: description }];
  await writeFile(join(dir, 'docs', 'goals.json'), `${JSON.stringify(goals, null, 2)}\n`);
  const template = await readFile(join(PRACTICES, 'phases', 'files', 'docs', 'templates', 'phase.md'), 'utf8');
  await writeFile(join(dir, 'docs', 'phases', PHASE0_FILE), phaseZero(template, { name, kind, since: today() }));
  await mkdir(join(dir, 'docs', 'evidence'), { recursive: true });
  await writeFile(join(dir, 'docs', 'evidence', 'README.md'), EVIDENCE_README);
  await writeFile(join(dir, 'README.md'), readme({ name, description, kind }));

  // A block the seed has no markers for (loop's) gets them first; render keeps a seeded file it finds.
  const seeded = enabled.includes('agents-md') ? seedAgents(practices, enabled, config) : null;
  if (seeded !== null) {
    await mkdir(dirname(join(dir, guidePath(config))), { recursive: true });
    await writeFile(join(dir, guidePath(config)), seeded);
  }
  const rendered = await render(dir);
  // The stack the rendered files show (phase 30), recorded so docs/keel-lessons.md carries its lessons.
  const stack = (await detectStack(dir)).map(d => d.tag);
  if (stack.length) {
    config.stack = stack;
    await writeFile(join(dir, '.keel', 'keel.json'), `${JSON.stringify(config, null, 2)}\n`);
    await render(dir); // only docs/keel-lessons.md changes; the first render already listed it as created
  }
  const agentsPath = join(dir, guidePath(config));
  await writeFile(agentsPath, projectSection(await readFile(agentsPath, 'utf8'), { name, tagline, description, kind, guide: guidePath(config) }));
  if (kind === 'node' && enabled.includes('base')) {
    const pkg = join(dir, 'package.json');
    await writeFile(pkg, withPackageName(await readFile(pkg, 'utf8'), npmName(name)));
  }
  // The night's test ledger from the first run (migration 0004 brings it to older projects).
  if (enabled.includes('base') && enabled.includes('night')) {
    const pkg = join(dir, 'package.json');
    const text = await readFile(pkg, 'utf8');
    const script = JSON.parse(text).scripts?.test, ledger = withLedger(script);
    if (ledger) await writeFile(pkg, text.replace(JSON.stringify(script), JSON.stringify(ledger)));
  }
  await roadmap({ root: dir, mode: 'write' });

  if (!(await stat(join(dir, '.git')).catch(() => null))) git(dir, ['init', '-q', '-b', 'main'], env);
  const message = `keel init: ${name} on practice ${version.practice} (keel ${version.commit ?? version.cli})`;
  git(dir, ['add', '-A'], env);
  try {
    git(dir, ['commit', '-q', '-m', message], env);
  } catch (error) {
    throw new InitError(`git commit failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`, 1);
  }
  const commit = git(dir, ['rev-parse', '--short', 'HEAD'], env);
  return {
    dir, config, commit, message, npx: `${NPX} <verb>`,
    files: rendered.entries.filter(e => e.status === 'create' || e.status === 'update').map(e => e.block ? `${e.path}#${e.block}` : e.path),
    text: `Initialised ${name} in ${dir} on practice ${version.practice}; committed ${commit} "${message}".\nNext: cd ${dir} && keel next\nNo keel on PATH? Run it as ${NPX} <verb> (e.g. ${NPX} next).`,
  };
}

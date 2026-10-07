// The guides can't fall behind the CLI (lessons 16 and 18). docs/guide/ tells
// people what each verb is for; these tests read the guides against the live
// registry in lib/cli.mjs, the scripts the practices ship, and the night's
// measures, so a removed flag, an unregistered verb, a verb no guide names,
// a measure that no longer exists or a broken link fails here, not in a
// reader's terminal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { verbs, FLAGS, CLI_ROOT } from '../lib/cli.mjs';
import { MEASURES } from '../scripts/keel/improve.mjs';

const GUIDES = join(CLI_ROOT, 'docs', 'guide');
const README = join(CLI_ROOT, 'README.md');

async function guides() {
  const names = (await readdir(GUIDES)).filter(n => n.endsWith('.md')).sort();
  return Promise.all(names.map(async n => ({ path: join(GUIDES, n), name: `docs/guide/${n}`, text: await readFile(join(GUIDES, n), 'utf8') })));
}

/** Flags a verb knows: its usage line, and every '--flag' literal in its run(). */
function verbFlags(name) {
  const v = verbs.get(name);
  return new Set([...`${v.usage}\n${v.run.toString()}`.matchAll(/--[a-z][a-z-]*/g)].map(m => m[0]));
}

/**
 * Every command the registry answers to: each verb, each top-level flag, and
 * each subcommand its usage spells as `[sub …` or `| sub …` (learn propose,
 * loose-ends mark).
 */
export function surface() {
  const out = new Map();
  for (const [name, v] of verbs) {
    out.set(name, name);
    for (const m of v.usage.matchAll(/(?:\[|\| )([a-z][a-z-]*) /g)) out.set(`${name} ${m[1]}`, name);
  }
  for (const f of FLAGS) out.set(f.name, f.name);
  return out;
}

/** The scripts a guide may run, by their path in a project, with the flags their source knows. */
async function scripts() {
  const out = new Map();
  for (const p of await readdir(join(CLI_ROOT, 'practices'), { withFileTypes: true })) {
    if (!p.isDirectory()) continue;
    for (const dir of ['scripts/keel', 'scripts']) {
      const at = join(CLI_ROOT, 'practices', p.name, 'files', dir);
      const files = await readdir(at).catch(() => []);
      for (const f of files.filter(f => f.endsWith('.mjs'))) {
        const src = await readFile(join(at, f), 'utf8');
        out.set(`${dir}/${f}`, new Set([...src.matchAll(/--[a-z][a-z-]*/g)].map(m => m[0])));
      }
    }
  }
  return out;
}

/** Code a reader would run or type: inline code spans, and fenced block lines. */
export function codeOf(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) { out.push(line); continue; }
    for (const m of line.matchAll(/`([^`]+)`/g)) out.push(m[1]);
  }
  return out;
}

const SEPARATORS = new Set(['&&', '||', '|', ';', '#']);

/** Each `keel …` and `node scripts/….mjs …` command in a piece of code: its words up to a separator. */
export function commandsIn(code) {
  const words = code.trim().split(/\s+/);
  const out = [];
  words.forEach((w, i) => {
    const keel = w === 'keel' || /\/keel$/.test(w);
    const script = w === 'node' && /^scripts\/.+\.mjs$/.test(words[i + 1] ?? '');
    if (!keel && !script) return;
    const rest = [];
    for (const x of words.slice(i + 1)) { if (SEPARATORS.has(x)) break; rest.push(x); }
    out.push(keel ? { kind: 'keel', words: rest } : { kind: 'script', script: rest[0], words: rest.slice(1) });
  });
  return out;
}

const flagsOf = words => words.map(w => /^(--[a-z][a-z-]*)/.exec(w)?.[1]).filter(Boolean);

/** Which registered command a `keel` command's words name, or null when its first word isn't a verb's shape. */
function resolveVerb(words, known) {
  const [a, b] = words;
  if (a === undefined) return { verb: null };
  if (a.startsWith('--')) return { verb: known.has(a) ? a : null, unknown: known.has(a) ? null : a };
  if (!/^[a-z][a-z-]*$/.test(a)) return { verb: null };
  if (b && known.has(`${a} ${b}`)) return { verb: `${a} ${b}`, owner: known.get(`${a} ${b}`) };
  if (known.has(a)) return { verb: a, owner: known.get(a) };
  return { verb: null, unknown: a };
}

/** Every disagreement between the guides (and README links) and what keel registers and ships. */
export function guideGaps(docs, { known, flagsFor, scriptFlags, measures, exists }) {
  const gaps = [];
  const said = new Set();
  const universe = new Set(['--json']);
  for (const [, owner] of known) for (const f of flagsFor(owner)) universe.add(f);
  for (const set of scriptFlags.values()) for (const f of set) universe.add(f);

  for (const doc of docs) {
    for (const code of codeOf(doc.text)) {
      const commands = commandsIn(code);
      for (const c of commands) {
        if (c.kind === 'script') {
          const flags = scriptFlags.get(c.script);
          if (!flags) { gaps.push(`${doc.name}: runs a script no practice ships: ${c.script}`); continue; }
          for (const f of flagsOf(c.words)) if (f !== '--json' && !flags.has(f)) gaps.push(`${doc.name}: ${c.script} has no ${f}`);
          continue;
        }
        const { verb, owner, unknown } = resolveVerb(c.words, known);
        if (unknown) { gaps.push(`${doc.name}: names an unregistered verb: keel ${unknown}`); continue; }
        if (!verb) continue;
        said.add(verb);
        const allowed = flagsFor(owner ?? verb);
        for (const f of flagsOf(c.words.slice(verb.split(' ').length))) {
          if (f !== '--json' && !allowed.has(f)) gaps.push(`${doc.name}: keel ${verb} has no ${f}`);
        }
      }
      // A bare flag (`--with <practice>`) must be one keel or a shipped script knows.
      if (!commands.length) {
        const bare = /^(--[a-z][a-z-]*)/.exec(code.trim())?.[1];
        if (bare && !universe.has(bare)) gaps.push(`${doc.name}: names a flag nothing has: ${bare}`);
      }
      // A night measure named in code must be one the night takes.
      for (const id of code.match(/^[a-z]+(?:_[a-z]+)+$/) ?? []) {
        if (!measures.includes(id)) gaps.push(`${doc.name}: names a measure the night does not take: ${id}`);
      }
    }
  }
  for (const doc of docs) {
    for (const m of doc.text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const file = resolve(dirname(doc.path), decodeURI(target.split('#')[0]));
      if (!exists(file)) gaps.push(`${doc.name}: broken link: ${target}`);
    }
  }
  return { gaps, said };
}

/** The registered commands no guide names. */
export function unguided(said, known) {
  return [...known.keys()].filter(name => ![...said].some(s => s === name)).filter(name => {
    // A verb counts as named when any guide names it or one of its subcommands.
    return ![...said].some(s => s.startsWith(`${name} `));
  });
}

async function context() {
  return {
    known: surface(),
    flagsFor: name => (verbs.has(name) ? verbFlags(name) : new Set(FLAGS.find(f => f.name === name)?.usage.match(/--[a-z][a-z-]*/g) ?? [])),
    scriptFlags: await scripts(),
    measures: MEASURES.map(m => m.id),
    exists: existsSync,
  };
}

async function docsAndReadme() {
  return [...await guides(), { path: README, name: 'README.md', text: await readFile(README, 'utf8') }];
}

test('every guide command is a registered verb, with flags that verb knows', async () => {
  const ctx = await context();
  const { gaps } = guideGaps(await guides(), ctx);
  assert.deepEqual(gaps, []);
});

test('every registered verb and subcommand is explained in at least one guide', async () => {
  const ctx = await context();
  const { said } = guideGaps(await guides(), ctx);
  assert.deepEqual(unguided(said, ctx.known), []);
});

test('every relative link in docs/guide/ and README.md resolves', async () => {
  const ctx = await context();
  const { gaps } = guideGaps(await docsAndReadme(), ctx);
  assert.deepEqual(gaps.filter(g => g.includes('broken link')), []);
});

test('each kind of drift fails (mutations of the guide text, in memory)', async () => {
  const ctx = await context();
  const docs = await guides();
  const run = ds => guideGaps(ds, ctx);
  const base = run(docs);
  const added = ds => run(ds).gaps.filter(g => !base.gaps.includes(g));
  const swap = (from, to, name = 'docs/guide/start-a-project.md') => docs.map(d => d.name === name ? { ...d, text: d.text.replace(from, to) } : d);

  // A removed flag: init has no --frobnicate.
  const start = docs.find(d => d.name === 'docs/guide/start-a-project.md').text;
  assert.ok(start.includes('--kind node'));
  assert.deepEqual(added(swap('--kind node', '--frobnicate node')), ['docs/guide/start-a-project.md: keel init has no --frobnicate']);
  // A flag that belongs to another verb: --with is init's and adopt's, never update's.
  const fleet = 'docs/guide/keep-the-fleet-current.md';
  assert.deepEqual(added(swap('keel update --local', 'keel update --with', fleet)), [`${fleet}: keel update has no --with`]);
  // A bare flag nothing has.
  assert.deepEqual(added(swap('`--tagline <t>`', '`--slogan <t>`')), ['docs/guide/start-a-project.md: names a flag nothing has: --slogan']);
  // An unregistered verb.
  assert.deepEqual(added(swap('cd acme-notes && keel next', 'cd acme-notes && keel frobnicate')), ['docs/guide/start-a-project.md: names an unregistered verb: keel frobnicate']);
  // A script flag that isn't the script's.
  const climb = 'docs/guide/climb-and-tend.md';
  assert.deepEqual(added(swap('climb.mjs pick ', 'climb.mjs pick --everything ', climb)), [`${climb}: scripts/keel/climb.mjs has no --everything`]);
  // A measure the night doesn't take.
  const night = 'docs/guide/the-night-shift.md';
  assert.deepEqual(added(swap('`flaky_tests`', '`flakey_tests`', night)), [`${night}: names a measure the night does not take: flakey_tests`]);
  // A broken link.
  assert.deepEqual(added(swap('(the-night-shift.md)', '(the-night-watch.md)')), ['docs/guide/start-a-project.md: broken link: the-night-watch.md']);

  const before = unguided(base.said, ctx.known);
  const missing = (said, known = ctx.known) => unguided(said, known).filter(n => !before.includes(n));
  // A verb missing from every guide: drop every mention of keel retro.
  const noRetro = docs.map(d => ({ ...d, text: d.text.replaceAll('keel retro', 'keel status') }));
  assert.deepEqual(missing(run(noRetro).said), ['retro']);
  // A subcommand missing: no guide names keel loose-ends mark.
  const noMark = docs.map(d => ({ ...d, text: d.text.replaceAll('keel loose-ends mark', 'keel loose-ends') }));
  assert.deepEqual(missing(run(noMark).said), ['loose-ends mark']);
  // A newly registered verb with no guide.
  const more = new Map([...ctx.known, ['frobnicate', 'frobnicate']]);
  assert.deepEqual(missing(base.said, more), ['frobnicate']);
});

test('the surface reads subcommands from usage', () => {
  const known = surface();
  for (const name of ['learn propose', 'learn decide', 'learn render', 'learn distill', 'loose-ends mark', 'goal retire', '--agent-help']) {
    assert.ok(known.has(name), name);
  }
  assert.ok(!known.has('init dir'), 'an optional [dir] is not a subcommand');
});

// The night shift's rules, held on the workflow templates keel ships (and on
// keel's own rendered copies), read as text: no YAML dependency. Design §6:
// a bot writes a PR, never main; one queue per workflow, its own branch
// prefix; a merge only after a gate; a guard that fires into a room. Each rule
// is a function of the text, and each is mutation-checked below: a template
// that breaks it must fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../lib/practices.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each keel workflow's own branch prefix: the only refs it may push or drain. */
export const PREFIX = {
  'keel-night.yml': 'keel-night/',
  'keel-update.yml': 'keel/update-v',
  'keel-loop.yml': 'keel-loop/',
  'claude.yml': 'claude/',
  'check.yml': null,
};

const code = text => text.split('\n').map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => !/^\s*#/.test(line));

/** A five-field cron whose every field is in range. */
export function validCron(expr) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return fields.every((f, i) => f.split(',').every(part => {
    const m = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m || (m[4] !== undefined && Number(m[4]) < 1)) return false;
    if (m[1]) return true;
    const [lo, hi] = ranges[i];
    const a = Number(m[2]), b = m[3] === undefined ? a : Number(m[3]);
    return a >= lo && b <= hi && a <= b;
  }));
}

/**
 * Every rule broken by one workflow's text: [string]. `name` is its file name,
 * `declared` the secret names its practice declares for it.
 */
export function problems(name, text, declared = []) {
  const out = [];
  const lines = code(text);
  const prefix = PREFIX[name];
  if (!/^concurrency:\s*\n\s+group:\s*\S/m.test(text)) out.push('no concurrency group');
  for (const { line, n } of lines) {
    if (/\bgit push\b/.test(line)) {
      const ref = /(?:HEAD:)?refs\/heads\/(\S+?)["'\s]*$/.exec(line)?.[1] ?? /\bHEAD:(\S+?)["'\s]*$/.exec(line)?.[1];
      if (!ref) out.push(`line ${n}: git push names no explicit refs/heads/<branch>`);
      else if (!prefix || !ref.startsWith(prefix)) out.push(`line ${n}: git push to ${ref}, outside this workflow's prefix ${prefix}`);
      if (/\b(main|master)\b/.test(line)) out.push(`line ${n}: git push names main`);
    }
    if (/\bgit diff\b.*--(quiet|exit-code)/.test(line)) out.push(`line ${n}: git diff --quiet misses new files; test git status --porcelain`);
    if (/\bgh pr merge\b/.test(line)) out.push(`line ${n}: merges directly; merges go through keel drain, after a gate`);
    const drain = /(?:\bkeel|outputs\.cli \}\})\s+drain\s+(\S*\/\S*)/.exec(line);
    if (drain) {
      if (drain[1] !== prefix) out.push(`line ${n}: drains ${drain[1]}, not this workflow's prefix ${prefix}`);
      if (/--gate-passed/.test(line)) {
        const before = lines.filter(l => l.n < n && l.line.trim()).at(-1)?.line ?? '';
        if (!/^\s*if \[ "\$GATE" = ok \]; then\s*$/.test(before)) out.push(`line ${n}: --gate-passed outside an if on the gate`);
      }
    }
    for (const [, s] of line.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (s !== 'GITHUB_TOKEN' && !declared.includes(s)) out.push(`line ${n}: secrets.${s} is not declared in the practice's secrets`);
    }
    const cron = /^\s*-\s*cron:\s*["']?([^"']+)["']?\s*$/.exec(line);
    if (cron && !validCron(cron[1])) out.push(`line ${n}: invalid cron "${cron[1]}"`);
  }
  const body = lines.map(l => l.line).join('\n');
  if (/^\s*git commit\b/m.test(body) && !/git status --porcelain/.test(body)) out.push('commits without testing git status --porcelain');
  if (/--gate-passed/.test(text) && !/GATE: \$\{\{ steps\.(improve|gate)\.outputs\.gate \}\}/.test(text)) out.push('--gate-passed, but GATE is not the gate this run ran (keel improve\'s measure, or a gate step)');
  return out;
}

/** Every workflow keel ships: { practice, name, template, declared }. */
async function shipped() {
  const out = [];
  for (const p of (await load()).values()) for (const f of p.files) {
    if (!f.path.startsWith('.github/workflows/')) continue;
    out.push({ practice: p.name, optional: p.optional, path: f.path, name: f.path.split('/').pop(), template: f.template,
      declared: p.secrets.filter(s => s.workflow === f.path).map(s => s.name) });
  }
  return out;
}

test('every workflow keel ships keeps the night shift\'s rules, as a template and as rendered on keel', async () => {
  const all = await shipped();
  assert.deepEqual(all.map(w => w.name).sort(), ['check.yml', 'claude.yml', 'keel-loop.yml', 'keel-night.yml', 'keel-update.yml']);
  for (const w of all) {
    assert.ok(Object.hasOwn(PREFIX, w.name), `${w.name}: name its own branch prefix in PREFIX`);
    assert.deepEqual(problems(w.name, w.template, w.declared), [], `${w.practice} ${w.path}`);
    if (w.optional) continue; // keel does not switch on an optional practice, so has no rendered copy
    const rendered = await readFile(join(KEEL, w.path), 'utf8');
    assert.deepEqual(problems(w.name, rendered, w.declared), [], `keel's ${w.path}`);
  }
  for (const n of (await readdir(join(KEEL, '.github/workflows'))).filter(n => /\.ya?ml$/.test(n))) {
    assert.ok(all.some(w => w.name === n), `keel's ${n} is not shipped by a practice; it would escape this test`);
  }
});

test('the night workflow measures before it drains, pushes only its dated branch, and goes red on a broken instrument or gate', async () => {
  const night = (await shipped()).find(w => w.name === 'keel-night.yml').template;
  const at = s => { const i = night.indexOf(s); assert.ok(i >= 0, `missing: ${s}`); return i; };
  assert.ok(at('improve --report --json') < at('drain keel-night/'), 'improve runs before the drain, so machine_prs counts last night\'s PR');
  assert.ok(at('git status --porcelain') < at('git commit'));
  assert.match(night, /git push --force origin "HEAD:refs\/heads\/keel-night\/\$DAY"/);
  assert.match(night, /cancel-in-progress: false/);
  assert.match(night, /if: always\(\) && steps\.keel\.outputs\.cli != ''/, 'the verdict runs even after a failed step');
  assert.match(night, /if \[ "\$CODE" = 2 \] \|\| \[ -z "\$CODE" \]; then[\s\S]*?exit 1/, 'a broken instrument (or no reading) is red');
  assert.match(night, /if \[ "\$GATE" != ok \]; then[\s\S]*?exit 1/, 'a failing gate is red');
  assert.doesNotMatch(night.slice(at('if [ "$CODE" = 1 ]')), /exit 1/, 'outside a bound is news, not red');
  assert.match(night, /::notice::Skipped: add the KEEL_TOKEN secret/, 'no secret: a notice, not a red run');
  const update = (await shipped()).find(w => w.name === 'keel-update.yml').template;
  assert.doesNotMatch(update, /--gate-passed/, 'an update PR is never merged by machinery');
  assert.match(update, /update --yes/);
});

test('mutations: a workflow that breaks a rule fails', async () => {
  const w = (await shipped()).find(w => w.name === 'keel-night.yml');
  const night = w.template;
  const fails = (text, pattern, why) => {
    const found = problems('keel-night.yml', text, w.declared);
    assert.ok(found.some(p => pattern.test(p)), `${why}: expected a problem matching ${pattern}, got ${JSON.stringify(found)}`);
  };
  const push = 'git push --force origin "HEAD:refs/heads/keel-night/$DAY"';
  assert.ok(night.includes(push));
  fails(night.replace(push, 'git push origin main'), /names main|no explicit/, 'git push origin main');
  fails(night.replace(push, 'git push'), /no explicit/, 'a bare git push');
  fails(night.replace(push, 'git push origin HEAD:refs/heads/main'), /outside this workflow's prefix|names main/, 'a push to refs/heads/main');
  fails(night.replace(push, 'git push origin "HEAD:refs/heads/renovate/x"'), /outside this workflow's prefix/, 'another queue\'s branch');
  fails(night.replace('if [ -z "$(git status --porcelain)" ]; then', 'if git diff --quiet; then'), /porcelain/, 'git diff --quiet');
  fails(night.replace(/concurrency:\n\s+group: keel-night\n/, ''), /no concurrency group/, 'no concurrency');
  fails(night.replace('cron: "23 7 * * *"', 'cron: "23 7 * *"'), /invalid cron/, 'four fields');
  fails(night.replace('cron: "23 7 * * *"', 'cron: "61 7 * * *"'), /invalid cron/, 'minute 61');
  fails(night.replace('${{ secrets.KEEL_TOKEN }}', '${{ secrets.ACME_SECRET }}'), /ACME_SECRET is not declared/, 'an undeclared secret');
  fails(night.replace(/if \[ "\$GATE" = ok \]; then\n(\s+)(.*drain keel-night\/ --yes --gate-passed)/, '$1$2\n$1true'), /outside an if on the gate/, 'an unconditional --gate-passed');
  fails(night.replace('drain keel-night/ --yes --gate-passed', 'drain keel/ --yes --gate-passed'), /not this workflow's prefix/, 'draining another prefix');
  fails(`${night}\n      - run: gh pr merge 1 --squash\n`, /merges directly/, 'a direct merge');
  assert.deepEqual(problems('keel-night.yml', night, w.declared), [], 'the unmutated template is clean');
});

/** The PR-permission path: notice on GitHub's refusal, red on anything else. */
export function permissionPath(text) {
  const out = [];
  if (!/grep -qi 'not permitted to create or approve pull requests'/.test(text)) out.push('no match on GitHub\'s "not permitted to create or approve pull requests"');
  if (!/::notice::.*Settings → Actions → General → Workflow permissions → \\"Allow GitHub Actions to create and approve pull requests\\"/.test(text)) out.push('no notice naming the setting');
  if (!/else\n\s+exit "\$code"\n/.test(text)) out.push('any other failure must stay red');
  if (!/^permissions:\n\s+contents: write\n\s+pull-requests: write$/m.test(text)) out.push('must declare contents: write and pull-requests: write (the repo default may be read)');
  return out;
}

test('the night workflows: Actions not allowed to open PRs is a notice naming the setting; any other failure is red', async () => {
  for (const name of ['keel-night.yml', 'keel-update.yml']) {
    const w = (await shipped()).find(w => w.name === name);
    assert.deepEqual(permissionPath(w.template), [], name);
    assert.deepEqual(permissionPath(await readFile(join(KEEL, w.path), 'utf8')), [], `keel's ${name}`);
    const notice = w.template.split('\n').find(l => l.includes('::notice::') && l.includes('Workflow permissions'));
    assert.ok(permissionPath(w.template.replace(notice, '              echo ok')).length, `${name}: removing the notice fails`);
    assert.ok(permissionPath(w.template.replace(/grep -qi 'not permitted[^']*'/, "grep -qi 'x'")).length, `${name}: removing the match fails`);
    assert.ok(permissionPath(w.template.replace(/else\n(\s+)exit "\$code"\n/, 'else\n$1true\n')).length, `${name}: swallowing other failures fails`);
    assert.ok(permissionPath(w.template.replace('  pull-requests: write\n', '')).length, `${name}: dropping pull-requests: write fails`);
  }
});

test('validCron', () => {
  for (const ok of ['23 7 * * *', '41 7 * * 1', '*/15 * * * *', '0 0 1,15 * 0-6']) assert.ok(validCron(ok), ok);
  for (const bad of ['23 7 * *', '60 7 * * *', '0 24 * * *', '0 0 0 * *', 'a b c d e', '*/0 * * * *']) assert.ok(!validCron(bad), bad);
});

test('every secret a practice declares is used by the workflow it names', async () => {
  for (const p of (await load()).values()) for (const s of p.secrets) {
    const f = p.files.find(f => f.path === s.workflow);
    assert.ok(f, `${p.name}: ${s.name} names ${s.workflow}, which the practice does not ship`);
    assert.match(f.template, new RegExp(`secrets\\.${s.name}\\b`), `${p.name}: ${s.name} is declared for ${s.workflow} but unused there`);
  }
});

/**
 * Names the official stitch CLI (@google/stitch, from npm) never reads, in one
 * shipped file's text: [string]. It reads STITCH_API_KEY and STITCH_WORKSPACE;
 * a LOOP_* variable, or a secret holding an installer's URL, belonged to the
 * build before it, and a project told to set one is told wrong. LOOP_DOC_HEADER
 * is a constant in scripts/loop.mjs, not an environment variable.
 */
export function staleStitchNames(text) {
  const out = [];
  for (const [m] of text.matchAll(/\bLOOP_(?!DOC_HEADER\b)[A-Z][A-Z0-9_]*/g)) out.push(`${m}: the official CLI reads STITCH_* names`);
  if (/\bSTITCH_INSTALLER_URL\b/.test(text)) out.push('STITCH_INSTALLER_URL: the CLI comes from npm, never a URL');
  if (/\bSTITCH_BASE_URL\s*[:=]/.test(text)) out.push('STITCH_BASE_URL set: the official CLI uses its own default endpoint (a stored copy of an old fact)');
  return [...new Set(out)];
}

test('no shipped file names a LOOP_* variable or STITCH_INSTALLER_URL; the official CLI reads STITCH_*', async () => {
  for (const p of (await load()).values()) {
    for (const f of p.files.filter(f => f.template !== undefined)) assert.deepEqual(staleStitchNames(f.template), [], `${p.name} ${f.path}`); // a link has no text
    assert.deepEqual(staleStitchNames(JSON.stringify(p.secrets)), [], `${p.name} practice.json secrets`);
  }
  for (const f of ['lib/agent-guide.md', 'practices/loop/README.md']) assert.deepEqual(staleStitchNames(await readFile(join(KEEL, f), 'utf8')), [], f);
  // Mutations: each stale name is caught; the constant is not.
  const loop = (await shipped()).find(w => w.name === 'keel-loop.yml').template;
  assert.ok(staleStitchNames(loop.replace('secrets.STITCH_API_KEY', 'secrets.LOOP_API_KEY')).length, 'a LOOP_ secret');
  assert.ok(staleStitchNames(`${loop}\n      LOOP_WORKSPACE: acme\n`).length, 'a LOOP_ env');
  assert.ok(staleStitchNames("env.LOOP_INCLUDE_DISMISSED = '1'").length, 'a LOOP_ variable in a script');
  assert.ok(staleStitchNames(`${loop}\n      X: \${{ secrets.STITCH_INSTALLER_URL }}\n`).length, 'the installer URL secret');
  assert.ok(staleStitchNames(loop.replace('    steps:', '      STITCH_BASE_URL: https://jules.googleapis.com/v2alpha\n    steps:')).length, 'a base URL override in the workflow');
  assert.ok(staleStitchNames("const env = { ...process.env, STITCH_BASE_URL: 'https://x' };").length, 'a base URL override in a script');
  assert.deepEqual(staleStitchNames('export const LOOP_DOC_HEADER = 1;'), []);
});

// The night shift's rules, held on the workflow templates keel ships (and on
// keel's own rendered copies), read as text: no YAML dependency. Design §6:
// a bot writes a PR, never main; one queue per workflow, its own branch
// prefix; a merge only after a gate; a guard that fires into a room. Each rule
// is a function of the text, and each is mutation-checked below: a template
// that breaks it must fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, fill, PUSH_TRIGGERS, CROSS_REVIEW_WORKFLOW } from '../lib/practices.mjs';
import { run } from './helpers/run.mjs';
import { AGENTS } from '../practices/night/files/scripts/keel/lib.mjs';
import { runBlocks, inlineNode, shellProblems } from './helpers/workflows.mjs';

export { runBlocks, inlineNode, shellProblems };

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each keel workflow's own branch prefix: the only refs it may push or drain. */
export const PREFIX = {
  'keel-night.yml': 'keel-night/',
  'keel-loop.yml': 'keel-loop/',
  'keel-climb.yml': 'keel-climb/',
  'keel-tend.yml': 'keel-tend/',
  'keel-robot.yml': 'keel/robot-',
  'claude.yml': 'claude/',
  'keel-cross-review.yml': null,
  'check.yml': null,
  'keel-impact.yml': null,
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
    const drain = /(?:\bkeel|outputs\.cli \}\})\s+drain\s+(\S*\/\S*)/.exec(line) ?? /\bdrain\.mjs\s+(\S*\/\S*)/.exec(line);
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
  assert.deepEqual(all.map(w => w.name).sort(), ['check.yml', 'claude.yml', 'keel-climb.yml', 'keel-cross-review.yml', 'keel-impact.yml', 'keel-loop.yml', 'keel-night.yml', 'keel-robot.yml', 'keel-tend.yml']);
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
  assert.ok(at('node scripts/keel/improve.mjs --report --json') < at('node scripts/keel/drain.mjs keel-night/'), 'improve runs before the drain, so machine_prs counts last night\'s PR');
  assert.ok(at('git status --porcelain') < at('git commit'));
  assert.match(night, /git push --force origin "HEAD:refs\/heads\/keel-night\/\$DAY"/);
  assert.match(night, /cancel-in-progress: false/);
  assert.match(night, /- name: Verdict\n\s+if: always\(\)\n/, 'the verdict runs even after a failed step');
  assert.match(night, /if \[ "\$CODE" = 2 \] \|\| \[ -z "\$CODE" \]; then[\s\S]*?exit 1/, 'a broken instrument (or no reading) is red');
  assert.match(night, /if \[ "\$GATE" != ok \]; then[\s\S]*?exit 1/, 'a failing gate is red');
  assert.doesNotMatch(night.slice(at('if [ "$CODE" = 1 ]')), /exit 1/, 'outside a bound is news, not red');
  assert.doesNotMatch(night, /secrets\./, 'the night needs no secret: it runs the project\'s own scripts');
  assert.deepEqual(night.match(/secrets\[[^\]]*\]/g), ['secrets[steps.config.outputs.setup_token]'], 'its one secret is the project\'s own setupToken, by name');
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
  fails(night.replace('if [ "${#PATHS[@]}" = 0 ] || [ -z "$(git status --porcelain -- "${PATHS[@]}")" ]; then', 'if git diff --quiet; then'), /porcelain/, 'git diff --quiet');
  fails(night.replace(/concurrency:\n\s+group: keel-night\n/, ''), /no concurrency group/, 'no concurrency');
  fails(night.replace('cron: "23 7 * * *"', 'cron: "23 7 * *"'), /invalid cron/, 'four fields');
  fails(night.replace('cron: "23 7 * * *"', 'cron: "61 7 * * *"'), /invalid cron/, 'minute 61');
  fails(night.replace('    env:\n      GH_TOKEN: ${{ github.token }}\n', '    env:\n      GH_TOKEN: ${{ github.token }}\n      ACME: ${{ secrets.ACME_SECRET }}\n'), /ACME_SECRET is not declared/, 'an undeclared secret');
  fails(night.replace(/if \[ "\$GATE" = ok \]; then\n(\s+)(.*drain\.mjs keel-night\/ --yes --gate-passed)/, '$1$2\n$1true'), /outside an if on the gate/, 'an unconditional --gate-passed');
  fails(night.replace('drain.mjs keel-night/ --yes --gate-passed', 'drain.mjs keel/ --yes --gate-passed'), /not this workflow's prefix/, 'draining another prefix');
  fails(`${night}\n      - run: gh pr merge 1 --squash\n`, /merges directly/, 'a direct merge');
  assert.deepEqual(problems('keel-night.yml', night, w.declared), [], 'the unmutated template is clean');
});

/**
 * Every way a shipped workflow could reach back to keel at runtime (design §6,
 * "Projects run on their own"): keel's repo by name, a keel token, any clone,
 * or keel's CLI. The one exception is keel's own night gathering its inbox:
 * `node bin/keel.mjs learn` in a step guarded on `steps.self.outputs.self`,
 * set by a step that reads `"keel": "self"` from .keel/keel.json.
 */
export function reachesBack(text) {
  const out = [];
  const lines = text.split('\n');
  const steps = [];
  lines.forEach((line, i) => {
    if (/^\s+- (name|uses|id|run):/.test(line) && /^\s{6}- /.test(line)) steps.push({ start: i, lines: [] });
    steps.at(-1)?.lines.push(line);
  });
  const stepOf = i => steps.filter(s => s.start <= i).at(-1);
  const selfStep = steps.find(s => s.lines.some(l => /^\s+id: self\s*$/.test(l)) && s.lines.some(l => /\.keel === 'self'/.test(l)));
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/dalmaer\/keel\b/.test(line)) out.push(`line ${n}: names keel's repo`);
    if (/\bKEEL_TOKEN\b/.test(line)) out.push(`line ${n}: a keel token`);
    if (/\bgh repo clone\b/.test(line)) out.push(`line ${n}: gh repo clone`);
    if (/\bgit clone\b/.test(line)) out.push(`line ${n}: git clone`);
    if (/\bkeel\.mjs\b/.test(line)) {
      const step = stepOf(i);
      const guarded = selfStep && step && step !== selfStep && step.lines.some(l => /^\s+if: steps\.self\.outputs\.self == 'true'\s*$/.test(l));
      if (!guarded || !/\bnode bin\/keel\.mjs learn\b/.test(line)) out.push(`line ${n}: keel's CLI outside keel's own learn step`);
    }
  });
  return out;
}

test('no shipped workflow reaches back to keel: no keel repo, no keel token, no clone, no keel CLI (keel\'s own learn aside)', async () => {
  for (const w of await shipped()) {
    assert.deepEqual(reachesBack(w.template), [], `${w.practice} ${w.path}`);
    if (!w.optional) assert.deepEqual(reachesBack(await readFile(join(KEEL, w.path), 'utf8')), [], `keel's ${w.path}`);
  }
  for (const p of (await load()).values()) assert.ok(!p.secrets.some(s => s.name === 'KEEL_TOKEN'), `${p.name} declares KEEL_TOKEN`);
  // Mutations: each way back is caught.
  const night = (await shipped()).find(w => w.name === 'keel-night.yml').template;
  const loop = (await shipped()).find(w => w.name === 'keel-loop.yml').template;
  const learn = 'run: node bin/keel.mjs learn';
  assert.ok(night.includes(learn));
  const add = (text, step) => text.replace('      - name: Measure\n', `${step}      - name: Measure\n`);
  for (const [why, text] of [
    ['a clone of keel', add(night, '      - run: gh repo clone dalmaer/keel "$RUNNER_TEMP/keel" -- --quiet\n')],
    ['a git clone', add(night, '      - run: git clone https://github.com/acme/tools tools\n')],
    ['a keel token', add(night, '      - env:\n          T: ${{ secrets.KEEL_TOKEN }}\n        run: echo\n')],
    ['keel\'s repo in a comment', `# fetched from dalmaer/keel\n${night}`],
    ['keel\'s CLI for the measure', night.replace('node scripts/keel/improve.mjs --report --json', 'node $RUNNER_TEMP/keel/bin/keel.mjs improve --report --json')],
    ['learn without its guard', night.replace("        if: steps.self.outputs.self == 'true'\n", '')],
    ['the guard without its self check', night.replace(".keel === 'self'", ".keel === 'acme'")],
    ['keel\'s CLI in the loop drain', loop.replace('node scripts/keel/drain.mjs keel-loop/ --yes --gate-passed', 'node bin/keel.mjs drain keel-loop/ --yes --gate-passed')],
  ]) assert.ok(reachesBack(text).length, `${why}: expected a problem`);
});

/** A workflow's jobs, by their two-space keys under jobs:: [{ id, text }]. */
export function jobsOf(text) {
  const at = text.search(/^jobs:\n/m);
  if (at < 0) return [];
  return text.slice(at + 'jobs:\n'.length).split(/\n(?= {2}[A-Za-z_][\w-]*:\n)/).map(t => ({ id: /^ {2}([A-Za-z_][\w-]*):/m.exec(t)?.[1] ?? null, text: t })).filter(j => j.id);
}

/** The PR-permission path: notice on GitHub's refusal, red on anything else. */
export function permissionPath(text) {
  const out = [];
  if (!/grep -qi 'not permitted to create or approve pull requests'/.test(text)) out.push('no match on GitHub\'s "not permitted to create or approve pull requests"');
  if (!/::notice::.*Settings → Actions → General → Workflow permissions → \\"Allow GitHub Actions to create and approve pull requests\\"/.test(text)) out.push('no notice naming the setting');
  if (!/else\n\s+exit "\$code"\n/.test(text)) out.push('any other failure must stay red');
  // At the top, or (climb, tend: the agent's job may not hold them) on the one job that opens the PR.
  const opener = jobsOf(text).find(j => /\bgh pr create\b/.test(j.text));
  if (!/^permissions:\n\s+contents: write\n\s+pull-requests: write$/m.test(text) && !/\n {4}permissions:\n {6}contents: write\n {6}pull-requests: write\n/.test(opener?.text ?? '')) out.push('must declare contents: write and pull-requests: write (the repo default may be read)');
  return out;
}

test('the night workflows: Actions not allowed to open PRs is a notice naming the setting; any other failure is red', async () => {
  for (const name of ['keel-night.yml', 'keel-climb.yml', 'keel-tend.yml']) {
    const w = (await shipped()).find(w => w.name === name);
    assert.deepEqual(permissionPath(w.template), [], name);
    if (!w.optional) assert.deepEqual(permissionPath(await readFile(join(KEEL, w.path), 'utf8')), [], `keel's ${name}`);
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

/**
 * The night's install, read from .keel/keel.json at run time: `setup` when it
 * has one, else npm ci with a lockfile; `env` exported to later steps. [string].
 */
export function installProblems(text) {
  const out = [];
  const at = s => text.indexOf(s);
  if (!/readFileSync\("\.keel\/keel\.json"/.test(text)) out.push('the config is not read at run time');
  if (!/GITHUB_OUTPUT, `setup<<\$\{eof\}\\n\$\{c\.setup \?\? ""\}/.test(text)) out.push('setup is not read from .keel/keel.json');
  if (!/appendFileSync\(process\.env\.GITHUB_ENV/.test(text)) out.push('env is not exported to the later steps');
  if (!/SETUP: \$\{\{ steps\.config\.outputs\.setup \}\}\n/.test(text)) out.push('Install does not take setup from the config step');
  if (!/if \[ -n "\$SETUP" \]; then\n[^\n]*\n\s+bash -e -c "\$SETUP"\n\s+elif \[ -f package-lock\.json \]; then\n\s+npm ci\n\s+fi\n/.test(text)) out.push('no setup-else-npm-ci default');
  if (/run:[^\n]*\$\{\{ steps\.config\.outputs\.setup/.test(text) || /^\s+[^#\n]*\$\{\{ steps\.config\.outputs\.setup \}\}[^\n]*;/m.test(text)) out.push('setup is spliced into a script; pass it through env');
  if (!(at('- name: Read the config') >= 0 && at('- name: Read the config') < at('- name: Install'))) out.push('the config is read after the install');
  const measure = at('node scripts/keel/improve.mjs');
  if (measure >= 0 && !(at('- name: Install') < measure)) out.push('the install runs after the measure');
  return out;
}

test('keel-night, keel-loop, keel-climb and keel-tend install with the config\'s setup, else npm ci, and export its env', async () => {
  const all = await shipped();
  for (const name of ['keel-night.yml', 'keel-loop.yml', 'keel-climb.yml', 'keel-tend.yml']) {
    const w = all.find(w => w.name === name);
    assert.deepEqual(installProblems(w.template), [], name);
    if (!w.optional) assert.deepEqual(installProblems(await readFile(join(KEEL, w.path), 'utf8')), [], `keel's ${w.path}`);
  }
  // Mutations: each way the install goes wrong is caught.
  const night = all.find(w => w.name === 'keel-night.yml').template;
  for (const [why, text] of [
    ['the old fixed install', night.replace(/      - name: Read the config[\s\S]*?          fi\n/, '      - name: Install\n        run: if [ -f package-lock.json ]; then npm ci; fi\n')],
    ['no default', night.replace(/\n\s+elif \[ -f package-lock\.json \]; then\n\s+npm ci/, '')],
    ['setup ignored', night.replace('bash -e -c "$SETUP"', 'true')],
    ['env not exported', night.replace('fs.appendFileSync(process.env.GITHUB_ENV', 'console.log(')],
    ['setup spliced into the script', night.replace('bash -e -c "$SETUP"', 'bash -e -c "${{ steps.config.outputs.setup }}";')],
    ['the install after the measure', night.replace(/(      - name: Install\n[\s\S]*?          fi\n)([\s\S]*?)(      # Porcelain)/, '$2$1$3')],
  ]) assert.ok(installProblems(text).length, `${why}: expected a problem`);
});

/**
 * The config's setupToken (a secret's NAME) reaches the Install step's env as
 * GH_TOKEN and nothing else: not the job, not another step, never printed,
 * never exported to later steps. [string].
 */
export function setupTokenProblems(text) {
  const out = [];
  const lines = text.split('\n');
  const steps = [];
  let current = null;
  lines.forEach((line, i) => {
    if (/^\s{6}- /.test(line)) steps.push(current = { start: i, lines: [] });
    else if (/^\s{0,5}\S/.test(line)) current = null; // the job's own keys, or another job
    current?.lines.push(line);
  });
  // A workflow of several jobs (climb, tend: the agent's and the judge's) installs in each: every Install step is held to it.
  const installs = steps.filter(s => /^\s+- name: Install\s*$/.test(s.lines[0]));
  const configs = steps.filter(s => s.lines.some(l => /^\s+id: config\s*$/.test(l)));
  const expr = 'GH_TOKEN: ${{ secrets[steps.config.outputs.setup_token] || github.token }}';
  if (!configs.length || configs.some(config => !/fs\.appendFileSync\(process\.env\.GITHUB_OUTPUT, `setup_token=\$\{tok \?\? ""\}\\n`\)/.test(config.lines.join('\n')))) out.push('the config step does not output setup_token');
  if (configs.some(config => !/!\/\^\[A-Z_\]\[A-Z0-9_\]\*\$\/\.test\(tok\)/.test(config.lines.join('\n')))) out.push('the config step does not check setupToken is a secret name');
  if (!installs.length) return [...out, 'no Install step'];
  for (const install of installs) {
    const own = install.lines.filter(l => !/^\s*#/.test(l));
    const envAt = own.findIndex(l => /^\s{8}env:\s*$/.test(l));
    const runAt = own.findIndex(l => /^\s{8}run:/.test(l));
    const inEnv = envAt >= 0 && own.slice(envAt + 1, runAt < envAt ? undefined : runAt).some(l => l.trim() === expr);
    if (!inEnv) out.push('the Install step\'s env does not set GH_TOKEN from the setupToken secret (with the job token as fallback)');
    if (/GITHUB_ENV|GITHUB_OUTPUT|GITHUB_STATE/.test(own.join('\n'))) out.push('the Install step writes to GITHUB_ENV/OUTPUT: the token could reach later steps');
  }
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const n = i + 1;
    const mine = installs.some(install => i >= install.start && i < install.start + install.lines.length);
    if (/secrets\[/.test(line) && !(mine && line.trim() === expr)) out.push(`line ${n}: secrets[…] outside the Install step's GH_TOKEN`);
    if (/outputs\.setup_token/.test(line) && !(mine && line.trim() === expr)) out.push(`line ${n}: setup_token used outside the Install step's GH_TOKEN`);
    if (/\$\{?GH_TOKEN\b|env\.GH_TOKEN/.test(line)) out.push(`line ${n}: GH_TOKEN is read or printed`);
  });
  return out;
}

test('the setupToken secret reaches only the Install step, as GH_TOKEN, and is never printed', async () => {
  const all = await shipped();
  for (const name of ['keel-night.yml', 'keel-loop.yml', 'keel-climb.yml', 'keel-tend.yml']) {
    const w = all.find(w => w.name === name);
    assert.deepEqual(setupTokenProblems(w.template), [], name);
    if (!w.optional) assert.deepEqual(setupTokenProblems(await readFile(join(KEEL, w.path), 'utf8')), [], `keel's ${w.path}`);
  }
  // Mutations: each way the token leaks or goes missing is caught.
  const expr = '          GH_TOKEN: ${{ secrets[steps.config.outputs.setup_token] || github.token }}\n';
  for (const name of ['keel-night.yml', 'keel-loop.yml']) {
    const t = all.find(w => w.name === name).template;
    assert.ok(t.includes(expr), name);
    for (const [why, text] of [
      ['no token for setup', t.replace(expr, '')],
      ['no fallback to the job token', t.replace(' || github.token }}', ' }}')],
      ['at job level', t.replace(expr, '').replace('    env:\n      GH_TOKEN: ${{ github.token }}\n', '    env:\n      GH_TOKEN: ${{ secrets[steps.config.outputs.setup_token] || github.token }}\n')],
      ['also in another step', t.replace(/(      - name: (?:Validation verdict|Verdict)\n(?:        id:[^\n]*\n)?(?:        if:[^\n]*\n)?)/, `$1        env:\n${expr}`)],
      ['echoed', t.replace('bash -e -c "$SETUP"', 'echo "$GH_TOKEN"\n            bash -e -c "$SETUP"')],
      ['exported to later steps', t.replace('bash -e -c "$SETUP"', 'bash -e -c "$SETUP"\n            echo "GH_TOKEN=x" >> "$GITHUB_ENV"')],
      ['the name never output', t.replace(/fs\.appendFileSync\(process\.env\.GITHUB_OUTPUT, `setup_token=[^\n]*\n/, '')],
      ['the name never checked', t.replace('!/^[A-Z_][A-Z0-9_]*$/.test(tok)', 'false')],
    ]) {
      assert.notEqual(text, t, `${name} ${why}: the mutation did not apply`);
      assert.ok(setupTokenProblems(text).length, `${name} ${why}: expected a problem`);
    }
  }
});

test('every run: block in every workflow parses as bash, and every inline node -e \'…\' parses as JS', async () => {
  const files = [];
  for (const p of await readdir(join(KEEL, 'practices'))) {
    const d = join(KEEL, 'practices', p, 'files/.github/workflows');
    let names = [];
    try { names = await readdir(d); } catch { continue; }
    for (const n of names.filter(n => /\.ya?ml$/.test(n))) files.push(join('practices', p, 'files/.github/workflows', n));
  }
  for (const n of (await readdir(join(KEEL, '.github/workflows'))).filter(n => /\.ya?ml$/.test(n))) files.push(join('.github/workflows', n));
  assert.ok(files.length >= 7, `found ${files.length} workflows`);
  let blocks = 0, nodes = 0;
  for (const f of files) {
    const text = await readFile(join(KEEL, f), 'utf8');
    const bs = runBlocks(text);
    blocks += bs.length;
    nodes += bs.reduce((a, b) => a + inlineNode(b.script).length, 0);
    assert.deepEqual(await shellProblems(f, text), [], f);
  }
  assert.ok(blocks >= 30 && nodes >= 4, `read ${blocks} run blocks and ${nodes} inline node scripts: the extractor found too few`);

  // Mutations: the shapes that broke on GitHub, and a JS slip, are caught.
  const night = await readFile(join(KEEL, 'practices/night/files/.github/workflows/keel-night.yml'), 'utf8');
  const comment = '// Only the secret NAME, never its value: the Install step looks it up.';
  assert.ok(night.includes(comment));
  const apostrophe = await shellProblems('night', night.replace(comment, "// Only the secret's NAME, never its value."));
  assert.ok(apostrophe.some(p => /step "Read the config"/.test(p)), `an apostrophe in node -e: ${JSON.stringify(apostrophe)}`);
  const js = await shellProblems('night', night.replace('const tok = c.setupToken;', 'const tok = c.setupToken +;'));
  assert.ok(js.some(p => /step "Read the config".*node -e: .*SyntaxError/.test(p)), `broken JS in node -e: ${JSON.stringify(js)}`);
  const sh = await shellProblems('night', night.replace('elif [ -f package-lock.json ]; then', 'elif [ -f package-lock.json ]'));
  assert.ok(sh.some(p => /step "Install".*bash -n/.test(p)), `broken bash: ${JSON.stringify(sh)}`);
  const one = await shellProblems('loop', 'jobs:\n  x:\n    steps:\n      - name: One line\n        run: if true; then echo\n');
  assert.ok(one.some(p => /step "One line".*bash -n/.test(p)), `a one-line run: ${JSON.stringify(one)}`);
});

/**
 * Run the night's "Where the health page goes" and "Open the night's pull
 * request" steps, as the workflow has them, in a synthetic Acme repo with a
 * bare origin and a stub gh. Returns { dir, files: the paths the pushed
 * branch's commit carries, out }.
 */
async function nightCommit(t, night, { health, ignore = '', tracked = {}, before = async () => {}, after = async () => {} }) {
  const steps = runBlocks(night);
  const where = steps.find(b => b.step === 'Where the health page goes');
  const open = steps.find(b => b.step === "Open the night's pull request");
  assert.ok(where && open, 'both steps are in the workflow');
  const base = await mkdtemp(join(tmpdir(), 'keel-wf-night-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'acme'), origin = join(base, 'origin.git'), bin = join(base, 'bin'), temp = join(base, 'tmp');
  const git = (args, cwd = dir) => { const r = run('git', args, { cwd }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout; };
  for (const d of [dir, bin, temp, join(dir, 'scripts/keel'), join(dir, '.keel')]) await mkdir(d, { recursive: true });
  git(['init', '-q', '--bare', origin], base);
  git(['init', '-q', '-b', 'main']);
  for (const f of ['lib.mjs', 'pr-body.mjs']) await writeFile(join(dir, 'scripts/keel', f), await readFile(join(KEEL, 'practices/night/files/scripts/keel', f), 'utf8'));
  await writeFile(join(dir, '.keel/keel.json'), `${JSON.stringify({ name: 'Acme', ...(health ? { health } : {}) })}\n`);
  await writeFile(join(dir, '.gitignore'), ignore);
  for (const [f, text] of Object.entries(tracked)) { await mkdir(dirname(join(dir, f)), { recursive: true }); await writeFile(join(dir, f), text); }
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'acme']);
  git(['remote', 'add', 'origin', origin]);
  await before(dir, base);
  // gh keeps the body it is handed (--body-file), for the reader's check.
  await writeFile(join(bin, 'gh'), `#!/bin/sh\nif [ "$1 $2" = "pr list" ]; then exit 0; fi\nwhile [ $# -gt 0 ]; do if [ "$1" = --body-file ]; then cp "$2" "${join(base, 'body.md')}"; fi; shift; done\necho https://github.test/acme/acme/pull/1\n`, { mode: 0o755 });
  // The night's writes: a page where the config says, the bounds, and something that is not data.
  const out = join(temp, 'out');
  await writeFile(out, '');
  const env = { ...process.env, GITHUB_OUTPUT: out, RUNNER_TEMP: temp, PATH: `${bin}:${process.env.PATH}` };
  const w = run('bash', ['-e', '-c', where.script], { cwd: dir, env });
  if (w.status !== 0) return { where: w.status, out: w.stdout + w.stderr, files: null };
  const page = /^dir=(.*)$/m.exec(await readFile(out, 'utf8'))?.[1];
  await mkdir(join(dir, health ?? 'docs/health'), { recursive: true });
  await writeFile(join(dir, health ?? 'docs/health', '2026-10-05.md'), '# Health — 2026-10-05\n');
  await writeFile(join(dir, '.keel/bounds.json'), '{}\n');
  await writeFile(join(dir, 'acme-scratch.txt'), 'setup left this\n');
  await after(dir);
  // improve's --pr-input, as improve writes it (nightPr), for a night with a measure outside.
  const { nightPr } = await import('../practices/night/files/scripts/keel/improve.mjs');
  await writeFile(join(temp, 'pr.json'), JSON.stringify(nightPr({ date: '2026-10-05', report: `${page}/2026-10-05.md`, proposal: { id: 'prs_stale', state: 'outside', text: 'Close or merge the Acme PRs.' },
    results: [{ id: 'gate', state: 'ok', detail: 'npm test passed, 12 tests', bound: 0, better: 'lower', value: 0 }, { id: 'prs_stale', state: 'outside', detail: '2 stale', bound: 0, better: 'lower', value: 2 }] })));
  const o = run('bash', ['-e', '-c', open.script], { cwd: dir, env: { ...env, DAY: '2026-10-05', BASE: 'main', HEALTH: page ?? '' } });
  const pushed = run('git', ['--git-dir', origin, 'show', '--name-only', '--format=', 'refs/heads/keel-night/2026-10-05']);
  const body = await readFile(join(base, 'body.md'), 'utf8').catch(() => null);
  const show = run('git', ['--git-dir', origin, 'show', '--name-status', '--format=', 'refs/heads/keel-night/2026-10-05']);
  return { page, where: 0, status: o.status, out: o.stdout + o.stderr, body, files: pushed.status === 0 ? pushed.stdout.trim().split('\n').filter(Boolean).sort() : null,
    changes: show.status === 0 ? show.stdout.trim().split('\n').filter(Boolean).sort() : null };
}

test('the night commits its page from the configured health dir (read at run time), only data, and goes red on an ignored one', async t => {
  const night = await readFile(join(KEEL, 'practices/night/files/.github/workflows/keel-night.yml'), 'utf8');
  // ledger's shape: docs/health/ ignored, health in .keel/health.
  const own = await nightCommit(t, night, { health: '.keel/health', ignore: '/docs/health/\n' });
  assert.equal(own.page, '.keel/health');
  assert.equal(own.status, 0, own.out);
  assert.deepEqual(own.files, ['.keel/bounds.json', '.keel/health/2026-10-05.md'], 'the page and the bounds; never what is not data');
  // The body is pr-body.mjs's: the commit's files as the picture, the gate and what is outside, a two-way door over data.
  const at = ['## Summary', '## Evidence', '## Merge danger'].map(h => own.body?.indexOf(`${h}\n`) ?? -1);
  assert.ok(at[0] === 0 && at[0] < at[1] && at[1] < at[2], own.body);
  assert.match(own.body, /```text\n└── \.keel\/\n    ├── health\/\n    │   └── 2026-10-05\.md\n    └── bounds\.json\n```/);
  assert.match(own.body, /^Gate: ok: npm test passed, 12 tests/m);
  assert.match(own.body, /^\| prs_stale \(outside\) \| ≤0 \| 2 \|$/m);
  assert.match(own.body, /^Two-way door: data only/m);
  assert.match(own.body, /^Blast radius: this repo's data files only\.$/m);
  assert.match(own.body, /\*\*Proposal \(`prs_stale`, outside\):\*\* Close or merge the Acme PRs\./);
  assert.ok(own.body.trimEnd().endsWith('```') && own.body.indexOf('```keel-impact') > at[2], 'the keel-impact block is last');
  // No body is built in inline JS: the open step calls pr-body.mjs, and no node -e writes body.md.
  const blocks = runBlocks(night);
  assert.match(blocks.find(b => b.step === "Open the night's pull request").script, /node scripts\/keel\/pr-body\.mjs --input "\$RUNNER_TEMP\/pr\.json" --files [^\n]*> "\$RUNNER_TEMP\/body\.md"/);
  assert.match(blocks.find(b => b.step === 'Measure').script, /improve\.mjs --report --json --pr-input "\$RUNNER_TEMP\/pr\.json"/);
  for (const b of blocks) for (const n of inlineNode(b.script)) assert.doesNotMatch(n.js, /body|Proposal|keel-impact/, `step "${b.step}" builds a PR body in inline JS`);
  // The default, with nothing ignored.
  const def = await nightCommit(t, night, {});
  assert.equal(def.page, 'docs/health');
  assert.deepEqual(def.files, ['.keel/bounds.json', 'docs/health/2026-10-05.md']);
  // The configured dir ignored: red, naming the fix, and nothing pushed.
  const lost = await nightCommit(t, night, { ignore: '/docs/health/\n' });
  assert.notEqual(lost.status, 0);
  assert.match(lost.out, /docs\/health is git-ignored.*set \\?"health\\?" in \.keel\/keel\.json/);
  assert.equal(lost.files, null);
  // Mutation: the commit step hard-codes docs/health instead of the configured dir.
  const hard = night.replace('PAGE="$HEALTH/$DAY.md"', 'PAGE="docs/health/$DAY.md"');
  assert.notEqual(hard, night);
  const m = await nightCommit(t, hard, { health: '.keel/health', ignore: '/docs/health/\n' });
  assert.ok(!(m.files ?? []).includes('.keel/health/2026-10-05.md'), `a hard-coded docs/health loses the page: ${JSON.stringify(m.files)}`);
  // Mutation: the dir is not read from the config.
  const fixed = night.replace('const dir = healthDirIn(".", JSON.parse(readFileSync(".keel/keel.json", "utf8")));', 'const dir = "docs/health";');
  assert.notEqual(fixed, night);
  const f = await nightCommit(t, fixed, { health: '.keel/health', ignore: '/docs/health/\n' });
  assert.ok(!(f.files ?? []).includes('.keel/health/2026-10-05.md'), `a fixed dir loses the page: ${JSON.stringify(f.files)}`);
});

// ledger #76–#80: what the night stages from the health directory, and what it refuses.
test('the night stages only tonight\'s page and its own data (deletions kept), probes a dated page for ignores, and refuses a symlinked or magic health dir', async t => {
  const night = await readFile(join(KEEL, 'practices/night/files/.github/workflows/keel-night.yml'), 'utf8');
  // #76: a shared health dir ("scripts"): the night's page, never the project's other changes under it.
  const shared = await nightCommit(t, night, { health: 'scripts', tracked: { 'scripts/deploy.mjs': 'v1\n' }, after: dir => writeFile(join(dir, 'scripts/deploy.mjs'), 'v2, half-done\n') });
  assert.equal(shared.status, 0, shared.out);
  assert.deepEqual(shared.files, ['.keel/bounds.json', 'scripts/2026-10-05.md'], 'only the dated page and the bounds');
  // #76 too: a stray file in the default dir is not the night's.
  const stray = await nightCommit(t, night, { after: dir => writeFile(join(dir, 'docs/health/notes.md'), 'a person\'s notes\n') });
  assert.deepEqual(stray.files, ['.keel/bounds.json', 'docs/health/2026-10-05.md']);
  // #78: a tracked data path that is gone is staged as its deletion.
  const gone = await nightCommit(t, night, { tracked: { 'docs/INBOX.md': '# Inbox\n', 'docs/inbox/1.md': 'x\n' }, after: async dir => { await rm(join(dir, 'docs/INBOX.md')); await rm(join(dir, 'docs/inbox'), { recursive: true }); } });
  assert.equal(gone.status, 0, gone.out);
  assert.deepEqual(gone.changes, ['A\t.keel/bounds.json', 'A\tdocs/health/2026-10-05.md', 'D\tdocs/INBOX.md', 'D\tdocs/inbox/1.md']);
  // #77: an ignore rule for dated pages (not the directory) is caught: red, nothing pushed.
  const dated = await nightCommit(t, night, { ignore: 'docs/health/20*.md\n' });
  assert.notEqual(dated.status, 0);
  assert.match(dated.out, /docs\/health is git-ignored \(docs\/health\/2026-10-05\.md\)/);
  assert.equal(dated.files, null);
  // #79: a health dir that is a symlink out of the repo is refused before anything is written.
  const out = await nightCommit(t, night, { health: '.keel/health', before: async (dir, base) => { await mkdir(join(base, 'elsewhere'), { recursive: true }); await symlink(join(base, 'elsewhere'), join(dir, '.keel/health')); } });
  assert.notEqual(out.where, 0, 'the health step refuses it');
  assert.match(out.out, /resolves outside the repo/);
  // A symlink inside the repo is still the repo's.
  const inside = await nightCommit(t, night, { health: '.keel/health', before: async dir => { await mkdir(join(dir, 'acme-pages'), { recursive: true }); await symlink('../acme-pages', join(dir, '.keel/health')); } });
  assert.equal(inside.where, 0, inside.out);
  // #80: pathspec magic in "health" is refused.
  for (const health of [':(top)docs/health', ':!docs']) {
    const magic = await nightCommit(t, night, { health });
    assert.notEqual(magic.where, 0, health);
    assert.match(magic.out, /pathspec magic/, health);
  }
  // Mutations: each of the old shapes fails one of the checks above.
  const whole = await nightCommit(t, night.replace('for p in "$PAGE" docs/inbox', 'for p in "$HEALTH" docs/inbox'), { health: 'scripts', tracked: { 'scripts/deploy.mjs': 'v1\n' }, after: dir => writeFile(join(dir, 'scripts/deploy.mjs'), 'v2, half-done\n') });
  assert.ok(whole.files.includes('scripts/deploy.mjs'), `staging the whole dir carries the project's file: ${JSON.stringify(whole.files)}`);
  const exists = await nightCommit(t, night.replace('if [ -e "$p" ] || [ -n "$(git ls-files -- "$p")" ]; then', 'if [ -e "$p" ]; then'), { tracked: { 'docs/INBOX.md': '# Inbox\n' }, after: dir => rm(join(dir, 'docs/INBOX.md')) });
  assert.ok(!exists.changes.includes('D\tdocs/INBOX.md'), `-e alone drops the deletion: ${JSON.stringify(exists.changes)}`);
  const probe = await nightCommit(t, night.replace('PAGE="$HEALTH/$DAY.md"\n', 'PAGE="$HEALTH/$DAY.md"\n          PROBE="$HEALTH/x.md"\n').replace('git check-ignore -q -- "$PAGE"', 'git check-ignore -q -- "$PROBE"'), { ignore: 'docs/health/20*.md\n' });
  assert.doesNotMatch(probe.out, /is git-ignored \(/, 'an x.md probe misses a rule for dated pages');
  const lexical = await nightCommit(t, night.replace('import { healthDirIn } from', 'import { healthDirOf as healthDirIn } from'), { health: '.keel/health', before: async (dir, base) => { await mkdir(join(base, 'elsewhere'), { recursive: true }); await symlink(join(base, 'elsewhere'), join(dir, '.keel/health')); } });
  assert.equal(lexical.where, 0, 'a lexical check alone lets the symlink through');
});

test('the PR description is re-checked on edit by keel-impact.yml alone; check.yml never runs it', async () => {
  const all = await shipped();
  const impact = all.find(w => w.name === 'keel-impact.yml').template;
  const check = all.find(w => w.name === 'check.yml').template;
  const on = /^on:\n([\s\S]*?)\n\S/m.exec(impact)?.[1] ?? '';
  for (const t of ['opened', 'synchronize', 'reopened', 'edited']) assert.match(on, new RegExp(`\\b${t}\\b`), `keel-impact.yml runs on ${t}`);
  assert.doesNotMatch(on, /push|pull_request_target/, 'keel-impact.yml: pull_request only');
  assert.match(impact, /reconcile\.mjs --event "\$GITHUB_EVENT_PATH"/);
  assert.doesNotMatch(impact, /\{\{check\}\}|npm (ci|test|run)/, 'an edit never re-runs the gate');
  // An edited-triggered gate would skip, and a skipped required check reads as passed.
  assert.doesNotMatch(check, /--event/, 'check.yml leaves the description to keel-impact.yml');
  assert.doesNotMatch(check, /\bedited\b/, 'check.yml does not run on description edits');
});

/**
 * The test ledger's history between runs (phase 33): check.yml keeps each
 * run's .keel/test-runs as a keel-test-runs artifact, red or green; the night
 * reads the newest of them, read-only and by name, before improve runs, and
 * keeps its own after. [string] problems.
 */
export function ledgerProblems(name, text) {
  const out = [];
  const step = title => {
    const at = text.indexOf(`      - name: ${title}\n`);
    if (at < 0) return null;
    const next = text.indexOf('\n      - ', at + 1);
    return { at, body: text.slice(at, next < 0 ? undefined : next) };
  };
  const keep = step('Keep the test ledger');
  if (!keep) out.push(`${name}: no "Keep the test ledger" step`);
  else {
    if (!/\n\s+if: always\(\)\n/.test(keep.body)) out.push(`${name}: the ledger is kept only when the run passed (a failing run is the one that names a flaky test)`);
    if (!/uses: actions\/upload-artifact@v\d+/.test(keep.body)) out.push(`${name}: the ledger is not uploaded as an artifact`);
    if (!/\n\s+name: keel-test-runs\n/.test(keep.body)) out.push(`${name}: the artifact is not named keel-test-runs (the night reads it by name)`);
    if (!/\n\s+path: \.keel\/test-runs\/\n/.test(keep.body)) out.push(`${name}: the artifact is not .keel/test-runs/`);
    if (!/include-hidden-files: true/.test(keep.body)) out.push(`${name}: .keel is hidden; upload-artifact skips it unless told`);
    if (!/if-no-files-found: ignore/.test(keep.body)) out.push(`${name}: a project without the reporter must not go red over a missing ledger`);
  }
  if (name === 'keel-night.yml') {
    const gather = step('Gather the test ledger'), measure = text.indexOf('node scripts/keel/improve.mjs --report');
    if (!gather) out.push('keel-night.yml: no "Gather the test ledger" step');
    else {
      if (gather.at > measure) out.push('keel-night.yml: the ledger is gathered after improve measured');
      if (!/gh api "repos\/\$REPO\/actions\/artifacts\?name=keel-test-runs/.test(gather.body)) out.push('keel-night.yml: the artifacts are not read by name');
      if (!/head_branch == \\"\$BASE\\"/.test(gather.body)) out.push('keel-night.yml: artifacts from other branches are read');
      if (/gh api[^\n]*(-X|--method|-f |-F |--field|--input)/.test(gather.body)) out.push('keel-night.yml: the ledger read writes to GitHub');
      if (!/unzip -o -q [^\n]* -d \.keel\/test-runs/.test(gather.body)) out.push('keel-night.yml: the artifacts are not unpacked into .keel/test-runs');
    }
    if (keep && keep.at < measure) out.push('keel-night.yml: the ledger is kept before the gate ran');
  }
  return out;
}

test('check.yml keeps each run\'s test ledger as an artifact, red or green; the night reads the newest by name, read-only, before improve, and keeps its own', async () => {
  const all = await shipped();
  for (const name of ['check.yml', 'keel-night.yml']) {
    const w = all.find(x => x.name === name);
    assert.deepEqual(ledgerProblems(name, w.template), [], `${name} template`);
    assert.deepEqual(ledgerProblems(name, await readFile(join(KEEL, w.path), 'utf8')), [], `keel's ${name}`);
  }
  const check = all.find(w => w.name === 'check.yml').template;
  const night = all.find(w => w.name === 'keel-night.yml').template;
  const fails = (name, text, pattern, why) => assert.ok(ledgerProblems(name, text).some(p => pattern.test(p)), `${why}: ${JSON.stringify(ledgerProblems(name, text))}`);
  fails('check.yml', check.replace(/(- name: Keep the test ledger\n)\s+if: always\(\)\n/, '$1'), /only when the run passed/, 'kept only on green');
  fails('check.yml', check.replace('include-hidden-files: true', 'include-hidden-files: false'), /hidden/, 'hidden files skipped');
  fails('check.yml', check.replace('if-no-files-found: ignore', 'if-no-files-found: error'), /must not go red/, 'red without a reporter');
  fails('keel-night.yml', night.replace(' | select(.workflow_run.head_branch == \\"$BASE\\")', ''), /other branches/, 'any branch\'s artifacts');
  fails('keel-night.yml', night.replace('gh api "repos/$REPO/actions/artifacts/$id/zip"', 'gh api -X DELETE "repos/$REPO/actions/artifacts/$id/zip"'), /writes to GitHub/, 'a write in the read');
  const late = night.replace(/(\n      - name: Gather the test ledger\n[\s\S]*?)(\n      # Before the drain)/, '$2').replace('\n      # Porcelain, never', `${/\n      - name: Gather the test ledger\n[\s\S]*?(?=\n      # Before the drain)/.exec(night)[0]}\n      # Porcelain, never`);
  fails('keel-night.yml', late, /gathered after improve/, 'gathered after the measure');
});

/**
 * A climb night's own rules (phase 35), on keel-climb.yml's text: [string].
 * The agent's tools cannot push, merge or reach gh; its step is time-boxed by
 * the budget; the script judges the night (settle, guard) before anything is
 * pushed; a night that kept nothing pushes nothing; climb off is the first
 * thing the run says.
 */
export function climbWorkflowProblems(text) {
  const out = [];
  const tools = /--allowedTools "([^"]*)"/.exec(text)?.[1];
  if (!tools) out.push('the agent has no --allowedTools list');
  else {
    const list = tools.split(',').map(s => s.trim());
    for (const t of list) {
      if (/\bpush\b|\bmerge\b|\brebase\b|\breset\b/.test(t)) out.push(`the agent may run ${t}`);
      if (/^Bash\(git( \*|:\*|\*)\)$/.test(t) || t === 'Bash' || t === 'Bash(*)') out.push(`the agent may run any git or shell command (${t})`);
      if (/^Bash\(gh\b/.test(t)) out.push(`the agent may run gh (${t})`);
      // A loop night proposes; deciding, pushing to Loop and re-mining are a person's (phase 37, lesson 53).
      if (/^Bash\(node scripts\/loop\.mjs/.test(t) && !/^Bash\(node scripts\/loop\.mjs (?:list|propose)\b/.test(t)) out.push(`the agent may run loop.mjs beyond list and propose (${t})`);
    }
    if (!list.includes('Bash(node scripts/keel/climb.mjs *)')) out.push('the agent cannot run climb.mjs, so its numbers would be its own');
  }
  const climbAt = text.indexOf('      - name: Climb\n');
  const climbNext = text.indexOf('\n      - ', climbAt + 1);
  const climbStep = climbAt < 0 ? '' : text.slice(climbAt, climbNext < 0 ? undefined : climbNext + 1);
  if (!/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.pick\.outputs\.minutes\) \}\}\n/.test(climbStep) || !/\n\s+uses: anthropics\/claude-code-action@v\d+\n/.test(climbStep)) out.push('the agent\'s step is not time-boxed by the budget (steps.pick.outputs.minutes)');
  const at = s => text.indexOf(s);
  const push = at('git push');
  for (const verb of ['settle', 'guard', 'report']) {
    const i = at(`node scripts/keel/climb.mjs ${verb}`);
    if (i < 0) out.push(`the night is not judged by climb.mjs ${verb}`);
    else if (push >= 0 && i > push) out.push(`climb.mjs ${verb} runs after the push`);
  }
  const kept = at('if [ "$KEPT" = 0 ]');
  if (kept < 0 || (push >= 0 && kept > push)) out.push('the push does not wait on a kept change: a night that kept nothing must open nothing');
  const steps = [...text.matchAll(/^ {6}- (?:name: (.+)|uses: (\S+))$/gm)].map(m => m[1] ?? m[2]);
  if (!(steps[0]?.startsWith('actions/checkout') && steps[1] === 'Is climb on?')) out.push('"Is climb on?" is not the first step after checkout');
  if (!/climb is off/.test(text)) out.push('climb off is not said');
  return out;
}

test('keel-climb.yml: the agent cannot push or merge, is time-boxed by the budget, and the script judges the night before one PR', async () => {
  const w = (await shipped()).find(x => x.name === 'keel-climb.yml');
  const t = w.template;
  assert.deepEqual(climbWorkflowProblems(t), []);
  assert.match(t, /git push --force origin "\$head:refs\/heads\/keel-climb\/\$JOB\/\$DAY"/);
  // STITCH_API_KEY: a loop night's pull (phase 37), in its own step only.
  // OPENAI_API_KEY: a Codex night's (phase 47).
  assert.deepEqual(w.declared.sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'STITCH_API_KEY']);
  assert.deepEqual(t.split(/\n(?= {6}- )/).filter(s => s.includes('secrets.STITCH_API_KEY')).map(s => /name: (.+)/.exec(s)[1]), ["Pull Loop's findings"]);
  const tools = /--allowedTools "([^"]*)"/.exec(t)[1];
  for (const [why, text] of [
    ['git push allowed', t.replace(tools, `${tools},Bash(git push*)`)],
    ['any git allowed', t.replace(tools, `${tools},Bash(git *)`)],
    ['gh allowed', t.replace(tools, `${tools},Bash(gh pr merge *)`)],
    ['loop decide allowed', t.replace(tools, `${tools},Bash(node scripts/loop.mjs decide *)`)],
    ['any loop verb allowed', t.replace('Bash(node scripts/loop.mjs propose *)', 'Bash(node scripts/loop.mjs *)')],
    ['climb.mjs not allowed', t.replace('Bash(node scripts/keel/climb.mjs *),', '')],
    ['no time box', t.replace(/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.pick\.outputs\.minutes\) \}\}/, '')],
    ['no guard', t.replace('          node scripts/keel/climb.mjs guard --base "$GITHUB_SHA"\n', '')],
    ['a push whatever was kept', t.replace('if [ "$KEPT" = 0 ] || [ -z "$KEPT" ]; then', 'if false; then')],
    ['climb off said late', t.replace('      - name: Is climb on?\n', '      - name: Acme first\n        run: true\n      - name: Is climb on?\n')],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    assert.ok(climbWorkflowProblems(text).length, `${why}: expected a problem`);
  }
});

/**
 * Lesson 29 on an agent's workflow: a step after the agent's own (its id
 * `id`), before anything is judged or pushed, runs `climb.mjs agent-ran` on
 * that step's outcome and the action's execution file, and is not itself
 * continue-on-error, so an agent that failed before its budget ran out ends
 * the run red. [string].
 */
export function agentRanProblems(text, { step, id }) {
  const out = [];
  const steps = text.split(/\n(?= {6}- )/);
  const at = name => steps.findIndex(s => new RegExp(`^ {6}- name: ${name.replace(/[?]/g, '\\?')}\\n`).test(s));
  const agent = at(step), check = at('Did the agent run?');
  if (agent < 0) return [`no "${step}" step`];
  if (!new RegExp(`\\n {8}id: ${id}\\n`).test(steps[agent])) out.push(`the "${step}" step has no id ${id}, so its outcome cannot be read`);
  if (check < 0) return [...out, 'no "Did the agent run?" step: an agent that never started reports success (lesson 29)'];
  if (check < agent) out.push('"Did the agent run?" runs before the agent');
  const body = steps[check];
  if (/continue-on-error/.test(body)) out.push('"Did the agent run?" is continue-on-error: its red would be swallowed');
  // Phase 47: Codex's step (id <id>_codex) when the pass names codex, else Claude's.
  if (!new RegExp(`OUTCOME: \\$\\{\\{ (?:steps\\.on\\.outputs\\.agent == 'codex' && steps\\.${id}_codex\\.outcome \\|\\| )?steps\\.${id}\\.outcome \\}\\}`).test(body)) out.push(`"Did the agent run?" does not read steps.${id}.outcome`);
  const codexStep = steps.find(s => new RegExp(`\\n {8}id: ${id}_codex\\n`).test(s));
  if (codexStep) {
    if (!body.includes(`steps.${id}_codex.outcome`)) out.push(`"Did the agent run?" does not read steps.${id}_codex.outcome`);
    if (!/node scripts\/keel\/climb\.mjs agent-ran --agent codex --outcome "\$OUTCOME" --file "\$RUNNER_TEMP\/codex-final-message\.md" --minutes "\$MINUTES" --started "\$STARTED"/.test(body)) out.push('"Did the agent run?" does not judge Codex by its final message (agent-ran --agent codex)');
    if (steps.indexOf(codexStep) > check) out.push('"Did the agent run?" runs before Codex\'s step');
  }
  if (!new RegExp(`EXECUTION: \\$\\{\\{ steps\\.${id}\\.outputs\\.execution_file \\}\\}`).test(body)) out.push('"Did the agent run?" does not read the action\'s execution file');
  if (!/node scripts\/keel\/climb\.mjs agent-ran --outcome "\$OUTCOME" --file "[^"]+" --minutes "\$MINUTES" --started "\$STARTED"/.test(body)) out.push('"Did the agent run?" does not run climb.mjs agent-ran with the outcome, the file, the budget and the start');
  if (/\|\| true|; *exit 0/.test(body)) out.push('"Did the agent run?" swallows its exit');
  for (const later of ['guard', 'git push']) {
    const i = steps.findIndex(s => s.includes(later === 'guard' ? 'node scripts/keel/climb.mjs guard' : 'git push'));
    if (i >= 0 && i < check) out.push(`${later} runs before "Did the agent run?"`);
  }
  return out;
}

test('lesson 29: keel-climb.yml and keel-tend.yml end red when the agent failed before its budget ran out, before anything is judged or pushed', async () => {
  const all = await shipped();
  for (const [name, opts] of [['keel-climb.yml', { step: 'Climb', id: 'climb' }], ['keel-tend.yml', { step: 'Tend', id: 'tend' }]]) {
    const t = all.find(w => w.name === name).template;
    assert.deepEqual(agentRanProblems(t, opts), [], name);
    assert.deepEqual(agentRanProblems(await readFile(join(KEEL, '.github/workflows', name), 'utf8'), opts), [], `keel's ${name}`);
    const check = /\n {6}- name: Did the agent run\?\n[\s\S]*?(?=\n {6}(?:#|- ))/.exec(t)[0];
    for (const [why, text] of [
      ['no check', t.replace(check, '')],
      ['the check swallowed', t.replace(check, check.replace('        run: |', '        continue-on-error: true\n        run: |'))],
      ['another step\'s outcome', t.replace(`steps.${opts.id}.outcome`, 'steps.brief.outcome')],
      ['no execution file', t.replace(`EXECUTION: \${{ steps.${opts.id}.outputs.execution_file }}`, 'EXECUTION: none')],
      ['its exit ignored', t.replace(/--started "\$STARTED"\n/, '--started "$STARTED" || true\n')],
      ['the agent step has no id', t.replace(`\n        id: ${opts.id}\n`, '\n')],
    ]) {
      assert.notEqual(text, t, `${name} ${why}: the mutation did not apply`);
      assert.ok(agentRanProblems(text, opts).length, `${name} ${why}: expected a problem`);
    }
  }
});

/**
 * The agent holds no credential that can write (ledger#92), on keel-climb.yml
 * or keel-tend.yml: [string]. The job with claude-code-action declares its
 * own permissions, none of them write (no id-token either: the action is
 * handed the job's read-only token as github_token, so it never trades OIDC
 * for its app's token); it has no job-level GH_TOKEN; every checkout in it
 * keeps no credential. The workflow's own permissions grant nothing. Only a
 * job with no agent pushes, opens the PR or files an issue, and it checks
 * climb.mjs sandbox before its push; the judge checks it before it takes the
 * agent's commits.
 */
export function agentSandboxProblems(text) {
  const out = [];
  const jobs = jobsOf(text);
  // Phase 47: Codex's step, where a pass names codex, is the agent's too, in the same job.
  const isAgent = j => /\n\s+uses: (?:anthropics\/claude-code-action|openai\/codex-action)@/.test(j.text);
  const agents = jobs.filter(isAgent);
  if (agents.length !== 1) return [`${agents.length} jobs run an agent; one, the agent's`];
  const agent = agents[0];
  const top = /^permissions:(.*)\n((?: {2}.*\n)*)/m.exec(text);
  if (!top) out.push('the workflow declares no permissions: every job would get the repo default, which may write');
  else if (/write/.test(top[1] + top[2])) out.push(`the workflow's permissions grant a write to every job: ${(top[1] + top[2]).trim()}`);
  const perms = /\n {4}permissions:\n((?: {6}.*\n)+)/.exec(agent.text)?.[1];
  if (!perms) out.push(`the agent's job (${agent.id}) declares no permissions of its own`);
  else {
    for (const line of perms.split('\n').filter(Boolean)) if (/:\s*write/.test(line)) out.push(`the agent's job may write: ${line.trim()}`);
    if (!/^ {6}contents: read$/m.test(perms)) out.push('the agent\'s job must say contents: read');
  }
  if (/\n {4}permissions:\s*write-all/.test(agent.text)) out.push('the agent\'s job is write-all');
  const jobEnv = /\n {4}env:\n((?: {6}.*\n)+)/.exec(agent.text)?.[1] ?? '';
  if (/GH_TOKEN|GITHUB_TOKEN/.test(jobEnv)) out.push('the agent\'s job sets a token for every step (job-level env)');
  const checkouts = agent.text.split(/\n(?= {6}- )/).filter(st => /uses: actions\/checkout@/.test(st));
  if (!checkouts.length) out.push('the agent\'s job has no checkout');
  for (const c of checkouts) if (!/\n {10}persist-credentials: false(?:\n|$)/.test(c)) out.push('a checkout in the agent\'s job keeps the token in git (persist-credentials: false)');
  const action = agent.text.split(/\n(?= {6}- )/).find(st => /uses: anthropics\/claude-code-action@/.test(st)) ?? '';
  if (!/\n {10}github_token: \$\{\{ github\.token \}\}\n/.test(action)) out.push('claude-code-action is not handed the job\'s token (github_token), so it trades OIDC for its app\'s token, which can write');
  for (const j of jobs) {
    const lines = code(j.text).map(l => l.line);
    const writes = lines.filter(l => /\bgit push\b|\bgh (pr|issue) create\b/.test(l));
    if (writes.length && isAgent(j)) out.push(`the agent's job ${j.id} pushes or opens: ${writes[0].trim()}`);
    const push = lines.findIndex(l => /\bgit push\b/.test(l));
    if (push >= 0) {
      const sandbox = lines.findIndex(l => /node scripts\/keel\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head"/.test(l));
      if (sandbox < 0 || sandbox > push) out.push(`job ${j.id} pushes without climb.mjs sandbox first`);
    }
  }
  const judge = jobs.find(j => !isAgent(j) && /node scripts\/keel\/climb\.mjs guard/.test(j.text));
  if (!judge) out.push('no job without the agent runs the guard');
  else {
    const at = s => judge.text.indexOf(s);
    if (/:\s*write/.test(/\n {4}permissions:\n((?: {6}.*\n)+)/.exec(judge.text)?.[1] ?? 'none: write')) out.push('the judge may write: it runs the agent\'s code (the gate)');
    if (at('climb.mjs sandbox') < 0 || at('git switch -q -c "$BRANCH" "$head"') < 0 || at('climb.mjs sandbox') > at('git switch -q -c "$BRANCH" "$head"')) out.push('the judge takes the agent\'s commits before climb.mjs sandbox has checked them');
    if (!/\n {10}persist-credentials: false\n/.test(judge.text)) out.push('the judge\'s checkout keeps the token in git');
    // ledger#92: no code of the agent's runs where the setup token is. The
    // install (its only step) runs on the run's commit, before the bundle is
    // fetched or switched to; the gate runs after, with no setup token.
    const lines = code(judge.text);
    const taken = lines.findIndex(l => /git fetch -q "\$in\/\w+\.bundle"|git switch -q -c "\$BRANCH" "\$head"/.test(l.line));
    const token = lines.map((l, i) => /secrets\[|outputs\.setup_token|\bSETUP\b/.test(l.line) ? i : -1).filter(i => i >= 0);
    if (taken < 0) out.push('the judge never takes the agent\'s commits');
    else if (!token.length || token.some(i => i > taken)) out.push('the judge installs (with the setup token) after it takes the agent\'s commits: their preinstall or lockfile would run with the token');
    // ledger#92: the judge's base is the run's commit, never the record's (the agent wrote it).
    for (const { line } of lines) {
      const verb = /node scripts\/keel\/climb\.mjs (settle|guard|compare --final|report|tend-report)\b/.exec(line)?.[1];
      if (verb && !/ --base "\$GITHUB_SHA"(?: |$)/.test(line)) out.push(`the judge's climb.mjs ${verb} trusts the record's base: pass --base "$GITHUB_SHA"`);
    }
  }
  return out;
}

test('ledger#92: the climb and tend agents hold no credential that can write; a job with no agent judges and pushes', async () => {
  const all = await shipped();
  for (const name of ['keel-climb.yml', 'keel-tend.yml']) {
    const t = all.find(w => w.name === name).template;
    assert.deepEqual(agentSandboxProblems(t), [], name);
    assert.deepEqual(agentSandboxProblems(await readFile(join(KEEL, '.github/workflows', name), 'utf8')), [], `keel's ${name}`);
    assert.deepEqual(jobsOf(t).map(j => j.id), ['agent', 'judge', 'publish'], `${name}: the jobs, as GitHub shows them`);
    const agentPerms = '    permissions:\n      contents: read\n      pull-requests: read\n      actions: read\n';
    assert.ok(t.includes(agentPerms), name);
    const pushStep = /\n {6}- name: Open the [^\n]*\n[\s\S]*?(?=\n {6}(?:#|- ))/.exec(t)[0];
    for (const [why, text] of [
      ['the agent may write contents', t.replace(agentPerms, agentPerms.replace('contents: read', 'contents: write'))],
      ['the agent may write PRs', t.replace(agentPerms, agentPerms.replace('pull-requests: read', 'pull-requests: write'))],
      ['the agent may mint an OIDC token', t.replace(agentPerms, `${agentPerms}      id-token: write\n`)],
      ['the agent job without its own permissions', t.replace(agentPerms, '')],
      ['the workflow grants write', t.replace('permissions: {}\n', 'permissions:\n  contents: write\n')],
      ['a job-level token', t.replace('    timeout-minutes: 240\n    permissions:\n      contents: read\n      pull-requests: read', '    timeout-minutes: 240\n    env:\n      GH_TOKEN: ${{ github.token }}\n    permissions:\n      contents: read\n      pull-requests: read')],
      ['the checkout keeps its credential', t.replace('          fetch-depth: 0\n          persist-credentials: false\n', '          fetch-depth: 0\n')],
      ['the action trades for its app token', t.replace('          github_token: ${{ github.token }}\n', '')],
      ['the push in the agent\'s job', t.replace(/(\n {6}- name: Did the agent run\?\n)/, `\n${pushStep.replace(/^\n/, '')}$1`)],
      ['no sandbox before the push', t.replace(/(\n {6}- name: Open the [\s\S]*?)\n {10}node scripts\/keel\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head"\n/, '$1\n')],
      ['the judge may write', t.replace('  judge:\n', '  judge:\n').replace(/(\n  judge:\n[\s\S]*?\n {4}permissions:\n {6}contents: )read/, '$1write')],
      ['the judge takes the commits unchecked', t.replace(/(\n  judge:\n[\s\S]*?)\n {10}node scripts\/keel\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head"\n/, '$1\n')],
      // The install moved back after the take, as it was before ledger#92's review: a preinstall runs with the token.
      ['the judge installs on the agent\'s commits', t.replace(/(\n  judge:\n[\s\S]*?)(\n {6}- name: Install\n[\s\S]*?\n {10}fi\n)([\s\S]*?\n {6}- name: Take the [^\n]*\n[\s\S]*?\n {10}done\n)/, '$1$3$2')],
      ['the judge\'s guard trusts the record\'s base', t.replace(/(node scripts\/keel\/climb\.mjs guard(?: --job tend)?) --base "\$GITHUB_SHA"/, '$1')],
      ['the judge\'s report trusts the record\'s base', t.replace(/(node scripts\/keel\/climb\.mjs (?:tend-)?report [^\n]*?) --base "\$GITHUB_SHA"/, '$1')],
    ]) {
      assert.notEqual(text, t, `${name} ${why}: the mutation did not apply`);
      assert.ok(agentSandboxProblems(text).length, `${name} ${why}: expected a problem`);
    }
  }
});

/**
 * The tend pass's own rules (phase 38), on keel-tend.yml's text: [string].
 * The climb's rights and no more: the agent cannot push, merge, delete or
 * reach gh; its step is time-boxed by the budget; the tend guard and the
 * report run before anything is pushed; a pass with no commit pushes nothing;
 * nothing in it closes, deletes or merges; tend off is said first.
 */
export function tendWorkflowProblems(text) {
  const out = [];
  const tools = /--allowedTools "([^"]*)"/.exec(text)?.[1];
  if (!tools) out.push('the agent has no --allowedTools list');
  else {
    const list = tools.split(',').map(s => s.trim());
    for (const t of list) {
      if (/\bpush\b|\bmerge\b|\brebase\b|\breset\b|\bclean\b|\brm\b|\bbranch\b|\bcheckout\b|\bswitch\b/.test(t)) out.push(`the agent may run ${t}`);
      if (/^Bash\(git( \*|:\*|\*)\)$/.test(t) || t === 'Bash' || t === 'Bash(*)') out.push(`the agent may run any git or shell command (${t})`);
      if (/^Bash\(gh\b/.test(t)) out.push(`the agent may run gh (${t})`);
    }
    if (!list.includes('Bash(node scripts/keel/climb.mjs *)')) out.push('the agent cannot run climb.mjs (tend-note, the guard)');
  }
  const tendAt = text.indexOf('      - name: Tend\n');
  const tendNext = text.indexOf('\n      - ', tendAt + 1);
  const tendStep = tendAt < 0 ? '' : text.slice(tendAt, tendNext < 0 ? undefined : tendNext + 1);
  if (!/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.pick\.outputs\.minutes\) \}\}\n/.test(tendStep) || !/\n\s+uses: anthropics\/claude-code-action@v\d+\n/.test(tendStep)) out.push('the agent\'s step is not time-boxed by the budget (steps.pick.outputs.minutes)');
  const at = s => text.indexOf(s);
  const push = at('git push');
  for (const verb of ['tend-input --record', 'guard --job tend', 'tend-report']) {
    const i = at(`node scripts/keel/climb.mjs ${verb}`);
    if (i < 0) out.push(`the pass does not run climb.mjs ${verb}`);
    else if (push >= 0 && i > push) out.push(`climb.mjs ${verb} runs after the push`);
  }
  const waits = at('if [ "$COMMITS" = 0 ]');
  if (waits < 0 || (push >= 0 && waits > push)) out.push('the push does not wait on a commit: a pass that changed nothing must open nothing');
  for (const { line, n } of code(text)) {
    if (/\bgh pr (close|merge)\b|\bgh (api|repo)\b[^\n]*(-X|--method)\s*DELETE|\bgit push\b[^\n]*(--delete|\s:refs)|\bgit branch -[dD]\b|\bgh repo delete\b/.test(line)) out.push(`line ${n}: closes, merges or deletes; tend only proposes that`);
  }
  if (/^\s+issues: write$/m.test(text)) out.push('issues: write: tend files no issue');
  const steps = [...text.matchAll(/^ {6}- (?:name: (.+)|uses: (\S+))$/gm)].map(m => m[1] ?? m[2]);
  if (!(steps[0]?.startsWith('actions/checkout') && steps[1] === 'Is tend on?')) out.push('"Is tend on?" is not the first step after checkout');
  if (!/tend is off/.test(text)) out.push('tend off is not said');
  if (!/^ {4}- cron: "\d+ \d+ \* \* 1"$/m.test(text)) out.push('tend is not weekly on Mondays');
  // ledger#94: the proposals page is the judge's commit before the guard, so the gate sees the pushed tree;
  // its date is the run's (the pick's day), never the record's.
  const page = at('node scripts/keel/climb.mjs tend-page'), guard = at('node scripts/keel/climb.mjs guard --job tend');
  if (page < 0 || guard < 0 || page > guard) out.push('the proposals page is not committed (tend-page) before the tend guard: the gate would not see the pushed tree');
  for (const verb of ['tend-input --record', 'tend-page', 'tend-report']) {
    const line = code(text).find(l => l.line.includes(`node scripts/keel/climb.mjs ${verb}`))?.line ?? '';
    if (!/ --date "\$DAY"(?: |$)/.test(line)) out.push(`climb.mjs ${verb} does not take the run's day (--date "$DAY"): the record's date would name the page`);
  }
  return out;
}

/** Minutes past midnight UTC of a cron "m h dom mon dow" with one minute and one hour; null otherwise. */
const cronAt = expr => { const m = /^(\d+) (\d+) /.exec(expr); return m ? Number(m[2]) * 60 + Number(m[1]) : null; };

/**
 * A loop night proposes on the findings keel-loop.yml pulled (b5944cc), so
 * keel-climb.yml runs after that pull is done: its cron is later than
 * keel-loop's on every day loop runs, by more than keel-loop's job timeout
 * (ledger#94). [string].
 */
export function climbAfterLoopProblems(climb, loop) {
  const c = /^ {4}- cron: "([^"]+)"$/m.exec(climb)?.[1], l = /^ {4}- cron: "([^"]+)"$/m.exec(loop)?.[1];
  if (!c || !l) return ['no cron in keel-climb.yml or keel-loop.yml'];
  const days = e => e.split(' ').slice(2).join(' ');
  if (days(c) !== days(l)) return [`keel-climb.yml runs on "${days(c)}" and keel-loop.yml on "${days(l)}": not the same days`];
  const bound = Number(/\n {4}timeout-minutes: (\d+)\n/.exec(loop)?.[1] ?? NaN);
  if (!Number.isFinite(bound)) return ['keel-loop.yml\'s job has no timeout-minutes'];
  return cronAt(c) > cronAt(l) + bound ? [] : [`keel-climb.yml (${c}) does not run after keel-loop.yml's pull (${l}, up to ${bound} min): a loop night would propose on yesterday's findings`];
}

test('keel-climb.yml runs after keel-loop.yml\'s pull, on the same days, so a loop night proposes on today\'s findings (ledger#94)', async () => {
  const all = await shipped();
  const climb = all.find(w => w.name === 'keel-climb.yml').template, loop = all.find(w => w.name === 'keel-loop.yml').template;
  assert.deepEqual(climbAfterLoopProblems(climb, loop), []);
  assert.deepEqual(climbAfterLoopProblems(await readFile(join(KEEL, '.github/workflows/keel-climb.yml'), 'utf8'), loop), [], "keel's keel-climb.yml");
  for (const [why, text] of [
    ['before the pull, as it was', climb.replace('cron: "17 10 * * *"', 'cron: "41 9 * * *"')],
    ['inside the pull\'s bound', climb.replace('cron: "17 10 * * *"', 'cron: "50 9 * * *"')],
    ['weekly while loop is daily', climb.replace('cron: "17 10 * * *"', 'cron: "17 10 * * 1"')],
  ]) {
    assert.notEqual(text, climb, `${why}: the mutation did not apply`);
    assert.ok(climbAfterLoopProblems(text, loop).length, `${why}: expected a problem`);
  }
});

test('keel-tend.yml has the climb workflow\'s rights only: its prefix, no merge, no delete; the agent time-boxed; the guard and the report before one PR', async () => {
  const w = (await shipped()).find(x => x.name === 'keel-tend.yml');
  const t = w.template;
  assert.equal(w.practice, 'climb');
  assert.deepEqual(tendWorkflowProblems(t), []);
  assert.deepEqual(tendWorkflowProblems(await readFile(join(KEEL, w.path), 'utf8')), [], "keel's rendered keel-tend.yml");
  assert.match(t, /git push --force origin "\$head:refs\/heads\/keel-tend\/\$DAY"/);
  assert.deepEqual(w.declared.sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY']);
  const climbCron = /cron: "(\d+) (\d+) /.exec((await shipped()).find(x => x.name === 'keel-climb.yml').template);
  const tendCron = /cron: "(\d+) (\d+) /.exec(t);
  assert.deepEqual([Number(tendCron[1]) - Number(climbCron[1]), tendCron[2]], [1, climbCron[2]], 'a minute after the climb\'s');
  const tools = /--allowedTools "([^"]*)"/.exec(t)[1];
  const push = 'git push --force origin "$head:refs/heads/keel-tend/$DAY"';
  for (const [why, text, rule] of [
    ['a push outside keel-tend/', t.replace(push, 'git push --force origin "$head:refs/heads/keel-climb/$DAY"'), 'problems'],
    ['a push to main', t.replace(push, 'git push origin main'), 'problems'],
    ['a merge', `${t}\n      - run: gh pr merge 1 --squash\n`, 'problems'],
    ['git push allowed', t.replace(tools, `${tools},Bash(git push*)`)],
    ['rm allowed', t.replace(tools, `${tools},Bash(rm *)`)],
    ['git rm allowed', t.replace(tools, `${tools},Bash(git rm *)`)],
    ['gh allowed', t.replace(tools, `${tools},Bash(gh pr close *)`)],
    ['climb.mjs not allowed', t.replace('Bash(node scripts/keel/climb.mjs *),', '')],
    ['no time box', t.replace(/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.pick\.outputs\.minutes\) \}\}/, '')],
    ['no tend guard', t.replace('          node scripts/keel/climb.mjs guard --job tend --base "$GITHUB_SHA"\n', '')],
    ['a push whatever was committed', t.replace('if [ "$COMMITS" = 0 ] || [ -z "$COMMITS" ]; then', 'if false; then')],
    ['a branch deleted', t.replace(push, `${push}\n          git push origin --delete refs/heads/keel-tend/old`)],
    ['a PR closed', t.replace(push, `${push}\n          gh pr close 3`)],
    ['tend off said late', t.replace('      - name: Is tend on?\n', '      - name: Acme first\n        run: true\n      - name: Is tend on?\n')],
    ['daily', t.replace('cron: "18 10 * * 1"', 'cron: "18 10 * * *"')],
    ['the page after the guard', t.replace(/( {10}node scripts\/keel\/climb\.mjs tend-page [^\n]*\n)( {10}node scripts\/keel\/climb\.mjs guard --job tend [^\n]*\n)/, '$2$1')],
    ['the page named by the record\'s date', t.replace(/(climb\.mjs tend-page [^\n]*?) --date "\$DAY"/, '$1')],
    ['the report trusts the record\'s date', t.replace(/(climb\.mjs tend-report [^\n]*?) --date "\$DAY"/, '$1')],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    const found = rule === 'problems' ? problems('keel-tend.yml', text, w.declared) : tendWorkflowProblems(text);
    assert.ok(found.length, `${why}: expected a problem`);
  }
});

/**
 * The night gathers the newest tend record (phase 38), as it gathers the
 * climb's: the keel-tend artifact, by name, from the default branch only,
 * read-only, into .keel/tend before improve writes the page; none is never red.
 */
export function tendGatherProblems(text) {
  const out = [];
  const at = text.indexOf('      - name: Gather the tend record\n');
  if (at < 0) return ['no "Gather the tend record" step'];
  const next = text.indexOf('\n      - ', at + 1);
  const body = text.slice(at, next < 0 ? undefined : next);
  const measure = text.indexOf('node scripts/keel/improve.mjs --report');
  if (measure >= 0 && at > measure) out.push('the tend record is gathered after improve wrote the page');
  if (!/gh api "repos\/\$REPO\/actions\/artifacts\?name=keel-tend&/.test(body)) out.push('the tend record is not read by name');
  if (!/head_branch == \\"\$BASE\\"/.test(body) || !/BASE: \$\{\{ github\.event\.repository\.default_branch \}\}/.test(body)) out.push('tend records from other branches are read');
  if (/gh api[^\n]*(-X|--method|-f |-F |--field|--input)/.test(body)) out.push('the tend read writes to GitHub');
  if (!/unzip -o -q [^\n]* -d \.keel\/tend\n/.test(body)) out.push('the record is not unpacked into .keel/tend, where improve reads it');
  if (/exit 1/.test(body)) out.push('a missing tend record must never be red');
  return out;
}

test('the night gathers the newest keel-tend record, read-only, from the default branch, before improve writes the health page', async () => {
  const w = (await shipped()).find(x => x.name === 'keel-night.yml');
  assert.deepEqual(tendGatherProblems(w.template), []);
  assert.deepEqual(tendGatherProblems(await readFile(join(KEEL, w.path), 'utf8')), [], "keel's keel-night.yml");
  const t = w.template;
  const step = /\n {6}# The newest tend pass's record[\s\S]*?(?=\n {6}# Before the drain)/.exec(t)[0];
  for (const [why, text] of [
    ['a write in the read', t.replace('gh api "repos/$REPO/actions/artifacts/$id/zip" > "$RUNNER_TEMP/tend-', 'gh api -X DELETE "repos/$REPO/actions/artifacts/$id/zip" > "$RUNNER_TEMP/tend-')],
    ['unpacked elsewhere', t.replace('-d .keel/tend\n', '-d .keel/elsewhere\n')],
    ['gathered after the measure', t.replace(step, '').replace('\n      - name: Keep the test ledger', `${step}\n      - name: Keep the test ledger`)],
    ['no gather at all', t.replace(step, '')],
    ['red when missing', t.replace('echo "tend: no keel-tend record on $BASE"\n            exit 0', 'echo "tend: no keel-tend record on $BASE"\n            exit 1')],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    assert.ok(tendGatherProblems(text).length, `${why}: expected a problem`);
  }
});

/**
 * The night gathers the newest climb record (phase 35): the keel-climb
 * artifact, by name, from the default branch only, read-only, unpacked into
 * .keel/climb before improve writes the health page; none is never red. [string].
 */
export function climbGatherProblems(text) {
  const out = [];
  const at = text.indexOf("      - name: Gather the climb's record\n");
  if (at < 0) return ['no "Gather the climb\'s record" step'];
  const next = text.indexOf('\n      - ', at + 1);
  const body = text.slice(at, next < 0 ? undefined : next);
  const measure = text.indexOf('node scripts/keel/improve.mjs --report');
  if (measure >= 0 && at > measure) out.push('the climb record is gathered after improve wrote the page');
  if (!/gh api "repos\/\$REPO\/actions\/artifacts\?name=keel-climb&/.test(body)) out.push('the climb record is not read by name');
  if (!/head_branch == \\"\$BASE\\"/.test(body) || !/BASE: \$\{\{ github\.event\.repository\.default_branch \}\}/.test(body)) out.push('climb records from other branches are read');
  if (/gh api[^\n]*(-X|--method|-f |-F |--field|--input)/.test(body)) out.push('the climb read writes to GitHub');
  if (!/unzip -o -q [^\n]* -d \.keel\/climb\n/.test(body)) out.push('the record is not unpacked into .keel/climb, where improve reads it');
  if (/exit 1/.test(body)) out.push('a missing climb record must never be red');
  return out;
}

test('the night gathers the newest keel-climb record, read-only, from the default branch, before improve writes the health page', async () => {
  const w = (await shipped()).find(x => x.name === 'keel-night.yml');
  assert.deepEqual(climbGatherProblems(w.template), []);
  assert.deepEqual(climbGatherProblems(await readFile(join(KEEL, w.path), 'utf8')), [], "keel's keel-night.yml");
  const t = w.template;
  const step = /\n {6}- name: Gather the climb's record\n[\s\S]*?(?=\n {6}# Before the drain)/.exec(t)[0];
  for (const [why, text] of [
    ['any branch\'s record', t.replace(' | select(.workflow_run.head_branch == \\"$BASE\\")] | sort_by(.created_at) | reverse | .[:1]', '] | sort_by(.created_at) | reverse | .[:1]')],
    ['a write in the read', t.replace('gh api "repos/$REPO/actions/artifacts/$id/zip" > "$RUNNER_TEMP/climb-', 'gh api -X DELETE "repos/$REPO/actions/artifacts/$id/zip" > "$RUNNER_TEMP/climb-')],
    ['unpacked elsewhere', t.replace('-d .keel/climb\n', '-d .keel/elsewhere\n')],
    ['gathered after the measure', t.replace(step, '').replace('\n      - name: Keep the test ledger', `${step}\n      - name: Keep the test ledger`)],
    ['no gather at all', t.replace(step, '')],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    assert.ok(climbGatherProblems(text).length, `${why}: expected a problem`);
  }
});

/**
 * Every action used at two majors across the given workflows (phase 40's
 * retro: a builder wrote upload-artifact@v6 from memory while keel was on
 * v7). `files` is [{ file, text }]; v7 and v7.0.1 agree, v6 and v7 do not; a
 * ref that is not a version (a SHA, a branch) is left alone. [string].
 */
export function actionMajorProblems(files) {
  const seen = new Map(); // owner/repo → Map(major → Set(file))
  for (const { file, text } of files) {
    for (const { line } of code(text)) {
      const m = /^\s*(?:-\s+)?uses:\s*["']?([\w.-]+\/[\w.-]+)(?:\/[^@\s"']*)?@v?(\d+)(?:\.[\w.-]*)?["']?\s*$/.exec(line);
      if (!m) continue;
      const [, action, major] = m;
      if (!seen.has(action)) seen.set(action, new Map());
      const majors = seen.get(action);
      if (!majors.has(major)) majors.set(major, new Set());
      majors.get(major).add(file);
    }
  }
  const out = [];
  for (const [action, majors] of seen) {
    if (majors.size < 2) continue;
    const parts = [...majors].sort(([a], [b]) => a - b).map(([v, fs]) => `v${v} in ${[...fs].sort().join(', ')}`);
    out.push(`${action} is used at ${majors.size} majors: ${parts.join('; ')}`);
  }
  return out;
}

test('one major version per action across every workflow keel ships and keel\'s rendered copies', async () => {
  const files = (await shipped()).map(w => ({ file: `practices/${w.practice}/files/${w.path}`, text: w.template }));
  for (const n of (await readdir(join(KEEL, '.github/workflows'))).filter(n => /\.ya?ml$/.test(n))) {
    files.push({ file: `.github/workflows/${n}`, text: await readFile(join(KEEL, '.github/workflows', n), 'utf8') });
  }
  assert.ok(files.some(f => /uses: actions\/upload-artifact@v\d/.test(f.text)), 'no workflow uses upload-artifact; the mutation below would prove nothing');
  assert.deepEqual(actionMajorProblems(files), []);
  // v7 and v7.0.1 agree.
  assert.deepEqual(actionMajorProblems([{ file: 'a.yml', text: '      - uses: actions/checkout@v7\n' }, { file: 'b.yml', text: '        uses: actions/checkout@v7.0.1\n' }]), []);
  // Mutation: one template on another major fails, naming the action and both files.
  const i = files.findIndex(f => /uses: actions\/upload-artifact@v\d+/.test(f.text));
  const mutated = files.map((f, j) => j === i ? { ...f, text: f.text.replace(/uses: actions\/upload-artifact@v\d+/, 'uses: actions/upload-artifact@v6') } : f);
  assert.notDeepEqual(mutated[i].text, files[i].text, 'the mutation did not apply');
  const p = actionMajorProblems(mutated);
  assert.equal(p.length, 1, p.join('\n'));
  assert.match(p[0], /^actions\/upload-artifact is used at 2 majors: v6 in /);
  assert.ok(p[0].includes(files[i].file), p[0]);
});

// ---- phase 42: cross-review -------------------------------------------------------

/**
 * A GitHub Actions expression, evaluated against `ctx` ({ github: {...} }):
 * the subset keel's job conditions use. Literals ('…', numbers, true, false,
 * null), property paths, ! && || == != and parentheses, and startsWith,
 * endsWith, contains and fromJSON. As GitHub does: == on strings ignores
 * case, a missing property is null, and null, false, 0 and '' are falsy.
 * With { value: true }, the value itself (a concurrency group's), and format.
 * The object filter `.*` (phase 54: labels.*.name) maps what follows over a list.
 */
export function evalExpression(source, ctx, { value = false } = {}) {
  const tokens = [];
  const re = /\s*(?:('(?:[^']|'')*')|(\d+(?:\.\d+)?)|(&&|\|\||==|!=|!|\(|\)|,|\.|\[|\]|\*)|([A-Za-z_][\w-]*))/y;
  let at = 0;
  const src = source.replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, '$1').trim();
  while (at < src.length) {
    re.lastIndex = at;
    const m = re.exec(src);
    if (!m) throw new Error(`cannot read the expression at: ${src.slice(at, at + 20)}`);
    at = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ str: m[1].slice(1, -1).replace(/''/g, "'") });
    else if (m[2] !== undefined) tokens.push({ num: Number(m[2]) });
    else if (m[3] !== undefined) tokens.push({ op: m[3] });
    else tokens.push({ id: m[4] });
    while (at < src.length && /\s/.test(src[at])) at++;
  }
  let i = 0;
  const peek = () => tokens[i], op = o => tokens[i]?.op === o && ++i;
  const need = o => { if (!op(o)) throw new Error(`expected ${o}`); };
  const truthy = v => !(v === null || v === undefined || v === false || v === 0 || v === '');
  const eq = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : (a ?? null) === (b ?? null));
  const str = v => (v === null || v === undefined ? '' : String(v));
  const fns = {
    startsWith: (a, b) => str(a).toLowerCase().startsWith(str(b).toLowerCase()),
    endsWith: (a, b) => str(a).toLowerCase().endsWith(str(b).toLowerCase()),
    contains: (a, b) => (Array.isArray(a) ? a.some(x => eq(x, b)) : str(a).toLowerCase().includes(str(b).toLowerCase())),
    fromJSON: a => JSON.parse(a),
    format: (f, ...args) => str(f).replace(/\{(\d+)\}/g, (_, n) => str(args[Number(n)])),
  };
  const primary = () => {
    const t = tokens[i++];
    if (!t) throw new Error('unexpected end');
    if (t.op === '(') { const v = or(); need(')'); return v; }
    if (t.str !== undefined) return t.str;
    if (t.num !== undefined) return t.num;
    if (t.id === 'true') return true;
    if (t.id === 'false') return false;
    if (t.id === 'null') return null;
    if (t.id && peek()?.op === '(') {
      if (!fns[t.id]) throw new Error(`unknown function ${t.id}`);
      i++;
      const args = [];
      if (!op(')')) { do args.push(or()); while (op(',')); need(')'); }
      return fns[t.id](...args);
    }
    if (!t.id) throw new Error(`unexpected ${JSON.stringify(t)}`);
    let v = ctx[t.id] ?? null, spread = false;
    for (;;) {
      if (op('.')) {
        if (op('*')) { v = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []; spread = true; continue; }
        const k = tokens[i++]?.id;
        v = spread ? v.map(x => x?.[k] ?? null) : v?.[k] ?? null;
      }
      else if (op('[')) { const k = or(); need(']'); v = v?.[k] ?? null; }
      else return v;
    }
  };
  const unary = () => (op('!') ? !truthy(unary()) : cmp());
  const cmp = () => {
    const a = primary();
    if (op('==')) return eq(a, primary());
    if (op('!=')) return !eq(a, primary());
    return a;
  };
  const and = () => { let v = unary(); while (op('&&')) { const r = unary(); v = truthy(v) ? r : v; } return v; };
  const or = () => { let v = and(); while (op('||')) { const r = and(); v = truthy(v) ? v : r; } return v; };
  const v = or();
  if (i !== tokens.length) throw new Error(`unread: ${JSON.stringify(tokens.slice(i))}`);
  return value ? v : truthy(v);
}

/** The one job's `if:` in a workflow's text (a block scalar or one line), or null. */
export function jobIf(text) {
  const m = /\n {4}if: \|\n((?: {6}.*\n)+)/.exec(text) ?? /\n {4}if: (.+)\n/.exec(text);
  return m ? m[1].replace(/\n$/, '') : null;
}

const ACME = 'acme/anvils';
/** A synthetic event as the job's `if:` reads it. */
const ghEvent = (event_name, event) => ({ github: { event_name, repository: ACME, event: { repository: { full_name: ACME, default_branch: 'main' }, ...event } } });
const prEvent = ({ action = 'opened', repo = ACME, draft = false, ref = 'codex/anvil-lid' } = {}) => ghEvent('pull_request', { action, pull_request: { number: 7, draft, head: { ref, repo: { full_name: repo } } } });
const commentEvent = ({ body = '/review', association = 'OWNER', login = 'acme-owner', type = 'User', pr = true } = {}) =>
  ghEvent('issue_comment', { action: 'created', issue: { number: 7, ...(pr ? { pull_request: { url: `https://api.github.com/repos/${ACME}/pulls/7` } } : {}) }, comment: { body, author_association: association, user: { login, type } } });

/**
 * The cross-review workflow's own rules (phase 42), on its text: [string].
 * Triggers: pull_request opened and ready_for_review, issue_comment created;
 * never a push, a synchronize or pull_request_target. The agent's tools are
 * read-only plus the inline-comment tool, and no Bash beyond gh pr diff and
 * gh pr view; the token cannot write contents; the only write is the summary
 * review, posted from the script's JSON (event COMMENT); nothing approves,
 * requests changes, merges or pushes; the agent is time-boxed by the budget.
 */
export const CROSS_REVIEW_TOOLS = Object.freeze(['Read', 'Grep', 'Glob', 'Bash(gh pr diff:*)', 'Bash(gh pr view:*)']);

/** A workflow's steps, each its text from `- ` to the next step at the same indent. */
export function stepsOf(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)- /.exec(lines[i]);
    if (!m || /^\s*#/.test(lines[i])) continue;
    const indent = m[1].length;
    // A step is a list item under `steps:` (jobs' items are deeper than 2 spaces).
    let k = i - 1;
    while (k >= 0 && (!lines[k].trim() || /^\s*#/.test(lines[k]) || /^(\s*)/.exec(lines[k])[1].length > indent)) k--;
    if (!(k >= 0 && (new RegExp(`^\\s{${indent - 2}}steps:\\s*$`).test(lines[k]) || new RegExp(`^\\s{${indent}}- `).test(lines[k])))) continue;
    const body = [lines[i]];
    let j = i + 1;
    for (; j < lines.length && !(lines[j].trim() && !/^\s*#/.test(lines[j]) && /^(\s*)/.exec(lines[j])[1].length <= indent); j++) body.push(lines[j]);
    out.push(body.join('\n').replace(/(\n\s*(#.*)?)+$/, ''));
  }
  return out;
}

/** A step's `key: value` under `with:` or `env:` (one line each), as a map. */
export function stepMap(step, block) {
  const m = new RegExp(`\\n(\\s+)${block}:\\n((?:\\1 {2}.*\\n?)+)`).exec(step);
  if (!m) return {};
  return Object.fromEntries(m[2].split('\n').filter(Boolean).map(l => /^\s*([\w-]+):\s*(.*)$/.exec(l)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^"(.*)"$/, '$1')]));
}

/**
 * Every rule a Codex agent step breaks (keel phase 45): [string]. Each step
 * that uses openai/codex-action is the agent's: time-boxed by a budget,
 * continue-on-error (its check step says whether it ran), in the sandbox the
 * pass allows (`sandbox`: read-only for a pass that reads), with sudo dropped
 * (never unsafe: the key would be in reach), no GitHub token, nobody but a
 * writer able to start it (no allow-users, allow-bots, allow-bot-users), and
 * no way around the inputs (no codex-args, permission-profile or codex-home).
 */
export function codexStepProblems(text, { sandbox }) {
  const out = [];
  for (const step of stepsOf(text).filter(st => /\n\s+uses:\s*openai\/codex-action@/.test(`\n${st}`))) {
    const name = /name:\s*(.+)/.exec(step)?.[1] ?? '(unnamed)';
    const w = stepMap(step, 'with'), env = stepMap(step, 'env');
    if (!/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.[\w-]+\.outputs\.minutes\) \}\}/.test(step)) out.push(`${name}: Codex's step is not time-boxed by the budget`);
    if (!/\n\s+continue-on-error: true/.test(step)) out.push(`${name}: Codex's step is not continue-on-error, so its check never says whether it ran`);
    if (w.sandbox !== sandbox) out.push(`${name}: Codex's sandbox is ${w.sandbox ?? '(the action\'s default, workspace-write)'}, not ${sandbox}`);
    if (w['safety-strategy'] !== 'drop-sudo') out.push(`${name}: Codex's safety-strategy is ${w['safety-strategy'] ?? '(unset)'}, not drop-sudo: with sudo it can read its key`);
    for (const k of ['allow-users', 'allow-bots']) if (k in w) out.push(`${name}: ${k} lets someone without write access start Codex`);
    // ledger#101, duo#84: providers' bots open the PRs Codex reviews; only the adapters' logins (lib.mjs AGENTS), by name.
    if ('allow-bot-users' in w) out.push(...botListProblems(`${name}: allow-bot-users`, w['allow-bot-users']));
    for (const k of ['codex-args', 'permission-profile', 'codex-home', 'codex-user']) if (k in w) out.push(`${name}: ${k} is a way around the sandbox inputs`);
    if (/danger-full-access|\bunsafe\b/.test(step)) out.push(`${name}: danger-full-access or unsafe`);
    if (env.GH_TOKEN !== '') out.push(`${name}: Codex's step does not blank GH_TOKEN, so it holds the job's token`);
    // Its sandbox may write $TMPDIR: never the runner's temp (GITHUB_ENV, GITHUB_OUTPUT: every later step) nor .git.
    if (!env.TMPDIR) out.push(`${name}: Codex's step does not pin TMPDIR, which its sandbox may write`);
    else if (!/^\/tmp\/[\w.-]+$/.test(env.TMPDIR) || /runner\.temp|RUNNER_TEMP|\.git\b/.test(env.TMPDIR)) out.push(`${name}: Codex's TMPDIR is ${env.TMPDIR}: only a folder of its own under /tmp, never the runner's temp or .git`);
    else {
      const all = stepsOf(text);
      if (!all.slice(0, all.indexOf(step)).some(s => s.includes(`mkdir -p ${env.TMPDIR}`))) out.push(`${name}: no step before it makes its TMPDIR (${env.TMPDIR})`);
    }
    for (const [, sec] of step.matchAll(/secrets\.([A-Za-z_]\w*)/g)) if (sec !== 'OPENAI_API_KEY') out.push(`${name}: Codex's step is given secrets.${sec}`);
    if (!/\n\s+output-file: \$\{\{ runner\.temp \}\}\//.test(step)) out.push(`${name}: Codex's final message is not written to the runner's temp (output-file), where its check reads it`);
  }
  return out;
}

/** The adapters' bot logins (lib.mjs AGENTS login): the only bots an agent step may let start it. */
export const ADAPTER_LOGINS = Object.freeze(Object.values(AGENTS).map(a => a.login).filter(Boolean));
/** What is wrong with a comma list of bots an action lets start it: anything but an adapter's login. */
export function botListProblems(where, value) {
  return String(value ?? '').split(',').map(x => x.trim()).filter(login => !ADAPTER_LOGINS.includes(login))
    .map(login => `${where} names ${login || '(nothing)'}: only the providers' bots (${ADAPTER_LOGINS.join(', ')})`);
}

export function crossReviewProblems(text) {
  const out = [];
  // duo#84: Claude's step lets a provider's bot open the PR it reviews (its own, the fallback): the adapters' logins only.
  const claudeStep = stepsOf(text).find(st => /\n\s+uses:\s*anthropics\/claude-code-action@/.test(`\n${st}`)) ?? '';
  const claudeWith = stepMap(claudeStep, 'with');
  if ('allowed_bots' in claudeWith) out.push(...botListProblems('Review: allowed_bots', claudeWith.allowed_bots));
  const on = /\non:\n((?: {2}.*\n)+)/.exec(text)?.[1] ?? '';
  const events = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map(m => m[1]);
  // Phase 60: "after": "push" adds exactly a push to main and the daily run (lib/practices.mjs shapeCrossReview), nothing else.
  const after = events.join(',') === 'pull_request,issue_comment,push,schedule';
  if (events.join(',') !== 'pull_request,issue_comment' && !after) out.push(`triggers are ${events.join(', ') || 'none'}; only pull_request and issue_comment (and, after the push, push and schedule)`);
  if (after && !on.endsWith(PUSH_TRIGGERS)) out.push(`the push triggers are not exactly ${JSON.stringify(PUSH_TRIGGERS)}: a push to main, and once a day`);
  const types = name => /types: \[([^\]]*)\]/.exec(on.split(new RegExp(`^ {2}${name}:`, 'm'))[1]?.split(/^ {2}\S/m)[0] ?? '')?.[1].split(',').map(s => s.trim());
  if (JSON.stringify(types('pull_request')) !== JSON.stringify(['opened', 'ready_for_review'])) out.push(`pull_request types ${JSON.stringify(types('pull_request'))}: only opened and ready_for_review, never a push`);
  if (JSON.stringify(types('issue_comment')) !== JSON.stringify(['created'])) out.push('issue_comment types: only created');
  const tools = /--allowedTools "([^"]*)"/.exec(text)?.[1];
  if (!tools) out.push('the agent has no --allowedTools list');
  else for (const t of tools.split(',').map(s => s.trim())) if (!CROSS_REVIEW_TOOLS.includes(t)) out.push(`the agent may use ${t}: only ${CROSS_REVIEW_TOOLS.join(', ')}`);
  if ((text.match(/--allowedTools/g) ?? []).length !== 1 || /--(?:dangerously-skip-permissions|permission-mode)/.test(text)) out.push('one --allowedTools list, and no way around it');
  // keel#65: Claude reads the push's diff from a folder of its own (the Brief step writes it there), granted alone; no other directory.
  const addDirs = code(text).flatMap(({ line }) => [...line.matchAll(/--add-dir[ \t]+(.+?)[ \t]*$/g)].map(m => m[1]));
  if (JSON.stringify(addDirs) !== JSON.stringify(['${{ runner.temp }}/keel-diff'])) out.push(`Claude may read ${addDirs.join(', ') || 'no folder'} beyond the checkout: only the push diff's own folder, \${{ runner.temp }}/keel-diff`);
  if (!/cp "\$RUNNER_TEMP\/pr\.diff" "\$RUNNER_TEMP\/keel-diff\/push\.diff"/.test(text) || !/brief --push "\$RUNNER_TEMP\/push\.json" --agent "\$AGENT" --diff "\$RUNNER_TEMP\/keel-diff\/push\.diff"/.test(text)) out.push('the push\'s brief does not point the agent at the diff in the folder it may read');
  // Phase 46: each job asks for its own (crossReviewSandboxProblems holds which); no job may write contents or actions.
  if (!/^permissions: \{\}$/m.test(text)) out.push('the workflow\'s permissions must be {}: each job asks for its own');
  if (/:\s*write-all|contents: write|actions: write/.test(text)) out.push('the token may write contents or actions');
  for (const { line, n } of code(text)) {
    if (/\bgit push\b|\bgh pr (merge|review|close|edit)\b|\bAPPROVE\b|REQUEST_CHANGES|--approve|--request-changes/.test(line)) out.push(`line ${n}: pushes, merges, approves or requests changes: ${line.trim()}`);
    // Phase 60 (keel#65): the publish job's own reads of GitHub's compare, and a start's label, issue and close; each exactly.
    const PUSH_API = [
      /^\s*gh api -H "Accept: application\/vnd\.github\.raw" "repos\/\$REPO\/contents\/scripts\/keel\/(?:cross-review|lib)\.mjs\?ref=\$SHA" > "\$out\/(?:cross-review|lib)\.mjs"$/,
      /^\s*gh api "repos\/\$REPO\/compare\/\$STARTAT\.\.\.\$SHA" > "\$RUNNER_TEMP\/start-below\.json"$/,
      /^\s*had=\$\(gh api "repos\/\$REPO\/issues\?labels=keel:review-after&state=all&per_page=1" --jq 'length'\)$/,
      /^\s*gh api --method POST "repos\/\$REPO\/labels" -f name=keel:review-after -f color=5319e7 > \/dev\/null 2>&1 \|\| true$/,
      /^\s*gh api --method POST "repos\/\$REPO\/issues" --input "\$RUNNER_TEMP\/start\.json" > "\$RUNNER_TEMP\/started\.json"$/,
      /^\s*gh api --method PATCH "repos\/\$REPO\/issues\/\$number" -f state=closed -f state_reason=completed > \/dev\/null$/,
    ];
    if (/\bgh api\b/.test(line) && !/^\s*(?:if ! )?gh api --method POST "repos\/\$REPO\/pulls\/\$PR\/reviews" --input "\$RUNNER_TEMP\/review(?:-plain)?\.json" --jq '[^']*'(?:; then)?$/.test(line) && !PUSH_API.some(re => re.test(line))) out.push(`line ${n}: a gh api call other than the summary review: ${line.trim()}`);
  }
  if (!/node scripts\/keel\/cross-review\.mjs summary [^\n]*--out "\$RUNNER_TEMP\/review\.json"/.test(text)) out.push('the summary review is not the script\'s (cross-review.mjs summary): its event would be the workflow\'s to get wrong');
  const reviewStep = /\n {6}- name: Review\n[\s\S]*?(?=\n {6}(?:#|- )|$)/.exec(text)?.[0] ?? '';
  if (!/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.which\.outputs\.minutes\) \}\}\n/.test(reviewStep) || !/\n\s+uses: anthropics\/claude-code-action@v\d+\n/.test(reviewStep)) out.push('the agent\'s step is not time-boxed by the budget (steps.which.outputs.minutes)');
  // Phase 45: one agent step per provider, each run only when the config names it; Codex's in its read-only sandbox.
  const agents = stepsOf(text).filter(st => /\n\s+uses:\s*(?:anthropics\/claude-code-action|openai\/codex-action)@/.test(`\n${st}`));
  for (const [provider, action] of [['claude', 'anthropics/claude-code-action'], ['codex', 'openai/codex-action']]) {
    const mine = agents.filter(st => st.includes(`uses: ${action}@`));
    if (mine.length !== 1) out.push(`${mine.length} ${provider} steps; one`);
    else if (!mine[0].includes(`\n        if: steps.which.outputs.review == 'true' && steps.which.outputs.agent == '${provider}'\n`)) out.push(`the ${provider} step does not run only when the config names ${provider}`);
  }
  out.push(...codexStepProblems(text, { sandbox: 'read-only' }));
  if (/pull_request_target/.test(text)) out.push('pull_request_target runs a fork\'s PR with this repo\'s secrets');
  return out;
}

test('keel-cross-review.yml runs only for a same-repo PR opened or made ready, or a person\'s /review on a PR; a fork, a draft, a bot or anyone without write access does nothing', async () => {
  const t = (await shipped()).find(w => w.name === 'keel-cross-review.yml').template;
  const cond = jobIf(t);
  assert.ok(cond, 'the job has an if:');
  const runs = ctx => evalExpression(cond, ctx);
  assert.equal(runs(prEvent()), true, 'a same-repo PR');
  assert.equal(runs(prEvent({ action: 'ready_for_review' })), true);
  assert.equal(runs(prEvent({ repo: 'mallory/anvils' })), false, 'a fork');
  assert.equal(runs(prEvent({ draft: true })), false, 'a draft');
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) assert.equal(runs(commentEvent({ association })), true, association);
  assert.equal(runs(commentEvent({ body: '/review\nthe lid, please' })), true);
  assert.equal(runs(commentEvent({ type: 'Bot', login: 'codex[bot]', association: 'MEMBER' })), false, 'a bot\'s /review');
  assert.equal(runs(commentEvent({ type: 'User', login: 'acme-ci[bot]', association: 'MEMBER' })), false, 'a [bot] login');
  assert.equal(runs(commentEvent({ association: 'CONTRIBUTOR' })), false, 'no write access');
  assert.equal(runs(commentEvent({ association: 'NONE' })), false);
  assert.equal(runs(commentEvent({ pr: false })), false, '/review on an issue');
  assert.equal(runs(commentEvent({ body: 'LGTM' })), false, 'another comment');
  assert.equal(runs(ghEvent('push', {})), false);
  // The branch prefix is the config's, read at run time: every step of the review job after "Which pull request?" waits on it
  // (the publish job runs only when the review job's agent ran: crossReviewSandboxProblems).
  const steps = jobsOf(t).find(j => j.id === 'review').text.split(/\n(?= {6}- )/).filter(s => /^ {6}- /.test(s));
  const which = steps.findIndex(s => s.includes('- name: Which pull request or push?'));
  assert.ok(which > 0);
  assert.match(steps[which], /node scripts\/keel\/cross-review\.mjs which --pr "\$RUNNER_TEMP\/pr\.json" --event "\$EVENT"/);
  for (const s of steps.slice(which + 1)) assert.match(s, /\n {8}if: steps\.which\.outputs\.review == 'true'(?: && steps\.which\.outputs\.agent == '(?:claude|codex)')?\n/, s.split('\n')[0]);
  assert.deepEqual(crossReviewProblems(t), []);
  // The evaluator itself: each guard in the if: is load-bearing.
  for (const [why, from, to, ctx] of [
    ['no fork check', "github.event.pull_request.head.repo.full_name == github.repository &&\n", '', prEvent({ repo: 'mallory/anvils' })],
    ['no draft check', "&&\n        github.event.pull_request.draft == false", '', prEvent({ draft: true })],
    ['no bot check', "github.event.comment.user.type != 'Bot' &&\n        !endsWith(github.event.comment.user.login, '[bot]'))", 'true)', commentEvent({ type: 'Bot', login: 'codex[bot]', association: 'MEMBER' })],
    ['no association check', "contains(fromJSON('[\"OWNER\", \"MEMBER\", \"COLLABORATOR\"]'), github.event.comment.author_association) &&\n", '', commentEvent({ association: 'NONE' })],
    ['any association', '"COLLABORATOR"]', '"COLLABORATOR", "CONTRIBUTOR", "NONE"]', commentEvent({ association: 'NONE' })],
    ['any comment', "startsWith(github.event.comment.body, '/review') &&\n", '', commentEvent({ body: 'LGTM' })],
    ['an issue', 'github.event.issue.pull_request &&\n', '', commentEvent({ pr: false })],
  ]) {
    const mutated = cond.replace(from, to);
    assert.notEqual(mutated, cond, `${why}: the mutation did not apply`);
    assert.equal(evalExpression(mutated, ctx), true, `${why}: the mutated condition should let it through`);
    assert.equal(runs(ctx), false, why);
  }
});

/**
 * The cross-review concurrency group for one event: the group string, as
 * GitHub evaluates `keel-cross-review-${{ … }}`.
 */
export function crossReviewGroup(text, ctx) {
  const m = /^concurrency:\n {2}group: (.*)\n {2}cancel-in-progress: false$/m.exec(text);
  if (!m) throw new Error('no concurrency group with cancel-in-progress: false');
  return m[1].replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e) => String(evalExpression(e, ctx, { value: true }) ?? ''));
}

test('phase 60: a push to main triggers a review only with "after": "push" (the template, and every project without it, has no push trigger); then a push to the default branch and the daily run, coalescing in one group', async () => {
  const w = (await shipped()).find(x => x.name === 'keel-cross-review.yml');
  const t = w.template;
  const on = text => [...(/\non:\n((?: {2}.*\n)+)/.exec(text)?.[1] ?? '').matchAll(/^ {2}([a-z_]+):/gm)].map(m => m[1]);
  const base = { name: 'Acme', tagline: 'Anvils, dropped on time.', repo: ACME };
  assert.deepEqual(on(t), ['pull_request', 'issue_comment'], 'the template');
  for (const crossReview of [{ for: ['codex/'] }, { for: ['codex/', 'claude/'], budget: { minutes: 20 } }]) {
    const without = fill(t, { ...base, crossReview }, CROSS_REVIEW_WORKFLOW);
    assert.equal(without, t, 'no "after": the template\'s bytes, no push trigger');
  }
  // keel's own rendered copy: keel reviews its PRs, not its pushes.
  assert.deepEqual(on(await readFile(join(KEEL, CROSS_REVIEW_WORKFLOW), 'utf8')), ['pull_request', 'issue_comment']);
  const shaped = fill(t, { ...base, crossReview: { after: 'push' } }, CROSS_REVIEW_WORKFLOW);
  assert.deepEqual(on(shaped), ['pull_request', 'issue_comment', 'push', 'schedule']);
  assert.ok(shaped.includes("\n  push:\n    branches: [main]\n  schedule:\n    - cron: '41 4 * * *'\n\n"), 'a push to main, and once a day for the pushes that waited past the budget');
  assert.deepEqual(crossReviewProblems(shaped), []);
  assert.deepEqual(crossReviewSandboxProblems(shaped), []);
  assert.deepEqual(problems('keel-cross-review.yml', shaped, w.declared), []);
  // The job's if: a push to the default branch, and the daily run; never another branch or a tag.
  const cond = jobIf(t);
  const push = (ref = 'refs/heads/main') => ({ github: { event_name: 'push', ref, repository: ACME, event: { repository: { full_name: ACME, default_branch: 'main' }, before: 'a'.repeat(40), after: 'b'.repeat(40) } } });
  assert.equal(evalExpression(cond, push()), true, 'a push to main');
  assert.equal(evalExpression(cond, push('refs/heads/acme-feature')), false, 'a push to another branch');
  assert.equal(evalExpression(cond, push('refs/tags/v1.0.0')), false, 'a tag');
  assert.equal(evalExpression(cond, ghEvent('schedule', {})), true, 'the daily run');
  assert.equal(evalExpression(cond.replace("github.ref == format('refs/heads/{0}', github.event.repository.default_branch)", 'true'), push('refs/heads/acme-feature')), true, 'the branch check is load-bearing');
  // One group for every push and the daily run: GitHub keeps one pending run, so pushes during a review coalesce into it.
  const group = (ctx, id) => crossReviewGroup(t, { ...ctx, github: { ...ctx.github, run_id: id } });
  assert.equal(group(push(), 301), 'keel-cross-review-after-push');
  assert.equal(group(push(), 302), group(ghEvent('schedule', {}), 303));
  assert.equal(group(prEvent(), 304), 'keel-cross-review-7', 'a PR keeps its own queue');
  assert.equal(group(commentEvent({ body: 'LGTM' }), 305), 'keel-cross-review-run-305');
  // Mutations: the shaped triggers widened are refused.
  for (const [why, text] of [
    ['any branch', shaped.replace('    branches: [main]\n', "    branches: ['**']\n")],
    ['tags too', shaped.replace('    branches: [main]\n', '    branches: [main]\n    tags: [v*]\n')],
    ['every hour', shaped.replace("'41 4 * * *'", "'41 * * * *'")],
    ['a push alone, on any branch', t.replace('  issue_comment:\n    types: [created]\n', '  issue_comment:\n    types: [created]\n  push:\n')],
    ['workflow_run', shaped.replace('  schedule:\n', '  workflow_run:\n    workflows: [check]\n  schedule:\n')],
  ]) {
    assert.notEqual(text, shaped, `${why}: the mutation did not apply`);
    assert.ok(crossReviewProblems(text).length, `${why}: expected a problem`);
  }
});

test('keel-cross-review.yml: reviews of one PR queue behind each other; a run that will not review has a group of its own, so it never displaces a queued /review', async () => {
  const t = (await shipped()).find(w => w.name === 'keel-cross-review.yml').template;
  const withRun = (ctx, id) => ({ ...ctx, github: { ...ctx.github, run_id: id } });
  const group = (ctx, id = 101) => crossReviewGroup(t, withRun(ctx, id));
  assert.equal(group(prEvent()), 'keel-cross-review-7', 'an opened PR');
  assert.equal(group(prEvent({ action: 'ready_for_review' }), 102), 'keel-cross-review-7');
  assert.equal(group(commentEvent(), 103), 'keel-cross-review-7', 'a person\'s /review queues with them');
  assert.equal(group(commentEvent({ body: '/review\nthe lid, please' }), 104), 'keel-cross-review-7');
  // ledger#92: a later comment replaced a queued /review, then skipped. Each of these is alone.
  assert.equal(group(commentEvent({ body: 'Deployment ready (acme-preview)', type: 'Bot', login: 'acme-deploy[bot]' }), 105), 'keel-cross-review-run-105', 'a bot\'s comment');
  assert.equal(group(commentEvent({ body: 'LGTM' }), 106), 'keel-cross-review-run-106', 'a person\'s other comment');
  assert.equal(group(commentEvent({ body: '/review', type: 'Bot', login: 'codex[bot]', association: 'MEMBER' }), 107), 'keel-cross-review-run-107', 'a bot\'s /review never runs, so never queues');
  assert.notEqual(group(commentEvent({ body: 'LGTM' }), 108), group(commentEvent({ body: 'LGTM' }), 109), 'two other comments never share a group');
  // Every event the job's if: lets through queues on the PR's group: the group never splits real reviews.
  const cond = jobIf(t);
  for (const ctx of [prEvent(), prEvent({ action: 'ready_for_review' }), commentEvent(), commentEvent({ association: 'MEMBER' })]) {
    assert.equal(evalExpression(cond, ctx), true);
    assert.equal(group(ctx, 110), 'keel-cross-review-7');
  }
  // Codex on ledger#93: a /review the job will skip (no write access, a fork, a draft) never joins the PR's group.
  // The rule: the PR's group exactly when the job's if: lets the event through.
  const events = [prEvent(), prEvent({ action: 'ready_for_review' }), commentEvent(), commentEvent({ association: 'MEMBER' }), commentEvent({ association: 'OWNER' }),
    commentEvent({ association: 'CONTRIBUTOR' }), commentEvent({ association: 'NONE' }), commentEvent({ association: 'FIRST_TIME_CONTRIBUTOR' }),
    commentEvent({ body: 'LGTM' }), commentEvent({ body: '/review', type: 'Bot', login: 'codex[bot]', association: 'MEMBER' }), commentEvent({ body: '/review', login: 'acme-helper[bot]' }),
    prEvent({ repo: 'someone/acme-fork' }), prEvent({ draft: true })];
  for (const [i, ctx] of events.entries()) assert.equal(group(ctx, 200 + i) === 'keel-cross-review-7', evalExpression(cond, ctx) === true, JSON.stringify(ctx.github.event?.comment ?? ctx.github.event?.action));
  assert.equal(group(commentEvent({ association: 'NONE' }), 220), 'keel-cross-review-run-220', 'an outsider\'s /review is alone');
  // Mutation: the old group (the PR's number for every event) lets any comment displace a /review.
  const old = t.replace(/^( {2}group: ).*$/m, '$1keel-cross-review-${{ github.event.pull_request.number || github.event.issue.number }}');
  assert.notEqual(old, t, 'the mutation did not apply');
  assert.equal(crossReviewGroup(old, withRun(commentEvent({ body: 'LGTM' }), 111)), 'keel-cross-review-7', 'the old group puts any comment in the queue');
  assert.match(t, /^concurrency:\n {2}group: [^\n]*\n {2}cancel-in-progress: false$/m, 'queued, never cancelled');
});

test('keel-cross-review.yml: the agent reads and comments inline, nothing else; the review event is COMMENT; nothing pushes, approves or merges', async () => {
  const w = (await shipped()).find(x => x.name === 'keel-cross-review.yml');
  const t = w.template;
  assert.equal(w.practice, 'cross-review');
  assert.equal(w.optional, true);
  assert.deepEqual(w.declared.sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY']);
  assert.deepEqual(crossReviewProblems(t), []);
  assert.deepEqual(problems('keel-cross-review.yml', t, w.declared), []);
  const tools = /--allowedTools "([^"]*)"/.exec(t)[1];
  assert.deepEqual(tools.split(','), [...CROSS_REVIEW_TOOLS]);
  for (const [why, text] of [
    ['gh pr merge allowed', t.replace(tools, `${tools},Bash(gh pr merge:*)`)],
    ['any gh pr allowed', t.replace('Bash(gh pr view:*)', 'Bash(gh pr:*)')],
    ['any gh allowed', t.replace(tools, `${tools},Bash(gh *)`)],
    ['gh pr review allowed', t.replace(tools, `${tools},Bash(gh pr review:*)`)],
    ['git push allowed', t.replace(tools, `${tools},Bash(git push:*)`)],
    ['any shell', t.replace(tools, `${tools},Bash`)],
    ['Edit allowed', t.replace(tools, `${tools},Edit`)],
    ['Write allowed', t.replace(tools, `${tools},Write`)],
    ['the GitHub MCP server', t.replace(tools, `${tools},mcp__github__merge_pull_request`)],
    ['permissions bypassed', t.replace('--allowedTools', '--dangerously-skip-permissions --allowedTools')],
    ['contents: write', t.replace('  contents: read\n', '  contents: write\n')],
    ['an approval', t.replace('--input "$RUNNER_TEMP/review.json"', '--input "$RUNNER_TEMP/review.json"\n          gh pr review "$PR" --approve')],
    ['another review event', t.replace('--input "$RUNNER_TEMP/review.json"', '-f event=REQUEST_CHANGES -f body=x')],
    ['a merge', `${t}\n      - run: gh pr merge 7 --squash\n`],
    ['a push', `${t}\n      - run: git push origin HEAD:refs/heads/main\n`],
    ['the summary not the script\'s', t.replace(/node scripts\/keel\/cross-review\.mjs summary [^\n]*\n/, 'echo \'{"event":"COMMENT","body":"x"}\' > "$RUNNER_TEMP/review.json"\n')],
    ['on every push', t.replace('types: [opened, ready_for_review]', 'types: [opened, ready_for_review, synchronize]')],
    ['pull_request_target', t.replace('  pull_request:\n', '  pull_request_target:\n')],
    ['no time box', t.replace(/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.which\.outputs\.minutes\) \}\}/, '')],
    // Phase 45: findings are JSON, so the inline-comment tool is gone; and Codex's step holds the same rules.
    ['the inline-comment tool back', t.replace(tools, `${tools},mcp__github_inline_comment__create_inline_comment`)],
    ['Codex with full access', t.replace('          sandbox: read-only\n', '          sandbox: danger-full-access\n')],
    ['Codex may write the tree', t.replace('          sandbox: read-only\n', '          sandbox: workspace-write\n')],
    ['Codex on the action\'s default sandbox', t.replace('          sandbox: read-only\n', '')],
    ['Codex unsafe', t.replace('          safety-strategy: drop-sudo\n', '          safety-strategy: unsafe\n')],
    ['Codex keeps sudo', t.replace('          safety-strategy: drop-sudo\n', '')],
    ['Codex for bots', t.replace('          safety-strategy: drop-sudo\n', '          safety-strategy: drop-sudo\n          allow-bots: true\n')],
    ['Claude for any bot', t.replace('          allowed_bots: claude[bot]\n', '          allowed_bots: "*"\n')],
    // keel#65: Claude must be able to read the push's diff, and only that folder beyond the checkout.
    ['Claude cannot read the push diff', t.replace('            --add-dir ${{ runner.temp }}/keel-diff\n', '')],
    ['Claude may read the whole runner temp', t.replace('            --add-dir ${{ runner.temp }}/keel-diff\n', '            --add-dir ${{ runner.temp }}\n')],
    ['Claude may read another folder too', t.replace('            --add-dir ${{ runner.temp }}/keel-diff\n', '            --add-dir ${{ runner.temp }}/keel-diff\n            --add-dir /home/runner\n')],
    ['the push brief points elsewhere', t.replace('--diff "$RUNNER_TEMP/keel-diff/push.diff"', '--diff "$RUNNER_TEMP/pr.diff"')],
    ['Claude for another bot', t.replace('          allowed_bots: claude[bot]\n', '          allowed_bots: claude[bot],acme-deploy[bot]\n')],
    ['Codex for any bot', t.replace('          allow-bot-users: claude[bot]\n', '          allow-bot-users: "*"\n')],
    ['Codex for another bot', t.replace('          allow-bot-users: claude[bot]\n', '          allow-bot-users: claude[bot],acme-deploy[bot]\n')],
    ['Codex for a bot by an empty entry', t.replace('          allow-bot-users: claude[bot]\n', '          allow-bot-users: claude[bot],\n')],
    ['Codex for anyone', t.replace('          safety-strategy: drop-sudo\n', '          safety-strategy: drop-sudo\n          allow-users: "*"\n')],
    ['Codex args around the sandbox', t.replace('          safety-strategy: drop-sudo\n', '          safety-strategy: drop-sudo\n          codex-args: --dangerously-bypass-approvals-and-sandbox\n')],
    ['Codex holds the token', t.replace('        env:\n          GH_TOKEN: ""\n          TMPDIR: /tmp/keel-codex\n', '')],
    ['Codex\'s TMPDIR unpinned', t.replace('          TMPDIR: /tmp/keel-codex\n', '')],
    ['Codex\'s TMPDIR the runner\'s temp', t.replace('          TMPDIR: /tmp/keel-codex\n', '          TMPDIR: ${{ runner.temp }}\n')],
    ['Codex\'s TMPDIR never made', t.replace('        run: mkdir -p /tmp/keel-codex\n', '        run: true\n')],
    ['Codex given another secret', t.replace('          openai-api-key: ${{ secrets.OPENAI_API_KEY }}\n', '          openai-api-key: ${{ secrets.OPENAI_API_KEY }}\n          model: ${{ secrets.ANTHROPIC_API_KEY }}\n')],
    ['Codex not time-boxed', t.replace(/(id: review_codex\n[\s\S]*?)\n\s+timeout-minutes: [^\n]*/, '$1')],
    ['Codex runs whatever the config says', t.replace("id: review_codex\n        if: steps.which.outputs.review == 'true' && steps.which.outputs.agent == 'codex'\n", "id: review_codex\n        if: true\n")],
    ['Claude runs whatever the config says', t.replace("steps.which.outputs.agent == 'claude'\n", "true\n")],
    ['no Codex step', t.replace(/\n {6}- name: Review\n {8}id: review_codex\n[\s\S]*?(?=\n\n)/, '')],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    assert.ok(crossReviewProblems(text).length, `${why}: expected a problem`);
  }
});

/**
 * Cross-review's agent holds no credential that can write, and the job that
 * writes runs no agent (keel phase 46, as ledger#92 made climb and tend):
 * [string]. The workflow grants nothing; one job (the review job) holds every
 * agent step, Claude's and Codex's, and its permissions read (contents: read,
 * no write, no id-token), with no job-level token and no checkout keeping
 * one; Claude's action is handed that job's token (github_token), so it
 * never trades OIDC for its app's token. The review job never posts. Every
 * job that may write runs no agent, checks out only the default branch
 * (never the PR's head), needs the review job and runs only when its agent
 * ran (`ran`, set after "Did the agent run?"), and takes the agent's work as
 * the review job's artifact; the summary it posts is its own checkout's
 * cross-review.mjs.
 */
export function crossReviewSandboxProblems(text) {
  const out = [];
  const isAgent = j => /\n\s+uses: (?:anthropics\/claude-code-action|openai\/codex-action)@/.test(j.text);
  const permsOf = j => /\n {4}permissions:\n((?: {6}.*\n)+)/.exec(j.text)?.[1] ?? null;
  const stepsIn = j => j.text.split(/\n(?= {6}- )/);
  const jobs = jobsOf(text);
  const top = /^permissions:(.*)\n((?: {2}.*\n)*)/m.exec(text);
  if (!top) out.push('the workflow declares no permissions: every job would get the repo default, which may write');
  else if (/write/.test(top[1] + top[2])) out.push(`the workflow's permissions grant a write to every job: ${(top[1] + top[2]).trim()}`);
  const agents = jobs.filter(isAgent);
  if (agents.length !== 1) return [...out, `${agents.length} jobs run an agent; one, the review job, holds both providers' steps`];
  const agent = agents[0];
  for (const action of ['anthropics/claude-code-action', 'openai/codex-action']) if (!agent.text.includes(`uses: ${action}@`)) out.push(`the agent's job (${agent.id}) has no ${action} step`);
  const perms = permsOf(agent);
  if (perms === null) out.push(`the agent's job (${agent.id}) declares no permissions of its own`);
  else {
    for (const line of perms.split('\n').filter(Boolean)) if (/:\s*write/.test(line)) out.push(`the agent's job may write: ${line.trim()}`);
    if (!/^ {6}contents: read$/m.test(perms)) out.push('the agent\'s job must say contents: read');
  }
  if (/\n {4}permissions:\s*(?:write-all|read-all)/.test(agent.text)) out.push('the agent\'s job takes a blanket permission');
  const jobEnv = /\n {4}env:\n((?: {6}.*\n)+)/.exec(agent.text)?.[1] ?? '';
  if (/GH_TOKEN|GITHUB_TOKEN/.test(jobEnv)) out.push('the agent\'s job sets a token for every step (job-level env)');
  const checkouts = stepsIn(agent).filter(st => /uses: actions\/checkout@/.test(st));
  if (!checkouts.length) out.push('the agent\'s job has no checkout');
  for (const c of checkouts) if (!/\n {10}persist-credentials: false(?:\n|$)/.test(c)) out.push('a checkout in the agent\'s job keeps the token in git (persist-credentials: false)');
  // keel#65: after a push the review job runs the event's commit, the one the publisher is checked at, never
  // whatever the default branch's tip is when the job starts (a later push could change the scripts it runs).
  if (checkouts.length && !checkouts[0].includes("\n          ref: ${{ (github.event_name == 'push' || github.event_name == 'schedule') && github.sha || github.event.repository.default_branch }}\n")) out.push('the review job checks out the default branch\'s tip after a push, not the event\'s commit the publisher is checked at (github.sha)');
  const claude = stepsIn(agent).find(st => /uses: anthropics\/claude-code-action@/.test(st)) ?? '';
  if (!/\n {10}github_token: \$\{\{ github\.token \}\}\n/.test(claude)) out.push('claude-code-action is not handed the job\'s token (github_token), so it trades OIDC for its app\'s token, which can write');
  const posts = j => code(j.text).some(({ line }) => /\bgh api\b[^\n]*--method POST|cross-review\.mjs"? (?:summary|push-review|push-post)\b/.test(line));
  if (posts(agent)) out.push(`the agent's job ${agent.id} builds or posts the review`);
  const ran = stepsIn(agent).find(st => /^ {6}- name: Did the agent run\?\n/.test(st)) ?? '';
  if (!/\n {8}id: ran\n/.test(ran) || !/\n {10}fi\n {10}echo "ran=true" >> "\$GITHUB_OUTPUT"(?:\n|$)/.test(ran)) out.push('"Did the agent run?" does not say ran=true after its check passes');
  if (!/\n {6}ran: \$\{\{ steps\.ran\.outputs\.ran \}\}\n/.test(agent.text)) out.push(`the ${agent.id} job does not hand on whether its agent ran (outputs.ran)`);
  const upload = stepsIn(agent).findIndex(st => /uses: actions\/upload-artifact@/.test(st));
  if (upload < 0) out.push('the agent\'s job leaves no artifact: the publish job would have nothing to post');
  else if (upload < stepsIn(agent).indexOf(ran)) out.push('the artifact is kept before "Did the agent run?"');
  const writers = jobs.filter(j => /:\s*write/.test(permsOf(j) ?? '') || /\n {4}permissions:\s*write-all/.test(j.text));
  const poster = jobs.find(posts);
  if (!poster) out.push('no job posts the review');
  else if (!writers.includes(poster)) out.push(`the job that posts (${poster.id}) cannot write pull requests`);
  for (const w of writers) {
    if (w === agent) continue;
    if (!new RegExp(`\\n {4}needs: (?:${agent.id}|\\[[^\\]]*\\b${agent.id}\\b[^\\]]*\\])\\n`).test(w.text)) out.push(`the writing job ${w.id} does not wait for the ${agent.id} job`);
    // It runs when the agent ran, or (phase 60) to start the record after a push, which runs no repository code (below).
    const jobIfText = /\n {4}if: (.*)\n/.exec(w.text)?.[1] ?? '';
    if (![`needs.${agent.id}.outputs.ran == 'true'`, `needs.${agent.id}.outputs.ran == 'true' || needs.${agent.id}.outputs.mode == 'start'`].includes(jobIfText)) out.push(`the writing job ${w.id} runs whether or not the agent ran (if: needs.${agent.id}.outputs.ran == 'true')`);
    if (/\balways\(\)|\bfailure\(\)|\bcancelled\(\)/.test(jobIfText)) out.push(`the writing job ${w.id} runs after a failed agent`);
    const steps = stepsIn(w);
    const at = re => steps.findIndex(st => re.test(st));
    // keel#65: after a push every commit on main was pushed code once, a reviewed one too, so none is run for what it
    // is. The publisher is fetched alone (no checkout) and runs only when its sha256 is the one keel rendered here.
    const pub = steps[at(/\n {8}id: publisher\n/)] ?? '';
    if (!pub) out.push(`the writing job ${w.id} has no step that checks the publisher after a push (id: publisher)`);
    else {
      const env = stepMap(pub, 'env');
      if (!pub.includes("\n        if: (github.event_name == 'push' || github.event_name == 'schedule') && needs.review.outputs.mode == 'push'\n")) out.push('the publisher step does not run for a push event alone');
      if (!/^(?:unrendered|[0-9a-f]{64} [0-9a-f]{64})$/.test(env.KEEL_PUBLISHER ?? '')) out.push(`the publisher's sha256 is not keel's, written here (KEEL_PUBLISHER: ${env.KEEL_PUBLISHER ?? 'none'})`);
      if (env.SHA !== '${{ github.sha }}') out.push('the publisher step does not fetch at the run\'s commit');
      const fetched = [...pub.matchAll(/gh api -H "Accept: application\/vnd\.github\.raw" "repos\/\$REPO\/contents\/scripts\/keel\/([\w.-]+)\?ref=\$SHA" > "\$out\/([\w.-]+)"/g)].map(m => `${m[1]}>${m[2]}`);
      if (JSON.stringify(fetched) !== JSON.stringify(['cross-review.mjs>cross-review.mjs', 'lib.mjs>lib.mjs'])) out.push(`the publisher step fetches ${fetched.join(', ') || 'nothing'}: cross-review.mjs and lib.mjs alone`);
      if (!/cross !== want\[0\] \|\| lib !== want\[1\]/.test(pub) || !/createHash\("sha256"\)\.update\(fs\.readFileSync\(f\)\)/.test(pub)) out.push('the publisher step does not check the scripts\' sha256 against KEEL_PUBLISHER');
      if (!/\n {10}echo "dir=\$out" >> "\$GITHUB_OUTPUT"(?:\n\s*(?:#.*)?)*$/.test(pub)) out.push('the publisher step hands on its folder before the check passes');
    }
    // The push's post runs the checked publisher, and nothing of a checkout.
    const post = steps.find(st => /- name: Post after the push\n/.test(st)) ?? '';
    const runs = code(post).map(({ line }) => line).filter(l => /\bnode\b/.test(l));
    if (!runs.length || runs.some(l => !/^\s*node "\$PUBLISHER\/cross-review\.mjs" push-(?:review|post) /.test(l))) out.push('the push\'s post runs something besides the checked publisher');
    if (stepMap(post, 'env').PUBLISHER !== '${{ steps.publisher.outputs.dir }}') out.push('the push\'s post does not take the checked publisher\'s folder');
    for (const [i, c] of steps.entries()) if (/uses: actions\/checkout@/.test(c)) {
      // A PR: the default branch, and only for a PR; after a push nothing is checked out.
      if (!c.includes("\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment'\n")) out.push(`the writing job ${w.id} checks out the repository after a push: its pushed code would be on disk where the token writes`);
      if (!/\n {10}ref: \$\{\{ github\.event\.repository\.default_branch \}\}(?:\n|$)/.test(c)) out.push(`the writing job ${w.id} checks out something other than the default branch for a PR: the PR's code would run where the token writes`);
      if (!/\n {10}persist-credentials: false(?:\n|$)/.test(c)) out.push(`a checkout in the writing job ${w.id} keeps the token in git`);
    }
    if (/steps\.which\.outputs\.sha|pull_request\.head\.(?:sha|ref)|headRefOid|needs\.[\w-]+\.outputs\.trusted/.test(w.text)) out.push(`the writing job ${w.id} reaches for the PR's head, or a commit the review job named`);
    // The pushed commits appear only as the facts its steps check: the publisher's and the start's.
    for (const { line } of code(w.text)) {
      if (/github\.sha\b|github\.event\.(?:after|before|head_commit)\b|github\.ref\b/.test(line) && !/^ {10}(?:BEFORE: \$\{\{ github\.event\.before \}\}|SHA: \$\{\{ github\.sha \}\})$/.test(line)) out.push(`the writing job ${w.id} reaches for the pushed commits: ${line.trim()}`);
    }
    // A start runs no checkout and no script of the repository's.
    const start = steps.find(st => /- name: Start the record\n/.test(st));
    if (start && !start.includes("\n        if: (github.event_name == 'push' || github.event_name == 'schedule') && needs.review.outputs.mode == 'start'\n")) out.push('the start step runs on an event other than a push or the daily run');
    // keel#65: the PR path (the default branch's checkout, its script's summary) runs on a PR's events alone, keyed on the
    // event, never on the review job's word: on a push the review job ran the pushed code, and could say "pr".
    const summary = steps.find(st => /- name: Post the summary\n/.test(st));
    if (summary && !summary.includes("\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment'\n")) out.push('the PR\'s summary step runs on an event other than a PR\'s, or on the review job\'s word');
    if (post && !post.includes("\n        if: (github.event_name == 'push' || github.event_name == 'schedule') && needs.review.outputs.mode == 'push'\n")) out.push('the push\'s post runs on an event other than a push or the daily run');
    if (start && /scripts\/keel|cross-review\.mjs/.test(start)) out.push('the start step runs the repository\'s code');
    if (start) {
      const env = stepMap(start, 'env');
      if (env.SHA !== '${{ github.sha }}' || env.BEFORE !== '${{ github.event.before }}' || env.STARTAT !== `\${{ needs.${agent.id}.outputs.start }}`) out.push('the start step does not take its facts from the event and the suggestion from the review job');
      if (!/\n {10}at="\$SHA"\n/.test(start) || !/\[ "\$STARTAT" = "\$BEFORE" \]/.test(start) || !/\.status === "ahead" \? 0 : 1\)' "\$RUNNER_TEMP\/start-below\.json"; then at="\$STARTAT"; fi/.test(start)) out.push('the start step starts the record where the review job says, unchecked: only the push\'s before, below the run\'s commit, else the run\'s commit');
    }
    if (start) for (const c of steps.filter(st => /uses: actions\/(?:checkout|download-artifact)@/.test(st))) if (!/\n {8}if: (?:needs\.[\w-]+\.outputs\.mode != 'start'|github\.event_name == 'pull_request' \|\| github\.event_name == 'issue_comment')\n/.test(c)) out.push(`the writing job ${w.id} checks out or downloads for a start, which has nothing to run`);
    if (!/\n {6}- uses: actions\/download-artifact@/.test(w.text)) out.push(`the writing job ${w.id} does not take the review job's artifact`);
    if (code(w.text).some(({ line }) => (/cross-review\.mjs" (?:summary|push-review|push-post)|\$RUNNER_TEMP\/keel\//.test(line) && !/^\s*node "\$PUBLISHER\/cross-review\.mjs" push-(?:review|post) /.test(line)))) out.push(`the writing job ${w.id} runs a copy of cross-review.mjs, not its own checkout's`);
  }
  return out;
}

test('phase 46: cross-review\'s agent, Claude or Codex, runs in a job whose token only reads; the job that posts runs no agent and nothing of the PR\'s', async () => {
  const t = (await shipped()).find(w => w.name === 'keel-cross-review.yml').template;
  assert.deepEqual(crossReviewSandboxProblems(t), []);
  assert.deepEqual(jobsOf(t).map(j => j.id), ['review', 'publish'], 'the jobs, as GitHub shows them');
  const reviewPerms = '    permissions:\n      contents: read\n      pull-requests: read\n';
  assert.ok(t.includes(`${reviewPerms}      issues: read\n`), 'the review job reads the tracking issues of reviews after a push, and writes nothing');
  const publish = jobsOf(t).find(j => j.id === 'publish').text;
  assert.match(publish, /\n {4}permissions:\n {6}contents: read\n {6}pull-requests: write\n {6}issues: write\n/);
  const trustedRef = 'ref: ${{ github.event.repository.default_branch }}';
  assert.ok(publish.includes(trustedRef));
  // The publish job runs when the agent ran, or to start the record after a push (no repository code runs then).
  const pubIf = /\n {4}if: (.*)\n/.exec(publish)[1];
  assert.equal(evalExpression(pubIf, { needs: { review: { outputs: { ran: 'true' } } } }), true);
  assert.equal(evalExpression(pubIf, { needs: { review: { outputs: { ran: '' } } } }), false, 'a red "Did the agent run?" never sets ran');
  assert.equal(evalExpression(pubIf, { needs: { review: { outputs: {} } } }), false, 'no review: nothing set');
  assert.equal(evalExpression(pubIf, { needs: { review: { outputs: { ran: '', mode: 'start' } } } }), true, 'a start');
  // keel#65: on a push the review job ran the pushed code; its saying "pr" never reaches the PR path's checkout or post.
  const stepIf = name => /\n {8}if: (.*)\n/.exec(stepsOf(publish).find(st => st.includes(name)))[1];
  for (const name of ['- uses: actions/checkout@', '- name: Post the summary']) {
    for (const event_name of ['push', 'schedule']) assert.equal(evalExpression(stepIf(name), { github: { event_name }, needs: { review: { outputs: { mode: 'pr', ran: 'true' } } } }), false, `${name} on a ${event_name}`);
    for (const event_name of ['pull_request', 'issue_comment']) assert.equal(evalExpression(stepIf(name), { github: { event_name }, needs: { review: { outputs: { mode: 'pr', ran: 'true' } } } }), true, `${name} on a ${event_name}`);
  }
  for (const name of ['id: publisher', '- name: Post after the push', '- name: Start the record']) {
    for (const event_name of ['pull_request', 'issue_comment']) for (const mode of ['push', 'start']) assert.equal(evalExpression(stepIf(name), { github: { event_name }, needs: { review: { outputs: { mode } } } }), false, `${name} on a ${event_name}`);
  }
  const trustStep = stepsOf(t).find(st => /\n {8}id: publisher\n/.test(st));
  const startStep = stepsOf(t).find(st => st.includes('- name: Start the record'));
  const claudeStep = stepsOf(t).find(st => /uses: anthropics\/claude-code-action@/.test(st));
  const codexStep = stepsOf(t).find(st => /uses: openai\/codex-action@/.test(st));
  const postStep = /\n {6}# The review: the agent's final message[\s\S]*?(?=\n$|$)/.exec(publish)[0];
  for (const [why, text] of [
    ['the review job may write pull requests', t.replace(reviewPerms, reviewPerms.replace('pull-requests: read', 'pull-requests: write'))],
    ['the review job may write issues', t.replace(reviewPerms, `${reviewPerms}      issues: write\n`)],
    ['the review job may mint an OIDC token', t.replace(reviewPerms, `${reviewPerms}      id-token: write\n`)],
    ['the review job may write contents', t.replace(reviewPerms, reviewPerms.replace('contents: read', 'contents: write'))],
    ['the review job without its own permissions', t.replace(reviewPerms, '')],
    ['the review job write-all', t.replace(reviewPerms, '    permissions: write-all\n')],
    ['the workflow grants write', t.replace('permissions: {}\n', 'permissions:\n  contents: read\n  pull-requests: write\n')],
    ['the workflow grants the old set', t.replace('permissions: {}\n', 'permissions:\n  contents: read\n  pull-requests: write\n  issues: write\n  id-token: write\n')],
    ['a job-level token', t.replace('    env:\n      REPO: ${{ github.repository }}\n', '    env:\n      GH_TOKEN: ${{ github.token }}\n      REPO: ${{ github.repository }}\n')],
    ['the default branch\'s checkout keeps its credential', t.replace(/( {10}ref: [^\n]*github\.event\.repository\.default_branch \}\}\n {10}fetch-depth: [^\n]*\n) {10}persist-credentials: false\n/, '$1')],
    ['the review job checks out the tip after a push', t.replace("ref: ${{ (github.event_name == 'push' || github.event_name == 'schedule') && github.sha || github.event.repository.default_branch }}", 'ref: ${{ github.event.repository.default_branch }}')],
    ['the publish job\'s checkout keeps its credential', t.replace(publish, publish.replace('          persist-credentials: false\n', ''))],
    ['the PR\'s checkout keeps its credential', t.replace('          ref: ${{ steps.which.outputs.sha }}\n          persist-credentials: false\n', '          ref: ${{ steps.which.outputs.sha }}\n')],
    ['Claude trades OIDC for its app token', t.replace(claudeStep, claudeStep.replace('          github_token: ${{ github.token }}\n', ''))],
    ['the post in the review job', t.replace(/(\n {6}- name: Hand the review on\n)/, `\n${postStep.replace(/^\n/, '')}$1`)],
    ['Claude in the publish job', t.replace(publish, `${publish.replace(/\n$/, '')}\n${claudeStep}\n`)],
    ['Codex in the publish job', t.replace(publish, `${publish.replace(/\n$/, '')}\n${codexStep}\n`)],
    ['the publish job checks out the PR', t.replace(publish, publish.replace(trustedRef, 'ref: ${{ github.event.pull_request.head.sha }}'))],
    ['the publish job checks out the run\'s commit', t.replace(publish, publish.replace(`          ${trustedRef}\n`, ''))],
    // Phase 60, keel#65: after a push the default branch is the pushed code, and the review job ran it.
    // keel#65: after a push no commit is run for what it is; only the publisher keel rendered, checked byte for byte.
    ['the publish job checks out after a push', t.replace(publish, publish.replace("      - uses: actions/checkout@v7\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment'\n", '      - uses: actions/checkout@v7\n'))],
    // keel#65: the path is the event's. The review job's word (it ran the pushed code) never picks the PR path.
    ['the checkout on the review job\'s word', t.replace(publish, publish.replace("      - uses: actions/checkout@v7\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment'\n", "      - uses: actions/checkout@v7\n        if: needs.review.outputs.mode == 'pr'\n"))],
    ['the PR summary on the review job\'s word', t.replace(publish, publish.replace("      - name: Post the summary\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment'\n", "      - name: Post the summary\n        if: needs.review.outputs.mode == 'pr'\n"))],
    ['a push event reaching the PR summary', t.replace(publish, publish.replace("      - name: Post the summary\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment'\n", "      - name: Post the summary\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment' || github.event_name == 'push'\n"))],
    ['a push event reaching the PR checkout', t.replace(publish, publish.replace("      - uses: actions/checkout@v7\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment'\n", "      - uses: actions/checkout@v7\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment' || github.event_name == 'push'\n"))],
    ['the publisher on the review job\'s word alone', t.replace(publish, publish.replace("        id: publisher\n        if: (github.event_name == 'push' || github.event_name == 'schedule') && needs.review.outputs.mode == 'push'\n", "        id: publisher\n        if: needs.review.outputs.mode == 'push'\n"))],
    ['the push post on the review job\'s word alone', t.replace(publish, publish.replace("      - name: Post after the push\n        if: (github.event_name == 'push' || github.event_name == 'schedule') && needs.review.outputs.mode == 'push'\n", "      - name: Post after the push\n        if: needs.review.outputs.mode == 'push'\n"))],
    ['a start on any event', t.replace(publish, publish.replace("      - name: Start the record\n        if: (github.event_name == 'push' || github.event_name == 'schedule') && needs.review.outputs.mode == 'start'\n", "      - name: Start the record\n        if: needs.review.outputs.mode == 'start'\n"))],
    ['the publish job checks out the pushed head', t.replace(publish, publish.replace(trustedRef, 'ref: ${{ github.sha }}'))],
    ['the publish job checks out the last record', t.replace(publish, publish.replace(trustedRef, 'ref: ${{ needs.review.outputs.trusted || github.event.repository.default_branch }}'))],
    ['the publish job reads the pushed head', t.replace(publish, publish.replace('          REPO: ${{ github.repository }}\n          PUBLISHER:', '          REPO: ${{ github.repository }}\n          HEAD: ${{ github.event.head_commit.id }}\n          PUBLISHER:'))],
    ['no publisher step', t.replace(trustStep, '      - run: true')],
    ['the publisher unchecked', t.replace(trustStep, trustStep.replace(' || cross !== want[0] || lib !== want[1]', ''))],
    ['the publisher\'s sha256 from the review job', t.replace(trustStep, trustStep.replace('          KEEL_PUBLISHER: unrendered\n', '          KEEL_PUBLISHER: ${{ needs.review.outputs.publisher }}\n'))],
    ['the publisher fetched whole', t.replace(trustStep, trustStep.replace('"repos/$REPO/contents/scripts/keel/lib.mjs?ref=$SHA" > "$out/lib.mjs"', '"repos/$REPO/contents/scripts/keel/lib.mjs?ref=$SHA" > "$out/lib.mjs"\n          gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/scripts/keel/improve.mjs?ref=$SHA" > "$out/improve.mjs"'))],
    ['the publisher handed on first', t.replace(trustStep, trustStep.replace('        run: |\n          out=', '        run: |\n          echo "dir=$RUNNER_TEMP/publisher/scripts/keel" >> "$GITHUB_OUTPUT"\n          out=').replace(/\n {10}echo "dir=\$out" >> "\$GITHUB_OUTPUT"$/, ''))],
    ['the push post runs the pushed script', t.replace(publish, publish.replace('node "$PUBLISHER/cross-review.mjs" push-post', 'node scripts/keel/cross-review.mjs push-post'))],
    ['the push post runs something else too', t.replace(publish, publish.replace('          node "$PUBLISHER/cross-review.mjs" push-post', '          node scripts/keel/improve.mjs --check\n          node "$PUBLISHER/cross-review.mjs" push-post'))],
    ['the start step starts where the review job says', t.replace(startStep, startStep.replace('          at="$SHA"\n', '          at="${STARTAT:-$SHA}"\n'))],
    ['the start step takes any suggestion as the before', t.replace(startStep, startStep.replace(' && [ "$STARTAT" = "$BEFORE" ]', ''))],
    ['the start step asks GitHub nothing', t.replace(startStep, startStep.replace('.status === "ahead" ? 0 : 1)\' "$RUNNER_TEMP/start-below.json"; then at="$STARTAT"; fi', '.status ? 0 : 0)\' "$RUNNER_TEMP/start-below.json"; then at="$STARTAT"; fi'))],
    ['a start runs the repository\'s script', t.replace(startStep, startStep.replace('        run: |\n', '        run: |\n          node scripts/keel/cross-review.mjs config\n'))],
    ['a start downloads an artifact it has not', t.replace(publish, publish.replace("      - uses: actions/download-artifact@v8\n        if: needs.review.outputs.mode != 'start'\n", '      - uses: actions/download-artifact@v8\n'))],
    ['the publish job runs whatever happened', t.replace(publish, publish.replace("    if: needs.review.outputs.ran == 'true' || needs.review.outputs.mode == 'start'\n", '    if: always()\n'))],
    ['the publish job with no if', t.replace(publish, publish.replace("    if: needs.review.outputs.ran == 'true' || needs.review.outputs.mode == 'start'\n", ''))],
    ['the publish job for any mode', t.replace(publish, publish.replace("    if: needs.review.outputs.ran == 'true' || needs.review.outputs.mode == 'start'\n", "    if: needs.review.outputs.ran == 'true' || needs.review.outputs.mode != ''\n"))],
    ['the publish job not waiting', t.replace(publish, publish.replace('    needs: review\n', ''))],
    ['the publish job without the artifact', t.replace(publish, publish.replace(/\n {6}- uses: actions\/download-artifact@[\s\S]*?\/review\n/, '\n'))],
    ['the publish job runs a copy', t.replace(publish, publish.replace('node scripts/keel/cross-review.mjs summary', 'node "$RUNNER_TEMP/keel/scripts/keel/cross-review.mjs" summary'))],
    ['ran said before the check', t.replace('          echo "ran=true" >> "$GITHUB_OUTPUT"\n', '').replace('        run: |\n          if [ "$AGENT" = codex ]; then\n            node "$RUNNER_TEMP/keel/scripts/keel/cross-review.mjs" agent-ran', '        run: |\n          echo "ran=true" >> "$GITHUB_OUTPUT"\n          if [ "$AGENT" = codex ]; then\n            node "$RUNNER_TEMP/keel/scripts/keel/cross-review.mjs" agent-ran')],
    ['ran not handed on', t.replace('      ran: ${{ steps.ran.outputs.ran }}\n', '')],
    ['no artifact', t.replace(/\n {6}- name: Keep the review\n[\s\S]*?retention-days: 7\n/, '\n')],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    assert.ok(crossReviewSandboxProblems(text).length, `${why}: expected a problem`);
  }
});

/**
 * A workflow's budgeted agent steps (phase 43): each step that uses an agent's
 * action (claude-code-action, or codex-action since phase 45) time-boxed by a
 * budget (`timeout-minutes` from a step's `minutes` output): { agent, check },
 * its `name:` and the name of the first step after it that is not another
 * provider's step of the same name (null when either has none). Each
 * provider's step of one pass carries one name, so the Budget line finds
 * whichever ran (the other is skipped); a pass is listed once.
 */
export function budgetedAgentSteps(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*uses:\s*(?:anthropics\/claude-code-action|openai\/codex-action)@/.test(lines[i])) continue;
    let start = i;
    while (start >= 0 && !/^\s*- /.test(lines[start])) start--;
    if (start < 0) continue;
    const indent = /^(\s*)- /.exec(lines[start])[1].length;
    const body = [lines[start].replace(/^(\s*)- /, '$1  ')];
    let j = start + 1;
    for (; j < lines.length && !(lines[j].trim() && /^(\s*)/.exec(lines[j])[1].length <= indent); j++) body.push(lines[j]);
    const step = body.join('\n');
    if (!/^\s*timeout-minutes:\s*\$\{\{\s*fromJSON\(steps\.[\w-]+\.outputs\.minutes\)\s*\}\}/m.test(step)) continue;
    const nameOf = l => /^\s*(?:- )?name:\s*["']?(.+?)["']?\s*$/.exec(l ?? '')?.[1] ?? null;
    // The next step starts at the same indent with `- `; its name is on that line or the step's own lines.
    const agent = nameOf(step.split('\n').find(l => /^\s*name:/.test(l)));
    let next = null;
    for (;;) {
      while (j < lines.length && /^\s*(#.*)?$/.test(lines[j])) j++;
      if (!(j < lines.length && new RegExp(`^\\s{${indent}}- `).test(lines[j]))) break;
      next = nameOf(lines[j]);
      let k = j + 1;
      for (; k < lines.length && !(lines[k].trim() && /^(\s*)/.exec(lines[k])[1].length <= indent); k++) if (next === null && /^\s*name:/.test(lines[k])) next = nameOf(lines[k]);
      if (next !== agent || agent === null) break;
      next = null; j = k; // another provider's step of this pass: look past it
    }
    if (!out.some(o => o.agent === agent && o.check === next)) out.push({ agent, check: next });
  }
  return out;
}

test('the Budget line\'s step map equals each shipped workflow\'s budgeted claude-code-action step, as a template and as rendered on keel', async () => {
  const { BUDGET_STEPS, BUDGET_PASSES } = await import('../practices/night/files/scripts/keel/lib.mjs');
  const all = await shipped();
  const found = {};
  for (const w of all) {
    const names = budgetedAgentSteps(w.template);
    assert.ok(names.length <= 1, `${w.path}: one budgeted agent step`);
    if (names.length) found[w.name] = { ...names[0] };
    if (w.optional || !names.length) continue;
    const rendered = await readFile(join(KEEL, w.path), 'utf8').catch(() => null);
    if (rendered !== null) assert.deepEqual(budgetedAgentSteps(rendered), names, `keel's ${w.path}`);
  }
  assert.deepEqual(found, Object.fromEntries(Object.entries(BUDGET_STEPS).map(([k, v]) => [k, { ...v }])));
  assert.deepEqual(BUDGET_PASSES.map(p => p.workflow).sort(), Object.keys(BUDGET_STEPS).sort());

  // The reader sees a rename (the step's name is what GitHub's record of a run carries).
  const tend = all.find(w => w.name === 'keel-tend.yml').template;
  assert.match(tend, /^ {6}- name: Tend$/m);
  // Phase 47: Claude's step and Codex's both carry the name, so a rename renames both.
  assert.equal(tend.match(/^ {6}- name: Tend$/gm).length, 2);
  assert.deepEqual(budgetedAgentSteps(tend.replace(/^ {6}- name: Tend$/gm, '      - name: Tend the repo')), [{ agent: 'Tend the repo', check: 'Did the agent run?' }]);
  assert.deepEqual(budgetedAgentSteps(tend.replace(/^ {6}- name: Did the agent run\?$/m, '      - name: Did Claude run?')), [{ agent: 'Tend', check: 'Did Claude run?' }]);
  // An unbudgeted claude-code-action (claude.yml's) is not a budgeted pass.
  assert.deepEqual(budgetedAgentSteps(all.find(w => w.name === 'claude.yml').template), []);
});

/**
 * Codex on a pass that edits the tree (phase 47), keel-climb.yml or
 * keel-tend.yml: [string]. One Claude step and one Codex step, each run only
 * when the pass names its provider; Codex's under every rule of
 * codexStepProblems with sandbox workspace-write (never danger-full-access or
 * unsafe), in the agent's read-only job. Before it, a keel step gives it
 * .keel/agent-git; after it, a keel step takes only objects from that git
 * dir into a repo keel makes (no system or global config, hooks and
 * fsmonitor off), refuses a head not on top of the run's commit, and no
 * other step runs git on the agent's git dir. The hand-on step bundles .git
 * only for Claude. `cond` is the pass's own condition; `step`, `id` its agent step.
 */
export function codexEditProblems(text, { step, id, cond }) {
  const out = [...codexStepProblems(text, { sandbox: 'workspace-write' })];
  const all = stepsOf(text);
  const named = n => all.findIndex(s => s.startsWith(`- name: ${n}\n`) || new RegExp(`^\\s*- name: ${n.replace(/[?()]/g, '\\$&')}\\n`).test(s));
  for (const [provider, action] of [['claude', 'anthropics/claude-code-action'], ['codex', 'openai/codex-action']]) {
    const mine = all.filter(s => s.includes(`uses: ${action}@`));
    if (mine.length !== 1) { out.push(`${mine.length} ${provider} steps; one`); continue; }
    if (!mine[0].includes(`\n  if: ${cond} && steps.on.outputs.agent == '${provider}'\n`) && !mine[0].includes(`\n        if: ${cond} && steps.on.outputs.agent == '${provider}'\n`)) out.push(`the ${provider} step does not run only when the pass names ${provider}`);
    if (!new RegExp(`^\\s*- name: ${step}\\n`).test(mine[0])) out.push(`the ${provider} step is not named ${step}: the Budget line finds it by name`);
  }
  const codex = all.findIndex(s => s.includes('uses: openai/codex-action@'));
  if (codex < 0) return out;
  if (!new RegExp(`\\n\\s+id: ${id}_codex\\n`).test(all[codex])) out.push(`Codex's step has no id ${id}_codex`);
  const w = stepMap(all[codex], 'with');
  if (w['prompt-file'] !== '${{ runner.temp }}/prompt.md') out.push('Codex is not given the brief (prompt-file)');
  const jobs = jobsOf(text);
  const agentJob = jobs.find(j => j.text.includes('uses: openai/codex-action@'));
  if (agentJob?.id !== 'agent') out.push(`Codex runs in the ${agentJob?.id} job, not the agent's`);
  const give = named('Give Codex its git dir'), take = named('Take Codex\'s commits, objects only');
  if (give < 0 || give > codex) out.push('no keel step gives Codex its git dir (.keel/agent-git) before it runs');
  else if (!/git init -q --bare \.keel\/agent-git/.test(all[give]) || !/info\/exclude/.test(all[give])) out.push('the git dir is not made, or not ignored, before Codex runs');
  if (take < 0 || take < codex) return [...out, 'no keel step after Codex takes its commits from its git dir'];
  const t = all[take];
  if (!/\n\s+if: always\(\) && /.test(t)) out.push('the take is not always(): a night whose agent failed keeps no record of its commits');
  if (!/export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=\/dev\/null\n/.test(t)) out.push('the take reads a system or global git config');
  if (!t.includes('g() { git -c core.hooksPath=/dev/null -c core.fsmonitor=false --git-dir="$dst" "$@"; }')) out.push('the take\'s git is not keel\'s repo with hooks and fsmonitor off');
  if (!/git init -q --bare "\$dst"/.test(t)) out.push('the take does not make its own repo');
  if (!/g merge-base --is-ancestor "\$GITHUB_SHA" "\$tip"/.test(t)) out.push('the take does not refuse a head off the run\'s commit');
  if (/objects\/info\/alternates/.test(t) && !/echo "\$PWD\/\.git\/objects" > "\$dst\/objects\/info\/alternates"/.test(t)) out.push('the take borrows objects from somewhere other than .git');
  for (const s of all.slice(codex + 1)) for (const line of s.split('\n')) {
    if (/\bgit\b[^\n]*(?:--git-dir[= ]"?(?:\$src|\.keel\/agent-git)|-C "?(?:\$src|\.keel\/agent-git))/.test(line) || /GIT_DIR=/.test(line)) out.push(`a step after Codex runs git on its git dir: ${line.trim()}`);
  }
  const hand = all.findIndex((s, i) => i > take && /git bundle create/.test(s));
  if (hand < 0 || !/if \[ "\$AGENT" != codex \] && git rev-parse/.test(all[hand])) out.push('the hand-on step bundles .git for Codex too, where its commits are not');
  return out;
}

test('phase 47: Codex runs climb and tend in workspace-write with sudo dropped, never danger-full-access or unsafe; its commits leave its git dir as objects only, in the read-only agent job', async () => {
  const all = await shipped();
  for (const [name, opts] of [['keel-climb.yml', { step: 'Climb', id: 'climb', cond: "steps.pick.outputs.job != ''" }], ['keel-tend.yml', { step: 'Tend', id: 'tend', cond: "steps.pick.outputs.run == 'yes'" }]]) {
    const t = all.find(w => w.name === name).template;
    assert.deepEqual(codexEditProblems(t, opts), [], name);
    assert.deepEqual(agentSandboxProblems(t), [], name);
    assert.deepEqual(codexEditProblems(await readFile(join(KEEL, '.github/workflows', name), 'utf8'), opts), [], `keel's ${name}`);
    const codexStep = stepsOf(t).find(s => s.includes('uses: openai/codex-action@'));
    const publish = jobsOf(t).find(j => j.id === 'publish').text;
    const give = /\n {6}- name: Give Codex its git dir\n[\s\S]*?(?=\n {6}(?:#|- ))/.exec(t)[0];
    for (const [why, text, check = codexEditProblems] of [
      ['danger-full-access', t.replace('          sandbox: workspace-write\n', '          sandbox: danger-full-access\n')],
      ['unsafe', t.replace('          safety-strategy: drop-sudo\n', '          safety-strategy: unsafe\n')],
      ['read-only: it cannot edit', t.replace('          sandbox: workspace-write\n', '          sandbox: read-only\n')],
      ['the action\'s default sandbox', t.replace('          sandbox: workspace-write\n', '')],
      ['sudo kept', t.replace('          safety-strategy: drop-sudo\n', '')],
      ['any bot', t.replace('          safety-strategy: drop-sudo\n', '          safety-strategy: drop-sudo\n          allow-bots: true\n')],
      ['anyone', t.replace('          safety-strategy: drop-sudo\n', '          safety-strategy: drop-sudo\n          allow-users: "*"\n')],
      ['args around the sandbox', t.replace('          safety-strategy: drop-sudo\n', '          safety-strategy: drop-sudo\n          codex-args: --dangerously-bypass-approvals-and-sandbox\n')],
      ['the token held', t.replace('        env:\n          GH_TOKEN: ""\n', '        env:\n')],
      ['TMPDIR removed', t.replace('          TMPDIR: /tmp/keel-codex\n', '')],
      ['TMPDIR the runner\'s temp', t.replace('          TMPDIR: /tmp/keel-codex\n', '          TMPDIR: ${{ runner.temp }}\n')],
      ['TMPDIR $RUNNER_TEMP', t.replace('          TMPDIR: /tmp/keel-codex\n', '          TMPDIR: $RUNNER_TEMP/codex\n')],
      ['TMPDIR in .git', t.replace('          TMPDIR: /tmp/keel-codex\n', '          TMPDIR: /tmp/.git\n')],
      ['TMPDIR never made', t.replace('          mkdir -p /tmp/keel-codex\n', '')],
      ['another secret', t.replace('          openai-api-key: ${{ secrets.OPENAI_API_KEY }}\n', '          openai-api-key: ${{ secrets.OPENAI_API_KEY }}\n          model: ${{ secrets.ANTHROPIC_API_KEY }}\n')],
      ['not time-boxed', t.replace(/(id: \w+_codex\n[\s\S]*?)\n\s+timeout-minutes: [^\n]*/, '$1')],
      ['Codex whatever the config says', t.replace(`${opts.cond} && steps.on.outputs.agent == 'codex'\n        continue-on-error`, `${opts.cond}\n        continue-on-error`)],
      ['Claude whatever the config says', t.replace(`${opts.cond} && steps.on.outputs.agent == 'claude'\n`, `${opts.cond}\n`)],
      ['Codex in the publish job', t.replace(publish, `${publish.replace(/\n$/, '')}\n${codexStep}\n`), agentSandboxProblems],
      ['no git dir given', t.replace(give, '')],
      ['the take reads the agent\'s git dir', t.replace('g() { git -c core.hooksPath=/dev/null -c core.fsmonitor=false --git-dir="$dst" "$@"; }', 'g() { git --git-dir="$src" "$@"; }')],
      ['the take with hooks on', t.replace('g() { git -c core.hooksPath=/dev/null -c core.fsmonitor=false --git-dir="$dst" "$@"; }', 'g() { git -c core.fsmonitor=false --git-dir="$dst" "$@"; }')],
      ['the take reads a global config', t.replace('          export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null\n', '')],
      ['a head off the run\'s commit taken', t.replace(/\n {10}if ! g merge-base --is-ancestor "\$GITHUB_SHA" "\$tip"; then\n[\s\S]*?\n {10}fi\n/, '\n')],
      ['a bundle straight from the agent\'s git dir', t.replace(/( {10}if \[ "\$AGENT" != codex \] && git rev-parse)/, '          git --git-dir=.keel/agent-git bundle create "$out/acme.bundle" HEAD\n$1')],
      ['.git bundled for Codex too', t.replace('if [ "$AGENT" != codex ] && git rev-parse', 'if git rev-parse')],
    ]) {
      assert.notEqual(text, t, `${name} ${why}: the mutation did not apply`);
      assert.ok(check(text, opts).length, `${name} ${why}: expected a problem`);
    }
  }
});

// ---- phase 54: the robot ------------------------------------------------------------

/** An issues event as the robot's `if:` reads it: { action, label, labels }. */
const issueEvent = ({ action = 'labeled', label = 'keel:agent', labels = ['keel:agent'] } = {}) =>
  ghEvent('issues', { action, ...(action === 'labeled' ? { label: { name: label } } : {}), issue: { number: 12, labels: labels.map(name => ({ name })) } });
/** A comment on an issue (pr: on a pull request) as the robot's `if:` reads it. */
/** A dispatch from a ref (the default branch, main, unless named). */
const dispatchEvent = (ref = 'refs/heads/main') => { const e = ghEvent('workflow_dispatch', {}); e.github.ref = ref; return e; };
const issueComment = ({ association = 'OWNER', login = 'acme-owner', type = 'User', labels = ['keel:agent'], pr = false, number = 12, body = 'Use the lid, not the box.' } = {}) =>
  ghEvent('issue_comment', { action: 'created', issue: { number, labels: labels.map(name => ({ name })), ...(pr ? { pull_request: { url: `https://api.github.com/repos/${ACME}/pulls/${number}` } } : {}) }, comment: { body, author_association: association, user: { login, type } } });

/**
 * The robot's own rules (phase 54), on keel-robot.yml's text: [string]. Its
 * triggers are GitHub's issue events, a comment, the schedule and a dispatch,
 * nothing else; the agent's tools cannot push, merge, rebase, switch or reach
 * gh; its step is time-boxed by the pick's minutes; the result is a PR on
 * keel/robot-<issue> (the pick's issue, checked to be a number and the
 * branch's), opened after the judge's guard, never merged; the agent's last
 * message and the triage are posted by robot.mjs in the publish job, from the
 * pick's issue numbers (never from what the agent handed on); the robot off
 * is said first; and the weekly run is on Mondays.
 */
export function robotWorkflowProblems(text) {
  const out = [];
  const on = /\non:\n((?: {2}.*\n)+)/.exec(text)?.[1] ?? '';
  const events = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map(m => m[1]);
  if (events.join(',') !== 'issues,issue_comment,schedule,workflow_dispatch') out.push(`triggers are ${events.join(', ') || 'none'}; only issues, issue_comment, schedule and workflow_dispatch`);
  const types = name => /types: \[([^\]]*)\]/.exec(on.split(new RegExp(`^ {2}${name}:`, 'm'))[1]?.split(/^ {2}\S/m)[0] ?? '')?.[1].split(',').map(s => s.trim());
  if (JSON.stringify(types('issues')) !== JSON.stringify(['labeled', 'reopened'])) out.push(`issues types ${JSON.stringify(types('issues'))}: only labeled and reopened`);
  if (JSON.stringify(types('issue_comment')) !== JSON.stringify(['created'])) out.push('issue_comment types: only created');
  if (/pull_request_target/.test(text)) out.push('pull_request_target');
  if (!/^ {4}- cron: "\d+ \d+ \* \* 1"$/m.test(text)) out.push('the robot is not weekly on Mondays');
  const tools = /--allowedTools "([^"]*)"/.exec(text)?.[1];
  if (!tools) out.push('the agent has no --allowedTools list');
  else for (const t of tools.split(',').map(x => x.trim())) {
    if (/\bpush\b|\bmerge\b|\brebase\b|\breset\b|\bclean\b|\bbranch\b|\bcheckout\b|\bswitch\b|\bworktree\b/.test(t)) out.push(`the agent may run ${t}`);
    if (/^Bash\(git( \*|:\*|\*)\)$/.test(t) || t === 'Bash' || t === 'Bash(*)') out.push(`the agent may run any git or shell command (${t})`);
    if (/^Bash\(gh\b/.test(t)) out.push(`the agent may run gh (${t})`);
  }
  if ((text.match(/--allowedTools/g) ?? []).length !== 1 || /--(?:dangerously-skip-permissions|permission-mode)/.test(text)) out.push('one --allowedTools list, and no way around it');
  const work = stepsOf(text).find(s => /uses: anthropics\/claude-code-action@/.test(s)) ?? '';
  if (!/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.pick\.outputs\.minutes\) \}\}\n/.test(work)) out.push('the agent\'s step is not time-boxed by the pick\'s minutes');
  const jobs = jobsOf(text);
  const publish = jobs.find(j => j.id === 'publish')?.text ?? '';
  const pushes = code(text).filter(l => /\bgit push\b/.test(l.line));
  if (pushes.length !== 1) out.push(`${pushes.length} git pushes; one, the robot's PR branch`);
  for (const { line } of pushes) if (!/^\s*git push --force origin "\$head:refs\/heads\/keel\/robot-\$ISSUE"$/.test(line)) out.push(`a push that is not to the issue's own branch: ${line.trim()}`);
  if (pushes.length && !publish.includes(pushes[0].line)) out.push('the push is not in the publish job');
  const create = code(publish).find(l => /\bgh pr create\b/.test(l.line))?.line ?? '';
  if (!/gh pr create --base "\$BASE" --head "\$BRANCH" --title "[^"]*" --body-file "\$RUNNER_TEMP\/run\/body\.md"/.test(create)) out.push('no PR opened on the robot\'s branch with the judge\'s body (it says Closes #<issue>)');
  if (!/case "\$ISSUE" in ''\|\*\[!0-9\]\*\) [^\n]*exit 1 ;; esac/.test(publish) || !/if \[ "\$BRANCH" != "keel\/robot-\$ISSUE" \]; then/.test(publish)) out.push('the publish job does not check the issue is a number and the branch is its own');
  const issueFrom = [...publish.matchAll(/^ {10}ISSUE: (.*)$/gm)].map(m => m[1]);
  if (!issueFrom.length || issueFrom.some(v => v !== '${{ needs.agent.outputs.issue }}')) out.push('the issue the publish job writes to is not the pick\'s');
  if (/\bgh (pr|issue) (merge|close|delete)\b|\bgh api\b[^\n]*(-X|--method)/.test(text)) out.push('merges, closes, deletes or writes through gh api');
  if (!/\n {10}node scripts\/keel\/climb\.mjs guard --job robot --base "\$GITHUB_SHA"\n/.test(jobs.find(j => j.id === 'judge')?.text ?? '')) out.push('the judge does not run the robot\'s guard from the run\'s commit');
  if (!/robot\.mjs post --repo "\$REPO" --issue "\$ISSUE" --message "\$RUNNER_TEMP\/run\/message\.md"/.test(publish)) out.push('the agent\'s last message is not posted on the issue by robot.mjs post');
  // PR #59: the mark carries the pick's cursor, so a comment made while the run worked starts the next one.
  if (!/robot\.mjs post [^\n]*--read "\$READ"/.test(publish) || !/READ: \$\{\{ needs\.agent\.outputs\.read \}\}/.test(publish) || !/\n {6}read: \$\{\{ steps\.pick\.outputs\.read \}\}\n/.test(text)) out.push('the run\'s mark does not carry the pick\'s cursor (--read)');
  if (!/robot\.mjs post [^\n]*--seen "\$SEEN"/.test(publish) || !/SEEN: \$\{\{ needs\.agent\.outputs\.seen \}\}/.test(publish) || !/\n {6}seen: \$\{\{ steps\.pick\.outputs\.seen \}\}\n/.test(text)) out.push('the run\'s mark does not carry the comments read in the cursor\'s second (--seen)');
  // PR #59: the commit judged is named before the agent's code runs, and is what is reported, handed on and
  // pushed; publish holds the record rules itself; no PR open is a publish that failed.
  const judgeJob = jobs.find(j => j.id === 'judge')?.text ?? '';
  const take = stepsOf(judgeJob).find(s => /- name: Take the run's commits\n/.test(s)) ?? '';
  if (!/\n\s+id: take\n/.test(take) || !/echo "head=\$head" >> "\$GITHUB_OUTPUT"\n\s+git switch -q -c "\$BRANCH" "\$head"/.test(take)) out.push('the judge does not name the commit it takes before the agent\'s code runs');
  if (!/\n {6}validated: \$\{\{ steps\.take\.outputs\.head \}\}\n/.test(judgeJob)) out.push('the judge job does not hand on the commit it took');
  if (!/robot\.mjs report --base "\$GITHUB_SHA" --head "\$VALIDATED"/.test(judgeJob)) out.push('the report reads HEAD, not the commit the judge took');
  if (!/git update-ref "refs\/heads\/\$BRANCH" "\$VALIDATED"\n\s+git bundle create "\$out\/run\.bundle" "\$GITHUB_SHA\.\.refs\/heads\/\$BRANCH"/.test(judgeJob)) out.push('the judge hands on its HEAD, not the commit it took');
  if (!/VALIDATED: \$\{\{ needs\.judge\.outputs\.validated \}\}/.test(publish) || !/if \[ "\$head" != "\$VALIDATED" \]; then\n[^\n]*\n\s+exit 1/.test(publish)) out.push('publish pushes a head that is not the commit the judge took');
  if (!/node scripts\/keel\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head" --records\n/.test(publish)) out.push('publish does not hold the record rules itself (sandbox --records)');
  if (!/if \[ -z "\$url" \]; then\n[^\n]*\n\s+exit 1/.test(publish)) out.push('no PR open still counts as published, so the issue is marked worked');
  if (!/robot\.mjs triage --repo "\$REPO" --issues "\$TRIAGE" --post\n/.test(publish) || !/TRIAGE: \$\{\{ needs\.agent\.outputs\.triage \}\}/.test(publish)) out.push('the triage is not answered by robot.mjs in the publish job, from the pick\'s issue numbers');
  const steps = [...text.matchAll(/^ {6}- (?:name: (.+)|uses: (\S+))$/gm)].map(m => m[1] ?? m[2]);
  if (!(steps[0]?.startsWith('actions/checkout') && steps[1] === 'Is the robot on?')) out.push('"Is the robot on?" is not the first step after checkout');
  if (!/the robot is off/.test(text)) out.push('the robot off is not said');
  if (!/node scripts\/keel\/robot\.mjs pick --repo "\$REPO" --record --json/.test(text)) out.push('robot.mjs pick does not choose the run');
  return out;
}

const robotWorkflow = async () => (await shipped()).find(w => w.name === 'keel-robot.yml');
const robotIf = text => jobsOf(text).find(j => j.id === 'agent').text.match(/\n {4}if: \|\n((?: {6}.*\n)+)/)[1];

test('keel-robot.yml runs only for the keel:agent label, a reopen, a writer\'s comment, the schedule or a dispatch; a bot\'s or a stranger\'s comment runs nothing', async () => {
  const w = await robotWorkflow();
  assert.equal(w.practice, 'climb');
  const t = w.template;
  const cond = robotIf(t);
  const runs = ctx => evalExpression(cond, ctx);
  assert.equal(runs(issueEvent()), true, 'the label');
  assert.equal(runs(issueEvent({ label: 'bug' })), false, 'another label');
  assert.equal(runs(issueEvent({ action: 'reopened' })), true, 'a labelled issue reopened');
  assert.equal(runs(issueEvent({ action: 'reopened', labels: ['bug'] })), false, 'an unlabelled issue reopened');
  assert.equal(runs(issueEvent({ action: 'opened' })), false, 'opened is not a trigger');
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) assert.equal(runs(issueComment({ association })), true, association);
  for (const association of ['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE', '']) assert.equal(runs(issueComment({ association, login: 'mallory' })), false, `a stranger (${association || 'none'})`);
  assert.equal(runs(issueComment({ type: 'Bot', login: 'github-actions[bot]', association: 'NONE' })), false, 'the robot\'s own comment');
  assert.equal(runs(issueComment({ type: 'Bot', login: 'codex[bot]', association: 'MEMBER' })), false, 'a bot with write access');
  assert.equal(runs(issueComment({ type: 'User', login: 'acme-ci[bot]', association: 'MEMBER' })), false, 'a [bot] login');
  assert.equal(runs(issueComment({ labels: [] })), false, 'a comment on an issue not handed to the robot');
  assert.equal(runs(issueComment({ pr: true })), false, 'a comment on a pull request');
  assert.equal(runs(ghEvent('schedule', {})), true);
  // PR #59: a dispatch runs from the default branch only (its commit is the base every check trusts).
  assert.equal(runs(dispatchEvent()), true, 'a dispatch from the default branch');
  assert.equal(runs(dispatchEvent('refs/heads/acme-side')), false, 'a dispatch from another branch');
  assert.equal(runs(dispatchEvent('refs/tags/v1')), false, 'a dispatch from a tag');
  for (const name of ['push', 'pull_request', 'pull_request_target']) assert.equal(runs(ghEvent(name, {})), false, name);
  assert.deepEqual(robotWorkflowProblems(t), []);
  assert.deepEqual(robotWorkflowProblems(await readFile(join(KEEL, w.path), 'utf8')), [], "keel's rendered keel-robot.yml");
  // Each guard in the if: is load-bearing: mutated, the event gets through.
  for (const [why, from, to, ctx] of [
    ['a stranger\'s comment', "contains(fromJSON('[\"OWNER\", \"MEMBER\", \"COLLABORATOR\"]'), github.event.comment.author_association) &&\n", '', issueComment({ association: 'NONE', login: 'mallory' })],
    ['any association', '"COLLABORATOR"]', '"COLLABORATOR", "CONTRIBUTOR", "NONE"]', issueComment({ association: 'NONE', login: 'mallory' })],
    ['a bot\'s comment', "github.event.comment.user.type != 'Bot' &&\n        !endsWith(github.event.comment.user.login, '[bot]'))", 'true)', issueComment({ type: 'Bot', login: 'codex[bot]', association: 'MEMBER' })],
    ['an unlabelled issue', "contains(github.event.issue.labels.*.name, 'keel:agent') &&\n        contains(fromJSON", 'contains(fromJSON', issueComment({ labels: [] })],
    ['a pull request', '!github.event.issue.pull_request &&\n', '', issueComment({ pr: true })],
    ['any label', "github.event.action == 'labeled' && github.event.label.name == 'keel:agent'", "github.event.action == 'labeled'", issueEvent({ label: 'bug' })],
    ['a dispatch from any branch', "(github.event_name == 'workflow_dispatch' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch))", "github.event_name == 'workflow_dispatch'", dispatchEvent('refs/heads/acme-side')],
  ]) {
    const mutated = cond.replace(from, to);
    assert.notEqual(mutated, cond, `${why}: the mutation did not apply`);
    assert.equal(evalExpression(mutated, ctx), true, `${why}: the mutated condition lets it through`);
    assert.equal(runs(ctx), false, why);
  }
  // The rules' own mutations.
  const tools = /--allowedTools "([^"]*)"/.exec(t)[1];
  for (const [why, text] of [
    ['a pull_request trigger', t.replace('  workflow_dispatch: {}\n', '  workflow_dispatch: {}\n  pull_request_target:\n    types: [opened]\n')],
    ['issues opened', t.replace('types: [labeled, reopened]', 'types: [opened, labeled, reopened]')],
    ['git push allowed', t.replace(tools, `${tools},Bash(git push*)`)],
    ['gh allowed', t.replace(tools, `${tools},Bash(gh issue comment *)`)],
    ['any shell', t.replace(tools, `${tools},Bash(*)`)],
    ['no time box', t.replace(/(id: work\n[\s\S]*?)\n\s+timeout-minutes: [^\n]*/, '$1')],
    ['the issue from elsewhere', t.replace('          ISSUE: ${{ needs.agent.outputs.issue }}\n          PR_URL', '          ISSUE: ${{ steps.pr.outputs.issue }}\n          PR_URL')],
    ['the branch unchecked', t.replace(/\n {10}if \[ "\$BRANCH" != "keel\/robot-\$ISSUE" \]; then\n[\s\S]*?\n {10}fi\n/, '\n')],
    ['the message never posted', t.replace(/\n {6}# The issue is the conversation[\s\S]*$/, '\n')],
    ['the triage from the agent\'s artifact', t.replace('--issues "$TRIAGE" --post', '--issues "$(cat "$RUNNER_TEMP/run/triage")" --post')],
    ['a merge', t.replace('            gh pr edit "$num" --body-file "$RUNNER_TEMP/run/body.md"\n', '            gh pr merge "$num" --squash\n')],
    ['the robot off said late', t.replace('      - name: Is the robot on?\n', '      - name: Acme first\n        run: true\n      - name: Is the robot on?\n')],
    ['daily', t.replace('cron: "19 10 * * 1"', 'cron: "19 10 * * *"')],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    assert.ok(robotWorkflowProblems(text).length, `${why}: expected a problem`);
  }
});

test('keel-robot.yml: one issue at a time per project; a run that will not work has a group of its own, so it never displaces a queued run', async () => {
  const t = (await robotWorkflow()).template;
  const cond = robotIf(t);
  const withRun = (ctx, id) => ({ ...ctx, github: { ...ctx.github, run_id: id } });
  const group = (text, ctx, id) => crossReviewGroup(text, withRun(ctx, id));
  const events = [issueEvent(), issueEvent({ action: 'reopened' }), issueEvent({ label: 'bug' }), issueEvent({ action: 'reopened', labels: [] }),
    issueComment(), issueComment({ association: 'MEMBER' }), issueComment({ association: 'NONE', login: 'mallory' }), issueComment({ type: 'Bot', login: 'github-actions[bot]', association: 'NONE' }),
    issueComment({ pr: true }), issueComment({ labels: [] }), ghEvent('schedule', {}), dispatchEvent(), dispatchEvent('refs/heads/acme-side')];
  for (const [i, ctx] of events.entries()) {
    const runs = evalExpression(cond, ctx);
    assert.equal(group(t, ctx, 300 + i), runs ? 'keel-robot-queue' : `keel-robot-run-${300 + i}`, JSON.stringify(ctx.github.event?.comment ?? ctx.github.event?.action ?? ctx.github.event_name));
  }
  // One group for every issue: the robot works one issue at a time per project, whichever issue woke it.
  assert.equal(group(t, issueComment({ number: 99 }), 400), group(t, issueComment(), 401));
  assert.match(t, /^concurrency:\n {2}group: [^\n]*\n {2}cancel-in-progress: false$/m, 'queued, never cancelled');
  // Mutation: a group per issue lets two issues run at once.
  const perIssue = t.replace("&& 'queue' ||", "&& format('issue-{0}', github.event.issue.number) ||");
  assert.notEqual(perIssue, t, 'the mutation did not apply');
  assert.notEqual(group(perIssue, issueComment({ number: 99 }), 402), group(perIssue, issueComment(), 403));
});

test('keel-robot.yml holds every climb sandbox rule for both providers, and its result is a PR on keel/robot-<issue>, never a push to main', async () => {
  const w = await robotWorkflow();
  const t = w.template;
  const opts = { step: 'Work the issue', id: 'work', cond: "steps.pick.outputs.action == 'work'" };
  assert.deepEqual(jobsOf(t).map(j => j.id), ['agent', 'judge', 'publish'], 'the jobs, as GitHub shows them');
  assert.deepEqual(agentSandboxProblems(t), []);
  assert.deepEqual(codexEditProblems(t, opts), []);
  assert.deepEqual(agentRanProblems(t, opts), []);
  assert.deepEqual(permissionPath(t), []);
  assert.deepEqual(problems('keel-robot.yml', t, w.declared), []);
  const rendered = await readFile(join(KEEL, w.path), 'utf8');
  for (const check of [agentSandboxProblems, x => codexEditProblems(x, opts), x => agentRanProblems(x, opts)]) assert.deepEqual(check(rendered), [], "keel's rendered keel-robot.yml");
  assert.deepEqual(w.declared.sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY']);
  const agentPerms = '    permissions:\n      contents: read\n      pull-requests: read\n      actions: read\n      issues: read\n';
  assert.ok(t.includes(agentPerms));
  const push = 'git push --force origin "$head:refs/heads/keel/robot-$ISSUE"';
  assert.ok(t.includes(push));
  const publish = jobsOf(t).find(j => j.id === 'publish').text;
  const codexStep = stepsOf(t).find(s => s.includes('uses: openai/codex-action@'));
  const claudeStep = stepsOf(t).find(s => s.includes('uses: anthropics/claude-code-action@'));
  const rules = x => problems('keel-robot.yml', x, w.declared);
  for (const [why, text, check] of [
    // A push to main instead of a PR.
    ['a push to main', t.replace(push, 'git push origin "$head:refs/heads/main"'), rules],
    ['a push to main by name', t.replace(push, 'git push origin HEAD:main'), rules],
    ['a push outside keel/robot-', t.replace(push, 'git push --force origin "$head:refs/heads/keel-tend/$ISSUE"'), rules],
    ['a push instead of the PR', t.replace(/\n {10}num=\$\(gh pr list[\s\S]*?\n {10}fi\n {10}url=/, '\n          url='), robotWorkflowProblems],
    ['the agent may write issues', t.replace(agentPerms, agentPerms.replace('issues: read', 'issues: write')), agentSandboxProblems],
    ['the agent may write contents', t.replace(agentPerms, agentPerms.replace('contents: read', 'contents: write')), agentSandboxProblems],
    ['the checkout keeps its credential', t.replace('          fetch-depth: 0\n          persist-credentials: false\n', '          fetch-depth: 0\n'), agentSandboxProblems],
    ['Claude trades for its app token', t.replace(claudeStep, claudeStep.replace('          github_token: ${{ github.token }}\n', '')), agentSandboxProblems],
    ['the push in the agent\'s job', t.replace(/(\n {6}- name: Did the agent run\?\n)/, `\n      - run: ${push}$1`), agentSandboxProblems],
    ['no sandbox before the push', t.replace(/(\n {6}- name: Open the [\s\S]*?)\n {10}node scripts\/keel\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head" --records\n/, '$1\n'), agentSandboxProblems],
    ['the judge takes the commits unchecked', t.replace(/(\n {2}judge:\n[\s\S]*?)\n {10}node scripts\/keel\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head"\n/, '$1\n'), agentSandboxProblems],
    ['the judge\'s guard trusts a record', t.replace('climb.mjs guard --job robot --base "$GITHUB_SHA"', 'climb.mjs guard --job robot'), agentSandboxProblems],
    // PR #59: publish holds the record rules itself, on exactly the commit the judge took.
    ['publish without the record rules', t.replace('--head "$head" --records\n', '--head "$head"\n'), robotWorkflowProblems],
    ['publish takes any head', t.replace(/\n {10}if \[ "\$head" != "\$VALIDATED" \]; then\n[\s\S]*?\n {10}fi\n/, '\n'), robotWorkflowProblems],
    ['the judge hands on its HEAD', t.replace('            git update-ref "refs/heads/$BRANCH" "$VALIDATED"\n', ''), robotWorkflowProblems],
    ['the report reads HEAD', t.replace(' --head "$VALIDATED" --issue', ' --issue'), robotWorkflowProblems],
    ['the commit named after the gate', t.replace('          echo "head=$head" >> "$GITHUB_OUTPUT"\n', ''), robotWorkflowProblems],
    ['no PR, still published', t.replace(/\n {10}if \[ -z "\$url" \]; then\n[\s\S]*?\n {10}fi\n/, '\n'), robotWorkflowProblems],
    ['Codex in danger-full-access', t.replace('          sandbox: workspace-write\n', '          sandbox: danger-full-access\n'), x => codexEditProblems(x, opts)],
    ['Codex holds the token', t.replace('        env:\n          GH_TOKEN: ""\n', '        env:\n'), x => codexEditProblems(x, opts)],
    ['Codex in the publish job', t.replace(publish, `${publish.replace(/\n$/, '')}\n${codexStep}\n`), agentSandboxProblems],
    ['Claude in the publish job', t.replace(publish, `${publish.replace(/\n$/, '')}\n${claudeStep}\n`), agentSandboxProblems],
    ['no check after the agent', t.replace(/\n {6}- name: Did the agent run\?\n[\s\S]*?(?=\n {6}(?:#|- ))/, ''), x => agentRanProblems(x, opts)],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    assert.ok(check(text).length, `${why}: expected a problem`);
  }
});

/**
 * PR #59: the robot's run mark is posted only when the judge's own step ran
 * (passed or refused), never when its job failed before judging (checkout,
 * install, the take): that mark tells the next run the issue was worked.
 * [string] for keel-robot.yml's text.
 */
export function robotPostProblems(text) {
  const out = [];
  const judge = jobsOf(text).find(j => j.id === 'judge')?.text ?? '';
  const steps = stepsOf(judge);
  const at = name => steps.findIndex(s => new RegExp(`^\\s*- name: ${name.replace(/[?]/g, '\\?')}\\n`).test(s));
  const judging = at('Judge the run'), judged = at('Did the judge run?');
  if (judged < 0) return ['the judge job does not say whether its "Judge the run" step ran'];
  if (judged < judging) out.push('"Did the judge run?" runs before the judge');
  if (!/\n\s+if: always\(\)\n/.test(steps[judged])) out.push('"Did the judge run?" is not always(): a refused judge would say nothing');
  if (!/OUTCOME: \$\{\{ steps\.judge\.outcome \}\}/.test(steps[judged]) || !/echo "judged=\$OUTCOME" >> "\$GITHUB_OUTPUT"/.test(steps[judged])) out.push('"Did the judge run?" does not hand on the judge step\'s own outcome');
  if (!/\n {6}judged: \$\{\{ steps\.judged\.outputs\.judged \}\}\n/.test(judge)) out.push('the judge job does not output judged');
  const post = stepsOf(jobsOf(text).find(j => j.id === 'publish')?.text ?? '').find(s => /- name: Post the agent's last message\n/.test(s)) ?? '';
  const cond = /\n\s+if: (.*)\n/.exec(post)?.[1] ?? '';
  if (!cond.startsWith('always() && ')) return [...out, 'the post step is not always() (a refused judge still posts why)'];
  const posts = (result, judgedAs, action = 'work', pr = result === 'success' ? 'success' : 'skipped') => evalExpression(cond.replace(/^always\(\) && /, ''), { needs: { agent: { outputs: { action } }, judge: { result, outputs: judgedAs === undefined ? {} : { judged: judgedAs } } }, steps: { pr: { outcome: pr } } });
  for (const [result, judgedAs, want, why, pr] of [
    ['success', 'success', true, 'a judge that passed, published'],
    // PR #59: the mark says the issue was worked; a failed push or PR must leave it to be tried again.
    ['success', 'success', false, 'a judge that passed, but the push or the PR failed', 'failure'],
    ['success', 'success', false, 'a judge that passed, but publishing never ran', 'skipped'],
    ['failure', 'failure', true, 'a judge that refused'],
    ['failure', 'skipped', false, 'a judge job that failed before judging'],
    ['failure', undefined, false, 'a judge job that failed before it could say'],
    ['skipped', undefined, false, 'no judge'],
  ]) if (posts(result, judgedAs, 'work', pr) !== want) out.push(`the post step ${want ? 'does not post' : 'posts the run\'s mark'} for ${why}`);
  if (posts('success', 'success', 'triage')) out.push('the post step posts on a triage run');
  if (!/JUDGE: \$\{\{ needs\.judge\.outputs\.judged \}\}/.test(post)) out.push('the post says the job\'s result, not the judge step\'s');
  return out;
}

test('PR #59: keel-robot.yml posts the run\'s mark only when the judge\'s own step ran; a judge job that failed before judging leaves the issue to be tried again', async () => {
  const t = (await robotWorkflow()).template;
  assert.deepEqual(robotPostProblems(t), []);
  assert.deepEqual(robotPostProblems(await readFile(join(KEEL, '.github/workflows/keel-robot.yml'), 'utf8')), [], "keel's rendered keel-robot.yml");
  const judged = /\n {6}# Whether the judge itself ran[\s\S]*?echo "judged=\$OUTCOME" >> "\$GITHUB_OUTPUT"\n/.exec(t)[0];
  for (const [why, text] of [
    ['posted on the job\'s result, as it was', t.replace("((needs.judge.outputs.judged == 'success' && steps.pr.outcome == 'success') || needs.judge.outputs.judged == 'failure')", "(needs.judge.result == 'success' || needs.judge.result == 'failure')")],
    ['no step says the judge ran', t.replace(judged, '\n')],
    ['the step reads the job, not the judge step', t.replace('OUTCOME: ${{ steps.judge.outcome }}', 'OUTCOME: ${{ job.status }}')],
    ['the step only when all went well', t.replace('        id: judged\n        if: always()\n', '        id: judged\n')],
    ['posted whatever publishing did', t.replace("(needs.judge.outputs.judged == 'success' && steps.pr.outcome == 'success')", "needs.judge.outputs.judged == 'success'")],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    assert.ok(robotPostProblems(text).length, `${why}: expected a problem`);
  }
});

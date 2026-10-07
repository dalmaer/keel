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
import { load } from '../lib/practices.mjs';
import { run } from './helpers/run.mjs';
import { runBlocks, inlineNode, shellProblems } from './helpers/workflows.mjs';

export { runBlocks, inlineNode, shellProblems };

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each keel workflow's own branch prefix: the only refs it may push or drain. */
export const PREFIX = {
  'keel-night.yml': 'keel-night/',
  'keel-loop.yml': 'keel-loop/',
  'keel-climb.yml': 'keel-climb/',
  'keel-tend.yml': 'keel-tend/',
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
  assert.deepEqual(all.map(w => w.name).sort(), ['check.yml', 'claude.yml', 'keel-climb.yml', 'keel-cross-review.yml', 'keel-impact.yml', 'keel-loop.yml', 'keel-night.yml', 'keel-tend.yml']);
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
  const install = steps.find(s => /^\s+- name: Install\s*$/.test(s.lines[0]));
  const config = steps.find(s => s.lines.some(l => /^\s+id: config\s*$/.test(l)));
  const expr = 'GH_TOKEN: ${{ secrets[steps.config.outputs.setup_token] || github.token }}';
  if (!config || !/fs\.appendFileSync\(process\.env\.GITHUB_OUTPUT, `setup_token=\$\{tok \?\? ""\}\\n`\)/.test(config.lines.join('\n'))) out.push('the config step does not output setup_token');
  if (config && !/!\/\^\[A-Z_\]\[A-Z0-9_\]\*\$\/\.test\(tok\)/.test(config.lines.join('\n'))) out.push('the config step does not check setupToken is a secret name');
  if (!install) return [...out, 'no Install step'];
  const own = install.lines.filter(l => !/^\s*#/.test(l));
  const envAt = own.findIndex(l => /^\s{8}env:\s*$/.test(l));
  const runAt = own.findIndex(l => /^\s{8}run:/.test(l));
  const inEnv = envAt >= 0 && own.slice(envAt + 1, runAt < envAt ? undefined : runAt).some(l => l.trim() === expr);
  if (!inEnv) out.push('the Install step\'s env does not set GH_TOKEN from the setupToken secret (with the job token as fallback)');
  if (/GITHUB_ENV|GITHUB_OUTPUT|GITHUB_STATE/.test(own.join('\n'))) out.push('the Install step writes to GITHUB_ENV/OUTPUT: the token could reach later steps');
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const n = i + 1;
    const mine = i >= install.start && i < install.start + install.lines.length;
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
      ['also in another step', t.replace(/(      - name: Verdict\n(?:        if:[^\n]*\n)?)/, `$1        env:\n${expr}`)],
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
  assert.match(t, /git push --force origin "HEAD:refs\/heads\/keel-climb\/\$JOB\/\$DAY"/);
  // STITCH_API_KEY: a loop night's pull (phase 37), in its own step only.
  assert.deepEqual(w.declared.sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'STITCH_API_KEY']);
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
    ['no guard', t.replace('          node scripts/keel/climb.mjs guard\n', '')],
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
  if (!new RegExp(`OUTCOME: \\$\\{\\{ steps\\.${id}\\.outcome \\}\\}`).test(body)) out.push(`"Did the agent run?" does not read steps.${id}.outcome`);
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
  return out;
}

test('keel-tend.yml has the climb workflow\'s rights only: its prefix, no merge, no delete; the agent time-boxed; the guard and the report before one PR', async () => {
  const w = (await shipped()).find(x => x.name === 'keel-tend.yml');
  const t = w.template;
  assert.equal(w.practice, 'climb');
  assert.deepEqual(tendWorkflowProblems(t), []);
  assert.deepEqual(tendWorkflowProblems(await readFile(join(KEEL, w.path), 'utf8')), [], "keel's rendered keel-tend.yml");
  assert.match(t, /git push --force origin "HEAD:refs\/heads\/keel-tend\/\$DAY"/);
  assert.deepEqual(w.declared.sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
  const climbCron = /cron: "(\d+) (\d+) /.exec((await shipped()).find(x => x.name === 'keel-climb.yml').template);
  const tendCron = /cron: "(\d+) (\d+) /.exec(t);
  assert.deepEqual([Number(tendCron[1]) - Number(climbCron[1]), tendCron[2]], [1, climbCron[2]], 'a minute after the climb\'s');
  const tools = /--allowedTools "([^"]*)"/.exec(t)[1];
  const push = 'git push --force origin "HEAD:refs/heads/keel-tend/$DAY"';
  for (const [why, text, rule] of [
    ['a push outside keel-tend/', t.replace(push, 'git push --force origin "HEAD:refs/heads/keel-climb/$DAY"'), 'problems'],
    ['a push to main', t.replace(push, 'git push origin main'), 'problems'],
    ['a merge', `${t}\n      - run: gh pr merge 1 --squash\n`, 'problems'],
    ['git push allowed', t.replace(tools, `${tools},Bash(git push*)`)],
    ['rm allowed', t.replace(tools, `${tools},Bash(rm *)`)],
    ['git rm allowed', t.replace(tools, `${tools},Bash(git rm *)`)],
    ['gh allowed', t.replace(tools, `${tools},Bash(gh pr close *)`)],
    ['climb.mjs not allowed', t.replace('Bash(node scripts/keel/climb.mjs *),', '')],
    ['no time box', t.replace(/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.pick\.outputs\.minutes\) \}\}/, '')],
    ['no tend guard', t.replace('          node scripts/keel/climb.mjs guard --job tend\n', '')],
    ['a push whatever was committed', t.replace('if [ "$COMMITS" = 0 ] || [ -z "$COMMITS" ]; then', 'if false; then')],
    ['a branch deleted', t.replace(push, `${push}\n          git push origin --delete refs/heads/keel-tend/old`)],
    ['a PR closed', t.replace(push, `${push}\n          gh pr close 3`)],
    ['tend off said late', t.replace('      - name: Is tend on?\n', '      - name: Acme first\n        run: true\n      - name: Is tend on?\n')],
    ['daily', t.replace('cron: "42 9 * * 1"', 'cron: "42 9 * * *"')],
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
 */
export function evalExpression(source, ctx) {
  const tokens = [];
  const re = /\s*(?:('(?:[^']|'')*')|(\d+(?:\.\d+)?)|(&&|\|\||==|!=|!|\(|\)|,|\.|\[|\])|([A-Za-z_][\w-]*))/y;
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
    let v = ctx[t.id] ?? null;
    for (;;) {
      if (op('.')) { const k = tokens[i++]?.id; v = v?.[k] ?? null; }
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
  return truthy(v);
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
export const CROSS_REVIEW_TOOLS = Object.freeze(['Read', 'Grep', 'Glob', 'Bash(gh pr diff:*)', 'Bash(gh pr view:*)', 'mcp__github_inline_comment__create_inline_comment']);
export function crossReviewProblems(text) {
  const out = [];
  const on = /\non:\n((?: {2}.*\n)+)/.exec(text)?.[1] ?? '';
  const events = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map(m => m[1]);
  if (events.join(',') !== 'pull_request,issue_comment') out.push(`triggers are ${events.join(', ') || 'none'}; only pull_request and issue_comment`);
  const types = name => /types: \[([^\]]*)\]/.exec(on.split(new RegExp(`^ {2}${name}:`, 'm'))[1]?.split(/^ {2}\S/m)[0] ?? '')?.[1].split(',').map(s => s.trim());
  if (JSON.stringify(types('pull_request')) !== JSON.stringify(['opened', 'ready_for_review'])) out.push(`pull_request types ${JSON.stringify(types('pull_request'))}: only opened and ready_for_review, never a push`);
  if (JSON.stringify(types('issue_comment')) !== JSON.stringify(['created'])) out.push('issue_comment types: only created');
  const tools = /--allowedTools "([^"]*)"/.exec(text)?.[1];
  if (!tools) out.push('the agent has no --allowedTools list');
  else for (const t of tools.split(',').map(s => s.trim())) if (!CROSS_REVIEW_TOOLS.includes(t)) out.push(`the agent may use ${t}: only ${CROSS_REVIEW_TOOLS.join(', ')}`);
  if ((text.match(/--allowedTools/g) ?? []).length !== 1 || /--(?:dangerously-skip-permissions|permission-mode)/.test(text)) out.push('one --allowedTools list, and no way around it');
  const perms = /\npermissions:\n((?: {2}.*\n)+)/.exec(text)?.[1] ?? '';
  if (!/^ {2}contents: read$/m.test(perms)) out.push('permissions must say contents: read');
  if (/:\s*write-all|contents: write|actions: write/.test(text)) out.push('the token may write contents or actions');
  for (const { line, n } of code(text)) {
    if (/\bgit push\b|\bgh pr (merge|review|close|edit)\b|\bAPPROVE\b|REQUEST_CHANGES|--approve|--request-changes/.test(line)) out.push(`line ${n}: pushes, merges, approves or requests changes: ${line.trim()}`);
    if (/\bgh api\b/.test(line) && !/^\s*gh api --method POST "repos\/\$REPO\/pulls\/\$PR\/reviews" --input "\$RUNNER_TEMP\/review\.json"/.test(line)) out.push(`line ${n}: a gh api call other than the summary review: ${line.trim()}`);
  }
  if (!/cross-review\.mjs" summary --file [^\n]* --out "\$RUNNER_TEMP\/review\.json"/.test(text)) out.push('the summary review is not the script\'s (cross-review.mjs summary): its event would be the workflow\'s to get wrong');
  const reviewStep = /\n {6}- name: Review\n[\s\S]*?(?=\n {6}(?:#|- )|$)/.exec(text)?.[0] ?? '';
  if (!/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.which\.outputs\.minutes\) \}\}\n/.test(reviewStep) || !/\n\s+uses: anthropics\/claude-code-action@v\d+\n/.test(reviewStep)) out.push('the agent\'s step is not time-boxed by the budget (steps.which.outputs.minutes)');
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
  // The branch prefix is the config's, read at run time: every step after "Which pull request?" waits on it.
  const steps = t.split(/\n(?= {6}- )/).filter(s => /^ {6}- /.test(s));
  const which = steps.findIndex(s => s.includes('- name: Which pull request?'));
  assert.ok(which > 0);
  assert.match(steps[which], /node scripts\/keel\/cross-review\.mjs which --pr "\$RUNNER_TEMP\/pr\.json" --event "\$EVENT"/);
  for (const s of steps.slice(which + 1)) assert.match(s, /\n {8}if: steps\.which\.outputs\.review == 'true'\n/, s.split('\n')[0]);
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

test('keel-cross-review.yml: the agent reads and comments inline, nothing else; the review event is COMMENT; nothing pushes, approves or merges', async () => {
  const w = (await shipped()).find(x => x.name === 'keel-cross-review.yml');
  const t = w.template;
  assert.equal(w.practice, 'cross-review');
  assert.equal(w.optional, true);
  assert.deepEqual(w.declared.sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
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
    ['the summary not the script\'s', t.replace(/node "\$RUNNER_TEMP\/keel\/scripts\/keel\/cross-review\.mjs" summary [^\n]*\n/, 'echo \'{"event":"COMMENT","body":"x"}\' > "$RUNNER_TEMP/review.json"\n')],
    ['on every push', t.replace('types: [opened, ready_for_review]', 'types: [opened, ready_for_review, synchronize]')],
    ['pull_request_target', t.replace('  pull_request:\n', '  pull_request_target:\n')],
    ['no time box', t.replace(/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.which\.outputs\.minutes\) \}\}/, '')],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    assert.ok(crossReviewProblems(text).length, `${why}: expected a problem`);
  }
});

/**
 * A workflow's budgeted agent steps (phase 43): each step that uses
 * claude-code-action time-boxed by a budget (`timeout-minutes` from a step's
 * `minutes` output): { agent, check }, its `name:` and the name of the step
 * right after it (null when either has none).
 */
export function budgetedAgentSteps(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*uses:\s*anthropics\/claude-code-action@/.test(lines[i])) continue;
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
    let next = null;
    while (j < lines.length && /^\s*(#.*)?$/.test(lines[j])) j++;
    if (j < lines.length && new RegExp(`^\\s{${indent}}- `).test(lines[j])) {
      next = nameOf(lines[j]);
      for (let k = j + 1; next === null && k < lines.length && !(lines[k].trim() && /^(\s*)/.exec(lines[k])[1].length <= indent); k++) if (/^\s*name:/.test(lines[k])) next = nameOf(lines[k]);
    }
    out.push({ agent: nameOf(step.split('\n').find(l => /^\s*name:/.test(l))), check: next });
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
  assert.deepEqual(budgetedAgentSteps(tend.replace(/^ {6}- name: Tend$/m, '      - name: Tend the repo')), [{ agent: 'Tend the repo', check: 'Did the agent run?' }]);
  assert.deepEqual(budgetedAgentSteps(tend.replace(/^ {6}- name: Did the agent run\?$/m, '      - name: Did Claude run?')), [{ agent: 'Tend', check: 'Did Claude run?' }]);
  // An unbudgeted claude-code-action (claude.yml's) is not a budgeted pass.
  assert.deepEqual(budgetedAgentSteps(all.find(w => w.name === 'claude.yml').template), []);
});

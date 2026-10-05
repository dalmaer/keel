// The night shift's rules, held on the workflow templates keel ships (and on
// keel's own rendered copies), read as text: no YAML dependency. Design §6:
// a bot writes a PR, never main; one queue per workflow, its own branch
// prefix; a merge only after a gate; a guard that fires into a room. Each rule
// is a function of the text, and each is mutation-checked below: a template
// that breaks it must fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../lib/practices.mjs';
import { run } from './helpers/run.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each keel workflow's own branch prefix: the only refs it may push or drain. */
export const PREFIX = {
  'keel-night.yml': 'keel-night/',
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
  assert.deepEqual(all.map(w => w.name).sort(), ['check.yml', 'claude.yml', 'keel-loop.yml', 'keel-night.yml']);
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
  fails(night.replace('if [ -z "$(git status --porcelain)" ]; then', 'if git diff --quiet; then'), /porcelain/, 'git diff --quiet');
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
  for (const name of ['keel-night.yml']) {
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

test('keel-night and keel-loop install with the config\'s setup, else npm ci, and export its env', async () => {
  const all = await shipped();
  for (const name of ['keel-night.yml', 'keel-loop.yml']) {
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
  for (const name of ['keel-night.yml', 'keel-loop.yml']) {
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

/**
 * Every `run:` script in one workflow's text, read without a YAML dependency:
 * [{ step, line, script }]. A `run: |` (or `>`) block is the lines indented past
 * its key, the common indent stripped; a one-line `run:` is its value (outer
 * quotes stripped). GitHub's `${{ … }}` and a template's `{{name}}` become the
 * word GHEXPR, so the shell sees what it would after substitution.
 */
export function runBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  let step = null;
  const sub = s => s.replace(/\$\{\{[\s\S]*?\}\}/g, 'GHEXPR').replace(/\{\{\s*[\w.-]+\s*\}\}/g, 'GHEXPR');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    const item = /^(\s*)- /.exec(line);
    if (item) step = null;
    const name = /^\s*(?:- )?name:\s*(.+?)\s*$/.exec(line);
    if (name) step = name[1].replace(/^(["'])(.*)\1$/, '$2');
    const r = /^(\s*)(- )?run:\s*(.*?)\s*$/.exec(line);
    if (!r) continue;
    const keyIndent = r[1].length + (r[2] ? 2 : 0);
    const value = r[3];
    if (/^[|>][-+]?\d*$/.test(value)) {
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() && l.search(/\S/) <= keyIndent) break;
        body.push(l);
      }
      while (body.length && !body.at(-1).trim()) body.pop();
      const indent = Math.min(...body.filter(l => l.trim()).map(l => l.search(/\S/)));
      out.push({ step: step ?? `line ${i + 1}`, line: i + 1, script: sub(body.map(l => l.slice(indent)).join('\n')) });
      i = j - 1;
    } else {
      out.push({ step: step ?? `line ${i + 1}`, line: i + 1, script: sub(value.replace(/^(["'])(.*)\1$/, '$2')) });
    }
  }
  return out;
}

/** The single-quoted JS of each `node [--input-type=module] -e '…'` in a script: [{ module, js }]. */
export function inlineNode(script) {
  return [...script.matchAll(/\bnode\s+(--input-type=module\s+)?-e\s+'([^']*)'/g)].map(m => ({ module: Boolean(m[1]), js: m[2] }));
}

/** What bash -n and node --check say about one workflow's scripts: [string], each naming the step. */
export async function shellProblems(label, text) {
  const out = [];
  const dir = await mkdtemp(join(tmpdir(), 'keel-wf-'));
  try {
    for (const b of runBlocks(text)) {
      const where = `${label}: step "${b.step}" (line ${b.line})`;
      const sh = run('bash', ['-n'], { input: `${b.script}\n` });
      if (sh.status !== 0) out.push(`${where}: bash -n: ${sh.stderr.trim().split('\n')[0]}`);
      for (const [k, n] of inlineNode(b.script).entries()) {
        const file = join(dir, `b${b.line}-${k}.${n.module ? 'mjs' : 'cjs'}`);
        await writeFile(file, n.js);
        const js = run(process.execPath, ['--check', file]);
        if (js.status !== 0) out.push(`${where}: node -e: ${js.stderr.trim().split('\n').filter(l => /Error|^\S.*:\d+$/.test(l)).join(' | ')}`);
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  return out;
}

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

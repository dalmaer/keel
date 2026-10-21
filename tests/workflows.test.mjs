// The night shift's rules, held on the workflow templates plates ships (and on
// plates's own rendered copies), read as text: no YAML dependency. Design §6:
// a bot writes a PR, never main; one queue per workflow, its own branch
// prefix; a merge only after a gate; a guard that fires into a room. Each rule
// is a function of the text, and each is mutation-checked below: a template
// that breaks it must fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile, rm, mkdir, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, fill, plan, PUSH_TRIGGERS, CROSS_REVIEW_WORKFLOW, PUBLISH_WORKFLOW, PROJECT, shapePublish, gateNameIn } from '../lib/practices.mjs';
import { concurrencyOf, concurrencyProblems, workflowKind } from '../practices/delivery/files/scripts/plates/delivery.mjs';
import { run } from './helpers/run.mjs';
import { AGENTS } from '../practices/night/files/scripts/plates/lib.mjs';
import { runBlocks, inlineNode, shellProblems } from './helpers/workflows.mjs';

export { runBlocks, inlineNode, shellProblems };

const PLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each plates workflow's own branch prefix: the only refs it may push or drain. */
export const PREFIX = {
  'plates-night.yml': 'keel-night/',
  'plates-morning.yml': 'keel-night/',
  'plates-loop.yml': 'keel-loop/',
  'plates-climb.yml': 'keel-climb/',
  'plates-robot.yml': 'keel/robot-',
  'plates-robot-route.yml': null,
  'plates-tend.yml': 'keel-tend/',
  'claude.yml': 'claude/',
  'plates-cross-review.yml': null,
  'check.yml': null,
  'typecheck.yml': null,
  'plates-impact.yml': null,
  'plates-publish.yml': null,
};

// Contributor-only workflows are deliberately not installed by a practice.
// Register each by name so adding another cannot silently escape the guards.
const LOCAL_WORKFLOWS = Object.freeze({
  'typecheck.yml': { declared: [] },
});

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

/** The optional Vercel secret belongs only to the production collector step. */
export function productionSecretProblems(text) {
  const out = [], binding = "          VERCEL_TOKEN: ${{ steps.config.outputs.production_vercel == 'true' && secrets.VERCEL_API_TOKEN || '' }}";
  const steps = text.split(/\n(?= {6}- )/);
  const collectors = steps.filter(s => /^ {6}- name: Collect production evidence\n/.test(s));
  if (collectors.length !== 1 || !collectors[0].includes(binding + '\n')) out.push('production: one step-scoped Vercel secret binding is required');
  for (const step of steps) {
    const body = code(step).map(x=>x.line).join('\n');
    if (/^ {6}- name: Collect production evidence\n/.test(step)) {
      if (!/\n {8}run: node scripts\/plates\/production-night\.mjs\n(?:\s*#[^\n]*\n)*$/.test(step.trimEnd() + '\n')) out.push('production: only the bounded collector may receive the provider secret');
      if (/VERCEL_TOKEN|VERCEL_API_TOKEN|secrets\./.test(body.replace(binding,''))) out.push('production: provider secret must not be duplicated, printed or exported');
    } else if (/VERCEL_TOKEN|VERCEL_API_TOKEN|secrets\./.test(body.replace('secrets[steps.config.outputs.setup_token]', ''))) out.push('production: provider secret outside collection step');
  }
  return out;
}

/**
 * Every rule broken by one workflow's text: [string]. `name` is its file name,
 * `declared` the secret names its practice declares for it.
 */
export function problems(name, text, declared = []) {
  const out = name === 'plates-night.yml' ? productionSecretProblems(text) : [];
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
    if (/\bgh pr merge\b/.test(line)) out.push(`line ${n}: merges directly; merges go through plates drain, after a gate`);
    const drain = /(?:\bplates|outputs\.cli \}\})\s+drain\s+(\S*\/\S*)/.exec(line) ?? /\bdrain\.mjs\s+(\S*\/\S*)/.exec(line);
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
  if (/--gate-passed/.test(text) && !/GATE: \$\{\{ steps\.(improve|gate)\.outputs\.gate \}\}/.test(text)) out.push('--gate-passed, but GATE is not the gate this run ran (plates improve\'s measure, or a gate step)');
  return out;
}

/** Every workflow plates ships: { practice, name, template, declared }. */
async function shipped() {
  const out = [];
  for (const p of (await load()).values()) for (const f of p.files) {
    if (!f.path.startsWith('.github/workflows/')) continue;
    out.push({ practice: p.name, optional: p.optional, path: f.path, name: f.path.split('/').pop(), template: f.template,
      declared: p.secrets.filter(s => s.workflow === f.path).map(s => s.name) });
  }
  return out;
}

/** Optional controls adoption, not whether an existing rendered file is checked. */
function renderedWorkflowPaths(workflows, enabled, present) {
  for (const w of workflows) if (enabled.includes(w.practice)) {
    assert.ok(present.has(w.path), `configured workflow missing: ${w.path} (${w.practice})`);
  }
  return workflows.filter(w => present.has(w.path)).map(w => w.path);
}

async function renderedWorkflows(workflows) {
  const cfg = JSON.parse(await readFile(join(PLATES, '.plates/plates.json'), 'utf8'));
  const present = new Set((await readdir(join(PLATES, '.github/workflows')))
    .filter(n => /\.ya?ml$/.test(n)).map(n => `.github/workflows/${n}`));
  const paths = renderedWorkflowPaths(workflows, cfg.practices, present);
  return new Map(await Promise.all(paths.map(async path => [path, await readFile(join(PLATES, path), 'utf8')])));
}

test('every workflow plates ships keeps the night shift\'s rules, as a template and as rendered on plates', async () => {
  const all = await shipped();
  const rendered = await renderedWorkflows(all);
  const optional = { practice: 'acme', optional: true, path: '.github/workflows/acme.yml' };
  assert.deepEqual(renderedWorkflowPaths([optional], ['acme'], new Set([optional.path])), [optional.path]);
  assert.deepEqual(renderedWorkflowPaths([optional], [], new Set([optional.path])), [optional.path], 'an actual file is checked even when its practice is disabled');
  assert.deepEqual(renderedWorkflowPaths([optional], [], new Set()), [], 'a disabled absent workflow has only its template checked');
  assert.throws(() => renderedWorkflowPaths([optional], ['acme'], new Set()), /configured workflow missing: .*acme\.yml/, 'configured missing outputs cannot silently skip policy checks');
  assert.deepEqual(all.map(w => w.name).sort(), ['check.yml', 'claude.yml', 'plates-climb.yml', 'plates-cross-review.yml', 'plates-impact.yml', 'plates-loop.yml', 'plates-morning.yml', 'plates-night.yml', 'plates-publish.yml', 'plates-robot-route.yml', 'plates-robot.yml', 'plates-tend.yml']);
  for (const w of all) {
    assert.ok(Object.hasOwn(PREFIX, w.name), `${w.name}: name its own branch prefix in PREFIX`);
    assert.deepEqual(problems(w.name, w.template, w.declared), [], `${w.practice} ${w.path}`);
    if (rendered.has(w.path)) assert.deepEqual(problems(w.name, rendered.get(w.path), w.declared), [], `plates's ${w.path}`);
  }
  for (const n of (await readdir(join(PLATES, '.github/workflows'))).filter(n => /\.ya?ml$/.test(n))) {
    assert.ok(all.some(w => w.name === n) || Object.hasOwn(LOCAL_WORKFLOWS, n), `plates's ${n} is neither shipped by a practice nor registered locally; it would escape this test`);
    if (Object.hasOwn(LOCAL_WORKFLOWS, n)) {
      assert.ok(!all.some(w => w.name === n), `${n}: a local workflow must not also ship to adopters`);
      assert.ok(Object.hasOwn(PREFIX, n), `${n}: name its own branch prefix in PREFIX`);
      const text = await readFile(join(PLATES, '.github/workflows', n), 'utf8');
      assert.deepEqual(problems(n, text, LOCAL_WORKFLOWS[n].declared), [], `plates's local ${n}`);
    }
  }
});

test('local typecheck workflow installs contributor dependencies and obeys the same workflow guards', async () => {
  const name = 'typecheck.yml';
  assert.ok(Object.hasOwn(LOCAL_WORKFLOWS, name));
  assert.equal(PREFIX[name], null, 'typechecking has no branch it may push');
  const text = await readFile(join(PLATES, '.github/workflows', name), 'utf8');
  assert.match(text, /- run: npm ci --ignore-scripts\s*\n\s*- run: npm run typecheck/);
  for (const [why, changed, expected] of [
    ['prohibited push', text + '\n      - run: git push origin HEAD:refs/heads/acme-check\n', /outside this workflow's prefix/],
    ['missing concurrency', text.replace(/^concurrency:\n(?:[ \t]+[^\n]*\n)+/m, ''), /no concurrency group/],
  ]) {
    assert.notEqual(changed, text, `${why}: mutation must apply`);
    assert.ok(problems(name, changed, LOCAL_WORKFLOWS[name].declared).some(p => expected.test(p)), why);
  }
  const malformed = text.replace('run: npm run typecheck', 'run: if true; then echo');
  assert.ok((await shellProblems(name, malformed)).length, 'the local workflow also gets shell syntax checks');
});

test('the night workflow measures before it drains, pushes only its dated branch, and goes red on a broken instrument or gate', async () => {
  const night = (await shipped()).find(w => w.name === 'plates-night.yml').template;
  const at = s => { const i = night.indexOf(s); assert.ok(i >= 0, `missing: ${s}`); return i; };
  assert.ok(at('node scripts/plates/improve.mjs --report --json') < at('node scripts/plates/drain.mjs keel-night/'), 'improve runs before the drain, so machine_prs counts last night\'s PR');
  assert.ok(at('git status --porcelain') < at('git commit'));
  assert.match(night, /git push --force origin "HEAD:refs\/heads\/keel-night\/\$DAY"/);
  assert.match(night, /cancel-in-progress: false/);
  assert.match(night, /- name: Verdict\n\s+if: always\(\)\n/, 'the verdict runs even after a failed step');
  assert.match(night, /if \[ "\$CODE" = 2 \] \|\| \[ -z "\$CODE" \]; then[\s\S]*?exit 1/, 'a broken instrument (or no reading) is red');
  assert.match(night, /if \[ "\$GATE" != ok \]; then[\s\S]*?exit 1/, 'a failing gate is red');
  assert.doesNotMatch(night.slice(at('if [ "$CODE" = 1 ]')), /exit 1/, 'outside a bound is news, not red');
  assert.deepEqual(productionSecretProblems(night), [], 'only optional production collection receives its declared provider secret');
  assert.deepEqual(night.match(/secrets\[[^\]]*\]/g), ['secrets[steps.config.outputs.setup_token]'], 'dynamic secrets remain confined to the project setupToken');
});

test('mutations: a workflow that breaks a rule fails', async () => {
  const w = (await shipped()).find(w => w.name === 'plates-night.yml');
  const night = w.template;
  const fails = (text, pattern, why) => {
    const found = problems('plates-night.yml', text, w.declared);
    assert.ok(found.some(p => pattern.test(p)), `${why}: expected a problem matching ${pattern}, got ${JSON.stringify(found)}`);
  };
  const push = 'git push --force origin "HEAD:refs/heads/keel-night/$DAY"';
  assert.ok(night.includes(push));
  fails(night.replace(push, 'git push origin main'), /names main|no explicit/, 'git push origin main');
  fails(night.replace(push, 'git push'), /no explicit/, 'a bare git push');
  fails(night.replace(push, 'git push origin HEAD:refs/heads/main'), /outside this workflow's prefix|names main/, 'a push to refs/heads/main');
  fails(night.replace(push, 'git push origin "HEAD:refs/heads/renovate/x"'), /outside this workflow's prefix/, 'another queue\'s branch');
  fails(night.replace('if [ "${#PATHS[@]}" = 0 ] || [ -z "$(git status --porcelain -- "${PATHS[@]}")" ]; then', 'if git diff --quiet; then'), /porcelain/, 'git diff --quiet');
  fails(night.replace(/concurrency:\n\s+group: plates-night\n/, ''), /no concurrency group/, 'no concurrency');
  fails(night.replace('cron: "23 7 * * *"', 'cron: "23 7 * *"'), /invalid cron/, 'four fields');
  fails(night.replace('cron: "23 7 * * *"', 'cron: "61 7 * * *"'), /invalid cron/, 'minute 61');
  fails(night.replace('    env:\n      GH_TOKEN: ${{ github.token }}\n', '    env:\n      GH_TOKEN: ${{ github.token }}\n      ACME: ${{ secrets.ACME_SECRET }}\n'), /ACME_SECRET is not declared/, 'an undeclared secret');
  fails(night.replace(/if \[ "\$GATE" = ok \]; then\n(\s+)(.*drain\.mjs keel-night\/ --yes --gate-passed)/, '$1$2\n$1true'), /outside an if on the gate/, 'an unconditional --gate-passed');
  fails(night.replace('drain.mjs keel-night/ --yes --gate-passed', 'drain.mjs plates/ --yes --gate-passed'), /not this workflow's prefix/, 'draining another prefix');
  fails(`${night}\n      - run: gh pr merge 1 --squash\n`, /merges directly/, 'a direct merge');
  assert.deepEqual(problems('plates-night.yml', night, w.declared), [], 'the unmutated template is clean');
});

/**
 * Every way a shipped workflow could reach back to plates at runtime (design §6,
 * "Projects run on their own"): plates's repo by name, a plates token, any clone,
 * or plates's CLI. The one exception is plates's own night gathering its inbox:
 * `node bin/plates.mjs learn` in a step guarded on `steps.self.outputs.self`,
 * set by a step that reads `"plates": "self"` from .plates/plates.json.
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
  const selfStep = steps.find(s => s.lines.some(l => /^\s+id: self\s*$/.test(l)) && s.lines.some(l => /\.plates === 'self'/.test(l)));
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/dalmaer\/plates\b/.test(line)) out.push(`line ${n}: names plates's repo`);
    if (/\bPLATES_TOKEN\b/.test(line)) out.push(`line ${n}: a plates token`);
    if (/\bgh repo clone\b/.test(line)) out.push(`line ${n}: gh repo clone`);
    if (/\bgit clone\b/.test(line)) out.push(`line ${n}: git clone`);
    if (/\bplates\.mjs\b/.test(line)) {
      const step = stepOf(i);
      const guarded = selfStep && step && step !== selfStep && step.lines.some(l => /^\s+if: steps\.self\.outputs\.self == 'true'\s*$/.test(l));
      if (!guarded || !/\bnode bin\/plates\.mjs learn\b/.test(line)) out.push(`line ${n}: plates's CLI outside plates's own learn step`);
    }
  });
  return out;
}

test('no shipped workflow reaches back to plates: no plates repo, no plates token, no clone, no plates CLI (plates\'s own learn aside)', async () => {
  const all = await shipped(), rendered = await renderedWorkflows(all);
  for (const w of all) {
    assert.deepEqual(reachesBack(w.template), [], `${w.practice} ${w.path}`);
    if (rendered.has(w.path)) assert.deepEqual(reachesBack(rendered.get(w.path)), [], `plates's ${w.path}`);
  }
  for (const p of (await load()).values()) assert.ok(!p.secrets.some(s => s.name === 'PLATES_TOKEN'), `${p.name} declares PLATES_TOKEN`);
  // Mutations: each way back is caught.
  const night = (await shipped()).find(w => w.name === 'plates-night.yml').template;
  const loop = (await shipped()).find(w => w.name === 'plates-loop.yml').template;
  const learn = 'run: node bin/plates.mjs learn';
  assert.ok(night.includes(learn));
  const add = (text, step) => text.replace('      - name: Measure\n', `${step}      - name: Measure\n`);
  for (const [why, text] of [
    ['a clone of plates', add(night, '      - run: gh repo clone dalmaer/plates "$RUNNER_TEMP/plates" -- --quiet\n')],
    ['a git clone', add(night, '      - run: git clone https://github.com/acme/tools tools\n')],
    ['a plates token', add(night, '      - env:\n          T: ${{ secrets.KEEL_TOKEN }}\n        run: echo\n')],
    ['plates\'s repo in a comment', `# fetched from dalmaer/plates\n${night}`],
    ['plates\'s CLI for the measure', night.replace('node scripts/plates/improve.mjs --report --json', 'node $RUNNER_TEMP/plates/bin/plates.mjs improve --report --json')],
    ['learn without its guard', night.replace("        if: steps.self.outputs.self == 'true'\n", '')],
    ['the guard without its self check', night.replace(".plates === 'self'", ".plates === 'acme'")],
    ['plates\'s CLI in the loop drain', loop.replace('node scripts/plates/drain.mjs keel-loop/ --yes --gate-passed', 'node bin/plates.mjs drain keel-loop/ --yes --gate-passed')],
  ]) assert.ok(reachesBack(text).length, `${why}: expected a problem`);
});

/** Each line of a workflow (comments aside) that would promote production: plates promote, or its script. [string]. */
export function promotes(text) {
  return code(text).filter(({ line }) => /\bplates(\.mjs)?\s+promote\b|outputs\.cli \}\}\s+promote\b|\bpromote\.mjs\b/.test(line)).map(({ line, n }) => `line ${n}: ${line.trim()}`);
}

test('phase 82: no workflow plates installs runs plates promote, as a template or as rendered on plates; promotion is a person\'s command', async () => {
  const all = await shipped(), rendered = await renderedWorkflows(all);
  assert.ok(all.length > 10, 'every shipped workflow is read');
  for (const w of all) {
    assert.deepEqual(promotes(w.template), [], `${w.practice} ${w.path}`);
    if (rendered.has(w.path)) assert.deepEqual(promotes(rendered.get(w.path)), [], `plates's ${w.path}`);
  }
  for (const n of (await readdir(join(PLATES, '.github/workflows'))).filter(n => /\.ya?ml$/.test(n))) {
    assert.deepEqual(promotes(await readFile(join(PLATES, '.github/workflows', n), 'utf8')), [], `plates's ${n}`);
  }
  // Mutations: each way a workflow could promote is caught; a comment is not a run.
  const publish = all.find(w => w.name === 'plates-publish.yml').template;
  const step = run => publish.replace(/\n {6}- name: /, `\n      - run: ${run}\n      - name: `);
  for (const run of ['npx plates promote --yes', 'node bin/plates.mjs promote --back "$SHA" --yes', 'node scripts/plates/promote.mjs --yes', '${{ steps.plates.outputs.cli }} promote --yes']) {
    assert.ok(promotes(step(run)).length, `${run}: expected a problem`);
  }
  assert.deepEqual(promotes(`# plates promote is the owner's\n${publish}`), [], 'a comment names it without running it');
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
  const all = await shipped(), rendered = await renderedWorkflows(all);
  for (const name of ['plates-night.yml', 'plates-climb.yml', 'plates-tend.yml']) {
    const w = all.find(w => w.name === name);
    assert.deepEqual(permissionPath(w.template), [], name);
    if (rendered.has(w.path)) assert.deepEqual(permissionPath(rendered.get(w.path)), [], `plates's ${name}`);
    const notice = w.template.split('\n').find(l => l.includes('::notice::') && l.includes('Workflow permissions'));
    for (const [why, changed, expected] of [
      ['notice removed', w.template.replace(notice, '              echo ok'), /no notice naming the setting/],
      ['match removed', w.template.replace(/grep -qi 'not permitted[^']*'/, "grep -qi 'x'"), /no match on GitHub/],
      ['other failures swallowed', w.template.replace(/else\n(\s+)exit "\$code"\n/, 'else\n$1true\n'), /any other failure must stay red/],
      ['permission removed', w.template.replace('  pull-requests: write\n', ''), /must declare contents: write and pull-requests: write/],
    ]) {
      assert.notEqual(changed, w.template, `${name} ${why}: mutation must apply`);
      const found = permissionPath(changed);
      assert.ok(found.some(p => expected.test(p)), `${name} ${why}: ${JSON.stringify(found)}`);
    }
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
  for (const f of ['lib/agent-guide.md', 'practices/loop/README.md']) assert.deepEqual(staleStitchNames(await readFile(join(PLATES, f), 'utf8')), [], f);
  // Mutations: each stale name is caught; the constant is not.
  const loop = (await shipped()).find(w => w.name === 'plates-loop.yml').template;
  assert.ok(staleStitchNames(loop.replace('secrets.STITCH_API_KEY', 'secrets.LOOP_API_KEY')).length, 'a LOOP_ secret');
  assert.ok(staleStitchNames(`${loop}\n      LOOP_WORKSPACE: acme\n`).length, 'a LOOP_ env');
  assert.ok(staleStitchNames("env.LOOP_INCLUDE_DISMISSED = '1'").length, 'a LOOP_ variable in a script');
  assert.ok(staleStitchNames(`${loop}\n      X: \${{ secrets.STITCH_INSTALLER_URL }}\n`).length, 'the installer URL secret');
  assert.ok(staleStitchNames(loop.replace('    steps:', '      STITCH_BASE_URL: https://jules.googleapis.com/v2alpha\n    steps:')).length, 'a base URL override in the workflow');
  assert.ok(staleStitchNames("const env = { ...process.env, STITCH_BASE_URL: 'https://x' };").length, 'a base URL override in a script');
  assert.deepEqual(staleStitchNames('export const LOOP_DOC_HEADER = 1;'), []);
});

/**
 * The night's install, read from .plates/plates.json at run time: `setup` when it
 * has one, else npm ci with a lockfile; `env` exported to later steps. [string].
 */
export function installProblems(text) {
  const out = [];
  const at = s => text.indexOf(s);
  if (!/readFileSync\("\.plates\/plates\.json"/.test(text)) out.push('the config is not read at run time');
  if (!/GITHUB_OUTPUT, `setup<<\$\{eof\}\\n\$\{c\.setup \?\? ""\}/.test(text)) out.push('setup is not read from .plates/plates.json');
  if (!/appendFileSync\(process\.env\.GITHUB_ENV/.test(text)) out.push('env is not exported to the later steps');
  if (!/SETUP: \$\{\{ steps\.config\.outputs\.setup \}\}\n/.test(text)) out.push('Install does not take setup from the config step');
  if (!/if \[ -n "\$SETUP" \]; then\n[^\n]*\n\s+bash -e -c "\$SETUP"\n\s+elif \[ -f package-lock\.json \]; then\n\s+npm ci\n\s+fi\n/.test(text)) out.push('no setup-else-npm-ci default');
  if (/run:[^\n]*\$\{\{ steps\.config\.outputs\.setup/.test(text) || /^\s+[^#\n]*\$\{\{ steps\.config\.outputs\.setup \}\}[^\n]*;/m.test(text)) out.push('setup is spliced into a script; pass it through env');
  if (!(at('- name: Read the config') >= 0 && at('- name: Read the config') < at('- name: Install'))) out.push('the config is read after the install');
  const measure = at('node scripts/plates/improve.mjs');
  if (measure >= 0 && !(at('- name: Install') < measure)) out.push('the install runs after the measure');
  return out;
}

test('plates-night, plates-loop, plates-climb and plates-tend install with the config\'s setup, else npm ci, and export its env', async () => {
  const all = await shipped();
  const rendered = await renderedWorkflows(all);
  for (const name of ['plates-night.yml', 'plates-loop.yml', 'plates-climb.yml', 'plates-tend.yml']) {
    const w = all.find(w => w.name === name);
    assert.deepEqual(installProblems(w.template), [], name);
    if (rendered.has(w.path)) assert.deepEqual(installProblems(rendered.get(w.path)), [], `plates's ${w.path}`);
  }
  // Mutations: each way the install goes wrong is caught.
  const night = all.find(w => w.name === 'plates-night.yml').template;
  for (const [why, text, expected] of [
    ['the old fixed install', night.replace(/      - name: Read the config[\s\S]*?          fi\n/, '      - name: Install\n        run: if [ -f package-lock.json ]; then npm ci; fi\n'), /setup is not read from \.plates\/plates\.json/],
    ['no default', night.replace(/\n\s+elif \[ -f package-lock\.json \]; then\n\s+npm ci/, ''), /no setup-else-npm-ci default/],
    ['setup ignored', night.replace('bash -e -c "$SETUP"', 'true'), /no setup-else-npm-ci default/],
    ['env not exported', night.replace('fs.appendFileSync(process.env.GITHUB_ENV', 'console.log('), /env is not exported/],
    ['setup spliced into the script', night.replace('bash -e -c "$SETUP"', 'bash -e -c "${{ steps.config.outputs.setup }}";'), /setup is spliced into a script/],
    ['the install after the measure', night.replace(/(      - name: Install\n[\s\S]*?          fi\n)([\s\S]*?)(      # Porcelain)/, '$2$1$3'), /the install runs after the measure/],
  ]) {
    assert.notEqual(text, night, `${why}: mutation must apply`);
    const found = installProblems(text);
    assert.ok(found.some(p => expected.test(p)), `${why}: ${JSON.stringify(found)}`);
  }
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
  const rendered = await renderedWorkflows(all);
  for (const name of ['plates-night.yml', 'plates-loop.yml', 'plates-climb.yml', 'plates-tend.yml']) {
    const w = all.find(w => w.name === name);
    assert.deepEqual(setupTokenProblems(w.template), [], name);
    if (rendered.has(w.path)) {
      const text = rendered.get(w.path);
      assert.deepEqual(setupTokenProblems(text), [], `plates's ${w.path}`);
      if (w.optional) {
        const leaked = text.replace('bash -e -c "$SETUP"', 'echo "$GH_TOKEN"\n            bash -e -c "$SETUP"');
        assert.notEqual(leaked, text, `${name}: rendered token mutation must apply`);
        const found = setupTokenProblems(leaked);
        assert.ok(found.some(p => /GH_TOKEN is read or printed/.test(p)), `${name}: ${JSON.stringify(found)}`);
      }
    }
  }
  // Mutations: each way the token leaks or goes missing is caught.
  const expr = '          GH_TOKEN: ${{ secrets[steps.config.outputs.setup_token] || github.token }}\n';
  for (const name of ['plates-night.yml', 'plates-loop.yml']) {
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
  for (const p of await readdir(join(PLATES, 'practices'))) {
    const d = join(PLATES, 'practices', p, 'files/.github/workflows');
    let names = [];
    try { names = await readdir(d); } catch { continue; }
    for (const n of names.filter(n => /\.ya?ml$/.test(n))) files.push(join('practices', p, 'files/.github/workflows', n));
  }
  for (const n of (await readdir(join(PLATES, '.github/workflows'))).filter(n => /\.ya?ml$/.test(n))) files.push(join('.github/workflows', n));
  assert.ok(files.length >= 7, `found ${files.length} workflows`);
  let blocks = 0, nodes = 0;
  for (const f of files) {
    const text = await readFile(join(PLATES, f), 'utf8');
    const bs = runBlocks(text);
    blocks += bs.length;
    nodes += bs.reduce((a, b) => a + inlineNode(b.script).length, 0);
    assert.deepEqual(await shellProblems(f, text), [], f);
  }
  assert.ok(blocks >= 30 && nodes >= 4, `read ${blocks} run blocks and ${nodes} inline node scripts: the extractor found too few`);

  // Mutations: the shapes that broke on GitHub, and a JS slip, are caught.
  // The clean scan above checks every block. Each mutation needs only its
  // affected block, extracted from the real template, with its step name kept.
  const night = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-night.yml'), 'utf8');
  const stepWorkflow = name => {
    const matches = runBlocks(night).filter(b => b.step === name);
    assert.equal(matches.length, 1, `one night step named ${name}`);
    return `jobs:\n  night:\n    steps:\n      - name: ${name}\n        run: |\n${matches[0].script.split('\n').map(line => `          ${line}`).join('\n')}\n`;
  };
  const config = stepWorkflow('Read the config'), install = stepWorkflow('Install');
  const mutate = (text, from, to) => {
    const changed = text.replace(from, to);
    assert.notEqual(changed, text, `syntax mutation must apply: ${from}`);
    return changed;
  };
  const comment = '// Only the secret NAME, never its value: the Install step looks it up.';
  const apostrophe = await shellProblems('night', mutate(config, comment, "// Only the secret's NAME, never its value."));
  assert.ok(apostrophe.some(p => /step "Read the config".*bash -n/.test(p)), `an apostrophe in node -e: ${JSON.stringify(apostrophe)}`);
  const js = await shellProblems('night', mutate(config, 'const tok = c.setupToken;', 'const tok = c.setupToken +;'));
  assert.ok(js.some(p => /step "Read the config".*node -e: .*SyntaxError/.test(p)), `broken JS in node -e: ${JSON.stringify(js)}`);
  const sh = await shellProblems('night', mutate(install, 'elif [ -f package-lock.json ]; then', 'elif [ -f package-lock.json ]'));
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
async function nightCommit(t, night, { health, ignore = '', tracked = {}, existingPr = '', listExit = 0, editExit = 0, planDay = '', before = async () => {}, after = async () => {} }) {
  const steps = runBlocks(night);
  const where = steps.find(b => b.step === 'Where the health page goes');
  const open = steps.find(b => b.step === "Open the night's pull request");
  assert.ok(where && open, 'both steps are in the workflow');
  const base = await mkdtemp(join(tmpdir(), 'plates-wf-night-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'acme'), origin = join(base, 'origin.git'), bin = join(base, 'bin'), temp = join(base, 'tmp');
  const git = (args, cwd = dir) => { const r = run('git', args, { cwd }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout; };
  for (const d of [dir, bin, temp, join(dir, 'scripts/plates'), join(dir, '.plates')]) await mkdir(d, { recursive: true });
  git(['init', '-q', '--bare', origin], base);
  git(['init', '-q', '-b', 'main']);
  for (const f of ['lib.mjs', 'pr-body.mjs']) await writeFile(join(dir, 'scripts/plates', f), await readFile(join(PLATES, 'practices/night/files/scripts/plates', f), 'utf8'));
  await writeFile(join(dir, '.plates/plates.json'), `${JSON.stringify({ name: 'Acme', ...(health ? { health } : {}) })}\n`);
  await writeFile(join(dir, '.gitignore'), ignore);
  for (const [f, text] of Object.entries(tracked)) { await mkdir(dirname(join(dir, f)), { recursive: true }); await writeFile(join(dir, f), text); }
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'acme']);
  git(['remote', 'add', 'origin', origin]);
  await before(dir, base);
  // gh keeps the body it is handed (--body-file), for the reader's check.
  await writeFile(join(bin, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(base, 'gh.jsonl'))}, JSON.stringify(args) + '\\n');
if (args[0] === 'pr' && args[1] === 'list') {
  if (${listExit}) { console.error('Acme PR lookup failed'); process.exit(${listExit}); }
  console.log(${JSON.stringify(existingPr)});
} else if (args[0] === 'pr' && ['create', 'edit'].includes(args[1])) {
  const body = args.indexOf('--body-file');
  if (body < 0) process.exit(2);
  fs.copyFileSync(args[body + 1], ${JSON.stringify(join(base, 'body.md'))});
  if (args[1] === 'edit' && ${editExit}) { console.error('Acme PR edit failed'); process.exit(${editExit}); }
  console.log('https://github.test/acme/acme/pull/1');
} else { process.exit(2); }
`, { mode: 0o755 });
  // The night's writes: a page where the config says, the bounds, and something that is not data.
  const out = join(temp, 'out');
  await writeFile(out, '');
  const env = { ...process.env, GITHUB_OUTPUT: out, RUNNER_TEMP: temp, PATH: `${bin}:${process.env.PATH}` };
  const w = run('bash', ['-e', '-c', where.script], { cwd: dir, env });
  if (w.status !== 0) return { where: w.status, out: w.stdout + w.stderr, files: null };
  const page = /^dir=(.*)$/m.exec(await readFile(out, 'utf8'))?.[1];
  await mkdir(join(dir, health ?? 'docs/health'), { recursive: true });
  await writeFile(join(dir, health ?? 'docs/health', '2026-10-05.md'), '# Health — 2026-10-05\n');
  await writeFile(join(dir, '.plates/bounds.json'), '{}\n');
  await writeFile(join(dir, 'acme-scratch.txt'), 'setup left this\n');
  await after(dir);
  // improve's --pr-input, as improve writes it (nightPr), for a night with a measure outside.
  const { nightPr } = await import('../practices/night/files/scripts/plates/improve.mjs');
  await writeFile(join(temp, 'improve.json'), JSON.stringify({ date: '2026-10-05', report: `${page}/2026-10-05.md`, changedHistoricalHealthPaths: [] }));
  await writeFile(join(temp, 'pr.json'), JSON.stringify(nightPr({ date: '2026-10-05', report: `${page}/2026-10-05.md`, proposal: { id: 'prs_stale', state: 'outside', text: 'Close or merge the Acme PRs.' },
    results: [{ id: 'gate', state: 'ok', detail: 'npm test passed, 12 tests', bound: 0, better: 'lower', value: 0 }, { id: 'prs_stale', state: 'outside', detail: '2 stale', bound: 0, better: 'lower', value: 2 }] })));
  const o = run('bash', ['-e', '-c', open.script], { cwd: dir, env: { ...env, DAY: '2026-10-05', PLAN_DAY: planDay, BASE: 'main', HEALTH: page ?? '' } });
  const outputs = Object.fromEntries((await readFile(out, 'utf8')).trim().split('\n').filter(Boolean).map(l => l.split('=')));
  const branch = run('git', ['--git-dir', origin, 'show', 'refs/heads/keel-night-plan:.plates/night/plan.json']);
  const pushed = run('git', ['--git-dir', origin, 'show', '--name-only', '--format=', 'refs/heads/keel-night/2026-10-05']);
  const body = await readFile(join(base, 'body.md'), 'utf8').catch(() => null);
  const calls = (await readFile(join(base, 'gh.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const generatedBody = await readFile(join(temp, 'body.md'), 'utf8').catch(() => null);
  const show = run('git', ['--git-dir', origin, 'show', '--name-status', '--format=', 'refs/heads/keel-night/2026-10-05']);
  return { page, where: 0, status: o.status, out: o.stdout + o.stderr, body, calls, generatedBody, outputs, planBranch: branch.status === 0 ? branch.stdout : null, files: pushed.status === 0 ? pushed.stdout.trim().split('\n').filter(Boolean).sort() : null,
    changes: show.status === 0 ? show.stdout.trim().split('\n').filter(Boolean).sort() : null };
}

test('the night refreshes an existing PR body by exact number, or creates a new PR', async t => {
  const night = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-night.yml'), 'utf8');
  for (const existingPr of ['42', '']) {
    const r = await nightCommit(t, night, { existingPr });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.calls.map(args => args.slice(0, 2)), [['pr', 'list'], ['pr', existingPr ? 'edit' : 'create']]);
    assert.deepEqual(r.calls[0], ['pr', 'list', '--state', 'open', '--head', 'keel-night/2026-10-05', '--json', 'number', '--jq', '.[0].number']);
    const publish = r.calls[1], bodyAt = publish.indexOf('--body-file');
    assert.ok(bodyAt >= 0, 'publish receives a body file');
    assert.equal(r.body, r.generatedBody, 'publish receives the complete freshly generated body');
    assert.match(r.body, /^Gate: ok: npm test passed, 12 tests/m);
    if (existingPr) {
      assert.deepEqual(publish, ['pr', 'edit', existingPr, '--body-file', publish[bodyAt + 1]], 'edit preserves the human title');
    } else {
      assert.deepEqual(publish, ['pr', 'create', '--base', 'main', '--head', 'keel-night/2026-10-05', '--title', 'plates night: 2026-10-05', '--body-file', publish[bodyAt + 1]]);
      assert.equal(r.page, 'docs/health');
      assert.deepEqual(r.files, ['.plates/bounds.json', 'docs/health/2026-10-05.md'], 'the default health page and bounds, never scratch files');
    }
  }
});

test('the night fails on PR lookup or edit errors without creating a replacement', async t => {
  const night = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-night.yml'), 'utf8');
  for (const [options, code, message, verbs] of [
    [{ listExit: 7 }, 7, /Acme PR lookup failed/, ['list']],
    [{ existingPr: '42', editExit: 9 }, 9, /Acme PR edit failed/, ['list', 'edit']],
  ]) {
    const r = await nightCommit(t, night, options);
    assert.equal(r.status, code, r.out);
    assert.match(r.out, message);
    assert.deepEqual(r.calls.map(args => args[1]), verbs);
  }
});

test('the night commits its page from the configured health dir (read at run time), only data, and goes red on an ignored one', async t => {
  const night = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-night.yml'), 'utf8');
  // ledger's shape: docs/health/ ignored, health in .plates/health.
  const own = await nightCommit(t, night, { health: '.plates/health', ignore: '/docs/health/\n' });
  assert.equal(own.page, '.plates/health');
  assert.equal(own.status, 0, own.out);
  assert.deepEqual(own.files, ['.plates/bounds.json', '.plates/health/2026-10-05.md'], 'the page and the bounds; never what is not data');
  // The body is pr-body.mjs's: the commit's files as the picture, the gate and what is outside, a two-way door over data.
  const at = ['## Summary', '## Evidence', '## Merge danger'].map(h => own.body?.indexOf(`${h}\n`) ?? -1);
  assert.ok(at[0] === 0 && at[0] < at[1] && at[1] < at[2], own.body);
  assert.match(own.body, /```text\n└── \.plates\/\n    ├── health\/\n    │   └── 2026-10-05\.md\n    └── bounds\.json\n```/);
  assert.match(own.body, /^Gate: ok: npm test passed, 12 tests/m);
  assert.match(own.body, /^\| prs_stale \(outside\) \| ≤0 \| 2 \|$/m);
  assert.match(own.body, /^Two-way door: data only/m);
  assert.match(own.body, /^Blast radius: this repo's data files only\.$/m);
  assert.match(own.body, /\*\*Proposal \(`prs_stale`, outside\):\*\* Close or merge the Acme PRs\./);
  assert.ok(own.body.trimEnd().endsWith('```') && own.body.indexOf('```keel-impact') > at[2], 'the keel-impact block is last');
  // No body is built in inline JS: the open step calls pr-body.mjs, and no node -e writes body.md.
  const blocks = runBlocks(night);
  assert.match(blocks.find(b => b.step === "Open the night's pull request").script, /node scripts\/plates\/pr-body\.mjs --input "\$RUNNER_TEMP\/pr\.json" --files [^\n]*> "\$RUNNER_TEMP\/body\.md"/);
  assert.match(blocks.find(b => b.step === 'Measure').script, /improve\.mjs --report --json --pr-input "\$RUNNER_TEMP\/pr\.json"/);
  for (const b of blocks) for (const n of inlineNode(b.script)) assert.doesNotMatch(n.js, /body|Proposal|keel-impact/, `step "${b.step}" builds a PR body in inline JS`);
  // The configured dir ignored: red, naming the fix, and nothing pushed.
  const lost = await nightCommit(t, night, { ignore: '/docs/health/\n' });
  assert.notEqual(lost.status, 0);
  assert.match(lost.out, /docs\/health is git-ignored.*set \\?"health\\?" in \.plates\/plates\.json/);
  assert.equal(lost.files, null);
  // Mutation: the commit step hard-codes docs/health instead of the configured dir.
  const hard = night.replace('const paths = [report.report, ...historical];', 'const paths = [`docs/health/${day}.md`, ...historical];');
  assert.notEqual(hard, night);
  const m = await nightCommit(t, hard, { health: '.plates/health', ignore: '/docs/health/\n' });
  assert.ok(!(m.files ?? []).includes('.plates/health/2026-10-05.md'), `a hard-coded docs/health loses the page: ${JSON.stringify(m.files)}`);
  // Mutation: the dir is not read from the config.
  const fixed = night.replace('const dir = healthDirIn(".", JSON.parse(readFileSync(".plates/plates.json", "utf8")));', 'const dir = "docs/health";');
  assert.notEqual(fixed, night);
  const f = await nightCommit(t, fixed, { health: '.plates/health', ignore: '/docs/health/\n' });
  assert.ok(!(f.files ?? []).includes('.plates/health/2026-10-05.md'), `a fixed dir loses the page: ${JSON.stringify(f.files)}`);
});

// ledger #76–#80: what the night stages from the health directory, and what it refuses.
test('the night stages only tonight\'s page and its own data (deletions kept), probes a dated page for ignores, and refuses a symlinked or magic health dir', async t => {
  const night = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-night.yml'), 'utf8');
  // #76: a shared health dir ("scripts"): the night's page, never the project's other changes under it.
  const shared = await nightCommit(t, night, { health: 'scripts', tracked: { 'scripts/deploy.mjs': 'v1\n' }, after: dir => writeFile(join(dir, 'scripts/deploy.mjs'), 'v2, half-done\n') });
  assert.equal(shared.status, 0, shared.out);
  assert.deepEqual(shared.files, ['.plates/bounds.json', 'scripts/2026-10-05.md'], 'only the dated page and the bounds');
  // #76 too: a stray file in the default dir is not the night's.
  const stray = await nightCommit(t, night, { after: dir => writeFile(join(dir, 'docs/health/notes.md'), 'a person\'s notes\n') });
  assert.deepEqual(stray.files, ['.plates/bounds.json', 'docs/health/2026-10-05.md']);
  // #78: a tracked data path that is gone is staged as its deletion.
  const gone = await nightCommit(t, night, { tracked: { 'docs/INBOX.md': '# Inbox\n', 'docs/inbox/1.md': 'x\n' }, after: async dir => { await rm(join(dir, 'docs/INBOX.md')); await rm(join(dir, 'docs/inbox'), { recursive: true }); } });
  assert.equal(gone.status, 0, gone.out);
  assert.deepEqual(gone.changes, ['A\t.plates/bounds.json', 'A\tdocs/health/2026-10-05.md', 'D\tdocs/INBOX.md', 'D\tdocs/inbox/1.md']);
  // #77: an ignore rule for dated pages (not the directory) is caught: red, nothing pushed.
  const dated = await nightCommit(t, night, { ignore: 'docs/health/20*.md\n' });
  assert.notEqual(dated.status, 0);
  assert.match(dated.out, /docs\/health is git-ignored \(docs\/health\/2026-10-05\.md\)/);
  assert.equal(dated.files, null);
  // #79: a health dir that is a symlink out of the repo is refused before anything is written.
  const out = await nightCommit(t, night, { health: '.plates/health', before: async (dir, base) => { await mkdir(join(base, 'elsewhere'), { recursive: true }); await symlink(join(base, 'elsewhere'), join(dir, '.plates/health')); } });
  assert.notEqual(out.where, 0, 'the health step refuses it');
  assert.match(out.out, /resolves outside the repo/);
  // A symlink inside the repo is still the repo's.
  const inside = await nightCommit(t, night, { health: '.plates/health', before: async dir => { await mkdir(join(dir, 'acme-pages'), { recursive: true }); await symlink('../acme-pages', join(dir, '.plates/health')); } });
  assert.equal(inside.where, 0, inside.out);
  assert.notEqual(inside.status, 0, 'local reporting can use an inside alias, but Git cannot stage beyond it');
  assert.match(inside.out, /health alias cannot be staged/);
  assert.equal(inside.files, null);
  // #80: pathspec magic in "health" is refused.
  for (const health of [':(top)docs/health', ':!docs']) {
    const magic = await nightCommit(t, night, { health });
    assert.notEqual(magic.where, 0, health);
    assert.match(magic.out, /pathspec magic/, health);
  }
  // Mutations: each of the old shapes fails one of the checks above.
  const wholeMutation = night.replace('PATHS=("${HEALTH_PATHS[@]}")', 'PATHS=("$HEALTH")');
  assert.notEqual(wholeMutation, night);
  const whole = await nightCommit(t, wholeMutation, { health: 'scripts', tracked: { 'scripts/deploy.mjs': 'v1\n' }, after: dir => writeFile(join(dir, 'scripts/deploy.mjs'), 'v2, half-done\n') });
  assert.ok(whole.files.includes('scripts/deploy.mjs'), `staging the whole dir carries the project's file: ${JSON.stringify(whole.files)}`);
  const exists = await nightCommit(t, night.replace('if [ -e "$p" ] || [ -n "$(git ls-files -- "$p")" ]; then', 'if [ -e "$p" ]; then'), { tracked: { 'docs/INBOX.md': '# Inbox\n' }, after: dir => rm(join(dir, 'docs/INBOX.md')) });
  assert.ok(!exists.changes.includes('D\tdocs/INBOX.md'), `-e alone drops the deletion: ${JSON.stringify(exists.changes)}`);
  const probeMutation = night.replace('git check-ignore -q -- "$p"', 'git check-ignore -q -- "$HEALTH/x.md"');
  assert.notEqual(probeMutation, night);
  const probe = await nightCommit(t, probeMutation, { ignore: 'docs/health/20*.md\n' });
  assert.doesNotMatch(probe.out, /is git-ignored \(/, 'an x.md probe misses a rule for dated pages');
  const lexical = await nightCommit(t, night.replace('import { healthDirIn } from', 'import { healthDirOf as healthDirIn } from'), { health: '.plates/health', before: async (dir, base) => { await mkdir(join(base, 'elsewhere'), { recursive: true }); await symlink(join(base, 'elsewhere'), join(dir, '.plates/health')); } });
  assert.equal(lexical.where, 0, 'a lexical check alone lets the symlink through');
});

/**
 * Run the night's "Plan the night" step, as the workflow has it, in a
 * synthetic Acme repo whose origin is a bare repo that may hold the plan
 * branch keel-night-plan; `date` is a stub, so tonight is 2026-10-15 (UTC).
 * Returns { status, out, outputs, plan }.
 */
async function nightPlanStep(t, night, { branchPlan = null, origin: brokenOrigin = false, emptyBranch = false, failFetch = false } = {}) {
  const step = runBlocks(night).find(b => b.step === 'Plan the night');
  assert.ok(step, 'the night has a Plan the night step');
  const base = await mkdtemp(join(tmpdir(), 'plates-wf-plan-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'acme'), origin = join(base, 'origin.git'), bin = join(base, 'bin'), temp = join(base, 'tmp');
  const git = (args, cwd = dir) => { const r = run('git', args, { cwd }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout; };
  for (const d of [dir, bin, temp, join(dir, '.plates')]) await mkdir(d, { recursive: true });
  git(['init', '-q', '--bare', origin], base);
  git(['init', '-q', '-b', 'main']);
  await cp(join(PLATES, 'practices/night/files/scripts/plates'), join(dir, 'scripts/plates'), { recursive: true });
  await writeFile(join(dir, '.plates/plates.json'), `${JSON.stringify({ name: 'Acme' })}\n`);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'acme']);
  git(['push', '-q', origin, 'HEAD:refs/heads/main']);
  if (branchPlan) {
    // The plan branch, as /goodnight would push it: one file, on its own history.
    git(['checkout', '-q', '--orphan', 'keel-night-plan']);
    git(['rm', '-rq', '--cached', '.']);
    await mkdir(join(dir, '.plates/night'), { recursive: true });
    await writeFile(join(dir, '.plates/night/plan.json'), JSON.stringify(branchPlan));
    git(['add', '-f', '.plates/night/plan.json']);
    git(['commit', '-q', '-m', 'acme plan']);
    git(['push', '-q', origin, 'HEAD:refs/heads/keel-night-plan']);
    git(['checkout', '-q', '-f', 'main']);
    await rm(join(dir, '.plates/night'), { recursive: true, force: true });
  }
  // The branch, holding no plan file.
  if (emptyBranch) git(['push', '-q', origin, 'HEAD:refs/heads/keel-night-plan']);
  git(['remote', 'add', 'origin', brokenOrigin ? join(base, 'no-such-origin.git') : origin]);
  // A git whose fetch fails (the network drops between ls-remote and fetch); every other command is the real git.
  if (failFetch) {
    const real = run('sh', ['-c', 'command -v git']).stdout.trim();
    await writeFile(join(bin, 'git'), `#!/bin/sh\n[ "$1" = fetch ] && { echo "fatal: Acme network down" >&2; exit 128; }\nexec ${JSON.stringify(real)} "$@"\n`, { mode: 0o755 });
  }
  await writeFile(join(bin, 'date'), '#!/bin/sh\n[ "$1" = "-u" ] && [ "$2" = "+%F" ] && { echo 2026-10-15; exit 0; }\nexit 9\n', { mode: 0o755 });
  await writeFile(join(bin, 'gh'), '#!/bin/sh\necho "[]"\n', { mode: 0o755 });
  const out = join(temp, 'out');
  await writeFile(out, '');
  const r = run('bash', ['-e', '-c', step.script], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out, RUNNER_TEMP: temp, PATH: `${bin}:${process.env.PATH}` } });
  const outputs = Object.fromEntries((await readFile(out, 'utf8')).trim().split('\n').filter(Boolean).map(l => l.split('=')));
  const plan = await readFile(join(dir, '.plates/night/plan.json'), 'utf8').then(JSON.parse, () => null);
  return { status: r.status, out: r.stdout + r.stderr, outputs, plan };
}

test('the night plans before anything runs: tonight\'s plan from keel-night-plan, else the default plan, saying which; a plan it cannot make is red at the verdict', async t => {
  const night = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-night.yml'), 'utf8');
  const steps = runBlocks(night).map(b => b.step);
  const at = name => steps.indexOf(name);
  assert.ok(at('Plan the night') > at('Install') && at('Plan the night') < at('Gather what came home') && at('Plan the night') < at('Measure'), `the plan is written before any pass runs: ${steps.join(', ')}`);
  const owner = { schema: 1, date: '2026-10-15', shapedBy: 'owner', readyBy: null, willNotTouch: ['lib/anvil.mjs'], settledToday: [], leftOpen: [],
    items: [{ id: 'measure', title: 'Measure Acme', kind: 'measure', source: 'owner', number: null, lane: 'night', budget: null, status: 'planned', result: null }] };
  // The branch holds tonight's plan: it is used, and the step says so.
  const used = await nightPlanStep(t, night, { branchPlan: owner });
  assert.equal(used.status, 0, used.out);
  assert.deepEqual(used.outputs, { code: '0', day: '2026-10-15' });
  assert.match(used.out, /Tonight's plan \(2026-10-15\) is the one on keel-night-plan, shaped by owner\./);
  assert.deepEqual(used.plan, owner);
  // No branch: the default plan.
  const none = await nightPlanStep(t, night);
  assert.equal(none.status, 0, none.out);
  assert.match(none.out, /Tonight's plan \(2026-10-15\) is plates's default plan: no plan on keel-night-plan\./);
  assert.deepEqual([none.plan.shapedBy, none.plan.date, none.plan.items[0].id], ['default', '2026-10-15', 'measures']);
  // Dated for another night: the default plan, saying why.
  const old = await nightPlanStep(t, night, { branchPlan: { ...owner, date: '2026-10-14' } });
  assert.match(old.out, /plates's default plan: the plan on keel-night-plan is dated 2026-10-14, not 2026-10-15\./);
  assert.equal(old.plan.shapedBy, 'default');
  // The branch is there and holds no plan file: the default plan, and not red.
  const empty = await nightPlanStep(t, night, { emptyBranch: true });
  assert.equal(empty.outputs.code, '0', empty.out);
  assert.match(empty.out, /plan: keel-night-plan holds no \.plates\/night\/plan\.json/);
  assert.equal(empty.plan.shapedBy, 'default');
  // plates#142: the branch is there but the fetch fails: a plan the night could not read (red), never "no plan file".
  const unfetched = await nightPlanStep(t, night, { branchPlan: owner, failFetch: true });
  assert.equal(unfetched.status, 0, 'the step goes on: the measure still runs');
  assert.equal(unfetched.outputs.code, '2', unfetched.out);
  assert.match(unfetched.out, /::error::git fetch could not read the plan branch keel-night-plan \(exit 128\)/);
  assert.match(unfetched.out, /plates's default plan: the plan branch keel-night-plan could not be read \(git fetch exit 128\)/);
  assert.doesNotMatch(unfetched.out, /holds no \.plates\/night\/plan\.json/);
  assert.equal(unfetched.plan.shapedBy, 'default');
  // The branch cannot be read: red at the verdict, and the night still has its default plan.
  const broken = await nightPlanStep(t, night, { origin: true });
  assert.equal(broken.status, 0, 'the step goes on: the measure still runs');
  assert.equal(broken.outputs.code, '2');
  assert.match(broken.out, /::error::git ls-remote could not read the plan branch keel-night-plan/);
  assert.equal(broken.plan.shapedBy, 'default');
  // Mutation: a step that never reads the branch runs the default plan when the owner shaped one.
  const blind = await nightPlanStep(t, night.replace('ARGS=(--branch-plan "$RUNNER_TEMP/branch-plan.json")', 'ARGS=()'), { branchPlan: owner });
  assert.equal(blind.plan.shapedBy, 'default', 'the guard above would catch a blind step');
  // The verdict: a plan the night could not make is red; a made one is not.
  const verdict = runBlocks(night).find(b => b.step === 'Verdict').script;
  const v = env => run('bash', ['-e', '-c', verdict], { env: { ...process.env, CANVAS_OUTCOME: 'success', CODE: '0', GATE: 'ok', ...env } });
  assert.equal(v({ PLAN: '0' }).status, 0);
  const red = v({ PLAN: '2' });
  assert.equal(red.status, 1);
  assert.match(red.stdout, /Tonight's plan could not be made or read/);
  assert.equal(v({ PLAN: '' }).status, 1, 'no plan step at all is red too');
});

test('the night\'s PR carries the plan as it ended, docs/night/<date>.json, and nothing else there; a symlinked record is refused', async t => {
  const night = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-night.yml'), 'utf8');
  const record = async dir => { await mkdir(join(dir, 'docs/night'), { recursive: true }); await writeFile(join(dir, 'docs/night/2026-10-05.json'), '{"schema":1}\n'); await writeFile(join(dir, 'docs/night/notes.md'), 'a person\'s notes\n'); };
  const r = await nightCommit(t, night, { after: record });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.files, ['.plates/bounds.json', 'docs/health/2026-10-05.md', 'docs/night/2026-10-05.json'], 'the record, never the directory\'s other files');
  // No plan record (a project before phase 73's night): the PR is as it was.
  assert.deepEqual((await nightCommit(t, night, {})).files, ['.plates/bounds.json', 'docs/health/2026-10-05.md']);
  // A record that is a symlink out of the repo: red, nothing pushed.
  const linked = await nightCommit(t, night, { after: async dir => { await mkdir(join(dir, 'docs/night'), { recursive: true }); await symlink('/etc/hosts', join(dir, 'docs/night/2026-10-05.json')); } });
  assert.notEqual(linked.status, 0);
  assert.match(linked.out, /docs\/night\/2026-10-05\.json is not a regular file inside the repo/);
  assert.equal(linked.files, null);
  // Ignored: red, naming the fix.
  const ignored = await nightCommit(t, night, { ignore: 'docs/night/\n', after: record });
  assert.notEqual(ignored.status, 0);
  assert.match(ignored.out, /docs\/night\/2026-10-05\.json is git-ignored.*stop ignoring docs\/night\//);
  // Mutation: a step that stages the whole directory carries the person's notes.
  const whole = await nightCommit(t, night.replace('HEALTH_PATHS+=("$RECORD")', 'HEALTH_PATHS+=(docs/night)'), { after: record });
  assert.ok(whole.files.includes('docs/night/notes.md'), `staging docs/night/ carries what is not the night's: ${JSON.stringify(whole.files)}`);
});

// Phase 78: a default night records its plan on the plan branch, from the PR step alone.
test('a default night writes its plan to keel-night-plan from its PR step, the one step that writes; the plan step only reads; a failed write is red at the verdict', async t => {
  const night = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-night.yml'), 'utf8');
  const blocks = runBlocks(night);
  const publishing = blocks.filter(b => /node scripts\/plates\/night-plan\.mjs publish\b/.test(b.script)).map(b => b.step);
  assert.deepEqual(publishing, ["Open the night's pull request"], 'only the PR step writes the plan branch');
  assert.doesNotMatch(blocks.find(b => b.step === 'Plan the night').script, /\bgit push\b|publish/, 'the plan step only reads');
  assert.match(night, /\n {8}id: pr\n {8}env:\n(?: {10}.*\n)*? {10}PLAN_DAY: \$\{\{ steps\.plan\.outputs\.day \}\}\n/, 'the date is the plan step\'s, never another night\'s');
  const { writePlan, defaultPlan } = await import('../lib/night-plan.mjs');
  const plan = defaultPlan({ date: '2026-10-05' });
  const withPlan = async dir => { await cp(join(PLATES, 'practices/night/files/scripts/plates'), join(dir, 'scripts/plates'), { recursive: true }); await writePlan(dir, plan); };
  const r = await nightCommit(t, night, { before: withPlan, planDay: '2026-10-05' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /tonight's default plan is on keel-night-plan \(the branch keel-night-plan is new\)/);
  assert.equal(r.outputs.publish, '0');
  assert.deepEqual(JSON.parse(r.planBranch), plan, 'the plan branch holds tonight\'s default plan');
  assert.deepEqual(r.files, ['.plates/bounds.json', 'docs/health/2026-10-05.md'], 'the PR is as it was');
  // Mutation: a step that never publishes leaves the branch empty, and no pass has a plan to tick.
  const silent = await nightCommit(t, night.replace('node scripts/plates/night-plan.mjs publish --date "$PLAN_DAY" || published=$?', 'true'), { before: withPlan, planDay: '2026-10-05' });
  assert.equal(silent.planBranch, null);
  // The verdict: a failed write is red, naming it; none (an older night) is not.
  const verdict = blocks.find(b => b.step === 'Verdict').script;
  const v = env => run('bash', ['-e', '-c', verdict], { env: { ...process.env, CANVAS_OUTCOME: 'success', CODE: '0', GATE: 'ok', PLAN: '0', ...env } });
  assert.equal(v({ PUBLISH: '0' }).status, 0);
  assert.equal(v({ PUBLISH: '' }).status, 0);
  const red = v({ PUBLISH: '2' });
  assert.equal(red.status, 1);
  assert.match(red.stdout, /Tonight's default plan could not be written to keel-night-plan/);
});

test('the PR description is re-checked on edit by plates-impact.yml alone; check.yml never runs it', async () => {
  const all = await shipped();
  const impact = all.find(w => w.name === 'plates-impact.yml').template;
  const check = all.find(w => w.name === 'check.yml').template;
  const on = /^on:\n([\s\S]*?)\n\S/m.exec(impact)?.[1] ?? '';
  for (const t of ['opened', 'synchronize', 'reopened', 'edited']) assert.match(on, new RegExp(`\\b${t}\\b`), `plates-impact.yml runs on ${t}`);
  assert.doesNotMatch(on, /push|pull_request_target/, 'plates-impact.yml: pull_request only');
  assert.match(impact, /reconcile\.mjs --event "\$GITHUB_EVENT_PATH"/);
  assert.doesNotMatch(impact, /\{\{check\}\}|npm (ci|test|run)/, 'an edit never re-runs the gate');
  // An edited-triggered gate would skip, and a skipped required check reads as passed.
  assert.doesNotMatch(check, /--event/, 'check.yml leaves the description to plates-impact.yml');
  assert.doesNotMatch(check, /\bedited\b/, 'check.yml does not run on description edits');
});

/**
 * The test ledger's history between runs (phase 33): check.yml keeps each
 * run's .plates/test-runs as a plates-test-runs artifact, red or green; the night
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
    if (!/\n\s+name: plates-test-runs\n/.test(keep.body)) out.push(`${name}: the artifact is not named plates-test-runs (the night reads it by name)`);
    if (!(name === 'plates-night.yml' ? JSON.stringify(/\n          path: \|\n((?:            [^\n]+\n)+)/.exec(keep.body)?.[1].trim().split('\n').map(x=>x.trim())) === JSON.stringify(['.plates/test-runs/*.json','.plates/test-runs/retention','.plates/test-runs/recovery/status.json']) : /\n\s+path: \.plates\/test-runs\/\n/.test(keep.body))) out.push(`${name}: the artifact is not .plates/test-runs/`);
    if (!/include-hidden-files: true/.test(keep.body)) out.push(`${name}: .plates is hidden; upload-artifact skips it unless told`);
    if (!/if-no-files-found: ignore/.test(keep.body)) out.push(`${name}: a project without the reporter must not go red over a missing ledger`);
  }
  if (name === 'plates-night.yml') {
    const gather = step('Gather the test ledger'), measure = text.indexOf('node scripts/plates/improve.mjs --report');
    if (!gather) out.push('plates-night.yml: no "Gather the test ledger" step');
    else {
      if (gather.at > measure) out.push('plates-night.yml: the ledger is gathered after improve measured');
      if (!gather.body.includes('node scripts/plates/test-history.mjs --repo "$REPO" --branch "$BASE" --json')) out.push('plates-night.yml: bounded recovery does not bind the repository and default branch');
      if (/gh api[^\n]*(-X|--method|-f |-F |--field|--input)/.test(gather.body)) out.push('plates-night.yml: the ledger read writes to GitHub');
      if (/unzip\b/.test(gather.body)) out.push('plates-night.yml: extraction bypasses bounded recovery');
    }
    if (keep && keep.at < measure) out.push('plates-night.yml: the ledger is kept before the gate ran');
  }
  return out;
}

test('check.yml keeps each run\'s test ledger as an artifact, red or green; the night reads the newest by name, read-only, before improve, and keeps its own', async () => {
  const all = await shipped();
  for (const name of ['check.yml', 'plates-night.yml']) {
    const w = all.find(x => x.name === name);
    assert.deepEqual(ledgerProblems(name, w.template), [], `${name} template`);
    assert.deepEqual(ledgerProblems(name, await readFile(join(PLATES, w.path), 'utf8')), [], `plates's ${name}`);
  }
  const check = all.find(w => w.name === 'check.yml').template;
  const night = all.find(w => w.name === 'plates-night.yml').template;
  const fails = (name, text, pattern, why) => assert.ok(ledgerProblems(name, text).some(p => pattern.test(p)), `${why}: ${JSON.stringify(ledgerProblems(name, text))}`);
  fails('check.yml', check.replace(/(- name: Keep the test ledger\n)\s+if: always\(\)\n/, '$1'), /only when the run passed/, 'kept only on green');
  fails('check.yml', check.replace('include-hidden-files: true', 'include-hidden-files: false'), /hidden/, 'hidden files skipped');
  fails('check.yml', check.replace('if-no-files-found: ignore', 'if-no-files-found: error'), /must not go red/, 'red without a reporter');
  fails('plates-night.yml', night.replace('--branch "$BASE"', ''), /default branch/, 'unbound artifact branch');
  fails('plates-night.yml', night.replace('node scripts/plates/test-history.mjs', 'gh api -X DELETE repos/$REPO/actions/artifacts; node scripts/plates/test-history.mjs'), /writes to GitHub/, 'a write in the read');
  fails('plates-night.yml', night.replace('.plates/test-runs/recovery/status.json', '.plates/missing.json'), /artifact is not/, 'recovery coverage omitted from the artifact');
  fails('plates-night.yml', night.replace('.plates/test-runs/recovery/status.json', '.plates/test-runs/recovery/status.json\n            .claude/'), /artifact is not/, 'extra private upload path');
  fails('plates-night.yml', night.replace('node scripts/plates/test-history.mjs', 'unzip archive.zip; node scripts/plates/test-history.mjs'), /bypasses bounded/, 'unbounded extraction');
  const late = night.replace(/(\n      - name: Gather the test ledger\n[\s\S]*?)(\n      # Before the drain)/, '$2').replace('\n      # Porcelain, never', `${/\n      - name: Gather the test ledger\n[\s\S]*?(?=\n      # Before the drain)/.exec(night)[0]}\n      # Porcelain, never`);
  fails('plates-night.yml', late, /gathered after improve/, 'gathered after the measure');
});

/**
 * One gate result per commit (phase 79): check.yml's gate step is gate.mjs --ci, before the ledger is kept in
 * the same job (so the record the others reuse is in the artifact), with Actions read-only for its docs-only
 * lookup; the loop's gate step goes through gate.mjs too. [string] problems.
 */
export function gateReuseProblems(name, text) {
  const out = [];
  if (name === 'check.yml') {
    const gate = text.indexOf('      - name: Run the configured gate\n'), keep = text.indexOf('      - name: Keep the test ledger\n');
    if (gate < 0 || !/node scripts\/plates\/gate\.mjs --ci\n/.test(text.slice(gate, keep))) out.push('check.yml: the gate step does not run scripts/plates/gate.mjs --ci');
    if (keep < gate) out.push('check.yml: the ledger is kept before the gate ran');
    if (!/\n {6}actions: read\n/.test(text)) out.push('check.yml: the docs-only lookup cannot read Actions');
    if (/\n {6}actions: write\n/.test(text)) out.push('check.yml: Actions is writable');
  }
  if (name === 'plates-loop.yml' && !/- name: Gate\n[\s\S]*?node scripts\/plates\/gate\.mjs;[\s\S]*?render --check && check;/.test(text)) out.push('plates-loop.yml: the gate step does not go through scripts/plates/gate.mjs');
  return out;
}

test('check.yml\'s gate is gate.mjs --ci, kept as the artifact after it, read-only; the loop\'s gate goes through gate.mjs (phase 79)', async () => {
  const all = await shipped();
  for (const name of ['check.yml', 'plates-loop.yml']) {
    const w = all.find(x => x.name === name);
    assert.deepEqual(gateReuseProblems(name, w.template), [], name);
  }
  assert.deepEqual(gateReuseProblems('check.yml', await readFile(join(PLATES, '.github/workflows/check.yml'), 'utf8')), [], "plates's own check.yml");
  const check = all.find(w => w.name === 'check.yml').template, loop = all.find(w => w.name === 'plates-loop.yml').template;
  const fails = (name, text, pattern) => assert.ok(gateReuseProblems(name, text).some(p => pattern.test(p)), JSON.stringify(gateReuseProblems(name, text)));
  fails('check.yml', check.replace('node scripts/plates/gate.mjs --ci', 'node scripts/plates/test-ledger.mjs --gate'), /gate\.mjs --ci/);
  fails('check.yml', check.replace('      actions: read\n', ''), /cannot read Actions/);
  fails('check.yml', check.replace('      actions: read\n', '      actions: write\n'), /writable|cannot read/);
  fails('plates-loop.yml', loop.replace('node scripts/plates/gate.mjs;', '{{check}};'), /gate\.mjs/);
});

/**
 * A climb night's own rules (phase 35), on plates-climb.yml's text: [string].
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
    if (!list.includes('Bash(node scripts/plates/climb.mjs *)')) out.push('the agent cannot run climb.mjs, so its numbers would be its own');
  }
  const climbAt = text.indexOf('      - name: Climb\n');
  const climbNext = text.indexOf('\n      - ', climbAt + 1);
  const climbStep = climbAt < 0 ? '' : text.slice(climbAt, climbNext < 0 ? undefined : climbNext + 1);
  if (!/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.pick\.outputs\.minutes\) \}\}\n/.test(climbStep) || !/\n\s+uses: anthropics\/claude-code-action@v\d+\n/.test(climbStep)) out.push('the agent\'s step is not time-boxed by the budget (steps.pick.outputs.minutes)');
  const at = s => text.indexOf(s);
  const push = at('git push');
  for (const verb of ['settle', 'guard', 'report']) {
    const i = at(`node scripts/plates/climb.mjs ${verb}`);
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

test('plates-climb.yml: the agent cannot push or merge, is time-boxed by the budget, and the script judges the night before one PR', async () => {
  const w = (await shipped()).find(x => x.name === 'plates-climb.yml');
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
    ['climb.mjs not allowed', t.replace('Bash(node scripts/plates/climb.mjs *),', '')],
    ['no time box', t.replace(/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.pick\.outputs\.minutes\) \}\}/, '')],
    ['no guard', t.replace('          node scripts/plates/climb.mjs guard --base "$GITHUB_SHA"\n', '')],
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
    if (!/node "\$RUNNER_TEMP\/plates\/scripts\/plates\/climb\.mjs" agent-ran --agent codex --outcome "\$OUTCOME" --file "\$RUNNER_TEMP\/codex-final-message\.md" --minutes "\$MINUTES" --started "\$STARTED"/.test(body)) out.push('"Did the agent run?" does not judge Codex by its final message (agent-ran --agent codex)');
    if (steps.indexOf(codexStep) > check) out.push('"Did the agent run?" runs before Codex\'s step');
  }
  if (!new RegExp(`EXECUTION: \\$\\{\\{ steps\\.${id}\\.outputs\\.execution_file \\}\\}`).test(body)) out.push('"Did the agent run?" does not read the action\'s execution file');
  if (!/node "\$RUNNER_TEMP\/plates\/scripts\/plates\/climb\.mjs" agent-ran --outcome "\$OUTCOME" --file "[^"]+" --minutes "\$MINUTES" --started "\$STARTED"/.test(body)) out.push('"Did the agent run?" does not run climb.mjs agent-ran (the copy kept before the agent ran) with the outcome, the file, the budget and the start');
  // PR #59: the steps after the agent run plates's scripts as the run's commit has them, copied out of the
  // workspace before the agent ran, never a file it edited and did not commit.
  const keep = steps.findIndex(s => s.includes('mkdir -p "$RUNNER_TEMP/plates" && git archive "$GITHUB_SHA" scripts/plates .plates/plates.json | tar -x -C "$RUNNER_TEMP/plates"'));
  if (keep < 0 || keep > agent) out.push('plates\'s scripts are not kept (git archive "$GITHUB_SHA" … into $RUNNER_TEMP/plates) before the agent runs');  if (/\|\| true|; *exit 0/.test(body)) out.push('"Did the agent run?" swallows its exit');
  for (const later of ['guard', 'git push']) {
    const i = steps.findIndex(s => s.includes(later === 'guard' ? 'node scripts/plates/climb.mjs guard' : 'git push'));
    if (i >= 0 && i < check) out.push(`${later} runs before "Did the agent run?"`);
  }
  return out;
}

test('lesson 29: plates-climb.yml and plates-tend.yml end red when the agent failed before its budget ran out, before anything is judged or pushed', async () => {
  const all = await shipped();
  for (const [name, opts] of [['plates-climb.yml', { step: 'Climb', id: 'climb' }], ['plates-tend.yml', { step: 'Tend', id: 'tend' }]]) {
    const t = all.find(w => w.name === name).template;
    assert.deepEqual(agentRanProblems(t, opts), [], name);
    assert.deepEqual(agentRanProblems(await readFile(join(PLATES, '.github/workflows', name), 'utf8'), opts), [], `plates's ${name}`);
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
    // PR #59: the check runs plates's scripts as the run's commit has them, kept outside the workspace before
    // the agent ran (git archive into $RUNNER_TEMP/plates), never the workspace's, which the agent can edit.
    const keepLine = /\n +mkdir -p "\$RUNNER_TEMP\/plates" && git archive "\$GITHUB_SHA" scripts\/plates \.plates\/plates\.json \| tar -x -C "\$RUNNER_TEMP\/plates"\n/.exec(t)?.[0] ?? assert.fail(`${name}: no kept copy in the Brief`);
    for (const [why, text, said] of [
      ['agent-ran from the workspace', t.replace('node "$RUNNER_TEMP/plates/scripts/plates/climb.mjs" agent-ran --outcome', 'node scripts/plates/climb.mjs agent-ran --outcome'), /does not run climb\.mjs agent-ran \(the copy kept before the agent ran\)/],
      ['Codex\'s agent-ran from the workspace', t.replace('node "$RUNNER_TEMP/plates/scripts/plates/climb.mjs" agent-ran --agent codex', 'node scripts/plates/climb.mjs agent-ran --agent codex'), /does not judge Codex by its final message/],
      ['no kept copy', t.replace(keepLine, '\n'), /plates's scripts are not kept \(git archive "\$GITHUB_SHA" … into \$RUNNER_TEMP\/plates\) before the agent runs/],
      ['the copy kept after the agent', t.replace(keepLine, '\n').replace(check, check.replace('        run: |\n', `        run: |${keepLine}`)), /plates's scripts are not kept .* before the agent runs/],
    ]) {
      assert.notEqual(text, t, `${name} ${why}: the mutation did not apply`);
      const problems = agentRanProblems(text, opts);
      assert.ok(problems.some(p => said.test(p)), `${name} ${why}: ${JSON.stringify(problems)}`);
    }
  }
});

/**
 * The agent holds no credential that can write (ledger#92), on plates-climb.yml
 * or plates-tend.yml: [string]. The job with claude-code-action declares its
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
      // Unconditional: a sandbox run only under an `if` (phase 76's plan check) does not count.
      const sandbox = lines.findIndex(l => /^\s*node scripts\/plates\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head"/.test(l));
      if (sandbox < 0 || sandbox > push) out.push(`job ${j.id} pushes without climb.mjs sandbox first`);
    }
  }
  const judge = jobs.find(j => !isAgent(j) && /node scripts\/plates\/climb\.mjs guard/.test(j.text));
  if (!judge) out.push('no job without the agent runs the guard');
  else {
    const at = s => judge.text.indexOf(s);
    if (/:\s*write/.test(/\n {4}permissions:\n((?: {6}.*\n)+)/.exec(judge.text)?.[1] ?? 'none: write')) out.push('the judge may write: it runs the agent\'s code (the gate)');
    // Unconditional, as for the push: a sandbox run only under an `if` (phase 76's plan check) does not count.
    const sandboxAt = judge.text.search(/\n {10}node scripts\/plates\/climb\.mjs sandbox /);
    if (sandboxAt < 0 || at('git switch -q -c "$BRANCH" "$head"') < 0 || sandboxAt > at('git switch -q -c "$BRANCH" "$head"')) out.push('the judge takes the agent\'s commits before climb.mjs sandbox has checked them');
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
      const verb = /node scripts\/plates\/climb\.mjs (settle|guard|compare --final|report|tend-report)\b/.exec(line)?.[1];
      if (verb && !/ --base "\$GITHUB_SHA"(?: |$)/.test(line)) out.push(`the judge's climb.mjs ${verb} trusts the record's base: pass --base "$GITHUB_SHA"`);
    }
  }
  return out;
}

test('ledger#92: the climb and tend agents hold no credential that can write; a job with no agent judges and pushes', async () => {
  const all = await shipped();
  for (const name of ['plates-climb.yml', 'plates-tend.yml']) {
    const t = all.find(w => w.name === name).template;
    assert.deepEqual(agentSandboxProblems(t), [], name);
    assert.deepEqual(agentSandboxProblems(await readFile(join(PLATES, '.github/workflows', name), 'utf8')), [], `plates's ${name}`);
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
      ['no sandbox before the push', t.replace(/(\n {6}- name: Open the [\s\S]*?)\n {10}node scripts\/plates\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head"[^\n]*\n/, '$1\n')],
      ['the judge may write', t.replace('  judge:\n', '  judge:\n').replace(/(\n  judge:\n[\s\S]*?\n {4}permissions:\n {6}contents: )read/, '$1write')],
      ['the judge takes the commits unchecked', t.replace(/(\n  judge:\n[\s\S]*?)\n {10}node scripts\/plates\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head"\n/, '$1\n')],
      // The install moved back after the take, as it was before ledger#92's review: a preinstall runs with the token.
      ['the judge installs on the agent\'s commits', t.replace(/(\n  judge:\n[\s\S]*?)(\n {6}- name: Install\n[\s\S]*?\n {10}fi\n)([\s\S]*?\n {6}- name: Take the [^\n]*\n[\s\S]*?\n {10}done\n)/, '$1$3$2')],
      ['the judge\'s guard trusts the record\'s base', t.replace(/(node scripts\/plates\/climb\.mjs guard(?: --job tend)?) --base "\$GITHUB_SHA"/, '$1')],
      ['the judge\'s report trusts the record\'s base', t.replace(/(node scripts\/plates\/climb\.mjs (?:tend-)?report [^\n]*?) --base "\$GITHUB_SHA"/, '$1')],
    ]) {
      assert.notEqual(text, t, `${name} ${why}: the mutation did not apply`);
      assert.ok(agentSandboxProblems(text).length, `${name} ${why}: expected a problem`);
    }
  }
});

/**
 * The tend pass's own rules (phase 38), on plates-tend.yml's text: [string].
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
    if (!list.includes('Bash(node scripts/plates/climb.mjs *)')) out.push('the agent cannot run climb.mjs (tend-note, the guard)');
  }
  const tendAt = text.indexOf('      - name: Tend\n');
  const tendNext = text.indexOf('\n      - ', tendAt + 1);
  const tendStep = tendAt < 0 ? '' : text.slice(tendAt, tendNext < 0 ? undefined : tendNext + 1);
  if (!/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.pick\.outputs\.minutes\) \}\}\n/.test(tendStep) || !/\n\s+uses: anthropics\/claude-code-action@v\d+\n/.test(tendStep)) out.push('the agent\'s step is not time-boxed by the budget (steps.pick.outputs.minutes)');
  const at = s => text.indexOf(s);
  const push = at('git push');
  for (const verb of ['tend-input --record', 'guard --job tend', 'tend-report']) {
    const i = at(`node scripts/plates/climb.mjs ${verb}`);
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
  const page = at('node scripts/plates/climb.mjs tend-page'), guard = at('node scripts/plates/climb.mjs guard --job tend');
  if (page < 0 || guard < 0 || page > guard) out.push('the proposals page is not committed (tend-page) before the tend guard: the gate would not see the pushed tree');
  for (const verb of ['tend-input --record', 'tend-page', 'tend-report']) {
    const line = code(text).find(l => l.line.includes(`node scripts/plates/climb.mjs ${verb}`))?.line ?? '';
    if (!/ --date "\$DAY"(?: |$)/.test(line)) out.push(`climb.mjs ${verb} does not take the run's day (--date "$DAY"): the record's date would name the page`);
  }
  return out;
}

/** Minutes past midnight UTC of a cron "m h dom mon dow" with one minute and one hour; null otherwise. */
const cronAt = expr => { const m = /^(\d+) (\d+) /.exec(expr); return m ? Number(m[2]) * 60 + Number(m[1]) : null; };

/**
 * A loop night proposes on the findings plates-loop.yml pulled (b5944cc), so
 * plates-climb.yml runs after that pull is done: its cron is later than
 * plates-loop's on every day loop runs, by more than plates-loop's job timeout
 * (ledger#94). [string].
 */
export function climbAfterLoopProblems(climb, loop) {
  const c = /^ {4}- cron: "([^"]+)"$/m.exec(climb)?.[1], l = /^ {4}- cron: "([^"]+)"$/m.exec(loop)?.[1];
  if (!c || !l) return ['no cron in plates-climb.yml or plates-loop.yml'];
  const days = e => e.split(' ').slice(2).join(' ');
  if (days(c) !== days(l)) return [`plates-climb.yml runs on "${days(c)}" and plates-loop.yml on "${days(l)}": not the same days`];
  const bound = Number(/\n {4}timeout-minutes: (\d+)\n/.exec(loop)?.[1] ?? NaN);
  if (!Number.isFinite(bound)) return ['plates-loop.yml\'s job has no timeout-minutes'];
  return cronAt(c) > cronAt(l) + bound ? [] : [`plates-climb.yml (${c}) does not run after plates-loop.yml's pull (${l}, up to ${bound} min): a loop night would propose on yesterday's findings`];
}

test('plates-climb.yml runs after plates-loop.yml\'s pull, on the same days, so a loop night proposes on today\'s findings (ledger#94)', async () => {
  const all = await shipped();
  const climb = all.find(w => w.name === 'plates-climb.yml').template, loop = all.find(w => w.name === 'plates-loop.yml').template;
  assert.deepEqual(climbAfterLoopProblems(climb, loop), []);
  assert.deepEqual(climbAfterLoopProblems(await readFile(join(PLATES, '.github/workflows/plates-climb.yml'), 'utf8'), loop), [], "plates's plates-climb.yml");
  for (const [why, text] of [
    ['before the pull, as it was', climb.replace('cron: "17 10 * * *"', 'cron: "41 9 * * *"')],
    ['inside the pull\'s bound', climb.replace('cron: "17 10 * * *"', 'cron: "50 9 * * *"')],
    ['weekly while loop is daily', climb.replace('cron: "17 10 * * *"', 'cron: "17 10 * * 1"')],
  ]) {
    assert.notEqual(text, climb, `${why}: the mutation did not apply`);
    assert.ok(climbAfterLoopProblems(text, loop).length, `${why}: expected a problem`);
  }
});

test('plates-tend.yml has the climb workflow\'s rights only: its prefix, no merge, no delete; the agent time-boxed; the guard and the report before one PR', async () => {
  const w = (await shipped()).find(x => x.name === 'plates-tend.yml');
  const t = w.template;
  assert.equal(w.practice, 'climb');
  assert.deepEqual(tendWorkflowProblems(t), []);
  assert.deepEqual(tendWorkflowProblems(await readFile(join(PLATES, w.path), 'utf8')), [], "plates's rendered plates-tend.yml");
  assert.match(t, /git push --force origin "\$head:refs\/heads\/keel-tend\/\$DAY"/);
  assert.deepEqual(w.declared.sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY']);
  const climbCron = /cron: "(\d+) (\d+) /.exec((await shipped()).find(x => x.name === 'plates-climb.yml').template);
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
    ['climb.mjs not allowed', t.replace('Bash(node scripts/plates/climb.mjs *),', '')],
    ['no time box', t.replace(/\n\s+timeout-minutes: \$\{\{ fromJSON\(steps\.pick\.outputs\.minutes\) \}\}/, '')],
    ['no tend guard', t.replace('          node scripts/plates/climb.mjs guard --job tend --base "$GITHUB_SHA"\n', '')],
    ['a push whatever was committed', t.replace('if [ "$COMMITS" = 0 ] || [ -z "$COMMITS" ]; then', 'if false; then')],
    ['a branch deleted', t.replace(push, `${push}\n          git push origin --delete refs/heads/keel-tend/old`)],
    ['a PR closed', t.replace(push, `${push}\n          gh pr close 3`)],
    ['tend off said late', t.replace('      - name: Is tend on?\n', '      - name: Acme first\n        run: true\n      - name: Is tend on?\n')],
    ['daily', t.replace('cron: "18 10 * * 1"', 'cron: "18 10 * * *"')],
    ['the page after the guard', t.replace(/( {10}node scripts\/plates\/climb\.mjs tend-page [^\n]*\n)/, '').replace(/( {10}node scripts\/plates\/climb\.mjs guard --job tend [^\n]*\n)/, `$1${/ {10}node scripts\/plates\/climb\.mjs tend-page [^\n]*\n/.exec(t)[0]}`)],
    ['the page named by the record\'s date', t.replace(/(climb\.mjs tend-page [^\n]*?) --date "\$DAY"/, '$1')],
    ['the report trusts the record\'s date', t.replace(/(climb\.mjs tend-report [^\n]*?) --date "\$DAY"/, '$1')],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    const found = rule === 'problems' ? problems('plates-tend.yml', text, w.declared) : tendWorkflowProblems(text);
    assert.ok(found.length, `${why}: expected a problem`);
  }
});

/** Each workflow's judged hand-off (#68): its bundle, the judge's own last commit, the steps that run the agent's code, and publish's recheck. */
export const JUDGED = Object.freeze({
  'plates-climb.yml': Object.freeze({ bundle: 'night.bundle', last: 'node scripts/plates/climb.mjs settle', agentCode: ['climb.mjs guard', 'climb.mjs compare', 'climb.mjs report'], recheck: 'node scripts/plates/climb.mjs sandbox --base "$GITHUB_SHA" --head "$head"' }),
  'plates-tend.yml': Object.freeze({ bundle: 'pass.bundle', last: 'node scripts/plates/climb.mjs tend-page', agentCode: ['climb.mjs guard', 'climb.mjs tend-report'], recheck: 'node scripts/plates/climb.mjs sandbox --base "$GITHUB_SHA" --head "$head" --job tend' }),
});

/**
 * Climb and tend publish exactly the commit their guard passed (#68), on
 * plates-climb.yml or plates-tend.yml: [string]. The judge names that commit (its
 * `validated` output) and the checkout's state (`held`) in a step that runs
 * none of the agent's code, before every step that does, and after its own
 * last commit (climb's settle, tend's page); it checks with held --since,
 * after the last of the agent's code, that nothing moved; it bundles that
 * commit, never the branch as that code left it. The publish job refuses,
 * red, a bundle whose head is not that commit, then rechecks it with its own
 * checkout's script, before the push.
 */
export function judgedHeadProblems(text, { bundle, last, agentCode, recheck }) {
  const out = [];
  const jobs = jobsOf(text);
  const judge = jobs.find(j => j.id === 'judge'), publish = jobs.find(j => j.id === 'publish');
  if (!judge || !publish) return ['no judge job or no publish job'];
  const live = s => code(s).map(l => l.line).join('\n');
  const id = /\n {6}validated: \$\{\{ steps\.([\w-]+)\.outputs\.validated \}\}\n/.exec(judge.text)?.[1];
  if (!id) return ['the judge job has no validated output (steps.<id>.outputs.validated): publish cannot know which commit the guard passed'];
  const steps = stepsOf(judge.text).map(live);
  const runsAgent = s => agentCode.some(v => s.includes(`node scripts/plates/${v}`));
  const take = steps.findIndex(s => new RegExp(`\\n {8}id: ${id}(?:\\n|$)`).test(s));
  if (take < 0) return [`no judge step has the id ${id} its validated output names`];
  const t = steps[take];
  const firstAgent = steps.findIndex(runsAgent);
  if (runsAgent(t) || (firstAgent >= 0 && firstAgent < take)) out.push(`the judge names its commit (steps.${id}) after the agent's code has run: a commit that code made would be the one named`);
  const named = t.indexOf('validated=$(git rev-parse HEAD)');
  if (named < 0 || !t.includes('echo "validated=$validated" >> "$GITHUB_OUTPUT"')) out.push(`steps.${id} does not name HEAD as its validated output`);
  else if (t.indexOf(last) < 0 || t.lastIndexOf(last) > named) out.push(`steps.${id} names its commit before the judge's own last commit (${last.replace('node scripts/plates/', '')}): the bundle would not end on it`);
  if (!t.includes('held=$(node scripts/plates/climb.mjs held)') || !t.includes('echo "held=$held" >> "$GITHUB_OUTPUT"')) out.push(`steps.${id} does not keep the checkout's state (climb.mjs held) as its held output`);
  // The held check: after the last of the agent's code, reading the state and the commit the take step named.
  const agentSteps = steps.map((s, i) => (runsAgent(s) ? i : -1)).filter(i => i >= 0);
  const check = steps.findIndex(s => s.includes('node scripts/plates/climb.mjs held --since "$HELD" --head "$VALIDATED"'));
  if (check < 0) out.push('the judge never checks (climb.mjs held --since) that the agent\'s code it ran past the guard moved nothing');
  else {
    const s = steps[check], env = stepMap(s, 'env');
    if (env.HELD !== `\${{ steps.${id}.outputs.held }}` || env.VALIDATED !== `\${{ steps.${id}.outputs.validated }}`) out.push(`the held check does not read steps.${id}'s held and validated outputs`);
    const lastAgent = agentSteps.at(-1) ?? -1;
    const lastVerb = Math.max(...agentCode.map(v => s.lastIndexOf(`node scripts/plates/${v}`)));
    if (check < lastAgent || (check === lastAgent && lastVerb > s.indexOf('climb.mjs held --since'))) out.push('the held check runs before the last of the agent\'s code the judge runs');
  }
  // The bundle: the commit named, never the branch as the agent's code left it.
  const hand = steps.findIndex(s => s.includes(`bundle create "$out/${bundle}"`));
  if (hand < 0) out.push(`the judge hands on no ${bundle}`);
  else {
    const h = steps[hand];
    const pin = h.indexOf('update-ref "refs/heads/$BRANCH" "$VALIDATED"'), make = h.indexOf(`bundle create "$out/${bundle}" "$GITHUB_SHA..refs/heads/$BRANCH"`);
    if (stepMap(h, 'env').VALIDATED !== `\${{ steps.${id}.outputs.validated }}` || pin < 0 || make < 0 || pin > make) out.push(`the judge's ${bundle} is the branch as the agent's code left it, not the commit steps.${id} named: a later commit would be handed on`);
  }
  // Publish: the bundle's head is that commit, red otherwise, then its own recheck, then the push.
  const push = stepsOf(publish.text).map(live).find(s => /\bgit push\b/.test(s));
  if (!push) return [...out, 'the publish job never pushes'];
  if (stepMap(push, 'env').VALIDATED !== '${{ needs.judge.outputs.validated }}') out.push('the publish step does not read the judge\'s validated commit (needs.judge.outputs.validated)');
  const lines = push.split('\n').map(l => l.trim());
  const fetched = lines.indexOf('head=$(git rev-parse FETCH_HEAD)');
  const cmp = lines.findIndex(l => /^if \[ -z "\$VALIDATED" \] \|\| \[ "\$head" != "\$VALIDATED" \]; then$/.test(l));
  const pushed = lines.findIndex(l => /\bgit push\b/.test(l));
  const body = cmp < 0 ? [] : lines.slice(cmp + 1, lines.indexOf('fi', cmp));
  if (fetched < 0 || cmp < fetched || cmp > pushed || !body.some(l => l.startsWith('echo "::error::')) || !body.includes('exit 1')) out.push('publish pushes a bundle whose head it never requires to be the judge\'s validated commit (::error:: and exit 1 otherwise)');
  const rc = lines.indexOf(recheck);
  if (rc < 0 || rc < cmp || rc > pushed) out.push(`publish does not recheck the judged commit itself (${recheck.replace('node scripts/plates/', '')}) after the head check and before the push`);
  return out;
}

test('#68: climb and tend name the judged commit before any of the agent\'s code runs, hand on that commit alone, and publish refuses any other, rechecking it itself', async () => {
  const all = await shipped();
  for (const [name, opts] of Object.entries(JUDGED)) {
    const t = all.find(w => w.name === name).template;
    assert.deepEqual(judgedHeadProblems(t, opts), [], name);
    assert.deepEqual(judgedHeadProblems(await readFile(join(PLATES, '.github/workflows', name), 'utf8'), opts), [], `plates's ${name}`);
    const namedLine = '          validated=$(git rev-parse HEAD)\n';
    const heldLine = /\n {10}node scripts\/plates\/climb\.mjs held --since [^\n]*\n/.exec(t)[0];
    const guardLine = /\n {10}node scripts\/plates\/climb\.mjs guard [^\n]*\n/.exec(t)[0];
    const headCheck = /\n {10}if \[ -z "\$VALIDATED" \] \|\| \[ "\$head" != "\$VALIDATED" \]; then\n[\s\S]*?\n {10}fi\n/.exec(t)[0];
    const recheck = `\n          ${opts.recheck}\n`;
    // Climb's judge runs the same sandbox line when it takes the commits: publish's own is the one mutated.
    const at = t.indexOf('\n  publish:\n');
    const inPublish = f => `${t.slice(0, at)}${f(t.slice(at))}`;
    for (const [why, text, said] of [
      // The brief's three: a later commit published, no head check, no recheck.
      ['the branch bundled as the agent\'s code left it (a later commit)', t.replace(/\n {12}g update-ref "refs\/heads\/\$BRANCH" "\$VALIDATED"\n/, '\n'), /is the branch as the agent's code left it/],
      ['no head check in publish', t.replace(headCheck, '\n'), /never requires to be the judge's validated commit/],
      ['a head check that only warns', t.replace(headCheck, headCheck.replace('            exit 1\n', '')), /never requires to be the judge's validated commit/],
      ['no recheck in publish', inPublish(p => p.replace(recheck, '\n')), /does not recheck the judged commit itself/],
      ['a recheck that cannot fail', inPublish(p => p.replace(recheck, recheck.replace(/\n$/, ' || true\n'))), /does not recheck the judged commit itself/],
      ['the recheck before the head check', inPublish(p => p.replace(recheck, '\n').replace(headCheck, `${recheck}${headCheck.replace(/^\n/, '')}`)), /does not recheck the judged commit itself/],
      ['the commit named after the guard', t.replace(namedLine, '').replace(guardLine, `${guardLine}${namedLine}`), /does not name HEAD|after the agent's code has run/],
      ['the commit named by the judge step', t.replace('validated: ${{ steps.take.outputs.validated }}\n      ', 'validated: ${{ steps.judge.outputs.validated }}\n      '), /after the agent's code has run/],
      ['the commit named before the judge\'s own commit', t.replace(namedLine, '').replace(/(\n {10}node scripts\/plates\/climb\.mjs (?:settle|tend-page) [^\n]*\n)/, `\n${namedLine}$1`), /before the judge's own last commit/],
      ['no validated output', t.replace(/\n {6}validated: \$\{\{ steps\.take\.outputs\.validated \}\}/, ''), /no validated output/],
      ['publish not told the commit', t.replace('VALIDATED: ${{ needs.judge.outputs.validated }}', 'VALIDATED: ""'), /does not read the judge's validated commit/],
      ['no held check', t.replace(heldLine, '\n'), /never checks \(climb\.mjs held --since\)/],
      ['the held check before the report', t.replace(heldLine, '\n').replace(guardLine, `${guardLine}${heldLine.replace(/^\n/, '')}`), /runs before the last of the agent's code/],
      ['no state kept before the agent\'s code', t.replace('          held=$(node scripts/plates/climb.mjs held)\n', ''), /does not keep the checkout's state/],
    ]) {
      assert.notEqual(text, t, `${name} ${why}: the mutation did not apply`);
      const problems = judgedHeadProblems(text, opts);
      assert.ok(problems.some(p => said.test(p)), `${name} ${why}: ${JSON.stringify(problems)}`);
    }
  }
});

/** Structural jq contract only: this does not execute or emulate jq. */
function artifactSelectionProblems(body, kind) {
  const live = code(body).map(l => l.line).join('\n');
  const query = /--jq "((?:\\.|[^"\\])*)"/.exec(live)?.[1].replace(/\s+/g, ' ') ?? '';
  const out = [];
  if (!query.startsWith('[.artifacts[] | select(.expired | not) | ')) out.push(`${kind}: artifact selection must exclude expired entries before sorting`);
  if (!query.includes('] | sort_by(.created_at) | reverse | ')) out.push(`${kind}: artifact selection must sort created_at newest first`);
  if (!query.endsWith(' | .[:1][] | .id')) out.push(`${kind}: artifact selection must emit exactly the first eligible ID`);
  return out;
}

/** Mutate only this gather step, so its sibling cannot satisfy the guard. */
function checkArtifactSelectionMutations(text, title, kind, check) {
  const start = text.indexOf(`      - name: ${title}\n`);
  assert.ok(start >= 0, title);
  const next = text.indexOf('\n      - ', start + 1);
  const step = text.slice(start, next < 0 ? undefined : next);
  for (const [why, from, to, expected] of [
    ['expiry filter removed', 'select(.expired | not) | ', '', /must exclude expired entries/],
    ['only expired entries', 'select(.expired | not)', 'select(.expired)', /must exclude expired entries/],
    ['sort removed', 'sort_by(.created_at) | ', '', /must sort created_at newest first/],
    ['oldest first', ' | reverse | ', ' | ', /must sort created_at newest first/],
    ['two IDs', '.[:1][] | .id', '.[:2][] | .id', /must emit exactly the first eligible ID/],
    ['all IDs', '.[:1][] | .id', '.[] | .id', /must emit exactly the first eligible ID/],
  ]) {
    const changed = text.replace(step, step.replace(from, to));
    assert.notEqual(changed, text, `${kind} ${why}: mutation must apply`);
    const found = check(changed);
    assert.ok(found.some(p => p.startsWith(`${kind}:`) && expected.test(p)), `${kind} ${why}: ${JSON.stringify(found)}`);
  }
}

/**
 * The night gathers the newest tend record (phase 38), as it gathers the
 * climb's: the plates-tend artifact, by name, from the default branch only,
 * read-only, into .plates/tend before improve writes the page; none is never red.
 */
export function tendGatherProblems(text) {
  const out = [];
  const at = text.indexOf('      - name: Gather the tend record\n');
  if (at < 0) return ['no "Gather the tend record" step'];
  const next = text.indexOf('\n      - ', at + 1);
  const body = text.slice(at, next < 0 ? undefined : next);
  out.push(...artifactSelectionProblems(body, 'tend'));
  const measure = text.indexOf('node scripts/plates/improve.mjs --report');
  if (measure >= 0 && at > measure) out.push('the tend record is gathered after improve wrote the page');
  if (!/gh api "repos\/\$REPO\/actions\/artifacts\?name=plates-tend&/.test(body)) out.push('the tend record is not read by name');
  if (!/head_branch == \\"\$BASE\\"/.test(body) || !/BASE: \$\{\{ github\.event\.repository\.default_branch \}\}/.test(body)) out.push('tend records from other branches are read');
  if (/gh api[^\n]*(-X|--method|-f |-F |--field|--input)/.test(body)) out.push('the tend read writes to GitHub');
  if (!/unzip -o -q [^\n]* -d \.plates\/tend\n/.test(body)) out.push('the record is not unpacked into .plates/tend, where improve reads it');
  if (/exit 1/.test(body)) out.push('a missing tend record must never be red');
  return out;
}

test('the night gathers the newest plates-tend record, read-only, from the default branch, before improve writes the health page', async () => {
  const w = (await shipped()).find(x => x.name === 'plates-night.yml');
  assert.deepEqual(tendGatherProblems(w.template), []);
  assert.deepEqual(tendGatherProblems(await readFile(join(PLATES, w.path), 'utf8')), [], "plates's plates-night.yml");
  const t = w.template;
  const step = /\n {6}# The newest tend pass's record[\s\S]*?(?=\n {6}# Before the drain)/.exec(t)[0];
  for (const [why, text, expected] of [
    ['a write in the read', t.replace('gh api "repos/$REPO/actions/artifacts/$id/zip" > "$RUNNER_TEMP/tend-', 'gh api -X DELETE "repos/$REPO/actions/artifacts/$id/zip" > "$RUNNER_TEMP/tend-'), /tend read writes to GitHub/],
    ['unpacked elsewhere', t.replace('-d .plates/tend\n', '-d .plates/elsewhere\n'), /not unpacked into \.plates\/tend/],
    ['gathered after the measure', t.replace(step, '').replace('\n      - name: Keep the test ledger', `${step}\n      - name: Keep the test ledger`), /tend record is gathered after improve/],
    ['no gather at all', t.replace(step, ''), /no "Gather the tend record" step/],
    ['red when missing', t.replace('echo "tend: no plates-tend record on $BASE"\n            exit 0', 'echo "tend: no plates-tend record on $BASE"\n            exit 1'), /missing tend record must never be red/],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    const found = tendGatherProblems(text);
    assert.ok(found.some(p => expected.test(p)), `${why}: ${JSON.stringify(found)}`);
  }
  checkArtifactSelectionMutations(t, 'Gather the tend record', 'tend', tendGatherProblems);
});

/**
 * The night gathers the newest climb record (phase 35): the plates-climb
 * artifact, by name, from the default branch only, read-only, unpacked into
 * .plates/climb before improve writes the health page; none is never red. [string].
 */
export function climbGatherProblems(text) {
  const out = [];
  const at = text.indexOf("      - name: Gather the climb's record\n");
  if (at < 0) return ['no "Gather the climb\'s record" step'];
  const next = text.indexOf('\n      - ', at + 1);
  const body = text.slice(at, next < 0 ? undefined : next);
  out.push(...artifactSelectionProblems(body, 'climb'));
  const measure = text.indexOf('node scripts/plates/improve.mjs --report');
  if (measure >= 0 && at > measure) out.push('the climb record is gathered after improve wrote the page');
  if (!/gh api "repos\/\$REPO\/actions\/artifacts\?name=plates-climb&/.test(body)) out.push('the climb record is not read by name');
  if (!/head_branch == \\"\$BASE\\"/.test(body) || !/BASE: \$\{\{ github\.event\.repository\.default_branch \}\}/.test(body)) out.push('climb records from other branches are read');
  if (/gh api[^\n]*(-X|--method|-f |-F |--field|--input)/.test(body)) out.push('the climb read writes to GitHub');
  if (!/unzip -o -q [^\n]* -d \.plates\/climb\n/.test(body)) out.push('the record is not unpacked into .plates/climb, where improve reads it');
  if (/exit 1/.test(body)) out.push('a missing climb record must never be red');
  return out;
}

test('the night gathers the newest plates-climb record, read-only, from the default branch, before improve writes the health page', async () => {
  const w = (await shipped()).find(x => x.name === 'plates-night.yml');
  assert.deepEqual(climbGatherProblems(w.template), []);
  assert.deepEqual(climbGatherProblems(await readFile(join(PLATES, w.path), 'utf8')), [], "plates's plates-night.yml");
  const t = w.template;
  const step = /\n {6}- name: Gather the climb's record\n[\s\S]*?(?=\n {6}# Before the drain)/.exec(t)[0];
  for (const [why, text, expected] of [
    ['any branch\'s record', t.replace(' | select(.workflow_run.head_branch == \\"$BASE\\")] | sort_by(.created_at) | reverse | .[:1]', '] | sort_by(.created_at) | reverse | .[:1]'), /climb records from other branches/],
    ['a write in the read', t.replace('gh api "repos/$REPO/actions/artifacts/$id/zip" > "$RUNNER_TEMP/climb-', 'gh api -X DELETE "repos/$REPO/actions/artifacts/$id/zip" > "$RUNNER_TEMP/climb-'), /climb read writes to GitHub/],
    ['unpacked elsewhere', t.replace('-d .plates/climb\n', '-d .plates/elsewhere\n'), /not unpacked into \.plates\/climb/],
    ['gathered after the measure', t.replace(step, '').replace('\n      - name: Keep the test ledger', `${step}\n      - name: Keep the test ledger`), /climb record is gathered after improve/],
    ['no gather at all', t.replace(step, ''), /no "Gather the climb's record" step/],
  ]) {
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    const found = climbGatherProblems(text);
    assert.ok(found.some(p => expected.test(p)), `${why}: ${JSON.stringify(found)}`);
  }
  checkArtifactSelectionMutations(t, "Gather the climb's record", 'climb', climbGatherProblems);
});

/**
 * Every action used at two majors across the given workflows (phase 40's
 * retro: a builder wrote upload-artifact@v6 from memory while plates was on
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

test('one major version per action across every workflow plates ships and plates\'s rendered copies', async () => {
  const files = (await shipped()).map(w => ({ file: `practices/${w.practice}/files/${w.path}`, text: w.template }));
  for (const n of (await readdir(join(PLATES, '.github/workflows'))).filter(n => /\.ya?ml$/.test(n))) {
    files.push({ file: `.github/workflows/${n}`, text: await readFile(join(PLATES, '.github/workflows', n), 'utf8') });
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
 * the subset plates's job conditions use. Literals ('…', numbers, true, false,
 * null), property paths, ! && || == != and parentheses, and startsWith,
 * endsWith, contains and fromJSON. As GitHub does: == on strings ignores
 * case, a missing property is null, and null, false, 0 and '' are falsy.
 * With { value: true }, the value itself (a concurrency group's), and format.
 */
export function evalExpression(source, ctx, { value = false } = {}) {
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
 * Every rule a Codex agent step breaks (plates phase 45): [string]. Each step
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
  // plates#65: Claude reads the push's diff from a folder of its own (the Brief step writes it there), granted alone; no other directory.
  const addDirs = code(text).flatMap(({ line }) => [...line.matchAll(/--add-dir[ \t]+(.+?)[ \t]*$/g)].map(m => m[1]));
  if (JSON.stringify(addDirs) !== JSON.stringify(['${{ runner.temp }}/plates-diff'])) out.push(`Claude may read ${addDirs.join(', ') || 'no folder'} beyond the checkout: only the push diff's own folder, \${{ runner.temp }}/plates-diff`);
  if (!/cp "\$RUNNER_TEMP\/pr\.diff" "\$RUNNER_TEMP\/plates-diff\/push\.diff"/.test(text) || !/brief --push "\$RUNNER_TEMP\/push\.json" --agent "\$AGENT" --diff "\$RUNNER_TEMP\/plates-diff\/push\.diff"/.test(text)) out.push('the push\'s brief does not point the agent at the diff in the folder it may read');
  // Phase 46: each job asks for its own (crossReviewSandboxProblems holds which); no job may write contents or actions.
  if (!/^permissions: \{\}$/m.test(text)) out.push('the workflow\'s permissions must be {}: each job asks for its own');
  if (/:\s*write-all|contents: write|actions: write/.test(text)) out.push('the token may write contents or actions');
  for (const { line, n } of code(text)) {
    if (/\bgit push\b|\bgh pr (merge|review|close|edit)\b|\bAPPROVE\b|REQUEST_CHANGES|--approve|--request-changes/.test(line)) out.push(`line ${n}: pushes, merges, approves or requests changes: ${line.trim()}`);
    // Phase 60 (plates#65): the publish job's own reads of GitHub's compare, and a start's label, issue and close; each exactly.
    const PUSH_API = [
      /^\s*gh api -H "Accept: application\/vnd\.github\.raw" "repos\/\$REPO\/contents\/scripts\/plates\/(?:cross-review|lib)\.mjs\?ref=\$SHA" > "\$out\/(?:cross-review|lib)\.mjs"$/,
      /^\s*gh api "repos\/\$REPO\/compare\/\$STARTAT\.\.\.\$SHA" > "\$RUNNER_TEMP\/start-below\.json"$/,
      /^\s*had=\$\(gh api "repos\/\$REPO\/issues\?labels=keel:review-after&state=all&per_page=1" --jq 'length'\)$/,
      /^\s*gh api --method POST "repos\/\$REPO\/labels" -f name=keel:review-after -f color=5319e7 > \/dev\/null 2>&1 \|\| true$/,
      /^\s*gh api --method POST "repos\/\$REPO\/issues" --input "\$RUNNER_TEMP\/start\.json" > "\$RUNNER_TEMP\/started\.json"$/,
      /^\s*gh api --method PATCH "repos\/\$REPO\/issues\/\$number" -f state=closed -f state_reason=completed > \/dev\/null$/,
    ];
    if (/\bgh api\b/.test(line) && !/^\s*(?:if ! )?gh api --method POST "repos\/\$REPO\/pulls\/\$PR\/reviews" --input "\$RUNNER_TEMP\/review(?:-plain)?\.json" --jq '[^']*'(?:; then)?$/.test(line) && !PUSH_API.some(re => re.test(line))) out.push(`line ${n}: a gh api call other than the summary review: ${line.trim()}`);
  }
  if (!/node scripts\/plates\/cross-review\.mjs summary [^\n]*--out "\$RUNNER_TEMP\/review\.json"/.test(text)) out.push('the summary review is not the script\'s (cross-review.mjs summary): its event would be the workflow\'s to get wrong');
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

test('plates-cross-review.yml runs only for a same-repo PR opened or made ready, or a person\'s /review on a PR; a fork, a draft, a bot or anyone without write access does nothing', async () => {
  const t = (await shipped()).find(w => w.name === 'plates-cross-review.yml').template;
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
  assert.match(steps[which], /node scripts\/plates\/cross-review\.mjs which --pr "\$RUNNER_TEMP\/pr\.json" --event "\$EVENT"/);
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
 * GitHub evaluates `plates-cross-review-${{ … }}`.
 */
export function crossReviewGroup(text, ctx) {
  const m = /^concurrency:\n {2}group: (.*)\n {2}cancel-in-progress: false$/m.exec(text);
  if (!m) throw new Error('no concurrency group with cancel-in-progress: false');
  return m[1].replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e) => String(evalExpression(e, ctx, { value: true }) ?? ''));
}

test('phase 60: a push to main triggers a review only with "after": "push" (the template, and every project without it, has no push trigger); then a push to the default branch and the daily run, coalescing in one group', async () => {
  const w = (await shipped()).find(x => x.name === 'plates-cross-review.yml');
  const t = w.template;
  const on = text => [...(/\non:\n((?: {2}.*\n)+)/.exec(text)?.[1] ?? '').matchAll(/^ {2}([a-z_]+):/gm)].map(m => m[1]);
  const base = { name: 'Acme', tagline: 'Anvils, dropped on time.', repo: ACME };
  assert.deepEqual(on(t), ['pull_request', 'issue_comment'], 'the template');
  for (const crossReview of [{ for: ['codex/'] }, { for: ['codex/', 'claude/'], budget: { minutes: 20 } }]) {
    const without = fill(t, { ...base, crossReview }, CROSS_REVIEW_WORKFLOW);
    assert.equal(without, t, 'no "after": the template\'s bytes, no push trigger');
  }
  // plates's own rendered copy: plates reviews its PRs, not its pushes.
  assert.deepEqual(on(await readFile(join(PLATES, CROSS_REVIEW_WORKFLOW), 'utf8')), ['pull_request', 'issue_comment']);
  const shaped = fill(t, { ...base, crossReview: { after: 'push' } }, CROSS_REVIEW_WORKFLOW);
  assert.deepEqual(on(shaped), ['pull_request', 'issue_comment', 'push', 'schedule']);
  assert.ok(shaped.includes("\n  push:\n    branches: [main]\n  schedule:\n    - cron: '41 4 * * *'\n\n"), 'a push to main, and once a day for the pushes that waited past the budget');
  assert.deepEqual(crossReviewProblems(shaped), []);
  assert.deepEqual(crossReviewSandboxProblems(shaped), []);
  assert.deepEqual(problems('plates-cross-review.yml', shaped, w.declared), []);
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
  assert.equal(group(push(), 301), 'plates-cross-review-after-push');
  assert.equal(group(push(), 302), group(ghEvent('schedule', {}), 303));
  assert.equal(group(prEvent(), 304), 'plates-cross-review-7', 'a PR keeps its own queue');
  assert.equal(group(commentEvent({ body: 'LGTM' }), 305), 'plates-cross-review-run-305');
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

test('plates-cross-review.yml: reviews of one PR queue behind each other; a run that will not review has a group of its own, so it never displaces a queued /review', async () => {
  const t = (await shipped()).find(w => w.name === 'plates-cross-review.yml').template;
  const withRun = (ctx, id) => ({ ...ctx, github: { ...ctx.github, run_id: id } });
  const group = (ctx, id = 101) => crossReviewGroup(t, withRun(ctx, id));
  assert.equal(group(prEvent()), 'plates-cross-review-7', 'an opened PR');
  assert.equal(group(prEvent({ action: 'ready_for_review' }), 102), 'plates-cross-review-7');
  assert.equal(group(commentEvent(), 103), 'plates-cross-review-7', 'a person\'s /review queues with them');
  assert.equal(group(commentEvent({ body: '/review\nthe lid, please' }), 104), 'plates-cross-review-7');
  // ledger#92: a later comment replaced a queued /review, then skipped. Each of these is alone.
  assert.equal(group(commentEvent({ body: 'Deployment ready (acme-preview)', type: 'Bot', login: 'acme-deploy[bot]' }), 105), 'plates-cross-review-run-105', 'a bot\'s comment');
  assert.equal(group(commentEvent({ body: 'LGTM' }), 106), 'plates-cross-review-run-106', 'a person\'s other comment');
  assert.equal(group(commentEvent({ body: '/review', type: 'Bot', login: 'codex[bot]', association: 'MEMBER' }), 107), 'plates-cross-review-run-107', 'a bot\'s /review never runs, so never queues');
  assert.notEqual(group(commentEvent({ body: 'LGTM' }), 108), group(commentEvent({ body: 'LGTM' }), 109), 'two other comments never share a group');
  // Every event the job's if: lets through queues on the PR's group: the group never splits real reviews.
  const cond = jobIf(t);
  for (const ctx of [prEvent(), prEvent({ action: 'ready_for_review' }), commentEvent(), commentEvent({ association: 'MEMBER' })]) {
    assert.equal(evalExpression(cond, ctx), true);
    assert.equal(group(ctx, 110), 'plates-cross-review-7');
  }
  // Codex on ledger#93: a /review the job will skip (no write access, a fork, a draft) never joins the PR's group.
  // The rule: the PR's group exactly when the job's if: lets the event through.
  const events = [prEvent(), prEvent({ action: 'ready_for_review' }), commentEvent(), commentEvent({ association: 'MEMBER' }), commentEvent({ association: 'OWNER' }),
    commentEvent({ association: 'CONTRIBUTOR' }), commentEvent({ association: 'NONE' }), commentEvent({ association: 'FIRST_TIME_CONTRIBUTOR' }),
    commentEvent({ body: 'LGTM' }), commentEvent({ body: '/review', type: 'Bot', login: 'codex[bot]', association: 'MEMBER' }), commentEvent({ body: '/review', login: 'acme-helper[bot]' }),
    prEvent({ repo: 'someone/acme-fork' }), prEvent({ draft: true })];
  for (const [i, ctx] of events.entries()) assert.equal(group(ctx, 200 + i) === 'plates-cross-review-7', evalExpression(cond, ctx) === true, JSON.stringify(ctx.github.event?.comment ?? ctx.github.event?.action));
  assert.equal(group(commentEvent({ association: 'NONE' }), 220), 'plates-cross-review-run-220', 'an outsider\'s /review is alone');
  // Mutation: the old group (the PR's number for every event) lets any comment displace a /review.
  const old = t.replace(/^( {2}group: ).*$/m, '$1plates-cross-review-${{ github.event.pull_request.number || github.event.issue.number }}');
  assert.notEqual(old, t, 'the mutation did not apply');
  assert.equal(crossReviewGroup(old, withRun(commentEvent({ body: 'LGTM' }), 111)), 'plates-cross-review-7', 'the old group puts any comment in the queue');
  assert.match(t, /^concurrency:\n {2}group: [^\n]*\n {2}cancel-in-progress: false$/m, 'queued, never cancelled');
});

test('plates-cross-review.yml: the agent reads and comments inline, nothing else; the review event is COMMENT; nothing pushes, approves or merges', async () => {
  const w = (await shipped()).find(x => x.name === 'plates-cross-review.yml');
  const t = w.template;
  assert.equal(w.practice, 'cross-review');
  assert.equal(w.optional, true);
  assert.deepEqual(w.declared.sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY']);
  assert.deepEqual(crossReviewProblems(t), []);
  assert.deepEqual(problems('plates-cross-review.yml', t, w.declared), []);
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
    ['the summary not the script\'s', t.replace(/node scripts\/plates\/cross-review\.mjs summary [^\n]*\n/, 'echo \'{"event":"COMMENT","body":"x"}\' > "$RUNNER_TEMP/review.json"\n')],
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
    // plates#65: Claude must be able to read the push's diff, and only that folder beyond the checkout.
    ['Claude cannot read the push diff', t.replace('            --add-dir ${{ runner.temp }}/plates-diff\n', '')],
    ['Claude may read the whole runner temp', t.replace('            --add-dir ${{ runner.temp }}/plates-diff\n', '            --add-dir ${{ runner.temp }}\n')],
    ['Claude may read another folder too', t.replace('            --add-dir ${{ runner.temp }}/plates-diff\n', '            --add-dir ${{ runner.temp }}/plates-diff\n            --add-dir /home/runner\n')],
    ['the push brief points elsewhere', t.replace('--diff "$RUNNER_TEMP/plates-diff/push.diff"', '--diff "$RUNNER_TEMP/pr.diff"')],
    ['Claude for another bot', t.replace('          allowed_bots: claude[bot]\n', '          allowed_bots: claude[bot],acme-deploy[bot]\n')],
    ['Codex for any bot', t.replace('          allow-bot-users: claude[bot]\n', '          allow-bot-users: "*"\n')],
    ['Codex for another bot', t.replace('          allow-bot-users: claude[bot]\n', '          allow-bot-users: claude[bot],acme-deploy[bot]\n')],
    ['Codex for a bot by an empty entry', t.replace('          allow-bot-users: claude[bot]\n', '          allow-bot-users: claude[bot],\n')],
    ['Codex for anyone', t.replace('          safety-strategy: drop-sudo\n', '          safety-strategy: drop-sudo\n          allow-users: "*"\n')],
    ['Codex args around the sandbox', t.replace('          safety-strategy: drop-sudo\n', '          safety-strategy: drop-sudo\n          codex-args: --dangerously-bypass-approvals-and-sandbox\n')],
    ['Codex holds the token', t.replace('        env:\n          GH_TOKEN: ""\n          TMPDIR: /tmp/plates-codex\n', '')],
    ['Codex\'s TMPDIR unpinned', t.replace('          TMPDIR: /tmp/plates-codex\n', '')],
    ['Codex\'s TMPDIR the runner\'s temp', t.replace('          TMPDIR: /tmp/plates-codex\n', '          TMPDIR: ${{ runner.temp }}\n')],
    ['Codex\'s TMPDIR never made', t.replace('        run: mkdir -p /tmp/plates-codex\n', '        run: true\n')],
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
 * writes runs no agent (plates phase 46, as ledger#92 made climb and tend):
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
  // plates#65: after a push the review job runs the event's commit, the one the publisher is checked at, never
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
    // plates#65: after a push every commit on main was pushed code once, a reviewed one too, so none is run for what it
    // is. The publisher is fetched alone (no checkout) and runs only when its sha256 is the one plates rendered here.
    const pub = steps[at(/\n {8}id: publisher\n/)] ?? '';
    if (!pub) out.push(`the writing job ${w.id} has no step that checks the publisher after a push (id: publisher)`);
    else {
      const env = stepMap(pub, 'env');
      if (!pub.includes("\n        if: (github.event_name == 'push' || github.event_name == 'schedule') && needs.review.outputs.mode == 'push'\n")) out.push('the publisher step does not run for a push event alone');
      if (!/^(?:unrendered|[0-9a-f]{64} [0-9a-f]{64})$/.test(env.PLATES_PUBLISHER ?? '')) out.push(`the publisher's sha256 is not plates's, written here (PLATES_PUBLISHER: ${env.PLATES_PUBLISHER ?? 'none'})`);
      if (env.SHA !== '${{ github.sha }}') out.push('the publisher step does not fetch at the run\'s commit');
      const fetched = [...pub.matchAll(/gh api -H "Accept: application\/vnd\.github\.raw" "repos\/\$REPO\/contents\/scripts\/plates\/([\w.-]+)\?ref=\$SHA" > "\$out\/([\w.-]+)"/g)].map(m => `${m[1]}>${m[2]}`);
      if (JSON.stringify(fetched) !== JSON.stringify(['cross-review.mjs>cross-review.mjs', 'lib.mjs>lib.mjs'])) out.push(`the publisher step fetches ${fetched.join(', ') || 'nothing'}: cross-review.mjs and lib.mjs alone`);
      if (!/cross !== want\[0\] \|\| lib !== want\[1\]/.test(pub) || !/createHash\("sha256"\)\.update\(fs\.readFileSync\(f\)\)/.test(pub)) out.push('the publisher step does not check the scripts\' sha256 against PLATES_PUBLISHER');
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
    // plates#65: the PR path (the default branch's checkout, its script's summary) runs on a PR's events alone, keyed on the
    // event, never on the review job's word: on a push the review job ran the pushed code, and could say "pr".
    const summary = steps.find(st => /- name: Post the summary\n/.test(st));
    if (summary && !summary.includes("\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment'\n")) out.push('the PR\'s summary step runs on an event other than a PR\'s, or on the review job\'s word');
    if (post && !post.includes("\n        if: (github.event_name == 'push' || github.event_name == 'schedule') && needs.review.outputs.mode == 'push'\n")) out.push('the push\'s post runs on an event other than a push or the daily run');
    if (start && /scripts\/plates|cross-review\.mjs/.test(start)) out.push('the start step runs the repository\'s code');
    if (start) {
      const env = stepMap(start, 'env');
      if (env.SHA !== '${{ github.sha }}' || env.BEFORE !== '${{ github.event.before }}' || env.STARTAT !== `\${{ needs.${agent.id}.outputs.start }}`) out.push('the start step does not take its facts from the event and the suggestion from the review job');
      if (!/\n {10}at="\$SHA"\n/.test(start) || !/\[ "\$STARTAT" = "\$BEFORE" \]/.test(start) || !/\.status === "ahead" \? 0 : 1\)' "\$RUNNER_TEMP\/start-below\.json"; then at="\$STARTAT"; fi/.test(start)) out.push('the start step starts the record where the review job says, unchecked: only the push\'s before, below the run\'s commit, else the run\'s commit');
    }
    if (start) for (const c of steps.filter(st => /uses: actions\/(?:checkout|download-artifact)@/.test(st))) if (!/\n {8}if: (?:needs\.[\w-]+\.outputs\.mode != 'start'|github\.event_name == 'pull_request' \|\| github\.event_name == 'issue_comment')\n/.test(c)) out.push(`the writing job ${w.id} checks out or downloads for a start, which has nothing to run`);
    if (!/\n {6}- uses: actions\/download-artifact@/.test(w.text)) out.push(`the writing job ${w.id} does not take the review job's artifact`);
    if (code(w.text).some(({ line }) => (/cross-review\.mjs" (?:summary|push-review|push-post)|\$RUNNER_TEMP\/plates\//.test(line) && !/^\s*node "\$PUBLISHER\/cross-review\.mjs" push-(?:review|post) /.test(line)))) out.push(`the writing job ${w.id} runs a copy of cross-review.mjs, not its own checkout's`);
  }
  return out;
}

test('phase 46: cross-review\'s agent, Claude or Codex, runs in a job whose token only reads; the job that posts runs no agent and nothing of the PR\'s', async () => {
  const t = (await shipped()).find(w => w.name === 'plates-cross-review.yml').template;
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
  // plates#65: on a push the review job ran the pushed code; its saying "pr" never reaches the PR path's checkout or post.
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
    // Phase 60, plates#65: after a push the default branch is the pushed code, and the review job ran it.
    // plates#65: after a push no commit is run for what it is; only the publisher plates rendered, checked byte for byte.
    ['the publish job checks out after a push', t.replace(publish, publish.replace("      - uses: actions/checkout@v7\n        if: github.event_name == 'pull_request' || github.event_name == 'issue_comment'\n", '      - uses: actions/checkout@v7\n'))],
    // plates#65: the path is the event's. The review job's word (it ran the pushed code) never picks the PR path.
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
    ['the publisher\'s sha256 from the review job', t.replace(trustStep, trustStep.replace('          PLATES_PUBLISHER: unrendered\n', '          PLATES_PUBLISHER: ${{ needs.review.outputs.publisher }}\n'))],
    ['the publisher fetched whole', t.replace(trustStep, trustStep.replace('"repos/$REPO/contents/scripts/plates/lib.mjs?ref=$SHA" > "$out/lib.mjs"', '"repos/$REPO/contents/scripts/plates/lib.mjs?ref=$SHA" > "$out/lib.mjs"\n          gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/scripts/plates/improve.mjs?ref=$SHA" > "$out/improve.mjs"'))],
    ['the publisher handed on first', t.replace(trustStep, trustStep.replace('        run: |\n          out=', '        run: |\n          echo "dir=$RUNNER_TEMP/publisher/scripts/plates" >> "$GITHUB_OUTPUT"\n          out=').replace(/\n {10}echo "dir=\$out" >> "\$GITHUB_OUTPUT"$/, ''))],
    ['the push post runs the pushed script', t.replace(publish, publish.replace('node "$PUBLISHER/cross-review.mjs" push-post', 'node scripts/plates/cross-review.mjs push-post'))],
    ['the push post runs something else too', t.replace(publish, publish.replace('          node "$PUBLISHER/cross-review.mjs" push-post', '          node scripts/plates/improve.mjs --check\n          node "$PUBLISHER/cross-review.mjs" push-post'))],
    ['the start step starts where the review job says', t.replace(startStep, startStep.replace('          at="$SHA"\n', '          at="${STARTAT:-$SHA}"\n'))],
    ['the start step takes any suggestion as the before', t.replace(startStep, startStep.replace(' && [ "$STARTAT" = "$BEFORE" ]', ''))],
    ['the start step asks GitHub nothing', t.replace(startStep, startStep.replace('.status === "ahead" ? 0 : 1)\' "$RUNNER_TEMP/start-below.json"; then at="$STARTAT"; fi', '.status ? 0 : 0)\' "$RUNNER_TEMP/start-below.json"; then at="$STARTAT"; fi'))],
    ['a start runs the repository\'s script', t.replace(startStep, startStep.replace('        run: |\n', '        run: |\n          node scripts/plates/cross-review.mjs config\n'))],
    ['a start downloads an artifact it has not', t.replace(publish, publish.replace("      - uses: actions/download-artifact@v8\n        if: needs.review.outputs.mode != 'start'\n", '      - uses: actions/download-artifact@v8\n'))],
    ['the publish job runs whatever happened', t.replace(publish, publish.replace("    if: needs.review.outputs.ran == 'true' || needs.review.outputs.mode == 'start'\n", '    if: always()\n'))],
    ['the publish job with no if', t.replace(publish, publish.replace("    if: needs.review.outputs.ran == 'true' || needs.review.outputs.mode == 'start'\n", ''))],
    ['the publish job for any mode', t.replace(publish, publish.replace("    if: needs.review.outputs.ran == 'true' || needs.review.outputs.mode == 'start'\n", "    if: needs.review.outputs.ran == 'true' || needs.review.outputs.mode != ''\n"))],
    ['the publish job not waiting', t.replace(publish, publish.replace('    needs: review\n', ''))],
    ['the publish job without the artifact', t.replace(publish, publish.replace(/\n {6}- uses: actions\/download-artifact@[\s\S]*?\/review\n/, '\n'))],
    ['the publish job runs a copy', t.replace(publish, publish.replace('node scripts/plates/cross-review.mjs summary', 'node "$RUNNER_TEMP/plates/scripts/plates/cross-review.mjs" summary'))],
    ['ran said before the check', t.replace('          echo "ran=true" >> "$GITHUB_OUTPUT"\n', '').replace('        run: |\n          if [ "$AGENT" = codex ]; then\n            node "$RUNNER_TEMP/plates/scripts/plates/cross-review.mjs" agent-ran', '        run: |\n          echo "ran=true" >> "$GITHUB_OUTPUT"\n          if [ "$AGENT" = codex ]; then\n            node "$RUNNER_TEMP/plates/scripts/plates/cross-review.mjs" agent-ran')],
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
    if (!/^\s*timeout-minutes:\s*\$\{\{\s*fromJSON\(steps\.[\w-]+\.outputs\.(?:minutes|build_minutes)\)\s*\}\}/m.test(step)) continue;
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

test('the Budget line\'s step map equals each shipped workflow\'s budgeted claude-code-action step, as a template and as rendered on plates', async () => {
  const { BUDGET_STEPS, BUDGET_PASSES } = await import('../practices/night/files/scripts/plates/lib.mjs');
  const all = await shipped();
  const rendered = await renderedWorkflows(all);
  const found = {};
  for (const w of all) {
    const names = budgetedAgentSteps(w.template);
    if (w.name === 'plates-robot.yml') {
      const { ROBOT_MODEL_STEPS } = await import('../practices/night/files/scripts/plates/robot-budget.mjs');
      assert.deepEqual(names.map(n => n.agent).sort(), [...ROBOT_MODEL_STEPS].sort(), 'robot accounts for both build and review providers');
      if (rendered.has(w.path)) assert.deepEqual(budgetedAgentSteps(rendered.get(w.path)), names, `plates's ${w.path}`);
      continue;
    }
    assert.ok(names.length <= 1, `${w.path}: one budgeted agent step`);
    if (names.length) found[w.name] = { ...names[0] };
    if (rendered.has(w.path)) assert.deepEqual(budgetedAgentSteps(rendered.get(w.path)), names, `plates's ${w.path}`);
  }
  assert.deepEqual(found, Object.fromEntries(Object.entries(BUDGET_STEPS).map(([k, v]) => [k, { ...v }])));
  assert.deepEqual(BUDGET_PASSES.map(p => p.workflow).sort(), Object.keys(BUDGET_STEPS).sort());

  // The reader sees a rename (the step's name is what GitHub's record of a run carries).
  const tend = all.find(w => w.name === 'plates-tend.yml').template;
  assert.match(tend, /^ {6}- name: Tend$/m);
  // Phase 47: Claude's step and Codex's both carry the name, so a rename renames both.
  assert.equal(tend.match(/^ {6}- name: Tend$/gm).length, 2);
  assert.deepEqual(budgetedAgentSteps(tend.replace(/^ {6}- name: Tend$/gm, '      - name: Tend the repo')), [{ agent: 'Tend the repo', check: 'Did the agent run?' }]);
  assert.deepEqual(budgetedAgentSteps(tend.replace(/^ {6}- name: Did the agent run\?$/m, '      - name: Did Claude run?')), [{ agent: 'Tend', check: 'Did Claude run?' }]);
  // An unbudgeted claude-code-action (claude.yml's) is not a budgeted pass.
  assert.deepEqual(budgetedAgentSteps(all.find(w => w.name === 'claude.yml').template), []);
});

/**
 * Codex on a pass that edits the tree (phase 47), plates-climb.yml or
 * plates-tend.yml: [string]. One Claude step and one Codex step, each run only
 * when the pass names its provider; Codex's under every rule of
 * codexStepProblems with sandbox workspace-write (never danger-full-access or
 * unsafe), in the agent's read-only job. Before it, a plates step gives it
 * .plates/agent-git; after it, a plates step takes only objects from that git
 * dir into a repo plates makes (no system or global config, hooks and
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
  if (give < 0 || give > codex) out.push('no plates step gives Codex its git dir (.plates/agent-git) before it runs');
  else if (!/git init -q --bare \.plates\/agent-git/.test(all[give]) || !/info\/exclude/.test(all[give])) out.push('the git dir is not made, or not ignored, before Codex runs');
  if (take < 0 || take < codex) return [...out, 'no plates step after Codex takes its commits from its git dir'];
  const t = all[take];
  if (!/\n\s+if: always\(\) && /.test(t)) out.push('the take is not always(): a night whose agent failed keeps no record of its commits');
  if (!/export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=\/dev\/null\n/.test(t)) out.push('the take reads a system or global git config');
  if (!t.includes('g() { git -c core.hooksPath=/dev/null -c core.fsmonitor=false --git-dir="$dst" "$@"; }')) out.push('the take\'s git is not plates\'s repo with hooks and fsmonitor off');
  if (!/git init -q --bare "\$dst"/.test(t)) out.push('the take does not make its own repo');
  if (!/g merge-base --is-ancestor "\$GITHUB_SHA" "\$tip"/.test(t)) out.push('the take does not refuse a head off the run\'s commit');
  if (/objects\/info\/alternates/.test(t) && !/echo "\$PWD\/\.git\/objects" > "\$dst\/objects\/info\/alternates"/.test(t)) out.push('the take borrows objects from somewhere other than .git');
  for (const s of all.slice(codex + 1)) for (const line of s.split('\n')) {
    if (/\bgit\b[^\n]*(?:--git-dir[= ]"?(?:\$src|\.plates\/agent-git)|-C "?(?:\$src|\.plates\/agent-git))/.test(line) || /GIT_DIR=/.test(line)) out.push(`a step after Codex runs git on its git dir: ${line.trim()}`);
  }
  const hand = all.findIndex((s, i) => i > take && /git bundle create/.test(s));
  if (hand < 0 || !/if \[ "\$AGENT" != codex \] && git rev-parse/.test(all[hand])) out.push('the hand-on step bundles .git for Codex too, where its commits are not');
  return out;
}

test('phase 47: Codex runs climb and tend in workspace-write with sudo dropped, never danger-full-access or unsafe; its commits leave its git dir as objects only, in the read-only agent job', async () => {
  const all = await shipped();
  for (const [name, opts] of [['plates-climb.yml', { step: 'Climb', id: 'climb', cond: "steps.pick.outputs.job != ''" }], ['plates-tend.yml', { step: 'Tend', id: 'tend', cond: "steps.pick.outputs.run == 'yes'" }]]) {
    const t = all.find(w => w.name === name).template;
    assert.deepEqual(codexEditProblems(t, opts), [], name);
    assert.deepEqual(agentSandboxProblems(t), [], name);
    assert.deepEqual(codexEditProblems(await readFile(join(PLATES, '.github/workflows', name), 'utf8'), opts), [], `plates's ${name}`);
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
      ['TMPDIR removed', t.replace('          TMPDIR: /tmp/plates-codex\n', '')],
      ['TMPDIR the runner\'s temp', t.replace('          TMPDIR: /tmp/plates-codex\n', '          TMPDIR: ${{ runner.temp }}\n')],
      ['TMPDIR $RUNNER_TEMP', t.replace('          TMPDIR: /tmp/plates-codex\n', '          TMPDIR: $RUNNER_TEMP/codex\n')],
      ['TMPDIR in .git', t.replace('          TMPDIR: /tmp/plates-codex\n', '          TMPDIR: /tmp/.git\n')],
      ['TMPDIR never made', t.replace('          mkdir -p /tmp/plates-codex\n', '')],
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
      ['a bundle straight from the agent\'s git dir', t.replace(/( {10}if \[ "\$AGENT" != codex \] && git rev-parse)/, '          git --git-dir=.plates/agent-git bundle create "$out/acme.bundle" HEAD\n$1')],
      ['.git bundled for Codex too', t.replace('if [ "$AGENT" != codex ] && git rev-parse', 'if git rev-parse')],
    ]) {
      assert.notEqual(text, t, `${name} ${why}: the mutation did not apply`);
      assert.ok(check(text, opts).length, `${name} ${why}: expected a problem`);
    }
  }
});

// ---- phase 76: climb and the robot read tonight's plan, and tick it from their publish job ----

/** A workflow's jobs, by name (jobsOf, above). */
const jobsByName = text => Object.fromEntries(jobsOf(text).map(j => [j.id, j.text]));

test('climb and the robot read tonight\'s plan before they choose, keep it before any agent runs, and tick it only from the job that can write', async t => {
  const dir = join(PLATES, 'practices/climb/files/.github/workflows');
  const climb = await readFile(join(dir, 'plates-climb.yml'), 'utf8');
  const robot = await readFile(join(dir, 'plates-robot.yml'), 'utf8');
  for (const [name, text, chooses] of [['plates-climb', climb, 'Pick tonight\'s job'], ['plates-robot', robot, 'Admit one issue from trusted policy']]) {
    const jobs = jobsByName(text);
    const steps = runBlocks(jobs.agent).map(b => b.step);
    const at = s => steps.indexOf(s);
    assert.ok(at('Read tonight\'s plan') >= 0 && at('Read tonight\'s plan') < at(chooses), `${name}: the plan is read before the pass chooses: ${steps.join(', ')}`);
    // Only the publish job can write, and only it ticks; the agent and the judge read.
    for (const job of ['agent', 'judge']) {
      assert.doesNotMatch(jobs[job].split('\n    steps:\n')[0], /: write/, `${name} ${job} holds no write permission`);
      assert.doesNotMatch(jobs[job], /night-plan\.mjs record/, `${name} ${job} never ticks`);
    }
    assert.match(jobs.publish.split('\n    steps:\n')[0], /contents: write/);
    const publish = runBlocks(jobs.publish).map(b => b.step);
    assert.ok(publish.includes('Tick tonight\'s plan'), `${name}: the publisher ticks`);
    assert.match(jobs.publish, /- name: Tick tonight's plan\n {8}if: always\(\) && needs\.agent\.outputs\.plan_ticks == 'true'\n/);
    assert.match(jobs.publish, /node scripts\/plates\/night-plan\.mjs record --date "\$DAY" --ticks "\$RUNNER_TEMP\/plan-ticks\.json"/);
    // The plan never goes to main: the only push of it is record's, onto keel-night-plan.
    assert.doesNotMatch(text, /keel-night-plan:refs\/heads\/main|push[^\n]*keel-night-plan/);
  }
  // Climb keeps the plan and the pick as an artifact before its agent runs, the judge and the publisher refuse its
  // willNotTouch from that copy (sandbox --plan), and the agent's time box is the pick's minutes, never the config's alone.
  const agentText = jobsByName(climb).agent;
  assert.ok(agentText.indexOf('name: plates-climb-plan') > 0 && agentText.indexOf('name: plates-climb-plan') < agentText.indexOf('- name: Climb\n'), 'kept before the agent runs');
  // The off-limits check stays exactly as it was; the plan's is one more check right after it, never in its place.
  for (const job of ['judge', 'publish']) {
    assert.match(jobsByName(climb)[job], /\n {10}node scripts\/plates\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head"\n {10}if \[ "\$PLAN_USED" = true \]; then node scripts\/plates\/climb\.mjs sandbox --base "\$GITHUB_SHA" --head "\$head" --plan "\$RUNNER_TEMP\/plan\/night-plan\.json"; fi\n/, `${job} refuses the plan's willNotTouch`);
  }
  assert.match(agentText, /`minutes=\$\{p\.minutes \?\? c\.minutes\}`/);
  assert.match(jobsByName(robot).agent, /ROBOT_NIGHT_PLAN: \$\{\{ runner\.temp \}\}\/night-plan\/branch\.json/);

  // The read itself, against a stub gh: a plan is kept, none is green and says so, an unreadable branch is red.
  const base = await mkdtemp(join(tmpdir(), 'plates-wf-read-plan-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  for (const [name, text] of [['plates-climb', climb], ['plates-robot', robot]]) {
    const block = runBlocks(text).find(b => b.step === 'Read tonight\'s plan');
    for (const [answer, status, kept, said] of [
      ['echo \'{"schema":1}\'; exit 0', 0, true, /tonight's plan: read from keel-night-plan/],
      ['echo "gh: Not Found (HTTP 404)" >&2; exit 1', 0, false, /no plan on keel-night-plan: (climb picks|the robot admits) as it always has/],
      ['echo "gh: Server Error (HTTP 502)" >&2; exit 1', 1, false, /::error::The plan branch keel-night-plan could not be read \(gh api exit 1: gh: Server Error \(HTTP 502\)\); (climb|the robot) never guesses there is no plan\./],
    ]) {
      const temp = await mkdtemp(join(base, 'run-')), bin = join(temp, 'bin');
      await mkdir(bin);
      await writeFile(join(bin, 'gh'), `#!/bin/sh\n[ "$1 $2 $3" = "api -H Accept: application/vnd.github.raw+json" ] || exit 9\ncase "$4" in "repos/acme/anvils/contents/.plates/night/plan.json?ref=keel-night-plan") ;; *) exit 9 ;; esac\n${answer}\n`, { mode: 0o755 });
      const r = run('bash', ['-e', '-c', block.script], { cwd: temp, env: { ...process.env, RUNNER_TEMP: temp, REPO: 'acme/anvils', PATH: `${bin}:${process.env.PATH}` } });
      assert.equal(r.status, status, `${name}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout + r.stderr, said);
      assert.equal((await readdir(join(temp, 'night-plan'))).includes('branch.json'), kept, `${name}: the plan file is there only when one was read`);
    }
  }
});

test('a robot PR published on a night whose plan ticks fail still gets its other-provider review, and the run is still red', async t => {
  const robot = await readFile(join(PLATES, 'practices/climb/files/.github/workflows/plates-robot.yml'), 'utf8');
  const jobs = jobsByName(robot);
  // The review follows the publication step's own outcome, never the whole publish job's.
  assert.match(jobs.publish, /\n {6}published: \$\{\{ steps\.publish\.outcome \}\}\n/);
  assert.match(jobs.publish, /\n {6}- name: Publish verified candidate or explicit blocked outcome\n {8}id: publish\n/);
  const condition = /\n {4}if: (.+)\n/.exec(jobs['review-agent'])?.[1];
  assert.doesNotMatch(condition, /needs\.publish\.result/, 'the review never waits on the tick step');
  const runs = (publish, outputs) => Function('needs', 'always', `return ${condition.replaceAll(' == ', ' === ').replaceAll(' != ', ' !== ')};`)({ publish: { result: publish, outputs } }, () => true);
  assert.equal(runs('failure', { published: 'success', pr: '7' }), true, 'only the record failed: the PR is reviewed (mutation: needs.publish.result == \'success\' skips it)');
  assert.equal(runs('success', { published: 'success', pr: '7' }), true);
  assert.equal(runs('failure', { published: 'failure', pr: '' }), false, 'publication failed: no review');
  assert.equal(runs('success', { published: 'success', pr: '' }), false, 'nothing published: no review');
  // The tick step may not hide its failure: no continue-on-error, so a failed record leaves the job, and the run, red.
  const tick = jobs.publish.split(/\n(?= {6}- )/).find(s => s.includes('- name: Tick tonight\'s plan'));
  assert.ok(tick, 'the publisher ticks');
  assert.doesNotMatch(tick, /continue-on-error/);
  // And it does fail when the plan branch cannot be reached: the record's error is the step's exit.
  const base = await mkdtemp(join(tmpdir(), 'plates-wf-tick-fails-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'acme'), temp = join(base, 'tmp');
  await mkdir(join(temp, 'plan'), { recursive: true });
  await cp(join(PLATES, 'practices/night/files/scripts/plates'), join(dir, 'scripts/plates'), { recursive: true });
  for (const args of [['init', '-q', '-b', 'main'], ['remote', 'add', 'origin', join(base, 'no-such-origin.git')]]) assert.equal(run('git', args, { cwd: dir }).status, 0);
  await writeFile(join(temp, 'plan/robot-plan.json'), JSON.stringify({ nightPlan: { used: true, applies: true, date: '2026-10-15', item: 'robot-12', ticks: [], willNotTouch: [] } }));
  const block = runBlocks(robot).find(b => b.step === 'Tick tonight\'s plan');
  const r = run('bash', ['-e', '-c', block.script], { cwd: dir, env: { ...process.env, RUNNER_TEMP: temp, DAY: '2026-10-15', PUBLISHED: 'success', JUDGED: 'success', PR: '7', REPO: 'acme/anvils', RUN: 'https://github.com/acme/anvils/actions/runs/5' } });
  assert.notEqual(r.status, 0, `a failed record is red: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr + r.stdout, /cannot read the plan branch keel-night-plan/);
});

/**
 * plates-morning.yml's rules (phase 77), as text: started by each pass
 * finishing and by a schedule; read-only at the top; only the send job may
 * write issues; send and finalize run only when decide says the night is
 * over and unsent; a failed send fails the run. Returns the broken rules.
 */
export function productionMorningProblems(text) {
  const out = [], send = jobsOf(text).find(j=>j.id==='send')?.text ?? '';
  const steps = send.split(/\n(?= {6}- )/);
  const restore = (steps.find(s=>/^ {6}- name: Restore production observations for the brief\n/.test(s)) ?? '').trimEnd() + '\n';
  const verdict = steps.find(s=>/^ {6}- name: Production restoration verdict\n/.test(s)) ?? '';
  if (!restore.includes('        id: production_restore\n') || !restore.includes('          code=0\n          node scripts/plates/production-night.mjs --restore-only || code=$?\n          echo "code=$code" >> "$GITHUB_OUTPUT"\n')) out.push('send: restoration must capture and publish its real exit code');
  if (!verdict.includes('        if: always()\n') || !verdict.includes('          RESTORE_CODE: ${{ steps.production_restore.outputs.code }}\n') || !verdict.includes('          if [ "${RESTORE_CODE:-missing}" != 0 ]; then\n') || !/\n {12}exit 1\n {10}fi/.test(verdict)) out.push('send: restoration requires an always-run fail-closed verdict');
  if (send.indexOf('name: Restore production observations') > send.indexOf('name: Send the brief') || send.indexOf('name: Production restoration verdict') < send.indexOf('name: Send the brief')) out.push('send: restore, attempt brief, then verdict');
  return out;
}

export function morningProblems(text) {
  const out = [];
  if (!/^on:\n {2}workflow_run:\n {4}workflows: \[plates-night(?:, plates-climb, plates-robot)?\]\n {4}types: \[completed\]\n {2}schedule:\n(?: {4}#.*\n)* {4}- cron: "[^"]+"\n {2}workflow_dispatch: \{\}\n/m.test(text)) out.push('not started by plates-night, plates-climb and plates-robot finishing, by a schedule and by hand');
  // Once a day, just after the default readyBy (17:00 UTC): the passes finishing cover the rest.
  const crons = [...text.matchAll(/^\s*-\s*cron:\s*"([^"]+)"/gm)].map(m => m[1]);
  if (crons.length !== 1 || !/^\d+ 17 \* \* \*$/.test(crons[0]) || Number(crons[0].split(' ')[0]) > 30) out.push(`one daily cron shortly after 17:00 UTC, the default readyBy (got ${JSON.stringify(crons)})`);
  if (!/^concurrency:\n {2}group: plates-morning\n {2}cancel-in-progress: false$/m.test(text)) out.push('no plates-morning concurrency group that queues');
  if (!/^permissions: \{\}$/m.test(text)) out.push('the top level must grant nothing (permissions: {})');
  if (/secrets\./.test(text)) out.push('no secret beyond the job\'s own token');
  const jobs = Object.fromEntries(jobsOf(text).map(j => [j.id, j.text]));
  if (Object.keys(jobs).join(',') !== 'decide,finalize,send,card') out.push(`jobs are decide, finalize, send, card (got ${Object.keys(jobs).join(', ')})`);
  const perms = job => /\n {4}permissions:\n((?: {6}[a-z-]+: (?:read|write)\n)+)/.exec(jobs[job] ?? '')?.[1].trim().split('\n').map(l => l.trim()).sort() ?? [];
  for (const [id, body] of Object.entries(jobs)) {
    if (!/\n {4}timeout-minutes: \d+\n/.test(body)) out.push(`${id}: no timeout`);
    if (/issues: write/.test(body) && id !== 'send') out.push(`${id}: only the send job may write issues`);
    if (/continue-on-error/.test(body)) out.push(`${id}: continue-on-error hides a failure`);
  }
  if (JSON.stringify(perms('decide')) !== JSON.stringify(['contents: read', 'issues: read'])) out.push('decide reads contents and issues, and writes nothing');
  if (JSON.stringify(perms('finalize')) !== JSON.stringify(['contents: write', 'pull-requests: write'])) out.push('finalize writes contents and one PR, nothing else');
  if (JSON.stringify(perms('send')) !== JSON.stringify(['actions: read', 'contents: read', 'issues: write'])) out.push('send reads contents and production artifacts, and writes issues only');
  // Phase 78: the card job reads (contents, and the artifacts its canvas journal lives in); it writes only the canvas.
  if (JSON.stringify(perms('card')) !== JSON.stringify(['actions: read', 'contents: read'])) out.push('card reads contents and actions, and writes nothing on GitHub');
  if (!(jobs.card ?? '').includes("    needs: decide\n    if: needs.decide.outputs.plan == 'found' && (github.event_name != 'workflow_run' || github.event.workflow_run.head_branch == github.event.repository.default_branch)\n")) out.push('card: runs only for a night with a plan, from a default-branch pass');
  if (!/plates morning --card --yes --date "\$DAY" --json/.test(jobs.card ?? '')) out.push('card: publishes tonight\'s plan card with plates morning --card');
  const over = "needs.decide.outputs.ready == 'true' && needs.decide.outputs.sent != 'true'";
  if (!(jobs.send ?? '').includes(`    needs: decide\n    if: ${over}`)) out.push('send: runs only when decide says the night is over and unsent');
  // Finalize runs on every run after the night is over, sent or not: a finalization that failed
  // after a send, or a build that finished after a brief sent at readyBy, still reaches the
  // archive. Its own no-change check (git status --porcelain) makes repeats harmless.
  if (!(jobs.finalize ?? '').includes("    needs: decide\n    if: needs.decide.outputs.ready == 'true'\n")) out.push('finalize: runs whenever the night is over, never gated on the brief being unsent');
  if (!/if \[ -z "\$\(git status --porcelain -- "\$\{PATHS\[@\]\}"\)" \]; then\n(?:\s+#[^\n]*\n)*\s+if [^\n]*; then\n\s+echo "Nothing changed[^\n]*\n\s+exit 0/.test(jobs.finalize ?? '')) out.push('finalize: a run with nothing new changes nothing (git status --porcelain)');
  if (!(jobs.send ?? '').includes("&& needs.decide.outputs.assignee == 'set'")) out.push('send: runs only with an assignee');
  if (!/\n {8}run: node scripts\/plates\/morning\.mjs send --date "\$DAY"\n(?:\n| *#[^\n]*\n)*$/.test((jobs.send ?? '').split(/\n(?= {6}- )/).find(s=>/^ {6}- name: Send the brief\n/.test(s)) + '\n')) out.push('send: the send is its step\'s whole command, so its failure fails the run');
  out.push(...productionMorningProblems(text));
  if (!/node scripts\/plates\/morning\.mjs decide --github-output "\$GITHUB_OUTPUT"/.test(jobs.decide ?? '')) out.push('decide: runs morning.mjs decide into the job\'s outputs');
  if (!/node scripts\/plates\/morning\.mjs finalize --date "\$DAY"/.test(jobs.finalize ?? '')) out.push('finalize: runs morning.mjs finalize');
  return out;
}

/**
 * Run plates-morning's card job's gate and publish steps, as the workflow has
 * them, in a synthetic Acme repo: plates and isocan are stubs that log their
 * calls; gh answers the recovery's reads (no earlier canvas writer, so the
 * owner's provisioned manifest is the bootstrap). Returns { gate, status, out, calls, outputs }.
 */
async function cardStep(t, morning, { canvas, creds = true, pins = true, day = '2026-10-15' } = {}) {
  const blocks = runBlocks(morning);
  const gate = blocks.find(b => b.step === 'Is the card set up?'), publish = blocks.find(b => b.step === 'Publish the plan card');
  assert.ok(gate && publish, 'the card job has its gate and its publish step');
  const base = await mkdtemp(join(tmpdir(), 'plates-wf-card-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'acme'), bin = join(base, 'bin'), temp = join(base, 'tmp'), log = join(base, 'calls.jsonl'), home = join(base, 'isocan-home');
  for (const d of [join(dir, '.plates/canvas'), join(dir, 'scripts/plates'), bin, temp, home]) await mkdir(d, { recursive: true });
  for (const f of ['canvas-recovery.mjs', 'lib.mjs']) await cp(join(PLATES, 'practices/night/files/scripts/plates', f), join(dir, 'scripts/plates', f));
  await writeFile(join(dir, '.plates/plates.json'), JSON.stringify({ name: 'Acme', canvas }));
  await writeFile(join(dir, '.plates/canvas/manifest.json'), '{}');
  for (const tool of ['plates', 'isocan']) await writeFile(join(bin, tool), `#!${process.execPath}\nconst a = process.argv.slice(2); require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify([${JSON.stringify(tool)}, ...a]) + '\\n'); if (a[0] === '--version') console.log('acme-pinned');\n`, { mode: 0o755 });
  await writeFile(join(bin, 'gh'), `#!${process.execPath}\nconst a = process.argv.slice(2); require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(['gh', ...a]) + '\\n'); console.log(JSON.stringify(a[1].includes('/workflows/') ? { workflow_runs: [] } : {}));\n`, { mode: 0o755 });
  const out = join(temp, 'out');
  await writeFile(out, '');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: out, RUNNER_TEMP: temp, DAY: day, REPO: 'Acme/app', BASE: 'main', GITHUB_REPOSITORY: 'Acme/app', GITHUB_REF_NAME: 'main', GITHUB_EVENT_NAME: 'workflow_run', GITHUB_RUN_ID: '300', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'b'.repeat(40),
    ...(pins ? { PLATES_CANVAS_PLATES_VERSION: 'acme-pinned', PLATES_CANVAS_ISOCAN_VERSION: 'acme-pinned' } : {}), PLATES_CANVAS_ISOCAN_HOME: creds ? home : '' };
  const g = run('bash', ['-e', '-c', gate.script], { cwd: dir, env });
  const enabled = /^enabled=true$/m.test(await readFile(out, 'utf8'));
  const p = enabled ? run('bash', ['-e', '-c', publish.script], { cwd: dir, env }) : null;
  const calls = (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { gate: g, enabled, status: p?.status ?? null, out: g.stdout + g.stderr + (p ? p.stdout + p.stderr : ''), calls, neverRan: await readFile(join(temp, 'keel-canvas-card/never-ran.json'), 'utf8').then(JSON.parse, () => null) };
}

// Phase 78: the card ticks.
test('plates-morning republishes the plan card after each pass when the canvas is set for nightly publishing, with plates canvas night\'s own provisioning; otherwise a notice and nothing else', async t => {
  const morning = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-morning.yml'), 'utf8');
  const night = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-night.yml'), 'utf8');
  // Exactly plates canvas night's guards: the same tool, pin and isocan home checks, the same recovery script.
  const guards = runBlocks(night).find(b => b.step === 'Project the night onto its canvas').script;
  const preflight = guards.slice(guards.indexOf('for tool in plates isocan; do'), guards.indexOf('# Restore the latest canvas-enabled attempt'));
  assert.ok(preflight.length > 200, 'the night\'s preflight was found');
  const card = runBlocks(morning).find(b => b.step === 'Publish the plan card').script;
  assert.ok(card.includes(preflight), 'the card\'s preflight is the night\'s, line for line');
  for (const line of ['export PLATES_CANVAS_PERSISTENCE=artifact-v1', 'export PLATES_ISOCAN="$(command -v isocan)"', 'export ISOCAN_HOME="$PLATES_CANVAS_ISOCAN_HOME"']) assert.ok(card.includes(line) && guards.includes(line), line);
  assert.match(card, /node scripts\/plates\/canvas-recovery\.mjs --workflow plates-morning\.yml/);
  assert.match(guards, /node scripts\/plates\/canvas-recovery\.mjs --workflow plates-night\.yml/);
  // The journal travels as the night's does: kept, red or green, for 90 days, under the name the recovery reads.
  assert.match(morning, /- name: Keep the canvas journal\n {8}if: always\(\) && steps\.canvas\.outputs\.enabled == 'true'\n {8}uses: actions\/upload-artifact@v\d+\n {8}with:\n {10}name: keel-canvas-card-\$\{\{ github\.run_attempt \}\}\n {10}path: \$\{\{ runner\.temp \}\}\/keel-canvas-card\/\n/);
  // The secret the night's Install step may hold reaches only the card job's Install step too.
  assert.deepEqual(setupTokenProblems(morning), [], 'setupToken only in Install');

  const live = { provider: 'isocan', enabled: true, cadence: 'nightly', mode: 'live', liveKeys: ['pulse', 'night-plan'] };
  // Set up: the pinned plates publishes tonight's card, once, with --yes.
  const on = await cardStep(t, morning, { canvas: live });
  assert.equal(on.status, 0, on.out);
  // The stubs' own log (no plates runs here): the pins read, then one card publication.
  assert.deepEqual(on.calls.filter(c => c[0] !== 'gh').map(c => c.join(' ')), ['plates --version', 'isocan --version', 'plates morning --card --yes --date 2026-10-15 --json']);
  assert.ok(on.calls.some(c => c[0] === 'gh' && /actions\/workflows\/plates-night\.yml\/runs/.test(c[2])) && on.calls.some(c => c[0] === 'gh' && /actions\/workflows\/plates-morning\.yml\/runs/.test(c[2])), 'the journal is the newest of the night\'s and the card\'s');
  // Not set up: a notice, nothing installed, nothing called.
  for (const [canvas, why] of [[undefined, /not set for nightly publishing/], [{ ...live, cadence: 'manual' }, /not set for nightly publishing/], [{ ...live, mode: 'immutable' }, /does not list night-plan live/], [{ ...live, liveKeys: ['pulse'] }, /does not list night-plan live/]]) {
    const off = await cardStep(t, morning, { canvas });
    assert.equal(off.gate.status, 0, off.out);
    assert.equal(off.enabled, false);
    assert.match(off.out, /::notice::The plan card is not republished: /);
    assert.match(off.out, why);
    assert.deepEqual(off.calls, [], 'nothing else is done');
  }
  // Provisioning missing: red, a never-ran receipt, and the canvas never touched.
  for (const options of [{ creds: false }, { pins: false }, { day: '' }]) {
    const bad = await cardStep(t, morning, { canvas: live, ...options });
    assert.notEqual(bad.status, 0, JSON.stringify(options));
    assert.match(bad.out, /::error::/);
    assert.ok(!bad.calls.some(c => c[1] === 'morning'), 'no card without its provisioning');
    assert.equal(bad.neverRan?.provenance.workflow, '.github/workflows/plates-morning.yml');
  }
  // Mutation: a card that skips the isocan home check publishes with no admitted identity.
  const loose = morning.replace(/ {10}if \[ -z "\$\{PLATES_CANVAS_ISOCAN_HOME:-\}" \][^\n]*\n[^\n]*\n {10}fi\n/, '');
  assert.notEqual(loose, morning);
  assert.ok((await cardStep(t, loose, { canvas: live, creds: false })).calls.some(c => c[1] === 'morning'), 'the guard above is what stops it');
});

/**
 * Every `needs.<job>.outputs.<name>` a workflow reads is one that job
 * exports (its `outputs:` block). GitHub reads an unexported output as an
 * empty string, so a job gated on it silently never runs (review of #151:
 * the card job read needs.decide.outputs.plan, which decide did not export).
 */
export function neededOutputProblems(text) {
  const out = [];
  const jobs = Object.fromEntries(jobsOf(text).map(j => [j.id, j.text]));
  const exported = id => new Set([...((/\n {4}outputs:\n((?: {6}(?:[\w-]+: |#).*\n)+)/.exec(jobs[id] ?? '')?.[1] ?? '').matchAll(/^ {6}([\w-]+):/gm))].map(m => m[1]));
  for (const [, job, name] of text.matchAll(/needs\.([\w-]+)\.outputs\.([\w-]+)/g)) {
    if (!jobs[job]) out.push(`needs.${job}.outputs.${name}: no job ${job}`);
    else if (!exported(job).has(name)) out.push(`needs.${job}.outputs.${name}: ${job} does not export ${name}`);
  }
  return [...new Set(out)];
}

test('every needs.<job>.outputs.<name> a shipped workflow reads is exported by that job (#151)', async () => {
  const all = await shipped(), rendered = await renderedWorkflows(all);
  for (const w of all) {
    assert.deepEqual(neededOutputProblems(w.template), [], w.name);
    if (rendered.has(w.path)) assert.deepEqual(neededOutputProblems(rendered.get(w.path)), [], `${w.name}, plates's rendered copy`);
  }
  const morning = all.find(w => w.name === 'plates-morning.yml').template;
  const dropped = morning.replace('      plan: ${{ steps.decide.outputs.plan }}\n', '');
  assert.notEqual(dropped, morning, 'the mutation applies');
  assert.deepEqual(neededOutputProblems(dropped), ['needs.decide.outputs.plan: decide does not export plan']);
});

test('plates-morning.yml is started only by the passes a project installs: plates-night alone without climb, all three with it', async () => {
  const practices = await load(), MORNING_WORKFLOW = '.github/workflows/plates-morning.yml';
  const base = { name: 'Acme', tagline: 'Acme builds anvils.', repo: 'acme/anvils', practice: '0.0.0' };
  const triggers = text => /^ {4}workflows: (\[[^\]]*\])$/m.exec(text)?.[1];
  const dir = await mkdtemp(join(tmpdir(), 'plates-morning-'));
  try {
    for (const [names, expected] of [
      [['base', 'agents-md', 'night'], '[plates-night]'],
      [['base', 'agents-md', 'night', 'climb'], '[plates-night, plates-climb, plates-robot]'],
    ]) {
      const entries = await plan(dir, { ...base, practices: names }, practices);
      const morning = entries.find(e => e.path === MORNING_WORKFLOW)?.content;
      assert.ok(morning, `${names.join(',')}: plates-morning.yml is rendered`);
      assert.equal(triggers(morning), expected, names.join(','));
      const installed = new Set(entries.filter(e => e.path.startsWith('.github/workflows/')).map(e => e.path.split('/').pop().replace(/\.yml$/, '')));
      for (const w of expected.slice(1, -1).split(', ')) assert.ok(installed.has(w), `${names.join(',')}: ${w} is a workflow the project installs`);
      assert.deepEqual(morningProblems(morning), [], `${names.join(',')}: still the morning's shape`);
      assert.deepEqual(neededOutputProblems(morning), [], `${names.join(',')}: every needs output exported`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  // plates's own copy (climb on) keeps all three.
  assert.equal(triggers(await readFile(join(PLATES, MORNING_WORKFLOW), 'utf8')), '[plates-night, plates-climb, plates-robot]');
});

test('phase 77: plates-morning.yml starts when a pass finishes and on a schedule, decides read-only, and only its send job writes issues; a failed send is red', async () => {
  const all = await shipped(), rendered = await renderedWorkflows(all);
  const w = all.find(w => w.name === 'plates-morning.yml');
  assert.equal(w.practice, 'night');
  assert.deepEqual(morningProblems(w.template), []);
  if (rendered.has(w.path)) assert.deepEqual(morningProblems(rendered.get(w.path)), [], 'plates\'s rendered copy');
  assert.deepEqual(permissionPath(w.template), [], 'Actions not allowed to open PRs is a notice; any other failure is red');
  assert.deepEqual(reachesBack(w.template), []);
  // The final PR is in the night's queue, on its own dated branch, and commits only the night's data.
  assert.match(w.template, /git push --force origin "HEAD:refs\/heads\/keel-night\/\$DAY-final"/);
  assert.match(w.template, /PATHS=\("docs\/night\/\$DAY\.json"\)\n\s+if \[ -f "\$HEALTH\/\$DAY\.md" \]; then PATHS\+=\("\$HEALTH\/\$DAY\.md"\); fi/);
  const t = w.template;
  for (const [why, changed, expected] of [
    ['no workflow_run trigger', t.replace(/ {2}workflow_run:\n {4}workflows: \[[^\]]*\]\n {4}types: \[completed\]\n/, ''), /not started by/],
    ['climb left out', t.replace('[plates-night, plates-climb, plates-robot]', '[plates-night, plates-robot]'), /not started by/],
    ['no schedule', t.replace(/ {2}schedule:\n(?: {4}#.*\n)* {4}- cron: "[^"]+"\n/, ''), /not started by/],
    ['no dispatch', t.replace('  workflow_dispatch: {}\n', ''), /not started by/],
    ['hourly', t.replace('cron: "7 17 * * *"', 'cron: "7 * * * *"'), /one daily cron shortly after 17:00 UTC/],
    ['before readyBy', t.replace('cron: "7 17 * * *"', 'cron: "7 16 * * *"'), /one daily cron shortly after 17:00 UTC/],
    ['a second cron', t.replace('    - cron: "7 17 * * *"\n', '    - cron: "7 17 * * *"\n    - cron: "7 21 * * *"\n'), /one daily cron shortly after 17:00 UTC/],
    ['decide writes issues', t.replace('      contents: read\n      issues: read\n', '      contents: read\n      issues: write\n'), /decide: only the send job may write issues/],
    ['finalize writes issues', t.replace('      contents: write\n      pull-requests: write\n', '      contents: write\n      pull-requests: write\n      issues: write\n'), /finalize: only the send job may write issues/],
    ['a write at the top', t.replace('permissions: {}', 'permissions:\n  issues: write'), /top level must grant nothing/],
    ['a swallowed send', t.replace('run: node scripts/plates/morning.mjs send --date "$DAY"', 'run: node scripts/plates/morning.mjs send --date "$DAY" || true'), /send: the send is its step's whole command/],
    ['send allowed to fail', t.replace('      - name: Send the brief\n', '      - name: Send the brief\n        continue-on-error: true\n'), /send: continue-on-error/],
    ['send before the night is over', t.replace("  send:\n    needs: decide\n    if: needs.decide.outputs.ready == 'true' && ", '  send:\n    needs: decide\n    if: '), /send: runs only when decide says the night is over/],
    ['send twice', t.replace(" && needs.decide.outputs.sent != 'true' && needs.decide.outputs.assignee", ' && needs.decide.outputs.assignee'), /send: runs only when decide says the night is over and unsent/],
    ['finalize gated on the brief', t.replace("  finalize:\n    needs: decide\n    if: needs.decide.outputs.ready == 'true'\n", "  finalize:\n    needs: decide\n    if: needs.decide.outputs.ready == 'true' && needs.decide.outputs.sent != 'true'\n"), /finalize: runs whenever the night is over, never gated/],
    ['finalize before the night is over', t.replace("  finalize:\n    needs: decide\n    if: needs.decide.outputs.ready == 'true'\n", '  finalize:\n    needs: decide\n'), /finalize: runs whenever the night is over/],
    ['finalize with no no-change check', t.replace(/\n\s+echo "Nothing changed: [^\n]*\n\s+exit 0/, ''),/finalize: a run with nothing new changes nothing/],
    ['a secret', t.replace('GH_TOKEN: ${{ github.token }}\n      DAY: ${{ needs.decide.outputs.day }}\n    steps', 'GH_TOKEN: ${{ secrets.MAIL_TOKEN }}\n      DAY: ${{ needs.decide.outputs.day }}\n    steps'), /no secret/],
    ['no timeout', t.replace(/(  send:\n(?:.*\n)*?) {4}timeout-minutes: \d+\n/, '$1'), /send: no timeout/],
    ['the card writes issues', t.replace('      contents: read\n      actions: read\n', '      contents: read\n      actions: read\n      issues: write\n'), /card: only the send job may write issues/],
    ['the card writes contents', t.replace('      contents: read\n      actions: read\n', '      contents: write\n      actions: read\n'), /card reads contents and actions/],
    ['the card for a night with no plan', t.replace("    if: needs.decide.outputs.plan == 'found' && ", '    if: '), /card: runs only for a night with a plan/],
  ]) {
    assert.notEqual(changed, t, `${why}: the mutation must apply`);
    const found = morningProblems(changed);
    assert.ok(found.some(p => expected.test(p)), `${why}: ${JSON.stringify(found)}`);
  }
});

/**
 * Run plates-morning's finalize step, as the workflow has it, in a synthetic
 * Acme clone of a bare origin: morning.mjs finalize and pr-body.mjs are stubs
 * (finalize writes `final` as the night's record), gh logs its calls and
 * lists no open PR. `main` and `own` are the record on the default branch and
 * on keel-night/<day>-final (null: no such branch). Returns { status, out, gh, ref }.
 */
async function finalizeStep(t, { main, own, final }) {
  const morning = await readFile(join(PLATES, 'practices/night/files/.github/workflows/plates-morning.yml'), 'utf8');
  const step = runBlocks(morning).find(b => b.step === 'Open the night\'s final pull request');
  assert.ok(step, 'the finalize job has its step');
  const base = await mkdtemp(join(tmpdir(), 'plates-wf-final-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const day = '2026-10-15', origin = join(base, 'origin.git'), seed = join(base, 'seed'), dir = join(base, 'acme'), bin = join(base, 'bin'), temp = join(base, 'tmp'), log = join(base, 'gh.jsonl');
  for (const d of [bin, temp, join(seed, 'docs/night'), join(seed, 'scripts/plates'), join(seed, '.plates')]) await mkdir(d, { recursive: true });
  const git = (cwd, args) => { const r = run('git', args, { cwd }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout; };
  git(base, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(seed, ['init', '-q', '-b', 'main']);
  await writeFile(join(seed, '.plates/plates.json'), JSON.stringify({ name: 'Acme' }));
  await writeFile(join(seed, 'scripts/plates/lib.mjs'), 'export const healthDirIn = () => "docs/health";\n');
  await writeFile(join(seed, 'scripts/plates/morning.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync('docs/night/${day}.json', process.env.FINAL);\nwriteFileSync(process.argv.at(-1), '{}');\n`);
  await writeFile(join(seed, 'scripts/plates/pr-body.mjs'), 'console.log("The night as it finished.");\n');
  await writeFile(join(seed, `docs/night/${day}.json`), main);
  git(seed, ['add', '-A']);
  git(seed, ['commit', '-q', '-m', 'Acme']);
  git(seed, ['push', '-q', origin, 'HEAD:refs/heads/main']);
  if (own !== null) {
    await writeFile(join(seed, `docs/night/${day}.json`), own);
    git(seed, ['commit', '-q', '--allow-empty', '-am', 'plates night: as it finished']);
    git(seed, ['push', '-q', origin, `HEAD:refs/heads/keel-night/${day}-final`]);
  }
  git(base, ['clone', '-q', origin, dir]);
  await writeFile(join(bin, 'gh'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`, { mode: 0o755 });
  const r = run('bash', ['-e', '-c', step.script], { cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, DAY: day, BASE: 'main', FINAL: final } });
  const gh = (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { status: r.status, out: r.stdout + r.stderr, gh, ref: name => run('git', ['rev-parse', '--verify', '-q', name], { cwd: origin }).stdout.trim() };
}

// plates#149: a PR create that failed after the push is retried by the next run, though nothing changed since.
test('plates-morning\'s finalize opens the PR for its own pushed branch when nothing changed since; with nothing new anywhere it asks nothing of GitHub', async t => {
  const created = gh => gh.filter(a => a[0] === 'pr' && a[1] === 'create').map(a => a[a.indexOf('--head') + 1]);
  // An earlier run pushed keel-night/<d>-final and its PR create failed: this run, unchanged, opens it.
  const retry = await finalizeStep(t, { main: '{"old":true}\n', own: '{"final":true}\n', final: '{"final":true}\n' });
  assert.equal(retry.status, 0, retry.out);
  assert.deepEqual(created(retry.gh), ['keel-night/2026-10-15-final'], retry.out);
  assert.match(retry.out, /making sure its PR is open/);
  // Its branch already holds what main holds (merged): nothing to open.
  const merged = await finalizeStep(t, { main: '{"final":true}\n', own: '{"final":true}\n', final: '{"final":true}\n' });
  assert.equal(merged.status, 0, merged.out);
  assert.deepEqual(merged.gh, [], merged.out);
  // No branch of its own and main already final: nothing changes, nothing is asked of GitHub.
  const none = await finalizeStep(t, { main: '{"final":true}\n', own: null, final: '{"final":true}\n' });
  assert.equal(none.status, 0, none.out);
  assert.deepEqual(none.gh, [], none.out);
  assert.match(none.out, /Nothing changed: the night's archive already holds its final outcomes/);
  // Something new: committed, pushed and its PR opened, as before.
  const fresh = await finalizeStep(t, { main: '{"old":true}\n', own: null, final: '{"final":true}\n' });
  assert.equal(fresh.status, 0, fresh.out);
  assert.deepEqual(created(fresh.gh), ['keel-night/2026-10-15-final'], fresh.out);
  assert.notEqual(fresh.ref('refs/heads/keel-night/2026-10-15-final'), '', 'pushed');
});

// ---- phase 80: the publisher, and the concurrency rule --------------------------------------

/** A workflow_run event of the gate workflow finishing, as plates-publish.yml's expressions read it. */
const gateRun = ({ conclusion = 'success', event = 'push', branch = 'main', id = 301 } = {}) =>
  ({ github: { event_name: 'workflow_run', ref: 'refs/heads/main', run_id: id, repository: ACME, event: { repository: { full_name: ACME, default_branch: 'main' }, workflow_run: { conclusion, event, head_branch: branch, head_sha: 'a'.repeat(40) } } } });
const dispatch = ({ ref = 'refs/heads/main', id = 401 } = {}) => ({ github: { event_name: 'workflow_dispatch', ref, run_id: id, repository: ACME, event: { repository: { full_name: ACME, default_branch: 'main' } } } });

/** One job of a workflow's text: from `  <name>:` to the next job at that indent. */
const jobOf = (text, name) => {
  const m = new RegExp(`\\n {2}${name}:\\n((?: {4}.*\\n|\\s*\\n)+)`).exec(text);
  assert.ok(m, `no job ${name}`);
  return m[1];
};

/**
 * The publisher's own rules, on its text: [string]. It starts on the gate
 * workflow completing on main, and by hand; one fixed group, never cancelled;
 * nothing granted by default; the choose job only reads; only the advance job
 * writes contents, and it calls no API (no GH_TOKEN) and pushes nothing in
 * YAML (publish.mjs's lease does); values reach shell through env, never
 * interpolated into a run line.
 */
export function publishProblems(text) {
  const out = [];
  if (!/^ {2}workflow_run:\n {4}workflows: \[[^\]\n]+\]\n {4}types: \[completed\]\n {4}branches: \[main\]\n/m.test(text)) out.push('not started by the gate workflow completing on main');
  if (!/^ {2}workflow_dispatch:/m.test(text)) out.push('cannot be run by hand');
  if (/^ {2}(push|pull_request|pull_request_target|schedule):/m.test(text)) out.push('started by something other than the gate finishing');
  const blocks = concurrencyOf(text);
  if (blocks.length !== 1 || blocks[0].level !== 'workflow') out.push('not exactly one workflow-level concurrency group');
  out.push(...concurrencyProblems(PUBLISH_WORKFLOW, text, 'publish'));
  if (!/^permissions: \{\}$/m.test(text)) out.push('grants permissions by default');
  const choose = jobOf(text, 'choose'), advance = jobOf(text, 'advance');
  if (!/ {4}permissions:\n {6}contents: read\n {6}actions: read\n(?! {6})/.test(choose)) out.push('choose holds more than contents: read and actions: read');
  if (!/ {4}permissions:\n {6}contents: write\n(?! {6})/.test(advance)) out.push('advance holds more than contents: write');
  if ((text.match(/: write\b/g) ?? []).length !== 1) out.push('a write permission outside the advance job');
  if (!/ {4}needs: choose\n/.test(advance)) out.push('advance does not wait for choose');
  if (/GH_TOKEN|secrets\./.test(advance)) out.push('advance holds an API token');
  if (!/run: node scripts\/plates\/publish\.mjs --plan --trigger "\$TRIGGER"\n/.test(choose)) out.push('choose does not run publish.mjs --plan');
  if (!/run: node scripts\/plates\/publish\.mjs --advance --from "\$FROM" --to "\$TO"\n/.test(advance)) out.push('advance does not run publish.mjs --advance from the plan');
  for (const { line, n } of code(text)) {
    if (/\bgit push\b/.test(line)) out.push(`line ${n}: pushes in YAML; publish.mjs moves the ref, with a lease`);
    if (/^\s+run:.*\$\{\{/.test(line)) out.push(`line ${n}: an expression interpolated into a run line`);
  }
  return out;
}

test('phase 80: plates-publish.yml runs only after a successful gate on main (or by hand on main), queued in one group and never cancelled; a run that will not publish never displaces one', async () => {
  const w = (await shipped()).find(x => x.name === 'plates-publish.yml');
  assert.equal(w.practice, 'delivery');
  assert.equal(w.optional, true);
  const t = w.template;
  assert.deepEqual(publishProblems(t), []);
  const group = ctx => crossReviewGroup(t, ctx);
  const cond = jobIf(t);
  const runs = ctx => evalExpression(cond, ctx);
  assert.equal(runs(gateRun()), true, 'the gate succeeded on a push to main');
  assert.equal(group(gateRun()), 'publish');
  assert.equal(runs(dispatch()), true, 'by hand on main');
  assert.equal(group(dispatch()), 'publish');
  for (const [why, ctx] of [
    ['the gate failed', gateRun({ conclusion: 'failure' })],
    ['the gate was cancelled', gateRun({ conclusion: 'cancelled' })],
    ['a pull request\'s gate', gateRun({ event: 'pull_request' })],
    ['a push to another branch', gateRun({ branch: 'acme-feature' })],
    ['by hand on another branch', dispatch({ ref: 'refs/heads/acme-feature' })],
  ]) assert.equal(runs(ctx), false, why);
  // GitHub keeps one pending run per group: a run that will not publish has a group of its own.
  assert.equal(group(gateRun({ conclusion: 'failure', id: 302 })), 'publish-skip-302');
  assert.equal(group(gateRun({ event: 'pull_request', id: 303 })), 'publish-skip-303');
  assert.notEqual(group(gateRun({ conclusion: 'failure', id: 304 })), group(gateRun({ conclusion: 'failure', id: 305 })));
  // #179: the group is `publish` on exactly the choose job's condition, so a dispatch from a feature branch never replaces a pending publisher.
  assert.equal(group(dispatch({ ref: 'refs/heads/acme-feature', id: 306 })), 'publish-skip-306', 'by hand on another branch');
  assert.equal(group(gateRun({ branch: 'acme-feature', id: 307 })), 'publish-skip-307', 'a push to another branch');
  for (const ctx of [gateRun(), dispatch(), gateRun({ conclusion: 'failure' }), gateRun({ event: 'pull_request' }), gateRun({ branch: 'acme-feature' }), dispatch({ ref: 'refs/heads/acme-feature' })]) {
    assert.equal(group(ctx) === 'publish', runs(ctx), `${JSON.stringify(ctx.github.event_name)} ${ctx.github.ref}: joins publish only when choose runs`);
  }
  // The advance job runs only on a plan that moves the ref.
  assert.match(jobOf(t, 'advance'), / {4}if: needs\.choose\.outputs\.action == 'advance' \|\| needs\.choose\.outputs\.action == 'create'\n/);
  // Mutations: each rule fails when broken.
  for (const [why, from, to, pattern] of [
    ['cancellable', 'cancel-in-progress: false', 'cancel-in-progress: true', /deploy can be cancelled/],
    ['a per-commit group', "'publish' || format", "github.sha || format", /not fixed/],
    ['a push trigger', '  workflow_dispatch: {}\n', '  workflow_dispatch: {}\n  push:\n    branches: [main]\n', /other than the gate/],
    ['choose writes', '      contents: read\n      actions: read\n', '      contents: write\n      actions: read\n', /choose holds more|write permission outside/],
    ['advance reads Actions', '      contents: write\n', '      contents: write\n      actions: read\n', /advance holds more/],
    ['advance holds a token', '          FROM: ${{ needs.choose.outputs.from }}\n', '          GH_TOKEN: ${{ github.token }}\n          FROM: ${{ needs.choose.outputs.from }}\n', /API token/],
    ['a YAML push', '        run: node scripts/plates/publish.mjs --advance --from "$FROM" --to "$TO"\n', '        run: git push origin "$TO:refs/heads/green"\n', /pushes in YAML|does not run publish\.mjs --advance/],
    ['an interpolated sha', '--to "$TO"', '--to "${{ needs.choose.outputs.to }}"', /interpolated/],
    ['granted by default', 'permissions: {}\n', 'permissions:\n  contents: write\n', /grants permissions by default|write permission outside/],
  ]) {
    const mutated = t.replace(from, to);
    assert.notEqual(mutated, t, `${why}: the mutation did not apply`);
    assert.ok(publishProblems(mutated).some(p => pattern.test(p)), `${why}: ${JSON.stringify(publishProblems(mutated))}`);
  }
});

test('phase 80: plates-publish.yml names the gate workflow as GitHub does: the template for check, the project\'s name otherwise', async t => {
  const w = (await shipped()).find(x => x.name === 'plates-publish.yml');
  const facts = gateName => Object.defineProperty({ practices: ['delivery'] }, PROJECT, { value: { workspaces: [], ...(gateName ? { gateName } : {}) } });
  assert.equal(shapePublish(w.template, facts(null)), w.template);
  assert.equal(shapePublish(w.template, facts('check')), w.template);
  assert.match(shapePublish(w.template, facts('Acme tests')), /\n {4}workflows: \["Acme tests"\]\n/);
  assert.throws(() => shapePublish(w.template.replace('workflows: [check]', 'workflows: [x]'), facts('test')), /not the template's/);
  // The name, read from the project: "delivery".gateWorkflow's file's name:, else the gate workflow's.
  const root = await mkdtemp(join(tmpdir(), 'plates-publish-name-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.github/workflows'), { recursive: true });
  await writeFile(join(root, '.github/workflows/check.yml'), 'name: check\non: push\n');
  await writeFile(join(root, '.github/workflows/test.yml'), "name: 'Acme suite'\non: push\n");
  await writeFile(join(root, '.github/workflows/bare.yml'), 'on: push\n');
  assert.equal(await gateNameIn(root, { practices: ['night'] }), null, 'only with delivery on');
  assert.equal(await gateNameIn(root, { practices: ['delivery'] }), 'check', 'check.yml, the default gate');
  assert.equal(await gateNameIn(root, { practices: ['delivery'], ci: { gateWorkflow: 'test.yml' } }), 'Acme suite');
  assert.equal(await gateNameIn(root, { practices: ['delivery'], ci: { gateWorkflow: 'check.yml' }, delivery: { gateWorkflow: 'test.yml' } }), 'Acme suite', '"delivery".gateWorkflow first');
  assert.equal(await gateNameIn(root, { practices: ['delivery'], delivery: { gateWorkflow: 'bare.yml' } }), '.github/workflows/bare.yml', 'no name: GitHub names it by its path');
  assert.equal(await gateNameIn(root, { practices: ['delivery'], delivery: { gateWorkflow: 'Acme CI' } }), 'Acme CI', 'a name is the name');
});

test('phase 80: the concurrency rule: test workflows cancel the superseded per ref; publish and deploy workflows are one fixed group, never cancelled; every workflow plates ships and plates\'s own keep it', async () => {
  // Which workflow is which, read from its file and name.
  assert.equal(workflowKind('.github/workflows/check.yml', 'name: check\n'), 'test');
  assert.equal(workflowKind('.github/workflows/test.yml', 'name: test\n'), 'test');
  assert.equal(workflowKind('.github/workflows/pages.yml', 'name: pages\n', { gate: 'pages.yml' }), 'test', 'the gate workflow, whatever its name');
  assert.equal(workflowKind('.github/workflows/deploy.yml', 'name: deploy\n'), 'publish');
  assert.equal(workflowKind('.github/workflows/release.yml', 'name: release\n', { gate: 'release.yml' }), 'publish', 'a gate that also publishes is held as a publisher: a deploy is never cancelled');
  assert.equal(workflowKind('.github/workflows/plates-publish.yml', 'name: plates-publish\n'), 'publish');
  assert.equal(workflowKind('.github/workflows/plates-night.yml', 'name: plates-night\n'), null);
  // The rule on synthetic Acme workflows: each break is named, with the file and line.
  const testWf = (group, cancel) => `name: test\non: push\nconcurrency:\n  group: ${group}\n${cancel === undefined ? '' : `  cancel-in-progress: ${cancel}\n`}jobs:\n  t:\n    runs-on: ubuntu-latest\n`;
  const deploy = (group, cancel) => `name: deploy\non: push\njobs:\n  d:\n    runs-on: ubuntu-latest\n    concurrency:\n      group: ${group}\n${cancel === undefined ? '' : `      cancel-in-progress: ${cancel}\n`}`;
  assert.deepEqual(concurrencyProblems('test.yml', testWf('test-${{ github.ref }}', true), 'test'), []);
  assert.match(concurrencyProblems('test.yml', testWf('test-${{ github.ref }}', false), 'test').join('\n'), /^test\.yml \(line 3\): a test workflow's cancel-in-progress is false: a superseded test run keeps running/);
  assert.match(concurrencyProblems('test.yml', testWf('test-${{ github.ref }}'), 'test').join('\n'), /cancel-in-progress is not set/);
  assert.match(concurrencyProblems('test.yml', testWf('test', true), 'test').join('\n'), /is not per ref/);
  assert.match(concurrencyProblems('test.yml', 'name: test\non: push\n', 'test').join('\n'), /^test\.yml: a test workflow with no concurrency group/);
  assert.deepEqual(concurrencyProblems('deploy.yml', deploy('deploy', false), 'publish'), []);
  assert.deepEqual(concurrencyProblems('deploy.yml', deploy('deploy'), 'publish'), [], 'unset is GitHub\'s default, false');
  assert.deepEqual(concurrencyProblems('deploy.yml', 'name: deploy\nconcurrency: production\n', 'publish'), [], 'the one-line form');
  assert.match(concurrencyProblems('deploy.yml', deploy('deploy', true), 'publish').join('\n'), /^deploy\.yml \(line 6\): a publish or deploy workflow's cancel-in-progress is true: a deploy can be cancelled midway/);
  assert.match(concurrencyProblems('deploy.yml', deploy('deploy-${{ github.ref }}', false), 'publish').join('\n'), /is not fixed/);
  assert.match(concurrencyProblems('deploy.yml', deploy('deploy-${{ github.sha }}', false), 'publish').join('\n'), /is not fixed/);
  assert.match(concurrencyProblems('deploy.yml', 'name: deploy\non: push\n', 'publish').join('\n'), /no concurrency group: two can run at once/);
  assert.deepEqual(concurrencyProblems('x.yml', '', null), [], 'a workflow the rule does not name is not checked');
  // Every workflow plates ships, and plates's own, keep it.
  const all = await shipped(), rendered = await renderedWorkflows(all);
  for (const w of all) assert.deepEqual(concurrencyProblems(w.path, w.template, workflowKind(w.path, w.template, { gate: 'check.yml' })), [], w.path);
  for (const n of (await readdir(join(PLATES, '.github/workflows'))).filter(n => /\.ya?ml$/.test(n))) {
    const path = `.github/workflows/${n}`, text = rendered.get(path) ?? await readFile(join(PLATES, path), 'utf8');
    assert.deepEqual(concurrencyProblems(path, text, workflowKind(path, text, { gate: 'check.yml' })), [], `plates's ${path}`);
  }
  assert.equal(workflowKind('.github/workflows/check.yml', all.find(w => w.name === 'check.yml').template), 'test', 'check.yml is held as a test workflow');
});

// PR #178 review: `concurrency: { group: production, cancel-in-progress: true }` was read as a group named the
// whole mapping, losing cancel-in-progress: a cancellable deploy passed, and a valid inline test config was flagged.
test('phase 80: the concurrency rule reads a flow mapping and quoted values, and names a form it cannot read', () => {
  const wf = (name, concurrency, indent = '') => `name: ${name}\non: push\n${indent ? 'jobs:\n  j:\n    runs-on: ubuntu-latest\n' : ''}${indent}concurrency: ${concurrency}\n`;
  assert.deepEqual(concurrencyOf(wf('deploy', '{ group: production, cancel-in-progress: true }')).map(b => [b.group, b.cancel]), [['production', true]]);
  assert.match(concurrencyProblems('deploy.yml', wf('deploy', '{ group: production, cancel-in-progress: true }'), 'publish').join('\n'), /deploy can be cancelled midway/, 'a cancellable deploy, inline');
  assert.match(concurrencyProblems('deploy.yml', wf('deploy', '{group: "deploy-${{ github.ref }}"}', '    '), 'publish').join('\n'), /is not fixed/, 'a per-ref deploy group, inline and quoted, in a job');
  assert.deepEqual(concurrencyProblems('deploy.yml', wf('deploy', "{ group: 'production', cancel-in-progress: false }"), 'publish'), []);
  assert.deepEqual(concurrencyProblems('test.yml', wf('test', '{ group: "test-${{ github.ref }}", cancel-in-progress: true }'), 'test'), [], 'a valid inline test config');
  assert.deepEqual(concurrencyProblems('test.yml', wf('test', "{ group: \"${{ format('test-{0}', github.ref) }}\", cancel-in-progress: true } # per ref"), 'test'), [], 'a comma inside an expression, and a comment');
  assert.deepEqual(concurrencyOf('concurrency:\n  group: "deploy #1"\n  cancel-in-progress: false\n').map(b => [b.group, b.cancel]), [['deploy #1', false]], 'a quoted value keeps its #');
  assert.deepEqual(concurrencyOf("concurrency: 'production' # one at a time\n").map(b => [b.group, b.cancel]), [['production', undefined]]);
  // A form the reader cannot read is named, never guessed at.
  for (const [why, value] of [['an unclosed mapping', '{ group: production'], ['an unknown key', '{ group: production, cancel: true }'], ['an anchor', '&c { group: production }'], ['a block scalar', '|']]) {
    const found = concurrencyProblems('deploy.yml', wf('deploy', value), 'publish');
    assert.ok(found.some(p => /cannot read this concurrency/.test(p)), `${why}: ${JSON.stringify(found)}`);
  }
});

// #179 (PR #178 review, round two): a run-specific deploy group passed as fixed, and one compliant job covered a whole test workflow.
test('#179: a publish group naming the run is not fixed, one plates cannot establish is named, and only a workflow-level block covers every job of a test workflow', () => {
  const deploy = group => `name: deploy\non: push\nconcurrency:\n  group: ${group}\n  cancel-in-progress: false\n`;
  for (const g of ['deploy-${{ github.run_id }}', 'deploy-${{ github.run_number }}', "${{ format('deploy-{0}', github.run_attempt) }}", 'deploy-${{ github.sha }}']) {
    assert.match(concurrencyProblems('deploy.yml', deploy(g), 'publish').join('\n'), /is not fixed: it names the (run|commit)/, g);
  }
  assert.match(concurrencyProblems('deploy.yml', deploy('deploy-${{ inputs.environment }}'), 'publish').join('\n'), /cannot establish .* is fixed \(it reads inputs\.environment\)/);
  for (const g of ['production', 'deploy-${{ github.workflow }}', '${{ github.repository }}-deploy', 'deploy-${{ vars.ACME_STAGE }}']) {
    assert.deepEqual(concurrencyProblems('deploy.yml', deploy(g), 'publish'), [], g);
  }
  // A test workflow: one compliant job no longer covers a job with none.
  const unit = '  unit:\n    runs-on: ubuntu-latest\n    concurrency:\n      group: unit-${{ github.ref }}\n      cancel-in-progress: true\n    steps:\n      - run: npm test\n';
  const integration = '  integration:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run test:integration\n';
  const twoJobs = `name: test\non: push\njobs:\n${unit}${integration}`;
  const found = concurrencyProblems('test.yml', twoJobs, 'test');
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0], /^test\.yml \(line 11\): a test workflow's job integration has no concurrency of its own/);
  const bothJobs = `name: test\non: push\njobs:\n${unit}${unit.replace(/unit/g, 'integration')}`;
  assert.deepEqual(concurrencyProblems('test.yml', bothJobs, 'test'), [], 'every job cancels the superseded');
  const covered = `name: test\non: push\nconcurrency:\n  group: test-\${{ github.ref }}\n  cancel-in-progress: true\njobs:\n${unit}${integration}`;
  assert.deepEqual(concurrencyProblems('test.yml', covered, 'test'), [], 'a workflow-level block covers every job');
  const badJob = `name: test\non: push\njobs:\n${unit}${unit.replace(/unit/g, 'integration').replace('cancel-in-progress: true', 'cancel-in-progress: false')}`;
  assert.match(concurrencyProblems('test.yml', badJob, 'test').join('\n'), /job integration: cancel-in-progress is false/);
});

// PR #182 review: `${{ github.run_attempt == 1 && 'deploy' || format('deploy-{0}', github.run_id) }}` on an unconditional
// deploy job passed as fixed, though a retry gets its own group and deploys beside the first.
test('PR #182: a conditional publish group is fixed only when every job it covers runs on its condition alone', () => {
  const group = "${{ github.run_attempt == 1 && 'deploy' || format('deploy-{0}', github.run_id) }}";
  const wf = jobs => `name: deploy\non: push\nconcurrency:\n  group: ${group}\n  cancel-in-progress: false\njobs:\n${jobs}`;
  const job = (name, extra = '') => `  ${name}:\n    runs-on: ubuntu-latest\n${extra}    steps:\n      - run: ./deploy.sh\n`;
  const problems = text => concurrencyProblems('deploy.yml', text, 'publish');
  assert.match(problems(wf(job('deploy'))).join('\n'), /cannot establish .* is fixed: runs outside "github\.run_attempt == 1" get another group, and no job's if: keeps them from publishing/, 'an unconditional deploy job');
  assert.match(problems(`name: deploy\non: push\nconcurrency:\n  group: ${group}\n`).join('\n'), /cannot establish/, 'no jobs to read');
  assert.match(problems(wf(job('deploy', "    if: github.event_name == 'push'\n"))).join('\n'), /cannot establish/, 'another condition');
  assert.deepEqual(problems(wf(job('deploy', '    if: ${{ (github.run_attempt == 1) }}\n'))), [], 'the job runs on the condition alone');
  assert.deepEqual(problems(wf(job('plan', '    if: github.run_attempt == 1\n') + job('ship', '    needs: [plan]\n'))), [], 'a job needing one that runs on it is skipped with it');
  assert.match(problems(wf(job('plan', '    if: github.run_attempt == 1\n') + job('ship', '    needs: plan\n    if: always()\n'))).join('\n'), /cannot establish/, 'always() runs it anyway');
  assert.match(problems(wf(job('plan', '    if: github.run_attempt == 1\n') + job('other'))).join('\n'), /cannot establish/, 'every job, not one');
  // A job-level group: that job's own if:.
  const jobLevel = extra => `name: deploy\non: push\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n${extra}    concurrency:\n      group: ${group}\n    steps:\n      - run: ./deploy.sh\n`;
  assert.match(problems(jobLevel('')).join('\n'), /cannot establish/);
  assert.deepEqual(problems(jobLevel('    if: github.run_attempt == 1\n')), []);
});


test('production credentials are conditional on validated enabled Vercel config and scoped to collection', async () => {
  const text = await readFile(join(PLATES,'practices/night/files/.github/workflows/plates-night.yml'),'utf8');
  assert.deepEqual(productionSecretProblems(text),[]);
  for (const changed of [
    text.replace("steps.config.outputs.production_vercel == 'true' && secrets.VERCEL_API_TOKEN || ''", 'secrets.VERCEL_API_TOKEN'),
    text.replace('        run: node scripts/plates/production-night.mjs', '        run: echo "$VERCEL_TOKEN"'),
    text.replace('      - name: Install', '      - name: Install\n        env:\n          VERCEL_TOKEN: ${{ secrets.VERCEL_API_TOKEN }}'),
  ]) assert.ok(productionSecretProblems(changed).length);
  const dir = await mkdtemp(join(tmpdir(),'plates-production-config-'));
  try {
    await mkdir(join(dir,'.plates'));
    await cp(join(PLATES,'practices/night/files/scripts'),join(dir,'scripts'),{recursive:true});
    const script = runBlocks(text).find(s=>s.step==='Read the config').script;
    const source = {id:'acme',provider:'vercel',service:'acme',environment:'production',project:'prj_acme',scope:'team_acme',windowMinutes:60,maxEvents:100,maxBytes:10000,timeoutMs:5000,threshold:2};
    for (const [production, expected] of [[undefined,false],[{version:1,enabled:false},false],[{version:1,enabled:true,sources:[source]},true],[{version:1,enabled:true,sources:[{...source,provider:'gcp',region:'us-west1'}]},false]]) {
      await writeFile(join(dir,'.plates/plates.json'),JSON.stringify({production}));
      await writeFile(join(dir,'output'),'');
      const result = run('bash',['-e','-c',script],{cwd:dir,env:{...process.env,GITHUB_OUTPUT:join(dir,'output'),GITHUB_ENV:join(dir,'env')}});
      assert.equal(result.status,0,result.stderr);
      assert.match(await readFile(join(dir,'output'),'utf8'),new RegExp(`^production_vercel=${expected}$`,'m'));
    }
    await writeFile(join(dir,'.plates/plates.json'),JSON.stringify({production:{version:1,enabled:true,sources:[{...source,maxEvents:0}]}}));
    assert.notEqual(run('bash',['-e','-c',script],{cwd:dir,env:{...process.env,GITHUB_OUTPUT:join(dir,'output'),GITHUB_ENV:join(dir,'env')}}).status,0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('morning restoration failure still attempts the brief and fails the final verdict', async () => {
  const text = await readFile(join(PLATES,'practices/night/files/.github/workflows/plates-morning.yml'),'utf8');
  assert.deepEqual(productionMorningProblems(text),[]);
  for (const changed of [text.replace('--restore-only || code=$?', '--restore-only || true'), text.replace('if: always()\n        env:\n          RESTORE_CODE', 'if: success()\n        env:\n          RESTORE_CODE'), text.replace('RESTORE_CODE:-missing','RESTORE_CODE:-0')]) assert.ok(productionMorningProblems(changed).length);
  assert.ok(morningProblems(text.replace('        id: production_restore','        id: production_restore\n        continue-on-error: true')).length);
  assert.ok(morningProblems(text.replace('      actions: read','      actions: write')).length);
  const blocks = runBlocks(text), dir = await mkdtemp(join(tmpdir(),'plates-production-verdict-'));
  const restore = blocks.find(s=>s.step==='Restore production observations for the brief').script;
  const send = blocks.find(s=>s.step==='Send the brief').script;
  const verdict = blocks.find(s=>s.step==='Production restoration verdict').script;
  try {
    const script = `node() { if [ "$2" = "--restore-only" ]; then return 7; else echo brief-attempted; fi; }\n${restore}\n${send}\nRESTORE_CODE=$(sed -n 's/^code=//p' "$GITHUB_OUTPUT")\n${verdict}`;
    const result = run('bash',['-e','-c',script],{cwd:dir,env:{...process.env,GITHUB_OUTPUT:join(dir,'output'),DAY:'2026-01-01'}});
    assert.equal(result.status,1,result.stderr); assert.match(result.stdout,/brief-attempted/);
    assert.equal((await readFile(join(dir,'output'),'utf8')).trim(),'code=7');
    for (const [value,status] of [['',1],['0',0],['7',1]]) assert.equal(run('bash',['-e','-c',verdict],{cwd:dir,env:{...process.env,RESTORE_CODE:value}}).status,status);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

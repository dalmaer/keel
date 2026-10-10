// Agents are providers (keel phase 45): which agent runs each pass, the
// adapter each provider is, and the rules that hold for both. The config is
// .keel/keel.json "agents" and an "agent" on crossReview, climb and tend; the
// adapters are lib.mjs AGENTS. Synthetic Acme fixtures; no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { load } from '../lib/practices.mjs';
import { AGENTS, AGENT_PASSES, DEFAULT_AGENT, agentOf, agentsProblems, passAgentProblems, codexVerdict, stepUse, BUDGET_STEPS, authorOf, reviewerOf, crossReviewerProblems, prefixAuthors, agentGitArgs, gateEnv, AGENT_GIT_DIR, coAuthorsOf, commitAuthorOf, pushAuthorsOf, pushReviewerOf } from '../practices/night/files/scripts/keel/lib.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NIGHT = join(KEEL, 'practices/night/files/scripts/keel');
const CROSS = join(KEEL, 'practices/cross-review/files');
const CLIMB = join(KEEL, 'practices/climb/files');
const WORKFLOW = { crossReview: 'keel-cross-review.yml', climb: 'keel-climb.yml', tend: 'keel-tend.yml' };
// crossReview's prefix here is no provider's branch, so its "agent" decides (the fallback); per-PR choice is tested below.
const ON = { crossReview: { for: ['acme/'] }, climb: { jobs: ['test-time'] }, tend: {} };

/** The three scripts as a project has them: in scripts/keel beside the night's lib.mjs. */
let loaded = null;
const scripts = () => loaded ??= (async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-agents-scripts-'));
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  const keel = join(dir, 'scripts/keel');
  await mkdir(keel, { recursive: true });
  for (const f of ['lib.mjs', 'test-ledger.mjs', 'pr-body.mjs']) await cp(join(NIGHT, f), join(keel, f));
  await cp(join(CROSS, 'scripts/keel/cross-review.mjs'), join(keel, 'cross-review.mjs'));
  for (const f of ['climb.mjs', 'tend.mjs']) await cp(join(CLIMB, 'scripts/keel', f), join(keel, f));
  const at = f => import(pathToFileURL(join(keel, f)).href);
  return { cross: await at('cross-review.mjs'), climb: await at('climb.mjs'), tend: await at('tend.mjs') };
})();

/** Each shipped workflow by its pass: { practice, path, text, declared }. */
async function workflows() {
  const out = {};
  for (const p of (await load()).values()) for (const f of p.files) {
    const pass = Object.keys(WORKFLOW).find(k => f.path === `.github/workflows/${WORKFLOW[k]}`);
    if (pass) out[pass] = { practice: p.name, path: f.path, text: f.template, declared: p.secrets.filter(s => s.workflow === f.path).map(s => s.name) };
  }
  return out;
}

/** A workflow's steps, each its text from `      - ` to the next step (the agent jobs' indent). */
const steps = text => text.split(/\n(?= {6}- )/).filter(s => /^ {6}- /.test(s)).map(s => s.replace(/(\n\s*(#.*)?)+$/, ''));
/** The steps that use a provider's action. */
const agentSteps = (text, provider) => steps(text).filter(s => s.includes(`uses: ${AGENTS[provider].action}@`));
/** A step's one-line `key: value` pairs under `with:`. */
const withOf = step => Object.fromEntries((/\n {8}with:\n((?: {10}.*\n?)+)/.exec(`${step}\n`)?.[1] ?? '').split('\n').map(l => /^ {10}([\w-]+):\s*(.*)$/.exec(l)).filter(Boolean).map(([, k, v]) => [k, v]));

// ---- config ------------------------------------------------------------------

test('config: an agent not listed in "agents", an unknown provider and a malformed "agents" are errors; no agent means claude', async () => {
  assert.equal(DEFAULT_AGENT, 'claude');
  assert.deepEqual([...AGENT_PASSES], ['crossReview', 'climb', 'tend']);
  for (const key of AGENT_PASSES) {
    // No "agents", no "agent": claude, as before phase 45.
    assert.equal(agentOf({ [key]: ON[key] }, key), 'claude');
    assert.equal(agentOf({}, key), 'claude');
    assert.deepEqual(passAgentProblems({ [key]: ON[key] }, key), [], key);
    assert.deepEqual(passAgentProblems({ [key]: { ...ON[key], agent: 'claude' } }, key), [], `${key}: claude named, no "agents"`);
    assert.deepEqual(passAgentProblems({ agents: { claude: {}, codex: {} }, [key]: ON[key] }, key), [], `${key}: both listed, the default`);
    assert.deepEqual(passAgentProblems({}, key), [], `${key} off`);
    const bad = [
      [{ [key]: { ...ON[key], agent: 'codex' } }, new RegExp(`"${key}"\\.agent is codex, which "agents" does not list \\(claude\\)`)],
      [{ agents: { codex: {} }, [key]: ON[key] }, key === 'crossReview' ? /"crossReview" reviews acme\/ with claude \(the default: no provider's branch names them\), which "agents" does not list \(codex\)/ : new RegExp(`"${key}" runs claude \\(no "agent" names another\\), which "agents" does not list \\(codex\\)`)],
      [{ agents: { claude: {} }, [key]: { ...ON[key], agent: 'gemini' } }, new RegExp(`"${key}"\\.agent must be one of claude, codex \\(got "gemini"\\)`)],
      [{ [key]: { ...ON[key], agent: 7 } }, /agent must be one of claude, codex \(got 7\)/],
      [{ agents: { claude: {}, gemini: {} }, [key]: ON[key] }, /"agents" names an unknown provider "gemini" \(known: claude, codex\)/],
      [{ agents: ['claude'], [key]: ON[key] }, /"agents" must name the providers/],
      [{ agents: {}, [key]: ON[key] }, /"agents" must name the providers/],
      [{ agents: 'codex', [key]: ON[key] }, /"agents" must name the providers/],
      [{ agents: { codex: { model: 'acme-1' } }, [key]: { ...ON[key], agent: 'codex' } }, /"agents"\.codex must be \{\}/],
    ];
    for (const [config, message] of bad) {
      const found = passAgentProblems(config, key);
      assert.ok(found.some(p => message.test(p)), `${key} ${JSON.stringify(config)}: ${JSON.stringify(found)}`);
    }
  }
  // "agents" alone is checked even with no pass on.
  assert.deepEqual(agentsProblems({ agents: { claude: {}, codex: {} } }), []);
  assert.ok(agentsProblems({ agents: { acme: {} } }).length);
  assert.throws(() => passAgentProblems({}, 'night'), /not a pass an agent runs/);
});

// Phase 47 changed this on purpose: phase 45 refused Codex on climb and tend
// (its sandbox keeps .git read-only); since the spike (keel run 37716223683)
// it commits to .keel/agent-git, so "agent": "codex" is valid on both, when listed.
test('config: Codex reviews, and runs a climb night and a tend pass (phase 47: it commits to its own git dir); listed, like any provider', async () => {
  const codex = { agents: { claude: {}, codex: {} } };
  assert.deepEqual(passAgentProblems({ ...codex, crossReview: { for: ['claude/'], agent: 'codex' } }, 'crossReview'), []);
  for (const key of ['climb', 'tend']) {
    assert.deepEqual(passAgentProblems({ ...codex, [key]: { ...ON[key], agent: 'codex' } }, key), [], key);
    assert.deepEqual(passAgentProblems({ agents: { codex: {} }, [key]: { ...ON[key], agent: 'codex' } }, key), [], `${key}: codex alone`);
    const unlisted = passAgentProblems({ [key]: { ...ON[key], agent: 'codex' } }, key);
    assert.equal(unlisted.length, 1, JSON.stringify(unlisted));
    assert.match(unlisted[0], new RegExp(`^"${key}"\\.agent is codex, which "agents" does not list`));
  }
  assert.deepEqual(AGENTS.codex.refused, {});
  assert.deepEqual([...AGENTS.codex.passes], ['crossReview', 'climb', 'tend']);
  // Never the sandbox that can write .git, never sudo: workspace-write and drop-sudo, as the workflows hold it.
  assert.deepEqual({ ...AGENTS.codex.editTree }, { sandbox: 'workspace-write', 'safety-strategy': 'drop-sudo' });
});

test('config: each pass\'s own validator holds the agent rules, and the scripts exit 2 naming the key', async () => {
  const { cross, climb, tend } = await scripts();
  const two = { agents: { claude: {}, codex: {} } };
  // The key is known to each validator.
  assert.deepEqual(cross.crossReviewProblems({ ...two, crossReview: { for: ['claude/'], agent: 'codex' } }), []);
  assert.deepEqual(climb.climbProblems({ climb: { jobs: ['test-time'], agent: 'claude' } }), []);
  assert.deepEqual(tend.tendProblems({ tend: { agent: 'claude' } }), []);
  assert.equal(cross.crossReviewConfigOf({ ...two, crossReview: { for: ['acme/'], agent: 'codex' } }).agent, 'codex');
  assert.equal(cross.crossReviewConfigOf({ crossReview: { for: ['codex/'] } }).agent, 'claude');
  // And each refuses what passAgentProblems refuses.
  assert.throws(() => cross.crossReviewConfigOf({ crossReview: { for: ['codex/'], agent: 'codex' } }), e => e.exitCode === 2 && /"crossReview"\.agent is codex, which "agents" does not list/.test(e.message));
  // Phase 47: Codex runs climb and tend, when listed.
  assert.deepEqual(climb.climbProblems({ ...two, climb: { jobs: ['test-time'], agent: 'codex' } }), []);
  assert.deepEqual(tend.tendProblems({ ...two, tend: { agent: 'codex' } }), []);
  assert.throws(() => climb.climbConfigOf({ climb: { jobs: ['test-time'], agent: 'codex' } }), e => e.exitCode === 2 && /"climb"\.agent is codex, which "agents" does not list/.test(e.message));
  assert.throws(() => tend.tendConfigOf({ tend: { agent: 'codex' } }), e => e.exitCode === 2 && /"tend"\.agent is codex, which "agents" does not list/.test(e.message));
  assert.throws(() => tend.tendConfigOf({ agents: { acme: {} }, tend: {} }), e => /unknown provider "acme"/.test(e.message));
  // The command line, in an Acme project.
  const dir = await mkdtemp(join(tmpdir(), 'keel-agents-acme-'));
  try {
    await mkdir(join(dir, 'scripts/keel'), { recursive: true });
    await mkdir(join(dir, '.keel'), { recursive: true });
    await cp(join(CROSS, 'scripts/keel/cross-review.mjs'), join(dir, 'scripts/keel/cross-review.mjs'));
    await cp(join(NIGHT, 'lib.mjs'), join(dir, 'scripts/keel/lib.mjs'));
    await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', crossReview: { for: ['codex/'], agent: 'gemini' } }));
    const r = run(process.execPath, [join(dir, 'scripts/keel/cross-review.mjs'), 'config', '--json'], { cwd: dir });
    assert.equal(r.status, 2, r.stdout);
    assert.match(JSON.parse(r.stdout).error, /"crossReview"\.agent must be one of claude, codex \(got "gemini"\)/);
    await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', agents: { codex: {} }, crossReview: { for: ['claude/'], agent: 'codex' } }));
    const ok = run(process.execPath, [join(dir, 'scripts/keel/cross-review.mjs'), 'config', '--json'], { cwd: dir });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.deepEqual(JSON.parse(ok.stdout), { on: true, for: ['claude/'], minutes: 15, agent: 'codex', agents: ['codex'] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- adapters, held to the workflows ------------------------------------------------

test('adapters: each provider\'s step is its own action at its major, with its read-only inputs, given only its own secrets, which its practice declares', async () => {
  const w = await workflows();
  assert.deepEqual(Object.keys(AGENTS).sort(), ['claude', 'codex']);
  for (const [provider, a] of Object.entries(AGENTS)) {
    for (const k of ['name', 'action', 'major', 'secrets', 'readOnly', 'editTree', 'final', 'error', 'login', 'passes', 'refused']) assert.ok(k in a, `${provider}: no ${k}`);
    for (const key of AGENT_PASSES) {
      const mine = agentSteps(w[key].text, provider);
      if (!a.passes.includes(key)) {
        // A pass the provider cannot hold: no step for it, and the config says why.
        assert.equal(mine.length, 0, `${provider} has a step in ${w[key].path}, which it cannot run`);
        assert.ok(a.refused[key], `${provider} refuses ${key} without saying why`);
        continue;
      }
      assert.equal(mine.length, 1, `${w[key].path}: one ${provider} step`);
      const step = mine[0];
      assert.match(step, new RegExp(`\\n {8}uses: ${a.action.replace('/', '\\/')}@${a.major}\\n`), `${w[key].path}: ${provider} at ${a.major}`);
      // Its secrets: only its own, all declared for this workflow by the practice.
      const used = [...step.matchAll(/secrets\.([A-Za-z_]\w*)/g)].map(m => m[1]);
      assert.deepEqual([...new Set(used)].sort(), [...a.secrets].sort(), `${w[key].path}: ${provider}'s step is given ${used}`);
      for (const s of a.secrets) assert.ok(w[key].declared.includes(s), `${w[key].practice} does not declare ${s} for ${w[key].path}`);
      const inputs = withOf(step);
      if (key === 'crossReview') {
        // The pass reads: the provider's read-only inputs, as the adapter says them.
        if (provider === 'claude') assert.deepEqual(/--allowedTools "([^"]*)"/.exec(step)[1].split(','), [...a.readOnly.allowedTools]);
        else for (const [k, v] of Object.entries(a.readOnly)) assert.equal(inputs[k], v, `${w[key].path}: ${provider} ${k}`);
      } else {
        for (const [k, v] of Object.entries(a.editTree)) assert.equal(inputs[k], v, `${w[key].path}: ${provider} ${k}`);
      }
    }
  }
  // Each workflow's "Configured?" step looks for the chosen provider's secrets.
  assert.match(w.crossReview.text, /OPENAI: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
});

// ---- the default is today's ----------------------------------------------------------

// The Claude steps as they were before phase 45, byte for byte. Cross-review's
// step differs only in places a phase decided: it runs when the config names
// claude (the default), and its tools no longer include the inline-comment
// tool (findings are JSON, posted by keel's step) (phase 45); the bots it
// allows (duo#84); and it is handed the review job's read-only token as
// github_token, so the action never trades OIDC for its app's token (phase 46).
const CLAUDE_BEFORE = {
  crossReview: `      - name: Review
        id: review
        if: steps.which.outputs.review == 'true'
        continue-on-error: true
        timeout-minutes: \${{ fromJSON(steps.which.outputs.minutes) }}
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          prompt: \${{ steps.brief.outputs.prompt }}
          claude_args: |
            --allowedTools "Read,Grep,Glob,Bash(gh pr diff:*),Bash(gh pr view:*),mcp__github_inline_comment__create_inline_comment"`,
  climb: `      - name: Climb
        id: climb
        if: steps.pick.outputs.job != ''
        continue-on-error: true
        timeout-minutes: \${{ fromJSON(steps.pick.outputs.minutes) }}
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          github_token: \${{ github.token }}
          prompt: \${{ steps.brief.outputs.prompt }}
          claude_args: |
            --allowedTools "Read,Edit,Write,Glob,Grep,Bash(node scripts/keel/climb.mjs *),Bash(node scripts/loop.mjs list*),Bash(node scripts/loop.mjs propose *),Bash(npm test*),Bash(npm run *),Bash(git status*),Bash(git diff*),Bash(git log*),Bash(git show*),Bash(git add *),Bash(git commit *),Bash(git switch *),Bash(git worktree *)"`,
  tend: `      - name: Tend
        id: tend
        if: steps.pick.outputs.run == 'yes'
        continue-on-error: true
        timeout-minutes: \${{ fromJSON(steps.pick.outputs.minutes) }}
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          github_token: \${{ github.token }}
          prompt: \${{ steps.brief.outputs.prompt }}
          claude_args: |
            --allowedTools "Read,Edit,Write,Glob,Grep,Bash(node scripts/keel/climb.mjs *),Bash(node scripts/roadmap.mjs*),Bash(npm test*),Bash(npm run *),Bash(git status*),Bash(git diff*),Bash(git log*),Bash(git show*),Bash(git add *),Bash(git commit *)"`,
};

test('the default: a project naming no agent runs Claude, and Claude\'s step passes the action exactly what it did before phase 45', async () => {
  const w = await workflows();
  const [climbStep] = agentSteps(w.climb.text, 'claude');
  const [tendStep] = agentSteps(w.tend.text, 'claude');
  // Phase 47: Claude's step runs when the pass names claude (the default), as cross-review's since phase 45; nothing else differs.
  assert.equal(climbStep, CLAUDE_BEFORE.climb.replace("if: steps.pick.outputs.job != ''", "if: steps.pick.outputs.job != '' && steps.on.outputs.agent == 'claude'"));
  assert.equal(tendStep, CLAUDE_BEFORE.tend.replace("if: steps.pick.outputs.run == 'yes'", "if: steps.pick.outputs.run == 'yes' && steps.on.outputs.agent == 'claude'"));
  const [review] = agentSteps(w.crossReview.text, 'claude');
  const expected = CLAUDE_BEFORE.crossReview
    .replace("if: steps.which.outputs.review == 'true'", "if: steps.which.outputs.review == 'true' && steps.which.outputs.agent == 'claude'")
    .replace(',mcp__github_inline_comment__create_inline_comment', '')
    // Phase 46: the review job's read-only token, as climb's and tend's since ledger#92.
    .replace('          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}\n', '          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}\n          github_token: ${{ github.token }}\n')
    // duo#84: a provider's bot may open the PR Claude reviews (its own, the fallback); the adapters' logins, by name.
    .replace('          prompt: ${{ steps.brief.outputs.prompt }}\n', `          prompt: \${{ steps.brief.outputs.prompt }}
          # A provider's bot may open the PR (claude[bot]: Claude reviewing its
          # own, the fallback); the action allows no bot unless named. The
          # adapters' logins only (lib.mjs AGENTS login), never "*".
          allowed_bots: claude[bot]\n`);
  assert.equal(review, expected);
  // Phase 47: climb and tend have one step per provider; Codex's gets OPENAI_API_KEY alone (the adapters test).
  for (const key of ['climb', 'tend']) assert.equal(agentSteps(w[key].text, 'codex').length, 1);

  // Cross-review with no "agent": the first step says claude, the config says claude, and only Claude's step runs.
  const dir = await mkdtemp(join(tmpdir(), 'keel-agents-default-'));
  try {
    await mkdir(join(dir, '.keel'), { recursive: true });
    await mkdir(join(dir, 'scripts/keel'), { recursive: true });
    await cp(join(CROSS, 'scripts/keel/cross-review.mjs'), join(dir, 'scripts/keel/cross-review.mjs'));
    await cp(join(NIGHT, 'lib.mjs'), join(dir, 'scripts/keel/lib.mjs'));
    const on = runBlocks(w.crossReview.text).find(b => b.step === 'Is cross-review on?');
    const step = async config => {
      await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', ...config }));
      const out = join(dir, 'out');
      await writeFile(out, '');
      const r = run('bash', ['-e', '-c', on.script], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out } });
      return { ...r, outputs: Object.fromEntries((await readFile(out, 'utf8')).split('\n').filter(Boolean).map(l => l.split('='))) };
    };
    const outputs = async config => { const r = await step(config); assert.equal(r.status, 0, r.stdout + r.stderr); return r.outputs; };
    assert.deepEqual(await outputs({ crossReview: { for: ['codex/'] } }), { on: 'true', agents: 'claude' });
    assert.deepEqual(await outputs({ agents: { claude: {}, codex: {} }, crossReview: { for: ['codex/', 'claude/'] } }), { on: 'true', agents: 'claude,codex' });
    assert.deepEqual(await outputs({}), { on: 'false' });
    // ledger#101: a typo in "agents" is red here, before the secret gate could end the run green and quiet.
    for (const agents of [{ claud: {} }, { 'x"; rm -rf /': {}, codex: {} }]) {
      const bad = await step({ agents, crossReview: { for: ['claude/'] } });
      assert.equal(bad.status, 1, JSON.stringify(agents));
      assert.match(bad.stdout, /^::error::cross-review: \.keel\/keel\.json: "agents" names an unknown provider/m);
      assert.deepEqual(bad.outputs, {}, 'no output: the secret gate and everything after it never run');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  const { cross } = await scripts();
  const pr = { number: 7, headRefName: 'codex/lid', headRefOid: 'a'.repeat(40), isCrossRepository: false, isDraft: false, state: 'OPEN' };
  assert.equal(cross.shouldReview({ config: { crossReview: { for: ['codex/'] } }, event: { name: 'pull_request', action: 'opened' }, pr }).agent, 'claude');
  // Each provider's step runs only on its own name in the output.
  const ifOf = s => /\n {8}if: (.*)/.exec(s)[1];
  assert.equal(ifOf(agentSteps(w.crossReview.text, 'claude')[0]), "steps.which.outputs.review == 'true' && steps.which.outputs.agent == 'claude'");
  assert.equal(ifOf(agentSteps(w.crossReview.text, 'codex')[0]), "steps.which.outputs.review == 'true' && steps.which.outputs.agent == 'codex'");
});

// ---- did the agent run? -----------------------------------------------------------------

test('did the agent run: a Codex step that failed, or ended with no final message, before its budget is red with one error line; a timeout or a final message is not', async () => {
  const red = codexVerdict({ outcome: 'failure', message: null, elapsedSec: 12, minutes: 15 });
  assert.equal(red.ok, false);
  assert.equal(red.line, 'Codex did not start: the agent step ended failure after 12 s, before its 15-minute budget, with no final message; check OPENAI_API_KEY, the model, and that the run\'s actor has write access (codex-action refuses anyone else). Nothing is judged or posted.');
  assert.equal(codexVerdict({ outcome: 'success', message: '  \n', elapsedSec: 8, minutes: 15 }).ok, false, 'success with an empty final message never ran');
  assert.match(codexVerdict({ outcome: 'success', message: '', elapsedSec: 8, minutes: 15 }).line, /^Codex did not start: the agent step succeeded after 8 s with no final message/);
  const stopped = codexVerdict({ outcome: 'failure', message: 'acme private review text', elapsedSec: 60, minutes: 15 });
  assert.equal(stopped.ok, false);
  assert.match(stopped.line, /^Codex stopped with an error/);
  assert.doesNotMatch(stopped.line, /acme private review text/, 'never the agent\'s words: keel\'s logs are public');
  assert.deepEqual(codexVerdict({ outcome: 'failure', message: null, elapsedSec: 15 * 60 - 30, minutes: 15 }).ok, true, 'the budget ran out: not red');
  assert.equal(codexVerdict({ outcome: 'cancelled', message: null, elapsedSec: 15 * 60, minutes: 15 }).timedOut, true);
  const fine = codexVerdict({ outcome: 'success', message: 'Checked the lid.\n```json\n[]\n```', elapsedSec: 300, minutes: 15 });
  assert.equal(fine.ok, true);
  assert.doesNotMatch(fine.line, /Checked the lid/);

  // The workflow's step, with each provider's output, as a project runs it: Codex red is exit 1 and one ::error:: line.
  const w = await workflows();
  const block = runBlocks(w.crossReview.text).find(b => b.step === 'Did the agent run?');
  const dir = await mkdtemp(join(tmpdir(), 'keel-agents-ran-'));
  try {
    const keel = join(dir, 'keel/scripts/keel');
    await mkdir(keel, { recursive: true });
    await cp(join(CROSS, 'scripts/keel/cross-review.mjs'), join(keel, 'cross-review.mjs'));
    await cp(join(NIGHT, 'lib.mjs'), join(keel, 'lib.mjs'));
    const now = Math.floor(Date.now() / 1000);
    await writeFile(join(dir, 'output'), '');
    const step = env => run('bash', ['-e', '-c', block.script], { cwd: dir, env: { ...process.env, RUNNER_TEMP: dir, GITHUB_OUTPUT: join(dir, 'output'), MINUTES: '15', STARTED: String(now - 20), EXECUTION: '', ...env } });
    const none = step({ AGENT: 'codex', OUTCOME: 'failure' });
    assert.equal(none.status, 1, none.stdout + none.stderr);
    assert.equal(none.stdout.trim().split('\n').length, 1);
    assert.match(none.stdout, /^::error::Codex did not start: the agent step ended failure after \d+ s, before its 15-minute budget, with no final message; check OPENAI_API_KEY/);
    await writeFile(join(dir, 'codex-final-message.md'), 'Checked the lid. Nothing found.\n```json\n[]\n```\n');
    const ok = step({ AGENT: 'codex', OUTCOME: 'success' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /the agent ran: Codex wrote its final message/);
    // Claude, by its execution file, as before.
    await writeFile(join(dir, 'execution.json'), JSON.stringify([{ type: 'result', is_error: true, num_turns: 1, duration_ms: 1000, result: 'Invalid API key' }]));
    const claude = step({ AGENT: 'claude', OUTCOME: 'success', EXECUTION: join(dir, 'execution.json') });
    assert.equal(claude.status, 1);
    assert.match(claude.stdout, /^::error::Claude did not start: is_error after 1 turn/);
    const claudeOk = step({ AGENT: 'claude', OUTCOME: 'success', EXECUTION: join(dir, 'execution.json').replace('execution', 'none') });
    assert.equal(claudeOk.status, 0, 'a missing execution file on success is not red, as before');
  } finally { await rm(dir, { recursive: true, force: true }); }
  // The step reads the outcome of whichever provider's step ran.
  assert.match(w.crossReview.text, /OUTCOME: \$\{\{ steps\.which\.outputs\.agent == 'codex' && steps\.review_codex\.outcome \|\| steps\.review\.outcome \}\}/);
  assert.match(w.crossReview.text, /output-file: \$\{\{ runner\.temp \}\}\/codex-final-message\.md/);
});

test('the Budget line finds the agent step whichever provider ran it: both carry the pass\'s step name, and the skipped one is passed over', async () => {
  const w = await workflows();
  for (const provider of Object.keys(AGENTS)) {
    const [s] = agentSteps(w.crossReview.text, provider);
    assert.match(s, new RegExp(`^ {6}- name: ${BUDGET_STEPS['keel-cross-review.yml'].agent}\\n`), `${provider}'s review step is named as the Budget map says`);
  }
  const t = (h, m) => `2026-10-07T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
  const jobs = ({ claude, codex, check = 'success' }) => [{ steps: [
    { name: 'Brief', conclusion: 'success', started_at: t(9, 0), completed_at: t(9, 1) },
    { name: 'Review', conclusion: claude ? 'success' : 'skipped', started_at: claude ? t(9, 1) : null, completed_at: claude ? t(9, 1 + claude) : null },
    { name: 'Review', conclusion: codex ? 'success' : 'skipped', started_at: codex ? t(9, 1) : null, completed_at: codex ? t(9, 1 + codex) : null },
    { name: 'Did the agent run?', conclusion: check, started_at: t(9, 30), completed_at: t(9, 30) },
  ] }];
  const pass = { step: 'Review', check: 'Did the agent run?', minutes: 15 };
  assert.deepEqual(stepUse(jobs({ codex: 6 }), pass), { seconds: 360, ranOut: false }, 'Codex ran: its minutes');
  assert.deepEqual(stepUse(jobs({ claude: 4 }), pass), { seconds: 240, ranOut: false }, 'Claude ran: its minutes');
  assert.equal(stepUse(jobs({ codex: 1, check: 'failure' }), pass), null, 'Codex never started: not counted');
  assert.deepEqual(stepUse(jobs({ codex: 15 }), pass).ranOut, true);
});

// ---- the owner's rule: a PR is reviewed by a provider other than its author ----------

test('the reviewer is another provider whenever one is available: codex/ PRs go to Claude, claude/ PRs to Codex (when listed, its secret set), the first other provider "agents" lists', async () => {
  // The branches each provider's PRs use: claude-code-action's branch_prefix default, Codex cloud's fixed codex/<slug>.
  assert.equal(AGENTS.claude.branch, 'claude/');
  assert.equal(AGENTS.codex.branch, 'codex/');
  assert.equal(authorOf('codex/anvil-lid'), 'codex');
  assert.equal(authorOf('claude/issue-12-20261007'), 'claude');
  assert.equal(authorOf('acme/feature'), null);
  const both = { agents: { claude: {}, codex: {} }, crossReview: { for: ['codex/', 'claude/'] } };
  assert.deepEqual([reviewerOf({ config: both, head: 'codex/lid' }).reviewer, reviewerOf({ config: both, head: 'claude/lid' }).reviewer], ['claude', 'codex']);
  // Order is "agents"' order: codex first still reviews only what codex did not write.
  const codexFirst = { agents: { codex: {}, claude: {} }, crossReview: { for: ['codex/', 'claude/'] } };
  assert.deepEqual([reviewerOf({ config: codexFirst, head: 'codex/lid' }).reviewer, reviewerOf({ config: codexFirst, head: 'claude/lid' }).reviewer], ['claude', 'codex']);
  // No "agents" key: claude alone, and today's codex/ config is reviewed by Claude, unchanged.
  const today = { crossReview: { for: ['codex/'], budget: { minutes: 15 } } };
  assert.deepEqual(passAgentProblems(today, 'crossReview'), []);
  assert.deepEqual(reviewerOf({ config: today, head: 'codex/lid' }), { author: 'codex', reviewer: 'claude', self: false, why: 'written by codex (codex/): reviewed by claude, the first other provider "agents" lists' });
  // A prefix no provider's branch names: "crossReview".agent, default claude.
  assert.equal(reviewerOf({ config: { crossReview: { for: ['acme/'] } }, head: 'acme/x' }).reviewer, 'claude');
  assert.equal(reviewerOf({ config: { agents: { codex: {} }, crossReview: { for: ['acme/'], agent: 'codex' } }, head: 'acme/x' }).reviewer, 'codex');
  // The rule holds per PR in the script, for every listed order and head, with every secret set.
  const { cross } = await scripts();
  const pr = head => ({ number: 7, headRefName: head, headRefOid: 'b'.repeat(40), isCrossRepository: false, isDraft: false, state: 'OPEN' });
  for (const config of [both, codexFirst, today]) for (const head of config.crossReview.for.map(p => `${p}lid`)) {
    const r = cross.shouldReview({ config, event: { name: 'pull_request', action: 'opened' }, pr: pr(head), has: { claude: true, codex: true } });
    assert.equal(r.review, true);
    assert.notEqual(r.agent, r.author, `${head}: reviewed by its own provider while another was available`);
    assert.equal(r.self, false);
    assert.equal(r.author, authorOf(head));
  }
});

test('its own provider reviews a PR only when no other is available: none other listed, or none with its secret; it says so, in a notice and in the review', async () => {
  const both = { agents: { claude: {}, codex: {} }, crossReview: { for: ['codex/', 'claude/'] } };
  // Listed, but its secret is not set: the author reviews.
  // duo#84: the reason names the provider and the secret it lacks.
  assert.deepEqual(reviewerOf({ config: both, head: 'claude/lid', has: { claude: true, codex: false } }), { author: 'claude', reviewer: 'claude', self: true, reason: 'codex is listed but its secret OPENAI_API_KEY is not set', why: 'written by claude (claude/): reviewed by claude, its own provider: codex is listed but its secret OPENAI_API_KEY is not set' });
  assert.equal(reviewerOf({ config: both, head: 'codex/lid', has: { claude: false, codex: true } }).reason, 'claude is listed but its secret CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY) is not set');
  // Not listed: claude alone, a claude/ PR. Valid config now (the fallback), and Claude reviews it, saying no other is listed.
  const alone = { crossReview: { for: ['claude/'] } };
  assert.deepEqual(passAgentProblems(alone, 'crossReview'), []);
  assert.deepEqual([reviewerOf({ config: alone, head: 'claude/lid' }).self, reviewerOf({ config: alone, head: 'claude/lid' }).reason], [true, 'no other provider is listed']);
  // Nobody with a secret: the first other is named, so the caller says which secret to add.
  assert.deepEqual([reviewerOf({ config: both, head: 'claude/lid', has: { claude: false, codex: false } }).reviewer, reviewerOf({ config: both, head: 'claude/lid', has: { claude: false, codex: false } }).self], ['codex', false]);
  // The script: a self-review is a review, flagged; with no secret at all, a notice and no review.
  const { cross } = await scripts();
  const pr = { number: 7, headRefName: 'claude/lid', headRefOid: 'd'.repeat(40), isCrossRepository: false, isDraft: false, state: 'OPEN' };
  const ev = { name: 'pull_request', action: 'opened' };
  const self = cross.shouldReview({ config: both, event: ev, pr, has: { claude: true, codex: false } });
  assert.deepEqual([self.review, self.agent, self.author, self.self, self.reason], [true, 'claude', 'claude', true, 'codex is listed but its secret OPENAI_API_KEY is not set']);
  assert.equal(cross.shouldReview({ config: both, event: ev, pr: { ...pr, headRefName: 'codex/lid' }, has: { claude: true, codex: true } }).reason, undefined, 'no reason when another reviews');
  const none = cross.shouldReview({ config: both, event: ev, pr, has: { claude: false, codex: false } });
  assert.deepEqual([none.review, none.notice], [false, true]);
  assert.match(none.why, /add the OPENAI_API_KEY secret for it to run/);
  // The review says it, under the summary.
  const review = cross.summaryReview({ result: { is_error: false, result: 'Checked the lid.' }, agent: 'claude', author: 'claude', reason: self.reason, pr, minutes: 15 });
  assert.match(review.body, /Reviewed by claude, its own provider: codex is listed but its secret OPENAI_API_KEY is not set\./);
  assert.match(cross.summaryReview({ result: { is_error: false, result: 'Checked.' }, agent: 'claude', author: 'claude', reason: 'no other provider is listed', pr, minutes: 15 }).body, /its own provider: no other provider is listed\./);
  assert.doesNotMatch(cross.summaryReview({ result: { is_error: false, result: 'Checked.' }, agent: 'claude', author: 'codex', pr, minutes: 15 }).body, /its own provider/);
  // The last guard: its own provider while another is available (a bug in the choice) is red, and no agent runs.
  const stub = () => ({ author: 'claude', reviewer: 'claude', self: true, why: 'acme' });
  assert.throws(() => cross.shouldReview({ config: both, event: ev, pr, has: { claude: true, codex: true }, choose: stub }),
    e => e.exitCode === 2 && /claude would review its own provider's PR while codex is available; no agent runs/.test(e.message));
  assert.throws(() => cross.shouldReview({ config: both, event: ev, pr, choose: stub }), e => e.exitCode === 2, 'no secrets said: every listed provider counts as available');
  assert.equal(cross.shouldReview({ config: both, event: ev, pr, has: { claude: true, codex: false }, choose: stub }).self, true, 'with codex unavailable it is the fallback, not red');
  assert.throws(() => cross.shouldReview({ config: both, event: ev, pr, choose: () => ({ author: 'claude', reviewer: null, why: 'none listed' }) }), e => e.exitCode === 2 && /none listed; no agent runs/.test(e.message));
  // The workflow says so in a notice, and hands the author to the summary.
  const w = await workflows();
  assert.match(w.crossReview.text, /console\.log\(w\.review \? `\$\{w\.self \? "::notice::" : ""\}review: \$\{w\.why\}`/);
  assert.match(w.crossReview.text, /summary --agent "\$\{AGENT:-claude\}" --author "\$AUTHOR"/);
});

test('a third provider: the first listed that is not the author reviews; a pass\'s configured agent never overrides the author rule', () => {
  const agents = {
    claude: { branch: 'claude/', passes: ['crossReview'] },
    codex: { branch: 'codex/', passes: ['crossReview'] },
    acmebot: { branch: 'acmebot/', passes: ['crossReview'] },
  };
  const config = { agents: { acmebot: {}, codex: {}, claude: {} }, crossReview: { for: ['codex/', 'claude/', 'acmebot/'] } };
  assert.equal(reviewerOf({ config, head: 'codex/x', agents }).reviewer, 'acmebot');
  assert.equal(reviewerOf({ config, head: 'claude/x', agents }).reviewer, 'acmebot');
  assert.equal(reviewerOf({ config, head: 'acmebot/x', agents }).reviewer, 'codex', 'the first listed after skipping the author');
  assert.equal(reviewerOf({ config, head: 'acmebot/x', agents, has: { acmebot: true, codex: false, claude: true } }).reviewer, 'claude', 'the first other with its secret');
  // "agent" is ignored for a PR whose author is known.
  assert.equal(reviewerOf({ config: { ...config, crossReview: { ...config.crossReview, agent: 'claude' } }, head: 'acmebot/x', agents }).reviewer, 'codex');
  assert.deepEqual(crossReviewerProblems(config, { agents }), []);
  assert.deepEqual(crossReviewerProblems({ agents: { acmebot: {} }, crossReview: { for: ['acmebot/'] } }, { agents }), [], 'alone, it reviews its own');
});

// ---- phase 60: a push to main is reviewed by a provider other than its commits' ------

test('phase 60: who wrote a push is its commits\' authors and Co-authored-by trailers; the reviewer is never their provider while another is available; a person\'s push goes to the first listed', async () => {
  const person = { name: 'Acme Owner', email: 'owner@acme.test', message: 'acme: anvils' };
  const claudeTrailer = { ...person, message: 'acme: lid\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' };
  const claudeApp = { name: 'claude[bot]', email: '209825114+claude[bot]@users.noreply.github.com', message: 'acme: hinge' };
  const codex = { name: 'Codex', email: 'noreply@openai.com', message: 'acme: handle' };
  const codexConnector = { ...person, message: 'acme: x\n\nCo-authored-by: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>' };
  assert.deepEqual(coAuthorsOf(claudeTrailer.message), [{ name: 'Claude Opus 5.5', email: 'noreply@anthropic.com' }]);
  assert.deepEqual([person, claudeTrailer, claudeApp, codex, codexConnector].map(c => commitAuthorOf(c)), [[], ['claude'], ['claude'], ['codex'], ['codex']]);
  // A person named Claude, at their own address, is a person.
  assert.deepEqual(commitAuthorOf({ name: 'Claude Dupont', email: 'claude@acme.test', message: 'acme: fix' }), []);
  assert.deepEqual(pushAuthorsOf([person, claudeTrailer, person]), ['claude']);
  const both = { agents: { claude: {}, codex: {} }, crossReview: { after: 'push' } };
  const codexFirst = { agents: { codex: {}, claude: {} }, crossReview: { after: 'push' } };
  // Claude's push goes to Codex, Codex's to Claude, in either listed order, with every secret set.
  for (const config of [both, codexFirst]) {
    assert.equal(pushReviewerOf({ config, commits: [person, claudeTrailer] }).reviewer, 'codex');
    assert.equal(pushReviewerOf({ config, commits: [codex] }).reviewer, 'claude');
  }
  assert.deepEqual(pushReviewerOf({ config: both, commits: [claudeApp] }), { authors: ['claude'], author: 'claude', reviewer: 'codex', self: false, why: 'written by claude (its commits\' authors and trailers): reviewed by codex, the first other provider "agents" lists' });
  // A person's push: the first listed (with its secret).
  assert.equal(pushReviewerOf({ config: both, commits: [person] }).reviewer, 'claude');
  assert.equal(pushReviewerOf({ config: codexFirst, commits: [person] }).reviewer, 'codex');
  assert.equal(pushReviewerOf({ config: both, commits: [person], has: { claude: false, codex: true } }).reviewer, 'codex');
  assert.equal(pushReviewerOf({ config: both, commits: [person] }).author, null);
  // Its own provider only when no other is available: unlisted, no secret, or the other wrote some of it too.
  const self = pushReviewerOf({ config: both, commits: [claudeTrailer], has: { claude: true, codex: false } });
  assert.deepEqual([self.reviewer, self.self, self.reason], ['claude', true, 'codex is listed but its secret OPENAI_API_KEY is not set']);
  assert.deepEqual([pushReviewerOf({ config: { crossReview: { after: 'push' } }, commits: [claudeTrailer] }).self, pushReviewerOf({ config: { crossReview: { after: 'push' } }, commits: [claudeTrailer] }).reason], [true, 'no other provider is listed']);
  const mixed = pushReviewerOf({ config: both, commits: [claudeTrailer, codex] });
  assert.deepEqual([mixed.reviewer, mixed.self, mixed.reason], ['claude', true, 'every other provider listed wrote some of it too (codex)']);

  // The script, end to end on the decision: for every listed order, the reviewer is not the author.
  const { cross } = await scripts();
  const git = { isCommit: () => true, isAncestor: () => true, parentOf: () => 'c'.repeat(40), fileAt: () => `export const PUSH_PROTOCOL = ${cross.PUSH_PROTOCOL};\n` };
  const decide = (config, commits, extra = {}) => cross.shouldReviewPush({ config, event: 'push', head: 'b'.repeat(40), before: 'a'.repeat(40), history: { last: null, today: 0, day: '2026-10-09' }, git: { ...git, commits: () => commits }, ...extra });
  for (const config of [both, codexFirst]) for (const commits of [[claudeTrailer], [codex], [claudeApp, person]]) {
    const r = decide(config, commits, { has: { claude: true, codex: true } });
    assert.equal(r.review, true);
    assert.ok(!r.authors.includes(r.agent), `${JSON.stringify(commits.map(c => c.name))}: reviewed by its own provider while another was available`);
    assert.equal(r.self, false);
  }
  assert.deepEqual([decide(both, [claudeTrailer]).agent, decide(both, [claudeTrailer]).author], ['codex', 'claude']);
  // The last guard: a choice that puts the author on its own push while another is available is red, and no agent runs.
  const own = ({ commits }) => ({ ...pushReviewerOf({ config: both, commits }), reviewer: 'claude', self: true });
  assert.throws(() => decide(both, [claudeTrailer], { has: { claude: true, codex: true }, choose: own }),
    e => e.exitCode === 2 && /claude would review a push its own provider wrote while codex is available; no agent runs/.test(e.message));
  assert.equal(decide(both, [claudeTrailer], { has: { claude: true, codex: false }, choose: own }).self, true, 'with codex unavailable it is the fallback, not red');
  // No secret for the reviewer: a notice, no review.
  const none = decide(both, [claudeTrailer], { has: { claude: true, codex: false }, choose: () => ({ authors: ['claude'], author: 'claude', reviewer: 'codex', self: false, why: 'acme' }) });
  assert.deepEqual([none.review, none.notice], [false, true]);
  assert.match(none.why, /add the OPENAI_API_KEY secret for it to run/);
});

test('config: an "agent" that writes a prefix in "for" is an error only while another provider is listed; a prefix that matches a provider\'s branches and others is refused (duo#84)', async () => {
  const self = passAgentProblems({ agents: { claude: {}, codex: {} }, crossReview: { for: ['codex/'], agent: 'codex' } }, 'crossReview');
  assert.equal(self.length, 1, JSON.stringify(self));
  assert.match(self[0], /^"crossReview"\.agent is codex, who writes the codex\/ PRs "for" names, and another provider is listed to review them/);
  assert.deepEqual(passAgentProblems({ agents: { codex: {} }, crossReview: { for: ['codex/'], agent: 'codex' } }, 'crossReview'), [], 'codex alone: the fallback anyway');
  assert.deepEqual(passAgentProblems({ crossReview: { for: ['claude/'] } }, 'crossReview'), [], 'claude alone reviews its own claude/ PRs');
  // duo#84: a prefix that matches a provider's branches and others ("claude" matches claude/ and claude-fix) is refused, whatever the agents.
  assert.deepEqual(prefixAuthors('claude'), { authors: ['claude'], unknown: true });
  assert.deepEqual(prefixAuthors('c'), { authors: ['claude', 'codex'], unknown: true });
  assert.deepEqual(prefixAuthors('codex/fix-'), { authors: ['codex'], unknown: false });
  assert.deepEqual(prefixAuthors('acme/'), { authors: [], unknown: true });
  for (const agents of [undefined, { claude: {} }, { claude: {}, codex: {} }]) {
    const config = { ...(agents ? { agents } : {}), crossReview: { for: ['claude'] } };
    assert.deepEqual(passAgentProblems(config, 'crossReview'), [`"crossReview".for has claude: claude matches claude's branches and others (e.g. claude-fix); name the provider's branch exactly (claude/) or a prefix no provider's branch shares`], JSON.stringify(agents));
  }
  assert.deepEqual(passAgentProblems({ agents: { claude: {}, codex: {} }, crossReview: { for: ['c'] } }, 'crossReview'), [`"crossReview".for has c: c matches claude's branches and codex's branches and others (e.g. c-fix); name the provider's branch exactly (claude/, codex/) or a prefix no provider's branch shares`]);
  // Exact provider prefixes, longer ones, and prefixes no provider shares stay valid.
  for (const p of ['claude/', 'codex/', 'claude/feature-', 'custom/']) assert.deepEqual(passAgentProblems({ agents: { claude: {}, codex: {} }, crossReview: { for: [p] } }, 'crossReview'), [], p);
  // Both listed, both prefixes: clean (the owner's example).
  assert.deepEqual(passAgentProblems({ agents: { claude: {}, codex: {} }, crossReview: { for: ['codex/', 'claude/'], budget: { minutes: 15 } } }, 'crossReview'), []);
  const { cross } = await scripts();
  assert.throws(() => cross.crossReviewConfigOf({ agents: { claude: {}, codex: {} }, crossReview: { for: ['codex/'], agent: 'codex' } }), e => e.exitCode === 2 && /another provider is listed/.test(e.message));
  // The workflow: every agent step waits on Which's review output, set only by a review the script chose.
  const w = await workflows();
  for (const provider of Object.keys(AGENTS)) assert.match(agentSteps(w.crossReview.text, provider)[0], /\n {8}if: steps\.which\.outputs\.review == 'true' && steps\.which\.outputs\.agent == '[a-z]+'\n/);
  assert.match(w.crossReview.text, /HAS_CODEX: \$\{\{ secrets\.OPENAI_API_KEY != '' \}\}/, 'the reviewer\'s secret is checked by presence, never its value');
});

test('ledger#101, duo#84: each agent step lets exactly the providers\' bots start it (a claude/ PR opened by Claude\'s app), by allow-bot-users and allowed_bots, never a wildcard', async () => {
  const w = await workflows();
  const [step] = agentSteps(w.crossReview.text, 'codex');
  const inputs = withOf(step);
  // duo#84: every provider's bot, since a provider may review its own bot-opened PR as the fallback.
  const logins = Object.values(AGENTS).map(a => a.login).filter(Boolean);
  assert.deepEqual(logins, ['claude[bot]']);
  assert.equal(inputs['allow-bot-users'], logins.join(','));
  for (const k of ['allow-bots', 'allow-users']) assert.ok(!(k in inputs), k);
  // And Claude's step, by claude-code-action's allowed_bots (default: no bot).
  const [claude] = agentSteps(w.crossReview.text, 'claude');
  assert.equal(withOf(claude).allowed_bots, logins.join(','));
});

test('a budget timeout never swallows a short budget: on a one-minute budget a failure at 5 s is red, at 58 s it ran out (duo#83, cajones#56)', async () => {
  const { cross, climb } = await scripts();
  // Codex.
  assert.equal(codexVerdict({ outcome: 'failure', message: null, elapsedSec: 5, minutes: 1 }).ok, false);
  assert.match(codexVerdict({ outcome: 'failure', message: null, elapsedSec: 5, minutes: 1 }).line, /^Codex did not start/);
  assert.deepEqual([codexVerdict({ outcome: 'failure', message: null, elapsedSec: 58, minutes: 1 }).ok, codexVerdict({ outcome: 'failure', message: null, elapsedSec: 58, minutes: 1 }).timedOut], [true, true]);
  assert.equal(codexVerdict({ outcome: 'failure', message: null, elapsedSec: 0, minutes: 1 }).ok, false, 'a failure at 0 s never ran out a budget');
  assert.equal(codexVerdict({ outcome: 'failure', message: null, elapsedSec: 840, minutes: 15 }).timedOut, true, 'a long budget keeps its minute of slack');
  assert.equal(codexVerdict({ outcome: 'failure', message: null, elapsedSec: 600, minutes: 15 }).ok, false);
  // Claude, in climb.mjs and cross-review.mjs's copy alike.
  for (const [where, v] of [['climb.mjs', climb.agentVerdict], ['cross-review.mjs', cross.agentVerdict]]) {
    assert.equal(v({ outcome: 'failure', result: null, elapsedSec: 5, minutes: 1 }).ok, false, `${where}: 5 s of a 1-minute budget`);
    assert.equal(v({ outcome: 'failure', result: null, elapsedSec: 58, minutes: 1 }).timedOut, true, `${where}: 58 s`);
    assert.equal(v({ outcome: 'failure', result: null, elapsedSec: 0, minutes: 1 }).ok, false, `${where}: 0 s`);
    assert.equal(v({ outcome: 'failure', result: null, elapsedSec: 15 * 60 - 30, minutes: 15 }).timedOut, true, `${where}: 15 min`);
  }
});

// ---- phase 47: Codex on climb and tend ------------------------------------------------

test('phase 47: climb and tend read which provider runs them, ask for its secret alone, and judge Codex by its final message', async () => {
  const w = await workflows();
  const dir = await mkdtemp(join(tmpdir(), 'keel-agents-climb-'));
  try {
    await mkdir(join(dir, '.keel'), { recursive: true });
    const keel = join(dir, 'scripts/keel');
    await mkdir(keel, { recursive: true });
    for (const f of ['lib.mjs', 'test-ledger.mjs', 'pr-body.mjs']) await cp(join(NIGHT, f), join(keel, f));
    for (const f of ['climb.mjs', 'tend.mjs', 'distill.mjs']) await cp(join(CLIMB, 'scripts/keel', f), join(keel, f));
    const now = Math.floor(Date.now() / 1000);
    for (const key of ['climb', 'tend']) {
      const blocks = runBlocks(w[key].text);
      const block = name => blocks.find(b => b.step === name)?.script ?? assert.fail(`${w[key].path}: no "${name}"`);
      const outputs = async (name, env) => {
        const out = join(dir, 'output');
        await writeFile(out, '');
        const r = run('bash', ['-e', '-c', block(name)], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out, RUNNER_TEMP: dir, ...env } });
        return { ...r, outputs: Object.fromEntries((await readFile(out, 'utf8')).split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) };
      };
      const on = async pass => { await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', agents: { claude: {}, codex: {} }, [key]: pass })); return (await outputs(`Is ${key} on?`)).outputs; };
      assert.deepEqual(await on(ON[key]), { on: 'true', agent: 'claude' }, `${key}: no agent is claude`);
      assert.deepEqual(await on({ ...ON[key], agent: 'codex' }), { on: 'true', agent: 'codex' });
      assert.equal((await on({ ...ON[key], agent: 'x\nenabled=true' })).agent, 'invalid', 'an agent is never an output line of its own');
      const pass = key === 'climb' ? 'a climb night' : 'a tend pass';
      const none = await outputs('Configured?', { AGENT: 'codex', OPENAI: '', OAUTH: 'acme', API_KEY: 'acme' });
      assert.equal(none.status, 0);
      assert.equal(none.outputs.enabled, 'false', `${key}: Claude's secret does not run Codex`);
      assert.match(none.stdout, new RegExp(`^::notice::Skipped: add the OPENAI_API_KEY secret for ${pass} by Codex to run\\.`, 'm'));
      assert.equal((await outputs('Configured?', { AGENT: 'codex', OPENAI: 'acme', OAUTH: '', API_KEY: '' })).outputs.enabled, 'true');
      assert.equal((await outputs('Configured?', { AGENT: 'claude', OPENAI: 'acme', OAUTH: '', API_KEY: '' })).outputs.enabled, 'false', `${key}: Codex's secret does not run Claude`);
      assert.equal((await outputs('Configured?', { AGENT: 'claude', OPENAI: '', OAUTH: 'acme', API_KEY: '' })).outputs.enabled, 'true');

      // Did the agent run? Codex by its outcome and final message; Claude as before.
      await rm(join(dir, 'codex-final-message.md'), { force: true });
      const ran = env => outputs('Did the agent run?', { MINUTES: '30', STARTED: String(now - 20), EXECUTION: '', ...env });
      const red = await ran({ AGENT: 'codex', OUTCOME: 'failure' });
      assert.equal(red.status, 1, red.stdout + red.stderr);
      assert.match(red.stdout, /^::error::Codex did not start: the agent step ended failure after \d+ s, before its 30-minute budget, with no final message; check OPENAI_API_KEY/);
      await writeFile(join(dir, 'codex-final-message.md'), 'Kept one change.\n');
      const ok = await ran({ AGENT: 'codex', OUTCOME: 'success' });
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stdout, /the agent ran: Codex wrote its final message/);
      assert.doesNotMatch(ok.stdout, /Kept one change/, 'never the agent\'s words');
      const claude = await ran({ AGENT: 'claude', OUTCOME: 'failure' });
      assert.equal(claude.status, 1);
      assert.match(claude.stdout, /^::error::Claude did not start/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('phase 47: KEEL_AGENT_GIT points the checkout\'s git at the agent\'s git dir, only a relative path inside it that holds one; a worktree and the gate never see it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-agent-git-args-'));
  try {
    assert.equal(AGENT_GIT_DIR, '.keel/agent-git');
    const env = { KEEL_AGENT_GIT: AGENT_GIT_DIR };
    assert.deepEqual(agentGitArgs(dir, env), [], 'no git dir there yet');
    await mkdir(join(dir, AGENT_GIT_DIR), { recursive: true });
    await writeFile(join(dir, AGENT_GIT_DIR, 'HEAD'), 'ref: refs/heads/main\n');
    assert.deepEqual(agentGitArgs(dir, env), [`--git-dir=${join(dir, AGENT_GIT_DIR)}`, `--work-tree=${dir}`]);
    assert.deepEqual(agentGitArgs(dir, {}), [], 'unset');
    assert.deepEqual(agentGitArgs(dir, { KEEL_AGENT_GIT: join(dir, AGENT_GIT_DIR) }), [], 'absolute: a worktree would resolve it too');
    assert.deepEqual(agentGitArgs(join(dir, '.keel'), { KEEL_AGENT_GIT: '../.keel/agent-git' }), [], 'never outside the checkout');
    assert.deepEqual(agentGitArgs(join(dir, 'elsewhere'), env), [], 'a worktree elsewhere has none');
    const gate = gateEnv({ ...env, ACME: '1' }, {});
    assert.equal('KEEL_AGENT_GIT' in gate, false, 'the gate runs git as it always does');
    assert.equal(gate.ACME, '1');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// The cross-review practice (phase 42): scripts/keel/cross-review.mjs and the
// steps of keel-cross-review.yml that are shell, run where a project has them,
// in a synthetic Acme repo. gh is a stub on PATH; nothing here reads the live
// world or runs a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRACTICE = join(KEEL, 'practices/cross-review/files');
const SCRIPT = join(PRACTICE, 'scripts/keel/cross-review.mjs');
const WORKFLOW = join(PRACTICE, '.github/workflows/keel-cross-review.yml');
const LIB = join(KEEL, 'practices/night/files/scripts/keel/lib.mjs');
const CLIMB = join(KEEL, 'practices/climb/files/scripts/keel/climb.mjs');

const SHA = 'a'.repeat(40);
const ON = { for: ['codex/'], budget: { minutes: 15 } };

/** A synthetic Acme project with cross-review's files and the night's lib.mjs. */
async function acme(t, { crossReview = ON, files = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-cross-review-acme-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'scripts/keel'), { recursive: true });
  await mkdir(join(dir, '.agents/cross-review'), { recursive: true });
  await mkdir(join(dir, '.keel'), { recursive: true });
  await cp(SCRIPT, join(dir, 'scripts/keel/cross-review.mjs'));
  await cp(LIB, join(dir, 'scripts/keel/lib.mjs'));
  await cp(join(PRACTICE, '.agents/cross-review/REVIEW.md'), join(dir, '.agents/cross-review/REVIEW.md'));
  await writeFile(join(dir, '.keel/keel.json'), `${JSON.stringify({ name: 'Acme', repo: 'acme/anvils', ...(crossReview === null ? {} : { crossReview }) }, null, 2)}\n`);
  for (const [p, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), text);
  }
  return dir;
}

const cli = (dir, args, env = {}) => run(process.execPath, [join(dir, 'scripts/keel/cross-review.mjs'), ...args], { cwd: dir, env: { ...process.env, ...env } });
const json = r => { try { return JSON.parse(r.stdout); } catch { assert.fail(`not JSON (exit ${r.status}): ${r.stdout}${r.stderr}`); } };
const NIGHT = join(KEEL, 'practices/night/files/scripts/keel');

/** The script as a project has it: in scripts/keel beside the night's lib.mjs (and, with `climb`, climb.mjs and what it imports). */
async function load(t, { climb = false } = {}) {
  const dir = await acme(t);
  if (climb) {
    for (const f of ['test-ledger.mjs', 'pr-body.mjs']) await cp(join(NIGHT, f), join(dir, 'scripts/keel', f));
    for (const f of ['climb.mjs', 'tend.mjs']) await cp(join(dirname(CLIMB), f), join(dir, 'scripts/keel', f));
  }
  const at = f => import(pathToFileURL(join(dir, 'scripts/keel', f)).href);
  return climb ? { m: await at('cross-review.mjs'), climb: await at('climb.mjs') } : at('cross-review.mjs');
}

/** gh pr view's answer for an Acme PR. */
const prJson = over => ({ number: 7, headRefName: 'codex/anvil-lid', headRefOid: SHA, isCrossRepository: false, isDraft: false, state: 'OPEN', ...over });

/** A stub gh on PATH: `pr view` prints `pr`; `api` logs its arguments and the --input file, then prints a review. */
async function stubGh(t, pr, { diff = null, refuseInline = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-cross-review-gh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = join(dir, 'gh.log');
  await writeFile(join(dir, 'gh'), `#!${process.execPath}
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === 'pr' && a[1] === 'view') { process.stdout.write(${JSON.stringify(JSON.stringify(pr))}); process.exit(0); }
if (a[0] === 'pr' && a[1] === 'diff') { const d = ${JSON.stringify(diff)}; if (d === null) { process.stderr.write('acme gh: diff too large'); process.exit(1); } process.stdout.write(d); process.exit(0); }
if (a[0] === 'api') {
  const i = a.indexOf('--input');
  const input = i >= 0 ? JSON.parse(fs.readFileSync(a[i + 1], 'utf8')) : null;
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: a, input }) + '\\n');
  if (${refuseInline} && input && input.comments) { process.stderr.write('gh: Unprocessable Entity (HTTP 422)'); process.exit(1); }
  process.stdout.write('posted review 1 (COMMENTED)\\n');
  process.exit(0);
}
process.stderr.write('acme gh: unexpected ' + a.join(' '));
process.exit(1);
`, { mode: 0o755 });
  return { path: dir, calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) };
}

/** Run one named step of keel-cross-review.yml in `dir`, as the workflow has it: { status, out, outputs }. */
async function step(t, dir, name, env = {}) {
  const block = runBlocks(await readFile(WORKFLOW, 'utf8')).find(b => b.step === name);
  assert.ok(block, `keel-cross-review.yml has a step "${name}"`);
  const out = join(dir, '..', `${dir.split('/').pop()}-${name.replace(/\W/g, '')}-out`);
  t.after(() => rm(out, { force: true }));
  await writeFile(out, '');
  const r = run('bash', ['-e', '-c', block.script], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out, ...env } });
  const outputs = Object.fromEntries((await readFile(out, 'utf8')).split('\n').filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { status: r.status, out: r.stdout + r.stderr, outputs };
}

/** claude-code-action's execution file, as the action writes it: the session, then its result. */
const execution = result => JSON.stringify([
  { type: 'system', subtype: 'init' },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'acme private session text' }] } },
  { type: 'result', ...result },
]);

test('config: unknown keys, an empty prefix list and a budget outside 5-60 minutes are errors naming the key; the default budget is 15', async t => {
  const m = await load(t);
  assert.deepEqual(m.crossReviewProblems({}), [], 'no key: off, not an error');
  assert.equal(m.crossReviewConfigOf({}), null);
  assert.deepEqual(m.crossReviewConfigOf({ crossReview: { for: ['codex/'] } }), { for: ['codex/'], minutes: 15, agent: 'claude', agents: ['claude'] });
  assert.deepEqual(m.crossReviewConfigOf({ crossReview: ON }), { for: ['codex/'], minutes: 15, agent: 'claude', agents: ['claude'] });
  assert.deepEqual(m.crossReviewConfigOf({ crossReview: { for: ['codex/', 'gemini/'], budget: { minutes: 60 } } }), { for: ['codex/', 'gemini/'], minutes: 60, agent: 'claude', agents: ['claude'] });
  const bad = [
    [{ for: ['codex/'], reviewers: ['acme'] }, /unknown key reviewers/],
    [{ for: [] }, /"crossReview"\.for must list one branch prefix or more/],
    [{}, /"crossReview"\.for must list/],
    [{ for: 'codex/' }, /"crossReview"\.for must list/],
    [{ for: [''] }, /a prefix is a branch name's start/],
    [{ for: ['codex/', 'codex/'] }, /names a prefix twice/],
    [{ for: ['codex/'], budget: { minutes: 4 } }, /budget\.minutes must be a whole number from 5 to 60 \(got 4\)/],
    [{ for: ['codex/'], budget: { minutes: 61 } }, /from 5 to 60 \(got 61\)/],
    [{ for: ['codex/'], budget: { minutes: 7.5 } }, /from 5 to 60/],
    [{ for: ['codex/'], budget: { minutes: 15, dollars: 3 } }, /budget must be \{ minutes \}/],
    [['codex/'], /must be an object/],
  ];
  for (const [c, message] of bad) {
    assert.ok(m.crossReviewProblems({ crossReview: c }).some(p => message.test(p)), `${JSON.stringify(c)}: ${m.crossReviewProblems({ crossReview: c })}`);
    assert.throws(() => m.crossReviewConfigOf({ crossReview: c }), e => e.exitCode === 2 && message.test(e.message));
  }
  // The command line: exit 2 naming the key, and the workflow's "Which pull request?" goes red on it.
  const dir = await acme(t, { crossReview: { for: [], budget: { minutes: 90 } } });
  const r = cli(dir, ['config', '--json']);
  assert.equal(r.status, 2);
  assert.match(json(r).error, /"crossReview"\.for must list.*budget\.minutes must be a whole number from 5 to 60 \(got 90\)/);
  const gh = await stubGh(t, prJson());
  const which = await step(t, dir, 'Which pull request?', { PATH: `${gh.path}:${process.env.PATH}`, RUNNER_TEMP: dir, PR: '7', REPO: 'acme/anvils', EVENT: 'pull_request', ACTION: 'opened' });
  assert.equal(which.status, 2, which.out);
  assert.equal(which.outputs.review, undefined, 'a bad config reviews nothing');
});

test('off: with no crossReview key the workflow ends at its first step; with no secret the run ends green with a notice', async t => {
  const off = await acme(t, { crossReview: null });
  const o = await step(t, off, 'Is cross-review on?');
  assert.equal(o.status, 0, o.out);
  assert.match(o.out, /cross-review is off: \.keel\/keel\.json has no "crossReview", so this run does nothing\./);
  assert.equal(o.outputs.on, 'false');
  assert.deepEqual(json(cli(off, ['config', '--json'])), { on: false });

  const on = await acme(t);
  assert.equal((await step(t, on, 'Is cross-review on?')).outputs.on, 'true');
  const unset = await step(t, on, 'Configured?', { OAUTH: '', API_KEY: '' });
  assert.equal(unset.status, 0, unset.out);
  assert.match(unset.out, /^::notice::Skipped: add the CLAUDE_CODE_OAUTH_TOKEN \(or ANTHROPIC_API_KEY\) secret for a cross-review to run\.$/m);
  assert.equal(unset.outputs.enabled, 'false');
  assert.equal((await step(t, on, 'Configured?', { OAUTH: 'acme-token', API_KEY: '' })).outputs.enabled, 'true');
  assert.equal((await step(t, on, 'Configured?', { OAUTH: '', API_KEY: 'acme-key' })).outputs.enabled, 'true');

  // The order, and every step after Configured? waits on it (or on Which, which waits on it).
  const text = await readFile(WORKFLOW, 'utf8');
  const steps = text.split(/\n(?= {6}- )/).filter(s => /^ {6}- /.test(s));
  const names = steps.map(s => /^ {6}- (?:name: (.+)|uses: (\S+))/.exec(s)).map(m => m[1] ?? m[2]);
  assert.deepEqual(names.slice(0, 4), ['actions/checkout@v7', 'Is cross-review on?', 'Configured?', 'Which pull request?']);
  assert.match(steps[0], /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/, 'the config is the default branch\'s');
  assert.match(steps[2], /if: steps\.on\.outputs\.on == 'true'/);
  assert.match(steps[3], /if: steps\.configured\.outputs\.enabled == 'true'/);
  for (const s of steps.slice(4)) assert.match(s, /\n {8}if: steps\.which\.outputs\.review == 'true'(?: && steps\.which\.outputs\.agent == '(?:claude|codex)')?\n/, `step without the guard: ${s.split('\n')[0]}`);
  // The config and the brief come from the default branch, before the PR's head is checked out.
  assert.ok(names.indexOf('Brief') < names.indexOf('Check out the pull request'));
  assert.ok(names.indexOf('Check out the pull request') < names.indexOf('Review'));
});

test('which: a matching same-repo branch is reviewed on opened, ready_for_review and a person\'s /review; anything else is not, and says why', async t => {
  const m = await load(t);
  const config = { crossReview: ON };
  const pr = (name, over = {}) => ({ name, action: '', comment: {}, ...over });
  const review = (event, p = prJson()) => m.shouldReview({ config, event, pr: p });
  const comment = c => pr('issue_comment', { action: 'created', comment: { body: '/review', association: 'OWNER', login: 'acme-owner', type: 'User', ...c } });
  for (const action of ['opened', 'ready_for_review']) {
    const r = review(pr('pull_request', { action }));
    assert.equal(r.review, true, action);
    assert.deepEqual([r.number, r.sha, r.minutes], [7, SHA, 15]);
    assert.match(r.why, /^#7 on codex\/anvil-lid \(codex\/\), head aaaaaaa; written by codex \(codex\/\): reviewed by claude, the first other provider "agents" lists$/);
  }
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) assert.equal(review(comment({ association })).review, true, association);
  assert.equal(review(comment({ body: '  /review please\n' })).review, true, 'the first word asks');
  const no = [
    [pr('pull_request', { action: 'synchronize' }), prJson(), /never on a push/],
    [pr('pull_request', { action: 'reopened' }), prJson(), /reviews start on opened and ready_for_review/],
    [pr('push'), prJson(), /push never starts a review/],
    [pr('pull_request', { action: 'opened' }), prJson({ headRefName: 'claude/anvil-lid' }), /branch claude\/anvil-lid matches no "crossReview"\.for prefix \(codex\/\)/],
    [pr('pull_request', { action: 'opened' }), prJson({ headRefName: 'main' }), /matches no/],
    [pr('pull_request', { action: 'opened' }), prJson({ isCrossRepository: true }), /comes from a fork/],
    [pr('pull_request', { action: 'opened' }), prJson({ isCrossRepository: undefined }), /comes from a fork/],
    [pr('pull_request', { action: 'opened' }), prJson({ isDraft: true }), /is a draft/],
    [pr('pull_request', { action: 'opened' }), prJson({ state: 'MERGED' }), /is merged/],
    [pr('pull_request', { action: 'opened' }), prJson({ headRefOid: 'abc' }), /without its head commit/],
    [comment({ login: 'codex[bot]', type: 'Bot' }), prJson(), /from a bot \(codex\[bot\]\)/],
    [comment({ login: 'acme-bot[bot]', type: 'User' }), prJson(), /from a bot/],
    [comment({ association: 'CONTRIBUTOR' }), prJson(), /only OWNER, MEMBER, COLLABORATOR may ask/],
    [comment({ association: 'NONE' }), prJson(), /only OWNER/],
    [comment({ body: '/reviewer acme' }), prJson(), /does not ask for \/review/],
    [comment({ body: 'please /review' }), prJson(), /does not ask/],
    [comment({}), prJson({ headRefName: 'person/fix' }), /matches no/],
    [comment({}), prJson({ isCrossRepository: true }), /fork/],
  ];
  for (const [event, p, why] of no) {
    const r = review(event, p);
    assert.equal(r.review, false, `${JSON.stringify(event)} ${JSON.stringify(p)}`);
    assert.match(r.why, why);
  }
  assert.match(m.shouldReview({ config: {}, event: pr('pull_request', { action: 'opened' }), pr: prJson() }).why, /cross-review is off/);

  // The workflow's own step, end to end with a stub gh: outputs for the next steps, and why in the log.
  const dir = await acme(t);
  const at = async (p, env) => {
    const gh = await stubGh(t, p);
    return step(t, dir, 'Which pull request?', { PATH: `${gh.path}:${process.env.PATH}`, RUNNER_TEMP: dir, PR: String(p.number), REPO: 'acme/anvils', ACTION: '', COMMENT_BODY: '', ASSOCIATION: '', COMMENTER: '', COMMENTER_TYPE: '', ...env });
  };
  const yes = await at(prJson(), { EVENT: 'pull_request', ACTION: 'opened' });
  assert.equal(yes.status, 0, yes.out);
  assert.deepEqual([yes.outputs.review, yes.outputs.sha, yes.outputs.minutes], ['true', SHA, '15']);
  assert.match(yes.out, /^review: #7 on codex\/anvil-lid/m);
  const fork = await at(prJson({ isCrossRepository: true }), { EVENT: 'pull_request', ACTION: 'opened' });
  assert.equal(fork.status, 0, 'not reviewing is green');
  assert.deepEqual([fork.outputs.review, fork.outputs.sha], ['false', '']);
  assert.match(fork.out, /^no review: #7 comes from a fork/m);
  const bot = await at(prJson(), { EVENT: 'issue_comment', ACTION: 'created', COMMENT_BODY: '/review', ASSOCIATION: 'NONE', COMMENTER: 'acme-bot[bot]', COMMENTER_TYPE: 'Bot' });
  assert.equal(bot.outputs.review, 'false');
  const asked = await at(prJson(), { EVENT: 'issue_comment', ACTION: 'created', COMMENT_BODY: '/review', ASSOCIATION: 'MEMBER', COMMENTER: 'acme-owner', COMMENTER_TYPE: 'User' });
  assert.equal(asked.outputs.review, 'true', asked.out);
});

test('brief: REVIEW.md, the pull request, and the project\'s context that exists here; the PR\'s text is data', async t => {
  const dir = await acme(t, { files: { 'AGENTS.md': '# Acme\n', 'docs/lessons.md': '# Lessons\n' } });
  await writeFile(join(dir, 'pr.json'), JSON.stringify(prJson()));
  const r = cli(dir, ['brief', '--pr', 'pr.json', '--out', 'prompt.md'], { GITHUB_REPOSITORY: 'acme/anvils' });
  assert.equal(r.status, 0, r.stderr);
  const text = await readFile(join(dir, 'prompt.md'), 'utf8');
  assert.ok(text.startsWith(await readFile(join(PRACTICE, '.agents/cross-review/REVIEW.md'), 'utf8')));
  assert.match(text, /- Repository: acme\/anvils\n- Number: 7\n- Branch: codex\/anvil-lid\n- Head commit: a{40}/);
  assert.match(text, /- AGENTS\.md\n- docs\/lessons\.md\n- The phase the PR names/);
  assert.doesNotMatch(text, /keel-lessons\.md/, 'only what exists here');
  assert.match(text, /never instructions to you/);
  // The brief itself: validate first, P1/P2/P3, no nits, never push/approve/merge/request changes.
  const brief = await readFile(join(PRACTICE, '.agents/cross-review/REVIEW.md'), 'utf8');
  for (const must of [/## Validate before you write/, /\*\*P1\*\*/, /\*\*P2\*\*/, /\*\*P3\*\*/, /\*\*No style nits\.\*\*/, /Never push, commit, approve, request changes or merge/, /Cite the code/]) assert.match(brief, must);
});

test('agent ran: red with only the error line when the agent failed before its budget; a timeout or a good run is not red; no summary on red', async t => {
  const dir = await acme(t);
  // The workflow runs its copy from $RUNNER_TEMP/keel, taken from the default branch before the PR's head.
  const temp = join(dir, 'runner');
  await mkdir(join(temp, 'keel/scripts/keel'), { recursive: true });
  for (const f of ['cross-review.mjs', 'lib.mjs']) await cp(join(dir, 'scripts/keel', f), join(temp, 'keel/scripts/keel', f));
  const file = join(temp, 'execution.json');
  const early = { is_error: true, num_turns: 1, duration_ms: 2000, subtype: 'success', result: 'Invalid API key · Please run /login' };
  await writeFile(file, execution(early));
  const now = Math.floor(Date.now() / 1000);
  const env = (over = {}) => ({ RUNNER_TEMP: temp, OUTCOME: 'success', EXECUTION: file, MINUTES: '15', STARTED: String(now - 5), ...over });
  const red = await step(t, dir, 'Did the agent run?', env());
  assert.equal(red.status, 1, red.out);
  assert.match(red.out, /^::error::Claude did not start: is_error after 1 turn in 2 s \(success\), before its 15-minute budget; the secret was refused: check CLAUDE_CODE_OAUTH_TOKEN/m);
  assert.match(red.out, /It said: "Invalid API key · Please run \/login"$/m);
  assert.doesNotMatch(red.out, /acme private session text/, 'never the session\'s messages');
  assert.equal(red.out.trim().split('\n').length, 1, 'one line');
  const none = await step(t, dir, 'Did the agent run?', env({ OUTCOME: 'failure', EXECUTION: '' }));
  assert.equal(none.status, 1);
  assert.match(none.out, /Claude did not start: the agent step ended failure after \d+ s, before its 15-minute budget, with no result/);
  const timeout = await step(t, dir, 'Did the agent run?', env({ OUTCOME: 'failure', EXECUTION: join(temp, 'none.json'), STARTED: String(now - 15 * 60) }));
  assert.equal(timeout.status, 0, timeout.out);
  assert.match(timeout.out, /ran out its budget/);
  await writeFile(file, execution({ is_error: false, num_turns: 12, duration_ms: 300_000, result: 'Checked the lid. One P2.' }));
  const fine = await step(t, dir, 'Did the agent run?', env({ STARTED: String(now - 300) }));
  assert.equal(fine.status, 0, fine.out);
  assert.doesNotMatch(fine.out, /One P2/, 'the result text is printed only on failure');
  // A red check is not continue-on-error, so the summary step after it never runs.
  const text = await readFile(WORKFLOW, 'utf8');
  const check = /\n {6}- name: Did the agent run\?\n[\s\S]*?(?=\n {6}(?:#|- ))/.exec(text)[0];
  assert.doesNotMatch(check, /continue-on-error|\|\| true/);
  assert.ok(text.indexOf('- name: Did the agent run?') < text.indexOf('- name: Post the summary'));
});

test("agent ran: cross-review.mjs's copy of the check is climb.mjs's, function for function", async t => {
  const { m, climb } = await load(t, { climb: true });
  for (const f of ['lastResult', 'agentVerdict', 'errorText', 'errorCause']) assert.equal(m[f].toString(), climb[f].toString(), `${f} drifted from climb.mjs`);
  assert.equal(m.ERROR_CHARS, climb.ERROR_CHARS);
  // And by behaviour, on the cases phase 35 named.
  const early = { is_error: true, num_turns: 1, duration_ms: 2000, subtype: 'success', result: 'model: claude-acme-9 not_found_error' };
  for (const c of [
    { outcome: 'success', result: early, elapsedSec: 5, minutes: 15 },
    { outcome: 'failure', result: null, elapsedSec: 3, minutes: 15 },
    { outcome: 'failure', result: null, elapsedSec: 15 * 60, minutes: 15 },
    { outcome: 'success', result: { is_error: true, num_turns: 80, subtype: 'error_max_turns' }, elapsedSec: 900, minutes: 15 },
  ]) assert.deepEqual(m.agentVerdict(c), climb.agentVerdict(c));
});

test('summary: the agent\'s final message, posted as a COMMENT review on the head commit under the status marker; the budget said when it ran out', async t => {
  const m = await load(t);
  const pr = prJson();
  const r = m.summaryReview({ result: { is_error: false, result: 'Checked the lid and the hinge. One P2: the lid opens on a fork.' }, pr, minutes: 15 });
  assert.equal(r.event, 'COMMENT');
  assert.equal(r.commit_id, SHA);
  assert.deepEqual(Object.keys(r).sort(), ['body', 'commit_id', 'event']);
  assert.ok(r.body.startsWith('<!-- keel:cross-review -->\n'), 'a status board: it owes no answer');
  assert.match(r.body, /One P2: the lid opens on a fork\./);
  assert.match(m.summaryReview({ result: null, pr, minutes: 15 }).body, /ran out its 15-minute budget before writing a summary/);
  assert.match(m.summaryReview({ result: { is_error: true, result: 'Invalid API key' }, pr, minutes: 15 }).body, /ran out its 15-minute budget/, 'an error is never posted as a summary');
  assert.equal(m.summaryReview({ result: { result: 'x'.repeat(9000) }, pr, minutes: 15 }).body.length < 6300, true);

  // The workflow's step: the review JSON from the script, posted as it is, to this PR's reviews.
  const dir = await acme(t);
  const temp = join(dir, 'runner');
  await mkdir(join(temp, 'keel/scripts/keel'), { recursive: true });
  for (const f of ['cross-review.mjs', 'lib.mjs']) await cp(join(dir, 'scripts/keel', f), join(temp, 'keel/scripts/keel', f));
  await writeFile(join(temp, 'pr.json'), JSON.stringify(pr));
  await writeFile(join(temp, 'execution.json'), execution({ is_error: false, num_turns: 9, duration_ms: 60_000, result: 'Nothing found in the lid.' }));
  const gh = await stubGh(t, pr);
  const s = await step(t, dir, 'Post the summary', { PATH: `${gh.path}:${process.env.PATH}`, RUNNER_TEMP: temp, EXECUTION: join(temp, 'execution.json'), MINUTES: '15', REPO: 'acme/anvils', PR: '7' });
  assert.equal(s.status, 0, s.out);
  const [call] = await gh.calls();
  assert.deepEqual(call.args.slice(0, 4), ['api', '--method', 'POST', 'repos/acme/anvils/pulls/7/reviews']);
  assert.equal(call.input.event, 'COMMENT');
  assert.equal(call.input.commit_id, SHA);
  assert.match(call.input.body, /Nothing found in the lid\./);
});

// ---- phase 45: findings as data, and Codex -------------------------------------------

/** gh pr diff's answer for the Acme PR: lid.js changed (lines 10-14 and 40-42 on the new side), a deleted file, a binary one. */
const DIFF = [
  'diff --git a/src/lid.js b/src/lid.js',
  'index 1111111..2222222 100644',
  '--- a/src/lid.js',
  '+++ b/src/lid.js',
  '@@ -10,4 +10,5 @@ export function open(lid) {',
  '   const hinge = lid.hinge;',
  '-  hinge.turn();',
  '+  if (!hinge) return;',
  '+  hinge.turn(90);',
  '   return lid;',
  ' }',
  '@@ -40,2 +41,2 @@',
  '-const OLD = 1;',
  '+const NEW = 2;',
  ' export default open;',
  '\\ No newline at end of file',
  'diff --git a/src/old.js b/src/old.js',
  'deleted file mode 100644',
  '--- a/src/old.js',
  '+++ /dev/null',
  '@@ -1,1 +0,0 @@',
  '-gone',
  'diff --git a/logo.png b/logo.png',
  'Binary files a/logo.png and b/logo.png differ',
  '',
].join('\n');

const final = (summary, findings) => `${summary}\n\n\`\`\`json\n${JSON.stringify(findings, null, 2)}\n\`\`\`\n`;

test('findings: the diff\'s hunks are the lines a comment may sit on; the JSON block is the last fenced json, the summary the rest', async t => {
  const m = await load(t);
  const r = m.diffRanges(DIFF);
  assert.deepEqual([...r.keys()], ['src/lid.js'], 'a deleted file and a binary one have no lines to comment on');
  assert.deepEqual(r.get('src/lid.js'), [[10, 14], [41, 42]]);
  assert.deepEqual(m.findingsOf('Checked the lid. Nothing found.'), { summary: 'Checked the lid. Nothing found.', findings: [], problem: null }, 'prose alone: the summary');
  const f = m.findingsOf(final('Checked the lid. One P2.', [{ path: 'src/lid.js', line: 12, severity: 'P2', body: 'x' }]));
  assert.equal(f.summary, 'Checked the lid. One P2.');
  assert.deepEqual(f.findings, [{ path: 'src/lid.js', line: 12, severity: 'P2', body: 'x' }]);
  assert.match(m.findingsOf('Summary.\n```json\n{ not json\n```').problem, /^the findings block is not JSON/);
  assert.equal(m.findingsOf('Summary.\n```json\n{"path": "a"}\n```').problem, 'the findings block is not a JSON array');
  // Two blocks: the last is the findings (an example quoted earlier is summary text).
  assert.deepEqual(m.findingsOf('Saw ```json\n[1]\n``` in the docs.\n```json\n[]\n```').findings, []);
});

test('findings: valid ones become inline comments in one COMMENT review; a path outside the diff, a line out of range, an unknown severity is dropped and named; prose alone posts the summary alone', async t => {
  const m = await load(t);
  const pr = prJson();
  const findings = [
    { path: 'src/lid.js', line: 12, severity: 'P1', body: 'The hinge is never checked before turn(90): a lid with no hinge throws at src/lid.js:12.' },
    { path: 'src/lid.js', line: 41, severity: 'P3', body: 'NEW is never read.' },
    { path: 'src/base.js', line: 3, severity: 'P2', body: 'Outside the diff.' },
    { path: 'src/lid.js', line: 30, severity: 'P2', body: 'Between the hunks.' },
    { path: 'src/lid.js', line: 11, severity: 'P0', body: 'An unknown severity.' },
    { path: 'src/lid.js', line: 11, severity: 'P2', body: '  ' },
    { path: 'src/old.js', line: 1, severity: 'P2', body: 'A deleted file.' },
    'a string',
  ];
  const review = m.summaryReview({ result: { is_error: false, result: final('Checked the lid and its hinge. One P1, one P3.', findings) }, pr, minutes: 15, diff: DIFF });
  assert.equal(review.event, 'COMMENT');
  assert.equal(review.commit_id, SHA);
  assert.deepEqual(review.comments, [
    { path: 'src/lid.js', line: 12, side: 'RIGHT', body: `${m.FINDING_MARKER}\n**P1** The hinge is never checked before turn(90): a lid with no hinge throws at src/lid.js:12.` },
    { path: 'src/lid.js', line: 41, side: 'RIGHT', body: `${m.FINDING_MARKER}\n**P3** NEW is never read.` },
  ]);
  assert.ok(review.body.startsWith(`${m.MARKER}\n**Cross-review** by Claude of aaaaaaa`));
  assert.match(review.body, /Checked the lid and its hinge\. One P1, one P3\./);
  assert.doesNotMatch(review.body, /```json/, 'the findings block is not the summary');
  assert.match(review.body, /Dropped \(6, not posted inline\):\n- `src\/base\.js:3`: its path is not in the pull request's diff\n- `src\/lid\.js:30`: its line is outside the diff's hunks for that file\n- `src\/lid\.js:11`: its severity "P0" is not P1, P2, P3\n- `src\/lid\.js:11`: it has no body\n- `src\/old\.js:1`: its path is not in the pull request's diff\n- finding 8: not an object/);
  // Prose with no JSON block: the summary alone, no comments key (as before phase 45).
  const prose = m.summaryReview({ result: { is_error: false, result: 'Checked the lid. Nothing found.' }, pr, minutes: 15, diff: DIFF });
  assert.deepEqual(Object.keys(prose).sort(), ['body', 'commit_id', 'event']);
  assert.doesNotMatch(prose.body, /Dropped|could not be read/);
  // A block that is not JSON: the summary, and why nothing is inline.
  assert.match(m.summaryReview({ message: 'Summary.\n```json\n[{ oops\n```', agent: 'codex', pr, minutes: 15, diff: DIFF }).body, /Its findings could not be read: the findings block is not JSON/);
  // No diff (gh could not read it): every finding dropped, named.
  const blind = m.summaryReview({ message: final('S.', findings.slice(0, 1)), agent: 'codex', pr, minutes: 15, diff: null });
  assert.equal(blind.comments, undefined);
  assert.match(blind.body, /- `src\/lid\.js:12`: the pull request's diff could not be read/);
  // Codex's final message is the review, under its own name.
  const codex = m.summaryReview({ message: final('Codex checked the lid.', findings.slice(0, 1)), agent: 'codex', pr, minutes: 15, diff: DIFF });
  assert.match(codex.body, /\*\*Cross-review\*\* by Codex of aaaaaaa/);
  assert.equal(codex.comments.length, 1);
  // GitHub refused the inline comments: the same review, the findings in its body.
  const plain = m.summaryReview({ message: final('S.', findings.slice(0, 2)), agent: 'codex', pr, minutes: 15, diff: DIFF, inline: false });
  assert.equal(plain.comments, undefined);
  assert.match(plain.body, /GitHub refused the inline comments; the findings \(2\), to answer here:\n- `src\/lid\.js:12` \*\*P1\*\* The hinge/);
  // Past the cap: dropped and named. A long body is cut.
  const many = Array.from({ length: m.MAX_FINDINGS + 2 }, () => ({ path: 'src/lid.js', line: 10, severity: 'P3', body: 'y'.repeat(5000) }));
  const capped = m.checkFindings(many, m.diffRanges(DIFF));
  assert.equal(capped.kept.length, m.MAX_FINDINGS);
  assert.deepEqual(capped.dropped.map(d => d.why), [`more than ${m.MAX_FINDINGS} findings`, `more than ${m.MAX_FINDINGS} findings`]);
  assert.equal(capped.kept[0].body.length, m.FINDING_CHARS);
  // The night counts these: the marker it looks for is this one.
  const improve = await import(pathToFileURL(join(NIGHT, 'improve.mjs')).href);
  assert.equal(improve.CROSS_REVIEW_FINDING, m.FINDING_MARKER);
});

test('the workflow with Codex: Codex reviews Claude\'s claude/ PRs, Claude Codex\'s; no secret for the reviewer is a notice and green; the brief points at the diff it wrote; the review posts its findings inline, or in its summary when GitHub refuses them', async t => {
  const both = { for: ['codex/', 'claude/'], budget: { minutes: 15 } };
  const dir = await acme(t, { crossReview: both });
  const config = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...config, agents: { claude: {}, codex: {} } }));
  const on = await step(t, dir, 'Is cross-review on?');
  assert.deepEqual(on.outputs, { on: 'true', agents: 'claude,codex' });
  // Configured?: on when any listed provider has its secret; none, a notice and green.
  const none = await step(t, dir, 'Configured?', { AGENTS: 'claude,codex', OAUTH: '', API_KEY: '', OPENAI: '' });
  assert.equal(none.status, 0, none.out);
  assert.match(none.out, /^::notice::Skipped: add a reviewer's secret for a cross-review to run: CLAUDE_CODE_OAUTH_TOKEN \(or ANTHROPIC_API_KEY\) for Claude, OPENAI_API_KEY for Codex\.$/m);
  assert.equal(none.outputs.enabled, 'false');
  assert.equal((await step(t, dir, 'Configured?', { AGENTS: 'claude,codex', OAUTH: '', API_KEY: '', OPENAI: 'acme-openai' })).outputs.enabled, 'true');
  assert.equal((await step(t, dir, 'Configured?', { AGENTS: 'claude,codex', OAUTH: 'acme-token', API_KEY: '', OPENAI: '' })).outputs.enabled, 'true');
  const codexOnly = await step(t, dir, 'Configured?', { AGENTS: 'codex', OAUTH: 'acme-token', API_KEY: '', OPENAI: '' });
  assert.match(codexOnly.out, /^::notice::Skipped: add the OPENAI_API_KEY secret for a cross-review by Codex to run\.$/m);
  assert.equal(codexOnly.outputs.enabled, 'false', 'Claude\'s secret does not run Codex');
  assert.equal((await step(t, dir, 'Configured?', { AGENTS: 'claude', OAUTH: '', API_KEY: '', OPENAI: 'acme-openai' })).outputs.enabled, 'false', 'OpenAI\'s key does not run Claude');

  // Which: Claude's PR (claude/) goes to Codex; its secret missing is a notice, no review.
  const pr = prJson({ headRefName: 'claude/anvil-lid' });
  const gh = await stubGh(t, pr, { diff: DIFF, refuseInline: true });
  const temp = join(dir, 'runner');
  await mkdir(temp, { recursive: true });
  const env = { PATH: `${gh.path}:${process.env.PATH}`, RUNNER_TEMP: temp, PR: '7', REPO: 'acme/anvils' };
  const skipped = await step(t, dir, 'Which pull request?', { ...env, EVENT: 'pull_request', ACTION: 'opened', HAS_CLAUDE: 'true', HAS_CODEX: 'false' });
  assert.equal(skipped.status, 0, skipped.out);
  assert.equal(skipped.outputs.review, 'false');
  assert.match(skipped.out, /^::notice::Skipped: #7 on claude\/anvil-lid is reviewed by Codex \(written by claude \(claude\/\): reviewed by codex, the first other provider "agents" lists\); add the OPENAI_API_KEY secret for it to run\.$/m);
  const which = await step(t, dir, 'Which pull request?', { ...env, EVENT: 'pull_request', ACTION: 'opened', HAS_CLAUDE: 'true', HAS_CODEX: 'true' });
  assert.equal(which.status, 0, which.out);
  assert.equal(which.outputs.agent, 'codex');
  assert.equal(which.outputs.author, 'claude');
  // And Codex's PR (codex/) goes to Claude, in the same project.
  const ghCodex = await stubGh(t, prJson(), { diff: DIFF });
  await mkdir(join(temp, 'b'), { recursive: true });
  const back = await step(t, dir, 'Which pull request?', { ...env, PATH: `${ghCodex.path}:${process.env.PATH}`, RUNNER_TEMP: join(temp, 'b'), EVENT: 'pull_request', ACTION: 'opened', HAS_CLAUDE: 'true', HAS_CODEX: 'true' });
  assert.equal(back.status, 0, back.out);
  assert.deepEqual([back.outputs.agent, back.outputs.author], ['claude', 'codex']);
  // Brief: the diff, read before the agent, and a prompt that points Codex at it (no network in its sandbox).
  const brief = await step(t, dir, 'Brief', { ...env, AGENT: 'codex' });
  assert.equal(brief.status, 0, brief.out);
  assert.equal(await readFile(join(temp, 'pr.diff'), 'utf8'), DIFF);
  const prompt = await readFile(join(temp, 'prompt.md'), 'utf8');
  assert.match(prompt, new RegExp(`- Read it: the diff is ${join(temp, 'pr.diff').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, and the pull request \\(its title and body\\) is .*pr\\.json; this sandbox has no network`));
  assert.doesNotMatch(prompt, /gh pr diff 7/);
  // Claude's brief still reads with gh.
  const claudeBrief = cli(dir, ['brief', '--pr', join(temp, 'pr.json'), '--out', join(temp, 'claude.md')]);
  assert.equal(claudeBrief.status, 0, claudeBrief.stderr);
  assert.match(await readFile(join(temp, 'claude.md'), 'utf8'), /- Read it: `gh pr view 7` and `gh pr diff 7`/);

  // Post: Codex's final message; GitHub refuses the inline comments (422), so the plain review goes, findings in its body.
  await writeFile(join(temp, 'codex-final-message.md'), final('Codex checked the lid. One P1.', [{ path: 'src/lid.js', line: 12, severity: 'P1', body: 'The hinge is unchecked.' }, { path: 'src/nope.js', line: 1, severity: 'P2', body: 'x' }]));
  const post = await step(t, dir, 'Post the summary', { ...env, AGENT: 'codex', EXECUTION: '', MINUTES: '15' });
  assert.equal(post.status, 0, post.out);
  assert.match(post.out, /::warning::GitHub refused the review with its inline comments/);
  const calls = (await gh.calls()).filter(c => c.args[0] === 'api');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].input.comments, [{ path: 'src/lid.js', line: 12, side: 'RIGHT', body: '<!-- keel:cross-review finding -->\n**P1** The hinge is unchecked.' }]);
  assert.equal(calls[0].input.event, 'COMMENT');
  assert.match(calls[0].input.body, /- `src\/nope\.js:1`: its path is not in the pull request's diff/);
  assert.equal(calls[1].input.comments, undefined);
  assert.equal(calls[1].input.event, 'COMMENT');
  assert.match(calls[1].input.body, /GitHub refused the inline comments; the findings \(1\)/);

  // A diff gh cannot read: a warning, an empty diff, and the review still posts (its findings named, not inline).
  const blind = await stubGh(t, pr, { diff: null });
  const b = await step(t, dir, 'Brief', { ...env, PATH: `${blind.path}:${process.env.PATH}`, AGENT: 'codex' });
  assert.equal(b.status, 0, b.out);
  assert.match(b.out, /::warning::The pull request's diff could not be read/);
  const bp = await step(t, dir, 'Post the summary', { ...env, PATH: `${blind.path}:${process.env.PATH}`, AGENT: 'codex', EXECUTION: '', MINUTES: '15' });
  assert.equal(bp.status, 0, bp.out);
  const [only] = (await blind.calls()).filter(c => c.args[0] === 'api');
  assert.equal(only.input.comments, undefined);
  assert.match(only.input.body, /the pull request's diff could not be read/);
});

test('the workflow with Claude: its findings JSON is posted inline by keel\'s step, as Codex\'s are', async t => {
  const dir = await acme(t);
  const pr = prJson();
  const gh = await stubGh(t, pr, { diff: DIFF });
  const temp = join(dir, 'runner');
  await mkdir(join(temp, 'keel/scripts/keel'), { recursive: true });
  for (const f of ['cross-review.mjs', 'lib.mjs']) await cp(join(dir, 'scripts/keel', f), join(temp, 'keel/scripts/keel', f));
  await writeFile(join(temp, 'pr.json'), JSON.stringify(pr));
  await writeFile(join(temp, 'pr.diff'), DIFF);
  await writeFile(join(temp, 'execution.json'), execution({ is_error: false, num_turns: 9, duration_ms: 60_000, result: final('Checked the lid. One P3.', [{ path: 'src/lid.js', line: 42, severity: 'P3', body: 'NEW is never read.' }]) }));
  const s = await step(t, dir, 'Post the summary', { PATH: `${gh.path}:${process.env.PATH}`, RUNNER_TEMP: temp, AGENT: 'claude', EXECUTION: join(temp, 'execution.json'), MINUTES: '15', REPO: 'acme/anvils', PR: '7' });
  assert.equal(s.status, 0, s.out);
  const [call] = await gh.calls();
  assert.deepEqual(call.input.comments, [{ path: 'src/lid.js', line: 42, side: 'RIGHT', body: '<!-- keel:cross-review finding -->\n**P3** NEW is never read.' }]);
  assert.match(call.input.body, /by Claude of aaaaaaa/);
  // The brief tells the agent how to write them, and no longer names the comment tool.
  const brief = await readFile(join(PRACTICE, '.agents/cross-review/REVIEW.md'), 'utf8');
  assert.match(brief, /```json\n\[\n  \{ "path": "src\/lid\.js", "line": 42, "severity": "P2", "body": /);
  assert.doesNotMatch(brief, /mcp__github_inline_comment/);
});

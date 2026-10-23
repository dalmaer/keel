// The plates skill (phase 19): the door, not the room. It says what plates is,
// how to install it, and "run plates --agent-help" — and nothing about the CLI
// that could age, because a skill sits in a directory for months while the
// CLI moves on (lessons 1 and 16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { run } from './helpers/run.mjs';
import { mkdtemp, mkdir, readFile, rm, lstat, realpath, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(PLATES, 'bin', 'plates.mjs');
const SKILL = join(PLATES, 'practices', 'agents-md', 'files', '.agents', 'skills', 'plates', 'SKILL.md');
const BUDGET = 180;
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1',
};
const plates = (args, cwd) => {
  const r = run(process.execPath, [BIN, ...args], { cwd, env: ENV });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

/** { front: {key: value}, body } of a SKILL.md, or throws. */
function parseSkill(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error('no front matter');
  const front = Object.fromEntries(m[1].split('\n').map(l => /^([\w-]+):\s*(.*)$/.exec(l)).filter(Boolean).map(([, k, v]) => [k, v.trim()]));
  return { front, body: m[2] };
}

/** The words of the body, as wc -w counts them. */
const words = body => body.split(/\s+/).filter(Boolean).length;

/**
 * Every `plates <word>` in the body that isn't `plates --agent-help`. A verb named
 * here is a copy of the CLI that ages; the verbs live in --agent-help. `plates`
 * alone, or as part of a path or URL (dalmaer/plates), is fine.
 */
const verbMentions = body =>
  [...body.matchAll(/(?<![\w/.-])plates[ \t]+([^\s`]+)/g)].map(m => m[1]).filter(w => w !== '--agent-help');

test('the plates skill has valid front matter: name plates and a one-sentence description', async () => {
  const { front } = parseSkill(await readFile(SKILL, 'utf8'));
  assert.equal(front.name, 'plates');
  assert.ok(front.description, 'a description');
  assert.ok(front.description.length <= 1024, 'description within the Agent Skills limit');
  assert.match(front.description, /\.plates\/plates\.json/, 'it triggers in a plates project');
  for (const w of ['phases', 'roadmap', 'lessons', 'night shift']) assert.ok(front.description.includes(w), `it triggers on ${w}`);
});

test(`the plates skill stays short (≤ ${BUDGET} words) and names no verb but --agent-help`, async () => {
  const { body } = parseSkill(await readFile(SKILL, 'utf8'));
  assert.ok(words(body) <= BUDGET, `${words(body)} words; the budget is ${BUDGET}`);
  assert.match(body, /plates --agent-help/);
  assert.match(body, /git clone https:\/\/github\.com\/dalmaer\/plates/);
  assert.match(body, /npm install -g/);
  assert.match(body, /npx -y github:dalmaer\/plates --agent-help/, 'a way in with nothing installed (phase 23)');
  assert.match(body, /Read `\{\{guide\}\}`/, 'the doorway names the selected guide when rendered');
  assert.match(body, /docs\/ROADMAP\.md/);
  assert.deepEqual(verbMentions(body), []);
});

test('the guard bites: a copied verb or a longer skill fails', async () => {
  const { body } = parseSkill(await readFile(SKILL, 'utf8'));
  assert.deepEqual(verbMentions(body + '\nThen run `plates adopt`.\n'), ['adopt']);
  assert.deepEqual(verbMentions(body + '\nplates status --json\n'), ['status']);
  assert.ok(words(body + ' word'.repeat(BUDGET)) > BUDGET);
});

/** One plates init'd project, made once and copied per test. */
let template;
async function project(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'plates-skill-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (!template) {
    template = await realpath(await mkdtemp(join(tmpdir(), 'plates-skill-template-')));
    process.on('exit', () => rmSync(template, { recursive: true, force: true }));
    const r = plates(['init', join(template, 'acme-notes'), '--description', 'Acme Notes keeps meeting notes as plain files.', '--kind', 'node'], template);
    assert.equal(r.code, 0, r.err);
  }
  await cp(join(template, 'acme-notes'), join(dir, 'acme-notes'), { recursive: true, verbatimSymlinks: true });
  return join(dir, 'acme-notes');
}

test('a fresh plates init project carries the skill, filled, and the .claude/skills/plates link resolves to it', async t => {
  const dir = await project(t);
  const text = await readFile(join(dir, '.agents', 'skills', 'plates', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(text, /\{\{/, 'every placeholder filled');
  assert.match(text, /acme-notes is run with plates/);
  assert.match(text, /`npm run check` is the gate/);
  assert.ok((await lstat(join(dir, '.claude', 'skills', 'plates'))).isSymbolicLink());
  assert.equal(await readFile(join(dir, '.claude', 'skills', 'plates', 'SKILL.md'), 'utf8'), text);
  const doctor = JSON.parse(plates(['doctor', '--json'], dir).out);
  assert.deepEqual(doctor.lint.filter(l => l.path.includes('skills/plates')), []);
});

test('doctor lints a second copy of the plates skill', async t => {
  const dir = await project(t);
  await mkdir(join(dir, '.codex', 'skills', 'plates'), { recursive: true });
  await cp(join(dir, '.agents', 'skills', 'plates', 'SKILL.md'), join(dir, '.codex', 'skills', 'plates', 'SKILL.md'));
  const r = plates(['doctor', '--json'], dir);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.out).lint.map(l => `${l.rule} ${l.path}`), ['second-copy .codex/skills/plates/SKILL.md']);
});

test('plates carries its own copy (render --self)', async () => {
  const mine = await readFile(join(PLATES, '.agents', 'skills', 'plates', 'SKILL.md'), 'utf8');
  assert.equal(parseSkill(mine).front.name, 'plates');
  assert.ok((await lstat(join(PLATES, '.claude', 'skills', 'plates'))).isSymbolicLink());
});

// The conduct skill (phase 23): what a fresh agent had to guess, said.
test('the spin skill covers no remote, missing docs, small phases, and records before the one gate run', async () => {
  const text = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  const section = n => text.slice(text.indexOf(`\n## ${n}.`), text.indexOf('\n## ', text.indexOf(`\n## ${n}.`) + 1));
  assert.match(text, /If `git remote` prints nothing, skip every pull, push and CI/);
  assert.match(text, /the walk ends at the local commit/);
  assert.match(section(2), /`git pull --ff-only` \*\*first\*\*, if there is a remote/);
  assert.match(section(4), /With no remote, stop at the local commit/);
  assert.match(text, /if\s+the project has one, is the argument/);
  assert.match(text, /the README \(if the project has one\)/);
  assert.match(text, /\*\*Small phases\.\*\*[\s\S]*built by the conductor/);
  // Status first; the whole check after the record, not in Verify.
  assert.match(section(3), /^[\s\S]*?\n- \*\*Set the phase's `status:`\*\*/);
  assert.equal(section(3).match(/\n- /).index, section(3).indexOf("\n- **Set the phase's `status:`**"), 'status is the first bullet');
  assert.doesNotMatch(section(2), /\*\*The whole check, once\*\*/);
  assert.ok(section(3).indexOf('**the whole check, once**') > section(3).indexOf('npm run roadmap'), 'the gate runs after the record');
  assert.match(section(3), /\{\{check\}\}/);
  assert.match(section(4), /Commit the\s+tree the gate just checked/);
  // Third walk: the record can't hold what only exists after it.
  assert.match(section(3), /names the gate \*\*command\*\*\s+\(`\{\{check\}\}`\) and what it covers/);
  assert.match(section(3), /gate's result line\s+\(exit code, test count\) goes in the commit body/);
  assert.match(section(4), /carries the gate's result line/);
  assert.match(section(3), /\*\*Proofs that need the commit\*\*[\s\S]*?status `partial`[\s\S]*?Walk them right after the commit[\s\S]*?in the next\s+commit/);
  assert.match(section(4), /\*\*Proofs that need the commit\*\*[\s\S]*?record them in the next commit/);
  assert.match(section(3), /once it\s+is built, `None\.` \(or what lived-in needs, when the project counts it/);
  assert.match(section(4), /`phase <N>: <heading>`, where the heading is the phase file's\s+`# ` heading, word for word: it is the source/);
});

// The retro after real work (phase 40): step 5, after the commit.
test('the spin skill ends real work with a retro: the worksheet, the seven areas, typed candidates, the owner picks', async () => {
  const text = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  const at = text.indexOf('\n## 5. Retro');
  assert.ok(at > text.indexOf('\n## 4. Commit'), '§5 comes after §4');
  const five = text.slice(at, text.indexOf('\n## ', at + 1));
  assert.match(five, /plates retro --worksheet --since/);
  assert.match(five, /more than\s+`docs\/`/);
  for (const area of ['navigation', 'automatable\\s+checks', 'missing standards', '\\{\\{guide\\}\\} health', 'tool economy', 'no-op\\s+instructions', 'information gaps']) {
    assert.match(five, new RegExp(area), area);
  }
  assert.match(five, /\*\*seven areas\*\*/);
  assert.match(five, /at most five candidates/);
  assert.match(five, /most serious first/);
  assert.match(five, /\*\*check\*\*/);
  assert.match(five, /\*\*guide\/skill line\*\*/);
  assert.match(five, /\*\*lesson\*\*[\s\S]*plates learn/);
  assert.match(five, /\*\*The owner picks\.\*\* (?:\(why: [^)\n]+\) )?Nothing is applied unpicked/);
  assert.match(five, /Never run a retro from the night or a\s+climb/);
  // The sections before it are intact.
  for (const n of [0, 1, 2, 3, 4]) assert.ok(text.includes(`\n## ${n}.`), `§${n} kept`);
});

// Phase 41: every review comment is validated, then answered; never left unanswered.
const spaced = text => text.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
const REVIEW_RULE = new RegExp(`${spaced('when a PR has reviews, validate each comment against the code first, then answer it with one of the three replies')};?\\s*(?:\\(fixed,[\\s\\S]*?\\)\\s*)?;?\\s*${spaced('never leave one unanswered')}`);
test('the spin skill and the climb and tend briefs say: validate each review comment, then answer it with one of the three replies', async () => {
  const skill = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  const section = n => skill.slice(skill.indexOf(`\n## ${n}.`), skill.indexOf('\n## ', skill.indexOf(`\n## ${n}.`) + 1));
  for (const n of [4, 5]) assert.match(section(n), REVIEW_RULE, `§${n}`);
  for (const form of [/--fixed <commit>/, /--tracked <#issue\|vX\.Y\.Z>/, /--not-valid "<why>"/]) assert.match(section(4), form);
  assert.match(section(4), /Not a gate: an open thread never refuses a merge/);
  // The opt-in: review: wait, or the issue's label; it lands through a PR and merges on --gate.
  assert.match(section(4), /`review: wait`[\s\S]*?`keel:wait-for-review`[\s\S]*?through a\s+PR[\s\S]*?`plates review <repo>#<n> --gate` exits 0/);
  assert.match(section(4), /The default is neither: no PR,\s+no wait/);
  const block = await readFile(join(PLATES, 'practices', 'conduct', 'files', 'AGENTS.block.md'), 'utf8');
  assert.match(block, new RegExp(spaced('When a PR has reviews, validate each comment against the code first, then answer it with one of the three replies')));
  assert.match(block, /never leave one unanswered/);
  for (const brief of ['PROTOCOL.md', 'TEND.md']) {
    const text = await readFile(join(PLATES, 'practices', 'climb', 'files', '.agents', 'climb', brief), 'utf8');
    assert.match(text, /## After the PR opens/, brief);
    assert.match(text, REVIEW_RULE, brief);
    assert.match(text, /plates review <repo>#<n>/, brief);
  }
});

// Phase 48: in plates itself, a practice change lands as a claude/ PR reviewed by the other provider before a release.
test('the spin skill says: in plates, a practice change lands as a claude/ PR, waits for the other provider\'s review, answers it, then merges; records and CLI-only changes may go to main', async () => {
  const skill = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  const four = skill.slice(skill.indexOf('\n## 4.'), skill.indexOf('\n## ', skill.indexOf('\n## 4.') + 1));
  const at = four.indexOf('**In plates itself, a practice change is reviewed before a release**');
  assert.ok(at > 0, 'the rule is in §4, Commit');
  const rule = four.slice(at, four.indexOf('\n\n', at));
  assert.match(rule, /`"plates": "self"`/, 'plates only: a project has no practice of its own to release');
  assert.match(rule, /`practices\/`,\s+`migrations\/` or `docs\/lessons\.md`/, 'the release gate\'s scope, named');
  assert.match(rule, /lands as\s+a `claude\/` PR/);
  assert.match(rule, /wait for the\s+other provider's review/);
  assert.match(rule, /plates review <repo>#<n> --wait/);
  assert.match(rule, /Answer every comment/);
  assert.match(rule, /Merge when every comment is answered\s+and someone other than the PR's author has reviewed its head/);
  assert.match(rule, /`plates release`\s+refuses a practice commit that came any other way/);
  assert.match(rule, /`--unreviewed "<why>"`[\s\S]*never `--yes`/);
  assert.match(rule, /Records\s+\(`docs\/phases\/`, evidence, the roadmap\) and CLI-only changes may still go to\s+`main`/);
  // plates's own copy is rendered from it, and plates's own cross-review is on: Codex reviews the conductor's claude/ PRs.
  assert.ok((await readFile(join(PLATES, '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8')).includes('**In plates itself, a practice change is reviewed before a release**'));
  const config = JSON.parse(await readFile(join(PLATES, '.plates', 'plates.json'), 'utf8'));
  assert.ok(config.practices.includes('cross-review'));
  assert.deepEqual(config.agents, { claude: {}, codex: {} });
  assert.deepEqual([...config.crossReview.for].sort(), ['claude/', 'codex/']);
  const { reviewerOf } = await import('../practices/night/files/scripts/plates/lib.mjs');
  assert.equal(reviewerOf({ config, head: 'claude/phase-48' }).reviewer, 'codex');
  assert.equal(reviewerOf({ config, head: 'codex/fix' }).reviewer, 'claude');
});

// Phase 71: at the round limit the conductor stops pushing fixes and reports; it never merges.
test('the spin skill says: at the review-round limit stop pushing fixes, sort the open findings, report the choice, never merge', async () => {
  const skill = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  const four = skill.slice(skill.indexOf('\n## 4.'), skill.indexOf('\n## ', skill.indexOf('\n## 4.') + 1));
  const at = four.indexOf('**A review that keeps going is the owner\'s.**');
  assert.ok(at > four.indexOf('Not a gate: an open thread never refuses a merge'), 'in §4, after the answering rule');
  const rule = four.slice(at, four.indexOf('\n\n', at));
  assert.match(rule, /\(why: [^)\n]+\)/);
  assert.match(rule, /A round is one push a reviewer answered with a finding/);
  assert.match(rule, /`plates review <repo>#<n>` exits 3/);
  // The config key, in two parts (the gh-verb scan of test sources reads a quoted verb beside the CLI's name as a run of it).
  assert.match(rule, /exits 3[\s\S]*round limit \(three unless `[^`]+` `"\w+": \{"rounds": N\}`/);
  assert.ok(rule.includes('`"review": {"rounds": N}`'));
  assert.match(rule, /stop pushing fixes/);
  assert.match(rule, /`plates review <repo>#<n> --class security\|overwrite\|approval\|other <ids>`\s+\(it records the kind and answers nothing\)/);
  assert.match(rule, /report the choice it prints\s+to the owner: merge with the rest tracked, split, or close/);
  assert.match(rule, /Never merge it\s+yourself/);
  // plates's own copy is rendered from it.
  assert.ok((await readFile(join(PLATES, '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8')).includes(rule));
});

// ledger #60, #73, #74: the conduct skill assumes nothing a project with its own roadmap lacks, and agrees with the AGENTS block.
test('the spin skill reads the project\'s roadmap command, says whose check guards a stale status, and the AGENTS block names the small-phase exception', async () => {
  const skill = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  const section = n => skill.slice(skill.indexOf(`\n## ${n}.`), skill.indexOf('\n## ', skill.indexOf(`\n## ${n}.`) + 1));
  // §0: plates's commands only when plates's phases practice is on; a local roadmap is read from the project's own scripts.
  assert.match(section(0), /The roadmap command is the project's, never assumed/);
  // cajones has plates's phases but no `next` alias: the script itself is the command, the alias only where it exists.
  assert.match(section(0), /`"practices"` lists `phases`[\s\S]*?`node\s+scripts\/roadmap\.mjs --next`[\s\S]*?where `package\.json` has\s+that alias/);
  assert.match(section(0), /`"local"` names `phases`[\s\S]*?`package\.json`[\s\S]*?`next`, else `roadmap`/);
  assert.doesNotMatch(section(0), /```sh\nnpm run next/, 'no bare npm run next for every project');
  // §3: the stale-status guard is plates's roadmap check's, and a project's own roadmap is checked by hand.
  assert.match(section(3), /plates's roadmap check \(`scripts\/roadmap\.mjs`\) fails a\s+phase whose boxes are all checked/);
  assert.match(section(3), /a project's own roadmap may not check it, so check it\s+yourself/);
  // #74: both say a small phase may be built by the conductor.
  assert.match(skill, /\*\*Small phases\.\*\*[\s\S]*built by the conductor/);
  const block = await readFile(join(PLATES, 'practices', 'conduct', 'files', 'AGENTS.block.md'), 'utf8');
  assert.match(block, /briefs\s+a builder \(a phase of a file or two it may build itself: the skill's \*Small\s+phases\*\)/);
});

// Codex on cajones#53 and ledger#97: /conduct <N> honours a walk owed; a project with its own phases keeps its own rules.
test('the spin skill treats owes: walk as done for /spin <N>, and leaves a local roadmap\'s rules alone', async () => {
  const skill = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  assert.match(skill, /`\/spin <N>`[\s\S]*?a partial phase marked `owes: walk` counts as done here/);
  assert.match(skill, /\*\*Its dependencies are built\.\*\*[^\n]*a partial one marked `owes: walk` counts as built here/, 'the §0 gate too (Codex on duo#81)');
  assert.match(skill, /keeps its own phases \(`"local"`\s+names `phases`\) follows its own roadmap's rules for both/);
});

// Phase 70: two sessions built phase 54 at once. The claim comes before the build.
test('the spin skill claims a phase before it builds: plates phase claim first, a refusal means another phase or stop, never release another\'s claim', async () => {
  const skill = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  const orient = skill.slice(skill.indexOf('\n## 0.'), skill.indexOf('\n## 1.'));
  assert.match(orient, /\*\*Claim the phase before you build it\.\*\* \(why: [^)\n]+\)/);
  assert.match(orient, /the first step for a phase is `plates phase claim <N>`, before the brief/);
  assert.match(orient, /A refusal names who holds the phase: take another free\s+phase, or stop/);
  assert.match(orient, /never release a claim that\s+is not yours: a stale one is the owner's, on the board/);
  assert.match(orient, /If the claims could\s+not be read, stop and say so/);
  // The claim is said before the brief and before the gates that precede any code.
  assert.ok(skill.indexOf('**Claim the phase before you build it.**') < skill.indexOf('**Three gates before any code:**'));
  assert.ok(skill.indexOf('**Claim the phase before you build it.**') < skill.indexOf('\n## 1. Brief'));
  // plates's own copy says it too (render --self).
  assert.ok((await readFile(join(PLATES, '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8')).includes('the first step for a phase is `plates phase claim <N>`'));
});

// Phase 62: a fix is proven by its test failing without it, and the commit says so.
test('the spin skill and its AGENTS block say a fix: commit carries a Proven-by: trailer from plates prove', async () => {
  const skill = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  const commit = skill.slice(skill.indexOf('\n## 4.'), skill.indexOf('\n## 5.'));
  assert.match(commit, /\*\*A fix is proven by its test failing without it\.\*\* (?:\(why: [^)\n]+\) )?A `fix:` commit\s+carries a `Proven-by:` trailer, from `plates prove <test> --fix <the fix's\s+files> --trailer`/);
  assert.match(commit, /Only\s+VERIFIED proves the fix\. NOT WORKING means the test does not catch the bug/);
  assert.match(commit, /never touches the tree/);
  assert.match(commit, /Never write the\s+trailer by hand/);
  const block = await readFile(join(PLATES, 'practices', 'conduct', 'files', 'AGENTS.block.md'), 'utf8');
  assert.match(block, /A `fix:` commit\s+carries a `Proven-by:` trailer from `plates prove <test> --fix <files>\s+--trailer`/);
  // plates's own copies say it too (render --self).
  assert.ok((await readFile(join(PLATES, '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8')).includes('carries a `Proven-by:` trailer'));
  assert.match(await readFile(join(PLATES, 'AGENTS.md'), 'utf8'), /A `fix:` commit\s+carries a `Proven-by:` trailer/);
});

// Phase 87: the builder restates done first and reports in one shape; the conductor checks the shape before anything runs.
test('the spin skill\'s brief asks for the restatement and the report shape, and its verify step names the checks', async () => {
  const skill = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  const section = n => skill.slice(skill.indexOf(`\n## ${n}.`), skill.indexOf('\n## ', skill.indexOf(`\n## ${n}.`) + 1));
  // The brief's template has its own `## ` headings, so §1 runs to §2.
  const brief = skill.slice(skill.indexOf('\n## 1.'), skill.indexOf('\n## 2.')), fence = brief.slice(brief.indexOf('```\n'), brief.indexOf('\n```', brief.indexOf('```\n') + 4));
  // The brief ends with the restatement, before any code.
  const last = fence.slice(fence.lastIndexOf('\n## '));
  assert.match(last, /^\n## Before any code\nRestate the success criteria in your own words before writing code\.\s*$/);
  // The report: fixed sections, in order, the restatement first.
  const report = fence.slice(fence.indexOf('## What you return'), fence.indexOf('## Before any code'));
  assert.match(report, /these sections in this order/);
  const order = [/\n0\. Done means: your restatement/, /\n1\. What changed: the files and commits/, /\n2\. Each acceptance box: the test that proves it[\s\S]*?or why\s+it has none/,
    /\n3\. Focused tests: each command you ran, from the repo root, with its exit\s+code/, /\n4\. Decisions the spec left open/, /\n5\. What remains/];
  let at = -1;
  for (const re of order) {
    const m = re.exec(report);
    assert.ok(m, `${re} in the report`);
    assert.ok(m.index > at, `${re} in order`);
    at = m.index;
  }
  // Builders still test by file; the whole check is the conductor's.
  assert.match(report, /not the whole check/);
  assert.match(brief, /Do NOT run the whole check \(`\{\{check\}\}`\): the\s+conductor runs it once on the integrated tree/);
  // Verify: the restatement first, then the boxes and the exit codes, before anything runs; the gate stays in §3.
  const verify = section(2);
  const rule = verify.slice(verify.indexOf('**Read the report\'s shape first.**'), verify.indexOf('\n\n', verify.indexOf('**Read the report\'s shape first.**')));
  assert.match(rule, /^\*\*Read the report's shape first\.\*\* \(why: [^)\n]+\)/);
  assert.match(rule, /restatement before anything else: where it differs from the phase's Done\s+when, resolve that first/);
  assert.match(rule, /check every acceptance box is addressed[\s\S]*?every\s+focused command carries its exit code/);
  assert.match(rule, /A report missing either goes back\s+down/);
  assert.match(rule, /the whole check stays yours, once, in §3/);
  assert.ok(verify.indexOf(rule) < verify.indexOf('`git pull --ff-only`'), 'the shape is read before anything runs');
  assert.doesNotMatch(verify, /\*\*The whole check, once\*\*/);
  // plates's own copy says it too (render --self).
  const mine = await readFile(join(PLATES, '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  assert.ok(mine.includes(rule));
  assert.ok(mine.includes('Restate the success criteria in your own words before writing code.'));
});

// Phase 74: /goodnight shapes tonight's plan, only when the owner asks, and writes only on "that's the plan".
test('the spin skill\'s /goodnight runs only when asked, shows the opening, shapes by the owner\'s words, and writes only on "that\'s the plan"', async () => {
  const skill = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  assert.match(parseSkill(skill).front.description, /"\/goodnight", when the owner asks to shape tonight's plan/, 'it triggers on /goodnight');
  const at = skill.indexOf('\n## /goodnight');
  assert.ok(at > 0, 'a /goodnight section');
  const end = skill.indexOf('\n## ', at + 1);
  const night = skill.slice(at, end < 0 ? undefined : end);
  assert.match(night, /\*\*Run it only when the owner asks\.\*\* \(why: [^)\n]+\)/);
  assert.match(night, /Never offer a plan unasked/);
  assert.match(night, /\*\*Show the opening\.\*\* \(why: [^)\n]+\) Run `plates goodnight`/);
  assert.match(night, /\*\*Shape it by the owner's words\.\*\* \(why: [^)\n]+\)[\s\S]*?Use their words as they said them/);
  assert.match(night, /never work around it/);
  assert.match(night, /\*\*Write it only on "that's the plan"\.\*\* \(why: [^)\n]+\) Run `plates goodnight --yes` only\s+when the owner says that's the plan/);
  assert.match(night, /Anything else,\s+including silence or leaving, writes nothing/);
  // --yes is said in that one step only: nowhere else does the skill write the plan.
  assert.equal(skill.match(/plates goodnight --yes/g).length, 1);
  assert.ok(night.includes('plates goodnight --yes'));
  // plates's own copy says it too (render --self).
  assert.ok((await readFile(join(PLATES, '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8')).includes('**Write it only on "that\'s the plan".**'));
});

// Phase 83: two changes asked for one after the other each ran the full gate. Builders and sessions finish with
// plates ready; only plates integrate runs the full gate, and "never run a build beside another" is the lock.
test('the spin skill finishes with plates ready and leaves the full gate to plates integrate', async () => {
  const skill = await readFile(join(PLATES, 'practices', 'conduct', 'files', '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  const section = n => skill.slice(skill.indexOf(`\n## ${n}.`), skill.indexOf('\n## ', skill.indexOf(`\n## ${n}.`) + 1));
  const brief = skill.slice(skill.indexOf('\n## 1.'), skill.indexOf('\n## 2.'));
  // The brief: the whole check is the integrator's, and the old sentence is the lock now.
  assert.match(brief, /with a remote, through\s+`plates integrate`/);
  assert.match(brief, /the integrator's lock\s+\(`claims\/integrate`\) lets one run at a time/);
  assert.doesNotMatch(skill, /Never run a build beside/);
  // §3: with a remote, the one full run is plates integrate's, after the commit; without one it stays here.
  assert.match(section(3), /With a remote, that one run is `plates integrate`'s, after the commit \(§4\):\s+finish with `plates ready` and leave the full gate to the integrator\. Without a\s+remote, run it here\./);
  // §4: commit on the branch, plates ready (fast checks only, never the full gate), then plates integrate, in that order.
  const four = section(4);
  const at = re => { const m = re.exec(four); assert.ok(m, String(re)); return m.index; };
  const branch = at(/commit on the phase's branch \(`<provider>\/phase-<N>`\), never\s+on `main`/);
  const readyAt = at(/\*\*Finish with `plates ready`\.\*\* \(why: [^)\n]+\) It runs only the fast checks/);
  const integrateAt = at(/\*\*Then `plates integrate`\.\*\* It takes the lock \(`claims\/integrate`\), merges\s+every ready change onto `main`, runs `\{\{check\}\}` once on the combined tree\s+and pushes it/);
  assert.ok(branch < readyAt && readyAt < integrateAt, 'branch, then ready, then integrate');
  assert.match(four, /It\s+never runs the full gate, and refuses a check that is the full gate/);
  assert.match(four, /the\s+failing one is sent back blocked, with the reason\. One sent back is yours:\s+fix it on its branch and `plates ready` again/);
  assert.match(four, /another\s+integrator holds the lock: stop there; that one takes your change too/);
  // PR #186 review: the holder drains before letting go, and a change it did not name is run again after release.
  assert.match(four, /it reads the ready changes again before it lets go\)\. If its report does\s+not name yours, run `plates integrate` again once the lock is free/);
  assert.doesNotMatch(four, /\n4\. Push, and follow CI/, 'the conductor no longer pushes main itself');
  // plates's own copy says it too (render --self).
  const own = await readFile(join(PLATES, '.agents', 'skills', 'spin', 'SKILL.md'), 'utf8');
  assert.ok(own.includes('**Finish with `plates ready`.**') && own.includes('**Then `plates integrate`.**'));
});

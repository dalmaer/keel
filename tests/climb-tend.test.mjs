// climb.mjs's tests, split from climb.test.mjs (2026-10-09) so they run in parallel.
// The synthetic Acme repo and the stubs are in tests/helpers/climb.mjs; nothing here reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp, realpath, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { KEEL, git, write, commit, acme, climb, json, load, stubGh, page, step, tendAcme, stubKeel, DISTILL, LOOP, STITCH, setConfig, LESSONS_MD, READ_LESSONS, findingText, ALPHA, BETA, GAMMA, loopInsight } from './helpers/climb.mjs';

test('tend input: one worksheet of every record measure, reconciliation and loose ends; a source that could not run is n/a with why, never empty', async t => {
  const dir = await tendAcme(t);
  const NO_KEEL = { KEEL_CLI: join(dir, 'no-such-keel') };
  const w = json(climb(dir, ['tend-input', '--json'], NO_KEEL));
  assert.deepEqual(w.measures.map(m => m.id), ['proofs_hold', 'roadmap_stale', 'phases_stuck', 'evidence_placeholders', 'drift', 'lint']);
  const proofs = w.measures.find(m => m.id === 'proofs_hold');
  assert.equal(proofs.value, 1, JSON.stringify(proofs));
  assert.deepEqual(proofs.findings.map(f => f.id), ['proofs_hold:1']);
  assert.match(proofs.findings[0].what, /^phase 1 \(docs\/phases\/01-acme-orders\.md\): proof lost: tests\/acme-orders\.test\.mjs missing/);
  assert.equal(w.count, 1);
  assert.deepEqual(w.reconciliation, { state: 'n/a', why: 'the reconciliation practice is off here', findings: [] });
  assert.equal(w.looseEnds.state, 'n/a');
  assert.match(w.looseEnds.why, /^keel is not installed here/);
  assert.equal(w.health, null);
  // Every source has a state; every n/a says why (mutation: a measure returned empty fails here).
  for (const s of [...w.measures, w.reconciliation, w.looseEnds]) {
    assert.ok(['ok', 'outside', 'n/a'].includes(s.state), JSON.stringify(s));
    if (s.state === 'n/a') assert.ok(s.why?.trim(), `n/a with no why: ${JSON.stringify(s)}`);
    else assert.ok(Number.isFinite(s.value), `a number or n/a: ${JSON.stringify(s)}`);
  }
  // The night's row rides beside each measure; loose ends from keel when it is there.
  await write(dir, { 'docs/health/2026-10-05.md': page([['proofs_hold', 2, '≤ 0', 'outside'], ['lint', 0, '≤ 0', 'ok']]) });
  const KEEL_STUB = { KEEL_CLI: await stubKeel(t, { dir, items: [{ id: 'ab12', kind: 'branch', fingerprint: 'branch:acme-old', title: 'acme-old', move: 'delete it: merged', commands: ['git branch -d acme-old'] }] }) };
  const w2 = json(climb(dir, ['tend-input', '--json'], KEEL_STUB));
  assert.equal(w2.health, 'docs/health/2026-10-05.md');
  assert.deepEqual(w2.measures.find(m => m.id === 'proofs_hold').night, { value: 2, state: 'outside', detail: 'detail' });
  assert.deepEqual(w2.looseEnds.findings, [{ id: 'loose:branch:acme-old', measure: 'loose-ends', what: 'branch: acme-old → delete it: merged (git branch -d acme-old)' }]);
  assert.equal(w2.count, 1, 'loose ends are listed, not counted as records');
  // keel#22: a loose end's command named the runner's checkout path; the PR is read on GitHub, so paths are the repo's.
  const real = await realpath(dir);
  const PATHS = { KEEL_CLI: await stubKeel(t, { dir: real, items: [{ id: 'cd34', kind: 'phase', fingerprint: 'phase:7', title: 'phase 7: Acme orders', move: 'the owner\'s step', commands: [`less ${real}/docs/phases/07-acme-orders.md`] }] }) };
  const wPaths = json(climb(dir, ['tend-input', '--json'], PATHS));
  assert.deepEqual(wPaths.looseEnds.findings.map(f => f.what), ["phase: phase 7: Acme orders → the owner's step (less docs/phases/07-acme-orders.md)"]);
  // An instrument that cannot run: the phases measures are n/a, saying why, never 0.
  await rm(join(dir, 'scripts/roadmap.mjs'));
  const w3 = json(climb(dir, ['tend-input', '--json'], NO_KEEL));
  for (const id of ['proofs_hold', 'roadmap_stale', 'phases_stuck', 'evidence_placeholders']) {
    const m = w3.measures.find(x => x.id === id);
    assert.deepEqual([m.state, m.value], ['n/a', null], id);
    assert.match(m.why, /^could not run: scripts\/roadmap\.mjs is missing/, id);
  }
  // keel's loose-ends printing nothing usable is n/a too.
  const garbled = json(climb(dir, ['tend-input', '--json'], { KEEL_CLI: await stubKeel(t, { raw: 'not json' }) }));
  assert.match(garbled.looseEnds.why, /printed no JSON/);
  // The text form names each source.
  const text = climb(dir, ['tend-input'], NO_KEEL).stdout;
  assert.match(text, /^ {2}loose-ends: n\/a: keel is not installed here/m);
});

test('tend guard: refuses an evidence edit, a status marked built, a ticked acceptance box, a deletion and an uncited commit, naming the line; passes a cited record fix, then the gate', async t => {
  const dir = await tendAcme(t);
  const env = { KEEL_CLI: join(dir, 'no-such-keel') };
  assert.equal(climb(dir, ['tend-input', '--record'], env).status, 0);
  const base = git(dir, ['rev-parse', 'HEAD']);
  const m = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
  const findings = JSON.parse(await readFile(join(dir, '.keel/tend/pass.json'), 'utf8')).worksheet.findings;
  const phase2 = await readFile(join(dir, 'docs/phases/02-acme-ships.md'), 'utf8');
  /** One commit on a fresh branch from base; the guard's refusals for it. */
  const attempt = async (name, change, message = 'acme: tend\n\nTend: proofs_hold:1') => {
    git(dir, ['checkout', '-q', '-f', '-B', `try-${name}`, base]);
    await change();
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
    return m.tendCheck(dir, base, git(dir, ['rev-parse', 'HEAD']), { findings }).refused;
  };
  const refusedLike = (refused, re, why) => assert.ok(refused.some(p => re.test(p)), `${why}: ${JSON.stringify(refused)}`);
  refusedLike(await attempt('evidence', () => writeFile(join(dir, 'docs/evidence/2026-10-01-acme-orders.md'), '# Acme orders\n\nOrdered one anvil; it arrived.\nAnd a second.\n')), /^docs\/evidence\/2026-10-01-acme-orders\.md:4: edits evidence; tend never writes evidence/, 'an evidence edit');
  refusedLike(await attempt('new-evidence', () => write(dir, { 'docs/evidence/2026-10-07-acme-ships.md': '# Shipped\n' })), /^docs\/evidence\/2026-10-07-acme-ships\.md:1: adds evidence/, 'a new evidence file');
  // PR #59: a path git quotes (a non-ASCII byte), and a phase turned CRLF on its way to built, read the same.
  refusedLike(await attempt('evidence-é', () => write(dir, { 'docs/evidence/é-ships.md': '# Shipped\n' })), /^docs\/evidence\/é-ships\.md:1: adds evidence/, 'a non-ASCII evidence path');
  refusedLike(await attempt('built-crlf', () => writeFile(join(dir, 'docs/phases/02-acme-ships.md'), phase2.replace('status: partial', 'status: built').replace(/\n/g, '\r\n'))), /^docs\/phases\/02-acme-ships\.md:2: status partial → built/, 'partial → built, in CRLF');
  refusedLike(await attempt('built', () => writeFile(join(dir, 'docs/phases/02-acme-ships.md'), phase2.replace('status: partial', 'status: built'))), /^docs\/phases\/02-acme-ships\.md:2: status partial → built; tend never marks a phase built/, 'partial → built');
  for (const s of ['lived-in', 'accepted']) refusedLike(await attempt(s, () => writeFile(join(dir, 'docs/phases/02-acme-ships.md'), phase2.replace('status: partial', `status: ${s}`))), new RegExp(`status partial → ${s}`), s);
  refusedLike(await attempt('tick', () => writeFile(join(dir, 'docs/phases/02-acme-ships.md'), phase2.replace('- [ ] An anvil ships.', '- [x] An anvil ships.'))), /^docs\/phases\/02-acme-ships\.md:\d+: ticks an acceptance box \("An anvil ships\."\)/, 'a ticked box');
  refusedLike(await attempt('delete', () => rm(join(dir, 'tests/acme-ships.test.mjs'))), /^tests\/acme-ships\.test\.mjs: deleted; tend never deletes/, 'a deletion');
  refusedLike(await attempt('uncited', () => write(dir, { 'README.md': 'Acme sells anvils, and ships them.\n' }), 'acme: readme'), /"acme: readme": cites no finding/, 'no citation');
  refusedLike(await attempt('unknown', () => write(dir, { 'README.md': 'Acme.\n' }), 'acme: readme\n\nTend: lint:acme'), /cites lint:acme, which is not on the worksheet/, 'an unknown finding');
  // Outside tend's surfaces (records and agent-facing text) is refused, cited or not (ledger#92).
  refusedLike(await attempt('code', () => write(dir, { 'lib/acme.mjs': 'export const anvil = 1;\n' })), /^lib\/acme\.mjs: outside tend's surfaces/, 'code, though cited');
  refusedLike(await attempt('docs-json', () => write(dir, { 'docs/goals.json': '{}\n' })), /^docs\/goals\.json: outside tend's surfaces/, 'a docs file that is not Markdown');
  assert.deepEqual(await attempt('surfaces', () => write(dir, { 'AGENTS.md': '# Acme agents\n', 'CLAUDE.md': 'Read AGENTS.md.\n', '.agents/acme/NOTE.md': 'note\n', 'docs/decisions/0001-acme.md': '# Anvils\n', 'packages/anvil/README.md': '# Anvil\n' })), [], 'every surface passes');
  assert.deepEqual(await attempt('fix', () => writeFile(join(dir, 'README.md'), '# Acme\n\nAcme sells anvils.\n')), [], 'a cited README fix passes');
  assert.deepEqual(await attempt('step-back', () => writeFile(join(dir, 'docs/phases/02-acme-ships.md'), phase2.replace('Ship one.', 'Ship one anvil to the first customer.'))), [], 'a refreshed next action passes');
  // The command line: the guard, then the gate; a refusal is exit 1 naming the line.
  const okRun = climb(dir, ['guard', '--job', 'tend', '--base', base, '--json']);
  assert.equal(okRun.status, 0, okRun.stdout + okRun.stderr);
  assert.match(json(okRun).line, /^`node -e "process\.exit\(0\)"` exit 0 on [0-9a-f]{7}; the tend guard passed/);
  await attempt('evidence-cli', () => writeFile(join(dir, 'docs/evidence/2026-10-01-acme-orders.md'), 'rewritten\n'));
  const no = climb(dir, ['guard', '--job', 'tend', '--base', base]);
  assert.equal(no.status, 1);
  assert.match(no.stdout, /guard failed:\n {2}docs\/evidence\/2026-10-01-acme-orders\.md:1: edits evidence/);
  // A failing gate is a failing guard.
  git(dir, ['checkout', '-q', '-f', 'try-fix']);
  const cfg = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...cfg, check: 'node -e "process.exit(3)"' }));
  const gate = climb(dir, ['guard', '--job', 'tend', '--base', base]);
  assert.equal(gate.status, 1);
  assert.match(gate.stdout, /the gate `node -e "process\.exit\(3\)"` failed \(exit 3\)/);
  // PR #59: the gate is the agent's code, run after the tend guard's checks. A gate that commits evidence,
  // or only stages a change, and exits 0 is refused: what was checked is the only commit taken.
  const checked = git(dir, ['rev-parse', 'HEAD']);
  for (const [check, said] of [
    ['echo "# Acme: proven" > docs/evidence/2026-10-09-sneak.md && git add docs/evidence && git commit -q -m sneak', /moved HEAD from [0-9a-f]{7} to [0-9a-f]{7} after the guard's checks/],
    ['echo "more" >> README.md && git add README.md', /changed the tracked tree or the index after the guard's checks/],
  ]) {
    git(dir, ['reset', '-q', '--hard', checked]);
    await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...cfg, check }));
    const moved = climb(dir, ['guard', '--job', 'tend', '--base', base, '--json']);
    assert.equal(moved.status, 1, `${check}: ${moved.stdout}`);
    assert.ok(json(moved).problems.some(p => said.test(p)), JSON.stringify(json(moved).problems));
  }
});

test('tend off: with no tend key nothing runs and gh is never asked; with no secret the run ends green with a notice; a bad tend is red naming the key', async t => {
  const TEND = join(KEEL, 'practices/climb/files/.github/workflows/keel-tend.yml');
  const tendStep = async (dir, name, env = {}) => {
    const block = runBlocks(await readFile(TEND, 'utf8')).find(b => b.step === name);
    assert.ok(block, `keel-tend.yml has a step "${name}"`);
    const out = join(dir, '..', `tend-${name.replace(/\W/g, '')}-out`);
    await writeFile(out, '');
    const r = run('bash', ['-e', '-c', block.script], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out, ...env } });
    const outputs = Object.fromEntries((await readFile(out, 'utf8')).split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    return { status: r.status, out: r.stdout + r.stderr, outputs };
  };
  const off = await tendAcme(t, { tend: null });
  const o = await tendStep(off, 'Is tend on?');
  assert.equal(o.status, 0, o.out);
  assert.match(o.out, /tend is off: \.keel\/keel\.json has no "tend", so this run does nothing\./);
  assert.equal(o.outputs.on, 'false');
  const p = climb(off, ['tend-pick', '--json'], { KEEL_GH: await stubGh(t, null) });
  assert.equal(p.status, 0, 'tend off never asks gh');
  assert.deepEqual([json(p).run, json(p).reason], [false, 'tend is off: .keel/keel.json has no "tend"']);
  const rec = climb(off, ['tend-input', '--record'], { KEEL_CLI: join(off, 'no-keel') });
  assert.equal(rec.status, 2);
  assert.match(rec.stdout + rec.stderr, /tend is off/);
  assert.equal(json(climb(off, ['config', '--json'])).tend, undefined);

  const on = await tendAcme(t);
  assert.equal((await tendStep(on, 'Is tend on?')).outputs.on, 'true');
  assert.deepEqual(json(climb(on, ['config', '--json'])).tend, { schedule: 'weekly', minutes: 30 });
  const unset = await tendStep(on, 'Configured?', { OAUTH: '', API_KEY: '' });
  assert.equal(unset.status, 0, unset.out);
  assert.match(unset.out, /^::notice::Skipped: add the CLAUDE_CODE_OAUTH_TOKEN \(or ANTHROPIC_API_KEY\) secret for a tend pass to run\./m);
  assert.equal(unset.outputs.enabled, 'false');
  // Every step after those two waits on them; the judge and the publish job wait on the agent job's pick.
  const text = await readFile(TEND, 'utf8');
  const steps = text.slice(0, text.indexOf('\n  judge:\n')).split(/\n(?= {6}- )/).filter(s => /^ {6}- /.test(s));
  const after = steps.slice(steps.findIndex(s => s.includes('name: Configured?')) + 1);
  assert.ok(after.length >= 9);
  for (const s of after) {
    const cond = /(?:^ {6}- |\n {8})if: (.+)/.exec(s)?.[1] ?? '';
    assert.match(cond, /steps\.configured\.outputs\.enabled == 'true'|steps\.pick\.outputs\.run == 'yes'/, `step without the guard: ${s.split('\n')[0]}`);
  }
  assert.match(text, /\n  judge:\n    needs: agent\n    if: needs\.agent\.outputs\.run == 'yes'\n/, 'no pass, no judge');
  assert.match(text, /\n  publish:\n    needs: \[agent, judge\]\n    if: always\(\) && needs\.agent\.outputs\.run == 'yes'\n/, 'no pass, nothing published');
  // A bad "tend" is exit 2, naming the key.
  for (const [bad, re] of [[{ schedule: 'nightly' }, /"tend"\.schedule must be "weekly"/], [{ budget: { minutes: 999 } }, /"tend"\.budget\.minutes must be a whole number from 5 to 180/], [{ jobs: [] }, /"tend" has an unknown key jobs/], ['weekly', /"tend" must be an object/]]) {
    const cfg = JSON.parse(await readFile(join(on, '.keel/keel.json'), 'utf8'));
    await writeFile(join(on, '.keel/keel.json'), JSON.stringify({ ...cfg, tend: bad }));
    const r = climb(on, ['tend-pick', '--json'], { KEEL_GH: await stubGh(t, []) });
    assert.equal(r.status, 2, JSON.stringify(bad));
    assert.match(json(r).error, re);
  }
});

test('lessons: a distill pass over the project\'s own table writes proposals, one commit each, and changes no row; the guard refuses a row changed', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time', 'lessons'] }, config: { check: 'node -e ""' }, files: { 'docs/lessons.md': LESSONS_MD, 'scripts/keel/distill.mjs': await readFile(DISTILL, 'utf8') } });
  const gh = await stubGh(t, []);
  // pick: every row is new (no pass yet), so lessons goes ahead of the rotation.
  const p = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: gh }));
  assert.deepEqual([p.job, p.by], ['lessons', 'measure']);
  assert.match(p.why, /^lessons_since_distill is outside in docs\/lessons\.md since the last distill pass \(4 against ≤ 0\)/);

  const before = await readFile(join(dir, 'docs/lessons.md'), 'utf8');
  assert.equal(json(climb(dir, ['measure', 'lessons', '--baseline', '--json'])).median, 4);
  const w = json(climb(dir, ['distill', '--json']));
  assert.deepEqual(w.summary, { rows: 4, families: 0, open: 0, since: 4 });
  assert.deepEqual(w.rows.map(r => r.provenance), ['acme, widgets 3', 'acme, widgets 5', 'acme, ci 2', 'acme, sprockets 1']);
  assert.match(climb(dir, ['distill']).stdout, /^### 2 \(new since the last pass\)$/m);

  const propose = (...args) => climb(dir, ['distill', 'propose', ...args, '--json']);
  const fam = propose('--kind', 'family', '--name', 'A cache trusted after its source moved', '--rule', 'A cache names what it was read from, and a test moves that.', '--guard', 'a test that moves or renames the source under a warm cache', '--rows', '1,2', '--read', READ_LESSONS);
  assert.equal(fam.status, 0, fam.stdout + fam.stderr);
  assert.match(json(fam).file, /^\.keel\/climb\/lessons\/\d{4}-\d{2}-\d{2}-distill-family-a-cache-trusted-after-its-source-moved\.md$/);
  const rew = json(propose('--kind', 'reword', '--row', '2', '--guard', 'a test that renames a widget under a warm cache', '--read', READ_LESSONS));
  assert.deepEqual([rew.fields.cell, rew.fields.old, rew.fields.text], ['guard', 'to write', 'a test that renames a widget under a warm cache']);
  // Each proposal is its own commit, made by the script; nothing is left uncommitted.
  assert.equal(git(dir, ['status', '--porcelain']), '');
  assert.deepEqual(git(dir, ['log', '--format=%s', '-2']).split('\n'), ["climb lessons: propose reword: reword lesson 2's guard", 'climb lessons: propose family: family "A cache trusted after its source moved": lessons 1, 2']);
  assert.equal(git(dir, ['diff', '--name-only', 'HEAD~2', 'HEAD']).split('\n').every(f => f.startsWith('.keel/climb/lessons/')), true);
  // The table: not one byte changed.
  assert.equal(await readFile(join(dir, 'docs/lessons.md'), 'utf8'), before);
  const night = JSON.parse(await readFile(join(dir, '.keel/climb/night.json'), 'utf8'));
  assert.deepEqual(night.tried.map(a => a.verdict), ['keep', 'keep']);

  // Refused: the same family again, a family over one row, a standardise with no decided family, a read that cites nothing.
  for (const [args, re] of [
    [['--kind', 'family', '--name', 'A cache trusted after its source moved', '--rule', 'r', '--guard', 'g', '--rows', '1,2', '--read', READ_LESSONS], /already proposes this/],
    [['--kind', 'family', '--name', 'One', '--rule', 'r', '--guard', 'g', '--rows', '3', '--read', READ_LESSONS], /a family needs two rows or more/],
    [['--kind', 'standardise', '--family', 'A cache trusted after its source moved', '--check', 'a lint', '--read', READ_LESSONS], /no decided family/],
    [['--kind', 'reword', '--row', '9', '--cost', 'x', '--read', READ_LESSONS], /docs\/lessons\.md has no lesson 9/],
    [['--kind', 'tag', '--row', '1', '--read', READ_LESSONS], /--kind must be one of family, reword, standardise/],
    [['--kind', 'reword', '--row', '1', '--cost', 'x', '--read', 'I looked'], /--read must cite something checked/],
  ]) {
    const r = propose(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}`);
    assert.match(json(r).error, re);
  }
  // The pass is recorded by its proposals: nothing since, so pick does not send another lessons night.
  assert.deepEqual(json(climb(dir, ['distill', '--json'])).since, { through: 4, rows: [] });
  const m = await load(dir);
  assert.deepEqual((await m.signalsOf(dir, {}, ['lessons'])).map(r => [r.id, r.value, r.state]), [['lessons_since_distill', 0, 'ok']]);

  // Judged: settle keeps the commits, guard passes proposals only, and the report lists them for the owner.
  assert.equal(json(climb(dir, ['settle', '--json'])).dropped, false);
  const g = climb(dir, ['guard', '--json']);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  assert.match(json(g).line, /proposals only \(2 files under \.keel\/climb\/lessons\/\), no code changed, nothing decided/);
  // PR #59: the gate runs after the proposals' checks and is the agent's code: a gate that commits outside
  // the proposals (here, the table itself) and exits 0 is refused, never passed.
  const judged = git(dir, ['rev-parse', 'HEAD']);
  const cfg = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...cfg, check: 'echo "| 9 | sneak |" >> docs/lessons.md && git add docs/lessons.md && git commit -q -m sneak' }));
  const moved = climb(dir, ['guard', '--json']);
  assert.equal(moved.status, 1, moved.stdout + moved.stderr);
  assert.match(json(moved).problems.join('\n'), /moved HEAD from [0-9a-f]{7} to [0-9a-f]{7} after the guard's checks/);
  git(dir, ['reset', '-q', '--hard', judged]);
  assert.equal(climb(dir, ['guard', '--json']).status, 0, 'back on the judged commit, the honest gate passes again');
  const rep = climb(dir, ['report']);
  assert.equal(rep.status, 0, rep.stderr);
  assert.match(rep.stdout, /^climb lessons \d{4}-\d{2}-\d{2}: 2 proposals for the owner \(1 family, 1 reword\); the table unchanged; \d+ min$/m);
  assert.match(rep.stdout, /^\| Proposal \| Kind \| Rows \| File \|$/m);
  assert.match(rep.stdout, /^\| reword lesson 2's guard \| guard: to write \| a test that renames a widget under a warm cache \|$/m);
  assert.match(rep.stdout, /```keel-impact\n\{"version":1,.*"reconciliation":"none"/);

  // The owner accepts the family (status: accepted in its file): it is a family now, and its guard can be standardised.
  const famFile = join(dir, json(fam).file);
  await writeFile(famFile, (await readFile(famFile, 'utf8')).replace('status: proposed', 'status: accepted'));
  git(dir, ['commit', '-q', '-am', 'acme: the owner accepts the family']);
  assert.deepEqual(json(climb(dir, ['distill', '--json'])).families.map(f => [f.name, f.rows]), [['A cache trusted after its source moved', [1, 2]]]);

  // Mutations the guard refuses, naming each: a row of the table changed, a proposal edited, a path outside.
  // Each is guarded from its own --base, so the night's record (whose base is the night's start) goes:
  // a record naming another base than --base is refused (ledger#92).
  await rm(join(dir, '.keel/climb/night.json'));
  const refuse = async (files, re) => {
    const head = git(dir, ['rev-parse', 'HEAD']);
    await commit(dir, files, 'acme: tonight');
    const r = climb(dir, ['guard', '--base', head, '--job', 'lessons', '--json']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(json(r).problems.join('\n'), re);
    git(dir, ['reset', '-q', '--hard', head]);
  };
  await refuse({ 'docs/lessons.md': before.replace('| an hour | to write |', '| an hour | a test that renames a widget under a warm cache |') }, /^docs\/lessons\.md changed \(lesson 2\): a lessons night proposes, and only the owner changes the table/);
  await refuse({ [rew.file]: 'edited\n' }, /changed: a lessons night adds proposals and never edits one/);
  await refuse({ 'lib/acme.mjs': 'export {};\n' }, /^lib\/acme\.mjs is outside \.keel\/climb\/lessons\/: a lessons night only adds proposals$/);
});

test('loop: pulls, proposes a rank for every untriaged finding and decides none; Loop unreachable is a notice, not red; the guard refuses a decided finding', async t => {
  const files = {
    'scripts/loop.mjs': await readFile(LOOP, 'utf8'),
    '.stitch.json': '{ "workspace": "acme-0000-workspace" }\n',
    'lib/widget.mjs': 'export const cache = new Map();\n// the cache never expires\nexport const get = k => cache.get(k);\n',
    'docs/phases/01-widgets.md': '# Widgets hold their shape\n',
    'docs/loop/widget-cache-ignores-expiry.md': await findingText({ title: 'Widget cache ignores expiry', loop: [ALPHA], body: '# Widget cache ignores expiry\n\n> **Loop says** (P2/S1): it does.\n\n## Our read\n\nNot yet checked against the code.' }),
    'docs/loop/sprocket-api-lacks-rate-limit.md': await findingText({ title: 'Sprocket API lacks rate limit', loop: [BETA], decision: 'accepted', rank: 'next', phase: 1, since: '2026-10-01', note: 'real, and cheap', body: '# Sprocket API lacks rate limit\n\n## Our read\n\nlib/widget.mjs:3 has no limit.' }),
  };
  const dir = await acme(t, { climb: { jobs: ['loop'] }, config: { practices: ['loop'], check: 'node -e ""' }, files });
  const env = { KEEL_STITCH: STITCH, STITCH_STUB_LOG: join(dir, '..', `${dir.split('/').pop()}-stitch.log`), STITCH_STUB_STATE: join(dir, '..', `${dir.split('/').pop()}-stitch.json`) };
  t.after(() => Promise.all([rm(env.STITCH_STUB_LOG, { force: true }), rm(env.STITCH_STUB_STATE, { force: true })]));
  await writeFile(env.STITCH_STUB_LOG, '');
  await writeFile(env.STITCH_STUB_STATE, JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'acme: Loop is down' } }));
  // Relative, as the agent runs it: loop.mjs runs only as its own real path (a temp dir may be a symlink).
  const loopCmd = (...args) => run(process.execPath, ['scripts/loop.mjs', ...args], { cwd: dir, env: { ...process.env, ...env } });

  // A config naming loop needs the loop practice.
  await setConfig(dir, { climb: { jobs: ['loop'] }, practices: ['night'] });
  assert.match(json(climb(dir, ['config', '--json'])).error, /names loop, so "practices" must include loop/);
  git(dir, ['checkout', '-q', '--', '.keel/keel.json']);

  // pick: one untriaged finding, so a loop night.
  const p = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: await stubGh(t, []) }));
  assert.deepEqual([p.job, p.by], ['loop', 'measure']);
  assert.match(p.why, /^loop_untriaged is outside in docs\/loop\/ \(1 against ≤ 0\)/);
  git(dir, ['switch', '-q', '-c', 'keel-climb/loop/2026-10-06']);
  assert.equal(json(climb(dir, ['measure', 'loop', '--baseline', '--json'])).median, 1);
  const base = git(dir, ['rev-parse', 'HEAD']);

  // Unreachable: no key (the workflow's own step), then a key and a Loop that fails. A notice and exit 0, never red; nothing left behind.
  const noKey = await step(t, dir, "Pull Loop's findings", { ...env, STITCH_API_KEY: '' });
  assert.equal(noKey.status, 0, noKey.out);
  assert.match(noKey.out, /^::notice::Loop unreachable \(no STITCH_API_KEY\): no pull tonight; the night proposes for the findings already here \(1 untriaged\)$/m);
  const down = climb(dir, ['loop-pull', '--json'], { ...env, STITCH_API_KEY: 'acme-key' });
  assert.equal(down.status, 0, down.stdout + down.stderr);
  assert.deepEqual([json(down).pulled, /^the pull failed \(exit 1\): .*Loop is down/.test(json(down).why)], [false, true]);
  assert.equal(git(dir, ['rev-parse', 'HEAD']), base);
  assert.equal(git(dir, ['status', '--porcelain']), '');
  // Nothing proposed, Loop unreachable: no PR, and the line says why.
  const quiet = json(climb(dir, ['report', '--json']));
  assert.equal(quiet.kept, 0);
  assert.match(quiet.line, /^climb loop \d{4}-\d{2}-\d{2}: proposed nothing; decided none; 1 untriaged left; Loop unreachable \(the pull failed .*\): proposed for the findings already here; \d+ min$/);

  // Reachable: the pull files a new finding and commits it, by the script.
  await writeFile(env.STITCH_STUB_STATE, JSON.stringify({ insights: [loopInsight(ALPHA, 'Widget cache ignores expiry'), loopInsight(BETA, 'Sprocket API lacks rate limit'), loopInsight(GAMMA, 'Gear loader drops errors')] }));
  const up = json(climb(dir, ['loop-pull', '--json'], { ...env, STITCH_API_KEY: 'acme-key' }));
  assert.equal(up.pulled, true);
  assert.deepEqual(up.untriaged.sort(), ['gear-loader-drops-errors', 'widget-cache-ignores-expiry']);
  assert.match(git(dir, ['log', '-1', '--format=%s']), /^Loop: findings pulled \d{4}-\d{2}-\d{2} \(climb loop night, in place of keel-loop's pull\)$/);
  assert.ok(!JSON.parse(`[${(await readFile(env.STITCH_STUB_LOG, 'utf8')).trim().split('\n').join(',')}]`).some(c => /^(dismiss|create|delete|generate)$/.test(c.args[0])), 'a pull sends nothing to Loop');

  // The agent proposes for each untriaged finding, as the job's brief says, and commits.
  for (const slug of up.untriaged) {
    const r = loopCmd('propose', slug, '--rank', 'next', '--phase', '1', '--note', 'real: the code shows it', '--read', 'lib/widget.mjs:2 says the cache never expires');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^proposed ${slug}: next, phase 1$`, 'm'));
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'loop: propose a rank for each untriaged finding']);
  assert.equal(json(climb(dir, ['settle', '--json'])).dropped, false);
  const g = climb(dir, ['guard', '--json']);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  const rep = climb(dir, ['report']);
  assert.equal(rep.status, 0, rep.stderr);
  assert.match(rep.stdout, /^climb loop \d{4}-\d{2}-\d{2}: proposed a rank for 2 findings; decided none; 0 untriaged left; Loop pulled; \d+ min$/m);
  assert.match(rep.stdout, /^\| Finding \| Proposed rank \| Home \| Why \|$/m);
  assert.match(rep.stdout, /^\| Gear loader drops errors \(`docs\/loop\/gear-loader-drops-errors\.md`\) \| next \| phase 1 \| real: the code shows it \|$/m);
  assert.match(rep.stdout, /Decide each yourself: `node scripts\/loop\.mjs decide <slug>/);
  const night = JSON.parse(await readFile(join(dir, '.keel/climb/night.json'), 'utf8'));
  assert.deepEqual(night.tried.map(a => a.verdict), ['keep', 'keep'], 'the health page\'s climb line counts the proposals');
  assert.equal(git(dir, ['show', 'HEAD:docs/loop/sprocket-api-lacks-rate-limit.md']).includes('decision: accepted'), true);

  // Mutations the guard refuses: a finding decided tonight, a decided finding's rank changed.
  const head = git(dir, ['rev-parse', 'HEAD']);
  const decided = loopCmd('decide', 'gear-loader-drops-errors', 'accepted', '--note', 'real', '--no-push');
  assert.equal(decided.status, 0, decided.stdout + decided.stderr);
  git(dir, ['commit', '-q', '-am', 'loop: decide']);
  const r1 = climb(dir, ['guard', '--json']);
  assert.equal(r1.status, 1, r1.stdout);
  assert.match(json(r1).problems.join('\n'), /^docs\/loop\/gear-loader-drops-errors\.md is accepted tonight: deciding is the owner's/m);
  git(dir, ['reset', '-q', '--hard', head]);
  const sprocket = join(dir, 'docs/loop/sprocket-api-lacks-rate-limit.md');
  await writeFile(sprocket, (await readFile(sprocket, 'utf8')).replace('rank: next', 'rank: now'));
  git(dir, ['commit', '-q', '-am', 'loop: rerank']);
  const r2 = climb(dir, ['guard', '--json']);
  assert.equal(r2.status, 1, r2.stdout);
  assert.match(json(r2).problems.join('\n'), /sprocket-api-lacks-rate-limit\.md was accepted and its rank changed tonight: a proposal never overrides a decision/);
  git(dir, ['reset', '-q', '--hard', head]);
});

test('a loop night and keel-loop.yml never both pull: where keel-loop.yml is installed the night pulls nothing, says so, and proposes for the findings already here (ledger#92)', async t => {
  const files = {
    'scripts/loop.mjs': await readFile(LOOP, 'utf8'),
    '.stitch.json': '{ "workspace": "acme-0000-workspace" }\n',
    '.github/workflows/keel-loop.yml': 'name: keel-loop\n',
    'docs/loop/widget-cache-ignores-expiry.md': await findingText({ title: 'Widget cache ignores expiry', loop: [ALPHA], body: '# Widget cache ignores expiry\n\n## Our read\n\nNot yet checked.' }),
  };
  const dir = await acme(t, { climb: { jobs: ['loop'] }, config: { practices: ['loop'], check: 'node -e ""' }, files });
  const env = { KEEL_STITCH: STITCH, STITCH_API_KEY: 'acme-key', STITCH_STUB_LOG: join(dir, '..', `${dir.split('/').pop()}-stitch.log`), STITCH_STUB_STATE: join(dir, '..', `${dir.split('/').pop()}-stitch.json`) };
  t.after(() => Promise.all([rm(env.STITCH_STUB_LOG, { force: true }), rm(env.STITCH_STUB_STATE, { force: true })]));
  await writeFile(env.STITCH_STUB_LOG, '');
  await writeFile(env.STITCH_STUB_STATE, JSON.stringify({ insights: [loopInsight(ALPHA, 'Widget cache ignores expiry'), loopInsight(GAMMA, 'Gear loader drops errors')] }));
  assert.equal(json(climb(dir, ['pick', '--json'], { KEEL_GH: await stubGh(t, []) })).job, 'loop');
  git(dir, ['switch', '-q', '-c', 'keel-climb/loop/2026-10-07']);
  climb(dir, ['measure', 'loop', '--baseline', '--json']);
  const base = git(dir, ['rev-parse', 'HEAD']);
  // The workflow's own step, with a Loop key: no stitch install, and the script says why there is no pull.
  const s = await step(t, dir, "Pull Loop's findings", env);
  assert.equal(s.status, 0, s.out);
  assert.doesNotMatch(s.out, /npm|stitch enable/);
  assert.match(s.out, /^No pull tonight: \.github\/workflows\/keel-loop\.yml pulls Loop here every day, so this night does not \(the two never both pull\); the night proposes for the findings already here \(1 untriaged\)$/m);
  assert.equal((await readFile(env.STITCH_STUB_LOG, 'utf8')).trim(), '', 'Loop was never asked (mutation: a night that pulls here calls stitch)');
  assert.equal(git(dir, ['rev-parse', 'HEAD']), base, 'nothing pulled, nothing committed');
  const night = JSON.parse(await readFile(join(dir, '.keel/climb/night.json'), 'utf8'));
  assert.deepEqual([night.loop.pulled, night.loop.elsewhere], [false, true]);
  assert.match(json(climb(dir, ['report', '--json'])).line, /; Loop pulled by keel-loop\.yml, not this night: proposed for the findings already here; \d+ min$/);
});

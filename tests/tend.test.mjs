// The tend pass (phase 38) past its guard: whether a pass runs (tend-pick),
// what it leaves to the owner (tend-note), the PR body it writes through
// pr-body.mjs (Summary: finding → what was done; Evidence: the record count
// before and after; Merge danger; the owner's checklist), and the night's
// Tend line, which names each finding the pass left. A synthetic Acme made
// by keel init, a stub gh and a stub keel; nothing reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { ENV } from './helpers/improve.mjs';
import { improve } from '../practices/night/files/scripts/keel/improve.mjs';
import { tendLine } from '../practices/night/files/scripts/keel/lib.mjs';
import { tendReportOf, tendImpact, tendRetiring } from '../scripts/keel/tend.mjs'; // keel's rendered copy, beside the night's lib.mjs and pr-body.mjs
import { prBody } from '../practices/night/files/scripts/keel/pr-body.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const git = (cwd, args) => {
  const r = run('git', args, { cwd });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const climb = (dir, args, env = {}) => run(process.execPath, [join(dir, 'scripts/keel/climb.mjs'), ...args], { cwd: dir, env: { ...process.env, KEEL_CLI: join(dir, 'no-such-keel'), ...env } });
const json = r => { try { return JSON.parse(r.stdout); } catch { assert.fail(`not JSON (exit ${r.status}): ${r.stdout}${r.stderr}`); } };

/** Acme, inited with climb and tend on, with a stale roadmap (a finding tend may resolve) and a built phase whose proof is lost. */
async function acme(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'keel-tend-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'acme');
  const r = run(process.execPath, [join(KEEL, 'bin/keel.mjs'), 'init', dir, '--description', 'Acme sells anvils.', '--name', 'Acme', '--with', 'climb'], { cwd: base });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const config = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  await writeFile(join(dir, '.keel/keel.json'), `${JSON.stringify({ ...config, repo: 'acme/acme', check: 'node -e "process.exit(0)"', tend: { budget: { minutes: 30 } } }, null, 2)}\n`);
  await mkdir(join(dir, 'docs/evidence'), { recursive: true });
  await writeFile(join(dir, 'docs/evidence/2026-10-01-acme-orders.md'), '# Acme orders\n\nOrdered one anvil; it arrived.\n');
  await writeFile(join(dir, 'docs/phases/01-acme-orders.md'), ['---', 'status: built', 'since: 2026-10-01', 'goal: G0', 'depends: [0]', 'note: "Acme orders work."', 'evidence: ["evidence/2026-10-01-acme-orders.md"]', '---', '',
    '# Acme orders', '', '## Done when', '', 'An anvil is ordered.', '', '## Scope', '', 'Orders.', '', '## Acceptance', '',
    '- [x] An anvil is ordered. `tests/acme-orders.test.mjs: "orders"`', '', '## Proof', '', 'Automated: `node --test tests/acme-orders.test.mjs`.', '', '## Deliberately open', '', 'Nothing.', '', '## Next action', '', 'None.', ''].join('\n'));
  // The roadmap is not regenerated: roadmap_stale is a finding.
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme: orders built']);
  return dir;
}

/** A stub gh: open PRs' heads, and the closed list. */
async function stubGh(t, open = [], closed = []) {
  const d = await mkdtemp(join(tmpdir(), 'keel-tend-gh-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  await writeFile(join(d, 'gh'), `#!/bin/sh\nif [ "$1 $2 $3 $4" = "pr list --state closed" ]; then echo '${JSON.stringify(closed)}'; exit 0; fi\nif [ "$1 $2" = "pr list" ]; then echo '${JSON.stringify(open.map(h => ({ headRefName: h })))}'; exit 0; fi\nexit 1\n`, { mode: 0o755 });
  return join(d, 'gh');
}

test('tend-pick: a pass on keel-tend/<date>; an open tend PR waits; three closed unmerged and tend proposes its own retirement', async t => {
  const dir = await acme(t);
  const p = json(climb(dir, ['tend-pick', '--date', '2026-10-12', '--json'], { KEEL_GH: await stubGh(t) }));
  assert.deepEqual(p, { run: true, date: '2026-10-12', branch: 'keel-tend/2026-10-12', minutes: 30, schedule: 'weekly' });
  const waits = json(climb(dir, ['tend-pick', '--date', '2026-10-12', '--json'], { KEEL_GH: await stubGh(t, ['keel-climb/test-time/2026-10-11', 'keel-tend/2026-10-05']) }));
  assert.equal(waits.run, false);
  assert.match(waits.reason, /the last tend PR \(keel-tend\/2026-10-05\) is still open/);
  const pr = (n, merged = false) => ({ headRefName: `keel-tend/2026-09-${10 + n}`, number: n, createdAt: `2026-09-${10 + n}T09:42:00Z`, mergedAt: merged ? 'x' : null });
  assert.deepEqual(tendRetiring([pr(1), pr(2), pr(3)]), [3, 2, 1]);
  assert.equal(tendRetiring([pr(1), pr(2, true), pr(3)]), null);
  const retired = json(climb(dir, ['tend-pick', '--json'], { KEEL_GH: await stubGh(t, [], [pr(1), pr(2), pr(3)]) }));
  assert.equal(retired.run, false);
  assert.match(retired.reason, /^tend proposes its own retirement: its last 3 keel-tend\/ PRs \(#3, #2, #1\) were closed unmerged/);
  // gh that cannot answer: tend-pick never guesses.
  const blind = climb(dir, ['tend-pick', '--json'], { KEEL_GH: join(dir, 'no-gh') });
  assert.equal(blind.status, 2);
});

test('a tend pass: the worksheet, one cited fix, a proposal and a tried note; the PR body says finding → what was done, the record count before and after, and the owner\'s checklist', async t => {
  const dir = await acme(t);
  git(dir, ['switch', '-q', '-c', 'keel-tend/2026-10-12']);
  const w = json(climb(dir, ['tend-input', '--record', '--date', '2026-10-12', '--json']));
  const ids = w.findings.map(f => f.id);
  assert.ok(ids.includes('roadmap_stale') && ids.includes('proofs_hold:1'), JSON.stringify(ids));
  const before = w.count;
  assert.equal(before, w.measures.reduce((n, m) => n + (m.value ?? 0), 0));
  // The agent's work: regenerate the roadmap, citing its finding; propose stepping phase 1 back.
  assert.equal(run(process.execPath, ['scripts/roadmap.mjs'], { cwd: dir }).status, 0);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'Regenerate the roadmap\n\nTend: roadmap_stale']);
  const note = climb(dir, ['tend-note', '--finding', 'proofs_hold:1', '--propose', 'Step phase 1 back to partial: tests/acme-orders.test.mjs is gone and no test of that name ran.']);
  assert.equal(note.status, 0, note.stdout + note.stderr);
  assert.equal(climb(dir, ['tend-note', '--finding', 'acme:nothing', '--tried', 'x']).status, 2, 'a finding not on the worksheet');
  assert.equal(climb(dir, ['tend-note', '--finding', 'proofs_hold:1']).status, 2, 'neither --propose nor --tried');
  const others = ids.filter(id => !['roadmap_stale', 'proofs_hold:1'].includes(id));
  for (const id of others) assert.equal(climb(dir, ['tend-note', '--finding', id, '--tried', 'Read it; out of budget.']).status, 0);
  // The judge's page of proposals, then the guard and the gate over it, then the report.
  assert.equal(climb(dir, ['tend-page', '--date', '2026-10-12']).status, 0);
  const g = climb(dir, ['guard', '--job', 'tend']);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  const body = join(dir, '..', 'body.md');
  const r = json(climb(dir, ['tend-report', '--body', body, '--json']));
  assert.equal(r.commits, 2, 'the agent\'s fix, and the judge\'s page of proposals');
  assert.equal(r.page, 'docs/tend/2026-10-12.md');
  assert.match(git(dir, ['log', '-1', '--format=%s']), /^keel tend: 2026-10-12, 1 proposal for the owner$/);
  assert.match(await readFile(join(dir, 'docs/tend/2026-10-12.md'), 'utf8'), /^- \[ \] `proofs_hold:1`: phase 1 .*\n {2}Proposed: Step phase 1 back to partial/m);
  assert.deepEqual(r.resolved, ['roadmap_stale']);
  assert.equal(r.before, before);
  assert.equal(r.after, before - 1, 'the roadmap check passes on the branch');
  assert.match(r.line, new RegExp(`^Tend 2026-10-12: resolved 1 of ${ids.length} findings? \\(record count ${before} → ${before - 1}\\); 1 proposed for the owner; ${others.length} unresolved`));
  const text = await readFile(body, 'utf8');
  const at = ['## Summary', '## Evidence', '## Merge danger', '## Notes', '## Record impact'].map(h => text.indexOf(`${h}\n`));
  assert.ok(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), text);
  assert.match(text, /^\| Finding \| What was done \|$/m);
  assert.match(text, /^\| `roadmap_stale`: the roadmap check fails: .* \| Regenerate the roadmap \([0-9a-f]{7}\) \|$/m);
  assert.match(text, /^Gate: `node -e "process\.exit\(0\)"` exit 0 on [0-9a-f]{7}; the tend guard passed/m);
  assert.match(text, /^\| What \| Before \(the worksheet\) \| After \(this branch\) \|$/m);
  assert.match(text, /^\| `roadmap_stale` \| 1 \| 0 \|$/m);
  assert.match(text, new RegExp(`^\\| \\*\\*record count\\*\\* \\| ${before} \\| ${before - 1} \\|$`, 'm'));
  assert.match(text, /^Two-way door: records and docs only/m);
  assert.match(text, /^Blast radius: this repo's records and docs only\.$/m);
  assert.match(text, /^- \[ \] `proofs_hold:1`: Step phase 1 back to partial/m);
  assert.match(text, /```keel-impact\n\{"version":1,"phases":\[\],"decisions":\[\],"supersedes":\[\],"evidence":\[\],"reconciliation":"none"/);
  // The pass's record carries what the night's line needs.
  const pass = JSON.parse(await readFile(join(dir, '.keel/tend/pass.json'), 'utf8'));
  assert.deepEqual([pass.resolved, pass.proposed.map(p => p.finding), pass.unresolved.map(u => u.id)], [['roadmap_stale'], ['proofs_hold:1'], others]);
});

test('a pass that only proposes still reaches the owner: the judge commits its proposals as docs/tend/<date>.md, so a PR opens; a pass with neither commits nor proposals opens nothing (ledger#92)', async t => {
  const dir = await acme(t);
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['switch', '-q', '-c', 'keel-tend/2026-10-12']);
  const w = json(climb(dir, ['tend-input', '--record', '--date', '2026-10-12', '--json']));
  // Nothing proposed, nothing committed: no page, no PR body, nothing to publish.
  const quiet = json(climb(dir, ['tend-report', '--body', join(dir, '..', 'quiet.md'), '--json']));
  assert.deepEqual([quiet.commits, quiet.body, quiet.page], [0, null, undefined]);
  assert.equal(git(dir, ['rev-parse', 'HEAD']), base);
  // The agent only proposes (stepping phase 1 back is the owner's), and commits nothing.
  assert.equal(climb(dir, ['tend-note', '--finding', 'proofs_hold:1', '--propose', 'Step phase 1 back to partial: its test is gone.']).status, 0);
  // The report never writes the page: it refuses a page tend-page did not commit.
  const early = climb(dir, ['tend-report', '--json']);
  assert.equal(early.status, 2, early.stdout);
  assert.match(json(early).error, /docs\/tend\/2026-10-12\.md is not committed as the pass's notes say: climb\.mjs tend-page runs before the guard/);
  const page = json(climb(dir, ['tend-page', '--base', base, '--date', '2026-10-12', '--json']));
  assert.deepEqual(page, { page: 'docs/tend/2026-10-12.md', committed: true, proposed: 1 });
  assert.match(git(dir, ['log', '-1', '--format=%B']), /^keel tend: 2026-10-12, 1 proposal for the owner\n\nTend: proofs_hold:1/);
  // The guard and the gate run over the page (ledger#94: the pushed tree is the gated tree).
  const g = json(climb(dir, ['guard', '--job', 'tend', '--base', base, '--json']));
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.equal(g.skipped, undefined, 'the page is guarded and gated, never skipped');
  const gated = git(dir, ['rev-parse', 'HEAD']);
  const body = join(dir, '..', 'body.md');
  const r = json(climb(dir, ['tend-report', '--body', body, '--base', base, '--date', '2026-10-12', '--json']));
  assert.equal(git(dir, ['rev-parse', 'HEAD']), gated, 'the report commits nothing after the gate');
  assert.equal(r.commits, 1, 'the judge\'s page is the PR\'s one commit (mutation: no page commit leaves 0, and publish opens nothing)');
  assert.equal(r.page, 'docs/tend/2026-10-12.md');
  assert.deepEqual(git(dir, ['diff', '--name-only', base, 'HEAD']).split('\n'), ['docs/tend/2026-10-12.md'], 'the page and nothing else');
  assert.equal(git(dir, ['status', '--porcelain', '--untracked-files=no']), '', 'the judge\'s tree is clean after');
  assert.deepEqual(r.proposed.map(p => p.finding), ['proofs_hold:1']);
  const text = await readFile(body, 'utf8');
  assert.match(text, /^\| `proofs_hold:1`: phase 1 .* \| proposed for the owner in docs\/tend\/2026-10-12\.md \|$/m);
  assert.match(text, /^- \[ \] `proofs_hold:1`: Step phase 1 back to partial/m);
  assert.match(text, /^Gate: `node -e "process\.exit\(0\)"` exit 0 on [0-9a-f]{7}; the tend guard passed/m);
  assert.match(text, /"reconciliation":"none"/, 'the page is no phase or decision record');
  // A re-run of the page or the report makes no second commit.
  assert.equal(json(climb(dir, ['tend-page', '--json'])).committed, false);
  assert.equal(json(climb(dir, ['tend-report', '--json'])).commits, 1);
  assert.ok(w.findings.length >= 2);
});

test('resolved by measure, not by citation: a cited finding the re-run still reports was tried; a loose end, not re-measured, is resolved by its citation (ledger#92)', () => {
  const worksheet = { count: 2, findings: [{ id: 'roadmap_stale', measure: 'roadmap_stale', what: 'the roadmap check fails' }, { id: 'lint:phase:docs/phases/02-acme.md', measure: 'lint', what: 'phase in docs/phases/02-acme.md' }, { id: 'loose:branch:acme-old', measure: 'loose-ends', what: 'branch: acme-old' }], measures: [{ id: 'roadmap_stale', state: 'outside', value: 1 }, { id: 'lint', state: 'outside', value: 1 }], reconciliation: { state: 'n/a', why: 'off', findings: [] } };
  const pass = { date: '2026-10-12', started: '2026-10-12T09:42:00Z', worksheet, notes: [], gate: 'ok' };
  const commits = [
    { sha: 'a'.repeat(40), subject: 'Touch the roadmap', cites: ['roadmap_stale'] },
    { sha: 'b'.repeat(40), subject: 'Fix the phase section', cites: ['lint:phase:docs/phases/02-acme.md'] },
    { sha: 'c'.repeat(40), subject: 'Note the merged branch', cites: ['loose:branch:acme-old'] },
  ];
  const after = { measures: [{ id: 'roadmap_stale', state: 'outside', value: 1, findings: [{ id: 'roadmap_stale' }] }, { id: 'lint', state: 'ok', value: 0, findings: [] }], reconciliation: worksheet.reconciliation };
  const r = tendReportOf(pass, { commits, files: ['docs/ROADMAP.md'], after, now: new Date('2026-10-12T10:00:00Z') });
  assert.deepEqual(r.pass.resolved, ['lint:phase:docs/phases/02-acme.md', 'loose:branch:acme-old']);
  assert.deepEqual(r.pass.unresolved.map(u => u.id), ['roadmap_stale']);
  assert.match(r.pass.unresolved[0].tried, /^aaaaaaa \("Touch the roadmap"\) cited it, but the re-run on the branch still reports it\.$/);
  assert.match(r.line, /^Tend 2026-10-12: resolved 2 of 3 findings \(record count 2 → 1\); 0 proposed for the owner; 1 unresolved: roadmap_stale;/);
  assert.match(prBody(r.input), /^\| `roadmap_stale`: the roadmap check fails \| tried, not resolved: Touch the roadmap \(aaaaaaa\); the re-run still reports it \|$/m);
  // A measure that could not run again cannot show its finding gone: tried, not resolved.
  const blind = tendReportOf(pass, { commits, after: { ...after, measures: [after.measures[0], { id: 'lint', state: 'n/a', value: null, findings: [] }] } });
  assert.deepEqual(blind.pass.resolved, ['loose:branch:acme-old']);
  assert.match(blind.pass.unresolved.find(u => u.id === 'lint:phase:docs/phases/02-acme.md').tried, /its measure did not run again on the branch/);
});

test('the PR body: a phase edit is declared in the keel-impact block; a pass with no commit has no PR body', () => {
  assert.deepEqual(tendImpact(['docs/phases/02-acme.md', 'README.md', 'docs/ROADMAP.md']).phases, ['docs/phases/02-acme.md']);
  assert.equal(tendImpact(['docs/phases/02-acme.md']).reconciliation, 'updated');
  assert.equal(tendImpact(['README.md']).reconciliation, 'none');
  const worksheet = { count: 2, findings: [{ id: 'lint:phase:docs/phases/02-acme.md', what: 'phase in docs/phases/02-acme.md' }, { id: 'drift:AGENTS.md', what: 'AGENTS.md changed' }], measures: [{ id: 'lint', state: 'outside', value: 1 }, { id: 'drift', state: 'outside', value: 1 }], reconciliation: { state: 'n/a', why: 'off', findings: [] } };
  const pass = { date: '2026-10-12', started: '2026-10-12T09:42:00Z', worksheet, notes: [{ finding: 'drift:AGENTS.md', kind: 'proposed', text: 'Keep it: eject (keel doctor --fix AGENTS.md eject).' }], gate: 'ok' };
  const none = tendReportOf(pass, { commits: [], now: new Date('2026-10-12T10:00:00Z') });
  assert.equal(none.input, null);
  assert.match(none.line, /^Tend 2026-10-12: resolved 0 of 2 findings \(record count 2 → \?\); 1 proposed for the owner; 1 unresolved: lint:phase:docs\/phases\/02-acme\.md; 18 min$/);
  const one = tendReportOf(pass, { commits: [{ sha: 'a'.repeat(40), subject: 'Fix the phase section', cites: ['lint:phase:docs/phases/02-acme.md'] }], files: ['docs/phases/02-acme.md'], after: { measures: [{ id: 'lint', state: 'ok', value: 0 }, { id: 'drift', state: 'outside', value: 1 }], reconciliation: worksheet.reconciliation } });
  const body = prBody(one.input);
  assert.match(body, /"phases":\["docs\/phases\/02-acme\.md"\]/);
  assert.match(body, /"reconciliation":"updated"/);
  assert.match(body, /^\| \*\*record count\*\* \| 2 \| 1 \|$/m);
  assert.match(body, /^\| reconciliation findings \| n\/a \| n\/a \|$/m);
});

test('the health page\'s Tend line: what the newest pass resolved, its PR, and each finding it left with what it tried; nothing when tend is off or never ran', async t => {
  const pass = { date: '2026-10-12', worksheet: { findings: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, line: 'x', resolved: ['a'], proposed: [{ finding: 'b', text: 'p' }], unresolved: [{ id: 'c', what: 'c', tried: 'Read it;\nout of budget.' }], pr: 12 };
  assert.equal(tendLine({ tend: {} }, pass), 'Tend: 2026-10-12: resolved 1 of 3, 1 proposed for the owner, PR #12; unresolved: `c` (tried: Read it; out of budget.).');
  assert.equal(tendLine({}, pass), null, 'tend off');
  assert.equal(tendLine({ tend: {} }, undefined), null, 'never ran');
  assert.match(tendLine({ tend: {} }, 'unreadable'), /^Tend: the newest record \(\.keel\/tend\/pass\.json\) is unreadable/);
  assert.match(tendLine({ tend: {} }, { ...pass, line: undefined, gate: null }), /^Tend: 2026-10-12: 3 findings on the worksheet; the pass did not finish \(the tend guard or the gate did not pass\)/);
  assert.match(tendLine({ tend: {} }, { ...pass, unresolved: [{ id: 'c' }], pr: undefined, resolved: [] }), /nothing to merge; unresolved: `c` \(not tried\)\.$/);
  // On the page, from the record the night fetched into .keel/tend.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-tend-page-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel/tend'), { recursive: true });
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', practices: ['base', 'night', 'climb'], tend: {} }));
  await writeFile(join(dir, '.keel/tend/pass.json'), JSON.stringify(pass));
  const r = await improve({ root: dir, report: true, date: '2026-10-13' }, { env: ENV, measures: [] });
  assert.equal(r.data.tend, tendLine({ tend: {} }, pass));
  assert.match(await readFile(join(dir, 'docs/health/2026-10-13.md'), 'utf8'), /^Ratchet: no bound moved\.\n\nTend: 2026-10-12: resolved 1 of 3/m);
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', practices: ['base', 'night', 'climb'] }));
  const off = await improve({ root: dir, report: true, date: '2026-10-14' }, { env: ENV, measures: [] });
  assert.equal(off.data.tend, null);
  assert.doesNotMatch(await readFile(join(dir, 'docs/health/2026-10-14.md'), 'utf8'), /Tend:/);
});

test('the tend brief says what tend may do, may only propose, and may never do, in the second person', async () => {
  const brief = await readFile(join(KEEL, 'practices/climb/files/.agents/climb/TEND.md'), 'utf8');
  for (const h of ['## You may\n', '## You may only propose\n', '## You may never\n']) assert.ok(brief.includes(h), h);
  const never = brief.slice(brief.indexOf('## You may never'), brief.indexOf('## How you work'));
  for (const re of [/docs\/evidence\//, /`built`, `lived-in` or `accepted`/, /acceptance box/, /delete a file, a branch, a PR or data/, /merge/]) assert.match(never, re);
  assert.match(brief, /`Tend: <finding id>`/, 'every change cites its finding');
  assert.ok(pathToFileURL(join(KEEL, 'practices/climb/files/scripts/keel/tend.mjs')));
});

test('the page\'s date is a day and the run\'s: a record dated "../evidence/x" or another day writes nothing (ledger#94)', async t => {
  const dir = await acme(t);
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['switch', '-q', '-c', 'keel-tend/2026-10-12']);
  json(climb(dir, ['tend-input', '--record', '--date', '2026-10-12', '--json']));
  assert.equal(climb(dir, ['tend-note', '--finding', 'proofs_hold:1', '--propose', 'Step phase 1 back to partial.']).status, 0);
  const passFile = join(dir, '.keel/tend/pass.json');
  const pass = JSON.parse(await readFile(passFile, 'utf8'));
  const evidence = await readFile(join(dir, 'docs/evidence/2026-10-01-acme-orders.md'), 'utf8');
  for (const [date, re] of [['../evidence/2026-10-01-acme-orders', /names its date "\.\.\/evidence\/2026-10-01-acme-orders", which is not a day/], ['2026-10-13', /names its date 2026-10-13, not the run's 2026-10-12 \(--date\)/], ['2026-02-30', /not a day/]]) {
    await writeFile(passFile, JSON.stringify({ ...pass, date }));
    for (const verb of ['tend-page', 'tend-report']) {
      const r = climb(dir, [verb, '--base', base, '--date', '2026-10-12', '--json']);
      assert.equal(r.status, 2, `${verb} ${date}: ${r.stdout}`);
      assert.match(json(r).error, re, `${verb} ${date}`);
    }
    assert.equal(await readFile(join(dir, 'docs/evidence/2026-10-01-acme-orders.md'), 'utf8'), evidence, 'evidence untouched');
    assert.equal(git(dir, ['rev-parse', 'HEAD']), base, 'nothing committed');
  }
  // Without --date (a person's own run), the record's date must still be a day: the path never leaves docs/tend/.
  await writeFile(passFile, JSON.stringify({ ...pass, date: '../evidence/2026-10-01-acme-orders' }));
  assert.equal(climb(dir, ['tend-page', '--json']).status, 2);
  assert.equal(git(dir, ['status', '--porcelain']), '');
  assert.equal(climb(dir, ['tend-page', '--date', '../x', '--json']).status, 2, 'a --date that is not a day');
});

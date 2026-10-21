// The night in a box's GitHub (plates phase 86): a stub gh with a state file,
// for tests/night-box.test.mjs. It knows the calls a night makes of GitHub
// and nothing else: issues (the morning's brief, the robot's queue), labels,
// pull requests (list, create, edit) and the contents API for the plan branch,
// which it answers from the box's bare origin, as GitHub would from the repo.
// Every other call fails, as an unreachable GitHub does, so a stage that
// starts needing GitHub shows up as a failure, never as an empty answer.
//
// PLATES_BOX_GH_STATE: the state file ({ issues, prs, nextIssue, nextPr });
// PLATES_BOX_GH_LOG: each call appended as JSON; PLATES_BOX_ORIGIN: the bare repo.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const a = process.argv.slice(2);
const { PLATES_BOX_GH_STATE: STATE, PLATES_BOX_GH_LOG: LOG, PLATES_BOX_ORIGIN: ORIGIN } = process.env;
const opt = f => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
const input = opt('--body-file') === '-' ? readFileSync(0, 'utf8') : opt('--body-file') ? readFileSync(opt('--body-file'), 'utf8') : null;
appendFileSync(LOG, `${JSON.stringify({ a, input })}\n`);
const s = JSON.parse(readFileSync(STATE, 'utf8'));
const save = () => writeFileSync(STATE, JSON.stringify(s, null, 2));
const out = v => process.stdout.write(`${typeof v === 'string' ? v : JSON.stringify(v)}\n`);
const fail = (why, code = 1) => { process.stderr.write(`${why}\n`); process.exit(code); };
const pick = rows => { const f = opt('--json'); return f ? rows.map(r => Object.fromEntries(f.split(',').map(k => [k, r[k] ?? null]))) : rows; };
const repo = opt('--repo') ?? 'acme/anvils';

if (a[0] === 'issue' && a[1] === 'list') {
  const label = opt('--label'), state = opt('--state') ?? 'open';
  const rows = s.issues.filter(i => i.label === label && (state === 'all' || i.state === state.toUpperCase()));
  out(pick(rows));
} else if (a[0] === 'label' && a[1] === 'create') {
  process.exit(0);
} else if (a[0] === 'issue' && a[1] === 'create') {
  const number = s.nextIssue++;
  s.issues.push({ number, title: opt('--title'), state: 'OPEN', assignee: opt('--assignee'), label: opt('--label'), repo, body: input });
  save();
  out(`https://github.com/${repo}/issues/${number}`);
} else if (a[0] === 'issue' && a[1] === 'close') {
  const i = s.issues.find(x => x.number === Number(a[2]));
  if (!i) fail(`GraphQL: Could not resolve to an issue with the number of ${a[2]}.`);
  Object.assign(i, { state: 'CLOSED', comment: opt('--comment') });
  save();
} else if (a[0] === 'pr' && a[1] === 'list') {
  const state = opt('--state') ?? 'open', head = opt('--head');
  const rows = s.prs.filter(p => (state === 'all' || p.state === state.toUpperCase()) && (!head || p.headRefName === head));
  if (opt('--jq') === '.[0].number') out(rows[0] ? String(rows[0].number) : '');
  else if (opt('--jq')) fail(`stub gh: no --jq ${opt('--jq')} here`);
  else out(pick(rows));
} else if (a[0] === 'pr' && a[1] === 'create') {
  const head = opt('--head');
  if (s.prs.some(p => p.headRefName === head && p.state === 'OPEN')) fail(`a pull request for branch "${head}" already exists`);
  const number = s.nextPr++;
  s.prs.push({ number, headRefName: head, baseRefName: opt('--base'), title: opt('--title'), state: 'OPEN', isCrossRepository: false, isDraft: false, createdAt: new Date().toISOString(), mergedAt: null, body: input });
  save();
  out(`https://github.com/${repo}/pull/${number}`);
} else if (a[0] === 'pr' && a[1] === 'edit') {
  const p = s.prs.find(x => x.number === Number(a[2]));
  if (!p) fail(`no pull request #${a[2]}`);
  p.body = input;
  save();
} else if (a[0] === 'api' && /^repos\/[^/]+\/[^/]+\/contents\/\.keel\/night\/plan\.json\?ref=keel-night-plan$/.test(a.at(-1))) {
  // The contents API on the plan branch: the bare origin's own bytes, or GitHub's 404.
  let text;
  try { text = execFileSync('git', ['--git-dir', ORIGIN, 'show', 'refs/heads/keel-night-plan:.keel/night/plan.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { fail('gh: Not Found (HTTP 404)'); }
  process.stdout.write(text);
} else {
  fail(`stub gh: not here: ${a.join(' ')}`);
}

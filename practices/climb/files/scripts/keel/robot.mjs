// Trusted robot orchestration. Issue/comment content is data, never executable policy.
import { readFile, writeFile, mkdir, rm, mkdtemp, symlink } from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { robotPolicy } from './robot-policy.mjs';
import { readRobotBudget, robotAdmission } from './robot-budget.mjs';
import { robotGithub, robotRead, robotPages, robotRepo, robotSha, robotId, robotAssociation, robotAssociationOf } from './robot-delivery.mjs';
import { agentsProblems, listedAgents, agentOf, gateEnv, isMain } from './lib.mjs';
import { sandboxProblems } from './tend.mjs';
import { missingTests, ranOn, packageDirs, lastResult } from './climb.mjs';
import { prBody } from './pr-body.mjs';
import { readRuns } from './test-ledger.mjs';

const BOT = 'github-actions[bot]';
const isBot = user => user?.type === 'Bot' && user.login === BOT;
const sha256 = text => createHash('sha256').update(text).digest('hex');
export const robotRedact = value => String(value ?? '').replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)/g, '[redacted]').replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)\S+/gi, '$1[redacted]').slice(0, 4000);
// Escape HTML delimiters so data can never become a trusted control marker.
const robotText = value => robotRedact(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('`', '&#96;');
export function robotProviders(config, has) {
  const problems = agentsProblems(config), author = agentOf(config, 'climb');
  const listed = listedAgents(config);
  if (!listed.includes(author) || !['claude', 'codex'].includes(author)) problems.push('build provider must be listed in agents');
  const reviewer = listed.find(n => n !== author && ['claude', 'codex'].includes(n));
  if (!reviewer) problems.push('robot needs a listed other-provider reviewer');
  if (!has?.[author] || !has?.[reviewer]) problems.push('build and other-provider review credentials are required');
  return { author, reviewer: reviewer ?? null, problems };
}
export async function robotWriter({ repo, user, github = robotGithub }) {
  if (!robotRepo(repo) || user?.type !== 'User' || !/^[A-Za-z0-9-]+$/.test(user.login ?? '')) return false;
  try {
    const data = await robotRead(github, `/repos/${repo}/collaborators/${encodeURIComponent(user.login)}/permission`);
    return data.user?.login === user.login && ['write', 'maintain', 'admin'].includes(data.permission);
  } catch { return false; }
}
function stateOf(comments, repo, issueNumber) {
  const states = [];
  for (const c of comments) {
    if (!isBot(c.user)) continue;
    const text = String(c.body ?? '');
    const m = /^<!-- keel:robot-note [a-f0-9]{64} -->\n<!-- keel:robot-state (.+) -->\n/.exec(text);
    if ((text.match(/<!-- keel:robot-state/g) ?? []).length !== 1) continue;
    if (!m) continue;
    try {
      const s = JSON.parse(m[1]);
      if (s.repo === repo && s.issueNumber === issueNumber && Number.isSafeInteger(s.cursor) && s.cursor >= 0 && s.cursor < c.id && /^[a-f0-9]{64}$/.test(s.issueHash) && /^[A-Za-z0-9_-]{1,128}$/.test(s.instanceId) && Number.isFinite(Date.parse(s.completedAt)) && (s.headSha === null || robotSha(s.headSha))) states.push({ ...s, commentId: c.id });
    } catch { /* unrecognised text is not state */ }
  }
  return states.sort((a,b) => b.commentId - a.commentId)[0] ?? null;
}
function publicationOf(comments, repo, issueNumber) {
  for (const c of [...comments].sort((a,b) => b.id-a.id)) {
    if (!isBot(c.user)) continue;
    const m = /^<!-- keel:robot-publication (.+) -->\nTrusted publication intent; recovery may publish only this judged head\.$/.exec(c.body ?? '');
    if (!m) continue;
    try {
      const intent = JSON.parse(m[1]);
      validateRobotPlan(intent.plan, {repo, baseSha:intent.plan.baseSha});
      if (intent.version !== 1 || intent.plan.issueNumber !== issueNumber || !robotSha(intent.headSha) || !/^[a-f0-9]{64}$/.test(intent.plan.issueHash) || intent.plan.cursor >= c.id) continue;
      return {...intent, commentId:c.id};
    } catch { /* not a trusted publication envelope */ }
  }
  return null;
}
export async function prepareRobot({ root, repo, config, event, eventName, has, now = new Date(), github = robotGithub, preflight = null }) {
  const blocked = (reason, extra = {}) => ({ state: 'blocked', reason, ...extra });
  const policy = robotPolicy(config);
  if (!policy.valid || !policy.enabled) return blocked(policy.valid ? 'robot is off' : policy.problems.join('; '));
  if (!robotRepo(repo) || event?.repository?.full_name !== repo) return blocked('event repository mismatch');
  let issues;
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') {
    issues = (await robotPages(github, `/repos/${repo}/issues?state=open&labels=keel%3Aagent&sort=created&direction=asc`)).filter(i => !i.pull_request);
  } else if ((eventName === 'issues' && ['labeled', 'reopened'].includes(event.action)) || (eventName === 'issue_comment' && event.action === 'created')) {
    if (event.issue?.pull_request || !robotId(event.issue?.number)) return blocked('not an issue event');
    if (eventName === 'issues' && event.action === 'labeled' && event.label?.name !== 'keel:agent') return blocked('not the robot label');
    if (!await robotWriter({ repo, user: event.sender, github })) return blocked('sender does not have verified write access');
    issues = [event.issue];
  } else return blocked('unsupported event');
  const providers = robotProviders(config, has);
  for (const candidate of issues) {
    if (!robotId(candidate.number)) return blocked('invalid issue identity');
    const issue = await robotRead(github, `/repos/${repo}/issues/${candidate.number}`);
    if (issue.number !== candidate.number || issue.html_url !== `https://github.com/${repo}/issues/${candidate.number}` || issue.pull_request) return blocked('issue identity mismatch');
    if (issue.state !== 'open' || !issue.labels?.some(l => l.name === 'keel:agent')) continue;
    const comments = await robotPages(github, `/repos/${repo}/issues/${issue.number}/comments`);
    if (comments.some(c => !robotId(c.id))) return blocked('comment identity unavailable');
    if (eventName === 'issue_comment' && !comments.some(c => c.id === event.comment?.id && c.user?.login === event.sender.login && c.user?.type === 'User')) return blocked('triggering comment unavailable');
    const state = stateOf(comments, repo, issue.number);
    const pending = publicationOf(comments, repo, issue.number);
    if (pending && (!state || pending.commentId > state.commentId)) {
      if (pending.plan.issueHash !== sha256(issue.body ?? '')) return blocked('pending publication issue changed; owner resolution needed');
      const ref = await github({method:'GET',path:`/repos/${repo}/git/ref/heads/${pending.plan.branch}`});
      if (ref.status === 200 && ref.data?.ref === `refs/heads/${pending.plan.branch}` && ref.data.object?.type === 'commit' && ref.data.object.sha === pending.headSha) return {...pending.plan, state:'recover', recoveryHead:pending.headSha};
      // A crash before push leaves no new branch/head: normal admission can rebuild.
      const unpushed = (ref.status === 404 && pending.plan.previousHead === null) || (ref.status === 200 && ref.data?.ref === `refs/heads/${pending.plan.branch}` && ref.data.object?.type === 'commit' && ref.data.object.sha === pending.plan.previousHead);
      if (!unpushed) return blocked('pending publication branch changed or unavailable; refusing recovery', {repo,issueNumber:issue.number});
    }
    const unseen = [];
    for (const c of comments.filter(c => c.id > (state?.cursor ?? 0)).sort((a,b) => a.id-b.id)) {
      if (await robotWriter({ repo, user: c.user, github })) unseen.push({ id: c.id, body: robotRedact(c.body), user: c.user.login });
    }
    if (state && state.issueHash === sha256(issue.body ?? '') && !unseen.length && !(eventName === 'issues' && event.action === 'reopened')) continue;
    const cursor = unseen.at(-1)?.id ?? state?.cursor ?? 0;
    const issueMarks = [...String(issue.body ?? '').matchAll(/^<!-- keel:robot-issue (.+) -->$/gm)];
    let instanceId = state?.instanceId ?? `issue-${issue.number}`;
    if (issueMarks.length) {
      let mark;
      try { mark = JSON.parse(issueMarks[0][1]); } catch { return blocked('issue instance marker malformed'); }
      if (issueMarks.length !== 1 || mark.version !== 1 || mark.repo !== repo.toLowerCase() || !/^[A-Za-z0-9_-]{1,128}$/.test(mark.instanceId) || !/^[a-f0-9]{64}$/.test(mark.subject) || (state && state.instanceId !== mark.instanceId)) return blocked('issue instance identity changed or malformed');
      instanceId = mark.instanceId;
    }
    const common = { instanceId, repo, issueNumber: issue.number, cursor, previousCompletedAt: state?.completedAt ?? null, issueHash: sha256(issue.body ?? ''), author: providers.author, reviewer: providers.reviewer };
    const { parseRobotRubric } = await import('./robot-rubric.mjs');
    const parsed = parseRobotRubric(issue.body);
    if (!parsed.ok) return blocked(`rubric: ${parsed.problems.map(p => p.message).join('; ')}`, { ...common, triage: true });
    if (parsed.rubric.ownerBlockers.length) return blocked('owner-only blockers remain', { ...common, triage: true });
    // Prerequisites are deliberately fail-closed until verified: prose is not evidence.
    if (parsed.rubric.prerequisites.length) return blocked('prerequisite verification unavailable; resolve prerequisites before labelling', { ...common, triage: true });
    if (providers.problems.length) return blocked(providers.problems.join('; '), common);
    const pulls = await robotPages(github, `/repos/${repo}/pulls?state=all&head=${encodeURIComponent(repo.split('/')[0] + ':keel/robot-' + issue.number)}`);
    if (pulls.length > 1) return blocked('multiple robot pull requests; owner resolution needed', common);
    let previousHead = null, prNumber = null;
    if (pulls.length) {
      const pr = await robotRead(github, `/repos/${repo}/pulls/${pulls[0].number}`);
      const association = robotAssociationOf(pr.body);
      if (!state?.headSha || pr.state !== 'open' || pr.merged_at || !isBot(pr.user) || pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo || pr.head?.ref !== `keel/robot-${issue.number}` || pr.head?.sha !== state.headSha || association?.headSha !== state.headSha || association?.repo !== repo || association?.issueNumber !== issue.number) return blocked('continuation head or association changed; no human changes are overwritten', common);
      previousHead = pr.head.sha; prNumber = pr.number;
    } else if (state?.headSha) return blocked('recorded pull request unavailable', common);
    const baseSha = git(root, ['rev-parse', 'HEAD']);
    if (!robotSha(baseSha)) return blocked('trusted base unavailable', common);
    const budget = await readRobotBudget({ repo, policy, now, github, preflight });
    const admission = robotAdmission({ policy, budget, requestedBuildSeconds: 45 * 60, reservedReviewSeconds: 5 * 60 });
    if (!admission.allowed) return blocked(admission.reason, { ...common, budget });
    return { state: 'ready', ...common, baseSha, previousHead, prNumber, instanceId, branch: `keel/robot-${issue.number}`, comments: unseen, rubric: parsed.rubric, buildSeconds: admission.buildSeconds, reviewSeconds: admission.reviewSeconds, budget, preparedAt: new Date(now).toISOString() };
  }
  return blocked('no pending robot issue');
}
const safeEnv = env => ({ ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0' });
function git(root, args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd: root, env: safeEnv(process.env), encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  if (allowFail) return r;
  if (r.error || r.status !== 0) throw new Error('robot git operation failed');
  return r.stdout.trim();
}
export function robotSandbox(root, base, head) {
  const problems = sandboxProblems(root, base, head);
  const files = git(root, ['diff', '--name-only', '--no-renames', '-z', base, head]).split('\0').filter(Boolean);
  if (files.some(p => /^docs\/(?:phases\/|decisions\/|evidence\/|research\/|projects\/|design\.md$|goals\.json$|ROADMAP\.md$)/.test(p))) problems.push('record changes require owner reconciliation; robot cannot publish phase, decision, evidence or project-record changes');
  if (files.some(p => p.startsWith('.agents/') || p.startsWith('.claude/') || p.startsWith('.codex/'))) problems.push('agent protocols and settings are off limits');
  return problems;
}
export async function judgeRobot({ root, config, baseSha, headSha, env = process.env }) {
  const problems = robotSandbox(root, baseSha, headSha);
  if (problems.length) return { ok: false, problems };
  if (baseSha === headSha) return { ok: false, problems: ['no change committed'] };
  const gate = config.check;
  if (typeof gate !== 'string' || !gate.trim()) return { ok: false, problems: ['configured full gate unavailable'] };
  const results = [];
  // Fresh sibling worktrees share installed dependencies, not any agent ledger.
  for (const ref of [baseSha, headSha]) {
    const dir = await mkdtemp(join(dirname(resolve(root)), '.keel-robot-judge-'));
    try {
      git(root, ['worktree', 'add', '--detach', '--quiet', dir, ref]);
      for (const p of ['.', ...await packageDirs(root)]) {
        if (existsSync(join(root,p,'node_modules')) && existsSync(join(dir,p)) && !existsSync(join(dir,p,'node_modules'))) await symlink(join(root,p,'node_modules'), join(dir,p,'node_modules'), 'dir');
      }
      const before = new Set((await readRuns(dir)).runs.map(r => r.id));
      const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !/^(?:GH_|GITHUB_|ACTIONS_|KEEL_AGENT_GIT|NODE_TEST_)/.test(k)));
      const ran = spawnSync(gate, { cwd: dir, shell: true, env: gateEnv(clean, config), encoding: 'utf8', timeout: 60 * 60_000, maxBuffer: 64 * 1024 * 1024 });
      if (ran.error || ran.status !== 0) return { ok: false, problems: [`full gate failed on ${ref}`] };
      const record = ranOn((await readRuns(dir)).runs.filter(r => !before.has(r.id)), ref);
      if (!record || !record.tests.some(t => ['pass','fail'].includes(t.outcome))) return { ok: false, problems: ['full gate recorded no executed test identities'] };
      results.push(record);
    } finally { git(root, ['worktree', 'remove', '--force', dir], { allowFail: true }); await rm(dir, { recursive: true, force: true }); }
  }
  const missing = missingTests(...results);
  return { ok: !missing.length, problems: missing.map(t => `${t.how}: ${t.file} ${t.name}`), baseSha, headSha };
}

export function validateRobotPlan(plan, { repo, baseSha }) {
  if (plan?.state !== 'ready' || plan.repo !== repo || plan.baseSha !== baseSha || !robotSha(baseSha) || !robotId(plan.issueNumber) || plan.branch !== `keel/robot-${plan.issueNumber}` || !Number.isSafeInteger(plan.cursor) || plan.cursor < 0 || !/^[A-Za-z0-9_-]{1,128}$/.test(plan.instanceId) || !['claude','codex'].includes(plan.author) || !['claude','codex'].includes(plan.reviewer) || plan.author === plan.reviewer || (plan.previousHead !== null && !robotSha(plan.previousHead))) throw new Error('robot handoff identity mismatch');
  return plan;
}
async function revalidateIssue(plan, github) {
  const issue = await robotRead(github, `/repos/${plan.repo}/issues/${plan.issueNumber}`);
  if (issue.number !== plan.issueNumber || issue.html_url !== `https://github.com/${plan.repo}/issues/${plan.issueNumber}` || issue.pull_request || issue.state !== 'open' || !issue.labels?.some(l => l.name === 'keel:agent') || sha256(issue.body ?? '') !== plan.issueHash) throw new Error('issue closed, unlabelled or changed since admission');
  return issue;
}
function publicationPlan(plan) {
  return Object.fromEntries(['state','repo','baseSha','issueNumber','issueHash','cursor','instanceId','author','reviewer','previousHead','prNumber','branch'].map(k => [k,plan[k]]));
}
function publicationBody(plan, headSha) {
  return `<!-- keel:robot-publication ${JSON.stringify({version:1,plan:publicationPlan(plan),headSha})} -->\nTrusted publication intent; recovery may publish only this judged head.`;
}
export async function publishRobot({ root, repo, baseSha, plan, headSha, message = '', github = robotGithub, push = true }) {
  validateRobotPlan(plan, { repo, baseSha });
  const policy = robotPolicy(JSON.parse(await readFile(join(root, '.keel/keel.json'), 'utf8')));
  if (!policy.valid || !policy.enabled) throw new Error('trusted robot policy no longer permits publication');
  await revalidateIssue(plan, github);
  if (!robotSha(headSha) || headSha === baseSha || robotSandbox(root, baseSha, headSha).length) throw new Error('candidate fails trusted sandbox');
  if (plan.previousHead && git(root, ['merge-base','--is-ancestor',plan.previousHead,headSha], {allowFail:true}).status !== 0) throw new Error('candidate discards continuation history');
  let pr = null;
  const pulls = await robotPages(github, `/repos/${repo}/pulls?state=all&head=${encodeURIComponent(repo.split('/')[0]+':'+plan.branch)}`);
  const savedIntent = publicationOf(await robotPages(github, `/repos/${repo}/issues/${plan.issueNumber}/comments`),repo,plan.issueNumber);
  const resuming = savedIntent && savedIntent.headSha === headSha && JSON.stringify(savedIntent.plan) === JSON.stringify(publicationPlan(plan));
  if (plan.prNumber) {
    if (pulls.length !== 1 || pulls[0].number !== plan.prNumber) throw new Error('continuation PR changed');
    pr = await robotRead(github, `/repos/${repo}/pulls/${plan.prNumber}`);
    const mark = robotAssociationOf(pr.body);
    if (pr.state !== 'open' || pr.merged_at || (pr.head?.sha !== plan.previousHead && !(resuming && pr.head?.sha === headSha)) || pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo || (mark?.headSha !== plan.previousHead && !(resuming && mark?.headSha === headSha)) || mark?.instanceId !== plan.instanceId || mark?.author !== plan.author || pr.head?.ref !== plan.branch || mark?.issueNumber !== plan.issueNumber || mark?.repo !== repo || !isBot(pr.user)) throw new Error('continuation changed; refusing to overwrite');
    if (resuming && mark.headSha === headSha && pr.head.sha === headSha && pr.html_url === `https://github.com/${repo}/pull/${pr.number}`) return {prNumber:pr.number,prUrl:pr.html_url,headSha};
  } else if (pulls.length) {
    const intent = publicationOf(await robotPages(github, `/repos/${repo}/issues/${plan.issueNumber}/comments`),repo,plan.issueNumber);
    const existing = pulls.length === 1 ? await robotRead(github, `/repos/${repo}/pulls/${pulls[0].number}`) : null;
    const mark = robotAssociationOf(existing?.body);
    if (!intent || intent.headSha !== headSha || JSON.stringify(intent.plan) !== JSON.stringify(publicationPlan(plan)) || !existing || existing.state !== 'open' || existing.merged_at || !isBot(existing.user) || existing.head?.ref !== plan.branch || existing.head?.sha !== headSha || existing.head?.repo?.full_name !== repo || existing.base?.repo?.full_name !== repo || existing.html_url !== `https://github.com/${repo}/pull/${existing.number}` || mark?.instanceId !== plan.instanceId || mark?.headSha !== headSha || mark?.repo !== repo || mark?.issueNumber !== plan.issueNumber || mark?.author !== plan.author) throw new Error('a pull request appeared since admission');
    return {prNumber:existing.number,prUrl:existing.html_url,headSha};
  }
  const association = robotAssociation({ ...plan, headSha });
  const files = git(root,['diff','--name-only','--no-renames','-z',baseSha,headSha]).split('\0').filter(Boolean);
  const newBody = `${association}\n\n${prBody({
    summary:{lead:`Robot candidate for issue #${plan.issueNumber}; acceptance remains with the owner.`,files:files.map(robotText)},
    evidence:{gate:`Configured full gate passed on base ${baseSha} and candidate ${headSha}; no executed test dropped.`},
    danger:{door:'two-way',why:'Reverting this candidate restores its file changes; operational effects and acceptance still require owner review.',surfaces:['adopted project','published package']},
    notes:[`Closes #${plan.issueNumber}`,robotText(message) || 'Agent supplied no final message.',`Other-provider review pending (${plan.reviewer}); only a person merges.`],
    impact:{declaration:{version:1,phases:[],decisions:[],supersedes:[],evidence:[],reconciliation:'none',reason:'Trusted diff contains no phase, decision, evidence, research/design or project-record changes; record updates are blocked by the robot sandbox. This candidate does not establish acceptance.'}},
  })}`;
  const body = pr ? `${pr.body.replace(/^<!-- keel:robot-delivery .+ -->$/m, association)}\n\nContinuation (${headSha.slice(0,12)}):\n${robotText(message)}\nOther-provider review pending (${plan.reviewer}).\n` : newBody;
  if (body.length > 60_000) throw new Error('PR conversation exceeds safe update bound; owner resolution needed');
  // Resolve and validate the target before any branch mutation.
  const repository = await robotRead(github, `/repos/${repo}`);
  if (typeof repository.default_branch !== 'string' || git(root,['check-ref-format','--branch',repository.default_branch],{allowFail:true}).status !== 0) throw new Error('default branch unavailable');
  const comments = await robotPages(github, `/repos/${repo}/issues/${plan.issueNumber}/comments`);
  const intent = publicationOf(comments,repo,plan.issueNumber);
  const recovery = intent && intent.headSha === headSha && JSON.stringify(intent.plan) === JSON.stringify(publicationPlan(plan));
  if (!recovery) {
    const saved = await github({method:'POST',path:`/repos/${repo}/issues/${plan.issueNumber}/comments`,body:{body:publicationBody(plan,headSha)}});
    if (saved.status !== 201) throw new Error('publication intent could not be persisted; no push attempted');
  }
  // Recovery may reuse only the exact previously judged head; an unrelated or moved
  // branch always fails the original lease. No agent objects/config are executed.
  const remote = push ? git(root,['ls-remote','--heads','origin',`refs/heads/${plan.branch}`]).split(/\s+/)[0] : '';
  if (push && !(recovery && remote === headSha)) git(root, ['push', `--force-with-lease=refs/heads/${plan.branch}:${plan.previousHead ?? ''}`, 'origin', `${headSha}:refs/heads/${plan.branch}`]);
  const response = await github({ method: pr ? 'PATCH' : 'POST', path: `/repos/${repo}/pulls${pr ? '/'+pr.number : ''}`, body: pr ? {body} : { title: `Robot: issue #${plan.issueNumber}`, body, head: plan.branch, base: repository.default_branch } });
  if (![200,201].includes(response.status) || !robotId(response.data?.number)) throw new Error('PR publication ambiguous; inspect existing branch/PR before recovery');
  pr = await robotRead(github, `/repos/${repo}/pulls/${response.data.number}`);
  if (!isBot(pr.user) || pr.state !== 'open' || pr.head?.ref !== plan.branch || pr.head?.sha !== headSha || pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo || robotAssociationOf(pr.body)?.instanceId !== plan.instanceId || robotAssociationOf(pr.body)?.author !== plan.author || pr.html_url !== `https://github.com/${repo}/pull/${pr.number}` || robotAssociationOf(pr.body)?.headSha !== headSha) throw new Error('PR read-back identity mismatch');
  return { prNumber: pr.number, prUrl: pr.html_url, headSha };
}
export async function robotComment({ plan, result, message = '', github = robotGithub, now = new Date() }) {
  if (!robotRepo(plan.repo) || !robotId(plan.issueNumber)) return;
  const comments = await robotPages(github, `/repos/${plan.repo}/issues/${plan.issueNumber}/comments`);
  const marker = `<!-- keel:robot-note ${sha256(JSON.stringify([plan.issueHash,result.state === 'question' ? null : plan.cursor,result.state,result.reason ?? '',result.headSha ?? '']))} -->`;
  if (comments.some(c => isBot(c.user) && c.body?.startsWith(marker + '\n'))) return;
  const state = ['published','failed','question'].includes(result.state) ? `<!-- keel:robot-state ${JSON.stringify({ repo: plan.repo, issueNumber: plan.issueNumber, issueHash: plan.issueHash, cursor: plan.cursor, instanceId: plan.instanceId ?? `issue-${plan.issueNumber}`, headSha: result.headSha ?? plan.previousHead ?? null, completedAt: new Date(now).toISOString(), previousCompletedAt: plan.previousCompletedAt ?? null })} -->\n` : '';
  const body = `${marker}\n${state}${result.prUrl ? `PR: ${result.prUrl}\n\n` : ''}${robotText(result.reason ?? result.state)}\n\n${robotText(message)}`;
  const response = await github({method:'POST', path:`/repos/${plan.repo}/issues/${plan.issueNumber}/comments`, body:{body}});
  if (response.status !== 201) throw new Error('issue response could not be confirmed');
}
export async function prepareRobotReview({ root, repo, prNumber, headSha, has, now = new Date(), github = robotGithub, preflight = null }) {
  const config = JSON.parse(await readFile(join(root,'.keel/keel.json'),'utf8')), policy = robotPolicy(config);
  const providers = robotProviders(config, has);
  if (!policy.valid || !policy.enabled || providers.problems.length || !robotRepo(repo) || !robotId(prNumber) || !robotSha(headSha)) throw new Error('review policy/identity unavailable');
  const pr = await robotRead(github, `/repos/${repo}/pulls/${prNumber}`), mark = robotAssociationOf(pr.body);
  if (!mark || mark.repo !== repo || mark.author !== providers.author || mark.headSha !== headSha || pr.head?.sha !== headSha || pr.state !== 'open' || pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo || pr.head?.ref !== `keel/robot-${mark.issueNumber}` || !isBot(pr.user)) throw new Error('published head/provenance changed before review');
  const budget = await readRobotBudget({ repo,policy,now,github,preflight });
  const seconds = Math.floor(Math.min(300,budget.remainingSeconds ?? 0)/60)*60;
  if (!budget.complete || budget.state !== 'available' || seconds < 60) throw new Error('review allowance unavailable');
  return { repo,prNumber,headSha,author:providers.author,reviewer:providers.reviewer,reviewSeconds:seconds,issueNumber:mark.issueNumber };
}
export async function postRobotReview({ review, message, github = robotGithub }) {
  if (!robotRepo(review.repo) || !robotId(review.prNumber) || !robotSha(review.headSha) || !['claude','codex'].includes(review.author) || !['claude','codex'].includes(review.reviewer) || review.author === review.reviewer || !String(message ?? '').trim()) throw new Error('review is empty or identity invalid');
  const pr = await robotRead(github, `/repos/${review.repo}/pulls/${review.prNumber}`), mark = robotAssociationOf(pr.body);
  if (pr.head?.sha !== review.headSha || pr.head?.repo?.full_name !== review.repo || pr.base?.repo?.full_name !== review.repo || pr.state !== 'open' || mark?.author !== review.author || mark?.headSha !== review.headSha || !isBot(pr.user)) throw new Error('head changed before review publication');
  const marker = `<!-- keel:robot-review ${review.headSha} ${review.reviewer} -->`;
  const prior = await robotPages(github, `/repos/${review.repo}/pulls/${review.prNumber}/reviews`);
  if (prior.some(r => isBot(r.user) && r.commit_id === review.headSha && r.body?.startsWith(marker + '\n'))) return {posted:false,already:true};
  const r = await github({method:'POST',path:`/repos/${review.repo}/pulls/${review.prNumber}/reviews`,body:{commit_id:review.headSha,event:'COMMENT',body:`${marker}\nReviewed by ${review.reviewer}; built by ${review.author}.\n\n${robotText(message)}`}});
  if (r.status !== 200 && r.status !== 201) throw new Error('review publication unavailable');
  return {posted:true};
}

const json = path => readFile(path,'utf8').then(JSON.parse);
const hasOf = env => ({ claude: Boolean(env.ROBOT_HAS_CLAUDE === 'true'), codex: Boolean(env.ROBOT_HAS_CODEX === 'true') });
function outputs(values) {
  for (const [key,value] of Object.entries(values)) {
    if (!/^[a-z_]+$/.test(key) || /[\r\n]/.test(String(value))) throw new Error('invalid robot workflow output');
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
export async function robotCli(args, env = process.env) {
  const [command] = args, root = resolve(env.GITHUB_WORKSPACE ?? '.'), repo = env.GITHUB_REPOSITORY;
  const temp = env.RUNNER_TEMP;
  if (!temp) throw new Error('RUNNER_TEMP is required');
  const config = await json(join(root,'.keel/keel.json'));
  const trustedBase = git(root,['rev-parse','HEAD']);
  const write = (name,value) => writeFile(join(temp,name),JSON.stringify(value));
  if (command === 'sandbox') {
    const problems = robotSandbox(root, env.GITHUB_SHA, trustedBase);
    if (problems.length) throw new Error(problems.join('; '));
    return {ok:true};
  }
  if (command === 'prepare') {
    const plan = await prepareRobot({root,repo,config,event:await json(env.GITHUB_EVENT_PATH),eventName:env.GITHUB_EVENT_NAME,has:hasOf(env),preflight:{runId:Number(env.GITHUB_RUN_ID),attempt:Number(env.GITHUB_RUN_ATTEMPT),job:env.GITHUB_JOB}});
    await write('robot-plan.json',plan);
    outputs({ready:plan.state === 'ready',issue:plan.issueNumber ?? '',base:trustedBase,author:plan.author ?? '',reviewer:plan.reviewer ?? '',build_minutes:plan.buildSeconds ? plan.buildSeconds/60 : 1,review_minutes:plan.reviewSeconds ? plan.reviewSeconds/60 : 1});
    if (plan.state === 'ready') {
      const protocol = await readFile(join(root,'.agents/robot/PROTOCOL.md'),'utf8');
      await writeFile(join(temp,'robot-prompt.md'),`${protocol}\n\n## Trusted allocation and untrusted issue data\n${JSON.stringify(plan,null,2)}\n`);
    }
    return plan;
  }
  if (command === 'judge') {
    const plan = await json(join(temp,'plan/robot-plan.json'));
    validateRobotPlan(plan,{repo,baseSha:trustedBase});
    git(root,['fetch','--no-tags',join(temp,'handoff/robot.bundle'),`refs/heads/${plan.branch}`]);
    const headSha=git(root,['rev-parse','FETCH_HEAD']);
    const result=await judgeRobot({root,config,baseSha:trustedBase,headSha});
    if (!result.ok) throw new Error(result.problems.join('; '));
    await write('robot-judgment.json',result); outputs({head:headSha}); return result;
  }
  if (command === 'publish') {
    const plan = await json(join(temp,'plan/robot-plan.json'));
    if (plan.state === 'recover') {
      const restored = {...plan,state:'ready'};
      git(root,['fetch','--no-tags','origin',`refs/heads/${plan.branch}`]);
      if (git(root,['rev-parse','FETCH_HEAD']) !== plan.recoveryHead) throw new Error('pending publication branch moved; refusing recovery');
      const result = await publishRobot({root,repo,baseSha:plan.baseSha,plan:restored,headSha:plan.recoveryHead});
      await robotComment({plan:restored,result:{...result,state:'published',reason:'Recovered verified publication; other-provider review pending.'}});
      outputs({pr:result.prNumber,head:result.headSha});return result;
    }
    if (plan.state !== 'ready') { await robotComment({plan,result:{state:plan.triage?'question':'blocked',reason:plan.reason}}); return plan; }
    validateRobotPlan(plan,{repo,baseSha:trustedBase});
    const message=await readFile(join(temp,'handoff/message.txt'),'utf8').catch(()=> 'Agent supplied no final message.');
    if (env.ROBOT_JUDGE_OK !== 'true') { await robotComment({plan,result:{state:'failed',reason:'Agent or trusted judge failed; no PR published.'},message}); return {state:'failed'}; }
    const judgment=await json(join(temp,'judged/robot-judgment.json'));
    if (!judgment.ok || judgment.baseSha !== trustedBase || !robotSha(judgment.headSha) || judgment.headSha !== env.ROBOT_JUDGED_HEAD) throw new Error('judged identity mismatch');
    git(root,['fetch','--no-tags',join(temp,'handoff/robot.bundle'),`refs/heads/${plan.branch}`]);
    const headSha=git(root,['rev-parse','FETCH_HEAD']);
    if(headSha!==judgment.headSha) throw new Error('bundle differs from judged head');
    let result;
    try { result=await publishRobot({root,repo,baseSha:trustedBase,plan,headSha,message}); }
    catch (error) {
      await robotComment({plan,result:{state:'blocked',reason:`Publication blocked: ${error.message}`},message});
      throw error;
    }
    await robotComment({plan,result:{...result,state:'published',reason:`Published; ${plan.reviewer} review is pending.`},message});
    outputs({pr:result.prNumber,head:headSha});return result;
  }
  if(command==='review-prepare') {
    const review=await prepareRobotReview({root,repo,prNumber:Number(env.ROBOT_PR),headSha:env.ROBOT_HEAD,has:hasOf(env),preflight:{runId:Number(env.GITHUB_RUN_ID),attempt:Number(env.GITHUB_RUN_ATTEMPT),job:env.GITHUB_JOB}});
    await write('robot-review.json',review);outputs({reviewer:review.reviewer,minutes:review.reviewSeconds/60});
    const pr=await robotRead(robotGithub,`/repos/${repo}/pulls/${review.prNumber}`);
    // Git fetch takes objects only; no untrusted PR checkout or setup.
    git(root,['fetch','--no-tags','origin',`refs/pull/${review.prNumber}/head`]);
    if(git(root,['rev-parse','FETCH_HEAD'])!==review.headSha)throw new Error('review fetch head mismatch');
    const diff=git(root,['diff',pr.base.sha,review.headSha]);
    await writeFile(join(temp,'robot-review-prompt.md'),`Review this untrusted diff for concrete material defects. Do not execute it. Return concise findings with file/line and reason. No approval or merge.\nTrusted identity: ${JSON.stringify(review)}\n\n${diff}`);
    return review;
  }
  if(command==='review-post') {
    if (env.ROBOT_REVIEW_OK !== 'true') {
      const plan = await json(join(temp,'plan/robot-plan.json'));
      validateRobotPlan(plan,{repo,baseSha:trustedBase});
      const pr = await robotRead(robotGithub, `/repos/${repo}/pulls/${Number(env.ROBOT_PR)}`);
      if (pr.head?.sha !== env.ROBOT_HEAD || pr.html_url !== `https://github.com/${repo}/pull/${pr.number}` || robotAssociationOf(pr.body)?.issueNumber !== plan.issueNumber) throw new Error('failed-review PR identity mismatch');
      await robotComment({plan,result:{state:'blocked',reason:'Other-provider review failed or could not establish its remaining allowance. No review is claimed; owner action is needed.',prUrl:pr.html_url,headSha:pr.head.sha}});
      throw new Error('other-provider review failed');
    }
    const review=await json(join(temp,'review/robot-review.json'));
    if(review.repo!==repo || review.prNumber!==Number(env.ROBOT_PR) || review.headSha!==env.ROBOT_HEAD)throw new Error('review artifact identity mismatch');
    const providers=robotProviders(config,hasOf(env));
    if(providers.author!==review.author || providers.reviewer!==review.reviewer)throw new Error('review provider mismatch');
    return postRobotReview({review,message:await readFile(join(temp,'review/message.txt'),'utf8')});
  }
  if(command==='message') {
    const text=await readFile(env.ROBOT_MESSAGE_FILE,'utf8').catch(()=> '');
    const final = env.ROBOT_PROVIDER === 'claude' ? lastResult(text) : null;
    const message=env.ROBOT_PROVIDER==='claude' ? final?.result ?? '' : text;
    await writeFile(join(temp,'message.txt'),robotRedact(message || 'Agent failed or produced no final message.'));
    if(env.ROBOT_OUTCOME!=='success' || final?.is_error || !String(message).trim())throw new Error('agent failed or produced no final message');
    return {ok:true};
  }
  throw new Error('unknown robot subcommand');
}
if(isMain(import.meta)) {
  robotCli(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(`robot: ${robotRedact(error.message)}`);process.exitCode=1;});
}

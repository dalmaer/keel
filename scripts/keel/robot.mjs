// Trusted robot orchestration. Issue/comment content is data, never executable policy.
import { readFile, writeFile, mkdir, rm, mkdtemp, symlink } from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { robotPolicy } from './robot-policy.mjs';
import { readRobotBudget, robotAdmission } from './robot-budget.mjs';
import { robotGithub, robotRead, robotPages, robotRepo, robotSha, robotId, robotAssociation, robotAssociationOf, robotContinuation, robotDeliveryMetadata } from './robot-delivery.mjs';
import { agentsProblems, listedAgents, agentOf, gateEnv, isMain } from './lib.mjs';
import { sandboxProblems } from './tend.mjs';
import { missingTests, ranOn, packageDirs, lastResult } from './climb.mjs';
import { prBody } from './pr-body.mjs';
import { readRuns } from './test-ledger.mjs';

const BOT = 'github-actions[bot]';
const isBot = user => user?.type === 'Bot' && user.login === BOT;
const sha256 = text => createHash('sha256').update(text).digest('hex');
export const robotRedact = value => String(value ?? '').replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)/g, '[redacted]').replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)\S+/gi, '$1[redacted]').slice(0, 4000);
// Display only: interrupt GitHub closing verbs and escape Markdown so hostile
// formatting cannot reassemble them. File identities never pass through here.
const robotText = value => robotRedact(value)
  .replace(/\b(close[sd]?|fix(?:es|ed)?|resolve[sd]?)\b/gi, word => word[0] + '·' + word.slice(1))
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replace(/[\\`*_\[\]()~|]/g, char => `&#${char.charCodeAt(0)};`);
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
const hash64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
class RobotGlobalError extends Error {}
async function currentRobotPolicy(repo, has, github) {
  try {
    if (!robotRepo(repo)) throw new Error('repository identity unavailable');
    const repository = await robotRead(github, `/repos/${repo}`);
    if (repository.full_name !== repo || typeof repository.default_branch !== 'string' || !repository.default_branch.trim()) throw new Error('repository/default branch identity unavailable');
    const ref = await robotRead(github, `/repos/${repo}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`);
    if (ref.ref !== `refs/heads/${repository.default_branch}` || ref.object?.type !== 'commit' || !robotSha(ref.object.sha)) throw new Error('default branch commit unavailable');
    const file = await robotRead(github, `/repos/${repo}/contents/.keel/keel.json?ref=${ref.object.sha}`);
    if (file.type !== 'file' || file.path !== '.keel/keel.json' || file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > 1400000) throw new Error('pinned configuration unavailable');
    const bytes = Buffer.from(file.content.replace(/\s/g,''), 'base64');
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (file.sha !== blob || file.size !== bytes.length || bytes.length > 1048576) throw new Error('configuration blob identity unavailable');
    const config = JSON.parse(bytes.toString('utf8')), policy = robotPolicy(config);
    if (!policy.valid || !policy.enabled) throw new Error('robot is off or current policy invalid');
    const providers = robotProviders(config, has);
    if (providers.problems.length) throw new Error(providers.problems.join('; '));
    const policyHash = sha256(JSON.stringify({author:providers.author,reviewer:providers.reviewer}));
    return {repository,config,policy,providers,policyHash};
  } catch (error) { throw new RobotGlobalError(`current robot policy unavailable: ${error.message}`); }
}
async function authorizeLabel(repo, issueNumber, github, now = new Date()) {
  let active;
  try {
    const events = (await robotPages(github,`/repos/${repo}/issues/${issueNumber}/events`)).filter(e=>['labeled','unlabeled'].includes(e.event) && e.label?.name==='keel:agent');
    const seen = new Set();
    for (const e of events) {
      if (!robotId(e.id) || seen.has(e.id) || !Number.isFinite(Date.parse(e.created_at)) || Date.parse(e.created_at)>new Date(now).getTime()) throw new Error();
      seen.add(e.id);
    }
    active=events.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id-b.id).at(-1);
  } catch { throw new Error('active robot label provenance unavailable'); }
  if (active?.event !== 'labeled' || !await robotWriter({repo,user:active.actor,github})) throw new Error('active robot label actor lacks verified current write access');
}
function authorizationReceipt(comment, repo, issueNumber) {
  if (!robotId(comment?.id) || !isBot(comment.user) || comment.issue_url !== `https://api.github.com/repos/${repo}/issues/${issueNumber}` || typeof comment.body !== 'string' || comment.body.length > 2000) return null;
  const m = /^<!-- keel:robot-authorization (.+) -->$/.exec(comment.body);
  if (!m) return null;
  try {
    const r = JSON.parse(m[1]);
    const canonical = {version:1,repo:r.repo,issueNumber:r.issueNumber,bodyHash:r.bodyHash,writer:r.writer,eventName:r.eventName,action:r.action,commentId:r.commentId};
    if (comment.body !== `<!-- keel:robot-authorization ${JSON.stringify(canonical)} -->` || r.version !== 1 || r.repo !== repo || r.issueNumber !== issueNumber || !hash64(r.bodyHash) || !/^[A-Za-z0-9-]+$/.test(r.writer ?? '') || !((r.eventName === 'issues' && ['labeled','reopened'].includes(r.action) && r.commentId === null) || (r.eventName === 'issue_comment' && r.action === 'created' && robotId(r.commentId) && r.commentId < comment.id))) return null;
    return {...r,id:comment.id};
  } catch { return null; }
}
async function authorizeBody({repo,issue,comments,github,trigger=null}) {
  if (!(issue.body === null || typeof issue.body === 'string') || Buffer.byteLength(issue.body ?? '') > 1048576) throw new Error('issue body unavailable or exceeds authorization bound');
  const bodyHash = sha256(issue.body ?? '');
  for (const comment of [...comments].sort((a,b)=>b.id-a.id)) {
    const receipt = authorizationReceipt(comment,repo,issue.number);
    if (!receipt || receipt.bodyHash !== bodyHash) continue;
    if (trigger && (receipt.id !== trigger.authorizationId || bodyHash !== trigger.bodyHash || receipt.writer !== trigger.sender || receipt.eventName !== trigger.eventName || receipt.action !== trigger.action || receipt.commentId !== trigger.commentId)) continue;
    if (!await robotWriter({repo,user:{login:receipt.writer,type:'User'},github})) continue;
    return {receiptId:receipt.id,bodyHash,writer:receipt.writer};
  }
  throw new Error('current issue body lacks a trusted receipt from a current writer; fresh writer action required');
}
function permissionMarker(authorization) {
  return `<!-- keel:robot-permission ${JSON.stringify(authorization)} -->`;
}
function permissionOf(body) {
  const matches = [...String(body ?? '').matchAll(/^<!-- keel:robot-permission (.+) -->$/gm)];
  if (matches.length !== 1) throw new Error('published authorization unavailable');
  let a; try { a=JSON.parse(matches[0][1]); } catch { throw new Error('published authorization malformed'); }
  if (!hash64(a?.policyHash) || !hash64(a.bodyHash) || !robotId(a.receiptId) || !/^[A-Za-z0-9-]+$/.test(a.writer ?? '') || permissionMarker(a) !== matches[0][0]) throw new Error('published authorization malformed');
  return a;
}
async function readRobotPr(github, repo, number) {
  const pr = await robotRead(github, `/repos/${repo}/pulls/${number}`);
  if (!robotId(number) || pr?.number !== number) throw new Error('PR read-back identity mismatch');
  const metadata = await robotDeliveryMetadata({repo,pr,github});
  return {...pr, deliveryBody: robotAssociation(metadata.association) +
    (metadata.authorization ? '\n' + permissionMarker(metadata.authorization) : '')};
}
async function revalidateAuthorization({repo,issueNumber,authorization,fresh,github}) {
  if (!authorization || authorization.policyHash !== fresh.policyHash) throw new Error('planned robot authorization changed; owner action required');
  const issue = await robotRead(github,`/repos/${repo}/issues/${issueNumber}`);
  if (issue.number !== issueNumber || issue.html_url !== `https://github.com/${repo}/issues/${issueNumber}` || issue.pull_request || issue.state !== 'open' || !issue.labels?.some(l=>l.name==='keel:agent')) throw new Error('authorized issue is no longer open and labelled');
  await authorizeLabel(repo,issueNumber,github);
  const comments = await robotPages(github,`/repos/${repo}/issues/${issueNumber}/comments`);
  const receipt = comments.find(c=>c.id===authorization.receiptId);
  const approved = await authorizeBody({repo,issue,comments:receipt?[receipt]:[],github});
  if (approved.bodyHash !== authorization.bodyHash || approved.writer !== authorization.writer) throw new Error('planned issue authorization changed');
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
const TRIAGE_LIMIT = 10;
const noteMarker = (plan,result) => `<!-- keel:robot-note ${sha256(JSON.stringify([plan.issueHash,result.state === 'question' ? null : plan.cursor,result.state,result.reason ?? '',result.headSha ?? '']))} -->`;
const triageFields = ['repo','issueNumber','issueHash','authorization','instanceId','cursor','previousHead','previousCompletedAt','author','reviewer'];
function triagePlans(plan) {
  const plans = (plan.rejections ?? []).flatMap(r=>r.triage ? [r.triage] : []);
  if (plan.triage === true && robotId(plan.issueNumber) && !plans.some(p=>p.issueNumber===plan.issueNumber)) plans.push(plan);
  return plans;
}
export async function prepareRobot({ root, repo, config, event, eventName, has, now = new Date(), github = robotGithub, preflight = null }) {
  const rejections = [];
  const blocked = (reason, extra = {}) => ({ state: 'blocked', reason, rejections, ...extra });
  // A checkout that is already OFF cannot initiate work; enabled checkouts
  // still need the freshly pinned policy below.
  const local = robotPolicy(config);
  if (!local.valid || !local.enabled) return blocked(local.valid ? 'robot is off' : local.problems.join('; '));
  let fresh;
  try { fresh = await currentRobotPolicy(repo,has,github); } catch(error) { return blocked(error.message); }
  const {policy,providers} = fresh;
  if (!robotRepo(repo) || event?.repository?.full_name !== repo) return blocked('event repository mismatch');
  let routed = false, trigger;
  if (eventName === 'workflow_dispatch' && event.inputs?.robot_trigger !== undefined && event.inputs.robot_trigger !== '') {
    try {
      if (typeof event.inputs.robot_trigger !== 'string' || event.inputs.robot_trigger.length > 2000) throw new Error();
      trigger=JSON.parse(event.inputs.robot_trigger);
      if (!trigger || Object.keys(trigger).sort().join(',') !== 'action,authorizationId,bodyHash,commentId,eventName,issueNumber,repo,sender,version' || trigger.version !== 1 || !robotId(trigger.authorizationId) || !hash64(trigger.bodyHash) || trigger.repo !== repo || !robotId(trigger.issueNumber) || typeof trigger.sender !== 'string' || !/^[A-Za-z0-9-]+$/.test(trigger.sender) || !((trigger.eventName === 'issues' && ['labeled','reopened'].includes(trigger.action) && trigger.commentId === null) || (trigger.eventName === 'issue_comment' && trigger.action === 'created' && robotId(trigger.commentId)))) throw new Error();
    } catch { return blocked('invalid routed robot trigger'); }
    routed = true;
    eventName=trigger.eventName;
    event={repository:event.repository,action:trigger.action,issue:{number:trigger.issueNumber},sender:{login:trigger.sender,type:'User'},label:{name:'keel:agent'},comment:{id:trigger.commentId}};
  }
  const scanning = !routed && ['schedule','workflow_dispatch'].includes(eventName);
  let issues;
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') {
    issues = (await robotPages(github, `/repos/${repo}/issues?state=open&labels=keel%3Aagent&sort=created&direction=asc`)).filter(i => !i.pull_request);
  } else if ((eventName === 'issues' && ['labeled', 'reopened'].includes(event.action)) || (eventName === 'issue_comment' && event.action === 'created')) {
    if (event.issue?.pull_request || !robotId(event.issue?.number)) return blocked('not an issue event');
    if (eventName === 'issues' && event.action === 'labeled' && event.label?.name !== 'keel:agent') return blocked('not the robot label');
    if (!await robotWriter({ repo, user: event.sender, github })) return blocked('sender does not have verified write access');
    issues = [event.issue];
  } else return blocked('unsupported event');
  for (const candidate of issues) {
    let comments = [];
    const reject = (reason, extra = {}) => { const error = new Error(reason); error.extra=extra; throw error; };
    try {
    if (!robotId(candidate.number)) return reject('invalid issue identity');
    const issue = await robotRead(github, `/repos/${repo}/issues/${candidate.number}`);
    if (issue.number !== candidate.number || issue.html_url !== `https://github.com/${repo}/issues/${candidate.number}` || issue.pull_request) return reject('issue identity mismatch');
    if (issue.state !== 'open' || !issue.labels?.some(l => l.name === 'keel:agent')) return reject('issue closed or robot label removed');
    await authorizeLabel(repo,issue.number,github,now);
    comments = await robotPages(github, `/repos/${repo}/issues/${issue.number}/comments`);
    if (comments.some(c => !robotId(c.id))) return reject('comment identity unavailable');
    if (routed) {
      const receipt = await robotRead(github,`/repos/${repo}/issues/comments/${trigger.authorizationId}`);
      if (!comments.some(c=>c.id===receipt.id && c.body===receipt.body)) return reject('routed authorization receipt unavailable');
      await authorizeBody({repo,issue,comments:[receipt],github,trigger});
    }
    const authorization = {...await authorizeBody({repo,issue,comments,github,trigger:routed?trigger:null}),policyHash:fresh.policyHash};
    if (routed && eventName === 'issue_comment') {
      const comment=await robotRead(github, `/repos/${repo}/issues/comments/${event.comment.id}`);
      if (comment.id !== event.comment.id || comment.issue_url !== `https://api.github.com/repos/${repo}/issues/${issue.number}` || comment.user?.login !== event.sender.login || comment.user?.type !== 'User') return reject('routed comment association unavailable');
    }
    if (eventName === 'issue_comment' && !comments.some(c => c.id === event.comment?.id && c.user?.login === event.sender.login && c.user?.type === 'User')) return reject('triggering comment unavailable');
    const state = stateOf(comments, repo, issue.number);
    if (!state && comments.some(c=>isBot(c.user) && /^<!-- keel:robot-note [a-f0-9]{64} -->\n<!-- keel:robot-state /.test(String(c.body ?? '')))) return reject('recorded robot state malformed; owner resolution needed');
    const pending = publicationOf(comments, repo, issue.number);
    if (pending && (!state || pending.commentId > state.commentId)) {
      await revalidateAuthorization({repo,issueNumber:issue.number,authorization:pending.plan.authorization,fresh,github});
      if (pending.plan.issueHash !== sha256(issue.body ?? '')) return reject('pending publication issue changed; owner resolution needed');
      const ref = await github({method:'GET',path:`/repos/${repo}/git/ref/heads/${pending.plan.branch}`});
      if (ref.status === 200 && ref.data?.ref === `refs/heads/${pending.plan.branch}` && ref.data.object?.type === 'commit' && ref.data.object.sha === pending.headSha) {
        const pulls = await robotPages(github, `/repos/${repo}/pulls?state=all&head=${encodeURIComponent(repo.split('/')[0]+':'+pending.plan.branch)}`);
        if (pulls.length > 1) return reject('multiple robot pull requests; owner resolution needed');
        if (pulls.length) {
          const pr = await robotRead(github, `/repos/${repo}/pulls/${pulls[0].number}`);
          if (pr.base?.repo?.full_name !== repo || pr.base?.ref !== fresh.repository.default_branch) return reject('PR base branch changed; refusing human retarget');
        }
        return {...pending.plan, state:'recover', recoveryHead:pending.headSha, rejections};
      }
      // A crash before push leaves no new branch/head: normal admission can rebuild.
      const unpushed = (ref.status === 404 && pending.plan.previousHead === null) || (ref.status === 200 && ref.data?.ref === `refs/heads/${pending.plan.branch}` && ref.data.object?.type === 'commit' && ref.data.object.sha === pending.plan.previousHead);
      if (!unpushed) return reject('pending publication branch changed or unavailable; refusing recovery', {repo,issueNumber:issue.number});
    }
    const unseen = [];
    for (const c of comments.filter(c => c.id > (state?.cursor ?? 0)).sort((a,b) => a.id-b.id)) {
      if (await robotWriter({ repo, user: c.user, github })) unseen.push({ id: c.id, body: robotRedact(c.body), user: c.user.login });
    }
    const unchanged = state && state.issueHash === sha256(issue.body ?? '') && !unseen.length && !(eventName === 'issues' && event.action === 'reopened');
    if (unchanged && !state.headSha) continue;
    const cursor = unseen.at(-1)?.id ?? state?.cursor ?? 0;
    const issueMarks = [...String(issue.body ?? '').matchAll(/^<!-- keel:robot-issue (.+) -->$/gm)];
    let instanceId = state?.instanceId ?? `issue-${issue.number}`;
    if (issueMarks.length) {
      let mark;
      try { mark = JSON.parse(issueMarks[0][1]); } catch { return reject('issue instance marker malformed'); }
      if (issueMarks.length !== 1 || mark.version !== 1 || mark.repo !== repo.toLowerCase() || !/^[A-Za-z0-9_-]{1,128}$/.test(mark.instanceId) || !/^[a-f0-9]{64}$/.test(mark.subject) || (state && state.instanceId !== mark.instanceId)) return reject('issue instance identity changed or malformed');
      instanceId = mark.instanceId;
    }
    const common = { authorization, rejections, instanceId, repo, issueNumber: issue.number, cursor, previousHead: state?.headSha ?? null, previousCompletedAt: state?.completedAt ?? null, issueHash: sha256(issue.body ?? ''), author: providers.author, reviewer: providers.reviewer };
    const { parseRobotRubric } = await import('./robot-rubric.mjs');
    const parsed = parseRobotRubric(issue.body);
    if (!parsed.ok) return reject(`rubric: ${parsed.problems.map(p => p.message).join('; ')}`, { ...common, triage: true });
    if (parsed.rubric.ownerBlockers.length) return reject('owner-only blockers remain', { ...common, triage: true });
    // Prerequisites are deliberately fail-closed until verified: prose is not evidence.
    if (parsed.rubric.prerequisites.length) return reject('prerequisite verification unavailable; resolve prerequisites before labelling', { ...common, triage: true });

    const pulls = await robotPages(github, `/repos/${repo}/pulls?state=all&head=${encodeURIComponent(repo.split('/')[0] + ':keel/robot-' + issue.number)}`);
    if (pulls.length > 1) return reject('multiple robot pull requests; owner resolution needed', common);
    let previousHead = null, prNumber = null;
    if (pulls.length) {
      const pr = await readRobotPr(github, repo, pulls[0].number);
      if (pr.base?.repo?.full_name !== repo || pr.base?.ref !== fresh.repository.default_branch) return reject('PR base branch changed; refusing human retarget',common);
      const association = robotAssociationOf(pr.deliveryBody);
      if (!state?.headSha || pr.state !== 'open' || pr.merged_at || !isBot(pr.user) || pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo || pr.head?.ref !== `keel/robot-${issue.number}` || pr.head?.sha !== state.headSha || association?.headSha !== state.headSha || association?.repo !== repo || association?.issueNumber !== issue.number) return reject('continuation head or association changed; no human changes are overwritten', common);
      previousHead = pr.head.sha; prNumber = pr.number;
    } else if (state?.headSha) return reject('recorded pull request unavailable', common);
    const baseSha = git(root, ['rev-parse', 'HEAD']);
    if (previousHead) {
      const pr=await readRobotPr(github, repo, prNumber), mark=robotAssociationOf(pr.deliveryBody);
      if (pr.base?.repo?.full_name !== repo || pr.base?.ref !== fresh.repository.default_branch) return reject('PR base branch changed; refusing human retarget',common);
      if (mark?.instanceId !== instanceId || mark?.author !== providers.author) return reject('published provider or instance changed',common);
      if (!await completedRobotReview({repo,prNumber,headSha:previousHead,author:mark.author,reviewer:providers.reviewer,github})) {
        await revalidateAuthorization({repo,issueNumber:issue.number,authorization:permissionOf(pr.deliveryBody),fresh,github});
        return {...common,authorization:permissionOf(pr.deliveryBody),state:'review',baseSha,previousHead,prNumber,branch:`keel/robot-${issue.number}`,cursor:state.cursor};
      }
    }
    if (unchanged) continue;
    if (!robotSha(baseSha)) return blocked('trusted base unavailable', common);
    const budget = await readRobotBudget({ repo, policy, now, github, preflight });
    const admission = robotAdmission({ policy, budget, requestedBuildSeconds: 45 * 60, reservedReviewSeconds: 5 * 60 });
    if (!admission.allowed) return blocked(admission.reason, { ...common, budget });
    return { state: 'ready', ...common, baseSha, previousHead, prNumber, instanceId, branch: `keel/robot-${issue.number}`, comments: unseen, rubric: parsed.rubric, buildSeconds: admission.buildSeconds, reviewSeconds: admission.reviewSeconds, budget, preparedAt: new Date(now).toISOString() };
    } catch (error) {
      if (error instanceof RobotGlobalError) return blocked(error.message);
      const rejection = {issueNumber:candidate.number,reason:error.message};
      if (error.extra?.triage === true) {
        const triage = {...Object.fromEntries(triageFields.map(k=>[k,error.extra[k]])),state:'blocked',triage:true,reason:error.message};
        const marker = noteMarker(triage,{state:'question',reason:triage.reason});
        if (comments.some(c=>isBot(c.user) && c.body?.startsWith(marker+'\n'))) rejection.triageAlready = true;
        else if (rejections.filter(r=>r.triage).length < TRIAGE_LIMIT) rejection.triage = triage;
        else rejection.triageOmitted = true;
      }
      rejections.push(rejection);
      if (!scanning) return blocked(error.message,{repo,issueNumber:candidate.number,...error.extra});
    }
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
// Credentials exist only in this trusted fetch subprocess, never git config,
// a command-line value, the disposable agent repository or a later action.
export function robotFetch({root,repo,ref,env=process.env}) {
  if (!robotRepo(repo) || !(robotSha(ref) || /^refs\/(?:heads|pull)\/[A-Za-z0-9_./-]+$/.test(ref)) || ref.includes('..')) throw new Error('invalid trusted fetch identity');
  if (!env.GH_TOKEN) throw new Error('trusted fetch job token unavailable');
  const server=new URL(env.GITHUB_SERVER_URL || 'https://github.com');
  if ((server.protocol !== 'https:' && !(server.protocol === 'http:' && server.hostname === '127.0.0.1')) || server.username || server.password || server.search || server.hash || server.pathname !== '/') throw new Error('invalid trusted GitHub server');
  const url=`${server.origin}/${repo}.git`;
  const authEnv={...safeEnv(env),KEEL_ROBOT_FETCH_AUTH:`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env.GH_TOKEN}`).toString('base64')}`};
  const r=spawnSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','credential.helper=','-c','http.followRedirects=false',`--config-env=http.${url}.extraheader=KEEL_ROBOT_FETCH_AUTH`,'fetch','--no-tags',url,ref],{cwd:root,env:authEnv,encoding:'utf8',timeout:60_000,maxBuffer:16*1024*1024});
  if (r.error || r.status !== 0) throw new Error('authenticated robot fetch failed');
  return git(root,['rev-parse','FETCH_HEAD']);
}
export function robotSandbox(root, base, head) {
  const problems = sandboxProblems(root, base, head);
  const files = git(root, ['diff', '--name-only', '--no-renames', '-z', base, head]).split('\0').filter(Boolean);
  // Both gates use the runtime selected from the trusted checkout. A changed
  // selector cannot be verified under that old environment, even in a subproject.
  for (const path of files) if (/(?:^|\/)(?:\.nvmrc|\.node-version|\.tool-versions)$/.test(path)) problems.push(`${path}: runtime selectors are off limits; the judge uses the trusted base runtime, so runtime changes require owner verification`);
  if (files.some(p => /^docs\/(?:phases\/|decisions\/|evidence\/|research\/|projects\/|design\.md$|goals\.json$|ROADMAP\.md$)/.test(p))) problems.push('record changes require owner reconciliation; robot cannot publish phase, decision, evidence or project-record changes');
  if (files.some(p => p.startsWith('.agents/') || p.startsWith('.claude/') || p.startsWith('.codex/') || /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/i.test(p))) problems.push('agent protocols and settings are off limits');
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
  return Object.fromEntries(['state','repo','baseSha','issueNumber','issueHash','authorization','cursor','instanceId','author','reviewer','previousHead','prNumber','branch'].map(k => [k,plan[k]]));
}
function publicationBody(plan, headSha) {
  return `<!-- keel:robot-publication ${JSON.stringify({version:1,plan:publicationPlan(plan),headSha})} -->\nTrusted publication intent; recovery may publish only this judged head.`;
}
// A human may retarget an otherwise unchanged robot PR. Repository identity
// alone is insufficient: every reuse/write boundary checks the live default.
async function robotBase(repo, pr, github) {
  const repository = await robotRead(github, `/repos/${repo}`);
  if (typeof repository.default_branch !== 'string' || !repository.default_branch.trim()) throw new Error('default branch unavailable');
  if (pr && (pr.base?.repo?.full_name !== repo || pr.base?.ref !== repository.default_branch)) throw new Error('PR base branch changed; refusing human retarget');
  return repository;
}
export async function publishRobot({ root, repo, baseSha, plan, headSha, message = '', github = robotGithub, push = true, has = {claude:true,codex:true}, now = new Date() }) {
  validateRobotPlan(plan, { repo, baseSha });
  const fresh = await currentRobotPolicy(repo,has,github);
  await revalidateAuthorization({repo,issueNumber:plan.issueNumber,authorization:plan.authorization,fresh,github});
  if (plan.author !== fresh.providers.author || plan.reviewer !== fresh.providers.reviewer) throw new Error('planned providers changed');
  const budget = await readRobotBudget({repo,policy:fresh.policy,now,github});
  if (!budget.complete) throw new Error('publication budget unavailable');
  await revalidateIssue(plan, github);
  if (!robotSha(headSha) || headSha === baseSha || robotSandbox(root, baseSha, headSha).length) throw new Error('candidate fails trusted sandbox');
  if (plan.previousHead && git(root, ['merge-base','--is-ancestor',plan.previousHead,headSha], {allowFail:true}).status !== 0) throw new Error('candidate discards continuation history');
  const repository = await robotBase(repo, null, github);
  if (git(root,['check-ref-format','--branch',repository.default_branch],{allowFail:true}).status !== 0) throw new Error('default branch unavailable');
  let pr = null;
  const pulls = await robotPages(github, `/repos/${repo}/pulls?state=all&head=${encodeURIComponent(repo.split('/')[0]+':'+plan.branch)}`);
  const savedIntent = publicationOf(await robotPages(github, `/repos/${repo}/issues/${plan.issueNumber}/comments`),repo,plan.issueNumber);
  const resuming = savedIntent && savedIntent.headSha === headSha && JSON.stringify(savedIntent.plan) === JSON.stringify(publicationPlan(plan));
  if (plan.prNumber) {
    if (pulls.length !== 1 || pulls[0].number !== plan.prNumber) throw new Error('continuation PR changed');
    pr = await robotRead(github, `/repos/${repo}/pulls/${plan.prNumber}`);
    await robotBase(repo, pr, github);
    if (pr.number !== plan.prNumber || pr.state !== 'open' || pr.merged_at || (pr.head?.sha !== plan.previousHead && !(resuming && pr.head?.sha === headSha))) throw new Error('continuation changed; refusing to overwrite');
    let metadata;
    try { metadata = await robotDeliveryMetadata({repo,pr,github}); }
    catch (error) {
      if (!resuming || pr.head.sha !== headSha || error.code !== 'ROBOT_HEAD_METADATA_MISSING') throw error;
      metadata = await robotDeliveryMetadata({repo,pr,github,headSha:plan.previousHead});
    }
    const mark = metadata.association;
    if (!metadata.authorization || (mark.headSha !== plan.previousHead && !(resuming && mark.headSha === headSha)) || mark.instanceId !== plan.instanceId || mark.author !== plan.author || mark.issueNumber !== plan.issueNumber || mark.repo !== repo) throw new Error('continuation changed; refusing to overwrite');
    if (resuming && mark.headSha === headSha) {
      if (mark.cursor !== plan.cursor || JSON.stringify(metadata.authorization) !== JSON.stringify(plan.authorization)) throw new Error('continuation authorization changed');
      return {prNumber:pr.number,prUrl:pr.html_url,headSha};
    }
  } else if (pulls.length) {
    const intent = publicationOf(await robotPages(github, `/repos/${repo}/issues/${plan.issueNumber}/comments`),repo,plan.issueNumber);
    const existing = pulls.length === 1 ? await robotRead(github, `/repos/${repo}/pulls/${pulls[0].number}`) : null;
    if (existing) await robotBase(repo, existing, github);
    const mark = robotAssociationOf(existing?.body);
    if (!intent || intent.headSha !== headSha || JSON.stringify(intent.plan) !== JSON.stringify(publicationPlan(plan)) || !existing || existing.state !== 'open' || existing.merged_at || !isBot(existing.user) || existing.head?.ref !== plan.branch || existing.head?.sha !== headSha || existing.head?.repo?.full_name !== repo || existing.base?.repo?.full_name !== repo || existing.html_url !== `https://github.com/${repo}/pull/${existing.number}` || mark?.instanceId !== plan.instanceId || mark?.headSha !== headSha || mark?.repo !== repo || mark?.issueNumber !== plan.issueNumber || mark?.author !== plan.author) throw new Error('a pull request appeared since admission');
    return {prNumber:existing.number,prUrl:existing.html_url,headSha};
  }
  const association = robotAssociation({ ...plan, headSha });
  const files = git(root,['diff','--name-only','--no-renames','-z',baseSha,headSha]).split('\0').filter(Boolean);
  const newBody = `${association}\n${permissionMarker(plan.authorization)}\n\n${prBody({
    summary:{lead:`Robot candidate for issue #${plan.issueNumber}; acceptance remains with the owner.`,files:files.map(robotText)},
    evidence:{gate:`Configured full gate passed on base ${baseSha} and candidate ${headSha}; no executed test dropped.`},
    danger:{door:'two-way',why:'Reverting this candidate restores its file changes; operational effects and acceptance still require owner review.',surfaces:['adopted project','published package']},
    notes:[`Closes #${plan.issueNumber}`,robotText(message) || 'Agent supplied no final message.',`Other-provider review pending (${plan.reviewer}); only a person merges.`],
    impact:{declaration:{version:1,phases:[],decisions:[],supersedes:[],evidence:[],reconciliation:'none',reason:'Trusted diff contains no phase, decision, evidence, research/design or project-record changes; record updates are blocked by the robot sandbox. This candidate does not establish acceptance.'}},
  })}`;
  const body = pr ? robotContinuation({...plan,headSha}) + robotText(message) : newBody;
  if (body.length > 60_000) throw new Error('PR conversation exceeds safe update bound; owner resolution needed');
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
  if (pr) {
    // Never PATCH the owner-editable description. Verify the pushed head, then
    // append a canonical receipt; the saved intent permits exact-head recovery.
    pr = await robotRead(github, `/repos/${repo}/pulls/${pr.number}`);
    await robotBase(repo,pr,github);
    if (pr.number !== plan.prNumber || pr.state !== 'open' || pr.merged_at || pr.head?.sha !== headSha) throw new Error('continuation head changed after push');
    const previous = await robotDeliveryMetadata({repo,pr,github,headSha:plan.previousHead});
    if (previous.association.instanceId !== plan.instanceId || previous.association.author !== plan.author || previous.association.issueNumber !== plan.issueNumber) throw new Error('continuation provenance changed');
    let current = null;
    try { current = await robotDeliveryMetadata({repo,pr,github}); }
    catch (error) { if (error.code !== 'ROBOT_HEAD_METADATA_MISSING') throw error; }
    if (!current) {
      const response = await github({method:'POST',path:`/repos/${repo}/issues/${pr.number}/comments`,body:{body}});
      if (response.status !== 201 || !robotId(response.data?.id)) throw new Error('continuation receipt publication ambiguous; exact-head recovery required');
      const receipt = await robotRead(github,`/repos/${repo}/issues/comments/${response.data.id}`);
      if (receipt.id !== response.data.id || !isBot(receipt.user) || receipt.issue_url !== `https://api.github.com/repos/${repo}/issues/${pr.number}` || receipt.body !== body) throw new Error('continuation receipt read-back mismatch');
      current = await robotDeliveryMetadata({repo,pr,github});
    }
    if (current.association.cursor !== plan.cursor || JSON.stringify(current.authorization) !== JSON.stringify(plan.authorization)) throw new Error('continuation receipt does not match judged plan');
  } else {
    const response = await github({method:'POST',path:`/repos/${repo}/pulls`,body:{title:`Robot: issue #${plan.issueNumber}`,body,head:plan.branch,base:repository.default_branch}});
    if (response.status !== 201 || !robotId(response.data?.number)) throw new Error('PR publication ambiguous; inspect existing branch/PR before recovery');
    pr = await robotRead(github, `/repos/${repo}/pulls/${response.data.number}`);
    await robotBase(repo, pr, github);
    const {association:mark} = await robotDeliveryMetadata({repo,pr,github});
    if (pr.number !== response.data.number || pr.state !== 'open' || pr.merged_at || pr.head?.sha !== headSha || mark.issueNumber !== plan.issueNumber || mark.instanceId !== plan.instanceId || mark.author !== plan.author || mark.headSha !== headSha) throw new Error('PR read-back identity mismatch');
  }
  return { prNumber: pr.number, prUrl: pr.html_url, headSha };
}
export async function robotComment({ plan, result, message = '', github = robotGithub, now = new Date() }) {
  if (!robotRepo(plan.repo) || !robotId(plan.issueNumber)) return;
  const comments = await robotPages(github, `/repos/${plan.repo}/issues/${plan.issueNumber}/comments`);
  const marker = noteMarker(plan,result);
  if (comments.some(c => isBot(c.user) && c.body?.startsWith(marker + '\n'))) return {posted:false,already:true};
  const state = ['published','failed','question'].includes(result.state) ? `<!-- keel:robot-state ${JSON.stringify({ repo: plan.repo, issueNumber: plan.issueNumber, issueHash: plan.issueHash, cursor: plan.cursor, instanceId: plan.instanceId ?? `issue-${plan.issueNumber}`, headSha: result.headSha ?? plan.previousHead ?? null, completedAt: new Date(now).toISOString(), previousCompletedAt: plan.previousCompletedAt ?? null })} -->\n` : '';
  const body = `${marker}\n${state}${result.prUrl ? `PR: ${result.prUrl}\n\n` : ''}${robotText(result.reason ?? result.state)}\n\n${robotText(message)}`;
  const response = await github({method:'POST', path:`/repos/${plan.repo}/issues/${plan.issueNumber}/comments`, body:{body}});
  if (response.status !== 201) throw new Error('issue response could not be confirmed');
  return {posted:true};
}
export async function publishRobotTriage({repo,plan,has,github=robotGithub,now=new Date()}) {
  const questions = triagePlans(plan), results = [];
  if (questions.length > TRIAGE_LIMIT) throw new Error('triage handoff exceeds publication bound');
  const seen = new Set();
  for (const question of questions) {
    try {
      if (question.repo !== repo || !robotRepo(repo) || !robotId(question.issueNumber) || seen.has(question.issueNumber) || question.state !== 'blocked' || question.triage !== true || !hash64(question.issueHash) || question.authorization?.bodyHash !== question.issueHash || !/^[A-Za-z0-9_-]{1,128}$/.test(question.instanceId ?? '') || !Number.isSafeInteger(question.cursor) || question.cursor < 0 || !(question.previousHead === null || robotSha(question.previousHead)) || typeof question.reason !== 'string' || !question.reason || question.reason.length > 10000) throw new Error('triage handoff identity invalid');
      seen.add(question.issueNumber);
      const fresh = await currentRobotPolicy(repo,has,github);
      if (question.author !== fresh.providers.author || question.reviewer !== fresh.providers.reviewer) throw new Error('triage providers changed');
      await revalidateAuthorization({repo,issueNumber:question.issueNumber,authorization:question.authorization,fresh,github});
      const comments = await robotPages(github,`/repos/${repo}/issues/${question.issueNumber}/comments`);
      const state = stateOf(comments,repo,question.issueNumber);
      if ((state?.headSha ?? null) !== question.previousHead || (state && (state.instanceId !== question.instanceId || state.cursor > question.cursor))) throw new Error('triage recorded state changed');
      if (!state && comments.some(c=>isBot(c.user) && /^<!-- keel:robot-note [a-f0-9]{64} -->\n<!-- keel:robot-state /.test(String(c.body ?? '')))) throw new Error('triage recorded state malformed');
      const pulls = await robotPages(github,`/repos/${repo}/pulls?state=all&head=${encodeURIComponent(repo.split('/')[0]+':keel/robot-'+question.issueNumber)}`);
      if (question.previousHead) {
        if (pulls.length !== 1 || !robotId(pulls[0].number)) throw new Error('triage continuation unavailable');
        const pr = await readRobotPr(github, repo, pulls[0].number), mark=robotAssociationOf(pr.deliveryBody);
        if (pr.number !== pulls[0].number || !isBot(pr.user) || pr.state !== 'open' || pr.merged_at || pr.head?.repo?.full_name !== repo || pr.head?.ref !== `keel/robot-${question.issueNumber}` || pr.head?.sha !== question.previousHead || pr.base?.repo?.full_name !== repo || pr.base?.ref !== fresh.repository.default_branch || mark?.repo !== repo || mark?.issueNumber !== question.issueNumber || mark?.instanceId !== question.instanceId || mark?.headSha !== question.previousHead || mark?.author !== question.author) throw new Error('triage continuation changed; human changes preserved');
      } else if (pulls.length) throw new Error('triage pull request appeared since admission');
      const result = await robotComment({plan:question,result:{state:'question',reason:question.reason},github,now});
      results.push({issueNumber:question.issueNumber,...result});
    } catch(error) { results.push({issueNumber:question.issueNumber,posted:false,reason:error.message}); }
  }
  return {results,omitted:(plan.rejections ?? []).filter(r=>r.triageOmitted).length};
}
async function completedRobotReview({repo,prNumber,headSha,author,reviewer,github}) {
  const marker=`<!-- keel:robot-review ${headSha} ${reviewer} -->`;
  const reviews=await robotPages(github, `/repos/${repo}/pulls/${prNumber}/reviews`);
  return reviews.some(r => isBot(r.user) && r.state === 'COMMENTED' && r.commit_id === headSha && r.body?.startsWith(`${marker}\nReviewed by ${reviewer}; built by ${author}.\n`) && (r.body.match(/<!-- keel:robot-review/g) ?? []).length === 1);
}
export async function prepareRobotReview({ root, repo, prNumber, headSha, has, now = new Date(), github = robotGithub, preflight = null }) {
  const fresh = await currentRobotPolicy(repo,has,github), {policy,providers} = fresh;
  if (!policy.valid || !policy.enabled || providers.problems.length || !robotRepo(repo) || !robotId(prNumber) || !robotSha(headSha)) throw new Error('review policy/identity unavailable');
  const pr = await readRobotPr(github, repo, prNumber), mark = robotAssociationOf(pr.deliveryBody);
  if (!mark || mark.repo !== repo || mark.author !== providers.author || mark.headSha !== headSha || pr.head?.sha !== headSha || pr.state !== 'open' || pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo || pr.head?.ref !== `keel/robot-${mark.issueNumber}` || !isBot(pr.user)) throw new Error('published head/provenance changed before review');
  await robotBase(repo, pr, github);
  const authorization = permissionOf(pr.deliveryBody);
  await revalidateAuthorization({repo,issueNumber:mark.issueNumber,authorization,fresh,github});
  const identity={repo,prNumber,headSha,author:providers.author,reviewer:providers.reviewer,issueNumber:mark.issueNumber,authorization};
  if (await completedRobotReview({...identity,github})) return {...identity,complete:true,reviewSeconds:0};
  const budget = await readRobotBudget({ repo,policy,now,github,preflight });
  const seconds = Math.floor(Math.min(300,budget.remainingSeconds ?? 0)/60)*60;
  if (!budget.complete || budget.state !== 'available' || seconds < 60) throw new Error('review allowance unavailable');
  return {...identity,reviewSeconds:seconds};
}
export async function postRobotReview({ review, message, github = robotGithub, has = {claude:true,codex:true} }) {
  if (!robotRepo(review.repo) || !robotId(review.prNumber) || !robotSha(review.headSha) || !['claude','codex'].includes(review.author) || !['claude','codex'].includes(review.reviewer) || review.author === review.reviewer || (!review.complete && !String(message ?? '').trim())) throw new Error('review is empty or identity invalid');
  const pr = await readRobotPr(github, review.repo, review.prNumber), mark = robotAssociationOf(pr.deliveryBody);
  if (pr.head?.sha !== review.headSha || pr.head?.repo?.full_name !== review.repo || pr.base?.repo?.full_name !== review.repo || pr.state !== 'open' || mark?.author !== review.author || mark?.headSha !== review.headSha || !isBot(pr.user)) throw new Error('head changed before review publication');
  const fresh = await currentRobotPolicy(review.repo,has,github);
  if (fresh.providers.author !== review.author || fresh.providers.reviewer !== review.reviewer) throw new Error('review providers changed');
  const authorization = permissionOf(pr.deliveryBody);
  if (review.authorization && JSON.stringify(review.authorization) !== JSON.stringify(authorization)) throw new Error('review authorization changed');
  await revalidateAuthorization({repo:review.repo,issueNumber:mark.issueNumber,authorization,fresh,github});
  await robotBase(review.repo, pr, github);
  const marker = `<!-- keel:robot-review ${review.headSha} ${review.reviewer} -->`;
  if (await completedRobotReview({...review,github})) return {posted:false,already:true};
  if (review.complete) throw new Error('recorded review completion unavailable');
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
  if (command === 'fetch') return {headSha:robotFetch({root,repo,ref:env.ROBOT_FETCH_REF,env})};
  if (command === 'sandbox') {
    const problems = robotSandbox(root, env.GITHUB_SHA, trustedBase);
    if (problems.length) throw new Error(problems.join('; '));
    return {ok:true};
  }
  if (command === 'prepare') {
    const plan = await prepareRobot({root,repo,config,event:await json(env.GITHUB_EVENT_PATH),eventName:env.GITHUB_EVENT_NAME,has:hasOf(env),preflight:{runId:Number(env.GITHUB_RUN_ID),attempt:Number(env.GITHUB_RUN_ATTEMPT),job:env.GITHUB_JOB}});
    await write('robot-plan.json',plan);
    outputs({triage:triagePlans(plan).length>0,triage_count:triagePlans(plan).length,triage_omitted:(plan.rejections ?? []).filter(r=>r.triageOmitted).length,ready:plan.state === 'ready',issue:plan.issueNumber ?? '',base:trustedBase,author:plan.author ?? '',reviewer:plan.reviewer ?? '',build_minutes:plan.buildSeconds ? plan.buildSeconds/60 : 1,review_minutes:plan.reviewSeconds ? plan.reviewSeconds/60 : 1});
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
    const questions = triagePlans(plan);
    // OFF/no-work plans have no mutation to authorize. Each question is checked
    // independently so one stale approval cannot hide other valid questions.
    if (plan.state === 'blocked' && !questions.length) return plan;
    const triage = await publishRobotTriage({repo,plan,has:hasOf(env),github:robotGithub});
    if (plan.state === 'blocked') return {...plan,triageResults:triage};
    const finish = result => ({...result,triageResults:triage});
    const fresh = await currentRobotPolicy(repo,hasOf(env),robotGithub);
    if (plan.state === 'review') {
      validateRobotPlan({...plan,state:'ready'},{repo,baseSha:trustedBase});
      const pr=await readRobotPr(robotGithub, repo, plan.prNumber),mark=robotAssociationOf(pr.deliveryBody);
      if (pr.number !== plan.prNumber || !isBot(pr.user) || pr.state !== 'open' || pr.head?.sha !== plan.previousHead || pr.head?.ref !== plan.branch || pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo || mark?.headSha !== plan.previousHead || mark?.repo !== repo || mark?.issueNumber !== plan.issueNumber || mark?.instanceId !== plan.instanceId || mark?.author !== plan.author) throw new Error('review recovery PR/head changed');
      await revalidateAuthorization({repo,issueNumber:plan.issueNumber,authorization:plan.authorization,fresh,github:robotGithub});
      await robotBase(repo, pr, robotGithub);
      outputs({pr:pr.number,head:pr.head.sha});return finish({state:'review',prNumber:pr.number,headSha:pr.head.sha});
    }
    if (plan.state === 'recover') {
      const restored = {...plan,state:'ready'};
      git(root,['fetch','--no-tags','origin',`refs/heads/${plan.branch}`]);
      if (git(root,['rev-parse','FETCH_HEAD']) !== plan.recoveryHead) throw new Error('pending publication branch moved; refusing recovery');
      const result = await publishRobot({root,repo,baseSha:plan.baseSha,plan:restored,headSha:plan.recoveryHead,has:hasOf(env)});
      await robotComment({plan:restored,result:{...result,state:'published',reason:'Recovered verified publication; other-provider review pending.'}});
      outputs({pr:result.prNumber,head:result.headSha});return finish(result);
    }
    if (plan.state !== 'ready') throw new Error('unsupported publication plan state');
    validateRobotPlan(plan,{repo,baseSha:trustedBase});
    const message=await readFile(join(temp,'handoff/message.txt'),'utf8').catch(()=> 'Agent supplied no final message.');
    if (env.ROBOT_JUDGE_OK !== 'true') { await robotComment({plan,result:{state:'failed',reason:'Agent or trusted judge failed; no PR published.'},message}); return finish({state:'failed'}); }
    const judgment=await json(join(temp,'judged/robot-judgment.json'));
    if (!judgment.ok || judgment.baseSha !== trustedBase || !robotSha(judgment.headSha) || judgment.headSha !== env.ROBOT_JUDGED_HEAD) throw new Error('judged identity mismatch');
    git(root,['fetch','--no-tags',join(temp,'handoff/robot.bundle'),`refs/heads/${plan.branch}`]);
    const headSha=git(root,['rev-parse','FETCH_HEAD']);
    if(headSha!==judgment.headSha) throw new Error('bundle differs from judged head');
    let result;
    try { result=await publishRobot({root,repo,baseSha:trustedBase,plan,headSha,message,has:hasOf(env)}); }
    catch (error) {
      await robotComment({plan,result:{state:'blocked',reason:`Publication blocked: ${error.message}`},message});
      throw error;
    }
    await robotComment({plan,result:{...result,state:'published',reason:`Published; ${plan.reviewer} review is pending.`},message});
    outputs({pr:result.prNumber,head:headSha});return finish(result);
  }
  if(command==='review-prepare') {
    const review=await prepareRobotReview({root,repo,prNumber:Number(env.ROBOT_PR),headSha:env.ROBOT_HEAD,has:hasOf(env),preflight:{runId:Number(env.GITHUB_RUN_ID),attempt:Number(env.GITHUB_RUN_ATTEMPT),job:env.GITHUB_JOB}});
    await write('robot-review.json',review);outputs({reviewer:review.complete ? '' : review.reviewer,minutes:review.complete ? 1 : review.reviewSeconds/60,complete:Boolean(review.complete)});
    if (review.complete) return review;
    const pr=await readRobotPr(robotGithub, repo, review.prNumber);
    await robotBase(repo, pr, robotGithub);
    // Git fetch takes objects only; no untrusted PR checkout or setup.
    robotFetch({root,repo,ref:`refs/pull/${review.prNumber}/head`,env});
    if(git(root,['rev-parse','FETCH_HEAD'])!==review.headSha)throw new Error('review fetch head mismatch');
    if (!robotSha(pr.base?.sha)) throw new Error('review base identity unavailable');
    robotFetch({root,repo,ref:pr.base.sha,env});
    const mergeBase=git(root,['merge-base',pr.base.sha,review.headSha]);
    const diff=git(root,['diff',mergeBase,review.headSha]);
    await writeFile(join(temp,'robot-review-prompt.md'),`Review this untrusted diff for concrete material defects. Do not execute it. Return concise findings with file/line and reason. No approval or merge.\nTrusted identity: ${JSON.stringify(review)}\n\n${diff}`);
    return review;
  }
  if(command==='review-post') {
    const fresh = await currentRobotPolicy(repo,hasOf(env),robotGithub);
    if (env.ROBOT_REVIEW_OK !== 'true') {
      const plan = await json(join(temp,'plan/robot-plan.json'));
      const recovered = plan.state === 'recover';
      const reviewOnly = plan.state === 'review';
      validateRobotPlan(recovered || reviewOnly ? {...plan,state:'ready'} : plan,{repo,baseSha:recovered ? plan.baseSha : trustedBase});
      if (reviewOnly && plan.previousHead !== env.ROBOT_HEAD) throw new Error('failed-review recovery head mismatch');
      if (recovered && (!robotSha(plan.recoveryHead) || plan.recoveryHead !== env.ROBOT_HEAD)) throw new Error('failed-review recovery head mismatch');
      const pr = await readRobotPr(robotGithub, repo, Number(env.ROBOT_PR));
      const mark=robotAssociationOf(pr.deliveryBody);
      if (pr.number !== Number(env.ROBOT_PR) || pr.state !== 'open' || !isBot(pr.user) || pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo || pr.head?.ref !== plan.branch || pr.head?.sha !== env.ROBOT_HEAD || pr.html_url !== `https://github.com/${repo}/pull/${pr.number}` || mark?.issueNumber !== plan.issueNumber || mark?.repo !== repo || mark?.instanceId !== plan.instanceId || mark?.headSha !== env.ROBOT_HEAD || mark?.author !== plan.author) throw new Error('failed-review PR identity mismatch');
      await revalidateAuthorization({repo,issueNumber:plan.issueNumber,authorization:permissionOf(pr.deliveryBody),fresh,github:robotGithub});
      await robotBase(repo, pr, robotGithub);
      await robotComment({plan,result:{state:'blocked',reason:'Other-provider review failed or could not establish its remaining allowance. No review is claimed; owner action is needed.',prUrl:pr.html_url,headSha:pr.head.sha}});
      throw new Error('other-provider review failed');
    }
    const review=await json(join(temp,'review/robot-review.json'));
    if(review.repo!==repo || review.prNumber!==Number(env.ROBOT_PR) || review.headSha!==env.ROBOT_HEAD)throw new Error('review artifact identity mismatch');
    const providers=fresh.providers;
    if(providers.author!==review.author || providers.reviewer!==review.reviewer)throw new Error('review provider mismatch');
    return postRobotReview({review,has:hasOf(env),message:review.complete ? '' : await readFile(join(temp,'review/message.txt'),'utf8')});
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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decisionContext, decisionExitCode } from '../practices/reconciliation/files/scripts/keel/decision-context.mjs';
const exec = promisify(execFile);
export async function decisionCommand({ root, phase, issue }) {
  let issueBody;
  if (issue !== undefined && /^[\w.-]+\/[\w.-]+#[1-9]\d*$/.test(issue)) {
    try {
      const [repo, number] = issue.split('#');
      const { stdout } = await exec('gh', ['api', `/repos/${repo}/issues/${number}`], { cwd: root, timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
      const value = JSON.parse(stdout);
      if (value.number !== Number(number) || value.html_url !== `https://github.com/${repo}/issues/${number}` || value.pull_request) throw Error('issue identity mismatch');
      issueBody = value.body;
    } catch { /* The resolver reports unavailable required input, never empty coverage. */ }
  }
  const data = await decisionContext({ root, phase, issue, issueBody });
  return { data, text: JSON.stringify(data, null, 2), exitCode: decisionExitCode(data) };
}

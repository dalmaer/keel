// keel issue new --agent (keel phase 54): an issue the robot can work alone,
// written in the rubric's shape from flags (no editor), labelled keel:agent
// and created with gh (KEEL_GH stands in for gh), or printed with --dry-run.
// The shape is the climb practice's scripts/keel/rubric.mjs, the one the
// robot triages against, so an issue written here never misses a field.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LABEL, RUBRIC, rubricBody, triage } from '../practices/climb/files/scripts/keel/rubric.mjs';

export class IssueError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const REPO = /^[\w.-]+\/[\w.-]+$/;

/** The repo an issue goes to: --repo, else .keel/keel.json "repo". */
async function repoOf(root, repo) {
  if (repo !== undefined) {
    if (!REPO.test(repo)) throw new IssueError(`--repo ${repo}: use owner/name`);
    return repo;
  }
  let config = null;
  if (root) try { config = JSON.parse(await readFile(join(root, '.keel/keel.json'), 'utf8')); } catch {}
  if (REPO.test(config?.repo ?? '')) return config.repo;
  throw new IssueError('keel issue new needs --repo <owner/name>, or "repo" in .keel/keel.json');
}

/**
 * Write (and, without dryRun, file) an issue for the robot. Every rubric
 * field is a flag: --wrong, --see, --mended, and the title. The three boxes
 * (nothing only the owner can give, one change, nothing unpushed) are
 * ticked: filing with --agent says they hold. { data, text }.
 */
export async function issueNew({ root, repo, title, wrong, see, mended, agent, dryRun }, { env = process.env } = {}) {
  if (!agent) throw new IssueError('keel issue new writes an issue for the robot: pass --agent (an issue for a person is `gh issue create`)');
  const missing = [['--title', title], ['--wrong', wrong], ['--see', see], ['--mended', mended]].filter(([, v]) => !String(v ?? '').trim()).map(([f]) => f);
  if (missing.length) throw new IssueError(`keel issue new --agent needs ${missing.join(', ')}: ${RUBRIC.filter(r => r.heading).map(r => r.ask).join('; ')}`);
  const body = rubricBody({ wrong, see, mended });
  const gaps = triage(body);
  if (gaps.length) throw new IssueError(`the issue would miss ${gaps.map(g => g.ask).join(', ')}`);
  const target = await repoOf(root, repo);
  const plan = { repo: target, title: String(title).replace(/\s+/g, ' ').trim(), label: LABEL, body };
  if (dryRun) {
    return { data: { ok: true, dryRun: true, ...plan }, text: [`Would file on ${target}, labelled ${LABEL}:`, '', `# ${plan.title}`, '', body.trimEnd()].join('\n') };
  }
  const gh = env.KEEL_GH || 'gh';
  const r = spawnSync(gh, ['issue', 'create', '--repo', target, '--title', plan.title, '--label', LABEL, '--body-file', '-'], { env, input: body, encoding: 'utf8' });
  if (r.error) throw new IssueError(`gh issue create: ${r.error.code === 'ENOENT' ? `gh is not installed (${gh})` : r.error.message}`, 1);
  if (r.status !== 0) {
    const said = (r.stderr || r.stdout || '').trim().split('\n')[0];
    const hint = /label/i.test(said) ? `; make the label once with \`gh label create ${LABEL} --repo ${target}\`` : '';
    throw new IssueError(`gh issue create exited ${r.status}: ${said}${hint}`, 1);
  }
  const url = (r.stdout.trim().split('\n').find(l => /^https?:\/\//.test(l)) ?? '').trim() || null;
  return { data: { ok: true, ...plan, url }, text: `Filed on ${target}, labelled ${LABEL}: ${url ?? '(gh printed no URL)'}\nThe robot works it on its next run, when "robot" is on there.` };
}

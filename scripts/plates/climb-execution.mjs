// Bounded execution evidence for climb. Advisory receipts never authorize a gate or publish.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Keep categories only: commands, paths, arguments, credentials and session text never leave the execution file. */
export function denialEvidence(result) {
  const entries = Array.isArray(result?.permission_denials) ? result.permission_denials : [];
  const reported = Number.isSafeInteger(result?.permission_denials_count) && result.permission_denials_count >= 0 ? result.permission_denials_count : 0;
  const count = Math.max(reported, entries.length);
  return { count, detailsAvailable: entries.length > 0, omitted: Math.max(0, count - Math.min(entries.length, 8)), entries: entries.slice(0, 8).map(d => ({
    tool: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'].includes(d?.tool_name) ? d.tool_name : 'unknown',
    reason: 'permission-denied',
  })) };
}

/** Runner capability only. The action's later model/tool permissions are explicitly unverified. */
export async function preflight(root, { execute = spawnSync } = {}) {
  const checks = [];
  let scratch;
  try {
    scratch = await mkdtemp(join(root, '.plates-climb-probe-'));
    await writeFile(join(scratch, 'probe'), 'acme\n');
    if (await readFile(join(scratch, 'probe'), 'utf8') !== 'acme\n') throw new Error('read');
    checks.push({ capability: 'repository-read-write', ok: true });
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
    for (const k of Object.keys(env)) if (k.startsWith('GIT_') && !['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_TERMINAL_PROMPT'].includes(k)) delete env[k];
    const commands = [
      ['node', process.execPath, ['--version']], ['npm', 'npm', ['--version']],
      ['git-init', 'git', ['init', '-q']], ['git-add', 'git', ['add', 'probe']],
      ['git-commit', 'git', ['-c', 'user.name=Acme', '-c', 'user.email=acme@example.test', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'capability probe']],
    ];
    for (const [capability, command, args] of commands) {
      const r = execute(command, args, { cwd: scratch, env, timeout: 10000, maxBuffer: 16384, encoding: 'utf8', shell: false });
      checks.push({ capability, ok: !r.error && r.status === 0 });
      if (!checks.at(-1).ok) break;
    }
  } catch { checks.push({ capability: 'repository-read-write', ok: false }); }
  finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
  const ok = checks.length === 6 && checks.every(c => c.ok);
  return { schema: 1, ok, state: ok ? 'ready' : 'blocked', checks, agentPermissions: 'unverified', line: ok ? 'runner capabilities verified; agent action permissions remain unverified' : 'blocked: runner capability preflight failed; baseline was not started' };
}

/** Wall seconds, not CPU. Total includes inter-job queue/transfer time; phases must not be summed as total. */
export function durations({ started, baselineStarted, baselineEnded, agentSeconds, judgeStarted, now = Date.now() / 1000 }) {
  const n = v => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
  const span = (a, b) => n(a) !== null && n(b) !== null && n(b) >= n(a) ? n(b) - n(a) : null;
  return { unit: 'seconds', clock: 'wall', setup: span(started, baselineStarted), baseline: span(baselineStarted, baselineEnded), agent: n(agentSeconds), judge: span(judgeStarted, now), total: span(started, now), cpu: null, totalIncludes: 'through this snapshot, including inter-job queue and transfer; starts after agent checkout', setupIncludes: 'agent runner setup before baseline; later setup remains unallocated', judgeIncludes: 'judge setup, gate and comparison through snapshot; publish excluded' };
}

export function completion({ kept }, night) {
  if (kept > 0) return 'candidate';
  const attempts = night?.tried ?? [];
  if (!attempts.length) return 'no-candidate';
  const evaluated = a => a.verdict === 'revert' && (
    (Array.isArray(a.rounds) && a.rounds.length >= 2 && a.rounds.every(r => Number.isFinite(r.base) && Number.isFinite(r.candidate) && Number.isFinite(r.change))) ||
    (Number.isInteger(a.runs) && a.runs > 0 && Number.isInteger(a.passed) && a.passed >= 0 && Number.isInteger(a.failed) && a.failed > 0 && a.passed + a.failed <= a.runs && typeof a.tree === 'string' && /^[0-9a-f]{40,64}$/.test(a.tree))
  );
  return attempts.every(evaluated) ? 'no-improvement' : 'incomplete';
}

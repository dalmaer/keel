#!/usr/bin/env node
// Contributor-only Actions bridge. No arbitrary command, callback input or provider key.
import { webEnv } from '../lib/web/name-transition.mjs';
import { runJobWorker } from '../lib/web/job-worker.mjs';

const abort = new AbortController();
const stop = () => abort.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  const result = await runJobWorker({
    origin: webEnv(process.env, 'KEEL_WEB_ORIGIN'),
    operationId: webEnv(process.env, 'KEEL_WEB_OPERATION'),
    oidcUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    oidcToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    sha: process.env.GITHUB_SHA,
    workflowSha: process.env.GITHUB_WORKFLOW_SHA,
    cwd: process.env.GITHUB_WORKSPACE,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  }, { signal: abort.signal });
  process.stdout.write(`${JSON.stringify({ worker: 'typecheck-v1', ...result })}\n`);
  process.exitCode = result.state === 'succeeded' ? 0 : 1;
} catch {
  process.stderr.write('Worker unavailable; inspect the durable operation receipt.\n');
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}

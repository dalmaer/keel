#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runUpdateWorker, prepareUpdateTree } from '../lib/web/update-worker.mjs';

const abort = new AbortController();
const stop = () => abort.abort();
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  if (process.argv[2] === '--prepare-internal') {
    const [root, targetRoot, version, manifest] = process.argv.slice(3);
    const result = await prepareUpdateTree(root, targetRoot, version, JSON.parse(await readFile(manifest, 'utf8')));
    process.stdout.write(JSON.stringify(result));
  } else {
    const result = await runUpdateWorker({ origin: process.env.PLATES_WEB_ORIGIN ?? process.env.KEEL_WEB_ORIGIN,
      operationId: process.env.PLATES_WEB_OPERATION ?? process.env.KEEL_WEB_OPERATION, oidcUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
      oidcToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, sha: process.env.GITHUB_SHA,
      workflowSha: process.env.GITHUB_WORKFLOW_SHA, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      projectRoot: join(process.env.GITHUB_WORKSPACE, 'project-source'),
      targetRoot: join(process.env.GITHUB_WORKSPACE, 'trusted-keel') }, { signal: abort.signal });
    process.stdout.write(`${JSON.stringify({ worker: 'update-preparation-v1', ...result })}\n`);
    process.exitCode = result.state === 'succeeded' ? 0 : 1;
  }
} catch { process.stderr.write('Update preparation unavailable; inspect its durable receipt.\n'); process.exitCode = 1; }
finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }

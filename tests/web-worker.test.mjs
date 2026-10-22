import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { runJobWorker, createWorkerTransport, workerChildEnvironment } from '../lib/web/job-worker.mjs';
import { workerFixture, waitFor, alive } from './helpers/web-worker.mjs';

const sha = 'a'.repeat(40);
const options = () => ({ origin: 'https://acme.example', operationId: 'b'.repeat(64),
  sha, workflowSha: sha, runAttempt: '1', cwd: '/acme', env: {} });
function protocol(overrides = {}) {
  const calls = [];
  const deadline = Date.now() + 60_000;
  const claim = { fence: 1, jobId: 12, deadline, leaseExpiresAt: deadline, checkoutSha: sha,
    workflowSha: sha, adapter: 'typecheck-v1' };
  return { calls, claim, transport: async (stage, body, signal) => {
    calls.push({ stage, body });
    if (overrides[stage]) return overrides[stage](body, signal, claim);
    if (stage === 'claim') return claim;
    if (stage === 'begin') return { granted: true, ...claim };
    if (stage === 'heartbeat') return { continue: true, leaseExpiresAt: deadline };
    return { accepted: true };
  } };
}

test('worker runs fixed adapter commands once, only after exact claim and confirmed begin', async () => {
  const p = protocol();
  const commands = [];
  const result = await runJobWorker(options(), { transport: p.transport, readCheckout: async () => sha,
    runCommand: async argv => {
      assert.deepEqual(p.calls.slice(0, 2).map(call => call.stage), ['claim', 'begin']);
      commands.push(argv); return { exitCode: 0, stopped: false };
    } });
  assert.deepEqual(commands, [['npm', 'ci', '--ignore-scripts'], ['npm', 'run', 'typecheck']]);
  assert.deepEqual(result, { state: 'succeeded', exitCode: 0 });
  assert.deepEqual(p.calls.map(call => call.stage), ['claim', 'begin', 'complete']);
  assert.equal(p.calls[2].body.sequence, 1);
});

test('worker recovers lost claim with the same process nonce but never repeats an uncertain begin', async () => {
  let claims = 0;
  const p = protocol({ claim: (_body, _signal, claim) => {
    if (++claims === 1) throw new Error('fake lost claim response'); return claim;
  }, begin: () => { throw new Error('fake lost begin response'); } });
  let commands = 0;
  const result = await runJobWorker(options(), { transport: p.transport, readCheckout: async () => sha,
    runCommand: async () => { commands++; return { exitCode: 0 }; } });
  assert.equal(result.state, 'failed');
  assert.equal(commands, 0);
  assert.deepEqual(p.calls.map(call => call.stage), ['claim', 'claim', 'begin']);
  assert.equal(p.calls[0].body.nonce, p.calls[1].body.nonce);
  assert.match(p.calls[0].body.nonce, /^[0-9a-f]{64}$/);
});

test('worker refuses stale checkout/workflow, malformed fence, expired lease and non-granted begin before commands', async () => {
  const mutations = [
    { checkoutSha: 'c'.repeat(40) }, { workflowSha: 'c'.repeat(40) }, { fence: 0 },
    { jobId: null }, { deadline: Date.now() - 1 }, { deadline: Date.now() + 16 * 60_000 },
    { leaseExpiresAt: Date.now() - 1 }, { adapter: 'arbitrary-shell' },
  ];
  for (const mutation of mutations) {
    const p = protocol({ claim: (_body, _signal, claim) => ({ ...claim, ...mutation }) });
    let commands = 0;
    const result = await runJobWorker(options(), { transport: p.transport, readCheckout: async () => sha,
      runCommand: async () => { commands++; return { exitCode: 0 }; } });
    assert.equal(result.state, 'failed', JSON.stringify(mutation));
    assert.equal(commands, 0);
  }
  for (const mismatch of ['checkout', 'grant', 'fence', 'deadline']) {
    const p = protocol({ begin: (_body, _signal, claim) => ({ granted: mismatch !== 'grant', ...claim,
      ...(mismatch === 'fence' ? { fence: 2 } : {}), ...(mismatch === 'deadline' ? { deadline: claim.deadline + 1 } : {}) }) });
    let commands = 0;
    await runJobWorker(options(), { transport: p.transport, readCheckout: async () => mismatch === 'checkout' ? 'c'.repeat(40) : sha,
      runCommand: async () => { commands++; return { exitCode: 0 }; } });
    assert.equal(commands, 0, mismatch);
  }
});

test('actual fixed npm process stops on failure and never starts the second command', async t => {
  const fixture = await workerFixture(t, 'failure');
  const p = protocol();
  const result = await runJobWorker({ ...options(), ...fixture }, { transport: p.transport, readCheckout: async () => sha });
  assert.deepEqual(result, { state: 'failed', exitCode: 7 });
  assert.deepEqual(await fixture.events(), [['ci', '--ignore-scripts']]);
});

test('worker verifies actual checkout revision before confirmed begin and fixed process execution', async t => {
  const fixture = await workerFixture(t);
  const p = protocol();
  p.claim.checkoutSha = fixture.revision;
  p.claim.workflowSha = fixture.revision;
  const result = await runJobWorker({ ...options(), ...fixture, sha: fixture.revision, workflowSha: fixture.revision }, {
    transport: p.transport,
  });
  assert.deepEqual(result, { state: 'succeeded', exitCode: 0 });
  assert.deepEqual(await fixture.events(), [['ci', '--ignore-scripts'], ['run', 'typecheck']]);
  const stale = protocol();
  const refused = await runJobWorker({ ...options(), ...fixture }, { transport: stale.transport });
  assert.equal(refused.state, 'failed');
  assert.deepEqual(stale.calls.map(call => call.stage), ['claim']);
  assert.equal((await fixture.events()).length, 2, 'stale checkout executes no additional commands');
});

test('worker completion response loss stays failed without repeating commands or completion', async () => {
  const p = protocol({ complete: () => { throw new Error('fake lost completion'); } });
  let commands = 0;
  const result = await runJobWorker(options(), { transport: p.transport, readCheckout: async () => sha,
    runCommand: async () => { commands++; return { exitCode: 0, stopped: false }; } });
  assert.equal(result.state, 'failed');
  assert.equal(commands, 2);
  assert.equal(p.calls.filter(call => call.stage === 'complete').length, 1);
});

test('actual worker kills sleeping child and descendant on cancellation, revoked heartbeat and transport loss', async t => {
  for (const reason of ['cancel', 'revoked', 'network']) {
    await t.test(reason, async t => {
      const fixture = await workerFixture(t, 'hang');
      let pids;
      const p = protocol({ heartbeat: async () => {
        pids = await fixture.ready();
        if (reason === 'network') throw new Error('fake private token must never appear');
        return { continue: false };
      } });
      const result = await runJobWorker({ ...options(), ...fixture }, {
        transport: p.transport, readCheckout: async () => sha, heartbeatMs: 20,
      });
      assert.equal(result.state, 'cancelled');
      assert.ok(pids, 'cancellation follows real descendant readiness');
      await waitFor(() => !alive(pids.parent) && !alive(pids.child), 'worker descendant survived cancellation');
      assert.deepEqual(await fixture.events(), [['ci', '--ignore-scripts']]);
      assert.equal(p.calls.some(call => call.stage === 'complete'), false);
    });
  }
});

test('synthetic parent waits for a complete PID payload from its current descendant', async t => {
  const fixture = await workerFixture(t, 'parent-exit');
  // Execute the generated parent's actual readiness callback deterministically.
  // The real process-group test below still establishes descendant cleanup.
  const source = (await readFile(join(fixture.cwd, 'npm'), 'utf8'))
    .replace(/^#![^\n]*\n/, '').replace(/^import [^\n]*\n/gm, '');
  let poll, payload;
  const exits = [];
  runInNewContext(source, {
    process: { execPath: '/acme/node', argv: [], pid: 100, exit: code => exits.push(code) },
    spawn: () => ({ pid: 101 }), appendFileSync() {},
    existsSync: () => true, readFileSync: () => payload,
    setInterval: callback => { poll = callback; return 1; }, clearInterval() {},
  });
  assert.equal(typeof poll, 'function', 'the parent-exit fixture installed its readiness poll');
  for (payload of ['', '{', '{"parent":100,"child":', '{}', '{"parent":99,"child":101}', '{"parent":100,"child":98}']) {
    poll();
    assert.deepEqual(exits, [], `must wait on partial or stale PID payload ${JSON.stringify(payload)}`);
  }
  payload = '{"parent":100,"child":101}';poll();
  assert.deepEqual(exits, [0], 'only this parent and descendant can signal readiness');
});

test('actual worker kills leftover descendants when their parent exits before moving to next command', async t => {
  const fixture = await workerFixture(t, 'parent-exit');
  const p = protocol();
  const result = await runJobWorker({ ...options(), ...fixture }, { transport: p.transport, readCheckout: async () => sha });
  assert.equal(result.state, 'succeeded');
  const pids = await fixture.ready();
  await waitFor(() => !alive(pids.parent) && !alive(pids.child), 'exited parent left descendant alive');
  assert.deepEqual(await fixture.events(), [['ci', '--ignore-scripts'], ['run', 'typecheck']]);
});

test('worker deadline includes claim/setup and cannot be extended by heartbeats', async t => {
  const fixture = await workerFixture(t, 'hang');
  const baseTime = Date.now();
  let elapsed = 0;
  let pids;
  const p = protocol({ heartbeat: async (_body, _signal, claim) => {
    pids = await fixture.ready();
    elapsed = claim.deadline - baseTime;
    return { continue: true, leaseExpiresAt: claim.deadline };
  } });
  const result = await runJobWorker({ ...options(), ...fixture }, {
    transport: p.transport, readCheckout: async () => sha, heartbeatMs: 20,
    now: () => baseTime, monotonic: () => elapsed,
  });
  assert.equal(result.state, 'cancelled');
  await waitFor(() => !alive(pids.parent) && !alive(pids.child), 'deadline left descendant alive');
  assert.deepEqual(await fixture.events(), [['ci', '--ignore-scripts']]);
});

test('worker bounds hung begin and does not execute even if transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let commands = 0;
  let began;
  const ready = new Promise(resolve => { began = resolve; });
  const p = protocol({ begin: () => { began(); return new Promise(() => {}); } });
  const result = runJobWorker(options(), { transport: p.transport, readCheckout: async () => sha,
    runCommand: async () => { commands++; } });
  await ready;
  t.mock.timers.tick(4999);
  assert.equal(commands, 0);
  t.mock.timers.tick(1);
  assert.equal((await result).state, 'failed');
  assert.equal(commands, 0);
  assert.equal(p.calls.filter(call => call.stage === 'begin').length, 1);
});

test('worker transport uses only trusted origin and fixed OIDC audience; project environment excludes secrets', async () => {
  const calls = [];
  const transport = createWorkerTransport({ origin: 'https://acme.example',
    oidcUrl: 'https://run.actions.githubusercontent.com/acme?id=fake', oidcToken: 'fake-acme-runner-token' }, {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return Response.json(calls.length === 1 ? { value: 'fake.acme.jwt' } : { accepted: true });
    },
  });
  await transport('complete', { operationId: 'a'.repeat(64) }, new AbortController().signal);
  assert.equal(new URL(calls[0].url).searchParams.get('audience'), 'https://acme.example');
  assert.equal(calls[1].url, 'https://acme.example/api/workers/complete');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.headers.authorization, 'Bearer fake.acme.jwt');
  assert.deepEqual(workerChildEnvironment({ PATH: '/acme', HOME: '/acme', GITHUB_TOKEN: 'fake-github',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fake-oidc', KEEL_WEB_ORIGIN: 'https://acme.example', OPENAI_API_KEY: 'fake-api' }),
  { PATH: '/acme', HOME: '/acme' });
  assert.throws(() => createWorkerTransport({ origin: 'https://acme.example',
    oidcUrl: 'https://acme.invalid/oidc', oidcToken: 'fake' }));
});

test('workflow separates ordinary CI, web OIDC, fixed source, trusted callback and bounded concurrency', async () => {
  const source = await readFile(new URL('../.github/workflows/typecheck.yml', import.meta.url), 'utf8');
  const [ordinary, worker] = source.split('  web-worker:');
  assert.match(ordinary, /github.event_name != 'workflow_dispatch' \|\| inputs.keel_operation == ''/);
  assert.match(ordinary, /format\('keel-web-typecheck-\{0\}', inputs.keel_operation\) \|\| format\('typecheck-\{0\}', github.ref\)/);
  assert.match(ordinary, /cancel-in-progress: \$\{\{ github.event_name != 'workflow_dispatch' \|\| inputs.keel_operation == '' \}\}/);
  assert.doesNotMatch(ordinary, /id-token: write/);
  assert.match(ordinary, /npm ci --ignore-scripts/);
  assert.match(ordinary, /npm run typecheck/);
  assert.match(worker, /github.event_name == 'workflow_dispatch' && inputs.keel_operation != ''/);
  assert.match(worker, /timeout-minutes: 15/);
  assert.match(worker, /id-token: write/);
  assert.match(worker, /ref: \$\{\{ github.sha \}\}/);
  assert.match(worker, /PLATES_WEB_ORIGIN: \$\{\{ vars.PLATES_WEB_ORIGIN \|\| vars.KEEL_WEB_ORIGIN \}\}/);
  assert.match(worker, /run: node scripts\/web-worker.mjs/);
  assert.doesNotMatch(worker, /run: npm|secrets\.|cron:/);
});

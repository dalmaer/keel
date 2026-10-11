import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const keys = [1, 10, 2, 3, 4, 5, 6, 7].map(n => `acme/app#${n}`);
const merged = { state: 'closed', draft: false, merged_at: '2026-01-01T00:00:00Z', merge_commit_sha: 'a'.repeat(40) };
const now = '2026-01-02T00:00:00Z';
let imports = 0;
const originalExecFile = childProcess.execFile;

async function fixture(t, references = keys) {
  const root = await mkdtemp(join(tmpdir(), 'acme-reconciliation-parallel-'));
  const calls = [], waiters = [], runs = [];
  let active = 0, peak = 0, closing = false;
  t.after(async () => {
    closing = true;
    for (const call of calls) if (!call.released) call.release(Error('fixture closed'));
    await Promise.allSettled(runs);
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'docs/phases'), { recursive: true });
  const path = join(root, 'docs/phases/01-acme.md');
  const original = '# Acme\n## Acceptance\n- [ ] Verify use <!-- acceptance: use -->\n## Reconciliation\n```keel-reconciliation\n' + JSON.stringify({ version: 1, prs: [...references].reverse(), next: references.length ? { kind: 'review-pr', ref: references[0] } : { kind: 'acceptance', ref: 'use' } }) + '\n```\n';
  await writeFile(path, original);

  // Control the promisified execFile boundary used by the engine. Every
  // pending tool call has its own release barrier; no elapsed-time assertion.
  const execFileFixture = () => { throw Error('Fixture expects promisified execFile'); };
  execFileFixture[promisify.custom] = (command, args, options) => {
    if (closing) return Promise.reject(Error('fixture closed'));
    const gate = Promise.withResolvers();
    active++;
    peak = Math.max(peak, active);
    const call = { command, args, options, released: false, release(value = merged) {
      assert.equal(call.released, false, 'each tool call completes once');
      call.released = true;
      active--;
      if (value instanceof Error) gate.reject(value);
      else gate.resolve({ stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });
    } };
    calls.push(call);
    for (const waiter of waiters) if (calls.length >= waiter.count) waiter.resolve();
    return gate.promise;
  };
  childProcess.execFile = execFileFixture;
  syncBuiltinESMExports();
  const engine = await import(`../practices/reconciliation/files/scripts/keel/reconcile.mjs?barriers=${imports++}`);
  return {
    root, path, original, engine, calls,
    get peak() { return peak; },
    get active() { return active; },
    start(method = 'reconcile', options = {}) {
      const pending = engine[method]({ root, github: true, now, env: { KEEL_GH: 'acme-gh-fixture' }, ...options });
      runs.push(pending);
      return pending;
    },
    async wait(count) {
      if (calls.length >= count) return;
      const gate = Promise.withResolvers();
      waiters.push({ count, resolve: gate.resolve });
      // A deadlock diagnostic only, never a performance threshold.
      const timer = setTimeout(() => gate.reject(Error(`Waiting for ${count} tool calls; saw ${calls.length}`)), 10000);
      try { await gate.promise; } finally { clearTimeout(timer); }
    },
  };
}

async function releaseWave(f, values = {}, offset = 0) {
  await f.wait(offset + 4);
  assert.equal(f.active, 4, 'four independent reads reach the boundary before any completes');
  // Keep the first three blocked while later requests reuse the fourth slot.
  for (let i = 3; i < keys.length; i++) {
    f.calls[offset + i].release(values[keys[i]] ?? merged);
    if (i + 1 < keys.length) await f.wait(offset + i + 2);
  }
  for (const i of [2, 1, 0]) f.calls[offset + i].release(values[keys[i]] ?? merged);
}

test('fresh reads overlap, cap at four, refill independently and retain byte-equivalent sorted output', async t => {
  const f = await fixture(t, [...keys, keys[0]]);
  const pending = f.start();
  await releaseWave(f);
  const actual = await pending;
  assert.equal(f.peak, 4);
  assert.equal(f.calls.length, keys.length, 'duplicate references share one observation within a run');
  assert.deepEqual(Object.keys(actual.snapshot.prs), keys);
  const expected = await f.engine.reconcile({ root: f.root, github: true, now, prFacts: Object.fromEntries(keys.map(key => [key, merged])) });
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(await readFile(f.path, 'utf8'), f.original, 'merge facts never rewrite acceptance');
  for (const [index, call] of f.calls.entries()) {
    assert.equal(call.command, 'acme-gh-fixture');
    assert.deepEqual(call.args, ['api', `repos/acme/app/pulls/${keys[index].split('#')[1]}`]);
    assert.equal(call.options.timeout, 15000);
    assert.equal(call.options.maxBuffer, 1024 * 1024);
  }
});

test('partial failures settle independently and unknown ordering ignores completion order', async t => {
  const f = await fixture(t);
  const failures = { [keys[0]]: { ...merged, cached: true }, [keys[5]]: {} };
  const pending = f.start();
  await releaseWave(f, failures);
  const actual = await pending;
  const expected = await f.engine.reconcile({ root: f.root, github: true, now, prFacts: Object.fromEntries(keys.map(key => [key, failures[key] ?? merged])) });
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(actual.snapshot.remote, 'incomplete');
  assert.deepEqual(actual.unknown.map(x => x.path), [keys[0], keys[5]]);
  assert.deepEqual(Object.keys(actual.snapshot.prs), keys.filter(key => !failures[key]));
  assert.equal(f.peak, 4);
});

test('per-PR timeout, tool error and malformed JSON remain unknown while other reads complete', async t => {
  const f = await fixture(t);
  const failures = {
    [keys[0]]: Object.assign(Error('Acme request timed out'), { killed: true, signal: 'SIGTERM' }),
    [keys[2]]: Error('Acme tool unavailable'),
    [keys[5]]: 'not JSON',
  };
  const pending = f.start();
  await releaseWave(f, failures);
  const actual = await pending;
  assert.equal(actual.snapshot.remote, 'incomplete');
  assert.deepEqual(actual.unknown.map(x => [x.rule, x.path]), [keys[0], keys[2], keys[5]].map(key => ['github-unavailable', key]));
  assert.equal(actual.unknown[0].message, failures[keys[0]].message);
  assert.equal(actual.unknown[1].message, failures[keys[2]].message);
  assert.deepEqual(Object.keys(actual.snapshot.prs), keys.filter(key => !failures[key]));
  assert.equal(actual.findings.length, 0, 'unavailable review state cannot establish a contradiction');
  assert.equal(f.peak, 4);
});

test('proposal verification bounds both fresh passes without reusing previous observations', async t => {
  const f = await fixture(t);
  const initial = await f.engine.reconcile({ root: f.root, github: true, now, prFacts: Object.fromEntries(keys.map(key => [key, merged])) });
  const pending = f.start('verifyProposal', { proposal: initial.proposals[0] });
  await releaseWave(f);
  await releaseWave(f, {}, keys.length);
  const actual = await pending;
  assert.equal(actual.valid, true);
  assert.equal(f.calls.length, keys.length * 2, 'fingerprint reconciliation reads fresh facts again');
  assert.equal(f.peak, 4);
});

test('verification preserves proposal error order and rejects partial or changed fresh facts', async t => {
  const f = await fixture(t);
  const initial = await f.engine.reconcile({ root: f.root, github: true, now, prFacts: Object.fromEntries(keys.map(key => [key, merged])) });
  const proposal = initial.proposals[0];
  proposal.expected_prs = { invalid: {}, ...Object.fromEntries(Object.entries(proposal.expected_prs).reverse()) };
  const pending = f.start('verifyProposal', { proposal });
  await f.wait(4);
  for (let i = 3; i < keys.length; i++) {
    f.calls[i].release(i === 5 ? Error('Acme later failure') : merged);
    if (i + 1 < keys.length) await f.wait(i + 2);
  }
  f.calls[2].release({ ...merged, head: { sha: 'b'.repeat(40) } });
  f.calls[1].release(merged);
  f.calls[0].release(Error('Acme first failure'));
  const actual = await pending;
  assert.equal(actual.valid, false);
  assert.deepEqual(actual.unknown.map(x => x.path), ['invalid', keys[7], keys[2]]);
  assert.deepEqual(actual.findings.map(x => [x.rule, x.path]), [['proposal-stale', keys[5]]]);
  assert.equal(f.calls.length, keys.length, 'failed verification does not start a second pass');
  assert.equal(f.peak, 4);
});

test('empty, singleton and offline reads keep their existing boundary behavior', async t => {
  const empty = await fixture(t, []);
  assert.equal((await empty.start()).snapshot.remote, 'observed');
  assert.equal(empty.calls.length, 0);
  const single = await fixture(t, [keys[0]]);
  const pending = single.start();
  await single.wait(1);
  single.calls[0].release();
  assert.deepEqual(Object.keys((await pending).snapshot.prs), [keys[0]]);
  assert.equal(single.peak, 1);
  assert.equal((await single.start('reconcile', { github: false })).snapshot.remote, 'skipped');
  assert.equal(single.calls.length, 1);
});

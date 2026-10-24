import test from 'node:test';
import assert from 'node:assert/strict';
import { concurrencyPreflight } from '../lib/name-concurrency.mjs';
const repo = 'Acme/project', workflows = ['.github/workflows/plates-night.yml', '.github/workflows/plates-morning.yml'];
const input = () => ({ repo, workflows, coverage: { repo, complete: true, allBranches: true, workflows }, barrier: { repo, ownerApproved: true, heldThroughInstallation: true, disabledWorkflows: workflows }, runs: [] });
test('old-group runs block the concurrency transition', () => {
  for (const path of workflows) for (const headBranch of ['keel-night/2026-10-24', 'plates-night/2026-10-24']) {
    for (const status of ['queued', 'waiting', 'pending', 'in_progress', 'running', 'requested', 'unknown', undefined]) {
      const data = input();
      data.runs = [{ repo, id: 1, path, headBranch, group: 'keel-night', status, conclusion: 'cancelled' }];
      assert.equal(concurrencyPreflight(data).ok, false, `${path}: ${headBranch}: ${status}`);
      data.runs[0].status = 'completed';
      assert.equal(concurrencyPreflight(data).ok, true);
      data.runs[0].conclusion = null;
      assert.equal(concurrencyPreflight(data).ok, false);
    }
  }
});
test('concurrency preflight refuses incomplete coverage and missing owner barrier', () => {
  assert.equal(concurrencyPreflight(input()).ok, true);
  for (const key of ['repo', 'workflows', 'coverage', 'barrier', 'runs']) {
    const data = input(); delete data[key]; assert.equal(concurrencyPreflight(data).ok, false, key);
  }
  for (const mutate of [d => d.coverage.complete = false, d => d.coverage.allBranches = false, d => d.coverage.workflows = workflows.slice(0, 1), d => d.barrier.disabledWorkflows = [], d => d.barrier.ownerApproved = false, d => d.barrier.heldThroughInstallation = false, d => d.runs = [{ id: 1, path: workflows[0], status: 'completed', conclusion: 'cancelled' }]]) {
    const data = input(); mutate(data); assert.equal(concurrencyPreflight(data).ok, false);
  }
});

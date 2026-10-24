// Synthetic Acme record foundation. No provider or evaluator execution is implied.
import { sealRecord } from '../../lib/evaluation-records.mjs';
export function acmeEvaluationPlan() {
  const hash = 'a'.repeat(64), sha = 'b'.repeat(40), createdAt = '2026-10-23T00:00:00.000Z';
  const ref = r => ({ kind: r.kind, id: r.id, digest: r.digest });
  const environment = { image: `sha256:${hash}`, platform: 'linux/arm64', dependencyLock: hash, installer: hash };
  const limits = { timeoutSeconds: 60, minutes: 2, currencyUsd: null };
  const base = (kind, id) => ({ schemaVersion: 2, kind, id, createdAt });
  const material = sealRecord({ ...base('material', 'acme-checks'), mediaType: 'text/plain', content: 'Acme private acceptance placeholder; not executable proof.' });
  const task = sealRecord({ ...base('case', 'acme-case'), version: 1, taskClass: 'compatibility', publicBrief: 'Preserve Acme package entry.', repository: 'Acme/widget', startingCommit: sha, environment, allowlist: { tools: ['node'], network: [], paths: ['lib/entry.mjs'] }, prerequisites: [], requirements: ['Acme entry remains usable'], acceptanceManifest: ref(material), limits, provenance: ['synthetic Acme fixture'], visibility: 'development', exposure: [] });
  const config = id => sealRecord({ ...base('configuration', id), harnessCommit: sha, dirtyOverlay: null, provider: 'Acme', runtime: { name: 'acme-fake', version: '1', settings: { temperature: null, maxTokens: 1000 } }, model: { requested: 'acme-alias', resolved: null, unresolvedReason: 'Synthetic alias; no provider contacted' }, context: [], overlays: [], exclusions: [], tools: [{ name: 'node', version: '24.22.1', configDigest: hash }], routing: { provider: 'Acme', policyDigest: hash }, policy: { execution: 'offline-only', review: 'independent', automatic: false }, environment });
  const baseline = config('acme-baseline'), candidate = config('acme-candidate');
  const comparison = sealRecord({ ...base('comparison', 'acme-comparison'), repository: 'Acme/widget', authority: { kind: 'phase', ref: '117' }, baseline: ref(baseline), candidate: ref(candidate), cases: [ref(task)], pairs: Array.from({ length: 6 }, (_, i) => ({ id: `acme-pair-${i}`, case: ref(task), order: i % 2 ? 'BA' : 'AB' })), seed: 117, stopping: 'all-planned-or-safety', replacements: 0, allowance: { minutes: 24, currencyUsd: null }, retention: { days: 30, maxBytes: 1048576, maxEvents: 100 }, drift: 'unknown-is-incomparable', promotion: { automatic: false, criteria: null } });
  return { schemaVersion: 2, kind: 'harness', cases: [task], configurations: [baseline, candidate], materials: [material], comparison };
}

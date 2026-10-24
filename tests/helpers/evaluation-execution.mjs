// Synthetic Acme offline fixtures. Docker is used only by explicit opt-in tests.
import { mkdtemp, realpath, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, cleanEnv } from './run.mjs';
import { spawn } from 'node:child_process';
// Child handle is needed to prove real controller death, with the shared env isolation.
export function evaluationController(source) {
  return spawn(process.execPath, ['--input-type=module', '-e', source], { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
}
import { acmeEvaluationPlan } from './evaluation-plan.mjs';
import { sealRecord } from '../../lib/evaluation-records.mjs';
import { initializeWorkspace } from '../../lib/web/workspace.mjs';
import { evaluations } from '../../lib/evaluation-ledger.mjs';
export const IMAGE = 'sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a';
export async function evaluationWorld(t, { builder, expected = 'Acme\n', timeoutSeconds = 20, allowanceMinutes = 28, retentionBytes = 64 * 1024 * 1024, maxEvents = 1000 } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'acme-isolation-')));
  if (process.env.PLATES_EVALUATION_RETAIN === '1') t.diagnostic(JSON.stringify({ retainedPrivateWorkspace: root, authority: 'synthetic-test-evidence-only' }));
  else t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, 'repository'); await mkdir(join(repository, '.plates'), { recursive: true });
  const git = args => { const r = run('git', ['-c', 'core.fsmonitor=false', '-C', repository, ...args]); if (r.status !== 0) throw Error(r.stderr); return r.stdout.trim(); };
  await writeFile(join(repository, '.plates/plates.json'), JSON.stringify({ repo: 'Acme/widget' }));
  await writeFile(join(repository, 'answer.mjs'), 'export default "Acme";\n');
  git(['init', '-q']); git(['add', '.']); git(['commit', '-qm', 'Acme fixture']); git(['remote', 'add', 'origin', 'https://github.com/Acme/widget.git']);
  const revision = git(['rev-parse', 'HEAD']);
  const inputs = join(root, 'inputs'); await mkdir(inputs, { mode: 0o700 });
  const manifest = join(inputs, 'workspace.json'), managed = join(inputs, 'managed.json'), bundle = join(inputs, 'bundle.json'), execution = join(inputs, 'execution.json');
  await writeFile(manifest, JSON.stringify({ version: 1, id: 'acme', name: 'Acme', repo: 'Acme/private', projects: [{ id: 'widget', repo: 'Acme/widget' }] }));
  await writeFile(managed, JSON.stringify([{ repo: 'Acme/widget', role: 'managed' }]));
  const b = acmeEvaluationPlan(), ref = r => ({ kind: r.kind, id: r.id, digest: r.digest });
  b.materials[0] = sealRecord({ ...b.materials[0], mediaType: 'application/json', content: JSON.stringify({ schemaVersion: 1, driver: 'stdio-v1', checks: [{ id: 'acme-behavior', argv: ['node', '/work/probe.mjs'], stdin: '', stdout: expected, exitCode: 0 }] }) });
  const material = (id, content) => sealRecord({ schemaVersion: 2, kind: 'material', id, createdAt: b.materials[0].createdAt, mediaType: 'text/plain', content });
  const build = material('acme-builder', builder ?? 'import {readFileSync} from "node:fs";console.log(JSON.stringify({schemaVersion:1,files:[{path:"answer.mjs",mode:"100644",base64:readFileSync("answer.mjs").toString("base64")}]}));');
  const probe = material('acme-probe', 'import answer from "./answer.mjs";console.log(answer);');
  b.materials.push(build, probe);
  b.cases[0] = sealRecord({ ...b.cases[0], startingCommit: revision, environment: { ...b.cases[0].environment, image: IMAGE }, acceptanceManifest: ref(b.materials[0]), allowlist: { tools: ['pinned-image-tools'], network: [], paths: ['answer.mjs'] }, limits: { timeoutSeconds, minutes: 2, currencyUsd: null } });
  b.configurations = b.configurations.map(c => sealRecord({ ...c, provider: 'offline', runtime: { ...c.runtime, name: 'scripted-node-v1' }, routing: { ...c.routing, provider: 'offline' }, environment: b.cases[0].environment, overlays: [{ path: 'build.mjs', material: ref(build) }, { path: 'probe.mjs', material: ref(probe) }] }));
  b.comparison = sealRecord({ ...b.comparison, baseline: ref(b.configurations[0]), candidate: ref(b.configurations[1]), cases: b.cases.map(ref), pairs: b.comparison.pairs.map(p => ({ ...p, case: ref(b.cases[0]) })), allowance: { ...b.comparison.allowance, minutes: allowanceMinutes }, retention: { ...b.comparison.retention, maxBytes: retentionBytes, maxEvents } });
  await writeFile(bundle, JSON.stringify(b));
  const admission = { stateDir: join(root, 'host-budget'), manifest: managed, capacity: 1, weight: 1, repo: 'Acme/widget' };
  const request = { schemaVersion: 1, pairId: 'acme-pair-0', arm: 'baseline', repository, sourcePaths: ['answer.mjs'], builderArgv: ['node', '/work/build.mjs'], admission };
  await writeFile(execution, JSON.stringify(request));
  const options = { appRoot: fileURLToPath(new URL('../..', import.meta.url)), manifest, state: join(root, 'state') };
  await initializeWorkspace(options);
  const freeze = await evaluations({ ...options, action: 'freeze', bundle });
  await evaluations({ ...options, action: 'freeze', bundle, yes: true, digest: freeze.digest });
  const call = extra => evaluations({ ...options, action: 'run', experiment: b.comparison.id, execution, ...extra });
  return { root, repository, managed, admission, options, execution, request, b, call };
}

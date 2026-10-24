// Opt-in real pinned-image proof. Stage receipts are machinery evidence, not experiments or efficacy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { run } from './helpers/run.mjs';
import { corpusDefinition, prepareCorpusExport } from '../lib/evaluation-corpus.mjs';
import { validateArtifact } from '../lib/evaluation-artifacts.mjs';
import { preflightDocker, runDockerStage } from '../lib/evaluation-docker.mjs';
import { byteDigest, fingerprint } from '../lib/evaluation-records.mjs';
const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
for (const id of ['package-entry', 'canvas-retirement', 'coordinator-guidance', 'rename-ownership', 'consumer-options', 'workspace-command-doc']) {
  test('real Docker corpus ' + id + ' original fails and corrected witness passes', { skip: process.env.PLATES_EVALUATION_DOCKER !== '1' }, async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'acme-corpus-docker-')));
    if (process.env.PLATES_EVALUATION_RETAIN === '1') t.diagnostic(JSON.stringify({ retainedPrivateWorkspace: root }));
    else t.after(() => rm(root, { recursive: true, force: true }));
    const d = await corpusDefinition(id), p = await prepareCorpusExport({ case: id, repository, destination: join(root, 'export') });
    const original = p.outputs.filter(f => f.path.startsWith('builder/')).map(f => ({ path: f.path.slice(8), mode: '100644', base64: f.bytes.toString('base64') }));
    const image = await preflightDocker(d.task.environment, { deadline: Date.now() + 10000 });
    const corrected = original.map(f => {
      if (!d.definition.writable.includes(f.path)) return f;
      const r = run('git', ['-c', 'core.fsmonitor=false', '-C', repository, 'show', d.definition.fix + ':' + f.path]); assert.equal(r.status, 0, r.stderr);
      return { ...f, base64: Buffer.from(r.stdout).toString('base64') };
    });
    validateArtifact(original, corrected, d.definition.writable, d.probes.map(f => f.path));
    const receipts = [];
    for (const [witness, files] of [['original', original], ['corrected', corrected]]) {
      const name = 'plates-eval-' + randomBytes(16).toString('hex') + '-check-0', started = Date.now();
      const stage = await runDockerStage({ name, image, files, argv: ['node', '/work/probes/' + d.definition.probe], stdin: JSON.parse(d.acceptance.content).checks[0].stdin, deadline: started + 90000, cleanupDeadline: started + 100000 });
      const receipt = { caseId: id, witness, startingCommit: d.definition.start, correctedWitness: d.definition.fix, image, deliveryDigest: fingerprint(files), stage };
      const bytes = JSON.stringify(receipt, null, 2) + '\n', path = join(root, witness + '.json'); await writeFile(path, bytes, { mode: 0o400 });
      receipts.push({ path, sha256: byteDigest(bytes), operation: name, containerId: stage.containerId });
      t.diagnostic(JSON.stringify(receipts.at(-1)));
      assert.equal(stage.setup, 'passed', JSON.stringify(stage)); assert.equal(stage.termination.state, 'terminated', JSON.stringify(stage));
      assert.equal(stage.output.signal, null, JSON.stringify(stage));
      if (witness === 'original') { assert.notEqual(stage.output.exit, 0); assert.match(stage.output.stderr, /AssertionError|ERR_MODULE_NOT_FOUND/); }
      else { assert.equal(stage.output.exit, 0, stage.output.stderr); assert.equal(stage.output.stdout, d.definition.stdout); }
    }
    await writeFile(join(root, 'proof.json'), JSON.stringify({ id, receipts, claims: 'exposed scripted development machinery; no agent efficacy or live-provider claim' }, null, 2) + '\n', { mode: 0o400 });
  });
}

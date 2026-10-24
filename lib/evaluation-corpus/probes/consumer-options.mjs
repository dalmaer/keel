// Actual synthetic producer/consumer contract. Apache-2.0 provenance in rename-support.
import assert from 'node:assert/strict';
import { applyRename } from '../lib/rename.mjs';
import { fixture, put, get, command, commit, cleanup } from './rename-support.mjs';
const root = await fixture();
try {
  await put(root, 'node_modules/@acme/sdk/package.json', JSON.stringify({ type: 'module', main: 'index.mjs' }));
  await put(root, 'node_modules/@acme/sdk/index.mjs', 'export default value => value.keel;\n');
  const source = "import configure from '@acme/sdk'; const key='keel'; console.log(configure({keel:'enabled'}),configure({[key]:'keel-value'}),configure({keel:'.keel'}));\n";
  const environment = "const env=process.env; const key='KEEL_ACME'; const {KEEL_ACME,keelAcme:lower}=process.env;console.log(process.env.KEEL_ACME,process.env['KEEL_ACME'],KEEL_ACME,env[key],lower,process.env.keelAcme);\n";
  const config = JSON.parse(await get(root, '.keel/keel.json')); config.env = { KEEL_ACME: 'enabled', keelAcme: 'lowercase' }; config.tests = { configEnv: ['KEEL_ACME', 'keelAcme'] };
  await put(root, '.keel/keel.json', JSON.stringify(config));
  await put(root, 'src/options.mjs', source); await put(root, 'src/environment.mjs', environment);
  await put(root, '.gitignore', 'node_modules/\n'); commit(root);
  const execute = name => command(root, process.execPath, ['src/' + name + '.mjs'], config.env);
  assert.equal(execute('options'), 'enabled keel-value .keel\n');
  const before = execute('environment'); assert.equal(before, 'enabled enabled enabled enabled lowercase lowercase\n');
  await applyRename(root);
  assert.equal(execute('options'), 'enabled keel-value .keel\n'); assert.equal(execute('environment'), before);
  assert.equal(await get(root, 'src/options.mjs'), source); assert.equal(await get(root, 'src/environment.mjs'), environment);
  const after = JSON.parse(await get(root, '.plates/plates.json')); assert.deepEqual(after.env, config.env); assert.deepEqual(after.tests, config.tests);
  console.log('Acme consumer options accepted');
} finally { await cleanup(root); }

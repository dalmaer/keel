import { registerHooks } from 'node:module';
const root = 'file:///Users/dionalmaer/code/keel/';
const changes = {
  'candidate-unchanged': ['lib/release.mjs', 'return { version: practice, changed: false };', "return { version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, changed: false };"],
  'candidate-next-patch': ['lib/release.mjs', '${patch + 1}', '${patch}'],
  'candidate-non-self': ['lib/release.mjs', "if (config.keel !== 'self') throw new ReleaseError('the rehearsal", "if (false) throw new ReleaseError('the rehearsal"],
  'transport-space': ['lib/canvas-sync.mjs', "space: (home, spaceId) => invoke(['share', '--space', spaceId], true, home)", "space: (home, spaceId) => invoke(['share', '--canvas', spaceId], true, home)"],
  'transport-groups': ['lib/canvas-sync.mjs', "groups: binding => invoke(['--canvas', binding.canvasId, 'canvas', 'group', 'ls'], true, binding.home)", "groups: binding => invoke(['--canvas', binding.canvasId, 'canvas', 'group', 'show'], true, binding.home)"],
};
const name = process.env.KEEL_AUDIT_MUTATION;
if (!changes[name]) throw new Error('Unknown audit mutation');
const [path, before, after] = changes[name];
registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (url !== root + path) return loaded;
  const source = String(loaded.source);
  if (source.split(before).length !== 2 || before === after) throw new Error('Audit mutation must change exactly one source span: ' + name);
  process.stderr.write('AUDIT_MUTATION_APPLIED ' + name + '\n');
  return { ...loaded, source: source.replace(before, after) };
} });

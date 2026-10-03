// Render the practices a project has switched on (.keel/keel.json "practices").
//
//   node scripts/render.mjs --self             render onto keel itself
//   node scripts/render.mjs --self --check     exit 1, naming each path, if keel's
//                                              practice files differ from practices/
//   node scripts/render.mjs --into <dir>       render onto another project (its
//                                              .keel/keel.json must exist)
//   --json                                     the plan, for an agent
//
// Managed files and blocks are rewritten; seeded files are written only when
// absent and never compared. Phase 2 wraps this in bin/keel.mjs.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../lib/practices.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const json = args.includes('--json'), check = args.includes('--check');
const label = e => e.block ? `${e.path}#${e.block}` : e.path;

try {
  const into = args.indexOf('--into');
  if (args.includes('--self') === (into >= 0)) throw new Error('usage: render.mjs (--self | --into <dir>) [--check] [--json]');
  const root = into >= 0 ? resolve(args[into + 1] ?? '') : KEEL;
  if (into >= 0 && !args[into + 1]) throw new Error('--into needs a directory');
  const result = await render(root, { check });
  const counts = {};
  for (const e of result.entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
  if (json) {
    console.log(JSON.stringify({
      root, check, ok: result.ok,
      differs: result.differs.map(label),
      entries: result.entries.map(({ content, ...e }) => e),
    }, null, 2));
  } else if (check && !result.ok) {
    console.error(`Practice files differ from practices/ — run node scripts/render.mjs ${into >= 0 ? '--into <dir>' : '--self'}:`);
    for (const e of result.differs) console.error(`  ${e.status.padEnd(7)} ${label(e)} (${e.practice})`);
  } else {
    const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
    console.log(`${check ? 'Checked' : 'Rendered'} ${result.entries.length} practice targets: ${summary}`);
  }
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  if (json) console.log(JSON.stringify({ ok: false, error: error.message }));
  else console.error(error.message);
  process.exitCode = 1;
}

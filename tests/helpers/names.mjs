// Mutate one canonical alias at one fallback identity, then exercise the actual
// consumer. Relative imports keep their real source targets; no checkout edits.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const asModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
export async function markerMutant(consumer, id, removedName, exports = []) {
  const names = new URL('../../practices/night/files/scripts/plates/names.mjs', import.meta.url);
  const source = await readFile(names, 'utf8');
  const needle = 'for (const name of readNames(id, rows))';
  assert.equal(source.split(needle).length, 2, 'mutation targets exactly the marker fallback');
  const changed = source.replace(needle, `for (const name of readNames(id, rows).filter(name => id !== ${JSON.stringify(id)} || name !== ${JSON.stringify(removedName)}))`);
  return consumerWithNames(consumer, changed, exports);
}
async function consumerWithNames(consumer, changed, exports = []) {
  assert.ok(exports.every(name=>/^[A-Za-z][A-Za-z0-9_]*$/.test(name)));
  const dependency = asModule(changed);
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'acme-marker-mutant-')), file = join(dir, 'consumer.mjs');
  let reconciler;
  const rewrite = (source, base, library) => source.replace(/from (['"])(\.[^'"]+)\1/g, (_all, quote, path) => `from ${quote}${path === './names.mjs' ? dependency : path.endsWith('/reconcile.mjs') && reconciler ? reconciler : path === './lib.mjs' && library ? library : new URL(path, base).href}${quote}`).replace(/import\((['"])(\.[^'"]+)\1\)/g, (_all, quote, path) => `import(${quote}${new URL(path,base).href}${quote})`);
  try {
    const original=await readFile(consumer,'utf8');
    const target=/from ['"](\.[^'"]*\/reconcile\.mjs)['"]/.exec(original)?.[1];
    if(target) {
      const base=new URL(target,consumer),destination=join(dir,'reconcile.mjs');
      await writeFile(destination,rewrite(await readFile(base,'utf8'),base));
      reconciler=pathToFileURL(destination).href;
    }
    let library;
    if (original.includes("from './lib.mjs'")) {
      const base = new URL('./lib.mjs', consumer);
      library = asModule(rewrite(await readFile(base, 'utf8'), base));
    }
    const consumerSource = rewrite(original, consumer, library)+(exports.length ? `\nexport {${exports.join(',')}};\n` : '');
    await writeFile(file, consumerSource); return await import(pathToFileURL(file).href);
  } finally { await rm(dir, {recursive:true,force:true}); }
}

export async function artifactMutant(t, consumer, id, removedName) {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const source = await readFile(new URL('../../practices/night/files/scripts/plates/names.mjs', import.meta.url), 'utf8');
  const needle = 'return readNames(id, rows).map(name => name + suffix);';
  assert.equal(source.split(needle).length, 2);
  const dependency = asModule(source.replace(needle, `return readNames(id, rows).filter(name => id !== ${JSON.stringify(id)} || name !== ${JSON.stringify(removedName)}).map(name => name + suffix);`));
  const text = (await readFile(consumer, 'utf8')).replace(/from (['"])(\.[^'"]+)\1/g, (_all, quote, path) => `from ${quote}${path === './names.mjs' ? dependency : new URL(path, consumer).href}${quote}`);
  const dir = await mkdtemp(join(tmpdir(), 'acme-name-mutant-'));
  t.after(() => rm(dir, {recursive:true,force:true}));
  const file = join(dir, 'consumer.mjs');
  await writeFile(file, text);
  return import(pathToFileURL(file).href);
}


export async function fenceMutant(consumer, id, removedName) {
  const source = await readFile(new URL('../../practices/night/files/scripts/plates/names.mjs', import.meta.url), 'utf8');
  const needle = '[row.plates, row.keel].includes(type)';
  assert.equal(source.split(needle).length, 2, 'mutation targets only historical fence recognition');
  const changed = source.replace(needle, `[row.plates, row.keel].filter(name => row.id !== ${JSON.stringify(id)} || name !== ${JSON.stringify(removedName)}).includes(type)`);
  return consumerWithNames(consumer, changed);
}

export async function labelMutant(consumer,id,removedName,exports=[]) {
 const source=await readFile(new URL('../../practices/night/files/scripts/plates/names.mjs',import.meta.url),'utf8');
 const needle='return [row.plates, row.keel];';
 assert.equal(source.split(needle).length,2);
 return consumerWithNames(consumer,source.replace(needle,`return [row.plates, row.keel].filter(name => id !== ${JSON.stringify(id)} || name !== ${JSON.stringify(removedName)});`),exports);
}
export async function diagnosticMutant(consumer,removedName) {
 const source=await readFile(new URL('../../practices/night/files/scripts/plates/names.mjs',import.meta.url),'utf8');
 const needle='for(const name of readNames(id,rows))';
 assert.equal(source.split(needle).length,2);
 return consumerWithNames(consumer,source.replace(needle,`for(const name of readNames(id,rows).filter(name=>name!==${JSON.stringify(removedName)}))`));
}

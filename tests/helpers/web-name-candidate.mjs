// Synthetic source candidate: production has no activation flag or injected authority.
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
export async function nameCandidate(t, { cookies = true, database = false, markers = false } = {}) {
  const source = resolve(import.meta.dirname, '../..'), root = await mkdtemp(join(tmpdir(), 'acme-names-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['lib', 'scripts', 'practices', 'migrations', 'package.json']) await cp(join(source, path), join(root, path), { recursive: true });
  const table = join(root, 'practices/night/files/scripts/plates/names.mjs');
  const original = await readFile(table, 'utf8');
  let changed = 0;
  const candidate = original.replace(/Object\.freeze\((\{[^\n]+\})\)/g, (line, json) => {
    const row = JSON.parse(json);
    const selected = cookies && ['web:__Host-keel-session','web:__Host-keel-login','web:__Host-keel-oauth'].includes(row.id)
      || markers && ['web:Keel-Operation','web:Keel-Update-Operation'].includes(row.id)
      || database && row.surface === 'database' && !row.keel.includes('.') && (row.keel.endsWith('_rpc') || ['keel_run_history','keel_model_credential_read'].includes(row.keel));
    if (!selected) return line;
    assert.equal(row.state, 'held', `shipped activation barrier: ${row.id}`);
    changed++;
    return line.replace('"state": "held"', '"state": "dual"');
  });
  assert.equal(changed, (cookies ? 3 : 0) + (database ? 15 : 0) + (markers ? 2 : 0));
  await writeFile(table, candidate);
  // No capability registry is changed. Source coverage remains subject to its
  // independent pin checks; this candidate only exercises authentication/RPCs.
  return {
    root,
    auth: await import(pathToFileURL(join(root, 'lib/web/auth.mjs')).href),
    transitions: await import(pathToFileURL(join(root, 'lib/web/name-transition.mjs')).href),
    decisions: await import(pathToFileURL(join(root, 'lib/web/decisions.mjs')).href),
    operations: await import(pathToFileURL(join(root, 'lib/web/operations.mjs')).href),
    fleet: await import(pathToFileURL(join(root, 'lib/web/fleet-updates.mjs')).href),
    server: await import(pathToFileURL(join(root, 'lib/web/server.mjs')).href),
    store: await import(pathToFileURL(join(root, 'lib/web/store.mjs')).href),
    names: await import(pathToFileURL(join(root, 'lib/names.mjs')).href),
  };
}

export function browserJar(now) {
  const entries = new Map();
  return {
    entries,
    header: () => [...entries].filter(([, c]) => c.expires > now()).map(([name,c]) => `${name}=${c.value}`).join('; '),
    apply(response) {
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';'), index = pair.indexOf('='), name = pair.slice(0,index), value = pair.slice(index+1);
        const seconds = Number(/Max-Age=(\d+)/.exec(line)[1]);
        if (seconds === 0) entries.delete(name);
        else entries.set(name, { value, expires: now() + seconds * 1000 });
      }
    },
  };
}

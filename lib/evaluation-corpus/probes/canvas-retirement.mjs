// Behavioral acceptance adapted from dalmaer/plates tests/canvas-sync.test.mjs
// at d57d44ecae668c7e37713585f33f4e4fadd19566 (Apache-2.0).
// Direct supplied-card surface only; no snapshot/night/history-export coverage.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { canvasLive } from '../lib/canvas-sync.mjs';
import { fixture, read, configPath, manifestPath } from './canvas-retirement-support.mjs';
const key = 'acme-weekly';
const cards = date => [
  { key, title: `Acme weekly ${date}`, region: 'loop', source: `# Acme weekly ${date}\n`, visual: `<!doctype html><p>Acme ${date}</p>` },
  { key: `acme-control-${date}`, title: `Acme control ${date}`, region: 'health', source: `# Acme control ${date}\n` },
];
const modes = process.argv.length === 2 ? ['off', 'remove-key'] : process.argv.slice(2);
assert.ok(modes.length > 0 && modes.every(mode => ['off', 'remove-key'].includes(mode)), 'unsupported Acme probe mode');
for (const mode of modes) {
  const cleanups = [], f = await fixture({ after: fn => cleanups.push(fn) });
  try {
    await f.attach();
    assert.equal((await f.publish(cards('2026-10-12'))).exitCode, 0);
    await f.goLive({ cards: [key] });
    const owned = (await read(manifestPath(f.root))).items[key], card = f.remote.items.get(owned.itemId);
    assert.equal(owned.live, undefined, 'fixture must exercise live ownership awaiting adoption');
    card.title = 'Acme: edited by a person'; card.comments.push('Acme human note'); card.x = 913;
    card.properties.reviewed = 'Acme human review';
    const original = JSON.stringify(card);
    const leave = () => mode === 'off' ? canvasLive({ root: f.root, off: true, yes: true }, { transport: f.transport }) : f.goLive({ cards: ['pulse'] });
    const bound = async () => { const c = (await read(configPath(f.root))).canvas; return c.mode === 'immutable' || !c.liveKeys.includes(key); };
    const rename = fsp.rename;
    fsp.rename = async (from, to) => {
      if (to === manifestPath(f.root) && await bound()) throw Object.assign(new Error('Acme lost post-binding journal write'), { code: 'EIO' });
      return rename(from, to);
    };
    syncBuiltinESMExports();
    try { await assert.rejects(leave(), /Acme lost post-binding journal write/); }
    finally { fsp.rename = rename; syncBuiltinESMExports(); }
    assert.equal(await bound(), true, 'binding must have landed before interruption');
    const snapshot = JSON.stringify([...f.remote.items]), counts = [f.remote.adds, f.remote.groupCreates, f.remote.edits.length, f.remote.prunes.length];
    const retry = await leave();
    assert.deepEqual(retry.data.changes.filter(c => c.action === 'retire-live-card').map(c => [c.key, c.itemId]), [[key, card.id]], `${mode}: retry must finish retirement`);
    const journal = await read(manifestPath(f.root));
    assert.equal(journal.items[key], undefined);
    assert.deepEqual(journal.retired.map(r => [r.itemId, r.retiring]), [[card.id, undefined]]);
    await leave();
    assert.equal(JSON.stringify([...f.remote.items]), snapshot, 'retirement and retry have no external write effects');
    assert.deepEqual([f.remote.adds, f.remote.groupCreates, f.remote.edits.length, f.remote.prunes.length], counts);
    const next = await f.publish(cards('2026-10-19'));
    assert.deepEqual([next.data.state, next.exitCode], ['published', 0]);
    assert.equal(f.remote.adds, counts[0] + 2, 'one new card per requested publication');
    assert.equal(f.remote.edits.length, 0);
    assert.notEqual((await read(manifestPath(f.root))).items[key].itemId, card.id);
    assert.equal(JSON.stringify(card), original, 'the old human-owned card is unchanged');
    await f.publish(cards('2026-10-19'));
    assert.equal(f.remote.adds, counts[0] + 2, 'repeat publication must not duplicate effects');
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
}
process.stdout.write('Acme canvas retirement accepted\n');

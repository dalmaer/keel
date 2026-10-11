/**
 * Git, the same on every machine the tests run on.
 *
 * Loaded before every test file (`npm test` passes --import), so it reaches
 * every git the tests start — in-process, or spawned (directly, or through
 * `keel` itself): it sets process.env, which every child inherits, and
 * tests/helpers/run.mjs's cleanEnv strips only NODE_TEST_*.
 *
 * Nobody's own config is touched. The tests simply stop reading it:
 * - GIT_CONFIG_GLOBAL → an empty file of our own, GIT_CONFIG_NOSYSTEM=1. A
 *   developer's ~/.gitconfig and /etc/gitconfig (fsmonitor, commit.gpgsign,
 *   hooksPath, includeIf, credential helpers, init.defaultBranch, user.*)
 *   no longer leak in.
 * - A synthetic Acme identity, unless the environment already names one.
 *   Tests that pass their own still win: theirs is set after this.
 * - GIT_CONFIG_COUNT pins, which outrank every config file (appended to an
 *   existing set, never replacing it). Belt and braces for the keys that
 *   have bitten: `core.fsmonitor=true` in one developer's global config made
 *   31 tests fail there and pass in CI — each git in a scratch project
 *   started an fsmonitor daemon whose socket landed in the template doctor's
 *   tests copy, and Node will not copy a socket (ERR_FS_CP_SOCKET).
 *
 * tests/hermetic.test.mjs fails if this stops being loaded or stops holding.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'keel-gitconfig-'));
const global = join(dir, 'gitconfig');
writeFileSync(global, '');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

process.env.GIT_CONFIG_GLOBAL = global;
// keel's cache (review receipts, the board's kept GitHub reads): never the developer's own ~/.cache/keel.
process.env.KEEL_CACHE = join(dir, 'keel-cache');
// Adoption's optional Actions history never reaches the network in hermetic tests.
process.env.KEEL_CI_OFFLINE = '1';
process.env.KEEL_MILESTONES_OFFLINE = '1';
// climb.mjs's pointer to Codex's git dir (keel phase 47): a Codex night that runs keel's own suite must not aim the tests' climb.mjs at it.
delete process.env.KEEL_AGENT_GIT;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const identity = { GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test', GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test' };
for (const [k, v] of Object.entries(identity)) process.env[k] ||= v;

// maintenance.auto and gc.auto: a background `git maintenance` or auto-gc can remove
// .git/objects/maintenance.lock while a test walks .git (the phase 47 test makes it
// read-only), which failed keel's CI once with ENOENT (keel#58's check, 2026-10-10).
const pin = { 'core.fsmonitor': 'false', 'init.defaultBranch': 'main', 'commit.gpgsign': 'false', 'maintenance.auto': 'false', 'gc.auto': '0' };
const n = Number(process.env.GIT_CONFIG_COUNT) || 0;
Object.entries(pin).forEach(([key, value], i) => {
  process.env[`GIT_CONFIG_KEY_${n + i}`] = key;
  process.env[`GIT_CONFIG_VALUE_${n + i}`] = value;
});
process.env.GIT_CONFIG_COUNT = String(n + Object.keys(pin).length);

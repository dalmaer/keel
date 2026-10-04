/**
 * Git, the same on every machine the tests run on.
 *
 * Loaded before every test file (`npm test` passes --import), so it reaches
 * every git the tests start — directly, or through `keel` itself.
 *
 * `core.fsmonitor=true` in a developer's global config made 31 tests fail on
 * that one Mac and pass in CI: each `git` in a scratch project started an
 * fsmonitor daemon, whose socket (.git/fsmonitor--daemon.ipc) then sat in
 * the template that doctor's tests copy per test, and Node will not copy a
 * socket (ERR_FS_CP_SOCKET). It also left a daemon running per scratch dir.
 * Pinned off here, in the environment, so nobody's own config is touched.
 *
 * GIT_CONFIG_COUNT entries outrank every config file, and an existing set is
 * appended to rather than replaced.
 */

const pin = { 'core.fsmonitor': 'false' };

const n = Number(process.env.GIT_CONFIG_COUNT) || 0;
Object.entries(pin).forEach(([key, value], i) => {
  process.env[`GIT_CONFIG_KEY_${n + i}`] = key;
  process.env[`GIT_CONFIG_VALUE_${n + i}`] = value;
});
process.env.GIT_CONFIG_COUNT = String(n + Object.keys(pin).length);

// Synthetic Acme program: direct APIs are the instrumentation subject.
import assert from 'node:assert/strict';
import { ChildProcess, exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';

const [mode, outcome] = process.argv.slice(2);
const failed = outcome === 'failure';
const command = `printf Acme-secret-stdout; printf Acme-secret-stderr >&2; exit ${failed ? 7 : 0}`;
const check = (error, stdout, stderr) => {
  assert.equal(error?.code ?? null, failed ? 7 : null);
  assert.equal(String(stdout), 'Acme-secret-stdout');
  assert.equal(String(stderr), 'Acme-secret-stderr');
};
const checkChild = child => {
  assert.ok(child instanceof ChildProcess);
  assert.ok(Number.isInteger(child.pid));
  assert.ok(child.stdout);
  assert.ok(child.stderr);
};

if (mode === 'callback') {
  await new Promise((resolve, reject) => {
    const child = exec(command, (error, stdout, stderr) => {
      try { check(error, stdout, stderr); resolve(); } catch (e) { reject(e); }
    });
    checkChild(child);
  });
} else if (mode === 'promise') {
  const promise = promisify(exec)(command);
  checkChild(promise.child);
  let result; let error;
  try { result = await promise; } catch (e) { error = e; }
  check(error, error?.stdout ?? result.stdout, error?.stderr ?? result.stderr);
} else if (mode === 'sync') {
  let stdout; let error;
  try { stdout = execSync(command, { stdio: 'pipe' }); } catch (e) { error = e; }
  assert.equal(error?.status ?? null, failed ? 7 : null);
  assert.equal(String(error?.stdout ?? stdout), 'Acme-secret-stdout');
  if (failed) assert.equal(String(error.stderr), 'Acme-secret-stderr');
} else {
  throw new Error('Unknown synthetic fixture mode');
}

// Find the keel project a command is run in: the nearest directory, walking up
// from the working directory, that holds .keel/keel.json.
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export class NoProject extends Error {
  constructor(from) {
    super(`not in a keel project: no .keel/keel.json in ${from} or any parent`);
    this.exitCode = 2;
  }
}

/** The project root at or above `from`, or throws NoProject. */
export async function findRoot(from = process.cwd()) {
  let dir = resolve(from);
  for (;;) {
    if ((await stat(join(dir, '.keel', 'keel.json')).catch(() => null))?.isFile()) return dir;
    const up = dirname(dir);
    if (up === dir) throw new NoProject(resolve(from));
    dir = up;
  }
}

// Find the plates project a command is run in: the nearest directory, walking up
// from the working directory, that holds .plates/plates.json.
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export class NoProject extends Error {
  constructor(from) {
    super(`not in a plates project: no .plates/plates.json in ${from} or any parent`);
    this.exitCode = 2;
  }
}

/** The project root at or above `from`, or throws NoProject. */
export async function findRoot(from = process.cwd()) {
  let dir = resolve(from);
  for (;;) {
    if ((await stat(join(dir, '.plates', 'plates.json')).catch(() => null))?.isFile()) return dir;
    const up = dirname(dir);
    if (up === dir) throw new NoProject(resolve(from));
    dir = up;
  }
}

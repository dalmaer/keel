import { cp } from 'node:fs/promises';
import { relative, sep } from 'node:path';

/** Copy project inputs for render probes, preserving configuration and symlinks. */
export async function copyProject(source, destination) {
  await cp(source, destination, {
    recursive: true,
    verbatimSymlinks: true,
    filter: path => {
      const local = relative(source, path).split(sep).join('/');
      // Reject the directory itself before cp enumerates rotating records.
      return !/^(?:\.git|node_modules)(?:\/|$)/.test(local)
        && !/(?:^|\/)\.keel\/test-runs(?:\/|$)/.test(local);
    },
  });
}

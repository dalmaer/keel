import { cp } from 'node:fs/promises';
import { basename, relative, sep } from 'node:path';

/** Copy project inputs without runtime ledgers, preserving configuration and symlinks. */
export async function copyProject(source, destination) {
  await cp(source, destination, {
    recursive: true,
    verbatimSymlinks: true,
    filter: path => {
      const local = relative(source, path).split(sep).join('/');
      // Some probes copy the checkout's .keel subtree on its own.
      const projectPath = basename(source) === '.keel' ? `.keel/${local}` : local;
      // Reject the directory itself before cp enumerates rotating records.
      return !/^(?:\.git|node_modules)(?:\/|$)/.test(local)
        && !/(?:^|\/)\.keel\/test-runs(?:\/|$)/.test(projectPath);
    },
  });
}

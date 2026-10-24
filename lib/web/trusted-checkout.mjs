import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { aliasValue } from './name-transition.mjs';
import { nameRow } from '../names.mjs';
import { WebError } from './common.mjs';
export async function trustedCheckout(workspace) {
  const row = nameRow('web:trusted-keel'), paths = new Map();
  for (const name of [row.plates, row.keel]) {
    try { paths.set(name, await realpath(join(workspace, name))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const path = aliasValue(row.id, name => paths.get(name));
  if (!path) throw new WebError('trusted_checkout_unavailable');
  return path;
}
